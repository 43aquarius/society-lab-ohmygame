/**
 * InstitutionSystem — 所有制、劳动关系与财富分配
 * 收入份额由劳动制度决定，财富份额向收入份额缓慢收敛；
 * 制度变量的漂移由经济结构、技术与冲突共同驱动，而非固定科技升级路线。
 *
 * v2.0 历史合理性修正：
 * - 漂移全面放缓且带前置（雇佣劳动需要工业，依附劳动需要高农业剩余与土地集中）
 * - 时代建筑（神庙/庄园/城堡/学堂/银行/剧场/医院）成为制度变量的物质载体
 */
import type { WorldState, Civilization } from '../types';
import { BuildingKind } from '../types';
import { macroEconomy } from './economy';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 统计某类建成建筑总数（本文明的聚落） */
function countBuilt(w: WorldState, civ: Civilization, kind: BuildingKind): number {
  let n = 0;
  for (const s of w.settlements) {
    if (s.dead || s.civId !== civ.id) continue;
    for (const b of s.buildings) if (b.kind === kind && b.progress >= 1) n++;
  }
  return n;
}

/** 年度制度漂移 + 财富分配结算（按文明）。 */
export function tickInstitutions(w: WorldState, civ: Civilization): void {
  const v = civ.vars;
  const t = civ.tech.levels;
  const lvl = (d: string) => t[d] ?? 1;
  const macro = macroEconomy(w, civ);

  // —— 派生基础 ——
  const pop = macro.population;
  const surplus = clamp01((macro.surplusRatio - 1) * 1.8); // 0..1 剩余程度
  v.specialization = clamp01(
    0.06 + lvl('crafting') * 0.045 + v.market * 0.22 + macro.urbanization * 0.3 + Math.max(0, lvl('industry') - 1) * 0.09
  );
  v.livingStandard = clamp01(
    0.15 + (macro.foodRatio - 1) * 0.5 + Math.max(0, lvl('industry') - 1) * 0.09 + v.publicServices * 0.2 - v.resourcePressure * 0.2
  );

  // —— 时代建筑（制度的物质载体）——
  const temples = countBuilt(w, civ, BuildingKind.Temple);
  const manors = countBuilt(w, civ, BuildingKind.Manor);
  const castles = countBuilt(w, civ, BuildingKind.Castle);
  const academies = countBuilt(w, civ, BuildingKind.Academy);
  const banks = countBuilt(w, civ, BuildingKind.Bank);
  const theaters = countBuilt(w, civ, BuildingKind.Theater);
  const hospitals = countBuilt(w, civ, BuildingKind.Hospital);

  // 市场发育：商贸技术 + 城市化 + 贸易路线 + 银行催化——
  // v4.0：市场的普遍化以世纪计（商品经济侵蚀自然经济是数百年进程），
  // 这为封建的自然经济留出真实的历史窗口
  // 贸易路线的影响次线性（本地市场消化力有限）
  const tradeRoutes = Math.pow(Math.min(10, Math.max(0, macro.settlementCount - 1) + civ.met.length), 0.55); // 文明间贸易同样滋养市场
  const marketPull = (lvl('commerce') >= 2 ? Math.max(0, lvl('commerce') - 1) * 0.0022 : 0)
    + macro.urbanization * 0.0014 + tradeRoutes * 0.0009
    + (lvl('industry') >= 2 ? 0.005 : 0) + banks * 0.004;
  v.market = clamp01(v.market + marketPull - 0.009);
  // 国家能力：治理技术 + 公廨 + 神庙（合法性）+ 城堡（暴力机器）——发展需要数百年
  const adminCount = countBuilt(w, civ, BuildingKind.Admin);
  v.stateCapacity = clamp01(v.stateCapacity
    + lvl('governance') * 0.0035 + adminCount * 0.005 + temples * 0.004 + castles * 0.003
    + macro.urbanization * 0.002 - 0.003);
  // 教育与公共服务：学堂/医院承载（合作社的贡献打折——它们在多种社会形态中都存在）
  const servicesCount = countBuilt(w, civ, BuildingKind.Services) + countBuilt(w, civ, BuildingKind.Hospital) + countBuilt(w, civ, BuildingKind.Cooperative) * 0.4;
  const eduCap = 0.10 + lvl('education') * 0.08 + academies * 0.05;
  v.education = clamp01(v.education + (eduCap - v.education) * 0.018 + hospitals * 0.002 - 0.0008);
  v.publicServices = clamp01(v.publicServices
    + servicesCount * 0.011 + v.stateCapacity * (v.participation * 0.012 + 0.003) - 0.007);

  // —— 所有制漂移 ——
  // 私有化：市场、土地集中、庄园、工业共同推动；
  // v4.0：农业革命本身即私有化的起源——牲畜、农具与储粮天然可家庭占有
  // （粮食→牲畜→土地→仆从的历史链条，先于商品市场千年）
  const privatePull = v.market * 0.004 + v.landConcentration * 0.003 + manors * 0.004
    + Math.max(0, lvl('industry') - 1) * 0.004
    + (lvl('agriculture') >= 3 ? surplus * 0.010 : 0)
    + (lvl('agriculture') >= 5 ? surplus * 0.006 : 0);
  // 公有化需要社会主义意识的政治觉醒（高文教 + 高参与），否则国家能力只是“官府”而非公有部门
  const publicPull = ((v.participation > 0.45 && v.education > 0.35) ? v.stateCapacity * 0.0022 : 0)
    + (v.laborCoop > 0.35 ? 0.004 : 0)
    + (civ.groups.find(g => g.id === 'commoners')?.ideas ?? 0) * 0.003;
  // 强制劳动意味着对人的私人占有，推动私有化（奴隶制路径的制度反馈）
  const forcedPull = v.laborForced * 0.0024;
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

  // —— 劳动关系漂移（v2.0：带技术前置 + 饱和因子，混合形态长期共存）——
  // 强制劳动：战争记忆注入（奴隶制的引擎），国家能力与启蒙抑制
  // v4.0：奴隶制的三重起源（历史唯物主义）：
  // 1. 战争俘虏经济（warMemory 是主要引擎，一代人的战争阴影）
  // 2. 农业剩余 + 贫富分化产生的债务奴役（雅典罗马式）
  // 3. 奴隶劳动一旦成规模即成为贵族的依赖（制度惯性）
  const forcedIn = civ.warMemory * 0.035
    + (lvl('agriculture') >= 3 && surplus > 0.15 && v.wealthElite > 0.3 && v.market < 0.4 ? 0.0025 * (0.4 + surplus) : 0)
    + (lvl('agriculture') >= 4 && v.market < 0.35 ? 0.003 * (0.3 + surplus) : 0)
    + (v.laborForced > 0.08 ? 0.002 : 0)
    + (lvl('agriculture') >= 4 ? 0.0008 : 0);
  const forcedOut = v.stateCapacity * 0.0016 * (1 - (v.ownPrivate > 0.5 ? 0.5 : 0)) + civ.enlightenment * 0.003 + 0.0008;
  v.laborForced = clamp01(v.laborForced + (forcedIn - forcedOut) * (1 - v.laborForced * 0.75));
  civ.warMemory *= 0.985; // 战争阴影持续一代人
  // 依附劳动：农业剩余 + 土地集中 + 庄园推动；市场与工业侵蚀
  // v4.0：依附劳动在农业社会早期萌芽（农业>=3），市场兴起前是自然的历史阶段
  // v4.0：依附三重来源——土地集中催生佃附 + 自然经济下人身托庇 + 庄园载体
  const bondedIn = (lvl('agriculture') >= 3 ? v.landConcentration * 0.009 * (0.4 + surplus) : 0)
    + (lvl('agriculture') >= 3 && v.market < 0.3 ? 0.0035 * (0.3 + surplus) : 0)
    + manors * 0.006;
  v.laborBonded = clamp01(v.laborBonded + (bondedIn - v.market * 0.003 - Math.max(0, lvl('industry') - 1) * 0.004 - 0.0006) * (1 - v.laborBonded * 0.75));
  // 雇佣劳动：工业与市场推动（工业 < 2 时几乎不增长——前现代的雇佣关系始终是边缘）
  const wageIn = (lvl('industry') >= 2 ? v.market * 0.0045 + Math.max(0, lvl('industry') - 1) * 0.006 : v.market * 0.0008)
    + banks * 0.0025;
  v.laborWage = clamp01(v.laborWage + (wageIn - 0.0013) * (1 - v.laborWage * 0.8));
  // 合作劳动：启蒙思想、组织能力与公共性推动，且受文教水平缩放（无文化的合作只是亲缘互助）
  v.laborCoop = clamp01(v.laborCoop + (civ.enlightenment * 0.005 + v.orgCommon * 0.0026 + v.ownPublic * 0.0026) * (0.3 + v.education) - 0.0013 * (0.4 + v.education));

  // —— 土地集中（v2.0：需要高农业剩余；庄园是引擎）——
  const reformPull = v.participation * 0.0035 + (v.unrest > 0.6 ? 0.0025 : 0);
  v.landConcentration = clamp01(v.landConcentration
    + (lvl('agriculture') >= 4 ? v.ownPrivate * (0.003 + surplus * 0.003) + manors * 0.0045 : 0)
    - reformPull
    + (macro.foodRatio < 0.9 ? -0.002 : 0)); // 饥荒中小农破产与土地抛售并存，净效轻微

  // —— 收入与财富分配 ——
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
  const forestLoss = w.settlements.filter(s => !s.dead && s.civId === civ.id).reduce((a, s) => a + s.population, 0) * 0.00003 * Math.max(1, lvl('industry'));
  v.environment = clamp01(v.environment - forestLoss - Math.max(0, lvl('industry') - 1) * 0.004 + 0.003);
  const pressureFromLand = pop > 0 ? clamp01((pop / (w.settlements.filter(s => !s.dead && s.civId === civ.id).reduce((a, s) => a + s.radius * s.radius * Math.PI * 0.16, 1) * 26 + 40)) - 0.35) : 0;
  v.resourcePressure = clamp01(v.resourcePressure * 0.92 + pressureFromLand * 0.4 + (macro.foodRatio < 0.95 ? 0.15 : 0));

  // —— 组织能力 ——
  v.orgCommon = clamp01(v.orgCommon + v.education * 0.005 + macro.urbanization * 0.007 + civ.enlightenment * 0.007 - v.laborForced * 0.0025 - 0.0025);
  v.orgElite = clamp01(v.orgElite + v.stateCapacity * 0.005 + v.market * 0.0035 + manors * 0.002 - 0.0018);

  // —— 信任与参与 ——
  const trustTarget = clamp01(0.3 + v.publicServices * 0.3 + v.participation * 0.2 - v.unrest * 0.25 - v.laborForced * 0.2 + (macro.foodRatio > 1.15 ? 0.1 : -0.1));
  v.trust += (trustTarget - v.trust) * 0.12;
  // 政治参与受国家能力承载上限约束
  const partCap = 0.06 + v.stateCapacity * 0.55 + lvl('governance') * 0.05;
  const partTarget = clamp01(Math.min(partCap,
    v.education * 0.5 + macro.urbanization * 0.3 + civ.enlightenment * 0.3 + lvl('governance') * 0.04 - v.laborForced * 0.3));
  v.participation += (partTarget - v.participation) * 0.1;

  // —— 冲突风险 ——
  const famineMemory = w.settlements.filter(s => !s.dead && s.civId === civ.id).reduce((a, s) => a + (s.shortageYears > 0 ? 0.12 : 0), 0);
  const unrestTarget = clamp01(0.05
    + Math.max(0, v.wealthElite - 0.42) * 0.8
    + Math.max(0, v.landConcentration - 0.45) * 0.5
    + Math.max(0, v.resourcePressure - 0.45) * 0.5
    + famineMemory
    + v.laborForced * 0.3 + v.laborBonded * 0.12
    + civ.warMemory * 0.15
    + (1 - v.trust) * 0.2
    - v.participation * 0.3 - v.publicServices * 0.35 - v.education * 0.1 - theaters * 0.015);
  v.unrest += (unrestTarget - v.unrest) * 0.22 + (w.rng.next() - 0.5) * 0.02;
  v.unrest = clamp01(v.unrest);
}
