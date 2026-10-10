/**
 * EconomySystem v4.0 — 生产、消费、资源与聚落营造
 * - 地形读取走分块流式 API（tileAt），支持超大地图；
 * - 建造布局真实化：非农田建筑彼此间距 ≥2、农田集中在聚落外围带，
 *   道路把建筑与中心广场连成真实的街巷肌理；
 * - 模拟按文明（civ）隔离：每个文明用自己的技术与制度变量。
 */
import { CFG, BUILDINGS, STAGE_THRESHOLDS } from '../config';
import { Terrain, BuildingKind, type WorldState, type Settlement, type Building, type Civilization } from '../types';
import { tileAt } from '../worldgen';
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

export function civOf(w: WorldState, civId: number): Civilization {
  return w.civs[civId] ?? w.civs[0];
}

/** 聚落周边地形统计（领地内；分块流式读取） */
function survey(s: Settlement, w: WorldState) {
  let forest = 0, rock = 0, ore = 0, fertile = 0, hill = 0, fertilitySum = 0, count = 0, water = 0;
  const r = s.radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const t = tileAt(w, s.x + dx, s.y + dy);
      if (!t) continue;
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
  let sum = 0, n = 0;
  for (let dy = -3; dy <= 3; dy += 2) for (let dx = -3; dx <= 3; dx += 2) {
    const cell = w.weather.get((s.y + dy) * w.gen.size + (s.x + dx));
    if (cell) { sum += cell.wet; }
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
  const civ = civOf(w, s.civId);
  const v = civ.vars;
  const t = civ.tech.levels;
  const env = survey(s, w);
  const pop = Math.max(0, s.population);

  // 劳动供给
  const labor = pop * (0.52 + Math.min(0.2, v.specialization * 0.25));
  const toolMult = 1 + (t.crafting ?? 1) * 0.07;
  const wm = weatherMult(w, s) * blessingMult(s);
  const wlm = Math.min(1.35, wm * (t.agriculture >= 5 ? 1.12 : 1));

  const farms = s.buildings.filter(b => b.kind === BuildingKind.Farm && b.progress >= 1).length;
  const farmLaborCap = farms * 2.2;
  const farmLabor = Math.min(labor * 0.72, farmLaborCap);
  const forageLabor = Math.max(0, labor * 0.85 - farmLabor);

  // 农业：劳动 × 肥力 × 技术
  const agriMult = 1 + (t.agriculture ?? 1) * 0.2;
  const farmOutput = farmLabor * CFG.farmPerLabor * (0.4 + env.fertility * 1.0) * agriMult * wlm;
  // 采集狩猎：依赖森林与水体丰度；人口压力造成资源枯竭（马尔萨斯约束）
  // v4.0：承载力随超大地图显著扩展（但按文明活动的实际范围计）
  const totalPop = w.settlements.reduce((a, x) => a + (x.dead ? 0 : x.population), 0);
  const carrying = 2600 * Math.pow(w.gen.size / 96, 1.35);
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
  constructionAI(w, s, env, civ);
  // 领地扩张（v4.0：大半径 + 建筑间距让聚落有真实的空间感）
  s.radius = Math.max(3, Math.round(2.5 + Math.sqrt(pop) * 0.42));
  claimTiles(w, s);

  return { foodProduced, foodNeeded, foodRatio, famine, woodGained, stoneGained, metalGained };
}

/**
 * 需求驱动的建造决策：按优先级申请建筑。
 * v4.0 真实密度：住宅彼此留出间距、沿道路生长；农田集中在外围耕作带。
 */
function constructionAI(w: WorldState, s: Settlement, env: ReturnType<typeof survey>, civ: Civilization) {
  if (s.population < 8 || s.construction.length >= 2) return;
  const t = civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const v = civ.vars;
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

  if (agriReady && farms < Math.ceil(pop / CFG.farmPerFamily) && farms < env.fertile + 6) push(BuildingKind.Farm, 3 + (s.shortageYears > 0 ? 4 : 0));

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

  // —— 时代建筑（社会的物质形态随技术/制度出现；每类限量防拥挤）——
  const count = (k: BuildingKind) => s.buildings.filter(b => b.kind === k).length;
  if (pop > 150 && lvl('governance') >= 2 && lvl('agriculture') >= 4 && count(BuildingKind.Temple) < 1) push(BuildingKind.Temple, 2.6);
  if (pop > 130 && lvl('crafting') >= 3 && count(BuildingKind.Workshop) < 2) push(BuildingKind.Workshop, 2.4);
  if (pop > 160 && lvl('commerce') >= 1 && count(BuildingKind.Market) < 2) push(BuildingKind.Market, 2.4);
  if (pop > 240 && lvl('governance') >= 1 && count(BuildingKind.Admin) < 1) push(BuildingKind.Admin, 2.8);
  // 庄园：土地开始集中、农业成熟的象征（封建的物质载体）
  if (pop > 260 && lvl('agriculture') >= 5 && (v.landConcentration > 0.18 || v.ownPrivate > 0.25) && count(BuildingKind.Manor) < 2) push(BuildingKind.Manor, 2.5);
  // 城堡：城镇规模的防御中枢
  if (pop > 350 && lvl('building') >= 4 && count(BuildingKind.Castle) < 1) push(BuildingKind.Castle, 2.3);
  if (pop > 300 && lvl('building') >= 2 && count(BuildingKind.Wall) < 1) push(BuildingKind.Wall, 2.0);
  // 学堂：文教兴起
  if (pop > 280 && lvl('education') >= 3 && count(BuildingKind.Academy) < 1) push(BuildingKind.Academy, 2.3);
  // 工厂：工业时代
  if (pop > 380 && lvl('industry') >= 1 && count(BuildingKind.Factory) < 3) push(BuildingKind.Factory, 2.7);
  // 银行/剧场：市场社会的中枢与市民生活
  if (pop > 420 && lvl('commerce') >= 4 && v.market > 0.4 && count(BuildingKind.Bank) < 1) push(BuildingKind.Bank, 2.4);
  if (pop > 450 && lvl('commerce') >= 3 && v.livingStandard > 0.4 && count(BuildingKind.Theater) < 1) push(BuildingKind.Theater, 1.9);
  // 医院/合作社/公共堂：现代公共部门
  if (pop > 400 && lvl('medicine') >= 5 && count(BuildingKind.Hospital) < 1) push(BuildingKind.Hospital, 2.2);
  if (lvl('education') >= 2 && count(BuildingKind.Cooperative) < 2 && pop > 200) push(BuildingKind.Cooperative, 1.8);
  if (lvl('governance') >= 3 && pop > 420 && count(BuildingKind.Services) < 2) push(BuildingKind.Services, 1.9);

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
  // 施工即铺设土路（通往中心）
  addRoad(w, s, spot.x, spot.y, s.x, s.y);
}

/** 建造推进：每年按劳动力推进进度 */
export function advanceConstruction(w: WorldState, s: Settlement) {
  const civ = civOf(w, s.civId);
  const toolMult = 1 + (civ.tech.levels.crafting ?? 1) * 0.1;
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
  }
}

