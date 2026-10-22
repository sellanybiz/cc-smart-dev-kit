/**
 * The context every `cc-smart-dev-kit gateway …` command runs with, built in ONE place.
 *
 * WHY IT IS ITS OWN MODULE (a live-shaped bug, 2026-10-17). `gateway setup --omniroute-password`
 * asks for OmniRoute's dashboard password with no echo, and it can only do that when the context
 * carries a `readSecret` — a function that shows the question and reads one line from a terminal
 * whose echo can be switched off (the prompts' `secret`, `src/cli/ui/prompt.ts`). The context used
 * to be built inside
 * the CLI entry, and it never set that field: every run of `--omniroute-password` answered "this
 * terminal cannot hide what you type", on a real terminal too, while the README, the installer
 * and the gateway skill all send people to that flag. The entry now calls this function, and
 * `src/gateway/context.test.ts` proves a terminal-shaped stdin gets `readSecret` and a pipe does
 * not.
 *
 * Everything the machine owns is an argument (`terminal`, `apiFetch`, the runner, the service),
 * so a test builds a context of its own and no test reaches a real terminal or a real backend.
 */
import type { CliPaths } from "../cli/paths";
import { cleanSecretLine, type RawTerminal } from "../cli/secret-line";
import { terminalPrompts } from "../cli/ui/prompt";
import { currentTerminal } from "../cli/ui/terminal";
import type { GatewayContext } from "./commands";
import type { HealthFetch } from "./health";
import { realProbe } from "./health";
import type { RouterServiceKind, Runner } from "./service";

export interface GatewayContextOptions {
  paths: CliPaths;
  /** The plugin's own `dist/router.js`. */
  bundle: string;
  runner: Runner;
  /** The service this machine can run the router under (`routerServiceKind`). */
  service: RouterServiceKind;
  /** Windows: the account a Scheduled Task runs as (`MACHINE\user`); null everywhere else. */
  account: null | string;
  platform: NodeJS.Platform;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  /**
   * The terminal `--omniroute-password` reads from. `process.stdin` in use; a test passes a
   * fake. `readSecret` is set only when this stream is a terminal whose echo can be switched
   * off (`canHideInput`): on a pipe, and on a terminal that cannot hide what is typed, the
   * flag says to give the password on stdin instead.
   */
  terminal?: RawTerminal;
  /** Where the questions on that terminal are shown; stdout in use, a recorder in a test. */
  questionOutput?: (text: string) => void;
  /** The network for the key check, OmniRoute's dashboard and the liveness probe. */
  apiFetch?: HealthFetch;
  print?: (line: string) => void;
  error?: (line: string) => void;
}

export function gatewayContext(options: GatewayContextOptions): GatewayContext {
  const terminal = options.terminal ?? process.stdin;
  return {
    paths: options.paths,
    bunPath: process.execPath,
    bunVersion: Bun.version,
    bundle: options.bundle,
    runner: options.runner,
    // A secret on stdin is cleaned first: a terminal that keeps bracketed paste on hands a
    // paste to a pipe as `ESC[200~<key>ESC[201~` (`src/cli/secret-line.ts`).
    readStdin: async () => cleanSecretLine(await Bun.stdin.text()),
    ...terminalQuestions(terminal, options.questionOutput),
    confirm: options.confirm,
    service: options.service,
    account: options.account,
    platform: options.platform,
    probe: realProbe(),
    apiFetch: options.apiFetch ?? ((url, init) => fetch(url, init)),
    print: options.print ?? ((line) => console.log(line)),
    error: options.error ?? ((line) => console.error(line)),
  };
}

/**
 * The prompts' one home (`src/cli/ui/prompt.ts`) on this terminal: `prompts` for `gateway
 * setup`'s questions, and `readSecret` (the prompts' secret read: it shows the question, and
 * reads with no echo). Nothing at all on a pipe; no `readSecret` on a terminal that cannot
 * switch its echo off.
 */
function terminalQuestions(
  terminal: RawTerminal & { isTTY?: boolean },
  write?: (text: string) => void,
): Pick<GatewayContext, "prompts" | "readSecret"> {
  const prompts = terminalPrompts(currentTerminal(), terminal, write);
  if (prompts === null) return {};
  return prompts.secret === null ? { prompts } : { prompts, readSecret: prompts.secret };
}
