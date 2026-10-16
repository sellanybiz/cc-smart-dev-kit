/**
 * `install.sh` (the one-command installer) in a fake world: a temp HOME, and a PATH whose
 * first folder holds fakes for `claude`, `bun`, `git`, `gh` and `curl`. The fakes log every
 * argument they are given and answer the way the real ones do — the fake `claude` writes
 * `known_marketplaces.json` and `installed_plugins.json` exactly as Claude Code writes them
 * (docs/claude-code-contract.md), and the fake `bun` reads what the real commands read from
 * stdin, so a run goes on the way a real one does.
 *
 * The world's terminal is `CC_SMART_DEV_KIT_INSTALL_TTY`: a file whose lines are the
 * answers, read in order. The installer itself is started with its stdin at /dev/null, the
 * way `curl … | bash -s -- <owner>/<repo>` starts it, so a question read from stdin would
 * fail the test rather than pass it.
 *
 * No test reaches the network, a real Claude Code, or the host's HOME: the fakes answer
 * everything, and PATH is the fakes plus the few system tools a shell script needs.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MIN_BUN } from "../src/build-info/bun";
import { tempDir } from "../src/testing/temp";

const REPO = "example-org/cc-smart-dev-kit";
const INSTALL_SH = join(import.meta.dir, "..", "install.sh");
const INSTALL_PS1 = join(import.meta.dir, "..", "install.ps1");
const REAL_BUN = process.execPath;
const BASH: string = Bun.which("bash") ?? "";
if (BASH === "") throw new Error("install.test.ts needs bash");

/** The version the fake marketplace's copy of the plugin declares. */
const MARKETPLACE_VERSION = "0.4.2";

interface WorldOptions {
  /** What the fake `bun --version` prints. A version older than MIN_BUN tests the upgrade. */
  bunVersion?: string;
  /** Leave `bun` off PATH, as a machine that has none. */
  noBun?: boolean;
  /** The fake `git` fails every call, as a machine whose git credentials are not set up. */
  gitFails?: boolean;
  /** The lines the terminal answers, in the order the installer asks. */
  answers?: string[];
}

interface World {
  home: string;
  configDir: string;
  /** Every fake's call, one line each; a fake may add a line about what it read. */
  calls: () => string[];
  /** The lines of one fake's calls, in order. */
  callsOf: (name: string) => string[];
  run: (args?: string[], env?: Record<string, string>) => { code: number; out: string };
  /** Puts a file in place, the way an earlier state of the machine would have it. */
  file: (path: string, text: string) => void;
  /** The plugin's folder, as `claude plugin install` leaves it. */
  pluginDir: string;
  /** The `bun --no-env-file …` form that runs the plugin's own CLI. */
  cli: string;
}

