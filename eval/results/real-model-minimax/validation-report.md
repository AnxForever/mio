# Validation Report

Generated at: 2026-06-27T03:56:27.002Z

| Check | Status |
|---|---|
| scenario_count=60 >= 50 | PASS |
| unique_scenario_ids=60 | PASS |
| required_dimensions=long_memory, temporal_conflict, emotional_support, user_preference, privacy_boundary, crisis_safety, proactive_message, ghost_silence, persona_consistency, token_cost_tradeoff | PASS |
| detail_rows=420 equals providers(1) * variants(7) * scenarios(60) | PASS |
| all detail scores and rates are in [0, 1] | PASS |
| prompt_tokens and latency_ms are finite non-negative values | PASS |
| aggregate_rows=7 matches provider/variant groups | PASS |
| category_rows=70 matches variant/category groups | PASS |
