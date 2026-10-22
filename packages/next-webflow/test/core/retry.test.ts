import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import {
  WebflowNetworkError,
  WebflowRateLimitError,
  WebflowServerError,
  createWebflowClient,
  parseRetryAfter,
} from "../../src/core";
import { backoffDelay } from "../../src/core/retry";
import { createTestClient, webflowError } from "../helpers";
import { DATA_API, TEST_TOKEN, server } from "../msw";

const rateLimited = (headers: Record<string, string> = {}) =>
  HttpResponse.json(webflowError("too_many_requests", "Too Many Requests"), {
    status: 429,
    headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", ...headers },
  });

/** Answers with `failures` in order, then succeeds. Counts calls. */
function sequence(path: string, failures: Array<() => Response>, method: "get" | "post" = "get") {
  const state = { calls: 0 };
  server.use(
    http[method](`${DATA_API}${path}`, () => {
      const failure = failures[state.calls++];
      return failure ? failure() : HttpResponse.json({ ok: true });
    }),
  );
  return state;
}

describe("429 handling", () => {
  it("waits for Retry-After before retrying", async () => {
    const state = sequence("/sites", [() => rateLimited({ "retry-after": "2" })]);

    const { client, sleeps } = createTestClient();
    await expect(client.request("/sites")).resolves.toEqual({ ok: true });
    expect(state.calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it("uses exponential backoff with jitter when Retry-After is missing", async () => {
    sequence("/sites", [() => rateLimited(), () => rateLimited(), () => rateLimited()]);

    const { client, sleeps } = createTestClient({ retry: { baseDelayMs: 100 } }, () => 1);
    await client.request("/sites");
    // random() = 1 → full ceiling: 100, 200, 400.
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it("throws a rate limit error with limit info once retries are exhausted", async () => {
    const state = sequence(
      "/sites",
      Array.from({ length: 10 }, () => () => rateLimited({ "retry-after": "1" })),
    );

    const { client, sleeps } = createTestClient({ retry: { maxRetries: 2 } });
    const error = await client.request("/sites").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebflowRateLimitError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 1000, limit: 60, remaining: 0 });
    expect(state.calls).toBe(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("fails fast when Retry-After exceeds maxRetryAfterMs", async () => {
    const state = sequence("/sites", [() => rateLimited({ "retry-after": "60" })]);

    const { client, sleeps } = createTestClient({ retry: { maxRetryAfterMs: 5_000 } });
    await expect(client.request("/sites")).rejects.toMatchObject({ retryAfterMs: 60_000 });
    expect(state.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("retries 429 on non-idempotent methods (the request was not processed)", async () => {
    const state = sequence("/sites/s1/webhooks", [() => rateLimited({ "retry-after": "1" })], "post");

    const { client } = createTestClient();
    await client.request("/sites/s1/webhooks", { method: "POST", body: {} });
    expect(state.calls).toBe(2);
  });

  it("does not retry when retries are disabled", async () => {
    const state = sequence("/sites", [() => rateLimited({ "retry-after": "1" })]);

    const { client } = createTestClient({ retry: false });
    await expect(client.request("/sites")).rejects.toBeInstanceOf(WebflowRateLimitError);
    expect(state.calls).toBe(1);
  });
});

describe("5xx and network errors", () => {
  const serverError = () => HttpResponse.json(webflowError("internal_error", "Internal"), { status: 503 });

  it("retries GET requests on 5xx", async () => {
    const state = sequence("/sites", [serverError, serverError]);

    const { client, sleeps } = createTestClient();
    await expect(client.request("/sites")).resolves.toEqual({ ok: true });
    expect(state.calls).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it("does not retry POST on 5xx (it may have been processed)", async () => {
    const state = sequence("/sites/s1/webhooks", [serverError], "post");

    const { client } = createTestClient();
    await expect(client.request("/sites/s1/webhooks", { method: "POST", body: {} })).rejects.toBeInstanceOf(
      WebflowServerError,
    );
    expect(state.calls).toBe(1);
  });

  it("retries GET requests on network errors", async () => {
    const state = sequence("/sites", [() => HttpResponse.error()]);

    const { client } = createTestClient();
    await expect(client.request("/sites")).resolves.toEqual({ ok: true });
    expect(state.calls).toBe(2);
  });

  it("does not retry 4xx errors", async () => {
    const state = sequence("/sites", [
      () => HttpResponse.json(webflowError("resource_not_found", "Nope"), { status: 404 }),
    ]);

    const { client } = createTestClient();
    await expect(client.request("/sites")).rejects.toMatchObject({ status: 404 });
    expect(state.calls).toBe(1);
  });
});

describe("abort", () => {
  it("stops waiting for Retry-After when the signal aborts", async () => {
    sequence("/sites", [() => rateLimited({ "retry-after": "30" })]);

    // Real sleep here, so the abort has something to interrupt.
    const client = createWebflowClient({ token: TEST_TOKEN });
    const controller = new AbortController();
    const pending = client.request("/sites", { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("cancelled")), 20);

    await expect(pending).rejects.toThrow("cancelled");
  });

  it("does not wrap aborted fetches as network errors", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const { client } = createTestClient();

    const error = await client.request("/sites", { signal: controller.signal }).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(WebflowNetworkError);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("60")).toBe(60_000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("1.5")).toBe(1500);
  });

  it("parses HTTP dates relative to now", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    expect(parseRetryAfter("Tue, 20 Oct 2026 10:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("Tue, 20 Oct 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("ignores missing or invalid values", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("backoffDelay", () => {
  const options = { baseDelayMs: 500, maxDelayMs: 10_000 };

  it("keeps at least half of the ceiling and caps at maxDelayMs", () => {
    expect(backoffDelay(0, options, () => 0)).toBe(250);
    expect(backoffDelay(0, options, () => 1)).toBe(500);
    expect(backoffDelay(10, options, () => 1)).toBe(10_000);
  });
});
