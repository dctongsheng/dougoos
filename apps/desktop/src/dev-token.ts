import { chmod, open, rename } from "node:fs/promises";

export async function writeRotatedDevToken(path: string, token: string): Promise<void> {
  const temporaryPath = `${path}.${String(process.pid)}.tmp`;
  const file = await open(temporaryPath, "w", 0o600);
  try {
    await file.writeFile(`${token}\n`, { encoding: "utf8" });
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}
