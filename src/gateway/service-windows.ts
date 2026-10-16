/**
 * The router as a per-user Scheduled Task on Windows: the task's definition (an XML file
 * beside the router copy), the PowerShell commands that register, start, stop and remove
 * it, and the driver `installRouter` drives (`./service.ts`).
 *
 * Why a task, and not a Windows service: `sc create`, NSSM and WinSW make a machine-wide
 * service, which needs an administrator. A task in the per-user Task Scheduler runs at the
 * person's logon, as that person, with no elevation: the same reach as systemd's `--user`
 * units on Linux. It runs the router's copy with the absolute path of the bun that ran
 * setup, and `--no-env-file`, exactly as the unit does.
 *
 * What Windows does not have, so what this driver does not promise:
 *
 *   - **No socket activation.** On Linux systemd holds the port
 *     (`cc-smart-dev-kit-router.socket`), so a restart refuses no request. Here the router
 *     binds 127.0.0.1:<port> itself (the `gateway serve` way, `router.ts`), so a restart
 *     stops it and starts it again, and requests are refused for that moment (Claude Code
 *     retries them). `TASK_RESTART_WARNING` says so before the question.
 *   - **No drain on a stop.** `Stop-ScheduledTask` terminates the process, so the router's
 *     SIGTERM drain (`listen.ts`, `router.ts`) never runs here: an answer in flight is cut.
 *   - **No journal.** A task has no console, so the router's log goes nowhere. Watching it
 *     means stopping the task and running `cc-smart-dev-kit gateway serve` in a terminal;
 *     `logHint` says that, and the task's last result code is what `doctor` shows.
 *
 * Every command is PowerShell, never `schtasks`: `schtasks` prints localized words (a task
 * is "Ready" in one Windows language and "Bereit" in another), while `Get-ScheduledTask`
 * answers with Task Scheduler's own state names and numbers, which are the same everywhere.
 * Registering a task that runs as the current user, at their logon, with the least
 * privilege (`LeastPrivilege`) needs no elevation.
 *
 * The task the definition file describes (everything else is a Task Scheduler default this
 * driver does not want): it may be started on demand (`AllowStartOnDemand`); a second copy
 * is never started (`IgnoreNew`); it starts on a battery, and keeps running when the
 * machine goes on one (a laptop would otherwise not run the router); a missed logon trigger
 * still starts it (`StartWhenAvailable`); the machine going idle does not stop it; it has
 * no time limit (`ExecutionTimeLimit` `PT0S`: Task Scheduler's default is three days); and
 * Task Scheduler restarts it after a crash (`RestartOnFailure`, 3 times, a minute apart:
 * the nearest thing to systemd's `Restart=always`). The port sits in the description: the
 * router reads its port from `gateway.json`, so the definition would otherwise not change
 * when the port does, and setup would never restart the router on a moved port (on Linux
 * the socket unit changes there).
 */

import { COMMAND } from "../build-info";
import { powershellLiteral } from "../shell/powershell";
import { waitWhileRouterAnswers } from "./health";
import { oneLine } from "./plain-text";
import {
  type RestartPlan,
  type RouterService,
  type Runner,
  type ServiceDefinition,
  type ServiceInput,
  STOP_WAIT_MS,
  type StopResult,
} from "./service";

/** The Scheduled Task's name: what `Get-ScheduledTask` and Task Scheduler show. */
export const TASK_NAME = "cc-smart-dev-kit-router";

/** What every message calls it. */
export const TASK_LABEL = `the task ${TASK_NAME}`;

/**
 * Said before the restart that stops a running router and starts it again, and before the
 * question. Never the Linux sentence: there the socket keeps the port open, so no request
 * is refused. Here it is.
 */
export const TASK_RESTART_WARNING = `the task ${TASK_NAME} is running. A restart stops it and starts it again, so new requests are refused for a moment (Claude Code retries them). Windows has no socket that holds the router's port across a restart, so this restart cannot promise what a Linux one does: that no request fails.`;

/** Every warning this driver says before the question. */
export const TASK_WARNINGS: readonly string[] = [TASK_RESTART_WARNING];

/** How long `activate` waits for a stopped router's port to close before the new one starts. */
export const TASK_STOP_WAIT_MS = 5_000;

const POWERSHELL = "powershell";
const PS_FLAGS = ["-NoProfile", "-NonInteractive", "-Command"];

