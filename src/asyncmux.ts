import log, { isLogDebugEnabled } from "./_logger.js";
import AsyncmuxLock from "./asyncmux-lock.js";

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
  readonly type: LockType;

  /**
   * ロック対象を識別するキーです。グローバルロックの場合は `null` です。
   */
  readonly key: string | null;

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
}

/**
 * 二つの数値のうち、大きい方の数値を返します。
 *
 * @param a 比較対象の数値 1 です。
 * @param b 比較対象の数値 2 です。
 * @returns 二つの数値のうち大きい方の値です。
 */
function max(a: number, b: number): number {
  return a > b ? a : b;
}

/**
 * 現在のロック取得状況を管理するための内部クラスです。競合の判定ロジックを集約しています。
 */
class LockState {
  /**
   * グローバルな書き込みロックの保持数です。
   */
  private globalWriterCount: number;

  /**
   * グローバルな読み取りロックの保持数です。
   */
  private globalReaderCount: number;

  /**
   * キーごとの書き込みロック保持数を管理するマップです。
   */
  private localWriterCountMap: Map<string, number>;

  /**
   * キーごとの読み取りロック保持数を管理するマップです。
   */
  private localReaderCountMap: Map<string, number>;

  /**
   * インスタンスを初期化します。
   */
  public constructor() {
    this.globalWriterCount = 0;
    this.globalReaderCount = 0;
    this.localWriterCountMap = new Map();
    this.localReaderCountMap = new Map();
  }

  /**
   * 指定された要求を現在の状態に追加します。
   *
   * @param req 追加するロック要求です。
   */
  public add(req: LockRequest): void {
    if (req.key === null) {
      // キーがない場合はグローバルカウンターをインクリメントします。
      if (req.type === "W") {
        this.globalWriterCount++;
      } else {
        this.globalReaderCount++;
      }
    } else {
      // キーがある場合は該当するマップのカウンターを更新します。
      if (req.type === "W") {
        this.localWriterCountMap.set(req.key, (this.localWriterCountMap.get(req.key) ?? 0) + 1);
      } else {
        this.localReaderCountMap.set(req.key, (this.localReaderCountMap.get(req.key) ?? 0) + 1);
      }
    }
  }

  /**
   * 指定された要求を現在の状態から削除します。
   *
   * @param req 削除するロック要求です。
   */
  public remove(req: LockRequest): void {
    if (req.key === null) {
      if (req.type === "W") {
        this.globalWriterCount = max(0, this.globalWriterCount - 1);
      } else {
        this.globalReaderCount = max(0, this.globalReaderCount - 1);
      }
    } else {
      const countMap = req.type === "W" ? this.localWriterCountMap : this.localReaderCountMap;
      const count = (countMap.get(req.key) ?? 0) - 1;
      if (count <= 0) {
        // カウンターが 0 以下になる場合は、マップの肥大化を防ぐためエントリーごと削除します。
        countMap.delete(req.key);
      } else {
        countMap.set(req.key, count);
      }
    }
  }

  /**
   * 指定された要求が、現在のロック状況と競合するかどうかを判定します。
   *
   * @param req 判定対象のロック要求です。
   * @returns 競合する場合は `true`、そうでない場合は `false` を返します。
   */
  public conflicts(req: LockRequest): boolean {
    if (req.type === "W") {
      if (req.key === null) {
        // グローバル書き込みは、あらゆる読み書き（グローバル・ローカル問わず）と競合します。
        return (
          this.globalWriterCount > 0 ||
          this.globalReaderCount > 0 ||
          this.localWriterCountMap.size > 0 ||
          this.localReaderCountMap.size > 0
        );
      } else {
        // ローカル書き込みは、グローバルな読み書き、および同じキーの読み書きと競合します。
        return (
          this.globalWriterCount > 0 ||
          this.globalReaderCount > 0 ||
          (this.localWriterCountMap.get(req.key) || 0) > 0 ||
          (this.localReaderCountMap.get(req.key) || 0) > 0
        );
      }
    } else {
      if (req.key === null) {
        // グローバル読み込みは、あらゆる書き込み要求と競合します。
        return this.globalWriterCount > 0 || this.localWriterCountMap.size > 0;
      } else {
        // ローカル読み込みは、グローバル書き込み、および同じキーの書き込みと競合します。
        return this.globalWriterCount > 0 || (this.localWriterCountMap.get(req.key) ?? 0) > 0;
      }
    }
  }

