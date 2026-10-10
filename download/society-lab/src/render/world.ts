/**
 * VisualWorld — 世界渲染与摄像机
 * 画布分层职责：地形（含侧壁/细节）→ 领地边界 → 农田与建筑/小人（y 排序）
 * → 天气粒子 → 祝福与事件特效 → 聚落标签 → 笔刷光标。
 * 视口裁剪 + LOD 保证大地图流畅。
 */
import { Terrain, BuildingKind, type WorldState, type Settlement } from '../types';
import { TILE_W, TILE_H, ELEV_H, gridToScreen, screenToGrid, vhash, clamp } from './iso';
import { drawTile, drawBorders } from './terrain';
import { drawBuilding } from './buildings';
import { spawnVillagers, updateVillagers, drawVillagers, type Villager } from './villagers';

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

export class VisualWorld {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  villagers = new Map<number, Villager[]>();
  pings: Ping[] = [];
  hoverTile: { x: number; y: number } | null = null;
  brushRadius = 1;
  brushColor = 'rgba(47,126,118,0.7)';
  minimap: HTMLCanvasElement | null = null;
  minimapDirty = true;
  private lastMinimapDraw = 0;
  flashOverlay: { color: string; alpha: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = { x: 0, y: 0, zoom: 1.15, targetZoom: 1.15, targetX: 0, targetY: 0 };
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
    this.camera.x = this.camera.targetX = 0;
    this.camera.y = this.camera.targetY = size * TILE_H / 2;
  }

