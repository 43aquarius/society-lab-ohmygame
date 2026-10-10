/**
 * v3.0 居民智能体系统 —— 画面上的"真实的人"
 * - 持久实体：不会无故刷新消失/出现；增减只因为出生/死亡/迁徙
 * - 生老病死：婴儿在住处出生 → 童年玩耍 → 成年劳作 → 老年佝偻 →
 *   死亡倒地 → 众人驻足 → 坟墓留在聚落旁（持久 decal）
 * - 昼夜作息：夜里回屋睡觉（窗户亮灯），清晨出门上工，
 *   白天在农田/工坊/市场/神庙各司其职，黄昏围炉社交
 * - 职业与时代：采集-农耕-城镇-工业各时代的行为与衣着不同
 * - 疫病会真的让小人病倒（发绿、咳嗽、佝偻），饥荒让田地枯黄、脚步迟缓
 */
import { BuildingKind, Terrain, type WorldState, type Settlement, type Building } from '../types';
import { CFG } from '../config';
import { tileAt } from '../worldgen';
import { gridToScreen, elevAt, ELEV_H, vhash } from './iso';

export type AgentJob =
  | 'farmer' | 'forager' | 'crafter' | 'trader' | 'priest'
  | 'scholar' | 'guard' | 'child' | 'elder';

export type AgentState =
  | 'sleep' | 'home' | 'goto' | 'work' | 'idle' | 'social' | 'dying' | 'migrate';

export interface Agent {
  id: number;
  sid: number;
  gx: number; gy: number;
  age: number;
  lifespan: number;
  gender: 0 | 1;
  job: AgentJob;
  state: AgentState;
  tx: number; ty: number;
  wait: number;
  phase: number;
  dir: 1 | -1;
  speed: number;
  sick: number;
  dying: number;
  variant: number;
  homeX: number; homeY: number;
  workX: number; workY: number;
  taskT: number;
  slot: number;      // 当前日程段缓存
  stuck: number;
  mourn: number;
  seed: number;
}

/** 视觉随机（与模拟 RNG 分离） */
let aseed = 987654;
const arnd = () => {
  aseed = (aseed * 1664525 + 1013904223) >>> 0;
  return aseed / 4294967296;
};

const SURNAME = '岩风林木云山谷河雪明铁白苍松石泉雷火羽鹿狼隼燕苇棠洪温';
const GIVEN = '阿禾阿叶阿川阿汐阿岿阿露阿聿阿岑阿照阿苇阿泉小满小雪小满立春谷雨白露寒露霜降青禾青川青岩砚舟砚山观澜听澜一苇一粟知秋知雨怀瑾怀瑜见山见鹿思远致远行舟行川慕禾慕橙橙黄橙绿悠悠然然宁宁安安'.match(/.{2}/gu) ?? ['阿禾'];
const AGENT_NAMES = (() => {
  const out: string[] = [];
  for (let i = 0; i < SURNAME.length; i++) {
    for (let j = 0; j < GIVEN.length; j += 7) {
      out.push(SURNAME[i] + GIVEN[(i * 3 + j) % GIVEN.length]);
    }
  }
  return out;
})();
export function agentName(id: number): string {
  return AGENT_NAMES[(id * 2654435761 >>> 8) % AGENT_NAMES.length];
}

export function jobName(job: AgentJob, age: number): string {
  switch (job) {
    case 'child': return age < 8 ? '孩童' : '少年';
    case 'elder': return '长者';
    case 'farmer': return '农人';
    case 'forager': return '采集者';
    case 'crafter': return '匠人';
    case 'trader': return '商贩';
    case 'priest': return '祭司';
    case 'scholar': return '学士';
    case 'guard': return '卫士';
  }
}

/** 每聚落可见人数：小聚落人人可见；大聚落封顶（象征性密度） */
function agentTarget(pop: number): number {
  if (pop <= 0) return 0;
  if (pop <= 90) return pop;
  return Math.min(CFG.agents.perSettlementCap, Math.round(90 + Math.sqrt(pop - 90) * 5));
}

/** 智能体系统的文明查找（聚落 id → 文明） */
function civOfAgent(w: WorldState, sid: number): number {
  const s = w.settlements.find(x => x.id === sid);
  return s ? s.civId : 0;
}

/** 聚落的时代（衣着/行为风格） */
export function settlementEra(w: WorldState, s: Settlement): number {
  switch (s.stage) {
    case 'camp': return 0;
    case 'hamlet': case 'village': return 1;
    case 'town': return 2;
    case 'city': return (w.civs[s.civId].tech.levels.industry ?? 1) >= 3 ? 3 : 2;
  }
}

function walkableAt(w: WorldState, x: number, y: number, fromElev?: number): boolean {
  const size = w.gen.size;
  if (x < 0.5 || y < 0.5 || x >= size - 0.5 || y >= size - 0.5) return false;
  const t = tileAt(w, x | 0, y | 0);
  if (!t) return false;
  if (t.terrain === Terrain.Water || t.terrain === Terrain.Mountain) return false;
  // 下坡任意可走（人会下坡）；上坡最多爬 2 级（真正的绝壁拦住人）
  if (fromElev !== undefined && t.elevation > fromElev + 2) return false;
  return true;
}

/** 找聚落内一个住宅点 */
function homeSpot(w: WorldState, s: Settlement): { x: number; y: number } {
  const homes = s.buildings.filter(b =>
    b.progress >= 1 && (b.kind === BuildingKind.Camp || b.kind === BuildingKind.Shelter
      || b.kind === BuildingKind.House || b.kind === BuildingKind.Townhouse || b.kind === BuildingKind.Manor));
  if (homes.length) {
    const b = homes[(arnd() * homes.length) | 0];
    return { x: b.x + (arnd() - 0.5) * 0.9, y: b.y + (arnd() - 0.5) * 0.9 };
  }
  return { x: s.x + (arnd() - 0.5) * 2, y: s.y + (arnd() - 0.5) * 2 };
}

