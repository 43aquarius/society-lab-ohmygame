/**
 * 事件视觉特效系统（v3.0 彻底重做）
 * 战争：军队从出发地开拔 → 两军对垒厮杀（刃光/尘土/火箭）→ 焚屋 → 撤走留尸；
 * 疫病：瘴气 + 盘旋的乌鸦 + 病倒的居民（agents 系统配合）；
 * 山洪：浊水漫堤、波涛、溺水者挣扎、漂流残骸；
 * 起义/镇压：街垒冲突、火光冲天；
 * 陨星：坠落 → 冲击环 → 持久陨坑 decal；
 * 野火：火舌蔓延 + 焦痕 decal。
 */
import type { WorldState, EventRecord, GodPowerId } from '../types';
import { gridToScreen, vhash, TILE_W, TILE_H } from './iso';
import { addDecal } from '../decals';

export type FxType =
  | 'flood' | 'plague' | 'battle' | 'harvest' | 'meteor'
  | 'storm' | 'wildfire' | 'caravan' | 'heal' | 'blessing-glow' | 'smoke'
  | 'army' | 'riot' | 'crows';

interface Fx {
  type: FxType;
  gx: number; gy: number;
  ttl: number;        // 剩余秒
  maxTtl: number;
  seed: number;
  /** 商队/军队需要第二点 */
  to?: { gx: number; gy: number };
  /** 附加参数（如暴烈程度） */
  power?: number;
}

/** 视觉随机（独立于模拟） */
let fseed = 987654;
const frnd = () => {
  fseed = (fseed * 1664525 + 1013904223) >>> 0;
  return fseed / 4294967296;
};

export class EffectSystem {
  list: Fx[] = [];
  /** 屏幕闪光（闪电/陨石冲击） */
  flash: { color: string; alpha: number } | null = null;

  spawn(type: FxType, gx: number, gy: number, ttl: number, to?: { gx: number; gy: number }, power = 1) {
    const exist = this.list.find(f => f.type === type && Math.abs(f.gx - gx) < 2 && Math.abs(f.gy - gy) < 2 && !to);
    if (exist) { exist.ttl = ttl; exist.maxTtl = ttl; return; }
    if (this.list.length > 60) this.list.shift();
    this.list.push({ type, gx, gy, ttl, maxTtl: ttl, seed: frnd(), to, power });
  }

  /** 战争：从 a 行军至 b 开战（真实交战双方） */
  spawnArmy(a: { x: number; y: number }, b: { x: number; y: number }) {
    this.spawn('army', a.x, a.y, 20, { gx: b.x, gy: b.y });
    this.spawn('battle', b.x, b.y, 20);
  }

