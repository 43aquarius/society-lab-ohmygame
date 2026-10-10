/**
 * SaveManager v4.0 — 存档、读档与世界分支（多文明 + 分块地形）
 * - 地形只保存被修改过的 chunk（神力干预），其余由种子确定性重建——
 *   超大世界的存档依然很小；
 * - 兼容 v3 旧档：全量 tiles 数组迁移为显式 chunk（modified=true）；
 * - 多文明：civs 数组 + 聚落 civId + 道路 + 稀疏天气。
 */
import { CFG } from './config';
import { Rng, Terrain, CHUNK, type WorldState, type Tile, type WorldChunk, type WeatherCell } from './types';
import { createGen, chunkKey, generateChunk } from './worldgen';

interface SavePayload {
  version: number;
  savedAt: number;
  worldName: string;
  world: Serialized;
}

interface ChunkSave {
  cx: number;
  cy: number;
  /** 打包：terrain|elev|ore|owner 每格 4 字符位（16 进制），fert/moist/temp 量化 0..200 */
  pack: string;
}

interface Serialized {
  config: WorldState['config'];
  year: number;
  rngState: number;
  nextBuildingId: number;
  nextEventId: number;
  interventions: number;
  divine: number;
  divineMax: number;
  size: number;
  observedCiv: number;
  /** v4.0：被修改过的分块（确定性部分不保存） */
  chunks: ChunkSave[];
  /** v4.0：文明数组 */
  civs: WorldState['civs'];
  /** 稀疏天气（只有被干预过的格子） */
  weather: { k: number; wet: number; years: number }[];
  settlements: (Omit<WorldState['settlements'][number], 'roads'> & { roads: number[] })[];
  chronicle: WorldState['chronicle'];
  activeEvents: WorldState['activeEvents'];
  decals: WorldState['decals'];
  snapshots: WorldState['snapshots'];
}

/** 打包一个 chunk（hex 编码：地形/海拔/矿 3 字符 + 肥力/湿度/温度各 2 hex 字符） */
function packChunk(ch: WorldChunk): ChunkSave {
  let geo = '';
  const N = CHUNK * CHUNK;
  for (let i = 0; i < N; i++) {
    const t = ch.tiles[i];
    geo += t.terrain.toString(16)
      + Math.min(15, t.elevation).toString(16)
      + (t.ore ? '1' : '0');
  }
  // 环境：肥力/湿度/温度各量化到 0..200，2 位 hex（避免任何分隔符冲突）
  let env = '';
  for (let i = 0; i < N; i++) {
    const t = ch.tiles[i];
    env += Math.round(Math.min(1, Math.max(0, t.fertility)) * 200).toString(16).padStart(2, '0')
      + Math.round(Math.min(1, Math.max(0, t.moisture)) * 200).toString(16).padStart(2, '0')
      + Math.round(Math.min(1, Math.max(0, t.temp)) * 200).toString(16).padStart(2, '0');
  }
  return { cx: ch.cx, cy: ch.cy, pack: geo + '|' + env };
}

function unpackChunk(save: ChunkSave, size: number): WorldChunk {
  const [geo, env] = save.pack.split('|');
  const tiles: Tile[] = new Array(CHUNK * CHUNK);
  for (let i = 0; i < CHUNK * CHUNK; i++) {
    const g = i * 3;
    const e = i * 6;
    tiles[i] = {
      terrain: parseInt(geo[g], 16) as Terrain,
      elevation: parseInt(geo[g + 1], 16),
      ore: geo[g + 2] === '1',
      fertility: parseInt(env.slice(e, e + 2), 16) / 200,
      moisture: parseInt(env.slice(e + 2, e + 4), 16) / 200,
      temp: parseInt(env.slice(e + 4, e + 6), 16) / 200,
      owner: -1,
    };
  }
  return { cx: save.cx, cy: save.cy, tiles, modified: true, lastTouch: 0 };
}

export function serialize(w: WorldState, worldName: string): string {
  const chunks: ChunkSave[] = [];
  for (const ch of w.chunks.values()) {
    if (ch.modified) chunks.push(packChunk(ch));
  }
  const weather: { k: number; wet: number; years: number }[] = [];
  for (const [k, c] of w.weather) {
    if (c.wet !== 0) weather.push({ k, wet: Math.round(c.wet * 50) / 50, years: c.years });
  }
  const payload: SavePayload = {
    version: CFG.saveVersion,
    savedAt: Date.now(),
    worldName,
    world: {
      config: w.config,
      year: w.year,
      rngState: w.rng.state,
      nextBuildingId: w.nextBuildingId,
      nextEventId: w.nextEventId,
      interventions: w.interventions,
      divine: w.divine,
      divineMax: w.divineMax,
      size: w.gen.size,
      observedCiv: w.observedCiv,
      chunks,
      civs: w.civs.map(c => ({
        ...c,
        history: c.history.slice(-200),
        // 运行时字段不存
        hystForm: undefined, hystCount: undefined,
      })),
      weather,
      settlements: w.settlements.map(s => ({ ...s, roads: [...s.roads].slice(-900) })),
      chronicle: w.chronicle.slice(-600),
      activeEvents: w.activeEvents,
      decals: w.decals.slice(-CFG.agents.decalsMax),
      snapshots: (() => {
        const withData = w.snapshots.filter(s => s.data).slice(-8);
        const marks = w.snapshots.filter(s => !s.data).slice(-30);
        return [...marks, ...withData].sort((a, b) => a.year - b.year);
      })(),
    },
  };
  return JSON.stringify(payload);
}

