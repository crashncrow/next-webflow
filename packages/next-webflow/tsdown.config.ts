import { defineConfig } from "tsdown";

// Peer dependencies: resolved from the user's app.
const neverBundle = [/^next(\/|$)/, /^react(\/|$)/, /^react-dom(\/|$)/];

export default defineConfig([
  {
    // Runtime entries: edge-compatible, no Node built-ins.
    entry: { index: "src/index.ts", webhook: "src/webhook/index.ts", draft: "src/draft/index.ts" },
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
