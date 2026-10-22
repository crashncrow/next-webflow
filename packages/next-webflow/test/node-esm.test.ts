import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const dist = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// The CLI and user scripts import the built package in plain Node ESM (no bundler).
describe.skipIf(!existsSync(dist))("built package in plain Node ESM", () => {
  it("imports without resolution errors", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(dist)}); console.log(typeof m.createWebflow);`,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );
    expect(output.trim()).toBe("function");
  });

  it("imports next-webflow/webhook (next/cache.js resolves without a bundler)", () => {
    const entry = fileURLToPath(new URL("../dist/webhook.js", import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(entry)}); console.log(typeof m.POST, "runtime" in m);`,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );
    expect(output.trim()).toBe("function false");
  });

  it("imports next-webflow/draft (next/headers.js resolves without a bundler)", () => {
    const entry = fileURLToPath(new URL("../dist/draft.js", import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(entry)}); console.log(typeof m.createDraftHandler, typeof m.createPreviewUrl, "runtime" in m);`,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );
    expect(output.trim()).toBe("function function false");
  });

  it('imports next-webflow/components, and the client entry keeps "use client" first', () => {
    const entry = fileURLToPath(new URL("../dist/components.js", import.meta.url));
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(entry)}); console.log(typeof m.WebflowRichText, typeof m.WebflowImage, typeof m.DraftModeBanner);`,
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );
    expect(output.trim()).toBe("function function function");
    const client = readFileSync(new URL("../dist/components-client.js", import.meta.url), "utf8");
    expect(client.startsWith('"use client";')).toBe(true);
  });

  it("runs the CLI binary", () => {
    const cli = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
    const output = execFileSync(process.execPath, [cli, "--help"], { cwd: packageRoot, encoding: "utf8" });
    expect(output).toMatch(/next-webflow webhooks <command>/);
  });
});

// Exercise the built command as users invoke it, including its exit status.
it.skipIf(!existsSync(dist))("preview-url rejects lifetimes over the handler maximum", () => {
  const cli = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
  const args = [cli, "preview-url", "--url", "/api/draft", "--collection", "posts", "--item", "item", "--expires"];
  const options = {
    cwd: packageRoot,
    encoding: "utf8" as const,
    env: { ...process.env, WEBFLOW_PREVIEW_SECRET: "test-preview-secret" },
  };
  const valid = spawnSync(process.execPath, [...args, "2592000"], options);
  expect(valid.status).toBe(0);
  expect(valid.stdout).toContain("/api/draft?collection=posts");
  const invalid = spawnSync(process.execPath, [...args, "2592001"], options);
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toMatch(/2592000.*30 days.*maxLifetimeSeconds/);
});