  /**
   * デバッグ表示用に現在の状態をオブジェクトで返します。
   */
  public snapshot() {
    return {
      global: {
        W: this.globalWriterCount,
        R: this.globalReaderCount,
      },
      localW: Object.fromEntries(this.localWriterCountMap),
      localR: Object.fromEntries(this.localReaderCountMap),
    };
  }
}

export type AsyncmuxLockOptions = {
  readonly key?: string | undefined;
  readonly signal?: AbortSignal | undefined;
};

/**
 * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html)
 */
export default class Asyncmux {
  /**
   * ロック取得を待機している要求のキューです。
   */
  #queue: LockRequest[];

  /**
   * キュー内の待機中の要求の状態をまとめたものです。常に `#queue` の内容と一致します。
   *
   * 新しい要求がキュー内の先行要求と競合するかどうかを、キュー全体を走査せずに判定するために使用します。
   */
  readonly #pendingState: LockState;

  /**
   * `#queue` の再構築時に使い回すバッファーです。
   */
  #queueSwap: LockRequest[];

  /**
   * 現在アクティブ（取得中）なロックの状態です。
   */
  readonly #activeState: LockState;

  /**
   * キューの処理中かどうかを示すフラグです。
   */
  #isProcessing: boolean;

  /**
   * キューの再チェックが必要かどうかを示すフラグです。
   */
  #needsRecheck: boolean;

  /**
   * [API Reference](https://tai-kun.github.io/asyncmux/reference/general-utilities.html)
   */
  public constructor() {
    this.#queue = [];
    this.#queueSwap = [];
    this.#activeState = new LockState();
    this.#pendingState = new LockState();
    this.#isProcessing = false;
    this.#needsRecheck = false;
  }

