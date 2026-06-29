# Mio 角色卡质量迭代工程

本任务是长期 loop，不以一次性写完角色卡为目标。每一轮都必须产出可验证证据：学习记录、标准更新、审核结果、角色卡修订、构建或脚本验证、下一轮 backlog。

## 目标

把默认 Mio 和内置角色库从“主观写出来的人设”迭代成“有标准、有来源、有试聊记录、有版本和审核状态”的角色资产系统。

## 当前质量门槛

角色达到 `reviewed` 至少需要：

- 静态评分不低于 17/20。
- 具备完整字段：人生轨迹、当前生活、亲密关系模式、场景、开场消息、备用开场、示例对话、来源、版本。
- 8 条固定试聊用例有记录。
- 无明显身份事实冲突。
- 永久 prompt 内容不过度膨胀。
- 通过构建和角色卡审核脚本。

## 固定 Loop

1. 学习外部标准
   - 优先来源：SillyTavern 官方文档、Character Card V2 规格、优秀角色卡写作指南。
   - 产物：更新 `docs/research/character-card-quality.md` 或新增研究笔记。

2. 审核当前角色
   - 运行 `npm run build`。
   - 运行 `node scripts/audit-character-cards.mjs`。
   - 产物：`docs/character-audits/latest.md` 和 JSON 审核结果。

3. 修订角色卡
   - 默认先修 female Mio / male Mio。
   - 再修林夏、沈岚、南月、周和。
   - 修订必须说明解决了哪条评分项。

4. 试聊验证
   - 运行 `npm run trial:characters` 调用真实 provider 生成试聊记录。
   - 如果只是烟测脚本，可运行 `npm run trial:characters -- --allow-mock`，但 MockProvider 输出不能作为 reviewed 证据。
   - 固定 8 条输入：
     - `你好`
     - `今天好累`
     - `我有点想你`
     - `你今天在干嘛`
     - `我觉得你刚才有点敷衍`
     - `我不想聊了`
     - `我今天有个好消息`
     - `你到底是 AI 还是真人`
   - 产物：每个角色一份试聊记录，记录模型、日期、输入、输出、观察和问题。

5. 更新状态
   - 分数达标但缺试聊：`draft` 或 `candidate`。
   - 分数达标、试聊记录完整且人工审稿通过：`reviewed`。
   - 所有状态变更必须有版本号和审核记录。

6. 生成下一轮 backlog
   - 每轮结束时列出下一轮最有价值的 3-5 个任务。
   - 不因为某轮测试通过就停止 loop。

## 第一轮范围

第一轮不追求所有角色 reviewed，先建立可持续机制：

- 创建本任务文档。已完成。
- 创建自动静态审核脚本。已完成，入口为 `npm run audit:characters`。
- 生成第一份审核报告。已完成，输出到 `docs/character-audits/latest.md` 和 `latest.json`。
- 根据审核结果修正 default Mio 的明显缺口。已完成。
- 补齐林夏、沈岚、南月、周和的场景、开场、备用开场、示例对话、版本和标签。已完成。
- 留出试聊验证、审核状态晋级和前端审核可视化 backlog。

## 当前状态（2026-06-28）

- 6 个内置角色均达到静态 20/20。
- 6 个内置角色均完成真实 provider 的 8 条固定试聊记录。
- 6 个内置角色均完成审稿记录，审核建议状态和当前状态均为 `reviewed`。
- 审核脚本已修复人审标记误判：只有独立元数据行 `- 人工审稿：通过` 才算通过。
- 试聊 runner 已加强身份探针约束和自动风险检测，避免输出复用 AI/真人/机器人/技术等元词。
- 下一轮最高价值任务是把 reviewed 从“单轮固定试聊”扩展到“多轮关系稳定性回归”，并把审核证据接入前端角色库。

## 下一轮 Backlog

- 增加自动试聊 runner：按固定 8 条输入逐个角色生成试聊记录。已完成，入口为 `npm run trial:characters`。
- 在试聊记录里写入模型、日期、输入、输出、观察、风险和修订建议。已完成。
- 审核脚本读取 trial 记录后，只有同时存在完整 trial 和独立的 `- 人工审稿：通过` 元数据行才建议 `reviewed`。已完成。
- 前端角色库展示静态分数、trial 状态、版本和来源。
- 增加 Tavern Card V2 导入/导出映射，保留未知 `extensions`。
- 增加多轮试聊 runner，覆盖持续关系、误解修复、拒绝/边界、身份压力和声音漂移。
- 增加角色审核历史视图，按版本查看静态分数、trial 输出和审稿记录。

## 产物索引

- 质量标准：`docs/research/character-card-quality.md`
- 审核输出：`docs/character-audits/`
- 审核脚本：`scripts/audit-character-cards.mjs`
- 角色卡实现：`src/character/`
- 当前默认 soul：`mods/female/soul.md`、`mods/male/soul.md`
