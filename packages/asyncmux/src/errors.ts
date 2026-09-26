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

  public constructor(options?: ErrorOptions) {
    super("Lock id already released", options);
  }
}

setErrorMessage(LockReleasedError, "ロックはすでに解放済みです。", "ja");

// -------------------------------------------------------------------------------------------------

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/errors.html#reentrant-lock-error)
 */
export class ReentrantLockError extends ErrorBase<undefined> {
  static {
    this.prototype.name = "AsyncmuxReentrantLockError";
  }

  public constructor(options?: ErrorOptions) {
    super("Cannot acquire a lock while the same lock is already held", options);
  }
}

setErrorMessage(ReentrantLockError, "保持中のロックを再度獲得することはできません", "ja");
