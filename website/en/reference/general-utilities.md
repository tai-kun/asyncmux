# General Utilities {#general-utilities}

## Summary {#summary}

The General Utilities API allows for mutual exclusion (locking) on a per-resource basis using key strings. Additionally, omitting the key allows for global mutual exclusion across all resources. These lock objects are not limited to class methods and can be used anywhere in your code.

::: warning
While General Utilities offer more flexibility than class-method-based locking, haphazard use can lead to unnecessary overhead or make the code difficult to maintain.
:::

## API {#api}

### `Asyncmux` {#asyncmux-create}

The `Asyncmux` class creates a lock object used to acquire read/write locks. The scope of mutual exclusion is limited to the specific lock object returned.

#### Signature {#create-signature}

```ts
class Asyncmux {
  lock(key?: string): Promise<
    Disposable & {
      release(): void;
    }
  >;
  lock(options: { key?: string; signal?: AbortSignal }): Promise<
    Disposable & {
      release(): void;
    }
  >;

  rLock(key?: string): Promise<
    Disposable & {
      release(): void;
    }
  >;
  rLock(options: { key?: string; signal?: AbortSignal }): Promise<
    Disposable & {
      release(): void;
    }
  >;
}
```

#### Return Value {#create-return-value}

A lock object used to acquire read/write locks.

#### Example {#create-example}

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
```

---

### `mux.lock()` {#mux-lock}

The `mux.lock()` method acquires a write lock for all resources (global lock).

#### Signature {#lock-signature}

```ts
function lock(): Promise<
  Disposable & {
    release(): void;
  }
>;
```

#### Return Value {#lock-return-value}

A `Promise` that resolves to an unlocker object. To release the lock, use the `using` statement or call the `.release()` method on this object. Note that `.release()` cannot be called again after the lock has been released.

#### Example {#lock-example}

The following example uses the `using` statement to acquire a write lock.

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

{
  using _ = await mux.lock();
}
```

The following example manually acquires and releases a write lock.

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const lock = await mux.lock();
try {
  // ...
} finally {
  lock.release();
}
```

---

### `mux.lock(key)` {#mux-lock-key}

The `mux.lock(key)` method acquires a write lock for a specific resource.

#### Signature {#lock-key-signature}

```ts
function lock(key: string): Promise<
  Disposable & {
    release(): void;
  }
>;
```

#### Arguments {#lock-key-arguments}

`key`

- **Type**: `string`
- The key string identifying the resource to lock.

#### Return Value {#lock-key-return-value}

A `Promise` that resolves to an unlocker object. Release the lock using the `using` statement or by calling `.release()`.

#### Example {#lock-key-example}

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

{
  using _ = await mux.lock("resource(1)");
}
```

---

### `mux.lock(options)` {#mux-lock-options}

The `mux.lock(options)` method acquires a write lock for either a specific resource or all resources, with additional control.

#### Signature {#lock-options-signature}

```ts
function lock(options: { key?: string; signal?: AbortSignal }): Promise<
  Disposable & {
    release(): void;
  }
>;
```

#### Arguments {#lock-options-arguments}

`options.key`

- **Type**: `string`
- The key string identifying the resource to lock.

`options.signal`

- **Type**: `AbortSignal`
- An abort signal used to cancel the lock acquisition.

#### Return Value {#lock-options-return-value}

A `Promise` that resolves to an unlocker object.

#### Example {#lock-options-example}

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const ac = new AbortController();

{
  using _ = await mux.lock({ key: "resource(1)", signal: ac.signal });
}
```

---

### `mux.rLock()` {#mux-rlock}

The `mux.rLock()` method acquires a read lock for all resources.

#### Signature {#rlock-signature}

```ts
function rLock(): Promise<
  Disposable & {
    release(): void;
  }
>;
```

#### Return Value {#rlock-return-value}

A `Promise` that resolves to an unlocker object.

#### Example {#rlock-example}

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

{
  using _ = await mux.rLock();
}
```

---

### `mux.rLock(key)` {#mux-rlock-key}

The `mux.rLock(key)` method acquires a read lock for a specific resource.

#### Signature {#rlock-key-signature}

```ts
function rLock(key: string): Promise<
  Disposable & {
    release(): void;
  }
>;
```

#### Arguments {#rlock-key-arguments}

`key`

- **Type**: `string`
- The key string identifying the resource to lock.

#### Example {#rlock-key-example}

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const lock = await mux.rLock("resource(1)");
try {
  // ...
} finally {
  lock.release();
}
```

---

### `mux.rLock(options)` {#mux-rlock-options}

The `mux.rLock(options)` method acquires a read lock for either a specific resource or all resources.

#### Signature {#rlock-options-signature}

```ts
function rLock(options: { key?: string; signal?: AbortSignal }): Promise<
  Disposable & {
    release(): void;
  }
>;
```

#### Arguments {#rlock-options-arguments}

`options.key`

- **Type**: `string`
- The key string identifying the target resource.

`options.signal`

- **Type**: `AbortSignal`
- An abort signal used to cancel the lock acquisition.

#### Example {#rlock-options-example}

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();
const ac = new AbortController();

const lock = await mux.rLock({ signal: ac.signal });
try {
  // ...
} finally {
  lock.release();
}
```
