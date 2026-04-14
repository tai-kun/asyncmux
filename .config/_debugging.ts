import { configureSync, getConsoleSink } from "@logtape/logtape";

import pkg from "../package.json";

// @ts-expect-error
if (__DEBUG__) {
  configureSync({
    sinks: {
      console: getConsoleSink(),
    },
    loggers: [
      {
        category: pkg.name,
        sinks: ["console"],
        lowestLevel: "trace",
      },
    ],
  });
}
