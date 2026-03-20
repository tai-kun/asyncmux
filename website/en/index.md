---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "asyncmux"
  text: "A utility for mutual exclusion using asynchronous processing"
  actions:
    - theme: brand
      text: What is asyncmux?
      link: /guide/what-is-asyncmux
    - theme: alt
      text: Quickstart
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/tai-kun/asyncmux

features:
  - title: Write Locks
    details: Prevents concurrent execution of specific tasks, ensuring they run sequentially. Mutually exclusive with read locks.
  - title: Read Locks
    details: Allows multiple read operations to run in parallel. Mutually exclusive with write locks.
  - title: No Lock Escalation
    details: Prevents deadlocks by throwing a LockEscalationError if a write lock is requested while holding a read lock.
  - title: Reentrant
    details: Safely request the same lock from within an already locked context without causing a deadlock.
  - title: Abortable
    details: Supports AbortSignal to cancel pending tasks waiting for a lock.
---
