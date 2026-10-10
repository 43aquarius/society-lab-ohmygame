// 在 y=262 行（避开左侧工具栏 0-232px 和右下小地图），扫描地图/桌面边界
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const png = PNG.sync.read(readFileSync('/tmp/zoom-min.png'));
const W = png.width, H = png.height;
const y = Math.min(262, H - 1);
const px = (x) => { const i = (y * W + x) * 4; return [png.data[i], png.data[i+1], png.data[i+2]]; };
const isTable = ([r, g, b]) => Math.abs(r - 32) < 10 && Math.abs(g - 48) < 10 && Math.abs(b - 44) < 10;

let firstNonTableFromLeft = null, lastNonTableFromRight = null;
for (let x = 240; x < W; x++) { if (!isTable(px(x))) { firstNonTableFromLeft = x; break; } }
for (let x = W - 1; x >= 240; x--) { if (!isTable(px(x))) { lastNonTableFromRight = x; break; } }
console.log(JSON.stringify({ W, H, y, firstNonTableFromLeft, lastNonTableFromRight }));
