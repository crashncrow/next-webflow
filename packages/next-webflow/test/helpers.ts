import { createWebflowClient, type WebflowClientConfig } from "../src/core";
import { TEST_TOKEN } from "./msw";

/** Client with instant, recorded retry waits and deterministic jitter. */
export function createTestClient(config: WebflowClientConfig = {}, random = () => 0.5) {
  const sleeps: number[] = [];
  const client = createWebflowClient(
    { token: TEST_TOKEN, ...config },
    {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random,
    },
  );
  return { client, sleeps };
}

export function webflowError(code: string, message: string) {
  return { code, message, externalReference: null, details: [] };
}

/** Builds `count` fake items starting at `offset`. */
export function fakeItems(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${offset + index}`,
    fieldData: { name: `Item ${offset + index}`, slug: `item-${offset + index}` },
  }));
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
