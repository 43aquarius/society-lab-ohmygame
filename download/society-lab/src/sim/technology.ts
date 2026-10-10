/**
 * TechnologySystem — 知识积累与技术发展
 * 知识点 = 人口 × 教育 × 分工 × 稳定。按时代需求权重分配到八个域。
 * 跨越整数等级时产生「发明」事件（由事件系统叙事化）。
 */
import { TechDomain, TECH_NAMES, type WorldState } from '../types';

export const TECH_DOMAINS: TechDomain[] = Object.values(TechDomain);

/** 升到 level 所需累计知识点（level>=2） */
export function techCost(level: number): number {
  if (level <= 1) return 0;
  return Math.round(8 * Math.pow(level - 1, 1.55));
}

/** 域的时代亲和权重：越贴合当前社会需要，分到的知识点越多 */
function domainWeights(w: WorldState): Record<string, number> {
  const t = w.civ.tech.levels;
  const v = w.civ.vars;
  const starving = totalFoodRatio(w) < 1.05;
  return {
    agriculture: 1.6 + (starving ? 1.6 : 0) + t.agriculture * 0.05,
    crafting: 1.2 + v.specialization * 0.8,
    building: 0.8 + Math.min(1, w.settlements.reduce((s, x) => s + x.population, 0) / 600),
    commerce: v.market * 1.2 + (w.settlements.filter(s => !s.dead).length >= 2 ? 0.5 : 0),
    governance: 0.4 + v.stateCapacity * 0.6 + (v.unrest > 0.45 ? 1.2 : 0),
    medicine: 0.5 + (v.livingStandard > 0.4 ? 0.6 : 0),
    industry: t.crafting >= 4 && t.building >= 3 ? 1.4 + v.market * 0.8 : 0,
    education: v.wealthMiddle * 0.8 + v.livingStandard * 0.6,
  };
}

function totalFoodRatio(w: WorldState): number {
  let need = 0, have = 0;
  for (const s of w.settlements) {
    if (s.dead) continue;
    need += Math.max(1, s.population);
    have += s.food + estimateProduction(s, w);
  }
  return need === 0 ? 1 : have / need;
}

/** 粗估年产出（供技术权重与预警，不作为结算依据） */
export function estimateProduction(s: { population: number; buildings: { kind: string }[]; effects: { kind: string; power: number }[] }, w: WorldState): number {
  const farms = s.buildings.filter(b => b.kind === 'farm').length;
  const forage = Math.max(0, s.population * 0.5) * 1.2;
  const agri = 1 + (w.civ.tech.levels.agriculture ?? 0) * 0.18;
  return farms * 8 * agri + forage;
}

/** 年度知识点结算与分配。返回本年跨级的域列表（用于发明事件）。 */
export function tickTechnology(w: WorldState): { domain: TechDomain; level: number }[] {
  const v = w.civ.vars;
  const pop = w.settlements.reduce((s, x) => s + (x.dead ? 0 : x.population), 0);
  const stability = 0.6 + v.trust * 0.4 - v.unrest * 0.25;
  const points = pop * 0.02 * (0.5 + v.education) * (1 + v.specialization * 0.6) * Math.max(0.25, stability)
    + w.civ.enlightenment * 2.2; // 神力启蒙直接注入知识
  w.civ.tech.points += points;
  w.civ.enlightenment *= 0.94;

  const weights = domainWeights(w);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const gained = points / Math.max(0.001, total);
  const levelUps: { domain: TechDomain; level: number }[] = [];
  for (const d of TECH_DOMAINS) {
    w.civ.tech.progress[d] = (w.civ.tech.progress[d] ?? 0) + gained * (weights[d] ?? 0);
    let lvl = w.civ.tech.levels[d] ?? 1;
    while (lvl < 9 && w.civ.tech.progress[d] >= techCost(lvl + 1)) {
      lvl++;
      w.civ.tech.levels[d] = lvl;
      levelUps.push({ domain: d, level: lvl });
    }
  }
  return levelUps;
}

