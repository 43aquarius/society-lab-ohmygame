/**
 * WorldGenerator v4.0 — 分块流式世界生成（类 Minecraft 不断加载的巨大地图）
 *
 * 核心思想：
 * - 世界按 32×32 的 chunk 按需生成；同一 seed 下任何 chunk 的生成
 *   完全确定（只依赖噪声场与坐标哈希，不依赖生成顺序）。
 * - 噪声场包含：大陆形状（低频）、山脊、湿度、温度（纬度带 + 扰动）、
 *   河流（脊线场）、湖泊、岩石与矿脉。
 * - 气候带：地图中央为热带，南北两缘为寒带 —— 沙漠、丛林、草原、
 *   温带森林、针叶林、苔原沿纬度与湿度自然分布。
 * - 被神力修改过的 chunk 标记 modified，随存档保存；其余 chunk 重开时
 *   由种子确定性重建（存档因此可以非常小）。
 */
import { Rng, Terrain, CHUNK, type Tile, type WorldChunk, type WorldState } from './types';

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
  return (x: number, y: number, octaves = 4, freq = 0.012) => {
    let sum = 0, amp = 1, f = freq, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += value(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5; f *= 2.1;
    }
    return sum / norm;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export type NoiseFn = (x: number, y: number, octaves?: number, freq?: number) => number;

export interface GenContext {
  seed: number;
  size: number;
  chunksPerRow: number;
  /** LRU 计时器 */
  tick: number;
  /** 大陆与海拔（噪声函数：x, y, octaves?, freq?） */
  cont: NoiseFn;
  ridge: NoiseFn;
  detail: NoiseFn;
  moist: NoiseFn;
  tempN: NoiseFn;
  river: NoiseFn;
  lake: NoiseFn;
  rockN: NoiseFn;
  oreN: NoiseFn;
  /** 校准阈值（由 seed 采样分位数得出） */
  waterT: number;
  lvT: number[];
  /** 海拔原始场（含大陆混合，未平滑） */
  elevRaw: (x: number, y: number) => number;
}

/** 建立 GenContext：噪声函数 + 全域分位数校准（一次性，几毫秒） */
export function createGen(seed: number, size: number): GenContext {
  const cont = makeNoise(seed);
  const ridgeN = makeNoise(seed ^ 0x5eed1234);
  const detail = makeNoise(seed ^ 0xa17b9);
  const moistN = makeNoise(seed ^ 0x1234abcd);
  const tempN = makeNoise(seed ^ 0x7e57a1);
  const riverN = makeNoise(seed ^ 0x21f3c7);
  const lakeN = makeNoise(seed ^ 0x1a4e99);
  const rockN = makeNoise(seed ^ 0xbeef99);
  const oreN = makeNoise(seed ^ 0x6a71c5);

  const elevRaw = (x: number, y: number) => {
    const c = cont(x, y, 4, 0.0058);                 // 大陆形状（超低频）
    const r = 1 - Math.abs(ridgeN(x, y, 3, 0.012) * 2 - 1);  // 山脊线
    const d = detail(x, y, 3, 0.055);                // 细节
    return c * 0.6 + r * r * 0.24 + d * 0.16;
  };

  // —— 分位数校准：在整个世界上均匀采样，得到稳定的水面/海拔阶梯 ——
  const N = 72;
  const samples: number[] = [];
  const step = size / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      samples.push(elevRaw((i + 0.5) * step, (j + 0.5) * step));
    }
  }
  samples.sort((a, b) => a - b);
  const q = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))];
  const waterT = q(0.36); // 36% 水域：海洋、大湖与河流
  const land = samples.filter(s => s >= waterT);
  const qLand = (p: number) => land[Math.min(land.length - 1, Math.floor(p * land.length))];
  const lvT = [qLand(0.32), qLand(0.55), qLand(0.70), qLand(0.83), qLand(0.92), qLand(0.97)];

  return {
    seed, size,
    chunksPerRow: Math.ceil(size / CHUNK),
    tick: 0,
    cont, ridge: ridgeN, detail, moist: moistN, tempN, river: riverN,
    lake: lakeN, rockN, oreN: oreN,
    waterT, lvT, elevRaw,
  };
}