/** 找一份工作地点（依聚落现有建筑与时代） */
function pickWork(w: WorldState, s: Settlement, job: AgentJob): { x: number; y: number } | null {
  const size = w.config.size;
  const done = s.buildings.filter(b => b.progress >= 1);
  const find = (kind: BuildingKind): { x: number; y: number } | null => {
    const cands = done.filter(b => b.kind === kind);
    if (!cands.length) return null;
    const b = cands[(arnd() * cands.length) | 0];
    return { x: b.x + (arnd() - 0.5) * 1.4, y: b.y + (arnd() - 0.5) * 1.4 };
  };
  switch (job) {
    case 'farmer': return find(BuildingKind.Farm);
    case 'crafter': return find(BuildingKind.Workshop) ?? find(BuildingKind.Factory);
    case 'trader': return find(BuildingKind.Market);
    case 'priest': return find(BuildingKind.Temple);
    case 'scholar': return find(BuildingKind.Academy);
    case 'guard': return find(BuildingKind.Castle) ?? find(BuildingKind.Admin) ?? find(BuildingKind.Wall);
    case 'forager': {
      // 走向领地内的森林
      for (let a = 0; a < 24; a++) {
        const ang = arnd() * Math.PI * 2;
        const r = 2 + arnd() * Math.min(9, s.radius + 4);
        const x = s.x + Math.cos(ang) * r, y = s.y + Math.sin(ang) * r;
        if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
        const t = tileAt(w, x | 0, y | 0);
        if (t && t.terrain === Terrain.Forest) return { x, y };
      }
      return null;
    }
    default: return null;
  }
}

function assignJob(w: WorldState, s: Settlement, a: Agent): void {
  if (a.age < CFG.agents.adultAge) { a.job = 'child'; return; }
  if (a.age >= CFG.agents.elderAge) { a.job = 'elder'; return; }
  const done = s.buildings.filter(b => b.progress >= 1);
  const has = (k: BuildingKind) => done.some(b => b.kind === k);
  const count = (k: BuildingKind) => done.filter(b => b.kind === k).length;
  const farms = count(BuildingKind.Farm);
  const r = vhash(a.id, a.seed * 997 | 0, 3);
  const pop = s.population;
  if (has(BuildingKind.Factory) && r < 0.34) a.job = 'crafter';
  else if (has(BuildingKind.Workshop) && r < 0.44) a.job = 'crafter';
  else if (farms > 0 && r < 0.62) a.job = 'farmer';
  else if (farms === 0 && r < 0.62) a.job = 'forager';
  else if (has(BuildingKind.Market) && r < 0.74) a.job = 'trader';
  else if (has(BuildingKind.Temple) && r < 0.82) a.job = 'priest';
  else if (has(BuildingKind.Academy) && r < 0.88) a.job = 'scholar';
  else if ((has(BuildingKind.Castle) || has(BuildingKind.Admin)) && pop > 120 && r < 0.94) a.job = 'guard';
  else a.job = farms > 0 ? 'farmer' : 'forager';
}

function lifeStageOf(a: Agent): 'child' | 'adult' | 'elder' {
  if (a.age < CFG.agents.adultAge) return 'child';
  if (a.age >= CFG.agents.elderAge) return 'elder';
  return 'adult';
}

/** ---- AgentSystem ---- */
export class AgentSystem {
  agents: Agent[] = [];
  private nextId = 1;
  private lastPops = new Map<number, number>();
  private graveyards = new Map<number, { x: number; y: number }>();
  /** 供点击检视：最近一次绘制的智能体屏幕位置（世界像素） */
  lastDrawn: Agent[] = [];

