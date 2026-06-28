# Phase 0 执行计划：地基与体检 (Foundation & Diagnosis)

> 北极星见 `docs/north-star-architecture.md`。本文件是 Phase 0 的可执行计划（挨个攻破的第一阶段）。
> 制定于 2026-06-28。**计划阶段——经 Darling 批准前不执行。**

## 1. 目标（What / Why）

- **What**：Phase 0 不追求"让 Mio 变好"，追求**"能测出好不好"** + 止血最高 ROI 的纸板感。
- **Why**：研究里最务实的一条——**你不能 unit-test 一段六周的关系，没有"改进前"基线，"变好了"无从谈起**。而且这一步直接关掉你交接文档里那条挂着的"体检 todo"。
- **Why it's good for Darling**：低/零行为风险先行；拿到测量尺后，Phase 1–5 每一步都能用同一把尺验证"真的更好"，而不是凭感觉。

## 2. 关键发现：地基已经有一半（别重造）

| 已有 | 在哪 | Phase 0 怎么用 |
|---|---|---|
| 7 个 ablation variants（no_memory→…→full） | `eval/run.ts` | **现成的对标开源基线**：no_memory≈character.ai 滑窗、rag≈mem0、structured/full≈Mio 全栈。只需加一列 cardboard 指标 |
| 25 用例 pass/fail + minScore + exit 1 | `eval/quality-gate.ts` | **现成 CI 门**。加纸板/重复检查用例 |
| `assessDepth(user, reply)`→0..1 纸板分 | `src/emotion/ritual.ts` | **直接复用**当 cardboard 指标函数，无需重写 |
| runtime 隔离回放（MIO_DIR + dist/ + runTurn） | `eval/run.ts` `loadRuntime()` | 体检/回放脚手架照搬 |

**三个真缺口**（= Phase 0 的活）：
1. cardboard 信号 `turn-post-effects.ts:121` 算完即弃，从未进 eval。
2. eval 全是**合成场景**（`PROFILES`），没碰**真实 transcripts/memory-bank**。
3. 无跨会话重复（self-BLEU/distinct-n）、无纵向基线。

## 3. 工作流

### 工作流 A — 现状体检（真实数据基线）｜零行为风险

- **目标**：对真实数据出一份"改进前"体检报告。
- **新增文件**：`eval/health-check.ts`（CLI：`npm run eval:health -- --data <dir>`，默认 `./data`）。
- **依赖确认**：先读 `src/memory/transcript.ts` + `src/memory/bank.ts` 确定 JSONL 条目口径（role/content/timestamp + compaction 条目）与 `structured-memory.json` / persona-delta / L4 共同史 schema。
- **它算什么**（全部 LLM-free，复用现有函数）：
  - **纸板分布**：对每对连续 user→assistant 跑 `assessDepth` → 直方图 + 按周趋势（纸板感随时间变好还是变差）。
  - **记忆留存**：`structured-memory.json` 的 durableFacts 数、L4 共同史条目、persona-delta atoms；抽样核对"用户明确说过的事"是否被捕获。
  - **串户检测**：扫 `data/users/<id>/` 与 isolated session，核对全局 memory 是否混入 IM 会话事实（隔离漏洞回归）。
  - **ritual 累积**：读 `ritual-state.json` → 晋升了几个 ritual、频次分布。
  - **跨会话重复**：assistant 回复的 self-BLEU + distinct-1/2（"每次都那句安慰"= 纸板的纵向证据）。
- **产出**：`eval/results/health/health-report.md`（基线数字 + 直方图 data）。
- **验证**：`npm run eval:health -- --data ./data` 跑通出报告；对一份小的合成 transcript 跑出已知期望值（加一个 `tests/unit-health-check.ts`）。
- **风险**：真实数据在**部署机**（交接 todo #2 还没拉回）。缓解：脚本对本地 `./data` 先跑通；真实数据到位后重跑。脚本**只读**，绝不写 `data/`。

### 工作流 B — cardboard/ritual 接进现有 eval（信号不再丢）｜零行为风险

