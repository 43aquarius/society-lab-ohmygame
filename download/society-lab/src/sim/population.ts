/**
 * PopulationSystem v4.0 — 人口、健康与迁徙
 * - 迁徙优先流入同文明的聚落（文化认同），跨文明迁徙仅发生在接触后；
 * - 远距离分蘖可能孕育全新文明（文化分化：如同真实历史上的一支迁徙
 *   者在远方建立新的社会）；
 * - 新聚落自带中心广场与道路骨架。
 */
import { CFG, SETTLEMENT_CAP_DIV } from '../config';
import type { WorldState, Settlement, Civilization } from '../types';
import { Rng } from '../types';
import { settlementName, civilizationName, CIV_COLORS } from '../names';
import { Terrain } from '../types';
import { tileAt } from '../worldgen';

export function housingCapacity(s: Settlement): number {
  let cap = 0;
  for (const b of s.buildings) {
    cap += b.kind === 'camp' ? 14 : b.kind === 'shelter' ? 10 : b.kind === 'house' ? 13
      : b.kind === 'townhouse' ? 28 : b.kind === 'manor' ? 10 : b.kind === 'castle' ? 6 : 0;
  }
  return cap;
}

/** 返回本年人口变动与死亡原因记录 */
export function tickPopulation(w: WorldState, s: Settlement, foodRatio: number): { deaths: number; births: number; famineSeverity: number } {
  const rng: Rng = w.rng;
  const civ = w.civs[s.civId];
  const v = civ.vars;
  const pop = s.population;
  if (pop <= 0) { s.dead = true; return { deaths: 0, births: 0, famineSeverity: 0 }; }

  const med = civ.tech.levels.medicine ?? 1;
  const well = s.buildings.some(b => b.kind === 'well' && b.progress >= 1);
  const hospitals = s.buildings.filter(b => (b.kind === 'hospital' || b.kind === 'services') && b.progress >= 1).length;
  const healing = s.effects.reduce((a, e) => e.kind === 'healing' ? a + e.power : a, 0);
  const health = 0.62 + med * 0.055 + (well ? 0.08 : 0) + hospitals * 0.06 + v.publicServices * 0.12 + healing;

  // 饥荒严重度：连续短缺且库存耗尽
  let famine = 0;
  if (foodRatio < 1 && s.food <= 0.01) {
    famine = Math.min(1, (1 - foodRatio) * 1.6 + s.shortageYears * 0.12);
    s.shortageYears++;
  } else if (foodRatio >= 1) {
    s.shortageYears = Math.max(0, s.shortageYears - 1);
  }

  const housing = housingCapacity(s) / Math.max(1, pop);
  const foodFactor = Math.max(0.05, Math.min(1.25, foodRatio));
  const birthRate = CFG.birthBase * (foodFactor - 0.25) * (0.55 + Math.min(1, housing) * 0.45)
    * (1 - v.unrest * 0.25) * Math.min(1.1, 0.72 + health * 0.38);
  const deathRate = CFG.deathBase * (1.06 - Math.min(0.6, health * 0.5))
    * (1 + famine * 3.4 + v.unrest * 0.25 + (housing < 0.6 ? 0.35 : 0));

  const births = Math.max(0, pop * birthRate * rng.range(0.85, 1.15));
  const deaths = Math.max(0, pop * deathRate * rng.range(0.85, 1.15));
  let delta = Math.round(births - deaths + (rng.next() - 0.5));
  s.population = Math.max(0, s.population + delta);

  // 迁徙：压力驱动；优先流入同文明聚落（城市化），无接纳者才分蘖
  const migration = tryMigration(w, s, foodRatio, housing);
  if (s.population < CFG.minViablePop) {
    s.dead = true;
    s.population = 0;
  }
  return { deaths: Math.round(deaths + migration), births: Math.round(births), famineSeverity: famine };
}

