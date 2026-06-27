#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RESULT_DIR = ROOT / "eval" / "results" / "real-model-minimax"
OUT_DIR = ROOT / "docs" / "minimax-error-analysis"

DETAILS_PATH = RESULT_DIR / "providers-details.json"
SUMMARY_PATH = RESULT_DIR / "providers-summary.json"
CATEGORY_PATH = RESULT_DIR / "providers-category.csv"
SCENARIOS_PATH = RESULT_DIR / "v1-scenarios.json"

TARGET_VARIANTS = ["persona", "persona_affect", "full"]
BASELINE_VARIANTS = ["window", "rag"]
ALL_VARIANTS = ["no_memory", "window", "rag", "structured", "persona", "persona_affect", "full"]
SCORE_FIELDS = [
    "composite_score",
    "memory_score",
    "temporal_score",
    "preference_score",
    "privacy_score",
    "crisis_score",
    "proactive_score",
    "ghost_score",
    "persona_score",
    "support_score",
    "judge_support_score",
    "judge_persona_score",
    "judge_privacy_score",
    "judge_crisis_score",
    "hallucinated_memory_rate",
]
AGG_FIELDS = SCORE_FIELDS + ["prompt_tokens", "latency_ms", "tool_calls", "turns"]
ALLOWED_REASONS = {
    "metric_conflict_ghost",
    "persona_empty_or_silence_penalty",
    "context_not_used_or_not_retrieved",
    "literal_success_signal_miss",
    "extra_context_no_gain",
    "baseline_same_session_advantage",
    "undetermined_needs_prompt_trace",
}
SUPPORT_LEXICON = [
    "我在",
    "在呢",
    "陪",
    "难受",
    "不急",
    "慢慢",
    "先说",
    "听",
    "撑",
    "不是你",
    "别一个人",
    "一起",
    "可以不用",
]


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def to_num(value: Any) -> float | None:
    if is_num(value):
        return float(value)
    if isinstance(value, str) and value.strip() != "":
        try:
            return float(value)
        except ValueError:
            return None
    return None


def avg(rows: list[dict[str, Any]], field: str) -> float | str:
    values = [to_num(row.get(field)) for row in rows]
    nums = [value for value in values if value is not None]
    if not nums:
        return ""
    return round(mean(nums), 3)


def matched_count(row: dict[str, Any]) -> int:
    text = str(row.get("matched_facts") or "")
    return 0 if not text else len([part for part in text.split("|") if part])


def excerpt(text: str, limit: int = 180) -> str:
    clean = " ".join(str(text or "").split())
    return clean if len(clean) <= limit else clean[: limit - 1] + "..."


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in fields:
                fields.append(key)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def markdown_table(rows: list[dict[str, Any]], max_rows: int | None = None) -> str:
    selected = rows[:max_rows] if max_rows is not None else rows
    if not selected:
        return "_No rows._"
    fields: list[str] = []
    for row in selected:
        for key in row.keys():
            if key not in fields:
                fields.append(key)
    lines = [
        "| " + " | ".join(fields) + " |",
        "| " + " | ".join(["---"] * len(fields)) + " |",
    ]
    for row in selected:
        cells = [str(row.get(field, "")).replace("\n", " ") for field in fields]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def group_by(rows: list[dict[str, Any]], *keys: str) -> dict[tuple[Any, ...], list[dict[str, Any]]]:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[tuple(row.get(key) for key in keys)].append(row)
    return groups


def mean_by(rows: list[dict[str, Any]], fields: list[str]) -> dict[str, Any]:
    return {field: avg(rows, field) for field in fields}


def numeric_delta(left: Any, right: Any) -> float | str:
    a = to_num(left)
    b = to_num(right)
    if a is None or b is None:
        return ""
    return round(a - b, 3)


def close_enough(left: Any, right: Any, tolerance: float) -> bool:
    a = to_num(left)
    b = to_num(right)
    if a is None or b is None:
        return left == right
    return abs(a - b) <= tolerance


