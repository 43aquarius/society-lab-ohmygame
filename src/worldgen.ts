/**
 * WorldGenerator — 程序化世界生成
 * 多倍频值噪声生成海拔/湿度，雕刻河流与湖泊，分配沃土、森林与矿脉。
 * 相同 seed 生成完全一致的世界（可复现实验的基础）。
 */
import { Rng, Terrain, type Tile, type GameConfig } from './types';

/** 值噪声（种子化，可复现） */
function makeNoise(seed: number) {
  const rng = new Rng(seed);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const hash = (x: number, y: number) => perm[(perm[x & 255] + y) & 255] / 255;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x: number, y: number, octaves = 4, freq = 0.12) => {
    let sum = 0, amp = 1, f = freq, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += value(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5; f *= 2.1;
    }
    return sum / norm;
  };
}

export interface GenResult {
  tiles: Tile[];
  starts: { x: number; y: number }[];
}

/** 计算可通行/可建设性（渲染与寻路提示用） */
export function buildable(t: Tile): boolean {
  return t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain && t.elevation <= 2;
}

export function generateWorld(config: GameConfig): GenResult {
  const { size, seed, scenario } = config;
  const rng = new Rng(seed ^ 0x51ed270b);
  const elevNoise = makeNoise(seed);
  const moistNoise = makeNoise(seed ^ 0x1234abcd);
  const oreNoise = makeNoise(seed ^ 0x7e57a1);
  const edgeFade = (i: number, j: number) => {
    const dx = Math.min(i, size - 1 - i) / (size / 2);
    const dy = Math.min(j, size - 1 - j) / (size / 2);
    return Math.min(1, Math.min(dx, dy) * 1.6);
  };

  const tiles: Tile[] = new Array(size * size);
  const elevationField = new Float32Array(size * size);

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = j * size + i;
      let e = elevNoise(i, j, 5, scenario === 'valley' ? 0.09 : 0.11);
      // 边缘抬升形成盆地感（世界像一块沙盘）
      e = e * 0.86 + 0.14 * (1 - edgeFade(i, j) * 0.85);
      if (scenario === 'valley') {
        // 河谷情景：中部压出一条宽阔低地
        const center = Math.abs(j - size / 2) / (size / 2);
        e -= Math.max(0, 0.32 - center * 0.55);
      }
      elevationField[idx] = e;
      const m = moistNoise(i, j, 4, 0.08) * 0.7 + elevNoise(i + 977, j - 311, 2, 0.05) * 0.3;
      tiles[idx] = {
        terrain: Terrain.Grass,
        fertility: 0,
        moisture: Math.max(0, Math.min(1, m)),
        elevation: 0,
        ore: false,
        owner: -1,
      };
    }
  }

  // 高度分位阈值：水域 ~14%，山地 ~12%，丘陵 ~16%
  const sorted = Float32Array.from(elevationField).sort();
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const waterT = q(0.14), hillT = q(0.72), mountainT = q(0.9);

  for (let idx = 0; idx < tiles.length; idx++) {
    const e = elevationField[idx];
    const t = tiles[idx];
    if (e < waterT) {
      t.terrain = Terrain.Water;
      t.elevation = 0;
    } else if (e >= mountainT) {
      t.terrain = Terrain.Mountain;
      t.elevation = 4;
    } else if (e >= hillT) {
      t.terrain = Terrain.Hills;
      t.elevation = e > (hillT + mountainT) / 2 ? 3 : 2;
    } else {
      t.elevation = 1;
      t.terrain = Terrain.Grass;
    }
  }

  // 河流：自山地向低处行走（带惯性），直到入湖/入水/出界
  const riverCount = size >= 48 ? 4 : 3;
  for (let r = 0; r < riverCount; r++) {
    let tries = 0;
    let sx = -1, sy = -1;
    while (tries++ < 200) {
      const i = rng.int(size), j = rng.int(size);
      if (tiles[j * size + i].terrain === Terrain.Mountain && elevationField[j * size + i] > q(0.955)) {
        sx = i; sy = j; break;
      }
    }
    if (sx < 0) continue;
    let x = sx, y = sy, dirX = 0, dirY = 1;
    let steps = 0;
    while (steps++ < size * 3) {
      const idx = y * size + x;
      if (tiles[idx].terrain === Terrain.Water && steps > 2) break;
      if (tiles[idx].terrain !== Terrain.Mountain) tiles[idx].terrain = Terrain.Water;
      // 朝低处走，带惯性
      let best = -Infinity, bx = x, by = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const score = -elevationField[ny * size + nx] + (dx === dirX && dy === dirY ? 0.35 : 0);
        if (score > best) { best = score; bx = nx; by = ny; }
      }
      if (bx === x && by === y) break;
      dirX = bx - x; dirY = by - y;
      x = bx; y = by;
      if (x <= 0 || y <= 0 || x >= size - 1 || y >= size - 1) break;
    }
  }

  // 湖泊扩容：把低洼草地加深为湖（局部小湖）
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        const idx = j * size + i;
        if (tiles[idx].terrain === Terrain.Grass && elevationField[idx] < waterT * 1.04) {
          let waterN = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const t2 = tiles[(j + dj) * size + i + di];
            if (t2.terrain === Terrain.Water) waterN++;
          }
          if (waterN >= 4) tiles[idx].terrain = Terrain.Water;
        }
      }
    }
  }

  // 植被/沃土/矿石
  const nearWater = (i: number, j: number, dist: number) => {
    for (let dj = -dist; dj <= dist; dj++) for (let di = -dist; di <= dist; di++) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      if (tiles[nj * size + ni].terrain === Terrain.Water) return true;
    }
    return false;
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = j * size + i;
      const t = tiles[idx];
      if (t.terrain === Terrain.Grass) {
        if (nearWater(i, j, 2) && t.moisture > 0.34) {
          t.terrain = Terrain.Fertile;
          t.fertility = 0.72 + t.moisture * 0.25;
        } else if (t.moisture > 0.56 && rng.chance(0.92)) {
          t.terrain = Terrain.Forest;
          t.fertility = 0.3 + t.moisture * 0.15;
        } else {
          t.fertility = 0.18 + t.moisture * 0.3;
        }
      } else if (t.terrain === Terrain.Hills) {
        if (t.moisture > 0.62 && rng.chance(0.5)) t.terrain = Terrain.Forest;
        t.fertility = 0.12 + t.moisture * 0.18;
      } else if (t.terrain === Terrain.Rock || t.terrain === Terrain.Mountain) {
        t.fertility = 0.05;
      }
      if (t.terrain === Terrain.Hills || t.terrain === Terrain.Mountain) {
        const o = oreNoise(i, j, 3, 0.15);
        if (o > 0.63 && (t.terrain === Terrain.Hills ? rng.chance(0.55) : rng.chance(0.3))) t.ore = true;
      }
      if (t.terrain === Terrain.Rock) t.ore = false;
    }
  }

  // 石地斑块
  const rockNoise = makeNoise(seed ^ 0xbeef99);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = j * size + i;
      if (tiles[idx].terrain === Terrain.Grass || tiles[idx].terrain === Terrain.Hills) {
        if (rockNoise(i, j, 2, 0.18) > 0.72 && elevationField[idx] > hillT * 0.92) {
          tiles[idx].terrain = Terrain.Rock;
        }
      }
    }
  }

  // 起点选择：近水近沃土的低地
  const starts: { x: number; y: number }[] = [];
  const target = config.settlements;
  let guard = 0;
  while (starts.length < target && guard++ < 4000) {
    const i = 2 + rng.int(size - 4), j = 2 + rng.int(size - 4);
    const t = tiles[j * size + i];
    if (t.terrain !== Terrain.Grass && t.terrain !== Terrain.Fertile) continue;
    if (!nearWater(i, j, 4)) continue;
    // 距既有起点足够远
    let ok = true;
    for (const s of starts) {
      const d = Math.hypot(s.x - i, s.y - j);
      if (d < size * 0.32) { ok = false; break; }
    }
    if (!ok) continue;
    // 周边沃土足够
    let fertile = 0;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < size && nj < size && tiles[nj * size + ni].terrain === Terrain.Fertile) fertile++;
    }
    if (fertile < (scenario === 'valley' ? 3 : 5)) continue;
    starts.push({ x: i, y: j });
  }
  if (starts.length === 0) {
    // 兜底：找任何可居草地
    outer: for (let j = 2; j < size - 2; j++) {
      for (let i = 2; i < size - 2; i++) {
        const t = tiles[j * size + i];
        if (t.terrain === Terrain.Grass || t.terrain === Terrain.Fertile) {
          starts.push({ x: i, y: j });
          break outer;
        }
      }
    }
  }
  return { tiles, starts };
}
