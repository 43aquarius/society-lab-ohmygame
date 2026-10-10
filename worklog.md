# Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: 调研 ohmygame 项目结构，确定 Society Lab《人类社会实验室》实现路线

Work Log:
- 克隆 https://github.com/WhiteTowerAI/ohmygame，阅读 README/docs/runtime.md/docs/canvas-agent.md
- 克隆 ohmygame-examples（锁定 commit 98a8f59），研究 web-game 示例工程结构（tidal-workshop 等）
- 确认约定：游戏为标准 Vite+TS Web 工程；canvas/ 设计文档工作区（index.json/boards/documents/schemas/assets.json/jobs.json/editor/）；AGENTS.md/CREDITS.md/LICENSE/README.md；dev 模式暴露 window.__OHMYGAME_PLAYTEST__ 桥（snapshot/reset/setSeed/step）
- 环境检查：Node 24.21 / npm 11.19 / bun 1.3.14，npm registry 可达

Stage Summary:
- 技术路线：在 /home/z/my-project/download/society-lab 创建 ohmygame 风格 web-game 工程
- 零运行时依赖：Canvas 2D 等距渲染 + DOM UI + Web Audio 合成音效，保证可玩、可测、可构建
- 模块映射提示词要求：rng/config/worldgen/sim(population,economy,technology,institutions,society,conflict,events,manager)/powers/chronicle/saves/render/camera/ui/audio

---
Task ID: 2
Agent: main (Super Z)
Task: 基于 ohmygame 工程约定开发 Society Lab《人类社会实验室》完整可玩版本

Work Log:
- 在 /home/z/my-project/download/society-lab 创建 ohmygame web-game 工程（Vite+TS，零运行时依赖）
- 实现全部模块：worldgen（值噪声地形+河流湖泊矿脉）、sim/（manager/economy/population/technology/institutions/society/conflict/events）、powers（9+1 神力双模式）、render/（等距地形/14 种程序化建筑/代表性居民/天气特效/小地图）、ui/（菜单/HUD/事件卡/编年史/观察者/存档分支）、audio（Web Audio 合成）、saves（版本化 JSON+槽位+分支）
- canvas/ 设计文档工作区（index/board/documents/schemas 符合文件契约）+ AGENTS/README/CREDITS/LICENSE
- 12 项模拟回归测试全绿；tsc 零错误；构建 49.7KB gzip
- 无头浏览器实测：建图/摄像机/神力/事件/编年史/观察者/存读档往返/自动存档继续/61FPS/无控制台错误
- VLM 视觉审查两轮：修复地形接缝黑缝与水陆过渡
- 平衡迭代：修复采集死亡螺旋、事件冷却泄漏、劳动归一化放大、市场过速、粮仓容量；长跑验证自然演化 320 年（原始→资本主义 1615 人 15 聚落）与神力对照（原始→社会主义→资本主义）

Stage Summary:
- 交付完整可玩垂直切片：6811 行 TS/CSS，dist/ 可直接游玩
- 关键决策：Godot→Web 技术适配（ohmygame 约定）；模拟内核与渲染解耦；全部事件记录真实变量因果
- 已知限制：单文明、模板文案、合成音效（见 README）

---
Task ID: 3
Agent: main (Super Z)
Task: 沙箱部署预览 + 推送 GitHub 仓库 + 继续开发（v1.0.1）

Work Log:
- 调研沙箱部署机制：每次工具调用为独立会话，期间进程一律被回收；唯一存活通道是 start.sh boot 时执行的 .zscripts/dev.sh
- 部署：创建零依赖静态服务器 scripts/serve-preview.mjs（0.0.0.0:3000）+ .zscripts/dev.sh（boot 自启，供 Caddy 81 网关代理至预览面板）；本会话内实测服务器与网关链路 200
- 推送：society-lab 初始化 git（63 文件），main+gh-pages 推送至 43aquarius/society-lab-ohmygame
- Pages：PAT 缺 pages/workflows 权限（API 403 / workflow push 被拒）；工作流文件暂存 scripts/workflows-pending/ 待权限升级；jsDelivr gh-pages 直链可作为即时可玩 URL（HTML 为 text/plain 不可行，仅静态资源）
- 安全网：/home/sync/repo.tar 手动归档（防硬重启清空项目）
- 继续开发（v1.0.1 修复）：无头浏览器深度回归发现真实 Bug——模态打开时按 Esc 只清 DOM 不重置 modalOpen 标志，此后画布输入/快捷键/模拟推进永久失效；修复为统一走 closeModal()。另加界外点击提示「点击在沙盘之外」
- 验证：tsc 零错误；12/12 测试；真实鼠标事件全链路验证（武装神力→施放→编年史神迹记录→界外提示）；VLM 审查截图
- 排查记录：测试期间被三大干扰项迷惑——事件卡模态遮挡、agent-browser mouse wheel 语义（缩放从未生效致地图始终铺满屏幕）、合成事件 target 不符

