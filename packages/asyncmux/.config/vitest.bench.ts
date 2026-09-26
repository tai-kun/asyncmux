import { defineConfig } from "vitest/config";

import proposalDecorators from "./_proposal-decorators.js";

export default defineConfig({
  plugins: [proposalDecorators()],
  oxc: {
    target: "es2020",
  },
  test: {
    include: ["benchmarks/**/*.bench.ts"],
  },
});
