---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "asyncmux"
  text: "A utility for mutual exclusion using asynchronous processing"
  actions:
    - theme: brand
      text: What is asyncmux?
      link: /en/guide/what-is-asyncmux
    - theme: alt
      text: Quickstart
      link: /en/guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/tai-kun/asyncmux

features:
  - title: Write Locks
    details: Prevents concurrent execution of specific tasks, ensuring they run sequentially. Mutually exclusive with read locks.
  - title: Read Locks
    details: Allows multiple read operations to run in parallel. Mutually exclusive with write locks.
  - title: Abortable
    details: Supports AbortSignal to cancel pending tasks waiting for a lock.
---
