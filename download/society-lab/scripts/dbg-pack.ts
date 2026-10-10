import { newWorld, tickYear } from '/home/z/my-project/download/society-lab/src/sim/manager.ts';
import { serialize } from '/home/z/my-project/download/society-lab/src/saves.ts';
import { castBrushPower } from '/home/z/my-project/download/society-lab/src/powers.ts';

const w = newWorld({ seed: 1111, size: 64, mode: 'free', settlements: 1, scenario: 'valley' });
castBrushPower(w, 'fertile', w.settlements[0].x + 3, w.settlements[0].y + 3, 1);
for (let i = 0; i < 2; i++) tickYear(w);
const json = serialize(w, 'x');
const p = JSON.parse(json);
const cs = p.world.chunks[0];
console.log('chunk count:', p.world.chunks.length, 'cx,cy:', cs.cx, cs.cy);
const [geo, env] = cs.pack.split('|');
console.log('geo len:', geo.length, 'env len:', env.length, '(expect 3072 each)');
console.log('first 20 geo chars:', JSON.stringify(geo.slice(0, 20)));
console.log('first 20 env chars codes:', [...env.slice(0, 10)].map(c => c.charCodeAt(0)));
