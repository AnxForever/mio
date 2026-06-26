#!/usr/bin/env python3
"""
Mio — Training Data Augmentation

Augments Mio's collected conversation data to increase volume and diversity
for more robust fine-tuning. Uses:
  1. Persona variation: swaps soul.md variants in the system message
  2. Paraphrasing: uses an LLM (OpenAI-compatible API) to paraphrase user messages
  3. Contrastive pairs: generates "bad" responses paired with the original good ones

Augmentation target: 3-5x original volume.

Usage:
    python augment.py --data ./data/training/conversations.jsonl --soul-dir ./mods
    python augment.py --data ./data/training/conversations.jsonl --soul-dir ./mods --api-key sk-xxx --api-base https://api.openai.com/v1
    python augment.py --data ./data/training/conversations.jsonl --soul-dir ./mods --no-paraphrase --no-contrastive
"""

import argparse
import json
import logging
import random
import re
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable, Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Soul Variants for Persona Variation ───

def load_soul_variants(soul_dir: Path) -> dict[str, str]:
    """Load all available soul.md files as persona variants."""
    variants: dict[str, str] = {}

    # Main mod souls
    for mod in ("boyfriend", "girlfriend"):
        path = soul_dir / mod / "soul.md"
        if path.exists():
            content = path.read_text(encoding="utf-8").strip()
            if content:
                variants[f"mod/{mod}"] = content

    # Also check memory-bank working copy
    bank_soul = soul_dir.parent / "memory-bank" / "cola-self-reference" / "soul.md"
    if bank_soul.exists():
        content = bank_soul.read_text(encoding="utf-8").strip()
        if content:
            variants["bank/soul"] = content

    logger.info("Loaded %d soul variants: %s", len(variants), list(variants.keys()))
    return variants


# ─── Persona Variation ───

def augment_persona_variation(
    example: dict,
    soul_variants: dict[str, str],
    target_mod: Optional[str] = None,
) -> list[dict]:
    """
    Create variants of the example by swapping the system message with
    different soul.md versions.

    Returns a list of augmented examples (may be empty if no swap possible).
    """
    if len(soul_variants) <= 1:
        return []  # no other variants to swap to

    current_soul = example["messages"][0]["content"]
    results: list[dict] = []

    for name, variant_soul in soul_variants.items():
        if variant_soul == current_soul:
            continue

        # If target_mod is specified, only swap to that mod's soul
        if target_mod and target_mod not in name:
            continue

        new_example = deepcopy(example)
        new_example["messages"][0]["content"] = variant_soul
        new_example["meta"] = {
            **example["meta"],
            "is_augmented": True,
            "augmentation_type": "persona_variant",
            "original_soul": _soul_fingerprint(current_soul),
            "variant_soul": name,
        }
        results.append(new_example)

    return results


def _soul_fingerprint(soul: str) -> str:
    """Create a short fingerprint for a soul content (for dedup tracking)."""
    import hashlib
    return hashlib.md5(soul.encode("utf-8")).hexdigest()[:8]


# ─── Paraphrasing (LLM-based) ───

PARAPHRASE_SYSTEM_PROMPT = (
    "你是一个数据增强助手。你的任务是用不同的措辞改写用户的聊天消息，"
    "但要保持：1) 原始意图完全不变 2) 语气和情感强度相同 3) 长度相近 "
    "4) 仍然是中文口语。每条消息只输出改写后的结果，不要附加任何解释。"
)

PARAPHRASE_PROMPT_TEMPLATE = "请用不同的方式表达这句话（保持原意和语气）：\n{user_content}"


def call_paraphrase_api(
    user_content: str,
    api_key: str,
    api_base: str = "https://api.openai.com/v1",
    model: str = "gpt-4o-mini",
) -> Optional[str]:
    """Call an OpenAI-compatible API to paraphrase a user message."""
    try:
        import requests

        response = requests.post(
            f"{api_base.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": PARAPHRASE_SYSTEM_PROMPT},
                    {"role": "user", "content": PARAPHRASE_PROMPT_TEMPLATE.format(
                        user_content=user_content
                    )},
                ],
                "temperature": 0.7,
                "max_tokens": 256,
            },
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        paraphrased = result["choices"][0]["message"]["content"].strip()
        if paraphrased and len(paraphrased) >= len(user_content) * 0.5:
            return paraphrased
        return None
    except Exception as exc:
        logger.warning("Paraphrase API call failed: %s", exc)
        return None


