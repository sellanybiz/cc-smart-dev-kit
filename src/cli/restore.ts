import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  type BrowserSetupRecord,
  browserRestoreLines,
  readBrowserSetupRecord,
} from "../browser/setup";
import { COMMAND } from "../build-info";
import { configuredPort, routerService } from "../gateway/commands";
import { messageOf } from "../gateway/config";
import type { HealthProbe } from "../gateway/health";
import {
  gatewayCopiesAmong,
  linkedWorktreeFilesOf,
  PERSONAL_EXCLUDE_LINE,
  PERSONAL_FILE,
} from "../gateway/project-state";
import {
  type RouterServiceKind,
  type Runner,
  restartPendingFile,
  SOCKET_NAME,
  UNIT_NAME,
} from "../gateway/service";
import { TASK_LABEL } from "../gateway/service-windows";
import {
  BASE_URL_PATH,
  baseUrlPointsAtGateway,
  offAddressOf,
  ownedGatewayEnvKeys,
  RETIRED_GATEWAY_ENV_KEYS,
  readGatewaySettings,
  shownValue,
} from "../gateway/settings";
import { forgetClaudeMemChoices } from "../machine/claude-mem";
import { restoreTakenOver } from "../machine/claude-mem-choices";
import { forgetMcpServer, mcpRecordsFile } from "../mcp/records";
import { removeMcpServers } from "../mcp/register";
import { bunConfigPath } from "../setup/bun-config";
import { forgetInstructionsState } from "../setup/instructions";
import { shellQuote } from "../shell/quote";
import { LAUNCHER_NAME } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { samePath } from "../setup/managed-json";
import { type RestoreResult, restore } from "../setup/restore";
import { readChanged, realTarget } from "../setup/write";
import { type CliPaths, tildify } from "./paths";

function describe(result: RestoreResult, short: (path: string) => string): string {
  const file = short(result.file);
  switch (result.action) {
    case "restored":
      return `~ ${file}: back as it was before cc-smart-dev-kit`;
    case "removed":
      return `- ${file}: removed (cc-smart-dev-kit had created it)`;
    case "cleaned": {
      // A key written again, not taken out (the gateway's address, GP5): it is named first, so
      // the line says what the file holds now, not only what it lost.
      const parts = [
        ...(result.written ?? []).map((one) => `set ${one.path} to ${shownValue(one.value)}`),
        // A taken-over value back: the person's own, so it is named, never printed (it may be a
        // key or an address with one in it; the take-over's own lines show it the way it should).
        ...(result.putBack === undefined
          ? []
          : [`put back ${result.putBack.join(", ")} (yours again)`]),
        ...(result.details.length === 0 ? [] : [`removed ${result.details.join(", ")}`]),
      ];
      return `~ ${file}: ${parts.join(", ")}; everything else kept`;
    }
    case "unchanged":
      return `  ${file}: nothing of cc-smart-dev-kit left in it`;
    case "no-backup":
      return `! ${file}: the backup from before cc-smart-dev-kit is missing; left alone`;
  }
}

/** The router's own definition files, as restore knows them. */
const UNITS = `${UNIT_NAME} and ${SOCKET_NAME}`;

/** Said before restore stops a running router, and before the question. */
export const STOP_WARNING =
  "cc-smart-dev-kit-router is running. Stopping it cuts the answers in flight in running Claude sessions on this machine.";

/** Said before `restore --now`, and before the question. */
export const NOW_WARNING = `restore --now stops cc-smart-dev-kit-router while Claude sessions still use it: every running Claude session fails until it restarts.`;

