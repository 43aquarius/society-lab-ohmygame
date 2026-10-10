/**
 * VisualWorld v4.0 — 世界渲染与摄像机（分块流式大世界）
 * 画布分层职责：地形（16×16 渲染块缓存，三档分辨率/构建预算）→ 道路 →
 * 印记（坟墓/陨坑）→ 领地边界 → 建筑与小人（统一 y 排序，海拔感知）→
 * 事件特效 → 天气 → 昼夜暗幕 → 灯火合成层 → 聚落标签（文明色）→
 * 笔刷 → 云影 → 局部小地图（未探索迷雾 + 视口多边形 + 点击跳转）。
 * 缩放档位：zoom<0.34 贴 0.22 块 / <0.72 贴 0.45 块 / <1.6 贴 0.8 块 /
 * ≥1.6 逐格直绘（锐利近景）。
 */
import { Terrain, BuildingKind, type WorldState, type Settlement } from '../types';
import { CFG } from '../config';
import { TILE_W, TILE_H, ELEV_H, gridToScreen, screenToGrid, vhash, clamp, elevAt } from './iso';
import { drawBorders, drawTile, TerrainCache, RC, rcOrigin } from './terrain';
import { drawBuilding, beginLights, collectLights } from './buildings';
import { AgentSystem, daySlot, nightFactor } from './agents';
import { EffectSystem } from './effects';
import { drawDecals } from '../decals';
import { peekTile } from '../worldgen';

export interface Camera {
  x: number; y: number;     // 世界像素中心
  zoom: number;
  targetZoom: number;
  targetX: number; targetY: number;
}

export interface Ping {
  x: number; y: number;
  ttl: number;              // 秒
  color: string;
}

/** 云影与飞鸟（环境生命感） */
interface Cloud { x: number; y: number; r: number; s: number; a: number }
interface Bird { x: number; y: number; vx: number; vy: number; ph: number; life: number }

export class VisualWorld {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  agents = new AgentSystem();
  pings: Ping[] = [];
  hoverTile: { x: number; y: number } | null = null;
  brushRadius = 1;
  brushColor = 'rgba(47,126,118,0.7)';
  minimap: HTMLCanvasElement | null = null;
  minimapDirty = true;
  terrainCache = new TerrainCache();
  fx = new EffectSystem();
  /** 昼夜时钟（现实秒，暂停时停走；dayPhase = (clock % daySeconds)/daySeconds） */
  dayClock = CFG.daySeconds * 0.34; // 从上午开始
  /** 小地图点击回调（main.ts 注入跳转） */
  onMinimapClick: ((gx: number, gy: number) => void) | null = null;
  private clouds: Cloud[] = [];
  private birds: Bird[] = [];
  private lastMinimapDraw = 0;
  private lastMinimapCenter = { x: -999, y: -999 };
  private minimapChunkCount = -1;
  private minimapRectCache = { x: 0, y: 0, w: 148, h: 148 };
  flashOverlay: { color: string; alpha: number } | null = null;
  /** v4.0 性能核心：静态世界层缓存（道路/印记/边界/建筑）——相机静止时零重绘 */
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = '';
  private cachedLights: { x: number; y: number; r: number; c: string }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = { x: 0, y: 0, zoom: 1.15, targetZoom: 1.15, targetX: 0, targetY: 0 };
    for (let i = 0; i < 3; i++) {
      this.clouds.push({ x: Math.random(), y: Math.random(), r: 90 + Math.random() * 130, s: 0.004 + Math.random() * 0.006, a: 0.05 + Math.random() * 0.05 });
    }
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(320, rect.width * dpr);
    this.canvas.height = Math.max(240, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
  }
  private dpr = 1;

  /** 菜单背景等旧接口：聚焦世界中心（若有聚落则聚焦主文明） */
  centerOnMap(size: number) {
    this.focusObservedCiv(this.worldRef);
  }
  private worldRef: WorldState | null = null;

  /** v4.0：聚焦观察文明的最大聚落（超大世界不再有"全景"） */
  focusObservedCiv(w: WorldState | null) {
    if (!w) return;
    const civ = w.civs[w.observedCiv] ?? w.civs[0];
    let best: Settlement | null = null;
    for (const s of w.settlements) {
      if (s.dead || (civ && s.civId !== civ.id)) continue;
      if (!best || s.population > best.population) best = s;
    }
    if (!best) best = w.settlements.find(s => !s.dead) ?? null;
    const target = best;
    if (target) {
      const p = gridToScreen(target.x, target.y);
      this.camera.targetX = p.x;
      this.camera.targetY = p.y - elevAt(w, target.x, target.y) * ELEV_H;
      this.camera.targetZoom = Math.max(this.camera.targetZoom, 1.25);
      if (this.camera.zoom < 0.5) this.camera.zoom = 0.6; // 首次快速进入
      this.addPing(target.x, target.y, 'rgba(201,162,39,0.9)');
    }
  }

