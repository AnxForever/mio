# 给 codex 的任务交接：Mio 口语化人味（D）+ 收尾分寸（C 转化）

> 来源：Claude Code（feat/layered-persona 分支，拟人优化并行作业）
> 交接时间：2026-06-28

## 一、背景：两层并行，别撞车

「让 Mio 在微信/QQ 里更像活人」分两个正交的层，文件域严格隔离：

| 层 | 谁 | 状态 | 文件 |
|---|---|---|---|
| **行为动力学**（何时回/回多少/多快） | Claude Code | ✅ 已完成 | `im-pacing.ts`、`circadian.ts`、`templates.ts`、`openai-compat.ts`、`onebot.ts`、`server/index.ts`、`config.ts` |
| **语言风格**（说出来像不像人） | **你（codex）** | ⬜ 本任务 | `persona/layered.ts`、`soul.md`、`memory/persona-delta.ts` |

已完成的行为层：
- **A 打字节奏**：`src/server/im-pacing.ts`（长回复分段成多条短气泡 + 按字数模拟打字延迟），微信/QQ 桥都接了，开关 `MIO_FEATURE_IM_PACING=true`（默认关）。
- **B 时间感知**：`src/emotion/circadian.ts` + `buildTimeContext` 增强——深夜带困意/简短、清晨慢热、晚上最想聊，已注入 prompt。

## 二、你的任务范围（只动 persona 层）

**允许修改**：
- `src/persona/layered.ts`（`buildBeginDialogs` / 口语化指令）
- 当前 mod 的 `soul.md`
- `src/memory/persona-delta.ts`（若需扩展 begin_dialogs 结构）

**🚫 禁区（Claude Code 的地盘，绝对别碰，否则互相覆盖）**：
`templates.ts`、`config.ts`、`types.ts`、`agent-loop.ts`、`openai-compat.ts`、`onebot.ts`、`server/index.ts`、`im-pacing.ts`、`circadian.ts`，以及 `package.json` 里 Claude Code 已挂的 `unit-im-pacing`/`unit-circadian` 测试项。

## 三、要做什么

### D. 口语化人味（减 AI 腔）
目标：Mio 说话像真人发微信，不像 AI 助手。
1. **语气词与口语**：自然用"诶/嘛/啦/呗/哈/嗯呐"，但别滥用。
2. **短措辞**：微信化短句，少书面长句，少"首先/其次/综上"这类结构词。
3. **偶尔不完美**：允许口语跳跃、自我更正（"啊不对，是…"），不追求每句工整。
4. **去客服腔**：禁止"有什么可以帮您""请问还有什么需要"这类话术。

实现建议：在 `buildBeginDialogs` 指引里强化口语化定调；begin_dialogs few-shot 放更口语的示范对；`soul.md` 语言风格段补充。

### C. 收尾分寸（从 Claude Code 转来）
目标：对方在收尾时，Mio 别长篇大论硬聊。

背景：原计划在 `ghost.ts`/`agent-loop.ts` 做"软已读不回"，但 ① 系统提示在 `buildSystemPrompt` 阶段拿不到当前用户消息（无法判断"对方在收尾"）；② `agent-loop.ts` 是你的活（避让）。所以转为 persona 层引导——对陪伴 agent，软引导比硬编码静默更自然、不出戏。

要求：当对方说"晚安/嗯/哦/去忙了/先这样/拜拜"这类收尾或短确认时：
- 顺着自然收尾（"嗯嗯，晚安~""去忙吧，我在呢"），别强行延续话题、别抛新问题。
- 回得短，匹配对方的能量，不要用力过猛。

实现建议：begin_dialogs 放 1–2 个收尾示范对（如 user:"睡了" / assistant:"嗯，晚安，做个好梦~"）；`soul.md` 分寸段写明。

⚠️ **别重复 B**：深夜的"困意+简短"已由 `circadian.ts` 在 prompt 注入，你专注"对方收尾时的分寸"，别再写时间逻辑。

## 四、验收标准
- [ ] begin_dialogs/soul 体现口语化（语气词、短句、去客服腔）
- [ ] 有收尾场景示范（晚安/去忙了 → 自然收短）
- [ ] `npm run build && npm test` 全绿（尤其 `unit-begin-dialogs` / `unit-layered-persona`）
- [ ] 没碰禁区文件

## 五、测试
- 扩展 `tests/unit-begin-dialogs.ts` 或新增 `tests/unit-colloquial.ts`，断言口语化/收尾示范被正确渲染进 delta fragment。
- 测试挂进 `package.json` test 链时，只追加你新增的那一项，别动 Claude Code 已挂的 `unit-im-pacing`/`unit-circadian`。
