/**
 * 代表性居民 — 低成本视觉角色（v2.0 精细版）
 * 模拟人口是宏观数字，画面只显示代表性小人（数量独立于真实人口）。
 * v2.0：
 * - 移动基于网格坐标 + 可通行检测（不再从水上/山上穿行）
 * - 角色有头身、发型、服饰、四肢与职业配件，按职业（农/工/商/贵/童/祭）区分
 * - 行走摆臂、劳作弯身、携带行囊
 */
import { BuildingKind, Terrain, type WorldState, type Settlement } from '../types';
import { gridToScreen, vhash } from './iso';

export interface Villager {
  gx: number; gy: number;          // 网格坐标（浮点）
  tx: number; ty: number;          // 目标网格坐标
  speed: number;                   // 格/秒
  wait: number;
  role: number;                     // 0 农 1 工 2 商 3 贵 4 童 5 祭
  carrying: boolean;
  bobPhase: number;
  homeId: number;
  dir: number;                      // 朝向 1 右 -1 左
  stuck: number;
  workKind: number;                 // 0 行走 1 劳作
  variant: number;                  // 体型/配色变体
}

/** 视觉随机数（与模拟 RNG 分离） */
let vseed = 12345;
const vrnd = () => {
  vseed = (vseed * 1664525 + 1013904223) >>> 0;
  return vseed / 4294967296;
};

/** 职业服饰配色：[外衣, 外衣暗, 裤, 皮肤, 头发] */
const ROLE_STYLE: { cloth: string; clothDark: string; pants: string; skin: string; hair: string; hat: string }[] = [
  { cloth: 'rgb(196,150,104)', clothDark: 'rgb(150,110,76)', pants: 'rgb(104,84,60)', skin: 'rgb(238,206,170)', hair: 'rgb(60,44,32)', hat: 'rgb(228,204,130)' },   // 农：草帽
  { cloth: 'rgb(110,124,148)', clothDark: 'rgb(82,92,112)', pants: 'rgb(64,68,82)', skin: 'rgb(234,200,164)', hair: 'rgb(40,36,32)', hat: 'rgb(88,96,114)' },         // 工：便帽
  { cloth: 'rgb(168,96,88)', clothDark: 'rgb(128,70,64)', pants: 'rgb(92,72,60)', skin: 'rgb(240,208,172)', hair: 'rgb(52,38,28)', hat: 'rgb(84,60,48)' },            // 商：风帽
  { cloth: 'rgb(128,88,148)', clothDark: 'rgb(96,62,114)', pants: 'rgb(70,56,88)', skin: 'rgb(242,210,176)', hair: 'rgb(36,30,26)', hat: 'rgb(58,42,72)' },            // 贵：高冠
  { cloth: 'rgb(230,180,140)', clothDark: 'rgb(196,146,108)', pants: 'rgb(150,120,88)', skin: 'rgb(244,214,180)', hair: 'rgb(88,62,42)', hat: '' },                    // 童
  { cloth: 'rgb(222,214,196)', clothDark: 'rgb(178,168,146)', pants: 'rgb(158,148,128)', skin: 'rgb(236,202,166)', hair: 'rgb(56,46,38)', hat: 'rgb(196,186,166)' }, // 祭：兜帽
];

/** 依聚落人口确定代表性小人数量 */
export function villagerCount(s: Settlement): number {
  if (s.dead || s.population <= 0) return 0;
  return Math.max(4, Math.min(26, Math.round(s.population * 0.045)));
}

function walkable(w: WorldState, x: number, y: number): boolean {
  const size = w.config.size;
  if (x < 0.5 || y < 0.5 || x >= size - 0.5 || y >= size - 0.5) return false;
  const t = w.tiles[Math.floor(y) * size + Math.floor(x)];
  return t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain;
}

