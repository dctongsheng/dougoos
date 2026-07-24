---
id: release-baseline-001
scope: release
status: in-progress
depends-on: [ui-regression-001]
---

# P1 Release Baseline

## objective

建立 P0/P1 MVP 的首个可复现、可回退 release baseline。修正文档和项目元数据；加固忽略规则；增加 clean-checkout CI；生成可验证的轻量 release manifest；为独立 release review 和 `p0-p1-mvp` tag 提供完整证据。

## context

- `docs/INDEX.md`
- `docs/plan/analysis/p1-release-baseline.md`
- `plan.md`
- `README.md`
- `docs/VALIDATION_REPORT.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_DEV_SPEC.md`
- `docs/UI_REFERENCE_CONTRACT.md`

## path

- `.gitignore`
- `.github/workflows/clean-checkout.yml`
- `package.json`
- `README.md`
- `plan.md`
- `docs/INDEX.md`
- `docs/VALIDATION_REPORT.md`
- `docs/plan/`
- `release/`
- `tests/e2e/saas-ui.spec.ts`
- `tooling/release-manifest.mjs`

## requirements

1. 根 `plan.md` 必须区分已验证的 P0/P1 产品实现与尚待完成的 release baseline，不得用全绿状态掩盖缺失的 Git/CI/manifest/review。
2. 项目描述、版本和 README 数字必须来自当前源码或保存证据；不得沿用旧数字。
3. `.artifacts/`、visual `actual/diff`、Playwright 报告、数据库、日志、Provider 诊断和本地 Wrangler 状态不得进入 Git。
4. 156 个 prototype reference case 所需的 reference screenshots/metadata 必须保留，确保 clean checkout 可运行视觉门禁。
5. CI 必须从 checkout 和 frozen lockfile 安装开始，运行：
   - `pnpm release:manifest:check`
   - `pnpm check`
   - `pnpm test:e2e`
   - `pnpm test:visual`
   - `pnpm smoke:build`
6. CI 不得调用真实 Provider、Cloudflare deploy、桌面签名/公证或其他凭证依赖。
7. release manifest 必须轻量、确定性、可校验，至少记录：
   - schema、release name、项目版本；
   - Git 可发布输入的 SHA-256 与文件数；
   - Node/pnpm/Chromium/关键依赖版本；
   - package tests、E2E、视觉案例和 build smoke 摘要。
8. hash 只覆盖 Git 可发布输入，并排除 manifest 自身；clean checkout 中重新计算必须一致。
9. 实现完成时任务保持 `in-progress`，由独立 review 和最终 clean-checkout 门禁决定是否转为 `done`。
10. 若完整门禁暴露任务开始前已存在且可确定复现的测试合同漂移，可以在本任务内做最小测试修复；不得删除断言或改弱产品合同。审批场景必须分别验证可见的 approval command、折叠态 tool preview，以及展开前不可见、展开后可见的 tool input，禁止再用跨层级文本总数作为合同。
11. `ui-regression-001` 是 clean-checkout 视觉门禁发现的 blocking dependency；在该任务通过独立验证前，本任务不得完成、合并或打 tag。

## verification

```bash
git check-ignore -v .artifacts tests/visual/production/actual tests/visual/production/diff
git ls-files .artifacts tests/visual/production/actual tests/visual/production/diff
pnpm release:manifest:check
pnpm check
pnpm test:e2e
pnpm test:visual
pnpm smoke:build
```

最终还必须从 release candidate 的 clean checkout 使用 frozen lockfile 重现上述离线门禁，并保存独立 review：

```text
docs/plan/reviews/release-baseline-001-01.md
```

Review 记录必须逐条区分 blocking/non-blocking finding，并给出 `pass` 或 `blocked` 结论。