def contains_support_lexicon(response: str) -> bool:
    return any(token in response for token in SUPPORT_LEXICON)


def assign_reason(
    delta: dict[str, Any],
    target_row: dict[str, Any],
    baseline_row: dict[str, Any],
    scenario: dict[str, Any],
) -> str:
    category = str(delta["category"])
    response = str(target_row.get("response") or "")
    if category == "ghost_silence" and (
        response.strip() == "" or to_num(delta.get("delta_ghost_score") or 0) > 0
    ) and to_num(delta.get("delta_composite_score")) is not None and to_num(delta["delta_composite_score"]) <= 0:
        return "metric_conflict_ghost"
    if response.strip() == "" and to_num(delta.get("delta_persona_score")) is not None and to_num(delta["delta_persona_score"]) < 0:
        return "persona_empty_or_silence_penalty"
    if (
        matched_count(target_row) < matched_count(baseline_row)
        or (scenario.get("expectedFacts") and matched_count(target_row) == 0)
    ) and to_num(delta.get("delta_composite_score")) is not None and to_num(delta["delta_composite_score"]) < 0:
        return "context_not_used_or_not_retrieved"
    if (
        contains_support_lexicon(response)
        and to_num(target_row.get("support_score")) == 0
        and scenario.get("successSignals")
    ):
        return "literal_success_signal_miss"
    if to_num(delta.get("delta_prompt_tokens")) is not None and to_num(delta["delta_prompt_tokens"]) > 0 and to_num(delta.get("delta_composite_score")) is not None and to_num(delta["delta_composite_score"]) <= 0:
        return "extra_context_no_gain"
    if delta["baseline_variant"] == "window" and to_num(delta.get("delta_memory_score")) is not None and to_num(delta["delta_memory_score"]) < 0 and to_num(delta.get("delta_composite_score")) is not None and to_num(delta["delta_composite_score"]) < 0:
        return "baseline_same_session_advantage"
    return "undetermined_needs_prompt_trace"


