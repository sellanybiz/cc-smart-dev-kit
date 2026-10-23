# MS1 — the memory slot, and the router's OpenAI path for it (1.2.0, D63)

## Goal, and why

claude-mem, the memory plugin, sends its summaries straight to OmniRoute. In one day that was
about 53,000 calls, 1.28 billion input tokens and 36 million output tokens, so it bypasses every
chain the person sets on the gateway. The owner decided (D63, in the plan
`.claude/plans/2026-10-21-master-plan.md`) that claude-mem goes through the gateway, on a slot of
its own. claude-mem keeps its `openai-compatible` provider, so the router must answer that
provider's request on the memory slot. This phase builds the slot and the path. MS2 points
claude-mem at it, and MS3 is the portal card.

## What claude-mem sends (claude-mem 13.40.0, read from its installed `scripts/worker-service.cjs`)

- `POST <base>/chat/completions`, where `<base>` will be `http://127.0.0.1:<router port>/v1`.
- Headers: `Content-Type: application/json`, `x-client-request-id`, and `Authorization: Bearer
  <key>` only when a key is set. MS2 sets none.
- Body: `{model, messages, temperature: 0.3, stream: true, stream_options: {include_usage: true}}`.
  Read the installed file and confirm each field; never trust this list.
- It reads a 429 as a rate limit and honours `retry-after`.

## What to build

1. **The slot.** A built-in slot `cc-smart-dev-kit-memory`; the CLI calls it `memory`.
   - Take every name from the one place that lists the slots (`src/gateway/targets.ts`,
     `src/build-info/names.ts` if the router needs it), never typed again.
   - It takes **backend targets only**: a `claude-…` target is refused when the chain is set. Copy
     how the judge refuses one, and make that rule one home for both slots.
   - Fallback on and breaker on by default.
   - `gateway slot memory <targets>`, `gateway fallback memory`, `gateway breaker memory`,
     `gateway status`, `gateway models` and the health answer all show it. It has no Claude mode
     to fall back to: with no chain it is off, and a request for it is refused (below).
   - It runs no judge test: that is only for the judge's and the worker's targets.
2. **The path.** `POST /v1/chat/completions` in `src/gateway/router.ts`, **before** the branch that
   sends every other path to Anthropic. Today that branch would carry the client's bearer key to
   Anthropic (`router.ts`, the header comment and around line 2791).
   - **The local door**, as `/v1/messages` has: our `Host`, no `Origin`, a JSON body.
   - **The model is the memory slot** (its key, or its CLI name; take the router's slot-name
     rules): walk its chain.
   - **Any other model, a slot with no chain, or a body that is not JSON:** an OpenAI-shaped
     error (`{"error":{"message","type","code"}}`), 400 or 404 as fits. Never Anthropic, never
     another slot.
   - **For each target**, `POST <backend.baseUrl>/v1/chat/completions` with:
     - the body exactly as sent, with only `model` set to the target's model. One named,
       tested function does that swap, and a test proves every other byte stays;
     - the allow-listed headers, and the backend's own key;
     - `directIfLoopback`. Never the client's `authorization`.
   - **The first event:** a streamed answer waits for its first event under `timeouts.firstByteMs`,
     as the backend path of `/v1/messages` does. A failure before it (a status `fallbackKind`
     names, no first event in time, an error object as the first event) moves to the next target
     while fallback is on. Read how `/v1/messages` does each of these, and reuse its helpers;
     never write a second copy.
   - **Resting and the breaker:** a target that fails rests exactly as it does today
     (`noteCooldown`; the same state, shared with the target's use in other slots). The breaker
     holds as it does today. Its answer here is an OpenAI-shaped 429 with
     `retry-after` ≤ 60 (`capRetryAfter`). Never Anthropic's rate-limit headers.
   - **A used-up chain** relays its last answer, or a 502 in OpenAI shape.
   - **The log line and the health `recent`** have the same shape as today's.
3. **The history row.** One row per request, as `/v1/messages` writes one: slot `memory`, the
   target, status, ms, the next target on a fallback.
   - **Tokens:** read the usage from the stream's last `usage` chunk (or a JSON body's `usage`).
     `prompt_tokens` includes the cached tokens, so the input is `prompt_tokens − cached`, and the
     cache read is `prompt_tokens_details.cached_tokens`. The output is `completion_tokens`.
   - **Where it lives:** put this reader in a **new** module of its own, for example
     `src/gateway/openai-usage.ts`. Never edit `src/gateway/safety-checks.ts`: a 1.1.3 phase (PC1)
     changes its Anthropic reader, and the two meet at the next merge. The cost comes from
     `backendPrice`, as for any backend row.
4. **Docs, in this phase:**
   - `docs/gateway.md`: a section "The memory slot", and the path in the per-request list.
   - `.claude/rules/gateway.md`: the slot list (five becomes six); the memory slot is backend-only
     and served on the OpenAI path; that path never reaches Anthropic; and the one translation,
     the `model` swap, with its test named.
   - `docs/claude-code-contract.md`, or the companion section where claude-mem's behaviour is
     recorded: a row for claude-mem's `openai-compatible` request shape, the version it was read
     on, and how.
   - `README.md` § The AI gateway: the memory slot, one paragraph.
   - `CHANGELOG.md`: a `## 1.2.0` bullet.

## Files (change nothing else)

`src/gateway/targets.ts`, `src/gateway/config.ts`, `src/gateway/router.ts`, a new
`src/gateway/openai-usage.ts` (or the name you pick), `src/gateway/commands.ts` (only for the slot's
CLI name and help), `src/build-info/names.ts` only if the router needs the new name there, their tests,
`src/portal/facts.ts` (only if the Slots page's list does not pick the slot up by itself), the docs
named above, and `plugin/dist/*.js`. **`plugin/dist/router.js` changes; that is expected.** No other
bundle may change for a reason outside this phase: check `git diff --stat plugin/dist`.

## Never

- Change a prompt's words. Only `model` changes, through the one named function.
- Send anything on this path to Anthropic, or forward the client's `authorization`.
- Add a target to a chain, or pick a model: the person sets the memory chain.
- Reach the live router's port 20100 or OmniRoute in a test. Use a fake backend on a free port,
  through the port guard (`.claude/rules/testing.md`).

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`.

## Done-check

1. Tests, each seen failing first:
   - a memory request walks the chain, with fallback on a 429, a 5xx and a first-event timeout;
   - a resting target is skipped;
   - the breaker's 429 is in OpenAI shape;
   - a used-up chain gets a 502;
   - another model, or the memory slot with no chain, is refused and never reaches the
     Anthropic fake;
   - the client's `authorization` is never forwarded;
   - the body is byte-identical apart from `model`;
   - the history row's tokens come from a real OpenAI usage chunk, both streamed and non-streamed;
   - `gateway slot memory claude-…` is refused;
   - the health answer, `status` and `models` show the slot.
2. `bun run build`, then `bun run check`. Under load, a test with a time limit may fail only
   because of the load: run that file alone, and say so in your report.
3. Your review (`cc-smart-dev-kit:reviewer`, opus, `xhigh`: the router is a risky change set).
4. Your report. Say that `router.js` changed and why.