  focusSettlement(s: Settlement) {
    const p = gridToScreen(s.x, s.y);
    this.camera.targetX = p.x;
    this.camera.targetY = p.y - elevAt(this.worldRef!, s.x, s.y) * ELEV_H;
    this.camera.targetZoom = Math.max(this.camera.zoom, 1.6);
    this.addPing(s.x, s.y, 'rgba(201,162,39,0.9)');
  }

  addPing(gx: number, gy: number, color: string) {
    this.pings.push({ x: gx, y: gy, ttl: 2.2, color });
  }

  screenToTile(px: number, py: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const wx = (px - rect.left - cx) / this.camera.zoom + this.camera.x;
    const wy = (py - rect.top - cy) / this.camera.zoom + this.camera.y;
    const g = screenToGrid(wx, wy + TILE_H / 2);
    return { x: Math.floor(g.x), y: Math.floor(g.y) };
  }

  /** 主渲染入口 */
  render(w: WorldState, dt: number, time: number, paused: boolean) {
    this.worldRef = w;
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    // 摄像机平滑 + 世界边界钳制
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * Math.min(1, dt * 8);
    this.camera.x += (this.camera.targetX - this.camera.x) * Math.min(1, dt * 8);
    this.camera.y += (this.camera.targetY - this.camera.y) * Math.min(1, dt * 8);
    this.clampCamera(w, W, H);
    const cam = this.camera;
    this.fx.update(dt);

    // 昼夜推进（现实时间；暂停时冻结）
    if (!paused) {
      this.dayClock += dt;
      this.updateEnv(dt, W, H);
    }
    const dayPhase = (this.dayClock % CFG.daySeconds) / CFG.daySeconds;
    const night = nightFactor(dayPhase);

    // 居民智能体推进
    const SEG: any = (window as any).__SEG_ON ? ((window as any).__SEG ??= {}) : null;
    let segT = SEG ? performance.now() : 0;
    if (SEG) { SEG.agents = (SEG.agents || 0) - (performance.now() - segT); segT = performance.now(); }
    this.agents.update(w, Math.min(0.05, dt), dayPhase, paused);
    if (SEG) { SEG.agents = (SEG.agents || 0) + performance.now() - segT; segT = performance.now(); }

    // 背景桌台色（夜里更深）
    const deskR = 32 - night * 10, deskG = 48 - night * 14, deskB = 44 - night * 12;
    ctx.fillStyle = `rgb(${deskR | 0},${deskG | 0},${deskB | 0})`;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const size = w.gen.size;
    const halfW = W / 2 / cam.zoom, halfH = H / 2 / cam.zoom;
    const wx0 = cam.x - halfW - 80, wx1 = cam.x + halfW + 80;
    const wy0 = cam.y - halfH - 140, wy1 = cam.y + halfH + 180;

    const lod = cam.zoom;
    const inView = (sx: number, sy: number) => sx > wx0 - 100 && sx < wx1 + 100 && sy > wy0 - 160 && sy < wy1 + 140;

    const gmin = screenToGrid(wx0 - TILE_W, wy0 - TILE_H * 2);
    const gmax = screenToGrid(wx1 + TILE_W, wy1 + TILE_H * 2);
    const x0 = clamp(Math.floor(gmin.x) - 1, 0, size - 1);
    const x1 = clamp(Math.ceil(gmax.x) + 1, 0, size - 1);
    const y0 = clamp(Math.floor(gmin.y) - 1, 0, size - 1);
    const y1 = clamp(Math.ceil(gmax.y) + 1, 0, size - 1);

    // 1) 地形：分块缓存贴图（预算控制构建）；极高缩放直绘锐利近景
    this.terrainCache.resetBudget();
    if (lod >= 1.6) {
      for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
        for (let x = Math.max(x0, sum - y1); x <= Math.min(x1, sum - y0); x++) {
          const y = sum - x;
          if (y < y0 || y > y1) continue;
          const p = gridToScreen(x, y);
          drawTile(ctx, w, x, y, p.x, p.y, time, lod, true);
        }
      }
    } else {
      const tier = this.terrainCache.tierFor(lod);
      const scale = this.terrainCacheScaleOf(tier);
      const rc0x = Math.max(0, Math.floor((gmin.x - 2) / RC));
      const rc1x = Math.min(Math.ceil(size / RC) - 1, Math.floor((gmax.x + 2) / RC));
      const rc0y = Math.max(0, Math.floor((gmin.y - 2) / RC));
      const rc1y = Math.min(Math.ceil(size / RC) - 1, Math.floor((gmax.y + 2) / RC));
      // 由近及远构建（预算优先给中心）
      for (let ry = rc0y; ry <= rc1y; ry++) {
        for (let rx = rc0x; rx <= rc1x; rx++) {
          const cv = this.terrainCache.get(w, rx, ry, tier);
          if (!cv) continue;
          const { ox, oy } = rcOrigin(rx, ry);
          ctx.drawImage(cv, ox - 0.5, oy - 0.5, cv.width / scale, cv.height / scale);
        }
      }
    }

