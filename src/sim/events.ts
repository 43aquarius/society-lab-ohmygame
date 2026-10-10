/**
 * EventSystem — 条件触发 + 结果计算 + 叙事呈现
 * 每个事件由真实模拟变量触发，效果回写世界状态（不是随机文字）。
 * 事件记录原因与结果，进入编年史。
 */
import { Terrain, type WorldState, type EventRecord, type EventCategory, type Settlement } from '../types';
import { tileAt } from '../worldgen';
import { macroEconomy } from './economy';
import { housingCapacity } from './population';
import { TECH_NAMES, TechDomain } from '../types';
import { INVENTIONS } from './technology';

interface EventDef {
  id: string;
  title: (w: WorldState, ctx: EventCtx) => string;
  category: EventCategory;
  cooldown: number;
  condition: (w: WorldState, ctx: EventCtx) => boolean;
  weight: (w: WorldState, ctx: EventCtx) => number;
  apply: (w: WorldState, ctx: EventCtx) => { text: string; causes: string[]; effects: string[]; severity: number; settlementId?: number };
}

export interface EventCtx {
  /** 本年跨级的技术（发明事件用） */
  levelUps: { domain: TechDomain; level: number }[];
  /** 本年阶段跃迁的聚落 */
  stageUps: number[];
  /** v4.0：事件所属文明（所有 w.civ 引用改为 ctx.civ） */
  civ: import('../types').Civilization;
  macro: ReturnType<typeof macroEconomy>;
  cooldowns: Map<string, number>;
}

/** 每世界独立的事件冷却表（WeakMap 挂到世界实例，互不污染；读档后重置属可接受行为） */
const cooldownStore = new WeakMap<WorldState, Map<string, number>>();

export function freshCtx(w: WorldState, civ: import('../types').Civilization, levelUps: { domain: TechDomain; level: number }[], stageUps: number[]): EventCtx {
  let cds = cooldownStore.get(w);
  if (!cds) { cds = new Map(); cooldownStore.set(w, cds); }
  return { levelUps, stageUps, civ, macro: macroEconomy(w, civ), cooldowns: cds };
}

