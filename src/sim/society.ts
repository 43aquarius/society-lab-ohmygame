/**
 * SocietyClassifier v4.0 — 每个文明独立的社会形态识别
 *
 * 判定标准严格遵循马克思主义历史唯物主义的社会形态学说：
 * 1. 生产资料所有制（核心标准）：归谁所有——公社公有 / 奴隶主私有 /
 *    地主土地私有 / 资本私有 / 社会主义公有；
 * 2. 阶级关系：主导的剥削/被剥削阶级对（奴隶主—奴隶、地主—依附农民、
 *    资本家—雇佣工人），或无阶级社会；
 * 3. 产品分配关系：平均分配 / 掠夺占有 / 地租 / 雇佣工资 / 按劳分配；
 * 4. 上层建筑：国家形态（无国家 / 奴隶制国家 / 封建国家 / 资产阶级
 *    国家 / 人民国家）与占统治地位的意识形态。
 *
 * 生产力决定生产关系：一种形态只有在它的物质前提（农业剩余、国家机器、
 * 市场、工业、文教）具备时才有资格被识别（硬性前置门控）。
 * 不同文明可同时处于不同形态——世界史本就参差多态。
 */
import { FORM_NAMES, type WorldState, type Civilization, type SocietyForm, type SettlementStage } from '../types';
import { macroEconomy } from './economy';

export interface Classification {
  form: SocietyForm;
  mixed: SocietyForm | null; // 得分接近的第二形态
  scores: Record<SocietyForm, number>;
  causes: string[]; // 主导形态的判定依据（真实变量描述）
  /** 前置未达而被排除的形态（观察者面板展示用） */
  blocked: { form: SocietyForm; missing: string[] }[];
  /** v4.0 马克思主义判定书：所有制 / 阶级关系 / 分配关系 / 上层建筑 */
  basis: { ownership: string; classes: string; distribution: string; superstructure: string };
}

/** 各形态的硬性前置条件（生产关系不能超越生产力阶段而凭空出现） */
function formGates(w: WorldState, civ: Civilization): Record<SocietyForm, string[]> {
  const t = civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const v = civ.vars;
  const macro = macroEconomy(w, civ);
  const stages = w.settlements.filter(s => !s.dead && s.civId === civ.id).map(s => s.stage);
  const has = (min: SettlementStage) => stages.some(st => stageRank(st) >= stageRank(min));
  const surplus = Math.max(0, Math.min(1, (macro.surplusRatio - 1) * 1.5));
  const miss = (ok: boolean, label: string) => (ok ? null : label);

  const slave: string[] = [];
  let m: string | null;
  if ((m = miss(lvl('agriculture') >= 4, `农耕技术不足（需4级，现${lvl('agriculture')}）`))) slave.push(m);
  if ((m = miss(surplus >= 0.08, '农业剩余不足（剩余是奴役他人的物质前提）'))) slave.push(m);
  if ((m = miss(v.stateCapacity >= 0.16, '国家机器未成型（需要暴力机关维持占有）'))) slave.push(m);
  if ((m = miss(has('village'), '尚无村庄规模的聚落'))) slave.push(m);
  if ((m = miss(v.laborForced >= 0.12 || macro.urbanization >= 0.22, '强制劳动未成规模，城市聚集亦不足（城市本身依赖强制劳动）'))) slave.push(m);

  const feudal: string[] = [];
  if ((m = miss(lvl('agriculture') >= 5, `农耕技术不足（需5级，现${lvl('agriculture')}）`))) feudal.push(m);
  if ((m = miss(v.landConcentration >= 0.32, '土地尚未向地主集中'))) feudal.push(m);
  if ((m = miss(v.stateCapacity >= 0.28, '国家机器未成型'))) feudal.push(m);
  if ((m = miss(has('town') || (has('village') && v.laborBonded >= 0.18), '聚落规模不足'))) feudal.push(m);
  if ((m = miss(v.laborBonded >= 0.1, '人身依附未成规模'))) feudal.push(m);

  const capitalist: string[] = [];
  if ((m = miss(lvl('industry') >= 3, `工业技术不足（需3级，现${lvl('industry')}）`))) capitalist.push(m);
  if ((m = miss(v.market >= 0.5, '商品市场发育不足（劳动力尚未普遍商品化）'))) capitalist.push(m);
  if ((m = miss(macro.urbanization >= 0.18, '城市化不足'))) capitalist.push(m);
  if ((m = miss(has('town'), '尚无城镇'))) capitalist.push(m);
  if ((m = miss(v.laborWage >= 0.22, '雇佣劳动未成规模'))) capitalist.push(m);

  const socialist: string[] = [];
  if ((m = miss(lvl('industry') >= 4, `工业技术不足（需4级，现${lvl('industry')}）`))) socialist.push(m);
  if ((m = miss(v.education >= 0.45, '文教水平不足（公有社会需要自觉的劳动者）'))) socialist.push(m);
  if ((m = miss(v.publicServices >= 0.38, '公共服务不足'))) socialist.push(m);
  if ((m = miss(v.participation >= 0.4, '政治参与不足'))) socialist.push(m);
  if ((m = miss(v.ownPublic + v.laborCoop >= 0.42, '公有与合作部门不足'))) socialist.push(m);
  if ((m = miss(has('town'), '尚无城镇作为公共治理的基础'))) socialist.push(m);
  // 历史唯物主义：社会主义只能从资本主义社会的矛盾中生长
  // （其物质前提——社会化大生产——由资本主义创造；原始/奴隶/封建社会无法直接跃入）
  if ((m = miss(civ.form === 'capitalist' || civ.form === 'socialist', '社会主义只能从资本主义的内部生长（社会化大生产尚不存在）'))) socialist.push(m);

  return { primitive: [], slave, feudal, capitalist, socialist, collapsed: [] };
}