    // 可见水面波光（动画层，叠加在缓存之上；远景交给缓存贴图自身）
    if (lod > 0.8 && lod < 1.6) {
      for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
        for (let x = Math.max(x0, sum - y1); x <= Math.min(x1, sum - y0); x++) {
          const y = sum - x;
          if (y < y0 || y > y1) continue;
          const t = peekTile(w, x, y);
          if (!t || t.terrain !== Terrain.Water) continue;
          const ph = time * 0.0011 + vhash(x, y, 3) * Math.PI * 2;
          const a = 0.06 + Math.sin(ph) * 0.05;
          if (a <= 0) continue;
          const cx = (x - y) * TILE_W / 2, cy = (x + y) * TILE_H / 2 - t.elevation * ELEV_H + 5;
          ctx.fillStyle = `rgba(210,235,248,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(cx - TILE_W * 0.2, cy);
          ctx.lineTo(cx + TILE_W * 0.05, cy - TILE_H * 0.16);
          ctx.lineTo(cx + TILE_W * 0.2, cy + TILE_H * 0.06);
          ctx.lineTo(cx - TILE_W * 0.08, cy + TILE_H * 0.14);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    if (SEG) { SEG.terrain = (SEG.terrain || 0) + performance.now() - segT; segT = performance.now(); }
    // ===== 静态世界层（道路/印记/边界/建筑）=====
    // v4.0 性能核心：zoom<1.5 时相机静止直接贴缓存层（每帧 ≈ 1 次 drawImage）；
    // zoom>=1.5 近景直绘，保证小人与建筑的前后排序正确（此档视口小、成本低）
    const batchFar = lod < 1.5;
    if (batchFar) {
      // 预渲染静态层（屏幕空间画布；在世界变换之外贴，见下方 restore 之后）
      const sl = this.renderStaticLayer(w, W, H, time, night);
      (this as any)._pendingStaticLayer = sl;
    } else {
      (this as any)._pendingStaticLayer = null;
      beginLights();
      interface Drawable { depth: number; draw: () => void }
      const drawables: Drawable[] = [];
      for (const s of w.settlements) {
        const c = gridToScreen(s.x, s.y);
        const pad = s.radius * TILE_W + 140;
        if (c.x < wx0 - pad || c.x > wx1 + pad || c.y < wy0 - pad || c.y > wy1 + pad) continue;
        for (const b of [...s.buildings, ...s.construction]) {
          const e = elevAt(w, b.x, b.y);
          const p = gridToScreen(b.x, b.y);
          const by = p.y - e * ELEV_H;
          if (!inView(p.x, by)) continue;
          drawables.push({
            depth: b.x + b.y + (b.kind === BuildingKind.Farm ? -0.4 : 0),
            draw: () => drawBuilding(ctx, w, b, p.x, by, time, lod, night),
          });
        }
      }
      for (const a of this.agents.agents) {
        if (a.state === 'sleep') continue;
        const p = gridToScreen(a.gx, a.gy);
        const ay = p.y - elevAt(w, a.gx, a.gy) * ELEV_H;
        if (!inView(p.x, ay)) continue;
        drawables.push({
          depth: a.gx + a.gy,
          draw: () => this.agents.drawOne(ctx, w, a, lod, night, time),
        });
      }
      drawables.sort((a, b) => a.depth - b.depth);
      for (const d of drawables) d.draw();
      this.cachedLights = collectLights();
    }
    if (SEG) { SEG.draw = (SEG.draw || 0) + performance.now() - segT; segT = performance.now(); }
    // 9.5) 静态世界层贴图（屏幕空间——必须在世界变换 restore 之后贴，
    //      否则会被相机变换二次平移缩放导致画面错位；且必须在动态层之前，建筑才在小人之下）
    ctx.restore();
    const pendingSL: HTMLCanvasElement | null = (this as any)._pendingStaticLayer;
    if (pendingSL) ctx.drawImage(pendingSL, 0, 0, W, H);

    // 动态层（小人/天气/特效）：重新进入世界变换
    if (batchFar) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      this.agents.resetDetailBudget();
      this.agents.drawBatched(ctx, w, night, time);

    // 6) 天气（雨/旱的区域视觉；稀疏表直遍 + 视口裁剪）
    if (lod > 0.35 && w.weather.size) {
      for (const [key, cell] of w.weather) {
        if (Math.abs(cell.wet) < 0.25) continue;
        const x = key % size, y = Math.floor(key / size);
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const p = gridToScreen(x, y);
        if (cell.wet > 0.25) drawRain(ctx, x, y, p.x, p.y, time);
        else drawDrought(ctx, p.x, p.y);
      }
    }

    if (SEG) { SEG.weather = (SEG.weather || 0) + performance.now() - segT; segT = performance.now(); }
    // 7) 事件特效
    this.fx.draw(ctx, w, time);
    if (SEG) { SEG.fx = (SEG.fx || 0) + performance.now() - segT; segT = performance.now(); }

    // 8) 祝福特效
    for (const s of w.settlements) {
      if (s.dead || !s.effects.some(e => e.kind === 'blessing')) continue;
      const p = gridToScreen(s.x, s.y);
      if (!inView(p.x, p.y)) continue;
      drawBlessing(ctx, p.x, p.y, time);
    }

    // 9) 事件 ping
    for (const ping of this.pings) {
      ping.ttl -= dt;
      if (ping.ttl <= 0) continue;
      const p = gridToScreen(ping.x, ping.y);
      const t = 1 - ping.ttl / 2.2;
      ctx.strokeStyle = ping.color.replace(/[\d.]+\)$/, `${(1 - t) * 0.9})`);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 18 + t * 55, 9 + t * 28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.pings = this.pings.filter(p => p.ttl > 0);
    if (batchFar) ctx.restore(); // 动态层世界变换结束
    } // batchFar 动态层块结束

    // 10) 灯火（在暗幕之下先收集完，之后再叠加；世界变换已在动态层结束时收尾）

    // 11) 昼夜暗幕（屏幕空间；微缩沙盘不至于全黑）
    if (night > 0.02) {
      const a = night * 0.44;
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, `rgba(14,20,44,${a.toFixed(3)})`);
      grd.addColorStop(0.6, `rgba(16,24,52,${(a * 0.9).toFixed(3)})`);
      grd.addColorStop(1, `rgba(10,16,40,${(a * 0.8).toFixed(3)})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    }

