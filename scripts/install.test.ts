/**
 * `install.sh` (the one-command installer) in a fake world: a temp HOME, and a PATH whose
 * first folder holds fakes for `claude`, `bun`, `git`, `gh`, `curl` and `uname`. The fakes
 * log every argument they are given and answer the way the real ones do — the fake `claude`
 * writes `known_marketplaces.json`, `installed_plugins.json` and `enabledPlugins` exactly as
 * Claude Code writes them (docs/claude-code-contract.md), the fake `bun` reads what the real
 * commands read from stdin, and the fake `doctor` fails while the browser's token is missing,
 * the way the real one does (a ✗, not an optional line).
 *
 * The world's terminal is `CC_SMART_DEV_KIT_INSTALL_TTY`: a file whose lines are the
 * answers, read in order. The installer is started with its stdin at /dev/null — a case
 * pipes the script itself in, the way `gh api … | bash -s -- <repo>` starts it, so a question
 * read from stdin would fail the test rather than pass it.
 *
 * No test reaches the network, a real Claude Code, or the host's HOME: the fakes answer
 * everything, and PATH is the fakes plus the few system tools a shell script needs.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { MIN_BUN } from "../src/build-info/bun";
import { tempDir } from "../src/testing/temp";

const REPO = "example-org/cc-smart-dev-kit";
const INSTALL_SH = join(import.meta.dir, "..", "install.sh");
const INSTALL_PS1 = join(import.meta.dir, "..", "install.ps1");
const SMOKE_PS1 = join(import.meta.dir, "install-windows-smoke.ps1");
const REAL_BUN = process.execPath;
const BASH: string = Bun.which("bash") ?? "";
if (BASH === "") throw new Error("install.test.ts needs bash");

/** The version the fake marketplace's copy of the plugin declares. */
const MARKETPLACE_VERSION = "0.4.2";
/** The browser's token, in the shape the Playwright extension makes: 43 URL-safe characters. */
const TOKEN = `${"A".repeat(41)}_-`;

interface WorldOptions {
  /** What the fake `bun --version` prints. A version older than MIN_BUN tests the upgrade. */
  bunVersion?: string;
  /** Leave `bun` off PATH, as a machine that has none. */
  noBun?: boolean;
  /** The fake `git` fails every call, as a machine whose git credentials are not set up. */
  gitFails?: boolean;
  /** The lines the terminal answers, in the order the installer asks. */
  answers?: string[];
  /** Leave `systemctl` off PATH, as a machine whose gateway cannot run (a test-only bin). */
  noSystemctl?: boolean;
  /** The plugin is installed before the run, at this version (a "0.4.0" tests the update). */
  installedVersion?: string;
  /** The plugin is installed before the run but turned off in the settings. */
  disabled?: boolean;
  /** The old `anymodel@anymodel` is still installed (migrate's last step asks about it). */
  oldPlugin?: boolean;
  /** The old `anymodel` marketplace is still added. */
  oldMarketplace?: boolean;
  /** A half-finished move left its record behind. */
  progressFile?: boolean;
  /** A router copy is on disk, as it is after an earlier `gateway setup`. */
  routerCopy?: boolean;
}

interface World {
  home: string;
  configDir: string;
  /** Every fake's call, one line each; a fake may add a line about what it read. */
  calls: () => string[];
  /** The lines of one fake's calls, in order, without the fake's own name. */
  callsOf: (name: string) => string[];
  run: (args?: string[], env?: Record<string, string>) => { code: number; out: string };
  /** The same, with the script itself piped in (the README's own way to start it). */
  runPiped: (args?: string[]) => { code: number; out: string };
  /** Puts a file in place, the way an earlier state of the machine would have it. */
  file: (path: string, text: string) => void;
  read: (path: string) => string;
  /** The plugin's folder, as `claude plugin install` leaves it. */
  pluginDir: string;
  /** The launcher `setup` writes: what every hint names once it is there. */
  launcher: string;
  /** The `bun --no-env-file …` form that runs the plugin's own CLI. */
  cli: string;
  /** Where the browser's token goes. */
  tokenFile: string;
}