const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export const EVENT_DEFS: EventDef[] = [
  {
    id: 'bountiful-harvest',
    title: () => '丰收之年',
    category: 'harvest', cooldown: 6,
    condition: (w, c) => c.macro.foodRatio > 1.3 && c.civ.vars.unrest < 0.5,
    weight: (w, c) => (c.macro.foodRatio - 1.3) * 4 + 0.5,
    apply: (w, c) => {
      const bonus = c.macro.population * 0.35;
      for (const s of w.settlements) if (!s.dead && s.civId === c.civ.id) s.food += bonus / Math.max(1, c.macro.settlementCount);
      c.civ.vars.trust = Math.min(1, c.civ.vars.trust + 0.05);
      return {
        text: `风调雨顺，仓廪充实。各族感谢土地的馈赠，举行了一场盛大的丰收祭。`,
        causes: [`粮食产量达到需求的${pct(c.macro.foodRatio)}`],
        effects: [`各仓新增存粮 ${fmt(bonus)}`, '社会信任小幅上升'],
        severity: 0.3,
      };
    },
  },
  {
    id: 'famine',
    title: () => '饥荒蔓延',
    category: 'famine', cooldown: 4,
    condition: (w, c) => c.macro.foodRatio < 0.95,
    weight: (w, c) => (0.95 - c.macro.foodRatio) * 8 + 0.8,
    apply: (w, c) => {
      const v = c.civ.vars;
      v.unrest = Math.min(1, v.unrest + 0.18);
      v.resourcePressure = Math.min(1, v.resourcePressure + 0.1);
      v.trust = Math.max(0, v.trust - 0.07);
      const worst = [...w.settlements].filter(s => !s.dead && s.civId === c.civ.id).sort((a, b) => a.shortageYears - b.shortageYears).pop();
      if (worst) worst.lastFamine = w.year;
      return {
        text: `粮仓见了底，田野里都是挖野菜的人。长者们说，从没见过这样的年景。`,
        causes: [
          `粮食产出仅及需求的${pct(c.macro.foodRatio)}`,
          `存粮 ${fmt(c.macro.foodStock)} 人·年`,
          v.resourcePressure > 0.5 ? '人口对土地的压力长期偏高' : '连年消耗超过了产出',
        ],
        effects: ['死亡率上升（见人口结算）', '冲突风险上升', '可能触发迁徙'],
        severity: Math.min(1, (0.95 - c.macro.foodRatio) * 5),
        settlementId: worst?.id,
      };
    },
  },
  {
    id: 'plague',
    title: () => '疫病流行',
    category: 'plague', cooldown: 10,
    condition: (w, c) => c.macro.population > 220 && (c.civ.tech.levels.medicine ?? 1) < 4,
    weight: (w, c) => Math.min(3, c.macro.population / 900) + (c.macro.urbanization > 0.3 ? 0.8 : 0),
    apply: (w, c) => {
      const med = c.civ.tech.levels.medicine ?? 1;
      const lethality = Math.max(0.02, 0.05 - med * 0.008 - c.civ.vars.publicServices * 0.012);
      const alive = w.settlements.filter(s => !s.dead && s.civId === c.civ.id);
      const s = alive.length ? w.rng.pick(alive) : null;
      if (!s) return { text: '', causes: [], effects: [], severity: 0 };
      // 持续性疫病：未来数年逐年减员，玩家可用神力净化
      const existing = w.activeEvents.find(ae => ae.id === 'plague-outbreak' && ae.data.settlementId === s.id);
      if (!existing) {
        w.activeEvents.push({ id: 'plague-outbreak', year: w.year, yearsLeft: 3, data: { lethality, settlementId: s.id } });
      }
      c.civ.vars.unrest = Math.min(1, c.civ.vars.unrest + 0.1);
      return {
        text: `高热与咳嗽在${s.name}拥挤的居所之间传播。医者束手，人们焚香祈祷。疫病恐怕还将持续数年。`,
        causes: [
          `聚居规模（总人口 ${fmt(c.macro.population)}，${s.name} ${s.population} 人）`,
          `医道技术 ${med} 级，公共卫生 ${pct(c.civ.vars.publicServices)}`,
        ],
        effects: [`未来数年每年约 ${pct(lethality)} 人口死亡（可净化）`, '冲突风险上升'],
        severity: lethality * 20,
        settlementId: s.id,
      };
    },
  },
  {
    id: 'flood',
    title: () => '山洪暴发',
    category: 'disaster', cooldown: 8,
    condition: (w, c) => w.settlements.some(s => !s.dead && s.civId === c.civ.id && nearMountain(w, s)),
    weight: (w, c) => 0.5 + countNearMountain(w, c.civ) * 0.15,
    apply: (w, c) => {
      const targets = w.settlements.filter(s => !s.dead && s.civId === c.civ.id && nearMountain(w, s));
      const s = w.rng.pick(targets);
      // 洪水优先冲毁低处的农田与仓储
      const destroyed = s.buildings.filter(b => b.progress >= 1)
        .sort((a, b) => (a.kind === 'farm' ? -1 : a.kind === 'granary' ? -0.5 : 0) - (b.kind === 'farm' ? -1 : b.kind === 'granary' ? -0.5 : 0));
      const n = Math.min(destroyed.length, 2 + w.rng.int(2));
      const names: string[] = [];
      for (let i = 0; i < n; i++) {
        const b = destroyed[i];
        const idx = s.buildings.indexOf(b);
        if (idx >= 0) { s.buildings.splice(idx, 1); names.push(b.kind === 'farm' ? '农田' : b.kind === 'granary' ? '粮仓' : '建筑'); }
      }
      const dead = Math.round(s.population * w.rng.range(0.01, 0.04));
      s.population -= dead;
      s.food *= 0.7;
      return {
        text: `山间的暴雨汇成浊流，漫过河床冲进${s.name}。${n > 0 ? `浑水退去后，${names.join('、')}只余下泥泞的残迹。` : '田垄成了一片泽国。'}`,
        causes: ['聚落邻近山地', '降水异常集中'],
        effects: [...(n > 0 ? [`${n} 处设施被毁`] : []), `${dead} 人遇难`, '存粮受损'],
        severity: 0.5,
        settlementId: s.id,
      };
    },
  },
  {
    id: 'invention',
    title: (w, c) => {
      const up = c.levelUps[0];
      const inv = INVENTIONS[up.domain]?.find(i => i.level === up.level);
      return inv ? `发明：${inv.name}` : `${TECH_NAMES[up.domain]}之学精进`;
    },
    category: 'invention', cooldown: 0,
    condition: (_w, c) => c.levelUps.length > 0,
    weight: (_w, c) => 2 + c.levelUps.length,
    apply: (w, c) => {
      const results: string[] = [];
      for (const up of c.levelUps) {
        const inv = INVENTIONS[up.domain]?.find(i => i.level === up.level);
        results.push(inv ? inv.text : `${TECH_NAMES[up.domain]}达到 ${up.level} 级，相关生产得到改进。`);
      }
      return {
        text: results.join(''),
        causes: [`知识点累计 ${Math.round(c.civ.tech.points)}`, `文教水平 ${pct(c.civ.vars.education)}`],
        effects: c.levelUps.map(u => `${TECH_NAMES[u.domain]} → ${u.level} 级`),
        severity: 0.25,
      };
    },
  },
  {
    id: 'trade-boom',
    title: () => '商路贯通',
    category: 'trade', cooldown: 14,
    condition: (w, c) => (c.civ.tech.levels.commerce ?? 1) >= 2 && c.macro.settlementCount >= 2,
    weight: (w, c) => c.civ.vars.market * 2.4,
    apply: (w, c) => {
      const v = c.civ.vars;
      v.market = Math.min(1, v.market + 0.025); // v4.0：市场的普遍化以世纪计
      v.wealthMiddle = Math.min(0.6, v.wealthMiddle + 0.03);
      for (const s of w.settlements) if (!s.dead && s.civId === c.civ.id) { s.wood += 6; s.stone += 4; }
      return {
        text: c.civ.met.length
          ? `远方的异邦商队带来了别处的物产与见闻，也把本地的余粮运向四方。两条文明的道路自此交织。`
          : `远来的商队带来了别处的物产与见闻，也把本地的余粮运向四方。`,
        causes: [`商贸技术 ${(c.civ.tech.levels.commerce ?? 1)} 级`, `共 ${c.macro.settlementCount} 处聚落互通有无`],
        effects: ['市场发育度 +6%', '中产财富份额上升', '各地获得少量物资'],
        severity: 0.2,
      };
    },
  },
  {
    id: 'wealth-gap',
    title: () => '贫富分化加剧',
    category: 'wealth', cooldown: 7,
    condition: (w, c) => c.civ.vars.wealthElite > 0.5,
    weight: (w, c) => (c.civ.vars.wealthElite - 0.5) * 6,
    apply: (w, c) => {
      const v = c.civ.vars;
      v.unrest = Math.min(1, v.unrest + 0.08);
      v.orgCommon = Math.min(1, v.orgCommon + 0.02);
      return {
        text: `谷仓满溢的宅院与典当最后一袋种子的农户出现在同一片土地上。人们在私下议论这不公。`,
        causes: [`精英财富份额 ${pct(v.wealthElite)}`, `土地集中度 ${pct(v.landConcentration)}`],
        effects: ['冲突风险上升', '底层组织意识萌发'],
        severity: (v.wealthElite - 0.4) * 2,
      };
    },
  },
  {
    id: 'war-skirmish',
    title: () => '聚落冲突',
    category: 'war', cooldown: 9,
    // v2.0：除了资源压力，领地毗邻本身就是战争的温床（历史上的部落战争如此）
    // v4.0：部落/文明战争不要求己方多聚落——与异邦的领地摩擦同样爆发战争
    condition: (w, c) => (c.macro.settlementCount >= 2 || c.civ.met.length > 0)
      && (c.civ.vars.resourcePressure > 0.18 || c.macro.foodRatio < 1.15 || hasCloseNeighbors(w, c.civ) || c.civ.warMemory > 0.1),
    weight: (w, c) => c.civ.vars.resourcePressure * 2.6 + (hasCloseNeighbors(w, c.civ) ? 1.2 : 0) + c.civ.warMemory * 1.5 + (c.civ.vars.stateCapacity > 0.5 ? -0.6 : 0.7),
    apply: (w, c) => {
      const alive = w.settlements.filter(s => !s.dead && s.civId === c.civ.id);
      if (alive.length < 1) return { text: '', causes: [], effects: [], severity: 0 };
      // 跨文明战争：已接触的异邦近邻是更危险的猎物（历史上异族征伐与掠奴如此）
      let b: typeof alive[number];
      const foreignTargets = w.settlements.filter(s => !s.dead && s.civId !== c.civ.id && c.civ.met.includes(s.civId));
      const a = w.rng.pick(alive);
      if (foreignTargets.length && w.rng.chance(0.4)) {
        b = w.rng.pick(foreignTargets);
      } else {
        b = w.rng.pick(alive.filter(s => s !== a).length ? alive.filter(s => s !== a) : alive);
      }
      const dead = Math.round(Math.min(a.population, b.population) * w.rng.range(0.02, 0.06));
      a.population -= dead; b.population -= Math.round(dead * 0.8);
      const captives = Math.round(Math.min(a.population, b.population) * w.rng.range(0.02, 0.05));
      const winner = a.population >= b.population ? a : b;
      const loser = winner === a ? b : a;
      loser.population -= captives;
      winner.population += Math.round(captives * 0.4);
      c.civ.warMemory = Math.min(1, c.civ.warMemory + 0.45);
      c.civ.vars.laborForced = Math.min(0.9, c.civ.vars.laborForced + 0.07 + captives / Math.max(1, c.macro.population) * 2.5);
      return {
        text: a.civId !== b.civId
          ? `${a.name}与异邦的${b.name}在边界刀兵相向——不同文明的碰撞比同族械斗更加酷烈。胜者带走了俘虏与战利品。`
          : `为争夺草场与水源，${a.name}与${b.name}的青壮在边界械斗。胜者带走了俘虏——他们的命运将成为这个社会下一个转折的伏笔。`,
        causes: [`资源压力 ${pct(c.civ.vars.resourcePressure)}`, `粮食仅够 ${pct(c.macro.foodRatio)}，缺乏协调机制`],
        effects: [`双方约 ${dead + Math.round(dead * 0.8)} 人死亡`, `${captives} 名俘虏进入强制劳动`, '战争记忆加深'],
        severity: 0.6,
        settlementId: winner.id,
        aux: { attackerId: a.id, defenderId: b.id },
      };
    },
  },
  {
    id: 'new-ideas',
    title: () => '新思潮涌动',
    category: 'ideas', cooldown: 9,
    condition: (w, c) => c.civ.vars.education > 0.25 || c.civ.enlightenment > 0.3,
    weight: (w, c) => c.civ.vars.education * 2 + c.civ.enlightenment * 2,
    apply: (w, c) => {
      const v = c.civ.vars;
      v.participation = Math.min(1, v.participation + 0.05);
      v.orgCommon = Math.min(1, v.orgCommon + 0.04);
      const g = c.civ.groups.find(x => x.id === 'commoners')!;
      g.ideas = Math.min(1, g.ideas + 0.2);
      // 文案随时代变化：无文字的时代在篝火边议论，有城市后在酒馆与印刷所
      const urban = w.settlements.some(s => !s.dead && s.civId === c.civ.id && (s.stage === 'town' || s.stage === 'city'));
      const literate = (c.civ.tech.levels.education ?? 1) >= 3;
      const text = urban && literate
        ? `「凭什么生而不平等？」这样的问题开始在酒馆与作坊里流传。识字的人把疑问印成了传单，在集市上分发。`
        : urban
          ? `「凭什么生而不平等？」这样的问题开始在市井流传，行人驻足倾听。`
          : `「凭什么分肉的多寡由他人说了算？」这样的抱怨在篝火边与井台边悄悄流传，长者们假装没有听见。`;
      return {
        text,
        causes: [`文教 ${pct(v.education)}`, c.civ.enlightenment > 0.2 ? '神启的思想火种' : '识字率与流动性的提高'],
        effects: ['政治参与上升', '平民组织能力上升', '改革诉求增强'],
        severity: 0.3,
      };
    },
  },
  {
    id: 'city-flourish',
    title: (w, c) => `聚落跃迁：${w.settlements.find(s => s.id === c.stageUps[0])?.name ?? ''}步入新阶段`,
    category: 'urban', cooldown: 0,
    condition: (_w, c) => c.stageUps.length > 0,
    weight: () => 5,
    apply: (w, c) => {
      const sid = c.stageUps[0];
      const s = w.settlements.find(x => x.id === sid)!;
      const stageNames: Record<string, string> = { camp: '营地', hamlet: '村落', village: '村庄', town: '城镇', city: '城市' };
      const buildingText: Record<string, string> = {
        camp: '新的帐篷与篝火圈立了起来',
        hamlet: '木屋与仓房相继立起，小径连成了巷',
        village: '新的巷道、仓房与公共空间相继出现',
        town: '作坊、市集与官署拔地而起，人口如百川汇流',
        city: '高墙、学宫与市声喧嚣的街市，一座真正的城市诞生了',
      };
      return {
        text: `${s.name}的规模跨过了门槛，如今它的名字写作「${s.name}」。${buildingText[s.stage]}。`,
        causes: [`人口达到 ${s.population}`],
        effects: [`聚落等级 → ${stageNames[s.stage]}`, '将解锁相应新建筑'],
        severity: 0.35,
        settlementId: s.id,
      };
    },
  },
  {
    id: 'population-milestone',
    title: (w, c) => `人口里程碑：${c.macro.population >= 5000 ? '五千人' : c.macro.population >= 2500 ? '两千五百人' : c.macro.population >= 1000 ? '千人' : c.macro.population >= 500 ? '五百人' : '两百人'}`,
    category: 'achievement', cooldown: 3,
    condition: (w, c) => {
      const p = c.macro.population;
      return (p >= 200 && p < 220) || (p >= 500 && p < 550) || (p >= 1000 && p < 1100) || (p >= 2500 && p < 2750) || (p >= 5000 && p < 5500);
    },
    weight: () => 4,
    apply: (w, c) => {
      return {
        text: `编年史家记下了这个数字：${fmt(c.macro.population)}人。从一支流浪的队伍到如今的人烟，这片土地承载了太多故事。`,
        causes: ['人口持续正增长', `粮食保障率 ${pct(c.macro.foodRatio)}`],
        effects: ['文明知名度提升（叙事性成就）'],
        severity: 0.2,
      };
    },
  },
  {
    id: 'golden-age',
    title: () => '治世',
    category: 'achievement', cooldown: 20,
    condition: (w, c) => c.macro.foodRatio > 1.2 && c.civ.vars.trust > 0.62 && c.civ.vars.unrest < 0.3 && c.macro.population > 300,
    weight: (w, c) => 1 + c.civ.vars.trust,
    apply: (w, c) => {
      const v = c.civ.vars;
      v.trust = Math.min(1, v.trust + 0.04);
      v.education = Math.min(1, v.education + 0.015);
      for (const s of w.settlements) if (!s.dead && s.civId === c.civ.id) s.effects.push({ kind: 'blessing', years: 3, power: 0.15 });
      return {
        text: `仓廪实而民心安。这个时代的孩童比他们的祖辈长得更高，工匠有余暇琢磨技艺，长者说这是罕见的治世。`,
        causes: [`粮食保障率 ${pct(c.macro.foodRatio)}`, `制度信任 ${pct(v.trust)}`, `冲突风险仅 ${pct(v.unrest)}`],
        effects: ['未来三年各聚落产出小幅提升', '文教水平上升'],
        severity: 0.3,
      };
    },
  },
  {
    id: 'migration-wave',
    title: () => '移民潮',
    category: 'migration', cooldown: 12,
    condition: (w, c) => c.macro.housingRatio < 0.75 && c.macro.population > 400,
    weight: (w, c) => (0.75 - c.macro.housingRatio) * 6,
    apply: (w, c) => {
      const crowding = (s: Settlement) => s.population / Math.max(1, housingCapacity(s));
      const crowded = [...w.settlements].filter(s => !s.dead && s.civId === c.civ.id).sort((a, b) => crowding(b) - crowding(a));
      const from = crowded[0] ?? w.settlements.find(s => !s.dead);
      const roomy = [...w.settlements].filter(s => !s.dead && s.civId === c.civ.id && s.id !== from?.id && housingCapacity(s) > s.population * 1.1)
        .sort((a, b) => housingCapacity(b) - housingCapacity(a))[0];
      if (from && roomy) {
        const n = Math.round(Math.min(from.population * 0.06, 30));
        from.population -= n;
        roomy.population += n;
        return {
          text: `${from.name}的巷子太挤了，一些家庭收拾行囊，沿着道路投奔了${roomy.name}。`,
          causes: [`住房覆盖仅 ${pct(c.macro.housingRatio)}`, `${from.name} 人口 ${from.population} 逼近容量`],
          effects: [`${n} 人迁往 ${roomy.name}`, '两地的物资与技艺随之流动'],
          severity: 0.2,
          settlementId: roomy.id,
        };
      }
      return {
        text: `各地都在闹房荒，没有谁家有多余的屋檐收留外人。`,
        causes: [`住房覆盖仅 ${pct(c.macro.housingRatio)}`],
        effects: ['生育率将受抑制'],
        severity: 0.25,
      };
    },
  },
  {
    id: 'collapse-warning',
    title: () => '文明衰退的阴影',
    category: 'urban', cooldown: 12,
    condition: (w, c) => c.macro.foodRatio < 0.85 && c.macro.population < 80,
    weight: () => 3,
    apply: (w, c) => {
      return {
        text: `人口在萎缩，聚落在凋敝。若没有转机，这片土地可能重新归于寂静。`,
        causes: [`人口仅余 ${fmt(c.macro.population)}`, `粮食保障率 ${pct(c.macro.foodRatio)}`],
        effects: ['进入衰退观察（模拟将继续）'],
        severity: 0.8,
      };
    },
  },
];

