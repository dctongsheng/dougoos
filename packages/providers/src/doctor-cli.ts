import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { doctorProviders } from "./doctor.js";
import { createBuiltinProviders } from "./registry.js";

function selectedProviders(argument: string | undefined) {
  const providers = createBuiltinProviders();
  if (argument === undefined || argument === "all") return providers;
  const selected = providers.find((provider) => provider.id === argument);
  if (selected === undefined) {
    throw new Error(`Provider must be one of: all, ${providers.map(({ id }) => id).join(", ")}`);
  }
  return [selected];
}

export async function runDoctorCli(args: readonly string[]): Promise<void> {
  const [providerId, cwdArgument] = args;
  const results = await doctorProviders(selectedProviders(providerId), {
    cwd: resolve(cwdArgument ?? process.cwd()),
  });
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runDoctorCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Provider doctor failed"}\n`);
    process.exitCode = 1;
  });
}
