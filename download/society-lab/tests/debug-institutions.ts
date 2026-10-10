// 诊断：制度变量随时间的演化（调平衡用）
import { newWorld, tickYear } from '../src/sim/manager.ts';

function run(seed: number, scenario: 'dawn' | 'valley', years: number) {
  const w = newWorld({ seed, size: 96, mode: 'free', settlements: 1, scenario });
  console.log(`===== seed=${seed} ${scenario} =====`);
  console.log('year | form | pop | own(C/P/U) | labor(F/B/W/C) | land | mkt | state | edu | pub | part | tech(ag,cr,bu,co,go,me,in,ed)');
  for (let y = 1; y <= years; y++) {
    tickYear(w);
    if (y % 100 === 0 || y === 50) {
      const v = w.civ.vars;
      const t = w.civ.tech.levels;
      console.log(
        `${String(y).padStart(4)} | ${w.civ.form.padEnd(10)} | ${String(v.population).padStart(5)} | ` +
        `${Math.round(v.ownCommon * 100)}/${Math.round(v.ownPrivate * 100)}/${Math.round(v.ownPublic * 100)} | ` +
        `${Math.round(v.laborForced * 100)}/${Math.round(v.laborBonded * 100)}/${Math.round(v.laborWage * 100)}/${Math.round(v.laborCoop * 100)} | ` +
        `${Math.round(v.landConcentration * 100)} | ${Math.round(v.market * 100)} | ${Math.round(v.stateCapacity * 100)} | ` +
        `${Math.round(v.education * 100)} | ${Math.round(v.publicServices * 100)} | ${Math.round(v.participation * 100)} | ` +
        `${[t.agriculture, t.crafting, t.building, t.commerce, t.governance, t.medicine, t.industry, t.education].join(',')}`);
    }
  }
  console.log('战争/冲突事件数:', w.chronicle.filter(e => e.category === 'war').length);
  console.log('');
}

run(2024, 'valley', 800);
run(777, 'valley', 800);
