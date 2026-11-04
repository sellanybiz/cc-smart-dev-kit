---
name: explain
description: Use when someone wants to UNDERSTAND something, not change code - a piece of code, a word or idea ("what is a webhook"), or how a part of the system works. Teach it in plain words, with a real-life analogy, in layers, with a picture. Also covers how to word a question, its options or a status summary in plain English. Trigger phrases - "explain", "what is", "what does this do", "how does X work", "why does this work", "I don't get it", "ELI5", "teach me", "walk me through".
---

# Explain It Simply

**Project add-on:** `.claude/cc-smart-dev-kit/explain.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It gives the project's own words for its parts,
and who the readers usually are.

**Only wording a question, its options or a summary?** Then only `references/plain-english.md`
applies; the teaching steps below do not.

The person wants to **learn**, not to get code. Slow down and teach. The reader may be new to
code, or read English as a second language. Make the hard thing feel easy, and never make
them feel slow. If you cannot explain it simply, you do not understand it yet: read the real
code first, then simplify.

## The method

1. **Verify first.** Read the real code, type or table before you teach it. A confident wrong
   explanation is worse than none: they will build on it.
2. **One core idea.** The single most important thing, in one short sentence.
3. **A real-life analogy** — a waiter, a filing cabinet, a ticket line — then say where it
   **breaks**, so they do not over-trust it.
4. **Layers, never a dump.** *Like you're new:* plain words, no code terms. *A bit deeper:*
   the real names and a little "how". *The real detail:* the code and edge cases, only if
   they want it. Let them stop at any layer.
5. **A picture when there are steps.** In chat, an arrow line:
   `click Save → the server checks it → it is stored → others see it`. In a doc, a small
   Mermaid diagram.
6. **Anchor it in this project, then check it landed.** Walk the real path with real files
   (`file:line`), end with a one-line recap and an open door: "Want me to go deeper on any
   part?"

A safe default shape:

> **In one line:** the core idea
> **Like you're new:** the analogy, plain words
> **A bit deeper:** real names, a little how
> **In this project:** the real flow, with `file:line`
> **Picture:** an arrow flow, if there are steps
> **Recap:** one line — want more on any part?

## Analogies that work

| Thing | Everyday picture |
|---|---|
| API | A waiter: you order, it brings it from the kitchen; you never enter the kitchen. |
| Server | The kitchen: the real work, out of sight. |
| Database | A big labelled filing cabinet, or a spreadsheet with many sheets (tables). |
| Cache | A snack on your desk instead of a walk to the shop. It can go stale, so you refresh it. |
| Queue and worker | A ticket line at a deli: slow jobs take a ticket; a worker calls the next one. |
| Webhook | Instead of you calling the shop every minute, the shop calls you when it is ready. |
| async / await | Order coffee, take the buzzer, do other things; pick it up when it buzzes. |
| Component | A building block: snap blocks together into a page; reuse one block in many places. |
| Environment variable | A sticky note of settings the app reads at start. Change the note, not the app. |
| WebSocket | An open phone call both ways, instead of letters back and forth. |
| Migration | A tracked renovation of the filing cabinet: a new drawer, a renamed folder. |

Missing one? Make a fresh analogy — but only after you checked how the thing really works.

## Words

The plain-language habits, a word list, how to word a question and its options, and
before/after examples of a question and a status summary: `references/plain-english.md`. It is
the one detailed home for plain English in every reply, not only in an explanation. In short:
the project's own words for its parts; a code word defined in three or four plain words the
first time; short sentences, one idea each; no idioms; three or more new words → a tiny
glossary at the end.

## Never

- Dump everything at once.
- Explain a code word with another code word.
- Read code line by line like a robot — the **why** first, then the lines that matter.
- Say "just", "simply", "obviously", "of course" — they make a beginner feel slow.
- Invent the mechanism. An analogy that sounds right but is wrong is a trap.

## Size to the ask

- **Quick** (a word, one idea): the core sentence, the analogy, two layers. A few lines.
- **Deep** (a file, a feature, "how does X work"): all six steps and a diagram. For a big
  topic, offer to save it as a page they can keep.

The goal: they think "oh, that's it?" — and could now explain it to someone else.
