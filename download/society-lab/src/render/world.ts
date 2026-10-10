/**
 * VisualWorld — 世界渲染与摄像机（v3.0）
 * 画布分层职责：地形（缓存贴图或近景逐格）→ 印记（坟墓/陨坑）→ 领地边界
 * → 建筑与小人（统一 y 排序，海拔感知）→ 事件特效 → 天气 →
 * 昼夜暗幕 → 灯火合成层（窗光/篝火）→ 聚落标签 → 笔刷 → 云影 → 小地图。
 * 视口裁剪 + LOD + 地形缓存保证大地图流畅。
 */
import { Terrain, BuildingKind, type WorldState, type Settlement } from '../types';
import { CFG } from '../config';
import { TILE_W, TILE_H, ELEV_H, gridToScreen, screenToGrid, vhash, clamp, elevAt } from './iso';
import { drawBorders, TerrainCache } from './terrain';
import { drawBuilding, beginLights, collectLights } from './buildings';
import { AgentSystem, daySlot, nightFactor } from './agents';
import { EffectSystem } from './effects';
import { drawDecals } from '../decals';

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
  private clouds: Cloud[] = [];
  private birds: Bird[] = [];
  private lastMinimapDraw = 0;
  flashOverlay: { color: string; alpha: number } | null = null;

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

  centerOnMap(size: number) {
    this.fitMap(size);
  }

  /** 全景：把整张地图装进取景框（v2.0 默认视角） */
  fitMap(size: number) {
    const rect = this.canvas.getBoundingClientRect();
    const W = Math.max(320, rect.width), H = Math.max(240, rect.height);
    const worldW = size * TILE_W, worldH = size * TILE_H + ELEV_H * 10;
    const zoom = Math.min(W / worldW, H / worldH) * 0.96;
    this.camera.targetZoom = zoom;
    this.camera.targetX = 0;
    this.camera.targetY = (size * TILE_H) / 2;
    this.camera.zoom = zoom;
    this.camera.x = 0;
    this.camera.y = (size * TILE_H) / 2;
  }

  focusSettlement(s: Settlement) {
    const p = gridToScreen(s.x, s.y);
    this.camera.targetX = p.x;
    this.camera.targetY = p.y - elevAt(this.worldRef!, s.x, s.y) * ELEV_H;
    this.camera.targetZoom = Math.max(this.camera.zoom, 1.6);
    this.addPing(s.x, s.y, 'rgba(201,162,39,0.9)');
  }
  private worldRef: WorldState | null = null;

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
    // 摄像机平滑
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * Math.min(1, dt * 8);
    this.camera.x += (this.camera.targetX - this.camera.x) * Math.min(1, dt * 8);
    this.camera.y += (this.camera.targetY - this.camera.y) * Math.min(1, dt * 8);
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
    this.agents.update(w, Math.min(0.05, dt), dayPhase, paused);

    // 背景桌台色（夜里更深）
    const deskR = 32 - night * 10, deskG = 48 - night * 14, deskB = 44 - night * 12;
    ctx.fillStyle = `rgb(${deskR | 0},${deskG | 0},${deskB | 0})`;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const size = w.config.size;
    const halfW = W / 2 / cam.zoom, halfH = H / 2 / cam.zoom;
    const wx0 = cam.x - halfW - 80, wx1 = cam.x + halfW + 80;
    const wy0 = cam.y - halfH - 140, wy1 = cam.y + halfH + 180;

    const lod = cam.zoom;
    const useCache = lod < 0.8;
    const inView = (sx: number, sy: number) => sx > wx0 - 100 && sx < wx1 + 100 && sy > wy0 - 160 && sy < wy1 + 140;

    const gmin = screenToGrid(wx0 - TILE_W, wy0 - TILE_H * 2);
    const gmax = screenToGrid(wx1 + TILE_W, wy1 + TILE_H * 2);
    const x0 = clamp(Math.floor(gmin.x) - 1, 0, size - 1);
    const x1 = clamp(Math.ceil(gmax.x) + 1, 0, size - 1);
    const y0 = clamp(Math.floor(gmin.y) - 1, 0, size - 1);
    const y1 = clamp(Math.ceil(gmax.y) + 1, 0, size - 1);

    // 1) 地形：远景/近景均贴静态缓存（性能核心）；近景之上叠加水波动画
    if (useCache) {
      this.terrainCache.blit(ctx, w);
    } else {
      this.terrainCache.blitHi(ctx, w);
      // 可见水面波光（动画层）
      if (lod > 0.55) {
        ctx.fillStyle = 'rgba(210,235,248,0.10)';
        for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
          for (let x = Math.max(x0, sum - y1); x <= Math.min(x1, sum - y0); x++) {
            const y = sum - x;
            if (y < y0 || y > y1) continue;
            const t = w.tiles[y * size + x];
            if (t.terrain !== Terrain.Water) continue;
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
    }

    // 2) 持久印记（坟墓/陨坑/焦痕/废墟；视口裁剪 + 批量绘制）
    drawDecals(ctx, w, lod, (sx, sy) => inView(sx, sy));

    // 3) 领地边界
    if (lod > 0.55) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = gridToScreen(x, y);
          drawBorders(ctx, w, x, y, p.x, p.y);
        }
      }
    }

    // 4) 建筑与小人（统一 y 排序；海拔感知：站地表面）
    beginLights();
    interface Drawable { depth: number; draw: () => void }
    const drawables: Drawable[] = [];

    for (const s of w.settlements) {
      const all = [...s.buildings, ...s.construction];
      for (const b of all) {
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

    // 小人：远景批量绘制（性能核心）；近景逐个 y 排序绘制
    this.agents.resetDetailBudget();
    const batchFar = lod < 1.5;
    if (!batchFar) {
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
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw();
    // 远景：小人批量绘制（在建筑之后，颜色分组单次填充）
    if (batchFar) this.agents.drawBatched(ctx, w, night, time);

    // 5) 天气（雨/旱的区域视觉）
    if (lod > 0.35) {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const cell = w.weather[y * size + x];
          if (Math.abs(cell.wet) < 0.25) continue;
          const p = gridToScreen(x, y);
          if (cell.wet > 0.25) drawRain(ctx, x, y, p.x, p.y, time);
          else drawDrought(ctx, p.x, p.y);
        }
      }
    }

    // 6) 事件特效
    this.fx.draw(ctx, w, time);

    // 7) 祝福特效
    for (const s of w.settlements) {
      if (s.dead || !s.effects.some(e => e.kind === 'blessing')) continue;
      const p = gridToScreen(s.x, s.y);
      if (!inView(p.x, p.y)) continue;
      drawBlessing(ctx, p.x, p.y, time);
    }

    // 8) 事件 ping
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

    // 9) 灯火（在暗幕之下先收集完，之后再叠加）
    ctx.restore();

    // 10) 昼夜暗幕（屏幕空间；微缩沙盘不至于全黑）
    if (night > 0.02) {
      const a = night * 0.44;
      const grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, `rgba(14,20,44,${a.toFixed(3)})`);
      grd.addColorStop(0.6, `rgba(16,24,52,${(a * 0.9).toFixed(3)})`);
      grd.addColorStop(1, `rgba(10,16,40,${(a * 0.8).toFixed(3)})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    }

    // 11) 灯火合成层（窗光/篝火/火把，叠加在暗幕之上）
    if (night > 0.22 && lod > 0.5) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      ctx.globalCompositeOperation = 'lighter';
      for (const L of collectLights()) {
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

    // 12) 全局雨幕氛围
    let rainTiles = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      if (w.weather[y * size + x]?.wet > 0.5) rainTiles++;
    }
    if (rainTiles > 8) {
      ctx.fillStyle = `rgba(40,70,100,${Math.min(0.14, rainTiles * 0.002)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 13) 闪光反馈（神力/闪电）
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

    // 14) 云影（缓慢漂移的大块软影）
    for (const c of this.clouds) {
      const cx = c.x * W, cy = c.y * H;
      ctx.fillStyle = `rgba(24,32,44,${c.a})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, c.r, c.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 15) 飞鸟（屏幕空间掠过的雁阵）
    this.drawBirds(ctx, dt, W, H, paused);

    // 16) 笔刷光标
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

    // 17) 聚落标签（纯屏幕空间：字号恒定 + 防重叠）
    type Label = { sx: number; sy: number; text: string; strong: boolean; pop: number };
    const labels: Label[] = [];
    for (const s of w.settlements) {
      const p = gridToScreen(s.x, s.y);
      if (!inView(p.x, p.y)) continue;
      const sx = (p.x - cam.x) * cam.zoom + W / 2;
      const sy = (p.y - cam.y) * cam.zoom + H / 2;
      const text = s.dead ? '废墟' : `${s.name} · ${s.population}人`;
      labels.push({ sx, sy: sy - 14, text, strong: !s.dead, pop: s.dead ? 0 : s.population });
    }
    labels.sort((a, b) => b.pop - a.pop);
    ctx.font = '600 12px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
    const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const l of labels) {
      const wpx = ctx.measureText(l.text).width + 14;
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
      ctx.fillStyle = l.strong ? '#f2ead6' : '#b8b0a4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, 0, -13);
      ctx.restore();
    }

    // 18) 时段角标（清晨/白昼/黄昏/夜晚）
    const slotName = ['夜', '晨', '昼', '暮'][daySlot(dayPhase)];
    ctx.font = '600 11px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(24,32,28,0.55)';
    roundRect(ctx, 12, H - 30, 64, 20, 8);
    ctx.fill();
    ctx.fillStyle = night > 0.4 ? '#9aa8c8' : '#e8dfc8';
    ctx.fillText(`${slotName} · ${night > 0.4 ? '入夜' : '天光'}`, 20, H - 19);

    // 小地图
    this.drawMinimap(w, W, H, time);
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

  private drawMinimap(w: WorldState, W: number, H: number, time: number) {
    if (!this.minimap) return;
    const size = w.config.size;
    const interval = size > 72 ? 1400 : 700;
    if (time - this.lastMinimapDraw > interval || this.minimapDirty) {
      this.lastMinimapDraw = time;
      this.minimapDirty = false;
      const mc = this.minimap.getContext('2d')!;
      if (this.minimap.width !== size) { this.minimap.width = size; this.minimap.height = size; }
      const img = mc.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const t = w.tiles[y * size + x];
          const c = minimapRGB(t);
          const i = (y * size + x) * 4;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      mc.putImageData(img, 0, 0);
      for (const s of w.settlements) {
        mc.fillStyle = s.dead ? '#8a8a8a' : '#ffd66e';
        mc.fillRect(s.x - 1, s.y - 1, 3, 3);
      }
    }
    const ctx = this.ctx;
    const mmW = 148, mmH = 148;
    const ox = W - mmW - 14, oy = H - mmH - 14;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox - 5, oy - 5, mmW + 10, mmH + 10);
    ctx.clip();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(24,30,28,0.8)';
    roundRect(ctx, ox - 5, oy - 5, mmW + 10, mmH + 10, 8);
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimap, ox, oy, mmW, mmH);
    const halfW = W / 2 / this.camera.zoom, halfH = H / 2 / this.camera.zoom;
    const c = {
      mx: ox + mmW / 2 + this.camera.x * (mmW / (size * TILE_W)) * 2,
      my: oy + this.camera.y * (mmH / (size * TILE_H)) * 2,
    };
    const vw = halfW * 2 * (mmW / (size * TILE_W)) * 2;
    const vh = halfH * 2 * (mmH / (size * TILE_H)) * 2;
    ctx.strokeStyle = 'rgba(242,234,214,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.mx - vw / 2, c.my - vh / 2, vw, vh);
    ctx.restore();
  }
}

function minimapRGB(t: { terrain: Terrain; ore: boolean }): [number, number, number] {
  switch (t.terrain) {
    case Terrain.Water: return [62, 110, 148];
    case Terrain.Grass: return [108, 142, 84];
    case Terrain.Fertile: return [164, 144, 78];
    case Terrain.Forest: return [52, 88, 58];
    case Terrain.Hills: return [140, 142, 102];
    case Terrain.Mountain: return [120, 112, 102];
    case Terrain.Rock: return t.ore ? [196, 150, 64] : [132, 126, 118];
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
  const c = gridToScreen(cx, cy);
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
