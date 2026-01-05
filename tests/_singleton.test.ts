import { beforeEach, describe, test } from "vitest";
import singleton from "../src/_singleton.js";

beforeEach(() => {
  // グローバルなキャッシュを初期化する
  globalThis.asyncmux__singleton = undefined;
});

describe("同期関数の場合", () => {
  test("初めて呼び出したとき、関数が実行されてその結果が返る", ({ expect }) => {
    // Arrange
    const key = "sync-key";
    const value = "initial value";
    const fn = () => value;

    // Act
    const result = singleton(key, fn);

    // Assert
    expect(result).toBe(value);
  });

  test("同じキーで複数回呼び出したとき、2 回目以降は関数が実行されずキャッシュされた結果を返す", ({ expect }) => {
    // Arrange
    const key = "sync-duplicate-key";
    let callCount = 0;
    const fn = () => {
      callCount++;
      return "result";
    };

    // Act
    const firstResult = singleton(key, fn);
    const secondResult = singleton(key, fn);

    // Assert
    expect(firstResult).toBe("result");
    expect(secondResult).toBe("result");
    expect(callCount).toBe(1);
  });
});

describe("非同期関数の場合", () => {
  test("Promise を返す関数を呼び出したとき、解決された値が返る", async ({ expect }) => {
    // Arrange
    const key = "async-key";
    const value = "resolved value";
    const fn = async () => value;

    // Act
    const result = await singleton(key, fn);

    // Assert
    expect(result).toBe(value);
  });

  test("同じキーで非同期関数を複数回呼び出したとき、Promise が共有され関数は 1 回しか実行されない", async ({ expect }) => {
    // Arrange
    const key = "async-duplicate-key";
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "async result";
    };

    // Act
    const [result1, result2] = await Promise.all([
      singleton(key, fn),
      singleton(key, fn),
    ]);

    // Assert
    expect(result1).toBe("async result");
    expect(result2).toBe("async result");
    expect(callCount).toBe(1);
  });

  test("非同期関数が拒否されたとき、キャッシュが削除され次に呼び出したときに関数が再実行される", async ({ expect }) => {
    // Arrange
    const key = "async-error-key";
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("failed");
    };

    // Act & Assert
    // 1 回目の呼び出し: 失敗する
    await expect(singleton(key, fn)).rejects.toThrow("failed");
    expect(callCount).toBe(1);

    // 2 回目の呼び出し: キャッシュが削除されているため、再度実行される
    await expect(singleton(key, fn)).rejects.toThrow("failed");
    expect(callCount).toBe(2);
  });
});

describe("異なるキーの管理", () => {
  test("異なるキーで呼び出したとき、それぞれの関数の結果が個別にキャッシュされる", ({ expect }) => {
    // Arrange
    const key1 = "key1";
    const key2 = "key2";
    const fn1 = () => "value1";
    const fn2 = () => "value2";

    // Act
    const result1 = singleton(key1, fn1);
    const result2 = singleton(key2, fn2);

    // Assert
    expect(result1).toBe("value1");
    expect(result2).toBe("value2");
  });
});
