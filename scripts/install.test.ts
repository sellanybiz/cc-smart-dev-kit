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
import { describe, expect, setDefaultTimeout, test } from "bun:test";
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
import { REPO_ACCESS_FIX_LINES, SSH_REFUSED_WORDS } from "../src/setup/marketplace-access";
import { tempDir } from "../src/testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../src/testing/timeouts";
import {
  answer as bun,
  doctorTokenMissingLine as bunDoctorLine,
  tokenFile,
} from "./install-windows-fakes/bun";
import { answer as claude } from "./install-windows-fakes/claude";
import { answer as gh } from "./install-windows-fakes/gh";
import { answer as git } from "./install-windows-fakes/git";

// This file starts the installer as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const REPO = "example-org/cc-smart-dev-kit";
const INSTALL_SH = join(import.meta.dir, "..", "install.sh");
const INSTALL_PS1 = join(import.meta.dir, "..", "install.ps1");
const SMOKE_PS1 = join(import.meta.dir, "install-windows-smoke.ps1");
const REAL_BUN = process.execPath;
const BASH: string = Bun.which("bash") ?? "";
if (BASH === "") throw new Error("install.test.ts needs bash");

/**
 * The version the two installers ship with: `version` in plugin/.claude-plugin/plugin.json,
 * where the plugin's one home for it is (`.claude/rules/bundles-and-releases.md`). Each script
 * carries its own copy of the number (a shell script cannot read the manifest), and the test at
 * the end of this file keeps the two equal, the way the MIN_BUN test does.
 */
const INSTALLER_VERSION = (
  JSON.parse(
    readFileSync(join(import.meta.dir, "..", "plugin", ".claude-plugin", "plugin.json"), "utf8"),
  ) as { version: string }
).version;
/**
 * The version the fake marketplace's copy of the plugin declares, and the version the fake
 * `claude plugin …` leaves in Claude Code's records: the repository the installer came from is
 * this one, so the copy is on the same version the plugin's manifest carries.
 */
const MARKETPLACE_VERSION = INSTALLER_VERSION;
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
  /**
   * The version Claude Code's local CLONE of the marketplace declares when it is added: an
   * older one is the stale clone the first real run compared against (0.4.1 vs 0.4.1).
   */
  cloneVersion?: string;
  /** What the plugin's own CLI answers for `version`. Default: this installer's own version. */
  cliVersion?: string;
  /**
   * What `gateway check` answers: 0 the gateway works, 1 no key yet (OmniRoute answers),
   * 3 could not be judged, 4 the key is refused. Default 0.
   */
  gatewayCheck?: number;
  /** The line the fake `gateway check` prints. */
  gatewayCheckLine?: string;
  /** The gateway refuses every key given to `--backend-key-stdin`, as a wrong one. */
  gatewayKeyRefused?: boolean;
  /** OmniRoute refuses the dashboard password `--omniroute-password-stdin` carries. */
  omniRoutePasswordRefused?: boolean;
  /** A `gateway.json` is already on disk, holding the router's key. */
  gatewayConfig?: boolean;
  /** `TAVILY_API_KEY` is in this shell's environment. */
  tavilyInEnv?: string;
  /** The Tavily key file setup reads is already there. */
  tavilyKeyFile?: boolean;
  /** The settings already hold `env.TAVILY_API_KEY`. */
  tavilyInSettings?: boolean;
  /** The plugin's MCP servers that are registered by something else on this machine. */
  mcpForeign?: { name: string; runsWhat: string }[];
  /** The same, for the SECOND `mcp status` call (after the Tavily step). */
  mcpForeignAgain?: { name: string; runsWhat: string }[];
  /** User-scope MCP servers already in Claude Code's own config (`<configDir>/.claude.json`). */
  userServers?: Record<string, unknown>;
  /** The GitHub login the fake `gh api user --jq .login` answers. */
  ghLogin?: string;
  /** The account cannot see the repository: `gh repo view` answers "Could not resolve …". */
  ghRepoViewFails?: boolean;
  /** Nobody is logged in to gh: both of its questions fail with gh's own "gh auth login" line. */
  ghLoggedOut?: boolean;
  /** Leave `gh` off PATH, as a machine that has none. */
  noGh?: boolean;
  /**
   * No GitHub SSH key: `claude plugin marketplace add <owner>/<repo>` is refused the way ssh
   * refuses it, and the `https://github.com/<owner>/<repo>.git` form is added fine.
   */
  claudeSshRefused?: boolean;
  /** The repository cannot be read at all: both forms of the add fail with "Repository not found". */
  claudeAddNotFound?: boolean;
}

/** One `mcp status --json` answer, as the real command writes it. */
function mcpStatusJson(foreign: { name: string; runsWhat: string }[], configDir: string): string {
  return JSON.stringify({
    servers: foreign.map((one) => ({ name: one.name, runsWhat: one.runsWhat, state: "foreign" })),
    userConfigFile: join(configDir, ".claude.json"),
  });
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
    // plugin's own commands read their secret from stdin (and log only its shape); `version`
    // answers the CLI's own version (what the installer checks after an install or update);
    // `gateway check` answers this world's exit code and line; `doctor` fails while the
    // browser's token is missing, as the real one does.
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
*dist/cli.js\\ version*)
  # The plugin's own CLI, asked its version: the installer refuses to go on when it is older
  # than the release this installer ships with.
  printf 'cc-smart-dev-kit %s\\n' "$FAKE_CLI_VERSION"
  exit 0
  ;;
esac
case "$*" in
*dist/cli.js\\ gateway\\ check*)
  # The read-only question the installer asks before it asks a person for a key. The line and
  # the exit code are this world's (0 works, 1 no key yet, 3 could not be judged, 4 refused).
  printf '%s\\n' "$FAKE_GATEWAY_CHECK_LINE"
  exit "$FAKE_GATEWAY_CHECK_CODE"
  ;;
esac
case "$*" in
*dist/cli.js\\ mcp\\ status*)
  # Which of the plugin's MCP servers are registered by something else, as JSON: this world's.
  # The SECOND call answers FAKE_MCP_STATUS_AGAIN: a server that only appears once a Tavily
  # key exists is what the installer's second pass is for.
  count=""
  [ -f "$FAKE_MCP_COUNT" ] && count="$(cat "$FAKE_MCP_COUNT")"
  printf '%s' "$((count + 1))" > "$FAKE_MCP_COUNT" 2>/dev/null || true
  if [ -n "$count" ] && [ -n "$FAKE_MCP_STATUS_AGAIN" ]; then
    printf '%s\\n' "$FAKE_MCP_STATUS_AGAIN"
  else
    printf '%s\\n' "$FAKE_MCP_STATUS"
  fi
  exit 0
  ;;
