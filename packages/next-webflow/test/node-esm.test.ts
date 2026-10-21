import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const dist = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// The CLI and user scripts import the built package in plain Node ESM (no bundler).
describe.skipIf(!existsSync(dist))("built package in plain Node ESM", () => {
  it("imports without resolution errors", () => {
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `const m = await import(${JSON.stringify(dist)}); console.log(typeof m.createWebflow);`],
      { cwd: packageRoot, encoding: "utf8" },
    );
    expect(output.trim()).toBe("function");
  });
});
