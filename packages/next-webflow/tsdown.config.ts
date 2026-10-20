import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "neutral",
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  // Peer dependencies: resolved from the user's app.
  external: [/^next(\/|$)/, /^react(\/|$)/, /^react-dom(\/|$)/],
});
