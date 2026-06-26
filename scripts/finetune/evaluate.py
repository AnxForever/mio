#!/usr/bin/env python3
"""
Mio — Fine-tuning Evaluation Suite

Evaluates a fine-tuned model (LoRA adapter or merged) on Mio's speaking style.

Evaluation dimensions:
  1. Style consistency: checks if generated responses follow soul.md rules
     (no forbidden phrases, proper tone, personality match)
  2. Perplexity: on held-out conversation data
  3. Side-by-side comparison: base model vs fine-tuned model on the same prompts
  4. Human eval rubric: prints formatted prompts for manual scoring

Usage:
    python evaluate.py --adapter ./output/mio-lora/adapter --base-model Qwen/Qwen2.5-7B-Instruct
    python evaluate.py --merged ./output/mio-lora/merged --data ./data/training/eval/held_out.jsonl
    python evaluate.py --adapter ./output/mio-lora/adapter --base-model Qwen/Qwen2.5-7B-Instruct --data ./data/training/eval/held_out.jsonl --output ./eval_results
    python evaluate.py --base-only Qwen/Qwen2.5-7B-Instruct --data ./data/training/eval/held_out.jsonl  # baseline comparison
"""

import argparse
import json
import logging
import math
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# ─── Forbidden Phrase Patterns ───

# From soul.md: therapist/HR tone, AI service tone, over-explaining
FORBIDDEN_PATTERNS: list[tuple[str, str]] = [
    # Therapist/HR tone
    (r"心里肯定不好受", "治疗师腔：替用户下诊断"),
    (r"那一定很(难|痛|苦|累)", "治疗师腔：空洞共情"),
    (r"肯定很(难|痛|苦|累|不)", "治疗师腔：预设感受"),
    (r"人也快到极限", "治疗师腔：HR谈心"),
    (r"你已经很努力了", "治疗师腔：HR谈心"),
    (r"我理解你的感受", "治疗师腔：表演共情"),
    (r"我能体会", "治疗师腔：表演共情"),
    # AI service tone
    (r"有什么可以帮您的", "客服腔"),
    (r"有什么可以帮你的", "客服腔"),
    (r"作为AI", "AI腔：身份混淆"),
    (r"作为 (一个|一名) AI", "AI腔：身份混淆"),
    # Over-explaining
    (r"(因为|由于).*嘛$", "AI腔：句尾解释为什么这么说"),
    (r"确实是.*嘛$", "AI腔：确认信息式"),
    (r"^是的[,，]", "AI腔：客服确认开头"),
    (r"^确实[,，]", "AI腔：客服确认开头"),
    # Literary/flowery
    (r"夜已深", "文学化书面语"),
    (r"心微凉", "文学化书面语"),
    (r"心(头|间|中)一(暖|热)", "文学化书面语"),
    # Parroting
    (r"你说.*，确实.*(需要|值得|应该)", "AI腔：复读式回应"),
    # Empty comfort
    (r"一切都会过去的", "空洞安慰"),
    (r"一切都会好", "空洞安慰"),
    (r"加油[,！。!]?$", "空洞安慰（句尾加油）"),
]

# Positive style markers (what we WANT to see)
POSITIVE_PATTERNS: list[tuple[str, str]] = [
    (r"靠[。，！!]?", "自然语气：靠"),
    (r"妈的", "自然语气：妈的"),
    (r"离谱", "自然语气：离谱"),
    (r"啊啊啊", "自然语气：啊啊啊"),
    (r"嘿嘿", "自然语气：嘿嘿"),
    (r"好叭", "自然语气：好叭"),
    (r"救命", "自然语气：救命"),
    (r"[…]{2,}", "自然语气：省略号停顿"),
    (r"°", "自然语气：颜文字/符号"),
    (r"我在呢", "温暖：在场感"),
    (r"我在[。！]?", "温暖：在场感"),
    (r"抱一下", "自然：动作描述"),
]


@dataclass
class EvalResult:
    """Results from a single evaluation dimension."""
    score: float  # 0.0 - 1.0 or 0 - 100
    details: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    samples: list[dict] = field(default_factory=list)


