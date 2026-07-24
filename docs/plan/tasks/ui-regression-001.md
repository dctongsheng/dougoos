---
id: ui-regression-001
scope: web-visual
status: in-progress
depends-on: []
---

# Restore Fixture/Real Visual Boundary

## objective

恢复原型 fixture 与真实 Provider 数据的边界，使 P0/P1 当前源码重新满足已提交的像素级视觉合同，同时保持 OpenClaw/OpenCode 真实 Provider 支持和 raw reasoning 隐私边界。

## context

- `docs/INDEX.md`
- `docs/plan/analysis/ui-regression-release-blocker.md`
- `docs/UI_REFERENCE_CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_DEV_SPEC.md`
- `prototypes/agentos/README.md`

## path

- `apps/web/src/core/core-data-source.ts`
- `apps/web/src/core/core-data-source.test.ts`
- `apps/web/src/saas/AgentPage.tsx`
- `apps/web/src/saas/fixtures.ts`
- `apps/web/src/saas/fixtures.test.ts`
- `apps/web/src/saas/types.ts`
- `docs/UI_REFERENCE_CONTRACT.md`
- `docs/plan/`
- `tests/e2e/`
- `tests/visual/production.spec.ts`
- `tests/visual/visual-manifest.ts`

## requirements

1. fixture/demo/reference 数据保持原型规定的 6 个 Agent；不得从真实 Provider registry、DTO 或 discovery 中删除 OpenClaw/OpenCode。
2. real Core mode 根据实际 provider snapshot 增补可用 Provider；不得用 fixture 列表覆盖真实能力。
3. fixture 模式可以渲染原型安全 canned `think` 文案，以覆盖七类消息视觉合同。
4. real mode 的 raw provider `think` 不得进入 DOM、日志或持久化 UI 配置；必须有自动化测试。
5. 更新 visual case 名称或说明，使“安全 fixture 七类呈现”和“real reasoning 不可见”不再混淆。
6. 不修改 `tests/visual/reference/`、视觉阈值、原型文件或 production 安全边界。
7. 不使用 CSS 裁切、固定页面高度或缩小布局来掩盖 fixture 数据错误。

## verification

```bash
pnpm --filter @dougoos/web test
pnpm --filter @dougoos/web typecheck
pnpm test:e2e
pnpm test:visual
pnpm check
pnpm smoke:build
git diff --exit-code HEAD -- tests/visual/reference prototypes/agentos
```

独立 reviewer 必须确认：

- 视觉 9/9 通过且 156 个 reference 输入未变化；
- fixture 仍为 6 Agent；
- real provider snapshot 仍能呈现 OpenClaw/OpenCode；
- fixture canned `think` 可见，但 real raw `think` 不进入 DOM；
- 没有阈值放宽、reference 刷新或 CSS 裁切。
