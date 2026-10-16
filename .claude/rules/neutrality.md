# Neutral: The Plugin Works For Anyone

No `paths:` frontmatter: a name can land in any file — code, a doc, a test, a comment,
a commit message — so this rule loads on every turn.

## No names

No company, project, organization, person, machine or team name goes anywhere in the
repo: code, docs, tests, fixtures, comments, rules, skills, command output, commit
messages, branch names.

- **Neutral examples only:** `example-org/cc-smart-dev-kit`, `my-app`, `app-wt-`,
  `test@example.com`, `/home/user`. Never a real repo, host name, user name or home path.
- **Exception 1, the publisher:** the publisher metadata of the two manifests —
  `.claude-plugin/marketplace.json` (`owner`) and `plugin/.claude-plugin/plugin.json`
  (`author`, `repository`). Nothing else in those two files names anyone either.
- **Exception 2, third-party package coordinates:** the ids of the third-party plugins
  and marketplaces the plugin depends on or installs — a plugin id
  (`claude-mem@thedotmack`), a dependency's marketplace name, the GitHub `owner/repo` a
  marketplace is added from (`warpdotdev/claude-code-warp`). They are addresses a
  machine needs, allowed in the manifests, in code and in the docs that name the
  command to run. They never stand for the owner, a person or a team in prose, and
  never point at the publisher's own projects.
- **The code never writes the publisher as text.** It reads the repository from
  `plugin.json` at build time (`src/build-info/`, a Bun macro) and uses
  `MARKETPLACE_SOURCE`. So the publisher reaches command output in one place, built
  from the manifest: the CLI prints `claude plugin marketplace add <publisher>/cc-smart-dev-kit`
  (for example when setup finds no marketplace). That is part of exception 1.

## Project details come from the project

The plugin carries only general behaviour. Anything one project needs is a setting in
that project's `.claude/cc-smart-dev-kit.json` (`.claude/rules/cc-smart-dev-kit-json.md`), or a file in its own
`.claude/` folder that a general skill reads when it exists (for example, a review skill
also follows the project's `.claude/cc-smart-dev-kit/review.md`, and the project's text wins).

So when a change seems to need a project's value — a branch name, a folder prefix, a
command, a rule's wording — add a `cc-smart-dev-kit.json` field or an extension point. Never write the
value into the plugin.

## What the check catches, and what it does not

`bun run check:neutral` (`scripts/check-neutral.ts`, part of `bun run check` and CI):

- reads the forbidden names from the two manifests (the owner in `repository`, and the
  marketplace's `owner.name`), never from a list in the script;
- searches every tracked file and every new file git does not ignore, case-insensitive;
- skips the two manifests, `bun.lock` and `plugin/dist/` (built from `src/`, which it
  does check).

It knows **only the publisher's name**, and it reads **only files**. Another project's
name, a person, a machine or a team gets past it, and so does any name in a commit
message or a branch name. Keeping those out is on you, and on every review.

A hit is fixed by removing the name — never by adding a file to the skip list.
