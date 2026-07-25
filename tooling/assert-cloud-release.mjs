import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseRoot = join(workspaceRoot, "apps/cloud/dist/site");
const workerRoot = join(workspaceRoot, "apps/cloud/dist/worker");
const workerSource = join(workspaceRoot, "apps/cloud/worker/index.ts");
const sourceRoot = join(workspaceRoot, "apps/cloud/src");
const searchableExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs"]);
const releaseForbidden = [
  ["prototype component markup", /<x-dc\b|data-dc-tpl/iu],
  ["prototype source or runtime", /\.dc\.html|support\.js/iu],
  ["iframe", /<iframe\b|createElement\(["']iframe/iu],
  ["visual scenario seam", /visualCase|data-visual-case|production-safe-cta/iu],
  ["test runtime hook", /__dougoos/u],
  ["account or ingest API", /\/(?:api\/auth|v1\/ingest)\b/iu],
];
const allowedExternalUrl = "https://downloads.dougoos.com/early-access/macos/arm64/DougoOS.dmg";
const externalResourceAttribute = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/giu;
const sourceForbidden = [
  ["HTML injection", /dangerouslySetInnerHTML|\.innerHTML\s*=/u],
  ["iframe", /<iframe\b|createElement\(["']iframe/iu],
  ["network API", /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket|sendBeacon/iu],
  [
    "storage API",
    /localStorage|sessionStorage|indexedDB|CacheStorage|\bcaches\b|document\.cookie|cookieStore/iu,
  ],
  ["account or ingest API", /\/(?:api\/auth|v1\/ingest)\b/iu],
];
const workerForbidden = [
  ["ingest route", /\/v1\/ingest\b/iu],
  ["business payload field", /\b(?:prompt|cwd|token|deviceId|messages?|toolContent)\b/iu],
  ["persistence binding", /\b(?:D1Database|KVNamespace|Queue|R2Bucket)\b/u],
];
const workerBodyReaders =
  /\brequest\.(?:arrayBuffer|blob|formData|json|text)\s*\(|\brequest\.body\b/u;
const workerRequired = ["/v1/health", "dougoos-cloud", "NOT_FOUND", "env.ASSETS"];
const required = [
  "data-screen-label",
  "落地页",
  "多个 Agent CLI",
  "AgentOS — workspace / local",
  "FEATURES",
  "SMART ROUTING",
  "MEMORY",
  "把所有终端窗口,收进一个 OS",
  "登录 AgentOS",
  "data-production-ready",
];

const files = [];
const visit = async (directory, target) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path, target);
    else if (entry.isFile()) target.push(path);
  }
};

await stat(join(releaseRoot, "index.html"));
const workerEntry = join(workerRoot, "index.js");
await stat(workerEntry);
await visit(releaseRoot, files);
const sourcePaths = [];
await visit(sourceRoot, sourcePaths);

const sourceFiles = files.filter((path) => searchableExtensions.has(extname(path)));
const contents = await Promise.all(
  sourceFiles.map(async (path) => [path, await readFile(path, "utf8")]),
);
const failures = [];
for (const [path, content] of contents) {
  for (const [label, pattern] of releaseForbidden) {
    if (pattern.test(content))
      failures.push(`${relative(workspaceRoot, path)}: forbidden ${label}`);
  }
  for (const match of content.matchAll(externalResourceAttribute)) {
    if (match[1] !== allowedExternalUrl) {
      failures.push(`${relative(workspaceRoot, path)}: forbidden external resource URL`);
    }
  }
}
const workerContent = await readFile(workerEntry, "utf8");
for (const token of workerRequired) {
  if (!workerContent.includes(token)) failures.push(`worker output: missing ${token}`);
}
for (const [label, pattern] of workerForbidden) {
  if (pattern.test(workerContent)) failures.push(`worker output: forbidden ${label}`);
}
const workerSourceContent = await readFile(workerSource, "utf8");
if (workerBodyReaders.test(workerSourceContent)) {
  failures.push("worker source: forbidden request body reader");
}
for (const path of sourcePaths.filter((sourcePath) =>
  [".css", ".html", ".ts", ".tsx"].includes(extname(sourcePath)),
)) {
  const content = await readFile(path, "utf8");
  for (const [label, pattern] of sourceForbidden) {
    if (pattern.test(content))
      failures.push(`${relative(workspaceRoot, path)}: forbidden ${label}`);
  }
}

const composite = contents.map(([, content]) => content).join("\n");
if (!composite.includes(allowedExternalUrl)) {
  failures.push("release output: missing canonical Early Access download URL");
}
for (const token of required) {
  if (!composite.includes(token)) failures.push(`release output: missing ${token}`);
}

const relativeFiles = files.map((path) => relative(releaseRoot, path));
for (const extension of [".css", ".js", ".woff2"]) {
  if (!relativeFiles.some((path) => extname(path) === extension)) {
    failures.push(`release output: missing ${extension} asset`);
  }
}
if (!relativeFiles.some((path) => /^assets\/.+-[A-Za-z0-9_-]+\.(?:css|js)$/u.test(path))) {
  failures.push("release output: missing hashed JS/CSS asset");
}

if (failures.length > 0) {
  throw new Error(`Cloud release assertion failed:\n${failures.join("\n")}`);
}

console.log(`Cloud release assertion passed (${files.length.toString()} files).`);
