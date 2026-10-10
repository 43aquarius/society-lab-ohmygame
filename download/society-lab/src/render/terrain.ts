/**
 * VisualWorld 地形渲染 — 精致微缩沙盘风格（v2.0）
 * - 静态地形离屏缓存（半分辨率一次成图），远景直接贴图，支撑 128×128 大地图
 * - 近景（zoom ≥ 0.8）逐格实时绘制：精细树冠 / 山体棱线 / 矿闪 / 花田
 * - 水面：深度渐变 + 岸线泡沫 + 动画波光
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
  forestTree: string[][];
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
  waterDeep: 'rgb(52,104,150)',
  side: 'rgb(112,88,64)',
  forestTree: [
    ['rgb(56,102,62)', 'rgb(40,82,52)', 'rgb(76,120,72)'],   // 阔叶
    ['rgb(46,96,66)', 'rgb(32,74,52)', 'rgb(64,110,78)'],    // 松柏
    ['rgb(84,118,60)', 'rgb(62,94,48)', 'rgb(104,138,76)'],  // 白桦
  ],
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

/** 该水格周围陆地数（0..4），决定深浅与岸线 */
function landNeighbors(w: WorldState, x: number, y: number): number {
  const size = w.config.size;
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) { n++; continue; }
    if (w.tiles[ny * size + nx].terrain !== Terrain.Water) n++;
  }
  return n;
}

