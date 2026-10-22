export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** Caps how many tasks run at once. A finished task hands its slot straight to the next queued one. */
export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }

  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  };

  const release = (): void => {
    const next = queue.shift();
    if (next) next();
    else active--;
  };

  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
