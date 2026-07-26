# DougoOS Delivery Plan

`docs/plan/` 管理 P0/P1 基线之后的交付任务。设计合同仍由 [docs/INDEX.md](../INDEX.md) 索引，根目录 [plan.md](../../plan.md) 保留 P0/P1 MVP 的原始范围与完成状态。

## 目录

```text
docs/plan/
├─ README.md
├─ analysis/   # 任务拆分与集成关系
├─ tasks/      # 可独立开发和验证的任务
├─ reviews/    # 独立验证记录
└─ backlog.md  # 已接受的非阻塞 finding
```

## 状态

```text
pending -> ready -> in-progress -> awaiting_verification -> done
                         |
                         +-> blocked
```

- 开发者只实现任务 `objective` 和 `path` 中的内容。
- 独立验证者根据 `context`、源码与验证命令出具 review。
- blocking finding 必须修复并重新验证。
- non-blocking finding 进入 [backlog.md](./backlog.md)。
- `awaiting_verification` 表示实现与自动化门禁已通过，正在等待不能由仓库自动完成的外部验收。
- `done` 表示任务已通过独立验证，并已进入目标分支。

## 当前任务

| ID | 目标 | 状态 |
|---|---|---|
| [`ui-regression-001`](./tasks/ui-regression-001.md) | 恢复 fixture/real 数据边界和像素级视觉合同 | done |
| [`release-baseline-001`](./tasks/release-baseline-001.md) | 建立 P0/P1 可复现、可回退的发布基线 | done |
| [`early-access-0.2.0`](./tasks/early-access-0.2.0.md) | 零付费发布 macOS Apple Silicon Early Access | awaiting_verification |

## Release Baseline 门禁

发布标签只能指向同时满足以下条件的提交：

1. `.artifacts/`、visual `actual/diff` 与其他本地生成物未被跟踪。
2. release manifest 能在 clean checkout 中重新计算并通过校验。
3. `pnpm check`、`pnpm test:e2e`、`pnpm test:visual`、`pnpm smoke:build` 通过。
4. clean-checkout CI 覆盖相同离线门禁。
5. 独立 release review 结论为 `pass`，且没有 blocking finding。

Early Access 发布另需满足：

1. `v0.2.0` manifest 与 tag 对应，历史 `p0-p1-mvp` manifest 只校验其自身 tag。
2. DMG 为 macOS 13+ Apple Silicon、ad-hoc signed、未公证，官网没有误导性表述。
3. 更新包必须通过大小、SHA-256 与 Ed25519 签名校验，且不会自覆盖应用。
4. R2 必须先发布并公网回读不可变制品，最后才能更新 `latest.json` 和固定别名。
5. Tag 前独立 release review 没有 blocking finding，并明确授权创建 Tag。
6. Tag 后必须另做一次公网 release review；公网制品、生产入口和人工安装验收不能作为
   只有 Tag 才能触发的发布流水线的 Tag 前置条件。
