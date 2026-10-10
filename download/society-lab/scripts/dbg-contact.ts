import { newWorld, tickYear } from '../src/sim/manager.ts';

const w = newWorld({ seed: 31415, size: 512, mode: 'free', settlements: 3, scenario: 'valley' });
console.log('初始:', w.settlements.map(s => `${s.name}(civ${s.civId})@${s.x},${s.y}`).join(' '));
for (const a of w.settlements) for (const b of w.settlements) {
  if (a.id < b.id) console.log(`  ${a.name} ↔ ${b.name}: ${Math.hypot(a.x-b.x, a.y-b.y).toFixed(0)} 格`);
}
for (let y = 1; y <= 1500; y++) {
  tickYear(w);
  if (y % 300 === 0) {
    const alive = w.civs.filter(c => !c.dead);
    console.log(`[${y}] civs=${alive.length} 聚落:`, w.settlements.filter(s=>!s.dead).slice(0,8).map(s => `${s.name.slice(0,3)}(c${s.civId})`).join(' '));
  }
}
// 终局接触情况
console.log('终局文明 met 状态:', w.civs.map(c => `${c.id}:met[${c.met.join(',')}]${c.dead?'死':''}`).join(' '));
const alive = w.settlements.filter(s=>!s.dead);
for (let i = 0; i < Math.min(alive.length, 12); i++) for (let j = i+1; j < Math.min(alive.length, 12); j++) {
  const d = Math.hypot(alive[i].x-alive[j].x, alive[i].y-alive[j].y);
  if (d < 90) console.log(`  近对: ${alive[i].name}(c${alive[i].civId}) ↔ ${alive[j].name}(c${alive[j].civId}) = ${d.toFixed(0)}`);
}