export function techAverage(w: WorldState): number {
  const l = w.civ.tech.levels;
  return TECH_DOMAINS.reduce((a, d) => a + (l[d] ?? 0), 0) / TECH_DOMAINS.length;
}

export function techSummary(w: WorldState): string {
  return TECH_DOMAINS.map(d => `${TECH_NAMES[d]}${w.civ.tech.levels[d] ?? 0}`).join(' · ');
}

/** 各域的等级阈值叙事（发明事件用） */
export const INVENTIONS: Record<string, { level: number; name: string; text: string }[]> = {
  agriculture: [
    { level: 2, name: '驯化谷物的开端', text: '人们发现掉落的种子来年会长出新苗，刀耕火种取代了纯粹的采集。' },
    { level: 3, name: '犁与轮作', text: '弯曲的木犁翻开沃土，田地开始分块轮种。' },
    { level: 5, name: '水利灌溉网', text: '沟渠把河水引向高处的田垄，旱季不再意味着绝收。' },
    { level: 7, name: '选育良种', text: '饱满的穗子被留作种子，产量悄然倍增。' },
  ],
  crafting: [
    { level: 2, name: '磨制石器', text: '打磨过的石斧锋利数倍，伐木与狩猎都变了样。' },
    { level: 3, name: '青铜冶炼', text: '炉火中流出了金绿色的金属，工具史翻开了新页。' },
    { level: 5, name: '铁器普及', text: '廉价而坚硬的铁器进入千家万户。' },
    { level: 7, name: '精密机械', text: '齿轮与发条开始转动，作坊里响起了持续的节奏。' },
  ],
  building: [
    { level: 2, name: '夯土筑基', text: '夯实的土台让房屋经受住了雨季。' },
    { level: 3, name: '榫卯与砖石', text: '不用一钉一铆，梁柱却严丝合缝。' },
    { level: 5, name: '拱券技术', text: '石桥与高墙跨过了河流，城市开始向高处生长。' },
  ],
  commerce: [
    { level: 2, name: '一般等价物', text: '贝壳与谷物成了交换的中介，集市随之兴起。' },
    { level: 3, name: '远途商队', text: '驼铃声开始连接聚落之间的道路。' },
    { level: 5, name: '钱庄票号', text: '纸面的信用开始替代沉甸甸的金属。' },
  ],
  governance: [
    { level: 2, name: '成文律法', text: '刻在石柱上的规则让裁决不再依赖记忆与传闻。' },
    { level: 4, name: '官僚科层', text: '文书与印信把命令传到了最远的村落。' },
    { level: 6, name: '议事制度', text: '重大事务开始有固定的商议程序。' },
  ],
  medicine: [
    { level: 2, name: '草药与包扎', text: '懂得处理伤口的人多了，产褥热不再必然致命。' },
    { level: 4, name: '疫病隔离', text: '染疫者被安置在村外，瘟疫的爪牙被斩断了一节。' },
    { level: 6, name: '公共卫生', text: '清水与排污沟渠让城市不再恶臭。' },
  ],
  industry: [
    { level: 1, name: '水力机械', text: '河流推动了轮盘，生产第一次不依赖肌肉。' },
    { level: 2, name: '蒸汽机', text: '锅炉的轰鸣宣告了一个新时代。' },
    { level: 4, name: '流水线', text: '工序被拆分又重组，标准品源源涌出。' },
    { level: 6, name: '电力网络', text: '夜幕下的城市第一次亮如白昼。' },
  ],
  education: [
    { level: 2, name: '文字记事', text: '符号被刻在陶片上，记忆不再随死亡消散。' },
    { level: 3, name: '学堂', text: '孩童诵读声从公共建筑中传出。' },
    { level: 5, name: '印刷术', text: '知识随纸张飞入了寻常人家。' },
  ],
};
