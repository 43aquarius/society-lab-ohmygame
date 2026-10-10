/**
 * SocietyClassifier — 社会形态识别
 * 不用年份/科技树解锁，而是由生产力、所有制、劳动关系、土地依附、
 * 市场程度、财富结构等变量加权评分，支持混合形态与识别变迁叙事。
 *
 * v2.0 硬性前置（历史一致性）：
 * 一种社会形态只有在它的「物质与制度前提」具备时才有资格被识别——
 * 奴隶制需要农业剩余与早期国家机器；封建需要高土地集中与依附劳动；
 * 资本主义需要工业、市场与城市；社会主义需要高文教、公共服务与公有部门。
 * 未达前置的形态不参与评分，彻底杜绝"住着窝棚的资本主义"这类错位。
 */
import { FORM_NAMES, type WorldState, type SocietyForm, type SettlementStage } from '../types';
import { macroEconomy } from './economy';

export interface Classification {
  form: SocietyForm;
  mixed: SocietyForm | null; // 得分接近的第二形态
  scores: Record<SocietyForm, number>;
  causes: string[]; // 主导形态的判定依据（真实变量描述）
  /** 前置未达而被排除的形态（观察者面板展示用） */
  blocked: { form: SocietyForm; missing: string[] }[];
}

/** 各形态的硬性前置条件 */
function formGates(w: WorldState): Record<SocietyForm, string[]> {
  const t = w.civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const v = w.civ.vars;
  const macro = macroEconomy(w);
  const stages = w.settlements.filter(s => !s.dead).map(s => s.stage);
  const has = (min: SettlementStage) => stages.some(st => stageRank(st) >= stageRank(min));
  const surplus = Math.max(0, Math.min(1, (macro.surplusRatio - 1) * 1.5));
  const miss = (ok: boolean, label: string) => (ok ? null : label);

  const slave: string[] = [];
  let m: string | null;
  if ((m = miss(lvl('agriculture') >= 4, `农耕技术不足（需4级，现${lvl('agriculture')}）`))) slave.push(m);
  if ((m = miss(surplus >= 0.12, '农业剩余不足'))) slave.push(m);
  if ((m = miss(v.stateCapacity >= 0.22, '国家机器未成型'))) slave.push(m);
  if ((m = miss(has('village'), '尚无村庄规模的聚落'))) slave.push(m);
  if ((m = miss(v.laborForced >= 0.12, '强制劳动未成规模'))) slave.push(m);

  const feudal: string[] = [];
  if ((m = miss(lvl('agriculture') >= 5, `农耕技术不足（需5级，现${lvl('agriculture')}）`))) feudal.push(m);
  if ((m = miss(v.landConcentration >= 0.32, '土地尚未集中'))) feudal.push(m);
  if ((m = miss(v.stateCapacity >= 0.28, '国家机器未成型'))) feudal.push(m);
  if ((m = miss(has('town') || (has('village') && v.laborBonded >= 0.18), '聚落规模不足'))) feudal.push(m);
  if ((m = miss(v.laborBonded >= 0.1, '依附劳动未成规模'))) feudal.push(m);

  const capitalist: string[] = [];
  if ((m = miss(lvl('industry') >= 3, `工业技术不足（需3级，现${lvl('industry')}）`))) capitalist.push(m);
  if ((m = miss(v.market >= 0.5, '市场发育不足'))) capitalist.push(m);
  if ((m = miss(macro.urbanization >= 0.18, '城市化不足'))) capitalist.push(m);
  if ((m = miss(has('town'), '尚无城镇'))) capitalist.push(m);
  if ((m = miss(v.laborWage >= 0.22, '雇佣劳动未成规模'))) capitalist.push(m);

  const socialist: string[] = [];
  if ((m = miss(lvl('industry') >= 4, `工业技术不足（需4级，现${lvl('industry')}）`))) socialist.push(m);
  if ((m = miss(v.education >= 0.45, '文教水平不足'))) socialist.push(m);
  if ((m = miss(v.publicServices >= 0.38, '公共服务不足'))) socialist.push(m);
  if ((m = miss(v.participation >= 0.4, '政治参与不足'))) socialist.push(m);
  if ((m = miss(v.ownPublic + v.laborCoop >= 0.42, '公有与合作部门不足'))) socialist.push(m);
  if ((m = miss(has('town'), '尚无城镇作为公共治理的基础'))) socialist.push(m);
  if ((m = miss(w.civ.form === 'capitalist' || v.laborWage > 0.15 || w.civ.prevForm !== null, '尚无成熟的社会组织（需从既有形态演进而来）'))) socialist.push(m);

  return { primitive: [], slave, feudal, capitalist, socialist, collapsed: [] };
}

