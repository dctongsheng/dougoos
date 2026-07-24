# P1 Release Baseline 分析

## 目标

把已完成的 P0/P1 MVP 从“当前工作目录验证通过”提升为“有 Git 回退点、clean checkout 可复现、CI 可持续验证”的短发布基线。本任务不增加产品功能。

## 任务拆分时的起始审计

| 项目 | 当前状态 | 处理 |
|---|---|---|
| Git | 仓库根已存在；`origin/main` 位于 `0fd4b38`，任务体系种子提交为 `38bfa95`；无 release tag | 不重复初始化；在现有提交上建立首个 release baseline commit |
| 本地制品 | `.artifacts/` 约 1.4GB | 保持忽略并以自动检查证明未被跟踪 |
| 视觉输出 | `tests/visual/production/` 约 75MB；`actual/diff` 共 326 个文件 | 作为可再生输出忽略；只保留 reference 基线和轻量 release manifest |
| Git payload | 任务种子提交有 580 个跟踪项、约 42.2 MiB；156 张 reference 截图已跟踪 | reference 是 clean-checkout 视觉门禁输入，继续保留 |
| 文档 | 任务拆分前无 `docs/INDEX.md` 和 `docs/plan/`；根 `plan.md` 把本机收口与 release baseline 混为一体 | 任务种子提交建立索引和后续任务体系；实现提交单独记录 release baseline 状态 |
| 项目元数据 | 根包版本为 `0.0.0`，缺少项目描述 | 设置 P0/P1 MVP 版本与准确描述 |
| README | 视觉案例数字仍为旧值 140/15 | 从保存的 run manifest 和本轮验证结果更新 |
| CI | 无 clean-checkout workflow | 新增 check、E2E、视觉回归、build smoke |
| 发布证据 | 无轻量、可校验的 release manifest | 记录版本、源码 SHA-256、运行时和测试摘要 |

## 模块拆分

| 模块 | 输入 | 输出 | 验证 |
|---|---|---|---|
| Docs baseline | 当前架构、根计划、验证报告 | `docs/INDEX.md`、任务和 review 体系 | 所有文档可从索引到达 |
| Repository hygiene | `.gitignore`、Git index、生成物目录 | 明确的 tracked/ignored 边界 | `git check-ignore` 与 `git ls-files` |
| Clean-checkout CI | package scripts、Playwright、reference baselines | GitHub Actions workflow | workflow 命令与本地 clean checkout 一致 |
| Release manifest | Git 跟踪输入、package 版本、测试证据 | 可重复计算的 JSON manifest | `release:manifest:check` |
| Release review | 任务合同、实现 diff、验证证据 | blocking/non-blocking findings 与结论 | 独立验证者签出记录 |
| Git baseline | 通过审查的 commit | `p0-p1-mvp` tag | clean checkout 从 tag 复现离线门禁 |

## 集成关系

1. `package.json` scripts 被 CI workflow 和本地 clean-checkout 共同调用；根 `check` 在
   workspace contract 后先按拓扑构建各包 `dist`，再运行全部 typecheck 和 package tests，
   确保首次 clean checkout 不依赖旧构建产物。
2. `tests/visual/reference/` 是视觉回归输入；`tests/visual/production/actual` 与 `diff` 只是可再生输出。
3. release manifest 对 Git 可发布输入计算 SHA-256；manifest 自身不参与该 hash，避免自引用。
4. `docs/plan/tasks/release-baseline-001.md` 定义范围；独立 reviewer 将结论写入 `docs/plan/reviews/`。
5. 只有 review 为 `pass` 且 clean-checkout 门禁通过，release commit 才能标记 `p0-p1-mvp`。

## 明确不做

- 不增加 P2+ 产品能力。
- 不提交 `.artifacts/`、视觉 actual/diff、报告 HTML、数据库或 Provider 诊断。
- 不在 CI 调用真实 Provider、Cloudflare 部署或需要账户凭证的流程。
- 不自动推送 commit/tag；远端发布由用户单独授权。
