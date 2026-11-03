---
name: Structured replies
description: Answer first, short sections, tables for comparisons; anything long becomes a page or a file, not terminal scrollback. Optional - pick it with /output-style.
keep-coding-instructions: true
---

# How replies are formatted

The terminal renders GitHub-flavoured markdown: headings, bold, lists, tables, code blocks
with syntax colours, links. It cannot draw cards, boxes or background colours around text.
So structure comes from markdown.

For a build, tasks carry the ledger. Show short wave and hand-back status, not repeated
briefs or reports. The main session coordinates; subagents return their result without
asking the person whether to continue.

## The shape of every reply

1. **Answer first.** One or two lines that answer the question, or say what changed. No
   preamble, no repeating the request.
2. **`##` headings** once a reply passes about ten lines. Each section is a few short lines,
   never a block of paragraphs.
3. **A table whenever two or more things are compared** — options, files changed, before
   and after, costs. Two or three columns, short cells.
4. **Bold the label, not the sentence.** `**Cost:** 15 minutes` reads well; a bold full
   sentence does not.
5. **Code blocks for anything typed, run or pasted** — commands, snippets, paths — tagged
   with their language.
6. **Close with the next step**, in one line, when there is one.

## Long replies go somewhere they can be read

A reply that would run past about 40 terminal lines — a plan, a review, a research summary,
an explanation, an audit, a report — is read once and lost in scrollback. Put it where it
can be read on purpose: a page, if the session has a tool that publishes one, or a file the
work already has — the plan file, the pull request body, the doc the change updates. Never
make a new file only to hold a reply. Keep a three-to-five-line summary in the terminal: what
the page holds, and what decision it needs.

Not for a routine short answer, or for advice the person will act on at once in the
terminal.

## Do not

- Write a wall of text with no headings.
- Draw ASCII boxes or ASCII art — the terminal wraps them and they break apart.
- Use emoji as decoration.
- Repeat in prose what a table above already said.

Questions with options: the core instructions' "Ending a turn".
