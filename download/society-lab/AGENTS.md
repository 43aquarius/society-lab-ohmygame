# Society Lab · Agent Guide

上帝视角社会演化沙盒。OhMyGame web-game 工程：TypeScript + Vite + Canvas 2D，**零运行时依赖**。

## 运行与检查

Node.js 20+，npm。

```sh
npm install
npm run dev      # http://127.0.0.1:5183
npm test         # 模拟内核回归（tsx --test）
npm run build    # tsc --noEmit && vite build → dist/
```

## 架构红线

- `src/sim/` 模拟内核**禁止** import `src/render/`、`src/ui/`、DOM API；渲染与 UI 只消费状态。
- 所有模拟随机必须走 `WorldState.rng`（可复现）；视觉随机用 `render/iso.ts` 的 `vhash` 或 villagers 内部随机流。
- 所有可调参数集中在 `src/config.ts`，不得散落硬编码。
- 事件文案必须引用真实模拟数据（原因=变量快照，效果=状态回写），禁止编造未发生的因果。

## 模块地图

| 区域 | 文件 |
| --- | --- |
| 数据契约 / RNG | `src/types.ts` |
| 参数中心 | `src/config.ts` |
| 世界生成 | `src/worldgen.ts` |
| 模拟内核 | `src/sim/{manager,economy,population,technology,institutions,society,conflict,events}.ts` |
| 神力 | `src/powers.ts` |
| 存档/分支 | `src/saves.ts` |
| 渲染 | `src/render/{world,terrain,buildings,villagers,iso}.ts` |
| UI | `src/ui/{hud,panels,icons}.ts`, `src/style.css`, `src/main.ts` |
| 音频 | `src/audio.ts`（Web Audio 全合成） |
| 设计文档 | `canvas/`（文件契约见其 README 与 AGENTS.md） |
| 回归测试 | `tests/simulation.test.ts` |

## 玩法测试桥

开发模式下暴露 `window.__OHMYGAME_PLAYTEST__`：

- `snapshot()` → 年份/形态/人口/粮食比/unrest/建筑数/编年史长度/溢出标记
- `setSeed(n)` → 以种子直接开局
- `step(years)` → 同步推进 N 年（返回事件计数）
- `usePower(id, x, y, radius)` → 施放神力
- `serialize()` / `loadSave(json)` → 存档往返

## 编辑规则

- 存档契约 `society-lab-save-v1`（`CFG.saveVersion`）：新增字段必须向后兼容并在 `saves.ts` 处理缺省。
- 建筑修改需同步：`config.ts` 定义表、`render/buildings.ts` 视觉、`economy.ts` 建造 AI 三处。
- 社会模型调整请同步更新 `canvas/documents/society-lab-model.md`（模型假设说明）。
- 提交前：`npx tsc --noEmit` 零错误 + `npm test` 全绿 + `npm run build` 成功。
