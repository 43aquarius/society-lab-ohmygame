import { chromium } from '/home/z/.npm-global/lib/node_modules/playwright/index.mjs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:3000/game/index.html');
await wait(2000);
await page.evaluate(() => {
  document.querySelector('#new-seed').value = '20260';
  document.querySelectorAll('.scenario-pick button')[1].click();
});
await page.click('text=创世');
await wait(2500);
await page.evaluate(() => { window.__OHMYGAME_PLAYTEST__.step(340); });
await wait(1000);

const measure = async (label) => {
  const fps = await page.evaluate(async () => {
    const g = window.__game;
    g.vw.camera.targetZoom = 1.2; g.vw.camera.zoom = 1.2;
    let frames = 0;
    const t0 = performance.now();
    await new Promise(r => {
      const cnt = () => { frames++; if (performance.now() - t0 < 2500) requestAnimationFrame(cnt); else r(); };
      requestAnimationFrame(cnt);
    });
    return Math.round(frames / ((performance.now() - t0) / 1000));
  });
  console.log(label, fps);
  return fps;
};

// 聚焦最大聚落
await page.evaluate(() => {
  const g = window.__game;
  const s = g.world.settlements.filter(x => !x.dead).sort((a, b) => b.population - a.population)[0];
  const p = { x: (s.x - s.y) * 32, y: (s.x + s.y) * 16 };
  g.vw.camera.targetX = p.x; g.vw.camera.targetY = p.y; g.vw.camera.x = p.x; g.vw.camera.y = p.y;
});

const info = await page.evaluate(() => {
  const g = window.__game;
  return { agents: g.vw.agents.agents.length, decals: g.world.decals.length, buildings: g.world.settlements.reduce((a, s) => a + s.buildings.length, 0) };
});
console.log('scene:', JSON.stringify(info));

await measure('baseline      :');

// 1) 清空小人
await page.evaluate(() => { window.__bak_agents = window.__game.vw.agents.agents; window.__game.vw.agents.agents = []; });
await measure('no agents     :');

// 2) 清空印记
await page.evaluate(() => { window.__bak_decals = window.__game.world.decals; window.__game.world.decals = []; });
await measure('no decals     :');

// 3) 恢复
await page.evaluate(() => { window.__game.vw.agents.agents = window.__bak_agents; });

// 4) 缩放到远景观察
await page.evaluate(() => { window.__game.vw.fitMap(96); });
await measure('fitmap(0.4x)  :');

// 5) 恢复印记 + 中焦
await page.evaluate(() => { window.__game.world.decals = window.__bak_decals; });
await page.evaluate(() => {
  const g = window.__game;
  const s = g.world.settlements.filter(x => !x.dead).sort((a, b) => b.population - a.population)[0];
  const p = { x: (s.x - s.y) * 32, y: (s.x + s.y) * 16 };
  g.vw.camera.targetX = p.x; g.vw.camera.targetY = p.y; g.vw.camera.x = p.x; g.vw.camera.y = p.y;
  g.vw.camera.targetZoom = 1.8; g.vw.camera.zoom = 1.8;
});
await measure('close 1.8x    :');

await browser.close();
