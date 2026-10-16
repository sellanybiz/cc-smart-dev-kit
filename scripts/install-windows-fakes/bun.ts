/**
 * The fake `bun` for the Windows smoke test and for the Linux test of the fakes
 * (`scripts/install.test.ts`): it logs every argument, answers `--version` and `upgrade`, and
 * stands in for the plugin's own CLI — the commands the installer runs with it.
 *
 * It reads its own stdin, like the real commands do: `browser token` takes one line (the
 * pasted token, which it writes to the token file and never prints), and the two
 * `--…-key-stdin` commands read everything (and log only whether anything came). That is why
 * the fake is JavaScript run by a real `bun.exe` rather than batch: a batch file's own
 * parsing is where the first Windows run of 0.4.2 broke, and this logic is testable on Linux.
 *
 * Every command takes a `context` (see `contextFromEnv`), so a test can point one at a world
 * of its own.
 */
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** What the fake reads from the environment the smoke test builds. */
export interface Context {
  bunUpgradeTo: string;
  bunUpgraded: string;
  bunVersion: string;
  /** What the plugin's own CLI answers for `version` (the installer checks it). */
  cliVersion: string;
  /** What `gateway check` exits with, and the line it prints. */
  gatewayCheckCode: number;
  gatewayCheckLine: string;
  /** Every `--backend-key-stdin` run is refused, as a key the backend does not accept. */
  gatewayKeyRefused: boolean;
  /** The JSON `mcp status --json` answers: which servers are registered by something else. */
  mcpStatus: string;
  /** Every `--omniroute-password-stdin` run is refused, as a wrong dashboard password. */
  omniRoutePasswordRefused: boolean;
  home: string;
  launcher: string;
  log: string;
}

export function contextFromEnv(): Context {
  return {
    bunUpgradeTo: process.env.FAKE_BUN_UPGRADE_TO ?? "",
    bunUpgraded: process.env.FAKE_BUN_UPGRADED ?? "",
    bunVersion: process.env.FAKE_BUN_VERSION ?? "",
    cliVersion: process.env.FAKE_CLI_VERSION ?? "",
    gatewayCheckCode: Number(process.env.FAKE_GATEWAY_CHECK_CODE ?? "0"),
    gatewayCheckLine: process.env.FAKE_GATEWAY_CHECK_LINE ?? "",
    gatewayKeyRefused: process.env.FAKE_GATEWAY_KEY_REFUSED === "yes",
    mcpStatus: process.env.FAKE_MCP_STATUS ?? '{"servers":[]}',
    omniRoutePasswordRefused: process.env.FAKE_OMNIROUTE_PASSWORD_REFUSED === "yes",
    home: process.env.HOME ?? process.env.USERPROFILE ?? "",
    launcher: process.env.FAKE_LAUNCHER ?? "",
    log: process.env.FAKE_LOG ?? "",
  };
}

function record(context: Context, line: string): void {
  if (context.log !== "") appendFileSync(context.log, `${line}\n`);
}

async function readAllStdin(): Promise<string> {
  let text = "";
  for await (const chunk of Bun.stdin.stream()) text += new TextDecoder().decode(chunk);
  return text;
}

/** The one line a `set /p`-style read would take, without the line's end. */
async function readOneLine(): Promise<string> {
  const text = await readAllStdin();
  const end = text.indexOf("\n");
  return (end < 0 ? text : text.slice(0, end)).replace(/\r$/, "");
}

/** The browser's token file, as `browser token` writes it: mode 600, never printed. */
export function tokenFile(home: string): string {
  return join(home, ".config", "cc-smart-dev-kit", "playwright-extension.token");
}

/** The line the real `doctor` prints while the token is missing (`src/browser/doctor.ts`). */
export function doctorTokenMissingLine(home: string): string {
  return (
    `✗ the browser token is not set, so the browser cannot connect ` +
    `(no token file at ${tokenFile(home)}): run: cc-smart-dev-kit browser setup, ` +
    `then cc-smart-dev-kit browser token`
  );
}