export function spawnVillagers(w: WorldState, s: Settlement): Villager[] {
  const out: Villager[] = [];
  const n = villagerCount(s);
  for (let i = 0; i < n; i++) {
    let gx = s.x, gy = s.y;
    for (let a = 0; a < 14; a++) {
      const ang = vrnd() * Math.PI * 2;
      const r = vrnd() * 3;
      const x = s.x + Math.cos(ang) * r, y = s.y + Math.sin(ang) * r;
      if (walkable(w, x, y)) { gx = x; gy = y; break; }
    }
    out.push({
      gx, gy, tx: gx, ty: gy,
      speed: 0.5 + vrnd() * 0.35,
      wait: vrnd() * 2,
      role: pickRole(s),
      carrying: vrnd() < 0.25,
      bobPhase: vrnd() * Math.PI * 2,
      homeId: s.id,
      dir: vrnd() > 0.5 ? 1 : -1,
      stuck: 0,
      workKind: 0,
      variant: (vrnd() * 4) | 0,
    });
  }
  return out;
}

function pickRole(s: Settlement): number {
  const r = vrnd();
  const hasTemple = s.buildings.some(b => b.kind === BuildingKind.Temple);
  const hasMarket = s.buildings.some(b => b.kind === BuildingKind.Market);
  if (r < 0.5) return 0; // 农
  if (r < 0.66) return 1; // 工
  if (r < 0.76) return hasMarket ? 2 : 0; // 商
  if (r < 0.84) return s.population > 250 ? 3 : 0; // 贵（有城镇规模才出现）
  if (r < 0.92) return hasTemple ? 5 : 0; // 祭
  return 4; // 童
}

/** 找一个 POI（农田/水井/市场/神庙/中心）作为目标 */
function pickTarget(w: WorldState, s: Settlement): { x: number; y: number } {
  const pois: { x: number; y: number }[] = [];
  for (const b of s.buildings) {
    if (b.progress < 1) continue;
    if (b.kind === BuildingKind.Farm || b.kind === BuildingKind.Well || b.kind === BuildingKind.Market
      || b.kind === BuildingKind.Admin || b.kind === BuildingKind.Temple || b.kind === BuildingKind.Granary) {
      pois.push({ x: b.x, y: b.y });
    }
  }
  pois.push({ x: s.x, y: s.y });
  for (let a = 0; a < 4; a++) {
    const p = pois[(vrnd() * pois.length) | 0];
    const jx = p.x + (vrnd() - 0.5) * 1.6;
    const jy = p.y + (vrnd() - 0.5) * 1.6;
    if (walkable(w, jx, jy)) return { x: jx, y: jy };
  }
  return { x: s.x, y: s.y };
}

/** 每帧推进（dt 秒）：网格空间移动 + 绕障 */
export function updateVillagers(v: Villager[], w: WorldState, s: Settlement, dt: number): void {
  for (const p of v) {
    if (p.wait > 0) {
      p.wait -= dt;
      p.bobPhase += dt * 5.5;
      if (p.wait <= 0) {
        const t = pickTarget(w, s);
        p.tx = t.x; p.ty = t.y;
        p.carrying = vrnd() < 0.3;
        p.workKind = vrnd() < 0.45 ? 1 : 0;
      }
      continue;
    }
    const dx = p.tx - p.gx, dy = p.ty - p.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.08) {
      p.wait = 0.6 + vrnd() * 3.2;
      p.carrying = false;
      p.workKind = 0;
      continue;
    }
    if (Math.abs(dx) > 0.05) p.dir = dx > 0 ? 1 : -1;
    const step = Math.min(dist, p.speed * dt);
    let nx = p.gx + (dx / dist) * step;
    let ny = p.gy + (dy / dist) * step;
    if (!walkable(w, nx, ny)) {
      // 绕障：尝试垂直方向绕行
      const side = (vhash(Math.floor(p.gx * 3), Math.floor(p.gy * 3), 9) > 0.5 ? 1 : -1);
      nx = p.gx + (-dy / dist) * step * side;
      ny = p.gy + (dx / dist) * step * side;
      if (!walkable(w, nx, ny)) {
        p.stuck += dt;
        nx = p.gx; ny = p.gy;
        if (p.stuck > 0.8) {
          const t = pickTarget(w, s);
          p.tx = t.x; p.ty = t.y;
          p.stuck = 0;
          p.wait = 0.4;
        }
        continue;
      }
    }
    p.gx = nx; p.gy = ny;
    p.stuck = 0;
    p.bobPhase += dt * 9;
  }
}

