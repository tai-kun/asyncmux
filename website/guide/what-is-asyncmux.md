# asyncmux とは？ {#what-is-asyncmux}

`asyncmux` は、JavaScript/TypeScript 環境で非同期処理の排他制御（Mutex / 読み書きロック）を簡単に実現するためのライブラリーです。デコレーターによる簡潔な記述と、`using` 構文を利用できるマニュアル制御の両方に対応しています。

## 特徴 {#features}

- **書き込みロック**: 特定の処理の同時実行を禁止し、1 つずつ順番に実行します。
- **読み取りロック**: 読み取り同士は並列に実行できます。
- **Read / Write 制御**: 書き込み中は読み取り不可、読み取り中は書き込み不可となります。
- **ロックの昇格禁止**: 読み取りロック中に書き込みロックを取得しようとすると `LockEscalationError` が発生します。
- **再入可能**: すでにロックを取得しているコンテキスト内から、さらに同じロックを要求してもデッドロックしません。
- **中止可能**: `AbortSignal` によって排他制御による処理の実行待機を中止できます。
- **きめ細やかなロック**: キー文字列で指定することで、リソース単位のロックを獲得できます。

## ユースケース {#use-cases}

非同期処理が入り乱れる状況において、以下のような場面で威力を発揮します。

### リソースの不整合防止 {#preventing-resource-inconsistency}

例えば、ユーザープロフィールの「更新」と「参照」が同時に走るケースです。

- **読み取り**: 複数のユーザーが同時にプロフィールを閲覧しても問題ないため、並列に実行してパフォーマンスを維持します。
- **書き込み**: プロフィール更新中は、古いデータや中途半端な状態を読み取らせないよう、参照処理を待機させます。

### 二重送信・連打防止 {#prevention-of-duplicate-submissions}

API リクエストを伴うボタン操作などに `@asyncmux` を付与することで、前回の処理が終わるまで次の実行をキューイング（直列化）し、意図しない二重登録を防げます。

### 複雑な初期化処理の排他制御 {#exclusive-control-of-initialization}

`using _ = await mux.lock("init")` のように特定のキーを使用することで、複数のコンポーネントから同時に呼ばれる「設定ファイルの読み込み」や「データベース接続」などの初期化処理を、確実に一度だけ（または順番に）実行させることができます。

## 開発体験 {#developer-experience}

### 宣言的な記述（デコレーター） {#declarative-syntax-decorators}

メソッドに `@asyncmux` や `@asyncmux.readonly` を付けるだけで、ビジネスロジックと排他制御のコードを完全に分離できます。

```ts
class Runner {
  @asyncmux
  async write(path: string, data: string): Promise<void> {
    // ...
  }

  @asyncmux.readonly
  async read(path: string): Promise<string> {
    // ...
  }
}
```

### スコープベースの自動解放（`using` 構文） {#scope-based-automatic-release}

マニュアル制御において `using` 構文を採用しているため、**「ロックの解放漏れ」という致命的なバグが構造的に発生しません**。関数の途中で `return` したり、エラーが `throw` されたりしても、スコープを抜ける瞬間に確実にロックが解放されます。また、条件分岐の中でロックすることができます。

```ts
class Runner {
  async write(path: string, data: string, signal: AbortSignal): Promise<void> {
    using _ = await asyncmux(this, { signal });
  }
}
```

または、

```ts
class Runner {
  async write(path: string, data: string, signal: AbortSignal): Promise<void> {
    const mux = await asyncmux(this, { signal });
    try {
      // ...
    } finally {
      mux.unlock();
    }
  }
}
```

### きめ細やかなロック {#fine-grained-lock}

`asyncmux.create()` で API インスタンスを作成することで、キー文字列によるリソース単位のロックを獲得することができます。キー文字列を省略することで、全リソースに対するロックを獲得することもできます。

```ts
const mux = asyncmux.create();

using _ = await mux.lock(); // 全リソースに対する書き込みロック

using _ = await mux.lock("posts"); // リソース "posts" に対する書き込みロック

using _ = await mux.lock("profile"); // リソース "profile" に対する書き込みロック
using _ = await mux.rLock("profile"); // リソース "profile" に対する読み取りロック
```

### 再入可能性によるデッドロックの回避 {#avoiding-deadlock-with-reentrancy}

テストコードの「直列の中で直列を実行可能」という項目にある通り、同じインスタンス内であれば再帰的にロックを呼び出せます。

> **例:** `Method A (Lock)` が内部で `Method B (Lock)` を呼んでも止まらない。

これにより、既存のメソッドを組み合わせて新しいメソッドを作る際、ロックの重複を気にせず安全に合成が可能です。

### デッドロックの早期検知 {#early-detection-of-deadlocks}

「並行の中で直列を実行しようとするとエラー」になる仕様は、非常に強力です。読み取りロック中に書き込みロックを待機してしまうと、他の読み取り層と互いに待ち合うデッドロックに陥ります。`asyncmux` はこれを `LockEscalationError` として即座に通知するため、実行時に「なぜかフリーズする」というデバッグ困難な状況を防げます。