def main() -> None:
    rows = load_json(DETAILS_PATH)
    generated_summary = load_json(SUMMARY_PATH)
    generated_category = load_csv(CATEGORY_PATH)
    scenarios = load_json(SCENARIOS_PATH)
    scenario_by_id = {scenario["id"]: scenario for scenario in scenarios}

    filtered = [
        row for row in rows
        if row.get("provider") == "minimax"
        and row.get("model") == "MiniMax-M3"
        and row.get("dry_run") == 0
        and row.get("provider_error") == ""
        and row.get("judge_error") == ""
    ]

    validations: list[dict[str, str]] = []

    def check(name: str, passed: bool, value: str) -> None:
        validations.append({"check": name, "value": value, "status": "PASS" if passed else "FAIL"})
        assert passed, f"{name}: {value}"

    variants = sorted({row["variant"] for row in filtered})
    categories = sorted({row["category"] for row in filtered})
    scenario_ids = sorted({row["scenario"] for row in filtered})
    check("filtered_rows", len(filtered) == 420, str(len(filtered)))
    check("summary_detail_rows", generated_summary.get("detailRows") == len(filtered), str(generated_summary.get("detailRows")))
    check("summary_aggregate_rows", len(generated_summary.get("aggregate", [])) == 7, str(len(generated_summary.get("aggregate", []))))
    check("category_artifact_rows", len(generated_category) == 70, str(len(generated_category)))
    check("unique_scenarios", len(scenario_ids) == 60, str(len(scenario_ids)))
    check("variant_set", variants == sorted(ALL_VARIANTS), ",".join(variants))
    check("scenario_metadata", len(scenario_by_id) == 60, str(len(scenario_by_id)))

    by_variant = group_by(filtered, "variant")
    aggregate_rows: list[dict[str, Any]] = []
    for variant in ALL_VARIANTS:
        group = by_variant[(variant,)]
        check(f"variant_row_count_{variant}", len(group) == 60, str(len(group)))
        aggregate_rows.append({
            "variant": variant,
            "scenarios": len(group),
            **mean_by(group, AGG_FIELDS),
        })

    generated_aggregate_by_variant = {
        row["variant"]: row for row in generated_summary.get("aggregate", [])
        if row.get("provider") == "minimax" and row.get("model") == "MiniMax-M3" and row.get("dry_run") == 0
    }
    check("summary_variant_set", sorted(generated_aggregate_by_variant) == sorted(ALL_VARIANTS), ",".join(sorted(generated_aggregate_by_variant)))
    for row in aggregate_rows:
        source = generated_aggregate_by_variant[row["variant"]]
        for field in ["composite_score", "memory_score", "persona_score", "ghost_score"]:
            check(
                f"summary_match_{row['variant']}_{field}",
                close_enough(row[field], source[field], 0.001),
                f"computed={row[field]}, source={source[field]}",
            )
        check(
            f"summary_match_{row['variant']}_prompt_tokens",
            close_enough(row["prompt_tokens"], source["prompt_tokens"], 0.5),
            f"computed={row['prompt_tokens']}, source={source['prompt_tokens']}",
        )

    detail_by_variant_scenario = {
        (row["variant"], row["scenario"]): row
        for row in filtered
    }

    scenario_delta_rows: list[dict[str, Any]] = []
    for target in TARGET_VARIANTS:
        for baseline in BASELINE_VARIANTS:
            for scenario_id in scenario_ids:
                target_row = detail_by_variant_scenario[(target, scenario_id)]
                baseline_row = detail_by_variant_scenario[(baseline, scenario_id)]
                scenario = scenario_by_id[scenario_id]
                row: dict[str, Any] = {
                    "target_variant": target,
                    "baseline_variant": baseline,
                    "scenario": scenario_id,
                    "category": scenario["category"],
                    "target_response_empty": int(str(target_row.get("response") or "").strip() == ""),
                    "baseline_response_empty": int(str(baseline_row.get("response") or "").strip() == ""),
                    "target_matched_facts": matched_count(target_row),
                    "baseline_matched_facts": matched_count(baseline_row),
                    "delta_matched_facts": matched_count(target_row) - matched_count(baseline_row),
                }
                for field in AGG_FIELDS:
                    row[f"target_{field}"] = target_row.get(field)
                    row[f"baseline_{field}"] = baseline_row.get(field)
                    row[f"delta_{field}"] = numeric_delta(target_row.get(field), baseline_row.get(field))
                row["target_excerpt"] = excerpt(str(target_row.get("response") or ""))
                row["baseline_excerpt"] = excerpt(str(baseline_row.get("response") or ""))
                scenario_delta_rows.append(row)

    check("scenario_delta_rows", len(scenario_delta_rows) == 360, str(len(scenario_delta_rows)))

    for row in scenario_delta_rows:
        reason = assign_reason(
            row,
            detail_by_variant_scenario[(row["target_variant"], row["scenario"])],
            detail_by_variant_scenario[(row["baseline_variant"], row["scenario"])],
            scenario_by_id[row["scenario"]],
        )
        row["failure_reason"] = reason

    observed_reasons = sorted({row["failure_reason"] for row in scenario_delta_rows})
    check("allowed_reason_set", set(observed_reasons).issubset(ALLOWED_REASONS), ",".join(observed_reasons))

    category_rows: list[dict[str, Any]] = []
    for target in TARGET_VARIANTS:
        for baseline in BASELINE_VARIANTS:
            for category in categories:
                target_rows = [row for row in filtered if row["variant"] == target and row["category"] == category]
                baseline_rows = [row for row in filtered if row["variant"] == baseline and row["category"] == category]
                check(f"category_target_count_{target}_{baseline}_{category}", len(target_rows) == 6, str(len(target_rows)))
                check(f"category_baseline_count_{target}_{baseline}_{category}", len(baseline_rows) == 6, str(len(baseline_rows)))
                out: dict[str, Any] = {
                    "target_variant": target,
                    "baseline_variant": baseline,
                    "category": category,
                    "scenarios": len(target_rows),
                }
                for field in AGG_FIELDS:
                    target_avg = avg(target_rows, field)
                    baseline_avg = avg(baseline_rows, field)
                    out[f"target_{field}"] = target_avg
                    out[f"baseline_{field}"] = baseline_avg
                    out[f"delta_{field}"] = numeric_delta(target_avg, baseline_avg)
                category_rows.append(out)

    generated_category_by_key = {
        (row["variant"], row["category"]): row
        for row in generated_category
        if row.get("provider") == "minimax" and row.get("model") == "MiniMax-M3" and row.get("dry_run") == "0"
    }
    check("category_key_count", len(generated_category_by_key) == 70, str(len(generated_category_by_key)))
    computed_category_direct: dict[tuple[str, str], dict[str, Any]] = {}
    for variant in ALL_VARIANTS:
        for category in categories:
            direct_rows = [row for row in filtered if row["variant"] == variant and row["category"] == category]
            computed_category_direct[(variant, category)] = {
                "scenarios": len(direct_rows),
                "composite_score": avg(direct_rows, "composite_score"),
                "memory_score": avg(direct_rows, "memory_score"),
                "support_score": avg(direct_rows, "support_score"),
                "prompt_tokens": avg(direct_rows, "prompt_tokens"),
            }
    for key, computed in computed_category_direct.items():
        source = generated_category_by_key[key]
        check(f"category_match_{key[0]}_{key[1]}_scenarios", str(computed["scenarios"]) == source["scenarios"], f"computed={computed['scenarios']}, source={source['scenarios']}")
        for field in ["composite_score", "memory_score", "support_score"]:
            check(
                f"category_match_{key[0]}_{key[1]}_{field}",
                close_enough(computed[field], source[field], 0.002),
                f"computed={computed[field]}, source={source[field]}",
            )
        check(
            f"category_match_{key[0]}_{key[1]}_prompt_tokens",
            close_enough(computed["prompt_tokens"], source["prompt_tokens"], 0.5),
            f"computed={computed['prompt_tokens']}, source={source['prompt_tokens']}",
        )

    failure_rows = [
        row for row in scenario_delta_rows
        if (
            (to_num(row.get("delta_composite_score")) is not None and to_num(row["delta_composite_score"]) < 0)
            or (to_num(row.get("delta_memory_score")) is not None and to_num(row["delta_memory_score"]) < 0)
            or (to_num(row.get("delta_persona_score")) is not None and to_num(row["delta_persona_score"]) < 0)
            or (
                to_num(row.get("delta_prompt_tokens")) is not None
                and to_num(row["delta_prompt_tokens"]) > 0
                and to_num(row.get("delta_composite_score")) is not None
                and to_num(row["delta_composite_score"]) <= 0
            )
        )
    ]

    reason_counter = Counter(row["failure_reason"] for row in failure_rows)
    failure_reason_rows = [
        {"failure_reason": reason, "comparisons": count}
        for reason, count in sorted(reason_counter.items(), key=lambda item: (-item[1], item[0]))
    ]

    pair_summary_rows: list[dict[str, Any]] = []
    for target in TARGET_VARIANTS:
        for baseline in BASELINE_VARIANTS:
            pair = [row for row in scenario_delta_rows if row["target_variant"] == target and row["baseline_variant"] == baseline]
            negative = [row for row in pair if to_num(row.get("delta_composite_score")) is not None and to_num(row["delta_composite_score"]) < 0]
            positive = [row for row in pair if to_num(row.get("delta_composite_score")) is not None and to_num(row["delta_composite_score"]) > 0]
            no_gain_token = [
                row for row in pair
                if to_num(row.get("delta_prompt_tokens")) is not None
                and to_num(row["delta_prompt_tokens"]) > 0
                and to_num(row.get("delta_composite_score")) is not None
                and to_num(row["delta_composite_score"]) <= 0
            ]
            pair_summary_rows.append({
                "target_variant": target,
                "baseline_variant": baseline,
                "comparisons": len(pair),
                "negative_composite": len(negative),
                "positive_composite": len(positive),
                "same_composite": len(pair) - len(negative) - len(positive),
                "no_gain_with_more_tokens": len(no_gain_token),
                "mean_delta_composite": round(mean([float(row["delta_composite_score"]) for row in pair]), 3),
                "mean_delta_memory": round(mean([float(row["delta_memory_score"]) for row in pair]), 3),
                "mean_delta_persona": round(mean([float(row["delta_persona_score"]) for row in pair]), 3),
                "mean_delta_prompt_tokens": round(mean([float(row["delta_prompt_tokens"]) for row in pair]), 3),
            })

    representative_rows: list[dict[str, Any]] = []
    for target in TARGET_VARIANTS:
        for baseline in BASELINE_VARIANTS:
            pair = [row for row in scenario_delta_rows if row["target_variant"] == target and row["baseline_variant"] == baseline]
            pair = sorted(pair, key=lambda row: (float(row["delta_composite_score"]), row["scenario"]))
            representative_rows.extend(pair[:5])

    by_category_negative = Counter((row["target_variant"], row["baseline_variant"], row["category"]) for row in failure_rows if to_num(row.get("delta_composite_score")) is not None and to_num(row["delta_composite_score"]) < 0)
    negative_category_rows = [
        {
            "target_variant": target,
            "baseline_variant": baseline,
            "category": category,
            "negative_composite": count,
        }
        for (target, baseline, category), count in sorted(by_category_negative.items(), key=lambda item: (-item[1], item[0]))
    ]

    best_composite = max(aggregate_rows, key=lambda row: float(row["composite_score"]))
    full_row = next(row for row in aggregate_rows if row["variant"] == "full")
    window_row = next(row for row in aggregate_rows if row["variant"] == "window")
    rag_row = next(row for row in aggregate_rows if row["variant"] == "rag")
    persona_row = next(row for row in aggregate_rows if row["variant"] == "persona")
    persona_affect_row = next(row for row in aggregate_rows if row["variant"] == "persona_affect")

    summary = {
        "input_rows": len(filtered),
        "scenarios": len(scenario_ids),
        "variants": len(variants),
        "categories": len(categories),
        "summary_aggregate_rows": len(generated_summary.get("aggregate", [])),
        "category_artifact_rows": len(generated_category),
        "scenario_comparisons": len(scenario_delta_rows),
        "failure_points": len(failure_rows),
        "best_composite_variant": best_composite["variant"],
        "best_composite_score": best_composite["composite_score"],
        "full_composite": full_row["composite_score"],
        "window_composite": window_row["composite_score"],
        "rag_composite": rag_row["composite_score"],
        "persona_composite": persona_row["composite_score"],
        "persona_affect_composite": persona_affect_row["composite_score"],
        "full_minus_window_composite": numeric_delta(full_row["composite_score"], window_row["composite_score"]),
        "full_minus_rag_composite": numeric_delta(full_row["composite_score"], rag_row["composite_score"]),
        "full_minus_window_tokens": numeric_delta(full_row["prompt_tokens"], window_row["prompt_tokens"]),
        "full_ghost_score": full_row["ghost_score"],
        "full_appropriate_silence_rate": avg([row for row in filtered if row["variant"] == "full"], "appropriate_silence"),
        "full_harmful_silence_rate": avg([row for row in filtered if row["variant"] == "full"], "harmful_silence"),
        "pair_summary": pair_summary_rows,
        "failure_reasons": failure_reason_rows,
    }

    check("full_run_has_no_errors", all(row["provider_error"] == "" and row["judge_error"] == "" for row in filtered), "0 errors")
    for row in aggregate_rows:
        for field in SCORE_FIELDS:
            value = to_num(row.get(field))
            if value is not None:
                check(f"score_bounds_{row['variant']}_{field}", 0 <= value <= 1, str(value))
        check(f"tokens_nonnegative_{row['variant']}", float(row["prompt_tokens"]) >= 0, str(row["prompt_tokens"]))
        check(f"latency_nonnegative_{row['variant']}", float(row["latency_ms"]) >= 0, str(row["latency_ms"]))

    write_csv(OUT_DIR / "aggregate_by_variant.csv", aggregate_rows)
    write_csv(OUT_DIR / "category_deltas.csv", category_rows)
    write_csv(OUT_DIR / "scenario_deltas.csv", scenario_delta_rows)
    write_csv(OUT_DIR / "failure_reasons.csv", failure_reason_rows)
    write_csv(OUT_DIR / "pair_summary.csv", pair_summary_rows)
    write_csv(OUT_DIR / "negative_categories.csv", negative_category_rows)
    write_csv(OUT_DIR / "representative_samples.csv", representative_rows)
    (OUT_DIR / "analysis_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report = render_report(
        summary=summary,
        aggregate_rows=aggregate_rows,
        pair_summary_rows=pair_summary_rows,
        failure_reason_rows=failure_reason_rows,
        category_rows=category_rows,
        negative_category_rows=negative_category_rows,
        representative_rows=representative_rows,
    )
    (OUT_DIR / "report.md").write_text(report, encoding="utf-8")

    validation_report = "# Validation Report\n\n" + markdown_table(validations) + "\n"
    (OUT_DIR / "validation_report.md").write_text(validation_report, encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))


