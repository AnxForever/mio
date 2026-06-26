/**
 * time.js — 时间格式化
 */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export function fmtTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function fmtDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);

  if (diff < DAY) return '今天';
  if (diff < DAY * 2) return '昨天';
  if (diff < DAY * 7) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[d.getDay()];
  }

  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');

  if (y === now.getFullYear()) return `${m}月${day}日`;
  return `${y}年${m}月${day}日`;
}

/**
 * 判断两条消息之间是否需要日期分隔。
 * 规则: 每天第一条消息前 + 间隔超过 30 分钟的消息前显示时间。
 */
export function shouldShowDateSep(prev, curr) {
  if (!prev) return true;
  const pd = prev instanceof Date ? prev : new Date(prev);
  const cd = curr instanceof Date ? curr : new Date(curr);
  return pd.toDateString() !== cd.toDateString();
}

export function shouldShowTime(prev, curr) {
  if (!prev) return true;
  const pd = new Date(prev).getTime();
  const cd = new Date(curr).getTime();
  return (cd - pd) > 30 * MINUTE * 1000;
}
