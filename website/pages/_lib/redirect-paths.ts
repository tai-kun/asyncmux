import type { BlumeData } from "blume";

/** リダイレクトページが受け取る props です。 */
export interface RedirectPathProps {
  /** 転送先の候補になるロケールです。設定順に並びます。 */
  locales: string[];
}

/** ロケールなしの URL からロケール付きの URL へ転送するページです。 */
export interface RedirectPath {
  params: {
    /** ベースパスを含むルートパラメーターです。空の場合はサイトのルートです。 */
    slug: string | undefined;
  };
  props: RedirectPathProps;
}

/**
 * Blume がトップレベルのコンテンツをルーティングするために設定する、空白だけのプレースホルダーロケールかどうかを判定します。
 */
const isPlaceholderLocale = (code: string): boolean => code.trim() === "";

/**
 * ロケールなしの URL (`/rest`、`/version/rest`) を、Blume が生成します。
 * ロケール付きの URL (`/locale/rest`、`/locale/version/rest`) へ転送します。
 * リダイレクトページの一覧を作成します。
 *
 * 各ページの `locales` には、その URL に対応するページを配信している
 * ロケールだけを設定順で渡します。これにより、クライアント側は訪問者の
 * 言語に合うロケールを選んでから転送できます。
 */
export const getRedirectPaths = (data: BlumeData): RedirectPath[] => {
  const { basePath, i18n, versions } = data.config;
  if (!i18n) {
    return [];
  }

  const locales = i18n.locales
    .map((locale) => locale.code)
    .filter((code) => !isPlaceholderLocale(code));
  const localeSet = new Set(locales);
  const versionIds = new Set(versions?.archived.map((version) => version.id) ?? []);

  // 同じロケールなし URL が複数のロケールから参照されるため、slug ごとにロケールを集約します。
  const localesBySlug = new Map<string, Set<string>>();
  for (const route of data.routes) {
    // サイドバー非表示のページにはリダイレクトページを作りません。
    // `indexable` は検索の有効・無効にも左右されるため、判定には使いません。
    if (route.hidden || !route.path.startsWith(basePath)) {
      continue;
    }

    const segments = route.path.slice(basePath.length).split("/").filter(Boolean);
    const locale = segments.shift();
    if (locale === undefined || !localeSet.has(locale)) {
      continue;
    }

    // バージョンはロケールの直後に付きます。設定済みの ID と完全一致した場合だけをバージョンとして扱い、`videos` のようなページ名と取り違えないようにします。
    let version = "";
    if (segments[0] !== undefined && versionIds.has(segments[0])) {
      version = segments.shift() ?? "";
    }

    const slug = [version, ...segments].filter(Boolean).join("/");
    const slugLocales = localesBySlug.get(slug) ?? new Set<string>();
    slugLocales.add(locale);
    localesBySlug.set(slug, slugLocales);
  }

  const prefix = basePath.replace(/^\//, "");
  const toSlug = (slug: string): string | undefined =>
    [prefix, slug].filter(Boolean).join("/") || undefined;
  const toPath = (slug: string): string => {
    const path = toSlug(slug);
    return path === undefined ? "/" : `/${path}`;
  };

  // 実在するページと同じ URL にはリダイレクトページを作りません。
  // プレースホルダーロケールがトップレベルのコンテンツを配信している場合、その URL はロケールなしの URL と一致します。
  const taken = new Set(data.routes.map((route) => route.path));

  return [...localesBySlug]
    .filter(([slug]) => !taken.has(toPath(slug)))
    .map(([slug, slugLocales]) => ({
      params: {
        slug: toSlug(slug),
      },
      props: {
        locales: locales.filter((code) => slugLocales.has(code)),
      },
    }));
};