/** 平滑海拔：抑制孤峰孤坑（用带 2 格 padding 的原始海拔网格做邻域混合） */
function smoothGrid(g: GenContext, cx: number, cy: number): Float32Array {
  const S = CHUNK + 4; // 每侧 padding 2
  const grid = new Float32Array(S * S);
  const ox = cx * CHUNK - 2, oy = cy * CHUNK - 2;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      grid[j * S + i] = g.elevRaw(ox + i, oy + j);
    }
  }
  return grid;
}

const WATER_F = 0; // 水面海拔固定 0 级

/** 生成一个 chunk（纯函数：只依赖 GenContext 与坐标，确定性 100%） */
export function generateChunk(g: GenContext, cx: number, cy: number): WorldChunk {
  const S = CHUNK + 4;
  const grid = smoothGrid(g, cx, cy);
  const at = (i: number, j: number) => grid[(j + 2) * S + (i + 2)]; // 相对 chunk 内坐标，可取 [-2, CHUNK+1]
  const nearWaterRaw = (i: number, j: number, r: number) => {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (at(i + di, j + dj) < g.waterT) return true;
    }
    return false;
  };

  const tiles: Tile[] = new Array(CHUNK * CHUNK);
  const baseX = cx * CHUNK, baseY = cy * CHUNK;

  for (let j = 0; j < CHUNK; j++) {
    for (let i = 0; i < CHUNK; i++) {
      const x = baseX + i, y = baseY + j;
      // 平滑海拔（本格 0.62 + 对角 0.38）
      const e0 = at(i, j);
      const eAvg = (at(i - 1, j - 1) + at(i + 1, j - 1) + at(i - 1, j + 1) + at(i + 1, j + 1)) * 0.25;
      const e = e0 * 0.62 + eAvg * 0.38;

      // 温度：纬度带（中央热带、南北寒带）+ 扰动
      const lat = 1 - Math.abs((y + 0.5) / g.size * 2 - 1);
      let lv = 0;
      for (let l = 0; l < 6; l++) { if (e >= g.lvT[l]) lv = l + 1; }
      const temp = clamp01(lat * 0.92 + (g.tempN(x, y, 2, 0.02) - 0.5) * 0.34 - lv * 0.05);
      let moist = g.moist(x, y, 4, 0.013) * 0.75 + g.detail(x + 977, y - 311, 2, 0.05) * 0.25;
      if (nearWaterRaw(i, j, 2)) moist = Math.min(1, moist + 0.14); // 水汽

      const tile: Tile = {
        terrain: Terrain.Grass, fertility: 0.2, moisture: clamp01(moist),
        elevation: lv, temp, ore: false, owner: -1,
      };

      if (e < g.waterT) {
        tile.terrain = Terrain.Water;
        tile.elevation = WATER_F;
        tile.fertility = 0;
      } else {
        // 河流（脊线场，确定性蜿蜒）与湖泊（低地局部）
        const riverV = 1 - Math.abs(g.river(x, y, 3, 0.0042) * 2 - 1);
        const isRiver = riverV > 0.981 && lv <= 4;
        const isLake = g.lake(x, y, 2, 0.016) > 0.8 && lv <= 2;
        if (isLake || isRiver) {
          tile.terrain = Terrain.Water;
          tile.elevation = Math.max(0, lv - 1); // 河床/湖床下切
          tile.fertility = 0;
        } else {
          // —— 气候带 ——
          if (temp < 0.17) {
            tile.terrain = Terrain.Tundra;
            tile.fertility = 0.1 + moist * 0.12;
          } else if (moist < 0.26 && temp > 0.5) {
            // 沙漠（绿洲：极小概率的湿润地块）
            if (moist > 0.24 && vhashTile(x, y, 301) > 0.982) {
              tile.terrain = Terrain.Fertile;
              tile.fertility = 0.8;
            } else {
              tile.terrain = Terrain.Sand;
              tile.fertility = 0.03;
            }
          } else if (lv >= 5) {
            tile.terrain = Terrain.Mountain;
            tile.fertility = 0.05;
          } else if (lv >= 3) {
            tile.terrain = moist > 0.6 && vhashTile(x, y, 17) > 0.55 ? Terrain.Forest : Terrain.Hills;
            tile.fertility = 0.12 + moist * 0.18;
          } else if (nearWaterRaw(i, j, 2) && moist > 0.38 && temp > 0.25) {
            tile.terrain = Terrain.Fertile;
            tile.fertility = 0.72 + moist * 0.22;
          } else if (moist > 0.56) {
            tile.terrain = Terrain.Forest;
            tile.fertility = 0.3 + moist * 0.15;
          } else {
            tile.terrain = Terrain.Grass;
            tile.fertility = 0.18 + moist * 0.3;
          }
          // 石地斑块（丘陵以上）
          if ((tile.terrain === Terrain.Hills || tile.terrain === Terrain.Mountain)
            && g.rockN(x, y, 2, 0.02) > 0.74) {
            tile.terrain = Terrain.Rock;
            tile.fertility = 0.05;
          }
        }
      }
      // 矿脉（丘陵/山地/石地）
      if (tile.terrain === Terrain.Hills || tile.terrain === Terrain.Mountain || tile.terrain === Terrain.Rock) {
        const o = g.oreN(x, y, 3, 0.02);
        if (o > 0.66) tile.ore = vhashTile(x, y, 21) > 0.35;
      }
      tiles[j * CHUNK + i] = tile;
    }
  }
  return { cx, cy, tiles, modified: false, lastTouch: g.tick++ };
}

