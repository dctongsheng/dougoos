# Early Access 0.2.0 Release Review 02

## 结论

**overall: pass**

**blocking findings: none**

本次 Tag 前 review 由独立只读审查代理完成。候选提交
`92c86ad33a1779c601a5fd36d5db1431018f3037` 的代码、离线门禁、DMG 和发布基础设施均已
通过审查，明确授权在完成下述管理性收尾后创建 annotated `v0.2.0` Tag。

授权仅允许提交本 review 与 `release/v0.2.0.json`。任何额外实现代码变更都会使本授权
失效，并要求重新 review。

## 通过证据

| Gate | 结果 |
|---|---|
| candidate identity | `HEAD` 与 `origin/main` 均为 `92c86ad33a1779c601a5fd36d5db1431018f3037`；工作树干净，`git diff --check` 通过 |
| clean checkout | GitHub Actions `30187152636` 成功；frozen install、manifest、workspace check、E2E、171 个生产视觉场景和 build smoke 全部通过 |
| targeted visual | GitHub Actions `30187157323` 成功；SSIM `0.9951706436`，errors 为空 |
| canonical/full visual | GitHub Actions `30187204422` attempt 2 成功；两轮 canonical reference 稳定，完整生产视觉回归通过 |
| packaged smoke | 当前候选 SHA 的 `pnpm smoke:package` 通过；packaged Electron 启动和持久化 smoke 均通过 |
| package verification | DougoOS 0.2.0、macOS arm64、macOS 13+、ad-hoc、未公证；DMG 为 297,232,647 bytes |
| package SHA-256 | `3d2a24da23c3571e00d2b74985892c5a83157c5a199d16370df09cde78823d81` |
| repository | `dctongsheng/dougoos` 为公开仓库；AGPL-3.0-only 与第三方许可材料完整 |
| R2 | `dougoos-releases` bucket 存在于账户 `fe18867b4f120cca360d59ad1fdfc8ba` |
| GitHub release config | 四个所需 Secret 名称均存在；`early-access` environment 已创建且无保护规则 |
| security boundary | 全历史 secrets audit、更新器 trust/domain/channel/version/size/SHA-256/Ed25519 fail-closed、不可变上传与 promotion 顺序保持通过 |
| repository hygiene | `.artifacts/` 仍被忽略；visual actual/diff 和本地 DMG 均未被跟踪 |

## Non-blocking findings

1. GitHub Actions 的 `actions/*@v4` 出现 Node runtime 弃用警告；后续应升级或固定到仍受
   维护的完整 commit SHA。
2. 不可变对象发生部分上传后，重跑可能需要人工清理未 promotion 的残留对象；当前行为
   保持 fail-closed。
3. 官网登录、文档和在线体验等演示或空操作应明确标注，避免被理解为已上线功能。
4. Tag 前的 404 可能被 Cloudflare 缓存；发布后必须精确验证或清除版本化 URL、固定别名
   和 `latest.json` 的缓存。

## Tag 授权与限定顺序

1. 提交本 Review 02。
2. 生成并提交 `release/v0.2.0.json`。
3. 在最终管理提交上创建本地 annotated `v0.2.0` Tag，并验证 manifest 与该 Tag 完全
   一致。
4. 推送 `main`，等待该精确管理提交的 clean-checkout CI 成功。
5. 只有上述条件满足后才推送 `v0.2.0` Tag。

## Review 03 义务

本 review 只授权 Tag，不批准尚未产生的公网制品或生产官网。Tag 后必须独立验证：

- 版本化 DMG、Ed25519 签名、SHA256SUMS、release manifest 与源码提交一致；
- `latest.json`、固定 DMG 别名、attachment 文件名和缓存头正确；
- 生产官网三个下载入口可触发真实下载，且 `/install` 的 GET/HEAD 返回 `410 Gone`；
- 官网未出现“已签名”“已公证”“一键自动安装”等误导性表述；
- 在干净 Mac 上完成下载、拖入 Applications、“仍要打开”和启动验收。

公网自动化验证完成后任务进入 `awaiting_verification`；只有最后一项人工验收完成后才能
标记 `done`。
