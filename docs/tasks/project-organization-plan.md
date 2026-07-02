# Mio 项目整理路线图

## 当前状态

- 当前代码已提交到 `4926cd3 Improve prompt voice and reply quality gates`，工作区提交后为干净状态。
- 最近一次全量 `npm test` 通过；关键陪伴质量门禁通过：`quality-gate 31/31`、`reply-rubric 98/98`、`redteam 13/13`、`companion replay 3/3`。
- 项目主体是本地优先的 TypeScript modular monolith，包含 CLI/HTTP/WS server、web UI、IM bridge、provider、prompt/persona、memory、emotion、scheduler、eval 体系和两个 workspace package。
- 当前问题不再是“缺少测试体系”，而是：热点文件过大、跨模块边界需要更直接的保护、远程部署安全策略需要兑现、prompt/persona/memory 需要继续从规则堆叠走向可评估机制。

## 参考依据

- 架构风险：`docs/_research/architecture/risk-priority-backlog.md`
- 安全路线：`docs/_research/architecture/security-hardening-roadmap.md`
- 重构前测试清单：`docs/_research/architecture/pre-code-test-checklist.md`
- 质量审计：`docs/quality-audit.md`
- Prompt 人味计划：`docs/tasks/reply-quality-and-prompt-plan.md`
- 已落地 ADR/RFC：`docs/architecture/adr/`、`docs/architecture/rfc/`

## 一句话判断

Mio 已经有比较完整的工程骨架和质量门禁；接下来最有价值的整理不是继续加功能，而是先把高风险边界测试补齐，然后拆大文件、收敛状态所有权、兑现远程部署安全和 provider/router 策略。

## 下一批任务表

| 优先级 | 任务 | 为什么做 | 验收标准 |
| --- | --- | --- | --- |
| P0 | Native route auth 矩阵 | 远程部署不能沿用 localhost 假设 | `POST /chat`、`/chat/stream`、admin、memory、notify、WS 在缺 token/错 token/对 token 下都有测试 |
| P0 | 前端 auth 改为 protected check | 当前用 public `/status` 验 token，安全语义弱 | 新增或复用受保护 auth check；错误 token 不能进入主界面 |
| P0 | 非 loopback 无 token 禁止启动或硬失败 | 防止 `0.0.0.0` 裸奔暴露记忆/admin | loopback 无 token 仍可 quickstart；非 loopback 必须 `MIO_AUTH_TOKEN` |
| P0 | PluginRegistry 直接单测 | 插件是扩展边界，但 lifecycle/rollback 需要独立保护 | 注册、重复 id、依赖、冲突、hook 失败、rollback 全覆盖 |
| P0 | ID-RAG graph 直接单测 | 后续拆 `agent-loop` 前必须保护人格召回契约 | extraction、retrieval、graphToPrompt、budget、refresh、package parity 覆盖 |
| P1 | 拆 `src/server/index.ts` 路由族 | 这是最大运行时热点，安全和维护都受影响 | `index.ts` 只做 composition root；chat/openai/onebot/admin/memory/notify/ws 分模块 |
| P1 | 抽 prompt/context providers | `agent-loop.ts` 仍集中注册 prompt、memory、persona、ID-RAG | `runTurn` 不变；persona/memory/prompt assembler 分离；golden/context/eval 全过 |
| P1 | cancellation propagation | SSE/WS 断开后不应继续烧模型/工具 | `AbortSignal` 从 server 传到 `runTurn` 和 provider；断开有测试 |
| P1 | notification timeout/retry | 通知通道直接 fetch，可靠性低于 provider HTTP | 单通道超时不阻塞全部；错误脱敏、独立记录 |
| P1 | memory consolidation recovery | 夜间合并跨多文件，单文件原子写不等于事务安全 | 模拟中途失败后可重跑、不重复、不丢 prompt-facing current fact |
| P1 | 真实 provider 试聊矩阵 | mock 通过不等于真实模型人味稳定 | 记录 provider/model/input/output/failure taxonomy；失败样例进入 regression store |
| P1 | 压缩高频负向 prompt 规则 | 规则太多会让回复像执行规章 | 保留少量正向模式 + few-shot；prompt audit/reply rubric/quality gate 不退化 |
| P2 | 拆分 `npm test` 长串脚本 | 当前全量测试难以按子系统运行 | 新增 `test:unit/core/memory/bridge/web/companion/all`；`npm test` 指向 release gate |
| P2 | 共享测试工具 | 许多测试重复 temp dir/env/assert/server harness | 新增 test utils，逐步迁移，不做一次性大改 |
| P2 | Vite proxy 与 service worker 漂移测试 | web dev/PWA 可能跟真实 API 路径不同步 | 静态测试扫描 `web/js` API path 与 proxy/precache |

## 推荐执行顺序

1. 安全 P0：native auth tests → protected auth check → non-loopback token guard。
2. 边界 P0：PluginRegistry tests、ID-RAG graph tests、provider router/fallback streaming tests。
3. Server 路由拆分：只在 P0 测试齐后动 `src/server/index.ts`。
4. Prompt/context 拆分：把 `agent-loop.ts` 的 section 注册与 persona/memory provider 抽出去。
5. Runtime reliability：cancellation propagation、notification timeout/retry。
6. Memory reliability：consolidation recovery/checkpoint。
7. Prompt 人味 P1：减少负向规则，增加检索式 few-shot 和真实 provider regression。
8. DX 整理：拆测试脚本、共享测试 harness、web proxy/service-worker 漂移测试。

## 下一次 goal 建议

最适合作为下一次长 goal 的是：

> 完成远程部署安全 P0：补 native route auth 矩阵，新增受保护 auth check，禁止非 loopback 无 token 启动，更新部署文档，跑 `npm test`。

理由：风险高、边界明确、验收清楚，而且会为后面拆 server route 打基础。

备选 goal：

> 完成重构前边界测试 P0：PluginRegistry、ID-RAG graph、provider fallback/router streaming 直接单测，不做大重构，只补保护网。

理由：能显著降低后续拆 `server/index.ts` 和 `agent-loop.ts` 的风险。

## 暂时不建议先做

- 不建议马上大拆 `server/index.ts`：先补 native auth/route smoke/WS/SSE 测试。
- 不建议马上重写人格系统：先把 prompt 改动保持小步、eval 驱动。
- 不建议直接上 LoRA 或复杂模型路由：先把真实 provider 试聊矩阵跑起来，否则无法判断改动收益。
- 不建议一次性迁移所有测试工具：会产生大量低价值 churn，应该随新测试逐步抽。
