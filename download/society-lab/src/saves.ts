/**
 * SaveManager — 存档、读档与世界分支
 * 版本化 JSON；localStorage 槽位 + 文件导出/导入；
 * 快照支持「从历史节点创建分支」。随机数状态一并保存保证可复现。
 */
import { CFG } from './config';
import { Rng, Terrain, type WorldState, type Tile } from './types';

interface SavePayload {
  version: number;
  savedAt: number;
  worldName: string;
  world: Serialized;
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
  // 地形压缩为分量数组
  tTerrain: number[];
  tFert: number[];
  tMoist: number[];
  tElev: number[];
  tOre: number[];
  tOwner: number[];
  weather: { wet: number; years: number }[];
  settlements: WorldState['settlements'];
  civ: WorldState['civ'];
  chronicle: WorldState['chronicle'];
  activeEvents: WorldState['activeEvents'];
  history: WorldState['history'];
  snapshots: WorldState['snapshots'];
  /** v3.0：持久沙盘印记 */
  decals: WorldState['decals'];
}

export function serialize(w: WorldState, worldName: string): string {
  const size = w.config.size;
  const tTerrain: number[] = [], tFert: number[] = [], tMoist: number[] = [],
    tElev: number[] = [], tOre: number[] = [], tOwner: number[] = [];
  for (const t of w.tiles) {
    tTerrain.push(t.terrain);
    tFert.push(Math.round(t.fertility * 200));
    tMoist.push(Math.round(t.moisture * 200));
    tElev.push(t.elevation);
    tOre.push(t.ore ? 1 : 0);
    tOwner.push(t.owner + 1); // -1 → 0
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
      size,
      tTerrain, tFert, tMoist, tElev, tOre, tOwner,
      weather: w.weather.map(c => ({ wet: Math.round(c.wet * 50) / 50, years: c.years })),
      settlements: w.settlements,
      civ: w.civ,
      chronicle: w.chronicle.slice(-500),
      activeEvents: w.activeEvents,
      history: w.history,
      decals: w.decals.slice(-CFG.agents.decalsMax),
      // 控制存档体积：仅保留带数据的最近 8 个快照
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
  if (!payload || payload.version !== CFG.saveVersion || !payload.world) {
    return { error: `存档版本不兼容（当前支持 v${CFG.saveVersion}）` };
  }
  const s = payload.world;
  const size = s.size;
  const tiles: Tile[] = new Array(size * size);
  for (let i = 0; i < tiles.length; i++) {
    tiles[i] = {
      terrain: s.tTerrain[i] as Terrain,
      fertility: s.tFert[i] / 200,
      moisture: s.tMoist[i] / 200,
      elevation: s.tElev[i],
      ore: s.tOre[i] === 1,
      owner: s.tOwner[i] - 1,
    };
  }
  const rng = new Rng(1);
  rng.state = s.rngState;
  const world: WorldState = {
    config: s.config,
    year: s.year,
    tiles,
    weather: s.weather.map(c => ({ wet: c.wet, years: c.years })),
    settlements: s.settlements,
    civ: s.civ,
    chronicle: s.chronicle,
    activeEvents: s.activeEvents,
    history: s.history,
    decals: s.decals ?? [],
    interventions: s.interventions,
    divine: s.divine,
    divineMax: s.divineMax,
    rng,
    nextBuildingId: s.nextBuildingId,
    nextEventId: s.nextEventId,
    snapshots: s.snapshots,
  };
  return { world, worldName: payload.worldName };
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
      out.push({ key, index: i, worldName: p.worldName, year: p.world.year, savedAt: p.savedAt, form: p.world.civ.form });
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
