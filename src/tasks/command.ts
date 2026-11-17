import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseOptions } from "../cli/args";
import { usageError } from "../cli/help";
import { cliPaths } from "../cli/paths";
import { createOut, dryRunEnding, plural } from "../cli/ui/out";
import { currentTerminal } from "../cli/ui/terminal";
import { DEPLOY_TASKS_SINCE } from "../project/config";
import { locateCheckout } from "../project/resolve";
import { insideClaudeCode } from "../workflow/commands";
import { baseBranch } from "../worktrees/command";
import { taskContext } from "./context";
import { branchTaskChanges, readGitFacts, refCommit, unmergedBranchTasks } from "./deploy/branch";
import { checkDeployTasks } from "./deploy/check";
import { scanDeployTasks } from "./deploy/files";
import { DEPLOY_ENVS, DEPLOY_STEPS, DEPLOY_TYPES, type DeployEnv } from "./deploy/format";
import { gateAfter, gateBefore, releaseList } from "./deploy/release";
import { createTaskOps, projectLine, type TaskOperation } from "./ops";
import { TASK_COMMAND } from "./words";
import { openWorkDb, workDbFile } from "./work/db";
import { importClaudeMem } from "./work/import-claude-mem";

const KIND_LIST: readonly string[] = ["work", ...DEPLOY_ENVS];
const KINDS = KIND_LIST.join("|");
const TYPES = DEPLOY_TYPES.join("|");
const STEPS = DEPLOY_STEPS.join("|");
const ENVS = DEPLOY_ENVS.join("|");

export const TASK_USAGE = `Usage: ${TASK_COMMAND} <command>

add <subject> [--description <text> | --file <path|->] [--kind ${KINDS}]
    [--parent <ref>] [--start] [--type ${TYPES}] [--blocked-by <ref>]...
    [--phase <id>] [--plan <slug>]
    [--agent <id>] [--branch <name>] [--worktree <absolute-path>] [--base <sha>]
    [--deploy ${STEPS}] [--pair] [--flag <flag>]... [--ref <path>]...
set <ref> [--type ${TYPES}] [--deploy ${STEPS}] [--block <ref>]... [--unblock <ref>]... [--parent <ref> | --top]
    Bindings on set/start: --agent <id> --branch <name> --worktree <absolute-path> --base <sha>
start <ref>
done <ref> [--evidence <text>] [--note <text>]
drop <ref> [--note <text>]
reopen <deploy-task-id>
note <ref> [<text> | --file <path|->]
list [--scope mine|plan|project|all] [--plan <slug>] [--json]
take <plan-slug|#n> [--from <session>] [--force]
list --branch [--base <branch>]
list --branches
show <ref> [--offset <n>] [--history]
search <text> [--all]
check [--json]
release [${ENVS}] [--before | --after] [--ref <ref>] [--json]
import claude-mem [--project <name>] [--dry-run]
delete <ref>
mcp

Work tasks stay on this machine. A deploy task (--kind ${DEPLOY_ENVS.join(" or ")}) is a step owed
before or after a deploy: it needs --deploy and --type, and its file travels with your branch, so
commit it. --pair, with --kind staging, makes the staging task and its prod twin together.
Deploy tasks close with done --evidence <text>, or drop --note <reason>; only the person drops a
blocking one, in their own terminal. reopen puts a closed one back after a rolled-back deploy.
release <env> --before / --after is the gate around a deploy; --ref defaults to origin/<base>.
With no flag, release lists the open deploy tasks.
Layers: plan › phase › task. A blocking task (the default) holds its parent; a non-blocking
one holds nothing. A task blocked by an open task cannot start or be done.
--parent may name a plan (#n): the task waits there for a phase, and set --parent <phase> moves it under a phase of that plan.
A plan holds at most plans.maxPhases phases, and a phase starts only once it holds tasks.
A step of a phase closes with done --evidence <text>, or drop --note <reason>.`;
/** What `task release` was asked: an environment (none lists them all) and a gate (none lists the tasks). */
interface ReleaseRequest {
  env: DeployEnv | undefined;
  step: "before" | "after" | null;
}
const bindingFlags = ["--agent", "--branch", "--worktree", "--base"];
const definitions: Record<
  string,
  { values?: string[]; flags?: string[]; repeat?: string[]; min: number; max?: number }
