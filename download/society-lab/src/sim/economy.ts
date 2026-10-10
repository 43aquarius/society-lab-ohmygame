/**
 * EconomySystem — 生产、消费、资源与聚落营造
 * 生产受劳动、土地肥力、工具、技术、天气与神力祝福共同约束；
 * 分配（收入→财富）见 institutions.ts；这里只做产出与消耗的物理结算。
 */
import { CFG, BUILDINGS, STAGE_THRESHOLDS } from '../config';
import { Terrain, BuildingKind, type WorldState, type Settlement, type Building } from '../types';
import { housingCapacity } from './population';

export interface SettlementEconomy {
  foodProduced: number;
  foodNeeded: number;
  foodRatio: number;
  famine: number;
  woodGained: number;
  stoneGained: number;
  metalGained: number;
}

/** 聚落周边地形统计（领地内） */
function survey(s: Settlement, w: WorldState) {
  const size = w.config.size;
  let forest = 0, rock = 0, ore = 0, fertile = 0, hill = 0, fertilitySum = 0, count = 0, water = 0;
  const r = s.radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = s.x + dx, y = s.y + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const t = w.tiles[y * size + x];
      count++;
      if (t.terrain === Terrain.Forest) forest++;
      else if (t.terrain === Terrain.Rock) rock++;
      else if (t.terrain === Terrain.Hills) hill++;
      else if (t.terrain === Terrain.Water) water++;
      if (t.terrain === Terrain.Fertile) fertile++;
      if (t.ore) ore++;
      fertilitySum += t.fertility;
    }
  }
  return { forest, rock, hill, ore, fertile, water, fertility: count ? fertilitySum / count : 0.2, tiles: Math.max(1, count) };
}

function weatherMult(w: WorldState, s: Settlement): number {
  const size = w.config.size;
  let sum = 0, n = 0;
  for (let dy = -3; dy <= 3; dy += 2) for (let dx = -3; dx <= 3; dx += 2) {
    const x = s.x + dx, y = s.y + dy;
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    sum += w.weather[y * size + x].wet;
    n++;
  }
  return 1 + (n ? sum / n : 0) * 0.5;
}

function blessingMult(s: Settlement): number {
  let m = 1;
  for (const e of s.effects) if (e.kind === 'blessing') m += e.power;
  return m;
}

/** 年度生产与消费结算（单聚落） */
export function tickSettlementEconomy(w: WorldState, s: Settlement): SettlementEconomy {
  const v = w.civ.vars;
  const t = w.civ.tech.levels;
  const env = survey(s, w);
  const pop = Math.max(0, s.population);

  // 劳动供给
  const labor = pop * (0.52 + Math.min(0.2, v.specialization * 0.25));
  const toolMult = 1 + (t.crafting ?? 1) * 0.07;
  const wm = weatherMult(w, s) * blessingMult(s);
  const wlm = Math.min(1.35, wm * (t.agriculture >= 5 ? 1.12 : 1));

  const farms = s.buildings.filter(b => b.kind === BuildingKind.Farm && b.progress >= 1).length;
  const farmLaborCap = farms * 3;
  const farmLabor = Math.min(labor * 0.72, farmLaborCap);
  const forageLabor = Math.max(0, labor * 0.85 - farmLabor);

  // 农业：劳动 × 肥力 × 技术
  const agriMult = 1 + (t.agriculture ?? 1) * 0.2;
  const farmOutput = farmLabor * CFG.farmPerLabor * (0.4 + env.fertility * 1.0) * agriMult * wlm;
  // 采集狩猎：依赖森林与水体丰度；人口压力造成资源枯竭（马尔萨斯约束）
  // v2.0：承载力随地图规模扩展
  const totalPop = w.settlements.reduce((a, x) => a + (x.dead ? 0 : x.population), 0);
  const carrying = 1150 * Math.pow(w.config.size / 48, 1.5);
  const depletion = Math.max(0.35, 1 - totalPop / carrying);
  const wildRichness = (0.72 + Math.min(0.42, (env.forest + env.water * 2) / env.tiles)) * depletion;
  const forageOutput = forageLabor * CFG.foragePerLabor * wildRichness * wm * (1 + (t.agriculture ?? 1) * 0.06);

  const foodProduced = farmOutput + forageOutput;
  const foodNeeded = pop * CFG.foodPerCapita * (0.92 + v.livingStandard * 0.22);

  // 消耗与库存（受粮仓储量约束，超出部分腐坏流失）
  s.food += foodProduced - foodNeeded;
  const granaries = s.buildings.filter(b => b.kind === BuildingKind.Granary && b.progress >= 1).length;
  const storageCap = 40 + granaries * CFG.granaryCapacity;
  const spoil = Math.max(0, s.food) * CFG.spoilage + Math.max(0, s.food - storageCap) * 0.35;
  s.food -= spoil;
  let famine = 0;
  if (s.food < 0) {
    famine = Math.min(1, -s.food / Math.max(1, foodNeeded));
    s.food = 0;
  }
  const foodRatio = foodNeeded <= 0 ? 1 : (s.food + foodProduced) / foodNeeded;

  // 采伐掘取：木材/石/金属（金属需要冶炼技术）
  // v2.0：石料是时代建筑的门槛资源，产出显著上调（否则神庙/城墙永远盖不起来）
  // 木材提供基础流（草原拾柴），避免无林之地陷入死局
  const gatherCap = labor * 0.14 * toolMult;
  const woodGained = Math.min(gatherCap, Math.max(pop * 0.05, env.forest * 0.34) * toolMult);
  const stoneGained = Math.min(gatherCap, (env.rock * 0.38 + env.fertile * 0.1 + env.hill * 0.06 + 0.15) * toolMult);
  const metalGained = (t.crafting ?? 1) >= 2 ? Math.min(gatherCap * 0.4, env.ore * 0.13 * toolMult) : 0;
  s.wood = Math.max(0, s.wood + woodGained - pop * 0.035);
  s.stone = Math.max(0, s.stone + stoneGained - pop * 0.006);
  s.metal = Math.max(0, s.metal + metalGained - pop * 0.003);

  // 祝福/天气效果计时
  s.effects = s.effects.filter(e => (e.years--) > 0);

  // 营造
  constructionAI(w, s, env);
  // 领地扩张（v2.0：半径增长放缓——土地不会随人口无限外溢，逼近的边界孕育冲突）
  s.radius = Math.max(3, Math.round(2 + Math.sqrt(pop) * 0.24));
  claimTiles(w, s);

  return { foodProduced, foodNeeded, foodRatio, famine, woodGained, stoneGained, metalGained };
}

