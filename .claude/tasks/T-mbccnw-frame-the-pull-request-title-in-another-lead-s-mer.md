---
id: "T-mbccnw"
title: "Frame the pull request title in another lead's merge line as GitHub data"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-03"
from: "branch worktree-watch-news-quiet"
refs: ["src/hooks/after-merge.ts","src/crew/watch.ts"]
---
## What and why

`mergedLine` (`src/hooks/after-merge.ts`) puts the merged pull request's title into the line every other lead's watch says: `<lead> merged #<n> (<title>) into <base> — at your next stop, merge origin/<base> into your branch`. `quotableTitle` makes it one line (quotes swapped, whitespace folded, at most 100 characters), but `eventLine` (`src/crew/watch.ts`, `case "merge"`) gives it no `ISSUE_DATA_FRAME`, which every line that quotes GitHub text by someone else gets (`quotesGitHub`). On a repository where anyone can open a pull request, its title is text by anyone, read by a lead's model as part of the watch's line.

Found by the 1.11.3 review (it is older: D55); outside that release's change.

## Steps

- Decide whether a merge line's title counts as GitHub text by someone else (the lead merged it, so it read it once) or not.
- If it does: frame it the way issue lines are framed (`ISSUE_DATA_FRAME`), in `eventLine`'s `merge` case or in `mergedLine`, with a test.

## How to check

`bun test src/crew/watch.test.ts src/hooks/after-merge.test.ts`; a merge event whose title reads like an instruction comes out framed as data.