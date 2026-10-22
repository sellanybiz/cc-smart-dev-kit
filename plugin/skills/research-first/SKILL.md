---
name: research-first
description: Use before using or recommending any external library, API or pattern, before an architecture decision, an AI or LLM integration, browser or platform behaviour, a migration or upgrade - and before hand-writing a solved problem (validation, formatting, parsing, dates, money, crypto, sanitization) or a component, utility, workflow or integration from scratch. Finds what already exists and checks it against current sources. Trigger phrases - "should I use", "best way to", "how does X work", "is this still valid", "upgrade", "migrate", "best practice", "is X deprecated", "add validation", "build a component".
---

# Research Before You Build

**Project add-on:** `.claude/cc-smart-dev-kit/research-first.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). It names the project's research tools and
any library it prefers or bans.

The rule — research before you build, reuse in a fixed order, never give up — is in the core
instructions (§ Lead the work). This skill is how.

## 1. Look in the project first

For the project's own code, the repo is the only truth; a web search cannot tell you what it
does. Search it for an existing component, hook, utility, pattern or installed library that
already does the job: by name, by the words a caller would use, and in the dependency list
(`package.json` or its equivalent). Read the installed version's types and docs
(`node_modules/<pkg>/**/*.d.ts` and the like), not your memory of them.

## 2. Then the maintained solutions

No fit in the project? Find the maintained library or the standard approach for exactly this
job. Judge each candidate:

- **Maintained** — recent releases, open issues answered, not deprecated.
- **Fits** — the project's language version, framework version, runtime and bundle budget.
- **Small enough** — never a heavy dependency for a few lines; a small local function is
  right then.
- **Typed and documented**, with a license the project can use.

Adding a dependency is a decision: say which one, why, and what it replaced. Some projects
need the owner's yes for a new dependency — the add-on file or the project's rules say so.

## 3. The tools

Use the project's research tool of record when it names one (the add-on file). Otherwise:

- a web search tool for docs, APIs, current practice and changelogs;
- a fetch or extract tool for the full text of one known page;
- a deep-research tool when one search is not enough.

**A tool that is deferred** (listed by name only) must be loaded before the first call — with
`ToolSearch`, for example `select:<tool name>`. Called unloaded, it fails with an error that
reads like a wrong tool name. This bites subagents hardest: a fresh agent starts with nothing
loaded. If a search tool is down or out of quota, switch to another (the built-in
`WebSearch` / `WebFetch`) and **say which one you used**. Never skip the research because one
tool failed.

## 4. The protocol

1. Search as widely as the question needs.
2. Check the versions the project uses — APIs change between major versions.
3. Read the installed types, not memory.
4. Cross-check **at least two** authoritative sources. If they disagree, say so.
5. Nothing found? Change the query, search the library's own source or issues, read the
   types, or ask. Never fill the gap with a guess.
6. Write the findings where the next session finds them: for a plan, its Research section
   (`/cc-smart-dev-kit:plan-task` § 1 says where, and when it moves); else one plain line in
   your reply.

## Query hygiene

Training data leans toward older years. Check today's date before the first search. Pin
queries to versions, not years ("Next.js 16 server actions auth", not "best practices
2024"). Prefer words like `latest`, `current`, `deprecated`, `since vN`.

## When research is required

- every external library call, even a familiar one;
- architecture: data model, caching, auth, queues, state;
- a pattern the codebase has never used;
- hand-writing a solved problem (validation, formatting, parsing, dates and time zones,
  money, crypto, sanitization, translation) or a rich UI component;
- performance- or security-sensitive code; browser and platform behaviour;
- AI and LLM integrations — their SDKs change fast;
- a migration, upgrade or deprecation — read the full changelog and upgrade guide;
- any third-party behaviour you are recalling rather than reading.

Optional: a typo, a mechanical refactor inside a pattern you verified this session, an
internal helper with no outside API.

## From research to a recommendation

Compare two or three approaches you found, pick what fits this codebase best, and offer it as
the recommended option in `AskUserQuestion`, with the alternatives. Never recommend from
stale memory: if you did not research it this session, research it now.

**Banned:** "I know this API"; implementing from training-data recall; copying the
project's own wrapper around a library without checking the library's current API; research
after the implementation; one forum answer as proof; guessing at the project's own code when
reading the file would settle it.
