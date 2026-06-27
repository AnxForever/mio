# Mio QQ 接入（OneBot v11 / NapCatQQ）

Mio 已内置 **OneBot v11 接收端**（`POST /onebot/v11/events`），接 QQ 只差一个 OneBot 网关。

> 2026 调研结论：**个人自建 AI 伴侣，QQ 比微信更友好**——OneBot 协议标准化、headless 易部署、免费、封号风险相对低于微信个人号自动化。网关首选 **NapCatQQ**。

## 为什么是 NapCat（2026 现状）
- **NapCatQQ**：headless NTQQ（不注入桌面、低内存、Docker 一键 + WebUI 扫码），最活跃、社区最大、对接成本最低。**推荐**。
- go-cqhttp：已基本停更（安卓协议失效）。
- Lagrange.OneBot：纯协议逆向，但官方 SignServer 已停，需自建签名服务，登录易失败。
- LLOneBot：注入桌面版 QQ，更像真人，但要 GUI、难 headless。
- QQ 官方开放平台：无封号风险，但个人主体限制极严（**主动消息每月仅 4 条**、群能力需企业资质）→ 不适合自由对话的 AI 伴侣。

## ⚠️ 安全铁律（2025.9 大封号事件教训）
- **绝不公网裸奔 + 必设强 token**：当年大批 NapCat 实例因 OneBot 服务**空 token 暴露公网**被攻击诱导发敏感内容 → 腾讯批量封号。让 NapCat 只监听 `127.0.0.1`/内网，和 Mio 同机或同 Docker 私有网络。
- **用养了几个月的小号**，别用新号/主号（新号扫码常被秒冻结、无申诉）。
- 登录 IP 尽量与账号归属地同省（机房/海外 IP 易触发手机验证）。
- 仍是非官方协议端，封号尾部风险不可消除——别用主力号。

## 部署（NapCat Docker + Mio 同机）

1. **跑 Mio**（参考 `wechat-bridge-vps-deploy.md` 的 systemd，或 `docker compose up -d --build mio`）。
2. **跑 NapCat**（官方 NapCat-Docker），打开 WebUI(`:6099`) 用小号扫码登录。
3. **NapCat 配双向通信**（都设 token、都绑内网）：
   - **HTTP 客户端 / 上报**（NapCat → Mio）：`url: http://127.0.0.1:3000/onebot/v11/events`，`messagePostFormat: array`，`reportSelfMessage: false`。
   - **HTTP 服务器**（供 Mio 回调主动消息，Mio → NapCat）：绑 `127.0.0.1`、端口例如 `3001`、设 `token`。
4. **Mio `.env`**：
   ```bash
   MIO_ONEBOT_API_BASE=http://127.0.0.1:3001        # NapCat HTTP 服务器
   MIO_ONEBOT_ACCESS_TOKEN=<与 NapCat HTTP 服务器 token 一致>
   MIO_ONEBOT_REPLY_MODE=api                        # 要主动推送用 api；纯被动可 quick
   MIO_ONEBOT_GROUP_MODE=off                        # 1:1 伴侣；群里按需 at/all
   MIO_ONEBOT_ALLOW_USERS=<你的QQ号>                 # 白名单，强烈建议设
   ```
5. 重启 Mio，给登录的小号发 QQ 消息测试。

> **最简起步**：只配 quick reply（NapCat 只加 HTTP 客户端，Mio 在响应体返回回复，`MIO_ONEBOT_REPLY_MODE=quick`）即可跑通 1:1 对话；但**主动消息/延迟消息必须走 API 回调**（上面的方向 2）。

## QQ vs 微信 一句话
QQ（NapCat）：标准化、headless、社区大、相对稳，对个人最友好。
微信（WeClaw 扫码）：封号风险更高、协议更脆。
两者都是非官方协议端 → 都用小号。

## 来源
- NapCatQQ: https://github.com/NapNeko/NapCatQQ ｜ Docker: https://github.com/NapNeko/NapCat-Docker
- OneBot 网络配置: https://www.napcat.wiki/onebot/network ｜ 接入: https://napneko.github.io/use/integration
- 2025.9 安全事故: https://ippclub.org/ （NapCat 安全事故回顾）
- Mio 侧 OneBot 细节见 `docs/im-bridge.md` 的 “QQ via OneBot v11” 一节。
