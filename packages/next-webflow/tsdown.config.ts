import { defineConfig } from "tsdown";

// Peer dependencies: resolved from the user's app.
const neverBundle = [/^next(\/|$)/, /^react(\/|$)/, /^react-dom(\/|$)/];
// Client components are separate entries (their "use client" must stay at the top of the file),
// imported through the package's own export so they're never inlined into server chunks.
const clientEntries = [/^next-webflow\/components\/client$/];

export default defineConfig([
  {
    // Runtime entries: edge-compatible, no Node built-ins.
    entry: {
      index: "src/index.ts",
      webhook: "src/webhook/index.ts",
      draft: "src/draft/index.ts",
      components: "src/components/index.ts",
    },
    format: "esm",
    platform: "neutral",
    target: "es2022",
    dts: true,
    sourcemap: true,
    clean: false,
    deps: { neverBundle: [...neverBundle, ...clientEntries] },
  },
  {
    // Client components, one file each: rolldown keeps "use client" at the top of an entry module
    // (it still prints a MODULE_LEVEL_DIRECTIVE warning; test/node-esm.test.ts checks the output).
    entry: { "components-client": "src/components/exit-preview-link.tsx" },
    format: "esm",
    platform: "neutral",
    target: "es2022",
    dts: true,
    sourcemap: true,
    clean: false,
    deps: { neverBundle },
  },
  {
    // CLI binary: Node only.
    entry: { cli: "src/cli/index.ts" },
    format: "esm",
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    clean: false,
    deps: { neverBundle },
  },
]);
