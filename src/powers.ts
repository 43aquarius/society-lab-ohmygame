/**
 * GodPowerSystem — 玩家的神力操作
 * 神力直接修改真实模拟状态（地形/天气/产出/知识/思想），
 * 有限干预模式下受神力能量约束；自由模式无限制。
 * 所有作用立即反映在地图与模拟中。
 */
import { CFG } from './config';
import { Terrain, type WorldState, type GodPowerId, type Rng } from './types';

export interface GodPowerDef {
  id: GodPowerId;
  name: string;
  icon: string;
  group: 'create' | 'sky' | 'guide';
  desc: string;
  /** 是否为笔刷类（作用于地形） */
  brush: boolean;
  cost: number;
}

export const GOD_POWERS: GodPowerDef[] = [
  { id: 'forest', name: '生长之林', icon: 'forest', group: 'create', brush: true, cost: CFG.costs.forest, desc: '让荒地长出森林（提供木材与采集）' },
  { id: 'fertile', name: '丰饶沃土', icon: 'fertile', group: 'create', brush: true, cost: CFG.costs.fertile, desc: '祝圣土地，使其成为肥沃的农田' },
  { id: 'water', name: '涌泉之水', icon: 'water', group: 'create', brush: true, cost: CFG.costs.water, desc: '在旱地唤出水源' },
  { id: 'ore', name: '大地之藏', icon: 'ore', group: 'create', brush: true, cost: CFG.costs.ore, desc: '在山地埋下矿脉' },
  { id: 'rain', name: '唤雨', icon: 'rain', group: 'sky', brush: true, cost: CFG.costs.rain, desc: '为一片土地带来连年降雨' },
  { id: 'drought', name: '降旱', icon: 'drought', group: 'sky', brush: true, cost: CFG.costs.drought, desc: '使一片土地陷入干旱' },
  { id: 'blessing', name: '丰产祝福', icon: 'blessing', group: 'guide', brush: true, cost: CFG.costs.blessing, desc: '祝福一处聚落，六年内收成大增' },
  { id: 'enlighten', name: '知识启蒙', icon: 'enlighten', group: 'guide', brush: false, cost: CFG.costs.enlighten, desc: '向文明注入灵光，加速技术与思想' },
  { id: 'ideas', name: '思想传播', icon: 'ideas', group: 'guide', brush: false, cost: CFG.costs.ideas, desc: '传播平等与组织的观念，提升参与和组织力' },
];

export interface CastResult {
  ok: boolean;
  message: string;
  /** 实际影响的格数（反馈用） */
  tiles: number;
  settlementId?: number;
}

/** 笔刷地形神力 */
export function castBrushPower(w: WorldState, id: GodPowerId, cx: number, cy: number, radius: number): CastResult {
  const def = GOD_POWERS.find(p => p.id === id)!;
  if (!canAfford(w, def.cost)) return { ok: false, message: '神力不足，等待恢复…', tiles: 0 };
  const size = w.config.size;
  let touched = 0;
  let settlementTouched: number | undefined;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const t = w.tiles[y * size + x];
      if (t.terrain === Terrain.Mountain && id !== 'ore' && id !== 'water') continue;
      if (t.terrain === Terrain.Water && id !== 'fertile' && id !== 'forest') continue;
      touched++;
      switch (id) {
        case 'forest':
          if (t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain) {
            t.terrain = Terrain.Forest;
            t.fertility = Math.max(t.fertility, 0.35);
          }
          break;
        case 'fertile':
          if (t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain) {
            t.terrain = Terrain.Fertile;
            t.fertility = Math.min(1, 0.85);
            t.moisture = Math.max(t.moisture, 0.55);
          }
          break;
        case 'water':
          if (t.terrain !== Terrain.Mountain) {
            t.terrain = Terrain.Water;
            t.elevation = 0;
          }
          break;
        case 'ore':
          if (t.terrain === Terrain.Hills || t.terrain === Terrain.Mountain || t.terrain === Terrain.Rock) {
            t.ore = true;
          } else if (t.terrain !== Terrain.Water) {
            t.terrain = Terrain.Rock;
            t.ore = true;
            t.fertility = 0.08;
          }
          break;
        case 'rain': {
          const cell = w.weather[y * size + x];
          cell.wet = Math.min(1, cell.wet + 0.8);
          cell.years = Math.max(cell.years, 5);
          t.moisture = Math.min(1, t.moisture + 0.12);
          break;
        }
        case 'drought': {
          const cell = w.weather[y * size + x];
          cell.wet = Math.max(-1, cell.wet - 0.95);
          cell.years = Math.max(cell.years, 5);
          t.moisture = Math.max(0, t.moisture - 0.18);
          break;
        }
        case 'blessing': {
          // 找最近聚落
          let best = Infinity;
          for (const s of w.settlements) {
            if (s.dead) continue;
            const d = Math.hypot(s.x - x, s.y - y);
            if (d < best) { best = d; settlementTouched = s.id; }
          }
          break;
        }
      }
    }
  }
  if (id === 'blessing') {
    const s = w.settlements.find(x => x.id === settlementTouched);
    if (!s || s.dead) return { ok: false, message: '这里没有可以祝福的聚落', tiles: 0 };
    const existing = s.effects.find(e => e.kind === 'blessing');
    if (existing) { existing.years = 6; existing.power = 0.4; }
    else s.effects.push({ kind: 'blessing', years: 6, power: 0.4 });
    touched = 1;
  }
  if (touched === 0) return { ok: false, message: '这片土地无法接受该神力', tiles: 0 };
  spend(w, def.cost);
  w.interventions++;
  const names: Record<GodPowerId, string> = {
    forest: '森林生长起来', fertile: '土地变得肥沃', water: '清泉涌出', ore: '大地显露矿藏',
    rain: '甘霖落下', drought: '烈日炙烤大地', blessing: '丰产的祝福降临', enlighten: '', ideas: '',
  };
  return { ok: true, message: names[id] ?? '', tiles: touched, settlementId: settlementTouched };
}