/**
 * Said at the end of stage 1: what running sessions do on their own now, and the second run.
 *
 * Stage 1 **wrote** Anthropic's own address into every settings file that still pointed at the
 * router (GP5) instead of removing the key, so a running session switches to Anthropic by
 * itself within about a second (proved 2026-10-23) — nothing to restart, which is what the two
 * stages used to ask for. What the two stages are still for: the router keeps running until the
 * second run, because a request a session made just before it switched would be cut off by a
 * stop in the same run (nothing of the proof says a request in flight at a stop is safe, so it
 * is not claimed). When this run removed the launcher (setup had created it), the second
 * restore cannot be typed as `cc-smart-dev-kit restore` any more: the line then names the
 * command that really works — the README's own `bun --no-env-file --config=… …/dist/cli.js
 * restore` form, with this CLI's bundle (`RestoreOptions.cliBundle`, the installed version's
 * own `dist/cli.js`) and the bun running this command (`bunPath`, `process.execPath`), so the
 * line works on a machine whose PATH has no bun.
 */
export function stageOneDone(
  paths: CliPaths,
  cliBundle: string,
  wrote = false,
  bunPath: string = process.execPath,
): string {
  // The switch sentence only when an address was really written: an address the person set,
  // changed or removed is theirs and stays as it is (`offAddressOf`), so its running sessions
  // still use the router until they restart.
  const switched = wrote
    ? "Every running Claude session switches to Anthropic by itself, within about a second — a request one made just before it switched would be cut off by a stop in the same run."
    : "No settings file had an address of ours to switch (an address you set, changed or removed is yours, and restore leaves it), so nothing was written and running Claude sessions may still use the router. Restart them, and change any address of yours that still names the router, before the second run: when the router stops, a session that still uses it fails.";
  const launcher = join(paths.binDir, LAUNCHER_NAME);
  if (existsSync(launcher)) {
    return `${switched} Then run \`${COMMAND} restore\` again to stop and remove the router.`;
  }
  // The same two flags every run of the plugin's own bundles gets, and the plugin's own empty
  // config: the bundle sits in the installed version's folder (`…/<version>/dist/cli.js`), and
  // the config is beside it (`…/<version>/bunfig.toml`).
  const bunfig = bunConfigPath(dirname(dirname(cliBundle)));
  const flags = [shellQuote("--no-env-file"), shellQuote(`--config=${bunfig}`)].join(" ");
  return `${switched} Then run restore again — this one removed the launcher (${tildify(launcher, paths.home)}), so \`${COMMAND}\` is not on your PATH any more: ${shellQuote(bunPath)} ${flags} ${shellQuote(cliBundle)} restore`;
}

/**
 * What running the router means for this machine's service, in the words of the definition
 * `restore` removes: a task on Windows, a unit and its socket on Linux. A machine with no
 * service (macOS) has no definition either.
 */
function serviceFile(paths: CliPaths, service: RouterServiceKind): null | string {
  if (service === "scheduled-task") return paths.routerTaskFile;
  if (service === "systemd") return paths.routerUnitFile;
  return null;
}

export interface RestoreOptions {
  /** `--yes`: stop a running router without asking. */
  yes: boolean;
  /** `--now`: both stages at once, though running sessions still use the router. */
  now: boolean;
  /** This CLI's own bundle (`plugin/dist/cli.js`): what stage 1 names as the second run. */
  cliBundle: string;
  runner: Runner;
  /** The service this machine can run the router under (`routerServiceKind`). */
  service: RouterServiceKind;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  /** Asks the router's port after the stop, until it is closed; a test passes a fake. */
  probe: HealthProbe;
  /** Runs one `claude` command, for the MCP servers setup registered. */
  claude?: (argv: string[]) => { ok: boolean; out: string };
  /** Finds `claude` on PATH; null: the MCP servers are left and said so. */
  which?: (command: string) => null | string;
}

/** Asks before something that cuts running sessions; true to go on. Prints why it stops. */
function askFirst(
  options: RestoreOptions,
  warning: string,
  question: string,
  again: string,
): boolean {
  console.log(warning);
  if (options.yes) return true;
  const yes = options.confirm?.(question) ?? null;
  if (yes === true) return true;
  console.log(
    yes === null ? `Nothing was changed. Run again with --yes ${again}` : "Nothing was changed.",
  );
  return false;
}

