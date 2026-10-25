/**
 * Reading the issue a phase starts from (`crew start --issue`, GI3, decision D67): the one
 * place an issue somebody else wrote is let into a session's brief, so the rules are all here.
 *
 * **Only an issue the person chose.** It must carry the ready label (`issues.readyLabel`), and the
 * account that last added that label must hold **write access** to the repository: a label is
 * what a person with triage access can add, and a stranger's issue can never carry it. The
 * adder is read from the issue's events (`GET …/issues/<n>/events`: the newest `labeled` or
 * `unlabeled` of that label), its role from `GET …/collaborators/<login>/permission`. Anything
 * that cannot be read — the events, the role, the last edit — is a refusal, never a guess.
 *
 * **A label then an edit.** The person chose the text as it stood when they labelled it. So a
 * body edited after the label, or a title renamed after it, by an account without write access,
 * is refused: the writer re-labels it after reading the change. (The body's last edit is read
 * through GraphQL's `lastEditedAt` and `editor`; REST has no field for it.)
 *
 * **Not a project issue, not open work:** a pull request, a closed issue, or an issue of another
 * repository (named by its address, or answered by GitHub from another place after a transfer)
 * is refused with why. The reads go to `origin`'s repository only, on github.com, through the one
 * runner, and only read.
 *
 * **The text is data.** What it returns is the issue's text with every key, token, home path and
 * URL with credentials replaced (`redactText`): a secret in a public issue is still a secret on
 * this machine's disk. The brief quotes it under a heading that says so (`brief.ts`).
 */
import { issuesOff } from "../workflow/pr-switches";
import { ghProblem, type IssueWorld, ownRepository, resolveSwitch } from "./file";
import { redactText } from "./screen";

/** An issue chosen for a phase, its text redacted. */
export interface PickedIssue {
  author: string;
  body: string;
  labeledAt: string;
  labeledBy: string;
  labels: string[];
  number: number;
  /** The ready label's name, as the project's switch spells it. */
  readyLabel: string;
  /** `owner/name`, as GitHub spells it in the address. */
  repo: string;
  title: string;
  url: string;
}

export type PickOutcome = { issue: PickedIssue; ok: true } | { ok: false; why: string };

const refuse = (why: string): PickOutcome => ({ ok: false, why });

/** What `--issue` was given: a number, or the address of an issue (its repository then). */
export type IssueRef = { number: number; repo: null | string } | { error: string };

/** `12`, `#12` or `https://github.com/<owner>/<name>/issues/12`; or why it is none of them. */
export function parseIssueRef(text: string): IssueRef {
  const plain = /^#?([1-9][0-9]{0,8})$/.exec(text.trim());
  if (plain !== null) return { number: Number(plain[1]), repo: null };
  const address =
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/([1-9][0-9]{0,8})\/?$/.exec(text.trim());
  if (address !== null) return { number: Number(address[3]), repo: `${address[1]}/${address[2]}` };
  if (/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\//.test(text.trim())) {
    return { error: `${text} is a pull request, and a phase starts from an issue` };
  }
  return {
    error: `${JSON.stringify(text)} is no issue: give its number (12 or #12) or its address on github.com`,
  };
}