  /** 每个模拟年调用：年龄增长、出生/死亡/迁徙、职业与时疫 */
  syncYear(w: WorldState) {
    const globalCap = CFG.agents.globalCap;
    // 年龄 + 自然死亡判定
    for (const a of this.agents) {
      a.age++;
      const med = w.civs[civOfAgent(w, a.sid)]?.tech.levels.medicine ?? 1;
      if (a.age >= a.lifespan + med * 0.8 && a.state !== 'dying') {
        this.startDying(a);
      }
    }

    for (const s of w.settlements) {
      if (s.dead) {
        this.agents = this.agents.filter(a => !(a.sid === s.id && a.state !== 'dying'));
        continue;
      }
      const target = agentTarget(s.population);
      // 计入仍在弥留的居民：他们下葬前仍是"人"，避免死亡瞬间过量补充新生儿
      const current = this.agents.filter(a => a.sid === s.id).length;
      const last = this.lastPops.get(s.id) ?? s.population;

      if (current === 0 && target > 0) {
        // 新聚落/初次生成：按年龄结构布居（全局上限保护）
        const n = Math.min(target, 40, Math.max(0, CFG.agents.globalCap - this.agents.length));
        for (let i = 0; i < n; i++) {
          const home = homeSpot(w, s);
          const age = i === 0 ? 38 : Math.floor(3 + arnd() * arnd() * 55);
          this.spawnAgent(w, s, home.x, home.y, age);
        }
      } else if (target > current) {
        const diff = target - current;
        const room = Math.max(0, CFG.agents.globalCap - this.agents.length);
        if (diff <= 6) {
          // 出生：婴儿在住处出现（旁边站着母亲）
          for (let i = 0; i < Math.min(diff, room); i++) {
            const home = homeSpot(w, s);
            this.spawnAgent(w, s, home.x, home.y, 0);
          }
        } else {
          // 大量涌入（移民潮）：从其他大聚落走来（全局同时在途移民限流）
          const src = w.settlements.find(x => !x.dead && x.id !== s.id && x.population > s.population * 0.6)
            ?? w.settlements.find(x => !x.dead && x.id !== s.id);
          const from = src ?? { x: s.x + 12, y: s.y + 12 };
          const migrating = this.agents.filter(x => x.state === 'migrate').length;
          const n = Math.min(diff - 3, 10, room, Math.max(0, 30 - migrating));
          for (let i = 0; i < n; i++) {
            const a = this.spawnAgent(w, s, from.x + (arnd() - 0.5) * 3, from.y + (arnd() - 0.5) * 3,
              Math.floor(16 + arnd() * 40));
            a.state = 'migrate';
            a.tx = s.x + (arnd() - 0.5) * 3; a.ty = s.y + (arnd() - 0.5) * 3;
          }
          for (let i = 0; i < Math.min(3, room - n); i++) {
            const home = homeSpot(w, s);
            this.spawnAgent(w, s, home.x, home.y, 0);
          }
        }
      } else if (target < current) {
        // 减员：老人/病者先走
        const pool = this.agents
          .filter(a => a.sid === s.id && a.state !== 'dying')
          .sort((x, y) => (y.sick * 40 + y.age) - (x.sick * 40 + x.age));
        const n = Math.min(current - target, 8);
        for (let i = 0; i < n && i < pool.length; i++) this.startDying(pool[i]);
      }

      // 时疫：活跃疫病让人生病，部分病亡
      const plague = w.activeEvents.find(ae => ae.id === 'plague-outbreak' && ae.data.settlementId === s.id);
      if (plague) {
        const lethality = plague.data.lethality ?? 0.04;
        const mine = this.agents.filter(a => a.sid === s.id && a.state !== 'dying');
        const infect = Math.round(mine.length * Math.min(0.55, 0.18 + lethality * 4));
        for (let i = 0; i < infect && i < mine.length; i++) {
          const a = mine[(arnd() * mine.length) | 0];
          a.sick = Math.min(1, a.sick + 0.55 + arnd() * 0.3);
        }
        const deaths = Math.round(mine.length * lethality * 0.5);
        for (let i = 0; i < deaths; i++) {
          const sickOnes = mine.filter(a => a.sick > 0.3 && a.state !== 'dying');
          const victim = sickOnes.length ? sickOnes[(arnd() * sickOnes.length) | 0] : mine[(arnd() * mine.length) | 0];
          if (victim) this.startDying(victim);
        }
      } else {
        // 无疫：缓慢康复
        for (const a of this.agents) if (a.sid === s.id) a.sick = Math.max(0, a.sick - 0.35);
      }

      // 职业随聚落发展调整（v3.0.1：每年 15% 成年人转岗 —— 新行业出现后人们会改行）
      for (const a of this.agents) {
        if (a.sid !== s.id || a.state === 'dying') continue;
        const stage = lifeStageOf(a);
        if (stage === 'child' && a.job !== 'child') a.job = 'child';
        else if (stage === 'elder' && a.job !== 'elder') a.job = 'elder';
        else if (stage === 'adult' && arnd() < 0.15) assignJob(w, s, a);
      }
      this.lastPops.set(s.id, s.population);
      void last;
    }

    // 聚落湮灭 → 废墟
    for (const s of w.settlements) {
      if (s.dead && !w.decals.some(d => d.kind === 'ruin' && d.x === s.x && d.y === s.y)) {
        w.decals.push({ kind: 'ruin', x: s.x, y: s.y, year: w.year, seed: arnd() });
        if (w.decals.length > CFG.agents.decalsMax) w.decals.shift();
      }
    }
  }

  private spawnAgent(w: WorldState, s: Settlement, x: number, y: number, age: number): Agent {
    const med = w.civs[s.civId].tech.levels.medicine ?? 1;
    const a: Agent = {
      id: this.nextId++,
      sid: s.id,
      gx: x, gy: y,
      age,
      lifespan: Math.round(CFG.agents.lifespanMin + arnd() * (CFG.agents.lifespanMax - CFG.agents.lifespanMin + med * 1.5)),
      gender: arnd() > 0.5 ? 1 : 0,
      job: 'farmer',
      state: 'idle',
      tx: x, ty: y,
      wait: arnd() * 2,
      phase: arnd() * Math.PI * 2,
      dir: arnd() > 0.5 ? 1 : -1,
      speed: 0.62 + arnd() * 0.25,
      sick: 0,
      dying: 0,
      variant: (arnd() * 4) | 0,
      homeX: x, homeY: y,
      workX: x, workY: y,
      taskT: 0,
      slot: -1,
      stuck: 0,
      mourn: 0,
      seed: arnd(),
    };
    assignJob(w, s, a);
    const home = homeSpot(w, s);
    a.homeX = home.x; a.homeY = home.y;
    const work = pickWork(w, s, a.job);
    if (work) { a.workX = work.x; a.workY = work.y; }
    this.agents.push(a);
    return a;
  }

  /** 开始死亡：倒地 → 众人驻足 → 坟墓 */
  startDying(a: Agent) {
    if (a.state === 'dying') return;
    a.state = 'dying';
    a.dying = 2.0;
    a.wait = 0;
    // 附近的同乡驻足致哀
    for (const o of this.agents) {
      if (o.sid !== a.sid || o === a || o.state === 'dying') continue;
      const d = Math.hypot(o.gx - a.gx, o.gy - a.gy);
      if (d < 3.2) { o.mourn = 2.2 + arnd(); o.dir = a.gx > o.gx ? 1 : -1; }
    }
  }

