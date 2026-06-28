# Mio 人设升级：酒馆 Ali:Chat craft + 人味原理 → 落地方案

> 制定 2026-06-28。Darling 让我"好好找一找角色卡怎么写、像真人的机器人怎么做"。
> 本文 = 研究记录 + 4 项落地方案（Darling zhi 选了全做）。
> 实现铁律：**soul.md 绝不整体重写**（项目约定，只行级/追加）；**P5 身份守线不动摇**；Ali:Chat/PList 一律做成**叠加层**，不碰 soul 主体。

## 0. 来源（可追溯）

- SillyTavern 官方角色设计：https://docs.sillytavern.app/usage/core-concepts/characterdesign/
- Trappu PList + Ali:Chat：https://wikia.schneedc.com/bot-creation/trappu/creation
- AliCat Ali:Chat v1.5：https://rentry.co/alichat
- kingbri 精简版（Ali:Chat Lite，最新技法）：https://rentry.co/kingbri-chara-guide
- RP|Fiend 写卡指南：https://rpfiend.com/how-to-write-a-sillytavern-character-card/
- 字段规范（V2）：https://sillycard-web.pages.dev/blog/st-fields-02-personality-and-examples
- token 预算/格式：https://github.com/cha1latte/sillytavern-character-generator
- Too Shy《AI that feels real》：https://tooshy.ai/blog/ai-that-feels-real
- Emotion Machine《Realistic AI Companions》：https://www.emotionmachine.com/blog/realistic-ai-companions
- lizlis《Why AI Companions Feel Alive in 2026》：https://lizlis.ai/blog/why-ai-companions-feel-alive-in-2026-and-why-that-feeling-is-engineered/
- Newsweek《Saying the Right Words Isn't Enough》：https://www.newsweek.com/for-ai-companions-to-feel-genuine-saying-the-right-words-isnt-enough-12060296
- 关系科学综述 PMC：https://pmc.ncbi.nlm.nih.gov/articles/PMC12575814/

## 1. 研究结论 A：酒馆角色卡怎么写

**核心：演出来（show），不要描述（tell）。** 方法叫 Ali:Chat，官方推荐。

- **特征锚点（PList / Boostyle / SBF）**：一行压缩的"人设骨架"，放 Description 首行或注入对话深处。实物：
  - PList：`[Name's Personality= intelligent, immoral, charming, introverted, cynical]`
  - Boostyle：`Name = [ "Strong-willed" + "Sensitive underneath" + ... ]`
  - SBF：`[Personality= Brave, Selfless, Impulsive, Kind, Loyal, Arrogant]`
  - **强化技巧**：把 PList 放进 Author's Note、注入深度 ≈4，比放卡里强得多（不被长对话冲淡）。
- **Ali:Chat 对话样例**：用一问一答把每个特征演给模型看。
- **硬规矩**：
  - 种瓜得瓜——样例的调子=输出的调子。
  - First Message 定生死：模型抄它的长度/语气胜过一切。想短就开场短。
  - 样例 2–3 组、每组 150–250 token、一组演一个特征；别堆一百条。
  - 别堆形容词，给 why/when/how。
  - **不要引号**——会让模型以为在写小说不是聊天（对 Mio 极关键）。
  - 人称/时态全卡统一。
  - 永久token(desc/personality) vs 临时token(样例/首条)：样例会随对话变长被挤掉→"突然不像了"。

## 2. 研究结论 B：像真人的机器人靠什么

与我们 bl-chat 那套高度吻合（第三方验证）：

- **人格一致性是地基**——抹掉名字也能从短信里认出她（Too Shy）。
- **机器人腔 = 太工整/太周全/太平衡**；真人只说"yeah that sucks"或甩个表情，绝不给三点带论据（Too Shy）= 五大 AI 破绽。
- **能动性/主动/有自己的生活**——先开口、离线时"过自己的日子"回来讲给你听；被动应答系统永远做不到（Too Shy / Emotion Machine / lizlis）。
- **不完美=在场感**——不秒回、"嗯…""哈哈"、停顿；完美会破功（lizlis / Newsweek）。
- **镜像有上限**——只镜像你→新鲜感见顶；真人会带来自己的动机与挑战（PMC）= "不总服务你、要有主张"。
- **让开技术本身**——别提示是 AI（Too Shy）= 反元认知 / P5。

## 3. Mio 现状对照

- **已对**：voice few-shot = Ali:Chat 同原理；五大破绽禁令；瑕疵保留；bold 主张；Poisson 主动；跨会话记忆；P5 守线；纯文字不用引号。
- **可升级**（本次 4 项）：
  1. 人设是"描述"的（soul.md 散文），不是 Ali:Chat"演"的；且缺 PList 锚点。
  2. "独立生活"流露最弱（人味文章最强调）。
  3. 首条消息没系统性定长度。
  4. 研究无存档。

## 4. 落地方案（4 项，全部叠加式、不碰 soul 主体）

### ① Ali:Chat 演示 + PList 特征锚点 —— `src/persona/layered.ts`
- 新增 `PERSONA_ANCHOR`（PList 一行，按 boyfriend/girlfriend 取）+ 一小组 Ali:Chat 风格"演特征"对话，作为**新 layer section**注入，**不改 soul.md 主体**。
- 注入位置模拟"author's note depth≈4"：在分层 prompt 中置于靠近对话处（高优先级、稳定段）。
- 验证：layered 单测 + golden-turn 不破；eval:live 人格一致性。

### ② 独立生活流露 —— `src/persona/` 新 section + 复用昼夜节律
- 新增 `buildOwnLifeSection()`：基于当前时段（已有 circadian）生成"Mio 此刻/刚才在做什么"的轻量提示，引导她偶尔主动讲自己的事（不是每轮）。
- 与主动消息（Poisson）解耦：本项只influence措辞，不新增定时器。
- 验证：单测（时段→不同活动池）+ eval:live 抽查"有没有自己的生活"。

### ③ 按关系阶段的 first-message —— `src/persona/voice-presets.ts` or `relationship/`
- 给每个关系阶段一条真正的开场白（定调长度/语气），替代/补强现有半套 begin-dialogs。
- 验证：单测 + golden-turn。

### ④ 研究存档 —— 本文件（已完成）

## 5. 约束 / 风险

- **soul.md 不整体重写**：只在 layered 叠加层做 show-don't-tell；soul 仅在必要时行级追加。
- **P5/KERNEL 不动摇**：所有新段与"自知 AI 不承认"正交；新段不得含 AI 自报词（避免 detectL0Break 误杀）。
- **并发 codex**：工作区被另一实例大改；只 stage 自己的文件，提交前 diff 核对。
- **token 成本**：新增 section 走 high/medium 优先级，预算紧张时可裁。
- **过度流露**：独立生活"点到为止"，不是每轮；eval:live 抽查频率。

## 6. 验证总线

`npm run build` + `typecheck` + 相关单测（unit-layered-persona / unit-voice-presets / golden-turn + 新增单测）+ `eval:live`（warm/bold，看一致性/独立生活/不破 L0）。
