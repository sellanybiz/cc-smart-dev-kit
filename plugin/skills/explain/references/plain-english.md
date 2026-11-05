# Plain English — The Detail

Read on demand, from the `explain` skill. Many readers are new to code, and many read English
as a second language. Every sentence should be easy to read the first time. The core
instructions' § Ending a turn holds the short rule; this file holds the detail and the examples.

## Where it applies

Chat replies, `AskUserQuestion` text, plans shown to the person, commit messages, pull
request bodies, and error messages a person reads. Not code names, and not technical names
with no plain equivalent ("React", "TypeScript").

## The habits

1. **Short words.** "use", not "utilize"; "help", not "facilitate"; "start", not "commence".
2. **Short sentences.** Under 20 words where you can. One idea each.
3. **Active voice.** "The button shows an error", not "An error is shown by the button".
4. **Concrete.** "This runs every time you click", not "This is invoked on each interaction".
5. **Explain a technical word the first time.** "SSR (the server builds the page first)",
   then just "SSR".
6. **No idioms.** "This is the exact problem", not "this hits the nail on the head".
7. **No Latin or fancy phrases** — no "per se", "vis-à-vis", "ergo".
8. **Bullets** for three or more things.

| Avoid | Use |
|---|---|
| utilize, leverage | use |
| facilitate | help, let |
| commence, initiate | start |
| terminate, cease | end, stop |
| ascertain | check |
| endeavor | try |
| subsequently | next |
| aforementioned | above, that |
| instantiate | create |
| in lieu of | instead of |
| in order to | to |
| due to the fact that | because |

## Say it in the product's words

When you ask a question or offer a choice, use the words the person sees in the product
(the add-on file may list them), and say why a choice matters in terms they feel, not in
system terms.

| Do not say | Say |
|---|---|
| "open the public route (no login)" | "open the page visitors see" |
| "the worker died mid-run" | "the background check stopped early" |
| "a privacy leak in the public payload" | "visitors could see the owner's real name" |

Words worth translating in a question, because a reader new to code will stop at them:
`slug`, `UUID`, `endpoint`, `payload`, `schema`, `migration`, `queue`, `worker`, `cron`,
`cache`, `hydrate`, `SSR`, `bundle`, `auth`, `mutation`, `enum`, `foreign key`.

## Questions and options that stand alone

The person often sees only the question box: not your reasoning, not the files, not the last
twenty messages. So a question and each of its options must carry enough to choose with no
scrolling back.

- **The question** says what is being decided and why it matters now, in one or two short
  sentences.
- **The label** is short (one to five words) and names the choice, not a code term.
- **Each option's description** says what happens if it is picked, the main benefit, the
  downside or cost (time, money, risk, what the person must do), and for the recommended one,
  why it fits this case.
- **Short sentences, full meaning.** Cut words, never the facts the choice turns on. A short
  option that leaves out its cost is worse than a longer one that says it.
- **The same goes for a summary.** What changed, what was checked, what was not, and what the
  person must do next, each in its own line.

## Before and after

**A decision question with options.**

Before:

> **Cache strategy?**
> - SWR (Recommended) — stale-while-revalidate
> - TTL — fixed expiry
> - None

After:

> **The product list takes about 3 seconds to load, because it asks the database on every
> visit. How should it keep a copy so it loads faster?**
> - **Show the copy, refresh behind it (Recommended)** — The page shows the last saved list
>   at once and fetches a fresh one in the background. Fastest for visitors. Downside: a price
>   change can take up to a minute to appear. It fits here because prices change only a few
>   times a day.
> - **Keep each copy 10 minutes** — The list is saved for 10 minutes, then fetched again.
>   Simple. Downside: a change can take 10 minutes to show, and the first visitor after each
>   refresh still waits 3 seconds.
> - **No copy** — Every visit asks the database. Always current. Downside: it stays at 3
>   seconds.

**A status summary.**

Before:

> Done. Refactored the hydration path, fixed the race in the SSR boundary, bumped deps, CI
> should be green. Let me know.

After:

> **Done:** the sign-in page no longer shows the wrong name for a moment. The cause: the page
> was drawn before the saved login was read (`src/auth/session.ts:42`); it now waits for it.
> **Checked:** the sign-in tests and the type check pass.
> **Not checked:** a phone browser. Please open the sign-in page on your phone and check that
> the right name shows on the first load.
> **Left out:** the library upgrade I mentioned. It is a separate change.

**A plain question with no real options.**

Before:

> Need the env var — what's the value?

After:

> The payment test needs a test key to run. Where do you keep the payment service's test key —
> in a `.env` file, or in a secret store? I only need to know where to read it from, not the
> key itself.

## Two things this does not mean

**It does not mean dumbing down.** Say "component" when you mean component, then explain it.
Swapping a precise word for a vague one makes the message worse. A developer who has to find
the column needs the column's name.

**It does not mean sounding sure when you are not.** Never drop a real uncertainty to make a
sentence cleaner. Say what you know, what you assumed, and what you did not check.
