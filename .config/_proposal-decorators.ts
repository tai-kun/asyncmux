// Vite 8 が使用する oxc がデコレーターをサポートするまでの一時的な処置です。
// https://github.com/vitejs/vite/discussions/21891

import babel from "@rolldown/plugin-babel";
import type { PluginOption } from "vite";

function decoratorPreset(options: Record<string, unknown>) {
  return {
    preset: () => ({
      plugins: [["@babel/plugin-proposal-decorators", options]],
    }),
    rolldown: {
      filter: { code: "@" },
    },
  };
}

export default function proposalDecorators(): PluginOption {
  return babel({
    presets: [decoratorPreset({ version: "2023-11" })],
  });
}
