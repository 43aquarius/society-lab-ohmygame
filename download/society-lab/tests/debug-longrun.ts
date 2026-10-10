import { newWorld, tickYear } from '../src/sim/manager.ts';
import { castCivPower } from '../src/powers.ts';

// A: 自然演化
const a = newWorld({ seed: 777, size: 48, mode: 'free', settlements: 1, scenario: 'dawn' });
// B: 神力加速（启蒙+思想 交替）
const b = newWorld({ seed: 777, size: 48, mode: 'free', settlements: 1, scenario: 'dawn' });

for (let y = 1; y <= 320; y++) {
  tickYear(a);
  tickYear(b);
  if (y % 24 === 0) castCivPower(b, 'enlighten');
  if (y % 40 === 0) castCivPower(b, 'ideas');
}
const row = (name: string, w: typeof a) => {
  const v = w.civ.vars;
  const alive = w.settlements.filter(s => !s.dead);
  console.log(`${name}: 年${w.year} 形态=${w.civ.form} 人口=${v.population} 聚落=${alive.length} 建筑=${alive.reduce((x, s) => x + s.buildings.length, 0)}`);
  console.log(`   市场=${v.market.toFixed(2)} 私有=${v.ownPrivate.toFixed(2)} 公有=${v.ownPublic.toFixed(2)} 共有=${v.ownCommon.toFixed(2)} 雇佣=${v.laborWage.toFixed(2)} 依附=${v.laborBonded.toFixed(2)} 土地集中=${v.landConcentration.toFixed(2)} unrest=${v.unrest.toFixed(2)}`);
  console.log(`   编年史${w.chronicle.length}条 制度事件: ${w.chronicle.filter(e => e.category === 'institution').map(e => `y${e.year} ${e.title.split('：')[1]}`).join(', ')}`);
};
row('自然', a);
row('神力', b);
console.log('自然-事件类型分布:', JSON.stringify(a.chronicle.reduce((m: any, e) => (m[e.category] = (m[e.category] || 0) + 1, m), {})));
