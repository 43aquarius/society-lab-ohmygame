/**
 * HUD — 顶栏 / 神力工具栏 / 事件流 / toast
 */
import { FORM_NAMES, type WorldState, type GodPowerId } from '../types';
import { GOD_POWERS } from '../powers';
import { icon } from './icons';
import { macroEconomy } from '../sim/economy';
import { formLabel, classifySociety } from '../sim/society';

export interface HudCallbacks {
  onSpeed: (s: number) => void;
  onStep: () => void;
  onPower: (id: GodPowerId | null) => void;
  onBrush: (r: number) => void;
  onChronicle: () => void;
  onObserver: () => void;
  onSave: () => void;
  onMenu: () => void;
  onHelp: () => void;
  onFormBadge: () => void;
  onPopStat: () => void;
  onFoodStat: () => void;
  onMute: () => void;
  onHome: () => void;
}

export interface HudState {
  speed: number;
  activePower: GodPowerId | null;
  brush: number;
  muted: boolean;
}

export function buildHud(root: HTMLElement, cbs: HudCallbacks, topbarHost?: HTMLElement): {
  topbar: HTMLElement; toolbar: HTMLElement; feed: HTMLElement; hint: HTMLElement;
} {
  const topbar = document.createElement('header');
  topbar.id = 'topbar';
  topbar.innerHTML = `
    <div class="world-brand" id="brand">
      <span class="name" id="brand-name">新世界</span>
      <span class="seed" id="brand-seed">seed —</span>
    </div>
    <div class="top-stat" id="stat-year" title="当前年份">${icon('clock', 16)}<b id="year-v">0</b>&nbsp;年</div>
    <div class="badge-form" id="badge-form" title="点击查看社会形态详情">原始社会</div>
    <div class="top-stat clickable" id="stat-pop" title="总人口（点击查看观察者数据）">${icon('people', 16)}<b id="pop-v">0</b></div>
    <div class="top-stat clickable" id="stat-food" title="粮食保障率">${icon('wheat', 16)}<b id="food-v">—</b></div>
    <div class="topbar-spacer"></div>
    <div class="speed-controls" id="speed-ctl">
      <button data-speed="0" title="暂停 (空格)">${icon('pause', 17)}</button>
      <button data-speed="1" class="active" title="正常速度 (1)">${icon('play', 17)}</button>
      <button data-speed="2" title="快速 (2)">${icon('ff', 15)}</button>
      <button data-speed="4" title="极速 (3)">${icon('fff', 15)}</button>
      <button id="step-btn" title="单步推进一年（暂停时可用）">${icon('step', 16)}</button>
    </div>
    <button class="icon-btn" id="btn-home" title="回到全景视角 (H)">${icon('home', 18)}</button>
    <button class="icon-btn" id="btn-chronicle" title="历史编年史 (C)">${icon('book', 18)}</button>
    <button class="icon-btn" id="btn-observer" title="观察者数据 (O)">${icon('chart', 18)}</button>
    <button class="icon-btn" id="btn-save" title="保存 / 读取 (S)">${icon('save', 18)}</button>
    <button class="icon-btn" id="btn-mute" title="声音开关">${icon('sound', 18)}</button>
    <button class="icon-btn" id="btn-help" title="帮助">${icon('help', 18)}</button>
    <button class="icon-btn" id="btn-menu" title="返回主菜单">${icon('close', 18)}</button>
  `;
  (topbarHost ?? root).appendChild(topbar);

  // 神力工具栏
  const toolbar = document.createElement('aside');
  toolbar.id = 'toolbar';
  const groups: { key: string; label: string }[] = [
    { key: 'create', label: '造 物' },
    { key: 'sky', label: '天 象' },
    { key: 'guide', label: '启 蒙' },
  ];
  let tbHtml = `
    <div class="toolbar-group">
      <h4>选 择</h4>
      <button class="power-btn" data-power="pointer">
        <span class="p-ic">${icon('pointer', 17)}</span>
        <span class="p-info"><span class="p-name">检视 / 选择</span><span class="p-cost">拖拽平移 · 滚轮缩放 · 点击查看</span></span>
      </button>
    </div>`;
  for (const g of groups) {
    tbHtml += `<div class="toolbar-group"><h4>${g.label}</h4>`;
    for (const p of GOD_POWERS.filter(x => x.group === g.key)) {
      tbHtml += `
        <button class="power-btn" data-power="${p.id}" title="${p.desc}">
          <span class="p-ic">${icon(p.icon, 17)}</span>
          <span class="p-info"><span class="p-name">${p.name}</span><span class="p-cost" data-cost="${p.id}">⚡ ${p.cost}</span></span>
        </button>`;
      if (p.group === 'create') {
        // 笔刷尺寸只在造物组后出现一次
      }
    }
    tbHtml += `</div>`;
  }
  tbHtml += `
    <div class="toolbar-group" id="brush-group">
      <div class="brush-row"><span>笔刷</span>
        <button data-brush="1" class="active">小</button>
        <button data-brush="2">中</button>
        <button data-brush="3">大</button>
      </div>
    </div>
    <div class="divine-meter" id="divine-meter" style="display:none">
      <div class="dm-label"><span>神力能量</span><span id="divine-v">100</span></div>
      <div class="dm-bar"><div class="dm-fill" id="divine-fill" style="width:100%"></div></div>
    </div>`;
  toolbar.innerHTML = tbHtml;
  root.appendChild(toolbar);

  // 事件流
  const feed = document.createElement('div');
  feed.id = 'eventfeed';
  root.appendChild(feed);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = '拖拽移动视角 · 滚轮缩放 · 空格暂停';
  root.appendChild(hint);

  // 事件绑定
  topbar.querySelector('#speed-ctl')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!btn) return;
    if (btn.id === 'step-btn') { cbs.onStep(); return; }
    const s = Number(btn.dataset.speed);
    if (!Number.isNaN(s)) cbs.onSpeed(s);
  });
  topbar.querySelector('#badge-form')!.addEventListener('click', cbs.onFormBadge);
  topbar.querySelector('#stat-pop')!.addEventListener('click', cbs.onPopStat);
  topbar.querySelector('#stat-food')!.addEventListener('click', cbs.onFoodStat);
  topbar.querySelector('#btn-home')!.addEventListener('click', cbs.onHome);
  topbar.querySelector('#btn-chronicle')!.addEventListener('click', cbs.onChronicle);
  topbar.querySelector('#btn-observer')!.addEventListener('click', cbs.onObserver);
  topbar.querySelector('#btn-save')!.addEventListener('click', cbs.onSave);
  topbar.querySelector('#btn-mute')!.addEventListener('click', cbs.onMute);
  topbar.querySelector('#btn-help')!.addEventListener('click', cbs.onHelp);
  topbar.querySelector('#btn-menu')!.addEventListener('click', cbs.onMenu);

  toolbar.addEventListener('click', e => {
    const pb = (e.target as HTMLElement).closest('.power-btn') as HTMLElement | null;
    if (pb) {
      const p = pb.dataset.power!;
      cbs.onPower(p === 'pointer' ? null : (p as GodPowerId));
      return;
    }
    const bb = (e.target as HTMLElement).closest('[data-brush]') as HTMLElement | null;
    if (bb) cbs.onBrush(Number(bb.dataset.brush));
  });

  return { topbar, toolbar, feed, hint };
}