function print(results: RestoreResult[], short: (path: string) => string): void {
  for (const result of results) {
    console.log(describe(result, short));
    if (result.savedAs) {
      console.log(`  (its state before this restore: ${short(result.savedAs)})`);
    }
  }
}

/**
 * Takes back the MCP servers setup registered, and the record of them. A server the person
 * re-pointed is theirs and stays; its record goes either way, so a later restore does not try
 * it again. Returns the lines to print.
 *
 * Stage 1 takes these back too: a registered server only affects a session that starts later,
 * and every session that already started one keeps the server it is running.
 *
 * `ok` is false when a server could not be taken back (its record stays, so a later restore
 * tries again) or the record could not be read (it stays, for the person to fix): `restore`
 * then exits 1 (ST-12, ST-5).
 *
 * A caller that passes no `claude` runner gets no MCP handling at all — `removeMcpServers`
 * would only be able to say it cannot run the command. `cc-smart-dev-kit restore` always
 * passes both (`src/entries/cli.ts`).
 */
function removeMcp(
  paths: CliPaths,
  options: RestoreOptions,
  short: (path: string) => string,
): { lines: string[]; ok: boolean } {
  if (options.claude === undefined || options.which === undefined) return { lines: [], ok: true };
  const removal = removeMcpServers(paths, options.claude, options.which, false);
  for (const name of removal.forgotten) forgetMcpServer(paths.stateDir, name);
  const lines = [...removal.removed, ...removal.notes];
  const ok = !removal.recordsUnreadable && removal.kept.length === 0;
  // Nothing left to take back: the record file goes with its last entry. A file that did not
  // read is never "nothing left": it may still name what setup registered.
  if (ok && existsSync(mcpRecordsFile(paths.stateDir))) {
    rmSync(mcpRecordsFile(paths.stateDir), { force: true });
    lines.push(
      `- ${short(mcpRecordsFile(paths.stateDir))}: removed (the record of the MCP servers)`,
    );
  }
  return { lines, ok };
}

/**
 * The browser's own part: the token file, and the extension pre-registration setup added on
 * Windows (`browserRestoreLines`). The macOS pre-registration is a managed file, so `restore`
 * handles it above.
 *
 * **Chrome's `claude-code` profile and the installed extension are never touched**, and the lines
 * say so: they are the person's browser data, not cc-smart-dev-kit's. The profile's display name in
 * `Local State` is the one exception — it is a managed change, so `restore` puts it back, and every
 * other byte of that file is left as it is.
 */
function removeBrowser(
  paths: CliPaths,
  record: BrowserSetupRecord,
  runner: Runner,
): { lines: string[] } {
  const done = browserRestoreLines(paths, { record, run: (argv) => runner(argv) });
  const lines = [...done.lines];
  if (done.profileTouched) {
    lines.push(
      "  Chrome's \"claude-code\" profile and the Playwright extension stay exactly as they are: they are your browser's, not cc-smart-dev-kit's.",
    );
  }
  return { lines };
}

/**
 * Restore takes the instructions out, so their two state files go too: the version stamp,
 * and the stored `setup --no-instructions` (a setup after a restore starts fresh). Prints a
 * line when a stored choice was forgotten; true when it was.
 */
function forgetInstructionChoice(stateDir: string, short: (path: string) => string): boolean {
  const forgotten = forgetInstructionsState(stateDir);
  if (forgotten === null) return false;
  console.log(
    `- ${short(forgotten)}: removed (your --no-instructions choice; the next setup installs the instructions)`,
  );
  return true;
}

/**
 * Restore takes the person's claude-mem writes from the portal out with the other owned keys,
 * so the record that marks them as the person's goes too (`forgetClaudeMemChoices`): a setup
 * after it follows the scout slot again. Prints a line when there was one; true when it was.
 */
