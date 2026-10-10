/**
 * 建筑渲染 — 程序化等距建筑
 * 每种建筑有独特剪影与时代色板；建造中的脚手架；
 * 农田作物随年度周期生长。
 */
import { BuildingKind, type Building, type WorldState } from '../types';
import { TILE_W, TILE_H, ELEV_H, vhash } from './iso';

export interface BuildingPalette {
  wood: string; woodDark: string; roof: string; roofDark: string;
  stone: string; stoneDark: string; accent: string; cloth: string;
}

const P = (wood: string, roof: string, stone = 'rgb(168,162,152)', accent = 'rgb(194,120,60)', cloth = 'rgb(224,200,150)'): BuildingPalette => ({
  wood, woodDark: shade(wood, 0.72), roof, roofDark: shade(roof, 0.7),
  stone, stoneDark: shade(stone, 0.72), accent, cloth,
});

function shade(rgb: string, f: number): string {
  const m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return rgb;
  return `rgb(${(+m[1]) * f | 0},${(+m[2]) * f | 0},${(+m[3]) * f | 0})`;
}

export const PALETTES: Record<number, BuildingPalette> = {
  0: P('rgb(148,116,80)', 'rgb(201,162,94)'),          // 原始：茅草
  1: P('rgb(140,108,72)', 'rgb(178,120,70)'),          // 农业：木瓦
  2: P('rgb(132,102,70)', 'rgb(156,86,60)', 'rgb(178,172,160)'), // 城镇：陶瓦
  3: P('rgb(120,96,84)', 'rgb(88,88,100)', 'rgb(150,146,140)', 'rgb(80,96,120)'), // 工业：砖与铁
  4: P('rgb(150,140,128)', 'rgb(90,110,116)', 'rgb(196,192,184)', 'rgb(47,126,118)'), // 现代：水泥与青
};

/** 建筑占地面积（格）：多数 1 格，大型 2 格 */
function footprint(kind: BuildingKind): { w: number; d: number } {
  switch (kind) {
    case BuildingKind.Admin: return { w: 1.6, d: 1.4 };
    case BuildingKind.Factory: return { w: 1.8, d: 1.6 };
    case BuildingKind.Services: return { w: 1.5, d: 1.3 };
    case BuildingKind.Cooperative: return { w: 1.4, d: 1.2 };
    case BuildingKind.Market: return { w: 1.5, d: 1.2 };
    case BuildingKind.Wall: return { w: 1.6, d: 0.7 };
    default: return { w: 1, d: 1 };
  }
}

/** 等距立方体：中心 (cx,cy)（地面），格尺寸 (gw, gd)，高 hp 像素 */
function box(ctx: CanvasRenderingContext2D, cx: number, cy: number, gw: number, gd: number, hp: number, top: string, left: string, right: string) {
  const hw = (gw * TILE_W) / 2, hd = (gd * TILE_H) / 2;
  // 左面
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx, cy + hd - hp);
  ctx.lineTo(cx - hw, cy - hp);
  ctx.closePath();
  ctx.fill();
  // 右面
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx, cy + hd - hp);
  ctx.lineTo(cx + hw, cy - hp);
  ctx.closePath();
  ctx.fill();
  // 顶面
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hp - hd);
  ctx.lineTo(cx + hw, cy - hp);
  ctx.lineTo(cx, cy - hp + hd);
  ctx.lineTo(cx - hw, cy - hp);
  ctx.closePath();
  ctx.fill();
  return { topY: cy - hp - hd, hw, hd };
}

/** 双坡屋顶 */
function gableRoof(ctx: CanvasRenderingContext2D, cx: number, cy: number, gw: number, gd: number, hp: number, hrh: number, pal: BuildingPalette, flip = false) {
  const hw = (gw * TILE_W) / 2, hd = (gd * TILE_H) / 2;
  const peak = hp + hrh;
  if (!flip) {
    // 屋脊沿 SW-NE（左右两面）
    ctx.fillStyle = pal.roof;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hd - peak);
    ctx.lineTo(cx + hw, cy - peak);
    ctx.lineTo(cx + hw, cy - hp);
    ctx.lineTo(cx, cy + hd - hp);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = pal.roofDark;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hd - peak);
    ctx.lineTo(cx - hw, cy - peak);
    ctx.lineTo(cx - hw, cy - hp);
    ctx.lineTo(cx, cy + hd - hp);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = pal.roof;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hd - peak + hd);
    ctx.lineTo(cx + hw, cy - peak);
    ctx.lineTo(cx, cy + hd - peak + hd);
    ctx.closePath();
    ctx.fill();
  }
}

function shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, gw: number, gd: number) {
  const hw = (gw * TILE_W) / 2 + 3, hd = (gd * TILE_H) / 2 + 2;
  ctx.fillStyle = 'rgba(40,52,44,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + 2, hw * 0.8, hd * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 烟囱烟雾 */
function smoke(ctx: CanvasRenderingContext2D, cx: number, cy: number, topY: number, time: number, seed: number, intensity = 1) {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const ph = (time * 0.0004 + i / n + seed) % 1;
    const a = (1 - ph) * 0.28 * intensity;
    const r = 2.5 + ph * 7;
    ctx.fillStyle = `rgba(220,222,226,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(ph * 6 + seed * 9) * 4, topY - ph * 26, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 绘制建筑。sx, sy 为建筑所在格的地面世界像素中心。
 * time 毫秒用于动画（炊烟等）。
 */
export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  b: Building,
  sx: number, sy: number,
  time: number,
  lod: number,
) {
  const era = eraOf(w, b);
  const pal = PALETTES[era];
  const fp = footprint(b.kind);
  const seed = vhash(b.x, b.y, 5);

  // 建造中：脚手架 + 半成品
  if (b.progress < 1) {
    shadow(ctx, sx, sy, fp.w, fp.d);
    ctx.globalAlpha = 0.35 + b.progress * 0.6;
    drawCompleted(ctx, w, b, sx, sy, time, era, pal, seed, lod, true);
    ctx.globalAlpha = 1;
    // 脚手架线条
    ctx.strokeStyle = 'rgba(120,90,56,0.8)';
    ctx.lineWidth = 1.5;
    const hw = (fp.w * TILE_W) / 2, hd = (fp.d * TILE_H) / 2;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy); ctx.lineTo(sx, sy + hd); ctx.lineTo(sx, sy + hd - 22); ctx.lineTo(sx - hw, sy - 22); ctx.closePath();
    ctx.moveTo(sx + hw, sy); ctx.lineTo(sx, sy + hd); ctx.lineTo(sx, sy + hd - 22); ctx.lineTo(sx + hw, sy - 22); ctx.closePath();
    ctx.stroke();
    return;
  }
  shadow(ctx, sx, sy, fp.w, fp.d);
  drawCompleted(ctx, w, b, sx, sy, time, era, pal, seed, lod, false);
}

function drawCompleted(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  b: Building,
  sx: number, sy: number,
  time: number,
  era: number,
  pal: BuildingPalette,
  seed: number,
  lod: number,
  ghost: boolean,
) {
  switch (b.kind) {
    case BuildingKind.Camp: {
      // 帐篷 + 篝火
      const h = 16;
      ctx.fillStyle = 'rgba(40,52,44,0.2)';
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 20, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.cloth;
      ctx.beginPath();
      ctx.moveTo(sx - 2, sy + 8);
      ctx.lineTo(sx - 16, sy - h);
      ctx.lineTo(sx + 2, sy - h - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = pal.roof;
      ctx.beginPath();
      ctx.moveTo(sx + 2, sy + 8);
      ctx.lineTo(sx + 14, sy - h + 2);
      ctx.lineTo(sx + 2, sy - h - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(60,42,26,0.85)';
      ctx.beginPath();
      ctx.moveTo(sx - 2, sy + 8); ctx.lineTo(sx - 9, sy - h + 8); ctx.lineTo(sx + 2, sy - h - 2);
      ctx.closePath(); ctx.fill();
      if (!ghost && lod > 0.5) {
        // 篝火
        const fl = 3 + Math.sin(time * 0.008 + seed * 9) * 1.4;
        ctx.fillStyle = 'rgb(224,120,50)';
        ctx.beginPath();
        ctx.ellipse(sx + 14, sy + 6, 3, fl, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,206,90,0.75)';
        ctx.beginPath();
        ctx.ellipse(sx + 14, sy + 5, 1.6, fl * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case BuildingKind.Shelter: {
      box(ctx, sx, sy, 0.7, 0.7, 8, pal.wood, pal.woodDark, pal.wood);
      gableRoof(ctx, sx, sy - 8, 0.8, 0.8, 0, 8, pal);
      break;
    }
    case BuildingKind.House: {
      box(ctx, sx, sy, 0.85, 0.85, 14, pal.wood, pal.woodDark, shade(pal.wood, 0.85));
      gableRoof(ctx, sx, sy, 0.95, 0.95, 14, 8, pal);
      if (lod > 0.7) {
        ctx.fillStyle = 'rgba(255,214,140,0.8)';
        ctx.fillRect(sx + 3, sy - 8, 4, 4); // 窗
        ctx.fillStyle = pal.woodDark;
        ctx.fillRect(sx - 7, sy - 4, 5, 6); // 门
      }
      if (!ghost && lod > 0.6) smoke(ctx, sx - 6, sy, sy - 26, time, seed, 0.5);
      break;
    }
    case BuildingKind.Townhouse: {
      box(ctx, sx, sy, 0.8, 0.8, 30, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      gableRoof(ctx, sx, sy, 0.9, 0.9, 30, 9, pal);
      if (lod > 0.65) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i % 2 ? 'rgba(255,214,140,0.85)' : 'rgba(150,170,180,0.8)';
          ctx.fillRect(sx + 4, sy - 6 - i * 9, 4, 4);
          ctx.fillRect(sx - 8, sy - 6 - i * 9, 4, 4);
        }
      }
      break;
    }
    case BuildingKind.Farm: {
      // 田垄与作物：随年内周期生长
      const growth = cropGrowth(w, b);
      drawField(ctx, sx, sy, growth, seed);
      break;
    }
    case BuildingKind.Granary: {
      // 架高粮仓
      ctx.strokeStyle = pal.woodDark;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx - 12, sy + 4); ctx.lineTo(sx - 12, sy - 6);
      ctx.moveTo(sx + 12, sy + 4); ctx.lineTo(sx + 12, sy - 6);
      ctx.stroke();
      box(ctx, sx, sy - 6, 0.75, 0.75, 10, pal.wood, pal.woodDark, shade(pal.wood, 0.85));
      gableRoof(ctx, sx, sy - 6, 0.85, 0.85, 10, 7, pal);
      if (lod > 0.65) {
        ctx.fillStyle = 'rgb(224,196,120)';
        ctx.beginPath();
        ctx.ellipse(sx + 14, sy + 2, 3.5, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case BuildingKind.Well: {
      ctx.fillStyle = pal.stone;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(72,110,140)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 5.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pal.woodDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 7, sy); ctx.lineTo(sx - 4, sy - 14);
      ctx.moveTo(sx + 7, sy); ctx.lineTo(sx + 4, sy - 14);
      ctx.moveTo(sx - 5, sy - 13); ctx.lineTo(sx + 5, sy - 13);
      ctx.stroke();
      ctx.fillStyle = pal.roof;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 13); ctx.lineTo(sx, sy - 19); ctx.lineTo(sx + 8, sy - 13);
      ctx.closePath(); ctx.fill();
      break;
    }
    case BuildingKind.Workshop: {
      box(ctx, sx, sy, 0.9, 0.9, 16, pal.wood, pal.woodDark, shade(pal.wood, 0.82));
      gableRoof(ctx, sx, sy, 1.0, 1.0, 16, 8, pal);
      box(ctx, sx + 10, sy - 4, 0.22, 0.22, 22, pal.stone, pal.stoneDark, pal.stone);
      if (!ghost) smoke(ctx, sx + 10, sy - 4, sy - 30, time, seed);
      if (lod > 0.7) {
        ctx.fillStyle = pal.accent;
        ctx.fillRect(sx - 6, sy - 3, 4, 4); // 工件
      }
      break;
    }
    case BuildingKind.Market: {
      // 帐篷摊位
      const posts: [number, number][] = [[-16, 0], [0, 8], [16, 0], [0, -8]];
      ctx.strokeStyle = pal.woodDark;
      ctx.lineWidth = 2;
      for (const [px, py] of posts) {
        ctx.beginPath(); ctx.moveTo(sx + px, sy + py); ctx.lineTo(sx + px, sy + py - 12); ctx.stroke();
      }
      // 条纹顶
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? pal.roof : pal.cloth;
        const t0 = i / 6, t1 = (i + 1) / 6;
        const ax = -16 + t0 * 32, ay = -8 + t0 * 16;
        const bx = -16 + t1 * 32, by = -8 + t1 * 16;
        const cx2 = -16 + t0 * 32, cy2 = 8 - t0 * 16;
        const dx = -16 + t1 * 32, dy = 8 - t1 * 16;
        ctx.beginPath();
        ctx.moveTo(sx + ax, sy + ay - 12);
        ctx.lineTo(sx + bx, sy + by - 12);
        ctx.lineTo(sx + dx, sy + dy - 12);
        ctx.lineTo(sx + cx2, sy + cy2 - 12);
        ctx.closePath();
        ctx.fill();
      }
      if (lod > 0.6) {
        ctx.fillStyle = pal.accent;
        ctx.beginPath(); ctx.ellipse(sx - 6, sy + 3, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgb(178,96,70)';
        ctx.beginPath(); ctx.ellipse(sx + 7, sy + 1, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case BuildingKind.Admin: {
      // 台基 + 柱廊 + 旗帜
      box(ctx, sx, sy, 1.5, 1.3, 6, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      box(ctx, sx, sy - 6, 1.3, 1.1, 20, pal.wood, pal.woodDark, shade(pal.wood, 0.8));
      gableRoof(ctx, sx, sy - 6, 1.45, 1.25, 20, 10, pal);
      if (lod > 0.55) {
        ctx.strokeStyle = pal.cloth;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 34);
        ctx.lineTo(sx, sy - 48);
        ctx.stroke();
        const wave = Math.sin(time * 0.004 + seed * 7) * 2;
        ctx.fillStyle = 'rgb(178,86,70)';
        ctx.beginPath();
        ctx.moveTo(sx, sy - 48);
        ctx.lineTo(sx + 12 + wave, sy - 45);
        ctx.lineTo(sx, sy - 40);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case BuildingKind.Wall: {
      const fpw = footprint(BuildingKind.Wall);
      box(ctx, sx, sy, fpw.w, fpw.d, 12, pal.stone, pal.stoneDark, shade(pal.stone, 0.78));
      // 城齿
      ctx.fillStyle = pal.stone;
      for (let i = -2; i <= 2; i++) {
        const ox = i * 9, oy = -Math.abs(i) * 3.4;
        ctx.fillRect(sx + ox - 3, sy + oy - 16, 6, 6);
      }
      break;
    }
    case BuildingKind.Factory: {
      box(ctx, sx, sy, 1.7, 1.5, 24, 'rgb(150,96,84)', 'rgb(118,74,64)', 'rgb(132,82,70)');
      // 锯齿屋顶
      ctx.fillStyle = 'rgb(96,100,112)';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * 22 - 8, sy - 30);
        ctx.lineTo(sx + i * 22 + 8, sy - 30);
        ctx.lineTo(sx + i * 22 + 8, sy - 38);
        ctx.closePath();
        ctx.fill();
      }
      box(ctx, sx - 24, sy - 6, 0.24, 0.24, 34, 'rgb(88,88,96)', 'rgb(70,70,78)', 'rgb(78,78,86)');
      box(ctx, sx + 22, sy - 10, 0.24, 0.24, 28, 'rgb(88,88,96)', 'rgb(70,70,78)', 'rgb(78,78,86)');
      if (!ghost) {
        smoke(ctx, sx - 24, sy - 6, sy - 44, time, seed, 1.4);
        smoke(ctx, sx + 22, sy - 10, sy - 40, time, seed + 0.4, 1.2);
      }
      if (lod > 0.6) {
        ctx.fillStyle = 'rgba(255,214,140,0.9)';
        ctx.fillRect(sx - 6, sy - 10, 5, 5);
        ctx.fillRect(sx + 4, sy - 10, 5, 5);
      }
      break;
    }
    case BuildingKind.Cooperative: {
      box(ctx, sx, sy, 1.35, 1.15, 18, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      gableRoof(ctx, sx, sy, 1.5, 1.3, 18, 9, pal);
      if (lod > 0.55) {
        // 圆结社徽
        ctx.strokeStyle = 'rgb(47,126,118)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy - 24, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx - 4.5, sy - 24, 2.2, 0, Math.PI * 2);
        ctx.arc(sx + 4.5, sy - 24, 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case BuildingKind.Services: {
      box(ctx, sx, sy, 1.45, 1.25, 22, pal.stone, pal.stoneDark, shade(pal.stone, 0.82));
      gableRoof(ctx, sx, sy, 1.6, 1.4, 22, 8, pal);
      if (lod > 0.55) {
        // 生命树标识
        ctx.fillStyle = 'rgb(47,126,118)';
        ctx.fillRect(sx - 1, sy - 36, 2, 8);
        ctx.beginPath();
        ctx.ellipse(sx, sy - 38, 5, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}

/** 农田：垄沟 + 随周期生长的作物色 */
function drawField(ctx: CanvasRenderingContext2D, sx: number, sy: number, growth: number, seed: number) {
  const hw = TILE_W / 2 - 4, hh = TILE_H / 2 - 2;
  // 土地
  ctx.fillStyle = 'rgb(146,110,72)';
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh); ctx.lineTo(sx + hw, sy); ctx.lineTo(sx, sy + hh); ctx.lineTo(sx - hw, sy);
  ctx.closePath(); ctx.fill();
  // 垄
  ctx.strokeStyle = 'rgb(120,88,56)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    const ox = i * hw / 2.6;
    ctx.moveTo(sx + ox, sy - hh / 2 + Math.abs(i) * 1.6);
    ctx.lineTo(sx + ox * 0.2, sy + hh / 2 - Math.abs(i) * 1.2);
  }
  ctx.stroke();
  // 作物
  if (growth > 0.15) {
    const g = Math.min(1, growth);
    const cropColor = g < 0.5 ? `rgb(${120 + g * 60},${150 + g * 50},${70})` : `rgb(${200 + g * 40},${168 - g * 40},${60})`;
    ctx.fillStyle = cropColor;
    for (let i = -2; i <= 2; i++) {
      for (let j = -1; j <= 1; j++) {
        const ox = i * hw / 3 + j * 4, oy = j * hh / 2.4 + i * 1.4;
        const hgt = 2 + g * 7;
        ctx.beginPath();
        ctx.ellipse(sx + ox, sy + oy - hgt * 0.4, 1.6, hgt * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function cropGrowth(w: WorldState, b: Building): number {
  // 以建造年 + 当前年的小数相位模拟周期生长（纯视觉）
  const phase = (w.year % 3) + ((b.id % 7) / 7);
  return 0.15 + 0.85 * Math.abs(Math.sin(phase * Math.PI / 3));
}

function eraOf(w: WorldState, b: Building): number {
  const t = w.civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  switch (b.kind) {
    case BuildingKind.Camp: return 0;
    case BuildingKind.Shelter: return 0;
    case BuildingKind.Townhouse: case BuildingKind.Factory: return 3;
    case BuildingKind.Cooperative: case BuildingKind.Services: return 4;
    case BuildingKind.Market: case BuildingKind.Admin: case BuildingKind.Wall: case BuildingKind.Workshop: return 2;
    default: return lvl('agriculture') >= 2 ? 1 : 0;
  }
}

/** 建筑顶部标注高度（用于标签避让，可扩展） */
export function buildingTopOffset(kind: BuildingKind): number {
  switch (kind) {
    case BuildingKind.Factory: return 52;
    case BuildingKind.Admin: return 50;
    case BuildingKind.Townhouse: return 42;
    case BuildingKind.Services: return 40;
    case BuildingKind.Wall: return 18;
    default: return 28;
  }
}
