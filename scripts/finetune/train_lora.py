#!/usr/bin/env python3
"""
Mio — QLoRA Fine-tuning Script

Fine-tunes a small language model (Qwen2.5-7B-Instruct or Qwen3-4B) on
Mio's conversational style using QLoRA. The goal is to capture speaking
style and persona, not to inject knowledge.

Framework: transformers + peft + bitsandbytes
Strategy: QLoRA (4-bit quantization + LoRA adapters)

Usage:
    python train_lora.py --data ./data/training/conversations.jsonl
    python train_lora.py --data ./data/training/conversations.jsonl --output ./output/mio-lora
    python train_lora.py --data ./data/training/conversations.jsonl --base-model Qwen/Qwen2.5-7B-Instruct --epochs 5 --lr 1e-4
    python train_lora.py --data ./data/training/conversations.jsonl --negative-data ./data/training/conversations_negative.jsonl --dpo
"""

import argparse
import json
import logging
import math
import os
import sys
import gc
from pathlib import Path
from typing import Any, Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# ─── Configuration ───

DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"

TRAINING_CONFIG = {
    # LoRA configuration
    "lora_r": 16,
    "lora_alpha": 32,
    "lora_dropout": 0.1,
    "lora_target_modules": ["q_proj", "v_proj", "k_proj", "o_proj"],
    # Quantization
    "bnb_4bit_compute_dtype": "bfloat16",
    "bnb_4bit_quant_type": "nf4",
    "bnb_4bit_use_double_quant": True,
    # Training
    "learning_rate": 2e-4,
    "num_epochs": 3,
    "per_device_train_batch_size": 4,
    "gradient_accumulation_steps": 4,
    "warmup_steps": 100,
    "logging_steps": 10,
    "save_steps": 100,
    "eval_steps": 100,
    "max_seq_length": 2048,
    "packing": False,
}


# ─── Model Loading ───

def load_model_and_tokenizer(
    model_name: str,
    use_4bit: bool = True,
    device_map: str = "auto",
    max_seq_length: int = 2048,
):
    """
    Load the base model with 4-bit quantization and its tokenizer.

    Args:
        model_name: HuggingFace model ID or local path.
        use_4bit: Whether to use bitsandbytes 4-bit quantization.
        device_map: Device map strategy ("auto" for multi-GPU).
        max_seq_length: Maximum sequence length for the tokenizer.

    Returns:
        (model, tokenizer)
    """
    import torch
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
    )

    logger.info("Loading model: %s", model_name)

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
        device_map=device_map,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True,
        padding_side="right",
    )

    # Set pad token if not set
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Resize model embeddings if needed (for new tokens)
    model.config.pad_token_id = tokenizer.pad_token_id

    # Disable cache for gradient checkpointing compatibility
    model.config.use_cache = False

    logger.info(
        "Model loaded: %s parameters (%s trainable)",
        model_name,
        model.num_parameters(only_trainable=False),
    )

    return model, tokenizer


def apply_lora(model, config: dict) -> Any:
    """
    Apply LoRA adapters to the model.

    Args:
        model: The base model.
        config: Training config dict with lora_* keys.

    Returns:
        Model with LoRA adapters applied (peft model).
    """
    from peft import LoraConfig, get_peft_model, TaskType

    lora_config = LoraConfig(
        r=config.get("lora_r", 16),
        lora_alpha=config.get("lora_alpha", 32),
        target_modules=config.get("lora_target_modules", ["q_proj", "v_proj"]),
        lora_dropout=config.get("lora_dropout", 0.1),
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )

    model = get_peft_model(model, lora_config)

    # Print trainable parameters
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    all_params = sum(p.numel() for p in model.parameters())
    logger.info(
        "LoRA applied: %s trainable params / %s total (%.2f%%)",
        trainable_params, all_params,
        100 * trainable_params / all_params,
    )

    return model


# ─── Data Loading ───

def load_conversations(path: Path) -> list[dict]:
    """Load JSONL conversations into a list."""
    if not path.exists():
        logger.error("Data file not found: %s", path)
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        examples = [json.loads(line) for line in f if line.strip()]

    logger.info("Loaded %d examples from %s", len(examples), path)
    return examples


