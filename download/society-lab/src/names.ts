/**
 * 聚落与文明命名 — 音节拼合的古朴中文风地名。
 * v2.0：名称随聚落阶段演进（部落 → 村 → 镇 → 城）。
 * v4.0：每个文明拥有独立的国名/色标/文化气质。
 */
import { STAGE_SUFFIXES, type SettlementStage, type SocietyForm, type Rng } from './types';

const PREFIX = ['河', '谷', '林', '石', '泉', '原', '丘', '泽', '川', '山', '青', '白', '金', '沙', '风'];
const MIDDLE = ['阳', '溪', '湾', '坡', '岗', '甸', '滩', '林', '岭', '塘', '原', '口'];

/** v4.0 文明名（音节拼合 + 后缀，与聚落名风格一致） */
const CIV_PREFIX = ['河', '岳', '松', '漠', '金', '泽', '云', '苍', '雷', '陶', '烬', '桑', '雪', '岚', '旭', '砚', '粟', '越', '峒', '垚'];
const CIV_SUFFIX = ['之邦', '诸部', '列国', '故地', '遗民', '火种', '血脉', '江源', '山裔', '黎明'];

/** v4.0 文明色板（领土/小地图/标签/编年史） */
export const CIV_COLORS = [
  '#e05656', '#e08b3a', '#d4b13c', '#7bb661', '#4fb38a', '#4aa8c4',
  '#5f7fd8', '#8a6fd8', '#c46fb0', '#c47a5a', '#8f9a4e', '#6aa8b8',
];

export function civilizationName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 80; i++) {
    const name = rng.pick(CIV_PREFIX) + rng.pick(['', rng.pick(CIV_PREFIX)]) + rng.pick(CIV_SUFFIX);
    if (!used.has(name)) { used.add(name); return name; }
  }
  const fb = `无名之邦${used.size + 1}`;
  used.add(fb);
  return fb;
}

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
 * 文明的政治实体称谓（随社会形态 + 最大聚落规模演进）。
 * 用于文明面板与编年史叙事，让"国家"概念随历史出现。
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

/** v4.0 世界纪元：由最先进文明的技术水平推导（顶栏展示人类历史进程） */
export function worldEra(w: import('./types').WorldState): { name: string; desc: string } {
  let best = 0;
  for (const c of w.civs) {
    if (c.dead) continue;
    const t = c.tech.levels;
    const score = (t.crafting ?? 1) * 3 + (t.agriculture ?? 1) * 2 + (t.industry ?? 1) * 5;
    if (score > best) best = score;
  }
  const ind = best / 10;
  // 大致对标：石器 <3 / 青铜 <6 / 铁器 <9 / 中古 <14 / 工业革命 <22 / 电气 <30 / 信息 30+
  if (ind < 2.2) return { name: '石器时代', desc: '打磨的石块与火种，人类的黎明' };
  if (ind < 3.6) return { name: '青铜时代', desc: '炉火中流出金绿色的金属，国家开始出现' };
  if (ind < 5.0) return { name: '铁器时代', desc: '廉价的铁器进入千家万户，帝国与诸子百家' };
  if (ind < 6.6) return { name: '中古时代', desc: '土地与信仰编织秩序，商路连接远方' };
  if (ind < 8.4) return { name: '工业时代', desc: '机器的轰鸣重塑生产与阶级' };
  if (ind < 9.8) return { name: '电气时代', desc: '夜幕下的城市第一次亮如白昼' };
  return { name: '信息时代', desc: '知识的洪流冲刷着旧世界的堤岸' };
}

export const WORLD_TITLES = [
  '新大地', '摇篮', '长河', '初火', '晨星', '群丘', '绿洲', '丰饶之土', '试验场', '源野',
];
