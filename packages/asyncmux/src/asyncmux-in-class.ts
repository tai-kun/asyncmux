import log, { isLogDebugEnabled } from "./_logger.js";
import AsyncmuxLock from "./asyncmux-lock.js";
import { DecoratorSupportError, ReentrantLockError } from "./errors.js";

/**
 * 要求するロックの種類を定義します。
 *
 * - "R": 読み取りロック（共有ロック）
 * - "W": 書き込みロック（排他ロック）
 */
type LockType = "R" | "W";

/**
 * キューに登録される個々のロック要求を表すインターフェースです。
 */
interface LockRequest {
  /**
   * ロックの種別です。
   */
  type: LockType;

  /**
   * ロックが獲得された際に呼び出される解決用関数です。
   *
   * @param lock 獲得したロックオブジェクトです。
   */
  resolve: (lock: AsyncmuxLock) => void;

  /**
   * ロック獲得に失敗、または中断された際に呼び出される拒否用関数です。
   *
   * @param ex エラーオブジェクトまたは中断理由です。
   */
  reject: (ex: unknown) => void;

  /**
   * 中断を検知するためのシグナルです。
   */
  signal: AbortSignal | undefined;

  /**
   * 中断イベントが発生した際のクリーンアップ用ハンドラーです。
   */
  handleAbort?: () => void;
}

/**
 * ミューテックスの内部状態を管理するクラスです。
 */
class MutexState {
  /**
   * ロック獲得を待機しているリクエストのキューです。
   */
  public queue: LockRequest[];

  /**
   * 書き込みロックが現在保持されているかどうかを示します。
   */
  public writing: boolean;

  /**
   * 現在読み込みロックを保持しているリーダーの数です。
   */
  public readerCount: number;

  /**
   * MutexState クラスのコンストラクターです。
   */
  public constructor() {
    this.queue = [];
    this.writing = false;
    this.readerCount = 0;
  }

  /**
   * デバッグ表示用に現在の状態をオブジェクトで返します。
   *
   * @returns 状態のスナップショットオブジェクトです。
   */
  public snapshot() {
    return {
      W: this.writing,
      R: this.readerCount,
      queueN: this.queue.length,
    };
  }
}

/**
 * オブジェクトごとのミューテックス状態を保持する WeakMap です。
 *
 * 対象のオブジェクトがガベージコレクションされると、対応する状態も自動的に削除されます。
 */
const stateMap = new WeakMap<object, MutexState>();

/**
 * 指定されたオブジェクトに関連付けられた MutexState を取得します。
 *
 * 存在しない場合は新しく作成して登録します。
 *
 * @param this_ 状態を管理する対象のオブジェクトです。
 * @returns 対象のオブジェクトに対応する MutexState インスタンスです。
 */
function getOrCreateState(this_: object): MutexState {
  let state = stateMap.get(this_);
  if (!state) {
    state = new MutexState();
    stateMap.set(this_, state);
  }

  return state;
}

// -------------------------------------------------------------------------------------------------
//
// 再入検出
//
// -------------------------------------------------------------------------------------------------

/**
 * オブジェクトごとに、その非同期処理コンテキスト内で保持中のロック種別のスタックを表します。
 */
type LockStackMap = Map<object, LockType[]>;

/**
 * 非同期処理コンテキストごとにロックの保持状況を追跡するためのインターフェースです。
 */
interface ReentrancyTracker {
  /**
   * 現在の非同期処理コンテキストにおける、指定されたオブジェクトのロック保持スタックを返します。
   *
   * @param target ロック対象のオブジェクトです。
   * @returns 保持中のロック種別のスタックです。追跡されていない場合は `undefined` です。
   */
  getStack(target: object): readonly LockType[] | undefined;

  /**
   * 指定されたオブジェクトへのロック獲得を記録したコンテキスト内でコールバックを実行します。
   *
   * @param target ロック対象のオブジェクトです。
   * @param type 獲得したロックの種別です。
   * @param callback 実行するコールバック関数です。
   * @returns コールバック関数の戻り値です。
   */
  run<T>(target: object, type: LockType, callback: () => T): T;
}

