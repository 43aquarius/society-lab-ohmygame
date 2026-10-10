import { BuildingKind } from './types';
/**
 * Society Lab — 全局参数配置
 * 提示词 §6.1：所有模拟参数集中管理，不散落在 UI 或建筑脚本中。
 * 单位约定：人口为「人」，粮食为「人·年」口粮，木材/石料/金属为抽象单位。
 *
 * v2.0 平衡目标（历史进程合理性）：
 * - 人口净增长在顺境约 0.6%~1.0%/年（前现代水平），大饥荒/疫病可造成负增长
 * - 聚落优先「长大」（村落→城镇→城市），而非无限分蘖成小部落
 * - 技术进步依赖城市化、文教与分工，而非单纯人口堆积
 * - 社会形态判定带硬性前置（见 sim/society.ts），杜绝"住窝棚的资本主义"
 */

export const CFG = {
  /** 模拟节奏（v2.0 放慢：一年约 2.2 秒，让演化被看清） */
  yearMs1x: 2200,
  speeds: [0, 1, 2, 4, 8] as const,

  /** 人口（v2.0：净增速率控制在顺境 ~1%/年前现代水平） */
  birthBase: 0.028,
  deathBase: 0.019,
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

  /** 迁徙与聚居（v2.0：优先流入既有聚落，分蘖受限） */
  migrationAbsorbFoodHeadroom: 1.25, // 目的地粮储/需求比需高于此值
  splinterMinPop: 150, // 母体人口低于此值不再分蘖
  splinterCooldownYears: 25,

  /** 神力 */
  divineMax: 100,
  divineRegen: 4, // 每年恢复
  costs: {
    forest: 6, fertile: 5, water: 8, ore: 10, meadow: 4, uplift: 9,
    rain: 6, drought: 4,
    meteor: 16, storm: 10, wildfire: 8, pestilence: 14,
    blessing: 12, enlighten: 10, ideas: 14, heal: 12, found: 18,
  } as Record<string, number>,
  brushSizes: { small: 1, medium: 2, large: 3 },

  /** 技术（v2.0：曲线放缓 + 依赖城市化/文教，见 sim/technology.ts） */
  techPointBase: 0.05, // 每人每年知识点基数
  techUrbanBonus: 0.02, // 城市化人口的额外知识产出系数
  techCostBase: 26, // 1→2 级基础成本
  techCostExp: 1.6,

  /** 事件 */
  eventCooldown: 3,

  /** 快照 */
  snapshotEveryYears: 25,
  snapshotMax: 60,

  /** 存档 */
  saveKey: 'society-lab-save-v2',
  saveVersion: 2,
} as const;

/**
 * 建筑定义表。era: 0 原始 / 1 农业 / 2 城镇 / 3 工业 / 4 现代
 * v2.0 新增时代建筑：神庙（早期国家）、庄园/城堡（封建）、学堂、银行/剧场（资本主义）、医院（现代）。
 */
