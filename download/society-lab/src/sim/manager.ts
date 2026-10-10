/**
 * SimulationManager — 时间推进与年度模拟的总编排
 * 顺序：天气衰减 → 技术 → 生产/人口 → 建造 → 制度 → 形态识别 →
 *       冲突 → 事件 → 编年史 → 快照 → 神力能量恢复。
 */
import { CFG } from '../config';
import { Rng, type WorldState, type EventRecord } from '../types';
import { generateWorld } from '../worldgen';
import { settlementName, WORLD_TITLES } from '../names';
import { tickTechnology } from './technology';
import { tickSettlementEconomy, advanceConstruction, checkStageChange, macroEconomy } from './economy';
import { tickPopulation } from './population';
import { tickInstitutions } from './institutions';
import { classifySociety, transitionStory } from './society';
import { evaluateConflict } from './conflict';
import { dispatchEvents, freshCtx } from './events';
import { BuildingKind } from '../types';

export interface TickReport {
  year: number;
  events: EventRecord[];
  formChanged: boolean;
  famine: boolean;
  deaths: number;
  births: number;
}

/** 从配置新建世界（含初始聚落） */
export function newWorld(config: {
  seed: number; size: number; mode: 'free' | 'limited'; settlements?: number; scenario?: 'dawn' | 'valley';
}): WorldState {
  const gen = generateWorld({
    seed: config.seed, size: config.size, mode: config.mode,
    settlements: config.settlements ?? 1, scenario: config.scenario ?? 'dawn',
  });
  const w: WorldState = {
    config: {
      seed: config.seed, size: config.size, mode: config.mode,
      settlements: config.settlements ?? 1, scenario: config.scenario ?? 'dawn',
    },
    year: 0,
    tiles: gen.tiles,
    weather: new Array(config.size * config.size).fill(0).map(() => ({ wet: 0, years: 0 })),
    settlements: [],
    civ: {
      form: 'primitive', formSince: 0, prevForm: null,
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
      warMemory: 0,
      enlightenment: 0,
    },
    chronicle: [],
    activeEvents: [],
    history: [],
    interventions: 0,
    divine: config.mode === 'free' ? 999 : CFG.divineMax,
    divineMax: config.mode === 'free' ? 999 : CFG.divineMax,
    rng: new Rng(config.seed ^ 0x2f6e2b1),
    nextBuildingId: 1,
    nextEventId: 1,
    snapshots: [],
  };

  // 初始聚落
  const used = new Set<string>();
  const startPop = config.scenario === 'valley' ? 70 : 42;
  for (const p of gen.starts) {
    w.settlements.push({
      id: w.settlements.length,
      name: settlementName(w.rng, 'camp', used),
      x: p.x, y: p.y,
      stage: 'camp', population: startPop,
      buildings: [], construction: [],
      food: startPop * 1.8, wood: 14, stone: 2, metal: 0,
      radius: 3, shortageYears: 0, founded: 0,
      effects: [], dead: false, lastFamine: -999,
    });
    const t = w.tiles[p.y * config.size + p.x];
    t.owner = w.settlements.length - 1;
  }
  // 河谷情景：预设农业知识
  if (config.scenario === 'valley') {
    w.civ.tech.levels.agriculture = 2;
    w.civ.tech.progress.agriculture = 12;
    for (const s of w.settlements) {
      s.buildings.push({ id: w.nextBuildingId++, kind: BuildingKind.Farm, x: s.x, y: s.y + 1, builtYear: 0, progress: 1 });
      s.buildings.push({ id: w.nextBuildingId++, kind: BuildingKind.Shelter, x: s.x + 1, y: s.y, builtYear: 0, progress: 1 });
    }
  } else {
    for (const s of w.settlements) {
      s.buildings.push({ id: w.nextBuildingId++, kind: BuildingKind.Camp, x: s.x, y: s.y, builtYear: 0, progress: 1 });
    }
  }
  w.civ.vars.population = startPop * w.settlements.length;
  w.snapshots.push({ year: 0, label: `创世 · ${WORLD_TITLES[w.rng.int(WORLD_TITLES.length)]}`, data: '' });
  return w;
}

/** 恢复快照数据字段（分支用，data 由 saves.ts 填充） */
export function attachSnapshotData(w: WorldState, year: number, label: string, data: string) {
  w.snapshots.push({ year, label, data });
}