function stageRank(s: SettlementStage): number {
  return { camp: 0, hamlet: 1, village: 2, town: 3, city: 4 }[s];
}

export function classifySociety(w: WorldState, civ: Civilization): Classification {
  const v = civ.vars;
  const t = civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const macro = macroEconomy(w, civ);
  const pop = macro.population;
  const farming = lvl('agriculture') >= 2 && w.settlements.some(s => !s.dead && s.civId === civ.id && s.buildings.some(b => b.kind === 'farm'));
  const surplus = Math.max(0, Math.min(1, (macro.surplusRatio - 1) * 1.5));

  if (pop === 0) {
    return {
      form: 'collapsed', mixed: null, scores: collapsedScores(), causes: ['聚落人口清零'],
      blocked: [], basis: collapsedBasis(),
    };
  }

  const gates = formGates(w, civ);
  // 城镇/城市是阶级社会的物质证据（乌鲁克、雅典、罗马皆奴隶制城邦）：
  // 氏族公社无法组织千人的聚落——分工、剩余榨取与暴力机器是城市存在的前提
  const hasTown = w.settlements.some(s => !s.dead && s.civId === civ.id && stageRank(s.stage) >= 3);

  // —— 评分：生产资料所有制是第一权重（核心标准），劳动关系次之 ——
  const scores: Record<SocietyForm, number> = {
    // 原始：公社公有制 + 无阶级分化 + 无剩余榨取
    // （城镇与城市是阶级社会的物质证据，与氏族公有制不相容）
    primitive:
      v.ownCommon * 1.1
      + (1 - Math.max(v.laborForced, v.laborBonded, v.laborWage)) * 0.34
      + (farming ? 0 : 0.32)
      + (surplus < 0.12 ? 0.3 : 0)
      + (1 - v.specialization) * 0.2
      + (v.stateCapacity < 0.2 ? 0.14 : 0)
      - (hasTown ? 0.55 : 0)
      - (v.laborForced + v.laborBonded) * 0.5,
    // 奴隶制：奴隶主占有生产资料 + 直接占有劳动者人身
    // （城市聚集本身依赖强制劳动——古代城市多为奴隶制城邦）
    slave: gates.slave.length ? -1 :
      v.ownPrivate * 0.62
      + v.laborForced * 1.5
      + macro.urbanization * 0.3
      + surplus * 0.14
      + v.stateCapacity * 0.12
      + civ.warMemory * 0.2
      - v.market * 0.22,
    // 封建：地主占有土地 + 农民人身依附 + 地租
    feudal: gates.feudal.length ? -1 :
      v.landConcentration * 0.82
      + v.ownPrivate * 0.4
      + v.laborBonded * 1.12
      + surplus * 0.1
      + (1 - v.market) * 0.08
      - Math.max(0, lvl('industry') - 1) * 0.2,
    // 资本主义：资本私有 + 雇佣劳动 + 普遍化的商品市场
    capitalist: gates.capitalist.length ? -1 :
      v.ownPrivate * 0.36
      + v.laborWage * 1.1
      + v.market * 0.72
      + Math.max(0, lvl('industry') - 1) * 0.3
      + v.wealthMiddle * 0.1,
    // 社会主义：生产资料公有制 + 按劳分配 + 人民国家
    socialist: gates.socialist.length ? -1 :
      (v.ownPublic + v.laborCoop) * 1.15
      + v.publicServices * 0.28
      + v.participation * 0.24
      + v.education * 0.12,
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
      `生产资料归公社共有（${pct(v.ownCommon)}）`,
      farming ? '农业刚刚萌芽' : '仍以采集狩猎为生',
      `尚无系统的剩余榨取（强制${pct(v.laborForced)} / 依附${pct(v.laborBonded)}）`,
    ],
    slave: [
      `生产资料私有占${pct(v.ownPrivate)}，奴隶主并占有奴隶人身`,
      `强制劳动占 ${pct(v.laborForced)}`,
      `国家机器 ${pct(v.stateCapacity)}（暴力机关维持占有）`,
    ],
    feudal: [
      `土地集中度 ${pct(v.landConcentration)}（地主占有主要生产资料）`,
      `人身依附劳动占 ${pct(v.laborBonded)}`,
      `市场发育 ${pct(v.market)}（自然经济仍占主导）`,
    ],
    capitalist: [
      `资本私有占${pct(v.ownPrivate)}，劳动力成为商品`,
      `雇佣劳动占 ${pct(v.laborWage)}`,
      `市场发育 ${pct(v.market)}，工业 ${lvl('industry')} 级`,
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
  return { form, mixed, scores, causes: causesMap[form], blocked, basis: formBasis(form, v, lvl) };
}

/** 马克思主义判定书：四要素文本 */
function formBasis(form: SocietyForm, v: import('../types').SocietyVars, lvl: (d: string) => number): Classification['basis'] {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  switch (form) {
    case 'primitive':
      return {
        ownership: `生产资料归氏族公社公有（共有制 ${pct(v.ownCommon)}），尚无私有观念`,
        classes: '无阶级社会：全体成员共同劳动，仅按年齿与性别分工',
        distribution: '产品大体平均分配，无系统的剩余榨取',
        superstructure: '无国家：氏族长老议事与习俗维系秩序',
      };
    case 'slave':
      return {
        ownership: `生产资料与奴隶人身归奴隶主占有（私有 ${pct(v.ownPrivate)}）`,
        classes: `奴隶主阶级 / 奴隶阶级（强制劳动 ${pct(v.laborForced)}），自由民为中间层`,
        distribution: '剩余产品以直接掠夺形式集中于奴隶主',
        superstructure: '奴隶制国家：王权、神庙与军队构成暴力机器',
      };
    case 'feudal':
      return {
        ownership: `土地这一主要生产资料归地主阶级占有（集中度 ${pct(v.landConcentration)}）`,
        classes: `地主阶级 / 依附农民（人身依附 ${pct(v.laborBonded)}），商人与手工业者居边缘`,
        distribution: '剩余以地租（劳役、实物、货币）形式被地主占有，超经济强制普遍',
        superstructure: '封建国家：君主分封、等级身份与神学意识形态',
      };
    case 'capitalist':
      return {
        ownership: `生产资料归资本家阶级私人占有（私有 ${pct(v.ownPrivate)}）`,
        classes: `资产阶级 / 雇佣劳动者（劳动力成为商品，雇佣 ${pct(v.laborWage)}）`,
        distribution: '剩余价值归资本占有，按资分配主导',
        superstructure: '资产阶级国家与法权：契约自由、议会与市场意识形态',
      };
    case 'socialist':
      return {
        ownership: `生产资料公有制为主体（公有与合作 ${pct(v.ownPublic + v.laborCoop)}）`,
        classes: '剥削阶级作为阶级被消灭，工人阶级与劳动人民当家作主',
        distribution: '按劳分配为主体',
        superstructure: '人民国家：公共服务、广泛政治参与与集体主义意识形态',
      };
    case 'collapsed':
      return collapsedBasis();
  }
}

function collapsedBasis(): Classification['basis'] {
  return {
    ownership: '——', classes: '——', distribution: '——', superstructure: '废墟之上再无秩序',
  };
}

function collapsedScores(): Record<SocietyForm, number> {
  return { primitive: -1, slave: -1, feudal: -1, capitalist: -1, socialist: -1, collapsed: 1 };
}

export function formLabel(c: Classification): string {
  if (c.form === 'collapsed') return FORM_NAMES.collapsed;
  return c.mixed ? `${FORM_NAMES[c.form]}（${FORM_NAMES[c.mixed]}倾向）` : FORM_NAMES[c.form];
}

/** 形态变迁叙事：旧→新，由真实驱动变量组成（引用判定书要素） */
export function transitionStory(w: WorldState, civ: Civilization, from: SocietyForm, to: SocietyForm, c: Classification): { title: string; text: string } {
  const v = civ.vars;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const detail: Record<string, string> = {
    'primitive>slave': `战俘与债务把一部分人变成了「会说话的工具」。生产资料与奴隶人身归奴隶主占有（私有${pct(v.ownPrivate)}），强制劳动占${pct(v.laborForced)}，公权力第一次系统地服务于有产者。`,
    'primitive>feudal': `土地成了财富的根本。${pct(v.landConcentration)}的田地掌握在少数人手中，耕种者以人身依附（${pct(v.laborBonded)}）换取生存，剩余以地租形式流向地主。`,
    'primitive>capitalist': `市场的逻辑生长得比任何人预想的都快。雇佣关系与私人积累重塑了生产。`,
    'primitive>socialist': `在小规模共同体的协作与公共分配中，一种自觉的公有秩序成型了。`,
    'slave>feudal': `强制劳动的治理成本高企，主人发现地租比锁链更可靠——奴役改换形式为人身依附，封建国家取代了奴隶主的直接暴力。`,
    'slave>primitive': `强制劳动体系在反抗与崩解中瓦解，幸存者退回了小共同体生活。`,
    'feudal>capitalist': `商人与工坊主的力量超过了旧的土地贵族。雇佣劳动、普遍化的市场与机器共同宣告了新纪元——劳动力成为了商品。`,
    'feudal>slave': `依附关系恶化，公开的强制劳动重新成为主导。`,
    'capitalist>socialist': `组织起来的劳动者夺取了分配的主动权。生产资料转入公共与合作社之手，按劳分配取代了按资分配。`,
    'capitalist>feudal': `市场体系崩溃后，土地与人身依附重新成为社会支柱。`,
    'socialist>capitalist': `公共部门效率衰减，市场与私人积累悄然回归主导。`,
    'socialist>feudal': `公共秩序解体，权力落回地方豪强手中。`,
  };
  const key = `${from}>${to}`;
  return {
    title: `${civ.name}：${FORM_NAMES[from]} → ${FORM_NAMES[to]}`,
    text: detail[key] ?? `社会结构发生了深刻转变。${c.basis.ownership}；${c.basis.classes}。`,
  };
}
