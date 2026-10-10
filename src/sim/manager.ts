/**
 * SimulationManager v4.0 — 时间推进与年度模拟的总编排（多文明版）
 *
 * 每年：天气衰减 → [按文明] 技术(+扩散) → 生产/人口 → 建造 → 制度 →
 * 形态识别（马义判定书，带回滞） → 冲突 → 事件 →
 * [世界] 文明接触检测 → 文明生死 → 编年史 → 快照 → 神力恢复。
 */
import { CFG, STAGE_THRESHOLDS } from '../config';
import { Rng, type WorldState, type EventRecord, type SettlementStage, type Civilization } from '../types';
import { createGen, findStarts, tileAt } from '../worldgen';
import { settlementName, renameForStage, WORLD_TITLES, CIV_COLORS } from '../names';
import { tickTechnology, diffuseTechnology } from './technology';
import { tickSettlementEconomy, advanceConstruction, macroEconomy } from './economy';
import { tickPopulation, createCiv } from './population';
import { tickInstitutions } from './institutions';
import { classifySociety, transitionStory } from './society';
import { evaluateConflict } from './conflict';
import { dispatchEvents, freshCtx } from './events';
import { BuildingKind } from '../types';

export interface TickReport {
  year: number;
  events: EventRecord[];
  /** v4.0：形态发生变迁的文明（UI 弹卡用） */
  formChangedCivs: number[];
  famine: boolean;
  deaths: number;
  births: number;
}

function freshCiv(id: number, name: string, culture: number, year: number): Civilization {
  return {
    id, name, color: CIV_COLORS[id % CIV_COLORS.length], culture,
    form: 'primitive', formSince: year, prevForm: null,
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
    met: [], dead: false, founded: year, history: [],
  };
}

/** 从配置新建世界（含初始文明与聚落） */
export function newWorld(config: {
  seed: number; size: number; mode: 'free' | 'limited'; settlements?: number; scenario?: 'dawn' | 'valley';
}): WorldState {
  const gen = createGen(config.seed, config.size);
  const civCount = Math.max(1, Math.min(config.settlements ?? 1, 4));
  const w: WorldState = {
    config: {
      seed: config.seed, size: config.size, mode: config.mode,
      settlements: civCount, scenario: config.scenario ?? 'dawn',
    },
    year: 0,
    chunks: new Map(),
    weather: new Map(),
    settlements: [],
    civs: [],
    chronicle: [],
    activeEvents: [],
    interventions: 0,
    divine: config.mode === 'free' ? 999 : CFG.divineMax,
    divineMax: config.mode === 'free' ? 999 : CFG.divineMax,
    rng: new Rng(config.seed ^ 0x2f6e2b1),
    nextBuildingId: 1,
    nextEventId: 1,
    snapshots: [],
    decals: [],
    gen,
    observedCiv: 0,
    civIndex: new Map(),
  };

  // —— 初始文明（各自独立的摇篮与命运）——
  const starts = findStarts(w, civCount, w.rng);
  const usedCivNames = new Set<string>();
  for (let i = 0; i < civCount; i++) {
    const civ = freshCiv(i, '', w.rng.int(4), 0);
    // 文明名
    for (let t = 0; t < 60; t++) {
      const candidate = `${['河', '岳', '松', '漠', '金', '泽', '云', '苍', '雷', '陶', '雪', '岚', '旭', '粟', '越'][w.rng.int(15)]}${['原', '川', '谷', '野', '山', '林', '泽', '原'][w.rng.int(8)]}文明`;
      if (!usedCivNames.has(candidate)) { usedCivNames.add(candidate); civ.name = candidate; break; }
    }
    if (!civ.name) { civ.name = `文明${i + 1}`; usedCivNames.add(civ.name); }
    w.civs.push(civ);
  }

  // —— 初始聚落 ——
  const startPop = config.scenario === 'valley' ? 70 : 42;
  const usedNames = new Set<string>();
  starts.forEach((p, i) => {
    const civ = w.civs[i % w.civs.length];
    const size = config.size;
    w.settlements.push({
      id: w.settlements.length,
      name: settlementName(w.rng, 'camp', usedNames),
      x: p.x, y: p.y,
      civId: civ.id,
      stage: 'camp', population: startPop,
      buildings: [], construction: [],
      food: startPop * 1.8, wood: 14, stone: 2, metal: 0,
      radius: 3, shortageYears: 0, founded: 0,
      effects: [], dead: false, lastFamine: -999,
      roads: new Set<number>([p.y * size + p.x]),
    });
    const t = tileAt(w, p.x, p.y);
    if (t) t.owner = w.settlements.length - 1;
  });

  // 河谷情景：预设农业知识
  if (config.scenario === 'valley') {
    for (const civ of w.civs) {
      civ.tech.levels.agriculture = 2;
      civ.tech.progress.agriculture = 12;
    }
    for (const s of w.settlements) {
      s.buildings.push({ id: w.nextBuildingId++, kind: BuildingKind.Farm, x: s.x, y: s.y + 1, builtYear: 0, progress: 1 });
      s.buildings.push({ id: w.nextBuildingId++, kind: BuildingKind.Shelter, x: s.x + 1, y: s.y, builtYear: 0, progress: 1 });
      s.roads.add((s.y + 1) * config.size + s.x);
      s.roads.add(s.y * config.size + s.x + 1);
    }
  } else {
    for (const s of w.settlements) {
      s.buildings.push({ id: w.nextBuildingId++, kind: BuildingKind.Camp, x: s.x, y: s.y, builtYear: 0, progress: 1 });
    }
  }
  for (const civ of w.civs) {
    civ.vars.population = w.settlements.filter(s => s.civId === civ.id).reduce((a, s) => a + s.population, 0);
  }
  w.snapshots.push({ year: 0, label: `创世 · ${WORLD_TITLES[w.rng.int(WORLD_TITLES.length)]}`, data: '' });
  return w;
}

