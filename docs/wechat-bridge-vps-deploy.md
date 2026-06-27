# Mio 微信桥 · VPS 24/7 部署

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
