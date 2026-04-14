# エラー {#errors}

`asyncmux` のカスタムエラークラスは多言語対応（i18n）を前提とした設計になっており、`i18n-error-base` をベースに構築されています。

## `ErrorBase` {#error-base}

すべての `asyncmux` エラーの基底クラスです。`i18n-error-base` の `I18nErrorBase` を継承し、メタデータ付きエラーおよび多言語メッセージをサポートします。

## `DecoratorSupportError` {#decorator-support-error}

実行環境がステージ 3 のデコレーターをサポートしていない場合に投げられるエラーです。

### 対処 {#decorator-support-troubleshooting}

ステージ 3 のデコレーターをサポートしている実行環境、またはそれを再現した実装を用意する必要があります。

## `LockReleasedError` {#lock-released-error}

すでに解放済みのロックを再度解放を試みた場合に投げられるエラーです。

### 対処 {#lock-released-troubleshooting}

すでに解放済みのロックを再度解放しないようにします。