    // 12) 灯火合成层（窗光/篝火/火把，叠加在暗幕之上）
    if (night > 0.22 && lod > 0.5) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      ctx.globalCompositeOperation = 'lighter';
      for (const L of this.cachedLights) {
        if (!inView(L.x, L.y)) continue;
        const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
        g.addColorStop(0, L.c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    // 13) 全局雨幕氛围
    let rainTiles = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      if ((w.weather.get(y * size + x)?.wet ?? 0) > 0.5) rainTiles++;
    }
    if (rainTiles > 8) {
      ctx.fillStyle = `rgba(40,70,100,${Math.min(0.14, rainTiles * 0.002)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 14) 闪光反馈（神力/闪电）
    const flashFx = this.fx.flash;
    if (flashFx && flashFx.alpha > 0.01) {
      ctx.fillStyle = flashFx.color.replace(')', ',$a)').replace('rgb', 'rgba').replace('$a', String(flashFx.alpha));
      ctx.fillRect(0, 0, W, H);
    }
    if (this.flashOverlay && this.flashOverlay.alpha > 0.01) {
      ctx.fillStyle = this.flashOverlay.color.replace('$a', String(this.flashOverlay.alpha));
      ctx.fillRect(0, 0, W, H);
      this.flashOverlay.alpha *= Math.pow(0.02, dt);
    }

    // 15) 云影（缓慢漂移的大块软影）
    for (const c of this.clouds) {
      const cx = c.x * W, cy = c.y * H;
      ctx.fillStyle = `rgba(24,32,44,${c.a})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, c.r, c.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 16) 飞鸟（屏幕空间掠过的雁阵）
    this.drawBirds(ctx, dt, W, H, paused);

    // 17) 笔刷光标
    if (this.hoverTile) {
      const { x, y } = this.hoverTile;
      if (x >= 0 && y >= 0 && x < size && y < size) {
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(cam.zoom, cam.zoom);
        ctx.translate(-cam.x, -cam.y);
        drawBrushCursor(ctx, x, y, this.brushRadius, this.brushColor, time);
        ctx.restore();
      }
    }

    if (SEG) { SEG.overlay = (SEG.overlay || 0) + performance.now() - segT; segT = performance.now(); }
    // 18) 聚落标签（纯屏幕空间：字号恒定 + 防重叠 + 文明色标）
    type Label = { sx: number; sy: number; text: string; strong: boolean; pop: number; color?: string };
    const labels: Label[] = [];
    for (const s of w.settlements) {
      const p = gridToScreen(s.x, s.y);
      if (!inView(p.x, p.y)) continue;
      const sx = (p.x - cam.x) * cam.zoom + W / 2;
      const sy = (p.y - cam.y) * cam.zoom + H / 2;
      const text = s.dead ? '废墟' : `${s.name} · ${s.population}人`;
      const civ = w.civs[s.civId];
      labels.push({ sx, sy: sy - 14, text, strong: !s.dead, pop: s.dead ? 0 : s.population, color: s.dead ? undefined : civ?.color });
    }
    labels.sort((a, b) => b.pop - a.pop);
    ctx.font = '600 12px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
    const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const l of labels) {
      const wpx = ctx.measureText(l.text).width + 20;
      const lx0 = l.sx - wpx / 2, lx1 = l.sx + wpx / 2;
      const ly0 = l.sy - 22, ly1 = l.sy - 3;
      let clash = false;
      for (const t of taken) {
        if (lx0 < t.x1 + 4 && lx1 > t.x0 - 4 && ly0 < t.y1 + 2 && ly1 > t.y0 - 2) { clash = true; break; }
      }
      if (clash) continue;
      taken.push({ x0: lx0, x1: lx1, y0: ly0, y1: ly1 });
      ctx.save();
      ctx.translate(l.sx, l.sy);
      ctx.fillStyle = l.strong ? 'rgba(28,38,34,0.62)' : 'rgba(120,110,100,0.6)';
      roundRect(ctx, -wpx / 2, -22, wpx, 17, 8);
      ctx.fill();
      if (l.color) {
        ctx.fillStyle = l.color;
        roundRect(ctx, -wpx / 2 + 4, -17.5, 6, 6, 2);
        ctx.fill();
      }
      ctx.fillStyle = l.strong ? '#f2ead6' : '#b8b0a4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, l.color ? 4 : 0, -13);
      ctx.restore();
    }

