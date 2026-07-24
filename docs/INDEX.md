# DougoOS 文档索引

本目录是 DougoOS 架构、交付计划和发布证据的入口。代码与文档发生冲突时，先更新对应设计文档，再修改实现。

## 产品与架构

- [架构](./ARCHITECTURE.md)：进程边界、Core、Storage、ACP、Provider、Web、Desktop 与 Cloud。
- [AI 开发规范](./AI_DEV_SPEC.md)：类型、错误、安全、测试与禁止降级规则。
- [UI 参考合同](./UI_REFERENCE_CONTRACT.md)：原型真源、视觉案例、阈值和生产隔离边界。
- [P0/P1 实施计划](../plan.md)：MVP 范围、依赖、任务状态和 Definition of Done。

## ADR

- [0001 Turn Event Journal](./adr/0001-turn-event-journal.md)
- [0002 Fetch SSE Auth Replay](./adr/0002-fetch-sse-auth-replay.md)
- [0003 Session Interceptor Hooks](./adr/0003-session-interceptor-hooks.md)

## 交付与发布

- [任务体系](./plan/README.md)：后续任务的 develop/verify/review 流程。
- [Release Baseline 分析](./plan/analysis/p1-release-baseline.md)
- [视觉阻塞归因](./plan/analysis/ui-regression-release-blocker.md)
- [视觉阻塞修复任务](./plan/tasks/ui-regression-001.md)
- [Release Baseline 任务](./plan/tasks/release-baseline-001.md)
- [Backlog](./plan/backlog.md)：已接受的非阻塞事项。
- [P0/P1 验证报告](./VALIDATION_REPORT.md)
- [P0/P1 Release Manifest](../release/p0-p1-mvp.json)：版本、发布输入 hash、锁定工具链与测试摘要。
