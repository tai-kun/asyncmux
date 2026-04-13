# はじめに {#getting-started}

## インストール {#installation}

### 前提条件 {#prerequisites}

- ステージ 3 のデコレーターがサポートされている実行環境、またはそれを再現した実装
- `using` 構文がサポートされている実行環境、またはそれを再現した実装

::: code-group

```sh [npm]
$ npm add asyncmux
```

```sh [pnpm]
$ pnpm add asyncmux
```

```sh [yarn]
$ yarn add asyncmux
```

```sh [bun]
$ bun add asyncmux
```

:::

### インポート {#importing}

```ts
import { asyncmux } from "asyncmux";
```

## デコレーターによる使用方法 {#usage-decorators}

クラスのメソッドに付与するだけで、そのインスタンス単位での排他制御が可能です。

### 基本的な書き込みロック (`@asyncmux`) {#basic-write-lock}

メソッドが直列に実行されるようになります。

```ts
class Runner {
  @asyncmux
  async writeTask(ms: number, value: string) {
    await sleep(ms);
    console.log(value);
  }
}
```

### 読み取り専用ロック (`@asyncmux.readonly`) {#readonly-lock}

複数の読み取り操作は並列に実行されますが、`@asyncmux` が付いたメソッドが実行中の場合は待機します。

```ts
class Runner {
  @asyncmux.readonly
  async readTask(ms: number, value: string) {
    // 並列に実行される
    await sleep(ms);
    console.log(value);
  }
}
```

## マニュアル制御 {#manual-control}

メソッド全体ではなく、特定の範囲内または条件下だけでロックを制御したい場合に適しています。

### インスタンス単位のロック {#instance-lock}

`asyncmux(this)` または `asyncmux.readonly(this)` を呼び出します。

```ts
class Runner {
  isOpen: boolean;

  async runWithMutex(ms: number, value: string) {
    if (!this.isOpen) {
      return;
    }

    // スコープを抜けるときに自動でロックが解放される
    using _ = await asyncmux(this);

    await sleep(ms);
    console.log(value);
  }
}
```

または、

```ts
class Runner {
  isOpen: boolean;

  async runWithMutex(ms: number, value: string) {
    if (!this.isOpen) {
      return;
    }

    const mux = await asyncmux(this);
    try {
      await sleep(ms);
      console.log(value);
    } finally {
      mux.unlock();
    }
  }
}
```

### `AbortSignal` によるロックの中断 {#abort-signal-support}

`asyncmux(this)` または `asyncmux.readonly(this)` に `signal` オプションを渡せます。

```ts
class Runner {
  async runWithMutex(ms: number, value: string, signal?: AbortSignal) {
    // ロック中に `signal` が中断されればエラーを投げる
    using _ = await asyncmux(this, { signal });

    await sleep(ms);
    console.log(value);
  }
}
```

## 汎用 API による高度な制御 {#advanced-api}

`asyncmux.create()` を使用して、任意の場所でロックオブジェクトを作成・管理できます。

### キーによる細かい制御

同じキーを指定したロック同士は排他され、異なるキー同士は並列に実行されます。

```ts
const mux = asyncmux.create();

// key1 同士は直列
await Promise.all([
  (async () => {
    using _ = await mux.lock("key1");
    await task();
  })(),
  (async () => {
    using _ = await mux.lock("key1"); // key1 が空くまで待機
    await task();
  })(),
]);
```

### キーなしロック（グローバルロック） {#key-based-concurrency}

キーを指定せずに `lock()` を呼び出すと、**そのインスタンス内のすべてのロックに対して排他**となります。

```ts
const mux = asyncmux.create();

using _ = await mux.lock(); // すべての key1, key2 等の処理をブロックする
```

## 制約とエラーハンドリング {#global-lock}

### ロックの昇格の禁止 {#limitations-and-errors}

デッドロックを回避するため、**読み取りロックを保持した状態で書き込みロックを取得しようとする**とエラーになります。

```ts
class Runner {
  @asyncmux.readonly
  async read() {
    await this.write(); // ここで LockEscalationError が発生
  }

  @asyncmux
  async write() {
    // ...
  }
}
```

## 動作イメージ {#behavior-visual}

### 実行順保証 {#execution-order-guarantees}

- `W`: 書き込みロック
- `W`: 読み取りロック

| ケース          | 順序保証                                       |
| --------------- | ---------------------------------------------- |
| `W(1)` → `W(2)` | `W(1)` → `W(2)`（FIFO）                        |
| `R(1)` → `R(2)` | 非保証。`R(1)` → `R(2)` または `R(2)` → `R(1)` |
| `W` → `R`       | `W` → `R`                                      |
| `R` → `W`       | `R` → `W`                                      |
