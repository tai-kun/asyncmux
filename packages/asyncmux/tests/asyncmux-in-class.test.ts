import { describe, test } from "vitest";

import asyncmux from "../src/asyncmux-in-class.js";
import { DecoratorSupportError, ReentrantLockError } from "../src/errors.js";

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

describe("基本的なロック取得と解放", () => {
  test("単一の書き込みロックを要求したとき、取得に成功する", async ({ expect }) => {
    // 準備
    const target = {};

    // 実行
    const lock = await asyncmux(target);

    // 検証
    expect(lock.released).toBe(false);
    // oxlint-disable-next-line typescript/unbound-method
    expect(lock.release).toBeTypeOf("function");

    lock.release();
  });

  test("単一の読み取りロックを要求したとき、取得に成功する", async ({ expect }) => {
    // 準備
    const target = {};

    // 実行
    const lock = await asyncmux.readonly(target);

    // 検証
    expect(lock.released).toBe(false);

    lock.release();
  });
});

describe("並行実行制御", () => {
  test("書き込みロック中に読み取り要求をしたとき、解放されるまで待機する", async ({ expect }) => {
    // 準備
    const target = {};
    const writeLock = await asyncmux(target);
    let isReadResolved = false;

    // 実行
    const readLockPromise = asyncmux.readonly(target).then((lock) => {
      isReadResolved = true;

      return lock;
    });

    // 検証
    // 短時間待機して resolve されていないことを確認する。
    await sleep(50);
    expect(isReadResolved).toBe(false);

    writeLock.release();
    const readLock = await readLockPromise;
    expect(isReadResolved).toBe(true);
    readLock.release();
  });

  test("読み取りロック中に別の読み取り要求をしたとき、即座に共有して取得できる", async ({
    expect,
  }) => {
    // 準備
    const target = {};
    const readLock1 = await asyncmux.readonly(target);

    // 実行
    const readLock2 = await asyncmux.readonly(target);

    // 検証
    expect(readLock2.released).toBe(false);

    readLock1.release();
    readLock2.release();
  });

  test("読み取りロック中に書き込み要求をしたとき、すべての読み取りが解放されるまで待機する", async ({
    expect,
  }) => {
    // 準備
    const target = {};
    const readLock = await asyncmux.readonly(target);
    let isWriteResolved = false;

    // 実行
    const writeLockPromise = asyncmux(target).then((lock) => {
      isWriteResolved = true;

      return lock;
    });

    // 検証
    await sleep(50);
    expect(isWriteResolved).toBe(false);

    readLock.release();
    const writeLock = await writeLockPromise;
    expect(isWriteResolved).toBe(true);
    writeLock.release();
  });

  test("複数のリクエストがあるとき、先着順（FIFO）で実行される", async ({ expect }) => {
    // 準備
    const target = {};
    const executionOrder: string[] = [];

    const initialLock = await asyncmux(target);

    // 実行
    const readRequest = asyncmux.readonly(target).then((lock) => {
      executionOrder.push("R1");
      lock.release();
    });
    const writeRequest = asyncmux(target).then((lock) => {
      executionOrder.push("W2");
      lock.release();
    });

    initialLock.release();
    await Promise.all([readRequest, writeRequest]);

    // 検証
    expect(executionOrder).toStrictEqual(["R1", "W2"]);
  });
});

describe("中断処理", () => {
  test("すでに中断されているシグナルを渡したとき、即座に拒否される", async ({ expect }) => {
    // 準備
    const target = {};
    const controller = new AbortController();
    controller.abort("Already aborted");

    // 実行と検証
    await expect(asyncmux(target, controller.signal)).rejects.toBe("Already aborted");
  });

  test("待機中に中断されたとき、キューから削除され拒否される", async ({ expect }) => {
    // 準備
    const target = {};
    const initialLock = await asyncmux(target);
    const controller = new AbortController();

    // 実行
    const pendingLockPromise = asyncmux(target, controller.signal);
    controller.abort("Timeout");

    // 検証
    await expect(pendingLockPromise).rejects.toBe("Timeout");

    // 後続のロックが正しく取得できる (キューが壊れていない) ことを確認する。
    initialLock.release();
    const nextLock = await asyncmux(target);
    expect(nextLock.released).toBe(false);
    nextLock.release();
  });
});

describe("デコレーター機能", () => {
  test("メソッドにデコレーターを付与したとき、排他制御が行われる", async ({ expect }) => {
    // 準備
    class TestService {
      count = 0;
      @asyncmux
      async heavyTask() {
        const current = this.count;
        await sleep(50);
        this.count = current + 1;
      }
    }
    const service = new TestService();

    // 実行
    // 同時に 2 回実行する。
    await Promise.all([service.heavyTask(), service.heavyTask()]);

    // 検証
    // 排他制御されていれば 2 になり、されていなければ競合して 1 になる。
    expect(service.count).toBe(2);
  });

  test("読み取り専用デコレーターを付与したとき、並行実行が可能である", async ({ expect }) => {
    // 準備
    let activeCount = 0;
    let maxActiveCount = 0;

    class TestService {
      @asyncmux.readonly
      async sharedTask() {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await sleep(50);
        activeCount--;
      }
    }
    const service = new TestService();

    // 実行
    await Promise.all([service.sharedTask(), service.sharedTask()]);

    // 検証
    expect(maxActiveCount).toBe(2);
  });

  test("ステージ 3 以前のデコレーターしか利用できない環境では DecoratorSupportError が投げられる", ({
    expect,
  }) => {
    // 準備
    // ステージ 3 のデコレーターは context オブジェクトを受け取るため、無効な引数で呼び出す。

    // 実行と検証
    expect(() => (asyncmux as any)(() => {}, "invalid_context")).toThrow(DecoratorSupportError);
  });
});

