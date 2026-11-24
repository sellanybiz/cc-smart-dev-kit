---
name: performance-budget
description: Use for performance work - slow loading, re-renders, bundle size, N+1 queries, Core Web Vitals, backend capacity and scale. Sets performance and UX budgets; React code also follows react-best-practices. Not for routine CLI or script changes.
---

# Performance And UX Budget

**Project add-on:** `.claude/cc-smart-dev-kit/performance-budget.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). It names the project's data-fetching
library, cache, image component and any tighter targets.

Slow code is broken code. A janky screen is a broken screen.

For React and Next.js code, use `/cc-smart-dev-kit:react-best-practices` for the playbook,
React Compiler and design-system choices.

## Targets

- **LCP** under 2.5 s, **CLS** under 0.1, **INP** under 200 ms, **TTFB** under 600 ms (the
  Core Web Vitals and server response time).
- **API:** reads under 200 ms, writes under 500 ms.
- **Database:** indexed reads under 50 ms, joins under 200 ms.
- **Bundle:** each route under 200 KB gzipped.

Over a target is a bug: fix it before it ships, or get the person's yes to ship it knowingly.

## Before the change, ask

1. **Cached?** On the server, and on the client (the data library's cache, with a stale time
   that fits the data).
2. **Indexed?** Every column a frequent read filters, sorts or joins on; a column rewritten on
   every event that only a rare read uses stays unindexed (`../review/references/axes.md`,
   Performance).
3. **N+1?** One query per item in a loop → a join or one batched query.
4. **Re-renders?** New objects or arrays created inline as props; selectors that return a
   new object each time.
5. **Blocking the main thread?** Move heavy synchronous work to a worker or the server,
   debounce it, or split it into chunks.
6. **Bundle weight?** Check a package's size before you add it; load heavy components
   dynamically and only when shown; import only what you use.
7. **Instant feedback?** Optimistic updates for writes, a skeleton for reads. Never a blank
   page.
8. **Payload size?** Paginate; select only the fields the screen shows.

## Backend and scale

Only when the change adds shared capacity (the scale class in `../review/references/axes.md`,
Performance, from this skill's folder). A change with none skips this in one line. Price it at
10x and 100x today's users and events, and put the answer in the plan (`/cc-smart-dev-kit:plan-task`
§ 3, **Capacity**) or, for a change with no plan, on its task. The review names them from that
scale class.

- **Connection budget:** connections per process × processes, against the database's limit; every
  per-event read counts.
- **Queue caps:** each queue and pool has a stated size, a place to wait and a share per tenant.
- **Fan-out:** one event that makes every client read again costs clients × events. Push the
  change, or batch it.
- **Herds after a restart:** every client reconnects and re-reads at once. Add backoff with
  jitter, and a cap on the first load. The cause is known (the restart), so this backoff is not
  core's banned retry-until-success loop.
- **Growth and retention:** a table that only grows has an owner, a retention period and a way to
  archive or delete. Price its biggest query at 100x the rows.
- **Scale tests seed many small tenants,** not one big one: that shows unfair sharing and an
  index that ignores the tenant.
- **Locks:** hold a lock only across writes, never across a read or a network call, and give it
  a timeout.
- **A capacity page** in the project's docs lists each cap, pool and queue: its limit, what sets
  it and the scale where it bites. Generate it from the config or code that sets each limit where
  the project can; a hand-written page changes in the same change as the limit. A project with no
  page says so in one line; creating it is its own change.

## UX non-negotiables

- **Never blank:** a loading state, skeleton or spinner — always something.
- **Never a silent failure:** a visible error, a clear message, a way to recover.
- **Empty states** are designed, with a next step.
- **Optimistic UI** for the person's own actions: the screen updates, the sync follows.
- **Touch targets** at least 44×44 px on a phone.
- **Smooth animation:** animate `transform` and `opacity`, never `width`, `height`, `top` or
  `left`.
- **Mobile first**, checked at real phone, tablet and desktop sizes — measured, not eyeballed.
- **Accessible:** keyboard use, screen-reader labels, WCAG AA contrast, visible focus.
- **Dark mode parity:** theme tokens, never hard-coded colours.
- **Forms:** submit disabled while pending, focus on the first invalid field, input kept on
  an error.

## Banned

- A query with no limit; a new filter column of a frequent read with no index; a query inside a loop.
- The same expensive request on every mount, with no cache.
- Heavy synchronous work on the main thread (parsing huge JSON, a giant regex).
- A plain `<img>` where the framework has an optimized image component.
- An effect that only computes derived state — compute it during render.
- A missing loading state; a refetch on every focus without a reason.
- Loading a whole data set to count it — ask the database for the count.
- Returning 100 fields when the screen shows five.
- A write that forgets to invalidate the cache it changed.

## Four commandments

1. **Cache what is read often and changes rarely.** A long list → virtualize it, or cap the rows drawn.
2. **Measure, do not guess:** the browser's `performance` APIs and network log (through the
   Playwright MCP server), the React profiler for re-renders.
3. **The critical path first:** the largest element, what is above the fold, the main
   action.
4. **Perceived speed counts:** a skeleton feels faster than a blank page.
