#!/usr/bin/env bash
# Mio 微信桥掉线 → 邮件告警。建议 cron 每 5 分钟跑一次。
#
# 在 .env 里配置（QQ 邮箱示例，密码用「授权码」不是登录密码）：
#   ALERT_SMTP_URL=smtps://smtp.qq.com:465
#   ALERT_SMTP_USER=you@qq.com
#   ALERT_SMTP_PASS=your_smtp_authcode
#   ALERT_MAIL_FROM=you@qq.com
#   ALERT_MAIL_TO=you@qq.com
#   # 可选：按 WeClaw 实际掉线日志调这个正则（命中则视为掉线信号）
#   ALERT_LOG_PATTERN=offline|logout|expired|重新登录|扫码|relogin
#
# Gmail 用：ALERT_SMTP_URL=smtps://smtp.gmail.com:465 + 应用专用密码。
#
# 只在「正常→掉线」和「掉线→恢复」的状态切换时发信，不会每 5 分钟狂发。
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# 载入 .env（复用 read-env.mjs 解析）
if [ -f "$ROOT_DIR/.env" ] && command -v node >/dev/null 2>&1; then
  while IFS='=' read -r k v; do
    [ -n "$k" ] && export "$k=$v"
  done < <(node scripts/wechat-bridge/read-env.mjs "$ROOT_DIR/.env" 2>/dev/null)
fi

MIO_HTTP_PORT="${MIO_HTTP_PORT:-3000}"
MIO_WECLAW_API_ADDR="${MIO_WECLAW_API_ADDR:-127.0.0.1:18011}"
RUNTIME_DIR="$ROOT_DIR/data/runtime/wechat-bridge"
STATE_FILE="$RUNTIME_DIR/alert.state"
WECLAW_LOG="$RUNTIME_DIR/weclaw.log"
mkdir -p "$RUNTIME_DIR"

problems=()
curl -fsS --max-time 10 "http://127.0.0.1:${MIO_HTTP_PORT}/health" >/dev/null 2>&1 \
  || problems+=("Mio /health 不可达（127.0.0.1:${MIO_HTTP_PORT}）")
curl -fsS --max-time 10 "http://${MIO_WECLAW_API_ADDR}/health" >/dev/null 2>&1 \
  || problems+=("WeClaw /health 不可达（${MIO_WECLAW_API_ADDR}）")

# 可选：进程活着但微信登录态失效时，靠日志关键词兜底（按 WeClaw 实际输出调 ALERT_LOG_PATTERN）
if [ -n "${ALERT_LOG_PATTERN:-}" ] && [ -f "$WECLAW_LOG" ]; then
  if tail -n 80 "$WECLAW_LOG" | grep -qiE "${ALERT_LOG_PATTERN}"; then
    problems+=("WeClaw 日志疑似掉线/需重新登录（命中 '${ALERT_LOG_PATTERN}'）")
  fi
fi

send_mail() {
  local subject="$1" body="$2"
  if [ -z "${ALERT_SMTP_URL:-}" ] || [ -z "${ALERT_MAIL_TO:-}" ] || [ -z "${ALERT_SMTP_USER:-}" ]; then
    echo "[health-alert] SMTP 未配置（ALERT_SMTP_URL/USER/MAIL_TO），跳过发信"
    return 1
  fi
  local from="${ALERT_MAIL_FROM:-$ALERT_SMTP_USER}"
  local tmp; tmp="$(mktemp)"
  {
    printf 'From: Mio Bridge <%s>\r\n' "$from"
    printf 'To: %s\r\n' "$ALERT_MAIL_TO"
    printf 'Subject: %s\r\n' "$subject"
    printf 'Content-Type: text/plain; charset=UTF-8\r\n'
    printf '\r\n'
    printf '%s\r\n' "$body"
  } > "$tmp"
  curl -s --max-time 30 --url "$ALERT_SMTP_URL" --ssl-reqd \
    --mail-from "$from" --mail-rcpt "$ALERT_MAIL_TO" \
    --user "${ALERT_SMTP_USER}:${ALERT_SMTP_PASS:-}" \
    --upload-file "$tmp"
  local rc=$?
  rm -f "$tmp"
  return $rc
}

prev="$(cat "$STATE_FILE" 2>/dev/null || echo ok)"
now_ts="$(date '+%F %T')"

if [ "${#problems[@]}" -gt 0 ]; then
  detail="$(printf '%s\n' "${problems[@]}")"
  if [ "$prev" != "down" ]; then
    send_mail "[Mio] 微信桥掉线告警" "检测到问题：
${detail}

处理：SSH 到服务器查看日志并重新扫码登录：
  journalctl -u weclaw -f      # 或 tail -f ${WECLAW_LOG}

时间：${now_ts}" && echo "down" > "$STATE_FILE"
    echo "[health-alert] ALERT sent at ${now_ts}: ${detail}"
  else
    echo "[health-alert] still down at ${now_ts}（已发过告警，不重复）"
  fi
else
  if [ "$prev" = "down" ]; then
    send_mail "[Mio] 微信桥已恢复" "服务已恢复正常。时间：${now_ts}"
    echo "[health-alert] RECOVERED at ${now_ts}"
  else
    echo "[health-alert] ok at ${now_ts}"
  fi
  echo ok > "$STATE_FILE"
fi