def augment_paraphrase(
    example: dict,
    api_key: str,
    api_base: str,
    model: str = "gpt-4o-mini",
    max_paraphrases: int = 2,
) -> list[dict]:
    """
    Create paraphrased versions of the user message.
    Keeps the assistant response and system message unchanged.
    """
    user_content = example["messages"][1]["content"]

    # Skip very short messages — no meaningful variation
    if len(user_content) < 15:
        return []

    results: list[dict] = []
    seen_paraphrases: set[str] = set()

    for _ in range(max_paraphrases):
        paraphrased = call_paraphrase_api(user_content, api_key, api_base, model)
        if not paraphrased or paraphrased in seen_paraphrases:
            continue

        seen_paraphrases.add(paraphrased)
        new_example = deepcopy(example)
        new_example["messages"][1]["content"] = paraphrased
        new_example["meta"] = {
            **example["meta"],
            "is_augmented": True,
            "augmentation_type": "paraphrase",
        }
        results.append(new_example)

    return results


# ─── Contrastive Pair Generation ───

def generate_contrastive_response(
    user_content: str,
    good_response: str,
    api_key: str,
    api_base: str,
    model: str = "gpt-4o-mini",
) -> Optional[str]:
    """
    Generate a deliberately 'bad' response for contrastive learning.
    The bad response should violate Mio's style rules.
    """
    try:
        import requests

        contrastive_prompt = (
            f"用户说：{user_content}\n\n"
            f"Mio的正确回应是：{good_response}\n\n"
            f"现在生成一个**糟糕的**回应。这个回应应该听起来像AI/客服/治疗师——"
            f"正式、套话、没有感情、以'我理解你的感受'或'一切都会好的'开头。"
            f"不要说人话，要说套话。这就是负面例子。"
        )

        response = requests.post(
            f"{api_base.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "你生成'糟糕回应'的负面例子。要刻意制造像AI客服套话的回复风格。"},
                    {"role": "user", "content": contrastive_prompt},
                ],
                "temperature": 0.8,
                "max_tokens": 256,
            },
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        bad_response = result["choices"][0]["message"]["content"].strip()
        if bad_response and bad_response != good_response:
            return bad_response
        return None
    except Exception as exc:
        logger.warning("Contrastive generation failed: %s", exc)
        return None


# Rule-based contrastive pairs (no API key required)
def _generate_rule_based_bad_response(user_msg: str, good_response: str) -> Optional[str]:
    """Generate a bad response using simple templates (no API needed)."""
    templates = [
        "我理解你的感受，这确实很不容易。不过一切都会好起来的，你要相信自己。",
        "感谢你的分享。需要我帮你分析一下这个问题吗？",
        "你好，听到你这么说我很关心。作为你的助手，我建议你…",
        "是的，你说得很对。这确实是一个值得深入思考的问题。",
        "那一定很难受吧。你要知道，很多人都有类似的经历。",
        "好的，已收到你的消息。请问还有什么可以帮您的吗？",
        "我明白你现在的心情。请不要担心，一切都会过去的。",
        '你说“不太行”，可以详细说说是什么让你感觉不太好吗？',
    ]
    return random.choice(templates)


def augment_contrastive(
    example: dict,
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    model: str = "gpt-4o-mini",
) -> list[dict]:
    """
    Create contrastive pairs: for each good response, generate a bad one.
    If no API key, uses rule-based templates.
    """
    user_content = example["messages"][1]["content"]
    good_response = example["messages"][2]["content"]

    bad_response: Optional[str] = None

    if api_key and api_base:
        bad_response = generate_contrastive_response(
            user_content, good_response, api_key, api_base, model
        )

    if not bad_response:
        bad_response = _generate_rule_based_bad_response(user_content, good_response)

    if not bad_response:
        return []

    # Create two outputs: one for DPO rejection, one negative example
    negative_example = deepcopy(example)
    negative_example["messages"][2]["content"] = bad_response
    negative_example["meta"] = {
        **example["meta"],
        "is_augmented": True,
        "augmentation_type": "contrastive_negative",
        "original_response": good_response[:100],
    }

    return [negative_example]


# ─── Rule-Based Paraphrasing (No API) ───

