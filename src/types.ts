/**
 * Society Lab — 共享类型定义
 * 所有模块的数据契约集中在此，保证模拟内核与渲染/UI 解耦。
 */

/** 中央随机数流，模拟随机与视觉随机分离，保证可复现。 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
  /** mulberry32 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

export enum Terrain {
  Water = 0,
  Grass = 1,
  Fertile = 2,
  Forest = 3,
  Hills = 4,
  Mountain = 5,
  Rock = 6,
  // v4.0 气候带：沙漠与苔原，让世界如真实地表般多样
  Sand = 7,
  Tundra = 8,
}

export const TERRAIN_NAMES: Record<Terrain, string> = {
  [Terrain.Water]: '水域',
  [Terrain.Grass]: '草原',
  [Terrain.Fertile]: '沃土',
  [Terrain.Forest]: '森林',
  [Terrain.Hills]: '丘陵',
  [Terrain.Mountain]: '山地',
  [Terrain.Rock]: '石地',
  [Terrain.Sand]: '沙漠',
  [Terrain.Tundra]: '苔原',
};

export type ResourceKind = 'wood' | 'stone' | 'metal';

/** 地图格。资源与植被随地形派生，但可被神力修改。 */
export interface Tile {
  terrain: Terrain;
  /** 0..1 土地肥沃度 */
  fertility: number;
  /** 湿度，影响农业并受天气干预 */
  moisture: number;
  /** 海拔层级 0..6（v3.0：更丰富的起伏，悬崖渲染用） */
  elevation: number;
  /** v4.0 气候：温度 0..1（决定植被形态与渲染风格，苔原/沙漠/丛林） */
  temp: number;
  /** 是否含矿脉（丘陵/山地/石地） */
  ore: boolean;
  /** 归属聚落 id（领地圈定），-1 为无主 */
  owner: number;
}

/** v4.0 分块：世界按 CHUNK×CHUNK 的块按需生成（类 Minecraft 流式加载） */
export const CHUNK = 32;

export interface WorldChunk {
  cx: number;
  cy: number;
  tiles: Tile[];
  /** 被神力/事件修改过的块会随存档保存，且永不从缓存中淘汰 */
  modified: boolean;
  /** LRU 计时 */
  lastTouch: number;
}

export enum BuildingKind {
  Camp = 'camp',
  Shelter = 'shelter',
  House = 'house',
  Farm = 'farm',
  Granary = 'granary',
  Well = 'well',
  Workshop = 'workshop',
  Market = 'market',
  Admin = 'admin',
  Wall = 'wall',
  Townhouse = 'townhouse',
  Factory = 'factory',
  Cooperative = 'cooperative',
  Services = 'services',
  // v2.0 时代建筑：让每个社会形态拥有属于它的物质形态
  Temple = 'temple',      // 神庙：早期国家的合法性中枢（奴隶/早期王国）
  Manor = 'manor',         // 庄园：封建土地贵族的居所
  Castle = 'castle',       // 城堡：封建军事与行政中心
  Academy = 'academy',     // 学堂：文教设施
  Bank = 'bank',           // 银行：资本主义金融中枢
  Theater = 'theater',     // 剧场：市民文化生活
  Hospital = 'hospital',   // 医院：现代公共卫生
}

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  /** 建造年代需求：0 原始 / 1 农业 / 2 城镇 / 3 工业 / 4 现代 */
  era: number;
  /** 解锁所需技术（域:等级），域见 TechnologyDomain */
  tech?: [string, number];
  wood: number;
  stone: number;
  metal: number;
  /** 提供的住房人数 */
  housing: number;
  /** 建成年限（年，随工具技术缩短） */
  work: number;
  desc: string;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  builtYear: number;
  /** 建造进度 0..1 */
  progress: number;
}

export type SettlementStage = 'camp' | 'hamlet' | 'village' | 'town' | 'city';

export const STAGE_NAMES: Record<SettlementStage, string> = {
  camp: '营地',
  hamlet: '村落',
  village: '村庄',
  town: '城镇',
  city: '城市',
};