/** 从 (x1,y1) 到 (x2,y2) 铺一条土路（跳过水面与山地） */
export function addRoad(w: WorldState, s: Settlement, x1: number, y1: number, x2: number, y2: number): void {
  const size = w.gen.size;
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  if (steps <= 0) return;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    const tile = tileAt(w, x, y);
    if (!tile || tile.terrain === Terrain.Water || tile.terrain === Terrain.Mountain) continue;
    s.roads.add(y * size + x);
  }
  // 控制道路总量（性能与视觉密度）
  if (s.roads.size > 900) {
    const arr = [...s.roads];
    for (let i = 0; i < 200; i++) s.roads.delete(arr[i]);
  }
}

/**
 * 找空地（真实密度）：
 * - 农田：外围耕作带（farmRingInner..radius+6），优先成片（紧邻既有农田）；
 * - 其他建筑：与既有建筑间距 ≥ buildingGap，优先靠近道路与中心。
 */
function findBuildSpot(w: WorldState, s: Settlement, kind: BuildingKind): { x: number; y: number } | null {
  const size = w.gen.size;
  const isFarm = kind === BuildingKind.Farm;
  const gap = CFG.layout.buildingGap;

  if (isFarm) {
    // 农田：环形耕作带，紧邻既有农田可成片（真实的田块肌理）
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 90; attempt++) {
      const ang = w.rng.next() * Math.PI * 2;
      const ring = CFG.layout.farmRingInner + w.rng.next() * Math.min(s.radius + 6, 14);
      const x = Math.round(s.x + Math.cos(ang) * ring);
      const y = Math.round(s.y + Math.sin(ang) * ring);
      if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
      const t = tileAt(w, x, y);
      if (!t || (t.terrain !== Terrain.Fertile && t.terrain !== Terrain.Grass)) continue;
      // 不压建筑
      let occupied = false;
      for (const b of [...s.buildings, ...s.construction]) {
        if (Math.abs(b.x - x) + Math.abs(b.y - y) <= 1) { occupied = true; break; }
      }
      if (occupied) continue;
      // 评分：紧邻既有农田加分（成片）+ 肥力
      let adjFarm = 0;
      for (const b of s.buildings) {
        if (b.kind === BuildingKind.Farm && Math.abs(b.x - x) + Math.abs(b.y - y) === 1) adjFarm++;
      }
      const score = adjFarm * 0.5 + t.fertility + w.rng.next() * 0.3;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    return best;
  }

  // 非农田：螺旋搜索，间距 ≥ gap，近道路加分
  const occupied = new Set<number>();
  for (const b of [...s.buildings, ...s.construction]) occupied.add(b.y * size + b.x);
  const big = kind === BuildingKind.Castle || kind === BuildingKind.Temple || kind === BuildingKind.Manor;
  const bigList: BuildingKind[] = [BuildingKind.Castle, BuildingKind.Temple, BuildingKind.Manor, BuildingKind.Admin];

  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  const R = Math.min(11, 3 + Math.round(Math.sqrt(s.population) * 0.3));
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.abs(dx) + Math.abs(dy);
    if (d === 0 || d > R) continue;
    const x = s.x + dx, y = s.y + dy;
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
    const t = tileAt(w, x, y);
    if (!t || t.terrain === Terrain.Water || t.terrain === Terrain.Mountain || t.terrain === Terrain.Rock) continue;
    if (t.elevation > 3) continue;
    // 与所有既有建筑保持间距
    let minGap = 99;
    for (const b of [...s.buildings, ...s.construction]) {
      const g = Math.abs(b.x - x) + Math.abs(b.y - y);
      if (g < minGap) minGap = g;
    }
    if (minGap < gap) continue;
    // 大型建筑周边留出庭院
    if (big) {
      let clash = false;
      for (const b of s.buildings) {
        if (bigList.includes(b.kind) && Math.abs(b.x - x) + Math.abs(b.y - y) < 4) { clash = true; break; }
      }
      if (clash) continue;
    }
    // 评分：靠中心 + 靠道路 + 轻微随机
    let nearRoad = 0;
    for (let rj = -1; rj <= 1; rj++) for (let ri = -1; ri <= 1; ri++) {
      if (s.roads.has((y + rj) * size + (x + ri))) nearRoad = 1;
    }
    const score = -d * 0.28 + nearRoad * 1.2 + (t.elevation <= 1 ? 0.2 : 0) + w.rng.next() * 0.5;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

function claimTiles(w: WorldState, s: Settlement) {
  const r = Math.min(6, s.radius);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = tileAt(w, s.x + dx, s.y + dy);
    if (t && t.owner === -1) t.owner = s.id;
  }
}

