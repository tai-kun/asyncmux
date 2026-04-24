import { LockReleasedError } from "./errors.js";

// 獲得したロックを解除するためのオブジェクトです。
// `using` 構文を使うか、このオブジェクトの `release` メソッドを呼び出すことで、獲得したロックが解除されます。
export default class AsyncmuxLock {
  /**
   * ロックを解放するための関数を保持します。すでに解放されている場合は `null` になります。
   */
  #releaseFn: (() => void) | null;

  /**
   * @internal インスタンスを初期化します。
   * @param releaseFn ロックを解放する際に実行されるコールバック関数です。
   */
  public constructor(releaseFn: () => void) {
    this.#releaseFn = releaseFn;
  }

  public get released(): boolean {
    return !!this.#releaseFn;
  }

  public release(): void {
    // すでに解放関数が null の場合は、二重解放とみなしてエラーを投げます。
    if (!this.#releaseFn) {
      throw new LockReleasedError();
    }

    try {
      // 登録された解放処理（内部的な状態更新）を実行します。
      this.#releaseFn();
    } finally {
      // 再実行を防ぐために確実に null を代入します。
      this.#releaseFn = null;
    }
  }

  public [Symbol.dispose](): void {
    // すでに解放済みの場合は何もしません。
    if (!this.#releaseFn) {
      return;
    }

    this.release();
  }
}
