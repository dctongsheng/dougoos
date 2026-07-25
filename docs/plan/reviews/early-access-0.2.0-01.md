# Early Access 0.2.0 Release Review 01

## 结论

**overall: blocked**

**code review: pass after fixes**

本次 review 由独立只读审查代理完成。初审发现 4 个代码级 blocking finding；实现者修复后，
同一审查者复核确认全部关闭，没有新增代码级 blocker。发布仍被真实基础设施与手工验收
阻塞，因此本 review 不授权创建 `v0.2.0` Tag。

## 已关闭的 blocking findings

1. **公网签名未验证**
   - 初始问题：发布脚本只从公网回读 DMG 的 size/SHA-256。
   - 修复：promotion 前同时回读 `.sig`，使用 tracked Ed25519 公钥验证公网 DMG 摘要。
2. **版本化 R2 对象可被覆盖**
   - 初始问题：版本化 key 使用无条件 upload。
   - 修复：DMG、签名、`SHA256SUMS` 与 artifact manifest 均使用
     `PutObject + IfNoneMatch: "*"`；同版本对象已存在时发布失败。
3. **校验未绑定实际落盘字节**
   - 初始问题：忽略 `FileHandle.write()` 的 `bytesWritten`，摘要只覆盖网络流。
   - 修复：循环处理短写并拒绝零进度；关闭句柄后重新读取 `.partial`，验证磁盘 size、
     网络摘要、磁盘摘要和 manifest SHA-256，再使用磁盘摘要验签。
4. **活动任务检查与打开 DMG 存在竞态**
   - 初始问题：检查后还有第二个确认框，用户可在等待期间启动任务。
   - 修复：完整安装警告合并到默认“稍后”的 ready 对话框；`openUpdate` 在紧邻
     `shell.openPath()` 前再次检查活动任务和待审批操作。

## 已验证证据

| Gate | 结果 |
|---|---|
| exact runtime | Node 22.23.1、pnpm 11.16.0 |
| `pnpm check` | pass；修复前 353 tests，新增短写测试后最终全量重跑待执行 |
| Desktop targeted | pass；23/23 tests、typecheck、lint、format |
| `pnpm test:e2e` | pass；15/15 |
| `pnpm test:visual` | pass；9/9，171 production scenarios |
| `pnpm smoke:build` | pass；8 compiled ESM entries |
| packaged smoke | pass；darwin-arm64、Electron 43.2.0 |
| persistence smoke | pass；SQLite、Provider 选择、对话目录、项目/会话索引跨重启保持 |
| package verification | pass；DougoOS 0.2.0、`com.dougoos.desktop`、macOS 13、ad-hoc、未公证 |
| local artifact signing | pass；DMG size/SHA-256 与 64-byte Ed25519 signature 一致 |
| historical manifest | pass；`release/p0-p1-mvp.json` 对应 `p0-p1-mvp` Tag |
| repository hygiene | pass；`.artifacts/` 和 visual production actual/diff 被忽略且未跟踪 |

## 当前 blocking findings

这些是发布状态、外部基础设施或手工验收 blocker，不是未关闭的代码缺陷：

1. Cloudflare R2 subscription、`dougoos-releases` bucket 与
   `downloads.dougoos.com` custom domain 尚未在本次 review 中确认可用。
2. GitHub CLI 登录失效；4 个 release Secrets 尚未确认写入仓库。
3. 尚未从公网验证版本化 DMG、`.sig`、`latest.json`、固定别名和缓存头。
4. 生产官网尚未部署本次 CTA/安装说明；生产 `/install` 的 `410 Gone` 尚未验证。
5. 尚未在干净 Mac 用户环境完成
   “下载 → 拖入 Applications → 隐私与安全性仍要打开 → 启动”。
6. `release/v0.2.0.json`、通过状态的 follow-up review 与 `v0.2.0` Tag 尚未创建。
7. 最终 tagged clean checkout 尚未重跑全部离线门禁、package smoke、DMG verify 与公网回读。

## Non-blocking findings

1. 条件 PUT 保证版本化对象不可覆盖，但部分上传后失败会让同 Tag 重跑直接失败；当前需人工
   删除尚未 promotion 的残留对象，未来可增加“已存在且所有字节/metadata 相同则接受”。
2. `latest.json` 在固定别名前提升；alias copy 失败可能造成 updater 已看到新版而官网固定
   下载仍暂时指向旧版。客户端使用版本化 URL，不会下载错误字节。
3. 选择“稍后”后再次检查会重新下载完整 DMG，可在后续版本复用已验证缓存。
4. `minimumMacOS` 已进入严格 manifest，但尚未参与未来版本的客户端兼容性决策。

## Follow-up 条件

外部 blocker 全部关闭后创建 `early-access-0.2.0-02.md`。只有 review 02 结论为 `pass`、
blocking findings 为空，才生成 `release/v0.2.0.json`、创建并推送 `v0.2.0` Tag。
