import { describe, test } from "vitest";

import asyncmux from "../src/asyncmux-class-method.js";
import { LockEscalationError } from "../src/errors.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("デコレーター", () => {
  describe("lock", () => {
    test("書き込みは直列", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async runWithoutMutex(ms: number, value: string) {
          await sleep(ms);
          this.log.push(value);
          this.log;
        }

        @asyncmux
        async runWithMutex(ms: number, value: string) {
          await sleep(ms);
          this.log.push(value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      // asyncmux なし
      await Promise.all([
        runner.runWithoutMutex(400, "A"),
        runner.runWithoutMutex(200, "B"),
        runner.runWithoutMutex(0, "C"),
      ]);
      // asyncmux あり
      await Promise.all([
        runner.runWithMutex(400, "A"),
        runner.runWithMutex(200, "B"),
        runner.runWithMutex(0, "C"),
      ]);

      expect(log).toStrictEqual([
        // asyncmux なし
        "C",
        "B",
        "A",
        // asyncmux あり
        "A",
        "B",
        "C",
      ]);
    });

    test("直列の中で直列を実行可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        @asyncmux
        async write1(ms: number, value: string) {
          await sleep(ms);
          this.log.push("W1:" + value);
          await Promise.all([this.write2(200, "A"), this.write2(0, "B")]);
        }

        @asyncmux
        async write2(ms: number, value: string) {
          await sleep(ms);
          this.log.push("W2:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await Promise.all([runner.write1(200, "A"), runner.write1(0, "B")]);

      expect(log).toStrictEqual(["W1:A", "W2:A", "W2:B", "W1:B", "W2:A", "W2:B"]);
    });
  });

  describe("rLock", () => {
    test("読み取りは並行", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async runWithoutMutex(ms: number, value: string) {
          await sleep(ms);
          this.log.push(value);
        }

        @asyncmux.readonly
        async runWithMutex(ms: number, value: string) {
          await sleep(ms);
          this.log.push(value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      // asyncmux なし
      await Promise.all([
        runner.runWithoutMutex(400, "A"),
        runner.runWithoutMutex(200, "B"),
        runner.runWithoutMutex(0, "C"),
      ]);
      // asyncmux あり
      await Promise.all([
        runner.runWithMutex(400, "A"),
        runner.runWithMutex(200, "B"),
        runner.runWithMutex(0, "C"),
      ]);

      expect(log).toStrictEqual([
        // asyncmux なし
        "C",
        "B",
        "A",
        // asyncmux あり
        "C",
        "B",
        "A",
      ]);
    });

    test("並行の中で並行を実行可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        @asyncmux.readonly
        async read1(ms: number, value: string) {
          await sleep(ms);
          this.log.push("R1:" + value);
          await Promise.all([this.read2(200, "A"), this.read2(0, "B")]);
        }

        @asyncmux.readonly
        async read2(ms: number, value: string) {
          await sleep(ms);
          this.log.push("R2:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await runner.read1(0, "A");
      expect(log).toStrictEqual(["R1:A", "R2:B", "R2:A"]);
    });
  });

  describe("lock, rLock", () => {
    test("直列と並行の組み合わせは直列", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        @asyncmux
        async write(ms: number, value: string) {
          await sleep(ms);
          this.log.push("W:" + value);
        }

        @asyncmux.readonly
        async read(ms: number, value: string) {
          await sleep(ms);
          this.log.push("R:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await Promise.all([
        runner.write(200, "A"),
        runner.write(0, "B"),
        runner.read(400, "A"),
        runner.read(200, "B"),
        runner.write(0, "C"),
        runner.read(0, "B"),
      ]);

      expect(log).toStrictEqual(["W:A", "W:B", "R:B", "R:A", "W:C", "R:B"]);
    });

    test("直列の中で並行を実行可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        @asyncmux
        async write(ms: number, value: string) {
          await sleep(ms);
          this.log.push("W:" + value);
          await Promise.all([this.read(200, "A"), this.read(0, "B")]);
        }

        @asyncmux.readonly
        async read(ms: number, value: string) {
          await sleep(ms);
          this.log.push("R:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await runner.write(0, "A");
      expect(log).toStrictEqual(["W:A", "R:B", "R:A"]);
    });

    test("直列の中で直列と並列を組み合わせ可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        @asyncmux
        async write1(ms: number, value: string) {
          await sleep(ms);
          this.log.push("W1:" + value);
          await Promise.all([
            runner.write2(200, "A"),
            runner.write2(0, "B"),
            runner.read(400, "A"),
            runner.read(200, "B"),
            runner.write2(0, "C"),
            runner.read(0, "B"),
          ]);
        }

        @asyncmux
        async write2(ms: number, value: string) {
          await sleep(ms);
          this.log.push("W2:" + value);
        }

        @asyncmux.readonly
        async read(ms: number, value: string) {
          await sleep(ms);
          this.log.push("R:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await runner.write1(200, "A");

      expect(log).toStrictEqual(["W1:A", "W2:A", "W2:B", "R:B", "R:A", "W2:C", "R:B"]);
    });

    test("並行の中で直列を実行しようとするとエラー", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        @asyncmux.readonly
        async read(ms: number, value: string) {
          await sleep(ms);
          this.log.push("R:" + value);
          await this.write(0, "");
        }

        @asyncmux
        async write(ms: number, value: string) {
          await sleep(ms);
          this.log.push("W:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);

      await expect(runner.read(0, "A")).rejects.toThrow(LockEscalationError);
    });
  });
});

describe("マニュアル", () => {
  describe("lock", () => {
    test("書き込みは直列", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async runWithoutMutex(ms: number, value: string) {
          await sleep(ms);
          this.log.push(value);
          this.log;
        }

        async runWithMutex(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push(value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      // asyncmux なし
      await Promise.all([
        runner.runWithoutMutex(400, "A"),
        runner.runWithoutMutex(200, "B"),
        runner.runWithoutMutex(0, "C"),
      ]);
      // asyncmux あり
      await Promise.all([
        runner.runWithMutex(400, "A"),
        runner.runWithMutex(200, "B"),
        runner.runWithMutex(0, "C"),
      ]);

      expect(log).toStrictEqual([
        // asyncmux なし
        "C",
        "B",
        "A",
        // asyncmux あり
        "A",
        "B",
        "C",
      ]);
    });

    test("直列の中で直列を実行可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async write1(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push("W1:" + value);
          await Promise.all([this.write2(200, "A"), this.write2(0, "B")]);
        }

        async write2(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push("W2:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await Promise.all([runner.write1(200, "A"), runner.write1(0, "B")]);

      expect(log).toStrictEqual(["W1:A", "W2:A", "W2:B", "W1:B", "W2:A", "W2:B"]);
    });
  });

  describe("rLock", () => {
    test("読み取りは並行", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async runWithoutMutex(ms: number, value: string) {
          await sleep(ms);
          this.log.push(value);
        }

        async runWithMutex(ms: number, value: string) {
          using _ = await asyncmux.readonly(this);
          await sleep(ms);
          this.log.push(value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      // asyncmux なし
      await Promise.all([
        runner.runWithoutMutex(400, "A"),
        runner.runWithoutMutex(200, "B"),
        runner.runWithoutMutex(0, "C"),
      ]);
      // asyncmux あり
      await Promise.all([
        runner.runWithMutex(400, "A"),
        runner.runWithMutex(200, "B"),
        runner.runWithMutex(0, "C"),
      ]);

      expect(log).toStrictEqual([
        // asyncmux なし
        "C",
        "B",
        "A",
        // asyncmux あり
        "C",
        "B",
        "A",
      ]);
    });

    test("並行の中で並行を実行可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async read1(ms: number, value: string) {
          using _ = await asyncmux.readonly(this);
          await sleep(ms);
          this.log.push("R1:" + value);
          await Promise.all([this.read2(200, "A"), this.read2(0, "B")]);
        }

        async read2(ms: number, value: string) {
          using _ = await asyncmux.readonly(this);
          await sleep(ms);
          this.log.push("R2:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await runner.read1(0, "A");
      expect(log).toStrictEqual(["R1:A", "R2:B", "R2:A"]);
    });
  });

  describe("lock, rLock", () => {
    test("直列と並行の組み合わせは直列", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async write(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push("W:" + value);
        }

        async read(ms: number, value: string) {
          using _ = await asyncmux.readonly(this);
          await sleep(ms);
          this.log.push("R:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await Promise.all([
        runner.write(200, "A"),
        runner.write(0, "B"),
        runner.read(400, "A"),
        runner.read(200, "B"),
        runner.write(0, "C"),
        runner.read(0, "B"),
      ]);

      expect(log).toStrictEqual(["W:A", "W:B", "R:B", "R:A", "W:C", "R:B"]);
    });

    test("直列の中で並行を実行可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async write(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push("W:" + value);
          await Promise.all([this.read(200, "A"), this.read(0, "B")]);
        }

        async read(ms: number, value: string) {
          using _ = await asyncmux.readonly(this);
          await sleep(ms);
          this.log.push("R:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await runner.write(0, "A");
      expect(log).toStrictEqual(["W:A", "R:B", "R:A"]);
    });

    test("直列の中で直列と並列を組み合わせ可能", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async write1(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push("W1:" + value);
          await Promise.all([
            runner.write2(200, "A"),
            runner.write2(0, "B"),
            runner.read(400, "A"),
            runner.read(200, "B"),
            runner.write2(0, "C"),
            runner.read(0, "B"),
          ]);
        }

        async write2(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push("W2:" + value);
        }

        async read(ms: number, value: string) {
          using _ = await asyncmux.readonly(this);
          await sleep(ms);
          this.log.push("R:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);
      await runner.write1(200, "A");

      expect(log).toStrictEqual(["W1:A", "W2:A", "W2:B", "R:B", "R:A", "W2:C", "R:B"]);
    });

    test("並行の中で直列を実行しようとするとエラー", async ({ expect }) => {
      class Runner {
        private log: string[];

        constructor(log: string[]) {
          this.log = log;
        }

        async read(ms: number, value: string) {
          using _ = await asyncmux.readonly(this);
          await sleep(ms);
          this.log.push("R:" + value);
          await this.write(0, "");
        }

        async write(ms: number, value: string) {
          using _ = await asyncmux(this);
          await sleep(ms);
          this.log.push("W:" + value);
        }
      }

      const log: string[] = [];
      const runner = new Runner(log);

      await expect(runner.read(0, "A")).rejects.toThrow(LockEscalationError);
    });
  });

  describe("AbortSignal による中断", () => {
    test("ロック待機中に中断された場合、エラーを投げる", async ({ expect }) => {
      const self = {};
      const ac = new AbortController();
      const abortError = new Error("Abort");

      // 1. まず先行してロックを取得し、解放しない。
      using _ = await asyncmux(self);
      // 2. 2 番目のロック取得を試みる（待機状態になる）
      const promise = asyncmux(self, { signal: ac.signal });
      // 3. 待機中に中断を実行
      ac.abort(abortError);

      await expect(promise).rejects.toThrow(abortError);
    });
  });
});
