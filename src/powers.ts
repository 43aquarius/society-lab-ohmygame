/**
 * GodPowerSystem — 玩家的神力操作
 * 神力直接修改真实模拟状态（地形/天气/产出/知识/思想），
 * 有限干预模式下受神力能量约束；自由模式无限制。
 * 所有作用立即反映在地图与模拟中。
 *
 * v2.0 神力扩充（17 种）：
 * - 造物：森林 / 沃土 / 草原 / 涌泉 / 矿藏 / 造山
 * - 天象：唤雨 / 降旱
 * - 灾厄：陨星 / 风暴 / 野火 / 瘟疫
 * - 启蒙：祝福 / 启蒙 / 思想 / 治愈 / 奠基（新聚落）
 */
import { CFG } from './config';
import { Terrain, type WorldState, type GodPowerId, type Rng } from './types';
import { spawnSplinter } from './sim/population';

export interface GodPowerDef {
  id: GodPowerId;
  name: string;
  icon: string;
  group: 'create' | 'sky' | 'calamity' | 'guide';
  desc: string;
  /** 是否为笔刷类（作用于地形） */
  brush: boolean;
  cost: number;
}

export const GOD_POWERS: GodPowerDef[] = [
  // —— 造物 ——
  { id: 'forest', name: '生长之林', icon: 'forest', group: 'create', brush: true, cost: CFG.costs.forest, desc: '让荒地长出森林（提供木材与采集）' },
  { id: 'fertile', name: '丰饶沃土', icon: 'fertile', group: 'create', brush: true, cost: CFG.costs.fertile, desc: '祝圣土地，使其成为肥沃的农田' },
  { id: 'meadow', name: '辽阔草原', icon: 'meadow', group: 'create', brush: true, cost: CFG.costs.meadow, desc: '把荒芜之地化作宜牧宜居的草原' },
  { id: 'water', name: '涌泉之水', icon: 'water', group: 'create', brush: true, cost: CFG.costs.water, desc: '在旱地唤出水源' },
  { id: 'ore', name: '大地之藏', icon: 'ore', group: 'create', brush: true, cost: CFG.costs.ore, desc: '在山地埋下矿脉' },
  { id: 'uplift', name: '平地起山', icon: 'uplift', group: 'create', brush: true, cost: CFG.costs.uplift, desc: '让大地隆起，化作丘陵与山岳' },
  // —— 天象 ——
  { id: 'rain', name: '唤雨', icon: 'rain', group: 'sky', brush: true, cost: CFG.costs.rain, desc: '为一片土地带来连年降雨' },
  { id: 'drought', name: '降旱', icon: 'drought', group: 'sky', brush: true, cost: CFG.costs.drought, desc: '使一片土地陷入干旱' },
  // —— 灾厄 ——
  { id: 'meteor', name: '陨星天坠', icon: 'meteor', group: 'calamity', brush: false, cost: CFG.costs.meteor, desc: '召一颗陨星轰击大地，留下焦土与深坑' },
  { id: 'storm', name: '风暴肆虐', icon: 'storm', group: 'calamity', brush: true, cost: CFG.costs.storm, desc: '在一片区域降下连年风暴，摧毁建筑与收成' },
  { id: 'wildfire', name: '燎原野火', icon: 'wildfire', group: 'calamity', brush: true, cost: CFG.costs.wildfire, desc: '点燃森林与田垄，火焰将吞噬一切可燃之物' },
  { id: 'pestilence', name: '瘟疫降临', icon: 'pestilence', group: 'calamity', brush: false, cost: CFG.costs.pestilence, desc: '向最近的聚落降下高致命疫病' },
  // —— 启蒙 ——
  { id: 'blessing', name: '丰产祝福', icon: 'blessing', group: 'guide', brush: true, cost: CFG.costs.blessing, desc: '祝福一处聚落，六年内收成大增' },
  { id: 'enlighten', name: '知识启蒙', icon: 'enlighten', group: 'guide', brush: false, cost: CFG.costs.enlighten, desc: '向文明注入灵光，加速技术与思想' },
  { id: 'ideas', name: '思想传播', icon: 'ideas', group: 'guide', brush: false, cost: CFG.costs.ideas, desc: '传播平等与组织的观念，提升参与和组织力' },
  { id: 'heal', name: '治愈之光', icon: 'heal', group: 'guide', brush: false, cost: CFG.costs.heal, desc: '涤净所有疫病，并赐予数年的康健' },
  { id: 'found', name: '奠基之柱', icon: 'found', group: 'guide', brush: false, cost: CFG.costs.found, desc: '引导一批移民在指定之地建立新聚落' },
];

export interface CastResult {
  ok: boolean;
  message: string;
  /** 实际影响的格数（反馈用） */
  tiles: number;
  settlementId?: number;
}

