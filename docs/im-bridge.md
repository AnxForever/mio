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

## WeChat ClawBot/OpenClaw

Use OpenClaw/ClawBot for QR login and WeChat message transport, then point its
model/provider configuration at Mio:

```text
base_url: http://127.0.0.1:3000/v1
model: mio
api_key: change-me
```

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
    url: http://127.0.0.1:3000/onebot/v11/events
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