/** 恢复快照数据字段（分支用，data 由 saves.ts 填充） */
export function attachSnapshotData(w: WorldState, year: number, label: string, data: string) {
  w.snapshots.push({ year, label, data });
}

/** 单年推进（多文明） */
export function tickYear(w: WorldState): TickReport {
  w.year++;
  const report: TickReport = { year: w.year, events: [], formChangedCivs: [], famine: false, deaths: 0, births: 0 };
  const size = w.gen.size;

  // 1. 天气衰减（稀疏表）
  for (const [key, cell] of [...w.weather]) {
    if (cell.years > 0) {
      cell.years--;
      if (cell.years === 0) { cell.wet = 0; w.weather.delete(key); }
    }
  }

  // —— 按文明推进 ——
  const stageUpsAll: number[] = [];
  const usedNames = new Set(w.settlements.map(x => x.name));

  for (const civ of w.civs) {
    if (civ.dead) continue;

    // 2. 技术（+文明间扩散）
    const levelUps = tickTechnology(w, civ);
    if (w.year % 2 === 0) {
      const learned = diffuseTechnology(w, civ);
      for (const l of learned) {
        report.events.push({
          id: `ev-${w.nextEventId++}`, year: w.year, civId: civ.id,
          title: `技艺东渐：${civ.name}习得新知`,
          category: 'invention',
          text: `往来于${l.from.name}与${civ.name}之间的旅人，带来了更成熟的技艺。知识从不固守一地。`,
          causes: [`与${l.from.name}接触后的技术扩散`],
          effects: [`部分领域的技术进度提升`],
          intervened: false, severity: 0.15,
        });
      }
    }

    // 3. 聚落经济与人口
    let anyFamine = false;
    for (const s of w.settlements) {
      if (s.dead || s.civId !== civ.id) continue;
      const eco = tickSettlementEconomy(w, s);
      const pop = tickPopulation(w, s, eco.foodRatio);
      report.deaths += pop.deaths;
      report.births += pop.births;
      if (pop.famineSeverity > 0.05) anyFamine = true;
      advanceConstruction(w, s);
    }
    if (anyFamine) report.famine = true;
    civ.vars.population = w.settlements.filter(s => !s.dead && s.civId === civ.id).reduce((a, s) => a + s.population, 0);

    // 4. 阶段变迁检测（聚落随阶段改名；v4.0 滞回防抖：升级满额、降级打 8 折）
    const stageUps: number[] = [];
    for (const s of w.settlements) {
      if (s.dead || s.civId !== civ.id) continue;
      let target: SettlementStage = 'camp';
      for (const { stage, pop } of STAGE_THRESHOLDS) {
        if (s.population >= (stageRank(stage) > stageRank(s.stage) ? pop : pop * 0.8)) target = stage;
      }
      if (target !== s.stage) {
        const up = stageRank(target) > stageRank(s.stage);
        s.stage = target;
        s.name = renameForStage(s.name, target, usedNames);
        if (up) stageUps.push(s.id);
        else {
          report.events.push({
            id: `ev-${w.nextEventId++}`, year: w.year, civId: civ.id, title: `${s.name}的衰退`,
            category: 'urban', text: `${s.name}因人口流失而萎缩为${stageName(s.stage)}。`,
            causes: [`人口降至 ${s.population}`], effects: [`聚落等级 → ${stageName(s.stage)}`],
            intervened: false, severity: 0.4, settlementId: s.id,
          });
        }
      }
    }
    stageUpsAll.push(...stageUps);

    // 5. 制度
    tickInstitutions(w, civ);

    // 6. 社会形态识别与变迁（v2.0 回滞 + v4.0 判定书；连续 5 年指向同一新形态且分数有优势）
    const cls = classifySociety(w, civ);
    if (cls.form !== civ.form) {
      if (civ.hystForm === cls.form) civ.hystCount = (civ.hystCount ?? 0) + 1;
      else { civ.hystForm = cls.form; civ.hystCount = 1; }
      const margin = cls.scores[cls.form] - cls.scores[civ.form];
      if ((civ.hystCount ?? 0) >= 5 && (margin > 0.2 || civ.form === 'primitive')) {
        const story = transitionStory(w, civ, civ.form, cls.form, cls);
        civ.prevForm = civ.form;
        civ.form = cls.form;
        civ.formSince = w.year;
        report.formChangedCivs.push(civ.id);
        report.events.push({
          id: `ev-${w.nextEventId++}`,
          year: w.year,
          civId: civ.id,
          title: story.title,
          category: 'institution',
          text: story.text,
          causes: cls.causes,
          effects: [
            `社会形态 → ${cls.form === 'collapsed' ? '文明废墟' : formName(cls.form)}`,
            cls.basis.classes,
          ],
          intervened: false,
          severity: 0.9,
        });
        civ.hystForm = undefined; civ.hystCount = undefined;
      }
    } else {
      civ.hystForm = undefined; civ.hystCount = undefined;
    }

    // 7. 冲突（含跨文明战争分支）
    const conflict = evaluateConflict(w, civ);
    if (conflict) {
      report.events.push({ id: `ev-${w.nextEventId++}`, ...conflict.record });
    }

    // 8. 事件（按文明独立调度）
    const ctx = freshCtx(w, civ, levelUps, stageUps);
    report.events.push(...dispatchEvents(w, ctx));

    // 9. 观察者曲线采样（每 5 年 + 形态变迁年）
    const macro = macroEconomy(w, civ);
    if (w.year % 5 === 0 || report.formChangedCivs.includes(civ.id)) {
      civ.history.push({
        year: w.year,
        pop: macro.population,
        food: Math.round(macro.foodRatio * 100) / 100,
        unrest: Math.round(civ.vars.unrest * 100) / 100,
        elite: Math.round(civ.vars.wealthElite * 100) / 100,
        form: civ.form,
      });
      if (civ.history.length > 400) civ.history.shift();
    }
  }

  // —— 世界层：文明接触检测（每 3 年）——
  if (w.year % 3 === 0) {
    for (let i = 0; i < w.civs.length; i++) {
      for (let j = i + 1; j < w.civs.length; j++) {
        const A = w.civs[i], B = w.civs[j];
        if (A.dead || B.dead || A.met.includes(B.id)) continue;
        const near = civsNear(w, A, B, 70);
        if (near) {
          A.met.push(B.id); B.met.push(A.id);
          report.events.push({
            id: `ev-${w.nextEventId++}`, year: w.year,
            title: `文明相遇：${A.name}与${B.name}`,
            category: 'trade',
            text: `${A.name}的猎人在远方遇见了${B.name}的族人。语言不通，但盐与贝壳的交换先于言语完成了沟通——两个世界从此知道了彼此的存在。`,
            causes: [`${near.a.name}与${near.b.name}相距 ${Math.round(Math.hypot(near.a.x - near.b.x, near.a.y - near.b.y))} 格`],
            effects: ['两文明开始贸易与技术扩散', '跨文明迁徙成为可能'],
            intervened: false, severity: 0.55, civId: A.id,
          });
        }
      }
    }
  }

  // —— 世界层：文明生死 ——
  for (const civ of w.civs) {
    if (civ.dead) continue;
    const alive = w.settlements.filter(s => !s.dead && s.civId === civ.id);
    if (alive.length === 0) {
      civ.dead = true;
      report.events.push({
        id: `ev-${w.nextEventId++}`, year: w.year, civId: civ.id,
        title: `文明消亡：${civ.name}`,
        category: 'urban',
        text: `${civ.name}的最后一处炊烟熄灭了。它存在了 ${w.year - civ.founded} 年，此后只余风中的传说与荒草间的基石。`,
        causes: ['全部聚落消亡'],
        effects: ['该文明退出历史'],
        intervened: false, severity: 0.95,
      });
    }
  }
  // 观察文明失效时自动切换
  if (w.civs[w.observedCiv]?.dead) {
    const largest = w.civs.filter(c => !c.dead).sort((a, b) => b.vars.population - a.vars.population)[0];
    if (largest) w.observedCiv = largest.id;
  }

  // 10. 编年史
  w.chronicle.push(...report.events);
  if (w.chronicle.length > 1200) w.chronicle.splice(0, w.chronicle.length - 1200);

  // 11. 快照
  if (w.year % CFG.snapshotEveryYears === 0 || (report.formChangedCivs.length > 0 && w.year > 0)) {
    if (w.snapshots.length < CFG.snapshotMax || w.year - w.snapshots[w.snapshots.length - 1].year >= CFG.snapshotEveryYears) {
      w.snapshots.push({ year: w.year, label: `${w.year} 年 · ${worldSummaryLabel(w)}`, data: '' });
    }
  }

  // 12. 神力能量恢复
  if (w.config.mode === 'limited') {
    w.divine = Math.min(w.divineMax, w.divine + CFG.divineRegen);
  }

  // 13. 进行中的事件（疫病等持续过程）
  for (const ae of [...w.activeEvents]) {
    if (ae.id === 'plague-outbreak') {
      const s = w.settlements.find(x => x.id === ae.data.settlementId);
      if (s && !s.dead) {
        const dead = Math.round(s.population * ae.data.lethality);
        s.population -= dead;
        if (ae.yearsLeft <= 1) {
          w.activeEvents.splice(w.activeEvents.indexOf(ae), 1);
          w.chronicle.push({
            id: `ev-${w.nextEventId++}`, year: w.year, civId: s.civId, title: '疫情平息',
            category: 'plague', text: `肆虐的疫病终于平息了。${s.name}的人们掩埋死者，重新开始生活。`,
            causes: ['疫病自然衰减', '幸存者获得抵抗力'],
            effects: ['聚落人口企稳'], intervened: false, severity: 0.2, settlementId: s.id,
          });
        }
      } else {
        w.activeEvents.splice(w.activeEvents.indexOf(ae), 1);
      }
    }
    ae.yearsLeft--;
    if (ae.yearsLeft <= 0 && ae.id !== 'plague-outbreak') {
      w.activeEvents.splice(w.activeEvents.indexOf(ae), 1);
    }
  }
  return report;
}

