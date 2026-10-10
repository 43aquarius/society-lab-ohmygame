import { chromium } from '/home/z/.npm-global/lib/node_modules/playwright/index.mjs';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then(c => c.newPage());
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:3000/game/index.html');
await wait(2000);
await page.evaluate(() => { document.querySelector('#new-seed').value = '777'; document.querySelectorAll('.scenario-pick button')[1].click(); });
await page.click('text=创世');
await wait(2200);
const out = await page.evaluate(async () => {
  const g = window.__game;
  const s = g.world.settlements[0];
  const p = { x: (s.x - s.y) * 32, y: (s.x + s.y) * 16 };
  g.vw.camera.targetX = p.x; g.vw.camera.targetY = p.y; g.vw.camera.x = p.x; g.vw.camera.y = p.y;
  g.vw.camera.targetZoom = 1.6; g.vw.camera.zoom = 1.6;
  g.vw.dayClock = 26 * 0.45;
  g.vw.fx.spawn('plague', s.x, s.y, 14);
  g.vw.fx.spawn('crows', s.x, s.y, 14);
  g.vw.fx.spawn('riot', s.x, s.y, 12, undefined, 1);
  await new Promise(r => setTimeout(r, 1200));
  return {
    fxList: g.vw.fx.list.map(f => ({ type: f.type, gx: f.gx, gy: f.gy, ttl: Math.round(f.ttl) })),
    settlement: { x: s.x, y: s.y },
    camera: { x: Math.round(g.vw.camera.x), y: Math.round(g.vw.camera.y), zoom: +g.vw.camera.zoom.toFixed(2) },
    dayPhase: +((g.vw.dayClock % 26) / 26).toFixed(2),
  };
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: '/home/z/my-project/download/society-lab/docs/v3/debug-fx.png' });
await browser.close();