/**
 * 需求驱动的建造决策：按优先级申请建筑。
 * v2.0：住宅类型随聚落阶段升级（窝棚→农舍→街屋），城镇会逐步改建旧居所，
 * 并按技术/制度阶段兴建时代建筑（神庙/庄园/城堡/学堂/银行/剧场/医院）。
 */
function constructionAI(w: WorldState, s: Settlement, env: ReturnType<typeof survey>) {
  if (s.population < 8 || s.construction.length >= 2) return;
  const t = w.civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const v = w.civ.vars;
  const houses = housingCapacity(s);
  const farms = s.buildings.filter(b => b.kind === BuildingKind.Farm).length;
  const granaries = s.buildings.filter(b => b.kind === BuildingKind.Granary).length;
  const pop = s.population;
  const granaryCap = granaries * CFG.granaryCapacity + 40;
  const agriReady = lvl('agriculture') >= 2;

  type Want = { kind: BuildingKind; urgency: number } | null;
  const wantRef: { v: Want } = { v: null };
  const push = (kind: BuildingKind, urgency: number) => {
    if (!wantRef.v || urgency > wantRef.v.urgency) wantRef.v = { kind, urgency };
  };

  if (agriReady && farms < Math.ceil(pop / CFG.farmPerFamily) && farms < env.fertile + 4) push(BuildingKind.Farm, 3 + (s.shortageYears > 0 ? 4 : 0));

  // 住宅：类型随聚落阶段与技术演进（营地窝棚 → 村落农舍 → 城镇街屋）
  if (houses < pop * CFG.buildHousingTrigger) {
    const kind =
      (s.stage === 'town' || s.stage === 'city') && lvl('building') >= 4 ? BuildingKind.Townhouse
        : s.stage === 'camp' ? BuildingKind.Shelter
          : BuildingKind.House;
    push(kind, 4 + (houses < pop * 0.7 ? 3 : 0));
  }
  // 城镇改建：窝棚被更体面的住宅逐步取代（先确认资源再拆旧屋）
  if (s.stage !== 'camp' && s.stage !== 'hamlet' && lvl('agriculture') >= 3 && w.rng.chance(0.10)) {
    const upgrade = lvl('building') >= 4 && s.stage !== 'village' ? BuildingKind.Townhouse : BuildingKind.House;
    const def = BUILDINGS[upgrade];
    const shabby = s.buildings.find(b => b.kind === BuildingKind.Shelter);
    if (shabby && !s.construction.length && s.wood >= def.wood * 0.6 && s.stone >= def.stone * 0.6) {
      s.buildings.splice(s.buildings.indexOf(shabby), 1);
      push(upgrade, 2.2);
    }
  }
  if (s.food > granaryCap * 0.85 && pop > 60) push(BuildingKind.Granary, 2.5);
  if (pop > 90 && !s.buildings.some(b => b.kind === BuildingKind.Well) && lvl('building') >= 1) push(BuildingKind.Well, 2.2);

  // —— 时代建筑（社会的物质形态随技术/制度出现）——
  if (pop > 150 && lvl('governance') >= 2 && lvl('agriculture') >= 4 && !s.buildings.some(b => b.kind === BuildingKind.Temple)) push(BuildingKind.Temple, 2.6);
  if (pop > 130 && lvl('crafting') >= 3 && !s.buildings.some(b => b.kind === BuildingKind.Workshop)) push(BuildingKind.Workshop, 2.4);
  if (pop > 160 && lvl('commerce') >= 1 && !s.buildings.some(b => b.kind === BuildingKind.Market)) push(BuildingKind.Market, 2.4);
  if (pop > 240 && lvl('governance') >= 1 && !s.buildings.some(b => b.kind === BuildingKind.Admin)) push(BuildingKind.Admin, 2.8);
  // 庄园：土地开始集中、农业成熟的象征（封建的物质载体；不依赖既有土地集中，打破鸡生蛋）
  if (pop > 260 && lvl('agriculture') >= 5 && (v.landConcentration > 0.18 || v.ownPrivate > 0.25) && s.buildings.filter(b => b.kind === BuildingKind.Manor).length < 2) push(BuildingKind.Manor, 2.5);
  // 城堡：城镇规模的防御中枢
  if (pop > 350 && lvl('building') >= 4 && !s.buildings.some(b => b.kind === BuildingKind.Castle)) push(BuildingKind.Castle, 2.3);
  if (pop > 300 && lvl('building') >= 2 && !s.buildings.some(b => b.kind === BuildingKind.Wall)) push(BuildingKind.Wall, 2.0);
  // 学堂：文教兴起
  if (pop > 280 && lvl('education') >= 3 && !s.buildings.some(b => b.kind === BuildingKind.Academy)) push(BuildingKind.Academy, 2.3);
  // 工厂：工业时代
  if (pop > 380 && lvl('industry') >= 1 && s.buildings.filter(b => b.kind === BuildingKind.Factory).length < 3) push(BuildingKind.Factory, 2.7);
  // 银行/剧场：市场社会的中枢与市民生活
  if (pop > 420 && lvl('commerce') >= 4 && v.market > 0.4 && !s.buildings.some(b => b.kind === BuildingKind.Bank)) push(BuildingKind.Bank, 2.4);
  if (pop > 450 && lvl('commerce') >= 3 && v.livingStandard > 0.4 && !s.buildings.some(b => b.kind === BuildingKind.Theater)) push(BuildingKind.Theater, 1.9);
  // 医院/合作社/公共堂：现代公共部门
  if (pop > 400 && lvl('medicine') >= 5 && !s.buildings.some(b => b.kind === BuildingKind.Hospital)) push(BuildingKind.Hospital, 2.2);
  if (lvl('education') >= 2 && s.buildings.filter(b => b.kind === BuildingKind.Cooperative).length < 2 && pop > 200) push(BuildingKind.Cooperative, 1.8);
  if (lvl('governance') >= 3 && pop > 420 && s.buildings.filter(b => b.kind === BuildingKind.Services).length < 2) push(BuildingKind.Services, 1.9);

  const want = wantRef.v;
  if (!want) return;
  const def = BUILDINGS[want.kind];
  // 建造前置：时代与技术
  if (def.era > 0 && lvl('agriculture') < 2) return;
  if (def.tech && lvl(def.tech[0]) < def.tech[1]) return;
  // 资源检查（宽松：不足时允许预付一半开工，慢慢补）
  if (s.wood < def.wood * 0.5 || s.stone < def.stone * 0.5) return;

  const spot = findBuildSpot(w, s, want.kind);
  if (!spot) return;
  s.wood = Math.max(0, s.wood - def.wood);
  s.stone = Math.max(0, s.stone - def.stone);
  s.metal = Math.max(0, s.metal - def.metal);
  s.construction.push({
    id: w.nextBuildingId++, kind: want.kind, x: spot.x, y: spot.y,
    builtYear: w.year, progress: 0,
  });
}