/** 笔刷地形神力（含目标类：陨星/瘟疫/奠基走独立分支） */
export function castBrushPower(w: WorldState, id: GodPowerId, cx: number, cy: number, radius: number): CastResult {
  const def = GOD_POWERS.find(p => p.id === id)!;
  if (!canAfford(w, def.cost)) return { ok: false, message: '神力不足，等待恢复…', tiles: 0 };
  const size = w.config.size;

  // —— 目点型神力 ——
  if (id === 'meteor') return castMeteor(w, cx, cy);
  if (id === 'pestilence') return castPestilence(w, cx, cy);
  if (id === 'found') return castFound(w, cx, cy);

  let touched = 0;
  let settlementTouched: number | undefined;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const t = w.tiles[y * size + x];
      if (t.terrain === Terrain.Mountain && id !== 'ore' && id !== 'water' && id !== 'meadow' && id !== 'uplift') continue;
      if (t.terrain === Terrain.Water && id !== 'fertile' && id !== 'forest' && id !== 'uplift') continue;
      touched++;
      switch (id) {
        case 'forest':
          if (t.terrain !== Terrain.Mountain) {
            t.terrain = Terrain.Forest;
            t.fertility = Math.max(t.fertility, 0.35);
          }
          break;
        case 'fertile':
          if (t.terrain !== Terrain.Mountain) {
            t.terrain = Terrain.Fertile;
            t.fertility = 0.85;
            t.moisture = Math.max(t.moisture, 0.55);
          }
          break;
        case 'meadow':
          t.terrain = Terrain.Grass;
          t.elevation = Math.min(t.elevation, 1);
          t.fertility = Math.max(t.fertility, 0.45);
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
        case 'uplift': {
          if (t.terrain === Terrain.Water) {
            // 填水造陆
            t.terrain = Terrain.Hills;
            t.elevation = 2;
            t.fertility = 0.2;
          } else if (t.elevation >= 3) {
            t.terrain = Terrain.Mountain;
          } else if (t.elevation >= 1) {
            t.elevation = Math.min(4, t.elevation + 2);
            t.terrain = t.elevation >= 3 ? Terrain.Mountain : Terrain.Hills;
          } else {
            t.elevation = 2;
            t.terrain = Terrain.Hills;
          }
          t.fertility = Math.min(t.fertility, 0.15);
          break;
        }
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
        case 'storm': {
          const cell = w.weather[y * size + x];
          cell.wet = Math.min(1, cell.wet + 0.6);
          cell.years = Math.max(cell.years, 4);
          // 风暴即时摧毁该区域的在建设施与部分农田
          for (const s of w.settlements) {
            if (s.dead) continue;
            if (Math.hypot(s.x - x, s.y - y) > radius + 1.5) continue;
            settlementTouched = s.id;
            const farms = s.buildings.filter(b => b.kind === 'farm');
            if (farms.length && w.rng.chance(0.3)) {
              s.buildings.splice(s.buildings.indexOf(w.rng.pick(farms)), 1);
            }
            if (s.construction.length && w.rng.chance(0.4)) s.construction.pop();
            s.food *= 0.96;
          }
          break;
        }
        case 'wildfire': {
          // 焚毁森林与农田，留下焦土（临时通过 weather 干旱表达）
          if (t.terrain === Terrain.Forest) { t.terrain = Terrain.Grass; t.fertility *= 0.6; }
          const cell = w.weather[y * size + x];
          cell.wet = Math.max(-1, cell.wet - 0.4);
          cell.years = Math.max(cell.years, 2);
          for (const s of w.settlements) {
            if (s.dead) continue;
            if (Math.hypot(s.x - x, s.y - y) > radius + 1.5) continue;
            settlementTouched = s.id;
            const farms = s.buildings.filter(b => b.kind === 'farm' && Math.hypot(b.x - x, b.y - y) <= radius + 1.5);
            for (const f of farms) if (w.rng.chance(0.7)) s.buildings.splice(s.buildings.indexOf(f), 1);
          }
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
  const names: Partial<Record<GodPowerId, string>> = {
    forest: '森林生长起来', fertile: '土地变得肥沃', meadow: '草原铺展开来', water: '清泉涌出',
    ore: '大地显露矿藏', uplift: '大地隆起，山岳拔地而起',
    rain: '甘霖落下', drought: '烈日炙烤大地',
    storm: '风暴席卷大地', wildfire: '烈焰吞噬了森林',
    blessing: '丰产的祝福降临',
  };
  return { ok: true, message: names[id] ?? '', tiles: touched, settlementId: settlementTouched };
}

/** 陨星：永久改变地形（坑洞岩石），摧毁范围内建筑与人口 */
function castMeteor(w: WorldState, cx: number, cy: number): CastResult {
  const size = w.config.size;
  const t = w.tiles[cy * size + cx];
  if (!t) return { ok: false, message: '点击在沙盘之外', tiles: 0 };
  spend(w, CFG.costs.meteor);
  w.interventions++;
  // 坑洞：中心变岩石，周围受损
  t.terrain = Terrain.Rock;
  t.fertility = 0.05;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= size || y >= size || (dx === 0 && dy === 0)) continue;
    const t2 = w.tiles[y * size + x];
    if (t2.terrain === Terrain.Forest) t2.terrain = Terrain.Grass;
    t2.fertility *= 0.5;
  }
  let dead = 0;
  let destroyed = 0;
  let sid: number | undefined;
  for (const s of w.settlements) {
    if (s.dead) continue;
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d > 3.5) continue;
    sid = s.id;
    const before = s.buildings.length;
    s.buildings = s.buildings.filter(b => Math.hypot(b.x - cx, b.y - cy) > 2.2);
    destroyed += before - s.buildings.length;
    const loss = Math.round(s.population * Math.max(0, 0.3 - d * 0.07));
    dead += loss;
    s.population -= loss;
  }
  w.chronicle.push({
    id: `ev-${w.nextEventId++}`, year: w.year, title: '神罚：陨星坠落',
    category: 'disaster',
    text: `一道白光划破天际，大地震颤。撞击点只余焦黑的巨坑，${dead > 0 ? `${dead} 人在灾难中丧生` : '幸而无人伤亡'}。`,
    causes: ['神（玩家）召来陨星'],
    effects: [...(dead ? [`${dead} 人遇难`] : []), ...(destroyed ? [`${destroyed} 处建筑被毁`] : []), '撞击点化为焦土'],
    intervened: true, severity: 0.95, settlementId: sid,
  });
  return { ok: true, message: '陨星轰然坠地', tiles: 1, settlementId: sid };
}