    // 19) 时段角标（清晨/白昼/黄昏/夜晚）
    const slotName = ['夜', '晨', '昼', '暮'][daySlot(dayPhase)];
    ctx.font = '600 11px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(24,32,28,0.55)';
    roundRect(ctx, 12, H - 30, 64, 20, 8);
    ctx.fill();
    ctx.fillStyle = night > 0.4 ? '#9aa8c8' : '#e8dfc8';
    ctx.fillText(`${slotName} · ${night > 0.4 ? '入夜' : '天光'}`, 20, H - 19);

    if (SEG) { SEG.labels = (SEG.labels || 0) + performance.now() - segT; segT = performance.now(); }
    // 小地图（局部窗口 + 迷雾 + 文明色 + 视口多边形）
    this.drawMinimap(w, W, H, time);
    if (SEG) { SEG.minimap = (SEG.minimap || 0) + performance.now() - segT; }
  }

  /**
   * 静态世界层：道路+印记+边界+建筑。
   * 失效条件：相机移动/缩放、年份推进、建筑增删、昼夜窗火、600ms 烟动画步进。
   * 相机静止观看时（最常见的欣赏状态）每帧零重绘。
   */
  private renderStaticLayer(w: WorldState, W: number, H: number, time: number, night: number): HTMLCanvasElement {
    const cam = this.camera;
    const key = [
      Math.round(cam.x * 2), Math.round(cam.y * 2), Math.round(cam.zoom * 1500),
      w.year, w.nextBuildingId, night > 0.22 ? 1 : 0, Math.floor(time / 600),
      Math.round(W), Math.round(H),
    ].join(',');
    if (this.staticLayer && key === this.staticKey) return this.staticLayer;
    this.staticKey = key;
    const cv = this.staticLayer ?? (this.staticLayer = document.createElement('canvas'));
    const dpr = Math.min(1.6, this.dpr * 0.85); // 0.85× 采样：像素量再降 28%
    const cw = Math.ceil(W * dpr), ch = Math.ceil(H * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, ch);
    c.scale(dpr, dpr);
    c.translate(W / 2, H / 2);
    c.scale(cam.zoom, cam.zoom);
    c.translate(-cam.x, -cam.y);

    const lod = cam.zoom;
    const size = w.gen.size;
    const halfW = W / 2 / cam.zoom, halfH = H / 2 / cam.zoom;
    const wx0 = cam.x - halfW - 80, wx1 = cam.x + halfW + 80;
    const wy0 = cam.y - halfH - 140, wy1 = cam.y + halfH + 180;
    const gmin = screenToGrid(wx0 - TILE_W, wy0 - TILE_H * 2);
    const gmax = screenToGrid(wx1 + TILE_W, wy1 + TILE_H * 2);
    const x0 = clamp(Math.floor(gmin.x) - 1, 0, size - 1);
    const x1 = clamp(Math.ceil(gmax.x) + 1, 0, size - 1);
    const y0 = clamp(Math.floor(gmin.y) - 1, 0, size - 1);
    const y1 = clamp(Math.ceil(gmax.y) + 1, 0, size - 1);

    if (lod > 0.5) drawRoads(c, w, x0, x1, y0, y1, wx0, wx1, wy0, wy1);
    drawDecals(c, w, lod, (sx, sy) => sx > wx0 - 100 && sx < wx1 + 100 && sy > wy0 - 160 && sy < wy1 + 140);
    if (lod > 0.55) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = gridToScreen(x, y);
          drawBorders(c, w, x, y, p.x, p.y);
        }
      }
    }
    beginLights();
    interface D2 { depth: number; draw: () => void }
    const ds: D2[] = [];
    for (const s of w.settlements) {
      const cc = gridToScreen(s.x, s.y);
      const pad = s.radius * TILE_W + 140;
      if (cc.x < wx0 - pad || cc.x > wx1 + pad || cc.y < wy0 - pad || cc.y > wy1 + pad) continue;
      for (const b of [...s.buildings, ...s.construction]) {
        const e = elevAt(w, b.x, b.y);
        const p = gridToScreen(b.x, b.y);
        const by = p.y - e * ELEV_H;
        if (p.x < wx0 - 100 || p.x > wx1 + 100 || by < wy0 - 160 || by > wy1 + 140) continue;
        ds.push({
          depth: b.x + b.y + (b.kind === BuildingKind.Farm ? -0.4 : 0),
          draw: () => drawBuilding(c, w, b, p.x, by, 0, lod, night),
        });
      }
    }
    ds.sort((a, b) => a.depth - b.depth);
    for (const d of ds) d.draw();
    this.cachedLights = collectLights();
    return cv;
  }

  /** 分块缓存档位对应的缩放比 */
  private terrainCacheScaleOf(tier: number): number {
    return tier === 0 ? 0.22 : tier === 1 ? 0.45 : 0.8;
  }

  /** 摄像机钳制在世界范围内（巨大世界的硬边界） */
  private clampCamera(w: WorldState, W: number, H: number) {
    const size = w.gen.size;
    const worldW = size * TILE_W;
    const worldH = size * TILE_H + ELEV_H * 8;
    const margX = W / this.camera.zoom * 0.35;
    const margY = H / this.camera.zoom * 0.35;
    const minX = -worldW / 2 - margX, maxX = worldW / 2 + margX;
    const minY = -margY * 0.6, maxY = worldH + margY;
    this.camera.x = clamp(this.camera.x, minX, maxX);
    this.camera.y = clamp(this.camera.y, minY, maxY);
    this.camera.targetX = clamp(this.camera.targetX, minX, maxX);
    this.camera.targetY = clamp(this.camera.targetY, minY, maxY);
  }

  /** 云影漂移 + 偶发雁阵 */
  private updateEnv(dt: number, W: number, H: number) {
    for (const c of this.clouds) {
      c.x += c.s * dt * 0.12;
      if (c.x * W - c.r > W) c.x = -c.r / W;
    }
    if (this.birds.length === 0 && Math.random() < dt * 0.02) {
      const fromLeft = Math.random() > 0.5;
      const y = 30 + Math.random() * (H * 0.4);
      const n = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        this.birds.push({
          x: fromLeft ? -30 - i * 18 : W + 30 + i * 18,
          y: y + Math.sin(i * 1.3) * 14,
          vx: (fromLeft ? 1 : -1) * (46 + Math.random() * 18),
          vy: (Math.random() - 0.3) * 8,
          ph: Math.random() * Math.PI * 2,
          life: 40,
        });
      }
    }
    for (const b of this.birds) {
      b.x += b.vx * dt;
      b.y += b.vy * dt + Math.sin(b.ph) * 0.2;
      b.ph += dt * 9;
      b.life -= dt;
    }
    this.birds = this.birds.filter(b => b.life > 0);
  }

  private drawBirds(ctx: CanvasRenderingContext2D, dt: number, W: number, H: number, paused: number | boolean) {
    if (!this.birds.length) return;
    ctx.strokeStyle = 'rgba(40,44,52,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const b of this.birds) {
      const flap = Math.sin(b.ph) * 3;
      ctx.moveTo(b.x - 4, b.y - flap);
      ctx.quadraticCurveTo(b.x, b.y + 1.6, b.x + 4, b.y - flap);
    }
    ctx.stroke();
    void dt; void W; void H; void paused;
  }

  /** 小地图点击：屏幕坐标 → 网格坐标（返回 null 表示点在小地图外） */
  minimapClick(px: number, py: number): { gx: number; gy: number } | null {
    const r = this.minimapRectCache;
    const rect = this.canvas.getBoundingClientRect();
    const cx = px - rect.left, cy = py - rect.top;
    if (cx < r.x || cy < r.y || cx > r.x + r.w || cy > r.y + r.h) return null;
    const w = this.worldRef!;
    const relX = (cx - r.x) / r.w, relY = (cy - r.y) / r.h;
    const win = this.minimapWindow(w);
    const gx = Math.round(win.x0 + relX * win.span);
    const gy = Math.round(win.y0 + relY * win.span);
    return { gx: clamp(gx, 2, w.gen.size - 3), gy: clamp(gy, 2, w.gen.size - 3) };
  }

  /** 小地图窗口（以摄像机为中心的局部区域） */
  private minimapWindow(w: WorldState) {
    const span = 224; // 覆盖 224×224 格
    const g = screenToGrid(this.camera.x, this.camera.y);
    return { x0: g.x - span / 2, y0: g.y - span / 2, span, cx: g.x, cy: g.y };
  }

  private drawMinimap(w: WorldState, W: number, H: number, time: number) {
    if (!this.minimap) return;
    const size = w.gen.size;
    const win = this.minimapWindow(w);
    const imgW = 112; // 迷你像素分辨率（2 格 1 px）
    const interval = 1200;

    const moved = Math.hypot(win.cx - this.lastMinimapCenter.x, win.cy - this.lastMinimapCenter.y);
    if (time - this.lastMinimapDraw > interval || moved > 5 || this.minimapChunkCount !== w.chunks.size || this.minimapDirty) {
      this.lastMinimapDraw = time;
      this.minimapDirty = false;
      this.lastMinimapCenter = { x: win.cx, y: win.cy };
      this.minimapChunkCount = w.chunks.size;
      const mc = this.minimap.getContext('2d')!;
      if (this.minimap.width !== imgW) { this.minimap.width = imgW; this.minimap.height = imgW; }
      const img = mc.createImageData(imgW, imgW);
      const d = img.data;
      // 领土色缓存（owner → 文明色）
      const ownerColor = new Map<number, [number, number, number]>();
      for (let py = 0; py < imgW; py++) {
        for (let px = 0; px < imgW; px++) {
          const gx = Math.round(win.x0 + (px / (imgW - 1)) * win.span);
          const gy = Math.round(win.y0 + (py / (imgW - 1)) * win.span);
          const i = (py * imgW + px) * 4;
          const t = peekTile(w, gx, gy);
          if (!t) {
            // 未探索迷雾（深色）
            d[i] = 16; d[i + 1] = 22; d[i + 2] = 24; d[i + 3] = 235;
            continue;
          }
          let c = minimapRGB(t);
          if (t.owner >= 0) {
            let oc = ownerColor.get(t.owner);
            if (!oc) {
              const st = w.settlements.find(s => s.id === t.owner);
              const civ = st ? w.civs[st.civId] : undefined;
              oc = civ ? hexToRgb(civ.color) : [255, 214, 110];
              ownerColor.set(t.owner, oc);
            }
            c = [Math.round(c[0] * 0.55 + oc[0] * 0.45), Math.round(c[1] * 0.55 + oc[1] * 0.45), Math.round(c[2] * 0.55 + oc[2] * 0.45)];
          }
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      mc.putImageData(img, 0, 0);
      // 聚落点（文明色 + 白描边；窗口外不画）
      for (const s of w.settlements) {
        const sx = Math.round(((s.x - win.x0) / win.span) * (imgW - 1));
        const sy = Math.round(((s.y - win.y0) / win.span) * (imgW - 1));
        if (sx < 1 || sy < 1 || sx > imgW - 2 || sy > imgW - 2) continue;
        const civ = w.civs[s.civId];
        mc.fillStyle = s.dead ? '#8a8a8a' : (civ?.color ?? '#ffd66e');
        mc.fillRect(sx - 1, sy - 1, 3, 3);
        if (s.population > 400) {
          mc.strokeStyle = 'rgba(255,255,255,0.85)';
          mc.lineWidth = 0.8;
          mc.strokeRect(sx - 2.5, sy - 2.5, 5, 5);
        }
      }
    }

    const ctx = this.ctx;
    const mmW = 148, mmH = 148;
    const ox = W - mmW - 14, oy = H - mmH - 14;
    this.minimapRectCache = { x: ox, y: oy, w: mmW, h: mmH };
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox - 5, oy - 5, mmW + 10, mmH + 10);
    ctx.clip();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(16,22,24,0.85)';
    roundRect(ctx, ox - 5, oy - 5, mmW + 10, mmH + 10, 8);
    ctx.fill();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.minimap, ox, oy, mmW, mmH);

    // —— 视口多边形（修复：屏幕四角 → 网格 → 小地图像素，绘制真实视口形状）——
    const rect = this.canvas.getBoundingClientRect();
    const corners: [number, number][] = [
      [rect.left, rect.top], [rect.right, rect.top],
      [rect.right, rect.bottom], [rect.left, rect.bottom],
    ];
    const mmPts: [number, number][] = corners.map(([sx, sy]) => {
      const wx = (sx - rect.left - rect.width / 2) / this.camera.zoom + this.camera.x;
      const wy = (sy - rect.top - rect.height / 2) / this.camera.zoom + this.camera.y;
      const g = screenToGrid(wx, wy + TILE_H / 2);
      return [
        ox + ((g.x - win.x0) / win.span) * mmW,
        oy + ((g.y - win.y0) / win.span) * mmH,
      ];
    });
    ctx.strokeStyle = 'rgba(242,234,214,0.92)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(mmPts[0][0], mmPts[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(mmPts[i][0], mmPts[i][1]);
    ctx.closePath();
    ctx.stroke();

    // 摄像机中心十字
    const ccx = ox + ((win.cx - win.x0) / win.span) * mmW;
    const ccy = oy + ((win.cy - win.y0) / win.span) * mmH;
    ctx.strokeStyle = 'rgba(242,234,214,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ccx - 4, ccy); ctx.lineTo(ccx + 4, ccy);
    ctx.moveTo(ccx, ccy - 4); ctx.lineTo(ccx, ccy + 4);
    ctx.stroke();

    // 标题
    ctx.font = '600 10px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(242,234,214,0.75)';
    ctx.fillText(`区域图 · ${Math.round(win.cx)},${Math.round(win.cy)}`, ox - 2, oy - 10);
    ctx.restore();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

/** 道路运行时几何缓存（聚落级；道路数量变化时重建） */
const roadCache = new WeakMap<Settlement, { n: number; pts: number[] }>();

function roadGeom(w: WorldState, s: Settlement): number[] {
  let c = roadCache.get(s);
  if (!c || c.n !== s.roads.size) {
    const size = w.gen.size;
    const pts: number[] = [];
    for (const idx of s.roads) {
      const x = idx % size, y = Math.floor(idx / size);
      const e = elevAt(w, x, y);
      if (e > 4) continue;
      const p = gridToScreen(x, y);
      pts.push(p.x, p.y - e * ELEV_H);
    }
    c = { n: s.roads.size, pts };
    roadCache.set(s, c);
  }
  return c.pts;
}

/** 道路绘制：视口内可见聚落的土路（几何缓存 + 聚落级 + 世界坐标双重裁剪） */
function drawRoads(ctx: CanvasRenderingContext2D, w: WorldState, x0: number, x1: number, y0: number, y1: number, wx0 = -1e9, wx1 = 1e9, wy0 = -1e9, wy1 = 1e9) {
  const size = w.gen.size;
  ctx.fillStyle = 'rgba(128,102,66,0.55)';
  for (const s of w.settlements) {
    if (s.dead || s.roads.size === 0) continue;
    // 聚落包围盒粗裁剪（按半径扩展）
    if (s.x < x0 - 24 || s.x > x1 + 24 || s.y < y0 - 24 || s.y > y1 + 24) continue;
    const pts = roadGeom(w, s);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const pxx = pts[i], pyy = pts[i + 1];
      // 世界坐标视口裁剪（跳过视口外的路格）
      if (pxx < wx0 || pxx > wx1 || pyy < wy0 - 40 || pyy > wy1 + 60) continue;
      ctx.moveTo(pxx, pyy - TILE_H * 0.28);
      ctx.lineTo(pxx + TILE_W * 0.28, pyy);
      ctx.lineTo(pxx, pyy + TILE_H * 0.28);
      ctx.lineTo(pxx - TILE_W * 0.28, pyy);
      ctx.closePath();
    }
    ctx.fill();
  }
  void size;
}

