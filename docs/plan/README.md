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
pending -> ready -> in-progress -> done
                         |
                         +-> blocked
```

- 开发者只实现任务 `objective` 和 `path` 中的内容。
- 独立验证者根据 `context`、源码与验证命令出具 review。
- blocking finding 必须修复并重新验证。
- non-blocking finding 进入 [backlog.md](./backlog.md)。
- `done` 表示任务已通过独立验证，并已进入目标分支。

## 当前任务

| ID | 目标 | 状态 |
|---|---|---|
| [`release-baseline-001`](./tasks/release-baseline-001.md) | 建立 P0/P1 可复现、可回退的发布基线 | in-progress |

## Release Baseline 门禁

发布标签只能指向同时满足以下条件的提交：

1. `.artifacts/`、visual `actual/diff` 与其他本地生成物未被跟踪。
2. release manifest 能在 clean checkout 中重新计算并通过校验。
3. `pnpm check`、`pnpm test:e2e`、`pnpm test:visual`、`pnpm smoke:build` 通过。
4. clean-checkout CI 覆盖相同离线门禁。
5. 独立 release review 结论为 `pass`，且没有 blocking finding。
