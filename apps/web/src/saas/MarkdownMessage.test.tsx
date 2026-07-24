import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "./MarkdownMessage.js";

const renderMarkdown = (source: string): string =>
  renderToStaticMarkup(<MarkdownMessage>{source}</MarkdownMessage>);

describe("MarkdownMessage", () => {
  it("renders GFM structure, emphasis, code, and soft line breaks", () => {
    const html = renderMarkdown(
      [
        "### 正式回答",
        "第一行",
        "第二行",
        "",
        "- 条目 A",
        "- 条目 B",
        "",
        "**完成** 与 `inline()`",
        "",
        "| 名称 | 状态 |",
        "| --- | --- |",
        "| AgentOS | 正常 |",
      ].join("\n"),
    );

    expect(html).toContain("<h3>正式回答</h3>");
    expect(html).toContain("第一行<br/>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>条目 A</li>");
    expect(html).toContain("<strong>完成</strong>");
    expect(html).toContain("<code>inline()</code>");
    expect(html).toContain("<table>");
  });

  it("does not execute raw HTML or dangerous link protocols", () => {
    const html = renderMarkdown(
      '<img src=x onerror="globalThis.pwned=true"><script>alert(1)</script>\n[危险](javascript:alert(1))',
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;img src=x onerror=");
  });

  it("keeps rendering while a streamed Markdown construct is incomplete", () => {
    expect(() => renderMarkdown("### 流式回答\n**尚未结束")).not.toThrow();
  });
});