def format_conversation(messages: list[dict], tokenizer) -> str:
    """
    Format a conversation into the chat template expected by the model.

    For Qwen models, this uses their built-in chat template:
    <|im_start|>system
    {system_prompt}<|im_end|>
    <|im_start|>user
    {user_msg}<|im_end|>
    <|im_start|>assistant
    {assistant_reply}<|im_end|>

    For other models, falls back to the tokenizer's chat_template.
    """
    if hasattr(tokenizer, "apply_chat_template"):
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
    # Manual fallback for Qwen format
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
    parts.append("<|im_start|>assistant")
    return "\n".join(parts)


def tokenize_conversations(
    examples: list[dict],
    tokenizer,
    max_length: int = 2048,
    split: Optional[str] = None,
) -> tuple:
    """
    Tokenize conversations for training.

    Each conversation is formatted with the chat template, then tokenized.
    Labels are set to the input_ids for language modeling (predicting the
    next token on the entire sequence, but loss is computed on all positions).

    Returns:
        A dict with "input_ids", "attention_mask", "labels" tensors.
    """
    from datasets import Dataset

    texts: list[str] = []
    for ex in examples:
        text = format_conversation(ex["messages"], tokenizer)
        texts.append(text)

    def tokenize_function(examples_batch):
        return tokenizer(
            examples_batch["text"],
            truncation=True,
            padding="max_length",
            max_length=max_length,
            return_tensors=None,
        )

    dataset = Dataset.from_dict({"text": texts})
    tokenized = dataset.map(
        tokenize_function,
        batched=True,
        remove_columns=["text"],
        desc=f"Tokenizing {split or 'data'}",
    )

    # Set labels = input_ids for causal LM
    tokenized = tokenized.map(
        lambda x: {"labels": x["input_ids"]},
        desc="Setting labels",
    )

    return tokenized


# ─── Training ───

def train(
    model,
    tokenizer,
    train_dataset,
    eval_dataset: Optional[Any] = None,
    config: Optional[dict] = None,
    output_dir: str = "./output/mio-lora",
    resume_from_checkpoint: Optional[str] = None,
) -> Any:
    """
    Run the SFT training loop using transformers.Trainer.

    Args:
        model: The PEFT model (base + LoRA).
        tokenizer: The tokenizer.
        train_dataset: Tokenized training dataset.
        eval_dataset: Optional tokenized evaluation dataset.
        config: Training configuration dict.
        output_dir: Output directory for checkpoints and final model.
        resume_from_checkpoint: Path to checkpoint to resume from.

    Returns:
        The trained model (with LoRA weights merged).
    """
    from transformers import TrainingArguments, Trainer, DataCollatorForSeq2Seq, EarlyStoppingCallback

    cfg = config or TRAINING_CONFIG

    training_args = TrainingArguments(
        output_dir=output_dir,
        overwrite_output_dir=True,
        num_train_epochs=cfg.get("num_epochs", 3),
        per_device_train_batch_size=cfg.get("per_device_train_batch_size", 4),
        gradient_accumulation_steps=cfg.get("gradient_accumulation_steps", 4),
        warmup_steps=cfg.get("warmup_steps", 100),
        logging_steps=cfg.get("logging_steps", 10),
        save_steps=cfg.get("save_steps", 100),
        eval_steps=cfg.get("eval_steps", 100) if eval_dataset else None,
        evaluation_strategy="steps" if eval_dataset else "no",
        learning_rate=cfg.get("learning_rate", 2e-4),
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        report_to="none",
        logging_dir=f"{output_dir}/logs",
        save_total_limit=3,
        load_best_model_at_end=eval_dataset is not None,
        metric_for_best_model="eval_loss" if eval_dataset else None,
        greater_is_better=False,
        dataloader_num_workers=2,
        group_by_length=True,
        ddp_find_unused_parameters=False,
        remove_unused_columns=False,
        lr_scheduler_type="cosine",
        optim="adamw_8bit",  # 8-bit AdamW for memory efficiency
    )

    data_collator = DataCollatorForSeq2Seq(
        tokenizer=tokenizer,
        model=model,
        padding=True,
        label_pad_token_id=tokenizer.pad_token_id,
    )

    callbacks = []
    if eval_dataset is not None:
        callbacks.append(EarlyStoppingCallback(early_stopping_patience=3))

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=data_collator,
        tokenizer=tokenizer,
        callbacks=callbacks if callbacks else None,
    )

    # Disable caching during training
    model.config.use_cache = False

    logger.info("Starting training...")
    trainer.train(resume_from_checkpoint=resume_from_checkpoint)
    logger.info("Training complete.")

    # Save the final model (LoRA adapter only)
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    logger.info("Model saved to %s", output_dir)

    return model


# ─── DPO Training (Optional) ───

