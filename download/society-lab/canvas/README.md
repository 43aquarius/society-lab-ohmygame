# Canvas Workspace · Society Lab

设计文档工作区（OhMyGame Design Canvas 文件契约）。

- `index.json` 列出看板与文档；主文档为 `society-lab-design`。
- `boards/society-lab-main.json` 含 4 个节点：设计文档、模型假设、视觉规范、核心循环速览。
- `documents/` 存放 Markdown 正文，由 board 节点通过 `documentId` 引用。
- `editor/` 存放节点坐标与视口（布局数据，可自由调整）。
- `assets.json` 登记画布资产清单（本项目运行时资产全部程序化生成，当前为空）。
- `jobs.json` 记录生成任务历史（数组）。
- 修改契约前先读 `AGENTS.md` 与 `schemas/`。
