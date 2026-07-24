# Release Baseline 视觉阻塞归因

## 结论

`release-baseline-001` 首轮 `pnpm test:visual` 为 7/9。两条失败测试展开为 146 条底层 production 诊断，其中 145 条来自同一 fixture 数据漂移，1 条来自 fixture/real `think` 展示合同混淆。问题可以通过小范围产品修复解决，不需要更新 reference 或放宽阈值。

## 根因一：原型 fixture 被真实 Provider 清单扩张

`prototypes/agentos` 的像素级合同固定展示 6 个 Agent。当前 `apps/web/src/saas/fixtures.ts` 把 OpenClaw、OpenCode 一并加入共享 fixture，导致所有 fixture/demo/reference 页面从 6 个 Agent 增长到 8 个：

- Dashboard 多一行卡片，两个 viewport 的 screen height 均增加 166px。
- Settings 多一行 Agent tab 和 visibility，页面增加 134px。
- `agent-config-section` 的高度和 Y 位置各漂移 36px。
- 额外 Sidebar Agent 级联影响 Sessions Manager、Harness、Agent 和 hover 场景。

诊断分组为 20 条 screen-height、5 条 screen-y、6 条 Settings geometry、48 条 pixel-diff 和 66 条 SSIM。它们不是 145 个独立产品缺陷。

真实 Provider 支持没有错。问题是把动态能力清单写进了原型 fixture。正确边界：

```text
prototype fixture (6) ──► demo/reference/visual
provider snapshot      ──► real Core mode 增补已发现 Provider
```

## 根因二：`think` 隐私边界与 probe 名称混淆

真实模式必须保留 raw provider reasoning 事件，但不能把它渲染进 DOM。当前 `AgentPage.tsx` 同时在列表过滤和 `MessageView` 中抑制 `think`，符合真实模式隐私边界。

visual manifest 的 `saas-production-seven-message-types` 使用的是安全固定 fixture，却把合同描述成真实七类消息并要求 `think` 在 DOM，造成唯一一条语义失败。

正确边界：

- fixture 模式可以显示原型自带的安全 canned think 文案，用于验证七类视觉组件。
- real 模式继续不显示 raw provider reasoning，并增加明确的 DOM 不可见测试。

## 禁止的处理

- 不重新生成 reference 接受 8-Agent 漂移。
- 不放宽 SSIM、diff、geometry 或颜色阈值。
- 不用固定高度、裁切、`overflow: hidden` 或缩小卡片掩盖数据错误。
- 不删除 OpenClaw/OpenCode 的真实 Provider 支持。
- 不在真实模式把 raw reasoning 放入 DOM。
- 不手改 `run.json`，不跳过失败 case。
