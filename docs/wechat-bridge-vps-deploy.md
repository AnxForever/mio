# Mio 微信桥 · VPS 24/7 部署

> 适用范围：这份文档是“自建 WeClaw/本地桥接进程”的部署方式，会涉及微信登录态。
> 如果使用微信自带的 ClawBot/OpenClaw 作为机器人入口，不走这里的扫码登录流程；
> 请看 [IM Bridge: WeChat ClawBot/OpenClaw and QQ](./im-bridge.md) 的 ClawBot 章节。

把 Mio 后端 + WeClaw（微信扫码接入，与 OpenClaw/Hermes/zcode 同一套机制）常驻在一台
Linux VPS 上，本地电脑关机/断网都不影响。

## 0. 前提
- Linux VPS（2 核 2G 起，Ubuntu/Debian 最省事）
- 一个 LLM provider key（如 `MINIMAX_API_KEY`）
- 用于接入的微信号（测试期建议用小号——这是这类扫码接入的圈子惯例，非 Mio 限制）

## 1. 装依赖
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y git build-essential curl
# Node ≥ 22（用 nodesource 或 nvm）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
# Go（编译 patched WeClaw 用）
sudo apt install -y golang-go   # 或装官方新版 go
node -v && go version && git --version
```

## 2. 拉项目 + 配 .env
```bash
sudo mkdir -p /opt/mio && sudo chown -R "$USER":"$USER" /opt/mio
git clone <你的 Mio 仓库> /opt/mio && cd /opt/mio
cp .env.example .env
# 编辑 .env：
#   MIO_PROVIDER=minimax
#   MINIMAX_API_KEY=sk-cp-...
#   MIO_HTTP_PORT=3000
#   （MIO_AUTH_TOKEN 会被 configure 自动生成）
npm ci
```

## 3. 首次跑通 + 扫码登录
```bash
bash scripts/wechat-bridge/start.sh           # 自动 build WeClaw + 起 Mio + WeClaw
tail -f data/runtime/wechat-bridge/weclaw.log # 手机扫这里出现的二维码登录
bash scripts/wechat-bridge/status.sh          # 健康检查
```
登录后，从另一个微信给登录号发消息，Mio 即以人格回复。
登录态保存在 `~/.weclaw/`，之后自动恢复。

上线前想确认微信里测到的是最新行为，用带伴侣门禁的重启：

```bash
npm run wechat:restart:verified
```

默认 `MIO_COMPANION_GATE_MODE=smoke`，会先跑 compiled persona prompt audit、quality gate、reply rubric、redteam、时间戳微信回放和已审核回归库，通过后才 stop/start。需要完整离线聊天测试时：

```bash
MIO_COMPANION_GATE_MODE=full npm run wechat:restart:verified
```

需要多模型/真实 provider 门禁时：

```bash
MIO_COMPANION_PROVIDERS=mock,deepseek \
MIO_COMPANION_MODELS=deepseek:deepseek-chat \
npm run wechat:restart:verified
```

### 多人试用与用户隔离
如果你用的是微信 ClawBot/OpenClaw，请不要按本节理解扫码流程。ClawBot 模式下，
Mio 只是一个 OpenAI-compatible 后端；别人扫的是 ClawBot/机器人入口，由 ClawBot
把消息转给 Mio。

无论是 ClawBot/OpenClaw 还是自建 WeClaw，只要网关传入稳定的 per-contact session
hint（例如 `user`、`metadata.conversation.id`、`X-OpenClaw-User-Id` 或
`X-WeChat-User-Id`），Mio 都会按 `openai-*` session 做隔离：

| 内容 | 多联系人隔离状态 |
| --- | --- |
| 对话记录 | `data/transcripts/<sessionId>.jsonl`，按联系人分开 |
| 显式偏好/称呼/人格微调 | `data/users/<sessionId>/`，按联系人分开 |
| 可用工具 | 外部 IM 只暴露 `current_time`，不能读文件、全局记忆或其他 transcript |
| 全局 memory-bank / 用户资料 / 共同回忆 | 外部 IM prompt 不读取，普通聊天也不写入 |
| 情绪/关系进展 | 外部 IM 使用中性默认上下文，不继承本地主人或其他联系人的全局状态 |
| 活跃时间模型 | 外部 IM 只写 `data/users/<sessionId>/user-activity.json`，不混入全局聚合 |

## 4. 开机自启（systemd，VPS 重启自恢复）
首次跑通后，用 systemd 托管，保证崩溃/重启自动拉起。把 `<USER>` 换成你的用户名。

`/etc/systemd/system/mio.service`：
```ini
[Unit]
Description=Mio backend (OpenAI-compatible API)
After=network-online.target
Wants=network-online.target
[Service]
User=<USER>
WorkingDirectory=/opt/mio
EnvironmentFile=/opt/mio/.env
ExecStart=/usr/bin/node dist/index.js serve --host 127.0.0.1 --port 3000
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/weclaw.service`：
```ini
[Unit]
Description=WeClaw WeChat bridge
After=mio.service
Requires=mio.service
[Service]
User=<USER>
Environment=HOME=/home/<USER>
Environment=NO_PROXY=127.0.0.1,localhost
ExecStart=/home/<USER>/.local/bin/weclaw-mio-session start --foreground --api-addr 127.0.0.1:18011
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

