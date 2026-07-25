# DougoOS 0.2.0 Early Access 分发分析

## 决策

0.2.0 面向 macOS 13+ Apple Silicon，前期不购买 Apple Developer Program。分发物是
ad-hoc signed、未经 Apple 公证的 DMG。该签名只维持应用 bundle 的结构完整性，不能描述为
“Apple 签名”或“已公证”。

用户首次启动可能被 Gatekeeper 拦截，必须通过“系统设置 → 隐私与安全性 → 仍要打开”明确
授权。产品和文档不得要求关闭 Gatekeeper、执行 `xattr`，或绕过 quarantine。

## 更新边界

Electron 主进程可以安全地检查、下载和验证新版 DMG，但未签名应用不能使用
`autoUpdater` 完成静默自更新。因此 Early Access 只负责：

1. 从固定 HTTPS 清单检查更高语义版本；
2. 将 DMG 下载到应用缓存目录；
3. 校验文件大小、SHA-256 与 Ed25519 发布签名；
4. 在没有活动任务或待审批操作时打开经验证的 DMG；
5. 引导用户退出 DougoOS 并拖动替换旧版本。

它不会覆盖运行中的 `.app`、提升权限、修改 `/Applications` 或移除 quarantine。

## 信任模型

- 清单、DMG 与签名只接受 `downloads.dougoos.com` 的 Early Access 路径。
- 发布私钥只进入 GitHub Secret `RELEASE_ED25519_PRIVATE_KEY`。
- 公钥同时内置于 Desktop 和 `release/early-access-public-key.pem`。
- 签名内容为 DMG 文件字节的 SHA-256 摘要，算法为 Ed25519。
- 任意大小、摘要、签名、域名、channel 或版本检查失败都会删除缓存文件并禁止打开。

## 发布顺序

`v0.2.0` tag 触发 macOS Apple Silicon runner。流水线完成无凭据门禁、DMG 打包和 packaged
smoke 后，上传版本化不可变对象，再从公网域名下载并重新校验。只有回读成功，才提升
`latest.json`、固定 `DougoOS.dmg` 和对应签名别名。

版本化路径使用长期 immutable cache；固定别名和清单使用 `no-cache`。这保证失败发布不会
把客户端指向尚未验证或不完整的制品。

## 未来迁移

购买 Apple Developer Program 后，0.3.0 增加 Developer ID 签名、公证和 staple。Early
Access 客户端仍只下载并打开一次 0.3.0 DMG，由用户手动替换。从 0.3.0 起再切换
`electron-updater`，之后用户可直接“重启并更新”。
