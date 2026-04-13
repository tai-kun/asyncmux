/**
 * 書き込み操作のキューアイテムを表す型です。
 */
export type QueueItemW = {
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
export type QueueItemR = {
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
export type QueueItemG = {
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
export type QueueItem = QueueItemW | QueueItemR | QueueItemG;
