import { newWorld, tickYear } from '../src/sim/manager.ts';
const w = newWorld({ seed: 31415, size: 512, mode: 'free', settlements: 3, scenario: 'valley' });
for (let y = 1; y <= 900; y++) {
  tickYear(w);
  if (y % 40 === 0) {
    const c = w.civs[0];
    const v = c.vars;
    const wl = w.chronicle.filter(e => e.category === 'war' && e.civId === 0).length;
    const pol = w.chronicle.filter(e => e.category === 'politics' && e.civId === 0).length;
    console.log(`y${y} form=${c.form.slice(0,4)} forced=${v.laborForced.toFixed(3)} bonded=${v.laborBonded.toFixed(3)} wage=${v.laborWage.toFixed(3)} warMem=${c.warMemory.toFixed(2)} market=${v.market.toFixed(2)} elite=${v.wealthElite.toFixed(2)} ownPriv=${v.ownPrivate.toFixed(2)} landC=${v.landConcentration.toFixed(2)} unrest=${v.unrest.toFixed(2)} 战争${wl} 政治${pol}`);
  }
}