  /** 由年度事件生成特效 */
  spawnForEvent(w: WorldState, ev: EventRecord) {
    const s = ev.settlementId !== undefined ? w.settlements.find(x => x.id === ev.settlementId) : null;
    const at = s ?? w.settlements.find(x => !x.dead);
    // v3.0：带交战双方的战争 → 行军 + 会战
    if (ev.aux?.attackerId !== undefined && ev.aux?.defenderId !== undefined) {
      const a = w.settlements.find(x => x.id === ev.aux!.attackerId);
      const b = w.settlements.find(x => x.id === ev.aux!.defenderId);
      if (a && b && !a.dead && !b.dead) {
        this.spawnArmy(a, b);
        return;
      }
    }
    switch (ev.category) {
      case 'disaster':
        if (ev.title.includes('陨星') || ev.title.includes('陨')) {
          if (at) {
            const mx = ev.aux?.x ?? at.x + (frnd() - 0.5) * 6;
            const my = ev.aux?.y ?? at.y + (frnd() - 0.5) * 6;
            this.spawn('meteor', mx, my, 12);
            addDecal(w, 'crater', Math.round(mx), Math.round(my));
          }
        } else if (ev.title.includes('风暴')) {
          if (at) this.spawn('storm', at.x, at.y, 14);
        } else if (ev.title.includes('野火') || ev.title.includes('火')) {
          if (at) {
            const fx = at.x + (frnd() - 0.5) * 8, fy = at.y + (frnd() - 0.5) * 8;
            this.spawn('wildfire', fx, fy, 13);
            addDecal(w, 'scorch', Math.round(fx), Math.round(fy));
          }
        } else if (ev.title.includes('洪') || ev.title.includes('涝')) {
          if (s) this.spawn('flood', s.x, s.y, 16);
        } else if (ev.title.includes('疫') || ev.title.includes('瘟')) {
          if (s) { this.spawn('plague', s.x, s.y, 18); this.spawn('crows', s.x, s.y, 18); }
        } else if (s) {
          this.spawn('flood', s.x, s.y, 12);
        }
        break;
      case 'famine':
        if (s) this.spawn('smoke', s.x, s.y, 10);
        break;
      case 'plague':
        if (s) { this.spawn('plague', s.x, s.y, 18); this.spawn('crows', s.x, s.y, 18); }
        break;
      case 'war':
        if (s) { this.spawn('battle', s.x, s.y, 14); this.spawn('riot', s.x, s.y, 12, undefined, 1); }
        break;
      case 'politics':
        // 冲突/集体行动：抗议 → 和平聚集；镇压/起义/革命 → 街垒激战
        if (s) {
          const violent = /镇压|起义|革命|暴动|驱散/.test(ev.title + ev.text);
          this.spawn('riot', s.x, s.y, 12, undefined, violent ? 1 : 0.3);
          if (violent) this.spawn('battle', s.x, s.y, 10);
        }
        break;
      case 'harvest':
        if (s) this.spawn('harvest', s.x, s.y, 7);
        break;
      case 'trade': {
        const alive = w.settlements.filter(x => !x.dead);
        if (alive.length >= 2) {
          const a = alive[0], b = alive[alive.length - 1];
          this.spawn('caravan', a.x, a.y, 14, { gx: b.x, gy: b.y });
        }
        break;
      }
      case 'migration':
        // 移民潮：一小队人马走向最大聚落
        if (at) {
          const src = w.settlements.find(x => !x.dead && x.id !== at.id);
          this.spawn('caravan', src?.x ?? at.x - 8, src?.y ?? at.y - 8, 16, { gx: at.x, gy: at.y });
        }
        break;
      case 'ideas':
        if (at) this.spawn('blessing-glow', at.x, at.y, 6);
        break;
      case 'institution':
        if (s) this.spawn('blessing-glow', s.x, s.y, 8);
        else if (at) this.spawn('blessing-glow', at.x, at.y, 8);
        break;
      default:
        if ((ev.category === 'achievement' || ev.category === 'urban') && s) {
          this.spawn('harvest', s.x, s.y, 5);
        }
    }
  }

  /** 神力施放的即时特效 */
  spawnForPower(id: GodPowerId, gx: number, gy: number, w: WorldState) {
    switch (id) {
      case 'meteor':
        this.spawn('meteor', gx, gy, 12);
        addDecal(w, 'crater', gx, gy);
        this.flash = { color: 'rgb(255,196,120)', alpha: 0.5 };
        break;
      case 'storm': this.spawn('storm', gx, gy, 15); break;
      case 'wildfire':
        this.spawn('wildfire', gx, gy, 13);
        addDecal(w, 'scorch', gx, gy);
        break;
      case 'pestilence':
        this.spawn('plague', gx, gy, 18);
        this.spawn('crows', gx, gy, 18);
        break;
      case 'heal': this.spawn('heal', gx, gy, 6); for (const s of w.settlements) if (!s.dead) this.spawn('heal', s.x, s.y, 6); break;
      case 'blessing': this.spawn('blessing-glow', gx, gy, 8); break;
      case 'found': this.spawn('harvest', gx, gy, 6); break;
      case 'uplift': this.flash = { color: 'rgb(180,150,110)', alpha: 0.25 }; break;
      default: break;
    }
  }

  update(dt: number) {
    for (const f of this.list) f.ttl -= dt;
    this.list = this.list.filter(f => f.ttl > 0);
    if (this.flash && this.flash.alpha > 0.01) {
      this.flash.alpha *= Math.pow(0.02, dt);
    } else this.flash = null;
  }

