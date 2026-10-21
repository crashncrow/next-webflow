import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/edge/**", "test/contract/**"],
          environment: "node",
          setupFiles: ["test/setup.ts"],
        },
      },
      {
        test: {
          // Runs runtime modules with edge globals only (no MSW: it patches Node's fetch).
          name: "edge",
          include: ["test/edge/**/*.test.ts"],
          environment: "edge-runtime",
        },
      },
      {
        test: {
          // Hits the real API of the TEST site. Skipped unless WEBFLOW_CONTRACT=1.
          // Credentials come from .env.local (git-ignored); only this project loads them.
          name: "contract",
          include: ["test/contract/**/*.test.ts"],
          environment: "node",
          env: loadEnv("contract", process.cwd(), "WEBFLOW_"),
          testTimeout: 60_000,
        },
      },
    ],
  },
});
