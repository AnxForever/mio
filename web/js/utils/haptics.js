/**
 * haptics.js — 触觉反馈封装
 *
 * 仅在支持时使用, 极度克制。
 * 场景: 发送按钮(10ms), 消息发送成功(20ms), 后台收到消息(模式)
 */

export function haptic(type) {
  if (!navigator.vibrate) return;

  switch (type) {
    case 'light':
      navigator.vibrate(10);
      break;
    case 'medium':
      navigator.vibrate(20);
      break;
    case 'notification':
      navigator.vibrate([10, 30, 10]);
      break;
    default:
      break;
  }
}