  /**
   * 绘制所有特效（ctx 已应用摄像机变换）
   */
  draw(ctx: CanvasRenderingContext2D, w: WorldState, time: number) {
    // 持久状态：疫病中的聚落持续冒瘴气 + 乌鸦
    for (const ae of w.activeEvents) {
      if (ae.id !== 'plague-outbreak') continue;
      const s = w.settlements.find(x => x.id === ae.data.settlementId);
      if (s && !s.dead) {
        drawPlagueMiasma(ctx, s.x, s.y, time);
        drawCrows(ctx, s.x, s.y, time, 0.6);
      }
    }
    for (const f of this.list) {
      const t = f.ttl / f.maxTtl; // 1 → 0
      switch (f.type) {
        case 'flood': {
          const p = gridToScreen(f.gx, f.gy);
          drawFlood(ctx, p.x, p.y, 1 - t, time, f.seed);
          break;
        }
        case 'plague': drawPlagueMiasma(ctx, f.gx, f.gy, time); break;
        case 'crows': {
          const p = gridToScreen(f.gx, f.gy);
          drawCrows(ctx, f.gx, f.gy, time, 1);
          void p;
          break;
        }
        case 'battle': {
          const p = gridToScreen(f.gx, f.gy);
          drawBattle(ctx, p.x, p.y, time, f.seed, t);
          break;
        }
        case 'riot': {
          const p = gridToScreen(f.gx, f.gy);
          drawRiot(ctx, p.x, p.y, time, f.seed, t, f.power ?? 1);
          break;
        }
        case 'army': drawArmy(ctx, f, time); break;
        case 'harvest': {
          const p = gridToScreen(f.gx, f.gy);
          drawHarvestSparkle(ctx, p.x, p.y, time, f.seed);
          break;
        }
        case 'meteor': {
          const p = gridToScreen(f.gx, f.gy);
          drawMeteor(ctx, p.x, p.y, 1 - t, time, f.seed);
          break;
        }
        case 'storm': drawStormZone(ctx, f.gx, f.gy, time, f.seed); break;
        case 'wildfire': drawWildfire(ctx, f.gx, f.gy, time, f.seed); break;
        case 'caravan': drawCaravan(ctx, f, time); break;
        case 'heal': {
          const p = gridToScreen(f.gx, f.gy);
          drawHealLight(ctx, p.x, p.y, time, f.seed);
          break;
        }
        case 'blessing-glow': {
          const p = gridToScreen(f.gx, f.gy);
          drawBlessingGlow(ctx, p.x, p.y, time, f.seed);
          break;
        }
        case 'smoke': {
          const p = gridToScreen(f.gx, f.gy);
          drawDistressSmoke(ctx, p.x, p.y, time, f.seed);
          break;
        }
      }
    }
  }
}

// ============ 各特效绘制 ============

