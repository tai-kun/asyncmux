import { defineConfig } from "vitest/config";
import isDebugMode from "./_is-debug-mode.js";

export default defineConfig({
  esbuild: {
    target: [
      "es2020",
      "node22",
    ],
  },
  define: {
    __DEBUG__: String(isDebugMode()),
    __CLIENT__: "false",
    __SERVER__: "true",
  },
  test: {
    include: [
      "tests/**/*.test.ts",
    ],
    exclude: [
      "tests/**/*.client.test.ts",
    ],
  },
});
