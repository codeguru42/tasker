import { readFileSync } from "node:fs";

export interface PiQuotaStream {
  sessionFile: string;
  stdout: Record<string, unknown>[];
  session: unknown[];
}

const records = JSON.parse(
  readFileSync(new URL("../fixtures/pi-streams/quota.json", import.meta.url), "utf8"),
) as Record<string, PiQuotaStream>;

export function piQuotaStream(name: string): PiQuotaStream {
  const record = records[name];
  if (record === undefined) throw new Error(`unknown pi quota stream: ${name}`);
  return structuredClone(record);
}