/** 找一个可接纳移民的聚落（优先同文明；接触过的外文明亦可） */
function findAbsorber(w: WorldState, from: Settlement): Settlement | null {
  let best: Settlement | null = null;
  let bestScore = -Infinity;
  for (const t of w.settlements) {
    if (t.dead || t.id === from.id) continue;
    // 文化认同：同文明优先，未接触的异文明不去
    const sameCiv = t.civId === from.civId;
    if (!sameCiv) {
      const home = w.civs[from.civId];
      if (!home.met.includes(t.civId)) continue;
    }
    const cap = housingCapacity(t);
    const room = cap - t.population;
    if (room < 15) continue;
    if (t.food < t.population * 0.5 && t.shortageYears > 0) continue; // 自顾不暇
    const d = Math.hypot(t.x - from.x, t.y - from.y);
    const score = Math.min(room, 120) - d * 2 + (sameCiv ? 30 : 0) + (t.stage === 'camp' ? -25 : 0);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/** 饥荒/拥挤驱动的人口流动。返回流出人数。 */
function tryMigration(w: WorldState, s: Settlement, foodRatio: number, housing: number): number {
  if (s.dead) return 0;
  let out = 0;

  if (foodRatio < 0.75 && s.shortageYears >= 2) {
    // 饥荒流民：优先投奔富余聚落，无人接纳才在条件允许时自立门户
    const flow = Math.round(s.population * 0.08);
    const absorber = findAbsorber(w, s);
    if (absorber) {
      absorber.population += flow;
      out += flow;
    } else {
      out += Math.round(flow * 0.4); // 找不到去处的人四散而亡/离开世界
      trySplinter(w, s, 9);
    }
  }

  // v4.0：人口压力的主动扩张——住房紧张即分蘖（人类历史的常态是扩散）
  if (housing < 0.72 && s.population > 130 && w.rng.chance(0.25)) {
    const absorber = findAbsorber(w, s);
    if (absorber) {
      const flow = Math.round(s.population * 0.05);
      absorber.population += flow;
      out += flow;
    } else {
      trySplinter(w, s, 11);
    }
  }
  if (housing < 0.55 && s.population > 90) {
    const absorber = findAbsorber(w, s);
    if (absorber) {
      const flow = Math.round(s.population * 0.05);
      absorber.population += flow;
      out += flow;
    } else {
      trySplinter(w, s, 11);
    }
  }
  s.population -= out;
  return out;
}

/** 分蘖新聚落（严格限制：母体规模、聚落总数、冷却） */
function trySplinter(w: WorldState, s: Settlement, percent: number): void {
  const alive = w.settlements.filter(x => !x.dead).length;
  const cap = Math.max(5, Math.floor(w.gen.size / SETTLEMENT_CAP_DIV));
  if (alive >= cap) return;
  if (s.population < CFG.splinterMinPop) return;
  if (w.year - s.founded < 20) return;
  if (!w.rng.chance(0.5)) return;
  spawnSplinter(w, s, percent);
}

/** 从 s 分出 percent% 人口建立新营地（距离远时可能孕育新文明） */
export function spawnSplinter(w: WorldState, s: Settlement, percent: number, at?: { x: number; y: number }): Settlement | null {
  const size = w.gen.size;
  let best: { x: number; y: number } | null = at ?? null;
  let bestScore = -1;
  if (!best) {
    for (let attempt = 0; attempt < 140; attempt++) {
      const ang = w.rng.next() * Math.PI * 2;
      // v4.0：偶发远征式分蘖（距离可超过 newCivMinDist → 孕育新文明/接触异邦）
      const dist = w.rng.range(9, Math.min(40, 8 + size * 0.07));
      const x = Math.round(s.x + Math.cos(ang) * dist);
      const y = Math.round(s.y + Math.sin(ang) * dist);
      if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
      const t = tileAt(w, x, y);
      if (!t || t.terrain === Terrain.Water || t.terrain === Terrain.Mountain || t.terrain === Terrain.Sand) continue;
      if (t.elevation > 2) continue;
      // 评分：沃土 + 不太近
      let score = t.fertility + w.rng.next() * 0.3;
      for (const o of w.settlements) {
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < 8) { score = -1; break; }
        score += Math.min(d, 20) * 0.02;
      }
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    if (!best || bestScore < 0) return null;
  }
  const group = Math.max(CFG.minViablePop + 4, Math.round(s.population * percent / 100));
  if (s.population - group < CFG.minViablePop) return null;
  s.population -= group;

  // —— 文化分化判定：指定地点距母聚落超过阈值 → 新文明 ——
  const distFromHome = Math.hypot(best.x - s.x, best.y - s.y);
  let civId = s.civId;
  let newCiv: Civilization | null = null;
  const livingCivs = w.civs.filter(c => !c.dead).length;
  if (distFromHome >= CFG.newCivMinDist && livingCivs < CFG.civMax && w.rng.chance(0.42)) {
    newCiv = createCiv(w, `来自${s.name}的迁徙者`);
  }
  if (newCiv) {
    civId = newCiv.id;
    inheritTech(w.civs[s.civId], newCiv, 0.7); // 迁徙者携带部分技艺
  }

  const used = new Set(w.settlements.map(x => x.name));
  const ns: Settlement = {
    id: w.settlements.length ? Math.max(...w.settlements.map(x => x.id)) + 1 : 0,
    name: settlementName(w.rng, 'camp', used),
    x: best.x, y: best.y,
    civId,
    stage: 'camp', population: group,
    buildings: [], construction: [],
    food: group * 0.5, wood: group * 0.15, stone: 0, metal: 0,
    radius: 3, shortageYears: 0, founded: w.year,
    effects: [], dead: false, lastFamine: -999,
    roads: new Set<number>(),
  };
  // 中心小广场
  ns.roads.add(best.y * size + best.x);
  w.settlements.push(ns);
  if (newCiv) {
    w.chronicle.push({
      id: `ev-${w.nextEventId++}`, year: w.year, civId: newCiv.id,
      title: `新文明诞生：${newCiv.name}`,
      category: 'migration',
      text: `一支迁徙者越过山川，在遥远的土地上停下了脚步。他们与故土的联系渐渐淡去，一个新文明——${newCiv.name}——从此登上历史舞台。`,
      causes: [`迁徙距离 ${Math.round(distFromHome)} 格，故土记忆淡去`],
      effects: [`世界文明数 → ${w.civs.filter(c => !c.dead).length}`],
      intervened: false, severity: 0.6, settlementId: ns.id,
    });
  }
  return ns;
}

/** 创建一个新文明（独立的社会形态演化路径） */
export function createCiv(w: WorldState, _origin: string): Civilization {
  const usedNames = new Set(w.civs.map(c => c.name));
  const id = w.civs.length;
  const civ: Civilization = {
    id,
    name: civilizationName(w.rng, usedNames),
    color: CIV_COLORS[id % CIV_COLORS.length],
    culture: w.rng.int(4),
    form: 'primitive', formSince: w.year, prevForm: null,
    vars: {
      population: 0,
      ownCommon: 0.92, ownPrivate: 0.06, ownPublic: 0.02,
      laborForced: 0.02, laborBonded: 0.05, laborWage: 0.02, laborCoop: 0.12,
      landConcentration: 0.12, market: 0.05, stateCapacity: 0.08,
      publicServices: 0.05, education: 0.08, specialization: 0.05,
      livingStandard: 0.18, trust: 0.5, participation: 0.08,
      unrest: 0.08, environment: 1, resourcePressure: 0.1,
      wealthCommon: 0.8, wealthElite: 0.1, wealthMiddle: 0.1,
      orgCommon: 0.06, orgElite: 0.1,
    },
    tech: {
      levels: { agriculture: 1, crafting: 1, building: 1, commerce: 1, governance: 1, medicine: 1, industry: 1, education: 1 },
      points: 0,
      progress: { agriculture: 0, crafting: 0, building: 0, commerce: 0, governance: 0, medicine: 0, industry: 0, education: 0 },
    },
    groups: [
      { id: 'commoners', name: '平民', ideas: 0.05 },
      { id: 'elite', name: '精英', ideas: -0.1 },
      { id: 'middle', name: '工商业者', ideas: 0.1 },
    ],
    warMemory: 0, enlightenment: 0,
    met: [], dead: false, founded: w.year, history: [],
  };
  w.civs.push(civ);
  return civ;
}

/** 让新文明继承母文明的部分知识（迁徙者携带技艺） */
export function inheritTech(from: Civilization, to: Civilization, ratio: number): void {
  for (const d of Object.keys(to.tech.levels)) {
    const src = from.tech.levels[d] ?? 1;
    const lv = Math.max(1, Math.round(src * ratio) - (src > 2 ? 1 : 0));
    to.tech.levels[d] = Math.max(1, lv);
  }
}
