import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "asyncmux",

  rewrites: {
    "ja/:rest*": ":rest*",
  },

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    socialLinks: [
      { icon: "github", link: "https://github.com/tai-kun/asyncmux" },
    ],
  },

  locales: {
    root: {
      lang: "ja",
      label: "日本語",
      description: "非同期処理を用いた相互排他のためのユーティリティー",
      themeConfig: {
        nav: [
          { text: "ガイド", link: "/guide/getting-started" },
          { text: "リファレンス", link: "/reference/class-method-utilities" },
        ],
        sidebar: {
          "/guide/": [
            {
              text: "導入",
              items: [
                { text: "asyncmux とは？", link: "/guide/what-is-asyncmux" },
                { text: "はじめに", link: "/guide/getting-started" },
              ],
            },
          ],
          "/reference/": [
            {
              text: "API",
              items: [
                { text: "クラスメソッド", link: "/reference/class-method-utilities" },
                { text: "汎用 API", link: "/reference/general-utilities" },
                { text: "エラー", link: "/reference/errors" },
              ],
            },
          ],
        },
      },
    },

    en: {
      lang: "en",
      label: "English",
      description: "A utility for mutual exclusion using asynchronous processing",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/en/guide/getting-started" },
          { text: "Reference", link: "/en/reference/class-method-utilities" },
        ],
        sidebar: {
          "/en/guide/": [
            {
              text: "Guide",
              items: [
                { text: "What is asyncmux?", link: "/en/guide/what-is-asyncmux" },
                { text: "Getting Started", link: "/en/guide/getting-started" },
              ],
            },
          ],
          "/en/reference/": [
            {
              text: "API",
              items: [
                { text: "Class method", link: "/en/reference/class-method-utilities" },
                { text: "General API", link: "/en/reference/general-utilities" },
                { text: "Errors", link: "/en/reference/errors" },
              ],
            },
          ],
        },
      },
    },
  },
});
