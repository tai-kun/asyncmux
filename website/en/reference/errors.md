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

## `LockEscalationError` {#lock-escalation-error}

An error thrown when an attempt is made to perform lock escalation (upgrading from a `read` lock to a `write` lock).

### Troubleshooting {#lock-escalation-troubleshooting}

This is a design constraint intended to prevent deadlocks. Please consider the following:

- Review and refactor your implementation.
- Decouple sections that can be executed in parallel.
