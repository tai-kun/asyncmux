// 獲得したロックを解除するためのオブジェクトです。
// `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
export default class AsyncmuxLock implements Disposable {
  /**
   * ロックしている `Promise` オブジェクトを解除する関数です。
   */
  #resolve: () => void;

  /**
   * `unlock` メソッドが呼び出されたかどうがのフラグです。
   */
  #unlockCalled: boolean;

  /**
   * `AsyncmuxLock` クラスの新しいインスタンスを初期化します。
   *
   * @internal
   * @param resolve ロックしている `Promise` オブジェクトを解除する関数です。
   */
  public constructor(resolve: () => void) {
    this.#resolve = resolve;
    this.#unlockCalled = false;
  }

  public unlock(): void {
    this.#unlockCalled = true;
    this.#resolve();
  }

  public [Symbol.dispose](): void {
    if (this.#unlockCalled) {
      return;
    }

    this.#resolve();
  }
}
