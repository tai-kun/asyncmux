import { defineConfig } from "vitest/config";

import isDebugMode from "./_is-debug-mode.js";
import proposalDecorators from "./_proposal-decorators.js";

export default defineConfig({
  plugins: [proposalDecorators()],
  oxc: {
    target: "es2020",
  },
  define: {
    __DEBUG__: `${isDebugMode}`,
    __CLIENT__: "false",
    __SERVER__: "true",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.client.test.ts"],
    setupFiles: [".config/_debugging.ts"],
  },
});