/** 两文明是否已有聚落相邻（返回最近的一对） */
function civsNear(w: WorldState, A: Civilization, B: Civilization, dist: number): { a: typeof w.settlements[number]; b: typeof w.settlements[number] } | null {
  let best: { a: typeof w.settlements[number]; b: typeof w.settlements[number] } | null = null;
  let bestD = Infinity;
  for (const a of w.settlements) {
    if (a.dead || a.civId !== A.id) continue;
    for (const b of w.settlements) {
      if (b.dead || b.civId !== B.id) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < bestD) { bestD = d; best = { a, b }; }
    }
  }
  return bestD <= dist ? best : null;
}

function worldSummaryLabel(w: WorldState): string {
  const alive = w.civs.filter(c => !c.dead);
  const forms = alive.map(c => formName(c.form));
  const uniq = [...new Set(forms)];
  return `${alive.length} 文明 · ${uniq.slice(0, 3).join('/')}`;
}

function formName(f: string): string {
  return ({ primitive: '原始社会', slave: '奴隶制社会', feudal: '封建社会', capitalist: '资本主义社会', socialist: '社会主义社会', collapsed: '文明废墟' } as Record<string, string>)[f] ?? f;
}
function stageName(s: string): string {
  return ({ camp: '营地', hamlet: '村落', village: '村庄', town: '城镇', city: '城市' } as Record<string, string>)[s] ?? s;
}
function stageRank(s: string): number {
  return ({ camp: 0, hamlet: 1, village: 2, town: 3, city: 4 } as Record<string, number>)[s] ?? 0;
}

/** 派生统计（UI 共用）：全局宏观（顶栏） */
export function worldMacro(w: WorldState) {
  let pop = 0, settlements = 0, civs = 0;
  for (const s of w.settlements) {
    if (s.dead) continue;
    pop += s.population;
    settlements++;
  }
  for (const c of w.civs) if (!c.dead) civs++;
  return { population: pop, settlementCount: settlements, civCount: civs };
}

/** 派生统计（UI 共用）：指定文明宏观 */
export function civMacro(w: WorldState, civ: Civilization) {
  return macroEconomy(w, civ);
}

export { createCiv };
