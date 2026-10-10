import { newWorld, tickYear } from '../src/sim/manager.ts';

// 调试 1: 确定性分歧点
const a = newWorld({ seed: 999, size: 48, mode: 'free', settlements: 1, scenario: 'valley' });
const b = newWorld({ seed: 999, size: 48, mode: 'free', settlements: 1, scenario: 'valley' });
for (let y = 1; y <= 30; y++) {
  tickYear(a); tickYear(b);
  if (JSON.stringify(a.civ.vars) !== JSON.stringify(b.civ.vars) || a.settlements[0].population !== b.settlements[0].population) {
    console.log(`分歧于第 ${y} 年:`);
    console.log(' a pop', a.settlements[0].population, 'b pop', b.settlements[0].population);
    for (const k of Object.keys(a.civ.vars)) {
      if (a.civ.vars[k] !== b.civ.vars[k]) console.log('  var', k, a.civ.vars[k], '!=', b.civ.vars[k]);
    }
    console.log(' a chron', a.chronicle.map(e => e.title).join('|'));
    console.log(' b chron', b.chronicle.map(e => e.title).join('|'));
    break;
  }
}
if (JSON.stringify(a.civ.vars) === JSON.stringify(b.civ.vars)) console.log('30 年内无分歧');

// 调试 2: 洪荒情景生存曲线
const w = newWorld({ seed: 2024, size: 48, mode: 'free', settlements: 1, scenario: 'dawn' });
console.log('\n洪荒情景演化:');
for (let y = 5; y <= 100; y += 5) {
  while (w.year < y) tickYear(w);
  const s = w.settlements[0];
  console.log(` 第${y}年 人口=${s?.population} 粮=${Math.round(s?.food ?? 0)} 聚落=${w.settlements.length} 形态=${w.civ.form} 农田=${s?.buildings.filter(b => b.kind === 'farm').length ?? 0}`);
}