def train_dpo(
    model,
    tokenizer,
    train_dataset,
    eval_dataset: Optional[Any] = None,
    config: Optional[dict] = None,
    output_dir: str = "./output/mio-lora-dpo",
) -> Any:
    """
    Optional DPO (Direct Preference Optimization) training using negative examples.

    Uses the TRL library's DPOTrainer.

    Args:
        model: The PEFT model after SFT.
        tokenizer: The tokenizer.
        train_dataset: Dataset with "chosen" and "rejected" columns.
        eval_dataset: Optional evaluation dataset.
        config: Training configuration.
        output_dir: Output directory.

    Returns:
        The DPO-trained model.
    """
    from trl import DPOTrainer, DPOConfig

    cfg = config or TRAINING_CONFIG

    training_args = DPOConfig(
        output_dir=output_dir,
        per_device_train_batch_size=cfg.get("per_device_train_batch_size", 2),
        gradient_accumulation_steps=cfg.get("gradient_accumulation_steps", 4),
        num_train_epochs=cfg.get("num_epochs", 2),
        learning_rate=1e-5,  # Lower LR for DPO
        bf16=True,
        logging_steps=10,
        save_steps=100,
        gradient_checkpointing=True,
        report_to="none",
        remove_unused_columns=False,
    )

    dpo_trainer = DPOTrainer(
        model=model,
        ref_model=None,  # Will be created automatically
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        tokenizer=tokenizer,
        max_length=cfg.get("max_seq_length", 2048),
        max_prompt_length=cfg.get("max_seq_length", 2048) // 2,
    )

    logger.info("Starting DPO training...")
    dpo_trainer.train()
    logger.info("DPO training complete.")

    dpo_trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    logger.info("DPO model saved to %s", output_dir)

    return model


def prepare_dpo_dataset(
    positive_examples: list[dict],
    negative_examples: list[dict],
    tokenizer,
    max_length: int = 2048,
) -> Any:
    """
    Prepare a DPO dataset from positive and negative examples.
    Matches positive and negative by session_id and user message content.
    """
    from datasets import Dataset

    dpo_data: list[dict] = []

    # Index negatives by session_id + truncated user msg
    neg_index: dict[str, list[dict]] = {}
    for neg in negative_examples:
        meta = neg.get("meta", {})
        sid = meta.get("session_id", "unknown")
        uid = meta.get("timestamp", "unknown")
        key = f"{sid}:{uid}"
        if key not in neg_index:
            neg_index[key] = []
        neg_index[key].append(neg)

    for pos in positive_examples:
        meta = pos.get("meta", {})
        sid = meta.get("session_id", "unknown")
        uid = meta.get("timestamp", "unknown")
        key = f"{sid}:{uid}"

        if key in neg_index:
            for neg in neg_index[key]:
                chosen_messages = pos["messages"]
                rejected_messages = neg["messages"]

                # Format using chat template
                chosen_str = format_conversation(chosen_messages, tokenizer)
                rejected_str = format_conversation(rejected_messages, tokenizer)

                dpo_data.append({
                    "chosen": chosen_str,
                    "rejected": rejected_str,
                })

    dataset = Dataset.from_list(dpo_data)
    logger.info("Prepared DPO dataset with %d pairs", len(dpo_data))
    return dataset


# ─── Model Merging and Saving ───

def merge_and_save(
    peft_model,
    tokenizer,
    output_dir: str,
    output_merged_dir: Optional[str] = None,
) -> None:
    """
    Save both the LoRA adapter weights and optionally the merged model.

    The LoRA adapter is saved to `output_dir`.
    The merged model (base + LoRA merged into full weights) is saved to
    `output_merged_dir` if specified, or skipped.

    Save both because:
    - LoRA adapter: small (~40MB), easy to distribute
    - Merged model: large (full 7B), but faster inference
    """
    logger.info("Saving LoRA adapter to %s", output_dir)

    # The PEFT model already saves correctly via trainer.save_model()
    # For manual save:
    peft_model.save_pretrained(output_dir)

    if output_merged_dir:
        logger.info("Merging LoRA weights and saving full model to %s", output_merged_dir)
        merged_model = peft_model.merge_and_unload()
        merged_model.save_pretrained(output_merged_dir)
        tokenizer.save_pretrained(output_merged_dir)
        logger.info("Merged model saved to %s", output_merged_dir)


# ─── Main Pipeline ───