启用：
```bash
cd /opt/mio && npm run build      # 确保 dist/ 是最新
sudo systemctl daemon-reload
sudo systemctl enable --now mio weclaw
systemctl status mio weclaw
journalctl -u weclaw -f           # 首次/重扫时在这里看二维码
```

## 5. 备份与记录（聊完做优化体检用）
- 全部状态都在 `/opt/mio/data/`：
  - `data/transcripts/<sessionId>.jsonl` — 每个联系人的完整对话
  - `data/users/<sessionId>/` — per-user 偏好 / 人格覆盖
  - `data/memory-bank/` — 记忆、关系、人格演化
  - `data/cardboard-state.json` — 纸板感（质量）监控
- 定期备份 `data/`（cron + tar）。要做体检时，把 `data/transcripts` + `data/memory-bank` 拉回本地给我分析。

## 6. 真实注意（稳定性，非封号）
扫码登录态会**偶尔掉线**（微信侧过期/被踢）——这是所有扫码接入的通病（OpenClaw/Hermes 也一样）。
systemd 会自动重启进程，但**重新扫码要手动**：`journalctl -u weclaw -f` 看到新二维码时重扫即可。

## 7. 可选 · 让她主动找你
`.env` 加：
```bash
MIO_WECLAW_NOTIFY=true
MIO_WECLAW_API_ADDR=127.0.0.1:18011
```
然后在微信对她说「主动找我聊天」→ 她按 Poisson + 智能门控偶尔主动发（per-contact opt-in；「别再主动联系我」可关）。

## 8. 掉线邮件告警（cron）
`scripts/wechat-bridge/health-alert.sh` 定时探活 Mio + WeClaw，掉线发一封、恢复再发一封（只在状态切换时发，不刷屏）。

`.env` 配 SMTP（QQ 邮箱示例，密码用「授权码」不是登录密码）：
```bash
ALERT_SMTP_URL=smtps://smtp.qq.com:465
ALERT_SMTP_USER=you@qq.com
ALERT_SMTP_PASS=你的授权码
ALERT_MAIL_FROM=you@qq.com
ALERT_MAIL_TO=you@qq.com
# 可选：进程活着但微信登录态失效时的兜底——按 weclaw.log 掉线时实际打印的词来填
ALERT_LOG_PATTERN=offline|logout|expired|重新登录|扫码|relogin
```
（Gmail 用 `smtps://smtp.gmail.com:465` + 应用专用密码。）

加 cron，每 5 分钟探一次：
```bash
crontab -e
# 加一行：
*/5 * * * * cd /opt/mio && /usr/bin/bash scripts/wechat-bridge/health-alert.sh >> data/runtime/wechat-bridge/alert.log 2>&1
```
⚠️ `/health` 主要反映「进程活没活」；微信登录态失效（进程还在）测不准，要靠 `ALERT_LOG_PATTERN` 命中日志关键词兜底——先观察 `weclaw.log` 掉线时实际输出什么，再把词填进去。
