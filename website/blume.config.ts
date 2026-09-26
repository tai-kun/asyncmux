import { defineConfig } from "blume";

export default defineConfig({
  title: "asyncmux",
  description: "Documentation for asyncmux",
  basePath: "/asyncmux",
  content: {
    root: "content",
  },
  navigation: {
    repo: "https://github.com/tai-kun/asyncmux",
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
});
