import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/dist/**", "**/coverage/**", "**/.next/**", "spikes/**", ".claude/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Runtime code must stay edge-compatible: no Node built-ins outside the CLI.
    files: ["packages/next-webflow/src/**/*.ts", "packages/next-webflow/src/**/*.tsx"],
    ignores: ["packages/next-webflow/src/cli/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "^node:", message: "Runtime code must be edge-compatible." },
            {
              regex: "^(fs|path|crypto|buffer|stream|http|https|url|util|os|child_process)$",
              message: "Runtime code must be edge-compatible.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Buffer", message: "Runtime code must be edge-compatible." },
      ],
    },
  },
);
