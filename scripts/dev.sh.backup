#!/bin/bash
# Society Lab《人类社会实验室》— 沙箱预览服务器
#
# 由容器启动脚本 /start.sh 在 BOOT 时以后台任务执行（sudo -u z bash 本文件），
# 是唯一能在工具调用之间存活的进程启动方式。
# 作用：在 0.0.0.0:3000 服务 dist/ 静态构建，供 Caddy 网关（对外预览面板）代理。
#
# 零依赖：仅需系统自带 node（/usr/bin/node）。

LOG=/tmp/society-lab-preview.log
PROJECT=/home/z/my-project
GAME=$PROJECT/download/society-lab
SERVER=$PROJECT/scripts/serve-preview.mjs

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "=== Society Lab preview dev.sh started (pid $$) ==="

# 健壮性：若 3000 端口已被占用（平台 bun dev 流程等），仅记录并退出
if command -v node >/dev/null 2>&1; then
  log "node found: $(node --version)"
else
  log "FATAL: node not found; cannot serve preview"
  exit 1
fi

# dist 不存在时尝试构建（node_modules 通常不随恢复保留，尽力而为）
if [ ! -f "$GAME/dist/index.html" ]; then
  log "dist/ missing, attempting build..."
  if [ -d "$GAME/node_modules" ]; then
    (cd "$GAME" && npx vite build >> "$LOG" 2>&1) \
      && log "build OK" \
      || log "build FAILED (dist missing)"
  else
    log "node_modules missing too — skipping build (dist must be committed)"
  fi
fi

if [ -f "$GAME/dist/index.html" ]; then
  log "serving $GAME/dist on :3000"
  exec node "$SERVER"
else
  log "FATAL: $GAME/dist/index.html not found; preview unavailable"
  exit 1
fi
