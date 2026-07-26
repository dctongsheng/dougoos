# Early Access 0.2.0 Release Review 03

## 结论

**overall: pass**

**blocking findings: none**

本次 Tag 后公网 review 由独立只读审查代理完成。annotated `v0.2.0` Tag、对应源码、
GitHub Actions 门禁、R2 制品、官网生产部署与公开源码入口均已通过审查。允许将
`early-access-0.2.0` 从 `in-progress` 改为 `awaiting_verification`。

当前仍不能标记 `done`：尚需用户在干净的 macOS 13+ Apple Silicon 环境完成首次安装和
启动验收。

## Release identity

| 项目 | 结果 |
|---|---|
| Tag | annotated `v0.2.0` |
| source commit | `c1ab4f625155b2ceb5d5146892ea98556727aa2b` |
| source manifest | `release/v0.2.0.json` 对该 Tag 校验通过 |
| release workflow | [30188102736](https://github.com/dctongsheng/dougoos/actions/runs/30188102736) — success |
| tagged clean checkout | [30188102737](https://github.com/dctongsheng/dougoos/actions/runs/30188102737) — success |
| Cloudflare production version | `703ad307-ab81-4b3f-8308-35d94a5c1085` |

Release workflow 在同一 Tag 的干净检出中通过 release identity、workspace check、15 个
browser E2E、171 个生产视觉场景、build smoke、packaged smoke、DMG 产品信息校验、
Ed25519 签名、R2 上传、公网回读和 alias promotion。

## Public artifact verification

| 项目 | 结果 |
|---|---|
| versioned DMG | [DougoOS-0.2.0-arm64.dmg](https://downloads.dougoos.com/early-access/macos/arm64/0.2.0/DougoOS-0.2.0-arm64.dmg) — `200` |
| stable download | [DougoOS.dmg](https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg) — `200` |
| size | `304173685` bytes |
| SHA-256 | `4644903c703c26ed9746ad7a1b7bcebdd27c0e7081aac66ab5cef0e5b15748d7` |
| signature | 64-byte Ed25519 signature；tracked public key 独立验证通过 |
| disk image | 公网整包执行 `hdiutil verify`，结果 `VALID` |
| update manifest | [`latest.json`](https://downloads.dougoos.com/early-access/macos/arm64/latest.json) — `200` |
| release metadata | release JSON、`SHA256SUMS` 与 DMG 字节、Tag 和 commit 一致 |

版本化 DMG、签名、`SHA256SUMS` 与 release metadata 使用
`public, max-age=31536000, immutable`。固定 DMG、固定签名与 `latest.json` 使用
`no-cache, no-store, must-revalidate`；固定 DMG 同时返回
`Content-Disposition: attachment; filename="DougoOS-0.2.0-arm64.dmg"`。

## Production website verification

- [dougoos.com](https://dougoos.com/) 返回 `200`，Cloud health 的 GET/HEAD 均返回
  `200` 和 `status: ok`。
- 生产 DOM 中“免费下载”“下载桌面版”“下载 DougoOS”三个 anchor 全部指向唯一固定
  DMG URL。
- 页面展示 `v0.2.0`、Apple Silicon、Early Access、“未经 Apple 公证”和四步首次启动
  说明。
- 生产 bundle 不再包含旧 `v2.0` 或 `curl -fsSL ... | sh` 文案。
- `/install` 的 GET/HEAD 均返回 `410 Gone` 和 `Cache-Control: no-store`。
- 公开 [v0.2.0 源码](https://github.com/dctongsheng/dougoos/tree/v0.2.0) 与
  [AGPL-3.0-only 许可](https://github.com/dctongsheng/dougoos/blob/v0.2.0/LICENSE)
  均返回 `200`。

## Non-blocking findings

1. `actions/*@v4` 出现 Node runtime 弃用警告；后续升级到受维护版本或固定完整 commit
   SHA。
2. immutable 对象在 promotion 前发生部分上传后，同 Tag 重跑可能仍需人工清理残留对象；
   当前发布行为保持 fail-closed。
3. 官网登录、文档和在线体验等 demo/no-op 入口应继续明确标注或在后续版本实现，避免被
   理解为已经上线的业务功能。

以上 finding 已进入 delivery backlog，不影响当前 DMG 下载、校验、安装包打开或客户端
更新边界。

## Manual acceptance boundary

用户需在干净的 macOS 13+ Apple Silicon Mac 上完成：

1. 从官网点击下载并打开 DMG。
2. 将 DougoOS 拖入 Applications。
3. 首次尝试启动并确认 macOS 拦截。
4. 在“系统设置 → 隐私与安全性”中选择“仍要打开”。
5. 确认 DougoOS 名称、图标和版本 `0.2.0` 正确，应用启动且无崩溃。

该验收通过后才能把任务从 `awaiting_verification` 改为 `done`。
