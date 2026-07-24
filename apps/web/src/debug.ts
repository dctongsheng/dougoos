import { packageManifest } from "./index.js";

process.stdout.write(`${JSON.stringify({ ...packageManifest, debug: "ready" })}\n`);
