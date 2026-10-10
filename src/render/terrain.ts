/**
 * VisualWorld 地形渲染 v4.0 — 分块缓存 + 气候带
 * - 海拔 0..6：悬崖侧壁深度 = 与最低邻格的高差，山体呈阶梯状拔起
 * - 气候带：沙漠（沙丘/仙人掌）、苔原（雪斑/矮灌）、温带森林、
 *   寒带针叶林（温度驱动树形）、丛林（高温高湿的深绿密林）
 * - 静态地形按 16×16 渲染块缓存（三档分辨率 + LRU + 每帧构建预算），
 *   支撑 Minecraft 式超大地图的流式渲染。
 */
import { Terrain, type Tile, type WorldState, CHUNK } from '../types';
import { TILE_W, TILE_H, ELEV_H, vhash } from './iso';
import { tileAt } from '../worldgen';

export interface Palette {
  grass: string[];
  fertile: string[];
  forestFloor: string[];
  hills: string[];
  mountain: string[];
  rock: string[];
  water: string[];
  waterDeep: string;
  sand: string[];
  tundra: string[];
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
  sand: shades([224, 200, 148], 6, 0.06),
  tundra: shades([176, 186, 176], 6, 0.06),
  side: 'rgb(112,88,64)',
  forestTree: [
    ['rgb(56,102,62)', 'rgb(40,82,52)', 'rgb(76,120,72)'],   // 阔叶
    ['rgb(46,96,66)', 'rgb(32,74,52)', 'rgb(64,110,78)'],    // 松柏
    ['rgb(84,118,60)', 'rgb(62,94,48)', 'rgb(104,138,76)'],   // 白桦
    ['rgb(36,84,54)', 'rgb(26,66,42)', 'rgb(52,98,62)'],      // 丛林（更深更大）
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
    case Terrain.Sand: return PALETTE.sand[(h * PALETTE.sand.length) | 0];
    case Terrain.Tundra: return PALETTE.tundra[(h * PALETTE.tundra.length) | 0];
    default: return PALETTE.grass[0];
  }
}

/** 该水格周围陆地数（0..4），决定深浅与岸线 */
function landNeighbors(w: WorldState, x: number, y: number): number {
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const t = tileAt(w, x + dx, y + dy);
    if (!t || t.terrain !== Terrain.Water) n++;
  }
  return n;
}

function elevOf(w: WorldState, x: number, y: number): number {
  const t = tileAt(w, x, y);
  return t ? t.elevation : 0;
}

