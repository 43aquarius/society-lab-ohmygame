/**
 * v4.0 多文明长跑：验证历史进程（万邦分化、形态变迁、接触/贸易/战争、纪元推进）
 */
import { newWorld, tickYear } from '../src/sim/manager.ts';
import { FORM_NAMES } from '../src/types.ts';
import { worldEra } from '../src/names.ts';

const seed = Number(process.argv[2] ?? 31415);
const years = Number(process.argv[3] ?? 1200);
const civCount = Number(process.argv[4] ?? 3);

console.log(`=== 万邦长跑 seed=${seed} years=${years} civs=${civCount} ===`);
const w = newWorld({ seed, size: 512, mode: 'free', settlements: civCount, scenario: 'valley' });
console.log(`初始文明：${w.civs.map(c => `${c.name}(${c.color})`).join('、')}`);
console.log(`初始聚落：${w.settlements.map(s => `${s.name}@${s.x},${s.y}`).join('、')}`);

const t0 = Date.now();
let lastReport = 0;
for (let y = 1; y <= years; y++) {
  tickYear(w);
  // 打印形态变迁
  for (const c of w.civs) {
    // 形态变迁事件
  }
  if (y - lastReport >= Math.max(50, Math.floor(years / 24))) {
    lastReport = y;
    const alive = w.civs.filter(c => !c.dead);
    const era = worldEra(w);
    console.log(`[第${y}年] ${era.name} · 文明${alive.length}个 · 总人口${w.settlements.filter(s=>!s.dead).reduce((a,s)=>a+s.population,0)} · ${alive.map(c => `${c.name.slice(0,3)}=${FORM_NAMES[c.form]}(${c.vars.population}人${c.met.length?`·识${c.met.length}`:''})`).join(' ')}`);
  }
}
const dt = (Date.now() - t0) / 1000;
console.log(`\n模拟耗时 ${dt.toFixed(1)}s (${(years / dt).toFixed(0)} 年/秒)`);
console.log(`\n=== 终局（第 ${w.year} 年）===`);
const era = worldEra(w);
console.log(`世界纪元：${era.name} —— ${era.desc}`);
for (const c of w.civs) {
  const mine = w.settlements.filter(s => s.civId === c.id);
  console.log(`\n【${c.name}】${c.dead ? '已消亡' : FORM_NAMES[c.form]} · 存续${w.year - c.founded}年 · ${c.vars.population}人 · ${mine.filter(s=>!s.dead).length}/${mine.length}聚落`);
  console.log(`  所有制：共有${Math.round(c.vars.ownCommon*100)}%/私有${Math.round(c.vars.ownPrivate*100)}%/公有${Math.round(c.vars.ownPublic*100)}% · 劳动：强制${Math.round(c.vars.laborForced*100)}%/依附${Math.round(c.vars.laborBonded*100)}%/雇佣${Math.round(c.vars.laborWage*100)}%/合作${Math.round(c.vars.laborCoop*100)}%`);
  console.log(`  技术：农耕${c.tech.levels.agriculture} 工具${c.tech.levels.crafting} 营造${c.tech.levels.building} 商贸${c.tech.levels.commerce} 治理${c.tech.levels.governance} 工业${c.tech.levels.industry}`);
  const events = w.chronicle.filter(e => e.civId === c.id);
  const forms = events.filter(e => e.category === 'institution');
  for (const f of forms.slice(-6)) console.log(`  · 第${f.year}年 ${f.title}`);
}
// 关键统计
const cats = new Map<string, number>();
for (const e of w.chronicle) cats.set(e.category, (cats.get(e.category) ?? 0) + 1);
console.log(`\n事件分布：${[...cats.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}`);
const wars = w.chronicle.filter(e => e.category === 'war');
const cross = w.chronicle.filter(e => e.title.includes('文明相遇'));
const spread = w.chronicle.filter(e => e.title.includes('技艺东渐'));
const newCiv = w.chronicle.filter(e => e.title.includes('新文明诞生'));
console.log(`战争 ${wars.length} 次 · 文明相遇 ${cross.length} 次 · 技术扩散 ${spread.length} 次 · 新文明诞生 ${newCiv.length} 次`);
console.log(`chunk 缓存：${w.chunks.size} 个（modified: ${[...w.chunks.values()].filter(c=>c.modified).length}）`);
