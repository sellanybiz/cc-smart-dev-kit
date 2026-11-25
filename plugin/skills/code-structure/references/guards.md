# Setting up the mechanical guards

`code-structure` § 13 names four guards. This page shows how to set them up for the project's own
stack. It is a plan of its own (`/cc-smart-dev-kit:plan-task`), offered as § 13 says, never part of
another change. **Install nothing, and add no dependency, without the person's yes.**

## 1. Pick the tool for each guard

Every stack has its own tools, and they change. For each guard, research the maintained tool
for the project's language (`/cc-smart-dev-kit:research-first`): read its current docs, not
memory, and prefer one the project already has. The JavaScript and TypeScript tools below are
examples. Their options were checked against each tool's docs when this page was written; check
them again before you name one.

| Guard | What it fails on | JS/TS example |
|---|---|---|
| Unused exports | an export nothing uses, or only a test uses | `knip`: reports unused files, exports and dependencies (`knip.json`); `knip --production` leaves test files out, so a test-only export counts as unused |
| Duplicate code | a copied block over a size | `jscpd`: use its own baseline as the ratchet (§ 2): `--baseline <file>` with `--fail-on-new-clones` tolerates the clones that exist and fails on a new one, and `--baseline-from-ref <ref>` does the same against a base ref with no committed file. `--threshold` measures the whole tree, so it is no ratchet; leave it out |
| Size | a file or function over a limit | a small script of your own (below) |
| Front door | an import that skips a feature's public entry | ESLint `no-restricted-imports` with `patterns` (`group` globs and a `message`), or a `forbidden` rule in `dependency-cruiser` |

Another language: ask the same question of its own tools (a linter rule for imports, a dead-code
finder, a copy detector). Where none exists, a short script that fails the build is fine.

## 2. Make each guard a ratchet

A guard that fails on today's mess never gets turned on. A ratchet starts from today and only
tightens:

- Record the current findings once, as a **baseline** file in the repo (a count, or a list of
  entries: files, exports, pairs of copies).
- The check fails on a **new** entry, and also on a **gone** entry: when someone fixes one, the
  baseline must shrink in the same change. The count can only go down.
- `--update` rewrites the baseline. A change that runs it says why in the pull request
  description (what was added or removed, and the reason), so a reviewer sees every loosening.
- Some tools have a baseline of their own (`dependency-cruiser` has `--ignore-known`, `jscpd` has
  `--baseline`). Use it when it exists; otherwise a script that compares the tool's output with the baseline file does the
  same.

The size guard is the simplest: a script lists files over the limit, compares with
`size-baseline.json`, and fails on a new or a gone entry unless called with `--update`.

## 3. Run them where they count

- **CI:** each guard is a step of the project's check, so a pull request cannot merge past it.
- **Pre-push:** the same commands in a pre-push hook of the project, so the failure shows before
  CI. Fast ones only; leave slow ones to CI.
- **The reviewers:** add the commands to `.claude/cc-smart-dev-kit/review.md` under a heading
  named exactly `Reuse signals`, one command per line with a short note on how to read it.
  `code-structure` § 13 says who runs them and when. `cc-smart-dev-kit doctor` and
  `cc-smart-dev-kit project init` say when the heading is missing.

## 4. The front-door gate, generated from the folders

A hand-written import rule per feature goes stale: the day someone adds a feature and forgets its
rule, that feature has no door. So let a script **read the feature folders and write the rule**.
A new feature then gets its rule with no edit.

The idea, for ESLint's flat config (`eslint.config.js`, which is plain JavaScript, so it can read
the disk when the lint starts). Adapt the paths to the project; this is a sketch, not a drop-in:

```js
import { existsSync, readdirSync } from "node:fs";

const featuresDir = "src/features";
const features = existsSync(featuresDir)
  ? readdirSync(featuresDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

// `group` needs at least one pattern: with no feature to close, a block is left out.
const doorBlock = (files, others, ignores = []) =>
  others.length === 0
    ? []
    : [{
        files,
        ignores,
        rules: {
          "no-restricted-imports": ["error", {
            patterns: [{
              // The negated line goes last: it keeps the index importable by name.
              group: [...others.map((other) => `**/${other}/*`), ...others.map((other) => `!**/${other}/index`)],
              message: "Import a feature through its front door (its index), not its inner files.",
            }],
          }],
        },
      }];

export default [
  // Inside a feature: the other features' inner files are closed.
  ...features.flatMap((name) =>
    doorBlock([`${featuresDir}/${name}/**`], features.filter((other) => other !== name))),
  // Everything else: every feature's inner files are closed.
  ...doorBlock(["src/**/*.{ts,tsx}"], features, [`${featuresDir}/**`]),
];
```

Notes:

- The sketch is valid with one feature (the block inside it is left out) and with none (no block
  at all). A folder import (`../billing`) is the front door; the `!` lines also let an import name
  the index (`../billing/index`). A project that imports with a file extension adds a negated
  line for it. ESLint wants negated patterns last in `group`, as the sketch has them.
- Each file matches exactly one block above. That matters: when two config blocks set the same
  rule for one file, the later block replaces the earlier, it does not add to it. If the project
  already sets `no-restricted-imports` for these files, merge its patterns into this script.
- A feature name that is also an ordinary folder name elsewhere over-matches. Anchor the globs
  to the features folder if that happens.
- With `dependency-cruiser`, one rule can cover every feature with no list at all: capture the
  feature's folder name in `from.path` with a group, and refer to it as `$1` in `to.pathNot` (its
  rules reference shows the pattern). The rule needs each feature's index in `to.pathNot`
  as well, or it also forbids the front door. A new folder is covered by the same rule.
- Keep the generator beside the config and run it in CI. Never commit its output as a hand-edited
  file; if the tool needs a file, the script writes it and a check fails when it is out of date.
- Start as a ratchet (§ 2): existing deep imports go in the baseline, new ones fail.

## 5. Order of work

1. Ask the person which guards they want, and which tools; get a yes before any install.
2. Add one guard at a time, each with its baseline and a check that it fails once on a bad input.
3. Wire it into CI, then pre-push, then the `Reuse signals` heading.
4. Run `cc-smart-dev-kit workflow claims` once and read it: it shows the "one home" claims the
   project makes, so a claim with no guard stands out.