/** The fake binaries, one shell script each. */
function fakeScripts(log: string): Record<string, string> {
  return {
    // `--version` answers this machine's Bun; `-e` (the installer's JSON reader) runs the
    // real bun, which reaches no network; `upgrade` records the version it moved to; the
    // plugin's own commands read their secret from stdin (and log only its shape).
    bun: `#!/bin/sh
printf '%s\\n' "bun $*" >> ${JSON.stringify(log)}
if [ "$1" = "--version" ]; then
  if [ -f "$FAKE_BUN_UPGRADED" ]; then cat "$FAKE_BUN_UPGRADED"; else printf '%s\\n' "$FAKE_BUN_VERSION"; fi
  exit 0
fi
if [ "$1" = "-e" ]; then exec ${JSON.stringify(REAL_BUN)} "$@"; fi
if [ "$1" = "upgrade" ]; then printf '%s\\n' "$FAKE_BUN_UPGRADE_TO" > "$FAKE_BUN_UPGRADED"; exit 0; fi
case "$*" in
*browser\\ token*)
  secret=""; IFS= read -r secret || secret=""
  printf '%s\\n' "stdin-\${#secret}-chars" >> ${JSON.stringify(log)}
  ;;
esac
case "$*" in
*--backend-key-stdin* | *--tavily-key-stdin*)
  secret="$(cat)"
  if [ -n "$secret" ]; then printf '%s\\n' "stdin-nonempty" >> ${JSON.stringify(log)}; else printf '%s\\n' "stdin-empty" >> ${JSON.stringify(log)}; fi
  ;;
esac
case "$*" in
*dist/cli.js\\ setup*)
  # The real setup writes the launcher; the machine then has a command to run.
  mkdir -p "$HOME/.local/bin"
  printf '#!/bin/sh\\nprintf "%%s\\\\n" "launcher $*" >> %s\\nexit 0\\n' ${JSON.stringify(log)} > "$HOME/.local/bin/cc-smart-dev-kit"
  chmod +x "$HOME/.local/bin/cc-smart-dev-kit"
  ;;
esac
exit 0
`,
    // Claude Code's own commands. `marketplace add` clones the marketplace: the fake makes
    // the folder and writes the record keyed by the marketplace's OWN NAME (proved live:
    // the name, never the source, is what "already added" means). `plugin install` writes
    // the user-scope install record and the plugin folder the installer runs next.
    claude: `#!/bin/sh
printf '%s\\n' "claude $*" >> ${JSON.stringify(log)}
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "add" ]; then
  name="cc-smart-dev-kit"
  case "$4" in
  *claude-mem) name=thedotmack ;;
  *claude-plugins-official) name=claude-plugins-official ;;
  esac
  dir="$CLAUDE_CONFIG_DIR/plugins/marketplaces/$name"
  mkdir -p "$dir/plugin/.claude-plugin"
  case "$4" in
  *cc-smart-dev-kit)
    printf '{"name":"cc-smart-dev-kit","version":"${MARKETPLACE_VERSION}"}\\n' > "$dir/plugin/.claude-plugin/plugin.json"
    ;;
  esac
  ${JSON.stringify(REAL_BUN)} -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d[process.argv[2]]={source:{source:"github",repo:process.argv[3]},installLocation:process.argv[4]};fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json" "$name" "$4" "$dir"
fi
if [ "$1" = "plugin" ] && [ "$2" = "install" ]; then
  dir="$CLAUDE_CONFIG_DIR/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/${MARKETPLACE_VERSION}"
  mkdir -p "$dir/dist"
  printf 'await import("the plugin");\\n' > "$dir/dist/cli.js"
  printf '{}\\n' > "$dir/bunfig.toml"
  ${JSON.stringify(REAL_BUN)} -e 'const fs=require("fs");const p=process.argv[1];let d={version:2,plugins:{}};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d.plugins=d.plugins||{};d.plugins["cc-smart-dev-kit@cc-smart-dev-kit"]=[{scope:"user",installPath:process.argv[2],version:process.argv[3]}];fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json" "$dir" "${MARKETPLACE_VERSION}"
fi
exit 0
`,
    git: `#!/bin/sh
printf '%s\\n' "git $*" >> ${JSON.stringify(log)}
if [ "$FAKE_GIT_FAILS" = "yes" ]; then exit 128; fi
exit 0
`,
    gh: `#!/bin/sh
printf '%s\\n' "gh $*" >> ${JSON.stringify(log)}
exit 0
`,
    // Bun's own installer is a script piped into bash: it downloads, then writes the binary
    // into ~/.bun/bin. The fake does the second half, so the installer finds a bun where
    // Bun's installer puts one.
    curl: `#!/bin/sh
printf '%s\\n' "curl $*" >> ${JSON.stringify(log)}
case "$*" in
*bun.sh/install*)
  mkdir -p "$HOME/.bun/bin"
  cp "$FAKE_BUN_REAL" "$HOME/.bun/bin/bun"
  chmod +x "$HOME/.bun/bin/bun"
  printf '#!/bin/sh\\nexit 0\\n'
  ;;
esac
exit 0
`,
  };
}

