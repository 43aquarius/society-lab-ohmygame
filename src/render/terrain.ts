/**
 * VisualWorld 地形渲染 — 精致微缩沙盘风格
 * 每种地形预生成若干色变体；水体含动画波光；高地带侧壁；
 * 视口裁剪 + LOD（远缩略时省略细节）。
 */
import { Terrain, type Tile, type WorldState } from '../types';
import { TILE_W, TILE_H, ELEV_H, vhash } from './iso';

export interface Palette {
  grass: string[];
  fertile: string[];
  forestFloor: string[];
  hills: string[];
  mountain: string[];
  rock: string[];
  water: string[];
  waterDeep: string;
  side: string;
  forestTree: string[];
  snow: string;
  border: string;
}

const hex = (r: number, g: number, b: number) => `rgb(${r | 0},${g | 0},${b | 0})`;
function shades(base: [number, number, number], n: number, jitter: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1) - 0.5) * 2 * jitter;
    out.push(hex(
      Math.max(0, Math.min(255, base[0] * (1 + f))),
      Math.max(0, Math.min(255, base[1] * (1 + f))),
      Math.max(0, Math.min(255, base[2] * (1 + f))),
    ));
  }
  return out;
}

export const PALETTE: Palette = {
  grass: shades([138, 176, 106], 7, 0.09),
  fertile: shades([190, 168, 92], 7, 0.08),
  forestFloor: shades([104, 142, 92], 6, 0.08),
  hills: shades([168, 172, 122], 7, 0.08),
  mountain: shades([141, 133, 120], 6, 0.07),
  rock: shades([156, 150, 140], 6, 0.07),
  water: shades([84, 156, 196], 5, 0.05),
  waterDeep: 'rgb(58,118,160)',
  side: 'rgb(112,88,64)',
  forestTree: ['rgb(48,92,58)', 'rgb(60,106,66)', 'rgb(40,82,52)'],
  snow: 'rgb(244,241,235)',
  border: 'rgba(62,84,60,0.35)',
};

export function tileTopColor(t: Tile, x: number, y: number): string {
  const h = vhash(x, y, 7);
  switch (t.terrain) {
    case Terrain.Grass: return PALETTE.grass[(h * PALETTE.grass.length) | 0];
    case Terrain.Fertile: return PALETTE.fertile[(h * PALETTE.fertile.length) | 0];
    case Terrain.Forest: return PALETTE.forestFloor[(h * PALETTE.forestFloor.length) | 0];
    case Terrain.Hills: return PALETTE.hills[(h * PALETTE.hills.length) | 0];
    case Terrain.Mountain: return PALETTE.mountain[(h * PALETTE.mountain.length) | 0];
    case Terrain.Rock: return PALETTE.rock[(h * PALETTE.rock.length) | 0];
    case Terrain.Water: return PALETTE.water[(h * PALETTE.water.length) | 0];
    default: return PALETTE.grass[0];
  }
}