/** What a login may look like in a path: GitHub's own rule, plus the `[bot]` of an app. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;

/** A name that is safe in a heading: whatever GitHub answered, only its login characters. */
function plainLogin(text: string): string {
  return text.replace(/[^A-Za-z0-9_.[\]-]/g, "");
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(out: string): unknown {
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/** One event of the issue's timeline, as far as this command reads it. */
interface TimelineEvent {
  actor: null | string;
  at: string;
  event: string;
  label: null | string;
}

/** The events list (`--paginate --slurp` gives a list of pages) as one list; null if unreadable. */
function parseEvents(out: string): null | TimelineEvent[] {
  const pages = parseJson(out);
  if (!Array.isArray(pages)) return null;
  const events: TimelineEvent[] = [];
  for (const row of pages.flat() as unknown[]) {
    if (!isObject(row) || typeof row.event !== "string" || typeof row.created_at !== "string") {
      return null;
    }
    const actor =
      isObject(row.actor) && typeof row.actor.login === "string" ? row.actor.login : null;
    const label = isObject(row.label) && typeof row.label.name === "string" ? row.label.name : null;
    events.push({ actor, at: row.created_at, event: row.event, label });
  }
  return events;
}

/** True when GitHub's permission answer says the account can push; null when it says nothing usable. */
function hasWriteAccess(out: string): boolean | null {
  const answer = parseJson(out);
  if (!isObject(answer)) return null;
  const user = isObject(answer.user) ? answer.user : null;
  const permissions = user !== null && isObject(user.permissions) ? user.permissions : null;
  if (permissions !== null && typeof permissions.push === "boolean") {
    return permissions.push || permissions.admin === true || permissions.maintain === true;
  }
  const word = typeof answer.role_name === "string" ? answer.role_name : answer.permission;
  if (typeof word !== "string") return null;
  return ["admin", "maintain", "write"].includes(word.toLowerCase());
}

/** The GraphQL read of the last edit of an issue's body. */
const LAST_EDIT_QUERY =
  "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){lastEditedAt editor{login}}}}";

/** The body's last edit: when and by whom (null: never edited); undefined when unreadable. */
function parseLastEdit(out: string): undefined | { at: string; editor: null | string } | null {
  const answer = parseJson(out);
  if (!isObject(answer) || !isObject(answer.data)) return undefined;
  const repository = answer.data.repository;
  const found = isObject(repository) ? repository.issue : undefined;
  if (!isObject(found)) return undefined;
  if (found.lastEditedAt === null) return null;
  if (typeof found.lastEditedAt !== "string") return undefined;
  const editor =
    isObject(found.editor) && typeof found.editor.login === "string" ? found.editor.login : null;
  return { at: found.lastEditedAt, editor };
}

/**
 * Reads issue `ref` of the project's own repository, or says why a phase may not start from it.
 * Never throws: every failure is a refusal with its reason.
 */
export async function pickIssue(world: IssueWorld, ref: string): Promise<PickOutcome> {
  const given = parseIssueRef(ref);
  if ("error" in given) return refuse(given.error);

  const policy = resolveSwitch(world);
  if ("why" in policy) return refuse(`the issue switch cannot be read: ${policy.why}`);
  const off = issuesOff(policy.resolved, policy.base);
  if (off !== null) return refuse(off);

  const own = ownRepository(world.cwd, world.env);
  if ("why" in own) return refuse(own.why);
  const name = own.repo.replace(/^github\.com\//, "");
  if (given.repo !== null && given.repo.toLowerCase() !== name.toLowerCase()) {
    return refuse(
      `issue ${given.repo}#${given.number} is in another repository; a phase starts from an issue of this project's own, ${name}`,
    );
  }
  const { number } = given;
  const label = policy.resolved.issues.readyLabel.value;

  const read = (args: string[]) =>
    world.gh(["api", "--hostname", "github.com", ...args], {
      env: world.env,
      folder: world.cwd,
      timeoutMs: 10_000,
    });
  const unreadable = (what: string) =>
    refuse(`${what} of ${name}#${number} cannot be read from GitHub, so the issue is not used`);

  const viewed = await read([`repos/${name}/issues/${number}`]);
  if (viewed.kind === "failed" && /404|not found/i.test(viewed.err)) {
    return refuse(`${name} has no issue #${number}`);
  }
  if (viewed.kind !== "ok") return refuse(ghProblem(`read issue #${number}`, viewed));
  const issue = parseJson(viewed.out);
  if (
    !isObject(issue) ||
    typeof issue.title !== "string" ||
    typeof issue.html_url !== "string" ||
    !Array.isArray(issue.labels) ||
    !isObject(issue.user) ||
    typeof issue.user.login !== "string"
  ) {
    return unreadable("the issue");
  }
  if (issue.pull_request !== undefined || /\/pull\/\d+$/.test(issue.html_url)) {
    return refuse(`#${number} is a pull request, and a phase starts from an issue`);
  }
  const address = new RegExp(`^https://github\\.com/${escapeRegExp(name)}/issues/${number}$`, "i");
  if (!address.test(issue.html_url)) {
    return refuse(
      `#${number} is now in another repository (${issue.html_url}); a phase starts from an issue of ${name}`,
    );
  }
  if (issue.state !== "open") {
    return refuse(`#${number} is closed, and a phase starts from an open issue`);
  }
  const wanted = label.toLowerCase();
  const labels = (issue.labels as unknown[]).flatMap((one) =>
    isObject(one) && typeof one.name === "string" ? [one.name] : [],
  );
  const missing = (why: string) =>
    refuse(
      `#${number} ${why}: a phase starts only from an issue the person labelled ${label} (someone with write access adds it; the person's own yes). Ask the person to add the label`,
    );
  if (!labels.some((one) => one.toLowerCase() === wanted)) {
    return missing(`does not carry the label ${label}`);
  }

  const listed = await read([
    "--paginate",
    "--slurp",
    `repos/${name}/issues/${number}/events?per_page=100`,
  ]);
  if (listed.kind !== "ok") return unreadable("the events");
  const events = parseEvents(listed.out);
  if (events === null) return unreadable("the events");
  const chosen = events.filter(
    (one) => one.label?.toLowerCase() === wanted && ["labeled", "unlabeled"].includes(one.event),
  );
  const last = chosen.at(-1);
  if (last === undefined || last.event !== "labeled") {
    return missing(`carries the label ${label}, but the events do not show who added it`);
  }
  if (last.actor === null)
    return refuse(
      `#${number}: the label ${label} was added by no account that exists any more, so the issue is not used`,
    );

  /** Whether `login` holds write access: true or false, or a refusal when it cannot be read. */
  const writer = async (login: string): Promise<boolean | PickOutcome> => {
    if (!LOGIN.test(login))
      return refuse(`the account name ${JSON.stringify(login)} is not one GitHub uses`);
    const role = await read([
      `repos/${name}/collaborators/${encodeURIComponent(login)}/permission`,
    ]);
    const write = role.kind === "ok" ? hasWriteAccess(role.out) : null;
    if (write === null) {
      return refuse(
        `the access of ${login} to ${name} cannot be read from GitHub, so the label ${label} they added on #${number} cannot be trusted`,
      );
    }
    return write;
  };
  const labeler = await writer(last.actor);
  if (typeof labeler !== "boolean") return labeler;
  if (!labeler) {
    return refuse(
      `the label ${label} on #${number} was added by ${last.actor}, who has no write access to ${name}: only a label from someone with write access counts`,
    );
  }

  const since = Date.parse(last.at);
  for (const event of events) {
    if (event.event !== "renamed" || !(Date.parse(event.at) >= since)) continue;
    if (event.actor === null) {
      return refuse(
        `#${number} was renamed after it was labelled, by no account that exists any more; label it again once the title is read`,
      );
    }
    const renamer = await writer(event.actor);
    if (typeof renamer !== "boolean") return renamer;
    if (!renamer) {
      return refuse(
        `#${number} was renamed by ${event.actor} after it was labelled ${label}, and ${event.actor} has no write access: read the new title, then label it again`,
      );
    }
  }

  const [owner = "", repoName = ""] = name.split("/");
  const edited = await read([
    "graphql",
    "-f",
    `query=${LAST_EDIT_QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${repoName}`,
    "-F",
    `number=${number}`,
  ]);
  const edit = edited.kind === "ok" ? parseLastEdit(edited.out) : undefined;
  if (edit === undefined) return unreadable("the last edit of the text");
  if (edit !== null && Date.parse(edit.at) >= since) {
    if (edit.editor === null) {
      return refuse(
        `the text of #${number} was edited after it was labelled, by no account that exists any more; label it again once it is read`,
      );
    }
    const editor = await writer(edit.editor);
    if (typeof editor !== "boolean") return editor;
    if (!editor) {
      return refuse(
        `the text of #${number} was edited by ${edit.editor} after it was labelled ${label}, and ${edit.editor} has no write access: read the new text, then label it again`,
      );
    }
  }

  const body = typeof issue.body === "string" ? issue.body : "";
  return {
    ok: true,
    issue: {
      author: plainLogin(issue.user.login),
      body: redactText(body.replace(/\r\n?/g, "\n"), world.home),
      labeledAt: last.at,
      labeledBy: plainLogin(last.actor),
      labels,
      number,
      readyLabel: label,
      repo: name,
      title: redactText(issue.title, world.home).replace(/\s+/g, " ").trim(),
      url: issue.html_url,
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
