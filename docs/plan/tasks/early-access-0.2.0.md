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
10. Tag 前独立 review 必须明确 blocking/non-blocking findings；没有 blocking finding 才能
    创建 `v0.2.0` tag。Tag 后另做公网 release review，公网制品、生产入口和人工安装验收
    不能反向阻塞只有 Tag 才能触发的发布流水线。

## pre-tag verification

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
打开阻断。Tag 前 Review 只在这些离线门禁通过、R2/自定义域名/GitHub Secrets 就绪且没有
代码 blocker 时授权创建 `v0.2.0`。

## post-tag verification

Tag 流水线必须从 `downloads.dougoos.com` 回读并校验版本化 DMG，再提升 `latest.json`
和固定别名。公网 release review 复核版本化制品、签名、缓存头、固定下载入口、生产
`/install` 的 `410 Gone` 以及官网文案。

公网与生产入口验证通过后状态改为 `awaiting_verification`。只有在干净 Mac 用户环境完成
“下载 → 拖入 Applications → 隐私与安全性仍要打开 → 启动”后才能标记 `done`。

## completion evidence

等待 Tag 前授权 review、`v0.2.0` 发布、Tag 后公网 review 和干净 Mac 验收后填写。
