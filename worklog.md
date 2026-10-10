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
---
Task ID: 5
Agent: main (Super Z)
Task: v3.0「生动世界」大改版——用户反馈：素材仍粗糙、小人只是装饰（会刷新消失）、无生老病死、不考虑时代、建筑平地起、事件只有文字、比例错误（人≈建筑、建筑≈树）、无地形起伏、时间飞快

Work Log:
- 基础层：Tile.elevation 扩至 0..6 级（ELEV_H=10）；worldgen 用分位数阶梯+山脊噪声+高原半滑（削峰填坑，悬崖只在山麓）；河流下切海拔（山间河谷逐级下降）；ELEV_H 提升后所有"站在地面"的对象统一走 surfacePoint/elevAt（修复建筑陷入地下的老 bug）；uplift 神力适配新海拔；天气类神力可作用于水域（修复干旱失效）
- 居民智能体系统（agents.ts 全新 ~800 行）：持久实体不再随机刷新；生（婴儿在住处出生）→ 长（童子追逐嬉戏）→ 老（佝偻社杖步履蹒跚）→ 病（疫病时发绿咳嗽）→ 死（倒地渐隐、众人驻足、坟墓落墓园）；昼夜作息（夜回屋睡觉/卫士火把巡夜、晨昏围炉社交、白天按职业上工：农人锄田/采集入林/匠人打铁/商贩摆摊/祭司上香/学士读书/孩童玩耍）；职业随聚落发展转岗（15%/年）；移民潮真实走人（限流 30）；点击居民可查看名字/年龄/职业/健康/在做什么
- 比例修正：建筑放大 1.6×（农舍 42px、街屋 58px、城堡近 90px，人 13px）；树木 22-36px 高大风摆；全部建筑坐石砌台基（坡地自动加深）+ 半木结构/砖缝/瓦垄/烟囱/店招/匾额等细节
- 事件画面彻底重做：战争=列旗行军→两军厮杀（刃光/尘土/火箭/倒地者/焚屋）→携俘而归（EventRecord.aux 携带交战双方）；疫病=黄绿毒雾+盘旋乌鸦+病倒居民（配合 agents 染病）；山洪=黄褐浊水漫田+波涛+溺水者挣扎+漂流残骸；起义=14 人人群+火把+双街垒+浓烟；冲突事件带 settlementId；陨星/野火留下永久 crater/scorch 印记；饥荒田地枯黄（drawField wither）
- 昼夜与环境：26s 视觉日循环（与年历解耦、暂停冻结）+ 夜幕暗层 + 窗火/篝火 lighter 合成层 + 时段角标；云影漂移；偶发雁阵；时代衣着色板
- 持久印记系统（decals.ts + WorldState.decals，随存档）：坟墓（4 档风化批量绘制）/陨坑/焦痕/废墟，上限 260；saves v3 序列化
- 时间放缓：yearMs1x 2200→6000ms；新增 16× 挡（按钮+快捷键 5）
- 性能：中高缩放直接贴 0.8× 高清地形缓存（首次构建一次成本）+ 近景水波动画层；远景小人按颜色分组 Path2D 批量绘制（几百人≈10 次 fill）；坟墓视口裁剪+批量；小人 LOD 三档（点/简形/精细，精细限额 300）；无头软渲染 FPS 40→54（真机 GPU 更高）
- Bug 修复：夜间入睡状态机（wait=-2 到家即睡）；干早刷不上水域；SVG 图标非法弧线（rain/storm）；step() 桥同步居民；职业不转岗；步挡策略（下坡任意、上坡≤2 级）
- 验证：tsc 零错误；13/13 测试全绿；长跑 1200 年完整演化（原始→奴隶→资本主义、聚落→城市 4158 人）；Playwright 无头八场景截图 + VLM 审查（山体悬崖/雪顶 ✓、比例 ✓、地基 ✓、夜窗灯火 ✓、疫病 9/10、暴动 8-9/10、山洪 8/10、夜眠 59/71、345 年 260 座坟、无控制台错误）
- 部署：新构建同步 public/game + .next/standalone/public/game；standalone 服务器重启（修 stale 文件缓存）；scripts/sync-game.sh 一键同步+重启

Stage Summary:
- v3.0 六大诉求全部落地：素材精细化/比例修正、小人真实化（生老病死+作息+职业+时代）、建筑特色（台基+细节+时代建筑）、事件真实画面（战争/疫病/山洪/起义）、地形起伏（悬崖河谷雪线）、时间放缓
- 已知取舍：大聚落（>150 人）画面为象征性密度（上限 110 小人/聚落）；远景小人绘制在建筑之上（y 排序让位性能）

---
Task ID: 6
Agent: main (Super Z)
Task: v4.0「万邦时代」大改版——用户第三轮反馈：①小地图视口与主画面不一致 ②每个文明应有各自的社会形态（马义历史唯物主义判定：生产资料所有制为核心+阶级/分配/上层建筑）③建筑太密不符合现实 ④建筑环境仍需精细化 ⑤地图太小要做 Minecraft 式不断加载的巨大地图 ⑥未表现人类历史进程