export async function answer(
  argv: string[],
  context: Context,
  io: { error?: (line: string) => void; say?: (line: string) => void } = {},
): Promise<number> {
  const say = io.say ?? ((line: string) => process.stdout.write(`${line}\n`));
  // A refusal goes where the real command's does: stderr.
  const sayError = io.error ?? ((line: string) => process.stderr.write(`${line}\n`));
  // The arguments as ONE string for matching, with every separator as "/": on Windows the
  // installer builds `C:\…\dist\cli.js`, and a matcher written with "/" never sees it (this
  // is the bug that made the fake skip writing the launcher on the first green-ish run).
  const joined = argv.join(" ").replaceAll("\\", "/");
  const first = argv[0];

  if (first === "--version") {
    const upgraded =
      context.bunUpgraded !== "" && existsSync(context.bunUpgraded)
        ? readFileSync(context.bunUpgraded, "utf8").trim()
        : context.bunVersion;
    say(upgraded);
    return 0;
  }
  if (first === "upgrade") {
    if (context.bunUpgraded !== "") writeFileSync(context.bunUpgraded, `${context.bunUpgradeTo}\n`);
    return 0;
  }
  // The plugin's own CLI, asked its version: the installer refuses to go on when the CLI that
  // answers is older than the release it ships with.
  if (joined.includes("dist/cli.js version")) {
    say(`cc-smart-dev-kit ${context.cliVersion}`);
    return 0;
  }
  // The read-only question the installer asks before it asks a person for a key.
  if (joined.includes("dist/cli.js gateway check")) {
    say(context.gatewayCheckLine);
    return context.gatewayCheckCode;
  }
  // Which of the plugin's MCP servers are registered by something else, as JSON.
  if (joined.includes("dist/cli.js mcp status")) {
    say(context.mcpStatus);
    return 0;
  }
  if (joined.includes("browser token")) {
    const secret = await readOneLine();
    record(context, `stdin-${secret.length}-chars`);
    const file = tokenFile(context.home);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${secret}\n`);
    chmodSync(file, 0o600);
    return 0;
  }
  if (
    joined.includes("--backend-key-stdin") ||
    joined.includes("--tavily-key-stdin") ||
    joined.includes("--omniroute-password-stdin")
  ) {
    const secret = await readAllStdin();
    // The number of characters that arrived, and never the value: a test proves the installer's
    // cleaning with it (a paste wrapped in the bracketed-paste markers must reach the command as
    // the key itself, not 12 characters longer).
    record(context, secret.trim() === "" ? "stdin-empty" : "stdin-nonempty");
    record(context, `key-${secret.trim().length}-chars`);
    // A key or a password the backend refuses: the real command saves NOTHING, keeps the key in
    // the file, and says why on stderr.
    if (joined.includes("--backend-key-stdin") && context.gatewayKeyRefused) {
      sayError(
        "cc-smart-dev-kit: omniroute answered HTTP 401 for this key: it does not accept it.\n" +
          "Nothing was saved, and the key in the config is kept as it was.",
      );
      return 1;
    }
    if (joined.includes("--omniroute-password-stdin")) {
      if (context.omniRoutePasswordRefused) {
        sayError(
          "cc-smart-dev-kit: OmniRoute rejected that dashboard password. Nothing was saved, and the key in the config is kept as it was.",
        );
        return 1;
      }
      say('made the key "cc-smart-dev-kit-router-test" in OmniRoute (••••cdef)');
    }
    return 0;
  }
  if (joined.includes("dist/cli.js setup")) {
    // The real setup writes the launcher; the fake copies the template the test made, which
    // does what the real launcher does (it runs the plugin's own CLI).
    if (context.launcher !== "") {
      const target = join(context.home, ".local", "bin", "cc-smart-dev-kit.cmd");
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(context.launcher, target);
    }
    return 0;
  }
  if (joined.includes("dist/cli.js doctor")) {
    const file = tokenFile(context.home);
    if (existsSync(file)) {
      say(`✓ the browser token is set (${file})`);
      return 0;
    }
    say(doctorTokenMissingLine(context.home));
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const context = contextFromEnv();
  record(context, `bun ${argv.join(" ")}`);
  process.exitCode = await answer(argv, context);
}
