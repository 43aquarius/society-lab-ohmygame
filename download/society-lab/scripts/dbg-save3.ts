import { newWorld, tickYear } from '/home/z/my-project/download/society-lab/src/sim/manager.ts';
import { serialize, deserialize } from '/home/z/my-project/download/society-lab/src/saves.ts';
import { castBrushPower } from '/home/z/my-project/download/society-lab/src/powers.ts';
import { tileAt } from '/home/z/my-project/download/society-lab/src/worldgen.ts';

const w = newWorld({ seed: 1111, size: 64, mode: 'free', settlements: 1, scenario: 'valley' });
castBrushPower(w, 'fertile', w.settlements[0].x + 3, w.settlements[0].y + 3, 1);
for (let i = 0; i < 25; i++) tickYear(w);
const w2 = (deserialize(serialize(w, 'x')) as any).world;
const s2 = w2.settlements[0];
console.log('s2:', {x: s2.x, y: s2.y, pop: s2.population, radius: s2.radius, food: s2.food});
console.log('buildings:', s2.buildings.map(b => `${b.kind}:${b.progress}`).join(' '));
console.log('gen size:', w2.gen.size, 'chunks:', w2.chunks.size);
// survey 手动
let fertilitySum = 0, count = 0;
for (let dy = -s2.radius; dy <= s2.radius; dy++) for (let dx = -s2.radius; dx <= s2.radius; dx++) {
  const t = tileAt(w2, s2.x + dx, s2.y + dy);
  if (!t) continue;
  count++;
  fertilitySum += t.fertility;
  if (Number.isNaN(t.fertility)) { console.log('NaN fertility at', s2.x+dx, s2.y+dy); }
}
console.log('survey count:', count, 'fertility avg:', count ? fertilitySum / count : 'n/a');
