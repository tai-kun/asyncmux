# 汎用 API {#general-utilities}

## 概要 {#summary}

汎用 API ではキー文字列によってリソース単位で排他制御することができます。また、キーを省略すると全リソースに対して排他制御することができます。このロックオブジェクトはクラスメソッドだけでなく、あらゆる場所で使用できます。

::: warning
汎用 API はクラスメソッドを用いた排他制御より柔軟に扱えますが、無計画に使用すると不要なオーバーヘッドが発生したり、コードの保守が困難になったりする可能性があります。
:::

## API {#api}

### `Asyncmux` {#asyncmux-create}

クラス `Asyncmux` は、書き込み / 読み取りロックを獲得するためのロックオブジェクトを作成します。排他制御の影響範囲は、このロックオブジェクトに限定されます。

#### シグネチャー {#create-signature}

```ts
class Asyncmux {
  lock(key?: string): Promise<
    Disposable & {
      unlock(): void;
    }
  >;
  lock(options: { key?: string; signal?: AbortSignal }): Promise<
    Disposable & {
      unlock(): void;
    }
  >;

  rLock(key?: string): Promise<
    Disposable & {
      unlock(): void;
    }
  >;
  rLock(options: { key?: string; signal?: AbortSignal }): Promise<
    Disposable & {
      unlock(): void;
    }
  >;
}
```

#### 返値 {#create-return-value}

書き込み / 読み取りロックを獲得するためのロックオブジェクトです。

#### 使用例 {#create-example}

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
```

### `mux.lock()` {#mux-lock}

メソッド `mux.lock()` は、全リソースに対する書き込みロックを獲得します。

#### シグネチャー {#lock-signature}

```ts
function lock(): Promise<
  Disposable & {
    unlock(): void;
  }
>;
```

#### 返値 {#lock-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.unlock()` メソッドを呼び出します。アンロックしたあと、`.unlock()` メソッドを呼び出すことはできません。

#### 使用例 {#lock-example}

以下の例では、クラスメソッド内で `using` 構文を使用して書き込みロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

{
  using _ = await mux.lock();
}
```

以下の例では、書き込みロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const lock = await mux.lock();
try {
  // ...
} finally {
  lock.unlock();
}
```

### `mux.lock(key)` {#mux-lock-key}

メソッド `mux.lock(key)` は、特定のリソースに対する書き込みロックを獲得します。

#### シグネチャー {#lock-key-signature}

```ts
function lock(key: string): Promise<
  Disposable & {
    unlock(): void;
  }
>;
```

#### 引数 {#lock-key-arguments}

`key`

- **型**: `string`

排他制御の対象をキー文字列で指定します。

#### 返値 {#lock-key-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.unlock()` メソッドを呼び出します。アンロックしたあと、`.unlock()` メソッドを呼び出すことはできません。

#### 使用例 {#lock-key-example}

以下の例では、クラスメソッド内で `using` 構文を使用して書き込みロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

{
  using _ = await mux.lock("resource(1)");
}
```

以下の例では、書き込みロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const lock = await mux.lock("resource(1)");
try {
  // ...
} finally {
  lock.unlock();
}
```

### `mux.lock(options)` {#mux-lock-options}

メソッド `mux.lock(options)` は、すべてまたは特定のリソースに対する書き込みロックを獲得します。

#### シグネチャー {#lock-options-signature}

```ts
function lock(options: { key?: string; signal?: AbortSignal }): Promise<
  Disposable & {
    unlock(): void;
  }
>;
```

#### 引数 {#lock-options-arguments}

`options.key`

- **型**: `string`

排他制御の対象をキー文字列で指定します。

`options.signal`

- **型**: `AbortSignal`

ロックの獲得を中止するためのシグナルです。

#### 返値 {#lock-options-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.unlock()` メソッドを呼び出します。アンロックしたあと、`.unlock()` メソッドを呼び出すことはできません。

#### 使用例 {#lock-options-example}

以下の例では、クラスメソッド内で `using` 構文を使用し、特定のリソースに対して書き込みロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const ac = new AbortController();

{
  using _ = await mux.lock({ key: "resource(1)", signal: ac.signal });
}
```

以下の例では、全リソースに対して書き込みロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const ac = new AbortController();
const lock = await mux.lock({ signal: ac.signal });
try {
  // ...
} finally {
  lock.unlock();
}
```

### `mux.rLock()` {#mux-rlock}

メソッド `mux.rLock()` は、全リソースに対する読み取りロックを獲得します。

#### シグネチャー {#rlock-signature}

```ts
function lock(): Promise<
  Disposable & {
    unlock(): void;
  }
>;
```

#### 返値 {#rlock-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.unlock()` メソッドを呼び出します。アンロックしたあと、`.unlock()` メソッドを呼び出すことはできません。

#### 使用例 {#rlock-example}

以下の例では、クラスメソッド内で `using` 構文を使用して読み取りロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

{
  using _ = await mux.rLock();
}
```

以下の例では、読み取りロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const lock = await mux.rLock();
try {
  // ...
} finally {
  lock.unlock();
}
```

### `mux.rLock(key)` {#mux-rlock-key}

メソッド `mux.rLock(key)` は、特定のリソースに対する読み取りロックを獲得します。

#### シグネチャー {#rlock-key-signature}

```ts
function lock(key: string): Promise<
  Disposable & {
    unlock(): void;
  }
>;
```

#### 引数 {#rlock-key-arguments}

`key`

- **型**: `string`

排他制御の対象をキー文字列で指定します。

#### 返値 {#rlock-key-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.unlock()` メソッドを呼び出します。アンロックしたあと、`.unlock()` メソッドを呼び出すことはできません。

#### 使用例 {#rlock-key-example}

以下の例では、クラスメソッド内で `using` 構文を使用して読み取りロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

{
  using _ = await mux.rLock("resource(1)");
}
```

以下の例では、読み取りロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const lock = await mux.rLock("resource(1)");
try {
  // ...
} finally {
  lock.unlock();
}
```

### `mux.rLock(options)` {#mux-rlock-options}

メソッド `mux.rLock(options)` は、すべてまたは特定のリソースに対する読み取りロックを獲得します。

#### シグネチャー {#rlock-options-signature}

```ts
function lock(options: { key?: string; signal?: AbortSignal }): Promise<
  Disposable & {
    unlock(): void;
  }
>;
```

#### 引数 {#rlock-options-arguments}

`options.key`

- **型**: `string`

排他制御の対象をキー文字列で指定します。

`options.signal`

- **型**: `AbortSignal`

ロックの獲得を中止するためのシグナルです。

#### 返値 {#rlock-options-return-value}

アンロックするためのオブジェクトで解決される `Promise` オブジェクトです。アンロックするためには、`using` 構文を使うか、このオブジェクトの `.unlock()` メソッドを呼び出します。アンロックしたあと、`.unlock()` メソッドを呼び出すことはできません。

#### 使用例 {#rlock-options-example}

以下の例では、クラスメソッド内で `using` 構文を使用し、特定のリソースに対して読み取りロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const ac = new AbortController();

{
  using _ = await mux.rLock({ key: "resource(1)", signal: ac.signal });
}
```

以下の例では、全リソースに対して読み取りロックを獲得します。

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const ac = new AbortController();
const lock = await mux.rLock({ signal: ac.signal });
try {
  // ...
} finally {
  lock.unlock();
}
```