function forgetClaudeMemChoice(stateDir: string, short: (path: string) => string): boolean {
  const forgotten = forgetClaudeMemChoices(stateDir);
  if (forgotten === null) return false;
  console.log(
    `- ${short(forgotten)}: removed (your claude-mem choices from the portal; the next setup follows the scout slot again)`,
  );
  return true;
}

/**
 * Puts the values a take-over recorded back, before this command's own pass
 * (`restoreTakenOver`): `restore` takes the records out with the keys, and the value to write
 * back lives in the record. It runs in both stages.
 *
 * A value cc-smart-dev-kit never wrote is not its to remove: without this, a restore would take
 * away the values the person had before the take-over. A key is the exception — its value is
 * never written down, so what it gets depends on what it holds (`restoreTakenOver`, `SecretPlan`):
 * left as it is while it is still theirs, their own key back from the backup when the kit's key
 * was written for an address that goes back.
 *
 * A failure here is one line, and the restore itself still runs — but **not on claude-mem's
 * file**: the plain pass would put the address back and leave the kit's key beside it, and it
 * would drop the records the next run needs. So the file is held back (it stays tracked, with its
 * records), the line says so, and the restore exits 1. Returns the files to leave.
 */
async function takeOverBack(paths: CliPaths): Promise<string[]> {
  try {
    for (const line of (await restoreTakenOver(paths)).lines) console.log(line);
    return [];
  } catch (error) {
    console.log(`! the values a take-over recorded could not be put back (${messageOf(error)})`);
    console.log(
      "! claude-mem's file is left as it is: run restore again to put them back, and take the rest out.",
    );
    return [realTarget(paths.claudeMemSettingsFile)];
  }
}

/**
 * Does this settings file mean some session reading it still sends its requests to the router
 * (GP4a)? A gateway key of ours that still holds our value says so — **unless the file's own
 * address is Anthropic's**: `gateway project off` writes exactly that address (P1), the session
 * goes to Anthropic on the person's own login, and no key beside it brings the router back. A
 * file with **no address** but another key of ours still answers yes: a session that started
 * while the address was there keeps it after the key is removed, unless another file sets one
 * (P7). A file that cannot be read answers yes too: a key that is there but unreadable must keep
 * every session working (`ownedGatewayEnvKeys`' own rule).
 */
function fileUsesRouter(file: string, stateDir: string): boolean {
  if (ownedGatewayEnvKeys(file, stateDir).length === 0) return false;
  try {
    // The one reader of a settings file's own gateway facts (`project-state.ts` reads it too).
    const url = readGatewaySettings(file).baseUrl;
    // An absent address key with another owned key still routes running sessions to the router
    // (a removed key reaches them only when another file sets it, P7): keep the answer — at worst
    // the router runs a run longer than it had to. A set address is "on" only
    // when it points at a gateway, not at Anthropic's own.
    if (url === null) return true;
    return baseUrlPointsAtGateway(url);
  } catch {
    return true;
  }
}

/**
 * The copies of a personal file we wrote that sit in a project's linked worktrees and hold a
 * gateway address (P6, 2.1.310): a project's `.worktreeinclude` makes them. Claude Code reads a
 * worktree's own `settings.local.json` after the main root's, key by key — so while the root's
 * key says Anthropic's address (stage 1) the copy changes nothing, and once restore removes that
 * key (stage 2) a session started in the worktree goes to its copy's address, a router that is
 * stopped. The kit did not write the copy, so restore reports it and leaves it as it is
 * (`.claude/rules/setup-and-managed-files.md` § Never take what is not ours).
 */
function copyWarnings(settingsFiles: readonly string[], short: (path: string) => string): string[] {
  const lines: string[] = [];
  for (const file of settingsFiles) {
    const claudeDir = dirname(file);
    if (basename(file) !== PERSONAL_FILE || basename(claudeDir) !== ".claude") continue;
    for (const copy of gatewayCopiesAmong(linkedWorktreeFilesOf(dirname(claudeDir)))) {
      lines.push(
        `! ${short(copy.path)} holds ${shownValue(copy.url ?? "")}: it is a copy the kit did not write, so restore leaves it, and a session started in that worktree goes to that address once the root's key is gone. Fix: remove the key from that file by hand`,
      );
    }
  }
  return lines;
}