> = {
  add: {
    values: [
      ...bindingFlags,
      "--description",
      "--file",
      "--kind",
      "--parent",
      "--type",
      "--blocked-by",
      "--phase",
      "--plan",
      "--deploy",
      "--flag",
      "--ref",
    ],
    flags: ["--start", "--pair"],
    repeat: ["--flag", "--ref", "--blocked-by"],
    min: 1,
  },
  take: { values: ["--from"], flags: ["--force"], min: 1, max: 1 },
  set: {
    values: [...bindingFlags, "--type", "--deploy", "--block", "--unblock", "--parent"],
    flags: ["--top"],
    repeat: ["--block", "--unblock"],
    min: 1,
    max: 1,
  },
  start: { values: bindingFlags, min: 1, max: 1 },
  done: { values: ["--evidence", "--note"], min: 1, max: 1 },
  drop: { values: ["--note"], min: 1, max: 1 },
  reopen: { min: 1, max: 1 },
  note: { values: ["--file"], min: 1 },
  list: {
    values: ["--scope", "--base", "--plan"],
    flags: ["--json", "--branch", "--branches"],
    min: 0,
    max: 0,
  },
  show: { values: ["--offset"], flags: ["--history"], min: 1, max: 1 },
  search: { flags: ["--all"], min: 1 },
  check: { flags: ["--json"], min: 0, max: 0 },
  release: { values: ["--ref"], flags: ["--json", "--before", "--after"], min: 0, max: 1 },
  import: { values: ["--project"], flags: ["--dry-run"], min: 1, max: 1 },
  delete: { min: 1, max: 1 },
};
export async function runTaskCommand(argv: string[]): Promise<number> {
  const out = createOut(currentTerminal());
  const [command = "list", ...rest] = argv;
  const definition = definitions[command];
  // A usage mistake is one line and where the help is (`.claude/rules/command-output.md`).
  const bad = (text: string) => {
    console.error(usageError(text, "task"));
    return 2;
  };
  if (!definition) return bad(`Unknown task command: ${command}`);
  const parsed = parseOptions(
    rest,
    definition.values ?? [],
    definition.flags ?? [],
    definition.repeat ?? [],
  );
  if ("error" in parsed) return bad(parsed.error);
  const { options, flags, lists, positionals: args } = parsed;
  if (
    args.length < definition.min ||
    (definition.max !== undefined && args.length > definition.max)
  )
    return bad(`Wrong arguments for task ${command}`);
  const get = (key: string) => options.get(`--${key}`);
  const has = (key: string) => flags.has(`--${key}`);
  const fileText = async () =>
    get("file") === "-" ? await Bun.stdin.text() : readFileSync(get("file") ?? "", "utf8");
  // Inside Claude Code a blocking deploy task is not dropped: it is the person's (D14).
  const ops = createTaskOps({
    cwd: () => process.cwd(),
    refuseBlockingDrop: insideClaudeCode(process.env),
  });
  try {
    let operation: TaskOperation;
    let input: Record<string, unknown>;
    const task = args[0];
    const kind = get("kind");
    const bindings = Object.fromEntries(
      bindingFlags
        .filter((flag) => options.has(flag))
        .map((flag) => [flag.slice(2), options.get(flag)]),
    );
    switch (command) {
      case "take":
        operation = "take";
        input = { task, from: get("from"), force: has("force") };
        break;
      case "add":
        if (get("file") && get("description")) return bad("Use --description or --file, not both");
        if (kind !== undefined && !KIND_LIST.includes(kind))
          return bad(
            `Unknown kind: ${kind} (${KIND_LIST.join(", ")}); follow-up and teammate are gone in ${DEPLOY_TASKS_SINCE}`,
          );
        operation = "create";
        input = {
          ...bindings,
          subject: args.join(" "),
          description: get("file") ? await fileText() : get("description"),
          kind,
          parent: get("parent"),
          status: has("start") ? "in_progress" : undefined,
          type: get("type"),
          blocked_by: lists.get("--blocked-by"),
          phase: get("phase"),
          plan: get("plan"),
          deploy: get("deploy"),
          pair: has("pair") ? true : undefined,
          flags: lists.get("--flag"),
          refs: lists.get("--ref"),
        };
        break;
      case "set":
        if (get("parent") && has("top")) return bad("Use --parent or --top, not both");
        operation = "update";
        input = {
          task,
          ...bindings,
          type: get("type"),
          deploy: get("deploy"),
          blocked_by_add: lists.get("--block"),
          blocked_by_remove: lists.get("--unblock"),
          parent: has("top") ? null : get("parent"),
        };
        break;
      case "start":
        operation = "update";
        input = { task, status: "in_progress", ...bindings };
        break;
      case "done":
      case "drop":
        operation = "done";
        input = {
          task,
          outcome: command === "drop" ? "dropped" : "done",
          evidence: get("evidence"),
          note: get("note"),
        };
        break;
      case "reopen":
        operation = "update";
        input = { task, status: "open" };
        break;
      case "note":
        if (get("file") && args.length > 1) return bad("Use note text or --file, not both");
        operation = "note";
        input = { task, text: get("file") ? await fileText() : args.slice(1).join(" ") };
        break;
      case "show":
        operation = "get";
        input = {
          task,
          offset: get("offset") === undefined ? 0 : Number(get("offset")),
          history: has("history"),
        };
        break;
      case "search":
        operation = "search";
        input = { text: args.join(" "), include_closed: has("all") };
        break;
      case "delete":
        operation = "delete";
        input = { task };
        break;
      case "list":
        if (has("branch") && has("branches")) return bad("Use --branch or --branches, not both");
        if (get("base") && !has("branch")) return bad("--base needs --branch");
        if (!has("branch") && !has("branches")) {
          operation = "list";
          input = { scope: get("scope"), plan: get("plan") };
          break;
        }
        if (get("scope") || has("json")) return bad("Branch lists do not take --scope or --json");
        return projectCommand();
      case "release": {
        const wanted = releaseRequest();
        return "error" in wanted ? bad(wanted.error) : projectCommand(wanted);
      }
      case "check":
      case "import":
        return projectCommand();
      default:
        return bad(`Unknown task command: ${command}`);
    }
    const answer = ops.call(operation, input);
    if (!answer.ok) {
      console.error(answer.why);
      return 1;
    }
    if (has("json")) out.json(answer.data ?? answer.text);
    else for (const line of answer.text.split("\n")) out.say(line);
    return 0;

    /** What `release` was asked, judged before git or the project are read: a wrong command is a usage error. */
    function releaseRequest(): ReleaseRequest | { error: string } {
      const step = has("before") ? "before" : has("after") ? "after" : null;
      if (has("before") && has("after")) return { error: "Use --before or --after, not both" };
      const name = args[0];
      const env = name === undefined ? undefined : DEPLOY_ENVS.find((one) => one === name);
      if (name !== undefined && env === undefined)
        return { error: `Unknown environment: ${name} (${ENVS})` };
      if (step !== null && env === undefined)
        return { error: `--${step} needs an environment: release <${ENVS}> --${step}` };
      if (get("ref") !== undefined && step === null)
        return { error: "--ref needs --before or --after" };
      return { env, step };
    }

    function projectCommand(release?: ReleaseRequest): number {
      const cwd = process.cwd();
      const ctx = taskContext(cwd);
      if (!ctx.ok) throw new Error(ctx.why);
      const paths = cliPaths();
      if (command === "import") {
        if (args[0] !== "claude-mem")
          return bad("Use import claude-mem [--project <name>] [--dry-run]");
        const db = openWorkDb(workDbFile(paths), { mode: "write" });
        try {
          const answer = importClaudeMem({
            claudeMemDb: join(dirname(paths.claudeMemSettingsFile), "claude-mem.db"),
            workDb: db,
            project: ctx.project,
            claudeMemProject: get("project") ?? basename(ctx.repo ?? cwd),
            dryRun: has("dry-run"),
            now: Date.now(),
          });
          if (!answer.ok) throw new Error(answer.why);
          const { imported, dropped, kept, skipped, open } = answer.value;
          for (const task of imported) out.say(task.subject, task.parent ? 2 : 0);
          for (const list of dropped)
            out.say(
              `${has("dry-run") ? "Would drop" : "Dropped"} #${list.number} "${list.list}" (${plural(list.tasks, "open task", "open tasks")}): claude-mem's own list, which an earlier import took as work.`,
            );
          for (const list of kept)
            out.say(
              `Left #${list.number} "${list.list}" open: claude-mem's own list, which an earlier import took as work, but a session made or changed ${list.touched.map((n) => `#${n}`).join(", ")} in it. Close what is not work yourself.`,
            );
          if (skipped.length)
            out.say(`Left out claude-mem's own lists (its My Work data): ${skipped.join(", ")}.`);
          if (has("dry-run")) out.say(dryRunEnding([]));
          else if (imported.length === 0)
            out.say(
              open > 0
                ? "Nothing new to import."
                : "Nothing to import: claude-mem has no open lists here.",
            );
          else
            out.say(
              `Imported ${plural(imported.length, "work task", "work tasks")} from claude-mem's open lists.`,
            );
          return 0;
        } finally {
          db.close();
        }
      }
      if (!ctx.projectTasks.ok) throw new Error(ctx.projectTasks.why);
      if (!ctx.checkoutRoot) throw new Error("Deploy tasks need a git checkout");
      const root = ctx.checkoutRoot;
      const settings = ctx.projectTasks;
      const dir = settings.dir;
      if (command === "list") {
        const base = get("base") ?? baseBranch(locateCheckout(cwd), process.env, root).base;
        if (has("branches")) {
          const { tasks, closed, broken } = unmergedBranchTasks(root, dir, base);
          for (const item of tasks) out.say(`${item.branch}: ${projectLine(item.task)}`);
          for (const item of closed)
            out.say(
              `closed on ${item.branch}, not merged: ${projectLine(item.task)} · ${item.task.status}`,
            );
          for (const item of broken) out.say(`${item.branch}: ${item.file} · ${item.why}`);
          if (!tasks.length && !closed.length && !broken.length)
            out.say("No deploy tasks on unmerged branches.");
        } else {
          const changes = branchTaskChanges(root, dir, base);
          for (const env of DEPLOY_ENVS) {
            const group = changes.filter((c) => c.task?.env === env);
            if (!group.length) continue;
            out.heading(env);
            for (const item of group)
              out.say(`${item.change}: ${item.task ? projectLine(item.task) : item.file}`);
          }
          for (const item of changes.filter((c) => !c.task))
            out.say(`${item.change}: ${item.file}${item.why ? ` · ${item.why}` : ""}`);
          if (!changes.length) out.say("No deploy task changes on this branch.");
        }
        return 0;
      }
      if (command === "check") {
        const findings = checkDeployTasks({
          checkoutRoot: root,
          dir,
          settings: { staleDays: settings.staleDays },
          now: new Date(),
        });
        if (has("json")) out.json(findings);
        else if (!findings.length) out.say("Deploy tasks: no problems found.");
        else
          for (const finding of findings)
            out.say(`${finding.kind}: ${finding.text} · ${finding.file}`);
        return findings.length ? 1 : 0;
      }
      const { env, step } = release ?? { env: undefined, step: null };
      if (step !== null && env !== undefined) {
        // The gates read the folder themselves, closed tasks too (`gateBefore`, `gateAfter`).
        const base = baseBranch(locateCheckout(cwd), process.env, root).base;
        const ref = get("ref") ?? `origin/${base}`;
        // The ref is resolved on its own, so only a ref git does not know gets the fetch advice;
        // any other git failure below (HEAD with no commit, say) is reported as git says it.
        try {
          refCommit(root, ref);
        } catch (error) {
          throw new Error(
            `Cannot read ${ref} (${error instanceof Error ? error.message : String(error)}): run \`git fetch origin\`, or name the commit that ships with --ref <ref>`,
          );
        }
        const facts = readGitFacts(root, dir, ref);
        const gate = (step === "before" ? gateBefore : gateAfter)(env, {
          dir,
          facts,
          envs: settings.envs,
          baseBranch: base,
          now: new Date(),
        });
        if (has("json"))
          out.json({
            ref: facts.ref,
            commit: facts.refCommit,
            ok: gate.ok,
            refusals: gate.refusals,
            notes: gate.notes,
          });
        else {
          out.heading(`Release gate: ${env} --${step}`);
          out.say(`Ref: ${facts.ref} (${facts.refCommit})`);
          for (const reason of gate.refusals) out.line("fail", reason);
          for (const note of gate.notes) out.line("info", note);
          out.verdict(
            gate.ok ? "ok" : "fail",
            gate.ok
              ? `Ready: ${env} ${step === "before" ? "may deploy" : "is clean after the deploy"}.`
              : `Not ready: ${plural(gate.refusals.length, "reason", "reasons")} to stop. Fix each one, then run this again.`,
          );
        }
        return gate.ok ? 0 : 1;
      }
      const result = releaseList(scanDeployTasks(dir, { archive: false }).tasks, env);
      if (has("json")) out.json(result);
      else {
        for (const group of result) {
          out.heading(`${group.env} · ${group.deploy} · ${group.type}`);
          for (const task of group.tasks) out.say(projectLine(task));
        }
        if (!result.length) out.say(`No open ${env ?? "deploy"} tasks.`);
      }
      return 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    ops.close();
  }
}
