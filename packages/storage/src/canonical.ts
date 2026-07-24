import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const result = JSON.stringify(normalize(value));
  if (result === undefined) throw new TypeError("value is not JSON serializable");
  return result;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
