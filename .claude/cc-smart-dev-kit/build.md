# Build: this repo's add-on

The build skill reads this file first. It adds what building a plan needs in this repo.

## Every plan touches the release files

Each plan here ships as its own version. So every plan changes the same files:
`plugin/.claude-plugin/plugin.json` (the version), `install.sh` and `install.ps1` (the
installers' copy of it), `CHANGELOG.md`, `plugin/dist/` and, when the portal changed,
`plugin/portal-ui/`. These are the files `plans.mergeFiles` should name. Until it does, two
plans whose file lists both name one of them overlap, so they run one at a time.

- **Builders never touch them.** A phase brief says: no version bump, no CHANGELOG entry, no
  `bun run build`. The plan's lead does all of it once, after the last phase merges and before
  the plan's review rounds (the `release` skill, steps 1 to 3).
- **Build with the Bun version CI pins** (`bun-version` in `.github/workflows/ci.yml`), for
  example `bunx --bun bun@<that version> run build`. Another Bun writes other bytes, and
  `build:check` fails in CI.
- **A worktree needs its own `bun install --frozen-lockfile`** before a build. Without it the
  bundles carry other module paths in their comments.
- **After the build, `git diff --stat origin/main -- plugin/dist/router.js` must be empty**
  unless the plan changed the router on purpose (`.claude/rules/bundles-and-releases.md`).

## A plan child, after main moved

A child's pull request goes into `main`. When another plan merged first, the child rebases
or merges `main`, then:

1. raises `version` above main's in the three files (a minor step for a feature);
2. puts its CHANGELOG entry above main's newest one, as its own version;
3. rebuilds `plugin/dist/` (and `plugin/portal-ui/` when the portal changed), never by
   resolving a conflict in a built file by hand;
4. runs `bun run check` again before it pushes.