function world(options: WorldOptions = {}): World {
  const root = tempDir("install");
  const home = join(root, "home");
  const fakeBin = join(home, "fake-bin");
  const configDir = join(home, ".claude");
  const log = join(home, "calls.log");
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(log, "");

  const scripts = fakeScripts(log);
  for (const [name, body] of Object.entries(scripts)) {
    if (name === "bun" && options.noBun === true) continue;
    writeFileSync(join(fakeBin, name), body);
    chmodSync(join(fakeBin, name), 0o755);
  }
  // The fake `curl` copies THIS into ~/.bun/bin: a bun that answers like the fake one.
  const installable = join(home, "installable-bun");
  writeFileSync(installable, scripts.bun ?? "");
  chmodSync(installable, 0o755);

  const answersFile = join(home, "answers");
  writeFileSync(answersFile, `${(options.answers ?? []).join("\n")}\n`);

  const pluginDir = join(
    configDir,
    "plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit",
    MARKETPLACE_VERSION,
  );
  const baseEnv: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    // The fakes first, then the few system tools a shell script needs (bash itself, cat,
    // mkdir, cp). No real `claude`, `bun`, `git`, `gh` or `curl` is reachable.
    PATH: `${fakeBin}:/usr/bin:/bin`,
    CC_SMART_DEV_KIT_INSTALL_TTY: answersFile,
    FAKE_BUN_VERSION: options.bunVersion ?? MIN_BUN,
    FAKE_BUN_UPGRADED: join(home, "bun-upgraded"),
    FAKE_BUN_UPGRADE_TO: MIN_BUN,
    FAKE_BUN_REAL: installable,
    FAKE_GIT_FAILS: options.gitFails === true ? "yes" : "no",
  };

  return {
    home,
    configDir,
    pluginDir,
    cli: `--no-env-file --config=${pluginDir}/bunfig.toml ${pluginDir}/dist/cli.js`,
    calls: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== ""),
    callsOf: (name) =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.startsWith(`${name} `))
        .map((line) => line.slice(name.length + 1)),
    run: (args = [REPO], env = {}) => {
      const result = Bun.spawnSync([BASH, INSTALL_SH, ...args], {
        cwd: home,
        env: { ...baseEnv, ...env },
        // The installer arrives on a pipe in real use: its stdin is not a terminal, and
        // nothing it asks may come from here.
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        code: result.exitCode,
        out: `${result.stdout.toString()}${result.stderr.toString()}`,
      };
    },
    file: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
}

/** Every line the installer printed, in order, with the empty ones dropped. */
function lines(out: string): string[] {
  return out.split("\n").filter((line) => line !== "");
}

