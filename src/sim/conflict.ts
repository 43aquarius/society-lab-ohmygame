/**
 * ConflictSystem — 社会矛盾与集体行动
 * 冲突不是随机数：由生存保障、财富/土地集中、劳动制度、组织能力、
 * 国家能力与改革渠道共同决定。同一矛盾允许多种结局。
 */
import type { WorldState, EventRecord, Civilization } from '../types';
import { macroEconomy } from './economy';
import { spawnSplinter } from './population';

export type ConflictOutcome = 'protest' | 'reform' | 'repression' | 'revolt' | 'revolution' | 'fission';

export interface ConflictResult {
  outcome: ConflictOutcome;
  record: Omit<EventRecord, 'id'>;
}

/** 评估并（可能）触发一次集体行动。无行动返回 null。 */
export function evaluateConflict(w: WorldState, civ: Civilization): ConflictResult | null {
  const v = civ.vars;
  const macro = macroEconomy(w, civ);
  if (v.unrest < 0.52) return null;
  // 紧张度越高越可能爆发；随机只影响时机，不影响方向
  const tension = (v.unrest - 0.52) / 0.48;
  if (!w.rng.chance(0.14 + tension * 0.5)) return null;

  const causes: string[] = [];
  if (macro.foodRatio < 1) causes.push('口粮不足');
  if (v.wealthElite > 0.42) causes.push(`精英财富占${Math.round(v.wealthElite * 100)}%`);
  if (v.landConcentration > 0.45) causes.push('土地高度集中');
  if (v.laborForced > 0.25) causes.push('强制劳动普遍');
  if (v.laborBonded > 0.3) causes.push('人身依附沉重');
  if (v.resourcePressure > 0.5) causes.push('资源紧张');
  if (v.participation < 0.25) causes.push('缺乏议政渠道');
  if (causes.length === 0) causes.push('普遍的不满情绪');

  // 结局权重
  const reformable = v.stateCapacity > 0.35 && v.participation > 0.28 && v.orgCommon > 0.25;
  const repressive = v.stateCapacity > 0.4 && v.orgElite > 0.4 && v.orgCommon < 0.45;
  const weights: Record<ConflictOutcome, number> = {
    protest: 3.2 - tension * 1.2,
    reform: reformable ? 2.2 + v.orgCommon * 2.2 : 0.15,
    repression: repressive ? 2.6 : 0.3,
    revolt: v.orgCommon > 0.4 && !repressive ? 1.8 + tension * 1.6 : 0.4,
    revolution: v.orgCommon > 0.62 && v.orgElite < 0.5 && tension > 0.45 ? 1.2 + v.participation : 0.06,
    fission: macro.settlementCount < 8 && w.settlements.some(s => !s.dead && s.civId === civ.id && s.population > 140) && v.unrest > 0.66 ? 1.1 : 0.2,
  };
  let total = 0;
  for (const k of Object.keys(weights) as ConflictOutcome[]) total += weights[k];
  let roll = w.rng.next() * total;
  let outcome: ConflictOutcome = 'protest';
  for (const k of Object.keys(weights) as ConflictOutcome[]) {
    roll -= weights[k];
    if (roll <= 0) { outcome = k; break; }
  }

  const effects: string[] = [];
  switch (outcome) {
    case 'protest':
      v.unrest = Math.max(0, v.unrest - 0.12);
      v.participation = Math.min(1, v.participation + 0.02);
      effects.push('不满得到表达，局势略有缓和', '政治参与小幅上升');
      break;
    case 'reform': {
      v.unrest = Math.max(0, v.unrest - 0.3);
      const dLand = 0.1 + w.rng.next() * 0.08, dForced = 0.08 + w.rng.next() * 0.06;
      v.landConcentration = Math.max(0.05, v.landConcentration - dLand);
      v.laborForced = Math.max(0, v.laborForced - dForced);
      v.laborBonded = Math.max(0, v.laborBonded - dForced * 0.7);
      v.publicServices = Math.min(1, v.publicServices + 0.07);
      v.participation = Math.min(1, v.participation + 0.06);
      v.trust = Math.min(1, v.trust + 0.12);
      effects.push('颁布改革：重新分配部分土地', '强制劳动被限制', '公共服务扩张', '制度信任回升');
      break;
    }
    case 'repression':
      v.unrest = Math.max(0, v.unrest - 0.34);
      v.trust = Math.max(0, v.trust - 0.16);
      v.participation = Math.max(0, v.participation - 0.06);
      v.laborForced = Math.min(1, v.laborForced + 0.03);
      effects.push('抗议被武力驱散', '制度信任受损', '公共参与收缩');
      break;
    case 'revolt': {
      const victim = pickLargest(w, civ);
      if (victim) {
        const loss = Math.round(victim.population * w.rng.range(0.03, 0.09));
        victim.population -= loss;
        // 烧毁建筑
        const burnable = victim.buildings.filter(b => b.kind !== 'camp');
        if (burnable.length > 2) {
          const n = Math.min(burnable.length - 1, 1 + w.rng.int(2));
          for (let i = 0; i < n; i++) victim.buildings.splice(victim.buildings.indexOf(w.rng.pick(burnable)), 1);
          effects.push(`${victim.name} 有 ${n} 处建筑毁于冲突`);
        }
        effects.push(`${victim.name} 约 ${loss} 人死于暴力冲突`);
      }
      v.wealthElite = Math.max(0.1, v.wealthElite - 0.06);
      v.wealthCommon = Math.min(0.85, v.wealthCommon + 0.06);
      v.unrest = Math.max(0, v.unrest - 0.22);
      effects.push('财富分配被暴力重整了一角');
      break;
    }
    case 'revolution': {
      // 革命方向取决于主流思想与生产力阶段（历史唯物主义）：
      // 资产阶级革命需要工业与市场的物质前提；前工业时代的革命
      // 只能走向财产重新分配或公社化（激进方向）
      const bourgeoisPossible = (civ.tech.levels.industry ?? 1) >= 2 && v.market > 0.3;
      const radical = !bourgeoisPossible
        || (civ.groups.find(g => g.id === 'commoners')?.ideas ?? 0) > 0.25
        || v.ownPublic + v.laborCoop > 0.4;
      if (radical) {
        if (civ.form === 'primitive') {
          // 原始社会内部的"革命"：氏族内部的财产与权威重新分配
          v.wealthElite = Math.max(0.05, v.wealthElite - 0.15);
          v.wealthCommon = Math.min(0.9, v.wealthCommon + 0.15);
          v.trust = Math.min(1, v.trust + 0.08);
          v.participation = Math.min(1, v.participation + 0.1);
          effects.push('氏族长老的权威被重新分配', '共有财产得以维持');
        } else {
          v.ownPublic = Math.min(0.9, v.ownPublic + 0.32);
          v.ownPrivate = Math.max(0.05, v.ownPrivate - 0.3);
          v.ownCommon = Math.max(0.02, 1 - v.ownPublic - v.ownPrivate);
          v.laborForced = Math.max(0, v.laborForced * 0.5);
          v.laborBonded = Math.max(0, v.laborBonded * 0.55);
          v.laborCoop = Math.min(0.95, v.laborCoop + 0.28);
          v.laborWage = Math.max(0.03, 1 - v.laborForced - v.laborBonded - v.laborCoop);
          v.participation = Math.min(1, v.participation + 0.2);
          effects.push('生产资料大规模转入公共与合作社', '强制与依附劳动被废除', '政治参与大幅扩展');
        }
      } else {
        v.ownPrivate = Math.min(0.9, v.ownPrivate + 0.25);
        v.ownPublic = Math.max(0.02, v.ownPublic - 0.2);
        v.laborWage = Math.min(0.9, v.laborWage + 0.28);
        v.laborBonded = Math.max(0, v.laborBonded * 0.6);
        v.participation = Math.min(1, v.participation + 0.12);
        effects.push('旧等级特权被废除', '市场与雇佣关系成为主导', '中产阶层崛起掌权');
      }
      v.unrest = Math.max(0, v.unrest - 0.4);
      v.trust = Math.max(0.15, v.trust - 0.08);
      break;
    }
    case 'fission': {
      const big = w.settlements.filter(s => !s.dead && s.civId === civ.id && s.population > 140);
      if (big.length) {
        const ns = spawnSplinter(w, w.rng.pick(big), 18);
        if (ns) {
          ns.effects.push({ kind: 'blessing', years: 2, power: 0.2 });
          effects.push(`一部分人脱离${big.map(s => s.name).join('、')}，建立新聚落 ${ns.name}`);
        }
      }
      v.unrest = Math.max(0, v.unrest - 0.18);
      break;
    }
  }

  const names: Record<ConflictOutcome, string> = {
    protest: '抗议请愿',
    reform: '政治改革',
    repression: '武力镇压',
    revolt: '武装冲突',
    revolution: '革命',
    fission: '地方分立',
  };
  return {
    outcome,
    record: {
      year: w.year,
      civId: civ.id,
      title: `${civ.name} · ${names[outcome]}`,
      category: outcome === 'fission' ? 'migration' : outcome === 'reform' || outcome === 'repression' ? 'politics' : 'war',
      text: `${names[outcome]}在紧张的社会空气中爆发。${effects.join('；')}。`,
      causes,
      effects,
      intervened: false,
      severity: tension,
      settlementId: pickLargest(w, civ)?.id,
    },
  };
}

function pickLargest(w: WorldState, civ: Civilization) {
  let best: WorldState['settlements'][number] | null = null;
  for (const s of w.settlements) {
    if (s.dead || s.civId !== civ.id) continue;
    if (!best || s.population > best.population) best = s;
  }
  return best;
}