/** The Task Scheduler's answer about the task: its state, its last result, and its action. */
export interface TaskFacts {
  registered: boolean;
  /** Its state in Task Scheduler's own words: `Running`, `Ready`, `Disabled`, `not registered`. */
  state: string;
  /** The last run's result code (0: it ran and exited 0), or null when there is none. */
  lastResult: null | number;
  /** What the task runs: the program, its arguments and its folder. */
  action: null | { arguments: string; execute: string; workingDirectory: string };
}

/**
 * The PowerShell that answers about the task. `Get-ScheduledTask` answers with the task's
 * own state names (`Running`, `Ready`, `Disabled`, `Queued`, `Unknown`) and its result
 * codes; neither is translated. A machine with no such task prints `registered=false`.
 */
function taskQuery(): string {
  return [
    `$n=${powershellLiteral(TASK_NAME)}`,
    "$t=Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue",
    `if($null -eq $t){'registered=false'}else{$a=@($t.Actions)[0];'registered=true'`,
    `'state='+$t.State`,
    `'last='+(Get-ScheduledTaskInfo -TaskName $n).LastTaskResult`,
    `'execute='+$a.Execute`,
    `'arguments='+$a.Arguments`,
    `'working='+$a.WorkingDirectory}`,
  ].join(";");
}

/** One line of PowerShell's own output, by its `key=` prefix (`null` when it printed none). */
function fieldOf(lines: readonly string[], key: string): null | string {
  const prefix = `${key}=`;
  const line = lines.find((one) => one.startsWith(prefix));
  return line === undefined ? null : line.slice(prefix.length).trim();
}

/** `taskFacts` from PowerShell's answer, so a test drives the parsing without Windows. */
export function parseTaskFacts(output: string): TaskFacts {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  if (fieldOf(lines, "registered") !== "true") {
    return { action: null, lastResult: null, registered: false, state: "not registered" };
  }
  const state = fieldOf(lines, "state") ?? "unknown";
  const last = fieldOf(lines, "last");
  const lastResult = last !== null && /^-?\d+$/.test(last) ? Number(last) : null;
  const execute = fieldOf(lines, "execute");
  return {
    action:
      execute === null
        ? null
        : {
            arguments: fieldOf(lines, "arguments") ?? "",
            execute,
            workingDirectory: fieldOf(lines, "working") ?? "",
          },
    lastResult,
    registered: true,
    state,
  };
}

/** The task's state, its last result and its action, from Task Scheduler. */
export function taskFacts(runner: Runner): TaskFacts {
  const result = runner([POWERSHELL, ...PS_FLAGS, taskQuery()]);
  if (result.exitCode !== 0) {
    throw new Error(
      `could not ask Windows about ${TASK_LABEL} (exit ${result.exitCode}): ${oneLine(result.output, 300)}`,
    );
  }
  return parseTaskFacts(result.output);
}

/** True when the task runs now. */
export function taskRunning(runner: Runner): boolean {
  return taskFacts(runner).state === "Running";
}

/** Throws with PowerShell's own words when a command that must work failed. */
function runTask(runner: Runner, script: string, what: string): void {
  const result = runner([POWERSHELL, ...PS_FLAGS, script]);
  if (result.exitCode !== 0) {
    throw new Error(`${what} failed (exit ${result.exitCode}): ${oneLine(result.output, 300)}`);
  }
}

/** Registers the task from its definition file, replacing a task of the same name. */
function registerTask(runner: Runner, taskPath: string): void {
  runTask(
    runner,
    `Register-ScheduledTask -TaskName ${powershellLiteral(TASK_NAME)} -Xml (Get-Content -Raw -Encoding UTF8 -LiteralPath ${powershellLiteral(taskPath)}) -Force | Out-Null`,
    `registering ${TASK_LABEL}`,
  );
}

function startTask(runner: Runner): void {
  runTask(
    runner,
    `Start-ScheduledTask -TaskName ${powershellLiteral(TASK_NAME)}`,
    `starting ${TASK_LABEL}`,
  );
}

function stopTask(runner: Runner): void {
  runTask(
    runner,
    `Stop-ScheduledTask -TaskName ${powershellLiteral(TASK_NAME)}`,
    `stopping ${TASK_LABEL}`,
  );
}

function unregisterTask(runner: Runner): void {
  runTask(
    runner,
    `Unregister-ScheduledTask -TaskName ${powershellLiteral(TASK_NAME)} -Confirm:$false`,
    `removing ${TASK_LABEL}`,
  );
}