- **目标**：把"算完即弃"的纸板信号变成**可回归的指标列**。
- **改动文件**：
  - `eval/run.ts`：`DetailRow` 加 `cardboard_score`、`repetition_score` 两列；在 `runScenarioVariant` 里对 `result.text`（+ seed 回复）跑 `assessDepth` 与跨 variant self-BLEU，写入聚合 CSV/JSON。→ 立刻能看到 **no_memory vs full 的纸板差**（量化"我的全栈到底降了多少纸板感"）。
  - `eval/quality-gate.ts`：加 1 个 `category: 'cardboard'` 的检查族——对几个已知"该深"的 probe，断言 `assessDepth(probe, response) < 阈值`；对重复回复断言 distinct-2 > 阈值。
- **验证**：`npm run eval:quality` 仍全绿且新增用例生效；`npm run eval:paper -- --max-scenarios 2 --dry-run` 看到新列。
- **风险**：`eval/run.ts` 是大文件但**非并发热点**（codex 在动的是 src/ 核心）。低风险。

### 工作流 C — 身份再锚定 P3（最高 ROI、零 schema）｜⚠️ 触碰 live prompt 路径

- **目标**：对抗注意力衰减导致的人格漂移（研究证明 drift 是几何必然，补救只有结构性再注入）。
- **改动文件**：
  - `src/prompt/templates.ts` 或 `context-engine.ts`：在**最新 user turn 之前的晚位置**再注入一个 ≤80 token 的 **identity anchor** = `L0 kernel 一行 + 自我一句话 + 关系一句话`（split-softmax 的 prompt 级替代）。
  - 新增 drift 探针：每 N 轮用便宜 `router.ts` classify 模型问一个固定的离题身份问题，用现有 `judge.ts` 对答案打分，写 `eval-events.jsonl`。
- **验证**：用工作流 B 的 cardboard/persona 指标做**再锚定前后对比**（A/B：anchor on/off 各跑一遍 eval，看 persona_score / cardboard 是否改善）。
- **风险**：⚠️ **`templates.ts` 是并发 codex 热文件**（见记忆 [[concurrent-codex-instances]]）。缓解：动前 `git status` 核实、只 add 自己的、必要时 node 脚本原子改避开 Edit race；anchor 走 ContextEngine 既有 section 注册机制，不裸改字符串拼接。**C 可选**——若想 Phase 0 纯测量、零行为风险，C 可推到 Phase 1 之后。

## 4. 执行顺序与依赖

```
A（体检基线）─┐
              ├─→ C（再锚定，用 B 的指标验证前后对比）  ← 可选/可延后
B（指标接线）─┘
```
A、B 互相独立、都零行为风险，可并行。C 依赖 B（要指标才能证明 anchor 有用），且因触碰热文件单独 gating。

## 5. 验证（战损检查）

```bash
npm run build && npm run typecheck      # 干净
npm test                                # 全量全绿（含新增 unit-health-check）
npm run eval:quality                    # CI 门全绿 + 新纸板用例生效
npm run eval:health -- --data ./data    # 出 health-report.md
```

## 6. 约定与风险（接手必读）

- **并发 codex**：改任何 `src/` 共享文件前先 `git status`；提交只 `git add` 自己的文件；**绝不 amend/rebase 别人 commit**。`templates.ts`/`types.ts` 是热点。
- ESM 导入带 `.js`；production 禁 `console.log`（用 `logger`）；测试 import 自 `dist/`（先 build）、`MIO_PROVIDER=mock`；所有路径经 `src/memory/paths.ts`；commit 身份 AnxForever。
- 工作流 A/B **零行为风险**（只读 + eval 工具）；C 是唯一动 live 路径的，单独批准。

## 7. 验收标准 (Definition of Done)

- [ ] `health-report.md` 产出真实（或本地）基线：纸板分布、记忆留存、串户、ritual、跨会话重复。
- [ ] `cardboard_score` + `repetition_score` 成为 `eval/run.ts` 指标列；能读出 no_memory↔full 的纸板差。
- [ ] `eval/quality-gate.ts` 新增纸板/重复检查族，`npm run eval:quality` 全绿。
- [ ] （若做 C）drift 探针有数 + 再锚定 on/off 的 persona/cardboard 对比。
- [ ] build + typecheck + 全量 test 全绿。

## 8. 任务清单

见 TaskList（Phase 0 专项）。攻击顺序：先确认数据口径 → A/B 并行 → 战损检查 →（可选）C。
