import { ENV, WEBFLOW_CLI_TOKEN_ENV, readEnv } from "./env";
import {
  WebflowApiError,
  WebflowConfigError,
  WebflowError,
  WebflowNetworkError,
  WebflowRateLimitError,
  WebflowServerError,
  createApiError,
} from "./errors";
import { createLimiter } from "./limiter";
import { toSearchParams, type QueryParams } from "./query";
import {
  backoffDelay,
  parseRetryAfter,
  resolveRetryOptions,
  sleep as defaultSleep,
  type RetryOptions,
} from "./retry";

/** `data` = Data API (`api.webflow.com`), `cdn` = Content Delivery API (`api-cdn.webflow.com`, live items only). */
export type WebflowHost = "data" | "cdn";

export const DEFAULT_BASE_URLS: Record<WebflowHost, string> = {
  data: "https://api.webflow.com/v2",
  cdn: "https://api-cdn.webflow.com/v2",
};

/** Webflow caps list endpoints at 100 items per request. */
export const MAX_PAGE_SIZE = 100;

/**
 * Default cap on in-flight requests per client. Cloudflare Workers (Webflow Cloud)
 * allow 6 concurrent outbound requests, so this stays below that.
 */
export const DEFAULT_CONCURRENCY = 4;

export interface WebflowClientConfig {
  /** API token. Defaults to `WEBFLOW_CMS_TOKEN`, read lazily on the first request. */
  token?: string | undefined;
  /** Custom `fetch`. Defaults to the global one (which Next.js patches for caching). */
  fetch?: typeof fetch | undefined;
  /** Override API base URLs, e.g. for a proxy. */
  baseUrls?: Partial<Record<WebflowHost, string>> | undefined;
  /** Retry policy for 429, 5xx and network errors. `false` disables retries. */
  retry?: RetryOptions | false | undefined;
  /** Max concurrent requests issued by this client. Default `4`. */
  concurrency?: number | undefined;
  /** Called after every response (including retried ones), e.g. to watch response sizes. */
  onResponse?: ((info: ResponseInfo) => void) | undefined;
}

export interface ResponseInfo {
  method: string;
  url: string;
  status: number;
  /** Body length in characters (≈ bytes for the API's JSON). */
  bytes: number;
  init: FetchInit | undefined;
}

/** Extra `fetch` options passed through untouched, e.g. Next.js `{ cache, next: { tags } }`. */
export type FetchInit = Omit<RequestInit, "method" | "body" | "signal"> & Record<string, unknown>;

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod | undefined;
  host?: WebflowHost | undefined;
  query?: QueryParams | undefined;
  /** JSON-serialized request body. */
  body?: unknown;
  signal?: AbortSignal | undefined;
  init?: FetchInit | undefined;
}

export interface WebflowPagination {
  limit: number;
  offset: number;
  total: number;
}

export interface WebflowListResponse<T> {
  items: T[];
  pagination: WebflowPagination;
}

export interface PaginateOptions extends Omit<RequestOptions, "method" | "body"> {
  /** Max number of items to return. Default: all of them. */
  limit?: number | undefined;
  /** Number of items to skip. Default `0`. */
  offset?: number | undefined;
}

export interface PaginateResult<T> {
  items: T[];
  /** Total items in the collection (for the given filters), as reported by the API. */
  total: number;
}

export interface WebflowClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  /** Fetches every page of a list endpoint (`{ items, pagination }`), in parallel up to `concurrency`. */
  paginate<T>(path: string, options?: PaginateOptions): Promise<PaginateResult<T>>;
}

/** @internal Hooks to make retry timing deterministic in tests. */
export interface ClientInternals {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["GET", "PUT", "DELETE"]);

