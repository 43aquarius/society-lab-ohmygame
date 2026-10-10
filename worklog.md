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
