# Getting Started {#getting-started}

## Installation {#installation}

### Prerequisites {#prerequisites}

- A runtime environment supporting Stage 3 Decorators (or a compatible polyfill).
- A runtime environment supporting the `using` statement (Explicit Resource Management) or a compatible polyfill.

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

### Importing {#importing}

```ts
import { asyncmux } from "asyncmux";
```

## Usage with Decorators {#usage-decorators}

Simply apply decorators to class methods to enable exclusive access control on a per-instance basis.

### Basic Write Lock (`@asyncmux`) {#basic-write-lock}

Ensures that methods are executed serially (one after another).

```ts
class Runner {
  @asyncmux
  async writeTask(ms: number, value: string) {
    await sleep(ms);
    console.log(value);
  }
}
```

### Read-Only Lock (`@asyncmux.readonly`) {#readonly-lock}

Allows multiple read operations to execute in parallel, but will wait if a method decorated with `@asyncmux` (write lock) is currently running.

```ts
class Runner {
  @asyncmux.readonly
  async readTask(ms: number, value: string) {
    // Executed in parallel with other readers
    await sleep(ms);
    console.log(value);
  }
}
```

## Manual Control {#manual-control}

Use manual control when you need to manage locks within a specific scope or under specific conditions rather than the entire method.

### Instance-Level Locking {#instance-lock}

Call `asyncmux(this)` or `asyncmux.readonly(this)`.

```ts
class Runner {
  isOpen: boolean;

  async runWithMutex(ms: number, value: string) {
    if (!this.isOpen) {
      return;
    }

    // The lock is automatically released when exiting the scope
    using _ = await asyncmux(this);

    await sleep(ms);
    console.log(value);
  }
}
```

Alternatively, using the classic `try...finally` pattern:

```ts
class Runner {
  isOpen: boolean;

  async runWithMutex(ms: number, value: string) {
    if (!this.isOpen) {
      return;
    }

    const lock = await asyncmux(this);
    try {
      await sleep(ms);
      console.log(value);
    } finally {
      lock.release();
    }
  }
}
```

### AbortSignal Support {#abort-signal-support}

You can pass a `signal` option to `asyncmux(this)` or `asyncmux.readonly(this)`.

```ts
class Runner {
  async runWithMutex(ms: number, value: string, signal?: AbortSignal) {
    // Throws an error if the signal is aborted while waiting for the lock
    using _ = await asyncmux(this, signal);

    await sleep(ms);
    console.log(value);
  }
}
```

## Advanced Control via General API {#advanced-api}

Use `asyncmux.create()` to create and manage lock objects anywhere in your code.

### Fine-Grained Control with Keys

Locks sharing the same key are mutually exclusive, while those with different keys run in parallel.

```ts
const mux = asyncmux.create();

// Serial execution for 'key1'
await Promise.all([
  (async () => {
    using _ = await mux.lock("key1");
    await task();
  })(),
  (async () => {
    using _ = await mux.lock("key1"); // Waits until key1 is released
    await task();
  })(),
]);
```

### Keyless Locking (Global Lock) {#key-based-concurrency}

Calling `lock()` without a key creates a **global lock that excludes all other locks** within that instance.

```ts
const mux = asyncmux.create();

using _ = await mux.lock(); // Blocks all processing for key1, key2, etc.
```

## Behavior Overview {#behavior-visual}

### Execution Order Guarantees {#execution-order-guarantees}

- `W`: Write Lock
- `R`: Read Lock

| Case            | Order Guarantee                                  |
| --------------- | ------------------------------------------------ |
| `W(1)` → `W(2)` | `W(1)` → `W(2)` (FIFO)                           |
| `R(1)` → `R(2)` | No guarantee. `R(1)` → `R(2)` or `R(2)` → `R(1)` |
| `W` → `R`       | `W` → `R`                                        |
| `R` → `W`       | `R` → `W`                                        |