export function deserialize(json: string): { world: WorldState; worldName: string } | { error: string } {
  let payload: SavePayload;
  try {
    payload = JSON.parse(json);
  } catch {
    return { error: '存档文件不是有效的 JSON' };
  }
  if (!payload || !payload.world) {
    return { error: '存档文件损坏' };
  }
  // v4 新格式
  if (payload.version === 4) {
    return deserializeV4(payload);
  }
  // v3 旧档迁移
  if (payload.version === 3) {
    return migrateV3(payload as any);
  }
  return { error: `存档版本不兼容（当前支持 v3/v4）` };
}

function deserializeV4(payload: SavePayload): { world: WorldState; worldName: string } | { error: string } {
  const s = payload.world;
  const gen = createGen(s.config.seed, s.size);
  const chunks = new Map<number, WorldChunk>();
  for (const cs of s.chunks) {
    chunks.set(chunkKey(gen, cs.cx, cs.cy), unpackChunk(cs, s.size));
  }
  const rng = new Rng(1);
  rng.state = s.rngState;
  const weather = new Map<number, WeatherCell>();
  for (const c of s.weather) weather.set(c.k, { wet: c.wet, years: c.years });
  const world: WorldState = {
    config: s.config,
    year: s.year,
    chunks,
    weather,
    settlements: s.settlements.map(x => ({ ...x, roads: new Set<number>(x.roads ?? []) })),
    civs: s.civs.map(c => ({ ...c, met: c.met ?? [], history: c.history ?? [] })),
    chronicle: s.chronicle,
    activeEvents: s.activeEvents,
    decals: s.decals ?? [],
    interventions: s.interventions,
    divine: s.divine,
    divineMax: s.divineMax,
    rng,
    nextBuildingId: s.nextBuildingId,
    nextEventId: s.nextEventId,
    snapshots: s.snapshots,
    gen,
    observedCiv: s.observedCiv ?? 0,
    civIndex: new Map(),
  };
  return { world, worldName: payload.worldName };
}

/** v3 → v4 迁移：全量 tiles → 显式 chunks（modified=true 永不淘汰） */
function migrateV3(payload: any): { world: WorldState; worldName: string } | { error: string } {
  const s = payload.world;
  const size: number = s.size;
  const gen = createGen(s.config.seed, size);
  const chunks = new Map<number, WorldChunk>();
  const perRow = Math.ceil(size / CHUNK);
  for (let cy = 0; cy < perRow; cy++) {
    for (let cx = 0; cx < perRow; cx++) {
      const ch = generateChunk(gen, cx, cy);
      ch.modified = true; // 迁移块显式保存，防止淘汰后丢失旧世界数据
      // 覆盖为旧数据
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = cx * CHUNK + lx, y = cy * CHUNK + ly;
          if (x >= size || y >= size) continue;
          const i = y * size + x;
          const old = {
            terrain: s.tTerrain[i] as Terrain,
            fertility: s.tFert[i] / 200,
            moisture: s.tMoist[i] / 200,
            elevation: s.tElev[i],
            temp: ch.tiles[ly * CHUNK + lx].temp, // 旧档无温度：用气候场推
            ore: s.tOre[i] === 1,
            owner: s.tOwner[i] - 1,
          };
          ch.tiles[ly * CHUNK + lx] = old;
        }
      }
      chunks.set(chunkKey(gen, cx, cy), ch);
    }
  }
  // 旧单文明 → v4 文明数组
  const oldCiv = s.civ;
  const civs: WorldState['civs'] = [{
    id: 0,
    name: '旧世界文明',
    color: '#4fb38a',
    culture: 0,
    form: oldCiv.form ?? 'primitive',
    formSince: oldCiv.formSince ?? 0,
    prevForm: oldCiv.prevForm ?? null,
    vars: oldCiv.vars,
    tech: oldCiv.tech,
    groups: oldCiv.groups ?? [
      { id: 'commoners', name: '平民', ideas: 0.05 },
      { id: 'elite', name: '精英', ideas: -0.1 },
      { id: 'middle', name: '工商业者', ideas: 0.1 },
    ],
    warMemory: oldCiv.warMemory ?? 0,
    enlightenment: oldCiv.enlightenment ?? 0,
    met: [],
    dead: false,
    founded: 0,
    history: s.history ?? [],
  }];
  const rng = new Rng(1);
  rng.state = s.rngState;
  const world: WorldState = {
    config: { ...s.config, settlements: 1 },
    year: s.year,
    chunks,
    weather: new Map(),
    settlements: (s.settlements as any[]).map(x => ({ ...x, civId: 0, roads: new Set<number>([x.y * size + x.x]) })),
    civs,
    chronicle: s.chronicle ?? [],
    activeEvents: s.activeEvents ?? [],
    decals: s.decals ?? [],
    interventions: s.interventions ?? 0,
    divine: s.divine ?? 100,
    divineMax: s.divineMax ?? 100,
    rng,
    nextBuildingId: s.nextBuildingId ?? 1,
    nextEventId: s.nextEventId ?? 1,
    snapshots: s.snapshots ?? [],
    gen,
    observedCiv: 0,
    civIndex: new Map(),
  };
  return { world, worldName: `${payload.worldName}（迁移）` };
}

