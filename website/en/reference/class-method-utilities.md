# Class Method Utilities {#class-method-utilities}

## Decorators {#decorator}

::: info
When using `asyncmux` as a decorator, you must use an environment that supports Stage 3 decorators or an equivalent implementation.
:::

### `@asyncmux` {#decorator-asyncmux}

The `@asyncmux` class method decorator acquires a write lock and executes the class method exclusively.

#### Signature

```ts
function asyncmux<TMethod extends AsyncClassMethod>(
  method: TMethod,
  context: unknown,
): TMethod;
```

#### Arguments {#decorator-asyncmux-arguments}

`method`

- **Type**: `(this: any, ...args: any) => Promise<any>`

A class method that returns a `Promise` object.

`context`

- **Type**: `unknown`

The context object for Stage 3 decorators.

#### Exceptions {#decorator-asyncmux-exceptions}

`DecoratorSupportError`

Thrown if the `context` argument is determined not to be a Stage 3 decorator context object.

`LockEscalationError`

Thrown when attempting to acquire this write lock while a read lock is already held.

#### Examples {#decorator-asyncmux-examples}

In the following example, Task B would normally output its ID to the console faster than Task A. however, because concurrency is controlled, Task A outputs its ID first, followed by Task B.

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

The following example demonstrates executing another class method that requires a write lock from within a class method that already holds a write lock.

```ts
import { asyncmux } from "asyncmux";

class Service {
  @asyncmux
  async create() {
    const updatePromiseA = service.update("3s", "A");
    const updatePromiseB = service.update("1s", "B");

    await Promise.all([updatePromiseA, updatePromiseB]);
  }

  @asyncmux
  async update(duration: string, id: string) {
    await sleep(duration);
    console.log(`update: ${id}`);
  }
}

const service = new Service();

await service.create();
// update: A
// update: B
```

The following example demonstrates executing class methods that require a read lock from within a class method that holds a write lock.

```ts
import { asyncmux } from "asyncmux";

class Service {
  @asyncmux
  async create() {
    const readPromiseA = service.read("3s", "A");
    const readPromiseB = service.read("1s", "B");

    await Promise.all([readPromiseA, readPromiseB]);
  }

  @asyncmux.readonly
  async read(duration: string, id: string) {
    await sleep(duration);
    console.log(`read: ${id}`);
  }
}

const service = new Service();

await service.create();
// read: B
// read: A
```

The following example demonstrates a `LockEscalationError` when a class method requiring a write lock is called from within a method already holding a read lock.

```ts
import { asyncmux } from "asyncmux";

class Service {
  @asyncmux
  async create() {
    // ...
  }

  @asyncmux.readonly
  async read() {
    await this.create();
  }
}

const service = new Service();

await service.read(); // LockEscalationError
```

### `@asyncmux.readonly` {#decorator-asyncmux-readonly}

The `@asyncmux.readonly` class method decorator acquires a read lock and executes the class method. Multiple methods decorated with `@asyncmux.readonly` can execute concurrently.

#### Signature {#decorator-asyncmux-readonly-signature}

```ts
function asyncmux.readonly<TMethod extends AsyncClassMethod>(
  method: TMethod,
  context: unknown,
): TMethod;
```

#### Arguments {#decorator-asyncmux-readonly-arguments}

`method`

- **Type**: `(this: any, ...args: any) => Promise<any>`

A class method that returns a `Promise` object.

`context`

- **Type**: `unknown`

The context object for Stage 3 decorators.

#### Exceptions {#decorator-asyncmux-readonly-exceptions}

`DecoratorSupportError`

Thrown if the `context` argument is determined not to be a Stage 3 decorator context object.

#### Examples {#decorator-asyncmux-readonly-examples}

In the following example, Task B has a shorter execution time than Task A. Since multiple read locks can be held simultaneously, they process in parallel, and Task B outputs its ID to the console first.

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

The following example shows a class method acquiring a read lock and then executing other methods that also require read locks. These are all treated as shared locks and execute in parallel.

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

---

## Functional API {#functional-api}

### `asyncmux()` {#functional-asyncmux}

The `asyncmux` function acquires a write lock within a class method.

#### Signature {#functional-asyncmux-signature}

```ts
function asyncmux(
  this_: object,
  options?: {
    signal?: AbortSignal;
  },
): Promise<Disposable & {
  unlock(): void;
}>;
```

#### Arguments {#functional-asyncmux-arguments}

`this_`

- **Type**: `object`

The instance of the class.

`options.signal`

- **Type**: `AbortSignal`

An optional signal to abort the lock acquisition.

#### Return Value {#functional-asyncmux-return-value}

A `Promise` that resolves to an object used to release the lock. You can release the lock either by using the `using` statement or by calling the `.unlock()` method on this object. Note that `.unlock()` cannot be called more than once.

#### Exceptions {#functional-asyncmux-exceptions}

If the `options.signal` is already aborted, it throws `options.signal.reason`.

#### Examples {#functional-asyncmux-examples}

The following example uses the `using` statement to acquire a write lock within a class method.

```ts
import { asyncmux } from "asyncmux";

class Service {
  async create(data: string, signal?: AbortSignal) {
    using _ = asyncmux(this, { signal });
    // ...
  }
}
```

The following example manually acquires and releases a write lock within a class method.

```ts
import { asyncmux } from "asyncmux";

class Service {
  async create(data: string, signal?: AbortSignal) {
    let mux;
    if (__STRICT_MODE__) {
      mux = asyncmux(this, { signal });
    }

    try {
      // ...
    } finally {
      mux?.unlock();
    }
  }
}
```

### `asyncmux.readonly()` {#functional-asyncmux-readonly}

The `asyncmux.readonly` function acquires a read lock within a class method.

#### Signature {#functional-asyncmux-readonly-signature}

```ts
function asyncmux.readonly(
  this_: object,
  options?: {
    signal?: AbortSignal;
  },
): Promise<Disposable & {
  unlock(): void;
}>;
```

#### Arguments {#functional-asyncmux-readonly-arguments}

`this_`

- **Type**: `object`

The instance of the class.

`options.signal`

- **Type**: `AbortSignal`

An optional signal to abort the lock acquisition.

#### Return Value {#functional-asyncmux-readonly-return-value}

A `Promise` that resolves to an object used to release the lock. You can release the lock either by using the `using` statement or by calling the `.unlock()` method. Once released, the `.unlock()` method cannot be called again.

#### Exceptions {#functional-asyncmux-readonly-exceptions}

If the `options.signal` is already aborted, it throws `options.signal.reason`.

#### Examples {#functional-asyncmux-readonly-examples}

The following example uses the `using` statement to acquire a read lock within a class method.

```ts
import { asyncmux } from "asyncmux";

class Service {
  async read(data: string, signal?: AbortSignal) {
    using _ = asyncmux.readonly(this, { signal });
    // ...
  }
}
```

The following example manually acquires and releases a read lock within a class method.

```ts
import { asyncmux } from "asyncmux";

class Service {
  async read(data: string, signal?: AbortSignal) {
    let mux;
    if (__STRICT_MODE__) {
      mux = asyncmux.readonly(this, { signal });
    }

    try {
      // ...
    } finally {
      mux?.unlock();
    }
  }
}
```
