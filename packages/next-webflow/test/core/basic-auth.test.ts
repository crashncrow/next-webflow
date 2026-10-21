import { describe, expect, it } from "vitest";
import { requireBasicAuth } from "../../src/core";

const header = (credentials: string) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(credentials)))}`;
const request = (authorization?: string) =>
  new Request("https://example.com/drafts", authorization ? { headers: { authorization } } : {});

describe("requireBasicAuth", () => {
  it("lets the right password through (any username by default)", async () => {
    await expect(requireBasicAuth(request(header("anyone:s3cret")), { password: "s3cret" })).resolves.toBeUndefined();
  });

  it("checks the username when given, and handles UTF-8 and colons in passwords", async () => {
    await expect(requireBasicAuth(request(header("editor:pä:ss")), { username: "editor", password: "pä:ss" })).resolves.toBeUndefined();
    expect((await requireBasicAuth(request(header("other:pä:ss")), { username: "editor", password: "pä:ss" }))?.status).toBe(401);
  });

  it.each([
    ["no header", undefined],
    ["a wrong password", header("x:nope")],
    ["a prefix of the password", header("x:s3cre")],
    ["another scheme", "Bearer s3cret"],
    ["garbage", "Basic !!!"],
    ["no colon", `Basic ${btoa("s3cret")}`],
  ])("answers 401 with a login prompt for %s", async (_, authorization) => {
    const response = await requireBasicAuth(request(authorization), { password: "s3cret", realm: 'Dr"afts' });
    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBe('Basic realm="Drafts", charset="UTF-8"');
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it("fails closed with 503 when no password is configured", async () => {
    expect((await requireBasicAuth(request(header("x:")), { password: undefined }))?.status).toBe(503);
    expect((await requireBasicAuth(request(header("x:")), { password: "" }))?.status).toBe(503);
  });

  it("accepts Headers too (await headers() in a page)", async () => {
    await expect(requireBasicAuth(new Headers({ authorization: header("x:s3cret") }), { password: "s3cret" })).resolves.toBeUndefined();
  });
});
