import { EdgeVM } from "@edge-runtime/vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Runtime entry points that must run on edge runtimes (everything except the CLI). */
const RUNTIME_ENTRIES = ["src/index.ts"];

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** Bundles like an edge runtime would. esbuild fails to resolve Node built-ins on this platform. */
function bundleForEdge(entry: { file: string } | { contents: string }) {
  return build({
    absWorkingDir: packageRoot,
    ...("file" in entry
      ? { entryPoints: [entry.file] }
      : { stdin: { contents: entry.contents, resolveDir: packageRoot, loader: "ts" } }),
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    conditions: ["edge-light", "worker", "browser"],
    format: "iife",
    globalName: "NextWebflow",
    logLevel: "silent",
  });
}

describe("edge compatibility check", () => {
  it("catches Node built-in imports", async () => {
    await expect(
      bundleForEdge({ contents: `import { createHmac } from "node:crypto"; export { createHmac };` }),
    ).rejects.toThrow(/node:crypto/);
  });
});

describe.each(RUNTIME_ENTRIES)("%s is edge-compatible", (file) => {
  it("bundles without Node built-ins and runs in an edge VM", async () => {
    const result = await bundleForEdge({ file });

    const externalImports = Object.values(result.metafile.outputs).flatMap((output) =>
      output.imports.filter((imported) => imported.external).map((imported) => imported.path),
    );
    expect(externalImports).toEqual([]);

    const code = result.outputFiles[0]?.text ?? "";
    const vm = new EdgeVM();
    vm.evaluate(code);
    vm.evaluate(`
      globalThis.__result = NextWebflow.createWebflowClient({
        token: "test-token",
        fetch: async () => Response.json({ items: [{ id: "a" }], pagination: { limit: 100, offset: 0, total: 1 } }),
      }).paginate("/collections/c1/items/live");
    `);
    await expect(vm.evaluate("globalThis.__result")).resolves.toMatchObject({ total: 1 });
  });
});
