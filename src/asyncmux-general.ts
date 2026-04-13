import type {
  QueueItem,
  QueueItemG,
  QueueItemR,
  QueueItemW,
} from "./_asyncmux-queue-item.types.js";
import AsyncmuxLock from "./asyncmux-lock.js";

/**
 * ロックのオプションです。
 */
export type AsyncmuxLockOptions = Readonly<{
  /**
   * ロックするリソースの識別子です。未指定の場合は全リソースに対するロックを獲得します。
   */
  key?: string | undefined;

  /**
   * ロックの獲得を中止するシグナルです。
   */
  signal?: AbortSignal | undefined;
}>;

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html)
 */
export default class Asyncmux {
  /**
   * グローバル操作のキューです。
   */
  readonly #globalQueue: QueueItem[];

  /**
   * 指定されたリソースに対する操作のキューです。
   */
  readonly #partialQueue: Map<string, QueueItem[]>;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html)
   */
  public constructor() {
    this.#globalQueue = [];
    this.#partialQueue = new Map();
  }

  /**
   * ロックするリソースの識別子とそのキューのペアを取得します。
   *
   * @param key ロックするリソースの識別子です。
   */
  *#getQueueEntries(key: string | undefined): Generator<[string | null, QueueItem[]]> {
    if (typeof key !== "string") {
      if (this.#partialQueue.size > 0) {
        yield* this.#partialQueue.entries();
      } else {
        yield [null, this.#globalQueue];
      }
    } else if (this.#partialQueue.has(key)) {
      const queue = this.#partialQueue.get(key)!;
      yield [key, queue];
    } else {
      const latestItem = this.#globalQueue[this.#globalQueue.length - 1];
      let globalItem: QueueItemG;
      if (latestItem === undefined) {
        globalItem = {
          type: "G",
          start: () => {},
          ready: Promise.resolve(),
        };
        this.#globalQueue.push(globalItem);
      } else if (latestItem.type !== "G") {
        const { resolve, promise } = Promise.withResolvers<void>();
        globalItem = {
          type: "G",
          start: resolve,
          ready: promise,
        };
        this.#globalQueue.push(globalItem);
      } else {
        globalItem = latestItem;
      }

      const queue = [globalItem];
      const next = () => {
        queue.shift();
        const item = queue[0];
        if (item) {
          item.start();
        } else {
          this.#partialQueue.delete(key);
        }
      };

      globalItem.ready.then(next);

      this.#partialQueue.set(key, queue);
      yield [key, queue];
    }
  }

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-lock)
   */
  public lock(): Promise<AsyncmuxLock>;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-lock-key)
   */
  public lock(key: string): Promise<AsyncmuxLock>;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-lock-options)
   */
  public lock(options: AsyncmuxLockOptions): Promise<AsyncmuxLock>;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-lock)
   */
  public lock(option?: string | AsyncmuxLockOptions | undefined): Promise<AsyncmuxLock>;

  public async lock(arg0: string | AsyncmuxLockOptions | undefined = {}): Promise<AsyncmuxLock> {
    const { key, signal } = typeof arg0 === "string" ? { key: arg0 } : arg0;
    signal?.throwIfAborted();
    const queueEntries = this.#getQueueEntries(key);
    const nextFuncList: (() => void)[] = [];
    const readyPromiseList: Promise<void>[] = [];
    for (const [key, queue] of queueEntries) {
      const latestItem = queue[queue.length - 1];
      let writableItem: QueueItemW;
      if (latestItem === undefined) {
        writableItem = {
          type: "W",
          start: () => {},
          ready: Promise.resolve(),
          steps: [],
        };
        queue.push(writableItem);
      } else if (latestItem.type !== "W") {
        const { resolve, promise } = Promise.withResolvers<void>();
        writableItem = {
          type: "W",
          start: resolve,
          ready: promise,
          steps: [],
        };
        queue.push(writableItem);
      } else {
        writableItem = latestItem;
      }

      const next = (): void => {
        const step = writableItem.steps.shift();
        if (step) {
          step();
        } else {
          queue.shift();
          const item = queue[0];
          if (item) {
            item.start();
          } else if (typeof key === "string") {
            this.#partialQueue.delete(key);
          }
        }
      };

      let stepPromise: Promise<void>;
      if (writableItem.steps.length === 0) {
        // steps が空の場合は後続のタスクが下の条件に入ることができるように `next` を追加します。
        // また、2 回連続で `next` を呼び出されるため、後続のステップを実行することができます。
        stepPromise = Promise.resolve();
        writableItem.steps.push(next);
      } else {
        const { resolve, promise } = Promise.withResolvers<void>();
        stepPromise = promise;
        writableItem.steps.push(resolve);
      }

      const readyPromise = writableItem.ready.then(() => stepPromise);

      nextFuncList.push(next);
      readyPromiseList.push(readyPromise);
    }

    const next = () => nextFuncList.forEach((next) => next());
    const readyPromise = Promise.all(readyPromiseList);

    const { resolve: abort, promise: abortPromise } = Promise.withResolvers();
    signal?.addEventListener("abort", abort, { once: true });

    const { resolve: unlock, promise: unlockPromise } = Promise.withResolvers<void>();

    readyPromise.then(() => unlockPromise).finally(next);

    return Promise.race([
      abortPromise.then(() => ({
        error: signal?.reason,
      })),
      readyPromise.then(() => {
        signal?.removeEventListener("abort", abort);
        return new AsyncmuxLock(unlock);
      }),
    ]).then((result) => {
      if ("error" in result) {
        unlock(); // 未解決の `unlockPromise` を解決します。
        return Promise.reject(result.error);
      } else {
        abort(null); // 未解決の `abortPromise` を解決します。
        return Promise.resolve(result);
      }
    });
  }

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-rlock)
   */
  public rLock(): Promise<AsyncmuxLock>;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-rlock-key)
   */
  public rLock(key: string): Promise<AsyncmuxLock>;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-rlock-options)
   */
  public rLock(options: AsyncmuxLockOptions): Promise<AsyncmuxLock>;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#mux-rlock)
   */
  public rLock(option?: string | AsyncmuxLockOptions | undefined): Promise<AsyncmuxLock>;

  public async rLock(arg0: string | AsyncmuxLockOptions | undefined = {}): Promise<AsyncmuxLock> {
    const { key, signal } = typeof arg0 === "string" ? { key: arg0 } : arg0;
    signal?.throwIfAborted();
    const queueEntries = this.#getQueueEntries(key);
    const nextFuncList: (() => void)[] = [];
    const readyPromiseList: Promise<void>[] = [];
    for (const [key, queue] of queueEntries) {
      const latestItem = queue[queue.length - 1];
      let readonlyItem: QueueItemR;
      if (latestItem === undefined) {
        readonlyItem = {
          type: "R",
          start() {},
          ready: Promise.resolve(),
          count: 0,
        };
        queue.push(readonlyItem);
      } else if (latestItem.type !== "R") {
        const { promise, resolve } = Promise.withResolvers<void>();
        readonlyItem = {
          type: "R",
          start: resolve,
          ready: promise,
          count: 0,
        };
        queue.push(readonlyItem);
      } else {
        readonlyItem = latestItem;
      }

      const next = (): void => {
        readonlyItem.count -= 1;
        if (readonlyItem.count === 0) {
          queue.shift();
          const item = queue[0];
          if (item) {
            item.start();
          } else if (typeof key === "string") {
            this.#partialQueue.delete(key);
          }
        }
      };

      readonlyItem.count += 1;
      const readyPromise = readonlyItem.ready;

      nextFuncList.push(next);
      readyPromiseList.push(readyPromise);
    }

    const next = () => nextFuncList.forEach((next) => next());
    const readyPromise = Promise.all(readyPromiseList);

    const { resolve: abort, promise: abortPromise } = Promise.withResolvers();
    signal?.addEventListener("abort", abort, { once: true });

    const { resolve: unlock, promise: unlockPromise } = Promise.withResolvers<void>();

    readyPromise.then(() => unlockPromise).finally(next);

    return Promise.race([
      abortPromise.then(() => ({
        error: signal?.reason,
      })),
      readyPromise.then(() => {
        signal?.removeEventListener("abort", abort);
        return new AsyncmuxLock(unlock);
      }),
    ]).then((result) => {
      if ("error" in result) {
        unlock(); // 未解決の `unlockPromise` を解決します。
        return Promise.reject(result.error);
      } else {
        abort(null); // 未解決の `abortPromise` を解決します。
        return Promise.resolve(result);
      }
    });
  }
}