/**
 * 绘制小人（ctx 已含摄像机变换）
 * 三档 LOD：silhouette / standard / detailed
 */
export function drawVillagers(
  ctx: CanvasRenderingContext2D,
  v: Villager[],
  time: number,
  lod: number,
): void {
  if (lod < 0.42) return;
  for (const p of v) {
    const world = gridToScreen(p.gx, p.gy);
    const moving = p.wait <= 0;
    const working = !moving && p.workKind === 1;
    const bob = moving ? Math.abs(Math.sin(p.bobPhase)) * 2.4 : working ? Math.abs(Math.sin(p.bobPhase)) * 1.1 : Math.sin(p.bobPhase) * 0.6;
    const child = p.role === 4;
    const bodyH = child ? 7 : 10.5;
    const st = ROLE_STYLE[p.role];
    const x = world.x, y = world.y;

    // 阴影
    ctx.fillStyle = 'rgba(40,52,44,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y, 4.4, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();

    const f = p.dir; // 朝向翻转系数

    if (lod < 0.75) {
      // 低 LOD：剪影
      ctx.fillStyle = st.clothDark;
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.quadraticCurveTo(x - 3.4, y - bodyH * 0.6 - bob, x - 1.4, y - bodyH - bob);
      ctx.lineTo(x + 1.4, y - bodyH - bob);
      ctx.quadraticCurveTo(x + 3.4, y - bodyH * 0.6 - bob, x + 3, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = st.skin;
      ctx.beginPath();
      ctx.arc(x, y - bodyH - 2.2 - bob, 2.4, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // —— 腿（行走摆动）——
    ctx.strokeStyle = st.pants;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    const sw = moving ? Math.sin(p.bobPhase) * 2.6 : working ? Math.sin(p.bobPhase * 0.8) * 0.7 : 0;
    ctx.beginPath();
    ctx.moveTo(x - 1.2, y - 2.6);
    ctx.lineTo(x - 1.2 - sw * 0.55 * f, y + 0.5);
    ctx.moveTo(x + 1.2, y - 2.6);
    ctx.lineTo(x + 1.2 + sw * 0.55 * f, y + 0.5);
    ctx.stroke();

    // —— 外衣（躯干，胶囊带摆）——
    const lean = working ? 1.6 : 0;
    ctx.fillStyle = st.cloth;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 2);
    ctx.quadraticCurveTo(x - 3.5, y - bodyH * 0.6 - bob, x - 1.5 + lean * f * 0.3, y - bodyH - bob);
    ctx.lineTo(x + 1.5 + lean * f * 0.3, y - bodyH - bob);
    ctx.quadraticCurveTo(x + 3.5, y - bodyH * 0.6 - bob, x + 3, y - 2);
    ctx.closePath();
    ctx.fill();
    // 衣摆暗部（立体感）
    ctx.fillStyle = st.clothDark;
    ctx.beginPath();
    ctx.moveTo(x + 1.2 + lean * f * 0.3, y - bodyH - bob + 0.6);
    ctx.quadraticCurveTo(x + 3.5, y - bodyH * 0.55 - bob, x + 3, y - 2);
    ctx.lineTo(x + 0.6, y - 2);
    ctx.quadraticCurveTo(x + 1.2, y - bodyH * 0.55 - bob, x + 1.2 + lean * f * 0.3, y - bodyH - bob + 0.6);
    ctx.closePath();
    ctx.fill();
    // 腰带
    ctx.fillStyle = st.clothDark;
    ctx.fillRect(x - 2.9, y - bodyH * 0.52 - bob, 5.8, 1.1);

    // —— 手臂（摆臂，与腿反相）——
    if (lod > 0.85) {
      ctx.strokeStyle = st.cloth;
      ctx.lineWidth = 1.5;
      const armSw = moving ? Math.sin(p.bobPhase + Math.PI) * 2.2 : working ? Math.sin(p.bobPhase * 0.8) * 1.6 + 1.4 : Math.sin(p.bobPhase * 0.5) * 0.5;
      const shoulderY = y - bodyH * 0.82 - bob;
      ctx.beginPath();
      ctx.moveTo(x - 2.2 + lean * f * 0.4, shoulderY);
      ctx.lineTo(x - 2.2 - armSw * 0.5 * f + lean * f * 0.6, shoulderY + 4.2);
      ctx.moveTo(x + 2.2 + lean * f * 0.4, shoulderY);
      ctx.lineTo(x + 2.2 + armSw * 0.5 * f + lean * f * 0.6, shoulderY + 4.2);
      ctx.stroke();
      // 手
      ctx.fillStyle = st.skin;
      ctx.beginPath();
      ctx.arc(x - 2.2 - armSw * 0.5 * f + lean * f * 0.6, shoulderY + 4.6, 1, 0, Math.PI * 2);
      ctx.arc(x + 2.2 + armSw * 0.5 * f + lean * f * 0.6, shoulderY + 4.6, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // —— 头 ——
    const headY = y - bodyH - 2.8 - bob + lean * f * 0.2;
    ctx.fillStyle = st.skin;
    ctx.beginPath();
    ctx.arc(x + lean * f * 0.3, headY, 2.6, 0, Math.PI * 2);
    ctx.fill();
    // 头发（后脑）
    ctx.fillStyle = st.hair;
    ctx.beginPath();
    ctx.arc(x + lean * f * 0.3 - f * 0.5, headY - 0.4, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛（近景）
    if (lod > 1.3) {
      ctx.fillStyle = 'rgb(40,32,28)';
      ctx.fillRect(x + f * 0.9 + lean * f * 0.3, headY - 0.4, 0.8, 0.9);
    }
    // 帽子
    ctx.fillStyle = st.hat;
    if (p.role === 0 && st.hat) {
      // 草帽：宽檐
      ctx.beginPath();
      ctx.ellipse(x, headY - 1.6, 4.6, 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, headY - 2.2, 2.2, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.role === 3 && st.hat) {
      // 高冠
      ctx.fillRect(x - 1.6, headY - 4.6, 3.2, 3.2);
      ctx.fillRect(x - 2.2, headY - 1.6, 4.4, 0.9);
    } else if ((p.role === 2 || p.role === 5) && st.hat) {
      // 风帽/兜帽
      ctx.beginPath();
      ctx.arc(x - f * 0.4, headY - 0.6, 2.9, Math.PI * 0.75, Math.PI * 2.35);
      ctx.closePath();
      ctx.fill();
    } else if (p.role === 1 && st.hat) {
      // 便帽
      ctx.beginPath();
      ctx.arc(x, headY - 1, 2.5, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    // —— 职业配件 ——
    if (lod > 0.85) {
      if (working && p.role === 0) {
        // 锄头
        ctx.strokeStyle = 'rgb(120,90,58)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + f * 3.4, y - 2);
        ctx.lineTo(x + f * 4.6, y - 9 - bob);
        ctx.stroke();
        ctx.fillStyle = 'rgb(150,150,155)';
        ctx.fillRect(x + f * 4.2 - 1.4, y - 10.4 - bob, f * 2.8, 1.6);
      } else if (p.role === 1 && vhash(Math.floor(x), Math.floor(y), 3) > 0.5) {
        // 锤子别在腰间
        ctx.strokeStyle = 'rgb(120,90,58)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x + f * 2.6, y - 5 - bob);
        ctx.lineTo(x + f * 3.4, y - 1.6 - bob);
        ctx.stroke();
        ctx.fillStyle = 'rgb(150,150,155)';
        ctx.fillRect(x + f * 2.9 - 1, y - 1.8 - bob, 2, 1.4);
      } else if (p.role === 2) {
        // 背囊
        ctx.fillStyle = 'rgb(160,124,76)';
        ctx.beginPath();
        ctx.ellipse(x - f * 3.2, y - bodyH * 0.6 - bob, 2, 2.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // —— 携带物（头顶包袱）——
    if (p.carrying) {
      ctx.fillStyle = 'rgb(206,172,104)';
      ctx.beginPath();
      ctx.ellipse(x + f * 1.2, y - bodyH - 6.4 - bob, 2.4, 1.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgb(120,92,58)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + f * 1.2, y - bodyH - 8 - bob);
      ctx.lineTo(x + f * 1.2, y - bodyH - 6.2 - bob);
      ctx.stroke();
    }
  }
}
