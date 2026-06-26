#!/usr/bin/env python3
"""
Mio — Transcript Data Collector

Reads Mio's JSONL session transcript files and converts them to
fine-tuning format (OpenAI chat JSONL).

Usage:
    python collect_data.py --data-dir ./data --soul-dir ./mods
    python collect_data.py --data-dir ./data --soul-dir ./mods --output ./my-training-data

Filters:
    - Meaningful exchanges only (user > 10 chars, assistant > 5 chars)
    - No tool call turns (pure conversation only)
    - Negative examples extracted separately
"""

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Constants ───

MIN_USER_LENGTH = 10
MIN_ASSISTANT_LENGTH = 5
MAX_TURNS_PER_EXAMPLE = 5
MAX_CONVERSATION_TOKENS = 4096  # rough upper bound for packing

# Patterns indicating user dissatisfaction (negative examples)
NEGATIVE_USER_PATTERNS = re.compile(
    r"(算了|不说了|你走吧|没意思|算了算了|不想聊了|别说了|烦不烦|"
    r"你闭嘴|别烦我|走开|不想说话|今天不想聊)", re.UNICODE
)

MOCK_REPLY_PATTERN = re.compile(r"^\[mock reply", re.IGNORECASE)


# ─── Soul Loading ───

def load_soul(soul_dir: Path, mod_name: str = "girlfriend") -> str:
    """Load soul.md content for the given mod."""
    soul_path = soul_dir / mod_name / "soul.md"
    if not soul_path.exists():
        logger.warning("Soul not found at %s, falling back to default", soul_path)
        return ""
    content = soul_path.read_text(encoding="utf-8").strip()
    logger.info("Loaded soul for mod '%s' (%d chars)", mod_name, len(content))
    return content


def detect_mod(soul_dir: Path, session_id: str, transcripts_dir: Path) -> str:
    """
    Detect which mod was active during a session.
    Falls back to reading the .active-mod file or defaulting to 'girlfriend'.

    In the v1 collector, we use the .active-mod file if it exists,
    but the ideal approach would record the active mod in the transcript
    metadata when the session starts.
    """
    active_mod_path = soul_dir / ".active-mod"
    if active_mod_path.exists():
        mod = active_mod_path.read_text(encoding="utf-8").strip()
        if mod in ("boyfriend", "girlfriend"):
            return mod
    return "girlfriend"


# ─── Transcript Parsing ───

