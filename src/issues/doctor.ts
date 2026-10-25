/**
 * `doctor`'s line for GitHub Issues (D67). With `issues.enabled` on — read as `issue file` reads
 * it, the person's file and the project's file as committed on the base — one line says whether
 * `gh` is logged in for `origin`'s host and may write issues in `origin`'s repository, each
 * failure with its fix (`.claude/rules/command-output.md`). With the switch off: no line, and no
 * `gh` call, so a project that never opted in pays nothing.
 */
import { COMMAND } from "../build-info/names";
import type { Check } from "../cli/check";
import type { CliPaths } from "../cli/paths";
import { GH_TIMEOUT_MS, type GhCall, type GhExec } from "../workflow/merge-check";
import { publicIssuesOff } from "../workflow/pr-switches";
import { ownRepository, parseRepoFacts, REPO_FIELDS, resolveSwitch } from "./file";

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
const READ_ONLY = "READ";
const TRIAGE = "TRIAGE";

/** The fix that takes the switch off again. */
const SWITCH_OFF = `or turn the switch off: ${COMMAND} workflow set issues.enabled false`;

/** The checks for GitHub Issues in the folder `world.cwd`: none while the switch is off. */
export async function issuesChecks(world: IssuesDoctorWorld): Promise<Check[]> {
  const policy = resolveSwitch({ ...world, home: null });
  // A policy that cannot be read is the project lines' own failure to report; not repeated here.
  if ("why" in policy || !policy.resolved.issues.enabled.value) return [];

  const own = ownRepository(world.cwd, world.env);
  if ("why" in own) {
    return [
      {
        fix: `point origin at the project's GitHub repository (git remote set-url origin <url>), ${SWITCH_OFF}`,
        ok: false,
        text: `issues: ${own.why.replace(/^this project's origin is not on github\.com/, "origin is not on github.com")}`,
      },
    ];
  }
  const named = own.repo.slice(`${HOST}/`.length);
  const call: GhCall = { env: world.env, folder: world.cwd, timeoutMs: GH_TIMEOUT_MS };

  // `--active`: only the account gh uses here. Without it a second, stale account on the host
  // makes gh exit 1 while the active one works (`gh auth status --help`).
  const auth = await world.gh(["auth", "status", "--hostname", HOST, "--active"], call);
  if (auth.kind === "missing") {
    return [
      {
        fix: "install GitHub's CLI from https://cli.github.com, then run: gh auth login",
        ok: false,
        text: "issues: gh is not installed, so the kit cannot file issues",
      },
    ];
  }
  if (auth.kind === "timeout") {
    return [
      {
        fix: `check the network, then run: ${COMMAND} doctor`,
        ok: false,
        text: `issues: gh timed out while it checked the login for ${HOST}`,
      },
    ];
  }
  if (auth.kind === "failed") {
    return [
      {
        fix: `gh auth login --hostname ${HOST}`,
        ok: false,
        text: `issues: gh is not logged in for ${HOST}`,
      },
    ];
  }

  const view = await world.gh(["repo", "view", own.repo, "--json", REPO_FIELDS], call);
  if (view.kind !== "ok") {
    return [
      {
        fix: `check that your GitHub account can see ${named}, then run: ${COMMAND} doctor`,
        ok: false,
        text: `issues: gh could not read ${named} (${view.kind === "timeout" ? "timed out" : "it was refused"})`,
      },
    ];
  }
  const facts = parseRepoFacts(view.out);
  if ("why" in facts) {
    return [
      {
        fix: `update gh, then run: ${COMMAND} doctor`,
        ok: false,
        text: `issues: ${facts.why}`,
      },
    ];
  }
  if (!facts.hasIssues) {
    return [
      {
        fix: `turn Issues on in ${named}'s Settings (General, Features), ${SWITCH_OFF}`,
        ok: false,
        text: `issues: ${named} has issues turned off`,
      },
    ];
  }
  if (facts.permission === READ_ONLY) {
    return [
      {
        fix: `ask for write access to ${named}, ${SWITCH_OFF}`,
        ok: false,
        text: `issues: gh has ${READ_ONLY} access only to ${named}, which cannot apply labels, so the kit cannot file its issues there`,
      },
    ];
  }
  if (facts.permission === TRIAGE) {
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