  /** 每帧推进（dt 秒，dayPhase 0..1，paused 时冻结） */
  update(w: WorldState, dt: number, dayPhase: number, paused: boolean) {
    if (paused) return;
    const slot = daySlot(dayPhase);
    for (const a of this.agents) {
      if (a.state === 'dying') {
        a.dying -= dt;
        a.phase += dt * 2;
        if (a.dying <= 0) {
          this.bury(w, a);
        }
        continue;
      }
      if (a.mourn > 0) { a.mourn -= dt; continue; }
      if (a.state === 'migrate') {
        this.step(w, a, dt, 1.1);
        if (Math.hypot(a.tx - a.gx, a.ty - a.gy) < 0.6) { a.state = 'idle'; a.wait = arnd() * 2; }
        continue;
      }
      // 日程切换
      if (a.slot !== slot) {
        a.slot = slot;
        this.schedule(w, a, slot, dayPhase);
      }
      switch (a.state) {
        case 'sleep':
          a.phase += dt * 1.2;
          break;
        case 'goto':
          this.step(w, a, dt, 1);
          if (Math.hypot(a.tx - a.gx, a.ty - a.gy) < 0.14) {
            if (a.wait === -2) {
              a.state = 'sleep';            // 夜里到家入睡（人在屋内）
            } else if (a.wait === -1) {
              a.state = 'work';
              a.taskT = 3 + arnd() * 7;
            } else {
              a.state = 'idle';
            }
            a.wait = Math.abs(a.wait);
          }
          break;
        case 'work':
          a.taskT -= dt;
          a.phase += dt * 4.2;
          if (a.taskT <= 0) {
            // 换任务：回家/换田/去仓库/闲逛
            this.schedule(w, a, slot, dayPhase, true);
          }
          break;
        case 'idle':
        case 'social':
          a.wait -= dt;
          a.phase += dt * 2.2;
          if (a.wait <= 0) this.schedule(w, a, slot, dayPhase, true);
          break;
        case 'home':
          a.wait -= dt;
          if (a.wait <= 0) this.schedule(w, a, slot, dayPhase, true);
          break;
      }
    }
    // 清理已下葬者
    if (this.agents.some(a => a.state === 'dying' && a.dying <= 0)) {
      this.agents = this.agents.filter(a => !(a.state === 'dying' && a.dying <= 0));
    }
  }

  /** 安排一个新去处 */
  private schedule(w: WorldState, a: Agent, slot: number, dayPhase: number, reassign = false) {
    const s = w.settlements.find(x => x.id === a.sid);
    if (!s || s.dead) return;
    const stage = lifeStageOf(a);
    const famine = s.shortageYears > 1 ? 0.6 : 1;

    // 夜里：回家睡觉
    if (slot === 0) {
      if (a.job === 'guard' && stage === 'adult') {
        // 卫士夜巡
        const ang = arnd() * Math.PI * 2;
        a.tx = s.x + Math.cos(ang) * (s.radius + 1);
        a.ty = s.y + Math.sin(ang) * (s.radius + 1);
        a.state = 'goto'; a.wait = -1; a.taskT = 5 + arnd() * 6;
        return;
      }
      a.tx = a.homeX; a.ty = a.homeY;
      a.state = 'goto';
      a.wait = -2; // 到达即睡
      return;
    }
    // 清晨与黄昏：社交（围炉/井边/市集）
    if (slot === 1 || slot === 3) {
      const r = arnd();
      if (r < 0.55) {
        const spot = socialSpot(w, s);
        a.tx = spot.x + (arnd() - 0.5) * 2.4;
        a.ty = spot.y + (arnd() - 0.5) * 2.4;
        a.state = 'goto';
        a.wait = 2 + arnd() * 4;
        return;
      }
    }
    // 白天：各司其职
    if (stage === 'child') {
      // 孩童在住处附近追逐玩耍
      const ang = arnd() * Math.PI * 2;
      const r = 1.2 + arnd() * 2.2;
      a.tx = a.homeX + Math.cos(ang) * r;
      a.ty = a.homeY + Math.sin(ang) * r;
      a.state = 'goto';
      a.wait = 1 + arnd() * 3;
      return;
    }
    if (stage === 'elder') {
      // 长者：缓步或坐在炉边
      if (reassign && arnd() < 0.5) { a.state = 'idle'; a.wait = 3 + arnd() * 5; return; }
      const spot = socialSpot(w, s);
      a.tx = spot.x + (arnd() - 0.5) * 2;
      a.ty = spot.y + (arnd() - 0.5) * 2;
      a.state = 'goto';
      a.wait = 3 + arnd() * 4;
      return;
    }
    // 成年人：去工作地点；干活间隙去仓库/换地/巡视
    // v3.0.1：固定工作地（不每次随机换田，否则整天在路上）
    let work: { x: number; y: number } | null = null;
    const dHome = Math.hypot(a.workX - s.x, a.workY - s.y);
    const workValid = dHome < s.radius + 5 && walkableAt(w, a.workX, a.workY);
    if (!workValid || (reassign && arnd() < 0.12)) {
      work = pickWork(w, s, a.job);
      if (work) { a.workX = work.x; a.workY = work.y; }
    } else {
      work = { x: a.workX + (arnd() - 0.5) * 1.2, y: a.workY + (arnd() - 0.5) * 1.2 };
    }
    if (!work) {
      const ang = arnd() * Math.PI * 2;
      const r = 1 + arnd() * Math.min(6, s.radius + 2);
      a.tx = s.x + Math.cos(ang) * r;
      a.ty = s.y + Math.sin(ang) * r;
      a.state = 'goto';
      a.wait = 2 + arnd() * 4;
      return;
    }
    if (reassign && arnd() < 0.3) {
      // 干活间隙：扛着东西往返（表现搬运）
      a.tx = a.homeX + (arnd() - 0.5) * 1.5;
      a.ty = a.homeY + (arnd() - 0.5) * 1.5;
      a.state = 'goto';
      a.wait = 0.8 + arnd() * 1.6;
      return;
    }
    a.workX = work.x; a.workY = work.y;
    a.tx = work.x; a.ty = work.y;
    a.state = 'goto';
    a.wait = -1;
    a.taskT = (4 + arnd() * 8) * famine;
  }