esac
case "$*" in
*browser\\ token*)
  secret=""; IFS= read -r secret || secret=""
  # The real browser-token command cleans the line it read before it judges its shape
  # (src/cli/secret-line.ts): with some terminals a paste arrives wrapped in the bracketed-paste
  # markers, and the markers are not part of the token. This fake stands for that command, so it
  # cleans the same way — the test then proves the installer handed the paste over as it arrived,
  # with nothing of its own added.
  secret="$(printf '%s' "$secret" | "$FAKE_BUN_REAL" -e 'let t="";for await (const c of Bun.stdin.stream()) t+=new TextDecoder().decode(c);process.stdout.write(t.replaceAll("\\u001b[200~","").replaceAll("\\u001b[201~","").replace(/[\\p{Cc}\\p{Cf}]/gu,"").trim())')"
  printf '%s\\n' "stdin-\${#secret}-chars" >> "$log"
  # The real command writes the token file; the fake doctor below reads it.
  mkdir -p "$HOME/.config/cc-smart-dev-kit"
  printf '%s\\n' "$secret" > "$HOME/.config/cc-smart-dev-kit/playwright-extension.token"
  chmod 600 "$HOME/.config/cc-smart-dev-kit/playwright-extension.token"
  ;;
esac
case "$*" in
*--backend-key-stdin* | *--tavily-key-stdin* | *--omniroute-password-stdin*)
  secret="$(cat)"
  if [ -n "$secret" ]; then printf '%s\\n' "stdin-nonempty" >> "$log"; else printf '%s\\n' "stdin-empty" >> "$log"; fi
  # The number of characters that arrived, and never the value: a test proves the installer's
  # cleaning with it (a paste wrapped in the bracketed-paste markers must reach the command as
  # the key itself, not 12 characters longer).
  printf 'key-%s-chars\\n' "\${#secret}" >> "$log"
  # A key the backend refuses: the real command saves NOTHING and keeps the key in the file.
  # The refusal line lands on stderr, as the real one's does.
  case "$*" in
  *--backend-key-stdin*)
    if [ "$FAKE_GATEWAY_KEY_REFUSED" = "yes" ]; then
      printf 'cc-smart-dev-kit: omniroute answered HTTP 401 for this key: it does not accept it.\\nNothing was saved, and the key in the config is kept as it was.\\n' >&2
      exit 1
    fi
    ;;
  *--omniroute-password-stdin*)
    if [ "$FAKE_OMNIROUTE_PASSWORD_REFUSED" = "yes" ]; then
      printf 'cc-smart-dev-kit: OmniRoute rejected that dashboard password. Nothing was saved, and the key in the config is kept as it was.\\n' >&2
      exit 1
    fi
    printf 'made the key "cc-smart-dev-kit-router-test" in OmniRoute (••••cdef)\\n'
    ;;
  esac
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
    //
    // The repository's own source is the one that can be refused, the way a machine's ssh
    // refusal and a repository the account cannot see were (live, 2026-10-17): the plain
    // `owner/repo` form is added over ssh and FAILS, and the `https://…` form — the one the
    // installer falls back to — is added fine. `FAKE_CLAUDE_ADD_NOT_FOUND` refuses both.
    claude: `#!/bin/sh
log=${JSON.stringify(log)}
printf '%s\\n' "claude $*" >> "$log"
bun=${JSON.stringify(REAL_BUN)}
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "add" ]; then
  case "$4" in
  *://*) ;;
  *cc-smart-dev-kit*)
    if [ "$FAKE_CLAUDE_ADD_NOT_FOUND" = "yes" ]; then
      printf 'ERROR: Repository not found.\\nfatal: Could not read from remote repository.\\n' >&2
      exit 1
    fi
    if [ "$FAKE_CLAUDE_SSH_REFUSED" = "yes" ]; then
      printf 'git@github.com: Permission denied (publickey).\\nfatal: Could not read from remote repository.\\n\\nPlease make sure you have the correct access rights\\nand the repository exists.\\n' >&2
      exit 1
    fi
    ;;
  esac
  name="cc-smart-dev-kit"
  case "$4" in
  *claude-mem) name=thedotmack ;;
  *claude-plugins-official) name=claude-plugins-official ;;
  esac
  dir="$CLAUDE_CONFIG_DIR/plugins/marketplaces/$name"
  mkdir -p "$dir/plugin/.claude-plugin"
  case "$4" in
  *cc-smart-dev-kit)
    # The version the clone is on WHEN IT IS ADDED: this world may add it hours before the
    # installer runs, at an older version (the first real run's own trap).
    printf '{"name":"cc-smart-dev-kit","version":"%s"}\\n' "$FAKE_CLONE_VERSION" > "$dir/plugin/.claude-plugin/plugin.json"
    ;;
  esac
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d[process.argv[2]]={source:{source:"github",repo:process.argv[3]},installLocation:process.argv[4]};fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json" "$name" "$4" "$dir"
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "remove" ]; then
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}delete d[process.argv[2]];fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json" "$4"
fi
if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ "$3" = "update" ]; then
  # A refresh brings the repository's newest commits into Claude Code's clone, so the copy's
  # manifest then declares the version this world's repository is on. A clone left stale is
  # exactly what made the first real run compare two 0.4.1s and update nothing (2026-10-17).
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}const l=(d[process.argv[2]]||{}).installLocation;if(l)fs.writeFileSync(l+"/plugin/.claude-plugin/plugin.json",JSON.stringify({name:"cc-smart-dev-kit",version:process.argv[3]}))' \
    "$CLAUDE_CONFIG_DIR/plugins/known_marketplaces.json" "$4" "${MARKETPLACE_VERSION}"
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
if [ "$1" = "mcp" ] && [ "$2" = "remove" ] && [ -f "$CLAUDE_CONFIG_DIR/.claude.json" ]; then
  # Claude Code's own removal: the server leaves the user config, so a test sees what the
  # installer took away.
  "$bun" -e 'const fs=require("fs");const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));if(d.mcpServers)delete d.mcpServers[process.argv[2]];fs.writeFileSync(p,JSON.stringify(d,null,2))' \
    "$CLAUDE_CONFIG_DIR/.claude.json" "$3"
fi
exit 0
`,
    git: `#!/bin/sh
printf '%s\\n' "git $*" >> ${JSON.stringify(log)}
if [ "$FAKE_GIT_FAILS" = "yes" ]; then exit 128; fi
exit 0
`,
    // The two questions the installer asks the GitHub CLI: whether the account this machine
    // is logged in with can see the repository (`repo view`, which fails the way gh does when
    // it cannot — "Could not resolve to a Repository …"), and its login (`api user`). Every
    // other call succeeds, as before. With nobody logged in BOTH questions fail with gh's own
    // line, as the real gh does: the installer must skip the check and print none of it.
    gh: `#!/bin/sh
printf '%s\\n' "gh $*" >> ${JSON.stringify(log)}
if [ "$FAKE_GH_LOGGED_OUT" = "yes" ]; then
  printf 'To get started with GitHub CLI, please run: gh auth login\\n' >&2
  exit 1
fi
case "$*" in
"repo view "*)
  if [ "$FAKE_GH_VIEW_FAILS" = "yes" ]; then
    printf "Could not resolve to a Repository with the name '%s'.\\n" "$3" >&2
    exit 1
  fi
  printf '{"name":"cc-smart-dev-kit"}\\n'
  ;;
"api user --jq .login")
  printf '%s\\n' "$FAKE_GH_LOGIN"
  ;;
esac
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
    if (name === "gh" && options.noGh === true) continue;
    writeFileSync(join(fakeBin, name), body);
    chmodSync(join(fakeBin, name), 0o755);
  }
  // The fake `curl` copies THIS into $BUN_INSTALL/bin: a bun that answers like the fake one.
  const installable = join(home, "installable-bun");
  writeFileSync(installable, scripts.bun ?? "");
  chmodSync(installable, 0o755);

  // `noSystemctl` and `noGh`: a PATH of the same fakes plus the few tools the script and the
  // fakes need, and no systemctl and no gh among them (the machine's own /usr/bin has both).
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
  if (options.userServers !== undefined) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, ".claude.json"),
      `${JSON.stringify({ mcpServers: options.userServers }, null, 2)}\n`,
    );
  }
  if (options.routerCopy === true) {
    const copy = join(home, ".local/share/cc-smart-dev-kit/router.js");
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, "// the router\n");
  }
  if (options.gatewayConfig === true) {
    const config = join(home, ".config/cc-smart-dev-kit/gateway.json");
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(
      config,
      `${JSON.stringify(
        {
          backends: {
            omniroute: { apiKey: "the-router-key", baseUrl: "http://127.0.0.1:20128" },
          },
          port: 20100,
          slots: { "cc-smart-dev-kit-worker": ["omniroute:m1"] },
          version: 1,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }
  if (options.tavilyKeyFile === true) {
    const file = join(configDir, "cc-smart-dev-kit/tavily.key");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "tvly-already-there\n", { mode: 0o600 });
  }
  if (options.tavilyInSettings === true) {
    const file = join(configDir, "settings.json");
    const settings: Record<string, unknown> = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
      : {};
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify(
        { ...settings, env: { ...(settings.env as object), TAVILY_API_KEY: "tvly-in-settings" } },
        null,
        2,
      )}\n`,
    );
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
    // mkdir, cp, grep) — or, for a world without systemctl and/or without gh, the same tools
    // with neither of the two.
    PATH:
      options.noSystemctl === true || options.noGh === true
        ? `${fakeBin}:${toolsBin}`
        : `${fakeBin}:/usr/bin:/bin`,
    CC_SMART_DEV_KIT_INSTALL_TTY: answersFile,
    FAKE_BUN_VERSION: options.bunVersion ?? MIN_BUN,
    FAKE_BUN_UPGRADED: join(home, "bun-upgraded"),
    FAKE_BUN_UPGRADE_TO: MIN_BUN,
    FAKE_BUN_REAL: installable,
    FAKE_PLUGIN_DIR: pluginDir,
    FAKE_GIT_FAILS: options.gitFails === true ? "yes" : "no",
    FAKE_UNAME: "Linux",
    // The marketplace's clone when it is added, the CLI's own version, and what the gateway
    // check answers (`gatewayCheckLine` is the real command's own kind of line).
    FAKE_CLONE_VERSION: options.cloneVersion ?? MARKETPLACE_VERSION,
    FAKE_CLI_VERSION: options.cliVersion ?? INSTALLER_VERSION,
    FAKE_GATEWAY_CHECK_CODE: String(options.gatewayCheck ?? 0),
    FAKE_GATEWAY_CHECK_LINE:
      options.gatewayCheckLine ??
      (options.gatewayCheck === 3
        ? "· the gateway could not be checked: OmniRoute does not answer at http://127.0.0.1:20128"
        : options.gatewayCheck === 4
          ? "✗ OmniRoute refused the key in ~/.config/cc-smart-dev-kit/gateway.json (HTTP 401): it is not an OmniRoute API key"
          : options.gatewayCheck === 1
            ? "✗ the gateway has no OmniRoute key yet, and OmniRoute answers at http://127.0.0.1:20128"
            : "✓ the gateway's OmniRoute key is accepted (http://127.0.0.1:20128, HTTP 200)"),
    FAKE_GATEWAY_KEY_REFUSED: options.gatewayKeyRefused === true ? "yes" : "no",
    FAKE_OMNIROUTE_PASSWORD_REFUSED: options.omniRoutePasswordRefused === true ? "yes" : "no",
    // A person's own Tavily key, in the three places setup reads one from.
    TAVILY_API_KEY: options.tavilyInEnv ?? "",
    // The MCP servers `mcp status --json` reports as registered by something else. `_AGAIN` is
    // the answer from the SECOND call (the installer's pass after the Tavily step).
    FAKE_MCP_STATUS: mcpStatusJson(options.mcpForeign ?? [], configDir),
    FAKE_MCP_STATUS_AGAIN:
      options.mcpForeignAgain === undefined
        ? ""
        : mcpStatusJson(options.mcpForeignAgain, configDir),
    FAKE_MCP_COUNT: join(home, "mcp-status-count"),
    // The GitHub CLI: the login it answers, whether its account can see the repository, and
    // whether nobody is logged in at all. And the way Claude Code's own add is refused on a
    // machine with no GitHub SSH key.
    FAKE_GH_LOGIN: options.ghLogin ?? "example-user",
    FAKE_GH_LOGGED_OUT: options.ghLoggedOut === true ? "yes" : "no",
    FAKE_GH_VIEW_FAILS: options.ghRepoViewFails === true ? "yes" : "no",
    FAKE_CLAUDE_SSH_REFUSED: options.claudeSshRefused === true ? "yes" : "no",
    FAKE_CLAUDE_ADD_NOT_FOUND: options.claudeAddNotFound === true ? "yes" : "no",
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

/**
 * The answers that finish the browser: yes to `browser setup`, then the token itself. The token
 * is one secret read now (not a yes/no question followed by a read), so a paste cannot land in
 * the wrong answer.
 */
function browserAnswers(...rest: string[]): string[] {
  return ["y", TOKEN, ...rest];
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
      "7/8 Paste the token from the extension's status page (it is not shown). Enter to skip: ",
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
    // The three marketplaces, in the README's order, then the marketplace REFRESH (before any
    // version is compared: a stale clone is what made the first real run update nothing), then
    // the install (whose line names the marketplace), then migrate before setup, both through
    // the plugin's own bundle.
    expect(w.callsOf("claude")).toEqual([
      `plugin marketplace add ${REPO}`,
      "plugin marketplace add thedotmack/claude-mem",
      "plugin marketplace add anthropics/claude-plugins-official",
      "plugin marketplace update cc-smart-dev-kit",
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
    expect(out).toContain(`✓ 5/8 the plugin is updated (0.4.0 -> ${MARKETPLACE_VERSION})\n`);
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
    // The second run adds no marketplace and reinstalls nothing — but the marketplace's own
    // copy is still refreshed (that is how it knows the plugin is current), and migrate, setup
    // and doctor still run.
    const second = w.calls().slice(afterFirst);
    expect(second.filter((call) => call.includes("marketplace add"))).toEqual([]);
    expect(second.filter((call) => call.includes("plugin install"))).toEqual([]);
    expect(second.filter((call) => call.includes("plugin update"))).toEqual([]);
    expect(second).toContain("claude plugin marketplace update cc-smart-dev-kit");
    expect(second).toContain(`bun ${w.cli} migrate`);
    expect(second).toContain(`bun ${w.cli} setup`);
    expect(second).toContain("launcher doctor");
  });

  test("a stale marketplace clone: the refresh runs first, then the update", () => {
    // The live trap (2026-10-17): the marketplace had been added hours earlier at 0.4.1, the
    // installed plugin was 0.4.1 too, and the installer compared the two — equal — so it never
    // updated, and then called an option the installed CLI did not have. The refresh is what
    // makes the comparison mean something.
    const w = world({
      answers: browserAnswers("n", "n"),
      cloneVersion: "0.4.0",
      installedVersion: "0.4.0",
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(w.callsOf("claude")).toEqual([
      `plugin marketplace add ${REPO}`,
      "plugin marketplace add thedotmack/claude-mem",
      "plugin marketplace add anthropics/claude-plugins-official",
      "plugin marketplace update cc-smart-dev-kit",
      "plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user",
    ]);
    expect(out).toContain(`✓ 5/8 the plugin is updated (0.4.0 -> ${MARKETPLACE_VERSION})\n`);
  });

  test("the CLI is still older after the update: refused with the two commands, and nothing else runs", () => {
    // The update ran, Claude Code's record says the new version, and the CLI that answers is
    // still the old one (a marketplace that itself does not carry the new version, say): the
    // installer must stop BEFORE it calls an option that CLI does not have.
    const w = world({
      answers: browserAnswers("n", "n"),
      cliVersion: "0.4.1",
      cloneVersion: "0.4.1",
      installedVersion: "0.4.1",
    });
    const { code, out } = w.run();
    expect(code).toBe(1);
    expect(out).toContain(
      `✗ the installed cc-smart-dev-kit CLI is 0.4.1, older than this installer's ${INSTALLER_VERSION}: this installer would call options that version does not have\n`,
    );
    expect(out).toContain(
      "  Retry just that step with:\n" +
        "    claude plugin marketplace update cc-smart-dev-kit\n" +
        "    claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user\n" +
        "  Then run this installer again: it goes on from there.\n",
    );
    // No later step ran at all: no migrate, no setup, no gateway check, no Tavily key. That is
    // the point — every one of those calls a flag an older CLI does not have.
    const bun = w.callsOf("bun");
    expect(bun.filter((call) => call.includes(" migrate"))).toEqual([]);
    expect(bun.filter((call) => call.includes(" setup"))).toEqual([]);
    expect(bun.filter((call) => call.includes("gateway check"))).toEqual([]);
    expect(bun.filter((call) => call.includes("--tavily-key-stdin"))).toEqual([]);
    // The CLI's own version WAS asked, once, after the update.
    expect(bun.filter((call) => call.endsWith("dist/cli.js version")).length).toBe(1);
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
    // Where the truncation lands decides bash's own words: a file that stops inside a string is
    // "unexpected EOF", one that stops between words is a "syntax error". Both are a parse
    // error, and neither runs a statement.
    expect(`${result.stdout.toString()}${result.stderr.toString()}`).toMatch(
      /syntax error|unexpected EOF/,
    );
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
  const GATEWAY_PASSWORD = "omni-dashboard-password-abc123";
  const TAVILY_KEY = "tvly-key-abc123";

  test("the secrets reach the plugin's own commands on stdin, never in an argument", () => {
    // No OmniRoute key yet, and OmniRoute answers: the installer asks for the DASHBOARD
    // password, and `gateway setup` makes the router's key itself (E).
    const w = world({
      answers: ["y", TOKEN, "y", GATEWAY_PASSWORD, "y", TAVILY_KEY],
      gatewayCheck: 1,
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("✓ 7/8 the browser's token is saved\n");
    expect(out).toContain(
      "✓ 7/8 the gateway is set up: turn it on with `" +
        w.launcher +
        " gateway on` when you want it\n",
    );
    expect(out).toContain("✓ 7/8 the Tavily key is saved\n");

    // Each command is the plugin's own, and each secret reaches it on stdin: the fake reports
    // what it read, and never the value.
    expect(w.callsOf("bun")).toContain(`${w.cli} browser setup`);
    expect(w.callsOf("bun")).toContain(`${w.cli} browser token`);
    expect(w.calls()).toContain(`stdin-${TOKEN.length}-chars`);
    expect(w.callsOf("bun")).toContain(
      `${w.cli} gateway setup --omniroute-password-stdin --save-unchecked`,
    );
    expect(w.callsOf("bun")).toContain(`${w.cli} setup --tavily-key-stdin`);
    // Two commands read a secret from a pipe: the dashboard password and the Tavily key.
    expect(w.calls().filter((line) => line === "stdin-nonempty")).toHaveLength(2);

    // No secret is in any fake's arguments, in the log, or in what the installer printed.
    for (const secret of [TOKEN, GATEWAY_PASSWORD, TAVILY_KEY]) {
      expect(w.calls().join("\n")).not.toContain(secret);
      expect(out).not.toContain(secret);
    }
  });

  test("a secret pasted with the bracketed-paste markers around it reaches the command clean", () => {
    // What Warp and other terminals put around a paste: ESC[200~ … ESC[201~. Both readers keep
    // the characters, so a marker left in would reach the plugin's own command and be refused
    // as the wrong shape (live, 2026-10-17: a token was pasted and never saved).
    const markedToken = `\u001b[200~${TOKEN}\u001b[201~`;
    const markedTavily = `\u001b[200~${TAVILY_KEY}\u001b[201~`;
    const w = world({ answers: ["y", markedToken, "n", "y", markedTavily] });
    const { code, out } = w.run();
    expect(code).toBe(0);
    // The fake logs the number of characters it read: exactly the token's own 43, so the
    // markers were gone before the command saw them.
    expect(w.calls()).toContain(`stdin-${TOKEN.length}-chars`);
    expect(w.calls()).toContain(`key-${TAVILY_KEY.length}-chars`);
    expect(out).toContain("✓ 7/8 the browser's token is saved\n");
    expect(out).toContain("✓ 7/8 the Tavily key is saved\n");
    for (const secret of [TOKEN, TAVILY_KEY, markedToken, markedTavily]) {
      expect(w.calls().join("\n")).not.toContain(secret);
      expect(out).not.toContain(secret);
    }
  });

  test("a gateway that already works: no key is asked for at all", () => {
    // The live failure (2026-10-17): the gateway worked, the person was asked for a key anyway,
    // and a provider key replaced the router's own OmniRoute key.
    const w = world({
      answers: browserAnswers("y", "n"),
      gatewayCheck: 0,
      gatewayConfig: true,
    });
    const before = w.read(join(w.home, ".config/cc-smart-dev-kit/gateway.json"));
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("· 7/8 the gateway already works, so no key is asked: ");
    expect(out).not.toContain("Paste the OmniRoute API key");
    expect(out).not.toContain("Paste your OmniRoute dashboard password");
    // The router's own copy and service are still refreshed, and the key in the file is kept.
    expect(w.callsOf("bun")).toContain(`${w.cli} gateway setup --no-backend-key`);
    expect(w.callsOf("bun").filter((call) => call.includes("--backend-key-stdin"))).toEqual([]);
    expect(w.read(join(w.home, ".config/cc-smart-dev-kit/gateway.json"))).toBe(before);
  });

  test("a key OmniRoute refuses: a new one is asked for, refused, asked once more, and the old file kept", () => {
    const w = world({
      answers: browserAnswers("y", GATEWAY_KEY, GATEWAY_KEY, "n"),
      gatewayCheck: 4,
      gatewayConfig: true,
      gatewayKeyRefused: true,
    });
    const before = w.read(join(w.home, ".config/cc-smart-dev-kit/gateway.json"));
    const { code, out } = w.run();
    // The run goes on, and the gateway's key is what is left.
    expect(code).toBe(0);
    expect(out).toContain(
      "7/8 Paste the OmniRoute API key the router uses (OmniRoute's dashboard → API keys; not your Ollama key). Enter to skip: \n",
    );
    // Asked AGAIN once, after the refusal, with the reason on the terminal.
    expect(out.match(/Paste the OmniRoute API key the router uses/g)?.length).toBe(2);
    expect(out).toContain("That was not saved:");
    expect(out).toContain("cc-smart-dev-kit: omniroute answered HTTP 401 for this key");
    expect(
      w.callsOf("bun").filter((call) => call.includes("--backend-key-stdin omniroute")),
    ).toHaveLength(2);
    // Nothing was written: the key the machine had is still the one in the file.
    expect(w.read(join(w.home, ".config/cc-smart-dev-kit/gateway.json"))).toBe(before);
    expect(out).toContain("· 7/8 the gateway keeps the key it had: give it a new one with ");
    expect(out).toContain(
      "  - the gateway's key: README § The AI gateway says which key OmniRoute wants, then ",
    );
    for (const secret of [GATEWAY_KEY]) {
      expect(w.calls().join("\n")).not.toContain(secret);
      expect(out).not.toContain(secret);
    }
  });

  test("OmniRoute refuses the dashboard password: nothing is saved, and it is asked once more", () => {
    const w = world({
      answers: browserAnswers("y", GATEWAY_PASSWORD, GATEWAY_PASSWORD, "n"),
      gatewayCheck: 1,
      omniRoutePasswordRefused: true,
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out.match(/Paste your OmniRoute dashboard password/g)?.length).toBe(2);
    expect(out).toContain("cc-smart-dev-kit: OmniRoute rejected that dashboard password");
    expect(
      w.callsOf("bun").filter((call) => call.includes("--omniroute-password-stdin")),
    ).toHaveLength(2);
    expect(out).toContain("· 7/8 the gateway keeps the key it had: ");
    expect(out).not.toContain(GATEWAY_PASSWORD);
  });

  test("no OmniRoute at all: nothing is asked, and the item is in what is left", () => {
    const w = world({ answers: browserAnswers("y", "n"), gatewayCheck: 3 });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("· 7/8 the gateway is left as it is: · the gateway could not be checked");
    expect(out).toContain(
      `  - the gateway: README § The AI gateway says how to install and run OmniRoute, then ${w.launcher} gateway setup --omniroute-password\n`,
    );
    expect(out).not.toContain("Paste your OmniRoute dashboard password");
    expect(out).not.toContain("Paste the OmniRoute API key");
    // The router's copy and service are set up all the same (no key is touched).
    expect(w.callsOf("bun")).toContain(`${w.cli} gateway setup --no-backend-key`);
  });

  test("a router already installed: the restart is asked about, and --yes carries the yes", () => {
    const w = world({
      answers: browserAnswers("y", "y", GATEWAY_PASSWORD, "n"),
      gatewayCheck: 1,
      routerCopy: true,
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      "7/8 A router is already installed here: setup restarts it, and running Claude Code sessions fail until you restart them. Go on? [y/N] \n",
    );
    expect(w.callsOf("bun")).toContain(
      `${w.cli} gateway setup --omniroute-password-stdin --save-unchecked --yes`,
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
    expect(w.callsOf("bun").filter((call) => call.includes("gateway check"))).toEqual([]);
  });

  test("a skipped secret is never asked again in one run", () => {
    // Yes to `browser setup`, no to the token: `browser token` must not run, and the
    // question must not come back later in the run.
    const w = world({ answers: ["y", "", "n", "n"] });
    const { code, out } = w.run();
    // The token was skipped, so doctor shows its ✗ and the run ends 3 (installed, with
    // items left) — the skip line is what the person acts on.
    expect(code).toBe(3);
    expect(out).toContain(
      `· 7/8 the browser's token was skipped: run \`${w.launcher} browser token\` when you have it\n`,
    );
    expect(out).toContain(`  - the browser's token: ${w.launcher} browser token\n`);
    expect(w.callsOf("bun").filter((call) => call.includes("browser token"))).toEqual([]);
    expect(out.match(/Paste the token from the extension's status page/g)?.length).toBe(1);
    // The gateway and the Tavily key were skipped, so neither of their commands ran.
    expect(w.callsOf("bun").filter((call) => call.includes("gateway setup"))).toEqual([]);
    expect(w.callsOf("bun").filter((call) => call.includes("--tavily-key-stdin"))).toEqual([]);
  });

  test("a gateway with no key yet, and nothing pasted: setup runs with --no-backend-key", () => {
    const w = world({ answers: browserAnswers("y", "", "n"), gatewayCheck: 1 });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("7/8 Paste your OmniRoute dashboard password");
    expect(out).toContain(
      "· 7/8 the router's copy and service are refreshed, and the gateway's key is untouched\n",
    );
    expect(w.callsOf("bun")).toContain(`${w.cli} gateway setup --no-backend-key`);
    expect(w.callsOf("bun").filter((call) => call.includes("--backend-key-stdin"))).toEqual([]);
    expect(w.callsOf("bun").filter((call) => call.includes("--omniroute-password-stdin"))).toEqual(
      [],
    );
  });

  test("a Tavily key that is already there is never asked for", () => {
    // Live (2026-10-17): the person had TAVILY_API_KEY in their environment and their project
    // already ran a Tavily MCP server; the installer asked anyway.
    const fromEnv = world({ answers: browserAnswers("n"), tavilyInEnv: "tvly-in-the-environment" });
    const first = fromEnv.run();
    expect(first.code).toBe(0);
    expect(first.out).toContain(
      "· 7/8 Tavily: using TAVILY_API_KEY from your environment (nothing is asked, nothing is written)\n",
    );
    expect(first.out).not.toContain("Add your Tavily key now");

    const fromFile = world({ answers: browserAnswers("n"), tavilyKeyFile: true });
    expect(fromFile.run().out).toContain(
      `· 7/8 Tavily: using the key already in ${fromFile.home}/.claude/cc-smart-dev-kit/tavily.key (nothing is asked)\n`,
    );

    const fromSettings = world({ answers: browserAnswers("n"), tavilyInSettings: true });
    expect(fromSettings.run().out).toContain(
      `· 7/8 Tavily: using the TAVILY_API_KEY already in ${fromSettings.configDir}/settings.json (nothing is asked)\n`,
    );
  });

  test("a foreign MCP server, answered yes: removed, and setup runs again", () => {
    // Live, 2026-10-17: a project's own script had registered `playwright` first, setup left it
    // alone (the rule), and its `!` line was never seen among the installer's output — so the
    // old browser kept starting. The installer asks now, showing what runs instead.
    const w = world({
      // The MCP question comes in step 6, before the browser's own questions.
      answers: ["y", ...browserAnswers("n", "n")],
      mcpForeign: [{ name: "playwright", runsWhat: "node /opt/tools/browser-server.js" }],
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      '6/8 The "playwright" server is registered by something else (node /opt/tools/browser-server.js). Replace it with cc-smart-dev-kit\'s? [y/N] \n',
    );
    expect(w.callsOf("claude")).toContain("mcp remove playwright --scope user");
    // `setup` runs again, so the plugin registers its own server WITH its record.
    expect(w.callsOf("bun").filter((call) => call === `${w.cli} setup`).length).toBe(2);
    expect(out).toContain(
      "✓ 6/8 setup ran again: cc-smart-dev-kit's own MCP servers are registered\n",
    );
    expect(out).not.toContain('  - the "playwright" MCP server');
  });

  test("a foreign MCP server, answered no: kept, and it is in what is left", () => {
    const w = world({
      answers: ["n", ...browserAnswers("n", "n")],
      mcpForeign: [{ name: "sequential-thinking", runsWhat: "node /opt/tools/thinking.js" }],
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      '6/8 The "sequential-thinking" server is registered by something else (node /opt/tools/thinking.js)',
    );
    expect(w.callsOf("claude").filter((call) => call.startsWith("mcp remove")).length).toBe(0);
    expect(out).toContain(
      `  - the "sequential-thinking" MCP server (registered by something else): claude mcp remove sequential-thinking --scope user && ${w.launcher} setup\n`,
    );
    expect(out).toContain(
      `· 6/8 the "sequential-thinking" server was left as it is: run \`claude mcp remove sequential-thinking --scope user\`, then \`${w.launcher} setup\`\n`,
    );
    // `setup` ran once only: nothing was replaced, so nothing is registered again.
    expect(w.callsOf("bun").filter((call) => call === `${w.cli} setup`).length).toBe(1);
  });

  test("a serena of the person's own: never asked about, never removed", () => {
    // Serena is retired (0.6.0): `mcp status` lists only the plugin's own names, so a `serena`
    // of the person's own is never reported (`src/mcp/mcp.test.ts` › "a retired name is never
    // reported") — this world's fake leaves it out the same way — and setup takes back only a
    // registration its record proves it made. The fake `claude mcp remove` really removes, so
    // a Serena step of the installer's own would show here.
    const theirs = { args: ["serena", "start-mcp-server"], command: "/opt/their-uvx" };
    const w = world({ answers: browserAnswers("n", "n"), userServers: { serena: theirs } });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).not.toContain("serena");
    expect(w.callsOf("claude").filter((call) => call.includes("serena"))).toEqual([]);
    // Still registered, under its name, exactly as the person had it.
    expect(JSON.parse(w.read(join(w.configDir, ".claude.json"))).mcpServers).toEqual({
      serena: theirs,
    });
  });

  test("the plugin's own servers are never asked about, and the check is one read-only call", () => {
    // The default world reports no foreign server, as `mcp status` does once setup registered
    // them all: nothing is asked.
    const w = world({ answers: browserAnswers("n", "n") });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).not.toContain("Replace it with cc-smart-dev-kit's?");
    expect(w.callsOf("claude").filter((call) => call.startsWith("mcp remove"))).toEqual([]);
    expect(w.calls()).toContain(`bun ${w.cli} mcp status --json`);
  });

  test("a server that only appears after the Tavily step is asked about too", () => {
    // M3 (premium review, 2026-10-17): the installer's foreign check runs again after step 7,
    // because the Tavily key arriving there changes what the plugin registers — and a
    // `tavily-websearch` of someone else's must not go on shadowing the plugin's own.
    const w = world({
      // Browser yes, the token, the gateway skipped, the Tavily key, then a yes to the second
      // pass's question.
      answers: [...browserAnswers("n", "y", TAVILY_KEY), "y"],
      mcpForeign: [],
      mcpForeignAgain: [
        { name: "tavily-websearch", runsWhat: "npx mcp-remote https://mcp.tavily.com/mcp/?***" },
      ],
    });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain("7/8 the Tavily key is saved");
    expect(out).toContain(
      '7/8 The "tavily-websearch" server is registered by something else (npx mcp-remote https://mcp.tavily.com/mcp/?***). Replace it with cc-smart-dev-kit\'s?',
    );
    expect(w.callsOf("claude")).toContain("mcp remove tavily-websearch --scope user");
    expect(w.callsOf("bun").filter((call) => call === `${w.cli} mcp status --json`).length).toBe(2);
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

describe("install.sh: the GitHub account and the marketplace's source", () => {
  // Both failures were seen live on 2026-10-17, while two team machines were moved: one had no
  // GitHub SSH key (Claude Code adds a marketplace over ssh, and the same marketplace over
  // HTTPS works), one was logged in with an account that could not see the private
  // repository (nothing could be added, and the installer said only "a private repository
  // needs your git credentials").
  test("no GitHub SSH key: the marketplace is added over HTTPS once, and the run goes on", () => {
    const w = world({ answers: browserAnswers("n", "n"), claudeSshRefused: true });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(out).toContain(
      `· 4/8 SSH to GitHub was refused, so the marketplace is added over HTTPS instead: https://github.com/${REPO}.git\n`,
    );
    // The repository's own source first, refused, then the HTTPS form: exactly one fallback,
    // and then the two companions as always.
    expect(w.callsOf("claude").filter((call) => call.startsWith("plugin marketplace add"))).toEqual(
      [
        `plugin marketplace add ${REPO}`,
        `plugin marketplace add https://github.com/${REPO}.git`,
        "plugin marketplace add thedotmack/claude-mem",
        "plugin marketplace add anthropics/claude-plugins-official",
      ],
    );
    expect(out).toContain(
      `✓ 4/8 marketplaces added: https://github.com/${REPO}.git, thedotmack/claude-mem, anthropics/claude-plugins-official\n`,
    );
    // The name it landed under comes from the repository's own marketplace file, so it is the
    // same name either way — and every later step found it: the refresh, the install, setup.
    expect(w.callsOf("claude")).toContain("plugin marketplace update cc-smart-dev-kit");
    expect(w.callsOf("claude")).toContain(
      "plugin install cc-smart-dev-kit@cc-smart-dev-kit --scope user",
    );
    expect(w.callsOf("bun")).toContain(`${w.cli} setup`);
    const known = JSON.parse(
      w.read(join(w.configDir, "plugins/known_marketplaces.json")),
    ) as Record<string, unknown>;
    expect(Object.keys(known).sort()).toEqual([
      "cc-smart-dev-kit",
      "claude-plugins-official",
      "thedotmack",
    ]);
  });

  test("the repository cannot be read at all: reported as before, with no HTTPS retry", () => {
    // A fallback is not a retry loop: "Repository not found" is access, not ssh, and the
    // HTTPS form cannot fix it.
    const w = world({ answers: browserAnswers("n", "n"), claudeAddNotFound: true });
    const { code, out } = w.run();
    expect(code).toBe(1);
    expect(out).toContain(`✗ adding the marketplace ${REPO} failed\n`);
    expect(out).toContain(
      `  Retry just that step with:\n    claude plugin marketplace add ${REPO}\n`,
    );
    expect(w.callsOf("claude")).toEqual([`plugin marketplace add ${REPO}`]);
    expect(out).not.toContain("SSH to GitHub was refused");
  });

  test("the account cannot see the repository: the account, the owner and the invitation", () => {
    const w = world({ answers: browserAnswers("n", "n"), ghRepoViewFails: true });
    const { code, out } = w.run();
    expect(code).toBe(1);
    expect(out).toContain(`✗ the GitHub account example-user cannot read ${REPO}\n`);
    expect(out).toContain(
      "  Retry just that step with:\n" +
        "    ask the repository's owner for read access\n" +
        `    accept the invitation at https://github.com/${REPO}/invitations\n` +
        "  Then run this installer again: it goes on from there.\n",
    );
    // The two GitHub questions, and nothing else: no marketplace was added, and no later step
    // ran (adding it cannot work until the account can see the repository).
    expect(w.callsOf("gh")).toEqual([`repo view ${REPO} --json name`, "api user --jq .login"]);
    expect(w.callsOf("claude")).toEqual([]);
  });

  test("git cannot read it and the account cannot see it: the account is named, not credentials", () => {
    // The live failure (2026-10-17) stopped HERE, at step 2, with "a private repository needs
    // your git credentials" — sending the person to fix credentials they already had. gh can
    // tell which it is, so step 2 asks it before it prints that line.
    const w = world({ answers: ["n"], gitFails: true, ghRepoViewFails: true });
    const { code, out } = w.run();
    expect(code).toBe(1);
    expect(out).toContain(`✗ the GitHub account example-user cannot read ${REPO}\n`);
    expect(out).toContain("    ask the repository's owner for read access\n");
    expect(out).not.toContain("git cannot read");
    // git was tried both ways first (step 2) and nothing else ran.
    expect(w.callsOf("git")).toEqual([
      `ls-remote git@github.com:${REPO}.git`,
      `ls-remote https://github.com/${REPO}.git`,
    ]);
    expect(w.callsOf("claude")).toEqual([]);
  });

  test("git cannot read it and the account can see it: the git-credentials line, as before", () => {
    const w = world({ answers: ["n"], gitFails: true });
    const { code, out } = w.run();
    expect(code).toBe(1);
    expect(out).toContain(
      `✗ git cannot read ${REPO}: a private repository needs your git credentials\n`,
    );
    expect(out).toContain("    gh auth login\n    gh auth setup-git\n");
    // One question only: the login is asked for only when the account cannot see the repository.
    expect(w.callsOf("gh")).toEqual([`repo view ${REPO} --json name`]);
  });

  test("gh is not installed: the check is skipped and the marketplace is added as before", () => {
    const w = world({ answers: browserAnswers("n"), noGh: true });
    const { code, out } = w.run();
    expect(code).toBe(0);
    expect(w.callsOf("gh")).toEqual([]);
    expect(w.callsOf("claude")).toContain(`plugin marketplace add ${REPO}`);
    expect(out).toContain(
      `✓ 4/8 marketplaces added: ${REPO}, thedotmack/claude-mem, anthropics/claude-plugins-official\n`,
    );
  });

  test("nobody is logged in to gh: the check is skipped, and none of gh's words are printed", () => {
    // Both of gh's questions fail with its own "please run: gh auth login" line — and NEITHER
    // of those lines may reach the output (both calls put gh's stderr away), so this also
    // guards the two silencings: `>/dev/null 2>&1` on `repo view`, `2>/dev/null` on `api user`.
    const w = world({ answers: browserAnswers("n"), ghLoggedOut: true });
    const { code, out } = w.run();
    expect(code).toBe(0);
    // Asked, so the branch really is the "it answered nothing" one.
    expect(w.callsOf("gh")).toEqual([`repo view ${REPO} --json name`, "api user --jq .login"]);
    expect(out).not.toContain("the GitHub account");
    expect(out).not.toContain("gh auth login");
    expect(w.callsOf("claude")).toContain(`plugin marketplace add ${REPO}`);
    expect(out).toContain(
      `✓ 4/8 marketplaces added: ${REPO}, thedotmack/claude-mem, anthropics/claude-plugins-official\n`,
    );
  });
});

describe("the Windows fakes: the same logic the Windows run uses, on Linux", () => {
  // scripts/install-windows-fakes/*.ts are what the `.cmd` wrappers in the Windows smoke
  // test run (through the real bun.exe). Their logic is exercised HERE, on Linux, so a typo
  // is caught before a Windows runner -- the first Windows run of 0.4.2 proved how slow that
  // loop is.
  const fakeWorld = () => {
    const root = tempDir("fakes");
    const configDir = join(root, ".claude");
    const log = join(root, "calls.log");
    writeFileSync(log, "");
    return {
      root,
      configDir,
      log,
      calls: () =>
        readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line !== ""),
    };
  };

  test("the fake claude's `mcp remove` takes that one server out of the user config", () => {
    const w = fakeWorld();
    const context = {
      addNotFound: false,
      addSshRefused: false,
      configDir: w.configDir,
      log: w.log,
      version: MARKETPLACE_VERSION,
    };
    // No user config yet: nothing to remove, and no file is made.
    expect(claude(["mcp", "remove", "serena", "--scope", "user"], context)).toBe(0);
    expect(existsSync(join(w.configDir, ".claude.json"))).toBe(false);
    mkdirSync(w.configDir, { recursive: true });
    writeFileSync(
      join(w.configDir, ".claude.json"),
      JSON.stringify({ mcpServers: { playwright: { command: "a" }, serena: { command: "b" } } }),
    );
    expect(claude(["mcp", "remove", "serena", "--scope", "user"], context)).toBe(0);
    expect(JSON.parse(readFileSync(join(w.configDir, ".claude.json"), "utf8"))).toEqual({
      mcpServers: { playwright: { command: "a" } },
    });
  });

  test("the fake claude writes the records the installer reads back", () => {
    const w = fakeWorld();
    const context = {
      addNotFound: false,
      addSshRefused: false,
      configDir: w.configDir,
      log: w.log,
      version: MARKETPLACE_VERSION,
    };
    for (const source of [REPO, "thedotmack/claude-mem", "anthropics/claude-plugins-official"]) {
      claude(["plugin", "marketplace", "add", source], context);
    }
    claude(["plugin", "install", "cc-smart-dev-kit@cc-smart-dev-kit", "--scope", "user"], context);
    expect(w.calls()).toEqual([
      `claude plugin marketplace add ${REPO}`,
      "claude plugin marketplace add thedotmack/claude-mem",
      "claude plugin marketplace add anthropics/claude-plugins-official",
      "claude plugin install cc-smart-dev-kit@cc-smart-dev-kit --scope user",
    ]);
    // The three keys known_marketplaces.json is read by, and the repo's own marketplace
    // carries the version the installer compares against.
    const known = JSON.parse(
      readFileSync(join(w.configDir, "plugins/known_marketplaces.json"), "utf8"),
    );
    expect(Object.keys(known).sort()).toEqual([
      "cc-smart-dev-kit",
      "claude-plugins-official",
      "thedotmack",
    ]);
    expect(known["cc-smart-dev-kit"].source.repo).toBe(REPO);
    expect(
      JSON.parse(
        readFileSync(
          join(known["cc-smart-dev-kit"].installLocation, "plugin/.claude-plugin/plugin.json"),
          "utf8",
        ),
      ).version,
    ).toBe(MARKETPLACE_VERSION);
    const installed = JSON.parse(
      readFileSync(join(w.configDir, "plugins/installed_plugins.json"), "utf8"),
    );
    expect(installed.plugins["cc-smart-dev-kit@cc-smart-dev-kit"][0].version).toBe(
      MARKETPLACE_VERSION,
    );
    expect(
      JSON.parse(readFileSync(join(w.configDir, "settings.json"), "utf8")).enabledPlugins[
        "cc-smart-dev-kit@cc-smart-dev-kit"
      ],
    ).toBe(true);
    // The two commands a move runs last, after the person says yes.
    claude(["plugin", "uninstall", "anymodel@anymodel", "--scope", "user"], context);
    claude(["plugin", "marketplace", "remove", "anymodel"], context);
    expect(
      JSON.parse(readFileSync(join(w.configDir, "plugins/installed_plugins.json"), "utf8")).plugins[
        "anymodel@anymodel"
      ],
    ).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(w.configDir, "plugins/known_marketplaces.json"), "utf8"))
        .anymodel,
    ).toBeUndefined();
  });

  test("the fake bun answers --version, version, upgrade, gateway check, doctor and the launcher", async () => {
    const w = fakeWorld();
    const launcher = join(w.root, "launcher.cmd");
    writeFileSync(launcher, "@echo off\nexit /b 0\n");
    const context = {
      bunUpgradeTo: MIN_BUN,
      bunUpgraded: join(w.root, "bun-upgraded"),
      bunVersion: "1.2.0",
      cliVersion: "0.4.3",
      gatewayCheckCode: 4,
      gatewayCheckLine: "✗ OmniRoute refused the key in gateway.json (HTTP 401)",
      gatewayKeyRefused: false,
      home: w.root,
      launcher,
      log: w.log,
      mcpStatus: '{"servers":[]}',
      omniRoutePasswordRefused: false,
    };
    const said: string[] = [];
    const errors: string[] = [];
    const io = {
      error: (line: string) => errors.push(line),
      say: (line: string) => said.push(line),
    };
    expect(await bun(["--version"], context, io)).toBe(0);
    expect(said.splice(0)).toEqual(["1.2.0"]);
    expect(await bun(["upgrade"], context, io)).toBe(0);
    expect(await bun(["--version"], context, io)).toBe(0);
    expect(said.splice(0)).toEqual([MIN_BUN]);
    // The two questions the installer asks about the CLI itself: its version, and whether the
    // gateway has a key its backend accepts.
    expect(
      await bun(
        ["--no-env-file", "--config=x", "C:\\tools\\0.4.3\\dist\\cli.js", "version"],
        context,
        io,
      ),
    ).toBe(0);
    expect(said.splice(0)).toEqual(["cc-smart-dev-kit 0.4.3"]);
    expect(
      await bun(
        ["--no-env-file", "--config=x", "C:\\tools\\0.4.3\\dist\\cli.js", "gateway", "check"],
        context,
        io,
      ),
    ).toBe(4);
    expect(said.splice(0)).toEqual([context.gatewayCheckLine]);
    // setup writes the launcher, the way the real one does (the template's own copy). The
    // arguments are the Windows shape the installer really passes -- a path with BACKSLASHES
    // -- so a matcher written with "/" (the bug that skipped this copy on the runner) fails
    // here instead of on a Windows runner.
    const windowsCli = "C:\\tools\\0.4.3\\dist\\cli.js";
    expect(await bun(["--no-env-file", "--config=x", windowsCli, "setup"], context, io)).toBe(0);
    expect(existsSync(join(w.root, ".local/bin/cc-smart-dev-kit.cmd"))).toBe(true);
    // doctor: the real ✗ line while the browser's token is missing, then the ✓ line.
    expect(await bun(["--no-env-file", "--config=x", windowsCli, "doctor"], context, io)).toBe(1);
    expect(said.splice(0)).toEqual([bunDoctorLine(w.root)]);
    mkdirSync(dirname(tokenFile(w.root)), { recursive: true });
    writeFileSync(tokenFile(w.root), "A\n", { mode: 0o600 });
    expect(await bun(["--no-env-file", "--config=x", windowsCli, "doctor"], context, io)).toBe(0);
    expect(said.splice(0)).toEqual([`✓ the browser token is set (${tokenFile(w.root)})`]);
    // The paths that read stdin (a key, a password, the token) are exercised through the fake's
    // own process — `scripts/install-windows-smoke.ps1` pipes one in, and the shell fakes above
    // prove the same logic on Linux. Here the two questions the installer asks about the CLI
    // itself are the ones worth pinning.
    expect(errors).toEqual([]);
  });

  test("the fake git fails on purpose, and the fake gh always succeeds", () => {
    const w = fakeWorld();
    expect(
      git(["ls-remote", "git@github.com:example-org/cc-smart-dev-kit.git"], {
        gitFails: false,
        log: w.log,
      }),
    ).toBe(0);
    expect(
      git(["ls-remote", "https://github.com/example-org/cc-smart-dev-kit.git"], {
        gitFails: true,
        log: w.log,
      }),
    ).toBe(128);
    expect(gh(["auth", "login"], { log: w.log })).toBe(0);
    expect(w.calls()).toEqual([
      "git ls-remote git@github.com:example-org/cc-smart-dev-kit.git",
      "git ls-remote https://github.com/example-org/cc-smart-dev-kit.git",
      "gh auth login",
    ]);
  });

  test("the fake claude's ssh refusal, and the fake gh's two answers", () => {
    // The Windows world's half of the two GitHub cases: the repository's own `owner/repo` add
    // is refused the way ssh refuses it on a machine with no key, the `https://…` form is
    // added — under the same marketplace name — and gh answers whether the account can see
    // the repository and what its login is.
    const w = fakeWorld();
    const refused = {
      addNotFound: false,
      addSshRefused: true,
      configDir: w.configDir,
      log: w.log,
      version: MARKETPLACE_VERSION,
    };
    const errors: string[] = [];
    const io = { error: (line: string) => errors.push(line) };
    expect(claude(["plugin", "marketplace", "add", REPO], refused, io)).toBe(1);
    expect(errors).toEqual([
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
    ]);
    // The other refusal: access, not ssh — the same non-zero exit, the line that says so.
    expect(
      claude(["plugin", "marketplace", "add", REPO], { ...refused, addNotFound: true }, io),
    ).toBe(1);
    expect(errors.at(-1)).toBe(
      "ERROR: Repository not found.\nfatal: Could not read from remote repository.",
    );
    const known = () =>
      JSON.parse(
        readFileSync(join(w.configDir, "plugins/known_marketplaces.json"), "utf8"),
      ) as Record<string, { source: { repo: string } }>;
    expect(existsSync(join(w.configDir, "plugins/known_marketplaces.json"))).toBe(false);
    expect(
      claude(["plugin", "marketplace", "add", `https://github.com/${REPO}.git`], refused, io),
    ).toBe(0);
    expect(Object.keys(known())).toEqual(["cc-smart-dev-kit"]);
    expect(known()["cc-smart-dev-kit"]?.source.repo).toBe(`https://github.com/${REPO}.git`);

    const said: string[] = [];
    const ghIo = {
      error: (line: string) => errors.push(line),
      say: (line: string) => said.push(line),
    };
    expect(gh(["repo", "view", REPO, "--json", "name"], { log: w.log }, ghIo)).toBe(0);
    expect(said.splice(0)).toEqual(['{"name":"cc-smart-dev-kit"}']);
    expect(gh(["api", "user", "--jq", ".login"], { login: "example-user", log: w.log }, ghIo)).toBe(
      0,
    );
    expect(said.splice(0)).toEqual(["example-user"]);
    // An account that cannot see the repository: gh's own words, and a non-zero exit.
    expect(
      gh(["repo", "view", REPO, "--json", "name"], { log: w.log, viewFails: true }, ghIo),
    ).toBe(1);
    expect(errors.at(-1)).toBe(
      "Could not resolve to a Repository with the name 'example-org/cc-smart-dev-kit'.",
    );
  });

  test("the fake gh answers a logged-out machine the way the real one does", () => {
    // The Windows world's half of the "nobody is logged in" smoke case, proved here so the
    // runner does not have to teach it: BOTH questions fail, with gh's own line on stderr and
    // nothing on stdout — the machine the installer skips the check on, not stops on.
    const w = fakeWorld();
    const said: string[] = [];
    const errors: string[] = [];
    const io = {
      error: (line: string) => errors.push(line),
      say: (line: string) => said.push(line),
    };
    const loggedOut = { log: w.log, loggedOut: true };
    expect(gh(["repo", "view", REPO, "--json", "name"], loggedOut, io)).toBe(1);
    expect(gh(["api", "user", "--jq", ".login"], loggedOut, io)).toBe(1);
    expect(said).toEqual([]);
    expect(errors).toEqual([
      "To get started with GitHub CLI, please run: gh auth login",
      "To get started with GitHub CLI, please run: gh auth login",
    ]);
    expect(w.calls()).toEqual([`gh repo view ${REPO} --json name`, "gh api user --jq .login"]);
  });
});

describe("the PowerShell files: the patterns the Windows run taught us", () => {
  // The two installers must print the SAME lines for the same machine. PowerShell hands a
  // native command's stderr straight to the console unless the call puts it away, so gh's own
  // "Could not resolve to a Repository ..." and "please run: gh auth login" lines were printed
  // by install.ps1 and not by install.sh (0.5.0 review). Every gh call in install.ps1 silences
  // stderr now, exactly as install.sh's two calls do (`>/dev/null 2>&1`, `2>/dev/null`).
  // The Windows smoke's logged-out case would catch a drop on the runner; this catches it on
  // Linux, before that run. (`gh` is only ever asked these two questions.)
  test("install.ps1 puts gh's own stderr away, as install.sh does", () => {
    const ps1 = readFileSync(INSTALL_PS1, "utf8");
    expect(ps1).toContain("& gh repo view $Repo --json name 2>$null");
    expect(ps1).toContain("& gh api user --jq .login 2>$null");
    const ghCalls = [...ps1.matchAll(/& gh [^\r\n]*/g)].map((match) => match[0]);
    expect(ghCalls).toHaveLength(2);
    expect(ghCalls.filter((call) => !call.includes("2>$null"))).toEqual([]);
  });

  // 0.4.2's first Windows run printed "marketplaces added: c, x, ..." for the repository:
  // `@(@($a, $b)) + $list` does NOT keep the pair together -- PowerShell enumerates that
  // inner array, the loop then walks two STRINGS before the pairs, and `$pair[0]` on a
  // string is its first character. A digit index on a variable is that pattern; the fix is
  // hashtables (`$marketplace.Name`), which cannot collapse.
  // PowerShell variables are CASE-INSENSITIVE. `foreach ($marketplace in ...)` writes over a
  // script-level `$Marketplace`, and 0.4.2's Windows run lost the marketplace's version that
  // way: step 5 then printed "the plugin is updated" on a machine already at that version.
  // Only the script-level names are checked -- a parameter or a loop variable inside a
  // function has its own scope, and two functions may each name one the same way.
  test("no script-level variable is spelled another way elsewhere", () => {
    for (const file of [INSTALL_PS1, SMOKE_PS1]) {
      // Comments cannot clobber anything, and these files explain the trap in them.
      const text = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      const scriptLevel = [...text.matchAll(/^\$([A-Za-z_][A-Za-z0-9_]*) = /gm)].map(
        (match) => match[1] ?? "",
      );
      const otherSpellings: string[] = [];
      for (const name of scriptLevel) {
        const pattern = new RegExp(`\\$(${name})\\b`, "gi");
        for (const found of text.matchAll(pattern)) {
          const spelling = found[1] ?? "";
          // `\$MinBun` is a regex inside a string (the smoke test reads install.ps1's own
          // number that way), not a variable: an escaped dollar is skipped.
          const before = text[(found.index ?? 0) - 1] ?? "";
          if (spelling === name || before === "\\" || before === "`") continue;
          otherSpellings.push(`${name} vs ${spelling}`);
        }
      }
      expect([...new Set(otherSpellings)]).toEqual([]);
    }
  });

  test("no PowerShell file indexes a value that may be a string", () => {
    for (const file of [INSTALL_PS1, SMOKE_PS1]) {
      // Comments cannot break PowerShell, and the comment above names the pattern.
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      const indexed = [...code.matchAll(/\$[A-Za-z_][A-Za-z0-9_]*\s*\[\d\]/g)].map((m) => m[0]);
      expect(indexed).toEqual([]);
      // And a list is grown with .Add (a List), never with `+=` on an array.
      expect(/\$[A-Za-z_][A-Za-z0-9_]* \+= /.test(code)).toBe(false);
    }
  });

  // `"$Marketplace.installLocation"` is MEMBER ACCESS inside a double-quoted string:
  // PowerShell reads `$Marketplace`, then `.installLocation`, and a string has no such
  // property -- so the path was the marketplace's name alone and the field came back empty
  // (0.4.2's fourth Windows run printed "the plugin is updated" on a machine that was already
  // up to date). `"$Repo:"` is the same trap with a colon, and `$Repo.git` in the two git
  // URLs was a third. `"${…}"` ends the variable name and is the fix.
  test("no variable inside a string is followed by a member-access character", () => {
    // The scope and drive names are not variables to end with braces: `"$env:NAME"` is the
    // way to read an environment variable, and `"$script:Answer"` a scope.
    const allowed = new Set(["env", "global", "local", "private", "script", "using", "variable"]);
    for (const file of [INSTALL_PS1, SMOKE_PS1]) {
      const text = readFileSync(file, "utf8");
      const offenders: string[] = [];
      for (const line of text.split("\n")) {
        if (/^\s*#/.test(line)) continue;
        for (const quoted of line.matchAll(/"([^"]*)"/g)) {
          const span = quoted[1] ?? "";
          if (span.includes("$(") || span.includes("${")) continue;
          // A member access needs a name after the dot (`$x.y`); `$x. text` is plain text.
          for (const found of span.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_]|\[|:)/g)) {
            if (!allowed.has(found[1] ?? "")) offenders.push(`$ ${found[0]}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    }
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

  // The version each installer ships with, kept equal to the plugin's own manifest
  // (`plugin/.claude-plugin/plugin.json`, its one home). A script reads it back off the
  // installed CLI and refuses to go on when that CLI is older, so a script that carried a
  // stale number would refuse a machine that is fine — or, worse, promise options the CLI it
  // calls does not have, which is what the first real run did (2026-07-17).
  test("both installers carry the version of plugin/.claude-plugin/plugin.json", () => {
    expect(INSTALLER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(/^INSTALLER_VERSION="([^"]+)"/m.exec(readFileSync(INSTALL_SH, "utf8"))?.[1]).toBe(
      INSTALLER_VERSION,
    );
    expect(/^\$InstallerVersion = "([^"]+)"/m.exec(readFileSync(INSTALL_PS1, "utf8"))?.[1]).toBe(
      INSTALLER_VERSION,
    );
  });

  test("a secret piped to the CLI is sent as UTF-8, without a BOM (Windows PowerShell 5.1)", () => {
    // 5.1 encodes what it pipes with $OutputEncoding — ASCII by default there — so a key with
    // any non-ASCII character reached the plugin's command as "?". Every secret goes through
    // the one helper that sets UTF-8 (no BOM) and puts the previous value back.
    const ps1 = readFileSync(INSTALL_PS1, "utf8");
    const code = ps1
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(code).toContain("$OutputEncoding = New-Object System.Text.UTF8Encoding $false");
    expect(code).toContain("function Send-SecretToCli");
    // The only variable piped into the CLI is the helper's own parameter: no call site pipes a
    // secret itself.
    // (`Invoke-CliQuiet` pipes `$null`, which is not a secret.)
    const pipes = [...code.matchAll(/^\s*\$([A-Za-z_][A-Za-z0-9_]*) \| & \$Bun @cliArgv/gm)]
      .map((match) => match[1] ?? "")
      .filter((name) => name !== "null");
    expect(pipes).toEqual(["Secret"]);
    // And each secret reaches the CLI through it.
    expect([...code.matchAll(/Send-SecretToCli \$/g)]).toHaveLength(4);
  });

  test("the `mcp status --json` answer is captured WITHOUT stderr (a warning cannot break the JSON)", () => {
    // `Get-CommandText` merges a native command's stderr into its text — right for a doctor
    // line, wrong for a JSON answer, where one warning line would make ConvertFrom-Json throw
    // and the installer would silently ask about nothing.
    const ps1 = readFileSync(INSTALL_PS1, "utf8");
    const code = ps1
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(code).toContain("function Get-CommandStdout");
    expect(code).toContain(
      '$statusText = Get-CommandStdout { Invoke-CliQuiet @("mcp", "status", "--json") }',
    );
    expect(code).not.toContain("$mcpStatusText = Get-CommandText");
  });

  // Read as text on purpose: PowerShell cannot run here, and the Windows job hit this order bug
  // (the version check ran `Invoke-CliQuiet` before `$cliArgv` was set, so it ran `bun version`).
  test("install.ps1 sets the CLI's argv once, before its first caller (the version check)", () => {
    const lines = readFileSync(INSTALL_PS1, "utf8").split("\n");
    const assigned = lines.flatMap((line, index) => (/^\$cliArgv = @\(/.test(line) ? [index] : []));
    const versionCheck = lines.findIndex((line) => line.includes('Invoke-CliQuiet @("version")'));
    expect(assigned).toHaveLength(1);
    expect(versionCheck).toBeGreaterThan(-1);
    expect(assigned[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(versionCheck);
  });

  // The lines that finish a repository the GitHub account cannot read, and the words that name
  // the ssh cause, are the plugin's own (src/setup/marketplace-access.ts: doctor prints them
  // too). A shell script cannot import that file, so all three carry the same words, and this
  // keeps them in step — each installer with its own spelling of the repository in the line.
  test("both installers carry the marketplace access lines of the plugin's own copy", () => {
    const withRepo = (repo: string) =>
      REPO_ACCESS_FIX_LINES.map((line) => line.replace("%s", repo));
    // PowerShell's spelling of the repository, `$` and `{Repo}` written apart so it is not read
    // as a template placeholder here.
    const psRepo = "$" + "{Repo}";
    for (const line of [...withRepo("$REPO"), SSH_REFUSED_WORDS]) {
      expect(readFileSync(INSTALL_SH, "utf8")).toContain(line);
    }
    for (const line of [...withRepo(psRepo), SSH_REFUSED_WORDS]) {
      expect(readFileSync(INSTALL_PS1, "utf8")).toContain(line);
    }
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
  // Comment lines are skipped: a comment is never parsed as code, and these files explain
  // the trap by naming it.
  test("no PowerShell variable runs into a colon (`$Repo:` is a parse error; braces fix it)", () => {
    const scopes = /^(env|script|global|local|private|using|function|variable)$/i;
    for (const file of [INSTALL_PS1, SMOKE_PS1]) {
      const bad = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .flatMap((line, index) =>
          [...line.matchAll(/(?<!\$\{)\$([A-Za-z_][A-Za-z0-9_]*):(?!:)/g)]
            .filter((match) => !scopes.test(match[1] ?? ""))
            .map((match) => `${file.split("/").pop()}:${index + 1}: ${match[0]}`),
        );
      expect(bad).toEqual([]);
    }
  });
});