/** 确定性格点哈希（0..1，视觉与生成决策共用；不消耗模拟 RNG） */
function vhashTile(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/** chunk 在 Map 中的 key */
export function chunkKey(g: GenContext, cx: number, cy: number): number {
  return cy * g.chunksPerRow + cx;
}

/** 非修改 chunk 的缓存上限（超过后 LRU 淘汰；modified 的永不淘汰） */
const CHUNK_CACHE_CAP = 720;

/** 取 chunk（不存在则按需生成——流式加载的入口） */
export function ensureChunk(w: WorldState, cx: number, cy: number): WorldChunk | null {
  const g = w.gen;
  if (cx < 0 || cy < 0 || cx >= g.chunksPerRow || cy >= g.chunksPerRow) return null;
  const key = chunkKey(g, cx, cy);
  let ch = w.chunks.get(key);
  if (!ch) {
    ch = generateChunk(g, cx, cy);
    w.chunks.set(key, ch);
    if (w.chunks.size > CHUNK_CACHE_CAP) evictChunks(w);
  }
  ch.lastTouch = g.tick++;
  return ch;
}

/** LRU 淘汰（只淘汰未修改的 chunk） */
export function evictChunks(w: WorldState): void {
  if (w.chunks.size <= CHUNK_CACHE_CAP) return;
  const entries = [...w.chunks.entries()]
    .filter(([, c]) => !c.modified)
    .sort((a, b) => a[1].lastTouch - b[1].lastTouch);
  let toEvict = w.chunks.size - CHUNK_CACHE_CAP + 24;
  for (const [key] of entries) {
    if (toEvict-- <= 0) break;
    w.chunks.delete(key);
  }
}

/** 读取格子（越界返回 null；自动流式生成所在 chunk） */
export function tileAt(w: WorldState, x: number, y: number): Tile | null {
  const size = w.gen.size;
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  const cx = x >> 5, cy = y >> 5; // CHUNK = 32
  const ch = ensureChunk(w, cx, cy);
  if (!ch) return null;
  return ch.tiles[(y & 31) * CHUNK + (x & 31)];
}

/** 只读查看（不生成 chunk）：未生成区域返回 null——小地图的"未探索迷雾" */
export function peekTile(w: WorldState, x: number, y: number): Tile | null {
  const g = w.gen;
  if (x < 0 || y < 0 || x >= g.size || y >= g.size) return null;
  const key = chunkKey(g, x >> 5, y >> 5);
  const ch = w.chunks.get(key);
  if (!ch) return null;
  ch.lastTouch = g.tick++;
  return ch.tiles[(y & 31) * CHUNK + (x & 31)];
}

/** 读取格子海拔（越界返回 99：不可攀的高墙） */
export function elevAt(w: WorldState, x: number, y: number): number {
  const t = tileAt(w, x, y);
  return t ? t.elevation : 99;
}

/** 读取格子温度（越界返回温和值） */
export function tempAt(w: WorldState, x: number, y: number): number {
  const t = tileAt(w, x, y);
  return t ? t.temp : 0.5;
}

/** 神力/事件修改地形后调用：标记 chunk 已修改（存档保存 + 不淘汰） */
export function markDirty(w: WorldState, x: number, y: number): void {
  const cx = x >> 5, cy = y >> 5;
  const key = chunkKey(w.gen, cx, cy);
  const ch = w.chunks.get(key);
  if (ch) ch.modified = true;
}

/** 计算可通行/可建设性（渲染与寻路提示用） */
export function buildable(t: Tile): boolean {
  return t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain && t.terrain !== Terrain.Sand && t.elevation <= 3;
}

/** 某点作为文明摇篮的评分（起点搜索与分蘖选址共用） */
export function siteQuality(w: WorldState, x: number, y: number): number {
  const t = tileAt(w, x, y);
  if (!t) return -1;
  if (t.terrain !== Terrain.Grass && t.terrain !== Terrain.Fertile) return -1;
  if (t.elevation > 2) return -1;
  if (t.temp < 0.28 || t.temp > 0.92) return -1; // 苔原/酷暑之地不宜摇篮
  let score = t.fertility;
  // 周边条件
  let fertile = 0, water = 0;
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
    const n = tileAt(w, x + di, y + dj);
    if (!n) continue;
    if (n.terrain === Terrain.Fertile) fertile++;
    if (n.terrain === Terrain.Water) water++;
  }
  if (water === 0) return -1; // 必须近水
  score += Math.min(fertile, 8) * 0.06 + 0.1;
  return score;
}

