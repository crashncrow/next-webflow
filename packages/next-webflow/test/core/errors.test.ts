import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import {
  WebflowApiError,
  WebflowBadRequestError,
  WebflowConflictError,
  WebflowError,
  WebflowForbiddenError,
  WebflowNetworkError,
  WebflowNotFoundError,
  WebflowServerError,
  WebflowUnauthorizedError,
} from "../../src/core";
import { createTestClient, webflowError } from "../helpers";
import { DATA_API, server } from "../msw";

describe("typed API errors", () => {
  it.each([
    [400, "bad_request", WebflowBadRequestError],
    [401, "not_authorized", WebflowUnauthorizedError],
    [403, "forbidden", WebflowForbiddenError],
    [404, "resource_not_found", WebflowNotFoundError],
    [409, "conflict", WebflowConflictError],
    [500, "internal_error", WebflowServerError],
    [418, "teapot", WebflowApiError],
  ] as const)("maps %i to %s", async (status, code, ErrorClass) => {
    server.use(
      http.get(`${DATA_API}/sites/s1`, () => HttpResponse.json(webflowError(code, "Something went wrong"), { status })),
    );

    const { client } = createTestClient({ retry: false });
    const error = await client.request("/sites/s1").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ErrorClass);
    expect(error).toBeInstanceOf(WebflowError);
    expect(error).toMatchObject({
      status,
      code,
      method: "GET",
      url: `${DATA_API}/sites/s1`,
      details: [],
      externalReference: null,
    });
    expect((error as Error).message).toContain("Something went wrong");
  });

  it("falls back to the status text for non-JSON error bodies", async () => {
    server.use(
      http.get(
        `${DATA_API}/sites/s1`,
        () => new HttpResponse("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
      ),
    );

    const { client } = createTestClient({ retry: false });
    const error = await client.request("/sites/s1").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebflowServerError);
    expect(error).toMatchObject({ status: 502, code: undefined });
    expect((error as Error).message).toContain("Bad Gateway");
  });

  it("wraps network failures", async () => {
    server.use(http.get(`${DATA_API}/sites/s1`, () => HttpResponse.error()));

    const { client } = createTestClient({ retry: false });
    await expect(client.request("/sites/s1")).rejects.toBeInstanceOf(WebflowNetworkError);
  });

  it("rejects invalid JSON on success", async () => {
    server.use(http.get(`${DATA_API}/sites/s1`, () => new HttpResponse("not json", { status: 200 })));

    const { client } = createTestClient();
    await expect(client.request("/sites/s1")).rejects.toThrow(/Invalid JSON/);
  });
});