/**
 * `node:async_hooks` の AsyncLocalStorage を利用して非同期処理全体を追跡するトラッカーです。
 *
 * await をまたいだ再入も検出できます。
 */
class AsyncContextTracker implements ReentrancyTracker {
  #storage: {
    getStore(): LockStackMap | undefined;
    run<T>(store: LockStackMap, callback: () => T): T;
  };

  public constructor(storage: {
    getStore(): LockStackMap | undefined;
    run<T>(store: LockStackMap, callback: () => T): T;
  }) {
    this.#storage = storage;
  }

  public getStack(target: object): readonly LockType[] | undefined {
    return this.#storage.getStore()?.get(target);
  }

  public run<T>(target: object, type: LockType, callback: () => T): T {
    const next: LockStackMap = new Map(this.#storage.getStore() ?? []);
    next.set(target, [...(next.get(target) ?? []), type]);

    return this.#storage.run(next, callback);
  }
}

/**
 * 同期的な呼び出し範囲のみを追跡するフォールバックのトラッカーです。
 *
 * 非同期処理コンテキストを利用できない環境 (ブラウザーなど) で使用され、await をまたいだ再入は検出できません。
 */
class SyncStackTracker implements ReentrancyTracker {
  #stacks = new WeakMap<object, LockType[]>();

  public getStack(target: object): readonly LockType[] | undefined {
    return this.#stacks.get(target);
  }

  public run<T>(target: object, type: LockType, callback: () => T): T {
    let stack = this.#stacks.get(target);
    if (!stack) {
      stack = [];
      this.#stacks.set(target, stack);
    }

    stack.push(type);
    try {
      return callback();
    } finally {
      stack.pop();
    }
  }
}

/**
 * 再入検出用のトラッカーを作成します。
 *
 * `process.getBuiltinModule` を利用できるランタイム (Node.js 22.3 以上、Bun など) では AsyncLocalStorage ベースのトラッカーを使用し、それ以外の環境では同期的な呼び出し範囲のみを追跡するトラッカーにフォールバックします。
 *
 * @returns 作成したトラッカーです。
 */
function createTracker(): ReentrancyTracker {
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
    const asyncHooks = proc?.getBuiltinModule?.("node:async_hooks") as
      | {
          AsyncLocalStorage: new () => {
            getStore(): LockStackMap | undefined;
            run<T>(store: LockStackMap, callback: () => T): T;
          };
        }
      | undefined;

    if (asyncHooks && typeof asyncHooks.AsyncLocalStorage === "function") {
      return new AsyncContextTracker(new asyncHooks.AsyncLocalStorage());
    }
  } catch {
    // node:async_hooks を利用できない環境ではフォールバックします。
  }

  return new SyncStackTracker();
}

const tracker: ReentrancyTracker = createTracker();

/**
 * 同じオブジェクトに対する再入 (デッドロックになるロック要求) を検出した場合にエラーを投げます。
 *
 * - 書き込みロックの保持中は、読み書きどちらのロック要求でもデッドロックするため許可されません。
 * - 読み取りロックの保持中に書き込みロックを要求した場合もデッドロックするため許可されません。
 * - 読み取りロック同士は共有ロックとして扱われるため許可されます。
 *
 * @param type 要求するロックの種別です。
 * @param this_ ロック対象のオブジェクトです。
 * @throws {ReentrantLockError} デッドロックになる再入を検出した場合に投げられます。
 */
function assertNotReentrant(type: LockType, this_: object): void {
  const stack = tracker.getStack(this_);
  if (stack && stack.length > 0 && (stack.includes("W") || type === "W")) {
    if (isLogDebugEnabled()) {
      log.debug`Reentrant lock request detected: type=${type}`;
    }

    throw new ReentrantLockError();
  }
}

/**
 * 待機キューを処理し、可能な限りロックを割り当てます。
 *
 * @param this_ ロック対象のオブジェクトです。
 * @param state 現在のミューテックス状態です。
 */
