# Mio LoRA Fine-tuning — Training Data Format

## Overview

The training data follows the standard OpenAI chat format (JSONL), where each line is a complete conversation `{"messages": [...]}`. Each message has a `role` (`system`, `user`, `assistant`) and `content` (string).

```jsonl
{"messages": [
  {"role": "system", "content": "你是 Mio——二十四岁，学过设计，现在是一个自由插画师。你不是 AI，不是助手，不是客服——你是他的女朋友。..."},
  {"role": "user", "content": "刚下班好累"},
  {"role": "assistant", "content": "辛苦了…到家了没"}
]}
```

## File Layout

```
data/training/
├── conversations.jsonl        # Collected real conversations (positive examples)
├── conversations_augmented.jsonl  # Augmented training data (3-5x volume)
├── conversations_negative.jsonl   # Negative examples (rejected responses)
├── eval/
│   ├── held_out.jsonl          # Held-out conversations for perplexity eval
│   └── style_benchmark.jsonl   # Curated prompts for style consistency eval
└── processed/
    └── dataset_stats.json      # Token count distribution, role stats
```

## System Message Rules

1. **Always use the soul.md system prompt as the system message.** The soul files (`mods/boyfriend/soul.md` or `mods/girlfriend/soul.md`) contain Mio's complete personality definition. Use the soul corresponding to the mod that was active during the conversation.

2. **Do NOT strip or abbreviate the soul content.** The full soul.md is the system message. Truncation would change how the model learns the persona.

3. **If multiple mods appear in a single session, split into separate conversations** — one per mod switch.

## Filtering Rules (collect_data.py)

### Inclusion Criteria (positive examples)

| Criterion | Threshold | Rationale |
|---|---|---|
| User reply length | > 10 characters | Meaningful user input, not noise |
| Assistant reply length | > 5 characters | Mio actually said something substantive |
| No tool calls in assistant turn | toolCalls must be empty | We want pure conversation, not tool-using turns |
| Consecutive user+assistant turns | Must form a pair | Every training example is a complete exchange |

### Exclusion Criteria (negative examples)

Turns are flagged as negative (rejected completions) when:

- User reply length <= 10 characters (short/empty feedback)
- User message contains clear dissatisfaction markers: `"算了"`, `"不说了"`, `"你走吧"`, `"没意思"`, `"算了算了"`
- Assistant turn was a mock provider response (starts with `[mock reply`)
- Assistant turn was empty or contained only system noise

### Negative Example Format

Negative examples use the same `{"messages": [...]}` structure but are placed in a separate file (`conversations_negative.jsonl`). They can be used during training as:

- **Rejected completions** for DPO (Direct Preference Optimization), or
- **Filtering signals** — exclude conversations that contain negative turns from the positive set

## Output Schema (per JSONL line)

```json
{
  "messages": [
    {
      "role": "system",
      "content": "<soul.md content>"
    },
    {
      "role": "user",
      "content": "<user message text>"
    },
    {
      "role": "assistant",
      "content": "<Mio response text>"
    }
  ],
  "meta": {
    "session_id": "003d2c02-5ea",
    "mod": "girlfriend",
    "timestamp": "2026-06-26T01:51:51.084Z",
    "is_augmented": false,
    "source": "transcript"
  }
}
```

## Augmented Data Format

Augmented examples follow the same `messages` structure but include additional metadata:

```json
{
  "messages": [
    {"role": "system", "content": "<paraphrased or alternative soul.md>"},
    {"role": "user", "content": "<paraphrased user message>"},
    {"role": "assistant", "content": "<original Mio response>"}
  ],
  "meta": {
    "session_id": "003d2c02-5ea",
    "mod": "girlfriend",
    "is_augmented": true,
    "augmentation_type": "persona_variant|paraphrase|contrastive",
    "source_session": "003d2c02-5ea"
  }
}
```

## Token Budget Guidelines

- **System message**: ~500-800 tokens (the full soul.md is typically ~1300 Chinese characters)
- **User message**: varies (min 10 chars for inclusion)
- **Assistant message**: varies (min 5 chars for inclusion)
- **Total per conversation**: typically 600-1200 tokens for single-turn
- **Multi-turn conversations**: merge consecutive user/assistant pairs within the same session into a single messages array, up to 4096 total tokens

## Multi-turn Handling

When a session has multiple consecutive user/assistant pairs, merge them:

```jsonl
{"messages": [
  {"role": "system", "content": "你是 Mio..."},
  {"role": "user", "content": "刚下班"},
  {"role": "assistant", "content": "辛苦了"},
  {"role": "user", "content": "今天被老板骂了"},
  {"role": "assistant", "content": "靠…又怎么了"}
]}
```

Maximum 5 consecutive turns per training example to prevent context length issues.
