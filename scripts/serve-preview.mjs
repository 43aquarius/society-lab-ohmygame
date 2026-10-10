// Society Lab — 沙箱预览静态服务器（零依赖）
// 服务 /home/z/my-project/download/society-lab/dist 于 0.0.0.0:3000
// Caddy 网关（外部预览）转发至本端口
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = '/home/z/my-project/download/society-lab/dist';
const PORT = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let path = normalize(join(ROOT, url));
    if (!path.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let body;
    try {
      body = await readFile(path);
    } catch {
      // SPA 回退 / 目录索引
      body = await readFile(join(ROOT, 'index.html'));
      path = join(ROOT, 'index.html');
    }
    const type = MIME[extname(path)] ?? 'application/octet-stream';
    const cacheable = /\.(js|css|png|woff2?)$/.test(path) && !path.endsWith('.html');
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cacheable ? 'public, max-age=300' : 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end('Internal error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[society-lab-preview] serving ${ROOT} on http://0.0.0.0:${PORT}`);
});