/** 聚落阶段的形容词后缀（命名用，随阶段升级而演进） */
export const STAGE_SUFFIXES: Record<SettlementStage, string[]> = {
  camp: ['部落', '寨'],
  hamlet: ['村', '屯', '庄'],
  village: ['村', '庄'],
  town: ['镇', '城'],
  city: ['城', '都'],
};

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  /** v4.0：所属文明（每个文明有自己的社会形态） */
  civId: number;
  stage: SettlementStage;
  population: number;
  buildings: Building[];
  food: number;
  wood: number;
  stone: number;
  metal: number;
  /** 领地半径（格） */
  radius: number;
  /** 连续食物短缺年数 */
  shortageYears: number;
  /** 正在建造 */
  construction: Building[];
  founded: number;
  /** 短期祝福/惩罚效果 */
  effects: { kind: string; years: number; power: number }[];
  dead: boolean;
  /** 最近一次饥荒年份 */
  lastFamine: number;
  /** v4.0 道路：聚落内的土路格子（y*size+x，含中心广场），建筑沿路分布 */
  roads: Set<number>;
}

export enum TechDomain {
  Agriculture = 'agriculture',
  Crafting = 'crafting',
  Building = 'building',
  Commerce = 'commerce',
  Governance = 'governance',
  Medicine = 'medicine',
  Industry = 'industry',
  Education = 'education',
}

export const TECH_NAMES: Record<TechDomain, string> = {
  [TechDomain.Agriculture]: '农耕',
  [TechDomain.Crafting]: '工具',
  [TechDomain.Building]: '营造',
  [TechDomain.Commerce]: '商贸',
  [TechDomain.Governance]: '治理',
  [TechDomain.Medicine]: '医道',
  [TechDomain.Industry]: '工业',
  [TechDomain.Education]: '文教',
};

export type SocietyForm =
  | 'primitive'
  | 'slave'
  | 'feudal'
  | 'capitalist'
  | 'socialist'
  | 'collapsed';

export const FORM_NAMES: Record<SocietyForm, string> = {
  primitive: '原始社会',
  slave: '奴隶制社会',
  feudal: '封建社会',
  capitalist: '资本主义社会',
  socialist: '社会主义社会',
  collapsed: '文明废墟',
};

/**
 * v4.0 文明：世界的基本单位。每个文明拥有自己的生产关系、技术、
 * 阶级结构与上层建筑——社会形态按马克思主义历史唯物主义标准
 * （生产资料所有制为核心，辅以阶级关系、分配关系、上层建筑）独立判定，
 * 不同文明可以同时处于不同的社会形态。
 */
export interface Civilization {
  id: number;
  name: string;
  /** 文明色（领土/小地图/标签/编年史着色） */
  color: string;
  /** 文化风格（建筑配色与形制差异） */
  culture: number;
  form: SocietyForm;
  formSince: number;
  prevForm: SocietyForm | null;
  vars: SocietyVars;
  tech: TechState;
  groups: SocialGroup[];
  /** 战争俘虏等冲击的记忆（衰减） */
  warMemory: number;
  /** 启蒙思潮强度 0..1（神力可提升，影响组织与改革） */
  enlightenment: number;
  /** 已接触的文明 id（接触后才发生贸易与技术扩散） */
  met: number[];
  dead: boolean;
  founded: number;
  /** 本文明的观察者曲线采样 */
  history: HistorySample[];
  /** 形态判定回滞（运行时，不序列化） */
  hystForm?: SocietyForm;
  hystCount?: number;
}

/** 宏观社会变量（文明级），即提示词 §6.2 的落地。 */
export interface SocietyVars {
  population: number;
  /** 生产资料所有制占比 */
  ownCommon: number;
  ownPrivate: number;
  ownPublic: number;
  /** 劳动关系占比 */
  laborForced: number;
  laborBonded: number;
  laborWage: number;
  laborCoop: number;
  /** 土地集中度 0..1 */
  landConcentration: number;
  /** 市场发育 0..1 */
  market: number;
  /** 国家/公共组织能力 0..1 */
  stateCapacity: number;
  /** 公共服务覆盖 0..1 */
  publicServices: number;
  /** 教育水平 0..1 */
  education: number;
  /** 分工程度 0..1 */
  specialization: number;
  /** 人均实际消费（相对基准） */
  livingStandard: number;
  /** 制度信任 0..1 */
  trust: number;
  /** 政治参与 0..1 */
  participation: number;
  /** 社会冲突风险 0..1 */
  unrest: number;
  /** 环境质量 0..1 */
  environment: number;
  /** 资源压力 0..1 */
  resourcePressure: number;
  /** 各群体财富份额 */
  wealthCommon: number;
  wealthElite: number;
  wealthMiddle: number;
  /** 群体组织能力 */
  orgCommon: number;
  orgElite: number;
}

