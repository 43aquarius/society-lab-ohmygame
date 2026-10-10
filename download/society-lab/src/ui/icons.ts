/** 内联 SVG 图标库（手工线稿风格，24×24, stroke） */

const I = (paths: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;

export const ICONS: Record<string, string> = {
  pointer: I('<path d="M5 3l7 17 2.2-6.8L21 11z"/>'),
  forest: I('<path d="M12 3l5 8h-3l4 6H6l4-6H7z"/><path d="M12 17v4"/>'),
  fertile: I('<path d="M12 21c-4 0-6-3-6-7 0-5 4-9 6-11 2 2 6 6 6 11 0 4-2 7-6 7z"/><path d="M12 21v-6"/>'),
  water: I('<path d="M12 3c3.5 4.2 6 7.4 6 10.5a6 6 0 1 1-12 0C6 10.4 8.5 7.2 12 3z"/>'),
  ore: I('<path d="M6 11l6-7 6 7-3 9H9z"/><circle cx="12" cy="12" r="1.6"/>'),
  rain: I('<path d="M18 10a5 5 0 0 0-9.8-1.5A4 4 0 7 8 16h10a3 3 0 0 0 0-6z" transform="translate(-1 -1)"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>'),
  drought: I('<circle cx="12" cy="10" r="4"/><path d="M12 3v2M5 10H3M21 10h-2M6.3 4.3l1.4 1.4M17.7 4.3l-1.4 1.4"/><path d="M8 20c2-1 4 1 6 0s4 1 4 1" stroke-dasharray="0"/>'),
  blessing: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18 16l.9 2.6L21.5 19.5l-2.6.9L18 23l-.9-2.6-2.6-.9 2.6-.9z"/>'),
  enlighten: I('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.9.7 1.5 1.3 1.5 2.1h4c0-.8.6-1.4 1.5-2.1A6 6 0 0 0 12 3z"/>'),
  ideas: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>'),
  pause: I('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
  play: I('<path d="M7 4l13 8-13 8z"/>'),
  ff: I('<path d="M3 5l8 7-8 7zM13 5l8 7-8 7z"/>'),
  fff: I('<path d="M2 5l7 7-7 7zM9 5l7 7-7 7zM16 5l7 7-7 7z"/>'),
  step: I('<path d="M5 4l9 8-9 8z"/><path d="M18 4v16"/>'),
  home: I('<path d="M4 11l8-7 8 7"/><path d="M6 10v10h4v-6h4v6h4V10"/>'),
  book: I('<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>'),
  chart: I('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'),
  save: I('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  load: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>'),
  restart: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  alert: I('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18.2v.1"/>'),
  people: I('<circle cx="9" cy="8" r="3.5"/><path d="M3 21c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15.5 15.4c.6-.2 1.3-.4 2-.4 2.5 0 4.5 1.9 4.5 4.5"/>'),
  wheat: I('<path d="M12 22V8"/><path d="M12 8c0-3 2-5 5-5 0 3-2 5-5 5zM12 8c0-3-2-5-5-5 0 3 2 5 5 5zM12 13c0-3 2-5 5-5 0 3-2 5-5 5zM12 13c0-3-2-5-5-5 0 3 2 5 5 5zM12 18c0-3 2-5 5-5 0 3-2 5-5 5zM12 18c0-3-2-5-5-5 0 3 2 5 5 5z"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  sparkle: I('<path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15l-1.6-4.2L6 9.2l4.4-1.6z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  map: I('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  focus: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  pin: I('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  seed: I('<path d="M12 22v-6"/><path d="M12 16c-4.4 0-7-3-7-7 0-4.4 3-7 7-7 0 4.4 3 7 7 7 0 4-2.6 7-7 7z"/>'),
  flask: I('<path d="M9 3h6M10 3v6l-5.5 9a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/>'),
  branch: I('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 6H15.5M6 8.5V13a3 3 0 0 0 3 3h6.5"/>'),
  mountain: I('<path d="M3 19l6.5-12 4 7 2-3.5L21 19z"/>'),
  mute: I('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
  sound: I('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  help: I('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><path d="M12 17v.1"/>'),
  // —— v2.0 新神力 ——
  meadow: I('<path d="M3 20c2-6 5-8 9-8s7 2 9 8"/><path d="M12 12V7"/><path d="M12 7c-1.5-1.5-1.5-3 0-4.5 1.5 1.5 1.5 3 0 4.5z"/>'),
  uplift: I('<path d="M3 19l6.5-12 4 7 2-3.5L21 19z"/><path d="M12 22v-6M8 22l1-2M16 22l-1-2"/>'),
  meteor: I('<circle cx="15" cy="15" r="4.5"/><path d="M3 3l7 7M6 2l5 5M2 6l5 5"/>'),
  storm: I('<path d="M17 9a5 5 0 0 0-9.8-1.5A4 4 0 7 8 15h9a3 3 0 0 0 0-6z" transform="translate(-1 -1)"/><path d="M12 15l-2 4h3l-2 4"/>'),
  wildfire: I('<path d="M12 22c-4 0-6-3-6-6 0-4 3-6 4-9 2 2 2 3.5 1.5 5C13 11 15 12 15 15c0 4-1 7-3 7z"/><path d="M12 22c-1.8 0-3-1.4-3-3 0-2 1.4-3 2-4.5.9 1.2 2 2 2 4.5 0 1.6-.4 3-1 3z"/>'),
  pestilence: I('<circle cx="12" cy="12" r="3"/><path d="M12 3a4.5 4.5 0 0 0-4.5 4.5c-2 .5-3.5 2-3.5 4s1.5 3.5 3.5 4A4.5 4.5 0 0 0 12 21a4.5 4.5 0 0 0 4.5-5.5c2-.5 3.5-2 3.5-4s-1.5-3.5-3.5-4A4.5 4.5 0 0 0 12 3z"/><path d="M12 9v6M9 12h6"/>'),
  heal: I('<path d="M12 4v16M4 12h16"/><path d="M12 2a8 8 0 0 1 4 15 8 8 0 0 1-8 0A8 8 0 0 1 12 2z" opacity="0.4"/>'),
  found: I('<path d="M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6M3 21h18"/>'),
  'chevron-left': I('<path d="M14 6l-6 6 6 6"/>'),
  'chevron-right': I('<path d="M10 6l6 6-6 6"/>'),
};

export function icon(name: string, size = 20): string {
  const svg = ICONS[name] ?? ICONS.sparkle;
  return svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
}

/** 事件类别 → 图标与颜色 */
export const EVENT_ICON: Record<string, { icon: string; color: string }> = {
  harvest: { icon: 'wheat', color: '#c9a227' },
  famine: { icon: 'alert', color: '#b4552d' },
  plague: { icon: 'alert', color: '#8a5a9e' },
  disaster: { icon: 'mountain', color: '#8a7060' },
  invention: { icon: 'sparkle', color: '#2f7e76' },
  migration: { icon: 'map', color: '#6a8a5a' },
  trade: { icon: 'flask', color: '#a0862d' },
  wealth: { icon: 'chart', color: '#a0762d' },
  labor: { icon: 'people', color: '#7a6a4a' },
  politics: { icon: 'book', color: '#5a6a8a' },
  war: { icon: 'alert', color: '#a03a2d' },
  ideas: { icon: 'enlighten', color: '#4a7a9a' },
  institution: { icon: 'branch', color: '#2f7e76' },
  urban: { icon: 'people', color: '#5a7a5a' },
  achievement: { icon: 'sparkle', color: '#c9a227' },
};
