import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/edge/**"],
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
    ],
  },
});