function minimapRGB(t: { terrain: Terrain; ore: boolean; elevation: number }): [number, number, number] {
  switch (t.terrain) {
    case Terrain.Water: return [62, 110, 148];
    case Terrain.Grass: return [108, 142, 84];
    case Terrain.Fertile: return [164, 144, 78];
    case Terrain.Forest: return [52, 88, 58];
    case Terrain.Hills: return [140, 142, 102];
    case Terrain.Mountain: return [120, 112, 102];
    case Terrain.Rock: return t.ore ? [196, 150, 64] : [132, 126, 118];
    case Terrain.Sand: return [214, 191, 140];
    case Terrain.Tundra: return [198, 206, 202];
    default: return [0, 0, 0];
  }
}

function drawRain(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, time: number) {
  const n = 3;
  ctx.strokeStyle = 'rgba(180,210,235,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const phase = ((time * 0.0012) + vhash(x, y, i) * 8) % 1;
    const ox = (vhash(x, y, 10 + i) - 0.5) * TILE_W * 0.8;
    const yy = sy - 14 + phase * 22;
    ctx.moveTo(sx + ox, yy);
    ctx.lineTo(sx + ox - 2, yy + 6);
  }
  ctx.stroke();
}

function drawDrought(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  ctx.fillStyle = 'rgba(216,160,80,0.16)';
  ctx.beginPath();
  ctx.moveTo(sx, sy - TILE_H / 2 + 2);
  ctx.lineTo(sx + TILE_W / 2 - 3, sy);
  ctx.lineTo(sx, sy + TILE_H / 2 - 2);
  ctx.lineTo(sx - TILE_W / 2 + 3, sy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,190,120,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx - 10, sy - 4);
  ctx.quadraticCurveTo(sx, sy - 8, sx + 10, sy - 4);
  ctx.stroke();
}

