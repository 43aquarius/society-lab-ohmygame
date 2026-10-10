/**
 * 建筑渲染 — 程序化等距建筑（v3.0 全面精细化）
 * 比例修正：小人 13px；农舍约 42px、街屋 58px、城堡近 90px、树木 22-36px
 * —— 人与建筑/树木拉开真实比例。
 * 所有建筑坐落石砌台基（坡地上台基自然加深，不再"平地起"）；
 * 夜晚窗户透出暖光（收集到 LIGHTS，由 world.ts 在暗幕之上叠加）；
 * 建造中有脚手架；农田作物随年度周期生长，饥荒年枯黄。
 */
import { BuildingKind, type Building, type WorldState } from '../types';
import { tileAt } from '../worldgen';
import { TILE_W, TILE_H, ELEV_H, vhash, elevAt } from './iso';

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

/** 夜间光源收集（world.ts 在暗幕之上叠加绘制） */
export interface LightSrc { x: number; y: number; r: number; c: string }
let LIGHTS: LightSrc[] = [];
export function beginLights() { LIGHTS = []; }
export function collectLights(): LightSrc[] { return LIGHTS; }
function glow(x: number, y: number, r: number, c = 'rgba(255,196,110,0.55)') {
  if (LIGHTS.length < 400) LIGHTS.push({ x, y, r, c });
}
/** 夜里暖光的窗 */
function windowLit(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, night: number) {
  if (night > 0.22) {
    const a = Math.min(1, (night - 0.22) * 3);
    ctx.fillStyle = `rgba(255,196,110,${(0.55 + a * 0.45).toFixed(2)})`;
    ctx.fillRect(x, y, w, h);
    glow(x + w / 2, y + h / 2, 9 + w, `rgba(255,186,96,${(0.34 * a).toFixed(2)})`);
  } else {
    ctx.fillStyle = 'rgba(86,104,112,0.85)';
    ctx.fillRect(x, y, w, h);
  }
}

/** 建筑占地（格）与总高（px，供标签避让） */
export function footprint(kind: BuildingKind): { w: number; d: number } {
  switch (kind) {
    case BuildingKind.Admin: return { w: 1.7, d: 1.5 };
    case BuildingKind.Factory: return { w: 2.0, d: 1.7 };
    case BuildingKind.Services: return { w: 1.6, d: 1.4 };
    case BuildingKind.Cooperative: return { w: 1.5, d: 1.3 };
    case BuildingKind.Market: return { w: 1.7, d: 1.4 };
    case BuildingKind.Castle: return { w: 1.9, d: 1.6 };
    case BuildingKind.Manor: return { w: 1.7, d: 1.5 };
    case BuildingKind.Temple: return { w: 1.6, d: 1.4 };
    case BuildingKind.Academy: return { w: 1.4, d: 1.2 };
    case BuildingKind.Bank: return { w: 1.4, d: 1.2 };
    case BuildingKind.Theater: return { w: 1.6, d: 1.4 };
    case BuildingKind.Hospital: return { w: 1.3, d: 1.2 };
    case BuildingKind.Wall: return { w: 1.7, d: 0.8 };
    case BuildingKind.House: return { w: 1.05, d: 1.0 };
    case BuildingKind.Townhouse: return { w: 0.95, d: 0.9 };
    case BuildingKind.Granary: return { w: 0.9, d: 0.85 };
    case BuildingKind.Workshop: return { w: 1.1, d: 1.0 };
    default: return { w: 1, d: 1 };
  }
}

/** 等距立方体：中心 (cx,cy)（地面），格尺寸 (gw, gd)，高 hp 像素 */
function box(ctx: CanvasRenderingContext2D, cx: number, cy: number, gw: number, gd: number, hp: number, top: string, left: string, right: string) {
  const hw = (gw * TILE_W) / 2, hd = (gd * TILE_H) / 2;
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx, cy + hd - hp);
  ctx.lineTo(cx - hw, cy - hp);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hd);
  ctx.lineTo(cx, cy + hd - hp);
  ctx.lineTo(cx + hw, cy - hp);
  ctx.closePath();
  ctx.fill();
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

/** 双坡屋顶（屋脊沿 SW-NE） */
function gableRoof(ctx: CanvasRenderingContext2D, cx: number, cy: number, gw: number, gd: number, hp: number, hrh: number, pal: BuildingPalette, flip = false) {
  const hw = (gw * TILE_W) / 2, hd = (gd * TILE_H) / 2;
  const peak = hp + hrh;
  if (!flip) {
    ctx.fillStyle = pal.roof;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hd - peak);
    ctx.lineTo(cx + hw, cy - peak);
    ctx.lineTo(cx + hw, cy - hp);
    ctx.lineTo(cx, cy + hd - hp);
    ctx.closePath();
    ctx.fill();
    // 瓦垄线
    ctx.strokeStyle = shade(pal.roofDark, 0.9);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      ctx.moveTo(cx + t * hw, cy + hd * (1 - t) - peak + t * hrh * 0.2);
      ctx.lineTo(cx + t * hw, cy + hd * (1 - t) - hp - t * (peak - hp) * 0.05);
    }
    ctx.stroke();
    ctx.fillStyle = pal.roofDark;
    ctx.beginPath();
    ctx.moveTo(cx, cy + hd - peak);
    ctx.lineTo(cx - hw, cy - peak);
    ctx.lineTo(cx - hw, cy - hp);
    ctx.lineTo(cx, cy + hd - hp);
    ctx.closePath();
    ctx.fill();
    // 屋脊
    ctx.fillStyle = shade(pal.roofDark, 0.8);
    ctx.fillRect(cx - 2.4, cy + hd - peak - 1.4, 4.8, peak - hp + 1.4);
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

