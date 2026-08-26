# クラスメソッド {#class-method-utilities}

## デコレーター {#decorator}

::: info
`asyncmux` をデコレーターとして使用する場合、ステージ 3 のデコレーターがサポートされている実行環境、またはそれを再現した実装が必要です。
:::

### `@asyncmux` {#decorator-asyncmux}

クラスメソッドデコレーター `@asyncmux` は、書き込みロックを獲得し、クラスメソッドを排他的に実行します。

#### シグネチャー

```ts
function asyncmux<TMethod extends AsyncClassMethod>(method: TMethod, context: unknown): TMethod;
```

#### 引数 {#decorator-asyncmux-arguments}

`method`

- **型**: `(this: any, ...args: any) => Promise<any>`

`Promise` オブジェクトを返すクラスメソッドです。

`context`

- **型**: `unknown`

ステージ 3 のデコレーターの Context オブジェクトです。

#### 例外 {#decorator-asyncmux-exceptions}

`DecoratorSupportError`

引数 `context` がステージ 3 のデコレーターの Context オブジェクトではないと判定された場合に投げられます。

#### 使用例 {#decorator-asyncmux-examples}

以下の例では、処理 B の方が早く ID をコンソールに出力しそうですが、排他制御を行っているため、実際には処理 A が ID をコンソールに出力してから、処理 B が続きます。

```ts
import { asyncmux } from "asyncmux";

class Service {
  @asyncmux
  async update(duration: string, id: string) {
    await sleep(duration);
    console.log(`update: ${id}`);
  }
}

const service = new Service();

const updatePromiseA = service.update("3s", "A");
const updatePromiseB = service.update("1s", "B");

await Promise.all([updatePromiseA, updatePromiseB]);
// update: A
// update: B
```

::: warning
再入 (デッドロックになるロックの再獲得) はサポートされていません。書き込みロックを保持しているクラスメソッドの実行中に、同じインスタンスに対して書き込みロックを要求するクラスメソッド (`@asyncmux` が付与されたメソッド) や読み取りロックを要求するクラスメソッド (`@asyncmux.readonly` が付与されたメソッド) を呼び出すと、`ReentrantLockError` が投げられます。読み取りロックを保持している場合に書き込みロックを要求する場合も同様です。読み取りロック同士は共有ロックとして扱われるため、`@asyncmux.readonly` が付与されたクラスメソッド内で `@asyncmux.readonly` が付与されたクラスメソッドを呼び出すことはできます。
:::

以下の例では、書き込みロック中のクラスメソッド内で、書き込みロックを要求する他のクラスメソッドを実行すると `ReentrantLockError` が投げられます。

```ts
import { asyncmux } from "asyncmux";

class Service {
  @asyncmux
  async create() {
    // 書き込みロック保持中に書き込みロックを要求するためデッドロックになります。
    // ロックの獲得を要求した時点で ReentrantLockError が投げられます。
    const updatePromise = service.update("3s", "A");

    await updatePromise;
  }

  @asyncmux
  async update(duration: string, id: string) {
    await sleep(duration);
    console.log(`update: ${id}`);
  }
}

const service = new Service();

await service.create(); // Error: 保持中のロックを再度獲得することはできません
```

::: info
`ReentrantLockError` の検出には非同期処理コンテキストを利用します。Node.js 22.3 以上や Bun など `process.getBuiltinModule` を利用できる環境では await をまたいだ再入も検出されますが、ブラウザーなど非同期処理コンテキストを利用できない環境では、同期的な呼び出し範囲のみ検出され、それ以外の再入はデッドロックします。
:::

### `@asyncmux.readonly` {#decorator-asyncmux-readonly}

クラスメソッドデコレーター `@asyncmux.readonly` は、読み取りロックを獲得し、クラスメソッドを排他的に実行します。複数の `@asyncmux.readonly` デコレーターは並行して実行されます。

#### シグネチャー {#decorator-asyncmux-readonly-signature}

```ts
function asyncmux.readonly<TMethod extends AsyncClassMethod>(
  method: TMethod,
  context: unknown,
): TMethod;
```

#### 引数 {#decorator-asyncmux-readonly-arguments}

`method`

- **型**: `(this: any, ...args: any) => Promise<any>`

`Promise` オブジェクトを返すクラスメソッドです。

`context`

- **型**: `unknown`

ステージ 3 のデコレーターの Context オブジェクトです。

#### 例外 {#decorator-asyncmux-readonly-exceptions}

`DecoratorSupportError`

引数 `context` がステージ 3 のデコレーターの Context オブジェクトではないと判定された場合に投げられます。

