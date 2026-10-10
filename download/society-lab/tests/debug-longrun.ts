/**
 * 长跑平衡验证（v2.0）
 * 检验历史进程合理性：
 * 1. 聚落是否长大（村落→城镇→城市），而非无限分蘖成小部落
 * 2. 社会形态是否按序演进（原始→奴隶/封建→资本主义），且不超前于物质基础
 * 3. 时代建筑是否随社会出现
 * 4. 人口/技术的时间线是否合理
 */
import { newWorld, tickYear } from '../src/sim/manager.ts';
import { classifySociety } from '../src/sim/society.ts';
import { BUILDINGS } from '../src/config.ts';
import { STAGE_NAMES, FORM_NAMES } from '../src/types.ts';

function run(seed: number, scenario: 'dawn' | 'valley', years: number, label: string) {
  const w = newWorld({ seed, size: 96, mode: 'free', settlements: 1, scenario });
  const timeline: string[] = [];
  let lastForm = w.civ.form;
  const formYears: Record<string, number> = {};
  const maxPopByStage: Record<string, number> = {};
  const seenBuildings = new Set<string>();

  const t0 = Date.now();
  for (let y = 1; y <= years; y++) {
    tickYear(w);
    if (w.civ.form !== lastForm) {
      timeline.push(`  第${y}年 形态变迁: ${FORM_NAMES[lastForm]} → ${FORM_NAMES[w.civ.form]}`);
      lastForm = w.civ.form;
    }
    for (const s of w.settlements) {
      if (!s.dead && s.population > (maxPopByStage[s.stage] ?? 0)) maxPopByStage[s.stage] = s.population;
      for (const b of s.buildings) seenBuildings.add(b.kind);
    }
    if (y % 100 === 0) {
      const macro = { pop: w.civ.vars.population };
      const stages = w.settlements.filter(s => !s.dead).map(s => `${s.name}(${STAGE_NAMES[s.stage]}·${s.population})`);
      console.log(`第${y}年 [${FORM_NAMES[w.civ.form]}] 总人口${macro.pop} 聚落${w.settlements.filter(s => !s.dead).length}个 | ${stages.slice(0, 6).join(' ')}`);
      formYears[w.civ.form] = formYears[w.civ.form] ?? y;
    }
  }
  const ms = Date.now() - t0;

  console.log(`\n===== ${label} (seed=${seed}, ${scenario}, ${years}年, ${ms}ms) =====`);
  console.log('变迁时间线:');
  timeline.forEach(t => console.log(t));
  const cls = classifySociety(w);
  console.log(`最终形态: ${FORM_NAMES[w.civ.form]} | 技术水平:`, Object.entries(w.civ.tech.levels).map(([k, v]) => `${k.slice(0, 3)}${v}`).join(' '));
  console.log('制度变量:', JSON.stringify({
    own: [w.civ.vars.ownCommon, w.civ.vars.ownPrivate, w.civ.vars.ownPublic].map(x => Math.round(x * 100)),
    labor: [w.civ.vars.laborForced, w.civ.vars.laborBonded, w.civ.vars.laborWage, w.civ.vars.laborCoop].map(x => Math.round(x * 100)),
    market: Math.round(w.civ.vars.market * 100), state: Math.round(w.civ.vars.stateCapacity * 100),
    urban: Math.round(cls.blocked.length * 0 + (w.settlements.filter(s => !s.dead && s.population >= 400).reduce((a, s) => a + s.population, 0) / Math.max(1, w.civ.vars.population)) * 100),
  }));
  console.log('各阶段最大聚落人口:', Object.entries(maxPopByStage).map(([k, v]) => `${STAGE_NAMES[k as keyof typeof STAGE_NAMES]}:${v}`).join(' '));
  console.log('出现过的建筑:', [...seenBuildings].map(k => BUILDINGS[k]?.name ?? k).join('、'));
  console.log('最终聚落:', w.settlements.filter(s => !s.dead).map(s => `${s.name}(${STAGE_NAMES[s.stage]}·${s.population}人·建筑${s.buildings.length})`).join(' '));
  console.log('');
}

run(2024, 'valley', 1200, '河谷黎明 · 标准演化');
run(31337, 'dawn', 1200, '洪荒初民 · 白手起家');