def parse_transcript(path: Path) -> list[dict[str, Any]]:
    """Parse a single JSONL transcript file into a list of message dicts."""
    messages: list[dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return messages

    for line_num, line in enumerate(text.strip().splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as exc:
            logger.warning("JSON parse error in %s line %d: %s", path, line_num, exc)
            continue

        msg_type = entry.get("type", "")
        if msg_type in ("message",):
            messages.append(entry)
        elif msg_type == "session_end":
            break  # stop at session end

    return messages


def is_meaningful_user(user_msg: dict) -> bool:
    """Check if a user message is meaningful (not just noise)."""
    content = user_msg.get("content", "").strip()
    if len(content) <= MIN_USER_LENGTH:
        return False
    return True


def is_meaningful_assistant(assistant_msg: dict) -> tuple[bool, Optional[str]]:
    """
    Check if an assistant message is meaningful.
    Returns (is_valid, rejection_reason).
    """
    content = assistant_msg.get("content", "").strip() if assistant_msg.get("content") else ""
    tool_calls = assistant_msg.get("toolCalls", [])

    # Check for tool calls
    if tool_calls and len(tool_calls) > 0:
        return False, "has_tool_calls"

    # Check for mock provider
    if not content or MOCK_REPLY_PATTERN.match(content):
        return False, "mock_reply"

    # Check minimum length
    if len(content) <= MIN_ASSISTANT_LENGTH:
        return False, "too_short"

    return True, None


def is_negative_user_feedback(user_msg: dict) -> bool:
    """Check if a user message contains dissatisfaction markers."""
    content = user_msg.get("content", "")
    return bool(NEGATIVE_USER_PATTERNS.search(content))


def extract_conversations(
    messages: list[dict],
    soul_content: str,
    session_id: str,
    mod: str,
) -> tuple[list[dict], list[dict]]:
    """
    Extract positive and negative conversation examples from a sequence of messages.

    Returns:
        (positive_examples, negative_examples)
        Each example is a dict: {"messages": [...], "meta": {...}}
    """
    positive: list[dict] = []
    negative: list[dict] = []

    # Build ordered list of user/assistant pairs
    i = 0
    while i < len(messages) - 1:
        if messages[i].get("role") == "user" and messages[i + 1].get("role") == "assistant":
            user_msg = messages[i]
            assistant_msg = messages[i + 1]

            user_content = user_msg.get("content", "").strip()
            assistant_content = assistant_msg.get("content", "").strip() if assistant_msg.get("content") else ""

            meta = {
                "session_id": session_id,
                "mod": mod,
                "timestamp": user_msg.get("timestamp", ""),
                "is_augmented": False,
                "source": "transcript",
            }

            # Check for negative examples
            is_neg_user_feedback = is_negative_user_feedback(user_msg)
            is_neg_short_user = not is_meaningful_user(user_msg)
            asst_valid, asst_reason = is_meaningful_assistant(assistant_msg)

            if is_neg_user_feedback or is_neg_short_user:
                # Negative example
                negative.append({
                    "messages": [
                        {"role": "system", "content": soul_content},
                        {"role": "user", "content": user_content},
                        {"role": "assistant", "content": assistant_content},
                    ],
                    "meta": {**meta, "negative_reason": "user_feedback" if is_neg_user_feedback else "short_user"},
                })
            elif not asst_valid:
                # Assistant reply was problematic
                negative.append({
                    "messages": [
                        {"role": "system", "content": soul_content},
                        {"role": "user", "content": user_content},
                        {"role": "assistant", "content": assistant_content},
                    ],
                    "meta": {**meta, "negative_reason": asst_reason or "invalid_assistant"},
                })
            else:
                # Positive example
                positive.append({
                    "messages": [
                        {"role": "system", "content": soul_content},
                        {"role": "user", "content": user_content},
                        {"role": "assistant", "content": assistant_content},
                    ],
                    "meta": meta,
                })
            i += 2
        else:
            i += 1

    return positive, negative


def build_multi_turn_examples(
    positive: list[dict],
    max_turns: int = MAX_TURNS_PER_EXAMPLE,
) -> list[dict]:
    """
    Merge consecutive single-turn examples into multi-turn conversations.
    Each resulting example has up to `max_turns` user/assistant pairs.
    """
    if not positive:
        return []

    multi_turn: list[dict] = []
    buffer: list[dict] = []
    current_mod: Optional[str] = None
    current_soul: Optional[str] = None

    for example in positive:
        msgs = example["messages"]
        meta = example["meta"]
        soul = msgs[0]["content"]  # system message
        user_content = msgs[1]["content"]
        asst_content = msgs[2]["content"]

        # Detect mod/soul change — start a new conversation if different
        if (current_soul is not None and soul != current_soul) or \
           (current_mod is not None and meta.get("mod") != current_mod):
            # Flush the buffer
            if buffer:
                multi_turn.append({
                    "messages": [
                        {"role": "system", "content": current_soul},
                        *buffer,
                    ],
                    "meta": {**buffer[0]["meta"], "multi_turn": f"{len(buffer)//2}_turns"},
                })
                buffer = []

        current_soul = soul
        current_mod = meta.get("mod", current_mod)
        buffer.append({"role": "user", "content": user_content})
        buffer.append({"role": "assistant", "content": asst_content})

        # Flush when buffer reaches max turns
        if len(buffer) // 2 >= max_turns:
            multi_turn.append({
                "messages": [
                    {"role": "system", "content": current_soul},
                    *buffer,
                ],
                "meta": {**meta, "multi_turn": f"{len(buffer)//2}_turns"},
            })
            buffer = []

    # Flush remaining buffer
    if buffer:
        multi_turn.append({
            "messages": [
                {"role": "system", "content": current_soul},
                *buffer,
            ],
            "meta": {**buffer[0]["meta"], "multi_turn": f"{len(buffer)//2}_turns"},
        })

    return multi_turn


# ─── Main Pipeline ───

def find_transcript_files(transcripts_dir: Path) -> list[Path]:
    """Find all JSONL transcript files in the transcripts directory."""
    if not transcripts_dir.exists():
        logger.warning("Transcripts directory not found: %s", transcripts_dir)
        return []
    files = sorted(transcripts_dir.glob("*.jsonl"))
    logger.info("Found %d transcript files in %s", len(files), transcripts_dir)
    return files


def collect_data(
    transcripts_dir: Path,
    soul_dir: Path,
    output_dir: Path,
    mod_name: Optional[str] = None,
    split_eval: float = 0.1,
) -> dict[str, int]:
    """
    Run the full data collection pipeline.

    Args:
        transcripts_dir: Directory containing session JSONL files.
        soul_dir: Directory containing mod soul.md files.
        output_dir: Output directory for training data.
        mod_name: Optional mod override (auto-detected if None).
        split_eval: Fraction of examples to hold out for evaluation.

    Returns:
        Stats dict with counts of collected examples.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    eval_dir = output_dir / "eval"
    eval_dir.mkdir(parents=True, exist_ok=True)

    transcript_files = find_transcript_files(transcripts_dir)
    if not transcript_files:
        logger.warning("No transcript files found. Creating placeholder output.")
        # Write empty files
        _write_jsonl(output_dir / "conversations.jsonl", [])
        _write_jsonl(output_dir / "conversations_negative.jsonl", [])
        return {"positive": 0, "negative": 0, "sessions": 0, "files": 0}

    all_positive: list[dict] = []
    all_negative: list[dict] = []
    session_count = 0

    for tfile in transcript_files:
        session_id = tfile.stem
        mod = mod_name or detect_mod(soul_dir, session_id, transcripts_dir)
        soul_content = load_soul(soul_dir, mod)

        messages = parse_transcript(tfile)
        if not messages:
            continue

        positive, negative = extract_conversations(messages, soul_content, session_id, mod)
        all_positive.extend(positive)
        all_negative.extend(negative)
        session_count += 1
        logger.debug(
            "Session %s: %d positive, %d negative",
            session_id, len(positive), len(negative),
        )

    # Build multi-turn examples
    multi_positive = build_multi_turn_examples(all_positive)
    logger.info(
        "Collected %d single-turn positive, %d multi-turn positive, %d negative examples",
        len(all_positive), len(multi_positive), len(all_negative),
    )

    # Combine: prefer multi-turn, fall back to single-turn for non-merged
    speaker = set(e["meta"].get("session_id", "") for e in multi_positive)
    single_remain = [e for e in all_positive if e["meta"].get("session_id", "") not in speaker]
    final_positive = multi_positive + single_remain

    # Shuffle and split
    import random
    random.seed(42)
    random.shuffle(final_positive)

    split_idx = max(1, int(len(final_positive) * split_eval))
    eval_examples = final_positive[:split_idx]
    train_examples = final_positive[split_idx:]

    # Write outputs
    _write_jsonl(output_dir / "conversations.jsonl", train_examples)
    _write_jsonl(output_dir / "conversations_negative.jsonl", all_negative)
    _write_jsonl(eval_dir / "held_out.jsonl", eval_examples)

    # Write stats
    stats = _compute_stats(train_examples, all_negative, session_count, transcript_files)
    _write_json(output_dir / "processed" / "dataset_stats.json", stats)

    logger.info(
        "Output: %d train, %d eval, %d negative examples across %d sessions",
        len(train_examples), len(eval_examples), len(all_negative), session_count,
    )

    return {
        "positive": len(final_positive),
        "negative": len(all_negative),
        "positive_train": len(train_examples),
        "positive_eval": len(eval_examples),
        "sessions": session_count,
        "files": len(transcript_files),
    }


def _write_jsonl(path: Path, examples: list[dict]) -> None:
    """Write a list of examples to a JSONL file."""
    with open(path, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    logger.info("Wrote %d examples to %s", len(examples), path)


def _write_json(path: Path, data: dict) -> None:
    """Write a dict to a JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info("Wrote stats to %s", path)


def _compute_stats(
    train: list[dict],
    negative: list[dict],
    session_count: int,
    transcript_files: list[Path],
) -> dict:
    """Compute dataset statistics."""
    total_messages = sum(len(ex["messages"]) for ex in train)
    total_text_len = sum(
        len(m["content"]) for ex in train for m in ex["messages"]
    )
    mods: dict[str, int] = {}
    for ex in train:
        mod = ex["meta"].get("mod", "unknown")
        mods[mod] = mods.get(mod, 0) + 1

    return {
        "train_examples": len(train),
        "negative_examples": len(negative),
        "total_messages": total_messages,
        "total_text_length_chars": total_text_len,
        "avg_messages_per_example": round(total_messages / max(len(train), 1), 2),
        "mod_distribution": mods,
        "sessions_processed": session_count,
        "transcript_files_processed": len(transcript_files),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


# ─── CLI ───

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mio — Collect training data from session transcripts",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example:
  python collect_data.py --data-dir ./data --soul-dir ./mods
  python collect_data.py --data-dir ./data --soul-dir ./mods --mod girlfriend --output ./custom-output
  python collect_data.py --data-dir ./data --soul-dir ./mods --no-split
        """,
    )

    parser.add_argument(
        "--data-dir",
        type=str,
        default="./data",
        help="Path to Mio data directory (default: ./data)",
    )
    parser.add_argument(
        "--soul-dir",
        type=str,
        default="./mods",
        help="Path to mod soul.md files (default: ./mods)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output directory for training data (default: <data-dir>/training)",
    )
    parser.add_argument(
        "--mod",
        type=str,
        default=None,
        choices=["boyfriend", "girlfriend"],
        help="Force a specific mod (auto-detected if omitted)",
    )
    parser.add_argument(
        "--eval-split",
        type=float,
        default=0.1,
        help="Fraction of examples to hold out for evaluation (default: 0.1)",
    )
    parser.add_argument(
        "--no-split",
        action="store_true",
        help="Do not split into train/eval (output all as conversations.jsonl)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )

    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    data_dir = Path(args.data_dir).resolve()
    soul_dir = Path(args.soul_dir).resolve()
    output_dir = Path(args.output).resolve() if args.output else (data_dir / "training")

    transcripts_dir = data_dir / "transcripts"

    logger.info("Data dir: %s", data_dir)
    logger.info("Soul dir: %s", soul_dir)
    logger.info("Output dir: %s", output_dir)
    logger.info("Transcripts: %s", transcripts_dir)

    stats = collect_data(
        transcripts_dir=transcripts_dir,
        soul_dir=soul_dir,
        output_dir=output_dir,
        mod_name=args.mod,
        split_eval=0.0 if args.no_split else args.eval_split,
    )

    print(f"\nCollection complete:")
    print(f"  Sessions processed:  {stats['sessions']}")
    print(f"  Transcript files:    {stats['files']}")
    print(f"  Positive examples:   {stats.get('positive_train', stats['positive'])} train, {stats.get('positive_eval', 0)} eval")
    print(f"  Negative examples:   {stats['negative']}")
    print(f"  Output:              {output_dir}")


if __name__ == "__main__":
    main()