/** 建造推进：每年按劳动力推进进度 */
export function advanceConstruction(w: WorldState, s: Settlement) {
  const toolMult = 1 + (w.civ.tech.levels.crafting ?? 1) * 0.1;
  const laborAvail = s.population * 0.06 * toolMult;
  const perProject = s.construction.length ? laborAvail / s.construction.length : 0;
  const done: Building[] = [];
  for (const b of s.construction) {
    const def = BUILDINGS[b.kind];
    const need = Math.max(0.35, def.work);
    b.progress += Math.min(1 / need, perProject / need);
    if (b.progress >= 1) done.push(b);
  }
  for (const b of done) {
    s.construction.splice(s.construction.indexOf(b), 1);
    b.progress = 1;
    s.buildings.push(b);
    // 阶段变迁统一由 manager 的年度检测处理（含改名与事件）
  }
}

/** 找空地：靠近中心、可建、不与其他建筑重叠 */
function findBuildSpot(w: WorldState, s: Settlement, kind: BuildingKind): { x: number; y: number } | null {
  const size = w.config.size;
  const occupied = new Set<number>();
  for (const b of [...s.buildings, ...s.construction]) occupied.add(b.y * size + b.x);
  const spiral: { x: number; y: number; d: number }[] = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const d = Math.abs(dx) + Math.abs(dy);
    if (d === 0 || d > 6) continue;
    spiral.push({ x: s.x + dx, y: s.y + dy, d });
  }
  spiral.sort((a, b) => a.d - b.d);
  const isFarm = kind === BuildingKind.Farm;
  for (const p of spiral) {
    if (p.x < 1 || p.y < 1 || p.x >= size - 1 || p.y >= size - 1) continue;
    const t = w.tiles[p.y * size + p.x];
    if (occupied.has(p.y * size + p.x)) continue;
    if (isFarm) {
      if (t.terrain === Terrain.Fertile || t.terrain === Terrain.Grass) return p;
    } else {
      if (t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain && t.terrain !== Terrain.Rock) return p;
    }
  }
  return null;
}

