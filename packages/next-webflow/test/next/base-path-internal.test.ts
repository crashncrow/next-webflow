import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// next-webflow/draft falls back to `process.env.__NEXT_ROUTER_BASEPATH`, a Next.js INTERNAL that
// Next inlines at build time (Webflow Cloud route handlers don't see the mount path otherwise).
// If this test fails after a Next.js upgrade, the fallback is dead: users must set
// NEXT_PUBLIC_BASE_PATH (or the `basePath` option), and src/draft/index.ts needs a new fallback.
describe("Next.js still inlines __NEXT_ROUTER_BASEPATH", () => {
  it("is defined from config.basePath in the installed next/dist/build/define-env.js", () => {
    const require = createRequire(import.meta.url);
    const { version } = require("next/package.json") as { version: string };
    const defineEnv = readFileSync(require.resolve("next/dist/build/define-env.js"), "utf8");
    expect(
      defineEnv.includes("'process.env.__NEXT_ROUTER_BASEPATH': config.basePath"),
      `next@${version} no longer defines process.env.__NEXT_ROUTER_BASEPATH: next-webflow/draft's base path fallback is gone`,
    ).toBe(true);
  });
});
