# What is asyncmux? {#what-is-asyncmux}

`asyncmux` is a library designed to simplify exclusive control (Mutex / Read-Write Lock) for asynchronous operations in JavaScript/TypeScript environments. It supports both concise declarative syntax via decorators and manual control utilizing the `using` statement.

## Features {#features}

- **Write Lock**: Prevents concurrent execution of specific processes, ensuring they run sequentially.
- **Read Lock**: Allows multiple read operations to execute in parallel.
- **Read/Write Control**: Prevents reads while a write is in progress, and prevents writes while reads are in progress.
- **Abortable**: Supports `AbortSignal` to cancel a pending operation waiting for a lock.
- **Fine-grained Locking**: Allows acquiring locks on a per-resource basis by specifying key strings.

## Use Cases {#use-cases}

`asyncmux` is highly effective in scenarios where asynchronous processes overlap:

### Preventing Resource Inconsistency {#preventing-resource-inconsistency}

A classic example is when a user profile is being "updated" and "retrieved" simultaneously.

- **Read**: Multiple users viewing a profile at once is perfectly fine; these run in parallel to maintain performance.
- **Write**: While a profile is being updated, retrieval processes are queued to prevent users from reading stale or partially updated data.

### Preventing Duplicate Submissions {#prevention-of-duplicate-submissions}

By applying `@asyncmux` to button handlers that trigger API requests, you can queue (serialize) subsequent executions until the previous one finishes, preventing accidental double registrations.

### Exclusive Control of Complex Initialization {#exclusive-control-of-initialization}

By using specific keys—such as `using _ = await mux.lock("init")`—you can ensure that initialization tasks like "loading config files" or "establishing database connections" (which might be called by multiple components at once) are executed exactly once or strictly in order.

## Developer Experience {#developer-experience}

### Declarative Syntax (Decorators) {#declarative-syntax-decorators}

By simply adding `@asyncmux` or `@asyncmux.readonly` to a method, you can cleanly decouple your business logic from your concurrency control code.

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

### Scope-based Automatic Release (`using` statement) {#scope-based-automatic-release}

For manual control, the library adopts the `using` statement, which **structurally eliminates the critical bug of "forgotten lock releases."** Whether a function returns early or throws an error, the lock is guaranteed to be released the moment it leaves the scope. It also allows for conditional locking within your logic.

```ts
class Runner {
  async write(path: string, data: string, signal: AbortSignal): Promise<void> {
    using _ = await asyncmux(this, signal);
  }
}
```

Alternatively:

```ts
class Runner {
  async write(path: string, data: string, signal: AbortSignal): Promise<void> {
    const mux = await asyncmux(this, signal);
    try {
      // ...
    } finally {
      mux.unlock();
    }
  }
}
```

### Fine-grained Locking {#fine-grained-lock}

By creating an API instance with `asyncmux.create()`, you can acquire locks for specific resources using key strings. Omitting the key string allows you to acquire a global lock across all resources.

```ts
import { Asyncmux } from "asyncmux";

const mux = new Asyncmux();

using _ = await mux.lock(); // Write lock for all resources

using _ = await mux.lock("posts"); // Write lock for "posts" resource

using _ = await mux.lock("profile"); // Write lock for "profile" resource
using _ = await mux.rLock("profile"); // Read lock for "profile" resource
```
