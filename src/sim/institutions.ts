/**
 * InstitutionSystem — 所有制、劳动关系与财富分配
 * 收入份额由劳动制度决定，财富份额向收入份额缓慢收敛；
 * 制度变量的漂移由经济结构、技术与冲突共同驱动，而非固定科技升级路线。
 */
import type { WorldState } from '../types';
import { macroEconomy } from './economy';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 年度制度漂移 + 财富分配结算。返回观察文本片段（供观察者面板）。 */
export function tickInstitutions(w: WorldState): void {
  const v = w.civ.vars;
  const t = w.civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const macro = macroEconomy(w);

  // —— 派生基础 ——
  const pop = macro.population;
  const surplus = clamp01((macro.surplusRatio - 1) * 1.4); // 0..1 剩余程度
  v.specialization = clamp01(
    0.06 + lvl('crafting') * 0.05 + v.market * 0.25 + macro.urbanization * 0.3 + (lvl('industry') - 1) * 0.09
  );
  v.livingStandard = clamp01(
    0.15 + (macro.foodRatio - 1) * 0.5 + lvl('industry') * 0.09 + v.publicServices * 0.2 - v.resourcePressure * 0.2
  );

  // 市场发育：商贸技术 + 城市化 + 聚落间贸易
  const tradeRoutes = Math.max(0, macro.settlementCount - 1);
  // 市场发育：由商贸技术进步（而非基线）、城市化与聚落间贸易驱动
  v.market = clamp01(v.market
    + Math.max(0, lvl('commerce') - 1) * 0.012 + macro.urbanization * 0.006 + tradeRoutes * 0.004
    + (lvl('industry') >= 2 ? 0.02 : 0) - 0.006);
  // 国家能力：治理技术 + 公廨
  const adminCount = w.settlements.reduce((a, s) => a + s.buildings.filter(b => b.kind === 'admin').length, 0);
  v.stateCapacity = clamp01(v.stateCapacity
    + lvl('governance') * 0.014 + adminCount * 0.015 + macro.urbanization * 0.006 - 0.006);
  // 教育与公共服务：需要文教技术与设施承载，无输入则缓慢流失
  const servicesCount = w.settlements.reduce((a, s) => a + s.buildings.filter(b => b.kind === 'services' || b.kind === 'cooperative').length, 0);
  const eduCap = 0.1 + lvl('education') * 0.12;
  v.education = clamp01(v.education + (eduCap - v.education) * 0.035 + servicesCount * 0.004 - 0.001);
  v.publicServices = clamp01(v.publicServices
    + servicesCount * 0.02 + v.stateCapacity * (v.participation * 0.02 + 0.006) - 0.008);

  // —— 所有制漂移 ——
  // 私有化：市场、土地集中与生产剩余共同推动财富积累
  const privatePull = v.market * 0.006 + v.landConcentration * 0.004 + Math.max(0, lvl('industry') - 1) * 0.006
    + Math.max(0, surplus - 0.15) * 0.003;
  // 公有化需要组织与国家能力承载，而非仅凭教育自发漂移
  const publicPull = v.stateCapacity * 0.003 + (v.laborCoop > 0.35 ? 0.005 : 0)
    + (w.civ.groups.find(g => g.id === 'commoners')?.ideas ?? 0) * 0.004;
  // 强制劳动意味着对人的私人占有，推动私有化（奴隶制路径的制度反馈）
  const forcedPull = v.laborForced * 0.0028;
  v.ownCommon = clamp01(v.ownCommon - privatePull * 0.7 - forcedPull);
  v.ownPrivate = clamp01(v.ownPrivate + privatePull + forcedPull - publicPull * 0.4);
  v.ownPublic = clamp01(v.ownPublic + publicPull * 0.8);

  // —— 归一化 ——
  // 所有制三元归一（共有制吸收残差）
  const ownSum = v.ownCommon + v.ownPrivate + v.ownPublic;
  if (ownSum > 0.01) { v.ownCommon /= ownSum; v.ownPrivate /= ownSum; v.ownPublic /= ownSum; }
  // 劳动关系只缩不涨：四元超过 1 时等比压缩；残差为家庭生计部门（不参与形态评分，
  // 避免其他形式衰减后把残余合作劳动放大成 100%）
  const laborSum = v.laborForced + v.laborBonded + v.laborWage + v.laborCoop;
  if (laborSum > 1) {
    v.laborForced /= laborSum; v.laborBonded /= laborSum;
    v.laborWage /= laborSum; v.laborCoop /= laborSum;
  }

  // —— 劳动关系漂移 ——
  // 强制劳动：战争记忆注入，国家能力与启蒙抑制
  const forcedIn = w.civ.warMemory * 0.02;
  const forcedOut = v.stateCapacity * 0.004 * (1 - (v.ownPrivate > 0.5 ? 0.5 : 0)) + w.civ.enlightenment * 0.004 + 0.001;
  v.laborForced = clamp01(v.laborForced + forcedIn - forcedOut);
  w.civ.warMemory *= 0.93;
  // 依附劳动：土地集中推动，市场与工业侵蚀
  v.laborBonded = clamp01(v.laborBonded
    + v.landConcentration * 0.005 * surplus - v.market * 0.004 - Math.max(0, lvl('industry') - 1) * 0.005 - 0.001);
  // 雇佣劳动：市场与工业推动
  v.laborWage = clamp01(v.laborWage + v.market * 0.006 + Math.max(0, lvl('industry') - 1) * 0.008 - 0.002);
  // 合作劳动：启蒙思想、组织能力与公共性推动；无输入则缓慢衰减
  v.laborCoop = clamp01(v.laborCoop + w.civ.enlightenment * 0.006 + v.orgCommon * 0.003 + v.ownPublic * 0.003 - 0.0015);

  // —— 土地集中 ——
  const reformPull = v.participation * 0.004 + (v.unrest > 0.6 ? 0.003 : 0);
  v.landConcentration = clamp01(v.landConcentration
    + v.ownPrivate * (0.0025 + surplus * 0.002) - reformPull
    + (macro.foodRatio < 0.9 ? -0.002 : 0)); // 饥荒中小农破产与土地抛售并存，净效轻微

  // —— 收入与财富分配 ——
  // 劳动收入份额由劳动关系与所有制共同决定：原始公社中平民占大头，
  // 封建/奴隶制下精英攫取更多，资本主义取决于劳资力量对比
  const laborShare = 0.42 + v.laborWage * 0.25 + v.laborCoop * 0.2 - v.laborForced * 0.4 - v.laborBonded * 0.25
    + v.orgCommon * 0.05 + v.ownCommon * 0.3 - v.ownPrivate * 0.1;
  const stateShare = v.stateCapacity * (0.1 + v.publicServices * 0.22);
  let eliteShare = 1 - Math.max(0.12, laborShare) - stateShare;
  eliteShare = Math.max(0.06, Math.min(0.68, eliteShare));
  // 财富向收入缓慢收敛（资产增值偏向精英）
  v.wealthCommon += ((Math.max(0.12, laborShare) * 0.9) - v.wealthCommon) * 0.055;
  v.wealthElite += (eliteShare * 1.18 - v.wealthElite) * 0.055;
  v.wealthMiddle = Math.max(0.05, 1 - v.wealthCommon - v.wealthElite);
  v.wealthCommon = Math.max(0.05, 1 - v.wealthElite - v.wealthMiddle);

  // —— 环境与资源压力 ——
  const forestLoss = w.settlements.reduce((a, s) => a + s.population, 0) * 0.00003 * Math.max(1, lvl('industry'));
  v.environment = clamp01(v.environment - forestLoss - Math.max(0, lvl('industry') - 1) * 0.004 + 0.003);
  const pressureFromLand = pop > 0 ? clamp01((pop / (w.settlements.filter(s => !s.dead).reduce((a, s) => a + s.radius * s.radius * Math.PI * 0.22, 1) * 26 + 40)) - 0.55) : 0;
  v.resourcePressure = clamp01(v.resourcePressure * 0.92 + pressureFromLand * 0.4 + (macro.foodRatio < 0.95 ? 0.15 : 0));

  // —— 组织能力 ——
  v.orgCommon = clamp01(v.orgCommon + v.education * 0.006 + macro.urbanization * 0.008 + w.civ.enlightenment * 0.008 - v.laborForced * 0.003 - 0.003);
  v.orgElite = clamp01(v.orgElite + v.stateCapacity * 0.006 + v.market * 0.004 - 0.002);

  // —— 信任与参与 ——
  const trustTarget = clamp01(0.3 + v.publicServices * 0.3 + v.participation * 0.2 - v.unrest * 0.25 - v.laborForced * 0.2 + (macro.foodRatio > 1.15 ? 0.1 : -0.1));
  v.trust += (trustTarget - v.trust) * 0.12;
  // 政治参与受国家能力承载上限约束
  const partCap = 0.06 + v.stateCapacity * 0.55 + lvl('governance') * 0.05;
  const partTarget = clamp01(Math.min(partCap,
    v.education * 0.5 + macro.urbanization * 0.3 + w.civ.enlightenment * 0.3 + lvl('governance') * 0.04 - v.laborForced * 0.3));
  v.participation += (partTarget - v.participation) * 0.1;

  // —— 冲突风险 ——
  const famineMemory = w.settlements.reduce((a, s) => a + (s.shortageYears > 0 ? 0.12 : 0), 0);
  const unrestTarget = clamp01(0.05
    + Math.max(0, v.wealthElite - 0.42) * 0.8
    + Math.max(0, v.landConcentration - 0.45) * 0.5
    + Math.max(0, v.resourcePressure - 0.45) * 0.5
    + famineMemory
    + v.laborForced * 0.3 + v.laborBonded * 0.12
    + w.civ.warMemory * 0.15
    + (1 - v.trust) * 0.2
    - v.participation * 0.3 - v.publicServices * 0.35 - v.education * 0.1);
  v.unrest += (unrestTarget - v.unrest) * 0.22 + (w.rng.next() - 0.5) * 0.02;
  v.unrest = clamp01(v.unrest);
}
