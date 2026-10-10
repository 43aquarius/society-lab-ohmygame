// 测量截图 y=262 水平线上地图菱形的左右边界（深色桌面 vs 地图像素）
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const buf = readFileSync('/tmp/zoom-check.png');
const png = PNG.sync.read(buf);
const W = png.width, H = png.height;
const y = Math.round(H * 0.5); // ~262 if 523 high
const idx = (x, yy) => (yy * W + x) * 4;

// 桌面色 #20302c (32,48,44) → 找非桌面区段的边界
const isTable = (x) => {
  const r = png.data[idx(x, y)], g = png.data[idx(x, y) + 1], b = png.data[idx(x, y) + 2];
  return Math.abs(r - 32) < 14 && Math.abs(g - 48) < 14 && Math.abs(b - 44) < 14;
};
let left = null, right = null;
for (let x = 0; x < W; x++) { if (!isTable(x)) { left = x; break; } }
for (let x = W - 1; x >= 0; x--) { if (!isTable(x)) { right = x; break; } }
console.log(JSON.stringify({ W, H, y, left, right, width: right !== null && left !== null ? right - left + 1 : null, pct: right !== null && left !== null ? ((right - left + 1) / W * 100).toFixed(1) + '%' : null }));
