import type { AgentId } from "./types.js";

export const routeTask = (text: string): AgentId => {
  const lowered = text.toLowerCase();
  if (/(?:open[\s-]?claw|龙虾)/u.test(lowered)) return "openclaw";
  if (/(?:open[\s-]?code)/u.test(lowered)) return "opencode";
  if (/(测试|test|覆盖率|e2e|flaky)/u.test(lowered)) return "cursor";
  if (/(日志|crash|崩溃|根因|分析|排查)/u.test(lowered)) return "grok";
  if (/(迁移|schema|数据库|表|sql)/u.test(lowered)) return "claude";
  if (/(重构|refactor|中间件|架构)/u.test(lowered)) return "codex";
  if (/(文档|openapi|邮件|调研|外联|博客|seo)/u.test(lowered)) return "hermes";
  if (/(问答|解释|是什么|为什么)/u.test(lowered)) return "pi";
  return "claude";
};