/**
 * 绘制一个菱形地块（含侧壁与地形细节）。
 * ctx 已应用摄像机变换；wx, wy 为该格中心的世界像素。
 * animated=false 供缓存成图（跳过时间相关的波光）。
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  x: number, y: number,
  wx: number, wy: number,
  time: number,
  lod: number,
  animated = true,
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
    ctx.beginPath();
    ctx.moveTo(cx - hw - 0.6, cy);
    ctx.lineTo(cx, cy + hh + 0.4);
    ctx.lineTo(cx, cy + hh + d + 0.4);
    ctx.lineTo(cx - hw - 0.6, cy + d);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = t.elevation >= 3 ? 'rgb(88,70,54)' : 'rgb(94,74,54)';
    ctx.beginPath();
    ctx.moveTo(cx + hw + 0.6, cy);
    ctx.lineTo(cx, cy + hh + 0.4);
    ctx.lineTo(cx, cy + hh + d + 0.4);
    ctx.lineTo(cx + hw + 0.6, cy + d);
    ctx.closePath();
    ctx.fill();
    // 侧壁土层纹理（近景）
    if (lod > 1.1) {
      ctx.strokeStyle = 'rgba(60,44,32,0.28)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      const sd = Math.min(d, 7);
      ctx.moveTo(cx - hw * 0.6, cy + sd * 0.5);
      ctx.lineTo(cx - hw * 0.1, cy + hh * 0.6 + sd * 0.5);
      ctx.moveTo(cx + hw * 0.25, cy + sd * 0.7);
      ctx.lineTo(cx + hw * 0.7, cy + sd * 0.4);
      ctx.stroke();
    }
  } else {
    // 水岸：面向陆地的水下暗边，塑造河床
    const ln = landNeighbors(w, x, y);
    if (ln > 0) {
      ctx.fillStyle = 'rgba(38,80,110,0.30)';
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx, cy + hh + 3);
      ctx.lineTo(cx - hw, cy + 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 顶面（微扩 0.6px 覆盖抗锯齿接缝）
  const e = 0.6;
  let top = tileTopColor(t, x, y);
  if (t.terrain === Terrain.Water) {
    const ln = landNeighbors(w, x, y);
    if (ln === 0) top = PALETTE.waterDeep; // 深水
  }
  ctx.fillStyle = top;
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
      // 岸缘泡沫（邻陆水域描一圈浅色内边）
      if (lod > 0.4 && landNeighbors(w, x, y) > 0) {
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
      // 波光（动画）
      if (animated && lod > 0.55) {
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
    case Terrain.Grass: {
      if (lod > 0.8) drawGrassTufts(ctx, x, y, cx, cy);
      break;
    }
    case Terrain.Fertile: {
      if (lod > 0.7) drawFurrows(ctx, x, y, cx, cy, vhash(x, y, 11));
      break;
    }
    case Terrain.Forest: {
      if (lod > 0.45) drawTrees(ctx, x, y, cx, cy, lod);
      else if (lod > 0.3) {
        ctx.fillStyle = PALETTE.forestTree[0][1];
        ctx.beginPath();
        ctx.ellipse(cx, cy, hw * 0.55, hh * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case Terrain.Hills: {
      if (lod > 0.75) drawHillContours(ctx, x, y, cx, cy);
      break;
    }
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

/** 草丛 + 稀疏小花 */
function drawGrassTufts(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number) {
  const n = 4 + ((vhash(x, y, 28) * 3) | 0);
  ctx.strokeStyle = 'rgba(96,140,74,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const dx = (vhash(x, y, 31 + i) - 0.5) * TILE_W * 0.62;
    const dy = (vhash(x, y, 47 + i) - 0.5) * TILE_H * 0.62;
    const sway = vhash(x, y, 53 + i) * 2 - 1;
    ctx.moveTo(cx + dx, cy + dy);
    ctx.lineTo(cx + dx + sway, cy + dy - 3);
  }
  ctx.stroke();
  // 小花（约 1/5 的格子上有一朵）
  if (vhash(x, y, 59) > 0.8) {
    const fx = cx + (vhash(x, y, 61) - 0.5) * TILE_W * 0.5;
    const fy = cy + (vhash(x, y, 67) - 0.5) * TILE_H * 0.5;
    ctx.fillStyle = vhash(x, y, 71) > 0.5 ? 'rgb(238,220,150)' : 'rgb(224,150,168)';
    ctx.beginPath();
    for (let p = 0; p < 4; p++) {
      const a = p * Math.PI / 2;
      ctx.moveTo(fx, fy);
      ctx.arc(fx + Math.cos(a) * 1.4, fy + Math.sin(a) * 1.4, 1.1, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function drawFurrows(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, h: number) {
  ctx.strokeStyle = 'rgba(120,96,52,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    const ox = i * 10 * (0.7 + h * 0.3);
    ctx.moveTo(cx - hw2() + ox, cy - hh2() * 0.5 + ox * 0.5);
    ctx.lineTo(cx + ox, cy + hh2() * 0.5 + ox * 0.5 * -1);
  }
  ctx.stroke();
  // 垄沟高光
  ctx.strokeStyle = 'rgba(214,186,120,0.30)';
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    const ox = i * 10 * (0.7 + h * 0.3) + 3;
    ctx.moveTo(cx - hw2() + ox, cy - hh2() * 0.5 + ox * 0.5);
    ctx.lineTo(cx + ox, cy + hh2() * 0.5 + ox * 0.5 * -1);
  }
  ctx.stroke();
}
const hw2 = () => TILE_W / 2;
const hh2 = () => TILE_H / 2;

/** 精细树：三种形态（阔叶/松柏/白桦），三色树冠 + 树干 + 高光 */
function drawTrees(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, lod: number) {
  const positions = [[-14, 2], [8, -4], [-2, 8], [12, 8], [-12, -6]];
  const n = 2 + ((vhash(x, y, 51) * 3) | 0);
  for (let i = 0; i < n && i < positions.length; i++) {
    const [ox, oy] = positions[i];
    const variant = (vhash(x, y, 57 + i) * 3) | 0;
    const hgt = 14 + vhash(x, y, 61 + i) * 9;
    const tx = cx + ox, ty = cy + oy;
    const cols = PALETTE.forestTree[variant];
    // 阴影
    ctx.fillStyle = 'rgba(40,60,40,0.25)';
    ctx.beginPath();
    ctx.ellipse(tx + 2.5, ty + 3, 7.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 树干（带根部展开）
    ctx.fillStyle = variant === 2 ? 'rgb(178,166,140)' : 'rgb(94,66,44)';
    ctx.beginPath();
    ctx.moveTo(tx - 2.4, ty + 1.5);
    ctx.lineTo(tx - 1.4, ty - hgt * 0.42);
    ctx.lineTo(tx + 1.4, ty - hgt * 0.42);
    ctx.lineTo(tx + 2.4, ty + 1.5);
    ctx.closePath();
    ctx.fill();
    // 树冠
    ctx.fillStyle = cols[1];
    if (variant === 1) {
      // 松柏：三层叠锥
      for (let l = 0; l < 3; l++) {
        const ly = ty - hgt * (0.32 + l * 0.24);
        const lw = 9 - l * 2.2;
        ctx.beginPath();
        ctx.moveTo(tx, ly - hgt * 0.34);
        ctx.lineTo(tx + lw, ly);
        ctx.lineTo(tx - lw, ly);
        ctx.closePath();
        ctx.fillStyle = l === 2 ? cols[0] : cols[1];
        ctx.fill();
      }
    } else {
      // 阔叶/白桦：两团椭圆 + 主团
      ctx.fillStyle = cols[1];
      ctx.beginPath();
      ctx.ellipse(tx - 3.5, ty - hgt * 0.52, 6.5, 5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[0];
      ctx.beginPath();
      ctx.ellipse(tx + 3, ty - hgt * 0.58, 6.5, 5, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[0];
      ctx.beginPath();
      ctx.moveTo(tx, ty - hgt);
      ctx.quadraticCurveTo(tx + 9, ty - hgt * 0.55, tx + 2, ty - hgt * 0.4);
      ctx.quadraticCurveTo(tx - 9, ty - hgt * 0.55, tx, ty - hgt);
      ctx.fill();
    }
    // 高光（受光面）
    ctx.fillStyle = 'rgba(255,255,220,0.14)';
    ctx.beginPath();
    ctx.moveTo(tx, ty - hgt);
    ctx.quadraticCurveTo(tx + 5, ty - hgt * 0.55, tx + 3, ty - hgt * 0.42);
    ctx.quadraticCurveTo(tx - 1, ty - hgt * 0.6, tx, ty - hgt);
    ctx.fill();
    // 近景下的枝条描线
    if (lod > 1.2) {
      ctx.strokeStyle = 'rgba(30,50,34,0.35)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(tx, ty - hgt * 0.5);
      ctx.lineTo(tx + 4.5, ty - hgt * 0.66);
      ctx.moveTo(tx, ty - hgt * 0.62);
      ctx.lineTo(tx - 4, ty - hgt * 0.74);
      ctx.stroke();
    }
  }
}

function drawHillContours(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number) {
  const h = vhash(x, y, 77);
  ctx.strokeStyle = 'rgba(140,140,100,0.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const r = 8 - i * 3;
    ctx.moveTo(cx - r, cy + 2 - i * 4);
    ctx.quadraticCurveTo(cx, cy - 4 - i * 4 - h * 2, cx + r, cy + 2 - i * 4);
  }
  ctx.stroke();
  if (h > 0.6) {
    ctx.fillStyle = 'rgba(120,124,88,0.5)';
    ctx.beginPath();
    ctx.ellipse(cx + 8 * h - 4, cy - 2, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMountain(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, lod: number) {
  const h = vhash(x, y, 81);
  const hgt = 30 + h * 22;
  const wHalf = 24 + h * 8;
  // 山影
  ctx.fillStyle = 'rgba(52,48,46,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 6, wHalf * 0.9, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 山体：两面 + 棱线
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
  // 岩层纹理（近景）
  if (lod > 0.9) {
    ctx.strokeStyle = 'rgba(96,90,82,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const ly = cy - hgt + 12 + i * hgt * 0.2;
      const lw = wHalf * (1 - i * 0.22);
      ctx.moveTo(cx - lw * 0.7, ly);
      ctx.lineTo(cx - lw * 0.1, ly - 3);
      ctx.lineTo(cx + lw * 0.55, ly + 1);
    }
    ctx.stroke();
  }
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
    if (lod > 1.0) {
      ctx.fillStyle = 'rgba(210,224,232,0.7)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - hgt + 10);
      ctx.lineTo(cx + wHalf * 0.2, cy - hgt * 0.34);
      ctx.lineTo(cx + wHalf * 0.06, cy - hgt * 0.36);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawRocks(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number) {
  for (let i = 0; i < 3; i++) {
    const ox = (vhash(x, y, 91 + i) - 0.5) * 30;
    const oy = (vhash(x, y, 97 + i) - 0.5) * 12;
    const s = 4 + vhash(x, y, 103 + i) * 5;
    ctx.fillStyle = 'rgba(52,48,44,0.2)';
    ctx.beginPath();
    ctx.ellipse(cx + ox + 1, cy + oy + 1.5, s, s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = i % 2 ? 'rgb(132,126,118)' : 'rgb(158,152,142)';
    ctx.beginPath();
    ctx.moveTo(cx + ox - s, cy + oy);
    ctx.lineTo(cx + ox - s * 0.3, cy + oy - s * 0.9);
    ctx.lineTo(cx + ox + s * 0.7, cy + oy - s * 0.6);
    ctx.lineTo(cx + ox + s, cy + oy + s * 0.2);
    ctx.closePath();
    ctx.fill();
    // 石面高光
    ctx.fillStyle = 'rgba(230,226,218,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx + ox - s * 0.3, cy + oy - s * 0.9);
    ctx.lineTo(cx + ox + s * 0.1, cy + oy - s * 0.75);
    ctx.lineTo(cx + ox - s * 0.15, cy + oy - s * 0.45);
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

// ============ 静态地形缓存（远景大地图性能） ============

export class TerrainCache {
  canvas: HTMLCanvasElement | null = null;
  dirty = true;
  private scale = 0.5;

  /** 生成/重建缓存（整图一次成图，半分辨率） */
  build(w: WorldState) {
    const size = w.config.size;
    const worldW = size * TILE_W, worldH = size * TILE_H + ELEV_H * 6;
    const s = this.scale;
    const cv = this.canvas ?? document.createElement('canvas');
    const cw = Math.ceil(worldW * s), ch = Math.ceil(worldH * s);
    if (cv.width !== cw || cv.height !== ch) {
      cv.width = cw; cv.height = ch;
    }
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cw, ch);
    c.scale(s, s);
    // 世界像素 → 缓存像素：cacheX = worldX + worldW/2；世界原点 y=0 在山体之上留 ELEV 余量
    c.translate(worldW / 2, ELEV_H * 3);
    for (let sum = 0; sum <= 2 * (size - 1); sum++) {
      for (let x = Math.max(0, sum - size + 1); x <= Math.min(size - 1, sum); x++) {
        const y = sum - x;
        const t = w.tiles[y * size + x];
        const p = { x: (x - y) * TILE_W / 2, y: (x + y) * TILE_H / 2 };
        drawTile(c, w, x, y, p.x, p.y, 0, 0.9, false);
        if (t.ore) { /* 矿闪在缓存中已绘制 */ }
      }
    }
    this.canvas = cv;
    this.dirty = false;
  }

  /** 贴图（ctx 需已应用世界变换） */
  blit(ctx: CanvasRenderingContext2D, w: WorldState) {
    if (!this.canvas || this.dirty) this.build(w);
    const size = w.config.size;
    const worldW = size * TILE_W, worldH = size * TILE_H;
    ctx.drawImage(this.canvas!, -worldW / 2, -ELEV_H * 3, worldW, worldH + ELEV_H * 6);
  }
}
