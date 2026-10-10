# 沙箱发布基座（Z.ai Next.js 工程引用）

游戏本体是纯静态构建（`../dist` → 挂载到宿主 Next.js 工程的 `public/game/`）。

- `next.config.ts`：根路由 `/` 通过 beforeFiles rewrite 指向 `/game/index.html`
- `layout.tsx` / `page.tsx`：宿主页（兜底指引 + 元数据）
- 构建基座：`vite.config.ts` 中 `base: '/game/'`

宿主工程结构（/home/z/my-project）：
- `public/game/` ← 本工程 `dist/` 的拷贝
- `.zscripts/dev.sh`：平台启动时 `bun install && bun run db:push && bun run dev`（Next.js 16, 端口 3000）
- 发布：`bun run build`（standalone 输出，public 随包复制）