/** 瘟疫：对最近聚落投放高致命疫病 */
function castPestilence(w: WorldState, cx: number, cy: number): CastResult {
  let best = Infinity;
  let target = null;
  for (const s of w.settlements) {
    if (s.dead) continue;
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d < best) { best = d; target = s; }
  }
  if (!target) return { ok: false, message: '这里没有聚落', tiles: 0 };
  spend(w, CFG.costs.pestilence);
  w.interventions++;
  const lethality = 0.09;
  w.activeEvents.push({ id: 'plague-outbreak', year: w.year, yearsLeft: 4, data: { lethality, settlementId: target.id } });
  w.civ.vars.unrest = Math.min(1, w.civ.vars.unrest + 0.12);
  return { ok: true, message: `疫病在${target.name}蔓延开来`, tiles: 1, settlementId: target.id };
}

/** 奠基：从最大聚落引导移民建立新聚落 */
function castFound(w: WorldState, cx: number, cy: number): CastResult {
  const size = w.config.size;
  if (cx < 2 || cy < 2 || cx >= size - 2 || cy >= size - 2) return { ok: false, message: '离沙盘边缘太近了', tiles: 0 };
  const t = w.tiles[cy * size + cx];
  if (t.terrain === Terrain.Water) return { ok: false, message: '不能在水上奠基', tiles: 0 };
  if (t.terrain === Terrain.Mountain) return { ok: false, message: '山地无法奠基', tiles: 0 };
  for (const s of w.settlements) {
    if (!s.dead && Math.hypot(s.x - cx, s.y - cy) < 7) {
      return { ok: false, message: '离既有聚落太近（需相隔 7 格以上）', tiles: 0 };
    }
  }
  // 移民来源：人口最多的聚落
  const source = w.settlements.filter(s => !s.dead).sort((a, b) => b.population - a.population)[0];
  if (!source || source.population < 90) return { ok: false, message: '没有聚落能派出移民（需 90 人以上）', tiles: 0 };
  spend(w, CFG.costs.found);
  w.interventions++;
  const ns = spawnSplinter(w, source, 16, { x: cx, y: cy });
  if (!ns) return { ok: false, message: '奠基失败', tiles: 0 };
  ns.effects.push({ kind: 'blessing', years: 3, power: 0.2 });
  return { ok: true, message: `移民们在新土地建立了 ${ns.name}`, tiles: 1, settlementId: ns.id };
}

/** 文明级神力（启蒙/思想/治愈） */
export function castCivPower(w: WorldState, id: 'enlighten' | 'ideas' | 'heal'): CastResult {
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
  } else if (id === 'ideas') {
    w.civ.enlightenment = Math.min(1.2, w.civ.enlightenment + 0.25);
    const v = w.civ.vars;
    v.participation = Math.min(1, v.participation + 0.08);
    v.orgCommon = Math.min(1, v.orgCommon + 0.07);
    const g = w.civ.groups.find(x => x.id === 'commoners')!;
    g.ideas = Math.min(1, g.ideas + 0.25);
    return { ok: true, message: '平等与组织的观念开始流传', tiles: 1 };
  } else {
    // 治愈之光：清除全部疫病 + 数年康健
    const plagues = w.activeEvents.filter(ae => ae.id === 'plague-outbreak');
    for (const p of plagues) w.activeEvents.splice(w.activeEvents.indexOf(p), 1);
    for (const s of w.settlements) {
      if (!s.dead) s.effects.push({ kind: 'healing', years: 4, power: 0.3 });
    }
    w.civ.vars.trust = Math.min(1, w.civ.vars.trust + 0.06);
    return { ok: true, message: plagues.length ? '神光涤净了大地上的疫病' : '康健之光笼罩了大地', tiles: plagues.length || 1 };
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
    category: (id === 'enlighten' || id === 'ideas' || id === 'heal' ? 'ideas'
      : id === 'drought' || id === 'rain' ? 'disaster'
        : def.group === 'calamity' ? 'disaster' : 'harvest') as any,
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