/** 文明级神力（启蒙/思想） */
export function castCivPower(w: WorldState, id: 'enlighten' | 'ideas'): CastResult {
  const def = GOD_POWERS.find(p => p.id === id)!;
  if (!canAfford(w, def.cost)) return { ok: false, message: '神力不足，等待恢复…', tiles: 0 };
  const pop = w.civ.vars.population;
  if (pop <= 0) return { ok: false, message: '文明已不存在', tiles: 0 };
  spend(w, def.cost);
  w.interventions++;
  if (id === 'enlighten') {
    w.civ.enlightenment = Math.min(1.2, w.civ.enlightenment + 0.45);
    w.civ.tech.points += 22 + pop * 0.012;
    return { ok: true, message: '灵光注入了求知者的心灵', tiles: 1 };
  } else {
    w.civ.enlightenment = Math.min(1.2, w.civ.enlightenment + 0.25);
    const v = w.civ.vars;
    v.participation = Math.min(1, v.participation + 0.08);
    v.orgCommon = Math.min(1, v.orgCommon + 0.07);
    const g = w.civ.groups.find(x => x.id === 'commoners')!;
    g.ideas = Math.min(1, g.ideas + 0.25);
    return { ok: true, message: '平等与组织的观念开始流传', tiles: 1 };
  }
}

export function canAfford(w: WorldState, cost: number): boolean {
  return w.config.mode === 'free' || w.divine >= cost;
}
export function spend(w: WorldState, cost: number): void {
  if (w.config.mode === 'limited') w.divine -= cost;
}

/** 净化进行中的疫病（事件卡的神力回应） */
export function castPurify(w: WorldState, settlementId: number): CastResult {
  const cost = 12;
  if (!canAfford(w, cost)) return { ok: false, message: '神力不足，等待恢复…', tiles: 0 };
  const idx = w.activeEvents.findIndex(ae => ae.id === 'plague-outbreak' && ae.data.settlementId === settlementId);
  if (idx < 0) return { ok: false, message: '此处没有需要净化的疫病', tiles: 0 };
  w.activeEvents.splice(idx, 1);
  spend(w, cost);
  w.interventions++;
  const s = w.settlements.find(x => x.id === settlementId);
  if (s) {
    w.civ.tech.progress.medicine = Math.max(w.civ.tech.progress.medicine, 2);
    w.civ.vars.trust = Math.min(1, w.civ.vars.trust + 0.08);
  }
  return { ok: true, message: '疫病被神力净化', tiles: 1, settlementId };
}

/** 神力使用记录为编年史事件（由 UI 调用） */
export function powerChronicleEntry(w: WorldState, id: GodPowerId, result: CastResult) {
  const def = GOD_POWERS.find(p => p.id === id)!;
  return {
    id: `ev-${w.nextEventId++}`,
    year: w.year,
    title: `神力：${def.name}`,
    category: (id === 'enlighten' || id === 'ideas' ? 'ideas' : id === 'drought' || id === 'rain' ? 'disaster' : 'harvest') as any,
    text: result.settlementId !== undefined
      ? `一道光落在${w.settlements.find(s => s.id === result.settlementId)?.name ?? '聚落'}上空。`
      : `天象异动，大地的模样悄然改变。`,
    causes: [`神（玩家）施加「${def.name}」`, `影响范围约 ${result.tiles} 格`],
    effects: [result.message || def.desc],
    intervened: true,
    severity: 0.2,
    settlementId: result.settlementId,
  };
}
