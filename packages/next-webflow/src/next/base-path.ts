/**
 * The app's base path, which route handlers don't see on Webflow Cloud (`request.url` and
 * `nextUrl.basePath` lack the mount path). In order:
 * 1. `NEXT_PUBLIC_BASE_PATH`, the variable Webflow's "Bring your own app" docs tell users to set
 *    to the mount path (`""` counts: a root mount).
 * 2. `__NEXT_ROUTER_BASEPATH`, which Next.js inlines at build time. A Next.js **internal**: it may
 *    disappear in any release (`test/next/base-path-internal.test.ts` fails loudly if it does).
 * Both must stay literal `process.env.X` member expressions so Next.js can inline them.
 */
export function nextBasePath(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const documented = process.env.NEXT_PUBLIC_BASE_PATH;
  if (documented !== undefined) return documented;
  return process.env.__NEXT_ROUTER_BASEPATH || undefined;
}