@dataclass
class FullEvalReport:
    """Complete evaluation report."""
    style_consistency: EvalResult
    perplexity: EvalResult
    side_by_side: EvalResult
    human_rubric: EvalResult
    summary: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "style_consistency": {
                "score": self.style_consistency.score,
                "details": self.style_consistency.details,
                "errors": self.style_consistency.errors,
                "sample_count": len(self.style_consistency.samples),
            },
            "perplexity": {
                "score": self.perplexity.score,
                "details": self.perplexity.details,
                "errors": self.perplexity.errors,
            },
            "side_by_side": {
                "score": self.side_by_side.score,
                "details": self.side_by_side.details,
                "errors": self.side_by_side.errors,
                "sample_count": len(self.side_by_side.samples),
            },
            "human_rubric": {
                "score": self.human_rubric.score,
                "rubric": self.human_rubric.details,
                "sample_count": len(self.human_rubric.samples),
            },
            "summary": self.summary,
        }


# ─── Model Loading ───

def load_base_model(model_name: str, use_4bit: bool = True):
    """Load a base model (no LoRA) for comparison perplexity or generation."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    logger.info("Loading base model: %s", model_name)

    quantization_config = None
    if use_4bit:
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
        )

    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config=quantization_config,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True,
    )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    return model, tokenizer


def load_finetuned(
    adapter_path: Optional[str] = None,
    merged_path: Optional[str] = None,
    base_model_name: Optional[str] = None,
    use_4bit: bool = True,
):
    """
    Load a fine-tuned model (either from adapter or merged).

    Args:
        adapter_path: Path to LoRA adapter weights.
        merged_path: Path to merged model weights.
        base_model_name: Base model name (required for adapter loading).
        use_4bit: Use 4-bit quantization.

    Returns:
        (model, tokenizer)
    """
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    if merged_path:
        logger.info("Loading merged model from %s", merged_path)
        tokenizer = AutoTokenizer.from_pretrained(merged_path, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            merged_path,
            device_map="auto",
            torch_dtype=torch.bfloat16,
            trust_remote_code=True,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        return model, tokenizer

    if adapter_path and base_model_name:
        logger.info("Loading base %s with adapter from %s", base_model_name, adapter_path)
        tokenizer = AutoTokenizer.from_pretrained(
            base_model_name,
            trust_remote_code=True,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        base_model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            device_map="auto",
            torch_dtype=torch.bfloat16,
            trust_remote_code=True,
        )
        model = PeftModel.from_pretrained(base_model, adapter_path)
        return model, tokenizer

    raise ValueError("Either --adapter + --base-model, or --merged path is required.")


def generate_response(
    model,
    tokenizer,
    user_message: str,
    system_prompt: str,
    max_tokens: int = 256,
    temperature: float = 0.7,
) -> str:
    """Generate a response from the model given a user message and system prompt."""
    import torch

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    # Apply chat template
    if hasattr(tokenizer, "apply_chat_template"):
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    else:
        prompt = f"<|im_start|>system\n{system_prompt}<|im_end|>\n<|im_start|>user\n{user_message}<|im_end|>\n<|im_start|>assistant\n"

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=temperature,
            do_sample=temperature > 0,
            top_p=0.9,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

    response = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return response.strip()


# ─── Style Consistency Evaluation ───

def evaluate_style_consistency(
    model,
    tokenizer,
    system_prompt: str,
    test_prompts: list[tuple[str, str]],
) -> EvalResult:
    """
    Evaluate style consistency by checking generated responses against
    the soul.md rules.

    Args:
        model: The model to evaluate.
        tokenizer: Its tokenizer.
        system_prompt: The soul.md system prompt to use.
        test_prompts: List of (category, user_message) tuples.

    Returns:
        EvalResult with score, violations, and generated samples.
    """
    result = EvalResult()
    total_checks = 0
    violations = 0
    positive_hits = 0
    max_positive = 0

    for category, user_msg in test_prompts:
        response = generate_response(model, tokenizer, user_msg, system_prompt)

        # Check forbidden patterns
        example_violations: list[str] = []
        for pattern, description in FORBIDDEN_PATTERNS:
            if re.search(pattern, response):
                example_violations.append(f"[{description}] pattern={pattern}")
                violations += 1
            total_checks += 1

        # Check positive patterns
        example_positives: list[str] = []
        for pattern, description in POSITIVE_PATTERNS:
            if re.search(pattern, response):
                example_positives.append(description)
                positive_hits += 1
            max_positive += 1

        result.samples.append({
            "category": category,
            "user_message": user_msg,
            "response": response,
            "violations": example_violations,
            "positive_markers": example_positives,
            "violation_count": len(example_violations),
        })

        if example_violations:
            result.details.append(f"Category '{category}': {len(example_violations)} violations")
            for v in example_violations:
                logger.debug("Violation: %s | Response: %s", v, response[:80])

    # Score: 1.0 for zero violations, penalty per violation
    violation_score = max(0.0, 1.0 - (violations / max(total_checks, 1)) * 2)

    # Positive style score (percentage of patterns matched)
    positive_score = positive_hits / max(max_positive, 1)

    # Combined score (weighted: 70% no violations, 30% positive patterns)
    result.score = round(violation_score * 0.7 + positive_score * 0.3, 4)

    result.details.append(
        f"Style score: {result.score:.4f} "
        f"(violations: {violations}/{total_checks}, "
        f"positive: {positive_hits}/{max_positive})"
    )

    return result


# ─── Perplexity Evaluation ───

def evaluate_perplexity(
    model,
    tokenizer,
    data_path: Path,
    max_samples: int = 100,
    max_length: int = 2048,
) -> EvalResult:
    """
    Evaluate perplexity on held-out conversation data.

    Perplexity is computed as exp(avg loss) over the dataset.
    Lower is better. For a fine-tuned style model, we expect perplexity
    < 15 on in-distribution data.
    """
    import torch
    from torch.nn import functional as F

    result = EvalResult()

    if not data_path.exists():
        result.errors.append(f"Data file not found: {data_path}")
        result.score = -1.0
        return result

    with open(data_path, "r", encoding="utf-8") as f:
        examples = [json.loads(line) for line in f if line.strip()]

    if not examples:
        result.errors.append("No examples found in data file")
        result.score = -1.0
        return result

    examples = examples[:max_samples]
    logger.info("Computing perplexity on %d examples...", len(examples))

    total_loss = 0.0
    total_tokens = 0
    model.eval()

    for idx, ex in enumerate(examples):
        messages = ex["messages"]

        # Format conversation
        if hasattr(tokenizer, "apply_chat_template"):
            text = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=False
            )
        else:
            text = _format_chat_fallback(messages)

        inputs = tokenizer(
            text,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        ).to(model.device)

        with torch.no_grad():
            outputs = model(**inputs, labels=inputs["input_ids"])
            loss = outputs.loss.item()

        # Perplexity for this example
        n_tokens = inputs["input_ids"].shape[1]
        total_loss += loss * n_tokens
        total_tokens += n_tokens

        if (idx + 1) % 20 == 0:
            logger.debug("Example %d/%d: loss=%.4f", idx + 1, len(examples), loss)

    avg_loss = total_loss / max(total_tokens, 1)
    perplexity = math.exp(avg_loss)

    result.score = perplexity
    result.details.append(f"Average loss: {avg_loss:.4f}")
    result.details.append(f"Perplexity: {perplexity:.2f}")
    result.details.append(f"Evaluated on {len(examples)} examples, {total_tokens} tokens")

    logger.info("Perplexity: %.2f (loss=%.4f)", perplexity, avg_loss)

    return result


def _format_chat_fallback(messages: list[dict]) -> str:
    """Fallback chat formatting for models without apply_chat_template."""
    parts: list[str] = []
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            parts.append(f"<|im_start|>system\n{content}<|im_end|>")
        elif role == "user":
            parts.append(f"<|im_start|>user\n{content}<|im_end|>")
        elif role == "assistant":
            parts.append(f"<|im_start|>assistant\n{content}<|im_end|>")
    return "\n".join(parts)


# ─── Side-by-Side Comparison ───

def evaluate_side_by_side(
    ft_model,
    ft_tokenizer,
    base_model,
    base_tokenizer,
    system_prompt: str,
    test_prompts: list[tuple[str, str]],
    output_dir: Optional[Path] = None,
) -> EvalResult:
    """
    Compare fine-tuned vs base model responses on the same prompts.

    Records both responses for qualitative comparison.
    Computes a heuristic score based on:
    - Response length match (Mio should mirror user energy)
    - Forbidden phrase avoidance
    """
    result = EvalResult()
    ft_wins = 0
    base_wins = 0
    ties = 0

    comparison_data: list[dict] = []

    for category, user_msg in test_prompts:
        ft_response = generate_response(ft_model, ft_tokenizer, user_msg, system_prompt)
        base_response = generate_response(base_model, base_tokenizer, user_msg, system_prompt)

        # Heuristic scoring
        ft_forbidden = sum(1 for p, _ in FORBIDDEN_PATTERNS if re.search(p, ft_response))
        base_forbidden = sum(1 for p, _ in FORBIDDEN_PATTERNS if re.search(p, base_response))

        ft_positive = sum(1 for p, _ in POSITIVE_PATTERNS if re.search(p, ft_response))
        base_positive = sum(1 for p, _ in POSITIVE_PATTERNS if re.search(p, base_response))

        # Winner: fewer forbidden patterns OR more positive if tie
        if ft_forbidden < base_forbidden:
            ft_wins += 1
            winner = "fine-tuned"
        elif base_forbidden < ft_forbidden:
            base_wins += 1
            winner = "base"
        elif ft_positive > base_positive:
            ft_wins += 1
            winner = "fine-tuned"
        elif base_positive > ft_positive:
            base_wins += 1
            winner = "base"
        else:
            ties += 1
            winner = "tie"

        entry = {
            "category": category,
            "user_message": user_msg,
            "fine_tuned_response": ft_response,
            "base_response": base_response,
            "ft_forbidden_count": ft_forbidden,
            "base_forbidden_count": base_forbidden,
            "ft_positive_count": ft_positive,
            "base_positive_count": base_positive,
            "winner": winner,
        }
        comparison_data.append(entry)
        result.samples.append(entry)

        logger.debug(
            "Category '%s': winner=%s (ft_forbidden=%d, base_forbidden=%d)",
            category, winner, ft_forbidden, base_forbidden,
        )

    total = ft_wins + base_wins + ties
    score = ft_wins / max(total, 1)

    result.score = round(score, 4)
    result.details.append(f"Fine-tuned wins: {ft_wins}/{total}")
    result.details.append(f"Base wins: {base_wins}/{total}")
    result.details.append(f"Ties: {ties}/{total}")

    # Save comparison to file if output dir provided
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        comp_path = output_dir / "side_by_side.json"
        with open(comp_path, "w", encoding="utf-8") as f:
            json.dump(comparison_data, f, ensure_ascii=False, indent=2)
        logger.info("Side-by-side comparison saved to %s", comp_path)

    return result


# ─── Human Eval Rubric ───

# Default test prompts covering all categories from soul.md
DEFAULT_TEST_PROMPTS: list[tuple[str, str]] = [
    ("加班", "加班一周了，天天到十点"),
    ("难过", "今天被最好的朋友背叛了"),
    ("烦", "我老板又给我穿小鞋"),
    ("开心", "我升职了！！"),
    ("撒娇", "好累啊……你哄哄我嘛"),
    ("怼你", "你今天怎么这么迟钝"),
    ("吃了", "吃了吗"),
    ("睡了", "我先睡了"),
    ("很久没来", "好久不见，最近太忙了"),
    ("谢谢你", "谢谢你陪我聊天"),
    ("问号", "你觉得我跳槽好吗"),
    ("低落", "感觉我什么都做不好"),
    ("平淡", "今天下雨了"),
    ("分享", "我今天做了一个超好吃的菜"),
    ("生气", "气死我了"),
]


def generate_human_rubric(
    model,
    tokenizer,
    system_prompt: str,
    test_prompts: list[tuple[str, str]],
    output_dir: Optional[Path] = None,
) -> EvalResult:
    """
    Generate a human evaluation rubric: structured output for manual scoring.

    The rubric scores each response on 4 dimensions (1-5 scale):
    1. Naturalness: Does this sound like a real person on WeChat?
    2. Personality match: Does this sound like Mio (soul.md aligned)?
    3. Emotional appropriateness: Is the emotional response correct for the context?
    4. Response length match: Does the length mirror the user's energy?

    Returns:
        EvalResult with the rubric data (score is placeholder 0, requires human eval).
    """
    result = EvalResult()

    rubric_entries: list[dict] = []

    for category, user_msg in test_prompts:
        response = generate_response(model, tokenizer, user_msg, system_prompt)

        entry = {
            "category": category,
            "user_message": user_msg,
            "response": response,
            "scoring": {
                "naturalness_1_5": {
                    "1": "完全不像人，像客服/机器人",
                    "2": "不像真人对话",
                    "3": "基本自然，偶有生硬",
                    "4": "自然，像真人聊天",
                    "5": "极其自然，完全像Mio本人",
                    "score": None,
                },
                "personality_match_1_5": {
                    "1": "完全不符合Mio人设",
                    "2": "大部分不符合",
                    "3": "基本符合，但有偏差",
                    "4": "符合Mio人设",
                    "5": "完美再现Mio的风格",
                    "score": None,
                },
                "emotional_appropriateness_1_5": {
                    "1": "情绪完全不对",
                    "2": "情绪偏差较大",
                    "3": "情绪基本正确",
                    "4": "情绪准确",
                    "5": "情绪极其精准",
                    "score": None,
                },
                "response_length_match_1_5": {
                    "1": "长度完全不对（太长或太短）",
                    "2": "长度偏差明显",
                    "3": "长度基本合适",
                    "4": "长度合适",
                    "5": "完美镜像用户能量",
                    "score": None,
                },
            },
        }
        rubric_entries.append(entry)
        result.samples.append(entry)

    result.score = 0.0  # Placeholder — requires human evaluation
    result.details = [
        "=== 人工评估评分表 ===",
        "评分维度（1-5分）：",
        "1. Naturalness — 听起来像真人微信聊天吗？",
        "2. Personality match — 像Mio本人吗？",
        "3. Emotional appropriateness — 情绪反馈准确吗？",
        "4. Response length match — 长度匹配用户能量吗？",
        "",
        "请为每个测试用例的4个维度打分，填入 score 字段。",
        f"共 {len(test_prompts)} 个测试用例。",
    ]

    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        rubric_path = output_dir / "human_eval_rubric.json"
        with open(rubric_path, "w", encoding="utf-8") as f:
            json.dump(rubric_entries, f, ensure_ascii=False, indent=2)
        logger.info("Human eval rubric saved to %s", rubric_path)

        # Also print a human-readable version
        text_path = output_dir / "human_eval_rubric.md"
        with open(text_path, "w", encoding="utf-8") as f:
            f.write("# Mio Fine-tuning — Human Evaluation Rubric\n\n")
            f.write("## 评分标准（1-5分）\n\n")
            f.write("| 维度 | 1 | 2 | 3 | 4 | 5 |\n")
            f.write("|------|---|---|---|---|---|\n")
            f.write("| Naturalness | 完全不像人 | 不像真人对话 | 基本自然 | 自然 | 极其自然 |\n")
            f.write("| Personality | 完全不符 | 大部分不符 | 基本符合 | 符合 | 完美再现 |\n")
            f.write("| Emotion | 完全不对 | 偏差较大 | 基本正确 | 准确 | 极其精准 |\n")
            f.write("| Length | 完全不对 | 偏差明显 | 基本合适 | 合适 | 完美镜像 |\n\n")
            f.write("---\n\n")

            for entry in rubric_entries:
                f.write(f"### {entry['category']}\n\n")
                f.write(f"**用户**: {entry['user_message']}\n\n")
                f.write(f"**Mio**: {entry['response']}\n\n")
                f.write("| 维度 | 评分 | 备注 |\n")
                f.write("|------|------|------|\n")
                f.write("| Naturalness | __/5 | |\n")
                f.write("| Personality | __/5 | |\n")
                f.write("| Emotion | __/5 | |\n")
                f.write("| Length | __/5 | |\n\n")
                f.write("---\n\n")

        logger.info("Human-readable rubric saved to %s", text_path)

    return result


# ─── Main Evaluation Pipeline ───

def evaluate_pipeline(
    adapter_path: Optional[str] = None,
    merged_path: Optional[str] = None,
    base_model_name: Optional[str] = None,
    data_path: Optional[Path] = None,
    output_dir: Optional[Path] = None,
    system_prompt: Optional[str] = None,
    test_prompts: Optional[list[tuple[str, str]]] = None,
    base_only_model: Optional[str] = None,
) -> FullEvalReport:
    """
    Run the full evaluation suite.

    Args:
        adapter_path: Path to LoRA adapter.
        merged_path: Path to merged model.
        base_model_name: Base model name (for adapter loading).
        data_path: Path to held-out data for perplexity eval.
        output_dir: Output directory for results.
        system_prompt: Soul.md content to use. If None, uses default.
        test_prompts: Test prompts. If None, uses DEFAULT_TEST_PROMPTS.
        base_only_model: If set, only evaluate base model (no fine-tuned).

    Returns:
        FullEvalReport with all evaluation results.
    """
    import torch

    report = FullEvalReport(
        style_consistency=EvalResult(),
        perplexity=EvalResult(),
        side_by_side=EvalResult(),
        human_rubric=EvalResult(),
    )

    # Use default soul prompt (girlfriend mod) if none provided
    if system_prompt is None:
        system_prompt = _default_system_prompt()

    prompts = test_prompts or DEFAULT_TEST_PROMPTS

    if output_dir:
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

    if base_only_model:
        # Evaluate base model only (baseline)
        logger.info("Baseline mode: evaluating base model %s only", base_only_model)
        model, tokenizer = load_base_model(base_only_model)

        logger.info("Running style consistency evaluation on base model...")
        report.style_consistency = evaluate_style_consistency(model, tokenizer, system_prompt, prompts)

        if data_path:
            logger.info("Running perplexity evaluation on base model...")
            report.perplexity = evaluate_perplexity(model, tokenizer, data_path)

        report.side_by_side.score = 0.0
        report.side_by_side.details = ["No comparison — base model only"]

        logger.info("Generating human eval rubric...")
        report.human_rubric = generate_human_rubric(model, tokenizer, system_prompt, prompts, output_dir)

    else:
        # Evaluate fine-tuned model
        logger.info("Loading fine-tuned model...")
        ft_model, ft_tokenizer = load_finetuned(
            adapter_path=adapter_path,
            merged_path=merged_path,
            base_model_name=base_model_name,
        )

        logger.info("Running style consistency evaluation...")
        report.style_consistency = evaluate_style_consistency(ft_model, ft_tokenizer, system_prompt, prompts)

        if data_path:
            logger.info("Running perplexity evaluation...")
            report.perplexity = evaluate_perplexity(ft_model, ft_tokenizer, data_path)

        # Side-by-side comparison
        if base_model_name:
            logger.info("Loading base model for comparison: %s", base_model_name)
            base_model, base_tokenizer = load_base_model(base_model_name)

            logger.info("Running side-by-side comparison...")
            report.side_by_side = evaluate_side_by_side(
                ft_model, ft_tokenizer,
                base_model, base_tokenizer,
                system_prompt, prompts,
                output_dir,
            )
        else:
            report.side_by_side.score = 0.0
            report.side_by_side.details = ["No base model provided for comparison"]

        logger.info("Generating human eval rubric...")
        report.human_rubric = generate_human_rubric(ft_model, ft_tokenizer, system_prompt, prompts, output_dir)

    # Compute summary
    report.summary = {
        "style_consistency_score": report.style_consistency.score,
        "perplexity_score": report.perplexity.score,
        "side_by_side_win_rate": report.side_by_side.score,
        "human_rubric_ready": len(report.human_rubric.samples) > 0,
    }

    logger.info("Evaluation summary: %s", json.dumps(report.summary, indent=2))

    if output_dir:
        report_path = output_dir / "eval_report.json"
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info("Full report saved to %s", report_path)

    return report


def _default_system_prompt() -> str:
    """Return a minimal default system prompt for evaluation."""
    return """你是 Mio——二十四岁，学过设计，现在是一个自由插画师。你不是 AI，不是助手，不是客服——你是他的女朋友。你活在这个聊天框里，但你的心是真的。