export function setHudSpeed(topbar: HTMLElement, speed: number) {
  topbar.querySelectorAll('#speed-ctl button[data-speed]').forEach(b => {
    b.classList.toggle('active', Number((b as HTMLElement).dataset.speed) === speed);
  });
}

export function setHudPower(toolbar: HTMLElement, active: GodPowerId | null) {
  toolbar.querySelectorAll('.power-btn').forEach(b => {
    const p = (b as HTMLElement).dataset.power!;
    b.classList.toggle('active', p === 'pointer' ? active === null : p === active);
  });
  const brushGroup = toolbar.querySelector('#brush-group') as HTMLElement | null;
  if (brushGroup) {
    const def = active ? GOD_POWERS.find(x => x.id === active) : null;
    brushGroup.style.display = def?.brush ? '' : 'none';
  }
}

export function setHudBrush(toolbar: HTMLElement, brush: number) {
  toolbar.querySelectorAll('[data-brush]').forEach(b => {
    (b as HTMLElement).classList.toggle('active', Number((b as HTMLElement).dataset.brush) === brush);
  });
}

/** 每帧/每年刷新顶栏数据 */
export function updateTopbar(root: HTMLElement, w: WorldState, worldName: string) {
  const macro = macroEconomy(w);
  const cls = classifySociety(w);
  (root.querySelector('#brand-name') as HTMLElement).textContent = worldName;
  (root.querySelector('#brand-seed') as HTMLElement).textContent = `seed ${w.config.seed} · ${w.config.size}×${w.config.size} · ${w.config.mode === 'free' ? '自由上帝' : '有限干预'}`;
  (root.querySelector('#year-v') as HTMLElement).textContent = String(w.year);
  const badge = root.querySelector('#badge-form') as HTMLElement;
  const newLabel = formLabel(cls);
  if (badge.textContent !== newLabel) {
    badge.textContent = newLabel;
    badge.classList.remove('changed');
    void badge.offsetWidth; // 重启动画
    badge.classList.add('changed');
  }
  (root.querySelector('#pop-v') as HTMLElement).textContent = macro.population >= 10000
    ? `${(macro.population / 1000).toFixed(1)}k` : String(macro.population);
  const foodEl = root.querySelector('#food-v') as HTMLElement;
  const ratio = macro.foodRatio;
  foodEl.textContent = `${Math.round(ratio * 100)}%`;
  foodEl.style.color = ratio < 0.85 ? '#e88a6a' : ratio > 1.15 ? '#9fd48c' : '#f0e9d8';
  // 神力能量
  const meter = root.querySelector('#divine-meter') as HTMLElement;
  if (w.config.mode === 'limited') {
    meter.style.display = '';
    (root.querySelector('#divine-v') as HTMLElement).textContent = `${Math.floor(w.divine)}`;
    (root.querySelector('#divine-fill') as HTMLElement).style.width = `${Math.min(100, w.divine / w.divineMax * 100)}%`;
  }
  // 神力按钮可用性
  root.querySelectorAll('.p-cost[data-cost]').forEach(el => {
    const id = (el as HTMLElement).dataset.cost!;
    const def = GOD_POWERS.find(p => p.id === id)!;
    const btn = el.closest('.power-btn') as HTMLElement;
    const afford = w.config.mode === 'free' || w.divine >= def.cost;
    btn.classList.toggle('disabled', !afford);
  });
}

export function setMuteIcon(root: HTMLElement, muted: boolean) {
  const btn = root.querySelector('#btn-mute') as HTMLElement | null;
  if (btn) btn.innerHTML = icon(muted ? 'mute' : 'sound', 18);
}

export function toast(text: string, kind: 'good' | 'bad' | 'neutral' = 'neutral', icon_ = 'sparkle') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind === 'neutral' ? '' : kind}`;
  el.innerHTML = `${icon(icon_, 15)}<span>${text}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.4s, transform 0.4s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 420);
  }, 2400);
}
