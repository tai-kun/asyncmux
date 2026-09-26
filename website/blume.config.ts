import { defineConfig } from "blume";

export default defineConfig({
  content: {
    root: "content",
  },

  title: "asyncmux",
  description: "Documentation for asyncmux",
  deployment: {
    site: "https://tai-kun.github.io",
    base: "/asyncmux",
  },
  navigation: {
    repo: "https://github.com/tai-kun/asyncmux",
  },
  // 空のロケールを設定し、それをデフォルト値にしないと、トップレベルのページが無いコンテンツのルーティングができません。
  // 空のロケールの選択肢は theme.css で消しています。
  i18n: {
    locales: [
      {
        code: "ja",
        label: "日本語",
      },
      {
        code: "en",
        label: "English",
      },
      {
        code: " ",
        label: "",
      },
    ],
    defaultLocale: " ",
  },
  // versions: {
  //   current: {
  //     label: "Latest",
  //   },
  //   archived: [
  //     {
  //       id: "v0",
  //     },
  //   ],
  // },
});
