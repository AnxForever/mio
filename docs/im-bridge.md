# IM Bridge: WeChat ClawBot/OpenClaw and QQ

Mio exposes an OpenAI-compatible chat endpoint so IM gateways can call Mio as a
custom model. The gateway owns the risky login/protocol side. Mio only receives
normalized chat requests and keeps using its own memory, emotion, persona, and
relationship pipeline.

## Current Bridge

Start Mio:

```bash
MIO_PROVIDER=minimax \
MINIMAX_API_KEY="sk-cp-..." \
MIO_AUTH_TOKEN="change-me" \
npm run build

MIO_PROVIDER=minimax \
MINIMAX_API_KEY="sk-cp-..." \
MIO_AUTH_TOKEN="change-me" \
node dist/index.js serve --port 3000
```

Configure the gateway's custom OpenAI-compatible provider:

| Field | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:3000/v1` |
| Model | `mio` |
| API key | same value as `MIO_AUTH_TOKEN` |
| Streaming | enabled if supported |

Implemented endpoints:

```text
GET  /v1/models
POST /v1/chat/completions
GET  /onebot/v11/status
POST /onebot/v11/events
```

The bridge accepts normal OpenAI chat completion requests. It extracts the last
non-empty `user` message and sends that text into `runTurn()`. Both non-streaming
and SSE streaming responses use OpenAI-compatible response envelopes.

Authentication uses the same value as `MIO_AUTH_TOKEN`:

```http
Authorization: Bearer change-me
```

When auth fails on `/v1/*`, Mio returns an OpenAI-style error body:

```json
{
  "error": {
    "message": "Invalid token",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

Session IDs are resolved in this order:

```text
x-mio-session-id
x-openai-session-id
x-openclaw-session-id
x-openclaw-user-id
x-wechat-user-id
x-onebot-user-id
metadata.sessionId / metadata.session_id
metadata.mioSessionId / metadata.mio_session_id
metadata.conversationId / metadata.conversation_id / metadata.conversation.id
metadata.threadId / metadata.thread_id / metadata.thread.id
metadata.chatId / metadata.chat_id / metadata.chat.id
metadata.senderId / metadata.sender_id / metadata.sender.id
metadata.fromUserName / metadata.from_user_name
user
openai-bridge
```

Use a stable per-contact or per-group session ID in the gateway when possible.
That is what keeps Mio's transcript and memory coherent per WeChat/QQ contact.
Mio returns the resolved value in the `X-Mio-Session-Id` response header.

For WeChat contact-like usage, run Mio in strict session mode:

```bash
MIO_OPENAI_REQUIRE_SESSION=true
```

In this mode `/v1/chat/completions` rejects requests that do not include a
stable session hint. This is intentional. Without it, stock gateways can put
all contacts into the fallback `openai-bridge` session, which makes preferences
and conversation history feel cross-wired.

Per-user persona preferences and persona overrides are stored under:

```text
data/users/<sessionId>/preferences.json
data/users/<sessionId>/persona-delta.json
```

That means a preference such as "Mio should proactively chat with me" belongs to
that contact's session only. It is not a global rule for every future user.

## Local WeChat Runtime Scripts

The local scripts in `scripts/wechat-bridge/` manage a long-running personal
WeChat bridge:

```bash
scripts/wechat-bridge/prepare-weclaw-session.sh  # build patched WeClaw
scripts/wechat-bridge/configure.mjs              # sync .env + ~/.weclaw/config.json
scripts/wechat-bridge/preflight-companion-gate.sh # run companion gates before restart
scripts/wechat-bridge/start.sh                   # start Mio + WeClaw
scripts/wechat-bridge/restart-verified.sh        # gate + stop + start + status
scripts/wechat-bridge/status.sh                  # check health/config
scripts/wechat-bridge/stop.sh                    # stop managed processes
```

`configure.mjs` generates `MIO_AUTH_TOKEN` when missing, sets
`MIO_OPENAI_REQUIRE_SESSION=true`, and writes the same token into the WeClaw
HTTP agent config as `api_key`.

Before testing a new persona/memory change through WeChat, prefer:

```bash
npm run wechat:restart:verified
```

By default this runs the companion provider matrix in `smoke` mode: compiled
persona prompt audit, quality gate, reply rubric, redteam, timestamped WeChat
replay, and reviewed regression replay. Set
`MIO_COMPANION_GATE_MODE=full` to include scenario actors, persona cases,
pairwise experiments, and mining. Set `MIO_COMPANION_PROVIDERS` and
`MIO_COMPANION_MODELS` to run real-provider gates before restart, for example:

```bash
MIO_COMPANION_PROVIDERS=mock,deepseek \
MIO_COMPANION_MODELS=deepseek:deepseek-chat \
npm run wechat:restart:verified
```

Use the patched WeClaw binary built by `prepare-weclaw-session.sh`. The patch
adds the WeChat `conversationID` to:

```text
X-Mio-Session-Id
X-OpenClaw-User-Id
user
metadata.conversation.id
```

Stock WeClaw v0.7.1 keeps `conversationID` only in its own in-process history
and does not send it to the OpenAI-compatible backend, so Mio cannot reliably
separate contacts unless this patch or an equivalent upstream fix is present.

### Proactive WeChat Messages

Mio's proactive scheduler can send through WeClaw, but it is opt-in per target
contact. Do not use one global WeClaw recipient for a multi-user account.

```bash
MIO_WECLAW_NOTIFY=true
MIO_WECLAW_API_ADDR=127.0.0.1:18011
```

For WeClaw/OpenAI bridge traffic, Mio automatically stores the raw
`@im.wechat` contact ID in that user's preferences:

```json
{
  "userId": "openai-...",
  "channels": {
    "weclaw": {
      "to": "user_id@im.wechat",
      "enabled": true
    }
  }
}
```

The proactive scheduler only sends WeClaw messages to users that both:

- have an explicit proactive preference, such as "主动找我聊天"
- have `channels.weclaw.enabled=true` and a per-user `to`

Later opt-out text such as "别再主动联系我" takes that contact out of the
eligible proactive list until they opt in again. Each contact also has its own
smart proactive cooldown/activity file, and contact-scoped proactive messages
are recorded in that contact's transcript rather than global `BOOKMARKS.md`.

Test only the WeClaw channel:

```bash
curl -X POST http://127.0.0.1:3000/notify/test/weclaw \
  -H "Authorization: Bearer $MIO_AUTH_TOKEN"
```

`MIO_WECLAW_TO` is retained only as a legacy/manual-test fallback. The proactive
scheduler does not use it when a concrete `userId` is being delivered.

For multiple users, keep per-user target mappings and preferences. Inbound chat
session isolation alone is not enough to decide who should receive unsolicited
messages.

## Client Examples

### Non-streaming request

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -H 'X-WeChat-User-Id: wx-user-123' \
  -d '{
    "model": "mio",
    "messages": [
      { "role": "user", "content": "今天有点累，陪我说两句" }
    ]
  }'
```

Response shape:

```json
{
  "id": "chatcmpl-mio-...",
  "object": "chat.completion",
  "model": "mio",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "..." },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

### Streaming request

```bash
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "mio",
    "stream": true,
    "metadata": { "conversation": { "id": "wx-room-123" } },
    "messages": [
      { "role": "user", "content": "你在吗" }
    ]
  }'
```

Streaming emits `chat.completion.chunk` SSE frames followed by:

```text
data: [DONE]
```

### OpenAI SDK-compatible usage

Any SDK/client that allows a custom `baseURL` can point at Mio:

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3000/v1',
  apiKey: process.env.MIO_AUTH_TOKEN,
});

const response = await client.chat.completions.create({
  model: 'mio',
  user: 'wx-user-123',
  messages: [{ role: 'user', content: '今晚想聊一下项目' }],
});
```

For ChatGPT-like desktop/web clients, choose a client or relay that supports a
custom OpenAI-compatible provider. Set:

```text
Base URL: http://127.0.0.1:3000/v1
Model: mio
API key: change-me
Streaming: enabled
```

The official ChatGPT web product does not directly load a local custom model
endpoint; use a compatible client or gateway when you need this bridge.

## Mio Native WeChat/iLink

Primary product path: Mio can run a native WeChat iLink channel from the admin
console. This is the OpenClaw/Hermes-style QR flow: generate a WeChat connection
QR, scan it in WeChat, Mio saves the iLink bot credentials locally, then a
background worker long-polls `getUpdates` and sends replies through
`sendMessage`.

Admin UI:

```text
http://127.0.0.1:3000/#/channels
```

Runtime API:

```text
GET  /admin/wechat-native/status
POST /admin/wechat-native/login/start
POST /admin/wechat-native/login/poll
POST /admin/wechat-native/runtime/start
POST /admin/wechat-native/runtime/stop
POST /admin/wechat-native/runtime/restart
```

State is stored under:

```text
data/wechat-native/accounts/<accountId>/
  account.json          # iLink bot token, chmod 0600 when supported
  sync.json             # getUpdates cursor
  context-tokens.json   # per-contact reply context token
```

Incoming direct messages are routed to isolated sessions:

```text
wechat-native-<account>-<contact>
```

That keeps transcripts and per-contact preferences under the normal Mio
per-session boundaries. Current native support is intentionally narrow:
private text messages and WeChat-provided voice transcription. Media upload,
media download, allowlists, quota controls, and group policy are the next
product-hardening layer.

## WeChat ClawBot/OpenClaw

Use WeChat's ClawBot/OpenClaw for bot entry and WeChat message transport, then
point its model/provider configuration at Mio. In this mode Mio is not proxying
or logging into a personal WeChat account; Mio is just the OpenAI-compatible
backend that ClawBot calls.

```text
base_url: http://127.0.0.1:3000/v1
model: mio
api_key: change-me
```

### Let other people try it

For ClawBot-based trials, do not ask testers to scan a Mio or WeClaw login QR.
Give them the ClawBot/robot entry that WeChat provides: bot QR, invite link, or
the conversation entry inside WeChat. The trial flow should be:

1. Deploy Mio somewhere reachable by ClawBot, preferably behind HTTPS:
   `https://mio.example.com/v1`.
2. Set `MIO_AUTH_TOKEN` to a strong token and use the same value as ClawBot's
   OpenAI-compatible API key.
3. Set `MIO_OPENAI_REQUIRE_SESSION=true` so requests without a stable user or
   conversation id are rejected instead of being merged into one fallback
   session.
4. Configure ClawBot's custom provider:
   `base_url=https://mio.example.com/v1`, `model=mio`, `api_key=<token>`,
   streaming on if supported.
5. Share the ClawBot bot QR/link/conversation entry with testers. They scan or
   open that WeChat bot entry and chat there.

The important gateway requirement is stable identity. ClawBot should pass one
of these on every request:

- `user`
- `metadata.conversation.id`
- `X-OpenClaw-User-Id`
- `X-WeChat-User-Id`
- `X-Mio-Session-Id`

Mio normalizes that value into an `openai-*` session. Different testers then get
separate transcripts, per-user preferences, persona deltas, and activity files
under `data/users/<sessionId>/`.

Copyable provider block:

```yaml
providers:
  mio:
    type: openai
    base_url: http://127.0.0.1:3000/v1
    api_key: change-me
    model: mio
    stream: true
    headers:
      X-OpenClaw-User-Id: "{{ user_id }}"
```

If the gateway supports group/session metadata instead of custom headers:

```json
{
  "model": "mio",
  "stream": true,
  "metadata": {
    "conversation": { "id": "{{ room_id }}" },
    "sender": { "id": "{{ user_id }}" }
  },
  "messages": [
    { "role": "user", "content": "{{ text }}" }
  ]
}
```

This keeps Mio away from direct personal-WeChat protocol code. It is safer and
easier to replace if Tencent changes the ClawBot transport.

## ChatGPT-like Clients

Use clients that support a custom OpenAI-compatible provider, such as Chatbox,
LobeChat, Open WebUI, NextChat, or a private relay. Configure:

```text
Provider: OpenAI-compatible / Custom OpenAI
Base URL: http://127.0.0.1:3000/v1
Model: mio
API key: change-me
Streaming: on
```

Browser clients running on another origin need CORS:

```bash
MIO_CORS_ORIGIN=http://localhost:3001,https://chat.example.com
```

For a public endpoint, use HTTPS and keep auth enabled:

```text
Base URL: https://mio.example.com/v1
API key: change-me
```

The official ChatGPT web app does not directly mount a local custom model
endpoint. Use a ChatGPT-like client or relay that supports custom base URLs.

## OpenAI SDK

Non-streaming:

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3000/v1',
  apiKey: process.env.MIO_AUTH_TOKEN,
});

const response = await client.chat.completions.create({
  model: 'mio',
  user: 'sdk-user-123',
  metadata: { conversation: { id: 'sdk-thread-1' } },
  messages: [
    { role: 'system', content: 'External client context.' },
    { role: 'user', content: '今天有点累，陪我说两句' },
  ],
});

console.log(response.choices[0]?.message?.content);
```

Streaming:

```ts
const stream = await client.chat.completions.create({
  model: 'mio',
  stream: true,
  user: 'sdk-user-123',
  messages: [{ role: 'user', content: '你在吗' }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

## QQ via OneBot v11

For personal QQ, the practical route is OneBot v11 through NapCatQQ or
Lagrange.OneBot:

1. NapCat/Lagrange handles QQ login and emits OneBot events.
2. Mio receives normalized private/group message events.
3. Mio calls `runTurn({ text, sessionId })`.
4. Mio sends replies back through OneBot `send_private_msg` or `send_group_msg`.

Configure the OneBot HTTP post URL:

```text
http://127.0.0.1:3000/onebot/v11/events
```

If NapCat runs in Docker bridge mode through `npm run qq:napcat:up`, use the
host address visible from the container instead:

```text
http://host.docker.internal:3000/onebot/v11/events
```

In the same Docker bridge mode, configure NapCat's HTTP server to listen on
`0.0.0.0:3001`; the script publishes it only on the host's
`127.0.0.1:3001`, so Mio still uses `MIO_ONEBOT_API_BASE=http://127.0.0.1:3001`.

If `MIO_AUTH_TOKEN` is set, configure the OneBot HTTP post client to send:

```text
Authorization: Bearer change-me
```

Mio can reply in two ways:

| Mode | Config | Behavior |
| --- | --- | --- |
| Quick reply | no `MIO_ONEBOT_API_BASE` | Returns `{ reply: "..." }` in the HTTP event response |
| API reply | set `MIO_ONEBOT_API_BASE` | Calls OneBot `send_private_msg` / `send_group_msg` |

Environment variables:

| Env | Default | Purpose |
| --- | --- | --- |
| `MIO_ONEBOT_API_BASE` | unset | OneBot HTTP API base, e.g. `http://127.0.0.1:3001` |
| `MIO_ONEBOT_ACCESS_TOKEN` | unset | Bearer token for outbound calls to the OneBot API |
| `MIO_ONEBOT_REPLY_MODE` | `api` if API base exists, else `quick` | `api`, `quick`, `both`, or `off` |
| `MIO_ONEBOT_GROUP_MODE` | `mention` | `mention`, `all`, or `off` |
| `MIO_ONEBOT_TIMEOUT_MS` | `10000` | Outbound OneBot API timeout, clamped to 500-60000 ms |
| `MIO_ONEBOT_IGNORE_SELF` | `true` | Ignore events sent by the bot's own QQ account |
| `MIO_ONEBOT_OUTBOUND_FORMAT` | `string` | Outbound message format: `string` or OneBot segment `array` |
| `MIO_ONEBOT_ALLOW_USERS` | unset | Comma-separated QQ user IDs allowed to trigger Mio; applies to private messages and group senders |
| `MIO_ONEBOT_ALLOW_GROUPS` | unset | Comma-separated QQ group IDs allowed to trigger Mio |

If `MIO_ONEBOT_REPLY_MODE` is explicitly set to `api` or `both`,
`MIO_ONEBOT_API_BASE` is required; otherwise Mio returns a configuration error
instead of silently falling back to quick replies.

Default behavior is conservative: messages sent by the bot account itself are
ignored, and group messages are ignored unless they mention the bot. Private
messages are processed unless `MIO_ONEBOT_ALLOW_USERS` is configured.

Use allowlists before testing on a real account if you do not want Mio to reply
to every private contact or group where NapCat/Lagrange is receiving events.
When both allowlists are set, group messages must pass both checks: the group ID
must be in `MIO_ONEBOT_ALLOW_GROUPS`, and the sender's QQ ID must be in
`MIO_ONEBOT_ALLOW_USERS`. Leave `MIO_ONEBOT_ALLOW_USERS` unset if you want every
member of an allowed group to be able to trigger Mio:

```bash
MIO_ONEBOT_ALLOW_USERS=12345678,87654321
MIO_ONEBOT_ALLOW_GROUPS=11223344,55667788
```

Example:

```bash
MIO_PROVIDER=minimax \
MINIMAX_API_KEY="sk-cp-..." \
MIO_AUTH_TOKEN="change-me" \
MIO_ONEBOT_API_BASE="http://127.0.0.1:3001" \
MIO_ONEBOT_ACCESS_TOKEN="napcat-token-if-set" \
node dist/index.js serve --port 3000
```

Copyable NapCat/Lagrange HTTP post settings:

```yaml
post:
  - type: http
    url: http://host.docker.internal:3000/onebot/v11/events
    headers:
      Authorization: Bearer change-me
```

Outbound API reply mode:

```bash
MIO_ONEBOT_API_BASE=http://127.0.0.1:3001
MIO_ONEBOT_ACCESS_TOKEN=napcat-token-if-set
MIO_ONEBOT_REPLY_MODE=api
MIO_ONEBOT_GROUP_MODE=mention
```

Quick reply mode:

```bash
MIO_ONEBOT_REPLY_MODE=quick
MIO_ONEBOT_GROUP_MODE=mention
```

For NapCat, prefer segment-array outbound once the API path is working:

```bash
MIO_ONEBOT_OUTBOUND_FORMAT=array
```

This lets Mio send OneBot text/image segments instead of a single raw string.
Explicit image markers in the assistant text are converted to image segments:
`![alt](https://example.com/a.png)` and `[mio:image file:///absolute/path.jpg]`.

Local protocol verification without a real QQ login:

```bash
npm run qq:verify
```

After a real NapCat instance is configured, use:

```bash
npm run qq:status
```
