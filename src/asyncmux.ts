import unreachable from "./_unreachable.js";
import { DecoratorSupportError, LockEscalationError } from "./errors.js";

/***************************************************************************************************
 *
 * 共通の型
 *
 **************************************************************************************************/

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

/***************************************************************************************************
 *
 * クラスメソッドで利用するユーティリティー
 *
 **************************************************************************************************/

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

/**
 * ロックのオプションです。
 */
type ManualAsyncmuxOptions = Readonly<{
  /**
   * ロックの獲得を中止するシグナルです。
   */
  abortSignal?: AbortSignal | undefined;
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
  const { abortSignal } = options || {};
  abortSignal?.throwIfAborted();

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

  const onAbort = () => error(abortSignal!.reason);
  abortSignal?.addEventListener("abort", onAbort, { once: true });

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
      abortSignal?.removeEventListener("abort", onAbort);
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
 * 1 つ以上のクラスメソッドを同時実行性 1 で非同期処理するデコレーターです。
 */
function asyncmux<TMethod extends AsyncClassMethod>(method: TMethod, context: unknown): TMethod;

/**
 * 同時実行性 1 で非同期処理するためのロックを獲得します。
 *
 * @param this_ インスタンスの `this` です。
 * @param options ロックのオプションです。
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
 * 1 つ以上のクラスメソッドを並行して処理するデコレーターです。`asyncmux` と並行して実行されることはありません。
 */
function asyncmuxReadonly<TMethod extends AsyncClassMethod>(
  method: TMethod,
  context: unknown,
): TMethod;

/**
 * 共有ロック（読み取りロック）を獲得します。
 *
 * @param this_ インスタンスの `this` です。
 * @param options ロックのオプションです。
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

/***************************************************************************************************
 *
 * 汎用ユーティリティー
 *
 **************************************************************************************************/

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
  abortSignal?: AbortSignal | undefined;
}>;

/**
 * 排他制御のためのキューを管理するクラスです。
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
   * 全リソースに対するロックを獲得します。
   *
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public lock(): Promise<AsyncmuxLock>;

  /**
   * リソースを指定してロックを獲得します。
   *
   * @param key ロックするリソースの識別子です。
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public lock(key: string): Promise<AsyncmuxLock>;

  /**
   * ロックを獲得します。
   *
   * @param options ロックのオプションです。
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public lock(options: AsyncmuxLockOptions): Promise<AsyncmuxLock>;

  /**
   * ロックを獲得します。
   *
   * @param option ロックするリソースの識別子またはロックのオプションです。
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public lock(option?: string | AsyncmuxLockOptions | undefined): Promise<AsyncmuxLock>;

  public async lock(arg0: string | AsyncmuxLockOptions | undefined = {}): Promise<AsyncmuxLock> {
    const {
      key,
      abortSignal,
    } = typeof arg0 === "string"
      ? { key: arg0 }
      : arg0;
    abortSignal?.throwIfAborted();
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
    abortSignal?.addEventListener("abort", abort, { once: true });

    const {
      resolve: unlock,
      promise: unlockPromise,
    } = Promise.withResolvers<void>();

    readyPromise
      .then(() => unlockPromise)
      .finally(next);

    return Promise.race([
      abortPromise.then(() => ({
        error: abortSignal?.reason,
      })),
      readyPromise.then(() => {
        abortSignal?.removeEventListener("abort", abort);
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
   * 全リソースに対する読み取りロックを獲得します。
   *
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public rLock(): Promise<AsyncmuxLock>;

  /**
   * リソースを指定して読み取りロックを獲得します。
   *
   * @param key ロックするリソースの識別子です。
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public rLock(key: string): Promise<AsyncmuxLock>;

  /**
   * 読み取りロックを獲得します。
   *
   * @param options ロックのオプションです。
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public rLock(options: AsyncmuxLockOptions): Promise<AsyncmuxLock>;

  /**
   * 読み取りロックを獲得します。
   *
   * @param option ロックするリソースの識別子またはロックのオプションです。
   * @returns 獲得したロックを解除するための `AsyncmuxLock` オブジェクトです。
   * `using` 構文を使うか、このオブジェクトの `unlock` メソッドを呼び出すことで、獲得したロックが解除されます。
   */
  public rLock(option?: string | AsyncmuxLockOptions | undefined): Promise<AsyncmuxLock>;

  public async rLock(arg0: string | AsyncmuxLockOptions | undefined = {}): Promise<AsyncmuxLock> {
    const {
      key,
      abortSignal,
    } = typeof arg0 === "string"
      ? { key: arg0 }
      : arg0;
    abortSignal?.throwIfAborted();
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
    abortSignal?.addEventListener("abort", abort, { once: true });

    const {
      resolve: unlock,
      promise: unlockPromise,
    } = Promise.withResolvers<void>();

    readyPromise
      .then(() => unlockPromise)
      .finally(next);

    return Promise.race([
      abortPromise.then(() => ({
        error: abortSignal?.reason,
      })),
      readyPromise.then(() => {
        abortSignal?.removeEventListener("abort", abort);
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
 * 排他制御のためのキューを管理するオブジェクトを作成します。
 *
 * @returns 排他制御のためのキューを管理するオブジェクトです。
 */
function createAsyncmux(): Asyncmux {
  return new Asyncmux();
}

/***************************************************************************************************
 *
 * Export
 *
 **************************************************************************************************/

export type { Asyncmux, AsyncmuxLock, AsyncmuxLockOptions };

export default /*#__PURE__*/ Object.assign(asyncmux, {
  /**
   * 排他制御のためのキューを管理するオブジェクトを作成する関数です。
   */
  create: createAsyncmux,

  /**
   * 1 つ以上のクラスメソッドを並行して処理するデコレーターです。`@asyncmux` と並行して実行されることはありません。
   */
  readonly: asyncmuxReadonly,
});
