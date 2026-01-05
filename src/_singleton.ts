import { isPromiseLike } from "@tai-kun/is-promise-like";

declare global {
  /**
   * 一度だけ実行される関数の結果をキャッシュするためのグローバル変数です。
   */
  var asyncmux__singleton: Map<unknown, any> | undefined;
}

/**
 * 一度だけ実行されることを保証する関数です。
 *
 * `key` に紐づく関数 `fn` の実行結果をキャッシュし、同じ `key` で複数回呼び出された場合でも、関数が再度実行されることなくキャッシュされた結果を返します。関数が Promise を返す場合は、Promise の解決または拒否を待ってからキャッシュします。
 *
 * @template T 実行する関数の返り値の型です。
 * @param key キャッシュを一意に識別するための識別子です。
 * @param fn 一度だけ実行したい関数です。
 * @returns 関数の実行結果、またはそれが Promise を返す場合はその Promise を返します。
 */
export default function singleton<T>(key: unknown, fn: (...args: any) => T): T | Awaited<T> {
  const cache = globalThis.asyncmux__singleton ||= new Map<unknown, any>();
  if (cache.has(key)) {
    return cache.get(key);
  }

  let returns = fn();
  if (isPromiseLike<T>(returns)) {
    const promise = (async () => {
      try {
        const value = await returns;
        cache.set(key, value);
        return value;
      } catch (ex) {
        // エラーが発生した場合はキャッシュを削除し、エラーを投げます。
        cache.delete(key);
        throw ex;
      }
    })();
    cache.set(key, promise);
  } else {
    cache.set(key, returns);
  }

  return cache.get(key);
}
