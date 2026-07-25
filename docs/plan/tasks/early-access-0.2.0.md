---
id: early-access-0.2.0
scope: release
status: in-progress
depends-on: [release-baseline-001]
---

# DougoOS 0.2.0 Early Access

## objective

在不购买 Apple Developer Program 的前提下，为 macOS 13+ Apple Silicon 用户交付可审计、
可验证的 DougoOS 0.2.0 DMG，以及受限但安全的客户端内更新体验。

## context

- `docs/plan/analysis/early-access-distribution.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/AI_DEV_SPEC.md`
- `docs/UI_REFERENCE_CONTRACT.md`

## path

- `.github/workflows/`
- `apps/cloud/`
- `apps/desktop/`
- `packages/shared/`
- `release/`
- `tooling/`
- `tests/`
- `README.md`
- `docs/`

## requirements

1. 根项目、Desktop 产品元数据与发布清单版本统一为 `0.2.0`。
2. DMG 使用 DougoOS 名称、Bundle ID、自有图标、macOS 13 minimum target 和 ad-hoc
   bundle signing；不得声称已获 Apple 签名或公证。
3. 官网三个下载按钮使用唯一固定下载 URL，并展示 Apple Silicon、Early Access、未公证
   和四步首次启动说明。
4. `/install` 返回 `410 Gone`，不再提供 shell 安装命令。
5. 更新器只接受受信域名、Early Access channel 和高于当前版本的清单。
6. 下载后校验大小、SHA-256 和 Ed25519 签名；失败时删除文件且不可打开。
7. 活动任务或待审批操作只阻止打开安装包，不阻止后台下载。
8. 发布流水线必须先上传并公网回读不可变制品，最后提升清单和固定别名。
9. clean checkout 必须重现 check、E2E、视觉回归、构建 smoke 与 release manifest 门禁。
10. 独立 review 必须明确 blocking/non-blocking findings；没有 blocking finding 才能标记
    `done` 和创建 `v0.2.0` tag。

## verification

```bash
pnpm release:manifest:check
pnpm check
pnpm test:e2e
pnpm test:visual
pnpm smoke:build
pnpm smoke:package
node tooling/verify-early-access-package.mjs
node tooling/prepare-early-access-release.mjs
```

此外测试正确签名、错误签名、损坏文件、降级版本、错误域名、网络中断，以及活动任务的
打开阻断。最终发布必须从 `downloads.dougoos.com` 回读并校验版本化 DMG。

## completion evidence

等待完整门禁、独立 review、R2 公网回读和 `v0.2.0` tag 后填写。
