/**
 * Mio — 通知渠道系统
 *
 * 支持将主动消息推送到外部通知渠道（Telegram、Webhook）。
 * 设计上允许各渠道独立配置、独立运行，单渠道失败不应阻塞其他渠道。
 */

// ─── 类型 ───

export interface NotifyChannel {
  type: 'telegram' | 'webhook' | 'whatsapp' | 'discord' | 'slack';
  enabled: boolean;
  config: Record<string, string>;
}

export interface NotifyResult {
  channel: string;
  success: boolean;
  error?: string;
}

// ============================================================
// Telegram
// ============================================================

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Send a message to a Telegram chat via the Bot API.
 *
 * Reads config from environment variables:
 *   MIO_TELEGRAM_BOT_TOKEN — bot token from @BotFather
 *   MIO_TELEGRAM_CHAT_ID   — target chat/group/channel ID
 *
 * @param text  Message text (supports HTML parse_mode).
 * @returns     NotifyResult indicating success/failure.
 */
export async function sendTelegramMessage(text: string): Promise<NotifyResult> {
  const token = process.env.MIO_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.MIO_TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      channel: 'telegram',
      success: false,
      error: 'MIO_TELEGRAM_BOT_TOKEN or MIO_TELEGRAM_CHAT_ID not configured',
    };
  }

  try {
    const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      return {
        channel: 'telegram',
        success: false,
        error: `Telegram API returned ${response.status}: ${body.slice(0, 500)}`,
      };
    }

    return { channel: 'telegram', success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { channel: 'telegram', success: false, error: msg };
  }
}

// ============================================================
// Webhook
// ============================================================

/**
 * Send a message to a configured webhook URL.
 *
 * Reads config from environment variables:
 *   MIO_WEBHOOK_URL — target webhook endpoint (optional)
 *
 * @param text  Message payload.
 * @returns     NotifyResult indicating success/failure.
 */