/** 山洪：漫延浊水 + 波涛 + 溺水者挣扎 + 漂流残骸（v3.0.1 更大更浊） */
function drawFlood(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number, time: number, seed: number) {
  const extent = Math.min(1, t * 1.8);
  const fade = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28;
  const rx = 130 * extent, ry = 66 * extent;
  ctx.save();
  ctx.globalAlpha = 0.88 * fade;
  // 浑浊泥水（黄褐）
  ctx.fillStyle = 'rgb(122,104,74)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgb(96,82,58)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  // 高水位亮斑（泥浆反光）
  ctx.fillStyle = 'rgba(196,172,120,0.5)';
  ctx.beginPath();
  ctx.ellipse(sx - rx * 0.2, sy - ry * 0.2, rx * 0.24, ry * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9 * fade;
  // 波涛
  ctx.lineWidth = 2.6;
  for (let i = 0; i < 5; i++) {
    const ph = (time * 0.0012 + i * 0.2) % 1;
    ctx.strokeStyle = `rgba(210,192,150,${((1 - ph) * 0.6 * fade).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * (0.28 + ph * 0.7), ry * (0.28 + ph * 0.7), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 溺水者：挥动的手臂
  if (extent > 0.4 && fade > 0.5) {
    for (let i = 0; i < 4; i++) {
      const ang = seed * 7 + i * 2.2;
      const dx = Math.cos(ang) * rx * 0.5;
      const dy = Math.sin(ang) * ry * 0.5;
      const flail = Math.sin(time * 0.02 + i * 3) * 3;
      ctx.strokeStyle = `rgba(90,74,62,${0.8 * fade})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx + dx, sy + dy - 2);
      ctx.lineTo(sx + dx + flail, sy + dy - 8);
      ctx.stroke();
      ctx.fillStyle = `rgba(238,206,170,${0.9 * fade})`;
      ctx.beginPath();
      ctx.arc(sx + dx, sy + dy - 1.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 漂流的原木与残骸
  for (let i = 0; i < 9; i++) {
    const ang = seed * 7 + i * 1.26;
    const drift = ((time * 0.0004) + i * 0.16) % 1;
    const dx = Math.cos(ang) * rx * (0.15 + drift * 0.75);
    const dy = Math.sin(ang) * ry * (0.15 + drift * 0.75);
    ctx.fillStyle = i % 3 ? 'rgb(104,84,56)' : i % 3 === 1 ? 'rgb(140,124,88)' : 'rgb(160,164,120)';
    ctx.save();
    ctx.translate(sx + dx, sy + dy);
    ctx.rotate(ang + time * 0.001);
    ctx.fillRect(-5, -1.8, 10, 3.6);
    ctx.restore();
  }
  ctx.restore();
}

/** 疫病瘴气：黄绿色毒雾（与草地拉开色相）+ 地面病渍 */
function drawPlagueMiasma(ctx: CanvasRenderingContext2D, gx: number, gy: number, time: number) {
  const p = gridToScreen(gx, gy);
  for (let i = 0; i < 12; i++) {
    const phase = ((time * 0.0006) + i / 12 + vhash(gx, gy, i) * 0.3) % 1;
    const ang = vhash(gx, gy, 30 + i) * Math.PI * 2;
    const r = 10 + phase * 38;
    const x = p.x + Math.cos(ang) * r;
    const y = p.y - 8 - phase * 40;
    const a = (1 - phase) * 0.6;
    // 病态的黄绿色（亮）
    ctx.fillStyle = `rgba(178,204,74,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 11 + phase * 13, 7 + phase * 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // 暗橄榄核心
    ctx.fillStyle = `rgba(94,110,44,${(a * 0.6).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, (11 + phase * 13) * 0.6, (7 + phase * 7) * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 地面病渍（黄褐橄榄）
  const g2 = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 56);
  g2.addColorStop(0, 'rgba(158,166,64,0.45)');
  g2.addColorStop(1, 'rgba(158,166,64,0)');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 56, 28, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 乌鸦：疫区上空盘旋（翼展开合，v3.0.1 加强） */
function drawCrows(ctx: CanvasRenderingContext2D, gx: number, gy: number, time: number, alpha: number) {
  const p = gridToScreen(gx, gy);
  for (let i = 0; i < 7; i++) {
    const cyc = time * 0.0009 + i * 1.9 + vhash(gx, gy, i) * 6;
    const ang = cyc * 0.7 + i * 1.256;
    const r = 28 + i * 6;
    const x = p.x + Math.cos(ang) * r;
    const y = p.y - 52 - Math.sin(cyc * 1.3) * 9;
    const flap = Math.sin(time * 0.02 + i * 2);
    ctx.strokeStyle = `rgba(28,26,24,${(0.9 * alpha).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - flap * 3);
    ctx.quadraticCurveTo(x, y + 2, x + 6, y - flap * 3);
    ctx.stroke();
  }
}

/** 会战：两军冲杀（刃光/尘土/火箭/倒地者） */
function drawBattle(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number, t: number) {
  const intensity = t > 0.85 ? (1 - t) / 0.15 : 1;
  // 尘土
  for (let i = 0; i < 4; i++) {
    const phase = ((time * 0.0006) + i * 0.25 + seed) % 1;
    ctx.fillStyle = `rgba(150,132,104,${((1 - phase) * 0.32 * intensity).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx + Math.sin(phase * 5 + i * 2 + seed * 9) * 22, sy - 6 - phase * 22, 6 + phase * 15, 0, Math.PI * 2);
    ctx.fill();
  }
  // 交战双方（红 vs 铁灰），犬牙交错
  const n = 6;
  for (let i = 0; i < n; i++) {
    const side = i % 2;
    const jitter = Math.sin(time * 0.006 + i * 2.7 + seed * 9) * 6;
    const bx = sx + (side ? 14 : -14) + Math.cos(i * 2.2) * 12 + jitter;
    const by = sy - 2 + Math.sin(i * 1.9 + seed * 7) * 7 + jitter * 0.4;
    // 身影
    ctx.fillStyle = side ? 'rgb(120,84,64)' : 'rgb(88,94,104)';
    ctx.beginPath();
    ctx.moveTo(bx - 2.2, by);
    ctx.lineTo(bx - 2.6, by - 8);
    ctx.lineTo(bx + 2.6, by - 8);
    ctx.lineTo(bx + 2.2, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(224,196,162)';
    ctx.beginPath();
    ctx.arc(bx, by - 9.6, 1.8, 0, Math.PI * 2);
    ctx.fill();
    // 矛与盾
    ctx.strokeStyle = side ? 'rgb(96,70,44)' : 'rgb(70,72,80)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(bx + (side ? 2.4 : -2.4), by - 2);
    ctx.lineTo(bx + (side ? 3.6 : -3.6), by - 15);
    ctx.stroke();
    if (!side) {
      ctx.fillStyle = 'rgb(120,112,96)';
      ctx.beginPath();
      ctx.ellipse(bx - 3.4, by - 6, 2.2, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 刃光（高频闪过）
  const spark = Math.sin(time * 0.03 + seed * 20);
  if (spark > 0.72) {
    const a = (spark - 0.72) / 0.28;
    ctx.strokeStyle = `rgba(244,248,244,${(a * 0.95 * intensity).toFixed(2)})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(sx - 12, sy - 18);
    ctx.lineTo(sx + 3, sy - 8);
    ctx.moveTo(sx + 13, sy - 16);
    ctx.lineTo(sx - 1, sy - 5);
    ctx.stroke();
  }
  // 火箭（抛物线）
  const arrowPh = (time * 0.0016 + seed) % 1;
  if (arrowPh < 0.5) {
    const ax = sx - 40 + arrowPh * 80;
    const ay = sy - 26 - Math.sin(arrowPh * Math.PI) * 22;
    ctx.strokeStyle = `rgba(210,190,160,${(0.7 * intensity).toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - 5, ay + 2.5);
    ctx.stroke();
  }
  // 倒地者
  ctx.fillStyle = `rgba(58,52,48,${0.7 * intensity})`;
  for (let i = 0; i < 4; i++) {
    const ang = seed * 11 + i * 1.7;
    ctx.save();
    ctx.translate(sx + Math.cos(ang) * 16, sy + Math.sin(ang) * 8);
    ctx.rotate(ang);
    ctx.fillRect(-4, -1.4, 8, 2.8);
    ctx.restore();
  }
}

/** 起义/抗议：人群聚集 + 火把/街垒（v3.0.1 加强：人更多火更旺烟更浓） */
function drawRiot(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number, t: number, power: number) {
  const fade = Math.min(1, t * 3);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const ang = i * 0.45 + Math.sin(time * 0.002 + i) * 0.4;
    const r = 12 + (i % 3) * 7;
    const px = sx + Math.cos(ang) * r;
    const py = sy + Math.sin(ang) * r * 0.5 - 2;
    const bob = Math.abs(Math.sin(time * 0.004 + i * 2)) * 1.8;
    ctx.fillStyle = power > 0.6 ? 'rgb(110,70,60)' : 'rgb(96,96,110)';
    ctx.beginPath();
    ctx.moveTo(px - 2.4, py);
    ctx.quadraticCurveTo(px - 3, py - 7 - bob, px, py - 9 - bob);
    ctx.quadraticCurveTo(px + 3, py - 7 - bob, px + 2.4, py);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(232,204,170)';
    ctx.beginPath();
    ctx.arc(px, py - 10.6 - bob, 1.8, 0, Math.PI * 2);
    ctx.fill();
    if (i % 2 === 0) {
      const raise = Math.sin(time * 0.008 + i * 1.7) * 2;
      ctx.strokeStyle = power > 0.6 ? 'rgb(110,70,60)' : 'rgb(96,96,110)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px + 2.2, py - 6 - bob);
      ctx.lineTo(px + 3.8, py - 12 - bob + raise);
      ctx.stroke();
      if (power > 0.6) {
        const fl = 3 + Math.sin(time * 0.012 + i * 3) * 1.4;
        ctx.fillStyle = `rgba(255,140,50,${0.9 * fade})`;
        ctx.beginPath();
        ctx.ellipse(px + 3.8, py - 13.5 - bob + raise, 2.2, fl, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,208,96,${0.75 * fade})`;
        ctx.beginPath();
        ctx.ellipse(px + 3.8, py - 13.5 - bob + raise, 1.1, fl * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (power > 0.6) {
    // 燃烧的街垒（两处：翻倒的车与木箱堆）+ 浓烟
    for (const [bx, by] of [[16, 6], [-18, -2]] as const) {
      const fx2 = sx + bx, fy = sy + by;
      ctx.fillStyle = 'rgba(96,74,52,0.95)';
      ctx.save();
      ctx.translate(fx2, fy);
      ctx.rotate(0.3);
      ctx.fillRect(-9, -4, 18, 8);
      ctx.restore();
      ctx.fillStyle = 'rgba(120,92,60,0.95)';
      ctx.fillRect(fx2 + 8, fy - 6, 10, 6);
      const fl = 6 + Math.sin(time * 0.013 + seed * 7 + bx) * 3;
      ctx.fillStyle = 'rgba(228,120,44,0.9)';
      ctx.beginPath();
      ctx.ellipse(fx2, fy - 2, 6.5, fl, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,208,96,0.85)';
      ctx.beginPath();
      ctx.ellipse(fx2, fy - 1, 3.4, fl * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let s2 = 0; s2 < 3; s2++) {
        const ph = ((time * 0.0006) + s2 * 0.33 + seed) % 1;
        ctx.fillStyle = `rgba(84,76,70,${((1 - ph) * 0.45 * fade).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(fx2 + Math.sin(ph * 6 + s2 * 2) * 10, fy - 12 - ph * 42, 5 + ph * 13, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    const wave = Math.sin(time * 0.003) * 2;
    ctx.fillStyle = 'rgba(238,228,200,0.92)';
    ctx.beginPath();
    ctx.moveTo(sx - 20, sy - 24);
    ctx.quadraticCurveTo(sx, sy - 29 + wave, sx + 20, sy - 24);
    ctx.lineTo(sx + 18, sy - 17);
    ctx.quadraticCurveTo(sx, sy - 22 + wave, sx - 18, sy - 17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgb(96,84,70)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 20, sy - 24); ctx.lineTo(sx - 20, sy + 2);
    ctx.moveTo(sx + 20, sy - 24); ctx.lineTo(sx + 20, sy + 2);
    ctx.stroke();
  }
}

/** 军队行军：列队开拔 → 会战 → 携俘而归 */
function drawArmy(ctx: CanvasRenderingContext2D, f: Fx, time: number) {
  const from = gridToScreen(f.gx, f.gy);
  const to = f.to ? gridToScreen(f.to.gx, f.to.gy) : from;
  const t = 1 - f.ttl / f.maxTtl; // 0 → 1
  // 尘土行军线
  if (t < 0.55 || t > 0.88) {
    ctx.strokeStyle = 'rgba(180,164,132,0.25)';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 3);
    ctx.lineTo(to.x, to.y - 3);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const n = 12;
  const marching = t < 0.55;
  const returning = t > 0.88;
  const prog = marching ? t / 0.55 : returning ? 1 - (t - 0.88) / 0.12 : 0.5 + Math.min(0.5, (t - 0.55) / 0.1) * 0.02;
  for (let i = 0; i < n; i++) {
    // 队列：斜纵队，间隔
    const lag = i * 0.035;
    const tt = Math.max(0, Math.min(1, prog - lag));
    const x = from.x + (to.x - from.x) * tt;
    const y = from.y + (to.y - from.y) * tt;
    const bob = marching || returning ? Math.abs(Math.sin(time * 0.012 + i * 1.8)) * 1.6 : 0;
    // 阴影
    ctx.fillStyle = 'rgba(40,52,44,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 3.6, 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // 士兵
    ctx.fillStyle = returning && i < 2 ? 'rgb(96,90,84)' : 'rgb(134,88,68)'; // 押着的俘虏色暗
    ctx.beginPath();
    ctx.moveTo(x - 2.4, y);
    ctx.quadraticCurveTo(x - 3, y - 6.5 - bob, x - 1.2, y - 9 - bob);
    ctx.lineTo(x + 1.2, y - 9 - bob);
    ctx.quadraticCurveTo(x + 3, y - 6.5 - bob, x + 2.4, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgb(226,198,164)';
    ctx.beginPath();
    ctx.arc(x, y - 10.4 - bob, 1.9, 0, Math.PI * 2);
    ctx.fill();
    // 头盔
    ctx.fillStyle = 'rgb(120,124,132)';
    ctx.beginPath();
    ctx.arc(x, y - 10.8 - bob, 2.0, Math.PI, Math.PI * 2);
    ctx.fill();
    // 长矛
    ctx.strokeStyle = 'rgb(100,76,48)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 0.5);
    ctx.lineTo(x + 3.6, y - 15 - bob);
    ctx.stroke();
    ctx.fillStyle = 'rgb(170,170,175)';
    ctx.beginPath();
    ctx.moveTo(x + 3.6, y - 15 - bob);
    ctx.lineTo(x + 4.4, y - 18 - bob);
    ctx.lineTo(x + 2.9, y - 16.6 - bob);
    ctx.closePath();
    ctx.fill();
    // 军旗（首领位）
    if (i === 1) {
      const wave = Math.sin(time * 0.005 + i) * 2.2;
      ctx.fillStyle = 'rgb(178,74,58)';
      ctx.beginPath();
      ctx.moveTo(x + 3.6, y - 15 - bob);
      ctx.lineTo(x + 14 + wave, y - 12 - bob);
      ctx.lineTo(x + 3.6, y - 8.5 - bob);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** 丰收：金穗上升飘落 */
function drawHarvestSparkle(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number) {
  for (let i = 0; i < 12; i++) {
    const phase = ((time * 0.0007) + i / 12 + seed) % 1;
    const ang = vhash(i, Math.floor(seed * 100), 3) * Math.PI * 2;
    const x = sx + Math.cos(ang) * (10 + phase * 30) * Math.sin(phase * Math.PI);
    const y = sy - 8 - phase * 42;
    const a = Math.sin(phase * Math.PI) * 0.85;
    ctx.fillStyle = `rgba(238,204,102,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.6 + (1 - Math.abs(phase - 0.5)) * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 陨星：坠落 → 撞击闪光 → 冲击环 + 蘑菇烟 + 焦土 */
function drawMeteor(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number, time: number, seed: number) {
  const fallDur = 0.16;
  if (t < fallDur) {
    const ft = t / fallDur;
    const x = sx + (1 - ft) * 240;
    const y = sy - (1 - ft) * 280 - 20 * ft;
    const grad = ctx.createLinearGradient(x - 66, y + 78, x, y);
    grad.addColorStop(0, 'rgba(255,150,60,0)');
    grad.addColorStop(1, 'rgba(255,200,110,0.9)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 66, y + 78);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = 'rgb(255,230,160)';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const it = (t - fallDur) / (1 - fallDur);
    const ring = it * 2.6;
    if (ring < 1) {
      const a = 1 - ring;
      ctx.strokeStyle = `rgba(255,214,150,${(a * 0.9).toFixed(2)})`;
      ctx.lineWidth = 5 - ring * 3;
      ctx.beginPath();
      ctx.ellipse(sx, sy, ring * 120, ring * 60, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 溅射的土石
    if (it < 0.5) {
      for (let i = 0; i < 6; i++) {
        const ang = i * 1.05 + seed * 3;
        const d = it * 60 * (0.5 + vhash(i, 3, 31));
        ctx.fillStyle = `rgba(96,82,66,${(1 - it * 2).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(ang) * d, sy + Math.sin(ang) * d * 0.5 - it * 20, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 蘑菇烟尘
    for (let i = 0; i < 10; i++) {
      const phase = ((time * 0.00045) + i / 10 + seed) % 1;
      const ang = (i / 10) * Math.PI * 2;
      const spread = 8 + phase * 38;
      const x = sx + Math.cos(ang) * spread;
      const y = sy - 6 - Math.sin(phase * Math.PI) * (22 + phase * 34);
      const a = (1 - phase) * 0.5 * (1 - it * 0.4);
      ctx.fillStyle = `rgba(88,78,66,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 5 + phase * 13, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 4; i++) {
      const phase = ((time * 0.001) + i * 0.25 + seed) % 1;
      ctx.fillStyle = `rgba(255,160,70,${((1 - phase) * 0.8).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx + Math.sin(i * 2.4 + time * 0.002) * 16, sy - 4 - phase * 26, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(40,32,26,${(0.45 * (1 - it * 0.4)).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 24, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 风暴区：乌云 + 雨幕 + 闪电 */
function drawStormZone(ctx: CanvasRenderingContext2D, gx: number, gy: number, time: number, seed: number) {
  const p = gridToScreen(gx, gy);
  ctx.strokeStyle = 'rgba(190,210,230,0.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 26; i++) {
    const ph = ((time * 0.0016) + vhash(i, Math.floor(seed * 50), 7)) % 1;
    const ox = (vhash(i, 9, 11) - 0.5) * 140;
    const yy = p.y - 52 + ph * 64;
    const xx = p.x + ox - ph * 8;
    ctx.moveTo(xx, yy);
    ctx.lineTo(xx - 3, yy + 9);
  }
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const cx = p.x + (vhash(i, 3, 13) - 0.5) * 120;
    const cy = p.y - 58 - vhash(i, 5, 17) * 14;
    ctx.fillStyle = 'rgba(58,66,78,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30 + vhash(i, 7, 19) * 16, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const cyc = (time * 0.0006 + seed) % 1;
  if (cyc < 0.06) {
    const a = 1 - cyc / 0.06;
    ctx.strokeStyle = `rgba(240,244,255,${(a * 0.95).toFixed(2)})`;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    let lx = p.x + (seed - 0.5) * 80, ly = p.y - 64;
    ctx.moveTo(lx, ly);
    for (let i = 0; i < 4; i++) {
      lx += (vhash(i, Math.floor(seed * 30), 23) - 0.5) * 24;
      ly += 13;
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();
  }
}

/** 野火：火舌 + 浓烟 + 焦痕 */
function drawWildfire(ctx: CanvasRenderingContext2D, gx: number, gy: number, time: number, seed: number) {
  const p = gridToScreen(gx, gy);
  ctx.fillStyle = 'rgba(48,38,30,0.35)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 38, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + seed * 3;
    const r = 7 + vhash(i, 3, 29) * 28;
    const fx = p.x + Math.cos(ang) * r;
    const fy = p.y + Math.sin(ang) * r * 0.5;
    const fl = 5 + Math.sin(time * 0.013 + i * 2.1 + seed * 7) * 3;
    ctx.fillStyle = 'rgba(228,120,44,0.85)';
    ctx.beginPath();
    ctx.moveTo(fx - 3, fy);
    ctx.quadraticCurveTo(fx - 4, fy - fl * 0.6, fx, fy - fl);
    ctx.quadraticCurveTo(fx + 4, fy - fl * 0.6, fx + 3, fy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,208,96,0.8)';
    ctx.beginPath();
    ctx.ellipse(fx, fy - fl * 0.35, 1.8, fl * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 6; i++) {
    const phase = ((time * 0.00055) + i / 6 + seed) % 1;
    ctx.fillStyle = `rgba(84,76,70,${((1 - phase) * 0.42).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(phase * 6 + i) * 14, p.y - 16 - phase * 46, 6 + phase * 13, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 商队：两地之间往返的车队 */
function drawCaravan(ctx: CanvasRenderingContext2D, f: Fx, time: number) {
  const from = gridToScreen(f.gx, f.gy);
  const to = f.to ? gridToScreen(f.to.gx, f.to.gy) : from;
  ctx.strokeStyle = 'rgba(224,206,160,0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - 4);
  ctx.lineTo(to.x, to.y - 4);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 3; i++) {
    const trip = ((time * 0.00022) + i * 0.22) % 1;
    const tt = trip < 0.5 ? trip * 2 : 2 - trip * 2;
    const x = from.x + (to.x - from.x) * tt + Math.sin(time * 0.003 + i) * 2;
    const y = from.y + (to.y - from.y) * tt - 4;
    ctx.fillStyle = 'rgb(154,116,70)';
    ctx.fillRect(x - 4.4, y - 3.6, 8.8, 3.6);
    ctx.fillStyle = 'rgb(104,78,50)';
    ctx.fillRect(x - 4.4, y - 3.6, 8.8, 1.3);
    ctx.fillStyle = 'rgb(70,58,46)';
    ctx.beginPath();
    ctx.arc(x - 2.6, y + 0.7, 1.7, 0, Math.PI * 2);
    ctx.arc(x + 2.6, y + 0.7, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(120,96,72)';
    ctx.beginPath();
    ctx.ellipse(x - 7, y - 1.6, 2.4, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 治愈之光：光柱 + 上浮十字星 */
function drawHealLight(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number) {
  const grad = ctx.createLinearGradient(sx, sy - 64, sx, sy + 6);
  grad.addColorStop(0, 'rgba(160,232,208,0)');
  grad.addColorStop(0.6, 'rgba(160,232,208,0.22)');
  grad.addColorStop(1, 'rgba(200,248,226,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(sx - 17, sy - 64, 34, 70);
  for (let i = 0; i < 8; i++) {
    const phase = ((time * 0.0009) + i / 8 + seed) % 1;
    const x = sx + Math.sin(i * 2.3 + seed * 5) * 13;
    const y = sy - 6 - phase * 48;
    const a = Math.sin(phase * Math.PI) * 0.9;
    ctx.strokeStyle = `rgba(190,244,220,${a.toFixed(2)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y);
    ctx.moveTo(x, y - 2); ctx.lineTo(x, y + 2);
    ctx.stroke();
  }
}

/** 祝福金光：环绕上升的光粒 */
function drawBlessingGlow(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number) {
  for (let i = 0; i < 9; i++) {
    const phase = ((time * 0.0006) + i / 9 + seed * 0.13) % 1;
    const ang = i * 0.7 + phase * 2.4;
    const r = 16 + phase * 28;
    const x = sx + Math.cos(ang) * r * 1.5;
    const y = sy - 16 - phase * 34;
    ctx.fillStyle = `rgba(238,206,106,${((1 - phase) * 0.8).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + (1 - phase) * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 困顿之烟（饥荒等）：稀薄的灰烟 */
function drawDistressSmoke(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number) {
  for (let i = 0; i < 3; i++) {
    const phase = ((time * 0.0004) + i * 0.33 + seed) % 1;
    ctx.fillStyle = `rgba(120,112,100,${((1 - phase) * 0.3).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx + Math.sin(phase * 4 + i * 2) * 9, sy - 10 - phase * 30, 3 + phase * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  void TILE_W; void TILE_H;
}