/**
 * 绘制一个菱形地块（含悬崖侧壁与地形细节）。
 * ctx 已应用摄像机变换；wx, wy 为该格中心的世界像素（不含海拔）。
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
  tile?: Tile,
) {
  const t = tile ?? tileAt(w, x, y);
  if (!t) return;
  const hw = TILE_W / 2, hh = TILE_H / 2;
  const elev = t.elevation;

  // 水面低于地面
  const waterOffset = t.terrain === Terrain.Water ? 5 : 0;
  const cx = wx, cy = wy - elev * ELEV_H + waterOffset;

  if (t.terrain !== Terrain.Water) {
    // 悬崖侧壁：深度 = 本格与最低邻格的高差（真实落差）
    const nMin = Math.min(
      elevOf(w, x + 1, y), elevOf(w, x - 1, y),
      elevOf(w, x, y + 1), elevOf(w, x, y - 1),
    );
    const drop = Math.max(0, elev - nMin);
    const d = drop > 0 ? drop * ELEV_H : 2.5;
    if (d > 2.6) {
      // 左壁（向阳面稍亮）
      ctx.fillStyle = elev >= 4 ? 'rgb(122,98,76)' : 'rgb(118,92,66)';
      ctx.beginPath();
      ctx.moveTo(cx - hw - 0.6, cy);
      ctx.lineTo(cx, cy + hh + 0.4);
      ctx.lineTo(cx, cy + hh + d + 0.4);
      ctx.lineTo(cx - hw - 0.6, cy + d);
      ctx.closePath();
      ctx.fill();
      // 右壁（背光面暗）
      ctx.fillStyle = elev >= 4 ? 'rgb(96,74,56)' : 'rgb(92,70,50)';
      ctx.beginPath();
      ctx.moveTo(cx + hw + 0.6, cy);
      ctx.lineTo(cx, cy + hh + 0.4);
      ctx.lineTo(cx, cy + hh + d + 0.4);
      ctx.lineTo(cx + hw + 0.6, cy + d);
      ctx.closePath();
      ctx.fill();
      // 岩层纹理（悬崖上水平层理）
      if (lod > 0.55 && drop >= 1) {
        ctx.strokeStyle = 'rgba(58,44,32,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let s = 1; s < drop; s++) {
          const ly = cy + s * ELEV_H;
          ctx.moveTo(cx - hw * 0.92, ly);
          ctx.lineTo(cx - hw * 0.1, ly + hh * 0.82);
          ctx.moveTo(cx + hw * 0.25, ly + hh * 0.2);
          ctx.lineTo(cx + hw * 0.92, ly - hh * 0.02);
        }
        ctx.stroke();
      }
    } else {
      // 平地薄土裙边（消除菱形接缝）
      ctx.fillStyle = 'rgb(112,88,64)';
      ctx.beginPath();
      ctx.moveTo(cx - hw - 0.6, cy);
      ctx.lineTo(cx, cy + hh + 0.4);
      ctx.lineTo(cx, cy + hh + 3);
      ctx.lineTo(cx - hw - 0.6, cy + 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgb(94,74,54)';
      ctx.beginPath();
      ctx.moveTo(cx + hw + 0.6, cy);
      ctx.lineTo(cx, cy + hh + 0.4);
      ctx.lineTo(cx, cy + hh + 3);
      ctx.lineTo(cx + hw + 0.6, cy + 2.5);
      ctx.closePath();
      ctx.fill();
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
      // 瀑布：河床跌落处画白色水痕
      if (lod > 0.5 && elev > 0) {
        const below = Math.min(
          elevOf(w, x + 1, y), elevOf(w, x - 1, y),
          elevOf(w, x, y + 1), elevOf(w, x, y - 1),
        );
        if (below < elev) {
          const ph = animated ? time * 0.004 : 0;
          ctx.strokeStyle = `rgba(226,240,248,${0.55 + Math.sin(ph) * 0.12})`;
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(cx + hw * 0.3, cy + hh * 0.4);
          ctx.lineTo(cx + hw * 0.52, cy + hh * 0.4 + (elev - below) * ELEV_H);
          ctx.moveTo(cx - hw * 0.1, cy + hh * 0.6);
          ctx.lineTo(cx + hw * 0.12, cy + hh * 0.6 + (elev - below) * ELEV_H * 0.9);
          ctx.stroke();
        }
      }
      break;
    }
    case Terrain.Grass: {
      if (lod > 0.8) drawGrassTufts(ctx, x, y, cx, cy, t.temp);
      break;
    }
    case Terrain.Fertile: {
      if (lod > 0.7) drawFurrows(ctx, x, y, cx, cy, vhash(x, y, 11));
      break;
    }
    case Terrain.Forest: {
      if (lod > 0.45) drawTrees(ctx, x, y, cx, cy, lod, animated ? time : 0, t.temp, t.moisture);
      else if (lod > 0.3) {
        ctx.fillStyle = t.temp < 0.42 ? PALETTE.forestTree[1][1] : PALETTE.forestTree[0][1];
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
      drawMountain(ctx, x, y, cx, cy, lod, elev);
      break;
    case Terrain.Rock:
      if (lod > 0.6) drawRocks(ctx, x, y, cx, cy);
      break;
    case Terrain.Sand:
      if (lod > 0.5) drawDesert(ctx, x, y, cx, cy);
      break;
    case Terrain.Tundra:
      if (lod > 0.55) drawTundra(ctx, x, y, cx, cy);
      break;
  }

  // 雪线（高海拔顶面覆雪）
  if (t.terrain !== Terrain.Water && t.terrain !== Terrain.Sand
    && (elev >= 5 || (elev === 4 && vhash(x, y, 5) > 0.55))) {
    ctx.fillStyle = 'rgba(244,241,235,0.88)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh * 0.7);
    ctx.lineTo(cx + hw * 0.75, cy);
    ctx.lineTo(cx, cy + hh * 0.7);
    ctx.lineTo(cx - hw * 0.75, cy);
    ctx.closePath();
    ctx.fill();
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

/** 草丛 + 稀疏小花（热带更浓绿） */
function drawGrassTufts(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, temp: number) {
  const n = 4 + ((vhash(x, y, 28) * 3) | 0);
  ctx.strokeStyle = temp > 0.7 ? 'rgba(70,128,58,0.6)' : 'rgba(96,140,74,0.55)';
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

/**
 * v4.0 精细树（气候驱动形态）：
 * - 寒带（temp<0.42）：针叶树，三层叠锥
 * - 丛林（temp>0.72 且湿润）：更高大的深绿阔冠
 * - 温带：阔叶/白桦
 * 高大（22~36px，约 2 倍小人身高），风摆，近景落叶。
 */
function drawTrees(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, lod: number, time: number, temp: number, moist: number) {
  const jungle = temp > 0.72 && moist > 0.5;
  const positions = [[-15, 3], [9, -5], [-3, 9], [13, 9], [-13, -7]];
  const n = jungle ? 3 + ((vhash(x, y, 51) * 3) | 0) : 2 + ((vhash(x, y, 51) * 3) | 0);
  const wind = time ? Math.sin(time * 0.0011 + x * 0.7 + y * 0.4) * 1.6 : 0;
  for (let i = 0; i < n && i < positions.length; i++) {
    const [ox, oy] = positions[i];
    let variant: number;
    if (temp < 0.42) variant = 1; // 针叶
    else if (jungle) variant = 3; // 丛林
    else variant = vhash(x, y, 57 + i) > 0.5 ? 0 : 2;
    const big = vhash(x, y, 63 + i) > 0.62 || jungle;
    const hgt = (jungle ? 34 : big ? 30 : 22) + vhash(x, y, 61 + i) * 8;
    const tx = cx + ox, ty = cy + oy;
    const cols = PALETTE.forestTree[variant];
    // 阴影
    ctx.fillStyle = 'rgba(40,60,40,0.25)';
    ctx.beginPath();
    ctx.ellipse(tx + 3, ty + 3.5, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 树干（带根部展开）
    ctx.fillStyle = variant === 2 ? 'rgb(178,166,140)' : 'rgb(94,66,44)';
    ctx.beginPath();
    ctx.moveTo(tx - 3, ty + 1.5);
    ctx.lineTo(tx - 1.8, ty - hgt * 0.44);
    ctx.lineTo(tx + 1.8, ty - hgt * 0.44);
    ctx.lineTo(tx + 3, ty + 1.5);
    ctx.closePath();
    ctx.fill();
    // 树冠（随风轻摆）
    const sx = wind * (0.4 + i * 0.18);
    if (variant === 1) {
      // 松柏：三层叠锥
      for (let l = 0; l < 3; l++) {
        const ly = ty - hgt * (0.34 + l * 0.24);
        const lw = 12 - l * 3;
        ctx.beginPath();
        ctx.moveTo(tx + sx, ly - hgt * 0.36);
        ctx.lineTo(tx + sx + lw, ly);
        ctx.lineTo(tx + sx - lw, ly);
        ctx.closePath();
        ctx.fillStyle = l === 2 ? cols[0] : cols[1];
        ctx.fill();
      }
    } else if (variant === 3) {
      // 丛林：宽厚叠冠（多团椭圆）
      ctx.fillStyle = cols[1];
      ctx.beginPath();
      ctx.ellipse(tx + sx - 5, ty - hgt * 0.58, 11, 8, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[0];
      ctx.beginPath();
      ctx.ellipse(tx + sx + 5, ty - hgt * 0.66, 11, 8, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[2];
      ctx.beginPath();
      ctx.ellipse(tx + sx, ty - hgt * 0.86, 9, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 阔叶/白桦：两团椭圆 + 主团
      ctx.fillStyle = cols[1];
      ctx.beginPath();
      ctx.ellipse(tx + sx - 4.5, ty - hgt * 0.56, 8.5, 6.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[0];
      ctx.beginPath();
      ctx.ellipse(tx + sx + 4, ty - hgt * 0.62, 8.5, 6.5, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[0];
      ctx.beginPath();
      ctx.moveTo(tx + sx, ty - hgt);
      ctx.quadraticCurveTo(tx + sx + 11, ty - hgt * 0.56, tx + sx + 2.5, ty - hgt * 0.4);
      ctx.quadraticCurveTo(tx + sx - 11, ty - hgt * 0.56, tx + sx, ty - hgt);
      ctx.fill();
    }
    // 高光（受光面）
    ctx.fillStyle = 'rgba(255,255,220,0.14)';
    ctx.beginPath();
    ctx.moveTo(tx + sx, ty - hgt);
    ctx.quadraticCurveTo(tx + sx + 6, ty - hgt * 0.56, tx + sx + 3.5, ty - hgt * 0.42);
    ctx.quadraticCurveTo(tx + sx - 1, ty - hgt * 0.6, tx + sx, ty - hgt);
    ctx.fill();
    // 近景下的枝条描线
    if (lod > 1.2) {
      ctx.strokeStyle = 'rgba(30,50,34,0.35)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(tx + sx, ty - hgt * 0.5);
      ctx.lineTo(tx + sx + 5.5, ty - hgt * 0.66);
      ctx.moveTo(tx + sx, ty - hgt * 0.62);
      ctx.lineTo(tx + sx - 4.5, ty - hgt * 0.74);
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

/** v3.0 山体：阶梯海拔块已由侧壁呈现，这里画岩峰棱线与雪顶 */
function drawMountain(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number, lod: number, elev: number) {
  const h = vhash(x, y, 81);
  const hgt = 16 + h * 14 + elev * 3;
  const wHalf = 18 + h * 7;
  // 岩峰剪影（叠在阶梯地形块上，营造尖峰）
  ctx.fillStyle = 'rgb(150,142,130)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - hgt + 6);
  ctx.lineTo(cx + wHalf, cy + 6);
  ctx.lineTo(cx - wHalf, cy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgb(126,118,108)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - hgt + 6);
  ctx.lineTo(cx + wHalf, cy + 6);
  ctx.lineTo(cx + wHalf * 0.15, cy + 6);
  ctx.closePath();
  ctx.fill();
  // 岩层纹理（近景）
  if (lod > 0.9) {
    ctx.strokeStyle = 'rgba(96,90,82,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const ly = cy - hgt + 8 + i * hgt * 0.2;
      const lw = wHalf * (1 - i * 0.22);
      ctx.moveTo(cx - lw * 0.7, ly);
      ctx.lineTo(cx - lw * 0.1, ly - 3);
      ctx.lineTo(cx + lw * 0.55, ly + 1);
    }
    ctx.stroke();
  }
  // 雪顶（高海拔必雪）
  if (elev >= 5 || (lod > 0.5 && h > 0.4)) {
    ctx.fillStyle = PALETTE.snow;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hgt + 6);
    ctx.lineTo(cx + wHalf * 0.36, cy - hgt * 0.42 + 6);
    ctx.lineTo(cx + wHalf * 0.2, cy - hgt * 0.34 + 6);
    ctx.lineTo(cx + wHalf * 0.05, cy - hgt * 0.45 + 6);
    ctx.lineTo(cx - wHalf * 0.18, cy - hgt * 0.36 + 6);
    ctx.lineTo(cx - wHalf * 0.36, cy - hgt * 0.44 + 6);
    ctx.closePath();
    ctx.fill();
    if (lod > 1.0) {
      ctx.fillStyle = 'rgba(210,224,232,0.7)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - hgt + 6);
      ctx.lineTo(cx + wHalf * 0.2, cy - hgt * 0.34 + 6);
      ctx.lineTo(cx + wHalf * 0.06, cy - hgt * 0.36 + 6);
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

/** v4.0 沙漠：沙色波纹 + 仙人掌 + 枯草 */
function drawDesert(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number) {
  const h = vhash(x, y, 111);
  // 沙丘波纹（风向一致的曲线）
  ctx.strokeStyle = 'rgba(196,168,110,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const oy = (i - 0.5) * 7 + h * 3;
    ctx.moveTo(cx - hw2() * 0.72, cy + oy);
    ctx.quadraticCurveTo(cx, cy + oy - 3.5, cx + hw2() * 0.72, cy + oy + 1);
  }
  ctx.stroke();
  // 高光（阳面沙脊）
  ctx.strokeStyle = 'rgba(240,222,178,0.4)';
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const oy = (i - 0.5) * 7 + h * 3 - 1.5;
    ctx.moveTo(cx - hw2() * 0.72, cy + oy);
    ctx.quadraticCurveTo(cx, cy + oy - 3.5, cx + hw2() * 0.72, cy + oy + 1);
  }
  ctx.stroke();
  // 仙人掌（稀疏）
  if (vhash(x, y, 113) > 0.88) {
    const px = cx + (vhash(x, y, 117) - 0.5) * TILE_W * 0.5;
    const py = cy + (vhash(x, y, 119) - 0.5) * TILE_H * 0.4;
    ctx.fillStyle = 'rgb(88,128,74)';
    ctx.fillRect(px - 1.6, py - 13, 3.2, 13);
    ctx.fillRect(px - 5.5, py - 9.5, 2.6, 4.5);
    ctx.fillRect(px - 5.5, py - 10.5, 5.5, 2.4);
    ctx.fillRect(px + 3, py - 8, 2.4, 3.5);
    ctx.fillRect(px - 0.6, py - 10.5, 4.6, 2.2);
    // 刺
    if (vhash(x, y, 123) > 0.5) {
      ctx.strokeStyle = 'rgba(240,240,210,0.6)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(px - 1.6, py - 6); ctx.lineTo(px - 3.4, py - 7.4);
      ctx.moveTo(px + 1.6, py - 5); ctx.lineTo(px + 3.2, py - 6.2);
      ctx.stroke();
    }
  } else if (vhash(x, y, 127) > 0.72) {
    // 枯草团
    const px = cx + (vhash(x, y, 131) - 0.5) * TILE_W * 0.55;
    const py = cy + (vhash(x, y, 137) - 0.5) * TILE_H * 0.5;
    ctx.strokeStyle = 'rgba(178,158,104,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i - 1.5) * 0.3;
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * 5, py + Math.sin(a) * 5);
    }
    ctx.stroke();
  }
}

/** v4.0 苔原：雪斑 + 矮灌木 + 地衣 */
function drawTundra(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, cy: number) {
  const h = vhash(x, y, 141);
  // 雪斑
  if (h > 0.4) {
    ctx.fillStyle = `rgba(238,242,246,${0.25 + h * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(cx + (h - 0.5) * 18, cy + (vhash(x, y, 143) - 0.5) * 10, 12, 5.5, -0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  // 矮灌木（深绿小团，抗寒的硬叶）
  if (vhash(x, y, 147) > 0.45) {
    const n = 2 + ((vhash(x, y, 149) * 2) | 0);
    for (let i = 0; i < n; i++) {
      const px = cx + (vhash(x, y, 151 + i) - 0.5) * TILE_W * 0.6;
      const py = cy + (vhash(x, y, 157 + i) - 0.5) * TILE_H * 0.5;
      const s = 2.4 + vhash(x, y, 163 + i) * 2;
      ctx.fillStyle = 'rgb(74,96,72)';
      ctx.beginPath();
      ctx.ellipse(px, py, s, s * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,150,110,0.5)';
      ctx.beginPath();
      ctx.ellipse(px - s * 0.25, py - s * 0.3, s * 0.5, s * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 地衣（灰绿涂点）
  if (vhash(x, y, 167) > 0.6) {
    ctx.fillStyle = 'rgba(150,158,128,0.4)';
    const px = cx + (vhash(x, y, 173) - 0.5) * TILE_W * 0.5;
    const py = cy + (vhash(x, y, 179) - 0.5) * TILE_H * 0.5;
    ctx.beginPath();
    ctx.arc(px, py, 2.8 + vhash(x, y, 181) * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 领地边界（低存在感） */
export function drawBorders(ctx: CanvasRenderingContext2D, w: WorldState, x: number, y: number, wx: number, wy: number) {
  const t = tileAt(w, x, y);
  if (!t || t.owner < 0) return;
  const hw = TILE_W / 2, hh = TILE_H / 2;
  const cx = wx, cy = wy - t.elevation * ELEV_H;
  const neighbor = (nx: number, ny: number) => {
    const n = tileAt(w, nx, ny);
    return n ? n.owner : -2;
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

// ============ 分块地形缓存（v4.0 性能核心） ============

/** 渲染块尺寸（16×16 tiles；生成 chunk 是 32×32，一个生成块含 2×2 渲染块） */
export const RC = 16;

/** 渲染块的世界像素原点与外扩边距（容纳悬崖/树木的悬垂） */
const PAD_L = 56, PAD_R = 56, PAD_T = 112, PAD_B = 28;

export function rcOrigin(rx: number, ry: number): { ox: number; oy: number } {
  return {
    ox: (rx * RC - (ry * RC + RC - 1)) * TILE_W / 2 - PAD_L,
    oy: (rx * RC + ry * RC) * TILE_H / 2 - PAD_T,
  };
}

interface Tier { scale: number; cap: number; map: Map<number, HTMLCanvasElement> }

export class TerrainCache {
  private tiers: Tier[] = [
    { scale: 0.22, cap: 150, map: new Map() },
    { scale: 0.45, cap: 64, map: new Map() },
    { scale: 0.8, cap: 34, map: new Map() },
  ];
  /** 每帧构建预算（防止滚动时卡顿） */
  private budget = 3;
  private canvasPool: HTMLCanvasElement[] = [];

  tierFor(zoom: number): number {
    return zoom < 0.34 ? 0 : zoom < 0.72 ? 1 : 2;
  }

  /** 恢复每帧预算（render 循环开头调用） */
  resetBudget() { this.budget = 3; }

  /** 构建一个渲染块的缓存画布 */
  private build(w: WorldState, rx: number, ry: number, tier: Tier): HTMLCanvasElement {
    const scale = tier.scale;
    const baseW = (2 * RC - 1) * TILE_W / 2 + TILE_W + PAD_L + PAD_R;
    const baseH = (2 * RC - 1) * TILE_H / 2 + TILE_H + PAD_T + PAD_B;
    const cv = this.canvasPool.pop() ?? document.createElement('canvas');
    cv.width = Math.ceil(baseW * scale);
    cv.height = Math.ceil(baseH * scale);
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    c.scale(scale, scale);
    c.translate(PAD_L + TILE_W / 2, PAD_T + TILE_H / 2);
    // 按绘制顺序（sum 递增）遍历块内格子
    for (let sum = 0; sum <= 2 * (RC - 1); sum++) {
      for (let lx = Math.max(0, sum - RC + 1); lx <= Math.min(RC - 1, sum); lx++) {
        const ly = sum - lx;
        const x = rx * RC + lx, y = ry * RC + ly;
        const p = { x: (x - y) * TILE_W / 2, y: (x + y) * TILE_H / 2 };
        drawTile(c, w, x, y, p.x, p.y, 0, 0.9, false);
      }
    }
    return cv;
  }

  /** 取渲染块画布（没有则消耗预算构建；预算耗尽返回 null） */
  get(w: WorldState, rx: number, ry: number, tierIdx: number): HTMLCanvasElement | null {
    const tier = this.tiers[tierIdx];
    const rcPerRow = Math.ceil(w.gen.size / RC);
    const key = ry * rcPerRow + rx;
    let cv = tier.map.get(key);
    if (cv) return cv;
    if (rx < 0 || ry < 0 || rx >= rcPerRow || ry >= rcPerRow) return null;
    if (this.budget <= 0) {
      // 预算耗尽：尝试降档画布（放大的旧远景，比空白好）
      for (let t = tierIdx - 1; t >= 0; t--) {
        const lower = this.tiers[t].map.get(key);
        if (lower) return lower;
      }
      return null;
    }
    this.budget--;
    cv = this.build(w, rx, ry, tier);
    tier.map.set(key, cv);
    if (tier.map.size > tier.cap) {
      // LRU 淘汰：Map 迭代序 = 插入序，删最早的
      const first = tier.map.keys().next().value as number;
      const old = tier.map.get(first)!;
      tier.map.delete(first);
      if (this.canvasPool.length < 24) this.canvasPool.push(old);
    }
    return cv;
  }

  /** 神力修改地形后：作废对应渲染块（全部档位） */
  invalidate(w: WorldState, x: number, y: number): void {
    const rcPerRow = Math.ceil(w.gen.size / RC);
    const rx = Math.floor(x / RC), ry = Math.floor(y / RC);
    const key = ry * rcPerRow + rx;
    for (const tier of this.tiers) tier.map.delete(key);
    // 相邻渲染块边缘可能受影响（悬崖侧壁读邻居）
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = rx + dx, ny = ry + dy;
      if (nx < 0 || ny < 0 || nx >= rcPerRow || ny >= rcPerRow) continue;
      const nk = ny * rcPerRow + nx;
      for (const tier of this.tiers) tier.map.delete(nk);
    }
  }

  invalidateAll(): void {
    for (const tier of this.tiers) tier.map.clear();
  }
}

void CHUNK;