/** 社会群体（简化三阶层，用于叙事与分配）。 */
export interface SocialGroup {
  id: 'commoners' | 'elite' | 'middle';
  name: string;
  /** 思想倾向 -1..1（-1 保守，+1 激进；用于改革方向） */
  ideas: number;
}

export interface TechState {
  levels: Record<string, number>;
  /** 累计知识点 */
  points: number;
  /** 各域积累（跨等级进度） */
  progress: Record<string, number>;
}

export type EventCategory =
  | 'harvest' | 'famine' | 'plague' | 'disaster' | 'invention'
  | 'migration' | 'trade' | 'wealth' | 'labor' | 'politics'
  | 'war' | 'ideas' | 'institution' | 'urban' | 'achievement';

export interface EventRecord {
  id: string;
  year: number;
  title: string;
  category: EventCategory;
  /** 叙事正文 */
  text: string;
  /** 原因（来自真实模拟变量） */
  causes: string[];
  /** 实际结果 */
  effects: string[];
  /** 玩家是否介入 */
  intervened: boolean;
  settlementId?: number;
  /** v4.0：所属文明（多文明各自的编年史） */
  civId?: number;
  severity: number;
  /** v3.0：视觉表现挂接（交战双方、坐标等，不改模拟语义） */
  aux?: { attackerId?: number; defenderId?: number; x?: number; y?: number; radius?: number };
}

/** v3.0：持久的沙盘印记（坟墓/陨坑/焦痕/废墟），随存档保存 */
export type DecalKind = 'grave' | 'crater' | 'scorch' | 'ruin';
export interface Decal {
  kind: DecalKind;
  x: number;
  y: number;
  year: number;
  seed: number;
}

export interface ActiveEvent {
  id: string;
  year: number;
  yearsLeft: number;
  data: Record<string, number>;
}

export interface WeatherCell {
  /** 干湿偏移 -1..1，正为多雨 */
  wet: number;
  years: number;
}

export interface ChronicleEntry extends EventRecord {
  /** 分支节点标记 */
  node?: boolean;
}

export type GodPowerId =
  | 'forest' | 'fertile' | 'water' | 'ore' | 'meadow' | 'uplift'
  | 'rain' | 'drought'
  | 'meteor' | 'storm' | 'wildfire' | 'pestilence'
  | 'blessing' | 'enlighten' | 'ideas' | 'heal' | 'found';

export type PlayMode = 'free' | 'limited';

export interface GameConfig {
  seed: number;
  /** 世界边长（格）。v4.0：分块流式生成，256/512/1024 的巨大世界 */
  size: number;
  mode: PlayMode;
  /** 初始文明数（每个文明一个起始聚落，各自独立演化） */
  settlements: number;
  scenario: 'dawn' | 'valley';
}

export interface HistorySample {
  year: number;
  pop: number;
  food: number;
  unrest: number;
  elite: number;
  form: SocietyForm;
}

export interface WorldState {
  config: GameConfig;
  year: number;
  /** v4.0 分块地形：按需生成、LRU 缓存；modified 的块随存档保存 */
  chunks: Map<number, WorldChunk>;
  /** 稀疏天气（仅被神力干预过的格子；key = y*size+x） */
  weather: Map<number, WeatherCell>;
  settlements: Settlement[];
  /** v4.0 多文明：每个文明独立的社会形态与历史进程 */
  civs: Civilization[];
  chronicle: ChronicleEntry[];
  activeEvents: ActiveEvent[];
  /** 神力使用记录（编年史视角） */
  interventions: number;
  /** 神力能量（有限模式） */
  divine: number;
  divineMax: number;
  rng: Rng;
  nextBuildingId: number;
  nextEventId: number;
  /** 分支快照（里程碑节点） */
  snapshots: { year: number; label: string; data: string }[];
  /** v3.0：持久沙盘印记（坟墓/陨坑/焦痕/废墟），上限控制内存 */
  decals: Decal[];
  /** 世界生成上下文（噪声与阈值；重建自 seed，不序列化） */
  gen: import('./worldgen').GenContext;
  /** 当前镜头聚焦/观察的文明 id */
  observedCiv: number;
  /** 运行时缓存：文明按 id 索引（id === 数组下标） */
  civIndex: Map<number, Civilization>;
}
