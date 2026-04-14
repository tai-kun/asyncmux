import { type ErrorMeta, I18nErrorBase, setErrorMessage } from "i18n-error-base";

// -------------------------------------------------------------------------------------------------
//
// ユーティリティー
//
// -------------------------------------------------------------------------------------------------

export { setErrorMessage };

// -------------------------------------------------------------------------------------------------
//
// エラークラス
//
// -------------------------------------------------------------------------------------------------

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/errors.html#error-base)
 */
export class ErrorBase<
  TMeta extends ErrorMeta | undefined = ErrorMeta | undefined,
> extends I18nErrorBase<TMeta> {}

// -------------------------------------------------------------------------------------------------

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/errors.html#decorator-support-error)
 */
export class DecoratorSupportError extends ErrorBase<undefined> {
  static {
    this.prototype.name = "AsyncmuxDecoratorSupportError";
  }

  /**
   * `AsyncmuxDecoratorSupportError` クラスの新しいインスタンスを初期化します。
   *
   * @param options エラーのオプションです。
   */
  public constructor(options?: ErrorOptions) {
    super("Requires Stage 3 decorator support", options);
  }
}

setErrorMessage(DecoratorSupportError, "ステージ 3 のデコレーターのサポートが必要です", "ja");

// -------------------------------------------------------------------------------------------------

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/errors.html#lock-released-error)
 */
export class LockReleasedError extends ErrorBase<undefined> {
  static {
    this.prototype.name = "AsyncmuxLockReleasedError";
  }

  /**
   * `LockReleasedError` クラスの新しいインスタンスを初期化します。
   *
   * @param options エラーのオプションです。
   */
  public constructor(options?: ErrorOptions) {
    super("Lock id already released", options);
  }
}

setErrorMessage(LockReleasedError, "ロックはすでに解放済みです。", "ja");