/** 宏观经济汇总（按文明；供 institutions 消费） */
export function macroEconomy(w: WorldState, civ: Civilization) {
  let pop = 0, food = 0, produced = 0, needed = 0, urban = 0, housing = 0;
  const alive = w.settlements.filter(s => !s.dead && s.civId === civ.id);
  for (const s of alive) {
    pop += s.population;
    food += s.food;
    produced += estimateFoodOutput(w, s);
    needed += s.population * (0.92 + civ.vars.livingStandard * 0.22);
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
  const civ = civOf(w, s.civId);
  const t = civ.tech.levels;
  const env = survey(s, w);
  const v = civ.vars;
  const labor = Math.max(0, s.population) * (0.52 + Math.min(0.2, v.specialization * 0.25));
  const farms = s.buildings.filter(b => b.kind === BuildingKind.Farm && b.progress >= 1).length;
  const farmLabor = Math.min(labor * 0.72, farms * 2.2);
  const forageLabor = Math.max(0, labor * 0.85 - farmLabor);
  const wm = weatherMult(w, s) * blessingMult(s);
  const agriMult = 1 + (t.agriculture ?? 1) * 0.2;
  const totalPop = w.settlements.reduce((a, x) => a + (x.dead ? 0 : x.population), 0);
  const carrying = 2600 * Math.pow(w.gen.size / 96, 1.35);
  const depletion = Math.max(0.35, 1 - totalPop / carrying);
  const wildRichness = (0.72 + Math.min(0.42, (env.forest + env.water * 2) / env.tiles)) * depletion;
  return farmLabor * CFG.farmPerLabor * (0.4 + env.fertility * 1.0) * agriMult * wm
    + forageLabor * CFG.foragePerLabor * wildRichness * wm * (1 + (t.agriculture ?? 1) * 0.06);
}
