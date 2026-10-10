/**
 * PopulationSystem — 人口、健康与迁徙
 * 增长率受粮食、住房、医疗、冲突与拥挤约束，不存在永恒正增长。
 */
import { CFG } from '../config';
import type { WorldState, Settlement } from '../types';
import { Rng } from '../types';
import { settlementName } from '../names';
import { Terrain } from '../types';

export function housingCapacity(s: Settlement): number {
  let cap = 0;
  for (const b of s.buildings) cap += b.kind === 'camp' ? 8 : b.kind === 'shelter' ? 12 : b.kind === 'house' ? 16 : b.kind === 'townhouse' ? 22 : 0;
  return cap;
}

/** 返回本年人口变动与死亡原因记录 */
export function tickPopulation(w: WorldState, s: Settlement, foodRatio: number): { deaths: number; births: number; famineSeverity: number } {
  const rng: Rng = w.rng;
  const v = w.civ.vars;
  const pop = s.population;
  if (pop <= 0) { s.dead = true; return { deaths: 0, births: 0, famineSeverity: 0 }; }

  const med = w.civ.tech.levels.medicine ?? 1;
  const well = s.buildings.some(b => b.kind === 'well' && b.progress >= 1);
  const services = s.buildings.filter(b => b.kind === 'services' && b.progress >= 1).length;
  const health = 0.62 + med * 0.055 + (well ? 0.08 : 0) + services * 0.05 + v.publicServices * 0.12;

  // 饥荒严重度：连续短缺且库存耗尽
  let famine = 0;
  if (foodRatio < 1 && s.food <= 0.01) {
    famine = Math.min(1, (1 - foodRatio) * 1.6 + s.shortageYears * 0.12);
    s.shortageYears++;
  } else if (foodRatio >= 1) {
    s.shortageYears = Math.max(0, s.shortageYears - 1);
  }

  const housing = housingCapacity(s) / Math.max(1, pop);
  const foodFactor = Math.max(0.05, Math.min(1.35, foodRatio));
  // 出生受健康上限抑制但不至于归零；死亡随健康恶化上升——避免双向重复惩罚
  const birthRate = CFG.birthBase * (foodFactor - 0.25) * (0.55 + Math.min(1, housing) * 0.45)
    * (1 - v.unrest * 0.25) * Math.min(1.1, 0.72 + health * 0.38);
  const deathRate = CFG.deathBase * (1.06 - Math.min(0.6, health * 0.5))
    * (1 + famine * 3.4 + v.unrest * 0.25 + (housing < 0.6 ? 0.35 : 0));

  const births = Math.max(0, pop * birthRate * rng.range(0.85, 1.15));
  const deaths = Math.max(0, pop * deathRate * rng.range(0.85, 1.15));
  let delta = Math.round(births - deaths + (rng.next() - 0.5));
  s.population = Math.max(0, s.population + delta);

  // 迁徙：食物压力 → 外流或分蘖
  const migration = tryMigration(w, s, foodRatio, housing);
  if (s.population < CFG.minViablePop) {
    s.dead = true;
    s.population = 0;
  }
  return { deaths: Math.round(deaths + migration), births: Math.round(births), famineSeverity: famine };
}

/** 饥荒驱动的外迁；人口充足时分蘖新聚落（文明扩张的自然途径）。 */
function tryMigration(w: WorldState, s: Settlement, foodRatio: number, housing: number): number {
  if (s.dead) return 0;
  const alive = w.settlements.filter(x => !x.dead);
  let out = 0;
  if (foodRatio < 0.72 && s.shortageYears >= 2) {
    out += Math.round(s.population * 0.06);
    // 有人出走寻找新家园
    if (s.population > 60 && w.rng.chance(0.35)) spawnSplinter(w, s, 8);
  }
  if (housing < 0.55 && s.population > 120) {
    if (w.rng.chance(0.22)) spawnSplinter(w, s, 10);
  }
  s.population -= out;
  return out;
}

/** 从 s 分出 r% 人口建立新营地 */
export function spawnSplinter(w: WorldState, s: Settlement, percent: number, at?: { x: number; y: number }): Settlement | null {
  const size = w.config.size;
  let best: { x: number; y: number } | null = at ?? null;
  if (!best) {
    let bestScore = -1;
    for (let attempt = 0; attempt < 120; attempt++) {
      const ang = w.rng.next() * Math.PI * 2;
      const dist = w.rng.range(8, Math.min(16, size * 0.3));
      const x = Math.round(s.x + Math.cos(ang) * dist);
      const y = Math.round(s.y + Math.sin(ang) * dist);
      if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
      const t = w.tiles[y * size + x];
      if (t.terrain === Terrain.Water || t.terrain === Terrain.Mountain) continue;
      // 评分：沃土 + 不太近
      let score = t.fertility + w.rng.next() * 0.3;
      for (const o of w.settlements) {
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < 6) { score = -1; break; }
        score += Math.min(d, 20) * 0.02;
      }
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    if (!best || bestScore < 0) return null;
  }
  const group = Math.max(CFG.minViablePop + 4, Math.round(s.population * percent / 100));
  if (s.population - group < CFG.minViablePop) return null;
  s.population -= group;
  const used = new Set(w.settlements.map(x => x.name));
  const ns: Settlement = {
    id: w.settlements.length ? Math.max(...w.settlements.map(x => x.id)) + 1 : 0,
    name: settlementName(w.rng, 'camp', used),
    x: best.x, y: best.y,
    stage: 'camp', population: group,
    buildings: [], construction: [],
    food: group * 0.5, wood: group * 0.15, stone: 0, metal: 0,
    radius: 3, shortageYears: 0, founded: w.year,
    effects: [], dead: false, lastFamine: -999,
  };
  w.settlements.push(ns);
  return ns;
}
