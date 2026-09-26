/**
 * 非同期コンテキストに値を関連付けるためのストレージです。
 */
export interface AsyncContextStorage<TStore> {
  /**
   * 現在の非同期コンテキストに関連付けられた値を取得します。
   *
   * @returns 関連付けられた値です。関連付けられていない場合は `undefined` です。
   */
  getStore(): TStore | undefined;

  /**
   * 指定された値を関連付けたコンテキストでコールバック関数を実行します。
   *
   * @param store 関連付ける値です。
   * @param callback 実行するコールバック関数です。
   * @returns コールバック関数の戻り値です。
   */
  run<TResult>(store: TStore, callback: () => TResult): TResult;

  /**
   * 現在の非同期コンテキストに関連付ける値を、以降の非同期処理も含めて変更します。
   *
   * @param store 関連付ける値です。
   */
  enterWith(store: TStore): void;
}

/**
 * `node:async_hooks` の AsyncLocalStorage を利用して、非同期コンテキスト用のストレージを作成します。
 *
 * `process.getBuiltinModule` を利用できない環境ではストレージを作成せず、`undefined` を返します。
 *
 * @returns 作成したストレージです。作成できなかった場合は `undefined` です。
 */
export function createAsyncContextStorage<TStore>(): AsyncContextStorage<TStore> | undefined {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
    const asyncHooks = proc?.getBuiltinModule?.("node:async_hooks") as
      | {
          AsyncLocalStorage: new () => AsyncContextStorage<TStore>;
        }
      | undefined;

    if (asyncHooks && typeof asyncHooks.AsyncLocalStorage === "function") {
      return new asyncHooks.AsyncLocalStorage();
    }
  } catch {
    // node:async_hooks を利用できない環境ではストレージを作成しません。
  }

  return undefined;
}