/** The Windows account the task runs as (`MACHINE\user`), from the environment Windows sets. */
export function windowsAccount(env: Record<string, string | undefined>): null | string {
  const domain = env.USERDOMAIN?.trim();
  const name = env.USERNAME?.trim();
  if (!name) return null;
  return domain ? `${domain}\\${name}` : name;
}

/** The XML escaping Task Scheduler needs: `&`, `<` and `>` are its markup. */
function xmlEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A path the task's XML holds. Task Scheduler's markup is escaped, but a quote would end
 * the argument that carries the copy's path, and a control character cannot be written at
 * all: refused, as `checkUnitPath` refuses one for a unit file.
 */
function checkTaskPath(path: string): void {
  if (/["\p{Cc}]/u.test(path)) {
    throw new Error(`cannot put ${JSON.stringify(path)} in the task's definition`);
  }
}

export interface TaskDefinitionInput {
  /** The account the task runs as: `MACHINE\user`. */
  account: string;
  bunPath: string;
  copyPath: string;
  home: string;
  /** The port the router serves on: the definition names it, so a moved port registers again. */
  port: number;
}

/**
 * The task's definition, as `Register-ScheduledTask -Xml` takes it. The port sits in the
 * description on purpose: the router reads its port from `gateway.json`, so nothing else in
 * the definition would change when the port does, and setup would never restart the router
 * on a moved port (on Linux the socket unit changes there).
 */
export function renderTask(options: TaskDefinitionInput): string {
  for (const path of [options.bunPath, options.copyPath, options.home]) checkTaskPath(path);
  const account = xmlEscape(options.account);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${TASK_NAME}: the local CC gateway for Claude Code (127.0.0.1 only).
     Written by \`${COMMAND} gateway setup\`; it is registered as a Scheduled Task with
     \`Register-ScheduledTask -Xml\`. The next setup overwrites it; edits here are lost. -->
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Local CC gateway for Claude Code (127.0.0.1:${options.port} only). Written by \`${COMMAND} gateway setup\`.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${account}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${account}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(options.bunPath)}</Command>
      <Arguments>--no-env-file "${xmlEscape(options.copyPath)}"</Arguments>
      <WorkingDirectory>${xmlEscape(options.home)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** What the definition runs: the program, its arguments and its folder. */
export function taskAction(input: { bunPath: string; copyPath: string; home: string }): {
  arguments: string;
  execute: string;
  workingDirectory: string;
} {
  return {
    arguments: `--no-env-file "${input.copyPath}"`,
    execute: input.bunPath,
    workingDirectory: input.home,
  };
}

/** Windows paths differ in case between programs: compare them folded, with the ends trimmed. */
function samePath(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** True when the registered task runs this copy of the router, whatever else it holds. */
export function taskRunsCopy(facts: TaskFacts, copyPath: string): boolean {
  const action = facts.action;
  if (action === null) return false;
  return action.arguments.toLowerCase().includes(copyPath.trim().toLowerCase());
}

/** True when the registered action is the one setup writes for this copy. */
function actionCurrent(facts: TaskFacts, input: ServiceInput): boolean {
  if (facts.action === null) return false;
  const wanted = taskAction({
    bunPath: input.bunPath,
    copyPath: input.copyPath,
    home: input.home,
  });
  return (
    samePath(facts.action.execute, wanted.execute) &&
    samePath(facts.action.arguments, wanted.arguments) &&
    samePath(facts.action.workingDirectory, wanted.workingDirectory)
  );
}

/**
 * The Windows router service: a per-user Scheduled Task that runs the router copy at logon.
 * `taskPath` is where its definition lives (`paths.routerTaskFile`).
 */
export function scheduledTaskService(options: {
  taskPath: string;
  /** Used only to ask Windows which account this is when the environment has no answer. */
  runner: Runner;
  /** The account the task runs as (`MACHINE\user`); Windows' own answer when it is null. */
  account: null | string;
}): RouterService {
  const { taskPath } = options;
  let account: null | string = options.account?.trim() || null;
  /**
   * The account the task runs as. `process.env` carries it on every Windows machine; when
   * it does not, Windows itself is asked once, and the answer is kept.
   */
  const accountNow = (): string => {
    if (account === null) {
      const result = options.runner([
        POWERSHELL,
        ...PS_FLAGS,
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
      ]);
      const name = result.output.trim().split("\n")[0]?.trim() ?? "";
      if (result.exitCode !== 0 || name === "") {
        throw new Error(
          `could not tell which Windows account this is (exit ${result.exitCode}): ${oneLine(result.output, 300)}`,
        );
      }
      account = name;
    }
    return account;
  };
  const logHint = `stop ${TASK_LABEL} (\`Stop-ScheduledTask -TaskName ${TASK_NAME}\`) and run \`${COMMAND} gateway serve\` in a terminal: a task has no console, so the router's log goes nowhere else`;
  const definition = (input: ServiceInput): ServiceDefinition => ({
    id: "task",
    path: taskPath,
    text: renderTask({
      account: accountNow(),
      bunPath: input.bunPath,
      copyPath: input.copyPath,
      home: input.home,
      port: input.port,
    }),
    what: "task",
  });

  return {
    async activate(runner, input, plan: RestartPlan): Promise<void> {
      if (plan.running) {
        input.say(`restarting ${TASK_LABEL} (new requests are refused until it answers)`);
        stopTask(runner);
        // A stop terminates the router at once, so its port is free within milliseconds;
        // wait for it to be really free, or the new router cannot bind it.
        const waited = await waitWhileRouterAnswers(input.port, input.probe, TASK_STOP_WAIT_MS);
        if (waited.state === "held") {
          throw new Error(
            `${TASK_LABEL} was stopped, but 127.0.0.1:${input.port} still answers after ${TASK_STOP_WAIT_MS / 1000} s, so the new router cannot bind it. Nothing was started. Stop what holds that port, then run: ${COMMAND} gateway setup`,
          );
        }
        if (waited.state === "other") {
          input.say(
            `port ${input.port} answers, but not as this router (${waited.detail}); starting ${TASK_LABEL} all the same`,
          );
        }
      }
      startTask(runner);
    },
    afterWrite(runner): void {
      registerTask(runner, taskPath);
    },
    current(runner, input): boolean {
      const facts = taskFacts(runner);
      return facts.registered && actionCurrent(facts, input);
    },
    definitions(input): ServiceDefinition[] {
      return [definition(input)];
    },
    ensureRunning(runner): void {
      // Nothing changed: start it if it is stopped; leave a running router alone.
      if (!taskRunning(runner)) startTask(runner);
    },
    forget(): void {
      // `stop` unregisters the task: nothing of Task Scheduler's is left behind.
    },
    listenerUp(runner): boolean {
      // The router itself holds its port here (there is no socket unit), so "the service
      // holds the port" and "the router runs" are the same question.
      return taskRunning(runner);
    },
    logHint,
    name: TASK_LABEL,
    noAnswer(runner, port, waitedMs): string {
      const facts = taskFacts(runner);
      const last = facts.lastResult === null ? "" : `, last run result ${facts.lastResult}`;
      return `the router did not answer on 127.0.0.1:${port} within ${waitedMs / 1000} s of the task's start (${TASK_LABEL} is ${facts.state}${last}). See why: ${logHint}. Then run: ${COMMAND} gateway setup again.`;
    },
    plan(listenerUp, running, outcomes): RestartPlan {
      // Every restart here stops the router and starts it again, so it refuses requests
      // for that moment, whatever changed. On Linux `rebind` is true only for the ways
      // that (re)open the socket.
      return { listenerUp, outcomes, rebind: true, running };
    },
    restartWarning(): string {
      return TASK_RESTART_WARNING;
    },
    running(runner): boolean {
      return taskRunning(runner);
    },
    async stop(runner, port, probe): Promise<StopResult> {
      const before = taskFacts(runner);
      if (!before.registered) return { kind: "not-running", state: "not registered" };
      // The task must not start the router at logon again after a restore: stop it, remove it.
      if (before.state === "Running") stopTask(runner);
      unregisterTask(runner);
      if (port === null) return { kind: "no-port" };
      if (before.state !== "Running") return { kind: "not-running", state: before.state };
      const result = await waitWhileRouterAnswers(port, probe, STOP_WAIT_MS);
      if (result.state === "free") return { kind: "closed" };
      if (result.state === "other") return { detail: result.detail, kind: "other" };
      throw new Error(
        `${TASK_LABEL} was removed, but 127.0.0.1:${port} still takes connections after ${STOP_WAIT_MS / 1000} s. Nothing else was restored. Stop what holds that port, then run ${COMMAND} restore again.`,
      );
    },
    state(runner): string {
      return taskFacts(runner).state;
    },
    started: `registered and (re)started ${TASK_LABEL}`,
    warnings: TASK_WARNINGS,
  };
}
