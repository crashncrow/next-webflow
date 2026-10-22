import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeCliFile(path: string, content: string, options?: { secret?: boolean }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: options?.secret ? 0o600 : 0o644 });
  if (options?.secret && process.platform !== "win32") chmodSync(path, 0o600);
}
