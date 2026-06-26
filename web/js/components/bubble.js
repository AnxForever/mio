/**
 * bubble.js — 聊天气泡组件
 *
 * 处理单条消息的渲染: 气泡、时间戳、日期分隔。
 * 遵循 iMessage 连续消息规则: 同一方连续发送时圆角收窄, 间距缩短。
 */

import { el } from '../utils/dom.js';
import { fmtTime, fmtDate } from '../utils/time.js';

const MINUTE = 60;
const TIME_GAP_MS = 30 * MINUTE * 1000;

/**
 * 渲染一组消息到容器。
 * 处理日期分隔、连续消息圆角、时间戳显示规则。
 */
export function renderMessages(container, messages) {
  /* 清空, 但保留 typing 和 welcome */
  const typing = container.querySelector('.typing');
  const welcome = container.querySelector('.welcome');
  container.innerHTML = '';
  if (welcome) container.appendChild(welcome);

  let prevMsg = null;

  for (const msg of messages) {
    /* 日期分隔 */
    if (shouldShowDateSep(prevMsg, msg)) {
      container.appendChild(dateSep(msg.timestamp));
    }

    container.appendChild(bubble(msg, prevMsg));
    prevMsg = msg;
  }

  if (typing) container.appendChild(typing);

  /* 滚动到底部 */
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

/**
 * 追加单条消息 (用于用户刚发送的消息)
 */
export function appendMessage(container, msg, prevMsg) {
  const welcome = container.querySelector('.welcome');
  if (welcome) welcome.remove();

  if (shouldShowDateSep(prevMsg, msg)) {
    container.appendChild(dateSep(msg.timestamp));
  }

  container.appendChild(bubble(msg, prevMsg));

  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

/**
 * 创建单条消息气泡的 DOM
 */
function bubble(msg, prevMsg) {
  const isUser = msg.role === 'user';
  const isContinuous = prevMsg && prevMsg.role === msg.role;

  const div = el('div', {
    className: `msg ${isUser ? 'user' : 'mio'}${msg.isError ? ' error' : ''}${isContinuous ? ' continuous' : ''}`,
  });

  const bubbleEl = el('div', { className: 'msg-bubble', textContent: msg.text });

  div.appendChild(bubbleEl);

  /* 时间戳 — 仅当日第一条或间隔 > 30 分钟时显示 */
  const showTime = !prevMsg || shouldShowTime(prevMsg, msg);
  if (showTime) {
    const time = el('div', { className: 'msg-time', textContent: fmtTime(msg.timestamp) });
    div.appendChild(time);
  }

  return div;
}

function dateSep(timestamp) {
  return el('div', { className: 'date-sep' }, [
    el('span', { textContent: fmtDate(timestamp) }),
  ]);
}

function shouldShowDateSep(prev, curr) {
  if (!prev) return true;
  return new Date(prev.timestamp).toDateString() !== new Date(curr.timestamp).toDateString();
}

function shouldShowTime(prev, curr) {
  if (!prev) return true;
  return new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime() > TIME_GAP_MS;
}

/**
 * 创建打字指示器
 */
export function createTypingIndicator() {
  const typing = el('div', { className: 'typing' });
  for (let i = 0; i < 3; i++) {
    typing.appendChild(el('div', { className: 'typing-dot' }));
  }
  return typing;
}
