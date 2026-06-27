/**
 * icons.js — SVG 图标集 (24×24, stroke 1.5, rounded caps)
 */

const NS = 'http://www.w3.org/2000/svg';

function svgIcon(paths, size = 20) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.5');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');

  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    el.appendChild(p);
  }
  return el;
}

export const ICONS = {
  chat: () => svgIcon([
    'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  ]),

  studio: () => svgIcon([
    'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z',
    'M12 2c-1.5 2.5-1.5 7 0 10s3 3 5 0',
  ]),

  analytics: () => svgIcon([
    'M18 20V10',
    'M12 20V4',
    'M6 20v-6',
  ]),

  settings: () => svgIcon([
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ]),

  back: () => svgIcon([
    'M15 18l-6-6 6-6',
  ]),

  send: () => svgIcon([
    'M22 2L11 13',
    'M22 2l-7 20-4-9-9-4 20-7z',
  ]),

  mic: () => svgIcon([
    'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z',
    'M19 10v2a7 7 0 0 1-14 0v-2',
    'M12 19v4',
    'M8 23h8',
  ]),

  plus: () => svgIcon([
    'M12 5v14',
    'M5 12h14',
  ]),

  search: () => svgIcon([
    'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
    'M21 21l-4.35-4.35',
  ]),
};
