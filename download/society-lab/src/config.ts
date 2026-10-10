import { BuildingKind } from './types';
/**
 * Society Lab — 全局参数配置
 * 提示词 §6.1：所有模拟参数集中管理，不散落在 UI 或建筑脚本中。
 * 单位约定：人口为「人」，粮食为「人·年」口粮，木材/石料/金属为抽象单位。
 */

export const CFG = {
  /** 模拟节奏 */
  yearMs1x: 1600,
  speeds: [0, 1, 2, 4] as const,

  /** 人口 */
  birthBase: 0.032,
  deathBase: 0.017,
  /** 每人每年口粮 */
  foodPerCapita: 1,
  /** 原始采集/狩猎每劳动力年产出（受地形与技术修正） */
  foragePerLabor: 2.6,
  /** 农业每劳动力年产出基础 */
  farmPerLabor: 2.2,
  /** 仓库腐败率（每年） */
  spoilage: 0.04,
  /** 最低繁衍人口 */
  minViablePop: 12,

  /** 建造 */
  buildHousingTrigger: 0.92, // 住房覆盖率低于此值即申请住宅
  farmPerFamily: 5, // 每农田供养人口（粗粒度）
  granaryCapacity: 260,

  /** 神力 */
  divineMax: 100,
  divineRegen: 4, // 每年恢复
  costs: {
    forest: 6, fertile: 5, water: 8, ore: 10,
    rain: 6, drought: 4, blessing: 12, enlighten: 10, ideas: 14,
  } as Record<string, number>,
  brushSizes: { small: 1, medium: 2, large: 3 },

  /** 技术 */
  techPointBase: 0.55, // 每百人每年知识点基数
  techCostBase: 14, // 1→2 级基础成本
  techCostExp: 1.55,

  /** 事件 */
  eventCooldown: 3,

  /** 快照 */
  snapshotEveryYears: 25,
  snapshotMax: 60,

  /** 存档 */
  saveKey: 'society-lab-save-v1',
  saveVersion: 1,
} as const;

/** 建筑定义表。era: 0 原始 1 农业 2 城镇 3 工业 4 现代 */
export const BUILDINGS: Record<string, import('./types').BuildingDef> = {
  camp: { kind: BuildingKind.Camp, name: '营地', era: 0, wood: 4, stone: 0, metal: 0, housing: 26, work: 0, desc: '篝火与兽皮帐篷，流浪者的第一处落脚点。' },
  shelter: { kind: BuildingKind.Shelter, name: '窝棚', era: 0, wood: 8, stone: 0, metal: 0, housing: 14, work: 1, desc: '木棍与茅草搭成的原始居所。' },
  farm: { kind: BuildingKind.Farm, name: '农田', era: 1, wood: 3, stone: 0, metal: 0, housing: 0, work: 1, desc: '开垦的田垄，文明的根基。' },
  granary: { kind: BuildingKind.Granary, name: '粮仓', era: 1, wood: 14, stone: 4, metal: 0, housing: 0, work: 2, desc: '储存余粮，抵御荒年。' },
  well: { kind: BuildingKind.Well, name: '水井', era: 1, wood: 6, stone: 10, metal: 0, housing: 0, work: 2, tech: ['building', 1], desc: '清洁的水源改善健康。' },
  house: { kind: BuildingKind.House, name: '农舍', era: 1, wood: 12, stone: 2, metal: 0, housing: 16, work: 1, desc: '木骨泥墙的定居者住宅。' },
  workshop: { kind: BuildingKind.Workshop, name: '工坊', era: 2, wood: 16, stone: 8, metal: 2, housing: 0, work: 2, tech: ['crafting', 3], desc: '手工匠人聚集生产。' },
  market: { kind: BuildingKind.Market, name: '集市', era: 2, wood: 10, stone: 6, metal: 0, housing: 0, work: 2, tech: ['commerce', 1], desc: '交换的场所，市场在此发育。' },
  admin: { kind: BuildingKind.Admin, name: '公廨', era: 2, wood: 20, stone: 24, metal: 0, housing: 0, work: 4, tech: ['governance', 1], desc: '权力与公共事务的中枢。' },
  wall: { kind: BuildingKind.Wall, name: '墙垒', era: 2, wood: 12, stone: 30, metal: 0, housing: 0, work: 3, tech: ['building', 2], desc: '环围聚落的防御工事。' },
  townhouse: { kind: BuildingKind.Townhouse, name: '街屋', era: 3, wood: 10, stone: 12, metal: 1, housing: 22, work: 2, tech: ['building', 4], desc: '密集的城市住宅。' },
  factory: { kind: BuildingKind.Factory, name: '工厂', era: 3, wood: 20, stone: 20, metal: 8, housing: 0, work: 4, tech: ['industry', 1], desc: '机器轰鸣的工业生产设施。' },
  cooperative: { kind: BuildingKind.Cooperative, name: '合作社', era: 4, wood: 18, stone: 16, metal: 6, housing: 0, work: 3, tech: ['education', 2], desc: '劳动者共同所有的生产组织。' },
  services: { kind: BuildingKind.Services, name: '公共堂', era: 4, wood: 16, stone: 22, metal: 4, housing: 0, work: 3, tech: ['governance', 3], desc: '医疗、教育与公共服务的殿堂。' },
};

/** 聚落阶段人口门槛 */
export const STAGE_THRESHOLDS: { stage: import('./types').SettlementStage; pop: number }[] = [
  { stage: 'camp', pop: 0 },
  { stage: 'hamlet', pop: 55 },
  { stage: 'village', pop: 130 },
  { stage: 'town', pop: 320 },
  { stage: 'city', pop: 700 },
];