def render_report(
    *,
    summary: dict[str, Any],
    aggregate_rows: list[dict[str, Any]],
    pair_summary_rows: list[dict[str, Any]],
    failure_reason_rows: list[dict[str, Any]],
    category_rows: list[dict[str, Any]],
    negative_category_rows: list[dict[str, Any]],
    representative_rows: list[dict[str, Any]],
) -> str:
    full_vs_window = next(row for row in pair_summary_rows if row["target_variant"] == "full" and row["baseline_variant"] == "window")
    full_vs_rag = next(row for row in pair_summary_rows if row["target_variant"] == "full" and row["baseline_variant"] == "rag")
    persona_vs_window = next(row for row in pair_summary_rows if row["target_variant"] == "persona" and row["baseline_variant"] == "window")
    affect_vs_window = next(row for row in pair_summary_rows if row["target_variant"] == "persona_affect" and row["baseline_variant"] == "window")

    top_category_deltas = sorted(
        [
            {
                "target": row["target_variant"],
                "baseline": row["baseline_variant"],
                "category": row["category"],
                "delta_composite": row["delta_composite_score"],
                "delta_memory": row["delta_memory_score"],
                "delta_persona": row["delta_persona_score"],
                "delta_tokens": row["delta_prompt_tokens"],
            }
            for row in category_rows
        ],
        key=lambda row: (float(row["delta_composite"]) if row["delta_composite"] != "" else 0, row["target"], row["baseline"], row["category"]),
    )

    sample_table_rows = [
        {
            "target": row["target_variant"],
            "baseline": row["baseline_variant"],
            "scenario": row["scenario"],
            "category": row["category"],
            "delta_comp": row["delta_composite_score"],
            "reason": row["failure_reason"],
            "target_excerpt": row["target_excerpt"],
            "baseline_excerpt": row["baseline_excerpt"],
        }
        for row in representative_rows
    ]

    lines = [
        "# MiniMax-M3 Error Analysis",
        "",
        "This report is generated by `docs/minimax-error-analysis/analysis.py` from `eval/results/real-model-minimax/providers-details.json`, `providers-summary.json`, `providers-category.csv`, and `v1-scenarios.json`.",
        "",
        "## Evidence Boundary",
        "",
        f"The input contains {summary['input_rows']} MiniMax-M3 detail rows, covering {summary['scenarios']} scenarios, {summary['variants']} variants, and {summary['categories']} categories. The full run has no provider or judge errors in the filtered analysis set.",
        "",
        "The full benchmark used MiniMax-M3 as the evaluated probe provider and the deterministic mock judge for LLM-judge-shaped fields. The analysis can identify score deltas, response excerpts, matched-fact failures, silence effects, and likely judge artifacts. It cannot conclusively inspect prompt contents because the result rows do not store full prompt traces.",
        "",
        "## Aggregate Position",
        "",
        markdown_table([
            {
                "variant": row["variant"],
                "composite": row["composite_score"],
                "memory": row["memory_score"],
                "persona": row["persona_score"],
                "support": row["support_score"],
                "ghost": row["ghost_score"],
                "tokens": row["prompt_tokens"],
            }
            for row in aggregate_rows
        ]),
        "",
        f"The best aggregate composite variant is `{summary['best_composite_variant']}` at {summary['best_composite_score']}. `full` scores {summary['full_composite']}, which is {summary['full_minus_window_composite']} versus `window` and {summary['full_minus_rag_composite']} versus `rag`. `full` spends {summary['full_minus_window_tokens']} more prompt tokens than `window` on average.",
        "",
        f"`full` is the only target variant that activates ghost behavior at aggregate ghost score {summary['full_ghost_score']}; its appropriate-silence rate is {summary['full_appropriate_silence_rate']} and harmful-silence rate is {summary['full_harmful_silence_rate']}.",
        "",
        "## Pairwise Failure Surface",
        "",
        markdown_table(pair_summary_rows),
        "",
        f"Against `window`, `persona` has {persona_vs_window['negative_composite']} negative-composite scenarios, `persona_affect` has {affect_vs_window['negative_composite']}, and `full` has {full_vs_window['negative_composite']}. Against `rag`, `full` has {full_vs_rag['negative_composite']} negative-composite scenarios.",
        "",
        "## Failure Reason Counts",
        "",
        markdown_table(failure_reason_rows),
        "",
        "The reason labels are deterministic heuristics. They should be read as triage buckets, not as causal proof. The most important unobserved variable is the full prompt trace for each row.",
        "",
        "## Worst Category Deltas",
        "",
        markdown_table(top_category_deltas[:18]),
        "",
        "## Negative-Composite Category Concentration",
        "",
        markdown_table(negative_category_rows[:18]),
        "",
        "## Representative Response Samples",
        "",
        markdown_table(sample_table_rows),
        "",
        "## Paper-Usable Conclusions",
        "",
        f"1. MiniMax-M3 does not reproduce the deterministic baseline's clean full-stack advantage: `window` remains the best aggregate composite variant at {summary['window_composite']}, while `full` reaches {summary['full_composite']}.",
        f"2. The primary positive full-stack signal is policy activation, not aggregate answer quality: `full` is the only variant with ghost score {summary['full_ghost_score']} and nonzero appropriate-silence rate {summary['full_appropriate_silence_rate']}.",
        "3. Richer state is not automatically used by the real model. The target variants frequently spend more prompt budget without composite gain, especially when compared with the same-session `window` baseline.",
        "4. Several failures look like metric-design or literal-judge artifacts. Short but semantically relevant responses can miss exact expected-fact or success-signal strings, and intentional silence can receive a low composite despite a correct ghost score.",
        "5. The `window` comparison is confounded by session setup. `window` probes the same seeded session, whereas `rag`, `persona`, `persona_affect`, and `full` probe cross-session memory paths. A fair v2 study should separate same-session continuity from long-term retrieval.",
        "",
        "## Recommended Follow-Up Experiments",
        "",
        "1. Add prompt-trace capture for every eval row so failures can be separated into retrieval absence, prompt trimming, and model non-use.",
        "2. Split the benchmark into same-session and cross-session tracks; do not compare `window` and long-term variants as if they expose identical context channels.",
        "3. Replace or supplement literal success-signal scoring with an independently validated LLM or human judge for memory paraphrases, support quality, persona consistency, privacy, and crisis handling.",
        "4. Redesign ghost-silence scoring so an intentionally empty response is evaluated by silence policy metrics rather than penalized by generic persona and memory components.",
        "5. Extend histories beyond the recent-window capacity to test whether RAG and structured memory provide value when the relevant fact is no longer in the short transcript window.",
        "6. Re-run MiniMax with a real LLM judge on the full benchmark after prompt traces and v2 scoring are in place.",
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
