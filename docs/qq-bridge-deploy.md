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

### 0. 生成 Mio 侧配置提示

```bash
npm run qq:configure
```

这个命令会：
- 写入/补齐 `.env` 中的 `MIO_AUTH_TOKEN`、`MIO_ONEBOT_API_BASE`、`MIO_ONEBOT_ACCESS_TOKEN`。
- 默认设 `MIO_ONEBOT_REPLY_MODE=api`、`MIO_ONEBOT_GROUP_MODE=off`、`MIO_ONEBOT_OUTBOUND_FORMAT=array`。
- 在 `data/runtime/qq-bridge/` 生成 NapCat WebUI 可复制的 HTTP 客户端/服务端配置提示。

默认群聊关闭，先把私聊跑通；之后再把 `MIO_ONEBOT_GROUP_MODE` 改成 `mention` 或 `all`。

1. **跑 Mio**（参考 `wechat-bridge-vps-deploy.md` 的 systemd，或 `docker compose up -d --build mio`）。
2. **跑 NapCat**（官方 NapCat-Docker），打开 WebUI(`:6099`) 用小号扫码登录。
3. **NapCat 配双向通信**（都设 token、都绑内网）：
   - **HTTP 客户端 / 上报**（NapCat → Mio）：如果用本仓库脚本启动 NapCat Docker，填 `url: http://host.docker.internal:3000/onebot/v11/events`，`messagePostFormat: array`，`reportSelfMessage: false`。
   - **HTTP 服务器**（供 Mio 回调主动消息，Mio → NapCat）：本仓库 Docker bridge 脚本下在 NapCat 内填 `0.0.0.0:3001`、设 `token`；Docker 只把宿主 `127.0.0.1:3001` 发布出来。
4. **Mio `.env`**：
   ```bash
   MIO_ONEBOT_API_BASE=http://127.0.0.1:3001        # NapCat HTTP 服务器
   MIO_ONEBOT_ACCESS_TOKEN=<与 NapCat HTTP 服务器 token 一致>
   MIO_ONEBOT_REPLY_MODE=api                        # 要主动推送用 api；纯被动可 quick
   MIO_ONEBOT_GROUP_MODE=off                        # 1:1 伴侣；群里按需 at/all
   MIO_ONEBOT_OUTBOUND_FORMAT=array                 # 用 OneBot 消息段发出，兼容图片段
   MIO_ONEBOT_ALLOW_USERS=<你的QQ号>                 # 白名单，强烈建议设
   ```
5. 重启 Mio，给登录的小号发 QQ 消息测试。

> **最简起步**：只配 quick reply（NapCat 只加 HTTP 客户端，Mio 在响应体返回回复，`MIO_ONEBOT_REPLY_MODE=quick`）即可跑通 1:1 对话；但**主动消息/延迟消息必须走 API 回调**（上面的方向 2）。

### 可选：本机 NapCat Docker 启动模板

如果本机还没有 NapCat，可以先用小号启动一个独立容器：

```bash
npm run qq:napcat:up
```

查看状态和日志：

```bash
npm run qq:napcat:status
npm run qq:napcat:logs
```

扫码登录后可自动写入 NapCat HTTP client/server 配置：

```bash
npm run qq:napcat:configure
```

停止容器但保留登录数据：

```bash
npm run qq:napcat:down
```

上述脚本会把 NapCat 配置和 QQ 登录数据保存在 `data/runtime/napcat/`。默认使用 Docker bridge + 端口映射，兼容 Docker Desktop/WSL；如果确认本机 Docker 的 `--network host` 可用，可以设置 `MIO_NAPCAT_NETWORK=host`。

等价手动命令如下：