def _rule_based_paraphrase(text: str) -> list[str]:
    """
    Simple rule-based paraphrasing for Chinese text.
    Doesn't require an API key. Returns up to 2 variants.
    """
    variants: list[str] = []

    # Synonym swaps
    synonym_pairs = [
        ("好累", "累死了, 累得不行, 快废了"),
        ("好累", "累趴了"),
        ("今天", "今天"),
        ("下班", "下班"),
    ]

    # Find first match and swap
    for orig, replacements in synonym_pairs:
        if orig in text:
            for replacement in replacements.split(", "):
                variant = text.replace(orig, replacement, 1)
                if variant != text and variant not in variants:
                    variants.append(variant)
                if len(variants) >= 2:
                    break
            break

    # Word order variation (for longer text)
    if len(text) > 8 and len(variants) < 2:
        # Try swapping clauses around comma
        if "，" in text:
            parts = text.split("，")
            if len(parts) == 2:
                variant = f"{parts[1].strip()}，{parts[0].strip()}"
                if variant != text:
                    variants.append(variant)
        elif "但是" in text or "不过" in text:
            for conj in ["但是", "不过"]:
                if conj in text:
                    before, after = text.split(conj, 1)
                    variant = f"{after}，{conj}{before}"
                    if variant != text:
                        variants.append(variant)
                    break

    # Add "感觉" prefix for certain statements (soften)
    if any(starter in text[:3] for starter in ["好", "太", "真的", "有点"]):
        if len(variants) < 2:
            variant = f"感觉{text[0].lower()}{text[1:]}"
            # Chinese: just prefix naturally
            variant = text + " 真的"
            if len(variants) < 2 and variant not in variants:
                variants.append(variant)

    return variants[:2]


def augment_rule_based_paraphrase(example: dict) -> list[dict]:
    """Apply rule-based paraphrasing to create simple variants."""
    user_content = example["messages"][1]["content"]
    variants = _rule_based_paraphrase(user_content)
    results: list[dict] = []

    for variant in variants:
        new_example = deepcopy(example)
        new_example["messages"][1]["content"] = variant
        new_example["meta"] = {
            **example["meta"],
            "is_augmented": True,
            "augmentation_type": "rule_paraphrase",
        }
        results.append(new_example)

    return results


# ─── Augmentation Pipeline ───

def augment_dataset(
    input_path: Path,
    output_path: Path,
    soul_dir: Path,
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    paraphrase_model: str = "gpt-4o-mini",
    max_paraphrases: int = 2,
    enable_persona: bool = True,
    enable_paraphrase: bool = True,
    enable_contrastive: bool = True,
    target_mod: Optional[str] = None,
    seed: int = 42,
) -> dict[str, int]:
    """
    Run the full augmentation pipeline.

    Returns:
        Stats dict with augmentation counts.
    """
    random.seed(seed)

    # Load examples
    if not input_path.exists():
        logger.warning("Input file not found: %s", input_path)
        return {"original": 0, "augmented": 0, "total": 0}

    with open(input_path, "r", encoding="utf-8") as f:
        examples = [json.loads(line) for line in f if line.strip()]
    logger.info("Loaded %d original examples from %s", len(examples), input_path)

    # Load soul variants
    soul_variants = load_soul_variants(soul_dir)

    # Process each example
    augmented: list[dict] = []
    stats = {
        "persona_variants": 0,
        "paraphrases": 0,
        "rule_paraphrases": 0,
        "contrastive": 0,
    }

    for idx, example in enumerate(examples):
        # 1. Persona variation
        if enable_persona and soul_variants:
            variants = augment_persona_variation(example, soul_variants, target_mod)
            augmented.extend(variants)
            stats["persona_variants"] += len(variants)

        # 2. Rule-based paraphrasing (always available)
        rule_paraphrases = augment_rule_based_paraphrase(example)
        augmented.extend(rule_paraphrases)
        stats["rule_paraphrases"] += len(rule_paraphrases)

        # 3. LLM-based paraphrasing
        if enable_paraphrase and api_key and api_base:
            try:
                paraphrases = augment_paraphrase(
                    example, api_key, api_base, paraphrase_model, max_paraphrases
                )
                augmented.extend(paraphrases)
                stats["paraphrases"] += len(paraphrases)
            except Exception as exc:
                logger.warning("Paraphrasing failed for example %d: %s", idx, exc)

        # 4. Contrastive pairs
        if enable_contrastive:
            contrastive = augment_contrastive(
                example,
                api_key=api_key,
                api_base=api_base,
                model=paraphrase_model,
            )
            augmented.extend(contrastive)
            stats["contrastive"] += len(contrastive)

        if (idx + 1) % 50 == 0:
            logger.info("Processed %d/%d examples...", idx + 1, len(examples))

    # Shuffle augmented examples
    random.shuffle(augmented)

    # Combine original + augmented
    final_output = examples + augmented
    random.shuffle(final_output)

    # Write output
    with open(output_path, "w", encoding="utf-8") as f:
        for ex in final_output:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    augmentation_ratio = len(final_output) / max(len(examples), 1)
    logger.info(
        "Augmentation complete: %d original -> %d total (%.1fx ratio)\n"
        "  Persona variants: %d\n"
        "  Rule paraphrases: %d\n"
        "  LLM paraphrases:  %d\n"
        "  Contrastive:      %d",
        len(examples), len(final_output), augmentation_ratio,
        stats["persona_variants"],
        stats["rule_paraphrases"],
        stats["paraphrases"],
        stats["contrastive"],
    )

    return {
        "original": len(examples),
        "augmented": len(augmented),
        "total": len(final_output),
        "ratio": round(augmentation_ratio, 2),
        **stats,
    }


