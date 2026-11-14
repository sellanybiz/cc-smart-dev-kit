---
name: performance-budget
description: Use for every change to a React or Next.js web app (fetching, rendering, lists, forms, caching) - its React playbook, React Compiler on - and performance work - slow loading, re-renders, bundle size, N+1 queries, Core Web Vitals. Not for CLIs or scripts.
---

# Performance And UX Budget

**Project add-on:** `.claude/cc-smart-dev-kit/performance-budget.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). It names the project's data-fetching
library, cache, image component and any tighter targets.

Slow code is broken code. A janky screen is a broken screen.

## The React playbook — the standard for React and Next.js code

In a React or Next.js web app, `references/react-performance-playbook.md` (beside this file)
is the standard the code follows. Sections 1–8 are Vercel's React Best Practices, each rule
with a wrong and a right example; section 9 is this kit's own, on Next.js 16 caching, React 19
and React Compiler. Code that breaks one of its rules is a defect, in what you write and in what
you review, unless the project add-on says otherwise.

The file is long, so read it in two steps, never all at once:

1. **Before the first React change in a session:** its head — § Before You Apply Any Rule and
   the Table of Contents — and answer the checks table there (versions, compiler, data
   library, caching flag, bundler).
2. **Before each change:** only the rules whose Table of Contents headings match what the
   change does. Find each rule's line with a search for its heading (`### 5.4 `), read that
   rule alone, and do not read it again in the same session.

The table says where to look first:

| The change touches | Look in |
|---|---|
| Data fetching, server components, routes, API handlers, Server Actions | 1 (waterfalls), 3 (server), 4.3 (shared requests) |
| Imports, a new package, a heavy component | 2 (bundle size) |
| Components, hooks, state, effects | 5 (re-renders), 6 (rendering), 8 (advanced), 9.9–9.10 (Compiler, React 19.2) |
| Event listeners, scrolling, `localStorage` | 4.1, 4.2, 4.4 |
| Loops, sorting, data shaping, regular expressions | 7 (JavaScript) |
| Next.js caching, `use cache`, prefetching | 9 |

A slow page, a bundle audit or an N+1 hunt reads every CRITICAL and HIGH section in full.
Check any version-specific claim against the project's installed versions first.

## React Compiler — on in every React web app

React Compiler memoizes components and hooks at build time, so hand-written `useMemo`,
`useCallback` and `memo` are mostly no longer needed (playbook §9.9).

- **Check it first:** `reactCompiler` in `next.config.*`, or the compiler's Babel plugin in the
  bundler's config.
- **A new app** turns it on in its first setup.
- **An existing app with it off:** turning it on is its own change, never a side step inside
  another task. Say so in one line and offer to do it now or file it as a follow-up project
  task (the core instructions' one-plan rule).
- **The setup** comes from the official pages for the project's build tool and React version:
  [react.dev/learn/react-compiler/installation](https://react.dev/learn/react-compiler/installation),
  and for Next.js its
  [`reactCompiler` page](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler).
  They change between versions, so read them, never from memory.
- **The kit's order around it:**
  1. Add the compiler's lint rules through the project's linter: with ESLint, the
     `recommended-latest` preset of `eslint-plugin-react-hooks`. A linter without them: say so,
     and rely on the compiler's own report instead. The compiler silently skips a component
     that breaks the Rules of React, and the lint shows which.
  2. Fix what the lint finds in a small app. In a large one, roll out in parts, as
     [react.dev/learn/react-compiler/incremental-adoption](https://react.dev/learn/react-compiler/incremental-adoption)
     shows (by folder, or `compilationMode: 'annotation'` with `"use memo"`), and file the
     rest as a follow-up project task.
  3. Turn it on, run the full tests and the build, and check the main screens
     (`/cc-smart-dev-kit:ui-verify`).
- **Keep the memoization already there.** The React docs warn that removing it can change the
  compiled output; remove one only with a test that shows nothing changed.
- **With it on, new code relies on the compiler.** Write `useMemo` or `useCallback` only where
  you need precise control, for example a value used as an effect dependency (§9.9).
- **Off only by the project's choice,** written in the project add-on with its reason. Then
  the playbook's memoization rules apply in full.

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