/**
 * The settings files whose address must be **written again** rather than removed, keyed by
 * their real path, and the address each one gets (`offAddressOf`, GP5). An empty map when
 * no file of ours still points at the router: nothing to switch, and the plain removal is what
 * `restore` does with every key.
 */
function offWrites(files: readonly string[], stateDir: string): Map<string, string> {
  const writes = new Map<string, string>();
  for (const file of files) {
    const address = offAddressOf(file, stateDir);
    if (address.kind === "write") writes.set(realTarget(file), address.value);
  }
  return writes;
}

/**
 * Restore also undoes the router service when `gateway setup` installed it. Running Claude
 * sessions follow a **changed** `ANTHROPIC_BASE_URL` within about a second, but a **removed**
 * key reaches one only when another settings file still sets it (P7, re-proved on 2.1.310;
 * `docs/claude-code-contract.md` § The gateway): with none, the session keeps the address it
 * last had, and with a router address further down the chain it moves there. So while cc-smart-dev-kit's gateway env keys are in any
 * of the settings files it wrote — the user's `settings.json`, a project's own
 * `settings.local.json` or team `.claude/settings.json` (GP4a) — those sessions still send
 * requests to the router, and stopping it in the same run would make each of them fail. (A key
 * cc-smart-dev-kit set and the person changed since is theirs, and does not count here:
 * `ownedGatewayEnvKeys` keeps only the keys that still hold cc-smart-dev-kit's value.) So, with
 * the router installed:
 *   - stage 1, while such a key is in any of those files (**and the file's address is not
 *     already Anthropic's**): everything is restored **except the router's copy and units** and
 *     except each file's address key, which is **written to Anthropic's own address** instead
 *     of being removed (GP5, `writeInstead`). The seconds a running session needs to follow
 *     that change are what the stages are for: the router keeps running until the second run,
 *     because nothing proves a request in flight is safe when it stops — so the stop is left to
 *     a run the person starts after the change has had its second. The sessions themselves need
 *     no restart any more.
 *   - stage 2, with no such key left (the files' addresses are Anthropic's now, so nothing
 *     routes to the router): it disables and stops the unit and its socket (asking first when it
 *     runs, because that cuts answers in flight), waits up to 15 s for its port to close
 *     (`stopRouter`; the drain goes on in the background), restores the rest — the address keys
 *     among them, now plain removals — reloads systemd, and clears the restart-pending marker.
 *   - `--now`: both at once, after the warning that every running session fails until it
 *     restarts (asked, or `--yes`).
 */
