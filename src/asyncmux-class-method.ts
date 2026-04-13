import type { QueueItemR, QueueItemW } from "./_asyncmux-queue-item.types.js";
import unreachable from "./_unreachable.js";
import AsyncmuxLock from "./asyncmux-lock.js";
import { DecoratorSupportError, LockEscalationError } from "./errors.js";

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
    context &&
    typeof context === "object" &&
    "addInitializer" in context &&
    typeof context.addInitializer === "function"
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

  const { resolve: error, promise: errorPromise } = Promise.withResolvers();
  const { resolve: ready, promise: readyPromise } = Promise.withResolvers<void>();
  const { resolve: unlock, promise: unlockPromise } = Promise.withResolvers<void>();

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

    method.call(this_).catch(error);
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
    errorPromise.then((error) => ({ error })),
    readyPromise.then(() => new AsyncmuxLock(unlock)),
  ])
    .then((result) => {
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
        const { promise, resolve } = Promise.withResolvers<void>();
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
      const { promise, resolve } = Promise.withResolvers<void>();
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
        const { promise, resolve } = Promise.withResolvers<void>();
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

export default /*#__PURE__*/ Object.assign(asyncmux, {
  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#decorator-asyncmux-readonly)
   */
  readonly: asyncmuxReadonly,
});
