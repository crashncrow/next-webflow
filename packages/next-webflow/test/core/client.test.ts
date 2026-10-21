import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { WebflowConfigError, createWebflowClient, toSearchParams } from "../../src/core";
import { createTestClient } from "../helpers";
import { CDN_API, DATA_API, TEST_TOKEN, server } from "../msw";

describe("request", () => {
  it("sends the bearer token and JSON accept header to the Data API", async () => {
    let headers: Headers | undefined;
    server.use(
      http.get(`${DATA_API}/sites`, ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ sites: [] });
      }),
    );

    const { client } = createTestClient();
    await expect(client.request("/sites")).resolves.toEqual({ sites: [] });
    expect(headers?.get("authorization")).toBe(`Bearer ${TEST_TOKEN}`);
    expect(headers?.get("accept")).toBe("application/json");
  });

  it("reads the token from WEBFLOW_CMS_TOKEN lazily", async () => {
    let authorization: string | null = null;
    server.use(
      http.get(`${DATA_API}/sites`, ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({});
      }),
    );

    const client = createWebflowClient();
    vi.stubEnv("WEBFLOW_CMS_TOKEN", "env-token");
    await client.request("/sites");
    expect(authorization).toBe("Bearer env-token");
  });

  it("throws a config error when no token is available", async () => {
    const client = createWebflowClient();
    await expect(client.request("/sites")).rejects.toBeInstanceOf(WebflowConfigError);
    await expect(client.request("/sites")).rejects.not.toThrow(/WEBFLOW_API_TOKEN/);
  });

  it("never reads WEBFLOW_API_TOKEN (the Webflow CLI's workspace token), but says so", async () => {
    vi.stubEnv("WEBFLOW_API_TOKEN", "cli-workspace-token");
    const client = createWebflowClient();
    await expect(client.request("/sites")).rejects.toThrow(
      /Set WEBFLOW_CMS_TOKEN.*WEBFLOW_API_TOKEN is set but next-webflow doesn't read it/,
    );
  });

  it("uses the Content Delivery API host when asked", async () => {
    server.use(http.get(`${CDN_API}/collections/c1/items/live`, () => HttpResponse.json({ ok: true })));

    const { client } = createTestClient();
    await expect(client.request("/collections/c1/items/live", { host: "cdn" })).resolves.toEqual({
      ok: true,
    });
  });

  it("serializes nested filters with bracket notation", async () => {
    let search: URLSearchParams | undefined;
    server.use(
      http.get(`${DATA_API}/collections/c1/items/live`, ({ request }) => {
        search = new URL(request.url).searchParams;
        return HttpResponse.json({});
      }),
    );

    const { client } = createTestClient();
    await client.request("/collections/c1/items/live", {
      query: {
        slug: "hello",
        sortBy: "lastPublished",
        filter: { color: { in: ["red", "blue"] }, featured: { eq: true } },
        cmsLocaleId: undefined,
      },
    });

    expect(search?.get("slug")).toBe("hello");
    expect(search?.get("filter[color][in][0]")).toBe("red");
    expect(search?.get("filter[color][in][1]")).toBe("blue");
    expect(search?.get("filter[featured][eq]")).toBe("true");
    expect(search?.has("cmsLocaleId")).toBe(false);
  });

  it("passes extra fetch options (e.g. Next.js cache tags) through untouched", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => Response.json({}));
    const { client } = createTestClient({ fetch: fetchSpy });

    await client.request("/sites", {
      init: { cache: "force-cache", next: { tags: ["webflow"] } },
    });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit & { next?: unknown };
    expect(init.cache).toBe("force-cache");
    expect(init.next).toEqual({ tags: ["webflow"] });
  });

  it("does not let init headers override the authorization header", async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => Response.json({}));
    const { client } = createTestClient({ fetch: fetchSpy });

    await client.request("/sites", { init: { headers: { authorization: "Bearer other", "x-extra": "1" } } });

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TEST_TOKEN}`);
    expect(headers.get("x-extra")).toBe("1");
  });

  it("sends JSON bodies", async () => {
    let body: unknown;
    server.use(
      http.post(`${DATA_API}/sites/s1/webhooks`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "w1" });
      }),
    );

    const { client } = createTestClient();
    await client.request("/sites/s1/webhooks", { method: "POST", body: { triggerType: "site_publish" } });
    expect(body).toEqual({ triggerType: "site_publish" });
  });

  it("returns undefined for empty successful responses", async () => {
    server.use(http.delete(`${DATA_API}/webhooks/w1`, () => new HttpResponse(null, { status: 204 })));

    const { client } = createTestClient();
    await expect(client.request("/webhooks/w1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("toSearchParams", () => {
  it("skips undefined values and stringifies primitives", () => {
    expect(toSearchParams({ a: 1, b: false, c: undefined }).toString()).toBe("a=1&b=false");
  });
});
