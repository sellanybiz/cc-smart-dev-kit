---
name: ui-verify
description: Use for a UI check - `/cc-smart-dev-kit:ui-verify <route>`, a plan's UI step, or a visible frontend change. Launches the cc-smart-dev-kit ui-verifier agent to drive the running app through the Playwright matrix (breakpoints, colour schemes, edge cases), then you judge the design yourself from the key screenshots it saved.
argument-hint: "[route]"
---

# UI Verify ($ARGUMENTS)

**Project add-on:** `.claude/cc-smart-dev-kit/ui-verify.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It says how to find this session's dev server
address, how to start the server, and which flows need a login.

A UI check is two steps, and the session that wants the check owns both:

1. **Launch** the `cc-smart-dev-kit:ui-verifier` agent to drive the browser. That is many tool calls
   and large page snapshots — work for the affordable worker slot.
2. **Judge the design yourself** from the key screenshots it saved. The verdict stays with
   the main model.

The agent's own file holds its matrix, its safe-versus-mutating gate and its report format.
This skill is what **you** do around it. A plan's owner (a subagent) does not launch a check
of its own: it hands the route back to the main session.

## 1. Find this session's dev server

Use the address **this** session's server printed, or the way the add-on file gives. Never
assume a default port: with several worktrees, that port may be another branch's server. No
server running → start this session's, in the background, with a ready-wait that also ends
on failure, and use the address it prints. A change to server code needs a restart before the
check (`/cc-smart-dev-kit:verify-change` § 5).

## 2. Launch the agent — one at a time

`Agent` with the `cc-smart-dev-kit:ui-verifier` type, on `sonnet` (the worker slot; effort as the
core instructions say for that slot). **One at a time:** the session's Playwright MCP server
drives one browser, and a second agent fights the first for its pages. (A project whose add-on
says its browser is shared by every session on the machine: one at a time across them too.)

**The brief carries:**

- the routes to check and the dev server's address;
- the risks to drive **first** — one line each, from the change or the plan's UI step;
- whether it may drive logged-in or data-changing flows — pass "OK to drive authenticated or
  mutating flows — the session is live" only when that is true; without it, public pages
  only;
- the states your verdict turns on: 2–6 named key screenshots;
- "facts and measured values only, no design verdict", and that a case it could not
  reproduce is a result it reports.

## 3. Judge the design — your step

Open the key screenshots, read the measured values, and answer the design question yourself:
aligned, consistent with the product's look, nothing clipped, dark and light, every
breakpoint? That judgment is what the check exists for. An affordable model sees layout, colour and
clipping well but miscounts fine detail, so it measures and you judge.

## 4. Close out

- Close the browser (`browser_close`) when the check is done: the agent leaves it open on
  purpose. With stock Playwright MCP it closes this session's page. A project whose
  add-on says its browser is shared by every session may set it up so that `browser_close`
  closes only your windows: the add-on says which.
- **A page needs a login:** the agent reports it and never signs in. Open the page yourself
  and ask the person to sign in there, once. Never sign out or switch accounts without
  asking — in a browser the project shares between sessions, that login is everyone's.
- An affordable run that fails twice: `/cc-smart-dev-kit:subagent-decision` § Briefing an affordable model.
