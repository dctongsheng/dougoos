import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { isTrustedAppUrl } from "./contracts.js";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const STARTUP_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DougoOS 正在启动</title>
    <link rel="stylesheet" href="/desktop/startup.css" />
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true"></div>
      <h1>DougoOS 正在启动</h1>
      <p>正在准备本地 Core 和数据存储…</p>
    </main>
  </body>
</html>`;

const STARTUP_CSS = `:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f14;color:#f3f6f8;font-family:system-ui,sans-serif}main{text-align:center}.mark{width:28px;height:28px;margin:0 auto 20px;border:3px solid #334155;border-top-color:#64d8cb;border-radius:50%;animation:spin .8s linear infinite}h1{font-size:20px;margin:0 0 8px}p{color:#91a0af;font-size:14px;margin:0}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.mark{animation:none}}`;

const DIAGNOSTIC_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DougoOS 启动失败</title>
    <link rel="stylesheet" href="/desktop/startup.css" />
  </head>
  <body>
    <main>
      <h1>本地 Core 启动失败</h1>
      <p>请关闭应用后重试；详细诊断保留在本机。</p>
    </main>
  </body>
</html>`;

export function resolveWebAsset(webRoot: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) {
    return null;
  }
  const relative = decoded === "/" || decoded === "" ? "index.html" : decoded.replace(/^\/+/u, "");
  const root = resolve(webRoot);
  const asset = resolve(root, relative);
  return asset === root || asset.startsWith(`${root}${sep}`) ? asset : null;
}

function response(
  body: ConstructorParameters<typeof Response>[0],
  contentType: string,
  status = 200,
): Response {
  return new Response(body, {
    headers: {
      "content-security-policy": CONTENT_SECURITY_POLICY,
      "content-type": contentType,
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
    },
    status,
  });
}

export async function handleAppRequest(request: Request, webRoot: string): Promise<Response> {
  const url = new URL(request.url);
  if (!isTrustedAppUrl(url.href) || (request.method !== "GET" && request.method !== "HEAD")) {
    return response("Not found", "text/plain; charset=utf-8", 404);
  }
  const head = request.method === "HEAD";
  if (url.pathname === "/startup") {
    return response(head ? null : STARTUP_HTML, "text/html; charset=utf-8");
  }
  if (url.pathname === "/diagnostic") {
    return response(head ? null : DIAGNOSTIC_HTML, "text/html; charset=utf-8");
  }
  if (url.pathname === "/desktop/startup.css") {
    return response(head ? null : STARTUP_CSS, "text/css; charset=utf-8");
  }
  const asset = resolveWebAsset(webRoot, url.pathname);
  if (asset === null) return response("Not found", "text/plain; charset=utf-8", 404);
  try {
    const body = head ? null : await readFile(asset);
    return response(body, MIME_TYPES[extname(asset).toLowerCase()] ?? "application/octet-stream");
  } catch {
    return response("Not found", "text/plain; charset=utf-8", 404);
  }
}
