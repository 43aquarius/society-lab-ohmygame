/**
 * 事件视觉特效系统（v2.0）
 * 让每个事件在沙盘上有真实的表现：山洪漫堤、疫病瘴气、风暴闪电、
 * 陨星坠落、野火、商队、治愈之光、丰收金雨……
 * 特效是纯视觉层，不参与模拟；持久状态（疫病/风暴区）直接从世界状态读取。
 */
import type { WorldState, EventRecord, GodPowerId } from '../types';
import { gridToScreen, vhash, TILE_W, TILE_H } from './iso';

export type FxType =
  | 'flood' | 'plague' | 'battle' | 'harvest' | 'meteor'
  | 'storm' | 'wildfire' | 'caravan' | 'heal' | 'blessing-glow' | 'smoke';

interface Fx {
  type: FxType;
  gx: number; gy: number;
  ttl: number;        // 剩余秒
  maxTtl: number;
  seed: number;
  /** 商队等需要第二点 */
  to?: { gx: number; gy: number };
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

  spawn(type: FxType, gx: number, gy: number, ttl: number, to?: { gx: number; gy: number }) {
    // 同类型同位置去重（刷新时长）
    const exist = this.list.find(f => f.type === type && Math.abs(f.gx - gx) < 2 && Math.abs(f.gy - gy) < 2 && !to);
    if (exist) { exist.ttl = ttl; exist.maxTtl = ttl; return; }
    this.list.push({ type, gx, gy, ttl, maxTtl: ttl, seed: frnd(), to });
  }