export async function sendWebhookMessage(text: string): Promise<NotifyResult> {
  const url = process.env.MIO_WEBHOOK_URL;

  if (!url) {
    return {
      channel: 'webhook',
      success: false,
      error: 'MIO_WEBHOOK_URL not configured',
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        source: 'mio',
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      return {
        channel: 'webhook',
        success: false,
        error: `Webhook returned ${response.status}: ${body.slice(0, 500)}`,
      };
    }

    return { channel: 'webhook', success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { channel: 'webhook', success: false, error: msg };
  }
}

// ============================================================
// WhatsApp Cloud API
// ============================================================

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Send a text message via the WhatsApp Cloud API.
 *
 * Reads config from environment variables:
 *   MIO_WHATSAPP_TOKEN     — permanent access token from Meta Developer Portal
 *   MIO_WHATSAPP_PHONE_ID  — Phone Number ID (from WhatsApp Business Account)
 *   MIO_WHATSAPP_TO        — recipient phone number (incl. country code, no +/spaces)
 *
 * @param text  Message body (plain text).
 * @returns     NotifyResult indicating success/failure.
 */
export async function sendWhatsAppMessage(text: string): Promise<NotifyResult> {
  const token = process.env.MIO_WHATSAPP_TOKEN;
  const phoneId = process.env.MIO_WHATSAPP_PHONE_ID;
  const to = process.env.MIO_WHATSAPP_TO;

  if (!token || !phoneId || !to) {
    return {
      channel: 'whatsapp',
      success: false,
      error: 'MIO_WHATSAPP_TOKEN, MIO_WHATSAPP_PHONE_ID, or MIO_WHATSAPP_TO not configured',
    };
  }

  try {
    const url = `${WHATSAPP_API_BASE}/${phoneId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      return {
        channel: 'whatsapp',
        success: false,
        error: `WhatsApp API returned ${response.status}: ${body.slice(0, 500)}`,
      };
    }

    return { channel: 'whatsapp', success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { channel: 'whatsapp', success: false, error: msg };
  }
}

// ============================================================
// Discord Bot
// ============================================================

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Send a message to a Discord text channel via the Bot API.
 *
 * Reads config from environment variables:
 *   MIO_DISCORD_TOKEN      — bot token from Discord Developer Portal
 *   MIO_DISCORD_CHANNEL_ID — target text channel ID (snowflake)
 *
 * Note: Discord messages are capped at 2000 characters. Longer messages
 * are truncated automatically with a truncation notice appended.
 *
 * @param text  Message content.
 * @returns     NotifyResult indicating success/failure.
 */
export async function sendDiscordMessage(text: string): Promise<NotifyResult> {
  const token = process.env.MIO_DISCORD_TOKEN;
  const channelId = process.env.MIO_DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    return {
      channel: 'discord',
      success: false,
      error: 'MIO_DISCORD_TOKEN or MIO_DISCORD_CHANNEL_ID not configured',
    };
  }

  try {
    // Discord 2000-char limit: truncate if needed
    const MAX_DISCORD_LENGTH = 2000;
    const truncated = text.length > MAX_DISCORD_LENGTH
      ? text.slice(0, MAX_DISCORD_LENGTH - 50) + '\n\n...(truncated, see full message elsewhere)'
      : text;

    const url = `${DISCORD_API_BASE}/channels/${channelId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({ content: truncated }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      return {
        channel: 'discord',
        success: false,
        error: `Discord API returned ${response.status}: ${body.slice(0, 500)}`,
      };
    }

    return { channel: 'discord', success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { channel: 'discord', success: false, error: msg };
  }
}

// ============================================================
// Slack Incoming Webhook
// ============================================================

/**
 * Send a message to a Slack workspace via an Incoming Webhook.
 *
 * Reads config from environment variables:
 *   MIO_SLACK_WEBHOOK_URL — full Slack webhook URL
 *                          (e.g., https://hooks.slack.com/services/T00/B00/xxxxx)
 *
 * No extra auth header is needed — the URL itself contains the credentials.
 *
 * @param text  Message content (supports Slack markdown).
 * @returns     NotifyResult indicating success/failure.
 */
export async function sendSlackMessage(text: string): Promise<NotifyResult> {
  const url = process.env.MIO_SLACK_WEBHOOK_URL;

  if (!url) {
    return {
      channel: 'slack',
      success: false,
      error: 'MIO_SLACK_WEBHOOK_URL not configured',
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      return {
        channel: 'slack',
        success: false,
        error: `Slack webhook returned ${response.status}: ${body.slice(0, 500)}`,
      };
    }

    return { channel: 'slack', success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { channel: 'slack', success: false, error: msg };
  }
}

// ============================================================
// Dispatch
// ============================================================

/**
 * Send a message to ALL configured and enabled notification channels.
 *
 * Each channel is tried independently. A failure on one channel does not
 * prevent others from being attempted. Returns a consolidated results array.
 *
 * @param text  The message to deliver.
 * @returns     Array of NotifyResult, one per attempted channel.
 */
export async function sendToAllChannels(text: string): Promise<NotifyResult[]> {
  const channels = getNotifyChannels();
  const results: NotifyResult[] = [];

  for (const channel of channels) {
    if (!channel.enabled) continue;

    let result: NotifyResult;
    switch (channel.type) {
      case 'telegram':
        result = await sendTelegramMessage(text);
        break;
      case 'webhook':
        result = await sendWebhookMessage(text);
        break;
      case 'whatsapp':
        result = await sendWhatsAppMessage(text);
        break;
      case 'discord':
        result = await sendDiscordMessage(text);
        break;
      case 'slack':
        result = await sendSlackMessage(text);
        break;
      default:
        result = { channel: channel.type, success: false, error: 'Unknown channel type' };
    }

    results.push(result);
  }

  return results;
}

// ============================================================
// Config helpers
// ============================================================

/**
 * Check whether any notification channel is configured and ready to use.
 *
 * Checks:
 *   - Telegram  (MIO_TELEGRAM_BOT_TOKEN + MIO_TELEGRAM_CHAT_ID)
 *   - Webhook   (MIO_WEBHOOK_URL)
 *   - WhatsApp  (MIO_WHATSAPP_TOKEN + MIO_WHATSAPP_PHONE_ID + MIO_WHATSAPP_TO)
 *   - Discord   (MIO_DISCORD_TOKEN + MIO_DISCORD_CHANNEL_ID)
 *   - Slack     (MIO_SLACK_WEBHOOK_URL)
 */
export function isNotifyEnabled(): boolean {
  return (
    !!(process.env.MIO_TELEGRAM_BOT_TOKEN && process.env.MIO_TELEGRAM_CHAT_ID) ||
    !!process.env.MIO_WEBHOOK_URL ||
    !!(process.env.MIO_WHATSAPP_TOKEN && process.env.MIO_WHATSAPP_PHONE_ID && process.env.MIO_WHATSAPP_TO) ||
    !!(process.env.MIO_DISCORD_TOKEN && process.env.MIO_DISCORD_CHANNEL_ID) ||
    !!process.env.MIO_SLACK_WEBHOOK_URL
  );
}

/**
 * Return a list of configured notification channels.
 *
 * Sensitive values (tokens) are never exposed in the returned config.
 */
export function getNotifyChannels(): NotifyChannel[] {
  const channels: NotifyChannel[] = [];

  // Telegram
  const hasTelegramToken = !!process.env.MIO_TELEGRAM_BOT_TOKEN;
  const hasTelegramChat = !!process.env.MIO_TELEGRAM_CHAT_ID;
  channels.push({
    type: 'telegram',
    enabled: hasTelegramToken && hasTelegramChat,
    config: {
      chatId: process.env.MIO_TELEGRAM_CHAT_ID ?? '',
      // Token is intentionally NOT exposed here — it's secret.
      tokenConfigured: hasTelegramToken ? 'true' : 'false',
    },
  });

  // Webhook
  const webhookUrl = process.env.MIO_WEBHOOK_URL;
  channels.push({
    type: 'webhook',
    enabled: !!webhookUrl,
    config: {
      // Only show the origin (protocol + hostname) for awareness, not the full URL
      // in case it contains paths with secrets. If it's just a hostname, show it.
      url: webhookUrl ? sanitizeWebhookUrl(webhookUrl) : '',
    },
  });

  // WhatsApp
  const hasWhatsAppToken = !!process.env.MIO_WHATSAPP_TOKEN;
  const hasWhatsAppPhoneId = !!process.env.MIO_WHATSAPP_PHONE_ID;
  const hasWhatsAppTo = !!process.env.MIO_WHATSAPP_TO;
  channels.push({
    type: 'whatsapp',
    enabled: hasWhatsAppToken && hasWhatsAppPhoneId && hasWhatsAppTo,
    config: {
      phoneId: process.env.MIO_WHATSAPP_PHONE_ID ?? '',
      recipient: process.env.MIO_WHATSAPP_TO ?? '',
      tokenConfigured: hasWhatsAppToken ? 'true' : 'false',
    },
  });

  // Discord
  const hasDiscordToken = !!process.env.MIO_DISCORD_TOKEN;
  const hasDiscordChannelId = !!process.env.MIO_DISCORD_CHANNEL_ID;
  channels.push({
    type: 'discord',
    enabled: hasDiscordToken && hasDiscordChannelId,
    config: {
      channelId: process.env.MIO_DISCORD_CHANNEL_ID ?? '',
      tokenConfigured: hasDiscordToken ? 'true' : 'false',
    },
  });

  // Slack
  const slackWebhookUrl = process.env.MIO_SLACK_WEBHOOK_URL;
  channels.push({
    type: 'slack',
    enabled: !!slackWebhookUrl,
    config: {
      url: slackWebhookUrl ? sanitizeWebhookUrl(slackWebhookUrl) : '',
    },
  });

  return channels;
}

/**
 * Strip sensitive path/query from a webhook URL for display purposes.
 *
 * Examples:
 *   https://hooks.slack.com/services/T00/B00/xxxx → https://hooks.slack.com/...
 *   https://example.com/webhook/secret            → https://example.com/...
 */
function sanitizeWebhookUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}/...`;
  } catch {
    return '(invalid URL)';
  }
}
