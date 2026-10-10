#!/bin/bash
# 构建游戏 → 同步 public/game（源服务器目录）→ 重启 standalone 静态服务
set -e
GAME=/home/z/my-project/download/society-lab
for DEST in /home/z/my-project/public/game /home/z/my-project/.next/standalone/public/game; do
  mkdir -p "$DEST/assets"
  cp "$GAME/dist/index.html" "$DEST/index.html"
  cp "$GAME/dist/assets/"* "$DEST/assets/"
  cp "$GAME/dist/favicon.svg" "$DEST/favicon.svg" 2>/dev/null || true
done
# 清理两目录中不同名的旧 hash 资源
for DEST in /home/z/my-project/public/game /home/z/my-project/.next/standalone/public/game; do
  HASH=$(grep -o 'index-[^"]*\.js' "$DEST/index.html" | head -1)
  for f in "$DEST/assets/"index-*.js; do
    [ "$(basename "$f")" = "$HASH" ] || rm -f "$f"
  done
done
# 重启 standalone 服务器（进程号动态查找）
PID=$(ss -tlnp 2>/dev/null | grep ':3000' | grep -oP 'pid=\K[0-9]+' | head -1)
if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; sleep 1; fi
cd /home/z/my-project
setsid nohup env PORT=3000 bun .next/standalone/server.js > /home/z/my-project/scripts/standalone-server.log 2>&1 &
sleep 2
curl -s -o /dev/null -w "game %{http_code}\n" http://localhost:3000/game/