  /** 网格空间移动（含悬崖/水域规避） */
  private step(w: WorldState, a: Agent, dt: number, speedMul: number) {
    const stage = lifeStageOf(a);
    const famineSlow = a.sick > 0.3 ? 0.55 : 1;
    const spd = a.speed * speedMul * famineSlow
      * (stage === 'child' ? 1.25 : stage === 'elder' ? 0.5 : 1)
      * (a.state === 'migrate' ? 1.6 : 1);
    const dx = a.tx - a.gx, dy = a.ty - a.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.02) return;
    if (Math.abs(dx) > 0.04) a.dir = dx > 0 ? 1 : -1;
    const here = elevAt(w, a.gx, a.gy);
    const st = Math.min(dist, spd * dt);
    let nx = a.gx + (dx / dist) * st;
    let ny = a.gy + (dy / dist) * st;
    if (!walkableAt(w, nx, ny, here)) {
      // 绕障：左右试
      const side = vhash((a.gx * 4) | 0, (a.gy * 4) | 0, a.id) > 0.5 ? 1 : -1;
      let ok = false;
      for (const s2 of [side, -side]) {
        const mx = a.gx + (-dy / dist) * st * s2;
        const my = a.gy + (dx / dist) * st * s2;
        if (walkableAt(w, mx, my, here)) { nx = mx; ny = my; ok = true; break; }
      }
      if (!ok) {
        a.stuck += dt;
        if (a.stuck > 0.7) {
          a.tx = a.homeX; a.ty = a.homeY;
          a.stuck = 0;
          a.state = a.slot === 0 ? 'goto' : a.state;
        }
        return;
      }
    }
    a.gx = nx; a.gy = ny;
    a.stuck = 0;
    a.phase += dt * 8.5;
  }

  /** 死亡下葬：坟墓落在聚落墓园 */
  private bury(w: WorldState, a: Agent) {
    const s = w.settlements.find(x => x.id === a.sid);
    if (!s) return;
    let gy = this.graveyards.get(s.id);
    if (!gy) {
      gy = findGraveyard(w, s);
      this.graveyards.set(s.id, gy);
    }
    const jx = gy.x + (arnd() - 0.5) * 4.5;
    const jy = gy.y + (arnd() - 0.5) * 4.5;
    w.decals.push({ kind: 'grave', x: jx, y: jy, year: w.year, seed: a.seed });
    if (w.decals.length > CFG.agents.decalsMax) w.decals.shift();
  }

  /** 点击检视：最近的智能体 */
  pick(gx: number, gy: number): Agent | null {
    let best: Agent | null = null, bestD = 0.62;
    for (const a of this.agents) {
      if (a.state === 'dying') continue;
      const d = Math.hypot(a.gx - gx, a.gy - gy);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /** 绘制单个智能体（供 world.ts y 排序逐个调用）
   *  LOD：zoom < 0.9 色点 / < 1.5 简化人形 / 其余精细（性能保护） */
  private detailCount = 0;
  resetDetailBudget() { this.detailCount = 0; }
  drawOne(ctx: CanvasRenderingContext2D, w: WorldState, a: Agent, lod: number, night: number, time: number) {
    if (lod < 0.42) return;
    const stage = lifeStageOf(a);
    const p = gridToScreen(a.gx, a.gy);
    const yy = p.y - elevAt(w, a.gx, a.gy) * ELEV_H;
    if (lod < 0.9) {
      // 远景：色点
      ctx.fillStyle = jobColor(a, stage);
      ctx.beginPath();
      ctx.arc(p.x, yy - 3, 1.8, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (lod < 1.5 || this.detailCount > 300) {
      // 中景：简化人形
      const scale = stage === 'child' ? (a.age < 8 ? 0.5 : 0.66) : stage === 'elder' ? 0.92 : 1;
      const bodyH = 10.5 * scale;
      const bob = a.state === 'goto' || a.state === 'migrate' ? Math.abs(Math.sin(a.phase)) * 2 : 0;
      ctx.fillStyle = 'rgba(40,52,44,0.28)';
      ctx.beginPath();
      ctx.ellipse(p.x, yy, 3.6 * scale, 1.7 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = a.sick > 0.3 ? 'rgb(150,168,132)' : jobColor(a, stage);
      ctx.beginPath();
      ctx.moveTo(p.x - 3 * scale, yy - 1);
      ctx.quadraticCurveTo(p.x - 3.2 * scale, yy - bodyH * 0.6 - bob, p.x - 1.3 * scale, yy - bodyH - bob);
      ctx.lineTo(p.x + 1.3 * scale, yy - bodyH - bob);
      ctx.quadraticCurveTo(p.x + 3.2 * scale, yy - bodyH * 0.6 - bob, p.x + 3 * scale, yy - 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = a.sick > 0.3 ? 'rgb(196,208,164)' : 'rgb(238,206,170)';
      ctx.beginPath();
      ctx.arc(p.x, yy - bodyH - 2.4 * scale - bob, 2.2 * scale, 0, Math.PI * 2);
      ctx.fill();
      // 卫士夜巡火把（中景也保留光点）
      if (a.job === 'guard' && night > 0.4 && a.state === 'work') {
        ctx.fillStyle = 'rgba(255,170,70,0.85)';
        ctx.beginPath();
        ctx.arc(p.x - a.dir * 2.6, yy - bodyH - 4, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    this.detailCount++;
    drawAgentBody(ctx, w, a, stage, p.x, yy, lod, night, time);
  }

  /** 远景批量绘制：按颜色分组到少量 Path2D，一次填充几百人（性能核心） */
  drawBatched(ctx: CanvasRenderingContext2D, w: WorldState, night: number, time: number) {
    const bodyPaths = new Map<string, Path2D>();
    let headPath: Path2D | null = null;
    let sickHeadPath: Path2D | null = null;
    let shadowPath: Path2D | null = null;
    let torchPath: Path2D | null = null;
    for (const a of this.agents) {
      if (a.state === 'sleep') continue;
      const stage = lifeStageOf(a);
      const p = gridToScreen(a.gx, a.gy);
      const y = p.y - elevAt(w, a.gx, a.gy) * ELEV_H;
      const scale = stage === 'child' ? (a.age < 8 ? 0.55 : 0.7) : stage === 'elder' ? 0.92 : 1;
      const bodyH = 10.5 * scale;
      const moving = a.state === 'goto' || a.state === 'migrate';
      const bob = moving ? Math.abs(Math.sin(a.phase)) * 2 : a.state === 'work' ? Math.abs(Math.sin(a.phase)) * 0.9 : 0;
      const x = p.x, yy = y;
      if (!shadowPath) shadowPath = new Path2D();
      shadowPath.moveTo(x + 3.6 * scale, yy);
      shadowPath.ellipse(x, yy, 3.6 * scale, 1.7 * scale, 0, 0, Math.PI * 2);
      const col = a.sick > 0.3 ? 'rgb(150,168,132)' : jobColor(a, stage);
      let bp = bodyPaths.get(col);
      if (!bp) { bp = new Path2D(); bodyPaths.set(col, bp); }
      bp.moveTo(x - 3 * scale, yy - 1);
      bp.quadraticCurveTo(x - 3.2 * scale, yy - bodyH * 0.6 - bob, x - 1.3 * scale, yy - bodyH - bob);
      bp.lineTo(x + 1.3 * scale, yy - bodyH - bob);
      bp.quadraticCurveTo(x + 3.2 * scale, yy - bodyH * 0.6 - bob, x + 3 * scale, yy - 1);
      bp.closePath();
      const hy = yy - bodyH - 2.4 * scale - bob;
      const r = 2.2 * scale;
      if (a.sick > 0.3) {
        if (!sickHeadPath) sickHeadPath = new Path2D();
        sickHeadPath.moveTo(x + r, hy);
        sickHeadPath.arc(x, hy, r, 0, Math.PI * 2);
      } else {
        if (!headPath) headPath = new Path2D();
        headPath.moveTo(x + r, hy);
        headPath.arc(x, hy, r, 0, Math.PI * 2);
      }
      // 卫士夜巡火把
      if (a.job === 'guard' && night > 0.4 && a.state === 'work') {
        if (!torchPath) torchPath = new Path2D();
        const tx = x - a.dir * 2.6, ty = yy - bodyH - 4;
        torchPath.moveTo(tx + 1.6, ty);
        torchPath.arc(tx, ty, 1.6, 0, Math.PI * 2);
      }
    }
    if (shadowPath) { ctx.fillStyle = 'rgba(40,52,44,0.28)'; ctx.fill(shadowPath); }
    for (const [col, pth] of bodyPaths) { ctx.fillStyle = col; ctx.fill(pth); }
    if (headPath) { ctx.fillStyle = 'rgb(238,206,170)'; ctx.fill(headPath); }
    if (sickHeadPath) { ctx.fillStyle = 'rgb(196,208,164)'; ctx.fill(sickHeadPath); }
    if (torchPath) { ctx.fillStyle = 'rgba(255,170,70,0.85)'; ctx.fill(torchPath); }
    void time;
  }

  draw(ctx: CanvasRenderingContext2D, w: WorldState, lod: number, night: number, time: number) {
    if (lod < 0.42) return;
    const drawn: Agent[] = [];
    for (const a of this.agents) {
      const stage = lifeStageOf(a);
      if (a.state === 'sleep') continue; // 在屋里
      const p = gridToScreen(a.gx, a.gy);
      const yy = p.y - elevAt(w, a.gx, a.gy) * ELEV_H;
      if (lod < 0.72) {
        // 远景：色点
        ctx.fillStyle = jobColor(a, stage);
        ctx.beginPath();
        ctx.arc(p.x, yy - 3, 1.8, 0, Math.PI * 2);
        ctx.fill();
        drawn.push(a);
        continue;
      }
      drawAgentBody(ctx, w, a, stage, p.x, yy, lod, night, time);
      drawn.push(a);
    }
    this.lastDrawn = drawn;
  }
}

/** 日程段：0 夜 1 晨 2 昼 3 黄昏 */
export function daySlot(dayPhase: number): number {
  if (dayPhase < 0.20) return 0;
  if (dayPhase < 0.30) return 1;
  if (dayPhase < 0.70) return 2;
  if (dayPhase < 0.80) return 3;
  return 0;
}

/** 夜色强度 0..1（供光照/窗户灯） */
export function nightFactor(dayPhase: number): number {
  // 平滑：午夜最深，黄昏/黎明过渡
  if (dayPhase < 0.14) return 1;
  if (dayPhase < 0.26) return 1 - (dayPhase - 0.14) / 0.12;
  if (dayPhase < 0.66) return 0;
  if (dayPhase < 0.78) return (dayPhase - 0.66) / 0.12;
  if (dayPhase < 0.86) return 0.5 + (dayPhase - 0.78) / 0.08 * 0.5;
  return 1;
}

function socialSpot(w: WorldState, s: Settlement): { x: number; y: number } {
  const done = s.buildings.filter(b => b.progress >= 1);
  const prio: BuildingKind[] = [BuildingKind.Camp, BuildingKind.Market, BuildingKind.Well, BuildingKind.Temple, BuildingKind.Theater];
  for (const k of prio) {
    const b = done.find(x => x.kind === k);
    if (b) return { x: b.x, y: b.y };
  }
  return { x: s.x, y: s.y };
}

function findGraveyard(w: WorldState, s: Settlement): { x: number; y: number } {
  const size = w.config.size;
  const cx = size / 2, cy = size / 2;
  const dx = s.x - cx, dy = s.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  // 从聚落沿背离地图中心方向找一块平地
  for (let r = s.radius + 3; r < s.radius + 10; r++) {
    const x = Math.round(s.x + dx / len * r);
    const y = Math.round(s.y + dy / len * r);
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
    const t = tileAt(w, x, y);
    if (t && t.terrain !== Terrain.Water && t.terrain !== Terrain.Mountain && t.elevation <= 2) {
      return { x, y };
    }
  }
  return { x: s.x + 2, y: s.y + 2 };
}

// ============ 绘制 ============

/** 职业主色（含时代感） */
function jobColor(a: Agent, stage: 'child' | 'adult' | 'elder'): string {
  if (stage === 'child') return 'rgb(226,186,150)';
  if (stage === 'elder') return 'rgb(178,172,160)';
  switch (a.job) {
    case 'farmer': return 'rgb(186,148,100)';
    case 'forager': return 'rgb(150,130,96)';
    case 'crafter': return 'rgb(108,118,138)';
    case 'trader': return 'rgb(164,96,88)';
    case 'priest': return 'rgb(214,206,188)';
    case 'scholar': return 'rgb(96,104,128)';
    case 'guard': return 'rgb(132,138,148)';
    default: return 'rgb(178,150,110)';
  }
}

function drawAgentBody(
  ctx: CanvasRenderingContext2D, w: WorldState, a: Agent,
  stage: 'child' | 'adult' | 'elder',
  x: number, y: number, lod: number, night: number, time: number,
) {
  const dyingT = a.state === 'dying' ? Math.max(0, a.dying / 2) : 1;
  const working = a.state === 'work';
  const moving = a.state === 'goto' || a.state === 'migrate';
  const social = a.state === 'idle' || a.state === 'social' || a.mourn > 0;

  // 死亡：倒地渐隐
  if (a.state === 'dying') {
    const fall = Math.min(1, (2 - a.dying) / 0.7);
    ctx.save();
    ctx.globalAlpha = dyingT * 0.92;
    ctx.translate(x, y - 1);
    ctx.rotate(a.dir * fall * Math.PI / 2);
    ctx.fillStyle = jobColor(a, stage);
    ctx.beginPath();
    ctx.ellipse(0, -4, 3, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(236,204,168)';
    ctx.beginPath();
    ctx.arc(0, -8.4, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const scale = stage === 'child' ? (a.age < 8 ? 0.5 : 0.66) : stage === 'elder' ? 0.92 : 1;
  const bodyH = 10.5 * scale;
  const sickTint = a.sick > 0.3;
  const stoop = stage === 'elder' ? 1.6 : sickTint ? 1.2 : 0;
  const bob = moving ? Math.abs(Math.sin(a.phase)) * 2.2 : working ? Math.abs(Math.sin(a.phase)) * 1.0 : social ? Math.sin(a.phase * 0.4) * 0.4 : Math.sin(a.phase) * 0.5;
  const skin = sickTint ? 'rgb(196,208,164)' : 'rgb(238,206,170)';
  const cloth = jobColor(a, stage);
  const clothDark = shade2(cloth, 0.72);

  // 阴影
  ctx.fillStyle = 'rgba(40,52,44,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y, 4.2 * scale, 2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  const f = a.dir;

  if (lod < 1.05) {
    // 中 LOD：简化身体
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(x - 3 * scale, y - 1);
    ctx.quadraticCurveTo(x - 3.4 * scale, y - bodyH * 0.6 - bob, x - 1.3 * scale, y - bodyH - bob + stoop);
    ctx.lineTo(x + 1.3 * scale, y - bodyH - bob + stoop);
    ctx.quadraticCurveTo(x + 3.4 * scale, y - bodyH * 0.6 - bob, x + 3 * scale, y - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x + stoop * 0.3, y - bodyH - 2.4 * scale - bob + stoop, 2.3 * scale, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // —— 腿 ——
  ctx.strokeStyle = shade2(cloth, 0.62);
  ctx.lineWidth = 1.8 * scale;
  ctx.lineCap = 'round';
  const sw = moving ? Math.sin(a.phase) * 2.4 : working ? Math.sin(a.phase * 0.8) * 0.6 : 0;
  ctx.beginPath();
  ctx.moveTo(x - 1.1 * scale, y - 2.5 * scale);
  ctx.lineTo(x - 1.1 * scale - sw * 0.55 * f, y + 0.4);
  ctx.moveTo(x + 1.1 * scale, y - 2.5 * scale);
  ctx.lineTo(x + 1.1 * scale + sw * 0.55 * f, y + 0.4);
  ctx.stroke();

  // —— 躯干 ——
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(x - 3 * scale, y - 2 * scale);
  ctx.quadraticCurveTo(x - 3.4 * scale, y - bodyH * 0.6 - bob, x - 1.4 * scale + stoop * f * 0.4, y - bodyH - bob + stoop);
  ctx.lineTo(x + 1.4 * scale + stoop * f * 0.4, y - bodyH - bob + stoop);
  ctx.quadraticCurveTo(x + 3.4 * scale, y - bodyH * 0.6 - bob, x + 3 * scale, y - 2 * scale);
  ctx.closePath();
  ctx.fill();
  // 衣摆暗部
  ctx.fillStyle = clothDark;
  ctx.beginPath();
  ctx.moveTo(x + 1.1 * scale + stoop * f * 0.4, y - bodyH - bob + stoop + 0.6);
  ctx.quadraticCurveTo(x + 3.4 * scale, y - bodyH * 0.55 - bob, x + 3 * scale, y - 2 * scale);
  ctx.lineTo(x + 0.6 * scale, y - 2 * scale);
  ctx.quadraticCurveTo(x + 1.1 * scale, y - bodyH * 0.55 - bob, x + 1.1 * scale + stoop * f * 0.4, y - bodyH - bob + stoop + 0.6);
  ctx.closePath();
  ctx.fill();

  // —— 手臂（工作/行走摆动；社交时抬手比划）——
  ctx.strokeStyle = cloth;
  ctx.lineWidth = 1.4 * scale;
  const shoulderY = y - bodyH * 0.82 - bob + stoop * 0.6;
  let armSw = moving ? Math.sin(a.phase + Math.PI) * 2.0 : working ? Math.sin(a.phase * 0.8) * 1.5 + 1.2 : Math.sin(a.phase * 0.5) * 0.5;
  if (social && Math.sin(time * 0.002 + a.seed * 8) > 0.5) armSw = 2.6; // 比划
  ctx.beginPath();
  ctx.moveTo(x - 2.1 * scale, shoulderY);
  ctx.lineTo(x - 2.1 * scale - armSw * 0.5 * f, shoulderY + 4 * scale);
  ctx.moveTo(x + 2.1 * scale, shoulderY);
  ctx.lineTo(x + 2.1 * scale + armSw * 0.5 * f, shoulderY + 4 * scale);
  ctx.stroke();

  // —— 头 ——
  const headY = y - bodyH - 2.7 * scale - bob + stoop;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(x + stoop * f * 0.3, headY, 2.5 * scale, 0, Math.PI * 2);
  ctx.fill();
  // 头发（长者灰白）
  ctx.fillStyle = stage === 'elder' ? 'rgb(200,196,188)' : 'rgb(58,44,32)';
  ctx.beginPath();
  ctx.arc(x + stoop * f * 0.3 - f * 0.4, headY - 0.4, 2.4 * scale, 0, Math.PI * 2);
  ctx.fill();
  if (lod > 1.35) {
    ctx.fillStyle = 'rgb(40,32,28)';
    ctx.fillRect(x + f * 0.9 + stoop * f * 0.3, headY - 0.4, 0.8, 0.9);
  }

  // —— 帽/冠（成年职业）——
  if (stage === 'adult') {
    ctx.fillStyle = hatColor(a);
    if (a.job === 'farmer') {
      ctx.beginPath();
      ctx.ellipse(x, headY - 1.5 * scale, 4.4 * scale, 1.2 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, headY - 2.1 * scale, 2.1 * scale, 1.1 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (a.job === 'guard') {
      ctx.beginPath();
      ctx.arc(x, headY - 0.8 * scale, 2.4 * scale, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 0.4 * scale, headY - 3.4 * scale, 0.8 * scale, 1.4 * scale);
    } else if (a.job === 'trader' || a.job === 'priest') {
      ctx.beginPath();
      ctx.arc(x - f * 0.4, headY - 0.5 * scale, 2.8 * scale, Math.PI * 0.75, Math.PI * 2.35);
      ctx.closePath();
      ctx.fill();
    } else if (a.job === 'scholar' || a.job === 'crafter') {
      ctx.beginPath();
      ctx.arc(x, headY - 0.9 * scale, 2.4 * scale, Math.PI, Math.PI * 2);
      ctx.fill();
    }
  }

  // —— 职业道具（工作时）——
  if (working && lod > 0.9) {
    switch (a.job) {
      case 'farmer': {
        // 锄头起落
        const swing = Math.sin(a.phase) * 3;
        ctx.strokeStyle = 'rgb(118,88,56)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + f * 3.2, y - 1.5);
        ctx.lineTo(x + f * 4.4, y - 9 - swing);
        ctx.stroke();
        ctx.fillStyle = 'rgb(150,150,155)';
        ctx.fillRect(x + f * 4.0 - 1.3, y - 10.4 - swing, f * 2.6, 1.6);
        break;
      }
      case 'forager': {
        // 挎篮
        ctx.fillStyle = 'rgb(178,142,88)';
        ctx.beginPath();
        ctx.ellipse(x - f * 3.1, y - bodyH * 0.45, 1.9, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'crafter': {
        const swing = Math.sin(a.phase * 1.4) * 2;
        ctx.strokeStyle = 'rgb(118,88,56)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x + f * 2.6, y - 5 - swing);
        ctx.lineTo(x + f * 3.4, y - 1.6 - swing);
        ctx.stroke();
        ctx.fillStyle = 'rgb(150,150,155)';
        ctx.fillRect(x + f * 2.9 - 1, y - 1.9 - swing, 2, 1.4);
        break;
      }
      case 'guard': {
        // 长矛
        ctx.strokeStyle = 'rgb(110,84,54)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + f * 3.0, y + 0.5);
        ctx.lineTo(x + f * 3.6, y - 13);
        ctx.stroke();
        ctx.fillStyle = 'rgb(168,168,172)';
        ctx.beginPath();
        ctx.moveTo(x + f * 3.6, y - 13);
        ctx.lineTo(x + f * 4.3, y - 16);
        ctx.lineTo(x + f * 3.0, y - 14.6);
        ctx.closePath();
        ctx.fill();
        // 夜巡火把
        if (night > 0.4) {
          const fl = 2.4 + Math.sin(time * 0.013 + a.seed * 9) * 1.1;
          ctx.fillStyle = 'rgba(255,170,70,0.9)';
          ctx.beginPath();
          ctx.ellipse(x - f * 2.6, y - bodyH - 4, 1.8, fl, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(255,210,120,${0.10 + night * 0.1})`;
          ctx.beginPath();
          ctx.arc(x - f * 2.6, y - bodyH - 4, 11, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'trader': {
        ctx.fillStyle = 'rgb(160,124,76)';
        ctx.beginPath();
        ctx.ellipse(x - f * 3.2, y - bodyH * 0.6, 1.9, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'scholar': {
        ctx.fillStyle = 'rgb(232,224,200)';
        ctx.fillRect(x + f * 2.8 - 1.4, y - bodyH * 0.5 - 1.4, 2.8, 2.8);
        break;
      }
      case 'priest': {
        // 手持法杖
        ctx.strokeStyle = 'rgb(150,120,80)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + f * 3.0, y + 0.5);
        ctx.lineTo(x + f * 3.2, y - 12);
        ctx.stroke();
        ctx.fillStyle = 'rgb(214,178,84)';
        ctx.beginPath();
        ctx.arc(x + f * 3.2, y - 13, 1.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  // 病态标记：绿色病气小点
  if (sickTint && lod > 0.9) {
    const ph = (time * 0.0012 + a.seed * 7) % 1;
    ctx.fillStyle = `rgba(120,160,100,${(1 - ph) * 0.5})`;
    ctx.beginPath();
    ctx.arc(x + Math.sin(ph * 6) * 3, headY - 2 - ph * 7, 1.6 + ph, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hatColor(a: Agent): string {
  switch (a.job) {
    case 'farmer': return 'rgb(224,198,120)';
    case 'crafter': return 'rgb(88,96,114)';
    case 'trader': return 'rgb(96,72,56)';
    case 'priest': return 'rgb(196,186,166)';
    case 'scholar': return 'rgb(70,76,96)';
    case 'guard': return 'rgb(148,152,160)';
    default: return 'rgb(160,140,110)';
  }
}

function shade2(rgb: string, f: number): string {
  const m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return rgb;
  return `rgb(${(+m[1]) * f | 0},${(+m[2]) * f | 0},${(+m[3]) * f | 0})`;
}
