# Mio LoRA Fine-tuning Pipeline

Fine-tune a small language model (Qwen2.5-7B / Qwen3-4B) on Mio's conversational style. The goal is to capture Mio's speaking style and persona — not to inject facts, but to teach the model *how* to sound like Mio.

## Overview

```
scripts/finetune/
├── README.md                 ← This file
├── requirements.txt          ← Python dependencies
├── data_format.md            ← Training data format specification
├── collect_data.py           ← Convert session transcripts to training data
├── augment.py                ← Data augmentation (3-5x volume expansion)
├── train_lora.py             ← QLoRA fine-tuning
└── evaluate.py               ← Evaluation suite
```

## Setup

### Requirements

- Python 3.10+
- CUDA-capable GPU (see GPU Requirements section)
- 20GB+ disk space for model weights

### Install

```bash
cd scripts/finetune
pip install -r requirements.txt
```

For Debian/Ubuntu, ensure build dependencies for bitsandbytes:

```bash
sudo apt-get install build-essential cmake
```

## Pipeline Steps

### Step 1: Data Collection

Read Mio's session transcript JSONL files and convert them to training format (OpenAI chat JSONL).

```bash
python collect_data.py \
  --data-dir ./data \
  --soul-dir ./mods \
  --output ./data/training
```

Filters applied:
- Only meaningful exchanges: user > 10 chars AND assistant > 5 chars
- No tool calls in assistant turns (pure conversation only)
- Negative examples extracted separately (short user replies, dissatisfaction signals)

Output:
- `data/training/conversations.jsonl` — Positive training examples
- `data/training/conversations_negative.jsonl` — Negative examples
- `data/training/eval/held_out.jsonl` — Held-out evaluation set (10%)
- `data/training/processed/dataset_stats.json` — Dataset statistics

Options:
- `--mod boyfriend` — Force specific persona (auto-detected by default)
- `--no-split` — No train/eval split
- `--eval-split 0.15` — Custom eval split ratio
- `--verbose` — Debug logging

### Step 2: Data Augmentation (Optional, Recommended)

Expand the training dataset 3-5x using persona variation, paraphrasing, and contrastive pairs.

```bash
# Basic augmentation (rule-based only, no API key needed)
python augment.py \
  --data ./data/training/conversations.jsonl \
  --soul-dir ./mods

# With LLM-based paraphrasing (better quality)
python augment.py \
  --data ./data/training/conversations.jsonl \
  --soul-dir ./mods \
  --api-key $OPENAI_API_KEY

# Full augmentation, targeting specific mod
python augment.py \
  --data ./data/training/conversations.jsonl \
  --soul-dir ./mods \
  --api-key $OPENAI_API_KEY \
  --target-mod girlfriend \
  --max-paraphrases 3 \
  --output ./data/training/conversations_augmented.jsonl
```

Augmentation types:
1. **Persona variation** — Swap system prompt between boyfriend/girlfriend soul.md (no API needed)
2. **Rule-based paraphrasing** — Simple Chinese synonym/word-order swaps (no API needed)
3. **LLM paraphrasing** — Uses GPT-4o-mini (or compatible) to rephrase user messages (API key required)
4. **Contrastive pairs** — Generates "bad" responses violating style rules (API key recommended, rule-based fallback available)

### Step 3: Training

Run QLoRA fine-tuning on the collected data.

```bash
# Basic training
python train_lora.py \
  --data ./data/training/conversations_augmented.jsonl \
  --output ./output/mio-lora

# Training with specific settings
python train_lora.py \
  --data ./data/training/conversations_augmented.jsonl \
  --eval-data ./data/training/eval/held_out.jsonl \
  --output ./output/mio-lora \
  --base-model Qwen/Qwen2.5-7B-Instruct \
  --epochs 3 \
  --lr 2e-4 \
  --batch-size 4 \
  --grad-accum 4

# Training + DPO (uses negative examples)
python train_lora.py \
  --data ./data/training/conversations.jsonl \
  --negative-data ./data/training/conversations_negative.jsonl \
  --output ./output/mio-lora \
  --dpo

# Lightweight training (for testing)
python train_lora.py \
  --model qwen3-4b \
  --data ./data/training/conversations.jsonl \
  --output ./output/test-mio \
  --epochs 1 \
  --batch-size 2

# Full training with merged model output
python train_lora.py \
  --data ./data/training/conversations_augmented.jsonl \
  --output ./output/mio-lora \
  --base-model Qwen/Qwen2.5-7B-Instruct \
  --epochs 3 \
  --merge
```

Key hyperparameters (defaults):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `lora_r` | 16 | LoRA rank |
| `lora_alpha` | 32 | LoRA scaling alpha |
| Target modules | q_proj, v_proj, k_proj, o_proj | Attention projection matrices |
| Learning rate | 2e-4 | Peak learning rate (cosine schedule) |
| Epochs | 3 | Full passes over training data |
| Batch size | 4 | Per-device batch size |
| Gradient accumulation | 4 | Effective batch size = 4 * 4 = 16 |
| Max sequence length | 2048 | Tokens per example |
| Quantization | 4-bit NF4 | bitsandbytes QLoRA |

