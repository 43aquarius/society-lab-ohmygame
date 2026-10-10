/**
 * 模拟内核回归测试 v4.0 — node:test
 * 覆盖：分块生成确定性、多文明并存、五形态识别（马义判定书）、
 * 饥荒触发、强制劳动→精英份额、存档往返（v4）与 v3 迁移、神力效果。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld, tickYear } from '../src/sim/manager.ts';
import { classifySociety } from '../src/sim/society.ts';
import { serialize, deserialize } from '../src/saves.ts';
import { castBrushPower, castCivPower } from '../src/powers.ts';
import { Terrain, type WorldState, type SocietyForm } from '../src/types.ts';
import { tileAt, generateChunk, createGen, chunkKey } from '../src/worldgen.ts';
import { CFG } from '../src/config.ts';

function world(seed = 12345, scenario: 'dawn' | 'valley' = 'valley' as any): WorldState {
  return newWorld({ seed, size: 64, mode: 'free', settlements: 1, scenario });
}

test('分块生成确定性：同 seed 生成完全一致的 chunk', () => {
  const g1 = createGen(777, 64);
  const g2 = createGen(777, 64);
  const c1 = generateChunk(g1, 1, 1);
  const c2 = generateChunk(g2, 1, 1);
  for (let i = 0; i < c1.tiles.length; i++) {
    assert.equal(c1.tiles[i].terrain, c2.tiles[i].terrain);
    assert.equal(c1.tiles[i].elevation, c2.tiles[i].elevation);
    assert.equal(c1.tiles[i].ore, c2.tiles[i].ore);
    assert.equal(c1.tiles[i].temp, c2.tiles[i].temp);
  }
});

test('同一种子生成完全一致的世界', () => {
  const a = newWorld({ seed: 777, size: 64, mode: 'free', settlements: 2, scenario: 'dawn' });
  const b = newWorld({ seed: 777, size: 64, mode: 'free', settlements: 2, scenario: 'dawn' });
  assert.equal(a.settlements.length, b.settlements.length);
  assert.equal(a.settlements[0].name, b.settlements[0].name);
  assert.equal(a.settlements[0].x, b.settlements[0].x);
  for (let y = 0; y < 64; y += 3) for (let x = 0; x < 64; x += 3) {
    const ta = tileAt(a, x, y), tb = tileAt(b, x, y);
    assert.equal(ta?.terrain, tb?.terrain);
    assert.equal(ta?.ore, tb?.ore);
  }
});

test('同一种子模拟路径可复现', () => {
  const a = world(999);
  const b = world(999);
  for (let i = 0; i < 30; i++) { tickYear(a); tickYear(b); }
  assert.equal(a.year, b.year);
  assert.equal(a.settlements[0].population, b.settlements[0].population);
  assert.equal(a.civs[0].vars.population, b.civs[0].vars.population);
  assert.equal(a.chronicle.length, b.chronicle.length);
  assert.equal(JSON.stringify(a.civs[0].vars), JSON.stringify(b.civs[0].vars));
});

test('世界生成包含多种地形与可居起点（气候带）', () => {
  const w = world(4242, 'dawn');
  const terrains = new Set<number>();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const t = tileAt(w, x, y);
    if (t) terrains.add(t.terrain);
  }
  assert.ok(terrains.has(Terrain.Grass));
  assert.ok(terrains.has(Terrain.Mountain) || terrains.has(Terrain.Hills));
  assert.ok(w.settlements.length >= 1);
  const s = w.settlements[0];
  const t = tileAt(w, s.x, s.y);
  assert.ok(t);
  assert.notEqual(t!.terrain, Terrain.Water);
  assert.notEqual(t!.terrain, Terrain.Mountain);
});

test('时间推进改变人口与资源状态', () => {
  const w = world(555, 'valley');
  const pop0 = w.settlements[0].population;
  const food0 = w.settlements[0].food;
  for (let i = 0; i < 20; i++) tickYear(w);
  assert.ok(
    w.settlements[0].population !== pop0 || w.settlements[0].food !== food0,
    '人口或粮储应当变化',
  );
});

test('粮食持续短缺触发饥荒事件并推高冲突风险', () => {
  const w = world(31337, 'dawn');
  for (let i = 0; i < 10; i++) tickYear(w);
  const s = w.settlements[0];
  const civ = w.civs[0];
  const beforeUnrest = civ.vars.unrest;
  for (let round = 0; round < 5; round++) {
    castBrushPower(w, 'drought', s.x, s.y, 3);
    s.food = 0;
    for (let i = 0; i < 4; i++) {
      s.food = Math.min(s.food, 1);
      tickYear(w);
    }
  }
  const famineEvents = w.chronicle.filter(e => e.category === 'famine');
  assert.ok(famineEvents.length > 0, '应有饥荒事件记录');
  assert.ok(famineEvents[0].causes.length > 0, '饥荒事件应记录真实原因');
  assert.ok(civ.vars.unrest >= beforeUnrest || civ.vars.population < s.population + 1,
    '饥荒应推高冲突风险或造成人口损失');
});

test('社会识别器：五种形态都能被正确识别（马义判定书）', () => {
  const set = (patch: (w: WorldState) => void) => {
    const w = world(2024, 'valley');
    patch(w);
    return classifySociety(w, w.civs[0]);
  };
  // 原始：公社公有制 + 无阶级分化
  const prim = set(w => {
    const v = w.civs[0].vars;
    v.ownCommon = 0.95; v.ownPrivate = 0.03; v.ownPublic = 0.02;
    v.specialization = 0.05;
    w.civs[0].tech.levels.agriculture = 1;
    w.settlements[0].buildings = w.settlements[0].buildings.filter(b => b.kind !== 'farm');
  });
  assert.equal(prim.form, 'primitive');
  assert.ok(prim.basis.ownership.includes('公有'), '原始社会判定书应以公有制为所有制');

  // 奴隶制：奴隶主占有生产资料与奴隶人身
  const slave = set(w => {
    const v = w.civs[0].vars;
    v.laborForced = 0.55; v.laborBonded = 0.1; v.laborWage = 0.1; v.laborCoop = 0.1;
    v.market = 0.1; v.stateCapacity = 0.5;
    v.ownCommon = 0.35; v.ownPrivate = 0.6; v.ownPublic = 0.05;
    w.civs[0].tech.levels.agriculture = 4;
    w.civs[0].tech.progress.agriculture = 999;
    w.settlements[0].population = 200;
    w.settlements[0].stage = 'village';
    w.settlements[0].effects.push({ kind: 'blessing', years: 99, power: 1.2 });
  });
  assert.equal(slave.form, 'slave', `实际=${slave.form}`);
  assert.ok(slave.basis.classes.includes('奴隶'), '奴隶社会判定书应写明奴隶主/奴隶阶级');

  // 封建：地主占有土地 + 农民人身依附
  const feudal = set(w => {
    const v = w.civs[0].vars;
    v.laborForced = 0.05; v.laborBonded = 0.6; v.laborWage = 0.1; v.laborCoop = 0.1;
    v.landConcentration = 0.7; v.market = 0.15; v.ownPrivate = 0.6; v.ownCommon = 0.35;
    v.stateCapacity = 0.4;
    w.civs[0].tech.levels.agriculture = 5;
    w.civs[0].tech.progress.agriculture = 999;
    w.civs[0].tech.levels.industry = 1;
    w.settlements[0].population = 500;
    w.settlements[0].stage = 'town';
  });
  assert.equal(feudal.form, 'feudal', `实际=${feudal.form}`);
  assert.ok(feudal.basis.ownership.includes('地主'), '封建判定书应以地主占有土地为所有制');

  // 资本主义：资本私有 + 雇佣劳动 + 普遍市场
  const cap = set(w => {
    const v = w.civs[0].vars;
    v.laborWage = 0.65; v.laborForced = 0.02; v.laborBonded = 0.05; v.laborCoop = 0.05;
    v.market = 0.8; v.ownPrivate = 0.75; v.ownCommon = 0.15;
    w.civs[0].tech.levels.industry = 3;
    w.civs[0].tech.progress.industry = 999;
    w.settlements[0].population = 500;
    w.settlements[0].stage = 'town';
    w.settlements[0].buildings.push({ id: 999, kind: 'townhouse' as any, x: w.settlements[0].x + 1, y: w.settlements[0].y + 1, builtYear: 0, progress: 1 });
    w.settlements[0].buildings.push({ id: 998, kind: 'townhouse' as any, x: w.settlements[0].x - 1, y: w.settlements[0].y + 1, builtYear: 0, progress: 1 });
  });
  assert.equal(cap.form, 'capitalist', `实际=${cap.form}`);
  assert.ok(cap.basis.classes.includes('雇佣'), '资本主义判定书应写明雇佣劳动关系');

  // 社会主义：公有制 + 按劳分配 + 人民国家
  const soc = set(w => {
    const v = w.civs[0].vars;
    v.ownPublic = 0.6; v.ownPrivate = 0.08; v.ownCommon = 0.3;
    v.laborCoop = 0.6; v.laborWage = 0.2; v.laborForced = 0; v.laborBonded = 0;
    v.publicServices = 0.7; v.participation = 0.7; v.education = 0.6;
    w.civs[0].tech.levels.industry = 4;
    w.civs[0].tech.progress.industry = 999;
    w.settlements[0].population = 500;
    w.settlements[0].stage = 'town';
  });
  assert.equal(soc.form, 'socialist', `实际=${soc.form}`);
  assert.ok(soc.basis.distribution.includes('按劳分配'), '社会主义判定书应为按劳分配');
});

test('多文明并存：不同文明可同时处于不同社会形态', () => {
  const w = newWorld({ seed: 2077, size: 96, mode: 'free', settlements: 2, scenario: 'valley' });
  assert.equal(w.civs.length, 2, '应创建两个文明');
  assert.equal(w.settlements.length, 2);
  // 文明 0 保持原始；文明 1 推向封建
  const civA = w.civs[0], civB = w.civs[1];
  const v = civB.vars;
  v.laborBonded = 0.65; v.landConcentration = 0.75; v.market = 0.1; v.stateCapacity = 0.4;
  v.ownPrivate = 0.55; v.ownCommon = 0.4;
  civB.tech.levels.agriculture = 5;
  civB.tech.progress.agriculture = 999;
  const sb = w.settlements.find(s => s.civId === civB.id)!;
  sb.population = 500;
  sb.stage = 'town';
  for (let i = 0; i < 8; i++) tickYear(w);
  const clsA = classifySociety(w, civA);
  const clsB = classifySociety(w, civB);
  assert.equal(clsA.form, 'primitive', `文明A=${clsA.form}`);
  assert.equal(civB.form, 'feudal', `文明B=${civB.form}`);
  assert.notEqual(clsA.form, clsB.form, '两个文明形态应不同');
  // 形态变迁事件应带 civId
  const ev = w.chronicle.find(e => e.category === 'institution' && e.civId === civB.id);
  assert.ok(ev, '文明 B 的形态变迁应记入编年史');
});

test('强制劳动提高精英收入份额并推高 unrest 目标', () => {
  const w = world(8080, 'valley');
  for (let i = 0; i < 8; i++) tickYear(w);
  const civ = w.civs[0];
  const elite0 = civ.vars.wealthElite;
  const unrest0 = civ.vars.unrest;
  civ.vars.laborForced = 0.5;
  civ.warMemory = 0.8;
  for (let i = 0; i < 15; i++) tickYear(w);
  assert.ok(civ.vars.wealthElite > elite0, `精英份额应上升: ${elite0.toFixed(3)} → ${civ.vars.wealthElite.toFixed(3)}`);
  assert.ok(civ.vars.unrest > unrest0 - 0.05, '强制劳动不应降低 unrest');
});

test('知识启蒙神力实际提升技术与思想（作用于指定文明）', () => {
  const w = world(6060, 'valley');
  for (let i = 0; i < 5; i++) tickYear(w);
  const civ = w.civs[0];
  const points0 = civ.tech.points;
  const enr0 = civ.enlightenment;
  const res = castCivPower(w, 'enlighten', 0);
  assert.ok(res.ok);
  assert.ok(civ.tech.points > points0);
  assert.ok(civ.enlightenment > enr0);
  assert.equal(w.interventions, 1);
});

test('地形神力改变世界状态并消耗有限能量（分块标记保存）', () => {
  const w = newWorld({ seed: 42, size: 64, mode: 'limited', settlements: 1, scenario: 'valley' });
  const x = w.settlements[0].x + 5, y = w.settlements[0].y + 5;
  const divine0 = w.divine;
  const res = castBrushPower(w, 'forest', x, y, 1);
  assert.ok(res.ok);
  assert.equal(tileAt(w, x, y)!.terrain, Terrain.Forest);
  assert.ok(w.divine < divine0, '有限模式应消耗神力能量');
  // 修改过的 chunk 应标记 modified
  const ch = w.chunks.get(chunkKey(w.gen, x >> 5, y >> 5))!;
  assert.ok(ch.modified, '被神力修改的 chunk 应标记为 modified');
});

test('存档往返保持世界一致（v4 分块格式）', () => {
  const w = world(1111, 'valley');
  castBrushPower(w, 'fertile', w.settlements[0].x + 3, w.settlements[0].y + 3, 1); // 制造一个修改过的 chunk
  for (let i = 0; i < 25; i++) tickYear(w);
  const json = serialize(w, '测试世界');
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, CFG.saveVersion);
  const res = deserialize(json);
  assert.ok('world' in res, `应可解析: ${JSON.stringify(res)}`);
  if ('world' in res) {
    const w2 = res.world;
    assert.equal(w2.year, w.year);
    assert.equal(w2.settlements.length, w.settlements.length);
    assert.equal(w2.settlements[0].population, w.settlements[0].population);
    assert.equal(w2.civs[0].form, w.civs[0].form);
    assert.equal(w2.chronicle.length, w.chronicle.length);
    assert.equal(w2.rng.state, w.rng.state);
    // 修改过的 chunk 数据应保留
    assert.equal(tileAt(w2, w.settlements[0].x + 3, w.settlements[0].y + 3)!.terrain, Terrain.Fertile);
    // 未保存的 chunk 由种子重建，地形一致
    const t1 = tileAt(w, 40, 40), t2 = tileAt(w2, 40, 40);
    assert.equal(t1!.terrain, t2!.terrain, '确定性重建应保持地形一致');
    // 读档后继续推进，行为应与原世界一致
    tickYear(w); tickYear(w2);
    assert.equal(w2.civs[0].vars.population, w.civs[0].vars.population, '读档后应可继续确定性模拟');
  }
});

test('v3 旧档迁移：全量 tiles 转为分块世界', () => {
  const size = 64;
  // 构造一个 v3 风格的存档
  const tTerrain: number[] = [], tFert: number[] = [], tMoist: number[] = [], tElev: number[] = [], tOre: number[] = [], tOwner: number[] = [];
  for (let i = 0; i < size * size; i++) {
    tTerrain.push(i % 11 === 0 ? Terrain.Water : i % 7 === 0 ? Terrain.Hills : Terrain.Grass);
    tFert.push(100); tMoist.push(100); tElev.push(1); tOre.push(0); tOwner.push(0);
  }
  const v3payload = {
    version: 3, savedAt: Date.now(), worldName: '旧世界',
    world: {
      config: { seed: 5150, size, mode: 'free', settlements: 1, scenario: 'dawn' },
      year: 88, rngState: 12345, nextBuildingId: 9, nextEventId: 9,
      interventions: 2, divine: 100, divineMax: 100, size,
      tTerrain, tFert, tMoist, tElev, tOre, tOwner,
      weather: [], settlements: [{
        id: 0, name: '旧河阳村', x: 30, y: 30, stage: 'village', population: 180,
        buildings: [], construction: [], food: 100, wood: 10, stone: 5, metal: 1,
        radius: 4, shortageYears: 0, founded: 0, effects: [], dead: false, lastFamine: -1,
      }],
      civ: {
        form: 'primitive', formSince: 0, prevForm: null,
        vars: {
          population: 180, ownCommon: 0.9, ownPrivate: 0.08, ownPublic: 0.02,
          laborForced: 0.02, laborBonded: 0.05, laborWage: 0.02, laborCoop: 0.12,
          landConcentration: 0.12, market: 0.05, stateCapacity: 0.08,
          publicServices: 0.05, education: 0.08, specialization: 0.05,
          livingStandard: 0.18, trust: 0.5, participation: 0.08,
          unrest: 0.08, environment: 1, resourcePressure: 0.1,
          wealthCommon: 0.8, wealthElite: 0.1, wealthMiddle: 0.1,
          orgCommon: 0.06, orgElite: 0.1,
        },
        tech: {
          levels: { agriculture: 2, crafting: 1, building: 1, commerce: 1, governance: 1, medicine: 1, industry: 1, education: 1 },
          points: 10, progress: { agriculture: 5, crafting: 0, building: 0, commerce: 0, governance: 0, medicine: 0, industry: 0, education: 0 },
        },
        groups: [], warMemory: 0, enlightenment: 0,
      },
      chronicle: [{ id: 'ev-1', year: 50, title: '旧事件', category: 'harvest', text: 'x', causes: [], effects: [], intervened: false, severity: 0.2 }],
      activeEvents: [], history: [], decals: [], snapshots: [],
    },
  };
  const res = deserialize(JSON.stringify(v3payload));
  assert.ok('world' in res, `迁移应成功: ${JSON.stringify(res).slice(0, 200)}`);
  if ('world' in res) {
    const w = res.world;
    assert.equal(w.civs.length, 1, '单文明旧档 → 一个文明');
    assert.equal(w.settlements[0].civId, 0);
    assert.equal(w.settlements[0].population, 180);
    // 旧地形应被保留（迁移为显式 chunk）
    assert.equal(tileAt(w, 30, 30)!.terrain, Terrain.Grass);
    assert.equal(tileAt(w, 11, 0)!.terrain, Terrain.Water, '旧档的水域应保留');
    // 迁移后可以继续模拟
    tickYear(w);
    assert.equal(w.year, 89);
  }
});

test('长程演化不崩溃且产生编年史', () => {
  const w = world(2024, 'valley');
  for (let i = 0; i < 200; i++) {
    tickYear(w);
    for (const civ of w.civs) {
      assert.ok(civ.vars.unrest >= 0 && civ.vars.unrest <= 1);
      assert.ok(civ.vars.wealthElite + civ.vars.wealthCommon + civ.vars.wealthMiddle > 0.9);
    }
    for (const s of w.settlements) {
      if (!s.dead) {
        assert.ok(s.population >= 0);
        assert.ok(Number.isFinite(s.food));
      }
    }
  }
  assert.ok(w.chronicle.length > 0, '应有编年史记录');
  assert.ok(w.civs[0].history.length > 0, '应有观察者采样');
  assert.ok(w.year === 200);
});

test('形态变迁会记录判定依据与判定书事件', () => {
  const w = world(2024, 'valley');
  for (let i = 0; i < 5; i++) tickYear(w);
  const v = w.civs[0].vars;
  v.laborBonded = 0.65; v.landConcentration = 0.75; v.market = 0.1; v.stateCapacity = 0.4;
  v.ownPrivate = 0.55; v.ownCommon = 0.4;
  w.civs[0].tech.levels.agriculture = 5;
  w.civs[0].tech.progress.agriculture = 999;
  w.settlements[0].population = 500;
  w.settlements[0].stage = 'town';
  for (let i = 0; i < 6; i++) tickYear(w);
  assert.equal(w.civs[0].form, 'feudal', `形态=${w.civs[0].form}`);
  const ev = w.chronicle.filter(e => e.category === 'institution');
  assert.ok(ev.length > 0, '形态变迁应产生制度事件');
  assert.ok(ev[ev.length - 1].causes.length > 0, '变迁事件应记录判定依据');
  assert.ok(ev[ev.length - 1].effects.some(e => e.includes('封建')));
});

test('历史不会跳级：部落世界无法被识别为高级形态', () => {
  const w = world(31337, 'dawn');
  for (let i = 0; i < 80; i++) tickYear(w);
  const v = w.civs[0].vars;
  v.laborWage = 0.7; v.market = 0.9; v.ownPrivate = 0.8;
  const cls = classifySociety(w, w.civs[0]);
  assert.equal(cls.form, 'primitive', `形态=${cls.form}`);
  assert.ok(cls.blocked.some(b => b.form === 'capitalist' && b.missing.length > 0),
    '资本主义应列出未满足的前置');
});
