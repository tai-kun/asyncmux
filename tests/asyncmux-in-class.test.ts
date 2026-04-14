import { describe, test } from "vitest";

import asyncmux from "../src/asyncmux-in-class.js";
import { DecoratorSupportError } from "../src/errors.js";

describe("基本的なロック取得と解放", () => {
  test("単一の書き込みロックを要求したとき、取得に成功する", async ({ expect }) => {
    // Arrange
    const target = {};

    // Act
    const lock = await asyncmux(target);

    // Assert
    expect(lock).toBeDefined();
    expect(typeof lock.unlock).toBe("function");

    // Cleanup
    lock.unlock();
  });

  test("単一の読み取りロックを要求したとき、取得に成功する", async ({ expect }) => {
    // Arrange
    const target = {};

    // Act
    const lock = await asyncmux.readonly(target);

    // Assert
    expect(lock).toBeDefined();

    // Cleanup
    lock.unlock();
  });
});

describe("並行実行制御", () => {
  test("書き込みロック中に読み取り要求をしたとき、解放されるまで待機する", async ({ expect }) => {
    // Arrange
    const target = {};
    const writeLock = await asyncmux(target);
    let isReadResolved = false;

    // Act
    const readLockPromise = asyncmux.readonly(target).then((lock) => {
      isReadResolved = true;
      return lock;
    });

    // Assert
    // 短時間待機して resolve されていないことを確認する。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(isReadResolved).toBe(false);

    writeLock.unlock();
    const readLock = await readLockPromise;
    expect(isReadResolved).toBe(true);
    readLock.unlock();
  });

  test("読み取りロック中に別の読み取り要求をしたとき、即座に共有して取得できる", async ({
    expect,
  }) => {
    // Arrange
    const target = {};
    const readLock1 = await asyncmux.readonly(target);

    // Act
    const readLock2Promise = asyncmux.readonly(target);

    // Assert
    // await してもブロックされないことを検証する。
    await expect(readLock2Promise).resolves.toBeDefined();

    const readLock2 = await readLock2Promise;
    readLock1.unlock();
    readLock2.unlock();
  });

  test("読み取りロック中に書き込み要求をしたとき、すべての読み取りが解放されるまで待機する", async ({
    expect,
  }) => {
    // Arrange
    const target = {};
    const readLock = await asyncmux.readonly(target);
    let isWriteResolved = false;

    // Act
    const writeLockPromise = asyncmux(target).then((lock) => {
      isWriteResolved = true;
      return lock;
    });

    // Assert
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(isWriteResolved).toBe(false);

    readLock.unlock();
    const writeLock = await writeLockPromise;
    expect(isWriteResolved).toBe(true);
    writeLock.unlock();
  });

  test("複数のリクエストがあるとき、先着順（FIFO）で実行される", async ({ expect }) => {
    // Arrange
    const target = {};
    const executionOrder: string[] = [];

    const lock1 = await asyncmux(target); // W1

    // Act
    const p1 = asyncmux.readonly(target).then((l) => {
      executionOrder.push("R1");
      l.unlock();
    });
    const p2 = asyncmux(target).then((l) => {
      executionOrder.push("W2");
      l.unlock();
    });

    lock1.unlock();
    await Promise.all([p1, p2]);

    // Assert
    expect(executionOrder).toHaveLength(2);
    expect(executionOrder[0]).toBe("R1");
    expect(executionOrder[1]).toBe("W2");
  });
});

describe("中断処理", () => {
  test("すでに中断されているシグナルを渡したとき、即座に拒否される", async ({ expect }) => {
    // Arrange
    const target = {};
    const controller = new AbortController();
    controller.abort("Already aborted");

    // Act & Assert
    await expect(asyncmux(target, controller.signal)).rejects.toBe("Already aborted");
  });

  test("待機中に中断されたとき、キューから削除され拒否される", async ({ expect }) => {
    // Arrange
    const target = {};
    const initialLock = await asyncmux(target);
    const controller = new AbortController();

    // Act
    const pendingLockPromise = asyncmux(target, controller.signal);
    controller.abort("Timeout");

    // Assert
    await expect(pendingLockPromise).rejects.toBe("Timeout");

    // 後続のロックが正しく取得できる（キューが壊れていない）ことを確認する。
    initialLock.unlock();
    const nextLock = await asyncmux(target);
    expect(nextLock).toBeDefined();
    nextLock.unlock();
  });
});

describe("デコレーター機能", () => {
  test("メソッドにデコレーターを付与したとき、排他制御が行われる", async ({ expect }) => {
    // Arrange
    class TestService {
      count = 0;
      @asyncmux
      async heavyTask() {
        const current = this.count;
        await new Promise((resolve) => setTimeout(resolve, 50));
        this.count = current + 1;
      }
    }
    const service = new TestService();

    // Act
    // 同時に 2 回実行する。
    await Promise.all([service.heavyTask(), service.heavyTask()]);

    // Assert
    // 排他制御されていれば 2 になり、されていなければ競合して 1 になる。
    expect(service.count).toBe(2);
  });

  test("読み取り専用デコレーターを付与したとき、並行実行が可能である", async ({ expect }) => {
    // Arrange
    let activeCount = 0;
    let maxActiveCount = 0;

    class TestService {
      @asyncmux.readonly
      async sharedTask() {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeCount--;
      }
    }
    const service = new TestService();

    // Act
    await Promise.all([service.sharedTask(), service.sharedTask()]);

    // Assert
    expect(maxActiveCount).toBe(2);
  });

  test("Stage 3 以前の環境でデコレーターを呼び出したとき、エラーをスローする", async ({
    expect,
  }) => {
    // Stage 3 デコレーターは context オブジェクトを引数に取るため、手動で無効な引数を渡してエラーハンドリングを確認する。

    // Act & Assert
    // @ts-ignore: 意図的な不正呼び出し
    expect(() => (asyncmux as any)(() => {}, "invalid_context")).toThrow(DecoratorSupportError);
  });
});

describe("境界値・異常系", () => {
  test("例外が発生したとき、確実にロックが解放される", async ({ expect }) => {
    // Arrange
    class ErrorService {
      @asyncmux
      async failTask() {
        throw new Error("Failure");
      }
    }
    const service = new ErrorService();

    // Act
    await expect(service.failTask()).rejects.toThrow("Failure");

    // Assert
    // ロックが解放されていれば、次の呼び出しが即座に成功する。
    const nextLock = await asyncmux(service);
    expect(nextLock).toBeDefined();
    nextLock.unlock();
  });

  test("異なるオブジェクトへのロック要求は、互いに干渉しない", async ({ expect }) => {
    // Arrange
    const objA = {};
    const objB = {};
    const lockA = await asyncmux(objA);

    // Act & Assert
    // objA がロックされていても、objB のロックは即座に取得できるはずである。
    const lockBPromise = asyncmux(objB);
    await expect(lockBPromise).resolves.toBeDefined();

    const lockB = await lockBPromise;
    lockA.unlock();
    lockB.unlock();
  });

  test("高負荷状態で多数のリクエストを発行したとき、整合性が保たれる", async ({ expect }) => {
    // Arrange
    const target = {};
    const results: number[] = [];
    const count = 100;

    // Act
    const tasks = Array.from({ length: count }).map((_, i) => {
      return (async () => {
        const lock = await asyncmux(target);
        results.push(i);
        lock.unlock();
      })();
    });

    await Promise.all(tasks);

    // Assert
    expect(results).toHaveLength(count);
    // 重複がなくすべて実行されていることを確認する。
    const uniqueResults = new Set(results);
    expect(uniqueResults.size).toBe(count);
  });
});
