/**
 * 聚落命名 — 音节拼合的古朴中文风地名。
 * v2.0：名称随聚落阶段演进（部落 → 村 → 镇 → 城），文明整体称谓随社会形态演进。
 */
import { STAGE_SUFFIXES, type SettlementStage, type SocietyForm, type Rng } from './types';

const PREFIX = ['河', '谷', '林', '石', '泉', '原', '丘', '泽', '川', '山', '青', '白', '金', '沙', '风'];
const MIDDLE = ['阳', '溪', '湾', '坡', '岗', '甸', '滩', '林', '岭', '塘', '原', '口'];

/** 去掉名称中的阶段后缀，保留专名部分 */
function stripStageSuffix(name: string): string {
  const suffixes = ['部落', '寨', '村', '屯', '庄', '镇', '城', '都'];
  for (const s of suffixes) {
    if (name.length > s.length && name.endsWith(s)) return name.slice(0, -s.length);
  }
  return name;
}

/** 用确定性哈希从列表选择（避免消耗模拟 RNG） */
function pickByHash(text: string, list: string[]): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return list[(h >>> 0) % list.length];
}

export function settlementName(rng: Rng, stage: string, used: Set<string>): string {
  const suffixPool = STAGE_SUFFIXES[(stage as SettlementStage) ?? 'camp'] ?? ['部落', '寨'];
  for (let i = 0; i < 60; i++) {
    const name = rng.pick(PREFIX) + rng.pick(MIDDLE) + rng.pick(suffixPool);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `无名之地${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

/**
 * 聚落升/降级时更新名称后缀（部落 → 村 → 镇 → 城）。
 * 名称中的专名（如"河阳"）保持不变，保证历史连续性。
 */
export function renameForStage(name: string, stage: SettlementStage, used: Set<string>): string {
  const base = stripStageSuffix(name);
  const suffixPool = STAGE_SUFFIXES[stage] ?? ['部落'];
  let next = base + pickByHash(base, suffixPool);
  let guard = 0;
  while (used.has(next) && guard++ < 20) {
    next = base + pickByHash(base + guard, suffixPool);
  }
  if (name !== next) {
    used.delete(name);
    used.add(next);
  }
  return next;
}

/**
 * 文明整体的政治实体称谓（随社会形态 + 最大聚落规模演进）。
 * 用于顶栏与编年史叙事，让"国家"概念随历史出现。
 */
export function civEntityName(form: SocietyForm, largestStage: SettlementStage, settlementCount: number): string {
  switch (form) {
    case 'primitive':
      return settlementCount > 4 ? '部落联盟' : '部族';
    case 'slave':
      return largestStage === 'city' ? '王国' : largestStage === 'town' ? '早期王国' : '酋邦';
    case 'feudal':
      return largestStage === 'city' ? '王朝' : '封建领邑';
    case 'capitalist':
      return largestStage === 'city' ? '共和国' : '商业共和国';
    case 'socialist':
      return '人民联盟';
    case 'collapsed':
      return '——';
  }
}

export const WORLD_TITLES = [
  '新大地', '摇篮', '长河', '初火', '晨星', '群丘', '绿洲', '丰饶之土', '试验场', '源野',
];
