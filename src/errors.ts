import { type ErrorMeta, I18nErrorBase, initErrorMessage, setErrorMessage } from "i18n-error-base";

/***************************************************************************************************
 *
 * ユーティリティー
 *
 **************************************************************************************************/

/**
 * あらゆる値を文字列に整形します。
 *
 * @param value 文字列に整形する値です。
 * @returns 文字列に整形された値です。
 */
export function formatErrorValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/***************************************************************************************************
 *
 * エラークラス
 *
 **************************************************************************************************/

/**
 * Asyncmux エラーの基底クラスです。
 *
 * @template TMeta エラーに紐づくメタデータです。
 */
export class ErrorBase<TMeta extends ErrorMeta | undefined = undefined>
  extends I18nErrorBase<TMeta>
{}

/**************************************************************************************************/

/**
 * 到達不能なコードに到達した場合に投げられるエラーです。
 */
export class UnreachableError extends ErrorBase<{
  /**
   * 到達しないはずの値です。
   */
  value?: unknown;
}> {
  static {
    this.prototype.name = "AsyncmuxUnreachableError";
  }

  /**
   * `AsyncmuxUnreachableError` クラスの新しいインスタンスを初期化します。
   *
   * @param args 到達しないはずの値があれば指定します。
   * @param options エラーのオプションです。
   */
  public constructor(args: [never?], options?: ErrorOptions | undefined) {
    super(options, args.length > 0 ? { value: args[0] } : {});
    initErrorMessage(this, ({ meta }) => (
      "value" in meta
        ? "Encountered impossible value: " + formatErrorValue(meta.value)
        : "Unreachable code reached"
    ));
  }
}

/*#__PURE__*/ setErrorMessage(
  UnreachableError,
  ({ meta }) => (
    "value" in meta
      ? "不可能な値に遭遇しました: " + formatErrorValue(meta.value)
      : "到達できないコードに到達しました"
  ),
  "ja",
);

/**************************************************************************************************/

/**
 * ステージ 3 のデコレーターがサポートされていないと判定された場合に投げられるエラーです。
 */
export class DecoratorSupportError extends ErrorBase {
  static {
    this.prototype.name = "AsyncmuxDecoratorSupportError";
  }

  /**
   * `AsyncmuxDecoratorSupportError` クラスの新しいインスタンスを初期化します。
   *
   * @param options エラーのオプションです。
   */
  public constructor(options?: ErrorOptions | undefined) {
    super(options, undefined);
    initErrorMessage(this, () => "Requires Stage 3 decorator support");
  }
}

/*#__PURE__*/ setErrorMessage(
  DecoratorSupportError,
  () => "ステージ 3 のデコレーターのサポートが必要です",
  "ja",
);

/**************************************************************************************************/

/**
 * ロックの昇格しようとした場合に投げられるエラーです。
 */
export class LockEscalationError extends ErrorBase {
  static {
    this.prototype.name = "AsyncmuxLockEscalationError";
  }

  /**
   * `AsyncmuxLockEscalationError` クラスの新しいインスタンスを初期化します。
   *
   * @param options エラーのオプションです。
   */
  public constructor(options?: ErrorOptions | undefined) {
    super(options, undefined);
    initErrorMessage(
      this,
      () => "Lock Escalation is not allowed: Cannot acquire a write lock while holding a read lock",
    );
  }
}

/*#__PURE__*/ setErrorMessage(
  LockEscalationError,
  () =>
    "ロックの昇格は許可されていません: 読み取りロックを保持している間は書き込みロックを取得できません",
  "ja",
);