function stageRank(s: SettlementStage): number {
  return { camp: 0, hamlet: 1, village: 2, town: 3, city: 4 }[s];
}

export function classifySociety(w: WorldState): Classification {
  const v = w.civ.vars;
  const t = w.civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const macro = macroEconomy(w);
  const pop = macro.population;
  const farming = lvl('agriculture') >= 2 && w.settlements.some(s => s.buildings.some(b => b.kind === 'farm'));
  const surplus = Math.max(0, Math.min(1, (macro.surplusRatio - 1) * 1.5));

  if (pop === 0) {
    return {
      form: 'collapsed', mixed: null, scores: collapsedScores(), causes: ['聚落人口清零'],
      blocked: [],
    };
  }

  const gates = formGates(w);

  const scores: Record<SocietyForm, number> = {
    // 原始：共有制 + 无农业剩余 + 低分工（始终有资格）
    primitive:
      v.ownCommon * 0.9
      + (farming ? 0 : 0.35)
      + (surplus < 0.12 ? 0.3 : 0)
      + (1 - v.specialization) * 0.25
      + (macro.settlementCount <= 1 && pop < 120 ? 0.15 : 0)
      - (v.laborForced + v.laborBonded) * 0.6,
    // 奴隶制：强制劳动占主导 + 存在剩余 + 国家机器
    slave: gates.slave.length ? -1 :
      v.laborForced * 1.55
      + surplus * 0.18
      + v.stateCapacity * 0.18
      + w.civ.warMemory * 0.25
      + v.ownPrivate * 0.15
      - v.market * 0.25,
    // 封建：土地集中 + 依附劳动 + 私有但不发达的市场
    feudal: gates.feudal.length ? -1 :
      v.laborBonded * 1.25
      + v.landConcentration * 0.75
      + v.ownPrivate * 0.2
      + surplus * 0.15
      + (1 - v.market) * 0.10
      - Math.max(0, lvl('industry') - 1) * 0.22,
    // 资本主义：雇佣劳动 + 市场 + 工业技术
    capitalist: gates.capitalist.length ? -1 :
      v.laborWage * 1.15
      + v.market * 0.6
      + Math.max(0, lvl('industry') - 1) * 0.32
      + v.ownPrivate * 0.22
      + v.wealthMiddle * 0.12,
    // 社会主义：公有/合作制 + 公共服务 + 参与
    socialist: gates.socialist.length ? -1 :
      (v.ownPublic + v.laborCoop) * 1.05 * (0.4 + v.publicServices * 2)
      + v.publicServices * 0.36
      + v.participation * 0.26
      + v.education * 0.14,
    collapsed: -1,
  };

  let form: SocietyForm = 'primitive';
  let best = -Infinity;
  for (const key of ['primitive', 'slave', 'feudal', 'capitalist', 'socialist'] as SocietyForm[]) {
    if (scores[key] > best) { best = scores[key]; form = key; }
  }
  let mixed: SocietyForm | null = null;
  let second = -Infinity;
  for (const key of ['primitive', 'slave', 'feudal', 'capitalist', 'socialist'] as SocietyForm[]) {
    if (key !== form && scores[key] > second) { second = scores[key]; mixed = key; }
  }
  if (second < best * 0.8 || second < 0.25) mixed = null;

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const causesMap: Record<SocietyForm, string[]> = {
    primitive: [
      `生产资料${pct(v.ownCommon)}为共同体持有`,
      farming ? '农业刚刚萌芽' : '仍以采集狩猎为生',
      `分工程度 ${pct(v.specialization)}`,
    ],
    slave: [
      `强制劳动占 ${pct(v.laborForced)}`,
      `组织能力 ${pct(v.stateCapacity)}`,
      surplus > 0.3 ? '剩余产品足以供养非劳动者' : '剩余有限',
    ],
    feudal: [
      `土地集中度 ${pct(v.landConcentration)}`,
      `依附劳动占 ${pct(v.laborBonded)}`,
      `市场发育 ${pct(v.market)}`,
    ],
    capitalist: [
      `雇佣劳动占 ${pct(v.laborWage)}`,
      `市场发育 ${pct(v.market)}`,
      `工业技术 ${lvl('industry')} 级`,
    ],
    socialist: [
      `公有制与合作社占 ${pct(v.ownPublic + v.laborCoop)}`,
      `公共服务覆盖 ${pct(v.publicServices)}`,
      `政治参与 ${pct(v.participation)}`,
    ],
    collapsed: ['聚落人口清零'],
  };
  const blocked = (Object.keys(gates) as SocietyForm[])
    .filter(k => gates[k].length > 0)
    .map(k => ({ form: k, missing: gates[k] }));
  return { form, mixed, scores, causes: causesMap[form], blocked };
}

