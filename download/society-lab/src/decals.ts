/**
 * v3.0 持久沙盘印记：坟墓 / 陨坑 / 焦痕 / 废墟
 * 历史在土地上留下痕迹 —— 战争与瘟疫的死者有坟，陨星砸出坑洼，
 * 大火留下焦土，湮灭的聚落只剩断壁残垣。
 * 性能：坟墓（数量大）按 4 档风化度分组为 Path2D 批量绘制 + 视口裁剪。
 */
import type { WorldState, Decal } from './types';
import { CFG } from './config';
import { gridToScreen, elevAt, ELEV_H, vhash } from './render/iso';

export function addDecal(w: WorldState, kind: Decal['kind'], x: number, y: number) {
  w.decals.push({ kind, x, y, year: w.year, seed: vhash(x | 0, y | 0, kind.length * 7) % 0.97 });
  if (w.decals.length > CFG.agents.decalsMax) w.decals.shift();
}

/**
 * 绘制印记。inView: 世界像素级视口检测（可选）。
 */
export function drawDecals(
  ctx: CanvasRenderingContext2D,
  w: WorldState,
  lod: number,
  inView?: (sx: number, sy: number) => boolean,
) {
  // 坟墓批量绘制（4 档风化度 × 形体/墓石两层）
  const FADES = [0.42, 0.62, 0.82, 1.0];
  const moundPaths: (Path2D | null)[] = [null, null, null, null];
  const stonePaths: (Path2D | null)[] = [null, null, null, null];
  let grassPaths: (Path2D | null)[] = [null, null, null, null];

  for (const d of w.decals) {
    const p = gridToScreen(d.x, d.y);
    const y = p.y - elevAt(w, d.x, d.y) * ELEV_H;
    if (inView && !inView(p.x, y)) continue;
    const age = w.year - d.year;
    const fade = Math.max(0.35, 1 - age / 400);

    switch (d.kind) {
      case 'grave': {
        const bucket = fade > 0.85 ? 3 : fade > 0.65 ? 2 : fade > 0.5 ? 1 : 0;
        let mp = moundPaths[bucket];
        if (!mp) { mp = new Path2D(); moundPaths[bucket] = mp; }
        mp.moveTo(p.x + 4.6, y);
        mp.ellipse(p.x, y, 4.6, 2.2, 0, 0, Math.PI * 2);
        let sp = stonePaths[bucket];
        if (!sp) { sp = new Path2D(); stonePaths[bucket] = sp; }
        sp.moveTo(p.x + 1, y - 6);
        sp.rect(p.x - 1, y - 6, 2, 5);
        sp.moveTo(p.x + 1.4, y - 6);
        sp.arc(p.x, y - 6, 1.4, 0, Math.PI * 2);
        if (lod > 0.7) {
          let gp = grassPaths[bucket];
          if (!gp) { gp = new Path2D(); grassPaths[bucket] = gp; }
          gp.moveTo(p.x - 3, y - 1);
          gp.lineTo(p.x - 3.6, y - 3.4);
          gp.moveTo(p.x + 3.2, y - 0.6);
          gp.lineTo(p.x + 3.8, y - 3);
        }
        break;
      }
      case 'crater': {
        const r = 14 + d.seed * 8;
        ctx.fillStyle = `rgba(58,50,44,${0.55 * fade})`;
        ctx.beginPath();
        ctx.ellipse(p.x, y, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(84,74,64,${0.5 * fade})`;
        ctx.beginPath();
        ctx.ellipse(p.x, y, r * 0.55, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        if (lod > 0.7) {
          ctx.strokeStyle = `rgba(30,26,22,${0.4 * fade})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x - r * 0.4, y - 2);
          ctx.lineTo(p.x - r * 0.1, y + 1);
          ctx.moveTo(p.x + r * 0.2, y - 1);
          ctx.lineTo(p.x + r * 0.45, y + 2);
          ctx.stroke();
        }
        break;
      }
      case 'scorch': {
        const r = 10 + d.seed * 10;
        ctx.fillStyle = `rgba(44,36,30,${0.4 * fade})`;
        ctx.beginPath();
        ctx.ellipse(p.x, y, r, r * 0.55, d.seed * 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ruin': {
        ctx.fillStyle = `rgba(112,104,94,${0.85 * fade})`;
        for (let i = 0; i < 5; i++) {
          const a = d.seed * 9 + i * 1.9;
          const ox = Math.cos(a) * (6 + i * 3.5);
          const oy = Math.sin(a) * (3 + i * 1.8);
          const h = 4 + ((i * 37 + (d.seed * 100 | 0)) % 7);
          ctx.fillRect(p.x + ox - 2, y + oy - h, 4, h);
        }
        ctx.fillStyle = `rgba(70,64,58,${0.5 * fade})`;
        ctx.beginPath();
        ctx.ellipse(p.x, y + 1, 16, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }
  // 批量填充坟墓
  for (let b = 0; b < 4; b++) {
    const a = FADES[b];
    if (moundPaths[b]) { ctx.fillStyle = `rgba(96,104,78,${0.9 * a})`; ctx.fill(moundPaths[b]!); }
    if (stonePaths[b]) { ctx.fillStyle = `rgba(126,124,116,${0.95 * a})`; ctx.fill(stonePaths[b]!); }
    if (grassPaths[b]) { ctx.strokeStyle = `rgba(120,140,90,${0.6 * a})`; ctx.lineWidth = 0.8; ctx.stroke(grassPaths[b]!); }
  }
}