/** The fake binaries, one shell script each. */
function fakeScripts(log: string): Record<string, string> {
  return {
    // `--version` answers this machine's Bun; `-e` (the installer's JSON reader) runs the
    // real bun, which reaches no network; `upgrade` records the version it moved to; the
    // plugin's own commands read their secret from stdin (and log only its shape); `doctor`
    // fails while the browser's token is missing, as the real one does.
    bun: `#!/bin/sh
log=${JSON.stringify(log)}
printf '%s\\n' "bun $*" >> "$log"
if [ "$1" = "--version" ]; then
  if [ -f "$FAKE_BUN_UPGRADED" ]; then cat "$FAKE_BUN_UPGRADED"; else printf '%s\\n' "$FAKE_BUN_VERSION"; fi
  exit 0
fi
if [ "$1" = "-e" ]; then exec ${JSON.stringify(REAL_BUN)} "$@"; fi
if [ "$1" = "upgrade" ]; then printf '%s\\n' "$FAKE_BUN_UPGRADE_TO" > "$FAKE_BUN_UPGRADED"; exit 0; fi
case "$*" in
*browser\\ token*)
  secret=""; IFS= read -r secret || secret=""
  printf '%s\\n' "stdin-\${#secret}-chars" >> "$log"
  # The real command writes the token file; the fake doctor below reads it.
  mkdir -p "$HOME/.config/cc-smart-dev-kit"
  printf '%s\\n' "$secret" > "$HOME/.config/cc-smart-dev-kit/playwright-extension.token"
  chmod 600 "$HOME/.config/cc-smart-dev-kit/playwright-extension.token"
  ;;
esac
case "$*" in
*--backend-key-stdin* | *--tavily-key-stdin*)
  secret="$(cat)"
  if [ -n "$secret" ]; then printf '%s\\n' "stdin-nonempty" >> "$log"; else printf '%s\\n' "stdin-empty" >> "$log"; fi
  ;;
esac
case "$*" in
*dist/cli.js\\ setup*)
  # The real setup writes the launcher; the machine then has a command to run. The fake one
  # does what the real launcher does — it runs the plugin's own CLI — so doctor's answer
  # comes from the fake doctor below.
  mkdir -p "$HOME/.local/bin"
  printf '#!/bin/sh\\nprintf "%%s\\\\n" "launcher $*" >> %s\\nexec %s --no-env-file --config=%s %s/dist/cli.js "$@"\\n' \
    "$log" "$FAKE_BUN_REAL" "$FAKE_PLUGIN_DIR/bunfig.toml" "$FAKE_PLUGIN_DIR" > "$HOME/.local/bin/cc-smart-dev-kit"
  chmod +x "$HOME/.local/bin/cc-smart-dev-kit"
  ;;
esac
case "$*" in
*dist/cli.js\\ doctor*)
  token="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/../.config/cc-smart-dev-kit/playwright-extension.token"
  token="$HOME/.config/cc-smart-dev-kit/playwright-extension.token"
  if [ -f "$token" ]; then
    printf '✓ the browser token is set (%s)\\n' "$token"
    exit 0
  fi
  printf '✗ the browser token is not set, so the browser cannot connect (no token file at %s): run: cc-smart-dev-kit browser setup, then cc-smart-dev-kit browser token\\n' "$token"
  exit 1
  ;;
esac
exit 0
`,
    // Claude Code's own commands. `marketplace add` clones the marketplace: the fake makes
    // the folder and writes the record keyed by the marketplace's OWN NAME (proved live:
    // the name, never the source, is what "already added" means). `plugin install` writes
    // the user-scope install record, the plugin folder the installer runs next, and the
    // `enabledPlugins` key Claude Code sets. `update`, `enable`, `uninstall` and
    // `marketplace remove` write the same records the real ones do.
    claude: `#!/bin/sh
log=${JSON.stringify(log)}
printf '%s\\n' "claude $*" >> "$log"
bun=${JSON.stringify(REAL_BUN)}
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
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d[process.argv[2]]={source:{source:"github",repo:process.argv[3]},installLocation:process.argv[4]};fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json" "$name" "$4" "$dir"
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "remove" ]; then
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}delete d[process.argv[2]];fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json" "$4"
fi
if [ "$1" = "plugin" ] && { [ "$2" = "install" ] || [ "$2" = "update" ]; }; then
  dir="$CLAUDE_CONFIG_DIR/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/${MARKETPLACE_VERSION}"
  mkdir -p "$dir/dist"
  printf 'await import("the plugin");\\n' > "$dir/dist/cli.js"
  printf '{}\\n' > "$dir/bunfig.toml"
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={version:2,plugins:{}};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d.plugins=d.plugins||{};d.plugins["cc-smart-dev-kit@cc-smart-dev-kit"]=[{scope:"user",installPath:process.argv[2],version:process.argv[3]}];fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json" "$dir" "${MARKETPLACE_VERSION}"
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d.enabledPlugins=d.enabledPlugins||{};d.enabledPlugins["cc-smart-dev-kit@cc-smart-dev-kit"]=true;fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/settings.json"
fi
if [ "$1" = "plugin" ] && [ "$2" = "enable" ]; then
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d.enabledPlugins=d.enabledPlugins||{};d.enabledPlugins["cc-smart-dev-kit@cc-smart-dev-kit"]=true;fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/settings.json"
fi
if [ "$1" = "plugin" ] && [ "$2" = "uninstall" ]; then
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={version:2,plugins:{}};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d.plugins=d.plugins||{};delete d.plugins[process.argv[2]];fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json" "$3"
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
    // `uname -s` decides whether the gateway's router can run here (systemd on Linux).
    uname: `#!/bin/sh
printf '%s\\n' "$FAKE_UNAME"
`,
    // Bun's own installer is a script piped into bash: it downloads, then writes the binary
    // into $BUN_INSTALL/bin. The fake does the second half, so the installer finds a bun
    // where Bun's installer puts one.
    curl: `#!/bin/sh
printf '%s\\n' "curl $*" >> ${JSON.stringify(log)}
case "$*" in
*bun.sh/install*)
  mkdir -p "\${BUN_INSTALL:-$HOME/.bun}/bin"
  cp "$FAKE_BUN_REAL" "\${BUN_INSTALL:-$HOME/.bun}/bin/bun"
  chmod +x "\${BUN_INSTALL:-$HOME/.bun}/bin/bun"
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
  // The fake `curl` copies THIS into $BUN_INSTALL/bin: a bun that answers like the fake one.
  const installable = join(home, "installable-bun");
  writeFileSync(installable, scripts.bun ?? "");
  chmodSync(installable, 0o755);

  // `noSystemctl`: a PATH of the same fakes plus the few tools the script and the fakes
  // need, and no systemctl among them (the machine's own /usr/bin has one).
  const toolsBin = join(home, "tools-bin");
  mkdirSync(toolsBin, { recursive: true });
  for (const tool of ["cat", "cp", "mkdir", "chmod", "grep", "rm", "ls"]) {
    const real = Bun.which(tool);
    if (real !== null) symlinkSync(real, join(toolsBin, tool));
  }
  writeFileSync(join(toolsBin, "uname"), "#!/bin/sh\nprintf '%s\\n' \"$FAKE_UNAME\"\n");
  chmodSync(join(toolsBin, "uname"), 0o755);

  // What the machine already has, before the run.
  if (options.installedVersion !== undefined) {
    const dir = join(
      configDir,
      "plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit",
      options.installedVersion,
    );
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist/cli.js"), 'await import("the plugin");\n');
    writeFileSync(join(dir, "bunfig.toml"), "{}\n");
    const plugins: Record<string, unknown> = {
      "cc-smart-dev-kit@cc-smart-dev-kit": [
        { scope: "user", installPath: dir, version: options.installedVersion },
      ],
    };
    if (options.oldPlugin === true) {
      plugins["anymodel@anymodel"] = [{ scope: "user", installPath: "/nowhere", version: "0.2.1" }];
    }
    writeFileSync(
      join(configDir, "plugins/installed_plugins.json"),
      `${JSON.stringify({ version: 2, plugins }, null, 2)}\n`,
    );
    writeFileSync(
      join(configDir, "settings.json"),
      `${JSON.stringify(
        { enabledPlugins: { "cc-smart-dev-kit@cc-smart-dev-kit": options.disabled !== true } },
        null,
        2,
      )}\n`,
    );
  }
  if (options.oldMarketplace === true) {
    mkdirSync(join(configDir, "plugins"), { recursive: true });
    writeFileSync(
      join(configDir, "plugins/known_marketplaces.json"),
      `${JSON.stringify(
        {
          anymodel: {
            source: { source: "github", repo: "example-org/anymodel" },
            installLocation: join(configDir, "plugins/marketplaces/anymodel"),
          },
        },
        null,
        2,
      )}\n`,
    );
  }
  if (options.progressFile === true) {
    mkdirSync(join(configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(
      join(configDir, "cc-smart-dev-kit/migrate-progress.json"),
      `${JSON.stringify({ done: ["folders"], version: 1 }, null, 2)}\n`,
    );
  }
  if (options.routerCopy === true) {
    const copy = join(home, ".local/share/cc-smart-dev-kit/router.js");
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, "// the router\n");
  }

  const answersFile = join(home, "answers");
  writeFileSync(answersFile, `${(options.answers ?? []).join("\n")}\n`);

  const pluginDir = join(
    configDir,
    "plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit",
    MARKETPLACE_VERSION,
  );
  const tokenFile = join(home, ".config/cc-smart-dev-kit/playwright-extension.token");
  const baseEnv: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    // The fakes first, then the few system tools a shell script needs (bash itself, cat,
    // mkdir, cp, grep) — or, for the no-systemctl case, the same tools without systemctl.
    PATH: options.noSystemctl === true ? `${fakeBin}:${toolsBin}` : `${fakeBin}:/usr/bin:/bin`,
    CC_SMART_DEV_KIT_INSTALL_TTY: answersFile,
    FAKE_BUN_VERSION: options.bunVersion ?? MIN_BUN,
    FAKE_BUN_UPGRADED: join(home, "bun-upgraded"),
    FAKE_BUN_UPGRADE_TO: MIN_BUN,
    FAKE_BUN_REAL: installable,
    FAKE_PLUGIN_DIR: pluginDir,
    FAKE_GIT_FAILS: options.gitFails === true ? "yes" : "no",
    FAKE_UNAME: "Linux",
  };

  const spawn = (args: string[], env: Record<string, string>, input?: string) => {
    const result = Bun.spawnSync([BASH, ...args], {
      cwd: home,
      env: { ...baseEnv, ...env },
      // Nothing the installer asks may come from stdin: /dev/null here, and the script
      // itself in `runPiped` (the way the README's line starts it).
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: result.exitCode,
      out: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  };

  return {
    home,
    configDir,
    pluginDir,
    launcher: join(home, ".local/bin/cc-smart-dev-kit"),
    tokenFile,
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
    run: (args = [REPO], env = {}) => spawn([INSTALL_SH, ...args], env),
    runPiped: (args = [REPO]) => spawn(["-s", "--", ...args], {}, readFileSync(INSTALL_SH, "utf8")),
    file: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    read: (path) => readFileSync(path, "utf8"),
  };
}

/** Every line the installer printed, in order, with the empty ones dropped. */
function lines(out: string): string[] {
  return out.split("\n").filter((line) => line !== "");
}

/** The answers that finish the browser (yes, paste the token, and the token itself). */
function browserAnswers(...rest: string[]): string[] {
  return ["y", "y", TOKEN, ...rest];
}

describe("install.sh: a machine, step by step", () => {
  test("a fresh machine: the marketplaces, the plugin, migrate, setup and doctor", () => {
    const w = world({ answers: browserAnswers("n", "n") });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(lines(out)).toEqual([
      "✓ 1/8 not inside a Claude Code session",
      `✓ 2/8 claude found: ${w.home}/fake-bin/claude, and git can read ${REPO}`,
      `✓ 3/8 Bun ${MIN_BUN} is new enough (the plugin needs ${MIN_BUN} or newer)`,
      `✓ 4/8 marketplaces added: ${REPO}, thedotmack/claude-mem, anthropics/claude-plugins-official`,
      `✓ 5/8 the plugin is installed (${MARKETPLACE_VERSION}): ${w.pluginDir}`,
      // The plugin install turns it on (the fake writes the settings key the real one does).
      "✓ 6/8 migrate finished (nothing to move on a machine without the old anymodel names)",
      "✓ 6/8 setup finished",
      "7/8 Set up the browser (Playwright on your own Chrome)? [y/N] ",
      "7/8 Paste the extension's token now (the extension's status page shows it)? [y/N] ",
      "✓ 7/8 the browser's token is saved",
      "7/8 Set up the AI gateway now (affordable models for the haiku and sonnet subagents)? [y/N] ",
      "· 7/8 the gateway was skipped: README § The AI gateway has its steps",
      "7/8 Add your Tavily key now (the tavily-websearch MCP server)? [y/N] ",
      "· 7/8 the Tavily key was skipped: README § MCP servers says where it goes",
      `✓ the browser token is set (${w.tokenFile})`,
      "✓ 8/8 doctor: every check passed",
      "Restart every Claude Code session: they load the plugin when they start.",
      "`cc-smart-dev-kit portal` opens the portal in your own terminal (it prints a link with a one-time token).",
      "What is left:",
      `  - the gateway: ${w.launcher} gateway setup --backend-key-stdin omniroute, then ${w.launcher} gateway on`,
      `  - the Tavily key: README § MCP servers says where it goes, then ${w.launcher} setup`,
    ]);
    // The three marketplaces, in the README's order, then the install (whose line names the
    // marketplace), then migrate before setup, both through the plugin's own bundle.
    expect(w.callsOf("claude")).toEqual([
      `plugin marketplace add ${REPO}`,
      "plugin marketplace add thedotmack/claude-mem",
      "plugin marketplace add anthropics/claude-plugins-official",
      "plugin install cc-smart-dev-kit@cc-smart-dev-kit --scope user",
    ]);
    expect(w.callsOf("bun")).toContain(`${w.cli} migrate`);
    expect(w.callsOf("bun")).toContain(`${w.cli} setup`);
    // The token reached `browser token` on stdin; the launcher setup wrote runs doctor.
    expect(w.calls()).toContain("stdin-43-chars");
    expect(w.callsOf("launcher")).toEqual(["doctor"]);
    // git was asked before anything was installed (SSH first, then HTTPS).
    expect(w.callsOf("git")).toEqual([`ls-remote git@github.com:${REPO}.git`]);
  });

  test("the browser skipped: doctor's ✗ is what is left, and the exit code is 3", () => {
    const w = world({ answers: ["n", "n", "n"] });
    const { code, out } = w.run();
    expect(code).toBe(3);
    expect(out).toContain("✗ 8/8 doctor found what is left (its ✗ lines are in the list below)\n");
    expect(out).toContain(
      `✗ the browser token is not set, so the browser cannot connect (no token file at ${w.tokenFile}): run: cc-smart-dev-kit browser setup, then cc-smart-dev-kit browser token\n`,
    );
    // The list: this run's own skips, each with the line that finishes it, then doctor's ✗.
    expect(out).toContain("What is left:\n");
    expect(out).toContain(
      `  - the browser: ${w.launcher} browser setup, then ${w.launcher} browser token\n`,
    );
    expect(out).toContain(
      `  - the gateway: ${w.launcher} gateway setup --backend-key-stdin omniroute, then ${w.launcher} gateway on\n`,
    );
    expect(out).toContain(
      `  - the Tavily key: README § MCP servers says where it goes, then ${w.launcher} setup\n`,
    );
  });

  test("a machine that still has the old anymodel names: migrate, then setup", () => {
    const w = world({ answers: browserAnswers("n", "n"), oldMarketplace: true });
    w.file(join(w.home, ".config/anymodel/gateway.json"), "{}\n");
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "✓ 6/8 migrate finished (nothing to move on a machine without the old anymodel names)\n",
    );
    expect(out).toContain("✓ 6/8 setup finished\n");
    const calls = w.callsOf("bun").join("\n");
    expect(calls).toContain(`${w.cli} migrate`);
    expect(calls).toContain(`${w.cli} setup`);
    // migrate is always first: the move rewrites what setup then reads.
    expect(calls.indexOf(`${w.cli} migrate`)).toBeLessThan(calls.indexOf(`${w.cli} setup\n`));
  });

  test("a half-moved machine: its progress file makes migrate run again, then setup", () => {
    const w = world({ answers: browserAnswers("n", "n"), progressFile: true });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("✓ 6/8 migrate finished");
    expect(out).toContain("✓ 6/8 setup finished");
    expect(w.callsOf("bun")).toContain(`${w.cli} migrate`);
  });

  test("the old plugin still installed: asked about, removed on yes", () => {
    const w = world({
      answers: ["y", ...browserAnswers("n", "n")],
      installedVersion: MARKETPLACE_VERSION,
      oldPlugin: true,
      oldMarketplace: true,
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "6/8 The old anymodel plugin is still installed. Remove it, and the old anymodel marketplace with it? [y/N] \n",
    );
    expect(out).toContain("✓ 6/8 the old anymodel plugin and marketplace are removed\n");
    expect(w.callsOf("claude")).toContain("plugin uninstall anymodel@anymodel --scope user");
    expect(w.callsOf("claude")).toContain("plugin marketplace remove anymodel");
  });

  test("the old plugin left in place: one line, and it is in what is left", () => {
    const w = world({
      answers: ["n", ...browserAnswers("n", "n")],
      installedVersion: MARKETPLACE_VERSION,
      oldPlugin: true,
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "· 6/8 the old anymodel plugin was left in place: run `claude plugin uninstall anymodel@anymodel`, then `claude plugin marketplace remove anymodel`\n",
    );
    expect(out).toContain(
      "  - the old anymodel plugin: claude plugin uninstall anymodel@anymodel && claude plugin marketplace remove anymodel\n",
    );
    expect(w.callsOf("claude").filter((call) => call.includes("uninstall"))).toEqual([]);
  });

  test("the plugin installed at an older version: update, not install", () => {
    const w = world({ answers: browserAnswers("n", "n"), installedVersion: "0.4.0" });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(`✓ 5/8 the plugin is updated (${MARKETPLACE_VERSION})\n`);
    expect(w.callsOf("claude")).toContain(
      "plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user",
    );
    expect(w.callsOf("claude").filter((call) => call.includes("plugin install"))).toEqual([]);
  });

  test("the plugin installed but turned off: enabled", () => {
    const w = world({
      answers: browserAnswers("n", "n"),
      installedVersion: MARKETPLACE_VERSION,
      disabled: true,
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("✓ 5/8 the plugin is enabled\n");
    expect(w.callsOf("claude")).toContain(
      "plugin enable cc-smart-dev-kit@cc-smart-dev-kit --scope user",
    );
  });

  test("a second run does only what is missing", () => {
    const w = world({ answers: browserAnswers("n", "n") });
    expect(w.run().code).toBe(0);
    const afterFirst = w.calls().length;
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("✓ 4/8 all three marketplaces are already added\n");
    expect(out).toContain(
      `✓ 5/8 the plugin is installed, at the marketplace's version (${MARKETPLACE_VERSION})\n`,
    );
    // The second run adds no marketplace and reinstalls nothing — but still runs migrate and
    // setup (both refresh what they own) and doctor.
    const second = w.calls().slice(afterFirst);
    expect(second.filter((call) => call.includes("marketplace add"))).toEqual([]);
    expect(second.filter((call) => call.includes("plugin install"))).toEqual([]);
    expect(second.filter((call) => call.includes("plugin update"))).toEqual([]);
    expect(second).toContain(`bun ${w.cli} migrate`);
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

  test("no terminal to ask on: refused, exit 2, and the README's own line is named", () => {
    const w = world({ answers: ["n"] });
    const { code, out } = w.run([REPO], { CC_SMART_DEV_KIT_INSTALL_TTY: join(w.home, "nothing") });
    expect(code).toBe(2);
    expect(out).toContain("✗ no terminal to ask on (");
    expect(out).toContain(
      `    gh api repos/${REPO}/contents/install.sh -H "Accept: application/vnd.github.raw" | bash -s -- ${REPO}\n`,
    );
    expect(w.callsOf("claude")).toEqual([]);
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
    const w = world({ bunVersion: "1.2.0", answers: ["y", ...browserAnswers("n", "n")] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(`✓ 3/8 Bun upgraded: ${MIN_BUN}\n`);
    expect(w.callsOf("bun")).toContain("upgrade");
  });

  test("no Bun at all, and the person says yes: Bun's own installer runs, under BUN_INSTALL", () => {
    const w = world({ noBun: true, answers: ["y", ...browserAnswers("n", "n")] });
    const { code, out } = w.run([REPO], { BUN_INSTALL: join(w.home, "bun-here") });
    expect(code).toBe(0);
    expect(out).toContain(`✓ 3/8 Bun installed: ${MIN_BUN}\n`);
    expect(w.callsOf("curl")).toEqual(["-fsSL https://bun.sh/install"]);
    // It is used from where Bun's installer puts it (BUN_INSTALL), not from PATH.
    expect(existsSync(join(w.home, "bun-here/bin/bun"))).toBe(true);
  });

  test("no systemd: the gateway question is skipped, with the reason", () => {
    const w = world({ answers: browserAnswers("n", "n"), noSystemctl: true });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "· 7/8 the gateway was skipped: its router runs under systemd on Linux, and this machine has no systemd\n",
    );
    expect(out).not.toContain("Set up the AI gateway now");
    expect(w.callsOf("bun").filter((call) => call.includes("gateway"))).toEqual([]);
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
      "usage: bash install.sh <owner>/<repo> [--dry-run]   (or set CC_SMART_DEV_KIT_REPO=<owner>/<repo>)\n",
    );
    expect(w.calls()).toEqual([]);
  });

  test("CC_SMART_DEV_KIT_REPO is read when there is no argument", () => {
    const w = world({ answers: browserAnswers("n", "n") });
    const { code, out } = w.run([], { CC_SMART_DEV_KIT_REPO: REPO });
    expect(code).toBe(0);
    expect(out).toContain(
      `✓ 2/8 claude found: ${w.home}/fake-bin/claude, and git can read ${REPO}\n`,
    );
  });

  test("piped into bash -s -- (the README's way): the questions still read the terminal", () => {
    const w = world({ answers: browserAnswers("n", "n") });
    const { code, out } = w.runPiped();
    expect(code).toBe(0);
    expect(out).toContain("✓ 1/8 not inside a Claude Code session\n");
    expect(out).toContain("✓ 7/8 the browser's token is saved\n");
    expect(w.calls()).toContain("stdin-43-chars");
  });

  test("half the script: a syntax error, and nothing on the machine is touched", () => {
    const w = world({ answers: browserAnswers("n", "n") });
    // The first half of the file, as a download that stopped would leave it.
    const text = readFileSync(INSTALL_SH, "utf8");
    const half = join(w.home, "half-install.sh");
    writeFileSync(half, text.slice(0, Math.floor(text.length / 2)));
    const result = Bun.spawnSync([BASH, half, REPO], {
      cwd: w.home,
      env: {
        HOME: w.home,
        CLAUDE_CONFIG_DIR: w.configDir,
        PATH: `${w.home}/fake-bin:/usr/bin:/bin`,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout.toString()}${result.stderr.toString()}`).toContain("syntax error");
    expect(w.calls()).toEqual([]);
    expect(existsSync(join(w.configDir, "plugins"))).toBe(false);
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
    // migrate or setup, no doctor — and no record file appeared.
    expect(w.callsOf("claude")).toEqual([]);
    expect(w.callsOf("git")).toEqual([]);
    expect(w.callsOf("curl")).toEqual([]);
    expect(w.calls().filter((call) => call.includes("dist/cli.js"))).toEqual([]);
    expect(existsSync(join(w.configDir, "plugins/known_marketplaces.json"))).toBe(false);
    expect(existsSync(join(w.configDir, "plugins/installed_plugins.json"))).toBe(false);
  });

  test("--dry-run with no Bun says it cannot read what is already installed", () => {
    const w = world({ noBun: true });
    const { code, out } = w.run(["--dry-run", REPO]);
    expect(code).toBe(0);
    expect(out).toContain(
      `· 3/8 Bun is not installed: the plan asks to install it (the plugin needs ${MIN_BUN} or newer), and without Bun it cannot read what is already installed\n`,
    );
  });
});

describe("install.sh: what only the person has", () => {
  const GATEWAY_KEY = "omniroute-key-abc123";
  const TAVILY_KEY = "tvly-key-abc123";

  test("the three secrets reach the plugin's own commands on stdin, never in an argument", () => {
    const w = world({ answers: ["y", "y", TOKEN, "y", GATEWAY_KEY, "y", TAVILY_KEY] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("✓ 7/8 the browser's token is saved\n");
    expect(out).toContain(
      "✓ 7/8 the gateway is set up: turn it on with `" +
        w.launcher +
        " gateway on` when you want it\n",
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

  test("a router already installed: the restart is asked about, and --yes carries the yes", () => {
    const w = world({
      answers: browserAnswers("y", "y", GATEWAY_KEY, "n"),
      routerCopy: true,
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "7/8 A router is already installed here: setup restarts it, and running Claude Code sessions fail until you restart them. Go on? [y/N] \n",
    );
    expect(w.callsOf("bun")).toContain(
      `${w.cli} gateway setup --backend-key-stdin omniroute --yes`,
    );
    expect(w.calls().filter((line) => line === "stdin-nonempty")).toHaveLength(1);
  });

  test("a router already installed, and the person says no: the gateway is left alone", () => {
    const w = world({ answers: browserAnswers("y", "n", "n"), routerCopy: true });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      `· 7/8 the gateway was left as it is: run \`${w.launcher} gateway setup --yes\` when you are ready\n`,
    );
    expect(out).toContain(
      `  - the gateway (its router was not restarted): ${w.launcher} gateway setup --yes\n`,
    );
    expect(w.callsOf("bun").filter((call) => call.includes("gateway setup"))).toEqual([]);
    expect(out).not.toContain("Paste the OmniRoute API key");
  });

  test("a skipped secret is never asked again in one run", () => {
    // Yes to `browser setup`, no to the token: `browser token` must not run, and the
    // question must not come back later in the run.
    const w = world({ answers: ["y", "n", "n", "n"] });
    const { code, out } = w.run();
    // The token was skipped, so doctor shows its ✗ and the run ends 3 (installed, with
    // items left) — the skip line is what the person acts on.
    expect(code).toBe(3);
    expect(out).toContain(
      `· 7/8 the browser's token was skipped: run \`${w.launcher} browser token\` when you have it\n`,
    );
    expect(out).toContain(`  - the browser's token: ${w.launcher} browser token\n`);
    expect(w.callsOf("bun").filter((call) => call.includes("browser token"))).toEqual([]);
    expect(out.match(/Paste the extension's token/g)?.length).toBe(1);
    // The gateway and the Tavily key were skipped, so neither of their commands ran.
    expect(w.callsOf("bun").filter((call) => call.includes("gateway setup"))).toEqual([]);
    expect(w.callsOf("bun").filter((call) => call.includes("--tavily-key-stdin"))).toEqual([]);
  });

  test("a gateway with no key yet: setup runs with --no-backend-key", () => {
    const w = world({ answers: browserAnswers("y", "", "n") });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      `✓ 7/8 the gateway is set up: turn it on with \`${w.launcher} gateway on\` when you want it\n`,
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

describe("install.sh and install.ps1: the shared rules", () => {
  // CI's setup-bun comment says a test keeps its number equal to MIN_BUN in
  // src/build-info/bun.ts; this is that test for the two installers. The same number sits
  // in four places (the plugin, package.json's engines.bun, CI, and these two scripts), and
  // the plugin's is the one home.
  test("both installers check the MIN_BUN of src/build-info/bun.ts", () => {
    expect(/^MIN_BUN="([^"]+)"/m.exec(readFileSync(INSTALL_SH, "utf8"))?.[1]).toBe(MIN_BUN);
    expect(/^\$MinBun = "([^"]+)"/m.exec(readFileSync(INSTALL_PS1, "utf8"))?.[1]).toBe(MIN_BUN);
  });

  test("the PowerShell files are pure ASCII, so any Windows code page reads them", () => {
    for (const file of [INSTALL_PS1, SMOKE_PS1]) {
      const text = readFileSync(file, "utf8");
      const nonAscii = [...text].filter((char) => (char.codePointAt(0) ?? 0) > 127);
      expect(nonAscii).toEqual([]);
      // The marks install.sh uses would be mojibake in a Windows console.
      expect(/[✓✗·…—]/.test(text)).toBe(false);
    }
  });

  // Read as text on purpose: PowerShell cannot run on Linux, and this is a parse error the
  // Windows job hit (`"... $Repo: ..."` reads as a drive-qualified variable). A variable
  // followed by `:` must be written `${Name}:`, unless the colon is a scope (`$env:`, …).
  test("no PowerShell variable runs into a colon (`$Repo:` is a parse error; braces fix it)", () => {
    const scopes = /^(env|script|global|local|private|using|function|variable)$/i;
    for (const file of [INSTALL_PS1, SMOKE_PS1]) {
      const bad = readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          [...line.matchAll(/(?<!\$\{)\$([A-Za-z_][A-Za-z0-9_]*):(?!:)/g)]
            .filter((match) => !scopes.test(match[1] ?? ""))
            .map((match) => `${file.split("/").pop()}:${index + 1}: ${match[0]}`),
        );
      expect(bad).toEqual([]);
    }
  });
});
