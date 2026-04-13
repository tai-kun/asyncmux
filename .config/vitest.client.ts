import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import isDebugMode from "./_is-debug-mode";
import proposalDecorators from "./_proposal-decorators";

export default defineConfig({
  plugins: [proposalDecorators()],
  oxc: {
    target: "es2020",
  },
  define: {
    __DEBUG__: `${isDebugMode}`,
    __CLIENT__: "true",
    __SERVER__: "false",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.server.test.ts"],
    browser: {
      provider: playwright(),
      enabled: true,
      headless: true,
      instances: [
        { browser: "chromium" },
        { browser: "firefox" },
        // 未対応
        // { browser: "webkit" },
      ],
    },
  },
});
