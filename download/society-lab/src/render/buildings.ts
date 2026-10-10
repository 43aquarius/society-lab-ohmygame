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
    case BuildingKind.Castle: return { w: 1.7, d: 1.5 };
    case BuildingKind.Manor: return { w: 1.6, d: 1.4 };
    case BuildingKind.Temple: return { w: 1.5, d: 1.3 };
    case BuildingKind.Academy: return { w: 1.3, d: 1.1 };
    case BuildingKind.Bank: return { w: 1.3, d: 1.1 };
    case BuildingKind.Theater: return { w: 1.4, d: 1.3 };
    case BuildingKind.Hospital: return { w: 1.2, d: 1.1 };
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
      // 窝棚：树枝斜搭 + 茅草（v2.0 更精细：骨架线条 + 茅草层次）
      shadow(ctx, sx, sy, 0.7, 0.7);
      const h = 13;
      ctx.strokeStyle = pal.woodDark;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy + 5); ctx.lineTo(sx - 2, sy - h);
      ctx.moveTo(sx + 10, sy + 5); ctx.lineTo(sx + 2, sy - h);
      ctx.moveTo(sx - 7, sy + 1); ctx.lineTo(sx + 1, sy - h + 3);
      ctx.stroke();
      // 茅草面（两片，带茅草簇）
      ctx.fillStyle = pal.roof;
      ctx.beginPath();
      ctx.moveTo(sx - 2, sy + 7); ctx.lineTo(sx - 13, sy - h + 2); ctx.lineTo(sx + 1, sy - h - 1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = pal.roofDark;
      ctx.beginPath();
      ctx.moveTo(sx + 2, sy + 7); ctx.lineTo(sx + 12, sy - h + 3); ctx.lineTo(sx + 2, sy - h - 1);
      ctx.closePath(); ctx.fill();
      // 茅草纹理
      ctx.strokeStyle = 'rgba(120,96,52,0.5)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(sx - 9 + i * 3, sy - h * 0.35 + i);
        ctx.lineTo(sx - 6 + i * 3, sy - h * 0.62 + i);
      }
      ctx.stroke();
      break;
    }
    case BuildingKind.House: {
      // 农舍 v2.0：木板墙纹理 + 双窗 + 门廊
      box(ctx, sx, sy, 0.85, 0.85, 14, pal.wood, pal.woodDark, shade(pal.wood, 0.85));
      // 木板横纹
      ctx.strokeStyle = 'rgba(90,64,42,0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 1; i <= 3; i++) {
        const yy = sy - 2 - i * 3;
        ctx.moveTo(sx - 13, yy - 13.5); ctx.lineTo(sx, yy - 19.5);
        ctx.moveTo(sx + 13, yy - 13.5); ctx.lineTo(sx, yy - 19.5);
      }
      ctx.stroke();
      gableRoof(ctx, sx, sy, 0.95, 0.95, 14, 8, pal);
      if (lod > 0.7) {
        ctx.fillStyle = 'rgba(255,214,140,0.85)';
        ctx.fillRect(sx + 4, sy - 8, 4, 4);
        ctx.fillRect(sx - 9, sy - 11, 3.5, 3.5);
        ctx.fillStyle = pal.woodDark;
        ctx.fillRect(sx - 5, sy - 5, 5, 6);
        ctx.fillStyle = 'rgba(40,30,20,0.5)';
        ctx.fillRect(sx - 5, sy - 5, 5, 1.2); // 门楣阴影
      }
      if (!ghost && lod > 0.6) smoke(ctx, sx - 6, sy, sy - 26, time, seed, 0.5);
      break;
    }
    case BuildingKind.Townhouse: {
      box(ctx, sx, sy, 0.8, 0.8, 30, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      // 砖缝
      ctx.strokeStyle = 'rgba(90,88,84,0.3)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 1; i <= 7; i++) {
        const yy = sy - i * 3.4;
        ctx.moveTo(sx - 12.5, yy - 12); ctx.lineTo(sx, yy - 17.5);
        ctx.moveTo(sx + 12.5, yy - 12); ctx.lineTo(sx, yy - 17.5);
      }
      ctx.stroke();
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
    // ============ v2.0 时代建筑 ============
    case BuildingKind.Temple: {
      // 神庙：三级台基 + 柱廊 + 金顶
      box(ctx, sx, sy, 1.4, 1.2, 4, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      box(ctx, sx, sy - 4, 1.25, 1.05, 3, shade(pal.stone, 0.94), pal.stoneDark, shade(pal.stone, 0.84));
      box(ctx, sx, sy - 7, 1.1, 0.9, 14, pal.stone, pal.stoneDark, shade(pal.stone, 0.82));
      // 柱廊（浅色立柱）
      if (lod > 0.5) {
        ctx.fillStyle = 'rgb(232,226,210)';
        for (let i = -2; i <= 2; i++) {
          const px = sx + i * 11;
          const py = sy - 9 + Math.abs(i) * -1.6;
          ctx.fillRect(px - 1.6, py - 12, 3.2, 12);
        }
        ctx.fillStyle = 'rgba(180,168,146,0.6)';
        for (let i = -2; i <= 2; i++) {
          const px = sx + i * 11;
          const py = sy - 9 + Math.abs(i) * -1.6;
          ctx.fillRect(px + 0.4, py - 12, 1.2, 12);
        }
      }
      // 金色梯形顶
      ctx.fillStyle = 'rgb(214,178,84)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 34);
      ctx.lineTo(sx + 30, sy - 22);
      ctx.lineTo(sx + 24, sy - 19);
      ctx.lineTo(sx - 24, sy - 19);
      ctx.lineTo(sx - 30, sy - 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgb(178,142,58)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 34);
      ctx.lineTo(sx + 30, sy - 22);
      ctx.lineTo(sx + 24, sy - 19);
      ctx.lineTo(sx, sy - 26);
      ctx.closePath();
      ctx.fill();
      // 顶饰
      ctx.fillStyle = 'rgb(240,216,140)';
      ctx.beginPath();
      ctx.arc(sx, sy - 36, 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (!ghost && lod > 0.6) smoke(ctx, sx, sy - 24, sy - 52, time, seed, 0.45); // 香火
      break;
    }
    case BuildingKind.Manor: {
      // 庄园：主楼 + 厢房 + 围栏
      box(ctx, sx - 14, sy + 2, 0.7, 0.6, 10, pal.wood, pal.woodDark, shade(pal.wood, 0.84));
      gableRoof(ctx, sx - 14, sy + 2, 0.8, 0.7, 10, 6, pal);
      box(ctx, sx, sy, 1.15, 1.0, 18, pal.wood, pal.woodDark, shade(pal.wood, 0.82));
      gableRoof(ctx, sx, sy, 1.25, 1.1, 18, 9, pal);
      if (lod > 0.55) {
        // 明窗 + 大门 + 山墙装饰
        ctx.fillStyle = 'rgba(255,214,140,0.9)';
        ctx.fillRect(sx - 8, sy - 12, 4, 5);
        ctx.fillRect(sx + 4, sy - 12, 4, 5);
        ctx.fillRect(sx - 2, sy - 22, 4, 4);
        ctx.fillStyle = pal.woodDark;
        ctx.fillRect(sx - 2.5, sy - 4, 5, 6);
      }
      if (lod > 0.6) {
        // 围栏
        ctx.strokeStyle = pal.woodDark;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const fx = sx + 16 + i * 5, fy = sy + 8 - i * 2.2;
          ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 4);
        }
        ctx.moveTo(sx + 16, sy + 6.5); ctx.lineTo(sx + 36, sy - 2.5);
        ctx.stroke();
      }
      break;
    }
    case BuildingKind.Castle: {
      // 城堡：主楼 + 双塔 + 城齿 + 旗
      box(ctx, sx, sy, 1.15, 1.0, 26, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      box(ctx, sx - 22, sy + 3, 0.45, 0.4, 34, pal.stone, pal.stoneDark, shade(pal.stone, 0.78));
      box(ctx, sx + 22, sy + 3, 0.45, 0.4, 34, pal.stone, pal.stoneDark, shade(pal.stone, 0.78));
      // 城齿（主楼与塔）
      ctx.fillStyle = pal.stone;
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(sx + i * 10 - 3.4, sy - 30 + Math.abs(i) * 2.4, 6.8, 6);
      }
      for (const tx of [sx - 22, sx + 22]) {
        for (let i = -1; i <= 1; i++) {
          ctx.fillRect(tx + i * 7 - 2.6, sy - 33 + Math.abs(i) * 2 + 3, 5.2, 5);
        }
        // 塔顶锥
        ctx.fillStyle = pal.roof;
        ctx.beginPath();
        ctx.moveTo(tx, sy - 52);
        ctx.lineTo(tx + 9, sy - 36);
        ctx.lineTo(tx - 9, sy - 36);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pal.roofDark;
        ctx.beginPath();
        ctx.moveTo(tx, sy - 52);
        ctx.lineTo(tx + 9, sy - 36);
        ctx.lineTo(tx, sy - 38);
        ctx.closePath();
        ctx.fill();
      }
      // 主旗
      if (lod > 0.5) {
        ctx.strokeStyle = pal.cloth;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 32); ctx.lineTo(sx, sy - 50);
        ctx.stroke();
        const wave = Math.sin(time * 0.004 + seed * 7) * 2.5;
        ctx.fillStyle = 'rgb(168,74,58)';
        ctx.beginPath();
        ctx.moveTo(sx, sy - 50);
        ctx.lineTo(sx + 14 + wave, sy - 46);
        ctx.lineTo(sx, sy - 41);
        ctx.closePath();
        ctx.fill();
        // 门与箭窗
        ctx.fillStyle = 'rgb(58,44,34)';
        ctx.fillRect(sx - 3.4, sy - 7, 6.8, 7);
        ctx.fillRect(sx - 22 - 1.5, sy - 8, 3, 4);
        ctx.fillRect(sx + 22 - 1.5, sy - 8, 3, 4);
      }
      break;
    }
    case BuildingKind.Academy: {
      // 学堂：厅堂 + 钟楼
      box(ctx, sx, sy, 1.05, 0.9, 16, 'rgb(184,142,96)', 'rgb(146,108,70)', 'rgb(162,124,84)');
      gableRoof(ctx, sx, sy, 1.15, 1.0, 16, 8, pal);
      box(ctx, sx + 18, sy - 2, 0.34, 0.3, 26, pal.stone, pal.stoneDark, shade(pal.stone, 0.82));
      // 钟楼尖顶
      ctx.fillStyle = 'rgb(70,86,110)';
      ctx.beginPath();
      ctx.moveTo(sx + 18, sy - 34);
      ctx.lineTo(sx + 26, sy - 26);
      ctx.lineTo(sx + 10, sy - 26);
      ctx.closePath();
      ctx.fill();
      if (lod > 0.55) {
        // 钟
        ctx.fillStyle = 'rgb(214,178,84)';
        ctx.beginPath();
        ctx.moveTo(sx + 16, sy - 24);
        ctx.quadraticCurveTo(sx + 18, sy - 20, sx + 20, sy - 24);
        ctx.closePath();
        ctx.fill();
        // 门窗
        ctx.fillStyle = 'rgba(255,214,140,0.85)';
        ctx.fillRect(sx - 8, sy - 12, 4, 5);
        ctx.fillRect(sx + 4, sy - 12, 4, 5);
        ctx.fillStyle = 'rgb(88,62,42)';
        ctx.fillRect(sx - 2.4, sy - 6, 4.8, 6);
        // 书卷匾额
        ctx.fillStyle = 'rgb(240,232,210)';
        ctx.fillRect(sx - 7, sy - 21, 14, 5);
        ctx.strokeStyle = 'rgb(120,100,70)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(sx - 7, sy - 21, 14, 5);
        ctx.beginPath();
        ctx.moveTo(sx - 4, sy - 19.5); ctx.lineTo(sx + 4, sy - 19.5);
        ctx.moveTo(sx - 4, sy - 17.5); ctx.lineTo(sx + 2, sy - 17.5);
        ctx.stroke();
      }
      break;
    }
    case BuildingKind.Bank: {
      // 银行：石砌殿堂 + 三角楣 + 四柱
      box(ctx, sx, sy, 1.2, 1.0, 18, pal.stone, pal.stoneDark, shade(pal.stone, 0.84));
      // 四柱
      ctx.fillStyle = 'rgb(226,220,206)';
      for (let i = 0; i < 4; i++) {
        const px = sx - 15 + i * 10;
        ctx.fillRect(px - 1.8, sy - 16 + Math.abs(i - 1.5) * -1.2, 3.6, 14);
      }
      // 檐口
      box(ctx, sx, sy - 16, 1.3, 1.1, 3, 'rgb(214,208,196)', 'rgb(178,172,160)', 'rgb(196,190,178)');
      // 三角楣
      ctx.fillStyle = 'rgb(226,220,206)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 30);
      ctx.lineTo(sx + 26, sy - 19);
      ctx.lineTo(sx - 26, sy - 19);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(178,172,160,0.55)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 30);
      ctx.lineTo(sx + 26, sy - 19);
      ctx.lineTo(sx, sy - 22);
      ctx.closePath();
      ctx.fill();
      if (lod > 0.55) {
        // 门 + 金币徽记
        ctx.fillStyle = 'rgb(64,54,44)';
        ctx.fillRect(sx - 5, sy - 8, 10, 8);
        ctx.fillStyle = 'rgb(214,178,84)';
        ctx.beginPath();
        ctx.arc(sx, sy - 25, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgb(150,118,50)';
        ctx.font = '600 4px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('¥', sx, sy - 23.8);
      }
      break;
    }
    case BuildingKind.Theater: {
      // 剧场：半环形看台 + 条纹篷
      ctx.fillStyle = 'rgb(190,168,132)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 26, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(162,140,108)';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 21, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(122,102,78)';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 13, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // 舞台
      ctx.fillStyle = 'rgb(214,190,150)';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      if (lod > 0.5) {
        // 看台坐席弧线
        ctx.strokeStyle = 'rgba(96,80,60,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(sx, sy - 3, 17, 9, 0, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        // 条纹大篷 + 旗杆
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? 'rgb(168,74,58)' : 'rgb(238,228,208)';
          ctx.fillRect(sx - 14 + i * 5.6, sy - 16, 5.6, 4);
        }
        ctx.fillStyle = 'rgb(96,80,60)';
        ctx.fillRect(sx - 15, sy - 20, 30, 2);
      }
      break;
    }
    case BuildingKind.Hospital: {
      // 医院：白楼 + 红十字旗
      box(ctx, sx, sy, 1.05, 0.9, 18, 'rgb(234,236,232)', 'rgb(198,204,200)', 'rgb(218,222,218)');
      gableRoof(ctx, sx, sy, 1.15, 1.0, 18, 6, { ...pal, roof: 'rgb(148,164,172)', roofDark: 'rgb(120,136,144)' });
      if (lod > 0.5) {
        // 窗（成排）
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = 'rgba(168,200,216,0.9)';
          ctx.fillRect(sx - 10 + i * 8, sy - 13, 4.5, 4);
          ctx.fillRect(sx - 10 + i * 8, sy - 5, 4.5, 4);
        }
        // 十字旗
        ctx.strokeStyle = 'rgb(160,160,156)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 24); ctx.lineTo(sx, sy - 40);
        ctx.stroke();
        ctx.fillStyle = 'rgb(224,224,220)';
        ctx.fillRect(sx + 0.5, sy - 40, 13, 9);
        ctx.fillStyle = 'rgb(200,72,58)';
        ctx.fillRect(sx + 5, sy - 39, 4, 7);
        ctx.fillRect(sx + 2.5, sy - 37.5, 9, 3.5);
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
    case BuildingKind.Bank: case BuildingKind.Theater: return 3;
    case BuildingKind.Cooperative: case BuildingKind.Services: case BuildingKind.Hospital: return 4;
    case BuildingKind.Temple: case BuildingKind.Manor: case BuildingKind.Castle: return 2;
    case BuildingKind.Academy: return lvl('education') >= 4 ? 3 : 2;
    case BuildingKind.Market: case BuildingKind.Admin: case BuildingKind.Wall: case BuildingKind.Workshop: return 2;
    default: return lvl('agriculture') >= 2 ? 1 : 0;
  }
}

/** 建筑顶部标注高度（用于标签避让，可扩展） */
export function buildingTopOffset(kind: BuildingKind): number {
  switch (kind) {
    case BuildingKind.Factory: return 52;
    case BuildingKind.Admin: return 50;
    case BuildingKind.Castle: return 54;
    case BuildingKind.Temple: return 40;
    case BuildingKind.Townhouse: return 42;
    case BuildingKind.Services: return 40;
    case BuildingKind.Wall: return 18;
    default: return 28;
  }
}
