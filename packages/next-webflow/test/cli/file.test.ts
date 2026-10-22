import { mkdtempSync, writeFileSync, chmodSync, statSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeCliFile } from "../../src/cli/file";

it.skipIf(process.platform === "win32")("restricts existing secret files to 0600", () => {
  const dir = mkdtempSync(join(tmpdir(), "webflow-permissions-"));
  try {
    const path = join(dir, "secrets");
    writeFileSync(path, "old");
    chmodSync(path, 0o644);
    writeCliFile(path, "new", { secret: true });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("new");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
