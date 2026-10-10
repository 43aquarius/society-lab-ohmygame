/**
 * 代表性居民 — 低成本视觉角色
 * 模拟人口是宏观数字，画面只显示代表性小人（数量独立于真实人口）。
 * 小人在聚落 POI 之间行走、劳作、聚集；使用视觉随机数，不影响模拟。
 */
import { BuildingKind, type WorldState, type Settlement } from '../types';
import { gridToScreen, vhash, TILE_W, TILE_H, ELEV_H } from './iso';

export interface Villager {
  sx: number; sy: number;          // 世界像素
  tx: number; ty: number;          // 目标世界像素
  speed: number;
  wait: number;
  role: number;                     // 0 农 1 工 2 商 3 贵 4 童
  carrying: boolean;
  bobPhase: number;
  homeId: number;
}

const ROLE_COLORS = ['rgb(196,150,104)', 'rgb(110,124,148)', 'rgb(168,96,88)', 'rgb(128,88,148)', 'rgb(230,180,140)'];
const ROLE_COLORS_DARK = ['rgb(150,110,76)', 'rgb(82,92,112)', 'rgb(128,70,64)', 'rgb(96,62,114)', 'rgb(196,146,108)'];

/** 视觉随机数（与模拟 RNG 分离） */
let vseed = 12345;
const vrnd = () => {
  vseed = (vseed * 1664525 + 1013904223) >>> 0;
  return vseed / 4294967296;
};

/** 依聚落人口确定代表性小人数量 */
export function villagerCount(s: Settlement): number {
  if (s.dead || s.population <= 0) return 0;
  return Math.max(4, Math.min(42, Math.round(s.population * 0.055)));
}

export function spawnVillagers(s: Settlement): Villager[] {
  const out: Villager[] = [];
  const n = villagerCount(s);
  for (let i = 0; i < n; i++) {
    const ang = vrnd() * Math.PI * 2;
    const r = vrnd() * 3;
    const gx = s.x + Math.cos(ang) * r;
    const gy = s.y + Math.sin(ang) * r;
    const p = gridToScreen(gx, gy);
    out.push({
      sx: p.x, sy: p.y,
      tx: p.x, ty: p.y,
      speed: 26 + vrnd() * 20,
      wait: vrnd() * 2,
      role: pickRole(s),
      carrying: false,
      bobPhase: vrnd() * Math.PI * 2,
      homeId: s.id,
    });
  }
  return out;
}

function pickRole(s: Settlement): number {
  const r = vrnd();
  if (r < 0.56) return 0; // 农
  if (r < 0.72) return 1; // 工
  if (r < 0.84) return s.buildings.some(b => b.kind === BuildingKind.Market) ? 2 : 0;
  if (r < 0.92) return 3; // 贵
  return 4; // 童
}

/** 找一个 POI（农田/水井/市场/中心）作为目标 */
function pickTarget(s: Settlement): { x: number; y: number } {
  const pois: { x: number; y: number }[] = [];
  for (const b of s.buildings) {
    if (b.progress < 1) continue;
    if (b.kind === BuildingKind.Farm) pois.push({ x: b.x, y: b.y });
    else if (b.kind === BuildingKind.Well) pois.push({ x: b.x, y: b.y });
    else if (b.kind === BuildingKind.Market) pois.push({ x: b.x, y: b.y });
    else if (b.kind === BuildingKind.Admin) pois.push({ x: b.x, y: b.y });
  }
  pois.push({ x: s.x, y: s.y });
  if (pois.length === 1) {
    const ang = vrnd() * Math.PI * 2;
    const r = 1 + vrnd() * 3;
    return { x: s.x + Math.cos(ang) * r, y: s.y + Math.sin(ang) * r };
  }
  return pois[Math.floor(vrnd() * pois.length)];
}

/** 每帧推进（dt 秒） */
export function updateVillagers(v: Villager[], s: Settlement, dt: number): void {
  for (const p of v) {
    if (p.wait > 0) {
      p.wait -= dt;
      p.bobPhase += dt * 6; // 劳作节奏
      if (p.wait <= 0) {
        const t = pickTarget(s);
        const gp = gridToScreen(t.x, t.y);
        p.tx = gp.x + (vrnd() - 0.5) * 26;
        p.ty = gp.y + (vrnd() - 0.5) * 13;
        p.carrying = vrnd() < 0.3;
      }
      continue;
    }
    const dx = p.tx - p.sx, dy = p.ty - p.sy;
    const dist = Math.hypot(dx, dy);
    if (dist < 3) {
      p.wait = 0.6 + vrnd() * 2.8;
      p.carrying = false;
      continue;
    }
    const step = Math.min(dist, p.speed * dt);
    p.sx += (dx / dist) * step;
    p.sy += (dy / dist) * step;
    p.bobPhase += dt * 11;
  }
}

/**
 * 绘制小人（ctx 已含摄像机变换）
 * walkBob：行走中的上下摆动；work 时前倾小幅摆动。
 */
export function drawVillagers(
  ctx: CanvasRenderingContext2D,
  v: Villager[],
  time: number,
  lod: number,
): void {
  if (lod < 0.45) return;
  for (const p of v) {
    const moving = p.wait <= 0;
    const bob = moving ? Math.abs(Math.sin(p.bobPhase)) * 2.2 : Math.sin(p.bobPhase) * 0.6;
    const lean = moving ? 0 : Math.sin(p.bobPhase * 0.7) * 1;
    const bodyH = p.role === 4 ? 7 : 10;
    const x = p.sx, y = p.sy;
    // 阴影
    ctx.fillStyle = 'rgba(40,52,44,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y, 4.2, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // 身体（胶囊）
    const col = ROLE_COLORS[p.role];
    const dark = ROLE_COLORS_DARK[p.role];
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - 2.8, y);
    ctx.quadraticCurveTo(x - 3 - 0.5, y - bodyH * 0.55 - bob, x - 1 + lean * 0.4, y - bodyH - bob);
    ctx.lineTo(x + 1 + lean * 0.4, y - bodyH - bob);
    ctx.quadraticCurveTo(x + 3.3, y - bodyH * 0.55 - bob, x + 2.8, y);
    ctx.closePath();
    ctx.fill();
    // 头
    ctx.fillStyle = 'rgb(238,206,170)';
    ctx.beginPath();
    ctx.arc(x + lean * 0.5, y - bodyH - 2.6 - bob, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // 携带物
    if (p.carrying) {
      ctx.fillStyle = 'rgb(212,178,110)';
      ctx.beginPath();
      ctx.arc(x + lean * 0.5, y - bodyH - 7 - bob, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 腿部行走感（两条短线交替）
    if (moving && lod > 0.8) {
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.6;
      const sw = Math.sin(p.bobPhase) * 2.4;
      ctx.beginPath();
      ctx.moveTo(x - 1, y - 1); ctx.lineTo(x - 1 - sw * 0.6, y + 1);
      ctx.moveTo(x + 1, y - 1); ctx.lineTo(x + 1 + sw * 0.6, y + 1);
      ctx.stroke();
    }
  }
}