function drawBlessing(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number) {
  for (let i = 0; i < 8; i++) {
    const phase = ((time * 0.0006) + i / 8) % 1;
    const ang = i * 0.785 + phase * 2;
    const r = 14 + phase * 26;
    const x = sx + Math.cos(ang) * r * 1.6;
    const y = sy - 20 - phase * 30;
    ctx.fillStyle = `rgba(232,196,98,${(1 - phase) * 0.75})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + (1 - phase) * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBrushCursor(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string, time: number) {
  const pulse = 0.75 + Math.sin(time * 0.005) * 0.25;
  const tiles: { x: number; y: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius + radius * 0.5) tiles.push({ x: cx + dx, y: cy + dy });
    }
  }
  ctx.save();
  ctx.globalAlpha = 0.28 * pulse + 0.2;
  ctx.fillStyle = color;
  for (const t of tiles) {
    const p = gridToScreen(t.x, t.y);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - TILE_H / 2);
    ctx.lineTo(p.x + TILE_W / 2, p.y);
    ctx.lineTo(p.x, p.y + TILE_H / 2);
    ctx.lineTo(p.x - TILE_W / 2, p.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const p = gridToScreen(cx, cy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - TILE_H / 2);
  ctx.lineTo(p.x + TILE_W / 2, p.y);
  ctx.lineTo(p.x, p.y + TILE_H / 2);
  ctx.lineTo(p.x - TILE_W / 2, p.y);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
