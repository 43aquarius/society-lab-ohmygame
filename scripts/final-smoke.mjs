import { chromium } from '/home/z/.npm-global/lib/node_modules/playwright/index.mjs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:3000/game/index.html');
await wait(2000);
await page.evaluate(() => { document.querySelector('#new-seed').value = '31337'; });
await page.click('text=创世');
await wait(3000);
// 让世界跑 20 秒真实时间（1× 速度，约 3 年）
await wait(20000);
const state = await page.evaluate(() => {
  const g = window.__game;
  const a = g.vw.agents.agents;
  return {
    year: g.world.year,
    pop: g.world.civ.vars.population,
    agents: a.length,
    speed: g.speed,
    playing: !document.getElementById('game').classList.contains('hidden'),
  };
});
console.log('final state:', JSON.stringify(state));
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await page.screenshot({ path: '/home/z/my-project/download/society-lab/docs/v3/16-final.png' });
await browser.close();