function nearMountain(w: WorldState, s: { x: number; y: number }): boolean {
  for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
    const t = tileAt(w, s.x + dx, s.y + dy);
    if (t && t.terrain === Terrain.Mountain) return true;
  }
  return false;
}
function countNearMountain(w: WorldState, civ: import('../types').Civilization): number {
  return w.settlements.filter(s => !s.dead && s.civId === civ.id && nearMountain(w, s)).length;
}

/** 是否存在领地毗邻的聚落对（战争的地缘温床） */
function hasCloseNeighbors(w: WorldState, civ: import('../types').Civilization): boolean {
  const alive = w.settlements.filter(s => !s.dead && s.civId === civ.id);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      if (Math.hypot(alive[i].x - alive[j].x, alive[i].y - alive[j].y) < 9) return true;
    }
  }
  return false;
}

/** 年度事件调度：按权重随机挑一个满足条件的事件执行（按文明独立调度） */
export function dispatchEvents(w: WorldState, ctx: EventCtx): EventRecord[] {
  const records: EventRecord[] = [];
  const candidates: { def: EventDef; weight: number }[] = [];
  for (const def of EVENT_DEFS) {
    const cd = ctx.cooldowns.get(def.id) ?? 0;
    if (cd > w.year) continue;
    if (!def.condition(w, ctx)) continue;
    const weight = def.weight(w, ctx);
    if (weight <= 0) continue;
    candidates.push({ def, weight });
  }
  if (!candidates.length) return records;
  // 每年最多 2 个常规事件（发明与跃迁类必发）
  const mustFire = candidates.filter(c => c.def.id === 'invention' || c.def.id === 'city-flourish');
  const rest = candidates.filter(c => !mustFire.includes(c));
  const chosen = [...mustFire];
  if (rest.length && w.rng.chance(0.35 + Math.min(0.3, ctx.civ.vars.unrest))) {
    const total = rest.reduce((a, c) => a + c.weight, 0);
    let roll = w.rng.next() * total;
    for (const c of rest) {
      roll -= c.weight;
      if (roll <= 0) { chosen.push(c); break; }
    }
  }
  for (const { def } of chosen) {
    const r = def.apply(w, ctx);
    ctx.cooldowns.set(def.id, w.year + def.cooldown);
    records.push({
      id: `ev-${w.nextEventId++}`,
      year: w.year,
      civId: ctx.civ.id,
      title: def.title(w, ctx),
      category: def.category,
      text: r.text,
      causes: r.causes,
      effects: r.effects,
      intervened: false,
      settlementId: r.settlementId,
      severity: r.severity,
    });
  }
  return records;
}

/** 供阶段跃迁检测：返回本年跃迁的聚落 id */
export function detectStageUps(w: WorldState, checker: (s: WorldState['settlements'][number]) => boolean): number[] {
  const ups: number[] = [];
  for (const s of w.settlements) {
    if (!s.dead && checker(s)) ups.push(s.id);
  }
  return ups;
}