function claimTiles(w: WorldState, s: Settlement) {
  const size = w.config.size;
  const r = Math.min(4, s.radius);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = s.x + dx, y = s.y + dy;
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    const t = w.tiles[y * size + x];
    if (t.owner === -1) t.owner = s.id;
  }
}

/** 宏观经济汇总（供 institutions 消费） */
export function macroEconomy(w: WorldState) {
  let pop = 0, food = 0, produced = 0, needed = 0, urban = 0, housing = 0;
  const alive = w.settlements.filter(s => !s.dead);
  for (const s of alive) {
    pop += s.population;
    food += s.food;
    produced += estimateFoodOutput(w, s);
    needed += s.population * (0.92 + w.civ.vars.livingStandard * 0.22);
    housing += housingCapacity(s);
    if (s.population >= 400) urban += s.population;
    else if (s.population >= 150) urban += s.population * 0.6;
  }
  const surplus = produced > 0 ? produced / Math.max(1, needed) : 0;
  return {
    population: pop,
    foodStock: food,
    foodProduction: produced,
    foodNeeded: needed,
    foodRatio: needed > 0 ? (food + produced) / needed : 1,
    surplusRatio: surplus,
    urbanization: pop > 0 ? urban / pop : 0,
    housingRatio: pop > 0 ? housing / pop : 0,
    settlementCount: alive.length,
  };
}

/** 复算某聚落当年粮食产出（事件/预警用，与 tickSettlementEconomy 同公式） */
export function estimateFoodOutput(w: WorldState, s: Settlement): number {
  const t = w.civ.tech.levels;
  const env = survey(s, w);
  const v = w.civ.vars;
  const labor = Math.max(0, s.population) * (0.52 + Math.min(0.2, v.specialization * 0.25));
  const farms = s.buildings.filter(b => b.kind === BuildingKind.Farm && b.progress >= 1).length;
  const farmLabor = Math.min(labor * 0.72, farms * 3);
  const forageLabor = Math.max(0, labor * 0.85 - farmLabor);
  const wm = weatherMult(w, s) * blessingMult(s);
  const agriMult = 1 + (t.agriculture ?? 1) * 0.2;
  const totalPop = w.settlements.reduce((a, x) => a + (x.dead ? 0 : x.population), 0);
  const carrying = 1150 * Math.pow(w.config.size / 48, 1.5);
  const depletion = Math.max(0.35, 1 - totalPop / carrying);
  const wildRichness = (0.72 + Math.min(0.42, (env.forest + env.water * 2) / env.tiles)) * depletion;
  return farmLabor * CFG.farmPerLabor * (0.4 + env.fertility * 1.0) * agriMult * wm
    + forageLabor * CFG.foragePerLabor * wildRichness * wm * (1 + (t.agriculture ?? 1) * 0.06);
}
