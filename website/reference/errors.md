# エラー {#errors}

`asyncmux` のカスタムエラークラスは多言語対応（i18n）を前提とした設計になっており、`i18n-error-base` をベースに構築されています。

## `ErrorBase` {#error-base}

すべての `asyncmux` エラーの基底クラスです。`i18n-error-base` の `I18nErrorBase` を継承し、メタデータ付きエラーおよび多言語メッセージをサポートします。

## `UnreachableError` {#unreachable-error}

「到達不可能なコード」に到達した場合に使用されるエラーです。主に網羅性チェック（`never` 型）や exhaustive switch の保証に使用されます。

### メタデータ {#unreachable-metadata}

```ts
{
  value?: unknown;
}
```

`value`

- **型**: `unknown`

到達しないはずの値です。

### 対処 {#unreachable-troubleshooting}

このエラーが実行時に発生する場合、ユーザーが `asyncmux` を型安全でない使い方をしているか、`asyncmux` のバグの可能性があります。

## `DecoratorSupportError` {#decorator-support-error}

実行環境がステージ 3 のデコレーターをサポートしていない場合に投げられるエラーです。

### 対処 {#decorator-support-troubleshooting}

ステージ 3 のデコレーターをサポートしている実行環境、またはそれを再現した実装を用意する必要があります。

## `LockEscalationError` {#lock-escalation-error}

ロックの昇格（read → write）を試みた場合に投げられるエラーです。

### 対処 {#lock-escalation-troubleshooting}

これはデッドロック防止のための設計制約です。以下を検討してください。

- 実装を見直す
- 並列実行可能な部分を切り出す
