import { newWorld, tickYear } from '/home/z/my-project/download/society-lab/src/sim/manager.ts';
import { serialize, deserialize } from '/home/z/my-project/download/society-lab/src/saves.ts';
import { castBrushPower } from '/home/z/my-project/download/society-lab/src/powers.ts';
import { Terrain } from '/home/z/my-project/download/society-lab/src/types.ts';

const w = newWorld({ seed: 1111, size: 64, mode: 'free', settlements: 1, scenario: 'valley' });
castBrushPower(w, 'fertile', w.settlements[0].x + 3, w.settlements[0].y + 3, 1);
for (let i = 0; i < 25; i++) tickYear(w);
const json = serialize(w, '测试世界');
const res = deserialize(json);
if ('world' in res) {
  const w2 = res.world;
  console.log('w settlements:', w.settlements.map(s => `${s.name} pop=${s.population} food=${Math.round(s.food)} civ=${s.civId}`).join(' | '));
  console.log('w2 settlements:', w2.settlements.map(s => `${s.name} pop=${s.population} food=${Math.round(s.food)} civ=${s.civId}`).join(' | '));
  console.log('w civ pop:', w.civs.map(c=>c.vars.population).join(','), ' w2:', w2.civs.map(c=>c.vars.population).join(','));
  console.log('w roads:', [...w.settlements[0].roads].length, 'w2 roads:', [...w2.settlements[0].roads].length);
  console.log('w civ[0] keys:', Object.keys(w.civs[0]).join(','));
  console.log('w2 civ[0] keys:', Object.keys(w2.civs[0]).join(','));
  // 单步对比
  tickYear(w);
  try { tickYear(w2); } catch (e: any) { console.log('w2 tick ERROR:', e.message); }
  console.log('after tick: w pop=', w.civs[0].vars.population, ' w2 pop=', w2.civs[0].vars.population);
  console.log('after tick: w s.pop=', w.settlements[0].population, ' w2 s.pop=', w2.settlements[0].population, 'w2 food=', w2.settlements[0].food);
}
