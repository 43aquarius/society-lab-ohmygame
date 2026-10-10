/** 聚落命名 — 音节拼合的古朴中文风地名。 */

const PREFIX = ['河', '谷', '林', '石', '泉', '原', '丘', '泽', '川', '山', '青', '白', '金', '沙', '风'];
const MIDDLE = ['阳', '溪', '湾', '坡', '岗', '甸', '滩', '林', '岭', '塘', '原', '口'];
const SUFFIX = ['村', '寨', '部落', '聚', '城', '镇', '堡'];

import type { Rng } from './types';

export function settlementName(rng: Rng, stage: string, used: Set<string>): string {
  for (let i = 0; i < 60; i++) {
    let name = rng.pick(PREFIX) + rng.pick(MIDDLE);
    if (stage === 'camp' && rng.chance(0.6)) name += rng.pick(['寨', '部落']);
    else name += rng.pick(SUFFIX);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `无名之地${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

export const WORLD_TITLES = [
  '新大地', '摇篮', '长河', '初火', '晨星', '群丘', '绿洲', '丰饶之土', '试验场', '源野',
];
