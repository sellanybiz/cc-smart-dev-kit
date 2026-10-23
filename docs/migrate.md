# Moving from anymodel

Until 0.3.0 the plugin, its marketplace, its command and its slots were named
`anymodel`. This page is the move for a machine that ran 0.2.x, and what a project keeps from
those names. The one command does it ([README](README.md#install)); the steps here are for a
machine where you would rather run it yourself.

Until 0.3.0 the plugin, its marketplace, its command and its slots were named
`anymodel` (the plugin id was `anymodel@anymodel`). A machine that ran 0.2.x still has
that version's names: its folders (`~/.config/anymodel`, `~/.claude/anymodel`,
`~/.local/share/anymodel`, `~/.local/state/anymodel`), its launcher
(`~/.local/bin/anymodel`), its router units (`anymodel-router`), the slots in
`gateway.json`, and the old names in `settings.json` and `~/.claude/CLAUDE.md`.

**The [one command](../README.md#install) does the move.** It adds the marketplaces, installs this
version, runs `migrate` (which decides by itself what to move, and says "Nothing to move."
on a machine without the old names), then runs `setup` — and asks about the old plugin if it
is still installed. Run it in your own terminal: `migrate` refuses inside a Claude Code
session, because it replaces the router that session's own model traffic goes through, and
it says to restart your sessions afterwards.

**Name the marketplace in the install line** either way. While the old `anymodel` marketplace
is added, a bare `claude plugin install cc-smart-dev-kit` installs the copy that comes from
`anymodel` (`cc-smart-dev-kit@anymodel`), and removing that marketplace later takes its copy
with it: `cc-smart-dev-kit@cc-smart-dev-kit` is the one to install. The one command does that
itself.

By hand: the `cc-smart-dev-kit` command does not exist on your machine yet — the old launcher
`~/.local/bin/anymodel` is the only one there — so run `migrate` from the plugin folder,
exactly as step 3 of [Install](../README.md#install) runs `setup`. Put the installed version in place of
`<version>`: the install prints no version, so read it with
`ls ~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/`:

```sh
plugin="$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/<version>"
claude plugin marketplace add <owner>/cc-smart-dev-kit
claude plugin install cc-smart-dev-kit@cc-smart-dev-kit
bun --no-env-file --config="$plugin/bunfig.toml" "$plugin/dist/cli.js" migrate
```

Add the marketplace by its **new** name, as the first line does. Adding it makes a SECOND
marketplace: it does **not** reuse the one already added from the same source. **Proved live**
(Claude Code 2.1.301, 2026-10-16) on a machine that had the old marketplace added — the source
`<owner>/anymodel` — where `claude plugin marketplace add <owner>/cc-smart-dev-kit` cloned the
repo and added a marketplace named `cc-smart-dev-kit` (`✔ Successfully added marketplace:
cc-smart-dev-kit (declared in user settings)`), and `claude plugin marketplace list` then
showed both. So "a marketplace is already added" means a marketplace with that **name**, which
is the key `known_marketplaces.json` uses — and the old `anymodel` marketplace stays added,
with its plugins, until the end of the move: `migrate`'s last step uninstalls the old plugin
and removes the old marketplace (it asks first), and the two commands near the end of this
section are the by-hand way. Removing a marketplace also uninstalls the plugins installed from
it (`docs/claude-code-contract.md` § Install and update), which is why the old one goes last.

The new plugin shows `✘ failed to load` too, until its two companions' marketplaces are
added: `claude plugin marketplace add thedotmack/claude-mem` and
`claude plugin marketplace add anthropics/claude-plugins-official`. The install says so
("will not load without them"), and the `cc-smart-dev-kit setup` at the end of the move adds
both and installs the companions.

Until the move, `claude plugin list` shows the old plugin as broken:

```
❯ anymodel@anymodel
  Status: ✘ failed to load
  Error: Plugin anymodel not found in marketplace anymodel
```

That is expected once 0.3.0 is on `main` **and the old marketplace's catalog has been
refreshed**. The refreshed catalog declares `cc-smart-dev-kit`, so the old plugin's entry has
nothing left to load; a refresh never renames the marketplace itself. Two ways it happens:
`claude plugin marketplace update anymodel`, or an update the session runs by itself (the
auto-update was not seen live from a 0.2.x clone, only a clone already on the new catalog).
Until then, the old clone still lists `anymodel` and its plugin stays ✔ enabled. Either way
it is only that entry: the router keeps running from its own copy
(`~/.local/share/anymodel/router.js`), so model traffic is unaffected until `migrate`
replaces it, and `migrate`'s last step removes the old plugin.

After that one run the launcher `~/.local/bin/cc-smart-dev-kit` is in place, and every
later command uses it (`cc-smart-dev-kit migrate` for a run that has to be repeated).

Run it in your own terminal: it refuses inside a Claude Code session (it replaces the
router that session's own model traffic goes through), and it says to restart your
sessions afterwards.

`migrate` moves every folder, rewrites the state folder's records and backups (so
`restore` still undoes what the old setup added), gives the settings keys the old setup
owned this version's value (the slots' names, and the words of their descriptions),
rewrites the instructions block in `~/.claude/CLAUDE.md` to the new markers and import
path and refreshes the copy (0.2.x shipped no instructions, so a 0.2.x machine has no
block: there the move installs none), renames the gateway config's slots — and adds an
`alias` for each old slot name, so Claude sessions that are still running keep working
until they restart; an alias of a project's own that pointed at an old slot is pointed at
the renamed one — replaces the `anymodel-router` units with this version's, and then
tells you to uninstall the old plugin (it does it after a yes on a terminal, and only
when it is still installed). Each changed file gets a backup first, and every step is
printed.

**Then run `cc-smart-dev-kit setup`.** One `migrate` run does not install the
instructions: it only rewrites the block a machine already has. A 0.2.x machine has none,
so it ends the move without them, and without the copy `setup` would have made. `setup`
installs both, and refreshes the launcher and the companions with them. `migrate` says
this in its closing lines when it applies to your machine.

The order matters, and it is fixed: it reads and checks everything (the plugin install,
the folders, the gateway config through its schema, the settings, the records), then
**asks every question**, and writes nothing before they are answered — so a "no" to the
router question, or a run with no terminal to ask on and no `--yes`, leaves the machine
exactly as it was. It then prints the steps it will do and walks them in order: the
folders, the state folder's records and backups, the gateway config, the limit state, the
settings, the instructions, the launcher, the router, the old plugin. A step that fails
says which one, keeps everything the steps before it did, and the next run goes on from
there — each step is safe to repeat, and each finished step is recorded in
`~/.claude/cc-smart-dev-kit/migrate-progress.json` while the move is unfinished.
`--dry-run` prints that same plan, the same changes, and the question it would ask, and
writes, runs and stops nothing. A second run after a finished one says "Nothing to move.".

Two things it refuses, on purpose:

- **It does not run inside a Claude Code session.** Run it in a terminal, then restart
  your sessions.
- **It stops before writing anything when a target folder is already there** — say, a
  `~/.config/cc-smart-dev-kit` you already made. Move or remove one of them by hand, then
  run it again; it never merges two folders by itself. The one exception is its own state
  folder `~/.claude/cc-smart-dev-kit` when it holds nothing but what a Claude session's
  start wrote there (its `sessions/` record, an update check, the update log): the move
  goes into it. Anything else in it, and it says which folder holds what, and stops.

Before it moves anything it also warns you about Claude sessions that started with the old
plugin and are still running (their `sessions/` records, in the old state folder, name
them): close them first, and start them again here — until then one of them may write the
old folders again.

The old plugin goes **last**, after `migrate` (`claude plugin uninstall
anymodel@anymodel`, `claude plugin marketplace remove anymodel`): two copies of the same
hooks would otherwise run, and removing a marketplace also deletes its plugins' saved data.
That is why the order is add the new marketplace, install the new plugin, then `migrate`:
`migrate`'s last step already uninstalls the old plugin when you say yes on a terminal, and
the two `claude plugin` commands above are for a "no" (or no terminal). One more thing: a
judge target's test proof does not carry
over (the proof's own text changed with the name), so a judge needs its test
again: `cc-smart-dev-kit gateway slot judge <targets>`. Without it the judge is simply
not used, and `doctor` says so. `migrate` prints that line when the old config had a
tested judge.

## Projects that used the old name

`migrate` moves your **machine's** own files. A project keeps what 0.2.x wrote in its own
`.claude/` folder, so run `cc-smart-dev-kit doctor` inside the project: it warns about each
one, with the name it becomes.

- **`.claude/anymodel.json`** — the old name of `.claude/cc-smart-dev-kit.json`, the file the
  plugin reads now. Rename it (merge the two when both are there): with only the old file, the
  project looks like one that never opted in, and every plugin hook stays silent in it.
- **`.claude/anymodel/`** — the old name of `.claude/cc-smart-dev-kit/`, where a skill reads the
  project's own add-ons (`review.md`, `plan-task.md`, …). Rename the folder.
- **A hook in `.claude/settings.json`** that still calls `"$HOME/.local/bin/anymodel" hook
  <name>` — that launcher went with 0.2.x. Change it to
  `"$HOME/.local/bin/cc-smart-dev-kit" hook <name>` (`cc-smart-dev-kit hook` prints the lines).