def train_pipeline(
    data_path: Path,
    output_dir: str,
    model_name: str = DEFAULT_MODEL,
    negative_data_path: Optional[Path] = None,
    eval_data_path: Optional[Path] = None,
    use_dpo: bool = False,
    use_4bit: bool = True,
    merge_model: bool = False,
    resume_from: Optional[str] = None,
    config_override: Optional[dict] = None,
) -> dict[str, Any]:
    """
    Run the full training pipeline.

    1. Load model and tokenizer
    2. Apply LoRA adapters
    3. Load and tokenize data
    4. Train (SFT)
    5. Optionally train DPO
    6. Save model

    Returns:
        Dict with training results and paths.
    """
    import torch

    cfg = {**TRAINING_CONFIG}
    if config_override:
        cfg.update(config_override)

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    merged_dir = str(output_path / "merged") if merge_model else None
    adapter_dir = str(output_path / "adapter")

    # 1. Load model
    model, tokenizer = load_model_and_tokenizer(
        model_name=model_name,
        use_4bit=use_4bit,
        max_seq_length=cfg.get("max_seq_length", 2048),
    )

    # 2. Apply LoRA
    model = apply_lora(model, cfg)

    # Enable gradient checkpointing
    model.config.use_cache = False
    if hasattr(model, "enable_input_require_grads"):
        model.enable_input_require_grads()

    # 3. Load and tokenize data
    examples = load_conversations(data_path)
    train_examples = examples

    eval_dataset = None
    if eval_data_path and eval_data_path.exists():
        eval_examples = load_conversations(eval_data_path)
        eval_dataset = tokenize_conversations(
            eval_examples, tokenizer,
            max_length=cfg.get("max_seq_length", 2048),
            split="eval",
        )
        logger.info("Using %d evaluation examples from %s", len(eval_examples), eval_data_path)

    # Split train if no eval data provided
    if eval_dataset is None and len(examples) > 50:
        split_idx = max(1, int(len(examples) * 0.05))
        train_examples = examples[split_idx:]
        eval_examples_list = examples[:split_idx]
        eval_dataset = tokenize_conversations(
            eval_examples_list, tokenizer,
            max_length=cfg.get("max_seq_length", 2048),
            split="eval",
        )
        logger.info("Auto-split: %d train, %d eval", len(train_examples), len(eval_examples_list))

    train_dataset = tokenize_conversations(
        train_examples, tokenizer,
        max_length=cfg.get("max_seq_length", 2048),
        split="train",
    )

    # 4. Train (SFT)
    model = train(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        config=cfg,
        output_dir=adapter_dir,
        resume_from_checkpoint=resume_from,
    )

    # 5. DPO (optional)
    dpo_dir: Optional[str] = None
    if use_dpo and negative_data_path and negative_data_path.exists():
        logger.info("Preparing DPO training...")
        pos_examples = examples
        neg_examples = load_conversations(negative_data_path)
        dpo_dataset = prepare_dpo_dataset(pos_examples, neg_examples, tokenizer)

        dpo_dir = str(output_path / "dpo")
        model = train_dpo(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dpo_dataset,
            eval_dataset=None,
            config=cfg,
            output_dir=dpo_dir,
        )

    # 6. Save
    merge_and_save(
        peft_model=model,
        tokenizer=tokenizer,
        output_dir=adapter_dir,
        output_merged_dir=merged_dir,
    )

    # Cleanup
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    gc.collect()

    result = {
        "status": "success",
        "base_model": model_name,
        "adapter_path": adapter_dir,
        "merged_path": merged_dir or "not_saved",
        "dpo_path": dpo_dir or "not_trained",
        "output_dir": output_dir,
        "config": cfg,
    }

    logger.info("Training pipeline complete. Results: %s", json.dumps(result, indent=2))
    return result


# ─── CLI ───

