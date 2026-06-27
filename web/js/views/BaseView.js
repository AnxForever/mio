/**
 * BaseView.js — 基础视图类
 *
 * 用于规范所有视图的生命周期（mount/unmount），
 * 自动管理事件监听器和 Store 订阅，防止内存泄漏和状态残留。
 */

export class BaseView {
  constructor(params = {}) {
    this.params = params;
    this.el = null;           // 视图根节点
    this._listeners = [];     // 绑定的 DOM 事件
    this._unsubscribes = [];  // Store 订阅解绑函数
    this._intervals = [];     // 定时器
    this._rafs = [];          // requestAnimationFrame
  }

  /**
   * 创建并返回视图 DOM 元素
   * @returns {HTMLElement}
   */
  render() {
    throw new Error('render() 必须由子类实现');
  }

  /**
   * 视图挂载后的回调
   * 在此进行 DOM 操作、订阅 Store 等
   */
  mount() {
    // 由子类实现
  }

  /**
   * 视图卸载时的回调
   * 自动清理资源，子类可重写以清理额外的（如 Canvas）资源
   */
  unmount() {
    // 1. 清理 DOM 事件
    this._listeners.forEach(({ element, type, handler, options }) => {
      element.removeEventListener(type, handler, options);
    });
    this._listeners = [];

    // 2. 清理 Store 订阅
    this._unsubscribes.forEach(unsub => unsub());
    this._unsubscribes = [];

    // 3. 清理定时器
    this._intervals.forEach(id => clearInterval(id));
    this._intervals = [];

    // 4. 清理 requestAnimationFrame
    this._rafs.forEach(id => cancelAnimationFrame(id));
    this._rafs = [];

    // 5. 移除 DOM 节点
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }

  /**
   * 注册 DOM 事件（在 unmount 时自动解绑）
   */
  on(element, type, handler, options = false) {
    if (!element) return;
    element.addEventListener(type, handler, options);
    this._listeners.push({ element, type, handler, options });
  }

  /**
   * 订阅 Store（在 unmount 时自动解绑）
   */
  subscribe(store, callback) {
    const unsub = store.subscribe(callback);
    this._unsubscribes.push(unsub);
  }

  /**
   * 注册定时器（在 unmount 时自动清除）
   */
  setInterval(callback, ms) {
    const id = setInterval(callback, ms);
    this._intervals.push(id);
    return id;
  }

  /**
   * 注册 RAF（在 unmount 时自动清除）
   */
  requestAnimationFrame(callback) {
    const id = requestAnimationFrame(callback);
    this._rafs.push(id);
    return id;
  }
}