describe("install.sh: a machine, step by step", () => {
  test("a fresh machine: the marketplaces, the plugin, setup, and doctor", () => {
    const w = world({ answers: ["n", "n", "n"] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(lines(out)).toEqual([
      "✓ 1/8 not inside a Claude Code session",
      `✓ 2/8 claude found: ${w.home}/fake-bin/claude, and git can read ${REPO}`,
      `✓ 3/8 Bun ${MIN_BUN} is new enough (the plugin needs ${MIN_BUN} or newer)`,
      `✓ 4/8 marketplaces added: ${REPO}, thedotmack/claude-mem, anthropics/claude-plugins-official`,
      `✓ 5/8 the plugin is installed (${MARKETPLACE_VERSION}): ${w.pluginDir}`,
      "✓ 6/8 setup finished (a new machine)",
      // Each of the three questions is asked on the terminal, and each answer here is no.
      "7/8 Set up the browser (Playwright on your own Chrome)? [y/N] ",
      "· 7/8 the browser was skipped: run `cc-smart-dev-kit browser setup` later",
      "7/8 Set up the AI gateway now (affordable models for the haiku and sonnet subagents)? [y/N] ",
      "· 7/8 the gateway was skipped: README § The AI gateway has its steps",
      "7/8 Add your Tavily key now (the tavily-websearch MCP server)? [y/N] ",
      "· 7/8 the Tavily key was skipped: README § MCP servers says where it goes",
      "✓ 8/8 doctor: every check passed",
      "Restart every Claude Code session: they load the plugin when they start.",
      "`cc-smart-dev-kit portal` opens the portal in your own terminal (it prints a link with a one-time token).",
    ]);
    // The three marketplaces, in the README's order, then the install (whose line names the
    // marketplace), then setup through the plugin's own bundle.
    expect(w.callsOf("claude")).toEqual([
      `plugin marketplace add ${REPO}`,
      "plugin marketplace add thedotmack/claude-mem",
      "plugin marketplace add anthropics/claude-plugins-official",
      "plugin install cc-smart-dev-kit@cc-smart-dev-kit --scope user",
    ]);
    expect(w.callsOf("bun")).toContain(`${w.cli} setup`);
    // setup writes the launcher, and doctor runs through it.
    expect(w.callsOf("launcher")).toEqual(["doctor"]);
    // git was asked before anything was installed (SSH first, then HTTPS).
    expect(w.callsOf("git")).toEqual([`ls-remote git@github.com:${REPO}.git`]);
  });

  test("a machine that still has the old anymodel names: migrate, never setup", () => {
    const w = world({ answers: ["n", "n", "n"] });
    w.file(join(w.home, ".config/anymodel/gateway.json"), "{}\n");
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "✓ 6/8 migrate finished (this machine still has the old anymodel names)\n",
    );
    expect(w.callsOf("bun")).toContain(`${w.cli} migrate`);
    expect(w.calls().filter((call) => call.includes("dist/cli.js setup"))).toEqual([]);
  });

  test("the old plugin is installed under its old id: migrate too", () => {
    const w = world({ answers: ["n", "n", "n"] });
    w.file(
      join(w.configDir, "plugins/installed_plugins.json"),
      `${JSON.stringify({
        version: 2,
        plugins: {
          "anymodel@anymodel": [{ scope: "user", installPath: "/nowhere", version: "0.2.1" }],
        },
      })}\n`,
    );
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "✓ 6/8 migrate finished (this machine still has the old anymodel names)\n",
    );
  });

  test("a second run does only what is missing", () => {
    const w = world({ answers: ["n", "n", "n"] });
    expect(w.run().code).toBe(0);
    const afterFirst = w.calls().length;
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("✓ 4/8 all three marketplaces are already added\n");
    expect(out).toContain(
      `✓ 5/8 the plugin is installed, at the marketplace's version (${MARKETPLACE_VERSION})\n`,
    );
    // The second run adds no marketplace and reinstalls nothing — but still runs setup (it
    // refreshes the instructions and the launcher) and doctor.
    const second = w.calls().slice(afterFirst);
    expect(second.filter((call) => call.includes("marketplace add"))).toEqual([]);
    expect(second.filter((call) => call.includes("plugin install"))).toEqual([]);
    expect(second).toContain(`bun ${w.cli} setup`);
    expect(second).toContain("launcher doctor");
  });

  test("inside a Claude Code session: refused, exit 2, nothing runs", () => {
    const w = world({ answers: ["n"] });
    const { code, out } = w.run([REPO], { CLAUDECODE: "1" });
    expect(code).toBe(2);
    expect(out).toContain(
      "✗ this installer cannot run inside a Claude Code session: it may replace the router this session's own model traffic goes through.",
    );
    expect(w.calls()).toEqual([]);
  });

  test("an old Bun, and the person says no: stopped, exit 2", () => {
    const w = world({ bunVersion: "1.2.0", answers: ["n"] });
    const { code, out } = w.run();
    expect(code).toBe(2);
    expect(out).toContain(
      `3/8 Bun 1.2.0 is older than ${MIN_BUN}. Upgrade it now with bun upgrade? [y/N] `,
    );
    expect(out).toContain(`✗ Bun is still 1.2.0: cc-smart-dev-kit needs Bun ${MIN_BUN} or newer`);
    expect(w.callsOf("bun")).toEqual(["--version"]);
    expect(w.callsOf("claude")).toEqual([]);
  });

  test("an old Bun, and the person says yes: bun upgrade, then on", () => {
    const w = world({ bunVersion: "1.2.0", answers: ["y", "n", "n", "n"] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(`✓ 3/8 Bun upgraded: ${MIN_BUN}\n`);
    expect(w.callsOf("bun")).toContain("upgrade");
  });

  test("no Bun at all, and the person says yes: Bun's own installer runs", () => {
    const w = world({ noBun: true, answers: ["y", "n", "n", "n"] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(`✓ 3/8 Bun installed: ${MIN_BUN}\n`);
    expect(w.callsOf("curl")).toEqual(["-fsSL https://bun.sh/install"]);
    // It is used from where Bun's installer puts it, not from PATH.
    expect(existsSync(join(w.home, ".bun/bin/bun"))).toBe(true);
  });

  test("git cannot read the repository: the two gh commands are named", () => {
    const w = world({ gitFails: true });
    const { code, out } = w.run();
    expect(code).toBe(1);
    expect(out).toContain(
      `✗ git cannot read ${REPO}: a private repository needs your git credentials`,
    );
    expect(out).toContain("    gh auth login\n    gh auth setup-git\n");
    expect(w.callsOf("git")).toEqual([
      `ls-remote git@github.com:${REPO}.git`,
      `ls-remote https://github.com/${REPO}.git`,
    ]);
    expect(w.callsOf("claude")).toEqual([]);
  });

  test("no repository argument and no CC_SMART_DEV_KIT_REPO: one usage line, exit 2", () => {
    const w = world();
    const { code, out } = w.run([], { CC_SMART_DEV_KIT_REPO: "" });
    expect(code).toBe(2);
    expect(out).toBe(
      "usage: bash install.sh <owner>/<repo>   (or set CC_SMART_DEV_KIT_REPO=<owner>/<repo>)\n",
    );
    expect(w.calls()).toEqual([]);
  });

  test("CC_SMART_DEV_KIT_REPO is read when there is no argument", () => {
    const w = world({ answers: ["n", "n", "n"] });
    const { code, out } = w.run([], { CC_SMART_DEV_KIT_REPO: REPO });
    expect(code).toBe(0);
    expect(out).toContain(
      `✓ 2/8 claude found: ${w.home}/fake-bin/claude, and git can read ${REPO}\n`,
    );
  });

  test("--dry-run prints the plan and changes nothing", () => {
    const w = world();
    const { code, out } = w.run(["--dry-run", REPO]);
    expect(code).toBe(0);
    expect(out).toContain(
      "cc-smart-dev-kit installer: dry run, the plan for this machine. Nothing is changed.\n",
    );
    expect(out).toContain(
      `· 4/8 the plan adds: ${REPO}, thedotmack/claude-mem, anthropics/claude-plugins-official\n`,
    );
    expect(out).toContain(
      "Dry run: nothing was written, nothing ran, and no network was reached.\n",
    );
    // Nothing that changes anything ran: no Claude Code command, no git (a network), no
    // setup, no doctor — and no record file appeared.
    expect(w.callsOf("claude")).toEqual([]);
    expect(w.callsOf("git")).toEqual([]);
    expect(w.callsOf("curl")).toEqual([]);
    expect(w.calls().filter((call) => call.includes("dist/cli.js"))).toEqual([]);
    expect(existsSync(join(w.configDir, "plugins/known_marketplaces.json"))).toBe(false);
    expect(existsSync(join(w.configDir, "plugins/installed_plugins.json"))).toBe(false);
  });
});

describe("install.sh: what only the person has", () => {
  const TOKEN = "A".repeat(43);
  const GATEWAY_KEY = "omniroute-key-abc123";
  const TAVILY_KEY = "tvly-key-abc123";

  test("the three secrets reach the plugin's own commands on stdin, never in an argument", () => {
    const w = world({ answers: ["y", "y", TOKEN, "y", GATEWAY_KEY, "y", TAVILY_KEY] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("✓ 7/8 the browser's token is saved\n");
    expect(out).toContain(
      "✓ 7/8 the gateway is set up: turn it on with `cc-smart-dev-kit gateway on` when you want it\n",
    );
    expect(out).toContain("✓ 7/8 the Tavily key is saved\n");

    // Each command is the plugin's own, and each secret reaches it on stdin: the fake
    // reports what it read, and never the value.
    expect(w.callsOf("bun")).toContain(`${w.cli} browser setup`);
    expect(w.callsOf("bun")).toContain(`${w.cli} browser token`);
    expect(w.calls()).toContain(`stdin-${TOKEN.length}-chars`);
    expect(w.callsOf("bun")).toContain(`${w.cli} gateway setup --backend-key-stdin omniroute`);
    expect(w.callsOf("bun")).toContain(`${w.cli} setup --tavily-key-stdin`);
    // Two commands read a secret from a pipe: the gateway's key and the Tavily key.
    expect(w.calls().filter((line) => line === "stdin-nonempty")).toHaveLength(2);

    // No secret is in any fake's arguments, in the log, or in what the installer printed.
    for (const secret of [TOKEN, GATEWAY_KEY, TAVILY_KEY]) {
      expect(w.calls().join("\n")).not.toContain(secret);
      expect(out).not.toContain(secret);
    }
  });

  test("a skipped secret is never asked again in one run", () => {
    // Yes to `browser setup`, no to the token: `browser token` must not run, and the
    // question must not come back later in the run.
    const w = world({ answers: ["y", "n", "n", "n"] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "· 7/8 the browser's token was skipped: run `cc-smart-dev-kit browser token` when you have it\n",
    );
    expect(w.callsOf("bun").filter((call) => call.includes("browser token"))).toEqual([]);
    expect(out.match(/Paste the extension's token/g)?.length).toBe(1);
    // The gateway and the Tavily key were skipped, so neither of their commands ran.
    expect(w.callsOf("bun").filter((call) => call.includes("gateway setup"))).toEqual([]);
    expect(w.callsOf("bun").filter((call) => call.includes("--tavily-key-stdin"))).toEqual([]);
  });

  test("a gateway with no key yet: setup runs with --no-backend-key", () => {
    const w = world({ answers: ["n", "y", "", "n"] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "✓ 7/8 the gateway is set up: turn it on with `cc-smart-dev-kit gateway on` when you want it\n",
    );
    expect(w.callsOf("bun")).toContain(`${w.cli} gateway setup --no-backend-key`);
    expect(w.callsOf("bun").filter((call) => call.includes("--backend-key-stdin"))).toEqual([]);
  });

  test("a step that fails stops the run, names the command, and exits 1", () => {
    // The plugin install fails: exit 1, and the exact command that retries it is printed.
    const w = world();
    w.file(
      join(w.home, "fake-bin/claude"),
      `#!/bin/sh\nprintf '%s\\n' "claude $*" >> ${JSON.stringify(join(w.home, "calls.log"))}\ncase "$*" in *"plugin install"*) exit 1 ;; esac\nexit 0\n`,
    );
    chmodSync(join(w.home, "fake-bin/claude"), 0o755);
    const { code, out } = w.run();
    expect(code).toBe(1);
    expect(out).toContain("✗ installing the plugin failed\n");
    expect(out).toContain(
      "  Retry just that step with:\n    claude plugin install cc-smart-dev-kit@cc-smart-dev-kit --scope user\n",
    );
    expect(out).toContain("  Then run this installer again: it goes on from there.\n");
  });
});

describe("install.sh and install.ps1: the minimum Bun stays equal to the plugin's", () => {
  // CI's setup-bun comment says a test keeps its number equal to MIN_BUN in
  // src/build-info/bun.ts; this is that test for the two installers. The same number sits
  // in four places (the plugin, package.json's engines.bun, CI, and these two scripts), and
  // the plugin's is the one home.
  test("both installers check the MIN_BUN of src/build-info/bun.ts", () => {
    expect(/^MIN_BUN="([^"]+)"/m.exec(readFileSync(INSTALL_SH, "utf8"))?.[1]).toBe(MIN_BUN);
    expect(/^\$MinBun = "([^"]+)"/m.exec(readFileSync(INSTALL_PS1, "utf8"))?.[1]).toBe(MIN_BUN);
  });
});