Work Log:
- 架构重构：WorldState 移除单文明 civ/tiles 全量数组，改为 civs: Civilization[]（每文明独立 vars/tech/history/met）+ chunks: Map（分块流式地形）+ weather: Map（稀疏）；Settlement 增 civId/roads(Set)
- 分块世界引擎（worldgen.ts 全新）：32×32 chunk 按需确定性生成（纯噪声场，无顺序 RNG）；大陆/山脊/湿度噪声+全域分位数校准；脊线河流场+湖泊下切；气候带（纬度温度：沙漠/苔原/丛林/针叶林/温带，绿洲）；tileAt/peekTile/markDirty API；LRU 缓存 720 块，modified 块永不淘汰
- 多文明模拟：society.ts 重写为马克思主义判定书（四要素：所有制/阶级关系/分配关系/上层建筑，所有制权重第一）；manager 按文明独立推进（技术/经济/制度/形态/冲突/事件）；文明接触检测→贸易+技术扩散+跨文明战争；远距分蘖孕育新文明（inheritTech 0.7）；文明生死与编年史 civId
- 历史唯物主义修正：革命方向受生产力约束（资产阶级革命需工业+市场，否则只能激进方向）；原始社会革命改为氏族财产重分配；私有化的农业起源（牲畜/农具先于市场）；市场普遍化以世纪计（trade-boom 事件 +0.025/14年，贸易路线次线性）；奴隶制三重起源（战俘经济 warMemory 0.985 半衰期/债务奴役/制度惯性）
- 真实聚落形态：建筑间距≥2 曼哈顿、农田外围环带（farmRingInner 3 + 成片优先）、道路系统（Bresenham addRoad + WeakMap 几何缓存 + 视口/聚落双重裁剪）；housing 调整（农舍13/街屋28/窝棚10）；farmPerFamily 5→13
- 渲染重构：TerrainCache→ChunkTerrainCache（16×16 渲染块三档 0.22/0.45/0.8 分辨率 LRU + 每帧 3 块构建预算）；zoom≥1.6 逐格直绘锐利近景；**静态世界层缓存**（道路/印记/边界/建筑层：相机静止时零重绘，0.85× 采样；修复关键 bug——blit 必须在世界变换 restore 后的屏幕空间）；天气改稀疏表直遍；沙漠/苔原/丛林新植被渲染（沙丘波纹/仙人掌/雪斑/矮灌/深绿密冠）
- 小地图重做：局部窗口 224×224 格（相机移动>5 格或 1.2s 重绘）+ 未探索迷雾（peekTile 不生成）+ 文明领土色 + 聚落文明色点 + **视口多边形**（屏幕四角→网格→小地图坐标，修复视口不一致 bug）+ 点击跳转（minimapClick → 相机跳转）
- UI：顶栏世界纪元徽章+万邦计数按钮；万邦面板（文明卡片+马义判定书四要素+技术概览+点击聚焦观察）；观察者面板文明切换；编年史文明筛选+色点；聚落面板显示所属文明与政体
- 存档 v4：分块 hex 打包（修复 fromCharCode(124)='|' 分隔符截断 bug）；v3 旧档自动迁移（全量 tiles→显式 modified chunks，单文明→civs[0]）
- 平衡长跑（6 轮迭代）：技术曲线 pop^0.68×0.02 + cost 指数 2.35（千年技术史）；战争条件放宽（单聚落文明可与异邦交战）；依附劳动三重来源；最终验证——1500 年长跑：漠野文明走通 原始→封建(y496)→资本主义(y558)；苍桑山 原始→奴隶(y868)→资本主义；9 文明并立有生有死；纪元石器→青铜→铁器→中古→工业→电气
- 性能优化（探针分段定位）：建筑循环聚落级粗裁剪（7387→视口内 467）；道路几何缓存+视口裁剪；静态层缓存后 FPS 15→59（zoom1.1 软渲染）/49（zoom0.6）；无控制台错误
- 浏览器实测（agent-browser + VLM 5 轮）：3 文明创建✓、1067 年 7 文明并存（3 资本主义+1 奴隶+3 原始）✓、万邦面板判定书✓、小地图视口框一致✓、小地图点击跳转✓（左上角在世界边缘正确不动）、近景土路/间距/外围农田/小人 VLM 确认✓、FPS 59/49✓
- 测试：16/16 全绿（新增分块确定性/多文明形态并存/v3 迁移/判定书断言）；tsc 零错误；构建 86KB gzip

Stage Summary:
- 六项反馈全部解决：小地图视口多边形修复、多文明马义判定书（判定书可在万邦面板查看）、建筑密度真实化（间距+道路+外围农田）、气候带精细化、256/512/1024 分块流式巨大地图、历史进程完整（形态序列可走通 原始→奴隶→封建→资本主义 + 世界纪元 + 文明互动）
- 关键决策：地形只存 modified 块（存档小）；静态层缓存（相机静止零重绘）；近景 zoom≥1.6 直绘保排序正确性
- 已知取舍：社会主义主要作为玩家引导的终局（历史本身罕见）；无头软渲染 zoom2.0 约 25 FPS（真机 GPU 数倍于此）