/** 单年推进 */
export function tickYear(w: WorldState): TickReport {
  w.year++;
  const report: TickReport = { year: w.year, events: [], formChanged: false, famine: false, deaths: 0, births: 0 };
  const size = w.config.size;

  // 1. 天气衰减
  for (const cell of w.weather) {
    if (cell.years > 0) {
      cell.years--;
      if (cell.years === 0) cell.wet = 0;
    }
  }

  // 2. 技术
  const levelUps = tickTechnology(w);

  // 3. 聚落经济与人口
  let anyFamine = false;
  for (const s of w.settlements) {
    if (s.dead) continue;
    const eco = tickSettlementEconomy(w, s);
    const pop = tickPopulation(w, s, eco.foodRatio);
    report.deaths += pop.deaths;
    report.births += pop.births;
    if (pop.famineSeverity > 0.05) anyFamine = true;
    advanceConstruction(w, s);
  }
  report.famine = anyFamine;
  w.civ.vars.population = w.settlements.reduce((a, s) => a + (s.dead ? 0 : s.population), 0);

  // 4. 阶段跃迁检测（在事件前）
  const stageUps: number[] = [];
  for (const s of w.settlements) {
    const was = s.stage;
    // 注意 checkStageChange 已在建造完成时调用；这里做人口下降的降级检测
    if (checkStageDowngrade(s, was)) stageUps.push(-s.id - 1000);
  }

  // 5. 制度
  tickInstitutions(w);

  // 6. 社会形态识别与变迁
  const cls = classifySociety(w);
  if (cls.form !== w.civ.form) {
    const story = transitionStory(w, w.civ.form, cls.form, cls);
    w.civ.prevForm = w.civ.form;
    w.civ.form = cls.form;
    w.civ.formSince = w.year;
    report.formChanged = true;
    report.events.push({
      id: `ev-${w.nextEventId++}`,
      year: w.year,
      title: story.title,
      category: 'institution',
      text: story.text,
      causes: cls.causes,
      effects: [`社会形态 → ${cls.form === 'collapsed' ? '文明废墟' : formName(cls.form)}`, ...subsequentEffects(w)],
      intervened: false,
      severity: 0.9,
    });
  }

  // 7. 冲突
  const conflict = evaluateConflict(w);
  if (conflict) {
    report.events.push({ id: `ev-${w.nextEventId++}`, ...conflict.record });
  }

  // 8. 事件
  const ctx = freshCtx(w, levelUps, stageUps.filter(x => x >= 0).map(x => x));
  // 建造完成时的跃迁已即时记录；此处补充人口降级提示
  for (const neg of stageUps.filter(x => x < 0)) {
    const s = w.settlements.find(x => x.id === -neg - 1000);
    if (s && !s.dead) {
      report.events.push({
        id: `ev-${w.nextEventId++}`, year: w.year, title: `${s.name}的衰退`,
        category: 'urban', text: `${s.name}因人口流失而萎缩为${stageName(s.stage)}。`,
        causes: [`人口降至 ${s.population}`], effects: [`聚落等级 → ${stageName(s.stage)}`],
        intervened: false, severity: 0.4, settlementId: s.id,
      });
    }
  }
  report.events.push(...dispatchEvents(w, ctx));

  // 9. 编年史
  w.chronicle.push(...report.events);
  if (w.chronicle.length > 900) w.chronicle.splice(0, w.chronicle.length - 900);

  // 10. 快照
  if (w.year % CFG.snapshotEveryYears === 0 || (report.formChanged && w.year > 0)) {
    if (w.snapshots.length < CFG.snapshotMax || w.year - w.snapshots[w.snapshots.length - 1].year >= CFG.snapshotEveryYears) {
      w.snapshots.push({ year: w.year, label: `${w.year} 年 · ${formName(w.civ.form)}`, data: '' });
    }
  }

  // 11. 神力能量恢复
  if (w.config.mode === 'limited') {
    w.divine = Math.min(w.divineMax, w.divine + CFG.divineRegen);
  }

  // 12. 观察者曲线采样（每 5 年 + 形态变迁年）
  const macro = macroEconomy(w);
  if (w.year % 5 === 0 || report.formChanged) {
    w.history.push({
      year: w.year,
      pop: macro.population,
      food: Math.round(macro.foodRatio * 100) / 100,
      unrest: Math.round(w.civ.vars.unrest * 100) / 100,
      elite: Math.round(w.civ.vars.wealthElite * 100) / 100,
      form: w.civ.form,
    });
    if (w.history.length > 400) w.history.shift();
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
            id: `ev-${w.nextEventId++}`, year: w.year, title: '疫情平息',
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

function formName(f: string): string {
  return ({ primitive: '原始社会', slave: '奴隶制社会', feudal: '封建社会', capitalist: '资本主义社会', socialist: '社会主义社会', collapsed: '文明废墟' } as Record<string, string>)[f] ?? f;
}
function stageName(s: string): string {
  return ({ camp: '营地', hamlet: '小村', village: '村庄', town: '城镇', city: '城市' } as Record<string, string>)[s] ?? s;
}
function subsequentEffects(w: WorldState): string[] {
  const v = w.civ.vars;
  return [
    `所有制：共有${Math.round(v.ownCommon * 100)}% / 私有${Math.round(v.ownPrivate * 100)}% / 公有${Math.round(v.ownPublic * 100)}%`,
    `劳动关系：强制${Math.round(v.laborForced * 100)}% / 依附${Math.round(v.laborBonded * 100)}% / 雇佣${Math.round(v.laborWage * 100)}% / 合作${Math.round(v.laborCoop * 100)}%`,
  ];
}

function checkStageDowngrade(s: WorldState['settlements'][number], _was: string): boolean {
  const thresholds: [string, number][] = [['camp', 0], ['hamlet', 55], ['village', 130], ['town', 320], ['city', 700]];
  let target = 'camp';
  for (const [st, pop] of thresholds) if (s.population >= pop) target = st;
  if (target !== s.stage) {
    s.stage = target as typeof s.stage;
    return true;
  }
  return false;
}

/** 派生统计（UI 共用） */
export function currentMacro(w: WorldState) {
  return macroEconomy(w);
}