describe("境界値・異常系", () => {
  test("メソッドが例外を投げたとき、確実にロックが解放される", async ({ expect }) => {
    // 準備
    class ErrorService {
      @asyncmux
      async failTask() {
        throw new Error("Failure");
      }
    }
    const service = new ErrorService();

    // 実行と検証
    await expect(service.failTask()).rejects.toThrow("Failure");

    // ロックが解放されていれば、次の呼び出しが即座に成功する。
    const nextLock = await asyncmux(service);
    expect(nextLock.released).toBe(false);
    nextLock.release();
  });

  test("異なるオブジェクトへのロック要求は、互いに干渉しない", async ({ expect }) => {
    // 準備
    const objA = {};
    const objB = {};
    const lockA = await asyncmux(objA);

    // 実行
    const lockB = await asyncmux(objB);

    // 検証
    // objA がロックされていても、objB のロックは即座に取得できる。
    expect(lockB.released).toBe(false);

    lockA.release();
    lockB.release();
  });

  test("高負荷状態で多数のリクエストを発行したとき、整合性が保たれる", async ({ expect }) => {
    // 準備
    const target = {};
    const results: number[] = [];
    const count = 100;

    // 実行
    const tasks = Array.from({ length: count }).map((_, i) => {
      return (async () => {
        const lock = await asyncmux(target);
        results.push(i);
        lock.release();
      })();
    });

    await Promise.all(tasks);

    // 検証
    // 重複がなくすべて実行されていることを確認する。
    expect(results).toHaveLength(count);
    expect(new Set(results).size).toBe(count);
  });
});

describe("再入の検出", () => {
  test("書き込みロック保持中に書き込みロックを要求したとき、ReentrantLockError が投げられる", async ({
    expect,
  }) => {
    // 準備
    class TestService {
      @asyncmux
      async outer() {
        await this.inner();
      }

      @asyncmux
      async inner() {}
    }
    const service = new TestService();

    // 実行と検証
    await expect(service.outer()).rejects.toThrow(ReentrantLockError);
  });

  test("書き込みロック保持中に読み取りロックを要求したとき、ReentrantLockError が投げられる", async ({
    expect,
  }) => {
    // 準備
    class TestService {
      @asyncmux
      async outer() {
        await this.inner();
      }

      @asyncmux.readonly
      async inner() {}
    }
    const service = new TestService();

    // 実行と検証
    await expect(service.outer()).rejects.toThrow(ReentrantLockError);
  });

  test("読み取りロック保持中に書き込みロックを要求したとき、ReentrantLockError が投げられる", async ({
    expect,
  }) => {
    // 準備
    class TestService {
      @asyncmux.readonly
      async outer() {
        await this.inner();
      }

      @asyncmux
      async inner() {}
    }
    const service = new TestService();

    // 実行と検証
    await expect(service.outer()).rejects.toThrow(ReentrantLockError);
  });

  test("読み取りロック同士の再入は共有ロックとして許可される", async ({ expect }) => {
    // 準備
    const logs: string[] = [];
    class TestService {
      @asyncmux.readonly
      async outer() {
        await Promise.all([this.inner(100, "A"), this.inner(50, "B")]);
        logs.push("outer done");
      }

      @asyncmux.readonly
      async inner(ms: number, id: string) {
        await sleep(ms);
        logs.push(`inner ${id}`);
      }
    }
    const service = new TestService();

    // 実行
    await service.outer();

    // 検証
    expect(logs).toStrictEqual(["inner B", "inner A", "outer done"]);
  });

  test("関数形 API による再取得も検出される", async ({ expect }) => {
    // 準備
    class TestService {
      @asyncmux
      async outer() {
        using _lock = await asyncmux(this);
      }
    }
    const service = new TestService();

    // 実行と検証
    await expect(service.outer()).rejects.toThrow(ReentrantLockError);
  });

  test.skipIf(!supportsAsyncContext)("await をまたいだ再入も検出される", async ({ expect }) => {
    // 準備
    class TestService {
      @asyncmux
      async outer() {
        await sleep(20);

        await this.inner();
      }

      @asyncmux
      async inner() {}
    }
    const service = new TestService();

    // 実行と検証
    await expect(service.outer()).rejects.toThrow(ReentrantLockError);
  });

  test.skipIf(!supportsAsyncContext)(
    "複数インスタンス間の循環待ちも検出される",
    async ({ expect }) => {
      // 準備
      class A {
        @asyncmux
        async m(b: B) {
          await b.m(this);
        }
      }
      class B {
        @asyncmux
        async m(a: A) {
          await a.m(b2); // A のロック保持中に A への再入になるため循環待ちになる
        }
      }
      const b2 = new B();

      // 実行
      const error = await new A().m(new B()).then(
        () => null,
        (e) => e,
      );

      // 検証
      expect(error).toBeInstanceOf(ReentrantLockError);
    },
  );
});

describe("再入と通常の競合の区別", () => {
  test("別タスクからの書き込みロック要求はエラーにならず待機する", async ({ expect }) => {
    // 準備
    class TestService {
      @asyncmux
      async w(ms: number) {
        await sleep(ms);

        return ms;
      }
    }
    const service = new TestService();

    // 実行
    const results = await Promise.all([service.w(50), service.w(0), service.w(10)]);

    // 検証
    // すべての呼び出しがエラーにならず完了し、直列に実行されている。
    expect(results).toStrictEqual([50, 0, 10]);
  });
});
