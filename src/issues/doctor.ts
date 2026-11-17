/**
 * `doctor`'s line for GitHub Issues (D67). With `issues.enabled` on — read as `issue file` reads
 * it, the person's file and the project's file as committed on the base — one line says whether
 * `gh` is logged in for `origin`'s host and may write issues in `origin`'s repository, each
 * failure with its fix (`.claude/rules/command-output.md`). With the switch off: no line, and no
 * `gh` call.
 *
 * The switch is on by default (5.0.0). While it is only that default, nobody chose it, so a place
 * the kit cannot file in is information, not a failure: every such result is a `·` line saying the
 * follow-up goes in the summary instead, and the `issues.allowPublic` nudge is left out
 * (`.claude/rules/command-output.md`: a part the person may leave out is never a failure). A
 * person or project that set the switch keeps every failure and warning.
 */
import { COMMAND } from "../build-info/names";
import type { Check } from "../cli/check";
import type { CliPaths } from "../cli/paths";
import { GH_TIMEOUT_MS, type GhCall, type GhExec } from "../workflow/merge-check";
import { publicIssuesOff } from "../workflow/pr-switches";
import {
  ownRepository,
  parseRepoFacts,
  READ_ONLY,
  REPO_FIELDS,
  readOnlyWhy,
  resolveSwitch,
} from "./file";

type Env = Record<string, string | undefined>;

export interface IssuesDoctorWorld {
  cwd: string;
  env: Env;
  gh: GhExec;
  paths: CliPaths;
}

/** The host the kit files on: `ownRepository` accepts github.com only. */
const HOST = "github.com";

/**
 * The repository roles (`viewerPermission`) that fall short: Read cannot apply a label, and
 * Triage applies labels but cannot create one (GitHub's repository roles table, researched in
 * `.claude/research/`). Write, Maintain and Admin do both.
 */
const TRIAGE = "TRIAGE";

/** The fix that takes the switch off again. */
const SWITCH_OFF = `or turn the switch off: ${COMMAND} workflow set issues.enabled false for your own file, and set it false in the project's .claude/cc-smart-dev-kit.json too when that file turns it on`;

/** What the info line says in place of a failure: where the follow-up goes instead. */
const INSTEAD = "follow-ups go in the summary instead";

/** The checks for GitHub Issues in the folder `world.cwd`: none while the switch is off. */
export async function issuesChecks(world: IssuesDoctorWorld): Promise<Check[]> {
  const policy = resolveSwitch({ ...world, home: null });
  // A policy that cannot be read is the project lines' own failure to report; not repeated here.
  if ("why" in policy || !policy.resolved.issues.enabled.value) return [];

  // Only the default: no one set the switch, so no result below may fail or nag.
  const fromDefault = policy.resolved.issues.enabled.source === "default";
  /** A place the kit cannot file in: a failure with its fix, or only information under the default. */
  const cannotFile = (text: string, fix: string): Check[] =>
    fromDefault
      ? [{ info: true, ok: true, text: `${text}; ${INSTEAD}` }]
      : [{ fix, ok: false, text }];

  const own = ownRepository(world.cwd, world.env);
  if ("why" in own) {
    return cannotFile(
      `issues: ${own.why.replace(/^this project's origin is not on github\.com/, "origin is not on github.com")}`,
      `point origin at the project's GitHub repository (git remote set-url origin <url>), ${SWITCH_OFF}`,
    );
  }
  const named = own.repo.slice(`${HOST}/`.length);
  const call: GhCall = { env: world.env, folder: world.cwd, timeoutMs: GH_TIMEOUT_MS };

  // `--active`: only the account gh uses here. Without it a second, stale account on the host
  // makes gh exit 1 while the active one works (`gh auth status --help`).
  const auth = await world.gh(["auth", "status", "--hostname", HOST, "--active"], call);
  if (auth.kind === "missing") {
    return cannotFile(
      "issues: gh is not installed, so the kit cannot file issues",
      "install GitHub's CLI from https://cli.github.com, then run: gh auth login",
    );
  }
  if (auth.kind === "timeout") {
    return cannotFile(
      `issues: gh timed out while it checked the login for ${HOST}`,
      `check the network, then run: ${COMMAND} doctor`,
    );
  }
  if (auth.kind === "failed") {
    return cannotFile(
      `issues: gh is not logged in for ${HOST}`,
      `gh auth login --hostname ${HOST}`,
    );
  }

  const view = await world.gh(["repo", "view", own.repo, "--json", REPO_FIELDS], call);
  if (view.kind !== "ok") {
    return cannotFile(
      `issues: gh could not read ${named} (${view.kind === "timeout" ? "timed out" : "it was refused"})`,
      `check that your GitHub account can see ${named}, then run: ${COMMAND} doctor`,
    );
  }
  const facts = parseRepoFacts(view.out);
  if ("why" in facts) {
    return cannotFile(`issues: ${facts.why}`, `update gh, then run: ${COMMAND} doctor`);
  }
  if (!facts.hasIssues) {
    return cannotFile(
      `issues: ${named} has issues turned off`,
      `turn Issues on in ${named}'s Settings (General, Features), ${SWITCH_OFF}`,
    );
  }
  if (facts.permission === READ_ONLY) {
    return cannotFile(
      `issues: ${readOnlyWhy(named)}`,
      `ask for write access to ${named}, ${SWITCH_OFF}`,
    );
  }
  if (facts.permission === TRIAGE) {
    if (fromDefault) {
      return [
        {
          info: true,
          ok: true,
          text: `issues: gh has ${TRIAGE} access to ${named}, which can apply labels but not create them, so the kit files there only while its labels exist`,
        },
      ];
    }
    return [
      {
        fix: `create the label ${policy.resolved.issues.foundLabel.value} in ${named} yourself, or ask for write access`,
        ok: true,
        text: `issues: gh has ${TRIAGE} access to ${named}, which can apply labels but not create them, so the kit files there only while its labels exist`,
        warn: true,
      },
    ];
  }
  if (facts.isPublic) {
    const off = publicIssuesOff(policy.resolved, policy.base);
    if (off !== null && fromDefault) {
      return [{ info: true, ok: true, text: `issues: ${named} is public; ${INSTEAD}` }];
    }
    if (off !== null) {
      return [
        {
          fix: off.slice(off.indexOf("turn it on")),
          ok: true,
          text: `issues: ${named} is public, so the kit files nothing there until issues.allowPublic is on`,
          warn: true,
        },
      ];
    }
  }
  return [
    {
      ok: true,
      text: `issues: gh is logged in for ${HOST} and can file issues in ${named}${facts.isPublic ? " (public repository)" : ""}`,
    },
  ];
}
