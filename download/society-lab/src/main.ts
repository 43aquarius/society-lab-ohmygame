/**
 * Society Lab《人类社会实验室》— 主入口
 * 菜单 ↔ 游戏状态机、输入（平移/缩放/神力笔刷）、时间循环、
 * OhMyGame 玩法测试桥（__OHMYGAME_PLAYTEST__）。
 */
import './style.css';
import { CFG } from './config';
import { Rng, type WorldState, type GodPowerId, type Settlement } from './types';
import { newWorld, tickYear } from './sim/manager';
import { macroEconomy } from './sim/economy';
import { castBrushPower, castCivPower, castPurify, powerChronicleEntry, GOD_POWERS, canAfford } from './powers';
import { classifySociety, formLabel } from './sim/society';
import { VisualWorld } from './render/world';
import { gridToScreen } from './render/iso';
import { AudioManager } from './audio';
import { icon } from './ui/icons';
import {
  buildHud, setHudSpeed, setHudPower, setHudBrush, updateTopbar, setMuteIcon, toast,
  type HudCallbacks,
} from './ui/hud';
import {
  openChronicle, openObserver, openSaveMenu, openHelp, openFormCard, openEventCard,
  showSettlementPanel, hideSettlementPanel, updateEventFeed, isModalOpen,
} from './ui/panels';
import { WORLD_TITLES } from './names';
import { autosave, loadAutosave, serialize as serializeSave, deserialize as deserializeSave } from './saves';

class Game {
  app = document.getElementById('app')!;
  world: WorldState | null = null;
  worldName = '新世界';
  vw: VisualWorld | null = null;
  audio = new AudioManager();
  speed = 1;
  yearAccum = 0;
  activePower: GodPowerId | null = null;
  brush = 1;
  lastFeedYear = 0;
  lastForm: string = 'primitive';
  private raf = 0;
  private lastTime = 0;
  private els: Record<string, HTMLElement> = {};
  private menuCanvas: HTMLCanvasElement | null = null;
  private menuWorld: WorldState | null = null;
  private menuVw: VisualWorld | null = null;

  constructor() {
    this.buildShell();
    this.showMenu();
    requestAnimationFrame(t => this.frame(t));
  }

  private buildShell() {
    this.app.innerHTML = `
      <div id="menu">
        <canvas id="menu-canvas"></canvas>
        <div class="menu-inner">
          <div class="game-title">
            <span class="sub">SOCIETY LAB</span>
            <h1>人类社会<em>实验室</em></h1>
            <span class="tagline">创造一个世界，看文明生长、分化与变革——<br>在关键的时刻，以神力改写历史的走向。</span>
          </div>
          <div class="menu-card" id="menu-new">
            <h3><span class="ic">${icon('seed', 16)}</span> 创造新世界</h3>
            <div class="form-row">
              <div class="form-item">
                <label>世界种子（相同种子 → 相同世界）</label>
                <div style="display:flex;gap:6px">
                  <input type="number" id="new-seed" value="${Math.floor(Math.random() * 100000)}">
                  <button class="btn small" id="seed-dice" title="随机">${icon('sparkle', 14)}</button>
                </div>
              </div>
              <div class="form-item">
                <label>地图规模</label>
                <select id="new-size">
                  <option value="40">紧凑 40×40</option>
                  <option value="48" selected>标准 48×48</option>
                  <option value="56">宽广 56×56</option>
                </select>
              </div>
              <div class="form-item">
                <label>初始聚落数</label>
                <select id="new-settlements">
                  <option value="1" selected>1 处（推荐）</option>
                  <option value="2">2 处</option>
                  <option value="3">3 处</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-item">
                <label>初始情景</label>
                <div class="scenario-pick">
                  <button data-sc="dawn" class="active">洪荒初民<br><span style="font-size:11px;color:var(--ink-soft)">采集部落，白手起家</span></button>
                  <button data-sc="valley">河谷黎明<br><span style="font-size:11px;color:var(--ink-soft)">已掌握基础农耕</span></button>
                </div>
              </div>
              <div class="form-item">
                <label>神力模式</label>
                <div class="mode-pick">
                  <button data-mode="free" class="active">
                    <span>自由上帝</span><span class="desc">神力无限，专注创造与观察</span>
                  </button>
                  <button data-mode="limited">
                    <span>有限干预</span><span class="desc">神力能量有限，需权衡时机</span>
                  </button>
                </div>
              </div>
            </div>
            <div class="menu-actions">
              <button class="btn primary" id="btn-create">${icon('seed', 16)} 创世</button>
            </div>
          </div>
          <div class="menu-actions">
            <button class="btn ghost" id="btn-continue" style="display:none">${icon('load', 16)} 继续上次的世界</button>
            <button class="btn ghost" id="btn-menu-help">${icon('help', 16)} 玩法说明</button>
          </div>
          <div class="menu-foot">
            Society Lab · OhMyGame web-game 工程 · TypeScript + Canvas 2D<br>
            社会演化沙盒 · 所有数据由模拟内核实时生成
          </div>
        </div>
      </div>
      <div id="game" class="hidden">
        <div id="main-area">
          <canvas id="world-canvas"></canvas>
        </div>
      </div>
      <div id="modal-root"></div>
      <div id="toasts"></div>`;
  }