/** 石砌台基：建筑"坐"在地上；坡地自动加深 */
function plinth(ctx: CanvasRenderingContext2D, w: WorldState, cx: number, cy: number, b: Building, gw: number, gd: number, pal: BuildingPalette) {
  const size = w.config.size;
  const e = elevAt(w, b.x, b.y);
  const nMin = Math.min(
    b.x + 1 >= size ? 0 : elevAt(w, b.x + 1, b.y),
    b.x - 1 < 0 ? 0 : elevAt(w, b.x - 1, b.y),
    b.y + 1 >= size ? 0 : elevAt(w, b.x, b.y + 1),
    b.y - 1 < 0 ? 0 : elevAt(w, b.x, b.y - 1),
  );
  const depth = Math.max(4, (e - nMin) * ELEV_H + 5);
  const hw = (gw * TILE_W) / 2 + 4, hd = (gd * TILE_H) / 2 + 2.5;
  // 左右两面台基
  ctx.fillStyle = pal.stone;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy);
  ctx.lineTo(cx - hw + 5, cy + hd * 0.35);
  ctx.lineTo(cx - hw + 5, cy + hd * 0.35 + depth);
  ctx.lineTo(cx - hw, cy + depth);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal.stoneDark;
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy);
  ctx.lineTo(cx + hw - 5, cy + hd * 0.35);
  ctx.lineTo(cx + hw - 5, cy + hd * 0.35 + depth);
  ctx.lineTo(cx + hw, cy + depth);
  ctx.closePath();
  ctx.fill();
  // 前缘
  ctx.fillStyle = shade(pal.stone, 0.82);
  ctx.fillRect(cx - hw * 0.4, cy + hd * 0.5, hw * 0.8, Math.min(depth, 6));
  // 石缝
  ctx.strokeStyle = 'rgba(70,66,60,0.4)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - hw + 1.5, cy + depth * 0.5);
  ctx.lineTo(cx - hw + 6, cy + hd * 0.35 + depth * 0.5);
  ctx.moveTo(cx + hw - 1.5, cy + depth * 0.6);
  ctx.lineTo(cx + hw - 6, cy + hd * 0.35 + depth * 0.6);
  ctx.stroke();
}

function shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, gw: number, gd: number) {
  const hw = (gw * TILE_W) / 2 + 5, hd = (gd * TILE_H) / 2 + 3;
  ctx.fillStyle = 'rgba(40,52,44,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 3, hw * 0.82, hd * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 烟囱烟雾 */
function smoke(ctx: CanvasRenderingContext2D, cx: number, cy: number, topY: number, time: number, seed: number, intensity = 1) {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const ph = (time * 0.0004 + i / n + seed) % 1;
    const a = (1 - ph) * 0.28 * intensity;
    const r = 2.5 + ph * 8;
    ctx.fillStyle = `rgba(220,222,226,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(ph * 6 + seed * 9) * 5, topY - ph * 30, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 绘制建筑。sx, sy 为建筑所在格的地表世界像素（含海拔抬升）。
 * night 0..1：夜间窗户亮灯。
 */
export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  b: Building,
  sx: number, sy: number,
  time: number,
  lod: number,
  night = 0,
) {
  const era = eraOf(w, b);
  const pal = PALETTES[era];
  const fp = footprint(b.kind);
  const seed = vhash(b.x, b.y, 5);

  if (b.progress < 1) {
    shadow(ctx, sx, sy, fp.w, fp.d);
    ctx.globalAlpha = 0.35 + b.progress * 0.6;
    drawCompleted(ctx, w, b, sx, sy, time, era, pal, seed, lod, true, 0);
    ctx.globalAlpha = 1;
    // 脚手架
    ctx.strokeStyle = 'rgba(120,90,56,0.85)';
    ctx.lineWidth = 1.8;
    const hw = (fp.w * TILE_W) / 2, hd = (fp.d * TILE_H) / 2;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy); ctx.lineTo(sx, sy + hd); ctx.lineTo(sx, sy + hd - 34); ctx.lineTo(sx - hw, sy - 34); ctx.closePath();
    ctx.moveTo(sx + hw, sy); ctx.lineTo(sx, sy + hd); ctx.lineTo(sx, sy + hd - 34); ctx.lineTo(sx + hw, sy - 34); ctx.closePath();
    // 横杆
    ctx.moveTo(sx - hw, sy - 14); ctx.lineTo(sx, sy + hd - 14);
    ctx.moveTo(sx + hw, sy - 20); ctx.lineTo(sx, sy + hd - 20);
    ctx.stroke();
    return;
  }
  shadow(ctx, sx, sy, fp.w, fp.d);
  plinth(ctx, w, sx, sy, b, fp.w, fp.d, pal);
  drawCompleted(ctx, w, b, sx, sy, time, era, pal, seed, lod, false, night);
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
  night: number,
) {
  switch (b.kind) {
    case BuildingKind.Camp: {
      // 营地：兽皮帐篷 + 篝火（夜光大）
      const h = 20;
      ctx.fillStyle = pal.cloth;
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy + 9);
      ctx.lineTo(sx - 21, sy - h);
      ctx.lineTo(sx + 2, sy - h - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = pal.roof;
      ctx.beginPath();
      ctx.moveTo(sx + 2, sy + 9);
      ctx.lineTo(sx + 18, sy - h + 2);
      ctx.lineTo(sx + 2, sy - h - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(60,42,26,0.85)';
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy + 9); ctx.lineTo(sx - 11, sy - h + 9); ctx.lineTo(sx + 2, sy - h - 3);
      ctx.closePath(); ctx.fill();
      // 支杆
      ctx.strokeStyle = 'rgb(104,78,50)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx - 21, sy - h); ctx.lineTo(sx - 24, sy - h - 6);
      ctx.moveTo(sx + 18, sy - h + 2); ctx.lineTo(sx + 21, sy - h - 4);
      ctx.stroke();
      // 晾晒的兽皮
      ctx.fillStyle = 'rgb(166,132,96)';
      ctx.beginPath();
      ctx.moveTo(sx + 14, sy + 6); ctx.lineTo(sx + 24, sy + 1); ctx.lineTo(sx + 24, sy + 8); ctx.lineTo(sx + 14, sy + 12);
      ctx.closePath(); ctx.fill();
      // 篝火
      {
        const fx = sx + 8, fy = sy + 14;
        ctx.strokeStyle = 'rgb(96,72,46)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx - 5, fy + 1); ctx.lineTo(fx + 4, fy - 2);
        ctx.moveTo(fx - 4, fy - 2); ctx.lineTo(fx + 5, fy + 1);
        ctx.stroke();
        if (!ghost && lod > 0.4) {
          const fl = 4 + Math.sin(time * 0.008 + seed * 9) * 1.8;
          ctx.fillStyle = 'rgb(224,116,46)';
          ctx.beginPath();
          ctx.ellipse(fx, fy - 3, 3.4, fl, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,206,90,0.8)';
          ctx.beginPath();
          ctx.ellipse(fx, fy - 2.4, 1.8, fl * 0.55, 0, 0, Math.PI * 2); ctx.fill();
          // 火光光晕（夜）
          glow(fx, fy - 3, 26 + Math.sin(time * 0.006) * 3, `rgba(255,168,80,${(0.5 * Math.max(0.3, night) + 0.15).toFixed(2)})`);
        }
      }
      break;
    }
    case BuildingKind.Shelter: {
      // 窝棚：树枝斜搭 + 茅草（斜顶人字形）
      const h = 17;
      ctx.strokeStyle = pal.woodDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 13, sy + 6); ctx.lineTo(sx - 2, sy - h);
      ctx.moveTo(sx + 13, sy + 6); ctx.lineTo(sx + 2, sy - h);
      ctx.moveTo(sx - 8, sy + 1); ctx.lineTo(sx + 1, sy - h + 4);
      ctx.stroke();
      ctx.fillStyle = pal.roof;
      ctx.beginPath();
      ctx.moveTo(sx - 2, sy + 8); ctx.lineTo(sx - 16, sy - h + 3); ctx.lineTo(sx + 1, sy - h - 1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = pal.roofDark;
      ctx.beginPath();
      ctx.moveTo(sx + 2, sy + 8); ctx.lineTo(sx + 15, sy - h + 4); ctx.lineTo(sx + 2, sy - h - 1);
      ctx.closePath(); ctx.fill();
      // 茅草纹理
      ctx.strokeStyle = 'rgba(120,96,52,0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(sx - 11 + i * 3.4, sy - h * 0.32 + i);
        ctx.lineTo(sx - 8 + i * 3.4, sy - H2(h, 0.62) + i);
      }
      ctx.stroke();
      break;
    }
    case BuildingKind.House: {
      // 农舍：石基 + 木骨泥墙 + 茅草双坡顶 + 烟囱
      const wall = 24;
      box(ctx, sx, sy, 0.95, 0.9, wall, pal.wood, pal.woodDark, shade(pal.wood, 0.85));
      // 木骨架（半木结构）
      ctx.strokeStyle = shade(pal.woodDark, 0.75);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx - 14, sy - wall + 2); ctx.lineTo(sx - 14, sy - 2);
      ctx.moveTo(sx + 14, sy - wall + 2); ctx.lineTo(sx + 14, sy - 2);
      ctx.moveTo(sx, sy - wall + 20 + 2); ctx.lineTo(sx, sy - 2);
      // 斜撑
      ctx.moveTo(sx - 13, sy - 6); ctx.lineTo(sx - 4, sy - wall * 0.62);
      ctx.moveTo(sx + 13, sy - 6); ctx.lineTo(sx + 4, sy - wall * 0.62);
      ctx.stroke();
      gableRoof(ctx, sx, sy, 1.05, 1.0, wall, 12, pal);
      // 烟囱
      box(ctx, sx - 13, sy - wall - 6, 0.16, 0.16, 14, pal.stone, pal.stoneDark, shade(pal.stone, 0.85));
      if (!ghost && lod > 0.5) smoke(ctx, sx - 13, sy - wall - 6, sy - wall - 22, time, seed, 0.55);
      // 门 + 台阶
      ctx.fillStyle = pal.woodDark;
      ctx.fillRect(sx - 4, sy - 11, 8, 11);
      ctx.fillStyle = 'rgba(40,30,20,0.5)';
      ctx.fillRect(sx - 4, sy - 11, 8, 1.6);
      ctx.fillStyle = shade(pal.stone, 0.9);
      ctx.fillRect(sx - 5.5, sy, 11, 2.4);
      // 窗
      if (lod > 0.6) {
        windowLit(ctx, sx + 5, sy - 15, 5.5, 5.5, night);
        windowLit(ctx, sx - 10.5, sy - 18, 5, 5, night);
      }
      // 屋旁柴堆
      if (lod > 0.75) {
        ctx.strokeStyle = 'rgb(112,82,52)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) ctx.moveTo(sx + 16, sy + 5 - i * 2.6), ctx.lineTo(sx + 25, sy + 3 - i * 2.6);
        ctx.stroke();
      }
      break;
    }
    case BuildingKind.Townhouse: {
      // 街屋：两层砖楼 + 砖缝 + 排窗
      const wall = 46;
      box(ctx, sx, sy, 0.9, 0.85, wall, pal.stone, pal.stoneDark, shade(pal.stone, 0.82));
      ctx.strokeStyle = 'rgba(90,88,84,0.3)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 1; i <= 11; i++) {
        const yy = sy - i * 4;
        ctx.moveTo(sx - 14, yy - 14.5); ctx.lineTo(sx, yy - 20);
        ctx.moveTo(sx + 14, yy - 14.5); ctx.lineTo(sx, yy - 20);
      }
      ctx.stroke();
      gableRoof(ctx, sx, sy, 1.0, 0.95, wall, 11, pal);
      if (lod > 0.6) {
        for (let i = 0; i < 4; i++) {
          windowLit(ctx, sx + 4, sy - 8 - i * 10, 4.6, 5.4, night);
          windowLit(ctx, sx - 9, sy - 8 - i * 10, 4.6, 5.4, night);
        }
        // 店招横匾
        ctx.fillStyle = 'rgb(120,86,58)';
        ctx.fillRect(sx - 8, sy - 4, 16, 3.4);
        ctx.fillStyle = 'rgb(232,220,190)';
        ctx.fillRect(sx - 7, sy - 3.4, 14, 2.2);
      }
      break;
    }
    case BuildingKind.Farm: {
      const growth = cropGrowth(w, b);
      const sid = tileAt(w, b.x, b.y)?.owner ?? -1;
      const st = sid >= 0 ? w.settlements.find(x => x.id === sid) ?? null : null;
      drawField(ctx, sx, sy, growth, seed, st ? st.shortageYears > 1 : false);
      break;
    }
    case BuildingKind.Granary: {
      // 架高粮仓（防潮）+ 粮袋
      const lift = 10;
      ctx.strokeStyle = pal.woodDark;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(sx - 13, sy + 5); ctx.lineTo(sx - 13, sy - lift);
      ctx.moveTo(sx + 13, sy + 5); ctx.lineTo(sx + 13, sy - lift);
      ctx.moveTo(sx - 6, sy + 8); ctx.lineTo(sx - 6, sy - lift + 2);
      ctx.moveTo(sx + 6, sy + 8); ctx.lineTo(sx + 6, sy - lift + 2);
      ctx.stroke();
      box(ctx, sx, sy - lift, 0.85, 0.8, 13, pal.wood, pal.woodDark, shade(pal.wood, 0.85));
      gableRoof(ctx, sx, sy - lift, 0.95, 0.9, 13, 10, pal);
      if (lod > 0.6) {
        ctx.fillStyle = 'rgb(224,196,120)';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(sx + 15 + i * 4.4, sy + 4 - i * 1.2, 2.6, 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case BuildingKind.Well: {
      // 石井 + 辘轳架
      ctx.fillStyle = pal.stone;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 11, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,86,80,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 8, 4.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgb(58,96,130)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 6.5, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pal.woodDark;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy); ctx.lineTo(sx - 5, sy - 17);
      ctx.moveTo(sx + 8, sy); ctx.lineTo(sx + 5, sy - 17);
      ctx.moveTo(sx - 6, sy - 16); ctx.lineTo(sx + 6, sy - 16);
      ctx.stroke();
      // 吊桶
      ctx.fillStyle = 'rgb(140,108,66)';
      ctx.fillRect(sx - 2.4, sy - 11, 4.8, 4);
      ctx.fillStyle = pal.roof;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 16); ctx.lineTo(sx, sy - 24); ctx.lineTo(sx + 10, sy - 16);
      ctx.closePath(); ctx.fill();
      break;
    }
    case BuildingKind.Workshop: {
      const wall = 28;
      box(ctx, sx, sy, 1.0, 0.95, wall, pal.wood, pal.woodDark, shade(pal.wood, 0.82));
      gableRoof(ctx, sx, sy, 1.1, 1.05, wall, 11, pal);
      box(ctx, sx + 13, sy - 5, 0.26, 0.26, 30, pal.stone, pal.stoneDark, pal.stone);
      if (!ghost) smoke(ctx, sx + 13, sy - 5, sy - 38, time, seed, 1);
      if (lod > 0.65) {
        windowLit(ctx, sx - 7, sy - 16, 6, 6, night);
        // 门前砧与工件
        ctx.fillStyle = 'rgb(120,92,60)';
        ctx.fillRect(sx - 17, sy + 3, 8, 4);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(sx + 12, sy + 4, 5, 2.4);
      }
      break;
    }
    case BuildingKind.Market: {
      // 集市：多顶条纹帐篷摊位 + 货箱
      const stalls: [number, number][] = [[-17, 2], [4, 8], [18, 0]];
      for (let si = 0; si < stalls.length; si++) {
        const [ox, oy] = stalls[si];
        const px = sx + ox, py = sy + oy;
        ctx.strokeStyle = pal.woodDark;
        ctx.lineWidth = 2;
        for (const [qx, qy] of [[-10, 0], [10, 0], [0, 5], [0, -5]] as const) {
          ctx.beginPath(); ctx.moveTo(px + qx, py + qy); ctx.lineTo(px + qx, py + qy - 14); ctx.stroke();
        }
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = (i + si) % 2 ? pal.roof : pal.cloth;
          const t0 = i / 6, t1 = (i + 1) / 6;
          ctx.beginPath();
          ctx.moveTo(px - 10 + t0 * 20, py - 5 + t0 * 10 - 14);
          ctx.lineTo(px - 10 + t1 * 20, py - 5 + t1 * 10 - 14);
          ctx.lineTo(px - 10 + t1 * 20, py + 5 - t1 * 10 - 14);
          ctx.lineTo(px - 10 + t0 * 20, py + 5 - t0 * 10 - 14);
          ctx.closePath();
          ctx.fill();
        }
        // 摊上货物
        if (lod > 0.55) {
          ctx.fillStyle = si === 0 ? 'rgb(206,120,86)' : si === 1 ? 'rgb(214,178,84)' : 'rgb(146,168,96)';
          for (let g2 = 0; g2 < 3; g2++) {
            ctx.beginPath();
            ctx.ellipse(px - 5 + g2 * 5, py - 2, 2.2, 1.6, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (lod > 0.6) {
        // 货箱与货担
        ctx.fillStyle = 'rgb(148,112,68)';
        ctx.fillRect(sx - 26, sy + 9, 9, 5);
        ctx.fillStyle = 'rgb(112,84,52)';
        ctx.fillRect(sx - 26, sy + 9, 9, 1.4);
      }
      break;
    }
    case BuildingKind.Admin: {
      // 公廨：台基 + 柱廊 + 旗
      box(ctx, sx, sy, 1.6, 1.4, 8, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      const wall = 30;
      box(ctx, sx, sy - 8, 1.4, 1.2, wall, pal.wood, pal.woodDark, shade(pal.wood, 0.8));
      gableRoof(ctx, sx, sy - 8, 1.55, 1.35, wall, 13, pal);
      if (lod > 0.5) {
        // 柱廊
        ctx.fillStyle = 'rgb(214,206,188)';
        for (let i = -2; i <= 2; i++) {
          const px = sx + i * 13;
          const py = sy - 10 + Math.abs(i) * -1.8;
          ctx.fillRect(px - 2, py - wall, 4, wall);
        }
        windowLit(ctx, sx - 6, sy - 24, 5, 6, night);
        windowLit(ctx, sx + 7, sy - 22, 5, 6, night);
        // 旗
        ctx.strokeStyle = pal.cloth;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - wall - 16);
        ctx.lineTo(sx, sy - wall - 34);
        ctx.stroke();
        const wave = Math.sin(time * 0.004 + seed * 7) * 2.4;
        ctx.fillStyle = 'rgb(178,86,70)';
        ctx.beginPath();
        ctx.moveTo(sx, sy - wall - 34);
        ctx.lineTo(sx + 15 + wave, sy - wall - 30);
        ctx.lineTo(sx, sy - wall - 24);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case BuildingKind.Wall: {
      const fpw = footprint(BuildingKind.Wall);
      box(ctx, sx, sy, fpw.w, fpw.d, 18, pal.stone, pal.stoneDark, shade(pal.stone, 0.78));
      ctx.fillStyle = pal.stone;
      for (let i = -3; i <= 3; i++) {
        const ox = i * 10, oy = -Math.abs(i) * 3.8;
        ctx.fillRect(sx + ox - 3.4, sy + oy - 22, 6.8, 7);
      }
      ctx.strokeStyle = 'rgba(80,76,70,0.4)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 1; i < 5; i++) {
        const yy = sy - i * 3.6;
        ctx.moveTo(sx - 26, yy - 12); ctx.lineTo(sx, yy - 17);
        ctx.moveTo(sx + 26, yy - 12); ctx.lineTo(sx, yy - 17);
      }
      ctx.stroke();
      break;
    }
    case BuildingKind.Factory: {
      const wall = 36;
      box(ctx, sx, sy, 1.8, 1.55, wall, 'rgb(150,96,84)', 'rgb(118,74,64)', 'rgb(132,82,70)');
      // 锯齿屋顶
      ctx.fillStyle = 'rgb(96,100,112)';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * 26 - 11, sy - wall - 4);
        ctx.lineTo(sx + i * 26 + 11, sy - wall - 4);
        ctx.lineTo(sx + i * 26 + 11, sy - wall - 14);
        ctx.closePath();
        ctx.fill();
      }
      // 双烟囱
      box(ctx, sx - 28, sy - 8, 0.26, 0.26, 52, 'rgb(88,88,96)', 'rgb(70,70,78)', 'rgb(78,78,86)');
      box(ctx, sx + 26, sy - 12, 0.26, 0.26, 44, 'rgb(88,88,96)', 'rgb(70,70,78)', 'rgb(78,78,86)');
      // 烟囱红白环
      ctx.fillStyle = 'rgb(196,96,80)';
      ctx.fillRect(sx - 32, sy - 46, 8, 3);
      ctx.fillRect(sx + 22, sy - 40, 8, 3);
      if (!ghost) {
        smoke(ctx, sx - 28, sy - 8, sy - 66, time, seed, 1.5);
        smoke(ctx, sx + 26, sy - 12, sy - 60, time, seed + 0.4, 1.3);
      }
      if (lod > 0.6) {
        for (let i = 0; i < 4; i++) windowLit(ctx, sx - 12 + i * 7.5, sy - 14, 4.6, 5, night);
      }
      break;
    }
    case BuildingKind.Cooperative: {
      const wall = 30;
      box(ctx, sx, sy, 1.5, 1.3, wall, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      gableRoof(ctx, sx, sy, 1.65, 1.45, wall, 12, pal);
      if (lod > 0.55) {
        windowLit(ctx, sx - 9, sy - 18, 5.4, 5.4, night);
        windowLit(ctx, sx + 6, sy - 16, 5.4, 5.4, night);
        // 圆结社徽
        ctx.strokeStyle = 'rgb(47,126,118)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(sx, sy - wall - 18, 6.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx - 5.5, sy - wall - 18, 3, 0, Math.PI * 2);
        ctx.arc(sx + 5.5, sy - wall - 18, 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case BuildingKind.Services: {
      const wall = 34;
      box(ctx, sx, sy, 1.6, 1.4, wall, pal.stone, pal.stoneDark, shade(pal.stone, 0.82));
      gableRoof(ctx, sx, sy, 1.75, 1.55, wall, 11, pal);
      if (lod > 0.55) {
        for (let i = 0; i < 3; i++) windowLit(ctx, sx - 12 + i * 9, sy - 18, 5.4, 6, night);
        // 生命树标识
        ctx.fillStyle = 'rgb(47,126,118)';
        ctx.fillRect(sx - 1.2, sy - wall - 22, 2.4, 10);
        ctx.beginPath();
        ctx.ellipse(sx, sy - wall - 25, 6, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    // ============ 时代建筑 ============
    case BuildingKind.Temple: {
      // 神庙：三级台基 + 柱廊 + 金顶 + 香炉
      box(ctx, sx, sy, 1.5, 1.3, 6, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      box(ctx, sx, sy - 6, 1.32, 1.12, 4, shade(pal.stone, 0.94), pal.stoneDark, shade(pal.stone, 0.84));
      const wall = 20;
      box(ctx, sx, sy - 10, 1.16, 0.95, wall, pal.stone, pal.stoneDark, shade(pal.stone, 0.82));
      if (lod > 0.45) {
        ctx.fillStyle = 'rgb(232,226,210)';
        for (let i = -2; i <= 2; i++) {
          const px = sx + i * 12;
          const py = sy - 12 + Math.abs(i) * -1.7;
          ctx.fillRect(px - 2, py - wall, 4, wall);
          // 柱头
          ctx.fillRect(px - 2.8, py - wall - 2, 5.6, 2.4);
        }
        ctx.fillStyle = 'rgba(180,168,146,0.6)';
        for (let i = -2; i <= 2; i++) {
          const px = sx + i * 12;
          const py = sy - 12 + Math.abs(i) * -1.7;
          ctx.fillRect(px + 0.6, py - wall, 1.4, wall);
        }
      }
      // 金色梯形顶
      const topY = sy - 10 - wall;
      ctx.fillStyle = 'rgb(214,178,84)';
      ctx.beginPath();
      ctx.moveTo(sx, topY - 12);
      ctx.lineTo(sx + 32, topY);
      ctx.lineTo(sx + 25, topY + 3);
      ctx.lineTo(sx - 25, topY + 3);
      ctx.lineTo(sx - 32, topY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgb(178,142,58)';
      ctx.beginPath();
      ctx.moveTo(sx, topY - 12);
      ctx.lineTo(sx + 32, topY);
      ctx.lineTo(sx + 25, topY + 3);
      ctx.lineTo(sx, topY - 4);
      ctx.closePath();
      ctx.fill();
      // 顶饰
      ctx.fillStyle = 'rgb(240,216,140)';
      ctx.beginPath();
      ctx.arc(sx, topY - 14, 3, 0, Math.PI * 2);
      ctx.fill();
      // 香炉青烟 + 祭火
      if (!ghost && lod > 0.5) {
        smoke(ctx, sx + 10, sy + 3, topY - 18, time, seed, 0.4);
        const fl = 2.4 + Math.sin(time * 0.007 + seed * 9) * 1.2;
        ctx.fillStyle = 'rgb(224,128,60)';
        ctx.beginPath();
        ctx.ellipse(sx - 9, sy - 2, 2.6, fl, 0, 0, Math.PI * 2);
        ctx.fill();
        glow(sx - 9, sy - 2, 18, 'rgba(255,170,90,0.35)');
      }
      break;
    }
    case BuildingKind.Manor: {
      // 庄园：主楼 + 厢房 + 围栏 + 谷仓
      const wing = 14;
      box(ctx, sx - 20, sy + 3, 0.8, 0.7, wing, pal.wood, pal.woodDark, shade(pal.wood, 0.84));
      gableRoof(ctx, sx - 20, sy + 3, 0.9, 0.8, wing, 8, pal);
      const wall = 30;
      box(ctx, sx, sy, 1.25, 1.1, wall, pal.wood, pal.woodDark, shade(pal.wood, 0.82));
      gableRoof(ctx, sx, sy, 1.38, 1.2, wall, 12, pal);
      if (lod > 0.5) {
        windowLit(ctx, sx - 10, sy - 18, 5.4, 6.5, night);
        windowLit(ctx, sx + 6, sy - 18, 5.4, 6.5, night);
        windowLit(ctx, sx - 2, sy - 30, 5, 5, night);
        windowLit(ctx, sx - 19, sy - 10, 4.4, 5, night);
        ctx.fillStyle = pal.woodDark;
        ctx.fillRect(sx - 3.4, sy - 6, 6.8, 8);
        // 山墙木饰
        ctx.strokeStyle = shade(pal.woodDark, 0.8);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy - wall - 6); ctx.lineTo(sx, sy - wall - 12); ctx.lineTo(sx + 8, sy - wall - 6);
        ctx.stroke();
      }
      if (lod > 0.6) {
        // 木围栏
        ctx.strokeStyle = pal.woodDark;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const fx = sx + 20 + i * 6, fy = sy + 9 - i * 2.4;
          ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 5.5);
        }
        ctx.moveTo(sx + 20, sy + 7.5); ctx.lineTo(sx + 56, sy - 6);
        ctx.moveTo(sx + 20, sy + 3.5); ctx.lineTo(sx + 56, sy - 10);
        ctx.stroke();
      }
      break;
    }
    case BuildingKind.Castle: {
      // 城堡：主楼 + 双塔 + 城齿 + 旗
      const wall = 42;
      box(ctx, sx, sy, 1.25, 1.1, wall, pal.stone, pal.stoneDark, shade(pal.stone, 0.8));
      box(ctx, sx - 27, sy + 3, 0.5, 0.45, 56, pal.stone, pal.stoneDark, shade(pal.stone, 0.78));
      box(ctx, sx + 27, sy + 3, 0.5, 0.45, 56, pal.stone, pal.stoneDark, shade(pal.stone, 0.78));
      ctx.fillStyle = pal.stone;
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(sx + i * 11 - 3.8, sy - wall - 4 + Math.abs(i) * 2.6, 7.6, 7);
      }
      // 石缝
      ctx.strokeStyle = 'rgba(84,80,74,0.35)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (let i = 1; i < 9; i++) {
        const yy = sy - i * 4.6;
        ctx.moveTo(sx - 17, yy - 12); ctx.lineTo(sx, yy - 17.5);
        ctx.moveTo(sx + 17, yy - 12); ctx.lineTo(sx, yy - 17.5);
      }
      ctx.stroke();
      for (const tx of [sx - 27, sx + 27]) {
        for (let i = -1; i <= 1; i++) {
          ctx.fillStyle = pal.stone;
          ctx.fillRect(tx + i * 8 - 2.8, sy - 53 + Math.abs(i) * 2.4, 5.6, 6);
        }
        // 塔顶锥
        ctx.fillStyle = pal.roof;
        ctx.beginPath();
        ctx.moveTo(tx, sy - 76);
        ctx.lineTo(tx + 12, sy - 52);
        ctx.lineTo(tx - 12, sy - 52);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = pal.roofDark;
        ctx.beginPath();
        ctx.moveTo(tx, sy - 76);
        ctx.lineTo(tx + 12, sy - 52);
        ctx.lineTo(tx, sy - 55);
        ctx.closePath();
        ctx.fill();
        // 塔窗
        windowLit(ctx, tx - 2, sy - 34, 4, 6, night);
        windowLit(ctx, tx - 2, sy - 46, 4, 6, night);
      }
      // 主旗
      if (lod > 0.45) {
        ctx.strokeStyle = pal.cloth;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - wall - 4); ctx.lineTo(sx, sy - wall - 26);
        ctx.stroke();
        const wave = Math.sin(time * 0.004 + seed * 7) * 2.6;
        ctx.fillStyle = 'rgb(168,74,58)';
        ctx.beginPath();
        ctx.moveTo(sx, sy - wall - 26);
        ctx.lineTo(sx + 17 + wave, sy - wall - 21);
        ctx.lineTo(sx, sy - wall - 15);
        ctx.closePath();
        ctx.fill();
      }
      // 门与箭窗
      ctx.fillStyle = 'rgb(58,44,34)';
      ctx.beginPath();
      ctx.moveTo(sx - 4.6, sy + 2);
      ctx.lineTo(sx - 4.6, sy - 8);
      ctx.quadraticCurveTo(sx, sy - 13, sx + 4.6, sy - 8);
      ctx.lineTo(sx + 4.6, sy + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(sx - 28, sy - 14, 3.4, 5);
      ctx.fillRect(sx + 24.6, sy - 14, 3.4, 5);
      break;
    }
    case BuildingKind.Academy: {
      // 学堂：厅堂 + 钟楼
      const wall = 26;
      box(ctx, sx, sy, 1.15, 1.0, wall, 'rgb(184,142,96)', 'rgb(146,108,70)', 'rgb(162,124,84)');
      gableRoof(ctx, sx, sy, 1.28, 1.1, wall, 11, pal);
      const towerH = 42;
      box(ctx, sx + 21, sy - 2, 0.38, 0.34, towerH, pal.stone, pal.stoneDark, shade(pal.stone, 0.82));
      ctx.fillStyle = 'rgb(70,86,110)';
      ctx.beginPath();
      ctx.moveTo(sx + 21, sy - towerH - 14);
      ctx.lineTo(sx + 31, sy - towerH + 4);
      ctx.lineTo(sx + 11, sy - towerH + 4);
      ctx.closePath();
      ctx.fill();
      if (lod > 0.5) {
        windowLit(ctx, sx + 19, sy - towerH + 8, 4.4, 5.4, night);
        // 钟
        ctx.fillStyle = 'rgb(214,178,84)';
        ctx.beginPath();
        ctx.moveTo(sx + 18, sy - towerH + 16);
        ctx.quadraticCurveTo(sx + 21, sy - towerH + 21, sx + 24, sy - towerH + 16);
        ctx.closePath();
        ctx.fill();
        windowLit(ctx, sx - 11, sy - 17, 5.4, 6, night);
        windowLit(ctx, sx + 6, sy - 17, 5.4, 6, night);
        ctx.fillStyle = 'rgb(88,62,42)';
        ctx.fillRect(sx - 3.4, sy - 8, 6.8, 8);
        // 书卷匾额
        ctx.fillStyle = 'rgb(240,232,210)';
        ctx.fillRect(sx - 10, sy - 30, 20, 6.4);
        ctx.strokeStyle = 'rgb(120,100,70)';
        ctx.lineWidth = 0.9;
        ctx.strokeRect(sx - 10, sy - 30, 20, 6.4);
        ctx.beginPath();
        ctx.moveTo(sx - 6, sy - 27.8); ctx.lineTo(sx + 6, sy - 27.8);
        ctx.moveTo(sx - 6, sy - 25.6); ctx.lineTo(sx + 3, sy - 25.6);
        ctx.stroke();
      }
      break;
    }
    case BuildingKind.Bank: {
      // 银行：石砌殿堂 + 三角楣 + 四柱
      const wall = 30;
      box(ctx, sx, sy, 1.3, 1.1, wall, pal.stone, pal.stoneDark, shade(pal.stone, 0.84));
      ctx.fillStyle = 'rgb(226,220,206)';
      for (let i = 0; i < 4; i++) {
        const px = sx - 17 + i * 11.4;
        ctx.fillRect(px - 2.2, sy - wall + 3 + Math.abs(i - 1.5) * -1.4, 4.4, wall - 3);
        ctx.fillRect(px - 3, sy - wall + 1, 6, 2.4);
      }
      box(ctx, sx, sy - wall, 1.42, 1.22, 4, 'rgb(214,208,196)', 'rgb(178,172,160)', 'rgb(196,190,178)');
      ctx.fillStyle = 'rgb(226,220,206)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - wall - 16);
      ctx.lineTo(sx + 30, sy - wall - 2);
      ctx.lineTo(sx - 30, sy - wall - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(178,172,160,0.55)';
      ctx.beginPath();
      ctx.moveTo(sx, sy - wall - 16);
      ctx.lineTo(sx + 30, sy - wall - 2);
      ctx.lineTo(sx, sy - wall - 5);
      ctx.closePath();
      ctx.fill();
      if (lod > 0.5) {
        ctx.fillStyle = 'rgb(64,54,44)';
        ctx.fillRect(sx - 6.4, sy - 13, 12.8, 11);
        ctx.fillStyle = 'rgb(214,178,84)';
        ctx.beginPath();
        ctx.arc(sx, sy - wall - 9, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgb(150,118,50)';
        ctx.font = '600 5px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('¥', sx, sy - wall - 7.4);
      }
      break;
    }
    case BuildingKind.Theater: {
      // 剧场：环形看台 + 舞台 + 幕布
      ctx.fillStyle = 'rgb(190,168,132)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 32, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(162,140,108)';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 26, 13.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(122,102,78)';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 16.5, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgb(214,190,150)';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (lod > 0.45) {
        // 看台坐席弧线
        ctx.strokeStyle = 'rgba(96,80,60,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(sx, sy - 3, 21, 11, 0, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        // 幕布（红）与台柱
        ctx.fillStyle = 'rgb(168,74,58)';
        ctx.fillRect(sx - 5, sy - 10, 10, 6);
        ctx.strokeStyle = 'rgb(96,80,60)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 10, sy - 4); ctx.lineTo(sx - 10, sy - 18);
        ctx.moveTo(sx + 10, sy - 4); ctx.lineTo(sx + 10, sy - 18);
        ctx.stroke();
        // 顶篷
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i % 2 ? 'rgb(168,74,58)' : 'rgb(238,228,208)';
          ctx.fillRect(sx - 17 + i * 5.8, sy - 22, 5.8, 4.6);
        }
        ctx.fillStyle = 'rgb(96,80,60)';
        ctx.fillRect(sx - 18, sy - 26, 36, 2.4);
      }
      break;
    }
    case BuildingKind.Hospital: {
      // 医院：白楼 + 红十字 + 救护灯
      const wall = 30;
      box(ctx, sx, sy, 1.15, 1.0, wall, 'rgb(234,236,232)', 'rgb(198,204,200)', 'rgb(218,222,218)');
      gableRoof(ctx, sx, sy, 1.28, 1.12, wall, 8, { ...pal, roof: 'rgb(148,164,172)', roofDark: 'rgb(120,136,144)' });
      if (lod > 0.45) {
        for (let i = 0; i < 3; i++) {
          windowLit(ctx, sx - 12 + i * 9, sy - 20, 5, 5.4, night);
          windowLit(ctx, sx - 12 + i * 9, sy - 9, 5, 5.4, night);
        }
        // 门廊
        ctx.fillStyle = 'rgb(208,214,214)';
        ctx.fillRect(sx - 7, sy - 6, 14, 2.6);
        ctx.fillRect(sx - 7, sy - 12, 2.4, 7);
        ctx.fillRect(sx + 4.6, sy - 12, 2.4, 7);
        // 十字旗
        ctx.strokeStyle = 'rgb(160,160,156)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy - wall - 6); ctx.lineTo(sx, sy - wall - 26);
        ctx.stroke();
        ctx.fillStyle = 'rgb(224,224,220)';
        ctx.fillRect(sx + 0.5, sy - wall - 26, 15, 10);
        ctx.fillStyle = 'rgb(200,72,58)';
        ctx.fillRect(sx + 6, sy - wall - 25, 4, 8);
        ctx.fillRect(sx + 3, sy - wall - 23.4, 10, 4.4);
      }
      break;
    }
  }
}

const H2 = (h: number, f: number) => h * f;

/** 农田：垄沟 + 随周期生长的作物；饥荒年枯黄 */
function drawField(ctx: CanvasRenderingContext2D, sx: number, sy: number, growth: number, seed: number, wither: boolean) {
  const hw = TILE_W / 2 - 3, hh = TILE_H / 2 - 1.5;
  ctx.fillStyle = wither ? 'rgb(138,112,74)' : 'rgb(146,110,72)';
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh); ctx.lineTo(sx + hw, sy); ctx.lineTo(sx, sy + hh); ctx.lineTo(sx - hw, sy);
  ctx.closePath(); ctx.fill();
  // 田埂围边
  ctx.strokeStyle = wither ? 'rgba(110,88,58,0.5)' : 'rgba(110,86,54,0.45)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh + 2); ctx.lineTo(sx + hw - 3, sy); ctx.lineTo(sx, sy + hh - 2); ctx.lineTo(sx - hw + 3, sy);
  ctx.closePath(); ctx.stroke();
  // 垄
  ctx.strokeStyle = wither ? 'rgb(116,92,60)' : 'rgb(120,88,56)';
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
    const cropColor = wither
      ? `rgb(${168 - g * 30},${142 - g * 60},${74 - g * 20})`
      : g < 0.5 ? `rgb(${120 + g * 60},${150 + g * 50},${70})` : `rgb(${200 + g * 40},${168 - g * 40},${60})`;
    ctx.fillStyle = cropColor;
    for (let i = -2; i <= 2; i++) {
      for (let j = -1; j <= 1; j++) {
        const ox = i * hw / 3 + j * 4, oy = j * hh / 2.4 + i * 1.4;
        const hgt = (wither ? 1.5 : 2) + g * (wither ? 3 : 8);
        ctx.beginPath();
        ctx.ellipse(sx + ox, sy + oy - hgt * 0.4, 1.7, hgt * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function cropGrowth(w: WorldState, b: Building): number {
  const phase = (w.year % 3) + ((b.id % 7) / 7);
  return 0.15 + 0.85 * Math.abs(Math.sin(phase * Math.PI / 3));
}

function eraOf(w: WorldState, b: Building): number {
  const owner = w.settlements.find(s => s.buildings.some(x => x.id === b.id));
  const t = (owner ? w.civs[owner.civId] : w.civs[0]).tech.levels;
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

/** 建筑顶部标注高度（用于标签避让） */
export function buildingTopOffset(kind: BuildingKind): number {
  switch (kind) {
    case BuildingKind.Factory: return 74;
    case BuildingKind.Admin: return 64;
    case BuildingKind.Castle: return 96;
    case BuildingKind.Temple: return 66;
    case BuildingKind.Townhouse: return 62;
    case BuildingKind.Services: return 54;
    case BuildingKind.Academy: return 62;
    case BuildingKind.Hospital: return 56;
    case BuildingKind.Manor: return 52;
    case BuildingKind.Wall: return 28;
    default: return 38;
  }
}
