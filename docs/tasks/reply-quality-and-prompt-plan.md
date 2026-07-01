# Mio 回复人味与 Prompt 质量计划

## 目标

解决“回复不像人、像客服/助手、记忆使用机械”的问题。所有 prompt 相关改动必须先有外部项目或官方文档对照，再用本仓库 eval 回归验证。

## 外部对照

检索日期：2026-07-01。prompt 相关判断至少用官方文档 + 开源同类项目交叉验证，不能只按主观语感改。

| 来源 | 已检查文件 | 关键做法 | 对 Mio 的决策 |
| --- | --- | --- | --- |
| Anthropic prompt/eval docs | prompt engineering overview, develop tests | 先定义成功标准和测试集，再改 prompt | prompt 改动必须配套 `persona-prompt-audit`、`reply-rubric`、`quality-gate` |
| OpenAI prompt/eval docs | prompt engineering, evaluation best practices | prompt 变更要进入代码和代表性 eval，不靠主观感觉 | 不做一次性大改，保留小步回归 |
| SillyTavern | `default/content/settings.json` | 核心 system 很短；人格、场景、样例、历史按顺序分块 | Mio 保持 `soul.md` 单一人格源，减少规则和人格混写 |
| Open WebUI | `backend/open_webui/utils/memory.py` | 记忆用独立 XML 标签；按用户最近消息查询、去重、限长 | 记忆只在同话题时注入，避免把工作记忆塞进饮品偏好回合 |
| ElizaOS | `packages/agent/src/runtime/build-character-config.ts`, `packages/cloud/shared/src/lib/eliza/shared/providers/character.ts`, `prompt-compaction.ts` | character 是结构化对象；能力提示短句追加；message examples 靠近生成点；上下文按意图压缩 | Mio 把 voice few-shot 后置到 prompt 末尾，动态状态先注入、样例最后教语气 |

### 来源附录

| 来源 | 链接 | 复查到的证据 | 本仓库落点 |
| --- | --- | --- | --- |
| Anthropic | <https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview>, <https://docs.anthropic.com/en/docs/test-and-evaluate/develop-tests> | 官方强调先建立可评估任务和测试，再迭代 prompt | 所有 prompt 改动进入 eval，不靠单条试聊判断 |
| OpenAI | <https://platform.openai.com/docs/guides/prompt-engineering>, <https://platform.openai.com/docs/guides/evals> | 官方建议把代表性失败样例纳入 eval，比较 prompt 变更效果 | `reply-rubric`、`quality-gate` 作为回归门 |
| SillyTavern | <https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/default/content/settings.json> | `story_string` 依次拼 `system`、`description`、`personality`、`scenario`、`persona`；另有 `example_separator` 和 `[Example Chat]` | Mio prompt 继续分 section，不把身份、记忆、状态混在一个大段里 |
| Open WebUI | <https://raw.githubusercontent.com/open-webui/open-webui/main/backend/open_webui/utils/memory.py> | 定义 `<memory_context>`；从最近 user messages 生成 query；`query_memory(... k=8)`；写入前去掉旧 memory context；用户记忆和上下文记忆都有 char limit | Mio 记忆补丁必须同话题、限量、隔离，不再机械塞旧事实 |
| ElizaOS character config | <https://raw.githubusercontent.com/elizaOS/eliza/main/packages/agent/src/runtime/build-character-config.ts> | character 由 `system`、`bio`、`style`、`topics`、`messageExamples` 组成；capability hints 是短句追加，不压过 voice | Mio 保持 `soul.md` 是身份源，能力/动态上下文独立追加 |
| ElizaOS character provider | <https://raw.githubusercontent.com/elizaOS/eliza/main/packages/cloud/shared/src/lib/eliza/shared/providers/character.ts> | message examples 按当前消息 keyword overlap 选 top 3；注释明确 few-shot 是 voice/style 的高效杠杆 | Mio 将 voice few-shot 后置，并保留未来做检索式示例选择的 P1/P2 方向 |
| ElizaOS prompt compaction | <https://raw.githubusercontent.com/elizaOS/eliza/main/packages/agent/src/runtime/prompt-compaction.ts> | 按 intent 压缩无关 action docs、workspace context、plugin catalog | Mio 后续压缩规则时优先做“按意图保留”，不是盲删上下文 |

## 当前基线

| 检查 | 命令 | 当前结果 |
| --- | --- | --- |
| Build | `npm run build` | 通过 |
| Prompt audit | `MIO_PROVIDER=mock node --experimental-strip-types eval/persona-prompt-audit.ts` | 0 error, 0 warning |
| Reply rubric | `MIO_PROVIDER=mock node --experimental-strip-types eval/reply-rubric.ts` | 98/98 通过 |
| Quality gate | `MIO_PROVIDER=mock node --experimental-strip-types eval/quality-gate.ts --providers=mock` | 31/31 通过 |

## 任务表

| 优先级 | 任务 | 决策依据 | 验收 |
| --- | --- | --- | --- |
| P0 | 修复机械记忆补丁：不再盲目前缀“记得，是...” | Open WebUI 的相关记忆过滤；用户投诉“像机器” | `unit-reply-quality-gate` 和 `quality-gate` 通过 |
| P0 | voice few-shot 后置到生成点附近 | SillyTavern/ElizaOS 都把示例靠近生成；few-shot 比抽象规则更能定语气 | `unit-persona-prompt-audit` 断言 `voice-examples` 在情绪/通用 few-shot 后 |
| P1 | 继续压缩高频负向规则，转成少量正向模式和示例 | 外部项目核心 system 更短，规则过多会变“执行规章” | prompt audit 不退化，reply rubric/quality gate 通过 |
| P1 | 修 proactive provider 参数顺序 | `selectProvider(provider, model, fallback)` 与调用点不一致 | 新增 focused unit test |
| P1 | 修 `@mio/idrag` gender drift | ADR 0005 已记录 package drift；types 是 `male/female`，generator 可能查 `boyfriend/girlfriend` | 新增 package parity/generator test |
| P1 | 修 fallback 跨 provider model 复用 | fallback provider 应使用自身默认 model，不应沿用 primary model 字符串 | 新增 fallback unit test |
| P2 | 扩展真实 provider 试聊集 | OpenAI/Anthropic 都建议从真实失败样例挖 eval | 记录 provider、模型、输入、输出和失败分类 |

## 执行规则

- 先搜外部材料或查本仓库 ADR，再改 prompt。
- 每次 prompt 改动只动一个机制，避免无法归因。
- 改动后至少跑：`npm run build`、相关 unit、`persona-prompt-audit`、`reply-rubric`、`quality-gate`。
- 不把动态状态写进 `soul.md`；人格稳定信息留在 `soul.md`，记忆/情绪/关系留在 ContextEngine 动态 section。
- 记忆注入必须有话题相关性，不能为了“显得记得”而强行提旧事实。
