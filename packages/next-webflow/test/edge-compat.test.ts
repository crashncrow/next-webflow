import { EdgeVM } from "@edge-runtime/vm";
import { build, type Plugin } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Runtime entry points that must run on edge runtimes (everything except the CLI), each with a
 * smoke test run inside the edge VM. The script must set `globalThis.__result` to a promise.
 */
const RUNTIME_ENTRIES: Array<{ file: string; smoke: string; expected: unknown }> = [
  {
    file: "src/index.ts",
    smoke: `
      globalThis.__result = NextWebflow.createWebflowClient({
        token: "test-token",
        fetch: async () => Response.json({ items: [{ id: "a" }], pagination: { limit: 100, offset: 0, total: 1 } }),
      }).paginate("/collections/c1/items/live");
    `,
    expected: { total: 1 },
  },
  {
    // HMAC with crypto.subtle; the timestamp is now, the signature is wrong on purpose.
    file: "src/webhook/index.ts",
    smoke: `
      globalThis.__result = NextWebflow.verifyWebflowSignature({
        rawBody: "{}",
        signature: "0".repeat(64),
        timestamp: String(Date.now()),
        secrets: ["whsec_x"],
      });
    `,
    expected: { ok: false, reason: "invalid" },
  },
];

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `next` is a peer dependency (Next itself is edge-compatible), so its modules are replaced
 * with minimal stubs instead of being bundled.
 */
const stubNext: Plugin = {
  name: "stub-next",
  setup(build) {
    const stubs: Record<string, string> = {
      "next/headers": "export const draftMode = async () => ({ isEnabled: false });",
      "next/cache": "export const revalidateTag = () => {};",
    };
    build.onResolve({ filter: /^next\/(headers|cache)(\.js)?$/ }, (args) => ({
      path: args.path.replace(/\.js$/, ""),
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "", loader: "js" }));
  },
};

/** Bundles like an edge runtime would. esbuild fails to resolve Node built-ins on this platform. */
function bundleForEdge(entry: { file: string } | { contents: string }) {
  return build({
    plugins: [stubNext],
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

describe.each(RUNTIME_ENTRIES)("$file is edge-compatible", ({ file, smoke, expected }) => {
  it("bundles without Node built-ins and runs in an edge VM", async () => {
    const result = await bundleForEdge({ file });

    const externalImports = Object.values(result.metafile.outputs).flatMap((output) =>
      output.imports.filter((imported) => imported.external).map((imported) => imported.path),
    );
    expect(externalImports).toEqual([]);

    const code = result.outputFiles[0]?.text ?? "";
    const vm = new EdgeVM();
    vm.evaluate(code);
    vm.evaluate(smoke);
    await expect(vm.evaluate("globalThis.__result")).resolves.toMatchObject(expected as object);
  });
});
