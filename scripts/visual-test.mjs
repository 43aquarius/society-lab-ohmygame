import { chromium } from '/home/z/.npm-global/lib/node_modules/playwright/index.mjs';

const SHOT = '/home/z/my-project/download/society-lab/docs/v3';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:3000/game/index.html');
await wait(2500);

// 创建河谷世界（已掌握农耕，更快看到农业时代）
await page.evaluate(() => {
  document.querySelector('#new-seed').value = '20260';
  document.querySelectorAll('.scenario-pick button')[1].click(); // 河谷黎明
});
await page.click('text=创世');
await wait(3000);

const state = () => page.evaluate(() => {
  const g = window.__game;
  return { year: g.world.year, pop: g.world.civ.vars.population, agents: g.vw.agents.agents.length };
});
console.log('world:', JSON.stringify(await state()));

// 聚焦聚落
await page.evaluate(() => {
  const g = window.__game;
  const s = g.world.settlements[0];
  const p = { x: (s.x - s.y) * 32, y: (s.x + s.y) * 16 };
  g.vw.camera.targetX = p.x; g.vw.camera.targetY = p.y;
  g.vw.camera.targetZoom = 2.2; g.vw.camera.x = p.x; g.vw.camera.y = p.y; g.vw.camera.zoom = 2.2;
});

// === 1) 白天劳作 ===
await page.evaluate(() => { window.__game.vw.dayClock = 26 * 0.45; }); // 白天工作时段
await wait(6000); // 等他们走出来干活
await page.screenshot({ path: `${SHOT}/05-settlement-day.png` });
const dayStates = await page.evaluate(() => {
  const a = window.__game.vw.agents.agents;
  const c = {};
  for (const x of a) c[x.state] = (c[x.state] || 0) + 1;
  const jobs = {};
  for (const x of a) jobs[x.job] = (jobs[x.job] || 0) + 1;
  return { states: c, jobs, n: a.length };
});
console.log('day states:', JSON.stringify(dayStates));

// === 2) 夜晚：入睡 + 窗户灯（钉住深夜时段，否则昼夜会继续流转） ===
for (let t = 0; t < 14; t++) {
  await page.evaluate(() => { window.__game.vw.dayClock = 26 * 0.05; });
  await wait(1000);
}
await page.screenshot({ path: `${SHOT}/06-night.png` });
const nightStates = await page.evaluate(() => {
  const a = window.__game.vw.agents.agents;
  const c = {};
  for (const x of a) c[x.state] = (c[x.state] || 0) + 1;
  return { states: c, n: a.length };
});
console.log('night states:', JSON.stringify(nightStates));

// === 3) 推进 30 年：生老病死与坟墓 ===
await page.evaluate(() => { window.__OHMYGAME_PLAYTEST__.step(30); });
await wait(1500);
const lifeInfo = await page.evaluate(() => {
  const g = window.__game;
  const a = g.vw.agents.agents;
  const ages = a.map(x => x.age);
  const dying = a.filter(x => x.state === 'dying').length;
  return {
    year: g.world.year, pop: g.world.civ.vars.population, agents: a.length,
    avgAge: (ages.reduce((s, x) => s + x, 0) / a.length).toFixed(1),
    children: a.filter(x => x.age < 16).length,
    elders: a.filter(x => x.age >= 58).length,
    dying,
    graves: g.world.decals.filter(d => d.kind === 'grave').length,
    decals: g.world.decals.length,
  };
});
console.log('life info:', JSON.stringify(lifeInfo));
await page.screenshot({ path: `${SHOT}/07-30years.png` });