```bash
mkdir -p data/runtime/napcat/config data/runtime/napcat/qq

docker run -d \
  --name napcat-mio \
  --restart unless-stopped \
  -p 127.0.0.1:6099:6099 \
  -p 127.0.0.1:3001:3001 \
  --add-host=host.docker.internal:host-gateway \
  -e NAPCAT_UID="$(id -u)" \
  -e NAPCAT_GID="$(id -g)" \
  -e TZ=Asia/Shanghai \
  -v "$PWD/data/runtime/napcat/config:/app/napcat/config" \
  -v "$PWD/data/runtime/napcat/qq:/app/.config/QQ" \
  mlikiowa/napcat-docker:latest
```

然后打开：

```text
http://127.0.0.1:6099
```

在 NapCat WebUI 里扫码登录小号，再配置 HTTP 客户端和 HTTP 服务器。

这种端口映射模式下，NapCat HTTP 客户端上报 Mio 的 URL 不要填 `127.0.0.1:3000`，要填：

```text
http://host.docker.internal:3000/onebot/v11/events
```

NapCat HTTP 服务器的监听地址填 `0.0.0.0:3001`；Mio `.env` 里的 `MIO_ONEBOT_API_BASE` 仍然填 `http://127.0.0.1:3001`。

如果你的 Docker 支持并且你想使用 `--network host`，可以改用：

```bash
docker run -d \
  --name napcat-mio \
  --restart unless-stopped \
  --network host \
  -e NAPCAT_UID="$(id -u)" \
  -e NAPCAT_GID="$(id -g)" \
  -e TZ=Asia/Shanghai \
  -v "$PWD/data/runtime/napcat/config:/app/napcat/config" \
  -v "$PWD/data/runtime/napcat/qq:/app/.config/QQ" \
  mlikiowa/napcat-docker:latest
```

host network 模式下，NapCat HTTP 客户端上报 Mio 的 URL 才填：

```text
http://127.0.0.1:3000/onebot/v11/events
```

## 连通性检查

先跑 Mio 侧协议级本机验证：

```bash
npm run qq:verify
```

这个命令会临时启动一个 fake OneBot API 和隔离 Mio 实例，验证：
- Mio `/health`
- Mio `/onebot/v11/status`
- OneBot `/get_status`
- QQ 私聊事件 → Mio → `send_private_msg`
- `MIO_ONEBOT_OUTBOUND_FORMAT=array`
- 图片标记 → OneBot `image` segment

它不需要真实 QQ 登录，适合每次改代码后确认 Mio 侧桥接逻辑没坏。

真实 NapCat 扫码登录并配置 WebUI 后，再跑：

```bash
npm run qq:status
```

它会检查：
- Mio `/health`
- Mio `/onebot/v11/status`
- NapCat OneBot API `/get_status`

如果 NapCat 没开 HTTP 服务器，前两项仍可通过，第三项会失败；这说明只能用 quick reply，不能主动发消息。

## 图片/消息段

Mio 默认文本回复保持兼容；设置：

```bash
MIO_ONEBOT_OUTBOUND_FORMAT=array
```

后，Mio 会用 OneBot 消息段向 NapCat 发送。普通文本会变成：

```json
[{ "type": "text", "data": { "text": "..." } }]
```

并支持显式图片标记转换为 image segment：

```text
![图](https://example.com/a.png)
[mio:image file:///absolute/path/to/a.jpg]
```

注意：这只是打通 QQ/OneBot 图片段通路。是否让 Mio 在对话里主动发图，还需要上层策略控制，避免频繁发图破坏陪伴感。

## QQ vs 微信 一句话
QQ（NapCat）：标准化、headless、社区大、相对稳，对个人最友好。
微信（WeClaw 扫码）：封号风险更高、协议更脆。
两者都是非官方协议端 → 都用小号。

## 来源
- NapCatQQ: https://github.com/NapNeko/NapCatQQ ｜ Docker: https://github.com/NapNeko/NapCat-Docker
- OneBot 网络配置: https://www.napcat.wiki/onebot/network ｜ 接入: https://napneko.github.io/use/integration
- 2025.9 安全事故: https://ippclub.org/ （NapCat 安全事故回顾）
- Mio 侧 OneBot 细节见 `docs/im-bridge.md` 的 “QQ via OneBot v11” 一节。
