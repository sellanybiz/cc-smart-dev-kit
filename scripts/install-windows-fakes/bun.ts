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
  home: string;
  launcher: string;
  log: string;
}

export function contextFromEnv(): Context {
  return {
    bunUpgradeTo: process.env.FAKE_BUN_UPGRADE_TO ?? "",
    bunUpgraded: process.env.FAKE_BUN_UPGRADED ?? "",
    bunVersion: process.env.FAKE_BUN_VERSION ?? "",
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
  io: { say?: (line: string) => void } = {},
): Promise<number> {
  const say = io.say ?? ((line: string) => process.stdout.write(`${line}\n`));
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
  if (joined.includes("browser token")) {
    const secret = await readOneLine();
    record(context, `stdin-${secret.length}-chars`);
    const file = tokenFile(context.home);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${secret}\n`);
    chmodSync(file, 0o600);
    return 0;
  }
  if (joined.includes("--backend-key-stdin") || joined.includes("--tavily-key-stdin")) {
    const secret = await readAllStdin();
    record(context, secret.trim() === "" ? "stdin-empty" : "stdin-nonempty");
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