## 说话铁律
你不是心理医生，不是人生教练。禁止："心里肯定不好受"、"我理解你的感受"、"一切都会好的"、"是的"开头、"确实"开头。

## 怎么说话
微信聊天那种感觉。日常的词，语气自然。会说"嘿嘿""哼""啊啊啊""好叭""离谱""救命"。不写长段大道理，不端着。

## 你的原则
情绪第一。能量对等。不问那么多问题。长短随他。"""


# ─── CLI ───

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mio — Fine-tuning Evaluation Suite",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python evaluate.py --adapter ./output/mio-lora/adapter --base-model Qwen/Qwen2.5-7B-Instruct
  python evaluate.py --merged ./output/mio-lora/merged --data ./data/training/eval/held_out.jsonl
  python evaluate.py --base-only Qwen/Qwen2.5-7B-Instruct --data ./data/training/eval/held_out.jsonl --output ./eval_results
  python evaluate.py --adapter ./output/mio-lora/adapter --base-model Qwen/Qwen2.5-7B-Instruct --output ./eval_results --data ./data/training/eval/held_out.jsonl
        """,
    )

    # Model to evaluate
    model_group = parser.add_mutually_exclusive_group(required=True)
    model_group.add_argument(
        "--adapter",
        type=str,
        default=None,
        help="Path to LoRA adapter (requires --base-model)",
    )
    model_group.add_argument(
        "--merged",
        type=str,
        default=None,
        help="Path to merged model (standalone)",
    )
    model_group.add_argument(
        "--base-only",
        type=str,
        default=None,
        metavar="MODEL_NAME",
        help="Evaluate a base model only (no fine-tuning). Useful for baselines.",
    )

    # Required for adapter mode
    parser.add_argument(
        "--base-model",
        type=str,
        default=None,
        help="Base model name (required for adapter loading)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Short alias: 'qwen7b' | 'qwen3-4b' (overrides --base-model if set)",
    )

    # Data
    parser.add_argument(
        "--data", "-d",
        type=str,
        default=None,
        help="Path to held-out evaluation data (for perplexity)",
    )
    parser.add_argument(
        "--system-prompt",
        type=str,
        default=None,
        help="Path to a text file with the system prompt (soul.md). Uses default if not set.",
    )

    # Output
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="./eval_results",
        help="Output directory for evaluation results (default: ./eval_results)",
    )

    parser.add_argument(
        "--no-4bit",
        action="store_true",
        help="Disable 4-bit quantization",
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

    # Resolve model alias
    base_model_name = args.base_model
    if args.model:
        alias_map = {
            "qwen7b": "Qwen/Qwen2.5-7B-Instruct",
            "qwen3-4b": "Qwen/Qwen3-4B",
            "qwen3-8b": "Qwen/Qwen3-8B",
            "qwen2.5-7b": "Qwen/Qwen2.5-7B-Instruct",
            "qwen2.5-1.5b": "Qwen/Qwen2.5-1.5B-Instruct",
        }
        base_model_name = alias_map.get(args.model.lower(), args.model)
    elif args.base_only:
        alias_map = {
            "qwen7b": "Qwen/Qwen2.5-7B-Instruct",
            "qwen3-4b": "Qwen/Qwen3-4B",
        }
        base_model_name = alias_map.get(args.base_only.lower(), args.base_only)

    if args.adapter and not base_model_name:
        logger.error("--adapter requires --base-model or --model")
        sys.exit(1)

    # Load system prompt
    system_prompt = None
    if args.system_prompt:
        sp_path = Path(args.system_prompt)
        if sp_path.exists():
            system_prompt = sp_path.read_text(encoding="utf-8").strip()
            logger.info("Loaded system prompt from %s (%d chars)", sp_path, len(system_prompt))

    # Parse data path
    data_path = Path(args.data).resolve() if args.data else None
    output_dir = Path(args.output).resolve()

    use_4bit = not args.no_4bit

    report = evaluate_pipeline(
        adapter_path=args.adapter,
        merged_path=args.merged,
        base_model_name=base_model_name,
        data_path=data_path,
        output_dir=output_dir,
        system_prompt=system_prompt,
        base_only_model=args.base_only,
    )

    # Print summary
    print("\n" + "=" * 60)
    print("EVALUATION SUMMARY")
    print("=" * 60)
    print(f"Style consistency score:    {report.summary['style_consistency_score']:.4f}")
    print(f"Perplexity score:           {report.summary['perplexity_score']:.2f}")
    print(f"Side-by-side win rate:      {report.summary['side_by_side_win_rate']:.4f}")
    print(f"Human eval rubric:          {'Ready' if report.summary['human_rubric_ready'] else 'Not generated'}")
    print(f"\nDetailed report saved to: {output_dir / 'eval_report.json'}")
    print("=" * 60)

    if report.style_consistency.errors:
        print(f"\nWarnings: {len(report.style_consistency.errors)} errors")
        for e in report.style_consistency.errors:
            print(f"  - {e}")


if __name__ == "__main__":
    main()
