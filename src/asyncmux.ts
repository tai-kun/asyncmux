import unreachable from "./_unreachable.js";
import { DecoratorSupportError, LockEscalationError } from "./errors.js";

// -------------------------------------------------------------------------------------------------
//
// 共通の型
//
// -------------------------------------------------------------------------------------------------

/**
 * 書き込み操作のキューアイテムを表す型です。
 */
type QueueItemW = {
  /**
   * キューの種類の識別子です。
   */
  readonly type: "W";

  /**
   * キュー内の次のアイテムの実行を開始する関数です。
   */
  readonly start: () => void;

  /**
   * 実行準備ができたことを示す `Promise` です。
   */
  readonly ready: Promise<void>;

  /**
   * 順番に実行されるステップの配列です。
   */
  readonly steps: (() => void)[];
};

/**
 * 読み取り操作のキューアイテムを表す型です。
 */
type QueueItemR = {
  /**
   * キューの種類の識別子です。
   */
  readonly type: "R";

  /**
   * キュー内の次のアイテムの実行を開始する関数です。
   */
  readonly start: () => void;

  /**
   * 実行準備ができたことを示す `Promise` です。
   */
  readonly ready: Promise<void>;

  /**
   * 同時に実行されている読み取り操作の数です。
   */
  count: number;
};

/**
 * グローバル操作のキューアイテムを表す型です。
 */
type QueueItemG = {
  /**
   * キューの種類の識別子です。
   */
  readonly type: "G";

  /**
   * キュー内の次のアイテムの実行を開始する関数です。
   */
  readonly start: () => void;

  /**
   * 実行準備ができたことを示す `Promise` です。
   */
  readonly ready: Promise<void>;
};

/**
 * キューアイテムの型です。
 */
type QueueItem =
  | QueueItemW
  | QueueItemR
  | QueueItemG;

/**
 * 獲得したロックを解除するためのオブジェクトです。
 * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
 */
class AsyncmuxLock implements Disposable {
  /**
   * ロックしている `Promise` オブジェクトを解除する関数です。
   */
  #resolve: () => void;

  /**
   * `unlock` メソッドが呼び出されたかどうがのフラグです。
   */
  #unlockCalled: boolean;

  /**
   * `AsyncmuxLock` クラスの新しいインスタンスを初期化します。
   *
   * @param resolve ロックしている `Promise` オブジェクトを解除する関数です。
   */
  public constructor(resolve: () => void) {
    this.#resolve = resolve;
    this.#unlockCalled = false;
  }

  /**
   * 獲得したロックを解除します。
   */
  public unlock(): void {
    this.#unlockCalled = true;
    this.#resolve();
  }

  /**
   * 獲得したロックを破棄します。
   */
  public [Symbol.dispose](): void {
    if (this.#unlockCalled) {
      return;
    }

    this.#resolve();
  }
}

// -------------------------------------------------------------------------------------------------
//
// クラスメソッドで利用するユーティリティー
//
// -------------------------------------------------------------------------------------------------

/**
 * asyncmux の状態を保持するプロパティーキーです。
 */
const CONTEXT = /*#__PURE__*/ Symbol.for("asyncmux/CONTEXT");

/**
 * 非同期クラスメソッドの型です。
 */
interface AsyncClassMethod {
  (this: any, ...args: any): Promise<any>;
}

/**
 * 現在のロックの種別です。初期値は `null` です。
 */
type LockType = AsyncmuxContext["queue"][number]["type"] | null;

/**
 * 現在の asyncmux のコンテクストです。
 */
class AsyncmuxContext {
  /**
   * 直列/並列処理のキューです。
   */
  public readonly queue: (QueueItemW | QueueItemR)[];

  /**
   * 現在のロックの種別です。
   */
  public readonly lockType: LockType;

  /**
   * 新しい `AsyncmuxContext` インスタンスを作成します。
   *
   * @param lockType 現在のロックの種別です。
   */
  public constructor(lockType: LockType = null) {
    this.lockType = lockType;
    this.queue = [];
  }
}

