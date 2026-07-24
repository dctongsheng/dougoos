# @dougoos/core

本地 Hono 服务和唯一组合根。Core 只监听 `127.0.0.1` 的随机端口，完成 SQLite
迁移、恢复与 Registry 初始化后才进入 ready；所有 `/api/*` 路由默认验证 256-bit
bearer、Host 和 Origin。生产组合根使用 `AcpCoreRegistry` 连接真实 Provider；
显式测试环境仍可注入确定性的 Fake Registry。

运行时依赖只增加：

- `hono`：REST 路由、中间件和结构化响应；
- `@hono/node-server`：把同一 Hono fetch app 绑定到 Node loopback TCP。

两者职责不同；shared 继续提供唯一 zod 合同，因此没有增加第二套 validator。

## 单独调试

```bash
pnpm --filter @dougoos/core debug
```

该命令会在临时目录启动真实 Core、通过 bearer 请求 ready，然后关闭 HTTP/SQLite
并清理临时数据。输出不会包含 token 或数据库路径。

对本机已认证 Provider 执行一次临时、自动清理的真实 headless 对话：

```bash
pnpm --filter @dougoos/core run smoke:providers all
pnpm --filter @dougoos/core run smoke:providers codex
pnpm --filter @dougoos/core run smoke:providers claude-code
```

结果只包含 Provider ID、锁定版本、协议、终态、stopReason 和消息种类，不输出
prompt、回复、cwd、token 或环境变量值。Provider stderr 每个进程最多采集 64 KiB，
经凭证、路径、邮箱和控制字符脱敏后，写入 Desktop userData 下的
`logs/agent-stderr.log`；日志以 `5 × 20 MiB` 滚动并使用 `0600` 文件权限。

## 包级验证

```bash
pnpm --filter @dougoos/core typecheck
pnpm --filter @dougoos/core test
pnpm --filter @dougoos/core lint
pnpm --filter @dougoos/core build
```