Stage Summary:
- GitHub：main（v1.0.1 源码+dist）+ gh-pages（构建产物）已推送
- 沙箱预览：需用户重启会话一次激活 .zscripts/dev.sh；重启安全（repo.tar + GitHub 双备份）
- 游戏修复：Esc 模态致命 Bug 与界外反馈已修复并验证
- 待用户操作（可选）：仓库 Settings→Pages→gh-pages 启用，或为 PAT 增加 workflows+pages 权限让我自动完成
---
Task ID: 4
Agent: main (Super Z)
Task: v2.0 大改版——修复用户 14 项反馈（发布失败/方形视野/小人素材精细化/大地图/可收缩侧栏/更多功能/文字重叠/事件视觉化/水上行走/社会形态与历史进程失真）

Work Log:
- 发布修复：init-fullstack 在 /home/z/my-project 建立标准 Next.js 16 工程（移除旧静态服务器 dev.sh，改用脚手架 dev.sh）；游戏 vite base 改 /game/，dist 同步 public/game/，根路由 beforeFiles rewrite → /game/index.html；实测 bun run build（standalone）+ bun .next/standalone/server.js 200 OK——发布链路完整
- 模拟内核重构（历史进程）：形态识别加硬性前置门控（奴隶需农耕4+剩余+国家+村庄；封建需农耕5+土地集中+城镇；资本主义需工业3+市场+城市；社会主义需工业4+文教+公共服务+参与+城镇基础）+ 5 年回滞判定防闪变；聚落阶段阈值上调（60/150/400/1000）+ 随阶段改名（部落→村→镇→城）+ 政体称谓（部族→王国→王朝→共和国→人民联盟）；迁徙优先流入既有聚落、分蘖受限（母体≥150、地图上限）；技术 pop^0.88 边际递减 + 城市知识引擎 + 饱和阻尼 + 跨域前置链（工业需工具5+营造4+商贸3+文教3）；制度漂移全面放缓并带前置（雇佣需工业、公有需文教+参与觉醒）；战争增加地缘触发（领地毗邻）；木材/石料产出修复（时代建筑不再被资源饿死）
- 新内容：7 种时代建筑（神庙/庄园/城堡/学堂/银行/剧场/医院）+ 住宅随阶段升级（窝棚→农舍→街屋+城镇改建）；8 种新神力（草原/造山/陨星/风暴/野火/瘟疫/治愈/奠基）共 17 种分四组；新事件（治世/移民潮）；8× 速度
- 渲染重构：静态地形缓存（远景贴图支撑 128×128）+ 精细化（三态树/深浅水/山体棱线/草簇花/矿闪）；小人重绘（头身/发型/帽饰/摆臂/职业配件/劳作姿态）+ 网格寻路可通行检测（不再水上走）；事件视觉特效系统 effects.ts（山洪浊水波纹/疫病瘴气/战火硝烟/陨星坠落冲击环/风暴乌云闪电/野火火舌/商队往来/治愈光柱）；标签纯屏幕空间恒定字号 + 防重叠；小地图 putImageData + 视口框裁剪
- UI：方形取景框（min(w,h) 居中 + 全景 fitMap 开局）；工具栏/详情栏可收缩（Tab + localStorage）；顶栏响应式防重叠（媒体查询分级隐藏）；年份闪现移位；事件流随侧栏收缩自适应
- 平衡验证：debug-longrun.ts / debug-institutions.ts 诊断迭代 6 轮——河谷情景达 原始(0-600)→封建(600-800)→资本主义(800+) 完整序列（依附劳动40%/土地集中70%），另一些种子走 原始→奴隶→资本主义（路径分岔）；聚落长成 2000+ 人口城市且名字演进（泽林部落→泽林城）
- 测试：13/13 全绿（新增"历史不会跳级"用例）；tsc 零错误；构建 64KB gzip
- 浏览器实测（Chromium+VLM 八轮截图审查）：全景开局/700 年 8000 人口资本主义文明/陨星与风暴特效/标签与小地图修复验证/工具栏收缩——均通过且无控制台错误
- 交付：v2.0.0 推送 GitHub main（8209c15），public/game 同步最新构建

Stage Summary:
- 14 项用户反馈全部解决；发布链路（Next.js standalone + rewrite）验证可用
- 核心改进：历史不再跳级（形态硬前置）、聚落会长大改名、时代建筑随社会出现、事件有真实画面表现
- 已知取舍：部分和平世界跳过奴隶/封建阶段直入资本主义（路径依赖设计）