// === 4) 事件视觉预览：战争行军 / 会战 / 疫病乌鸦 / 山洪 / 起义 / 陨星 ===
await page.evaluate(() => {
  const g = window.__game;
  const fx = g.vw.fx;
  const s = g.world.settlements[0];
  // 战争行军（两聚落间）——先造第二个聚落
  const b = g.world.settlements.find(x => !x.dead && x.id !== s.id);
  if (b) fx.spawnArmy(s, b);
  else fx.spawnArmy(s, { x: s.x + 10, y: s.y + 6 });
  // 疫病 + 乌鸦
  fx.spawn('plague', s.x, s.y, 14);
  fx.spawn('crows', s.x, s.y, 14);
  // 山洪
  fx.spawn('flood', s.x + 3, s.y + 3, 12);
  // 起义（激烈）
  fx.spawn('riot', s.x - 4, s.y - 3, 10, undefined, 1);
  // 陨星 + 陨坑
  fx.spawn('meteor', s.x + 14, s.y + 10, 9);
  // 让部分小人染病（配合疫病表现）
  for (const a of g.vw.agents.agents) if (Math.random() < 0.35) a.sick = 0.7;
  g.vw.camera.targetZoom = 1.5;
});
await wait(5000);
await page.screenshot({ path: `${SHOT}/08-events.png` });
await page.evaluate(() => { window.__game.vw.fx.list = []; }); // 清特效

// === 5) 旧世界：推进到 350 年看城镇形态与比例 ===
await page.evaluate(() => { window.__OHMYGAME_PLAYTEST__.step(310); });
await wait(2500);
const cityInfo = await page.evaluate(() => {
  const g = window.__game;
  const s = g.world.settlements.filter(x => !x.dead).sort((a, b) => b.population - a.population)[0];
  const p = { x: (s.x - s.y) * 32, y: (s.x + s.y) * 16 };
  g.vw.camera.targetX = p.x; g.vw.camera.targetY = p.y;
  g.vw.camera.targetZoom = 1.6; g.vw.camera.x = p.x; g.vw.camera.y = p.y; g.vw.camera.zoom = 1.6;
  const kinds = {};
  for (const b of s.buildings) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
  const a = g.vw.agents.agents;
  const jobs = {};
  for (const x of a) jobs[x.job] = (jobs[x.job] || 0) + 1;
  const ages = a.map(x => x.age);
  return {
    year: g.world.year, form: g.world.civ.form, bigCity: `${s.name}(${s.stage}·${s.population}人)`,
    buildings: kinds, agents: a.length, jobs,
    avgAge: (ages.reduce((s2, x) => s2 + x, 0) / a.length).toFixed(1),
    elders: a.filter(x => x.age >= 58).length,
    graves: g.world.decals.filter(d => d.kind === 'grave').length,
  };
});
console.log('city info:', JSON.stringify(cityInfo));
await wait(2000);
await page.screenshot({ path: `${SHOT}/09-city.png` });

// === 6) 夜景下的城市（灯火） ===
await page.evaluate(() => { window.__game.vw.dayClock = 26 * 0.04; });
await wait(4000);
await page.screenshot({ path: `${SHOT}/10-city-night.png` });

// === 7) 城市白天劳作 ===
await page.evaluate(() => { window.__game.vw.dayClock = 26 * 0.5; });
await wait(6000);
await page.screenshot({ path: `${SHOT}/11-city-day.png` });
const cityDay = await page.evaluate(() => {
  const a = window.__game.vw.agents.agents;
  const c = {};
  for (const x of a) c[x.state] = (c[x.state] || 0) + 1;
  const jobs = {};
  for (const x of a) jobs[x.job] = (jobs[x.job] || 0) + 1;
  return { states: c, jobs };
});
console.log('city day:', JSON.stringify(cityDay));

// === 8) 性能：FPS 采样 ===
const fps = await page.evaluate(async () => {
  const g = window.__game;
  g.vw.camera.targetZoom = 1.2;
  let frames = 0;
  const t0 = performance.now();
  await new Promise(r => {
    const cnt = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(cnt); else r(); };
    requestAnimationFrame(cnt);
  });
  return Math.round(frames / ((performance.now() - t0) / 1000));
});
console.log('FPS @zoom1.2 agents ~600:', fps);

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
