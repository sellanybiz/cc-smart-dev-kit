---
name: performance-budget
description: Use for frontend code (React, Next.js, fetching, rendering, lists, forms, caching, animations) and performance work such as slow loading, skeletons, re-renders, bundle size, N+1 queries or Core Web Vitals. Not for CLI tools, scripts or config.
---

# Performance And UX Budget

**Project add-on:** `.claude/cc-smart-dev-kit/performance-budget.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). It names the project's data-fetching
library, cache, image component and any tighter targets.

Slow code is broken code. A janky screen is a broken screen.

## The deep reference — read on purpose

`references/react-performance-playbook.md` (beside this file) holds more than 40 React and
Next.js rules with wrong-versus-right examples: waterfalls, bundle size, server work,
re-renders, rendering, plain JavaScript speed, and the newer caching model. Open it for real
performance work — a slow page, a bundle audit, an N+1 hunt — not on every edit. The file is
long: read its head first (the notes before any rule, and the Table of Contents), then only
the sections the work needs. Check any version-specific claim in it against the project's
installed versions first.

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
2. **Indexed?** Every column in a `WHERE`, `ORDER BY` or join.
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

- A query with no limit; a new filter column with no index; a query inside a loop.
- The same expensive request on every mount, with no cache.
- Heavy synchronous work on the main thread (parsing huge JSON, a giant regex).
- A plain `<img>` where the framework has an optimized image component.
- An effect that only computes derived state — compute it during render.
- A missing loading state; a refetch on every focus without a reason.
- Loading a whole data set to count it — ask the database for the count.
- Returning 100 fields when the screen shows five.
- A write that forgets to invalidate the cache it changed.

## Four commandments

1. **Cache what is read often and changes rarely.** A long list → virtualize it.
2. **Measure, do not guess:** the browser's `performance` APIs and network log (through the
   Playwright MCP server), the React profiler for re-renders.
3. **The critical path first:** the largest element, what is above the fold, the main
   action.
4. **Perceived speed counts:** a skeleton feels faster than a blank page.
