# Errors {#errors}

`asyncmux` custom error classes are designed with internationalization (i18n) in mind, built upon the `i18n-error-base` framework.

## `ErrorBase` {#error-base}

This is the base class for all `asyncmux` errors. It extends `I18nErrorBase` from `i18n-error-base`, providing support for errors with metadata and localized messages.

## `UnreachableError` {#unreachable-error}

An error used when "unreachable code" is executed. It is primarily used for exhaustiveness checking (the `never` type) or ensuring an exhaustive `switch` statement.

### Metadata {#unreachable-metadata}

```ts
{
  value?: unknown;
}
```

**`value`**

- **Type**: `unknown`

The value that was supposed to be unreachable.

### Troubleshooting {#unreachable-troubleshooting}

If this error occurs at runtime, it likely indicates that the user is utilizing `asyncmux` in a non-type-safe manner, or there is a bug within `asyncmux` itself.

## `DecoratorSupportError` {#decorator-support-error}

An error thrown when the runtime environment does not support Stage 3 decorators.

### Troubleshooting {#decorator-support-troubleshooting}

You must use a runtime environment that supports Stage 3 decorators or provide a polyfill/implementation that simulates them.

## LockReleasedError {#lock-released-error}

This error is thrown when an attempt is made to release a lock that has already been released.

### Troubleshooting {#lock-released-troubleshooting}

Ensure that the code does not attempt to release a lock that has already been released.

## `ReentrantLockError` {#reentrant-lock-error}

This error is thrown when reentrant (re-acquiring) lock acquisition that would deadlock is detected. It is thrown when a write lock or a read lock is requested for the same instance while a class method holding a write lock is running, or when a write lock is requested while a read lock is held.

### Troubleshooting {#reentrant-lock-troubleshooting}

Do not request a write lock for the same instance from within a locked method of that instance. Calls between read locks (calling a method decorated with `@asyncmux.readonly` from within a method decorated with `@asyncmux.readonly`) are allowed as shared locks.

::: info
On runtimes where an async context is available, such as Node.js 22.3+ and Bun, reentrancy across `await` boundaries is also detected. On environments where it is unavailable, such as browsers, only synchronous call ranges are detected and other reentrant calls still deadlock without throwing.
:::