### 使用例 {#decorator-asyncmux-readonly-examples}

以下の例では、処理 A よりも処理 B の方が実行時間が短いため、読み取りロック同士であれば並列に処理され、処理 B が先に ID をコンソールに出力します。

```ts
import { asyncmux } from "asyncmux";

class Service {
  @mutex.readonly
  async read(duration: string, id: string) {
    await sleep(duration);
    console.log(`read: ${id}`);
  }
}

const service = new Service();

const readPromiseA = service.read("3s", "A");
const readPromiseB = service.read("1s", "B");

await Promise.all([readPromiseA, readPromiseB]);
// read: B
// read: A
```

以下の例では、読み取りロック中のクラスメソッド内で、さらに読み取りロックを要求する他のクラスメソッドを実行します。これらはすべて共有ロックとして扱われるため、並列に実行されます。

```ts
import { asyncmux } from "asyncmux";

class Service {
  @mutex.readonly
  async list() {
    const readPromiseA = service.read("3s", "A");
    const readPromiseB = service.read("1s", "B");

    await Promise.all([readPromiseA, readPromiseB]);
  }

  @mutex.readonly
  async read(duration: string, id: string) {
    await sleep(duration);
    console.log(`read: ${id}`);
  }
}

const service = new Service();

await service.list();
// read: B
// read: A
```

## 関数型 API {#functional-api}

### `asyncmux()` {#functional-asyncmux}

関数 `asyncmux` は、クラスメソッド内で書き込みロックを獲得します。

#### シグネチャー {#functional-asyncmux-signature}

```ts
function asyncmux(
  this_: object,
  signal?: AbortSignal,
): Promise<
  Disposable & {
    release(): void;
  }
>;
```

#### 引数 {#functional-asyncmux-arguments}

`this_`

- **型**: `object`

クラスのインスタンスです。

`options.signal`

- **型**: `AbortSignal`

ロックの獲得を中止するためのシグナルです。

#### 返値 {#functional-asyncmux-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.release()` メソッドを呼び出します。アンロックしたあと、`.release()` メソッドを呼び出すことはできません。

#### 例外 {#functional-asyncmux-exceptions}

引数 `options.signal` がすでに中止されている場合、`options.signal.reason` を投げます。

#### 使用例 {#functional-asyncmux-examples}

以下の例では、クラスメソッド内で `using` 構文を使用して書き込みロックを獲得します。

```ts
import { asyncmux } from "asyncmux";

class Service {
  async create(data: string, signal?: AbortSignal) {
    using _ = await asyncmux(this, signal);
    // ...
  }
}
```

以下の例では、クラスメソッド内で書き込みロックを獲得します。

```ts
import { asyncmux } from "asyncmux";

class Service {
  async create(data: string, signal?: AbortSignal) {
    let lock;
    if (__STRICT_MODE__) {
      lock = await asyncmux(this, signal);
    }

    try {
      // ...
    } finally {
      lock?.release();
    }
  }
}
```

### `asyncmux.readonly()` {#functional-asyncmux-readonly}

関数 `asyncmux.readonly` は、クラスメソッド内で読み取りロックを獲得します。

#### シグネチャー {#functional-asyncmux-readonly-signature}

```ts
function asyncmux.readonly(
  this_: object,
  signal?: AbortSignal,
): Promise<Disposable & {
  release(): void;
}>;
```

#### 引数 {#functional-asyncmux-readonly-arguments}

`this_`

- **型**: `object`

クラスのインスタンスです。

`options.signal`

- **型**: `AbortSignal`

ロックの獲得を中止するためのシグナルです。

#### 返値 {#functional-asyncmux-readonly-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.release()` メソッドを呼び出します。アンロックしたあと、`.release()` メソッドを呼び出すことはできません。

#### 例外 {#functional-asyncmux-readonly-exceptions}

引数 `options.signal` がすでに中止されている場合、`options.signal.reason` を投げます。

#### 使用例 {#functional-asyncmux-readonly-examples}

以下の例では、クラスメソッド内で `using` 構文を使用して読み取りロックを獲得します。

```ts
import { asyncmux } from "asyncmux";

class Service {
  async read(data: string, signal?: AbortSignal) {
    using _ = await asyncmux.readonly(this, signal);
    // ...
  }
}
```

以下の例では、クラスメソッド内で読み取りロックを獲得します。

```ts
import { asyncmux } from "asyncmux";

class Service {
  async read(data: string, signal?: AbortSignal) {
    let lock;
    if (__STRICT_MODE__) {
      lock = await asyncmux.readonly(this, signal);
    }

    try {
      // ...
    } finally {
      lock?.release();
    }
  }
}
```