// ---------- localStorage 槽位 ----------

export interface SlotInfo {
  key: string;
  index: number;
  worldName: string;
  year: number;
  savedAt: number;
  form: string;
}

const SLOT_PREFIX = `${CFG.saveKey}-slot`;

export function listSlots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (let i = 1; i <= 6; i++) {
    const key = `${SLOT_PREFIX}${i}`;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const p = JSON.parse(raw) as SavePayload;
      const mainCiv = p.world.civs?.[0];
      out.push({ key, index: i, worldName: p.worldName, year: p.world.year, savedAt: p.savedAt, form: mainCiv?.form ?? 'primitive' });
    } catch { /* 忽略损坏槽位 */ }
  }
  return out;
}

export function saveToSlot(w: WorldState, worldName: string, index: number): boolean {
  try {
    localStorage.setItem(`${SLOT_PREFIX}${index}`, serialize(w, worldName));
    return true;
  } catch (e) {
    console.error('存档失败', e);
    return false;
  }
}

export function loadFromSlot(index: number) {
  const raw = localStorage.getItem(`${SLOT_PREFIX}${index}`);
  if (!raw) return { error: '槽位为空' };
  return deserialize(raw);
}

export function autosave(w: WorldState, worldName: string) {
  try {
    localStorage.setItem(`${CFG.saveKey}-auto`, serialize(w, worldName));
  } catch { /* 空间不足时静默 */ }
}

export function loadAutosave() {
  const raw = localStorage.getItem(`${CFG.saveKey}-auto`);
  if (!raw) return null;
  return deserialize(raw);
}

// ---------- 文件导出/导入 ----------

export function exportToFile(w: WorldState, worldName: string) {
  const blob = new Blob([serialize(w, worldName)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `society-lab-y${w.year}-seed${w.config.seed}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importFromFile(file: File): Promise<{ world: WorldState; worldName: string } | { error: string }> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(deserialize(String(reader.result)));
      } catch {
        resolve({ error: '无法解析文件' });
      }
    };
    reader.onerror = () => resolve({ error: '读取文件失败' });
    reader.readAsText(file);
  });
}

// ---------- 分支快照 ----------

/** 在当前时点创建带数据的分支节点 */
export function pinSnapshot(w: WorldState, label?: string): void {
  const last = w.snapshots[w.snapshots.length - 1];
  if (last && last.year === w.year && last.data) {
    last.label = label ?? last.label;
    return;
  }
  // 序列化时快照内互不嵌套：临时清空快照字段
  const backup = w.snapshots;
  w.snapshots = [];
  const data = serialize(w, label ?? '');
  w.snapshots = backup;
  w.snapshots.push({
    year: w.year,
    label: label ?? `${w.year} 年 · 手动节点`,
    data,
  });
  // 上限控制
  const withData = w.snapshots.filter(s => s.data);
  if (withData.length > 10) {
    const oldest = withData[0];
    oldest.data = '';
  }
}

/** 从快照建立分支（新随机流避免重放分歧） */
export function branchFromSnapshot(w: WorldState, index: number): { world: WorldState; worldName: string } | { error: string } {
  const snap = w.snapshots[index];
  if (!snap || !snap.data) return { error: '该节点没有分支数据（请选择带 ◆ 标记的节点）' };
  const res = deserialize(snap.data);
  if ('error' in res) return res;
  const { world } = res as { world: WorldState; worldName: string };
  // 分支：改变派生随机流的分歧点，但保持世界种子记录
  world.rng = new Rng(world.rng.state ^ (Date.now() & 0xffff));
  world.snapshots = world.snapshots.filter(s => s.year <= snap.year);
  return { world, worldName: `${res.worldName} 分支` };
}