export async function runRestore(paths: CliPaths, options: RestoreOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  const changed = readChanged(paths.stateDir);
  // The browser's record is read BEFORE `restore` runs: the record file is a managed file, so
  // restore takes it back, and what it says is what the browser's own cleanup has to undo.
  const browserRecord = readBrowserSetupRecord(paths.stateDir);
  const routerFiles = [
    realTarget(paths.routerCopy),
    realTarget(paths.routerUnitFile),
    realTarget(paths.routerSocketFile),
    realTarget(paths.routerTaskFile),
  ];
  const routerTracked = routerFiles.some((file) => Object.hasOwn(changed, file));
  // The service's own definition: the unit file on Linux, the task's on Windows.
  const definition = serviceFile(paths, options.service);
  const definitionTracked = definition !== null && Object.hasOwn(changed, realTarget(definition));
  // The service this machine runs the router under, for its state and its stop. The account
  // a Windows task would run as is not needed: restore writes no definition.
  const service = routerService({
    account: null,
    paths,
    runner: options.runner,
    service: options.service,
  });
  // A key the person changed since is theirs: `ownedGatewayEnvKeys` leaves it out, so it
  // does not keep the router up for sessions that no longer point at it.
  //
  // **Every settings file the kit wrote, not only the user's** (GP4a): a project's own
  // `ANTHROPIC_BASE_URL` (its `settings.local.json` or team `.claude/settings.json`, GP2) keeps
  // that project's sessions on the router just as the machine's key does, so stage 1 must wait
  // for them too — stopping the router in the same pass would cut their answers off.
  const settingsFiles = Object.entries(changed)
    .filter(([, entry]) => entry.kinds.includes("json-keys"))
    .map(([file]) => file);
  const sessionsUseRouter =
    routerTracked && settingsFiles.some((file) => fileUsesRouter(file, paths.stateDir));
  // Read before `restore` forgets the records: only a router that will stop makes them matter.
  const copies = routerTracked ? copyWarnings(settingsFiles, short) : [];

  if (sessionsUseRouter && !options.now) {
    // Stage 1: nothing stops, so nothing is asked. Every file still pointing at the router gets
    // the explicit address written into it (GP5), so its running sessions switch by themselves.
    return withLock(
      paths.stateDir,
      async () => {
        const heldBack = await takeOverBack(paths);
        // Inside the lock: the settings can change while the lock waits (a `gateway on`, a hand
        // edit), so the address each file gets is read now, not before the wait.
        const addresses = offWrites(settingsFiles, paths.stateDir);
        // A personal file kept for stage 2 must keep its `.git/info/exclude` line too: the line
        // is a separate `file-line` entry, and removing it here would let git see the file
        // (holding Anthropic's address) and commit it to the team. So the exclusion lines stay
        // tracked while any address is written; stage 2 removes them with the personal files.
        const excludeFiles =
          addresses.size === 0
            ? []
            : Object.entries(changed)
                .filter(
                  ([, entry]) =>
                    entry.kinds.includes("file-line") &&
                    entry.lines?.includes(PERSONAL_EXCLUDE_LINE),
                )
                .map(([file]) => file);
        const results = restore(paths.stateDir, {
          except: [...routerFiles, ...excludeFiles, ...heldBack],
          writeInstead: (file, path) => {
            const address = addresses.get(file);
            return samePath(path, BASE_URL_PATH) && address !== undefined
              ? { value: address }
              : undefined;
          },
        });
        print(results, short);
        for (const line of copies) console.log(line);
        // A retired model key is removed in this same write: a running session keeps the slot
        // name and now sends it to Anthropic, which does not know it, so it fails until it
        // restarts. Say so; the address key's change needs no restart.
        const removedRetired = results.some((result) =>
          result.details.some((detail) =>
            RETIRED_GATEWAY_ENV_KEYS.some((key) => detail.includes(key)),
          ),
        );
        if (removedRetired) {
          console.log(
            "  The retired model keys are removed, and apply at each session's next restart: until then a running session sends its slot name to Anthropic and fails.",
          );
        }
        const mcp = removeMcp(paths, options, short);
        for (const line of mcp.lines) console.log(line);
        for (const line of removeBrowser(paths, browserRecord, options.runner).lines) {
          console.log(line);
        }
        forgetInstructionChoice(paths.stateDir, short);
        forgetClaudeMemChoice(paths.stateDir, short);
        console.log(stageOneDone(paths, options.cliBundle, addresses.size > 0));
        return !mcp.ok || heldBack.length > 0 || results.some((r) => r.action === "no-backup")
          ? 1
          : 0;
      },
      { waitMs: 10_000 },
    );
  }

  // Stage 2 (and `--now`): before the question, so the person decides with these in sight.
  for (const line of copies) console.log(line);
  if (sessionsUseRouter) {
    if (
      !askFirst(
        options,
        NOW_WARNING,
        "Stop cc-smart-dev-kit-router and restore everything now?",
        `to do it now: ${COMMAND} restore --now --yes`,
      )
    ) {
      return 1;
    }
  } else if (definitionTracked && service.running(options.runner)) {
    if (
      !askFirst(
        options,
        STOP_WARNING,
        "Stop cc-smart-dev-kit-router and restore?",
        `to stop it: ${COMMAND} restore --yes`,
      )
    ) {
      return 1;
    }
  }

  return withLock(
    paths.stateDir,
    async () => {
      if (definitionTracked) {
        // The port the router listens on: the config's. An unusable config leaves it
        // unknown; the stop is sent all the same, with no port to wait for. (Its health
        // answer names its port too, but it can only be asked on a port already known.)
        let port: null | number;
        try {
          port = configuredPort(paths.gatewayConfigFile);
        } catch (error) {
          console.log(`  cannot read the router's port (${messageOf(error)}); not waiting for it`);
          port = null;
        }
        const stopped = await service.stop(options.runner, port, options.probe);
        // The service's own words: systemd disables the units and stops them (the drain
        // goes on in the background); Windows removes the task, and its router with it.
        const windows = options.service === "scheduled-task";
        const where = windows ? TASK_LABEL : UNITS;
        // What "was not running" is asked of: the service itself, not both of its units.
        const subject = windows ? TASK_LABEL : UNIT_NAME;
        const gone = windows ? "removed" : "disabled and stopped";
        switch (stopped.kind) {
          case "closed":
            console.log(
              windows
                ? `- ${where}: removed (port ${port} closed)`
                : `- ${where}: disabled and stopped (port ${port} closed; answers in flight finish in the background)`,
            );
            break;
          case "no-port":
            console.log(windows ? `- ${where}: removed` : `- ${where}: disabled and stopping`);
            break;
          case "not-running":
            console.log(
              windows
                ? `  ${subject} was not running (its state is ${stopped.state}); not waiting for port ${port}`
                : `  ${subject} was not running (systemctl --user is-active: ${stopped.state}); not waiting for port ${port}`,
            );
            console.log(`- ${where}: ${gone}`);
            break;
          case "other":
            console.log(
              `  port ${port} answers, but not as this router (${stopped.detail}); not waiting for it`,
            );
            console.log(windows ? `- ${where}: removed` : `- ${where}: disabled and stopping`);
            break;
        }
      }
      const heldBack = await takeOverBack(paths);
      const results = restore(paths.stateDir, { except: heldBack });
      if (definitionTracked) service.forget(options.runner);
      // The MCP servers setup registered, and the record of them.
      const mcp = removeMcp(paths, options, short);
      const browser = removeBrowser(paths, browserRecord, options.runner);
      // The router is gone: a setup that did not finish has nothing left to finish.
      rmSync(restartPendingFile(paths.stateDir), { force: true });
      // So is its limit state: no status line or alert may read a stale fallback from it.
      const stateGone = routerTracked && existsSync(paths.gatewayStateFile);
      if (stateGone) rmSync(paths.gatewayStateFile, { force: true });
      print(results, short);
      if (stateGone) {
        console.log(`- ${short(paths.gatewayStateFile)}: removed (the router's limit state)`);
      }
      for (const line of mcp.lines) console.log(line);
      for (const line of browser.lines) console.log(line);
      const forgotInstructions = forgetInstructionChoice(paths.stateDir, short);
      const forgotChoices = forgetClaudeMemChoice(paths.stateDir, short);
      const forgot = forgotInstructions || forgotChoices;
      if (
        results.length === 0 &&
        !stateGone &&
        mcp.lines.length === 0 &&
        browser.lines.length === 0
      ) {
        if (!forgot) console.log("Nothing to restore: cc-smart-dev-kit has nothing in any file.");
        return heldBack.length > 0 ? 1 : 0;
      }
      return !mcp.ok || heldBack.length > 0 || results.some((r) => r.action === "no-backup")
        ? 1
        : 0;
    },
    { waitMs: 10_000 },
  );
}
