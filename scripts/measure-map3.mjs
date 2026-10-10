// 检查右边缘像素颜色
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const png = PNG.sync.read(readFileSync('/tmp/after-drag3.png'));
const W = png.width;
for (const x of [1230, 1240, 1250, 1260, 1270, 1275, 1279]) {
  const i = (262 * W + x) * 4;
  console.log(`${x}: rgb(${png.data[i]},${png.data[i + 1]},${png.data[i + 2]})`);
}