/**
 * Stage 3 のクラスメソッドデコレーターをサポートしているか検証します。
 *
 * @param context デコレーターのコンテキストです。
 * @throws Stage 3 のデコレーターをサポートしていない場合にエラーを投げます。
 */
function assertStage3ClassMethodDecoratorSupport(
  context: unknown,
): asserts context is ClassMethodDecoratorContext {
  if (
    context
    && typeof context === "object"
    && "addInitializer" in context
    && typeof context.addInitializer === "function"
  ) {
    return;
  }

  throw new DecoratorSupportError();
}

/**
 * デコレートされたクラスのインスタンスに、コンテクストを初期化します。
 */
function initializeInstance(this: any): void {
  if (Object.hasOwn(this, CONTEXT)) {
    return;
  }

  let context = new AsyncmuxContext();
  Object.defineProperty(this, CONTEXT, {
    get() {
      return context;
    },
    set(value) {
      switch (true) {
        case value instanceof AsyncmuxContext:
          context = value;
          break;

        default:
          unreachable();
      }
    },
  });
}

export type ManualAsyncmuxOptions = Readonly<{
  signal?: AbortSignal | undefined;
}>;

/**
 * @see {@link manualAsyncmux}
 * @see {@link manualAsyncmuxReadonly}
 */
function manualLock(
  this_: object,
  decorator: (method: AsyncClassMethod, context: unknown) => AsyncClassMethod,
  options: ManualAsyncmuxOptions | undefined,
): Promise<AsyncmuxLock> {
  const { signal } = options || {};
  signal?.throwIfAborted();

  const {
    resolve: error,
    promise: errorPromise,
  } = Promise.withResolvers();
  const {
    resolve: ready,
    promise: readyPromise,
  } = Promise.withResolvers<void>();
  const {
    resolve: unlock,
    promise: unlockPromise,
  } = Promise.withResolvers<void>();

  try {
    const waitForUnlock = async () => {
      ready();
      await unlockPromise;
    };
    const initializers: ((this: unknown) => void)[] = [];
    const context: Pick<ClassMethodDecoratorContext, "addInitializer"> = {
      addInitializer(initializer) {
        initializers.push(initializer);
      },
    };
    const method = decorator(waitForUnlock, context);
    for (const initializer of initializers) {
      initializer.call(this_);
    }

    method
      .call(this_)
      .catch(error);
  } catch (ex) {
    // 未解決の `Promise` を解決します。
    error(null);
    ready();
    unlock();

    return Promise.reject(ex);
  }

  const onAbort = () => error(signal!.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  return Promise.race([
    errorPromise.then(error => ({ error })),
    readyPromise.then(() => new AsyncmuxLock(unlock)),
  ])
    .then(result => {
      if ("error" in result) {
        unlock(); // 未解決の `unlockPromise` を解決します。
        return Promise.reject(result.error);
      } else {
        error(null); // 未解決の `errorPromise` を解決します。
        return Promise.resolve(result);
      }
    })
    .finally(() => {
      signal?.removeEventListener("abort", onAbort);
    });
}

/**
 * @see {@link asyncmux}
 */
function asyncmuxDecorator(method: AsyncClassMethod, context: unknown): AsyncClassMethod {
  assertStage3ClassMethodDecoratorSupport(context);
  context.addInitializer(initializeInstance);

  return function asyncmuxClassMethod(...args) {
    const context: AsyncmuxContext = this[CONTEXT];
    if (!(context instanceof AsyncmuxContext)) {
      unreachable(context);
    }

    switch (context.lockType) {
      // 読み取りロック中に書き込みしようとしたらエラー (ロックの昇格を禁止) を投げます。
      case "R":
        return Promise.reject(new LockEscalationError());

      case "W":
      case null:
        break;

      default:
        unreachable(context.lockType);
    }

    let writableItem: QueueItemW;
    const latestItem = context.queue[context.queue.length - 1];
    switch (latestItem?.type) {
      case "R": {
        const {
          promise,
          resolve,
        } = Promise.withResolvers<void>();
        writableItem = {
          type: "W",
          start: resolve,
          ready: promise,
          steps: [],
        };
        context.queue.push(writableItem);
        break;
      }

      case "W":
        writableItem = latestItem;
        break;

      case undefined:
        writableItem = {
          type: "W",
          start() {},
          ready: Promise.resolve(),
          steps: [],
        };
        context.queue.push(writableItem);
        break;

      default:
        unreachable(latestItem);
    }

    function next(): void {
      const step = writableItem.steps.shift();
      if (step) {
        step();
      } else {
        context.queue.shift();
        context.queue[0]?.start();
      }
    }

    let stepPromise: Promise<void> | undefined;
    if (writableItem.steps.length === 0) {
      // `.steps` が空の場合は後続のタスクが下の条件に入ることができるように `next` を追加します。
      // 2 回連続で `next` を呼び出すため、後続のステップを実行することができます。
      writableItem.steps.push(next);
    } else {
      const {
        promise,
        resolve,
      } = Promise.withResolvers<void>();
      stepPromise = promise;
      writableItem.steps.push(resolve);
    }

    const readyPromise = writableItem.ready.then(() => stepPromise);

    return readyPromise
      .then(() => {
        this[CONTEXT] = new AsyncmuxContext("W");
        return method.apply(this, args);
      })
      .finally(() => {
        this[CONTEXT] = context;
        next();
      });
  };
}

/**
 * @see {@link asyncmux}
 */
function manualAsyncmux(
  this_: object,
  options: ManualAsyncmuxOptions | undefined = {},
): Promise<AsyncmuxLock> {
  return manualLock(this_, asyncmuxDecorator, options);
}

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#decorator-asyncmux)
 */
function asyncmux<TMethod extends AsyncClassMethod>(method: TMethod, context: unknown): TMethod;

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#functional-asyncmux)
 */
function asyncmux(
  this_: object,
  options?: ManualAsyncmuxOptions | undefined,
): Promise<AsyncmuxLock>;

function asyncmux(...args: [any, any?]): any {
  if (typeof args[0] === "function") {
    return asyncmuxDecorator(...args);
  } else {
    return manualAsyncmux(...args);
  }
}

/**
 * @see {@link asyncmuxReadonly}
 */
function asyncmuxReadonlyDecorator(method: AsyncClassMethod, context: unknown): AsyncClassMethod {
  assertStage3ClassMethodDecoratorSupport(context);
  context.addInitializer(initializeInstance);

  return function asyncmuxReadonlyClassMethod(...args) {
    const context: AsyncmuxContext = this[CONTEXT];
    if (!(context instanceof AsyncmuxContext)) {
      unreachable(context);
    }

    let readonlyItem: QueueItemR;
    const latestItem = context.queue[context.queue.length - 1];
    switch (latestItem?.type) {
      case "R":
        readonlyItem = latestItem;
        break;

      case "W": {
        const {
          promise,
          resolve,
        } = Promise.withResolvers<void>();
        readonlyItem = {
          type: "R",
          start: resolve,
          ready: promise,
          count: 0,
        };
        context.queue.push(readonlyItem);
        break;
      }

      case undefined:
        readonlyItem = {
          type: "R",
          start() {},
          ready: Promise.resolve(),
          count: 0,
        };
        context.queue.push(readonlyItem);
        break;

      default:
        unreachable(latestItem);
    }

    function next(): void {
      readonlyItem.count -= 1;
      if (readonlyItem.count === 0) {
        context.queue.shift();
        context.queue[0]?.start();
      }
    }

    readonlyItem.count += 1;
    const readyPromise = readonlyItem.ready;

    return readyPromise
      .then(() => {
        this[CONTEXT] = new AsyncmuxContext("R");
        return method.apply(this, args);
      })
      .finally(() => {
        this[CONTEXT] = context;
        next();
      });
  };
}

/**
 * @see {@link asyncmuxReadonly}
 */
function manualAsyncmuxReadonly(
  this_: object,
  options: ManualAsyncmuxOptions | undefined,
): Promise<AsyncmuxLock> {
  return manualLock(this_, asyncmuxReadonlyDecorator, options);
}

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#decorator-asyncmux-readonly)
 */
function asyncmuxReadonly<TMethod extends AsyncClassMethod>(
  method: TMethod,
  context: unknown,
): TMethod;

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#functional-asyncmux-readonly)
 */
function asyncmuxReadonly(
  this_: object,
  options?: ManualAsyncmuxOptions | undefined,
): Promise<AsyncmuxLock>;

function asyncmuxReadonly(...args: [any, any?]): any {
  if (typeof args[0] === "function") {
    return asyncmuxReadonlyDecorator(...args);
  } else {
    return manualAsyncmuxReadonly(...args);
  }
}

// -------------------------------------------------------------------------------------------------
//
// 汎用ユーティリティー
//
// -------------------------------------------------------------------------------------------------

/**
 * ロックのオプションです。
 */
type AsyncmuxLockOptions = Readonly<{
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
class Asyncmux {
  /**
   * グローバル操作のキューです。
   */
  readonly #globalQueue: QueueItem[];

  /**
   * 指定されたリソースに対する操作のキューです。
   */
  readonly #partialQueue: Map<string, QueueItem[]>;

  /**
   * `Asyncmux` クラスの新しいインスタンスを初期化します。
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
        const {
          resolve,
          promise,
        } = Promise.withResolvers<void>();
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
    const {
      key,
      signal,
    } = typeof arg0 === "string"
      ? { key: arg0 }
      : arg0;
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
        const {
          resolve,
          promise,
        } = Promise.withResolvers<void>();
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
        const {
          resolve,
          promise,
        } = Promise.withResolvers<void>();
        stepPromise = promise;
        writableItem.steps.push(resolve);
      }

      const readyPromise = writableItem.ready.then(() => stepPromise);

      nextFuncList.push(next);
      readyPromiseList.push(readyPromise);
    }

    const next = () => nextFuncList.forEach(next => next());
    const readyPromise = Promise.all(readyPromiseList);

    const {
      resolve: abort,
      promise: abortPromise,
    } = Promise.withResolvers();
    signal?.addEventListener("abort", abort, { once: true });

    const {
      resolve: unlock,
      promise: unlockPromise,
    } = Promise.withResolvers<void>();

    readyPromise
      .then(() => unlockPromise)
      .finally(next);

    return Promise.race([
      abortPromise.then(() => ({
        error: signal?.reason,
      })),
      readyPromise.then(() => {
        signal?.removeEventListener("abort", abort);
        return new AsyncmuxLock(unlock);
      }),
    ])
      .then(result => {
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
    const {
      key,
      signal,
    } = typeof arg0 === "string"
      ? { key: arg0 }
      : arg0;
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
        const {
          promise,
          resolve,
        } = Promise.withResolvers<void>();
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

    const next = () => nextFuncList.forEach(next => next());
    const readyPromise = Promise.all(readyPromiseList);

    const {
      resolve: abort,
      promise: abortPromise,
    } = Promise.withResolvers();
    signal?.addEventListener("abort", abort, { once: true });

    const {
      resolve: unlock,
      promise: unlockPromise,
    } = Promise.withResolvers<void>();

    readyPromise
      .then(() => unlockPromise)
      .finally(next);

    return Promise.race([
      abortPromise.then(() => ({
        error: signal?.reason,
      })),
      readyPromise.then(() => {
        signal?.removeEventListener("abort", abort);
        return new AsyncmuxLock(unlock);
      }),
    ])
      .then(result => {
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

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#asyncmux-create)
 */
function createAsyncmux(): Asyncmux {
  return new Asyncmux();
}

// -------------------------------------------------------------------------------------------------
//
// Export
//
// -------------------------------------------------------------------------------------------------

export type { Asyncmux, AsyncmuxLock, AsyncmuxLockOptions };

export default /*#__PURE__*/ Object.assign(asyncmux, {
  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html#asyncmux-create)
   */
  create: createAsyncmux,

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#decorator-asyncmux-readonly)
   */
  readonly: asyncmuxReadonly,
});