# ─── CLI ───

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mio — Data Augmentation for Fine-tuning",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python augment.py --data ./data/training/conversations.jsonl --soul-dir ./mods
  python augment.py --data ./data/training/conversations.jsonl --soul-dir ./mods --api-key sk-xxx --api-base https://api.openai.com/v1
  python augment.py --data ./data/training/conversations.jsonl --soul-dir ./mods --no-paraphrase --no-contrastive
  python augment.py --data ./data/training/conversations.jsonl --soul-dir ./mods --paraphrase-model gpt-4o-mini --max-paraphrases 3
        """,
    )

    parser.add_argument(
        "--data", "-d",
        type=str,
        required=True,
        help="Path to input conversations.jsonl",
    )
    parser.add_argument(
        "--soul-dir",
        type=str,
        default="./mods",
        help="Path to mod soul.md files (default: ./mods)",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="Output path for augmented data (default: <input_dir>/conversations_augmented.jsonl)",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default=None,
        help="API key for LLM-based paraphrasing",
    )
    parser.add_argument(
        "--api-base",
        type=str,
        default="https://api.openai.com/v1",
        help="API base URL for paraphrasing (default: OpenAI)",
    )
    parser.add_argument(
        "--paraphrase-model",
        type=str,
        default="gpt-4o-mini",
        help="Model to use for paraphrasing (default: gpt-4o-mini)",
    )
    parser.add_argument(
        "--max-paraphrases",
        type=int,
        default=2,
        help="Max paraphrases per example (default: 2)",
    )
    parser.add_argument(
        "--no-persona",
        action="store_true",
        help="Disable persona variation augmentation",
    )
    parser.add_argument(
        "--no-paraphrase",
        action="store_true",
        help="Disable LLM paraphrasing augmentation",
    )
    parser.add_argument(
        "--no-contrastive",
        action="store_true",
        help="Disable contrastive pair generation",
    )
    parser.add_argument(
        "--target-mod",
        type=str,
        default=None,
        choices=["boyfriend", "girlfriend"],
        help="Only generate persona variants for this mod",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed (default: 42)",
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

    input_path = Path(args.data).resolve()
    soul_dir = Path(args.soul_dir).resolve()
    output_path = Path(args.output).resolve() if args.output else (
        input_path.parent / "conversations_augmented.jsonl"
    )

    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    api_base = args.api_base or os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1")

    if args.no_paraphrase and args.no_contrastive and args.no_persona:
        logger.warning("All augmentation types disabled. Output will be identical to input.")

    logger.info("Input:  %s", input_path)
    logger.info("Output: %s", output_path)
    logger.info("Soul dir: %s", soul_dir)
    logger.info("API key present: %s", bool(api_key))

    stats = augment_dataset(
        input_path=input_path,
        output_path=output_path,
        soul_dir=soul_dir,
        api_key=api_key,
        api_base=api_base,
        paraphrase_model=args.paraphrase_model,
        max_paraphrases=args.max_paraphrases,
        enable_persona=not args.no_persona,
        enable_paraphrase=not args.no_paraphrase,
        enable_contrastive=not args.no_contrastive,
        target_mod=args.target_mod,
        seed=args.seed,
    )

    print(f"\nAugmentation complete:")
    print(f"  Original examples: {stats['original']}")
    print(f"  Augmented examples: {stats['augmented']}")
    print(f"  Total: {stats['total']} ({stats.get('ratio', '?')}x)")
    print(f"  Persona variants: {stats.get('persona_variants', 0)}")
    print(f"  Rule paraphrases: {stats.get('rule_paraphrases', 0)}")
    print(f"  LLM paraphrases: {stats.get('paraphrases', 0)}")
    print(f"  Contrastive pairs: {stats.get('contrastive', 0)}")
    print(f"  Output: {output_path}")


if __name__ == "__main__":
    main()
