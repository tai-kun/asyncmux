import { describe, test, vi } from "vitest";

import AsyncmuxLock from "../src/asyncmux-lock.js";
import { LockReleasedError } from "../src/errors.js";

describe("インスタンスの初期化", () => {
  test("初期化された直後、ロックは解放されていない状態になる", ({ expect }) => {
    // 準備
    const releaseFn = vi.fn<() => void>();

    // 実行
    const lock = new AsyncmuxLock(releaseFn);

    // 検証
    expect(lock.released).toBe(false);
  });
});

describe("明示的な解放", () => {
  test("release を呼び出したとき、登録された解放用関数が実行され、解放済み状態になる", ({
    expect,
  }) => {
    // 準備
    const releaseFn = vi.fn<() => void>();
    const lock = new AsyncmuxLock(releaseFn);

    // 実行
    lock.release();

    // 検証
    expect(releaseFn).toHaveBeenCalledTimes(1);
    expect(lock.released).toBe(true);
  });

  test("既に解放されている場合に release を呼び出すと、LockReleasedError が発生する", ({
    expect,
  }) => {
    // 準備
    const lock = new AsyncmuxLock(() => {});
    lock.release();

    // 実行と検証
    expect(() => {
      lock.release();
    }).toThrow(LockReleasedError);
  });
});

describe("自動解放 (Symbol.dispose)", () => {
  test("Symbol.dispose を呼び出したとき、登録された解放用関数が実行され、解放済み状態になる", ({
    expect,
  }) => {
    // 準備
    const releaseFn = vi.fn<() => void>();
    const lock = new AsyncmuxLock(releaseFn);

    // 実行
    lock[Symbol.dispose]();

    // 検証
    expect(releaseFn).toHaveBeenCalledTimes(1);
    expect(lock.released).toBe(true);
  });

  test("明示的に解放した後に Symbol.dispose を呼び出しても、エラーは発生せず、解放用関数も再実行されない", ({
    expect,
  }) => {
    // 準備
    const releaseFn = vi.fn<() => void>();
    const lock = new AsyncmuxLock(releaseFn);
    lock.release();
    expect(releaseFn).toHaveBeenCalledTimes(1);

    // 実行と検証
    expect(() => {
      lock[Symbol.dispose]();
    }).not.toThrow();
    expect(releaseFn).toHaveBeenCalledTimes(1);
  });

  test("using 構文を使用した場合、スコープを抜けるときに自動的に解放される", ({ expect }) => {
    // 準備
    const releaseFn = vi.fn<() => void>();

    // 実行
    {
      using _lock = new AsyncmuxLock(releaseFn);
      expect(releaseFn).not.toHaveBeenCalled();
    }

    // 検証
    expect(releaseFn).toHaveBeenCalledTimes(1);
  });
});

describe("例外発生時の振る舞い", () => {
  test("解放用関数の実行中にエラーが発生しても、ロックの状態は解放済みとしてマークされる", ({
    expect,
  }) => {
    // 準備
    const error = new Error("Release failed");
    const releaseFn = vi.fn<() => never>(() => {
      throw error;
    });
    const lock = new AsyncmuxLock(releaseFn);

    // 実行と検証
    expect(() => {
      lock.release();
    }).toThrow(error);

    // 解放用関数が失敗しても、状態は解放済みになっていなければならない
    expect(lock.released).toBe(true);
  });

  test("解放用関数がエラーを投げた後、再度 release を呼び出しても LockReleasedError が発生し、副作用は再発しない", ({
    expect,
  }) => {
    // 準備
    const releaseFn = vi.fn<() => never>(() => {
      throw new Error("Initial failure");
    });
    const lock = new AsyncmuxLock(releaseFn);

    try {
      lock.release();
    } catch {
      // 1 回目のエラーは無視する
    }

    // 実行と検証
    expect(() => {
      lock.release();
    }).toThrow(LockReleasedError);

    // 解放用関数が 2 回呼ばれていないことを保証する
    expect(releaseFn).toHaveBeenCalledTimes(1);
  });
});
