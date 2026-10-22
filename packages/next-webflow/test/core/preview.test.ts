import { describe, expect, it, vi } from "vitest";
import { createPreviewUrl, safeRelativePath, verifyPreviewParams } from "../../src/core";

const NOW = Date.UTC(2026, 9, 21, 12);
const SECRET = "preview-secret";
const link = (overrides: Partial<Parameters<typeof createPreviewUrl>[0]> = {}) =>
  createPreviewUrl({
    url: "https://example.com/api/webflow/draft",
    collection: "posts",
    itemId: "item-1",
    secret: SECRET,
    now: NOW,
    ...overrides,
  });
const params = async (url: Promise<string> | string) => new URL(await url, "https://example.com").searchParams;
const verify = async (
  url: Promise<string> | string,
  options: Partial<Parameters<typeof verifyPreviewParams>[1]> = {},
) => verifyPreviewParams(await params(url), { secrets: [SECRET], now: NOW, ...options });

describe("createPreviewUrl", () => {
  it("signs collection, item and expiry; the secret never appears in the link", async () => {
    const url = await link();
    expect(url).toMatch(
      /^https:\/\/example\.com\/api\/webflow\/draft\?collection=posts&item=item-1&expires=\d+&sig=[0-9a-f]{64}$/,
    );
    expect(url).not.toContain(SECRET);
    expect((await params(url)).get("expires")).toBe(String(NOW / 1000 + 3600));
  });

  it("keeps relative routes relative, and honors expiresIn", async () => {
    const url = await link({ url: "/api/webflow/draft", expiresIn: 60 });
    expect(url.startsWith("/api/webflow/draft?collection=posts")).toBe(true);
    expect((await params(url)).get("expires")).toBe(String(NOW / 1000 + 60));
  });

  it("reads WEBFLOW_PREVIEW_SECRET (signs with the first of several)", async () => {
    vi.stubEnv("WEBFLOW_PREVIEW_SECRET", `${SECRET},older`);
    await expect(verify(link({ secret: undefined }))).resolves.toMatchObject({ ok: true });
  });

  it("fails without a secret", async () => {
    vi.stubEnv("WEBFLOW_PREVIEW_SECRET", "");
    await expect(link({ secret: undefined })).rejects.toThrow(/WEBFLOW_PREVIEW_SECRET/);
  });
});

describe("verifyPreviewParams", () => {
  it("accepts a valid link", async () => {
    await expect(verify(link())).resolves.toEqual({
      ok: true,
      collection: "posts",
      itemId: "item-1",
      expires: NOW / 1000 + 3600,
    });
  });

  it("accepts any of several secrets (rotation)", async () => {
    await expect(verify(link({ secret: "older" }), { secrets: [SECRET, "older"] })).resolves.toMatchObject({
      ok: true,
    });
  });

  it.each([
    ["collection", "pages"],
    ["item", "item-2"],
    ["expires", String(NOW / 1000 + 7200)],
  ])("rejects a tampered %s", async (name, value) => {
    const tampered = await params(link());
    tampered.set(name, value);
    await expect(verifyPreviewParams(tampered, { secrets: [SECRET], now: NOW })).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects another secret's signature", async () => {
    await expect(verify(link({ secret: "other" }))).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects expired links and links that live longer than the maximum", async () => {
    await expect(verify(link({ expiresIn: 60 }), { now: NOW + 61_000 })).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
    await expect(verify(link({ expiresIn: 3600 }), { maxLifetimeSeconds: 600 })).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it.each([
    "",
    "?collection=posts&item=i",
    "?collection=posts&item=i&expires=x&sig=" + "0".repeat(64),
    "?collection=posts&item=i&expires=1&sig=zz",
  ])("rejects malformed links (%s)", async (query) => {
    await expect(verifyPreviewParams(new URLSearchParams(query), { secrets: [SECRET], now: NOW })).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("safeRelativePath", () => {
  it.each([
    ["/blog/hello", "/blog/hello"],
    ["/blog/hello?x=1#top", "/blog/hello?x=1#top"],
    ["/", "/"],
    ["/a/../b", "/b"],
  ])("accepts %s", (path, expected) => {
    expect(safeRelativePath(path)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "blog/hello",
    "/\tevil",
    "/a\nb",
    "",
    undefined,
    null,
    42,
    `/${"a".repeat(3000)}`,
  ])("rejects %j", (path) => {
    expect(safeRelativePath(path)).toBeUndefined();
  });
});

it.each([
  "/..//evil.com",
  "/.//evil.com",
  "/%2e%2e//evil.com",
  "/a/..//evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\\evil.com",
  "\\/evil.com",
  "/%5c/evil.com",
  "/%5C%5Cevil.com",
  "/%2f%2fevil.com",
  "/%2F/evil.com",
  "/a/./../..//evil.com",
  "https://evil.com",
  "javascript:alert(1)",
  "//evil.com",
  "/posts/my-slug?x=1#top",
])("redirect stays on site after normalization: %j", (input) => {
  const path = safeRelativePath(input);
  expect(new URL(path ?? "/", "https://example.com").origin).toBe("https://example.com");
  if (input === "/posts/my-slug?x=1#top") expect(path).toBe(input);
});
