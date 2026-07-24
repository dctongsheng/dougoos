# @dougoos/desktop

DougoOS 的 Electron 薄壳。它注册安全的 `app://dougoos` renderer、在
Electron utility process 中启动 Core、轮换仅保存在内存中的 bearer token，
并在 Core 崩溃后自动恢复。

## 单独调试

```bash
pnpm --filter @dougoos/web build
pnpm --filter @dougoos/desktop debug
```

只有显式启用独立浏览器调试时才会写入 `.dev-token`：

```bash
DOUGOOS_BROWSER_DEBUG=1 pnpm --filter @dougoos/desktop start
```

生成当前平台的 unsigned 应用包：

```bash
pnpm package:desktop
```

## 测试 Provider

`test-fake` 只在自动化测试显式设置
`DOUGOOS_TEST_FAKE_PROVIDER=1` 时注册。它不探测本机 Agent、不使用凭据，也不能
作为真实 Provider 完成证据。完整源码 E2E 与打包 smoke：

```bash
pnpm test:desktop
pnpm smoke:package
```
