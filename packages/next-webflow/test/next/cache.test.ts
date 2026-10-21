import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers.js", () => ({ draftMode: async () => ({ isEnabled: false }) }));

describe("nextCache", () => {
  it("detects production builds through NEXT_PHASE", async () => {
    const { nextCache } = await import("../../src/next/cache");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(nextCache.isBuild?.()).toBe(true);
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    expect(nextCache.isBuild?.()).toBe(false);
  });
});