function collapsedScores(): Record<SocietyForm, number> {
  return { primitive: -1, slave: -1, feudal: -1, capitalist: -1, socialist: -1, collapsed: 1 };
}

export function formLabel(c: Classification): string {
  if (c.form === 'collapsed') return FORM_NAMES.collapsed;
  return c.mixed ? `${FORM_NAMES[c.form]}（${FORM_NAMES[c.mixed]}倾向）` : FORM_NAMES[c.form];
}

/** 形态变迁叙事：旧→新，由真实驱动变量组成 */
export function transitionStory(w: WorldState, from: SocietyForm, to: SocietyForm, c: Classification): { title: string; text: string } {
  const v = w.civ.vars;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const detail: Record<string, string> = {
    'primitive>slave': `战俘与债务把一部分人变成了「会说话的工具」。强制劳动已占${pct(v.laborForced)}，公权力第一次系统地服务于有产者。`,
    'primitive>feudal': `土地成了财富的根本。${pct(v.landConcentration)}的田地掌握在少数人手中，耕种者以人身依附换取生存。`,
    'primitive>capitalist': `市场的逻辑生长得比任何人预想的都快。雇佣关系与私人积累重塑了生产。`,
    'primitive>socialist': `在小规模共同体的协作与公共分配中，一种自觉的公有秩序成型了。`,
    'slave>feudal': `强制劳动的治理成本高企，主人发现地租比锁链更可靠——奴役改换形式为依附。`,
    'slave>primitive': `强制劳动体系在反抗与崩解中瓦解，幸存者退回了小共同体生活。`,
    'feudal>capitalist': `商人与工坊主的力量超过了旧的土地贵族。市场、雇佣与机器共同宣告了新纪元。`,
    'feudal>slave': `依附关系恶化，公开的强制劳动重新成为主导。`,
    'capitalist>socialist': `组织起来的劳动者夺取了分配的主动权。生产资料转入公共与合作社之手。`,
    'capitalist>feudal': `市场体系崩溃后，土地与人身依附重新成为社会支柱。`,
    'socialist>capitalist': `公共部门效率衰减，市场与私人积累悄然回归主导。`,
    'socialist>feudal': `公共秩序解体，权力落回地方豪强手中。`,
  };
  const key = `${from}>${to}`;
  return {
    title: `社会形态变迁：${FORM_NAMES[from]} → ${FORM_NAMES[to]}`,
    text: detail[key] ?? `社会结构发生了深刻转变，${c.causes.join('；')}。`,
  };
}