def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mio — QLoRA Fine-tuning for Speaking Style",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python train_lora.py --data ./data/training/conversations.jsonl
  python train_lora.py --data ./data/training/conversations.jsonl --output ./output/mio-lora
  python train_lora.py --data ./data/training/conversations.jsonl --base-model Qwen/Qwen2.5-7B-Instruct --epochs 5
  python train_lora.py --data ./data/training/conversations.jsonl --eval-data ./data/training/eval/held_out.jsonl
  python train_lora.py --data ./data/training/conversations.jsonl --negative-data ./data/training/conversations_negative.jsonl --dpo
  python train_lora.py --data ./data/training/conversations.jsonl --lr 1e-4 --batch-size 8 --grad-accum 2
  python train_lora.py --data ./data/training/conversations.jsonl --merge --no-4bit
  python train_lora.py --data ./data/training/conversations.jsonl --model Qwen/Qwen3-4B
        """,
    )

    parser.add_argument(
        "--data", "-d",
        type=str,
        required=True,
        help="Path to training data (conversations.jsonl)",
    )
    parser.add_argument(
        "--negative-data", "-n",
        type=str,
        default=None,
        help="Path to negative examples for DPO training",
    )
    parser.add_argument(
        "--eval-data", "-e",
        type=str,
        default=None,
        help="Path to held-out evaluation data",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="./output/mio-lora",
        help="Output directory (default: ./output/mio-lora)",
    )
    parser.add_argument(
        "--base-model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Base model ID (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Short alias: 'qwen7b' | 'qwen3-4b' (overrides --base-model if set)",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=None,
        help="Number of training epochs (default: 3)",
    )
    parser.add_argument(
        "--lr",
        type=float,
        default=None,
        help="Learning rate (default: 2e-4)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Per-device batch size (default: 4)",
    )
    parser.add_argument(
        "--grad-accum",
        type=int,
        default=None,
        help="Gradient accumulation steps (default: 4)",
    )
    parser.add_argument(
        "--lora-r",
        type=int,
        default=None,
        help="LoRA rank (default: 16)",
    )
    parser.add_argument(
        "--lora-alpha",
        type=int,
        default=None,
        help="LoRA alpha (default: 32)",
    )
    parser.add_argument(
        "--max-seq-length",
        type=int,
        default=None,
        help="Maximum sequence length (default: 2048)",
    )
    parser.add_argument(
        "--dpo",
        action="store_true",
        help="Enable DPO training after SFT",
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="Save merged model (base + LoRA) in addition to adapter",
    )
    parser.add_argument(
        "--no-4bit",
        action="store_true",
        help="Disable 4-bit quantization (use full precision)",
    )
    parser.add_argument(
        "--resume",
        type=str,
        default=None,
        help="Resume from checkpoint path",
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
    model_name = args.base_model
    if args.model:
        alias_map = {
            "qwen7b": "Qwen/Qwen2.5-7B-Instruct",
            "qwen3-4b": "Qwen/Qwen3-4B",
            "qwen3-8b": "Qwen/Qwen3-8B",
            "qwen2.5-7b": "Qwen/Qwen2.5-7B-Instruct",
            "qwen2.5-1.5b": "Qwen/Qwen2.5-1.5B-Instruct",
        }
        model_name = alias_map.get(args.model.lower(), args.model)

    data_path = Path(args.data).resolve()
    negative_data_path = Path(args.negative_data).resolve() if args.negative_data else None
    eval_data_path = Path(args.eval_data).resolve() if args.eval_data else None

    # Build config overrides
    config_override = {}
    if args.epochs is not None:
        config_override["num_epochs"] = args.epochs
    if args.lr is not None:
        config_override["learning_rate"] = args.lr
    if args.batch_size is not None:
        config_override["per_device_train_batch_size"] = args.batch_size
    if args.grad_accum is not None:
        config_override["gradient_accumulation_steps"] = args.grad_accum
    if args.lora_r is not None:
        config_override["lora_r"] = args.lora_r
    if args.lora_alpha is not None:
        config_override["lora_alpha"] = args.lora_alpha
    if args.max_seq_length is not None:
        config_override["max_seq_length"] = args.max_seq_length

    logger.info("Model: %s", model_name)
    logger.info("Data: %s", data_path)
    logger.info("Output: %s", args.output)
    logger.info("Negative data: %s", negative_data_path)
    logger.info("Eval data: %s", eval_data_path)
    logger.info("DPO enabled: %s", args.dpo)
    logger.info("4-bit: %s", not args.no_4bit)
    logger.info("Merge: %s", args.merge)

    result = train_pipeline(
        data_path=data_path,
        output_dir=args.output,
        model_name=model_name,
        negative_data_path=negative_data_path,
        eval_data_path=eval_data_path,
        use_dpo=args.dpo,
        use_4bit=not args.no_4bit,
        merge_model=args.merge,
        resume_from=args.resume,
        config_override=config_override if config_override else None,
    )

    print(f"\nTraining complete!")
    print(f"  Base model: {result['base_model']}")
    print(f"  Adapter:    {result['adapter_path']}")
    print(f"  Merged:     {result['merged_path']}")
    print(f"  DPO:        {result['dpo_path']}")


if __name__ == "__main__":
    main()