function processQueue(this_: object, state: MutexState): void {
  if (isLogDebugEnabled()) {
    log.debug((t) => t`Processing queue. Current state: ${state.snapshot()}`);
  }

  // キューが空になるか、ロックがブロックされるまでループを回します。
  while (state.queue.length > 0) {
    const req = state.queue[0]!;

    if (req.type === "W") {
      // 他の書き込みが行われておらず、かつ読み込みも行われていない場合のみ獲得可能です。
      if (state.readerCount === 0 && !state.writing) {
        // 先頭のリクエストを取り出して状態を更新します。
        state.queue.shift();
        state.writing = true;

        if (isLogDebugEnabled()) {
          log.debug`Write lock ACQUIRED.`;
        }

        // 中断ハンドラーが登録されている場合は、解決前にリスナーを削除してメモリーリークを防ぎます。
        if (req.signal && req.handleAbort) {
          req.signal.removeEventListener("abort", req.handleAbort);
        }

        // ロックオブジェクトを生成して Promise を解決します。
        req.resolve(createLock(this_, state, "W"));
      } else {
        if (isLogDebugEnabled()) {
          log.debug`Write lock blocked. Waiting...`;
        }

        // ロックを獲得できないため、キューの処理をここで停止して待機します。
        // 書き込み待機がある場合、後続の読み込みリクエストを処理せず順序を維持します。
        break;
      }
    } else {
      // 書き込みが行われていなければ獲得可能です。
      if (!state.writing) {
        state.queue.shift();
        state.readerCount++;

        if (isLogDebugEnabled()) {
          log.debug`Read lock ACQUIRED. Total readers: ${state.readerCount}`;
        }

        // 中断ハンドラーを解除します。
        if (req.signal && req.handleAbort) {
          req.signal.removeEventListener("abort", req.handleAbort);
        }

        req.resolve(createLock(this_, state, "R"));
        // 読み込みロックは並行して実行できるため、ループを継続して次のリクエストを確認します。
      } else {
        if (isLogDebugEnabled()) {
          log.debug`Read lock blocked by writer. Waiting...`;
        }

        // 書き込み中のため待機します。
        break;
      }
    }
  }
}

/**
 * ロック解放時の処理を含むロックオブジェクトを作成します。
 *
 * @param this_ ロック対象のオブジェクトです。
 * @param state 現在のミューテックス状態です。
 * @param type 解放するロックの型です。
 * @returns 生成された AsyncmuxLock インスタンスです。
 */
function createLock(this_: object, state: MutexState, type: LockType): AsyncmuxLock {
  return new AsyncmuxLock(() => {
    if (isLogDebugEnabled()) {
      log.debug`Releasing ${type === "W" ? "Write" : "Read"} lock.`;
    }

    // ロック状態を更新します。
    if (type === "W") {
      state.writing = false;
      // 書き込みが終了したため、次の待機リクエスト（読み込みまたは書き込み）を処理します。
      processQueue(this_, state);
    } else {
      state.readerCount--;
      // 最後のリーダーが読み込みを終えた場合のみ、待機中の書き込みを開始できる可能性があります。
      if (state.readerCount === 0) {
        processQueue(this_, state);
      }
    }

    // どのリソースも使っておらず、待機キューも空である場合は stateMap からエントリーを削除して、メモリー効率を最適化します。
    if (state.readerCount === 0 && !state.writing && state.queue.length === 0) {
      if (isLogDebugEnabled()) {
        log.debug`State is idle. Cleaning up stateMap.`;
      }

      stateMap.delete(this_);
    }
  });
}

/**
 * 指定された型のロックを要求します。
 *
 * @param type ロックの型（R または W）です。
 * @param this_ ロック対象となるオブジェクト（コンテキスト）です。
 * @param signal 中断を検知するためのオプションの AbortSignal です。
 * @returns ロック獲得時に解決される Promise です。
 */
