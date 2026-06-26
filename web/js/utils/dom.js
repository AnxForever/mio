/**
 * dom.js — DOM 工具
 *
 * 极简: $ 选择器, el 创建, escapeHtml 防 XSS。
 */

export function $(selector, parent) {
  return (parent || document).querySelector(selector);
}

export function $$(selector, parent) {
  return Array.from((parent || document).querySelectorAll(selector));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') {
      node.className = val;
    } else if (key === 'textContent') {
      node.textContent = val;
    } else if (key.startsWith('on') && typeof val === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(node.style, val);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, val);
    } else if (val !== undefined && val !== null) {
      node.setAttribute(key, val);
    }
  }

  if (typeof children === 'string') {
    node.textContent = children;
  } else if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        node.appendChild(child);
      }
    }
  } else if (children instanceof Node) {
    node.appendChild(children);
  }

  return node;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function empty(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function addClass(node, ...classes) {
  node.classList.add(...classes);
}

export function removeClass(node, ...classes) {
  node.classList.remove(...classes);
}

export function toggleClass(node, cls, force) {
  node.classList.toggle(cls, force);
}
