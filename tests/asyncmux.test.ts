import { beforeEach, describe, test } from "vitest";

import Asyncmux from "../src/asyncmux.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * ロック対象タスクの開始と終了をログに記録します。
 * 実行順序の検証に使用します。
 */
async function runTask(type: "W" | "R", id: string, delay: number) {
  log.push(`${type}-${id} start`);
  await sleep(delay);
  log.push(`${type}-${id} end`);
}

let log: string[];

beforeEach(() => {
  log = [];
});

describe("lock", () => {
  test("異なるキーは互いに影響しない", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();

    // 実行
    await Promise.all([
      (async () => {
        using _ = await mux.lock("key1");
        await runTask("W", "K1", 200);
      })(),
      (async () => {
        using _ = await mux.lock("key2");
        await runTask("W", "K2", 0);
      })(),
    ]);

    // 検証
    expect(log).toStrictEqual([
      "W-K1 start",
      "W-K2 start", // K1 を待たずに開始
      "W-K2 end",
      "W-K1 end",
    ]);
  });

  test("同じキーは直列実行される", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();

    // 実行
    await Promise.all([
      (async () => {
        using _ = await mux.lock("key1");
        await runTask("W", "K1", 200);
      })(),
      (async () => {
        using _ = await mux.lock("key1");
        await runTask("W", "K2", 0);
      })(),
    ]);

    // 検証
    expect(log).toStrictEqual([
      "W-K1 start",
      "W-K1 end",
      "W-K2 start", // K1 を待ってから開始
      "W-K2 end",
    ]);
  });

  test("キーなしは直列実行される", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();

    // 実行
    await Promise.all([
      (async () => {
        using _ = await mux.lock();
        await runTask("W", "K1", 200);
      })(),
      (async () => {
        using _ = await mux.lock();
        await runTask("W", "K2", 0);
      })(),
    ]);

    // 検証
    expect(log).toStrictEqual([
      "W-K1 start",
      "W-K1 end",
      "W-K2 start", // K1 を待ってから開始
      "W-K2 end",
    ]);
  });

  test("キーなしロックは全ロックに対して排他制御を行う", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();

    // 実行
    await Promise.all([
      (async () => {
        using _ = await mux.lock();
        await runTask("W", "K1", 300);
      })(),
      (async () => {
        using _ = await mux.lock("key1");
        await runTask("W", "K2", 200);
      })(),
      (async () => {
        using _ = await mux.lock("key2");
        await runTask("W", "K3", 0);
      })(),
      (async () => {
        using _ = await mux.lock();
        await runTask("W", "K4", 200);
      })(),
      (async () => {
        using _ = await mux.lock("key1");
        await runTask("W", "K5", 0);
      })(),
    ]);

    // 検証
    expect(log).toStrictEqual([
      "W-K1 start",
      "W-K1 end",
      "W-K2 start", // K1 を待ってから開始
      "W-K3 start", // K2 を待たずに開始
      "W-K3 end",
      "W-K2 end",
      "W-K4 start", // K2 を待ってから開始
      "W-K4 end",
      "W-K5 start", // K4 を待ってから開始
      "W-K5 end",
    ]);
  });
});

describe("rLock", () => {
  test("複数の読み取り操作は並列実行される", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();

    // 実行
    await Promise.all([
      (async () => {
        using _ = await mux.rLock("key1");
        await runTask("R", "K1", 200);
      })(),
      (async () => {
        using _ = await mux.rLock("key1");
        await runTask("R", "K2", 0);
      })(),
    ]);

    // 検証
    expect(log).toStrictEqual([
      "R-K1 start",
      "R-K2 start", // K1 を待たずに開始
      "R-K2 end",
      "R-K1 end",
    ]);
  });
});

describe("lock, rLock", () => {
  test("書き込みロック中に読み取りロックは待機する", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();

    // 実行
    await Promise.all([
      (async () => {
        using _ = await mux.lock("key1");
        await runTask("W", "1", 200);
      })(),
      (async () => {
        using _ = await mux.rLock("key1");
        await runTask("R", "1", 0);
      })(),
    ]);

    // 検証
    expect(log).toStrictEqual(["W-1 start", "W-1 end", "R-1 start", "R-1 end"]);
  });

  test("読み取りロック中に書き込みロックは待機する", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();

    // 実行
    await Promise.all([
      (async () => {
        using _ = await mux.rLock("key1");
        await runTask("R", "1", 200);
      })(),
      (async () => {
        using _ = await mux.lock("key1");
        await runTask("W", "1", 0);
      })(),
    ]);

    // 検証
    expect(log).toStrictEqual(["R-1 start", "R-1 end", "W-1 start", "W-1 end"]);
  });
});

describe("AbortSignal による中断", () => {
  test("ロック待機中に中断された場合、エラーを投げる", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();
    const ac = new AbortController();
    const abortError = new Error("Abort");

    // 1. まず先行してロックを取得し、解放しない。
    using _ = await mux.lock();
    // 2. 2 番目のロック取得を試みる（待機状態になる）
    const promise = mux.lock({ signal: ac.signal });
    // 3. 待機中に中断を実行
    ac.abort(abortError);

    // 実行と検証
    await expect(promise).rejects.toThrow(abortError);
  });
});

describe("高競合時の順序保証と相互排他", () => {
  test("同一キーへの大量の書き込み要求は FIFO 順で実行される", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;

    // 実行
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        mux.lock("shared").then((lock) => {
          active++;
          maxActive = max(maxActive, active);
          order.push(i);
          active--;
          lock.release();
        }),
      ),
    );

    // 検証
    expect(order).toStrictEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(maxActive).toBe(1);
  });

  test("混在負荷でも相互排他と共有読み取りが維持される", async ({ expect }) => {
    // 準備
    const mux = new Asyncmux();
    const violations: string[] = [];
    const readers = { a: 0, b: 0 };
    const writers = { a: 0, b: 0 };

    // 実行
    await Promise.all(
      Array.from({ length: 60 }, (_, i) => {
        const key = i % 2 === 0 ? "a" : "b";

        if (i % 3 === 2) {
          return mux.lock(key).then(async (lock) => {
            writers[key]++;
            if (readers[key] > 0 || writers[key] > 1) {
              violations.push(`W overlapped: ${i}`);
            }

            await sleep(1);
            writers[key]--;
            lock.release();
          });
        }

        return mux.rLock(key).then(async (lock) => {
          readers[key]++;
          if (writers[key] > 0) violations.push(`R overlapped W: ${i}`);

          await sleep(1);
          readers[key]--;
          lock.release();
        });
      }),
    );

    // 検証
    expect(violations).toStrictEqual([]);
  });
});

function max(a: number, b: number): number {
  return a > b ? a : b;
}