/** 为若干文明寻找彼此远离的摇篮（从世界中心向外螺旋/随机搜索） */
export function findStarts(w: WorldState, count: number, rng: Rng): { x: number; y: number }[] {
  const size = w.gen.size;
  const c0 = size / 2;
  const starts: { x: number; y: number }[] = [];
  const minDist = count > 1 ? size * 0.14 : size * 0.2; // v4.0：拉近文明间距，保证历史上的相遇
  let guard = 0;
  while (starts.length < count && guard++ < 6000) {
    const ang = rng.next() * Math.PI * 2;
    // v4.0：环形采样——文明摇篮聚拢在彼此可及的范围（保证相遇与互动）
    const dist = count > 1 ? minDist * (0.55 + rng.next() * 0.5) : size * (0.1 + rng.next() * 0.15);
    const x = Math.round(c0 + Math.cos(ang) * dist);
    const y = Math.round(c0 + Math.sin(ang) * dist);
    if (x < 6 || y < 6 || x >= size - 6 || y >= size - 6) continue;
    if (siteQuality(w, x, y) < 0.55) continue;
    let ok = true;
    for (const s of starts) {
      if (Math.hypot(s.x - x, s.y - y) < minDist) { ok = false; break; }
    }
    if (!ok) continue;
    starts.push({ x, y });
  }
  // 兜底：中心附近随便找一块可居之地
  while (starts.length < count) {
    let placed = false;
    outer: for (let r = 0; r < size / 2 && !placed; r += 2) {
      for (let a = 0; a < 24 && !placed; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const x = Math.round(c0 + Math.cos(ang) * r), y = Math.round(c0 + Math.sin(ang) * r);
        if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
        const t = tileAt(w, x, y);
        if (t && t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain && t.elevation <= 2) {
          starts.push({ x, y }); placed = true; break outer;
        }
      }
    }
    if (!placed) { starts.push({ x: Math.floor(c0), y: Math.floor(c0) }); break; }
  }
  return starts;
}
