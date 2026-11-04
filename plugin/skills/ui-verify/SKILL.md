---
name: ui-verify
description: Use for a UI check - `/cc-smart-dev-kit:ui-verify <route>`, a plan's UI step, or a visible frontend change. The ui-verifier agent drives the running app through the Playwright matrix; you judge the design from its key screenshots.
argument-hint: "[route]"
---

# UI Verify ($ARGUMENTS)

**Project add-on:** `.claude/cc-smart-dev-kit/ui-verify.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It says how to find this session's dev server
address, how to start the server, and which flows need a login.

A UI check is two steps, and the session that wants the check owns both:

1. **Launch** the `cc-smart-dev-kit:ui-verifier` agent to drive the browser. That is many tool calls
   and large page snapshots — work for the affordable worker slot.
2. **Judge the design yourself** from the key screenshots it saved — on `opus` or `fable`, the
   only models design judgment runs on (§ 3).

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
core instructions say for that slot — the measured facts may run on an affordable model, the design
verdict may not). **One at a time:** the session's Playwright MCP server
drives one browser, and a second agent fights the first for its pages. Another session has
its own MCP server and its own tab group, so a check there does not clash with this one (with
`cc-smart-dev-kit setup` run, every session drives the person's own Chrome through the Playwright
extension, in a profile of its own, and sees only the tabs of its own group).

A browser tool that will not connect usually means the extension's token is not saved yet:
`cc-smart-dev-kit browser setup` prints the steps, and `cc-smart-dev-kit browser token` saves it
(the plugin never runs without it, so nothing waits for an approval click).

**The brief carries:**

- the routes to check and the dev server's address;
- the risks to drive **first** — one line each, from the change or the plan's UI step;
- whether it may drive logged-in or data-changing flows — pass "OK to drive authenticated or
  mutating flows — the session is live" only when that is true; without it, public pages
  only;
- the states your verdict turns on: 2–6 named key screenshots;
- "facts and measured values only, no design verdict", and that a case it could not
  reproduce is a result it reports.

## 3. Judge the design — on Opus or Fable

Open the key screenshots, read the measured values, and answer the design question yourself:
aligned, consistent with the product's look, nothing clipped, dark and light, every
breakpoint? That judgment is design work, so it runs only on `opus` or `fable`, at `high` or above
(the core instructions' model table); an affordable model sees layout, colour and clipping but
miscounts fine detail, so it measures and you judge. If this session runs on an affordable model,
hand the verdict to a read-only agent on `opus` (`Plan`, with the screenshots' paths) and take its
answer as the verdict.

## 4. Close out

- Close the browser (`browser_close`) when the check is done: the agent leaves it open on
  purpose. With cc-smart-dev-kit's own `playwright` server that ends this session's connection —
  the person's Chrome and its tabs stay, and so do the tabs of the closed connection (the tab
  group outlives it: the extension's own behaviour). With a stock Playwright MCP of your own it
  closes the page that server drives.
- **A page needs a login:** the agent reports it and never signs in. Open the page yourself
  and ask the person to sign in there, once — in that `claude-code` profile the sign-in stays
  for every session. Never sign out or switch accounts without asking: that profile is
  everyone's.
- An affordable run that fails twice: `/cc-smart-dev-kit:subagent-decision` § Briefing an affordable model.
