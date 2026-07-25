const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

const INSTALL_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

const INSTALL_DEPRECATION = `#!/bin/sh
echo "DougoOS 安装脚本已停用。请从 https://dougoos.com 下载 Early Access DMG。" >&2
exit 1
`;

const json = (body: unknown, init: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...init.headers },
  });

export function handleRequest(
  request: Request,
  assets: Pick<Fetcher, "fetch">,
): Response | Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/install") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        headers: { ...INSTALL_HEADERS, allow: "GET, HEAD" },
        status: 405,
      });
    }
    return new Response(request.method === "HEAD" ? null : INSTALL_DEPRECATION, {
      headers: INSTALL_HEADERS,
      status: 410,
    });
  }
  if (url.pathname === "/v1/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(
        { code: "METHOD_NOT_ALLOWED", status: "error" },
        { headers: { allow: "GET, HEAD" }, status: 405 },
      );
    }
    if (request.method === "HEAD") {
      return new Response(null, { headers: JSON_HEADERS, status: 200 });
    }
    return json({ service: "dougoos-cloud", status: "ok", v: 1 }, { status: 200 });
  }
  if (url.pathname.startsWith("/v1/")) {
    return json({ code: "NOT_FOUND", status: "error" }, { status: 404 });
  }
  return assets.fetch(request);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env.ASSETS);
  },
} satisfies ExportedHandler<Env>;