  // ---------- 菜单 ----------

  showMenu() {
    this.speed = 0;
    (document.getElementById('game') as HTMLElement).classList.add('hidden');
    (document.getElementById('menu') as HTMLElement).style.display = '';
    const cont = document.getElementById('btn-continue') as HTMLElement;
    const auto = loadAutosave();
    cont.style.display = auto && 'world' in auto ? '' : 'none';
    this.bindMenu();
    this.startMenuBackdrop();
  }

  private menuBound = false;
  private bindMenu() {
    if (this.menuBound) return;
    this.menuBound = true;
    const menu = document.getElementById('menu')!;
    menu.querySelectorAll('.mode-pick button').forEach(b => b.addEventListener('click', () => {
      menu.querySelectorAll('.mode-pick button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
    menu.querySelectorAll('.scenario-pick button').forEach(b => b.addEventListener('click', () => {
      menu.querySelectorAll('.scenario-pick button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    }));
    menu.querySelector('#seed-dice')!.addEventListener('click', () => {
      (menu.querySelector('#new-seed') as HTMLInputElement).value = String(Math.floor(Math.random() * 100000));
    });
    menu.querySelector('#btn-create')!.addEventListener('click', () => this.createFromMenu());
    menu.querySelector('#btn-continue')!.addEventListener('click', () => {
      const auto = loadAutosave();
      if (auto && 'world' in auto) this.startWorld(auto.world, auto.worldName);
    });
    menu.querySelector('#btn-menu-help')!.addEventListener('click', () => openHelp());
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !this.world && (document.getElementById('menu') as HTMLElement).style.display !== 'none') {
        this.createFromMenu();
      }
    });
  }

  private createFromMenu() {
    this.audio.ensure();
    const menu = document.getElementById('menu')!;
    const seed = Math.abs(Math.floor(Number((menu.querySelector('#new-seed') as HTMLInputElement).value) || 1)) || 1;
    const size = Number((menu.querySelector('#new-size') as HTMLSelectElement).value);
    const settlements = Number((menu.querySelector('#new-settlements') as HTMLSelectElement).value);
    const mode = (menu.querySelector('.mode-pick button.active') as HTMLElement).dataset.mode as 'free' | 'limited';
    const scenario = (menu.querySelector('.scenario-pick button.active') as HTMLElement).dataset.sc as 'dawn' | 'valley';
    const w = newWorld({ seed, size, mode, settlements, scenario });
    const rng = new Rng(seed ^ 0x77);
    this.startWorld(w, `${WORLD_TITLES[rng.int(WORLD_TITLES.length)]} · ${seed}`);
  }

  private startMenuBackdrop() {
    if (this.menuWorld) return;
    const canvas = document.getElementById('menu-canvas') as HTMLCanvasElement;
    this.menuCanvas = canvas;
    this.menuWorld = newWorld({ seed: 4242, size: 48, mode: 'free', settlements: 2, scenario: 'valley' });
    // 预跑几十年让世界有内容
    for (let i = 0; i < 60; i++) tickYear(this.menuWorld);
    this.menuVw = new VisualWorld(canvas);
    this.menuVw.camera.zoom = 0.62;
    this.menuVw.camera.targetZoom = 0.66;
    this.menuVw.centerOnMap(48);
  }

  // ---------- 游戏世界 ----------

  startWorld(w: WorldState, name: string) {
    this.world = w;
    this.worldName = name;
    this.speed = 1;
    this.activePower = null;
    this.lastFeedYear = -1;
    this.lastForm = w.civ.form;
    (document.getElementById('menu') as HTMLElement).style.display = 'none';
    const gameEl = document.getElementById('game') as HTMLElement;
    gameEl.classList.remove('hidden');

    // 构建游戏 HUD（首次或重建）
    const existingHud = document.getElementById('topbar');
    if (existingHud) existingHud.remove();
    const existingTb = document.getElementById('toolbar');
    if (existingTb) existingTb.remove();
    const existingFeed = document.getElementById('eventfeed');
    if (existingFeed) existingFeed.remove();
    const existingHint = document.getElementById('hint');
    if (existingHint) existingHint.remove();
    const existingSide = document.getElementById('sidepanel');
    if (existingSide) existingSide.remove();

    const mainArea = document.getElementById('main-area') as HTMLElement;
    const hud = buildHud(mainArea, this.hudCallbacks(), gameEl);
    this.els.topbar = hud.topbar;
    this.els.toolbar = hud.toolbar;
    this.els.feed = hud.feed;
    this.els.hint = hud.hint;

    const side = document.createElement('aside');
    side.id = 'sidepanel';
    side.classList.add('hidden');
    mainArea.appendChild(side);
    this.els.sidepanel = side;

    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    this.vw = new VisualWorld(canvas);
    this.vw.minimap = document.createElement('canvas');
    this.vw.minimap.width = this.vw.minimap.height = w.config.size;
    this.vw.centerOnMap(w.config.size);
    this.bindCanvasInput(canvas);
    this.bindKeys();
    this.audio.ensure();
    setHudSpeed(hud.topbar, 1);
    setHudPower(hud.toolbar, null);
    updateTopbar(gameEl, w, name);
    this.showHint('选择左侧神力，点击地图施放 · 拖拽移动 · 空格暂停', 5000);
    toast(`世界「${name}」已苏醒`, 'good', 'seed');
  }

  loadWorld(w: WorldState, name: string) {
    // 保留当前 UI，重建渲染状态
    this.world = w;
    this.worldName = name;
    this.speed = 0;
    this.lastFeedYear = w.year;
    this.vw = null;
    this.startWorld(w, name);
    this.speed = 0;
    setHudSpeed(this.els.topbar, 0);
    (this.els.sidepanel as HTMLElement).classList.add('hidden');
  }

  private hudCallbacks(): HudCallbacks {
    return {
      onSpeed: s => {
        this.speed = s;
        this.audio.ensure();
        setHudSpeed(this.els.topbar, s);
        if (this.world) this.showHint(s === 0 ? '时间暂停' : s === 1 ? '正常速度' : s === 2 ? '快速推进' : '极速推进', 1600);
      },
      onStep: () => {
        if (this.world && this.speed === 0) {
          const report = tickYear(this.world);
          this.afterYear(report);
        }
      },
      onPower: id => {
        if (!this.world) return;
        if (id === 'enlighten' || id === 'ideas') {
          const res = castCivPower(this.world, id);
          if (res.ok) {
            const entry = powerChronicleEntry(this.world, id, res);
            this.world.chronicle.push(entry);
            this.audio.power();
            this.flash('#7fc7ad', 0.35);
            toast(res.message, 'good', id === 'enlighten' ? 'enlighten' : 'ideas');
            this.refreshHud();
          } else toast(res.message, 'bad', 'alert');
          return;
        }
        this.activePower = this.activePower === id ? null : id;
        setHudPower(this.els.toolbar, this.activePower);
        this.showHint(this.activePower
          ? `神力就绪：点击地图施放（右键/Esc 取消）`
          : '检视模式：点击聚落查看详情', 2600);
      },
      onBrush: r => {
        this.brush = r;
        setHudBrush(this.els.toolbar, r);
        if (this.vw) this.vw.brushRadius = r;
      },
      onChronicle: () => this.world && openChronicle(this.world, this.panelActions()),
      onObserver: () => this.world && openObserver(this.world),
      onSave: () => this.world && openSaveMenu(this.world, this.worldName, this.panelActions()),
      onMenu: () => {
        if (this.world) { autosave(this.world, this.worldName); toast('已自动保存，返回主菜单', 'good', 'save'); }
        this.showMenu();
      },
      onHelp: () => openHelp(),
      onFormBadge: () => this.world && openFormCard(this.world),
      onPopStat: () => this.world && openObserver(this.world),
      onFoodStat: () => this.world && openObserver(this.world),
      onMute: () => {
        this.audio.setMuted(!this.audio.muted);
        setMuteIcon(this.els.topbar, this.audio.muted);
      },
      onHome: () => this.vw && this.world && this.vw.centerOnMap(this.world.config.size),
    };
  }

  panelActions() {
    return {
      focusSettlement: (s: Settlement) => this.vw?.focusSettlement(s),
      castBlessingAt: (s: Settlement) => this.blessingAt(s),
      purify: (settlementId: number) => this.purifyAt(settlementId),
      refreshHud: () => this.refreshHud(),
      loadWorld: (w: WorldState, n: string) => this.loadWorld(w, n),
      toast: (t: string, k?: 'good' | 'bad' | 'neutral', i?: string) => toast(t, k, i),
      playSfx: (name: string, sev?: number) => this.playSfx(name, sev),
    };
  }

  private blessingAt(s: Settlement) {
    if (!this.world) return;
    const res = castBrushPower(this.world, 'blessing', s.x, s.y, 0);
    if (res.ok) {
      const entry = powerChronicleEntry(this.world, 'blessing', res);
      this.world.chronicle.push(entry);
      this.vw?.addPing(s.x, s.y, 'rgba(232,196,98,0.95)');
      this.audio.power();
      this.flash('#e8c462', 0.3);
      toast(`丰产祝福降临 ${s.name}`, 'good', 'blessing');
      this.refreshHud();
    } else toast(res.message, 'bad', 'alert');
  }

  private purifyAt(settlementId: number) {
    if (!this.world) return false;
    const res = castPurify(this.world, settlementId);
    if (res.ok) {
      this.world.chronicle.push({
        id: `ev-${this.world.nextEventId++}`, year: this.world.year, title: '神力：净化疫病',
        category: 'plague', text: '神光扫过病榻，高热退去，咳嗽止息。医者们把这一夜记录了下来。',
        causes: ['神（玩家）净化疫病'], effects: ['疫病终止', '医学知识积累'], intervened: true,
        severity: 0.4, settlementId,
      });
      const s = this.world.settlements.find(x => x.id === settlementId);
      if (s) this.vw?.addPing(s.x, s.y, 'rgba(127,199,173,0.95)');
      this.audio.power();
      this.flash('#7fc7ad', 0.35);
      toast('疫病已被净化', 'good', 'sparkle');
      this.refreshHud();
      return true;
    }
    toast(res.message, 'bad', 'alert');
    return false;
  }

  playSfx(name: string, severity = 0.3) {
    if (name === 'chime') this.audio.chime(severity);
    else if (name === 'power') this.audio.power();
    else if (name === 'click') this.audio.click();
    else if (name === 'era') this.audio.eraFanfare();
    else if (name === 'milestone') this.audio.milestone();
  }

  flash(color: string, alpha: number) {
    if (this.vw) {
      this.vw.flashOverlay = { color: color.replace(')', ',$a)').replace('rgb', 'rgba'), alpha };
    }
  }

  refreshHud() {
    if (this.world) updateTopbar(document.getElementById('game') as HTMLElement, this.world, this.worldName);
  }

  showHint(text: string, ms = 2200) {
    const hint = this.els.hint;
    if (!hint) return;
    hint.textContent = text;
    hint.style.opacity = '1';
    clearTimeout((hint as any)._t);
    (hint as any)._t = setTimeout(() => { hint.style.opacity = '0'; }, ms);
  }

  // ---------- 输入 ----------

  private inputBound = false;
  private bindCanvasInput(canvas: HTMLCanvasElement) {
    if (this.inputBound) return;
    this.inputBound = true;
    let dragging = false;
    let moved = 0;
    let lastX = 0, lastY = 0;

    canvas.addEventListener('mousedown', e => {
      if (isModalOpen()) return;
      dragging = true;
      moved = 0;
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mousemove', e => {
      if (!this.vw || !this.world) return;
      // hover tile
      const tile = this.vw.screenToTile(e.clientX, e.clientY);
      this.vw.hoverTile = this.activePower && tile &&
        tile.x >= 0 && tile.y >= 0 && tile.x < this.world.config.size && tile.y < this.world.config.size ? tile : null;
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) {
        this.vw.camera.x -= dx / this.vw.camera.zoom;
        this.vw.camera.y -= dy / this.vw.camera.zoom;
        this.vw.camera.targetX = this.vw.camera.x;
        this.vw.camera.targetY = this.vw.camera.y;
        canvas.classList.add('dragging');
      }
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove('dragging');
      if (moved <= 6 && e.target === canvas) this.handleClick(e.clientX, e.clientY, e.button);
    });
    canvas.addEventListener('wheel', e => {
      if (!this.vw) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.88 : 1.14;
      this.vw.camera.targetZoom = Math.max(0.4, Math.min(2.6, this.vw.camera.targetZoom * factor));
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.activePower) {
        this.activePower = null;
        setHudPower(this.els.toolbar, null);
        this.showHint('神力已取消', 1400);
      }
    });
  }

  private handleClick(px: number, py: number, button: number) {
    if (!this.world || !this.vw || button !== 0) return;
    const tile = this.vw.screenToTile(px, py);
    if (!tile) return;
    const size = this.world.config.size;
    if (tile.x < 0 || tile.y < 0 || tile.x >= size || tile.y >= size) return;

    if (this.activePower) {
      const res = castBrushPower(this.world, this.activePower, tile.x, tile.y, this.brush);
      if (res.ok) {
        const entry = powerChronicleEntry(this.world, this.activePower, res);
        this.world.chronicle.push(entry);
        this.vw.minimapDirty = true;
        this.vw.addPing(tile.x, tile.y, 'rgba(127,199,173,0.9)');
        this.audio.power();
        this.flash(this.activePower === 'drought' ? 'rgb(216,160,80)' : 'rgb(127,199,173)', 0.28);
        toast(res.message, 'good', this.activePower);
        this.refreshHud();
      } else {
        toast(res.message, 'bad', 'alert');
      }
      return;
    }
    // 检视模式：找最近聚落
    let best: Settlement | null = null, bestD = 2.4;
    for (const s of this.world.settlements) {
      const d = Math.hypot(s.x - tile.x, s.y - tile.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) {
      showSettlementPanel(this.els.sidepanel, this.world, best, this.panelActions());
      this.audio.click();
    } else {
      hideSettlementPanel(this.els.sidepanel);
    }
  }

  private keysBound = false;
  private bindKeys() {
    if (this.keysBound) return;
    this.keysBound = true;
    document.addEventListener('keydown', e => {
      if (isModalOpen()) {
        if (e.key === 'Escape') {
          const root = document.getElementById('modal-root')!;
          if (root.firstChild) { root.innerHTML = ''; }
        }
        return;
      }
      if (!this.world) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.speed = this.speed === 0 ? 1 : 0;
          setHudSpeed(this.els.topbar, this.speed);
          break;
        case '1': this.speed = 1; setHudSpeed(this.els.topbar, 1); break;
        case '2': this.speed = 2; setHudSpeed(this.els.topbar, 2); break;
        case '3': this.speed = 4; setHudSpeed(this.els.topbar, 4); break;
        case 'Escape':
          if (this.activePower) {
            this.activePower = null;
            setHudPower(this.els.toolbar, null);
          } else {
            hideSettlementPanel(this.els.sidepanel);
          }
          break;
        case 'h': case 'H':
          this.vw?.centerOnMap(this.world.config.size);
          break;
        case 'c': case 'C': openChronicle(this.world, this.panelActions()); break;
        case 'o': case 'O': openObserver(this.world); break;
        case 's': case 'S': openSaveMenu(this.world, this.worldName, this.panelActions()); break;
        case 'f': case 'F': {
          // 聚焦最大聚落
          const alive = this.world.settlements.filter(s => !s.dead);
          if (alive.length) this.vw?.focusSettlement(alive.reduce((a, b) => a.population > b.population ? a : b));
          break;
        }
      }
    });
    window.addEventListener('resize', () => {
      this.vw?.resize();
      if (this.menuVw) this.menuVw.resize();
    });
  }

  // ---------- 主循环 ----------

  frame(time: number) {
    const dt = Math.min(0.06, (time - this.lastTime) / 1000 || 0.016);
    this.lastTime = time;

    // 菜单背景
    if ((document.getElementById('menu') as HTMLElement).style.display !== 'none' && this.menuVw && this.menuWorld) {
      const cam = this.menuVw.camera;
      cam.targetX = Math.sin(time * 0.00008) * 380;
      cam.targetY = this.menuWorld.config.size * 16 + Math.cos(time * 0.00006) * 160;
      this.menuVw.render(this.menuWorld, dt, time, true);
    }

    // 游戏世界
    if (this.world && this.vw && (document.getElementById('game') as HTMLElement).classList.contains('hidden') === false) {
      if (this.speed > 0 && !isModalOpen()) {
        this.yearAccum += dt * this.speed;
        const yearSeconds = CFG.yearMs1x / 1000;
        while (this.yearAccum >= yearSeconds) {
          this.yearAccum -= yearSeconds;
          const report = tickYear(this.world);
          this.afterYear(report);
          if (this.speed === 0) break;
        }
      }
      this.vw.render(this.world, dt, time, this.speed === 0);
    }
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  afterYear(report: ReturnType<typeof tickYear>) {
    if (!this.world) return;
    const w = this.world;
    this.refreshHud();

    // 事件提示
    for (const ev of report.events) {
      if (ev.category === 'institution') {
        this.playSfx('era');
        toast(ev.title, 'good', 'branch');
        const s = ev.settlementId !== undefined ? w.settlements.find(x => x.id === ev.settlementId) : null;
        if (s) this.vw?.addPing(s.x, s.y, 'rgba(201,162,39,0.95)');
      } else if (ev.severity > 0.55) {
        this.playSfx('chime', ev.severity);
        toast(ev.title, 'bad', 'alert');
        const s = ev.settlementId !== undefined ? w.settlements.find(x => x.id === ev.settlementId) : null;
        if (s) this.vw?.addPing(s.x, s.y, 'rgba(180,85,45,0.9)');
      } else if (ev.category === 'invention' || ev.category === 'achievement') {
        this.playSfx('milestone');
      }
      if (ev.settlementId !== undefined) {
        const s = w.settlements.find(x => x.id === ev.settlementId);
        if (s && ev.category !== 'institution' && ev.severity > 0.55) this.vw?.addPing(s.x, s.y, 'rgba(220,120,80,0.9)');
      }
    }

    // 事件流
    updateEventFeed(this.els.feed, w, this.panelActions(), this.lastFeedYear);
    this.lastFeedYear = w.year;

    // 雨声强度
    if (this.vw && this.world) {
      let wetCount = 0;
      const step = 3;
      for (let i = 0; i < this.world.weather.length; i += step * step) {
        if (this.world.weather[i].wet > 0.5) wetCount++;
      }
      this.audio.setRainIntensity(Math.min(1, wetCount / 40));
    }

    // 自动存档（每 10 年）
    if (w.year % 10 === 0) autosave(w, this.worldName);

    // 文明湮灭提示
    if (w.civ.vars.population === 0 && w.year > 10) {
      this.speed = 0;
      setHudSpeed(this.els.topbar, 0);
      toast('文明已经湮灭……可读取存档或从分支重启', 'bad', 'alert');
    }
  }
}

// ---------- OhMyGame 玩法测试桥（开发模式） ----------
if (import.meta.env?.DEV) {
  (window as any).__OHMYGAME_PLAYTEST__ = {
    snapshot: () => {
      const g = (window as any).__game as Game | undefined;
      if (!g?.world) return null;
      const w = g.world;
      const macro = macroEconomy(w);
      const cls = classifySociety(w);
      return {
        year: w.year,
        form: w.civ.form,
        formLabel: formLabel(cls),
        population: macro.population,
        foodRatio: Math.round(macro.foodRatio * 1000) / 1000,
        unrest: Math.round(w.civ.vars.unrest * 1000) / 1000,
        settlements: w.settlements.filter(s => !s.dead).length,
        buildings: w.settlements.reduce((a, s) => a + s.buildings.length, 0),
        chronicleLength: w.chronicle.length,
        interventions: w.interventions,
        speed: g.speed,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        ready: true,
      };
    },
    reset: () => {
      const g = (window as any).__game as Game | undefined;
      if (g) { g.showMenu(); return true; }
      return false;
    },
    setSeed: (seed: number) => {
      const g = (window as any).__game as Game | undefined;
      if (!g) return false;
      const w = newWorld({ seed: seed >>> 0, size: 48, mode: 'free', settlements: 1, scenario: 'dawn' });
      g.startWorld(w, `测试世界 ${seed}`);
      return true;
    },
    step: (years: number) => {
      const g = (window as any).__game as Game | undefined;
      if (!g?.world) return null;
      const reports = [];
      for (let i = 0; i < Math.max(0, Math.floor(years)); i++) {
        reports.push(tickYear(g.world));
      }
      g.refreshHud();
      return { years: reports.length, events: reports.reduce((a, r) => a + r.events.length, 0) };
    },
    usePower: (id: string, x: number, y: number, radius = 1) => {
      const g = (window as any).__game as Game | undefined;
      if (!g?.world) return null;
      if (id === 'enlighten' || id === 'ideas') return castCivPower(g.world, id as any);
      return castBrushPower(g.world, id as GodPowerId, x, y, radius);
    },
    loadSave: (json: string) => {
      const g = (window as any).__game as Game | undefined;
      if (!g) return null;
      const d = deserializeSave(json);
      if ('world' in d) { g.loadWorld(d.world, d.worldName); return true; }
      return false;
    },
    serialize: () => {
      const g = (window as any).__game as Game | undefined;
      if (!g?.world) return null;
      return serializeSave(g.world, g.worldName);
    },
  };
}

const game = new Game();
(window as any).__game = game;