  focusSettlement(s: Settlement) {
    const p = gridToScreen(s.x, s.y);
    this.camera.targetX = p.x;
    this.camera.targetY = p.y;
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
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    // 摄像机平滑
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * Math.min(1, dt * 8);
    this.camera.x += (this.camera.targetX - this.camera.x) * Math.min(1, dt * 8);
    this.camera.y += (this.camera.targetY - this.camera.y) * Math.min(1, dt * 8);
    const cam = this.camera;

    // 背景桌台色
    ctx.fillStyle = '#20302c';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const size = w.config.size;
    // 视口世界像素范围
    const halfW = W / 2 / cam.zoom, halfH = H / 2 / cam.zoom;
    const wx0 = cam.x - halfW - 80, wx1 = cam.x + halfW + 80;
    const wy0 = cam.y - halfH - 120, wy1 = cam.y + halfH + 160;

    const lod = cam.zoom;

    // 可见格范围（近似矩形，宽松）
    const gmin = screenToGrid(wx0 - TILE_W, wy0 - TILE_H * 2);
    const gmax = screenToGrid(wx1 + TILE_W, wy1 + TILE_H * 2);
    const x0 = clamp(Math.floor(gmin.x) - 1, 0, size - 1);
    const x1 = clamp(Math.ceil(gmax.x) + 1, 0, size - 1);
    const y0 = clamp(Math.floor(gmin.y) - 1, 0, size - 1);
    const y1 = clamp(Math.ceil(gmax.y) + 1, 0, size - 1);

    // 1) 地形（按 x+y 顺序保证侧壁遮挡正确）
    for (let sum = x0 + y0; sum <= x1 + y1; sum++) {
      for (let x = Math.max(x0, sum - y1); x <= Math.min(x1, sum - y0); x++) {
        const y = sum - x;
        if (y < y0 || y > y1) continue;
        const t = w.tiles[y * size + x];
        const p = gridToScreen(x, y);
        drawTile(ctx, w, x, y, p.x, p.y, time, lod);
      }
    }

    // 2) 领地边界
    if (lod > 0.6) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = gridToScreen(x, y);
          drawBorders(ctx, w, x, y, p.x, p.y);
        }
      }
    }

    // 3) 建筑与小人（统一 y 排序）
    interface Drawable { depth: number; draw: () => void }
    const drawables: Drawable[] = [];
    const inView = (sx: number, sy: number) => sx > wx0 - 80 && sx < wx1 + 80 && sy > wy0 - 120 && sy < wy1 + 100;

    for (const s of w.settlements) {
      const all = [...s.buildings, ...s.construction];
      for (const b of all) {
        const p = gridToScreen(b.x, b.y);
        if (!inView(p.x, p.y)) continue;
        drawables.push({
          depth: b.x + b.y + (b.kind === BuildingKind.Farm ? -0.4 : 0),
          draw: () => drawBuilding(ctx, w, b, p.x, p.y, time, lod),
        });
      }
    }

    for (const s of w.settlements) {
      if (s.dead) {
        // 废墟标记
        const p = gridToScreen(s.x, s.y);
        if (inView(p.x, p.y)) {
          drawables.push({
            depth: s.x + s.y,
            draw: () => {
              ctx.fillStyle = 'rgba(70,60,50,0.5)';
              for (let i = 0; i < 4; i++) {
                const a = i * 1.7 + 0.5;
                ctx.fillRect(p.x + Math.cos(a) * 10 - 3, p.y + Math.sin(a) * 5 - 2, 6, 4);
              }
            },
          });
        }
        this.villagers.delete(s.id);
        continue;
      }
      let list = this.villagers.get(s.id);
      const want = spawnCountFor(s);
      if (!list) {
        list = spawnVillagers(s);
        this.villagers.set(s.id, list);
      } else if (list.length !== want) {
        // 人口变化 → 重新生成
        list = spawnVillagers(s);
        this.villagers.set(s.id, list);
      }
      if (!paused || Math.random() < 0.5) updateVillagers(list, s, Math.min(0.05, dt));
      const vp = gridToScreen(s.x, s.y);
      if (inView(vp.x - 60, vp.y - 60) || inView(vp.x + 60, vp.y + 60)) {
        drawables.push({
          depth: 1e9 + s.id, // 小人最后画，避免被建筑完全遮挡的边界情况
          draw: () => drawVillagers(ctx, list!, time, lod),
        });
      }
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw();

    // 4) 天气（雨/旱的区域视觉）
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

    // 5) 祝福特效（聚落上空金色微光）
    for (const s of w.settlements) {
      if (s.dead || !s.effects.some(e => e.kind === 'blessing')) continue;
      const p = gridToScreen(s.x, s.y);
      if (!inView(p.x, p.y)) continue;
      drawBlessing(ctx, p.x, p.y, time);
    }

    // 6) 事件 ping
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

    ctx.restore();

    // 7) 全局雨幕氛围（屏幕空间）
    let rainTiles = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      if (w.weather[y * size + x]?.wet > 0.5) rainTiles++;
    }
    if (rainTiles > 8) {
      ctx.fillStyle = `rgba(40,70,100,${Math.min(0.14, rainTiles * 0.002)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 8) 闪光反馈（神力释放瞬间）
    if (this.flashOverlay && this.flashOverlay.alpha > 0.01) {
      ctx.fillStyle = this.flashOverlay.color.replace('$a', String(this.flashOverlay.alpha));
      ctx.fillRect(0, 0, W, H);
      this.flashOverlay.alpha *= Math.pow(0.02, dt);
    }

    // 9) 笔刷光标
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

    // 10) 聚落标签（屏幕空间，字号不随缩放过小）
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    const labelScale = clamp(1 / cam.zoom * 0.9, 0.55, 1.1);
    for (const s of w.settlements) {
      const p = gridToScreen(s.x, s.y);
      if (!inView(p.x, p.y)) continue;
      if (s.dead) {
        drawLabel(ctx, p.x, p.y - 40, '废墟', labelScale, 'rgba(120,110,100,0.85)', '#b8b0a4');
        continue;
      }
      drawLabel(ctx, p.x, p.y - 44, `${s.name} · ${s.population}人`, labelScale,
        'rgba(28,38,34,0.62)', '#f2ead6', true);
    }
    ctx.restore();

    // 小地图
    this.drawMinimap(w, W, H, time);
  }

  private drawMinimap(w: WorldState, W: number, H: number, time: number) {
    if (!this.minimap) return;
    const size = w.config.size;
    if (time - this.lastMinimapDraw > 700 || this.minimapDirty) {
      this.lastMinimapDraw = time;
      this.minimapDirty = false;
      const mc = this.minimap.getContext('2d')!;
      const scale = this.minimap.width / size;
      mc.clearRect(0, 0, this.minimap.width, this.minimap.height);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const t = w.tiles[y * size + x];
          mc.fillStyle = minimapColor(t);
          mc.fillRect(x * scale, y * scale, scale + 0.5, scale + 0.5);
        }
      }
      for (const s of w.settlements) {
        mc.fillStyle = s.dead ? '#8a8a8a' : '#ffd66e';
        mc.fillRect(s.x * scale - 1, s.y * scale - 1, 3, 3);
      }
    }
    // 把小地图绘制到主画布右下角 + 视口框
    const ctx = this.ctx;
    const mmW = 148 * (size / 48), mmH = 148 * (size / 48);
    const ox = W - mmW - 14, oy = H - mmH - 14;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(24,30,28,0.8)';
    roundRect(ctx, ox - 5, oy - 5, mmW + 10, mmH + 10, 8);
    ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimap, ox, oy, mmW, mmH);
    // 视口框
    const halfW = W / 2 / this.camera.zoom, halfH = H / 2 / this.camera.zoom;
    const scale = mmW / (size * TILE_W) * 1; // 世界x范围：±size*TW/2
    const worldToMini = (wx: number, wy: number) => ({
      mx: ox + mmW / 2 + wx * (mmW / (size * TILE_W)) * 2,
      my: oy + wy * (mmH / (size * TILE_H)) * 2,
    });
    const c = worldToMini(this.camera.x, this.camera.y);
    const vw = halfW * 2 * (mmW / (size * TILE_W)) * 2;
    const vh = halfH * 2 * (mmH / (size * TILE_H)) * 2;
    ctx.strokeStyle = 'rgba(242,234,214,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.mx - vw / 2, c.my - vh / 2, vw, vh);
    ctx.restore();
  }
}

function spawnCountFor(s: Settlement): number {
  if (s.dead || s.population <= 0) return 0;
  return Math.max(4, Math.min(42, Math.round(s.population * 0.055)));
}

function minimapColor(t: { terrain: Terrain; ore: boolean }): string {
  switch (t.terrain) {
    case Terrain.Water: return 'rgb(62,110,148)';
    case Terrain.Grass: return 'rgb(108,142,84)';
    case Terrain.Fertile: return 'rgb(164,144,78)';
    case Terrain.Forest: return 'rgb(52,88,58)';
    case Terrain.Hills: return 'rgb(140,142,102)';
    case Terrain.Mountain: return 'rgb(120,112,102)';
    case Terrain.Rock: return t.ore ? 'rgb(196,150,64)' : 'rgb(132,126,118)';
    default: return 'rgb(0,0,0)';
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
  // 热浪线
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
  // 中心格描边
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

function drawLabel(
  ctx: CanvasRenderingContext2D, x: number, y: number, text: string,
  scale: number, bg: string, fg: string, strong = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = `${strong ? '600 ' : ''}12px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  const wpx = ctx.measureText(text).width + 14;
  ctx.fillStyle = bg;
  roundRect(ctx, -wpx / 2, -22, wpx, 17, 8);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, -13);
  ctx.restore();
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