function requestLock(type: LockType, this_: object, signal?: AbortSignal): Promise<AsyncmuxLock> {
  if (isLogDebugEnabled()) {
    log.debug`Requesting ${type === "W" ? "Write" : "Read"} lock.`;
  }

  // 同じオブジェクトへの再入 (デッドロックになるロック要求) を検出した場合は即座にエラーを投げます。
  assertNotReentrant(type, this_);

  // リクエストの時点で既にシグナルが中断されている場合は、キューに追加せず即座にエラーを投げます。
  if (signal?.aborted) {
    if (isLogDebugEnabled()) {
      log.debug`Request aborted immediately (signal already aborted).`;
    }

    return Promise.reject(signal?.reason);
  }

  const { reject, resolve, promise } = Promise.withResolvers<AsyncmuxLock>();
  const state = getOrCreateState(this_);
  const req: LockRequest = { type, resolve, reject, signal };

  if (signal) {
    req.handleAbort = () => {
      // キューの中から自分自身のリクエストを探します。
      const idx = state.queue.indexOf(req);
      if (idx !== -1) {
        if (isLogDebugEnabled()) {
          log.debug`Request CANCELLED via AbortSignal.`;
        }

        // 待機キューから自分を削除し、Promise を拒否状態にします。
        state.queue.splice(idx, 1);
        reject(signal.reason);

        // 自分がキューから脱落したことで、後続の待機リクエストが処理可能になる場合があるため、キューを再実行します。
        processQueue(this_, state);
      }
    };

    signal.addEventListener("abort", req.handleAbort, { once: true });
  }

  // リクエストをキューの末尾に追加し、獲得処理を試みます。
  state.queue.push(req);
  processQueue(this_, state);

  return promise;
}

/**
 * Stage 3 のクラスメソッドデコレーターをサポートしているか検証します。
 *
 * @param context デコレーターのコンテキストです。
 * @throws Stage 3 のデコレーターをサポートしていない場合に DecoratorSupportError を投げます。
 */
function assertStage3ClassMethodDecoratorSupport(
  context: unknown,
): asserts context is ClassMethodDecoratorContext {
  // context がオブジェクトであり、addInitializer メソッドが存在するかをチェックします。
  if (
    context &&
    typeof context === "object" &&
    "addInitializer" in context &&
    typeof context.addInitializer === "function"
  ) {
    return;
  }

  // サポートされていない環境、または古いデコレーター仕様の場合はエラーを投げます。
  throw new DecoratorSupportError();
}

/**
 * 非同期クラスメソッドのシグネチャーを定義する型です。
 */
interface AsyncClassMethod {
  (this: any, ...args: any): Promise<any>;
}

/**
 * クラスメソッドをラップし、実行時に自動でロックの取得と解放を行うようにします。
 *
 * @param type 使用するロックの型です。
 * @param method 元のメソッド実装です。
 * @param context デコレーターコンテキストです。
 * @returns ラップされた新しいメソッドです。
 */
function wrapClassMethod(
  type: LockType,
  method: AsyncClassMethod,
  context: unknown,
): AsyncClassMethod {
  assertStage3ClassMethodDecoratorSupport(context);

  return function wrappedClassMethod(...args) {
    return (async (lockPromise) => {
      const lock = await lockPromise;
      try {
        // メソッドの実行全体を再入検出の対象として記録します。
        const returns = await tracker.run(this, type, () => method.apply(this, args));
        return returns;
      } finally {
        // メソッドの実行が完了してからロックを開放します。
        lock.release();
      }
    })(requestLock(type, this));
  };
}

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#decorator-asyncmux)
 */
function asyncmux<TMethod extends AsyncClassMethod>(method: TMethod, context: unknown): TMethod;

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#functional-asyncmux)
 */
function asyncmux(this_: object, signal?: AbortSignal): Promise<AsyncmuxLock>;

function asyncmux(...args: [any, any?]): AsyncClassMethod | Promise<AsyncmuxLock> {
  if (typeof args[0] === "function") {
    return wrapClassMethod("W", ...args);
  } else {
    return requestLock("W", ...args);
  }
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
function asyncmuxReadonly(this_: object, signal?: AbortSignal): Promise<AsyncmuxLock>;

function asyncmuxReadonly(...args: [any, any?]): AsyncClassMethod | Promise<AsyncmuxLock> {
  if (typeof args[0] === "function") {
    return wrapClassMethod("R", ...args);
  } else {
    return requestLock("R", ...args);
  }
}

export default /*#__PURE__*/ Object.assign(asyncmux, {
  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/class-method-utilities.html#decorator-asyncmux-readonly)
   */
  readonly: asyncmuxReadonly,
});