  /** 由年度事件生成特效 */
  spawnForEvent(w: WorldState, ev: EventRecord) {
    const s = ev.settlementId !== undefined ? w.settlements.find(x => x.id === ev.settlementId) : null;
    const at = s ?? w.settlements.find(x => !x.dead);
    switch (ev.category) {
      case 'disaster':
        if (ev.title.includes('陨星') || ev.title.includes('陨')) {
          // 陨星位置：标题里的神罚陨星来自 castMeteor，直接用最大聚落近似（或已由神力路径生成）
          if (at) this.spawn('meteor', at.x + (frnd() - 0.5) * 6, at.y + (frnd() - 0.5) * 6, 10);
        } else if (ev.title.includes('风暴')) {
          if (at) this.spawn('storm', at.x, at.y, 14);
        } else if (ev.title.includes('野火') || ev.title.includes('火')) {
          if (at) this.spawn('wildfire', at.x + (frnd() - 0.5) * 8, at.y + (frnd() - 0.5) * 8, 12);
        } else if (ev.title.includes('洪') || ev.title.includes('涝')) {
          if (s) this.spawn('flood', s.x, s.y, 14);
        } else if (ev.title.includes('疫') || ev.title.includes('瘟')) {
          if (s) this.spawn('plague', s.x, s.y, 16);
        } else if (s) {
          this.spawn('flood', s.x, s.y, 12);
        }
        break;
      case 'famine':
        if (s) this.spawn('smoke', s.x, s.y, 10);
        break;
      case 'plague':
        if (s) this.spawn('plague', s.x, s.y, 16);
        break;
      case 'war':
        if (s) this.spawn('battle', s.x, s.y, 8);
        break;
      case 'harvest':
        if (s) this.spawn('harvest', s.x, s.y, 7);
        break;
      case 'trade': {
        // 商路：两个聚落间跑商队
        const alive = w.settlements.filter(x => !x.dead);
        if (alive.length >= 2) {
          const a = alive[0], b = alive[alive.length - 1];
          this.spawn('caravan', a.x, a.y, 12, { gx: b.x, gy: b.y });
        }
        break;
      }
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
      case 'meteor': this.spawn('meteor', gx, gy, 11); this.flash = { color: 'rgb(255,196,120)', alpha: 0.5 }; break;
      case 'storm': this.spawn('storm', gx, gy, 15); break;
      case 'wildfire': this.spawn('wildfire', gx, gy, 13); break;
      case 'pestilence': this.spawn('plague', gx, gy, 18); break;
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
   * persistent: 持续状态（疫病聚落的瘴气）每帧直接绘制
   */
  draw(ctx: CanvasRenderingContext2D, w: WorldState, time: number) {
    // 持久状态：疫病中的聚落持续冒瘴气
    for (const ae of w.activeEvents) {
      if (ae.id !== 'plague-outbreak') continue;
      const s = w.settlements.find(x => x.id === ae.data.settlementId);
      if (s && !s.dead) drawPlagueMiasma(ctx, s.x, s.y, time);
    }
    for (const f of this.list) {
      const p = gridToScreen(f.gx, f.gy);
      const t = f.ttl / f.maxTtl; // 1 → 0
      switch (f.type) {
        case 'flood': drawFlood(ctx, p.x, p.y, 1 - t, time, f.seed); break;
        case 'plague': drawPlagueMiasma(ctx, f.gx, f.gy, time); break;
        case 'battle': drawBattle(ctx, p.x, p.y, time, f.seed); break;
        case 'harvest': drawHarvestSparkle(ctx, p.x, p.y, time, f.seed); break;
        case 'meteor': drawMeteor(ctx, p.x, p.y, 1 - t, time, f.seed); break;
        case 'storm': drawStormZone(ctx, f.gx, f.gy, time, f.seed); break;
        case 'wildfire': drawWildfire(ctx, f.gx, f.gy, time, f.seed); break;
        case 'caravan': drawCaravan(ctx, f, time); break;
        case 'heal': drawHealLight(ctx, p.x, p.y, time, f.seed); break;
        case 'blessing-glow': drawBlessingGlow(ctx, p.x, p.y, time, f.seed); break;
        case 'smoke': drawDistressSmoke(ctx, p.x, p.y, time, f.seed); break;
      }
    }
  }
}

// ============ 各特效绘制 ============

/** 山洪：漫延的浊水 + 波纹圈 + 漂流物 */
function drawFlood(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number, time: number, seed: number) {
  const extent = Math.min(1, t * 2.2); // 蔓延速度
  const fade = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25; // 尾段退水
  const rx = 70 * extent, ry = 35 * extent;
  ctx.save();
  ctx.globalAlpha = 0.75 * fade;
  // 浑水
  ctx.fillStyle = 'rgb(96,110,88)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgb(72,92,76)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9 * fade;
  // 波纹
  ctx.strokeStyle = 'rgba(190,208,188,0.7)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const ph = (time * 0.001 + i * 0.33) % 1;
    ctx.globalAlpha = (1 - ph) * 0.5 * fade;
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx * (0.4 + ph * 0.6), ry * (0.4 + ph * 0.6), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 漂流的原木/ debris
  ctx.globalAlpha = 0.85 * fade;
  for (let i = 0; i < 5; i++) {
    const ang = seed * 7 + i * 1.26;
    const drift = ((time * 0.0004) + i * 0.2) % 1;
    const dx = Math.cos(ang) * rx * (0.2 + drift * 0.65);
    const dy = Math.sin(ang) * ry * (0.2 + drift * 0.65);
    ctx.fillStyle = i % 2 ? 'rgb(104,84,56)' : 'rgb(140,124,88)';
    ctx.save();
    ctx.translate(sx + dx, sy + dy);
    ctx.rotate(ang + time * 0.001);
    ctx.fillRect(-4, -1.4, 8, 2.8);
    ctx.restore();
  }
  ctx.restore();
}

/** 疫病瘴气：绿色雾团上升 */
function drawPlagueMiasma(ctx: CanvasRenderingContext2D, gx: number, gy: number, time: number) {
  const p = gridToScreen(gx, gy);
  for (let i = 0; i < 7; i++) {
    const phase = ((time * 0.0006) + i / 7 + vhash(gx, gy, i) * 0.3) % 1;
    const ang = vhash(gx, gy, 30 + i) * Math.PI * 2;
    const r = 6 + phase * 22;
    const x = p.x + Math.cos(ang) * r;
    const y = p.y - 6 - phase * 26;
    const a = (1 - phase) * 0.4;
    ctx.fillStyle = `rgba(110,150,96,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + phase * 7, 4 + phase * 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 地面病气
  ctx.fillStyle = 'rgba(96,138,84,0.15)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 2, 26, 13, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 冲突：火光 + 硝烟 + 交错的刃光 */
function drawBattle(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number) {
  // 硝烟柱
  for (let i = 0; i < 3; i++) {
    const phase = ((time * 0.0005) + i * 0.33 + seed) % 1;
    const a = (1 - phase) * 0.4;
    ctx.fillStyle = `rgba(70,64,58,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx + Math.sin(phase * 5 + seed * 9) * 8, sy - 10 - phase * 34, 4 + phase * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  // 火舌
  const fl = 2.5 + Math.sin(time * 0.012 + seed * 9) * 1.5;
  for (const [ox, oy] of [[-8, 0], [7, 3]] as const) {
    ctx.fillStyle = 'rgba(224,120,50,0.8)';
    ctx.beginPath();
    ctx.ellipse(sx + ox, sy + oy - 3, 3, fl, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,206,90,0.7)';
    ctx.beginPath();
    ctx.ellipse(sx + ox, sy + oy - 2, 1.5, fl * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 刃光（偶尔闪过）
  const spark = Math.sin(time * 0.02 + seed * 20);
  if (spark > 0.86) {
    const a = (spark - 0.86) / 0.14;
    ctx.strokeStyle = `rgba(240,244,240,${a.toFixed(2)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx - 10, sy - 16);
    ctx.lineTo(sx + 2, sy - 6);
    ctx.moveTo(sx + 10, sy - 14);
    ctx.lineTo(sx - 2, sy - 4);
    ctx.stroke();
  }
}

/** 丰收：金穗上升飘落 */
function drawHarvestSparkle(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number) {
  for (let i = 0; i < 10; i++) {
    const phase = ((time * 0.0007) + i / 10 + seed) % 1;
    const ang = vhash(i, Math.floor(seed * 100), 3) * Math.PI * 2;
    const x = sx + Math.cos(ang) * (10 + phase * 30) * Math.sin(phase * Math.PI);
    const y = sy - 8 - phase * 38;
    const a = Math.sin(phase * Math.PI) * 0.85;
    ctx.fillStyle = `rgba(238,204,102,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.6 + (1 - Math.abs(phase - 0.5)) * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 陨星：坠落 → 撞击闪光 → 冲击环 + 蘑菇烟 */
function drawMeteor(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number, time: number, seed: number) {
  const fallDur = 0.18; // 前段为坠落
  if (t < fallDur) {
    // 坠落：斜向火流星
    const ft = t / fallDur;
    const x = sx + (1 - ft) * 220;
    const y = sy - (1 - ft) * 260 - 20 * ft;
    // 拖尾
    const grad = ctx.createLinearGradient(x - 60, y + 70, x, y);
    grad.addColorStop(0, 'rgba(255,150,60,0)');
    grad.addColorStop(1, 'rgba(255,200,110,0.85)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 60, y + 70);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = 'rgb(255,230,160)';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const it = (t - fallDur) / (1 - fallDur);
    // 冲击环
    const ring = it * 2.6;
    if (ring < 1) {
      const a = 1 - ring;
      ctx.strokeStyle = `rgba(255,214,150,${(a * 0.9).toFixed(2)})`;
      ctx.lineWidth = 4 - ring * 2.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy, ring * 110, ring * 55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 蘑菇烟尘
    for (let i = 0; i < 9; i++) {
      const phase = ((time * 0.00045) + i / 9 + seed) % 1;
      const ang = (i / 9) * Math.PI * 2;
      const spread = 8 + phase * 34;
      const x = sx + Math.cos(ang) * spread;
      const y = sy - 6 - Math.sin(phase * Math.PI) * (20 + phase * 30);
      const a = (1 - phase) * 0.5 * (1 - it * 0.4);
      ctx.fillStyle = `rgba(88,78,66,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 5 + phase * 12, 0, Math.PI * 2);
      ctx.fill();
    }
    // 余烬火星
    for (let i = 0; i < 4; i++) {
      const phase = ((time * 0.001) + i * 0.25 + seed) % 1;
      ctx.fillStyle = `rgba(255,160,70,${(1 - phase) * 0.8})`;
      ctx.beginPath();
      ctx.arc(sx + Math.sin(i * 2.4 + time * 0.002) * 14, sy - 4 - phase * 24, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // 焦土深色斑
    ctx.fillStyle = `rgba(40,32,26,${(0.4 * (1 - it * 0.5)).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 22, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 风暴区：乌云 + 雨幕 + 偶发闪电 */
function drawStormZone(ctx: CanvasRenderingContext2D, gx: number, gy: number, time: number, seed: number) {
  const p = gridToScreen(gx, gy);
  // 雨幕（斜线）
  ctx.strokeStyle = 'rgba(190,210,230,0.4)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 22; i++) {
    const ph = ((time * 0.0016) + vhash(i, Math.floor(seed * 50), 7)) % 1;
    const ox = (vhash(i, 9, 11) - 0.5) * 130;
    const yy = p.y - 46 + ph * 60;
    const xx = p.x + ox - ph * 8;
    ctx.moveTo(xx, yy);
    ctx.lineTo(xx - 3, yy + 9);
  }
  ctx.stroke();
  // 乌云盖
  for (let i = 0; i < 5; i++) {
    const cx = p.x + (vhash(i, 3, 13) - 0.5) * 110;
    const cy = p.y - 52 - vhash(i, 5, 17) * 12;
    ctx.fillStyle = 'rgba(58,66,78,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 26 + vhash(i, 7, 19) * 14, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 闪电（每 2 秒左右一次）
  const cyc = (time * 0.0006 + seed) % 1;
  if (cyc < 0.06) {
    const a = 1 - cyc / 0.06;
    ctx.strokeStyle = `rgba(240,244,255,${(a * 0.95).toFixed(2)})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    let lx = p.x + (seed - 0.5) * 80, ly = p.y - 58;
    ctx.moveTo(lx, ly);
    for (let i = 0; i < 4; i++) {
      lx += (vhash(i, Math.floor(seed * 30), 23) - 0.5) * 22;
      ly += 12;
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();
  }
}

/** 野火：跳动的火舌 + 浓烟 + 焦痕 */
function drawWildfire(ctx: CanvasRenderingContext2D, gx: number, gy: number, time: number, seed: number) {
  const p = gridToScreen(gx, gy);
  // 焦痕
  ctx.fillStyle = 'rgba(48,38,30,0.35)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 34, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  // 火舌簇
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + seed * 3;
    const r = 6 + vhash(i, 3, 29) * 24;
    const fx = p.x + Math.cos(ang) * r;
    const fy = p.y + Math.sin(ang) * r * 0.5;
    const fl = 4 + Math.sin(time * 0.013 + i * 2.1 + seed * 7) * 2.4;
    ctx.fillStyle = 'rgba(228,120,44,0.85)';
    ctx.beginPath();
    ctx.moveTo(fx - 2.6, fy);
    ctx.quadraticCurveTo(fx - 3.4, fy - fl * 0.6, fx, fy - fl);
    ctx.quadraticCurveTo(fx + 3.4, fy - fl * 0.6, fx + 2.6, fy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,208,96,0.8)';
    ctx.beginPath();
    ctx.ellipse(fx, fy - fl * 0.35, 1.6, fl * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 浓烟
  for (let i = 0; i < 5; i++) {
    const phase = ((time * 0.00055) + i / 5 + seed) % 1;
    ctx.fillStyle = `rgba(84,76,70,${((1 - phase) * 0.42).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(phase * 6 + i) * 12, p.y - 14 - phase * 40, 5 + phase * 11, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 商队：两地之间往返的小车 */
function drawCaravan(ctx: CanvasRenderingContext2D, f: Fx, time: number) {
  const from = gridToScreen(f.gx, f.gy);
  const to = f.to ? gridToScreen(f.to.gx, f.to.gy) : from;
  // 轨迹淡线
  ctx.strokeStyle = 'rgba(224,206,160,0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - 4);
  ctx.lineTo(to.x, to.y - 4);
  ctx.stroke();
  ctx.setLineDash([]);
  // 车队往返（3 辆）
  for (let i = 0; i < 3; i++) {
    const trip = ((time * 0.00022) + i * 0.22) % 1;
    const tt = trip < 0.5 ? trip * 2 : 2 - trip * 2;
    const x = from.x + (to.x - from.x) * tt + Math.sin(time * 0.003 + i) * 2;
    const y = from.y + (to.y - from.y) * tt - 4;
    // 小车：车斗 + 两轮
    ctx.fillStyle = 'rgb(154,116,70)';
    ctx.fillRect(x - 4, y - 3.4, 8, 3.4);
    ctx.fillStyle = 'rgb(104,78,50)';
    ctx.fillRect(x - 4, y - 3.4, 8, 1.2);
    ctx.fillStyle = 'rgb(70,58,46)';
    ctx.beginPath();
    ctx.arc(x - 2.4, y + 0.6, 1.6, 0, Math.PI * 2);
    ctx.arc(x + 2.4, y + 0.6, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // 驮兽（一前一后的小点）
    ctx.fillStyle = 'rgb(120,96,72)';
    ctx.beginPath();
    ctx.ellipse(x - 6.4, y - 1.4, 2.2, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 治愈之光：光柱 + 上浮十字星 */
function drawHealLight(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number) {
  const grad = ctx.createLinearGradient(sx, sy - 60, sx, sy + 6);
  grad.addColorStop(0, 'rgba(160,232,208,0)');
  grad.addColorStop(0.6, 'rgba(160,232,208,0.22)');
  grad.addColorStop(1, 'rgba(200,248,226,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(sx - 16, sy - 60, 32, 66);
  for (let i = 0; i < 8; i++) {
    const phase = ((time * 0.0009) + i / 8 + seed) % 1;
    const x = sx + Math.sin(i * 2.3 + seed * 5) * 12;
    const y = sy - 6 - phase * 44;
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
    ctx.arc(sx + Math.sin(phase * 4 + i * 2) * 8, sy - 10 - phase * 28, 3 + phase * 8, 0, Math.PI * 2);
    ctx.fill();
  }
}