Output:
- `output/mio-lora/adapter/` — LoRA adapter weights (~40MB)
- `output/mio-lora/merged/` — Full merged model (only with `--merge`)
- `output/mio-lora/dpo/` — DPO adapter (only with `--dpo`)

### Step 4: Evaluation

Evaluate the fine-tuned model on style consistency, perplexity, and side-by-side comparison.

```bash
# Full evaluation of fine-tuned model
python evaluate.py \
  --adapter ./output/mio-lora/adapter \
  --base-model Qwen/Qwen2.5-7B-Instruct \
  --data ./data/training/eval/held_out.jsonl \
  --output ./eval_results

# Evaluate merged model
python evaluate.py \
  --merged ./output/mio-lora/merged \
  --data ./data/training/eval/held_out.jsonl \
  --output ./eval_results

# Baseline comparison (base model without fine-tuning)
python evaluate.py \
  --base-only Qwen/Qwen2.5-7B-Instruct \
  --data ./data/training/eval/held_out.jsonl \
  --output ./eval_results/baseline
```

Output:
- `eval_results/eval_report.json` — Complete evaluation report
- `eval_results/human_eval_rubric.json` — Human evaluation scoring form
- `eval_results/human_eval_rubric.md` — Human evaluation rubric (readable)
- `eval_results/side_by_side.json` — Side-by-side comparison data

## GPU Requirements

| Model | GPU | Memory | Batch Size | Training Time (3 epochs, 10k examples) |
|-------|-----|--------|------------|----------------------------------------|
| Qwen3-4B | 1x RTX 4090 24GB | ~16GB | 4 | ~2-3 hours |
| Qwen2.5-7B | 1x RTX 4090 24GB | ~20GB | 2 | ~4-6 hours |
| Qwen2.5-7B | 1x A100 40GB | ~24GB | 4 | ~1-2 hours |
| Qwen2.5-7B | 2x RTX 4090 24GB | ~12GB each | 4 each | ~2-3 hours |

Notes:
- All estimates assume 4-bit quantization (QLoRA)
- Gradient checkpointing enabled (reduces memory by ~30%)
- `gradient_accumulation_steps=4` means the effective batch size is 4x the per-device batch
- If you run out of memory: reduce `--batch-size`, increase `--grad-accum`, or set `--max-seq-length 1024`

## Deployment

### Loading the LoRA Adapter in Inference

Once trained, the LoRA adapter can be loaded for inference:

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

# Load base model
base_model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen2.5-7B-Instruct",
    device_map="auto",
    torch_dtype="bfloat16",
)
tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-7B-Instruct")

# Load LoRA adapter
model = PeftModel.from_pretrained(base_model, "./output/mio-lora/adapter")

# Generate
messages = [
    {"role": "system", "content": "你是 Mio..."},
    {"role": "user", "content": "刚下班好累"},
]
prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
outputs = model.generate(**inputs, max_new_tokens=256)
response = tokenizer.decode(outputs[0], skip_special_tokens=True)
print(response)
```

### Integrating with Mio's TypeScript Provider

See `src/providers/lora-adapter.ts` for the TypeScript integration stub. When Mio adds local model support, the flow will be:

1. Load the LoRA adapter in a Python inference server (FastAPI)
2. Mio's provider sends chat requests to the inference server via HTTP
3. The inference server returns completions using the fine-tuned model

Currently, Mio only supports API-based providers (Anthropic, OpenAI-compatible). The LoRA adapter requires a local inference server. See `src/providers/lora-adapter.ts` for the integration point and implementation guidance.

## Training Data Format

See `data_format.md` for the complete specification. Quick reference:

```jsonl
{"messages": [
  {"role": "system", "content": "你是 Mio——二十四岁，学过设计..."},
  {"role": "user", "content": "刚下班好累"},
  {"role": "assistant", "content": "辛苦了…到家了没"}
]}
```

- System message = full soul.md content
- User message = user's actual text
- Assistant message = Mio's response (no tool calls)
- Meta field tracks provenance (session_id, mod, augmentation status)

## Notes

- The pipeline focuses on **style transfer, not knowledge injection**. The goal is to make the model sound like Mio, not to teach it facts.
- Training data size matters: aim for at least 500-1000 quality conversation pairs before augmentation.
- The `augment.py` persona variation is critical: without it, the model overfits to one mod's soul.md and can't generalize.
- DPO training (with negative examples) helps reduce forbidden patterns but requires good-quality negative examples.
- The evaluation suite's style consistency check is conservative — it flags anything matching forbidden patterns in soul.md. Some "violations" may be acceptable in context.