/**
 * 绘制一个菱形地块（含侧壁与地形细节）。
 * ctx 已应用摄像机变换；wx, wy 为该格中心的世界像素。
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  x: number, y: number,
  wx: number, wy: number,
  time: number,
  lod: number,
) {
  const t = w.tiles[y * w.config.size + x];
  const hw = TILE_W / 2, hh = TILE_H / 2;

  // 水面低于地面
  const waterOffset = t.terrain === Terrain.Water ? 5 : 0;
  const cx = wx, cy = wy - t.elevation * ELEV_H + waterOffset;

  // 侧壁（所有陆地格都有薄土裙边，消除菱形接缝；高海拔更深）
  if (t.terrain !== Terrain.Water) {
    const d = t.elevation >= 1 ? t.elevation * ELEV_H + 3 : 2.5;
    ctx.fillStyle = t.elevation >= 3 ? 'rgb(104,84,66)' : PALETTE.side;
    // 左侧面（底部外扩 1px 防缝）
    ctx.beginPath();
    ctx.moveTo(cx - hw - 0.6, cy);
    ctx.lineTo(cx, cy + hh + 0.4);
    ctx.lineTo(cx, cy + hh + d + 0.4);
    ctx.lineTo(cx - hw - 0.6, cy + d);
    ctx.closePath();
    ctx.fill();
    // 右侧面（更暗）
    ctx.fillStyle = t.elevation >= 3 ? 'rgb(88,70,54)' : 'rgb(94,74,54)';
    ctx.beginPath();
    ctx.moveTo(cx + hw + 0.6, cy);
    ctx.lineTo(cx, cy + hh + 0.4);
    ctx.lineTo(cx, cy + hh + d + 0.4);
    ctx.lineTo(cx + hw + 0.6, cy + d);
    ctx.closePath();
    ctx.fill();
  }

  // 顶面（微扩 0.6px 覆盖抗锯齿接缝）
  const e = 0.6;
  ctx.fillStyle = tileTopColor(t, x, y);
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh - e * 0.5);
  ctx.lineTo(cx + hw + e, cy);
  ctx.lineTo(cx, cy + hh + e * 0.5);
  ctx.lineTo(cx - hw - e, cy);
  ctx.closePath();
  ctx.fill();

  // 地形细节
  switch (t.terrain) {
    case Terrain.Water: {
      // 岸缘过渡（邻陆水域描一圈浅色内边）
      if (lod > 0.4 && w) {
        const size = w.config.size;
        let nearLand = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) { nearLand = true; continue; }
          if (w.tiles[ny * size + nx].terrain !== Terrain.Water) { nearLand = true; break; }
        }
        if (nearLand) {
          ctx.strokeStyle = 'rgba(198,226,238,0.5)';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(cx, cy - hh + 3);
          ctx.lineTo(cx + hw - 5, cy);
          ctx.lineTo(cx, cy + hh - 3);
          ctx.lineTo(cx - hw + 5, cy);
          ctx.closePath();
          ctx.stroke();
        }
      }
      // 波光
      if (lod > 0.55) {
        const ph = time * 0.0011 + vhash(x, y, 3) * Math.PI * 2;
        const a = 0.10 + Math.sin(ph) * 0.07;
        ctx.fillStyle = `rgba(210,235,248,${Math.max(0, a)})`;
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.45, cy - hh * 0.1 + Math.sin(ph) * 2);
        ctx.lineTo(cx + hw * 0.12, cy - hh * 0.34 + Math.cos(ph * 1.3) * 2);
        ctx.lineTo(cx + hw * 0.42, cy + hh * 0.08);
        ctx.lineTo(cx - hw * 0.15, cy + hh * 0.3);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case Terrain.Grass:
      if (lod > 0.8) drawSpeckles(ctx, x, y, cx, cy, 'rgba(96,140,74,0.5)', 3);
      break;
    case Terrain.Fertile:
      if (lod > 0.7) drawFurrows(ctx, cx, cy, vhash(x, y, 11), time);
      break;
    case Terrain.Forest:
      if (lod > 0.45) drawTrees(ctx, x, y, cx, cy);
      else if (lod > 0.3) {
        ctx.fillStyle = PALETTE.forestTree[0];
        ctx.beginPath();
        ctx.ellipse(cx, cy, hw * 0.55, hh * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case Terrain.Hills:
      if (lod > 0.75) drawSpeckles(ctx, x, y, cx, cy, 'rgba(140,140,100,0.4)', 2);
      break;
    case Terrain.Mountain:
      drawMountain(ctx, x, y, cx, cy, lod);
      break;
    case Terrain.Rock:
      if (lod > 0.6) drawRocks(ctx, x, y, cx, cy);
      break;
  }

  // 矿脉标识
  if (t.ore && lod > 0.6) {
    const g = vhash(x, y, 21);
    const px = cx - 8 + g * 16, py = cy - 4 + vhash(x, y, 22) * 8;
    ctx.fillStyle = '#d9a441';
    ctx.beginPath();
    ctx.moveTo(px, py - 4);
    ctx.lineTo(px + 4, py);
    ctx.lineTo(px, py + 3);
    ctx.lineTo(px - 4, py);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,244,200,0.85)';
    ctx.fillRect(px - 1.2, py - 1.6, 2.4, 2.4);
  }
}

function drawSpeckles(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, color: string, n: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const dx = (vhash(x, y, 31 + i) - 0.5) * TILE_W * 0.6;
    const dy = (vhash(x, y, 47 + i) - 0.5) * TILE_H * 0.6;
    ctx.fillRect(cx + dx, cy + dy, 2, 2);
  }
}

function drawFurrows(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, time: number) {
  ctx.strokeStyle = 'rgba(120,96,52,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    const ox = i * 10 * (0.7 + h * 0.3);
    ctx.moveTo(cx - hw2() + ox, cy - hh2() * 0.5 + ox * 0.5);
    ctx.lineTo(cx + ox, cy + hh2() * 0.5 + ox * 0.5 * -1);
  }
  ctx.stroke();
}
const hw2 = () => TILE_W / 2;
const hh2 = () => TILE_H / 2;

function drawTrees(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number) {
  const positions = [[-14, 2], [8, -4], [-2, 8], [12, 8]];
  const n = 2 + ((vhash(x, y, 51) * 3) | 0);
  for (let i = 0; i < n && i < positions.length; i++) {
    const [ox, oy] = positions[i];
    const hgt = 14 + vhash(x, y, 61 + i) * 8;
    const tx = cx + ox, ty = cy + oy;
    // 阴影
    ctx.fillStyle = 'rgba(40,60,40,0.25)';
    ctx.beginPath();
    ctx.ellipse(tx + 2, ty + 3, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 树干
    ctx.fillStyle = 'rgb(94,66,44)';
    ctx.fillRect(tx - 1.5, ty - hgt * 0.4, 3, hgt * 0.45);
    // 树冠（两层）
    ctx.fillStyle = PALETTE.forestTree[(vhash(x, y, 71 + i) * 3) | 0];
    ctx.beginPath();
    ctx.moveTo(tx, ty - hgt);
    ctx.lineTo(tx + 8, ty - hgt * 0.45);
    ctx.lineTo(tx - 8, ty - hgt * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(tx, ty - hgt);
    ctx.lineTo(tx + 4, ty - hgt * 0.5);
    ctx.lineTo(tx - 3, ty - hgt * 0.52);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMountain(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, lod: number) {
  const h = vhash(x, y, 81);
  const hgt = 30 + h * 22;
  const wHalf = 24 + h * 8;
  ctx.fillStyle = 'rgba(52,48,46,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 6, wHalf * 0.9, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 山体：两面
  ctx.fillStyle = 'rgb(156,148,136)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - hgt + 10);
  ctx.lineTo(cx + wHalf, cy + 8);
  ctx.lineTo(cx - wHalf, cy + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgb(128,120,110)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - hgt + 10);
  ctx.lineTo(cx + wHalf, cy + 8);
  ctx.lineTo(cx + wHalf * 0.15, cy + 8);
  ctx.closePath();
  ctx.fill();
  // 雪顶
  if (lod > 0.5) {
    ctx.fillStyle = PALETTE.snow;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hgt + 10);
    ctx.lineTo(cx + wHalf * 0.36, cy - hgt * 0.42);
    ctx.lineTo(cx + wHalf * 0.2, cy - hgt * 0.34);
    ctx.lineTo(cx + wHalf * 0.05, cy - hgt * 0.45);
    ctx.lineTo(cx - wHalf * 0.18, cy - hgt * 0.36);
    ctx.lineTo(cx - wHalf * 0.36, cy - hgt * 0.44);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRocks(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number) {
  for (let i = 0; i < 3; i++) {
    const ox = (vhash(x, y, 91 + i) - 0.5) * 30;
    const oy = (vhash(x, y, 97 + i) - 0.5) * 12;
    const s = 4 + vhash(x, y, 103 + i) * 5;
    ctx.fillStyle = i % 2 ? 'rgb(132,126,118)' : 'rgb(158,152,142)';
    ctx.beginPath();
    ctx.moveTo(cx + ox - s, cy + oy);
    ctx.lineTo(cx + ox - s * 0.3, cy + oy - s * 0.9);
    ctx.lineTo(cx + ox + s * 0.7, cy + oy - s * 0.6);
    ctx.lineTo(cx + ox + s, cy + oy + s * 0.2);
    ctx.closePath();
    ctx.fill();
  }
}

/** 领地边界（低存在感） */
export function drawBorders(ctx: CanvasRenderingContext2D, w: WorldState, x: number, y: number, wx: number, wy: number) {
  const size = w.config.size;
  const t = w.tiles[y * size + x];
  if (t.owner < 0) return;
  const hw = TILE_W / 2, hh = TILE_H / 2;
  const cx = wx, cy = wy - t.elevation * ELEV_H;
  const neighbor = (nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) return -2;
    return w.tiles[ny * size + nx].owner;
  };
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (neighbor(x, y - 1) !== t.owner) {
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
  }
  if (neighbor(x + 1, y) !== t.owner) {
    ctx.moveTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
  }
  if (neighbor(x, y + 1) !== t.owner) {
    ctx.moveTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
  }
  if (neighbor(x - 1, y) !== t.owner) {
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx, cy - hh);
  }
  ctx.stroke();
}
