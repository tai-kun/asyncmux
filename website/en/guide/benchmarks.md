# Benchmarks {#benchmarks}

This page presents the performance characteristics of `asyncmux`, measured with `benchmarks/asyncmux.bench.ts`.
The numbers below are reference values from a specific environment and will vary across environments.

## Methodology {#methodology}

Measurements use the Vitest benchmarking feature.
Each case runs repeatedly for about 0.5 seconds, and `ops/sec` is the number of executions per second.

```sh
npx vitest bench --config ./.config/vitest.bench.ts
```

The measurement environment was as follows:

- CPU: 12th Gen Intel Core i9-12900K
- Memory: 32 GiB
- Node.js: v24.15.0
- Date: 2026-09-08

## Results {#results}

### A. Uncontended lock acquisition {#uncontended}

Speed of `lock` / `rLock` acquisition and release with an empty queue.

| Case                         |   ops/sec |      Mean |       p99 |
| ---------------------------- | --------: | --------: | --------: |
| `lock` / `release` (no key)  | 1,196,752 | 0.0008 ms | 0.0012 ms |
| `lock` / `release` (key)     |   972,952 | 0.0010 ms | 0.0020 ms |
| `rLock` / `release` (no key) | 1,181,629 | 0.0008 ms | 0.0011 ms |
| `rLock` / `release` (key)    |   834,585 | 0.0012 ms | 0.0015 ms |

### B. Low contention {#low-contention}

Two workers repeatedly acquiring and releasing a lock on the same key.

| Case                          | ops/sec |      Mean |       p99 |
| ----------------------------- | ------: | --------: | --------: |
| 2 workers x 4 ops (same key)  |  77,059 | 0.0130 ms | 0.0144 ms |
| 2 workers x 16 ops (same key) |  24,165 | 0.0414 ms | 0.0397 ms |

### C. High contention {#high-contention}

Many requests hitting the same lock at once.

| Case                               | ops/sec |      Mean |       p99 |
| ---------------------------------- | ------: | --------: | --------: |
| 32 concurrent requests (no key)    |  22,103 | 0.0452 ms | 0.0425 ms |
| 128 concurrent requests (same key) |   2,011 | 0.4972 ms | 0.5530 ms |

### D. Repeated lock/unlock {#repeated-lock-unlock}

A single worker acquiring and releasing a lock in a tight loop.

| Case            | ops/sec |      Mean |       p99 |
| --------------- | ------: | --------: | --------: |
| Sequential x 16 |  59,214 | 0.0169 ms | 0.0172 ms |
| Sequential x 64 |  16,500 | 0.0606 ms | 0.0582 ms |

### E. Queued operations {#queued-operations}

Releasing a held lock to drain a queue of accumulated read/write requests at once.

| Case                          | ops/sec |      Mean |       p99 |
| ----------------------------- | ------: | --------: | --------: |
| Drain 50 queued R/W requests  |  13,877 | 0.0721 ms | 0.0648 ms |
| Drain 200 queued R/W requests |   3,044 | 0.3285 ms | 7.4403 ms |

### F. Error path {#error-path}

Exceptional paths such as double release or acquisition with an already-aborted signal.

| Case                                        | ops/sec |      Mean |       p99 |
| ------------------------------------------- | ------: | --------: | --------: |
| Double release (throws `LockReleasedError`) | 222,488 | 0.0045 ms | 0.0065 ms |
| Immediately aborted signal (rejects)        | 159,919 | 0.0063 ms | 0.0068 ms |

### G. Cancellation {#cancellation}

Cancelling a queued acquisition via `AbortSignal`.

| Case                         | ops/sec |      Mean |       p99 |
| ---------------------------- | ------: | --------: | --------: |
| Abort while waiting in queue | 106,592 | 0.0094 ms | 0.0087 ms |

### H. Realistic workload {#realistic-workload}

Cache-like load mixing 12 reads, 3 writes, and 1 global write.

| Case                                   | ops/sec |      Mean |       p99 |
| -------------------------------------- | ------: | --------: | --------: |
| Mixed R/W access (12R + 3W + global W) |  43,378 | 0.0231 ms | 0.0230 ms |

## How to read the results {#how-to-read}

Uncontended lock acquisition exceeds 1 million ops/sec, so the overhead of exclusive control attached to ordinary asynchronous work is negligible.
There is no large speed gap between read and write locks, and specifying a key makes little difference.
Even under high contention with 128 simultaneous requests, each request completes in about 0.5 ms, and a realistic mixed read/write load exceeds 40,000 ops/sec.