  /**
   * 要求をキューに積み、Promise を作成します。
   *
   * @param type ロックの種別（R/W）です。
   * @param key ロック対象のキーです。
   * @param signal 中断用のシグナルです。
   * @returns AsyncmuxLock で解決される Promise です。
   */
  #enqueue(
    type: LockType,
    key: string | null,
    signal: AbortSignal | undefined,
  ): Promise<AsyncmuxLock> {
    // すでにシグナルが中断されている場合は、即座に拒否されたプロミスを返します。
    if (signal?.aborted) {
      if (isLogDebugEnabled()) {
        log.debug`Request immediately rejected due to aborted signal`;
      }

      return Promise.reject(signal.reason);
    }

    if (isLogDebugEnabled()) {
      log.debug`Enqueueing request: type=${type}, key=${key}`;
    }

    const { reject, resolve, promise } = Promise.withResolvers<AsyncmuxLock>();
    const req: LockRequest = { key, type, reject, resolve };

    if (signal) {
      // シグナルによるキャンセルが発生した際のハンドラーを定義します。
      const handleAbort = (): void => {
        if (isLogDebugEnabled()) {
          log.debug`Abort triggered for request: type=${type}, key=${key}`;
        }

        const idx = this.#queue.indexOf(req);
        if (idx !== -1) {
          // キューから自分自身を削除し、理由を添えてプロミスを拒否します。
          this.#queue.splice(idx, 1);
          this.#pendingState.remove(req);
          reject(signal.reason);
          // 自分がキューから抜けたことで、後続のロックが取得可能になる可能性があるため再評価します。
          this.#tryAcquire();
        }
      };

      // シグナルを監視します。once オプションにより、実行は一回限りとなります。
      signal.addEventListener("abort", handleAbort, { once: true });

      // resolve/reject をラップして、完了時にイベントリスナーをクリーンアップするようにします。
      req.resolve = (lock: AsyncmuxLock) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(lock);
      };
      req.reject = (ex: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(ex);
      };
    }

    // アクティブなロックと待機キュー上の先行要求のどちらとも競合しない場合は、
    // キューの走査を行わずに即座にロックを割り当てます。
    // 先行要求と競合しないことは FIFO 順序・公平性に影響しないことが保証されており、
    // また新しい要求の追加が既存の待機要求の取得可否を変えることはないため、
    // 取得できない場合も `#tryAcquire()` による再走査は不要です。
    if (!this.#activeState.conflicts(req) && !this.#pendingState.conflicts(req)) {
      this.#activeState.add(req);
      req.resolve(this.#createLock(req));

      return promise;
    }

    // キューの末尾に追加します。取得可能な状態になるのはロック解放時など、
    // 既存の状態が変化したタイミングです。
    this.#pendingState.add(req);
    this.#queue.push(req);

    // キューの追加まで同期的に行い、最後に Promise を返します。
    return promise;
  }

  /**
   * 解放時にキューを再評価するロックオブジェクトを生成します。
   *
   * @param req ロックを割り当てる対象の要求です。
   */
  #createLock(req: LockRequest): AsyncmuxLock {
    return new AsyncmuxLock(() => {
      if (isLogDebugEnabled()) {
        log.debug`Releasing lock: type=${req.type}, key=${req.key}`;
      }

      this.#activeState.remove(req);

      if (isLogDebugEnabled()) {
        log.debug((t) => t`State after release: ${this.#activeState.snapshot()}`);
      }

      // ロックが解放されたため、新しい要求が通る可能性を求めて再評価します。
      this.#tryAcquire();
    });
  }

  /**
   * キューを走査し、取得可能なロックを解決します。逐次処理による無限ループを防ぎつつ、順序を守ってロックを割り当てます。
   */
  #tryAcquire(): void {
    // すでに処理中の場合は、現在の処理が終了した後に再チェックするようにフラグを立てます。
    if (this.#isProcessing) {
      if (isLogDebugEnabled()) {
        log.debug`Already processing. Setting recheck flag.`;
      }

      this.#needsRecheck = true;
      return;
    }

    if (isLogDebugEnabled()) {
      log.debug`Starting tryAcquire. Current queue length: ${this.#queue.length}`;
    }

    this.#isProcessing = true;
    try {
      do {
        this.#needsRecheck = false;

        const queue = this.#queue;
        const nextQueue = this.#queueSwap;
        nextQueue.length = 0;

        // ライタースターベーションを防止するためのシミュレーターです。
        // 現在アクティブなロックだけでなく、キュー上の自分より前にいる要求も考慮します。
        // 競合する要求が現れるまで生成されないため、無競合時の割り当てコストを抑えられます。
        let queueState: LockState | null = null;

        let i = 0;
        while (i < queue.length) {
          const req = queue[i]!;
          i++;

          const conflictWithActive = this.#activeState.conflicts(req);
          const conflictWithQueue = queueState !== null && queueState.conflicts(req);

          // 現在実行中のロックと競合せず、かつキュー内の先行する要求とも競合しない場合のみ許可されます。
          if (!conflictWithActive && !conflictWithQueue) {
            if (isLogDebugEnabled()) {
              log.debug`Lock acquired: type=${req.type}, key=${req.key}`;
            }

            // アクティブな状態として登録し、待機状態からは除外します。
            this.#activeState.add(req);
            this.#pendingState.remove(req);

            // ロックが解放された際に再度キューを動かすための仕掛けを施したオブジェクトを渡します。
            req.resolve(this.#createLock(req));
          } else {
            // 今回は取得できなかったため、次回のキューに残します。
            // また、後続の要求にとっての壁となるよう queueState に現在の要求を追加します。
            (queueState ??= new LockState()).add(req);
            nextQueue.push(req);

            if (req.type === "W" && req.key === null) {
              // グローバル書き込み要求はすべての要求と競合するため、
              // 以降の要求も取得できないことが確定します。残りをそのまま残して走査を打ち切ります。
              while (i < queue.length) {
                nextQueue.push(queue[i]!);
                i++;
              }

              break;
            }
          }
        }

        // ロックを取得できなかった要求のみでキューを更新します。
        // 1 つも取得できなかった場合は内容が同一のため、配列の差し替えを省略します。
        if (nextQueue.length < queue.length) {
          this.#queue = nextQueue;
          this.#queueSwap = queue;
        }

        // 処理中に needsRecheck が立てられた場合、ループを継続します。
      } while (this.#needsRecheck);
    } finally {
      // 処理の完了フラグを戻します。
      this.#isProcessing = false;

      if (isLogDebugEnabled()) {
        log.debug`Finished tryAcquire cycle. Remaining queue: ${this.#queue.length}`;
      }
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
  public lock(keyOrOptions?: string | AsyncmuxLockOptions): Promise<AsyncmuxLock>;

  public lock(arg0: string | AsyncmuxLockOptions | undefined = {}): Promise<AsyncmuxLock> {
    const { key = null, signal } = typeof arg0 === "string" ? { key: arg0 } : arg0;
    return this.#enqueue("W", key, signal);
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
  public rLock(keyOrOptions?: string | AsyncmuxLockOptions): Promise<AsyncmuxLock>;

  public rLock(arg0: string | AsyncmuxLockOptions | undefined = {}): Promise<AsyncmuxLock> {
    const { key = null, signal } = typeof arg0 === "string" ? { key: arg0 } : arg0;
    return this.#enqueue("R", key, signal);
  }
}