export function createWebflowClient(
  config: WebflowClientConfig = {},
  internals: ClientInternals = {},
): WebflowClient {
  const retry = resolveRetryOptions(config.retry);
  const limiter = createLimiter(config.concurrency ?? DEFAULT_CONCURRENCY);
  const baseUrls = { ...DEFAULT_BASE_URLS, ...config.baseUrls };
  const sleep = internals.sleep ?? defaultSleep;
  const random = internals.random ?? Math.random;

  const resolveToken = (): string => {
    const token = config.token ?? readEnv(ENV.cmsToken);
    if (!token) {
      throw new WebflowConfigError(
        `Missing Webflow API token. Set ${ENV.cmsToken} (a site token with CMS: Read) or pass \`token\` to the client.` +
          (readEnv(WEBFLOW_CLI_TOKEN_ENV)
            ? ` ${WEBFLOW_CLI_TOKEN_ENV} is set but next-webflow doesn't read it: it's the Webflow CLI's variable (a workspace token).`
            : ""),
      );
    }
    return token;
  };

  const resolveFetch = (): typeof fetch => {
    // Resolved per request so Next.js' patched global fetch is picked up.
    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new WebflowConfigError("No global fetch available. Pass `fetch` to the client.");
    }
    return fetchImpl;
  };

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = buildUrl(baseUrls[options.host ?? "data"], path, options.query);
    const token = resolveToken();
    const fetchImpl = resolveFetch();

    const headers = new Headers(options.init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");
    if (options.body !== undefined) headers.set("content-type", "application/json");

    const init: RequestInit = {
      ...options.init,
      method,
      headers,
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      ...(options.signal && { signal: options.signal }),
    };

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < retry.maxRetries;
      let response: Response;
      let bodyText: string;

      try {
        // The slot is held while the body downloads, but released before any retry wait.
        [response, bodyText] = await limiter.run(async () => {
          const res = await fetchImpl(url, init);
          return [res, await res.text()] as const;
        });
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        if (canRetry && IDEMPOTENT_METHODS.has(method)) {
          await sleep(backoffDelay(attempt, retry, random), options.signal);
          continue;
        }
        throw new WebflowNetworkError(`Request failed: ${method} ${url}`, { cause });
      }

      config.onResponse?.({ method, url, status: response.status, bytes: bodyText.length, init: options.init });
      if (response.ok) return parseBody<T>(bodyText, method, url);

      const retryAfterMs =
        response.status === 429 ? parseRetryAfter(response.headers.get("retry-after")) : undefined;
      const error = createApiError(response, bodyText, { method, url }, retryAfterMs);
      const delay = canRetry ? retryDelay(error, method, attempt) : undefined;
      if (delay === undefined) throw error;
      await sleep(delay, options.signal);
    }
  }

  /** Milliseconds to wait before retrying, or `undefined` if the error is final. */
  function retryDelay(error: WebflowApiError, method: string, attempt: number): number | undefined {
    if (error instanceof WebflowRateLimitError) {
      // A 429 means the request was not processed, so any method is safe to retry.
      if (error.retryAfterMs === undefined) return backoffDelay(attempt, retry, random);
      return error.retryAfterMs <= retry.maxRetryAfterMs ? error.retryAfterMs : undefined;
    }
    if (error instanceof WebflowServerError && IDEMPOTENT_METHODS.has(method)) {
      return backoffDelay(attempt, retry, random);
    }
    return undefined;
  }

  async function paginate<T>(path: string, options: PaginateOptions = {}): Promise<PaginateResult<T>> {
    const { limit, offset = 0, ...requestOptions } = options;
    assertNonNegativeInteger("offset", offset);
    if (limit !== undefined) assertNonNegativeInteger("limit", limit);
    if (limit === 0) return { items: [], total: 0 };

    const pageSize = Math.min(MAX_PAGE_SIZE, limit ?? MAX_PAGE_SIZE);
    const fetchPage = (pageOffset: number, pageLimit: number, signal?: AbortSignal) =>
      request<WebflowListResponse<T>>(path, {
        ...requestOptions,
        signal,
        query: { ...requestOptions.query, offset: pageOffset, limit: pageLimit },
      });

    const first = await fetchPage(offset, pageSize, requestOptions.signal);
    const total = first.pagination.total;
    const end = Math.min(total, limit === undefined ? Infinity : offset + limit);

    const rest: Array<[number, number]> = [];
    for (let pageOffset = offset + pageSize; pageOffset < end; pageOffset += pageSize) {
      rest.push([pageOffset, Math.min(pageSize, end - pageOffset)]);
    }

    let pages: T[][] = [];
    if (rest.length > 0) {
      // Abort sibling pages as soon as one fails, so a 401/404 doesn't keep spending rate limit.
      const controller = new AbortController();
      const signal = requestOptions.signal
        ? AbortSignal.any([requestOptions.signal, controller.signal])
        : controller.signal;
      try {
        pages = (
          await Promise.all(
            rest.map(([pageOffset, pageLimit]) => fetchPage(pageOffset, pageLimit, signal)),
          )
        ).map((page) => page.items);
      } catch (error) {
        controller.abort();
        throw error;
      }
    }

    const items = [first.items, ...pages].flat();
    return { items: limit === undefined ? items : items.slice(0, limit), total };
  }

  return { request, paginate };
}

function buildUrl(baseUrl: string, path: string, query: QueryParams | undefined): string {
  const url = `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const search = query ? toSearchParams(query).toString() : "";
  return search ? `${url}?${search}` : url;
}

function parseBody<T>(bodyText: string, method: string, url: string): T {
  if (!bodyText) return undefined as T;
  try {
    return JSON.parse(bodyText) as T;
  } catch (cause) {
    throw new WebflowError(`Invalid JSON in response: ${method} ${url}`, { cause });
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}
