# @dougoos/cloud

Cloudflare Worker 与 Landing 的 workspace 边界。当前静态 React Landing 完整复刻原型页面，
登录、下载、在线体验、GitHub 与导航均为无网络、无持久化的本地演示控件。Worker 只实现
`GET/HEAD /v1/health`；其他 `/v1/*`（包括 ingest）稳定返回 `404`。这里没有账号、认证、
数据库、队列、业务数据或遥测上报能力。

## 单独调试

```bash
pnpm --filter @dougoos/cloud dev
pnpm --filter @dougoos/cloud dev:worker
pnpm --filter @dougoos/cloud debug
pnpm --filter @dougoos/cloud types:worker
pnpm --filter @dougoos/cloud typecheck
pnpm --filter @dougoos/cloud test
pnpm --filter @dougoos/cloud build
```

`build` 保留 Node ESM 包入口 `dist/index.js`，把正式静态站输出到 `dist/site`，并用
Wrangler dry-run 验证 Worker 与静态资源路由。构建末尾的 release assertion 会拒绝
prototype runtime/HTML 注入、visual scenario seam、Landing 网络 API、浏览器持久化 API
或外部字体资源；它还要求 Worker bundle 只暴露 health 路由，并拒绝 ingest、业务 payload
字段、请求体读取和持久化绑定。
