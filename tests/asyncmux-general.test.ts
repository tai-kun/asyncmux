import { beforeEach, describe, test } from "vitest";
import Asyncmux from "../src/asyncmux-general.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
let log: string[];

beforeEach(() => {
  log = [];
});

async function runTask(type: "W" | "R", id: string, delay: number) {
  log.push(`${type}-${id} start`);
  await sleep(delay);
  log.push(`${type}-${id} end`);
}

describe("lock", () => {
  test("異なるキーは互いに影響しない", async ({ expect }) => {
    const mux = new Asyncmux();
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

    expect(log).toStrictEqual([
      "W-K1 start",
      "W-K2 start", // K1 を待たずに開始
      "W-K2 end",
      "W-K1 end",
    ]);
  });

  test("同じキーは直列実行される", async ({ expect }) => {
    const mux = new Asyncmux();
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

    expect(log).toStrictEqual([
      "W-K1 start",
      "W-K1 end",
      "W-K2 start", // K1 を待ってから開始
      "W-K2 end",
    ]);
  });

  test("キーなしは直列実行される", async ({ expect }) => {
    const mux = new Asyncmux();
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

    expect(log).toStrictEqual([
      "W-K1 start",
      "W-K1 end",
      "W-K2 start", // K1 を待ってから開始
      "W-K2 end",
    ]);
  });

  test("キーなしロックは全ロックに対して排他制御を行う", async ({ expect }) => {
    const mux = new Asyncmux();
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

    expect(log).toEqual([
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
    const mux = new Asyncmux();
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

    expect(log).toEqual([
      "R-K1 start",
      "R-K2 start", // K1 を待たずに開始
      "R-K2 end",
      "R-K1 end",
    ]);
  });
});

describe("lock, rLock", () => {
  test("書き込みロック中に読み取りロックは待機する", async ({ expect }) => {
    const mux = new Asyncmux();
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

    expect(log).toEqual([
      "W-1 start",
      "W-1 end",
      "R-1 start",
      "R-1 end",
    ]);
  });

  test("読み取りロック中に書き込みロックは待機する", async ({ expect }) => {
    const mux = new Asyncmux();
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

    expect(log).toEqual([
      "R-1 start",
      "R-1 end",
      "W-1 start",
      "W-1 end",
    ]);
  });
});

describe("AbortSignal による中断", () => {
  test("ロック待機中に中断された場合、エラーを投げる", async ({ expect }) => {
    const mux = new Asyncmux();
    const ac = new AbortController();
    const abortError = new Error("Abort");

    // 1. まず先行してロックを取得し、解放しない。
    using _ = await mux.lock();
    // 2. 2 番目のロック取得を試みる（待機状態になる）
    const promise = mux.lock({ signal: ac.signal });
    // 3. 待機中に中断を実行
    ac.abort(abortError);

    await expect(promise).rejects.toThrow(abortError);
  });
});
