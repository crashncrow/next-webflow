/** Base class for every error thrown by next-webflow. */
export class WebflowError extends Error {
  override name = "WebflowError";
}

/** Invalid or missing configuration (e.g. no API token). */
export class WebflowConfigError extends WebflowError {
  override name = "WebflowConfigError";
}

/** The request never got an HTTP response (DNS, connection reset, aborted...). */
export class WebflowNetworkError extends WebflowError {
  override name = "WebflowNetworkError";
}

export interface WebflowApiErrorInit {
  status: number;
  message: string;
  code?: string | undefined;
  details?: unknown[] | undefined;
  externalReference?: string | null | undefined;
  method: string;
  url: string;
}

/** The API answered with a non-2xx status. Body follows Webflow's `{ code, message, details }` shape. */
export class WebflowApiError extends WebflowError {
  override name = "WebflowApiError";
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown[];
  readonly externalReference: string | null;
  readonly method: string;
  readonly url: string;

  constructor(init: WebflowApiErrorInit) {
    super(`${init.message} (${init.method} ${init.url} → ${init.status})`);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.externalReference = init.externalReference ?? null;
    this.method = init.method;
    this.url = init.url;
  }
}

/** 400 `bad_request`. */
export class WebflowBadRequestError extends WebflowApiError {
  override name = "WebflowBadRequestError";
}

/** 401 `not_authorized`: missing or invalid token. */
export class WebflowUnauthorizedError extends WebflowApiError {
  override name = "WebflowUnauthorizedError";
}

/** 403: the token lacks the required scope (e.g. `cms:read`). */
export class WebflowForbiddenError extends WebflowApiError {
  override name = "WebflowForbiddenError";
}

/** 404 `resource_not_found`. */
export class WebflowNotFoundError extends WebflowApiError {
  override name = "WebflowNotFoundError";
}

/** 409 `conflict`. */
export class WebflowConflictError extends WebflowApiError {
  override name = "WebflowConflictError";
}

export interface WebflowRateLimitErrorInit extends WebflowApiErrorInit {
  retryAfterMs: number | undefined;
  limit: number | undefined;
  remaining: number | undefined;
}

/** 429 `too_many_requests`, thrown once retries are exhausted or `Retry-After` exceeds `maxRetryAfterMs`. */
export class WebflowRateLimitError extends WebflowApiError {
  override name = "WebflowRateLimitError";
  readonly retryAfterMs: number | undefined;
  readonly limit: number | undefined;
  readonly remaining: number | undefined;

  constructor(init: WebflowRateLimitErrorInit) {
    super(init);
    this.retryAfterMs = init.retryAfterMs;
    this.limit = init.limit;
    this.remaining = init.remaining;
  }
}

/** 5xx. */
export class WebflowServerError extends WebflowApiError {
  override name = "WebflowServerError";
}

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  externalReference?: unknown;
}

/** Builds the typed error for a non-2xx response. `bodyText` may be empty or non-JSON. */
export function createApiError(
  response: Response,
  bodyText: string,
  request: { method: string; url: string },
  retryAfterMs: number | undefined,
): WebflowApiError {
  let body: ErrorBody = {};
  try {
    const parsed: unknown = bodyText ? JSON.parse(bodyText) : {};
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    // Non-JSON error body (e.g. a proxy HTML page): fall back to the status text.
  }

  const init: WebflowApiErrorInit = {
    status: response.status,
    message:
      typeof body.message === "string" && body.message
        ? body.message
        : response.statusText || `HTTP ${response.status}`,
    code: typeof body.code === "string" ? body.code : undefined,
    details: Array.isArray(body.details) ? body.details : undefined,
    externalReference: typeof body.externalReference === "string" ? body.externalReference : null,
    method: request.method,
    url: request.url,
  };

  switch (response.status) {
    case 400:
      return new WebflowBadRequestError(init);
    case 401:
      return new WebflowUnauthorizedError(init);
    case 403:
      return new WebflowForbiddenError(init);
    case 404:
      return new WebflowNotFoundError(init);
    case 409:
      return new WebflowConflictError(init);
    case 429:
      return new WebflowRateLimitError({
        ...init,
        retryAfterMs,
        limit: parseIntHeader(response.headers.get("x-ratelimit-limit")),
        remaining: parseIntHeader(response.headers.get("x-ratelimit-remaining")),
      });
    default:
      return response.status >= 500 ? new WebflowServerError(init) : new WebflowApiError(init);
  }
}

function parseIntHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