export const BUILDINGS: Record<string, import('./types').BuildingDef> = {
  camp: { kind: BuildingKind.Camp, name: '营地', era: 0, wood: 4, stone: 0, metal: 0, housing: 26, work: 0, desc: '篝火与兽皮帐篷，流浪者的第一处落脚点。' },
  shelter: { kind: BuildingKind.Shelter, name: '窝棚', era: 0, wood: 8, stone: 0, metal: 0, housing: 14, work: 1, desc: '木棍与茅草搭成的原始居所。' },
  farm: { kind: BuildingKind.Farm, name: '农田', era: 1, wood: 3, stone: 0, metal: 0, housing: 0, work: 1, desc: '开垦的田垄，文明的根基。' },
  granary: { kind: BuildingKind.Granary, name: '粮仓', era: 1, wood: 14, stone: 4, metal: 0, housing: 0, work: 2, desc: '储存余粮，抵御荒年。' },
  well: { kind: BuildingKind.Well, name: '水井', era: 1, wood: 6, stone: 10, metal: 0, housing: 0, work: 2, tech: ['building', 1], desc: '清洁的水源改善健康。' },
  house: { kind: BuildingKind.House, name: '农舍', era: 1, wood: 12, stone: 2, metal: 0, housing: 16, work: 1, desc: '木骨泥墙的定居者住宅。' },
  temple: { kind: BuildingKind.Temple, name: '神庙', era: 2, wood: 20, stone: 18, metal: 0, housing: 0, work: 4, tech: ['governance', 2], desc: '祭司阶层在此凝聚信仰，为权力赋予合法性。' },
  workshop: { kind: BuildingKind.Workshop, name: '工坊', era: 2, wood: 16, stone: 8, metal: 2, housing: 0, work: 2, tech: ['crafting', 3], desc: '手工匠人聚集生产。' },
  market: { kind: BuildingKind.Market, name: '集市', era: 2, wood: 10, stone: 6, metal: 0, housing: 0, work: 2, tech: ['commerce', 1], desc: '交换的场所，市场在此发育。' },
  admin: { kind: BuildingKind.Admin, name: '公廨', era: 2, wood: 20, stone: 24, metal: 0, housing: 0, work: 4, tech: ['governance', 1], desc: '权力与公共事务的中枢。' },
  manor: { kind: BuildingKind.Manor, name: '庄园', era: 2, wood: 22, stone: 16, metal: 0, housing: 10, work: 4, tech: ['agriculture', 5], desc: '豪族的大宅与谷仓，佃户在周围耕作其土地。' },
  castle: { kind: BuildingKind.Castle, name: '城堡', era: 2, wood: 16, stone: 40, metal: 2, housing: 6, work: 6, tech: ['building', 4], desc: '领主的堡垒，拱卫一方秩序。' },
  wall: { kind: BuildingKind.Wall, name: '墙垒', era: 2, wood: 12, stone: 30, metal: 0, housing: 0, work: 3, tech: ['building', 2], desc: '环围聚落的防御工事。' },
  academy: { kind: BuildingKind.Academy, name: '学堂', era: 2, wood: 18, stone: 14, metal: 0, housing: 0, work: 3, tech: ['education', 3], desc: '读书声与算学，知识开始被系统传授。' },
  townhouse: { kind: BuildingKind.Townhouse, name: '街屋', era: 3, wood: 10, stone: 12, metal: 1, housing: 22, work: 2, tech: ['building', 4], desc: '密集的城市住宅。' },
  factory: { kind: BuildingKind.Factory, name: '工厂', era: 3, wood: 20, stone: 20, metal: 8, housing: 0, work: 4, tech: ['industry', 1], desc: '机器轰鸣的工业生产设施。' },
  bank: { kind: BuildingKind.Bank, name: '银行', era: 3, wood: 12, stone: 22, metal: 4, housing: 0, work: 3, tech: ['commerce', 4], desc: '信用的神殿，资本在此集结与流转。' },
  theater: { kind: BuildingKind.Theater, name: '剧场', era: 3, wood: 20, stone: 12, metal: 0, housing: 0, work: 3, tech: ['commerce', 3], desc: '市民的欢宴之所，新思想也在幕间流传。' },
  hospital: { kind: BuildingKind.Hospital, name: '医院', era: 4, wood: 14, stone: 24, metal: 4, housing: 0, work: 3, tech: ['medicine', 5], desc: '系统化的救死扶伤，公共卫生的里程碑。' },
  cooperative: { kind: BuildingKind.Cooperative, name: '合作社', era: 4, wood: 18, stone: 16, metal: 6, housing: 0, work: 3, tech: ['education', 2], desc: '劳动者共同所有的生产组织。' },
  services: { kind: BuildingKind.Services, name: '公共堂', era: 4, wood: 16, stone: 22, metal: 4, housing: 0, work: 3, tech: ['governance', 3], desc: '医疗、教育与公共服务的殿堂。' },
};

/** 聚落阶段人口门槛（v2.0 上调：聚落要长成真正的村庄/城镇/城市） */
export const STAGE_THRESHOLDS: { stage: import('./types').SettlementStage; pop: number }[] = [
  { stage: 'camp', pop: 0 },
  { stage: 'hamlet', pop: 60 },
  { stage: 'village', pop: 150 },
  { stage: 'town', pop: 400 },
  { stage: 'city', pop: 1000 },
];

/** 每阶段允许的最多并存聚落数系数（越大越倾向扩张新聚落） */
export const SETTLEMENT_CAP_DIV = 14; // 上限 = max(3, 地图边长 / 14)
