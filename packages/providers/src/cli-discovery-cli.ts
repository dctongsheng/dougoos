import { pathToFileURL } from "node:url";

import { AgentCliDiscovery } from "./cli-discovery.js";

export async function runCliDiscovery(): Promise<void> {
  const result = await new AgentCliDiscovery().scan({ force: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runCliDiscovery().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "CLI discovery failed"}\n`);
    process.exitCode = 1;
  });
}
