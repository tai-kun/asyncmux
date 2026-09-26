import { describe, test } from "vitest";

import Asyncmux from "../src/asyncmux.js";
import { ReentrantLockError } from "../src/errors.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * process.getBuiltinModule 経由で node:async_hooks を利用できるかを判定します。
 * AsyncLocalStorage ベースの再入検出に依存するテストの実行可否の判定に使用します。
 */
const supportsAsyncContext = (() => {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;

    return !!proc?.getBuiltinModule?.("node:async_hooks");
  } catch {
    return false;
  }
})();

describe("再入の検出", () => {
  test.skipIf(!supportsAsyncContext)(
    "保持中の書き込みロックと同じキーの書き込みロックを要求するとエラーになる",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _ = await mux.lock("key");

      // 検証
      expect(() => mux.lock("key")).toThrow(ReentrantLockError);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "保持中の書き込みロックと同じキーの読み取りロックを要求するとエラーになる",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _ = await mux.lock("key");

      // 検証
      expect(() => mux.rLock("key")).toThrow(ReentrantLockError);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "保持中の読み取りロックと同じキーの書き込みロックを要求するとエラーになる",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _ = await mux.rLock("key");

      // 検証
      expect(() => mux.lock("key")).toThrow(ReentrantLockError);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "保持中の読み取りロックと同じキーの読み取りロックは許可される",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _1 = await mux.rLock("key");
      using _2 = await mux.rLock("key");

      // 検証
      expect(_2.released).toBe(false);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "保持中のロックと異なるキーのロックは許可される",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _1 = await mux.lock("key1");
      using _2 = await mux.lock("key2");

      // 検証
      expect(_2.released).toBe(false);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "グローバル書き込みロックの保持中はキー付きロックを要求できない",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _ = await mux.lock();

      // 検証
      expect(() => mux.lock("key")).toThrow(ReentrantLockError);
      expect(() => mux.rLock("key")).toThrow(ReentrantLockError);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "キー付きロックの保持中はグローバル書き込みロックを要求できない",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _ = await mux.lock("key");

      // 検証
      expect(() => mux.lock()).toThrow(ReentrantLockError);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "グローバル読み取りロックの保持中は書き込みロックを要求できない",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _ = await mux.rLock();

      // 検証
      expect(() => mux.lock("key")).toThrow(ReentrantLockError);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "保持中のロックを解放した後は同じキーのロックを再取得できる",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      {
        using _ = await mux.lock("key");
      }
      using _ = await mux.lock("key");

      // 検証
      expect(_.released).toBe(false);
    },
  );

  test.skipIf(!supportsAsyncContext)("await をまたいだ再入も検出される", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux({ preventReentrancy: true });

    // 実行
    using _ = await mux.lock("key");
    await sleep(20);

    // 検証
    expect(() => mux.lock("key")).toThrow(ReentrantLockError);
  });

  test.skipIf(!supportsAsyncContext)(
    "複数のキーを保持した状態での再入も検出される",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _1 = await mux.lock("key1");
      using _2 = await mux.lock("key2");

      // 検証
      expect(() => mux.lock("key1")).toThrow(ReentrantLockError);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "異なるインスタンス間では再入にならない",
    async ({ expect }) => {
      // 準備
      const muxA = new Asyncmux({ preventReentrancy: true });
      const muxB = new Asyncmux({ preventReentrancy: true });

      // 実行
      using _1 = await muxA.lock("key");
      using _2 = await muxB.lock("key");

      // 検証
      expect(_2.released).toBe(false);
    },
  );

  test.skipIf(!supportsAsyncContext)(
    "別タスクからのロック要求はエラーにならず待機する",
    async ({ expect }) => {
      // 準備
      const mux = new Asyncmux({ preventReentrancy: true });
      const order: string[] = [];

      // 実行
      await Promise.all([
        (async () => {
          using _ = await mux.lock("key");
          await sleep(50);
          order.push("A");
        })(),
        (async () => {
          using _ = await mux.lock("key");
          order.push("B");
        })(),
      ]);

      // 検証
      expect(order).toStrictEqual(["A", "B"]);
    },
  );

  test("再入検出が無効な場合は、同じキーの要求を待機させる", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();
    const controller = new AbortController();

    // 実行
    using _ = await mux.lock("key");
    const pending = mux.lock({ key: "key", signal: controller.signal });
    controller.abort("中断されました");

    // 検証
    await expect(pending).rejects.toBe("中断されました");
  });
});
