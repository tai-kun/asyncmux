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

## `ReentrantLockError` {#reentrant-lock-error}

デッドロックになるロックの再入 (再獲得) を検出した場合に投げられるエラーです。書き込みロックを保持しているクラスメソッドの実行中に、同じインスタンスに対して書き込みロックまたは読み取りロックを要求した場合や、読み取りロックを保持している状態で書き込みロックを要求した場合に投げられます。

### 対処 {#reentrant-lock-troubleshooting}

同じインスタンスのロック対象メソッド内から、そのインスタンスに対する書き込みロックを要求しないでください。読み取りロック同士の呼び出し (`@asyncmux.readonly` が付与されたメソッド内での `@asyncmux.readonly` が付与されたメソッドの呼び出し) は共有ロックとして許可されます。

::: info
非同期処理コンテキストを利用できるランタイム (Node.js 22.3 以上、Bun など) では await をまたいだ再入も検出されますが、ブラウザーなど利用できない環境では同期的な呼び出し範囲のみ検出され、それ以外の再入はエラーにならずデッドロックします。
:::
