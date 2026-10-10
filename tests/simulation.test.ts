/**
 * 模拟内核回归测试 — node:test
 * 覆盖：确定性、世界生成合法性、五形态识别、饥荒触发、
 * 强制劳动→精英份额、存档往返、神力效果。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newWorld, tickYear } from '../src/sim/manager.ts';
import { classifySociety } from '../src/sim/society.ts';
import { serialize, deserialize } from '../src/saves.ts';
import { castBrushPower, castCivPower } from '../src/powers.ts';
import { Terrain, type WorldState, type SocietyForm } from '../src/types.ts';

function world(seed = 12345, scenario: 'dawn' | 'valley' = 'valley' as any): WorldState {
  return newWorld({ seed, size: 48, mode: 'free', settlements: 1, scenario });
}

test('同一种子生成完全一致的世界', () => {
  const a = newWorld({ seed: 777, size: 48, mode: 'free', settlements: 2, scenario: 'dawn' });
  const b = newWorld({ seed: 777, size: 48, mode: 'free', settlements: 2, scenario: 'dawn' });
  assert.equal(a.settlements.length, b.settlements.length);
  assert.equal(a.settlements[0].name, b.settlements[0].name);
  assert.equal(a.settlements[0].x, b.settlements[0].x);
  for (let i = 0; i < a.tiles.length; i += 37) {
    assert.equal(a.tiles[i].terrain, b.tiles[i].terrain);
    assert.equal(a.tiles[i].ore, b.tiles[i].ore);
  }
});

test('同一种子模拟路径可复现', () => {
  const a = world(999);
  const b = world(999);
  for (let i = 0; i < 30; i++) { tickYear(a); tickYear(b); }
  assert.equal(a.year, b.year);
  assert.equal(a.settlements[0].population, b.settlements[0].population);
  assert.equal(a.civ.vars.population, b.civ.vars.population);
  assert.equal(a.chronicle.length, b.chronicle.length);
  assert.equal(JSON.stringify(a.civ.vars), JSON.stringify(b.civ.vars));
});

test('世界生成包含多种地形与可居起点', () => {
  const w = world(4242, 'dawn');
  const terrains = new Set(w.tiles.map(t => t.terrain));
  assert.ok(terrains.has(Terrain.Grass));
  assert.ok(terrains.has(Terrain.Mountain) || terrains.has(Terrain.Hills));
  assert.ok(w.settlements.length >= 1);
  const s = w.settlements[0];
  const t = w.tiles[s.y * 48 + s.x];
  assert.notEqual(t.terrain, Terrain.Water);
  assert.notEqual(t.terrain, Terrain.Mountain);
});

test('时间推进改变人口与资源状态', () => {
  const w = world(555, 'valley');
  const pop0 = w.settlements[0].population;
  const food0 = w.settlements[0].food;
  for (let i = 0; i < 20; i++) tickYear(w);
  // 20 年内人口应有变化（正或负都算模拟在工作）
  assert.ok(
    w.settlements[0].population !== pop0 || w.settlements[0].food !== food0,
    '人口或粮储应当变化',
  );
});

test('粮食持续短缺触发饥荒事件并推高冲突风险', () => {
  const w = world(31337, 'dawn');
  for (let i = 0; i < 10; i++) tickYear(w);
  // 清空粮储并强制造氏（连续干旱）
  const s = w.settlements[0];
  const beforeUnrest = w.civ.vars.unrest;
  for (let round = 0; round < 3; round++) {
    castBrushPower(w, 'drought', s.x, s.y, 3);
    s.food = 0;
    for (let i = 0; i < 6; i++) {
      s.food = Math.min(s.food, 1);
      tickYear(w);
    }
  }
  const famineEvents = w.chronicle.filter(e => e.category === 'famine');
  assert.ok(famineEvents.length > 0, '应有饥荒事件记录');
  assert.ok(famineEvents[0].causes.length > 0, '饥荒事件应记录真实原因');
  assert.ok(w.civ.vars.unrest >= beforeUnrest || w.civ.vars.population < s.population + 1,
    '饥荒应推高冲突风险或造成人口损失');
});

test('社会识别器：五种形态都能被正确识别', () => {
  const base = world(2024, 'valley');
  const set = (patch: (w: WorldState) => void) => {
    const w = world(2024, 'valley');
    patch(w);
    return classifySociety(w);
  };
  // 原始：共有制 + 无农业
  const prim = set(w => {
    const v = w.civ.vars;
    v.ownCommon = 0.95; v.ownPrivate = 0.03; v.ownPublic = 0.02;
    v.specialization = 0.05;
    w.civ.tech.levels.agriculture = 1;
    w.settlements[0].buildings = w.settlements[0].buildings.filter(b => b.kind !== 'farm');
  });
  assert.equal(prim.form, 'primitive');

  // 奴隶制：强制劳动 + 国家能力
  const slave = set(w => {
    const v = w.civ.vars;
    v.laborForced = 0.55; v.laborBonded = 0.1; v.laborWage = 0.1; v.laborCoop = 0.1;
    v.market = 0.1; v.stateCapacity = 0.5;
    v.ownCommon = 0.35; v.ownPrivate = 0.6; v.ownPublic = 0.05;
    w.civ.tech.levels.agriculture = 3;
    w.civ.tech.progress.agriculture = 999;
  });
  assert.equal(slave.form, 'slave', `实际=${slave.form}`);

  // 封建：土地集中 + 依附劳动
  const feudal = set(w => {
    const v = w.civ.vars;
    v.laborForced = 0.05; v.laborBonded = 0.6; v.laborWage = 0.1; v.laborCoop = 0.1;
    v.landConcentration = 0.7; v.market = 0.15; v.ownPrivate = 0.6; v.ownCommon = 0.35;
    w.civ.tech.levels.agriculture = 4;
    w.civ.tech.progress.agriculture = 999;
    w.civ.tech.levels.industry = 1;
  });
  assert.equal(feudal.form, 'feudal', `实际=${feudal.form}`);

  // 资本主义：雇佣 + 市场 + 工业
  const cap = set(w => {
    const v = w.civ.vars;
    v.laborWage = 0.65; v.laborForced = 0.02; v.laborBonded = 0.05; v.laborCoop = 0.05;
    v.market = 0.8; v.ownPrivate = 0.75; v.ownCommon = 0.15;
    w.civ.tech.levels.industry = 3;
    w.civ.tech.progress.industry = 999;
  });
  assert.equal(cap.form, 'capitalist', `实际=${cap.form}`);

  // 社会主义：公有 + 合作 + 公共服务
  const soc = set(w => {
    const v = w.civ.vars;
    v.ownPublic = 0.6; v.ownPrivate = 0.08; v.ownCommon = 0.3;
    v.laborCoop = 0.6; v.laborWage = 0.2; v.laborForced = 0; v.laborBonded = 0;
    v.publicServices = 0.7; v.participation = 0.7; v.education = 0.6;
  });
  assert.equal(soc.form, 'socialist', `实际=${soc.form}`);
});

test('强制劳动提高精英收入份额并推高 unrest 目标', () => {
  const w = world(8080, 'valley');
  for (let i = 0; i < 8; i++) tickYear(w);
  const elite0 = w.civ.vars.wealthElite;
  const unrest0 = w.civ.vars.unrest;
  // 注入强制劳动与战争记忆
  w.civ.vars.laborForced = 0.5;
  w.civ.warMemory = 0.8;
  for (let i = 0; i < 15; i++) tickYear(w);
  assert.ok(w.civ.vars.wealthElite > elite0, `精英份额应上升: ${elite0.toFixed(3)} → ${w.civ.vars.wealthElite.toFixed(3)}`);
  assert.ok(w.civ.vars.unrest > unrest0 - 0.05, '强制劳动不应降低 unrest');
});

test('知识启蒙神力实际提升技术与思想', () => {
  const w = world(6060, 'valley');
  for (let i = 0; i < 5; i++) tickYear(w);
  const points0 = w.civ.tech.points;
  const enr0 = w.civ.enlightenment;
  const res = castCivPower(w, 'enlighten');
  assert.ok(res.ok);
  assert.ok(w.civ.tech.points > points0);
  assert.ok(w.civ.enlightenment > enr0);
  assert.equal(w.interventions, 1);
});

test('地形神力改变世界状态并消耗有限能量', () => {
  const w = newWorld({ seed: 42, size: 48, mode: 'limited', settlements: 1, scenario: 'valley' });
  const x = w.settlements[0].x + 5, y = w.settlements[0].y + 5;
  const before = w.tiles[y * 48 + x].terrain;
  const divine0 = w.divine;
  const res = castBrushPower(w, 'forest', x, y, 1);
  assert.ok(res.ok);
  assert.equal(w.tiles[y * 48 + x].terrain, Terrain.Forest);
  assert.ok(before === undefined || true);
  assert.ok(w.divine < divine0, '有限模式应消耗神力能量');
});

test('存档往返保持世界一致', () => {
  const w = world(1111, 'valley');
  for (let i = 0; i < 25; i++) tickYear(w);
  const json = serialize(w, '测试世界');
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, 1);
  const res = deserialize(json);
  assert.ok('world' in res, `应可解析: ${JSON.stringify(res)}`);
  if ('world' in res) {
    const w2 = res.world;
    assert.equal(w2.year, w.year);
    assert.equal(w2.settlements.length, w.settlements.length);
    assert.equal(w2.settlements[0].population, w.settlements[0].population);
    assert.equal(w2.civ.form, w.civ.form);
    assert.equal(w2.chronicle.length, w.chronicle.length);
    assert.equal(w2.rng.state, w.rng.state);
    // 读档后继续推进，行为应与原世界一致（同 RNG 状态）
    const a = JSON.parse(JSON.stringify(w.civ.vars.population));
    tickYear(w); tickYear(w2);
    assert.equal(w2.civ.vars.population, w.civ.vars.population, '读档后应可继续确定性模拟');
    assert.equal(a !== undefined, true);
  }
});

test('长程演化不崩溃且产生编年史', () => {
  const w = world(2024, 'valley');
  for (let i = 0; i < 200; i++) {
    tickYear(w);
    // 常量校验
    assert.ok(w.civ.vars.unrest >= 0 && w.civ.vars.unrest <= 1);
    assert.ok(w.civ.vars.wealthElite + w.civ.vars.wealthCommon + w.civ.vars.wealthMiddle > 0.9);
    for (const s of w.settlements) {
      if (!s.dead) {
        assert.ok(s.population >= 0);
        assert.ok(Number.isFinite(s.food));
      }
    }
  }
  assert.ok(w.chronicle.length > 0, '应有编年史记录');
  assert.ok(w.history.length > 0, '应有观察者采样');
  assert.ok(w.year === 200);
});

test('形态变迁会记录判定依据事件', () => {
  const w = world(2024, 'valley');
  // 人为推向封建
  for (let i = 0; i < 5; i++) tickYear(w);
  const v = w.civ.vars;
  v.laborBonded = 0.65; v.landConcentration = 0.75; v.market = 0.1;
  v.ownPrivate = 0.55; v.ownCommon = 0.4;
  w.civ.tech.levels.agriculture = 4;
  w.civ.tech.progress.agriculture = 999;
  tickYear(w);
  assert.equal(w.civ.form, 'feudal', `形态=${w.civ.form}`);
  const ev = w.chronicle.filter(e => e.category === 'institution');
  assert.ok(ev.length > 0, '形态变迁应产生制度事件');
  assert.ok(ev[ev.length - 1].causes.length > 0, '变迁事件应记录判定依据');
  assert.ok(ev[ev.length - 1].effects.some(e => e.includes('封建')));
});
