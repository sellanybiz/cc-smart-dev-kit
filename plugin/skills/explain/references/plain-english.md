# Plain English — The Detail

Read on demand, from the `explain` skill. Many readers are new to code, and many read English
as a second language. Every sentence should be easy to read the first time.

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

## Two things this does not mean

**It does not mean dumbing down.** Say "component" when you mean component, then explain it.
Swapping a precise word for a vague one makes the message worse. A developer who has to find
the column needs the column's name.

**It does not mean sounding sure when you are not.** Never drop a real uncertainty to make a
sentence cleaner. Say what you know, what you assumed, and what you did not check.
