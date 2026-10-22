export interface RetryOptions {
  /** Retries after the first attempt. Default `3`. */
  maxRetries?: number;
  /** Base delay for exponential backoff. Default `500` ms. */
  baseDelayMs?: number;
  /** Cap for a single backoff delay. Default `10_000` ms. */
  maxDelayMs?: number;
  /**
   * Longest `Retry-After` the client is willing to wait. If a 429 asks for longer,
   * a `WebflowRateLimitError` is thrown immediately instead. Default `60_000` ms
   * (Webflow usually answers 60 s).
   */
  maxRetryAfterMs?: number;
}

export type ResolvedRetryOptions = Required<RetryOptions>;

export const DEFAULT_RETRY: ResolvedRetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  maxRetryAfterMs: 60_000,
};

export function resolveRetryOptions(options: RetryOptions | false | undefined): ResolvedRetryOptions {
  if (options === false) return { ...DEFAULT_RETRY, maxRetries: 0 };
  const resolved = { ...DEFAULT_RETRY, ...stripUndefined(options ?? {}) };
  if (!Number.isInteger(resolved.maxRetries) || resolved.maxRetries < 0) {
    throw new RangeError("retry.maxRetries must be a non-negative integer");
  }
  return resolved;
}

/** Parses `Retry-After` (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Exponential backoff with "equal jitter": half fixed, half random, so delays never collapse to 0. */
export function backoffDelay(
  attempt: number,
  options: Pick<ResolvedRetryOptions, "baseDelayMs" | "maxDelayMs">,
  random: () => number,
): number {
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
