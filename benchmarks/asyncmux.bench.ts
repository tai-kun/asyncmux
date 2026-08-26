import { bench, describe } from "vitest";

import Asyncmux from "../src/asyncmux.js";

/**
 * 1 ワーカーが同一リソースに対して `count` 回ロック取得・解放を繰り返します。
 */
async function sequential(mux: Asyncmux, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const lock = await mux.lock();
    lock.release();
  }
}

/**
 * `workers` 個のワーカーが同じキーに対して `count` 回ロック取得・解放を繰り返します。
 */
async function contended(mux: Asyncmux, workers: number, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let i = 0; i < count; i++) {
        const lock = await mux.lock("shared");
        lock.release();
      }
    }),
  );
}

/**
 * `n` 個の要求をキューに溜めてから、保持中のロックを解放して一括で流します。
 */
async function queued(mux: Asyncmux, n: number): Promise<void> {
  const holder = await mux.lock();
  const promises: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    promises.push(
      (i & 1) === 0 ? mux.lock().then((l) => l.release()) : mux.rLock().then((l) => l.release()),
    );
  }
  holder.release();
  await Promise.all(promises);
}

describe("A. uncontended", () => {
  const mux = new Asyncmux();

  bench("lock / release (no key)", async () => {
    const lock = await mux.lock();
    lock.release();
  });

  bench("lock / release (key)", async () => {
    const lock = await mux.lock("key");
    lock.release();
  });

  bench("rLock / release", async () => {
    const lock = await mux.rLock();
    lock.release();
  });

  bench("rLock / release (key)", async () => {
    const lock = await mux.rLock("key");
    lock.release();
  });
});

describe("B. low contention", () => {
  bench("2 workers x 4 ops (same key)", async () => {
    await contended(new Asyncmux(), 2, 4);
  });

  bench("2 workers x 16 ops (same key)", async () => {
    await contended(new Asyncmux(), 2, 16);
  });
});

describe("C. high contention", () => {
  bench("32 concurrent requests (no key)", async () => {
    const mux = new Asyncmux();
    await Promise.all(Array.from({ length: 32 }, () => mux.lock().then((l) => l.release())));
  });

  bench("128 concurrent requests (same key)", async () => {
    const mux = new Asyncmux();
    await Promise.all(
      Array.from({ length: 128 }, () => mux.lock("shared").then((l) => l.release())),
    );
  });
});

describe("D. repeated lock/unlock", () => {
  bench("sequential x 16", async () => {
    await sequential(new Asyncmux(), 16);
  });

  bench("sequential x 64", async () => {
    await sequential(new Asyncmux(), 64);
  });
});

describe("E. queued operations", () => {
  bench("drain 50 queued R/W requests", async () => {
    await queued(new Asyncmux(), 50);
  });

  bench("drain 200 queued R/W requests", async () => {
    await queued(new Asyncmux(), 200);
  });
});

describe("F. error path", () => {
  const mux = new Asyncmux();

  bench("double release (throws LockReleasedError)", async () => {
    const lock = await mux.lock();
    lock.release();
    try {
      lock.release();
    } catch {
      // noop
    }
  });

  bench("immediately aborted signal (rejects)", async () => {
    const mux = new Asyncmux();
    const controller = new AbortController();
    controller.abort();
    try {
      await mux.lock({ signal: controller.signal });
    } catch {
      // noop
    }
  });
});

describe("G. cancellation", () => {
  bench("abort while waiting in queue", async () => {
    const mux = new Asyncmux();
    const holder = await mux.lock();
    const controller = new AbortController();
    const promise = mux.lock({ signal: controller.signal }).catch(() => {});
    controller.abort();
    await promise;
    holder.release();
  });
});

describe("H. realistic workload", () => {
  bench("reader-writer cache access (12R + 3W + global W)", async () => {
    const mux = new Asyncmux();
    const tasks: Promise<void>[] = [];
    for (let k = 0; k < 12; k++) {
      tasks.push(mux.rLock(`cache-${k % 4}`).then((l) => l.release()));
    }
    for (let k = 0; k < 3; k++) {
      tasks.push(mux.lock(`cache-${k}`).then((l) => l.release()));
    }
    tasks.push(mux.lock().then((l) => l.release()));
    await Promise.all(tasks);
  });
});
