import { chromium } from '/home/z/.npm-global/lib/node_modules/playwright/index.mjs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const SHOT = '/home/z/my-project/download/society-lab/docs/v3';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:3000/game/index.html');
await wait(2200);
await page.evaluate(() => {
  document.querySelector('#new-seed').value = '777';
  document.querySelectorAll('.scenario-pick button')[1].click();
});
await page.click('text=创世');
await wait(2500);
await page.evaluate(() => { window.__OHMYGAME_PLAYTEST__.step(80); });
await wait(800);

// 聚焦聚落，白天
await page.evaluate(() => {
  const g = window.__game;
  const s = g.world.settlements[0];
  const p = { x: (s.x - s.y) * 32, y: (s.x + s.y) * 16 };
  g.vw.camera.targetX = p.x; g.vw.camera.targetY = p.y; g.vw.camera.x = p.x; g.vw.camera.y = p.y;
  g.vw.camera.targetZoom = 1.6; g.vw.camera.zoom = 1.6;
  g.vw.dayClock = 26 * 0.45;
});
await wait(1500);

// 疫病全套（瘴气+乌鸦+病倒的居民）
await page.evaluate(() => {
  const g = window.__game;
  const s = g.world.settlements[0];
  g.vw.fx.spawn('plague', s.x, s.y, 14);
  g.vw.fx.spawn('crows', s.x, s.y, 14);
  for (const a of g.vw.agents.agents) if (Math.random() < 0.4) a.sick = 0.8;
});
await wait(3000);
await page.screenshot({ path: `${SHOT}/12-plague.png` });

// 清空后单独看山洪
await page.evaluate(() => {
  const g = window.__game;
  g.vw.fx.list = [];
  const s = g.world.settlements[0];
  g.vw.fx.spawn('flood', s.x + 2, s.y + 1, 12);
});
await wait(4000);
await page.screenshot({ path: `${SHOT}/13-flood.png` });

// 起义
await page.evaluate(() => {
  const g = window.__game;
  g.vw.fx.list = [];
  const s = g.world.settlements[0];
  g.vw.fx.spawn('riot', s.x, s.y, 12, undefined, 1);
});
await wait(3000);
await page.screenshot({ path: `${SHOT}/14-riot.png` });

// 战争（两个聚落间行军+会战）
await page.evaluate(() => {
  const g = window.__game;
  g.vw.fx.list = [];
  const s = g.world.settlements[0];
  const other = g.world.settlements.find(x => !x.dead && x.id !== s.id);
  if (other) {
    const mid = { x: (s.x + other.x) / 2, y: (s.y + other.y) / 2 };
    g.vw.fx.spawnArmy(s, other);
    // 相机对准两聚落中点，缩小看行军
    const p = { x: (mid.x - mid.y) * 32, y: (mid.x + mid.y) * 16 };
    g.vw.camera.targetX = p.x; g.vw.camera.targetY = p.y; g.vw.camera.x = p.x; g.vw.camera.y = p.y;
    g.vw.camera.targetZoom = 1.1; g.vw.camera.zoom = 1.1;
  }
});
await wait(7000);
await page.screenshot({ path: `${SHOT}/15-war.png` });

console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
