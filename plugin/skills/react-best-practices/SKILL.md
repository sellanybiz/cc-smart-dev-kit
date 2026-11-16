---
name: react-best-practices
description: Use for every change to a React or Next.js web app - components, hooks, state, data fetching, forms, styling with the design system, and React Compiler. Reads the React playbook and checks standard components before custom code. Not for CLIs or scripts.
---

# React Best Practices

**Project add-on:** `.claude/cc-smart-dev-kit/react-best-practices.md` — read it first when it exists.
If absent, read `.claude/cc-smart-dev-kit/performance-budget.md` when it exists: older projects
keep their React Compiler opt-out and data library there. The add-on wins (`core.md`, top).

## Design system first

Before writing a component, control, widget, hook or helper, look in this order:

1. **The project:** reuse its own components and hooks.
2. **Its design system:** use the standard component before making one. With `components.json`,
   the project uses shadcn/ui. Read the vendored `/cc-smart-dev-kit:shadcn` guide: `../shadcn/SKILL.md`
   and its reference files, beside this skill in the plugin. A project's own shadcn skill
   takes precedence. Use the shadcn MCP tools to search, view items, read examples and get
   the add command. Run that command in your own worktree, with the project's package runner,
   but replace its `shadcn@latest` with the version the vendored guide pins: never `@latest`.
3. **A maintained library:** find one that fits the gap (`/cc-smart-dev-kit:research-first`).
4. **Custom code:** explain why the earlier options do not fit with a `Why custom:` line
   in the report or pull request.

### Enforce it with the project's linter

Restrict raw tags where the design system has replacements. In **Biome 2.0 or later**, use
`linter.rules.correctness.noRestrictedElements`, set `level: "error"`, and map each tag to
its replacement in `options.elements`. For example, adapt these names and the UI folder:

```json
{
  "linter": {
    "rules": {
      "correctness": {
        "noRestrictedElements": {
          "level": "error",
          "options": {
            "elements": {
              "select": "Use Select.",
              "table": "Use Table.",
              "textarea": "Use Textarea.",
              "dialog": "Use Dialog."
            }
          }
        }
      }
    }
  },
  "overrides": [{
    "includes": ["src/components/ui/**"],
    "linter": { "rules": { "correctness": { "noRestrictedElements": "off" } } }
  }]
}
```

The override permits raw primitives inside the design system without dropping its other
lint checks. Biome restricts tags only, not attribute values. For radio inputs, use ESLint's
`no-restricted-syntax` with a `{selector, message}` entry, for example:
`JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='radio']`.
Name the project's RadioGroup in the message. In ESLint flat config, limit the restriction
object with `files` and its own `ignores` for the UI folder; do not ignore that folder globally.
Alternatively, `eslint-plugin-react` offers `react/forbid-elements`; its released peer range
does not declare ESLint 10 support. Check compatibility before adding it.

**Person-run workflows:** `/cc-smart-dev-kit:migrate-radix-to-base` and the five
`/cc-smart-dev-kit:shadcncraft-*` skills cover migration, Figma and tokens; some need a paid
shadcncraft licence or the Figma MCP. Never start them yourself. The person runs the
import-app → import-block → import-component chain one step at a time.

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

