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
import { GH_TIMEOUT_MS, GH_WRITE_TIMEOUT_MS } from "../workflow/merge-check";
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

/** What a failed `gh` read stops, for `ghProblem`: nothing is written, so a retry is safe. */
const READ_WORDS = {
  afterTimeout: "nothing was started. Try again",
  stops: "the issue cannot be read",
} as const;

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

/**
 * The GraphQL read of every edit of an issue's body (`userContentEdits`, newest first). The last
 * edit alone is not enough: a writer's later edit would hide a stranger's earlier one.
 */
const EDITS_QUERY =
  "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){userContentEdits(first:100){nodes{editedAt editor{login}} pageInfo{hasNextPage}}}}}";

/** One edit of the issue's body: when, and by whom (null: an account that no longer exists). */
interface BodyEdit {
  at: string;
  editor: null | string;
}

/** The body's edits and whether there are more than one read returns; undefined when unreadable. */
function parseEdits(out: string): undefined | { edits: BodyEdit[]; more: boolean } {
  const answer = parseJson(out);
  if (!isObject(answer) || !isObject(answer.data) || answer.errors !== undefined) return undefined;
  const repository = answer.data.repository;
  const found = isObject(repository) ? repository.issue : undefined;
  const list = isObject(found) ? found.userContentEdits : undefined;
  if (!isObject(list) || !Array.isArray(list.nodes) || !isObject(list.pageInfo)) return undefined;
  const edits: BodyEdit[] = [];
  for (const node of list.nodes as unknown[]) {
    if (!isObject(node) || typeof node.editedAt !== "string") return undefined;
    const editor =
      isObject(node.editor) && typeof node.editor.login === "string" ? node.editor.login : null;
    edits.push({ at: node.editedAt, editor });
  }
  return { edits, more: list.pageInfo.hasNextPage === true };
}

/**
 * What a reader cannot see: a format character (`Cf`: zero-width, bidi, tag), any default-ignorable
 * code point (variation selectors, the Hangul filler, the combining grapheme joiner), and U+2800,
 * the blank braille cell, which is none of those and still draws nothing. The one exception is
 * captured: an emoji followed by its own variation selector (U+FE0E, U+FE0F), which is how an
 * ordinary emoji is written and stays plain.
 */
const HIDDEN_CHARACTER =
  /(\p{Extended_Pictographic}[\uFE0E\uFE0F])|[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/** A character named by its code point, the way every hidden one is shown: `[U+202E]`. */
function named(char: string): string {
  return `[U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}]`;
}

/** True when one character draws nothing (`HIDDEN_CHARACTER`) or is a control but a tab or a newline. */
function isHidden(char: string): boolean {
  if (char === "\t" || char === "\n") return false;
  return /^(?:[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]|\p{Cc})$/u.test(char);
}

/**
 * The first line of a link reference definition (`[label]: destination "title"`). CommonMark
 * renders the whole definition as nothing, so `[//]: # (text)` is a comment a reader never sees.
 * Four spaces of indent make code instead, so they are not matched. A definition cannot interrupt
 * a paragraph in CommonMark, so one right after a text line is shown there; it is marked anyway:
 * marking a visible line costs a reader a few words, missing a hidden one costs the point.
 */
const DEFINITION_START = /^ {0,3}\[(?:\\.|[^\]\\])+\]:/;

/**
 * What a definition can sit behind: block-quote marks and list markers (`> `, `- `, `1. `). A
 * definition inside a quote or a list item is rendered as nothing too. Indent alone is not
 * stripped, so four spaces stay code.
 */
const CONTAINER_PREFIX = /^(?:[ \t]*(?:>|[-+*]|\d{1,9}[.)])[ \t]*)*/;

/** A label is at most 999 characters (CommonMark): how far a multi-line label is looked for. */
const LABEL_WINDOW = 1_100;

/**
 * True when the line that starts at `offset` of `text` starts a link reference definition. Its
 * label may span lines, so the next `LABEL_WINDOW` characters are looked at, up to a blank line;
 * the cost of one line is bounded by that window, however long the text is.
 */
function startsDefinition(text: string, offset: number): boolean {
  let window = text.slice(offset, offset + LABEL_WINDOW + 100);
  const blank = /\n[ \t]*\n/.exec(window);
  if (blank !== null) window = window.slice(0, blank.index);
  return DEFINITION_START.test(window.replace(CONTAINER_PREFIX, "").slice(0, LABEL_WINDOW));
}

/**
 * Marks every link reference definition, from its first line to the end of its block (the next
 * blank line or the end). A definition's destination and title may sit on the lines after the
 * label, so the block is the only edge that holds without parsing titles.
 */
function markDefinitions(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let offset = 0;
  for (let at = 0; at < lines.length; at++) {
    const lineStart = offset;
    offset += (lines[at] ?? "").length + 1;
    if (!startsDefinition(text, lineStart)) {
      out.push(lines[at] ?? "");
      continue;
    }
    let end = at;
    while (end + 1 < lines.length && (lines[end + 1] ?? "").trim() !== "") {
      end++;
      offset += (lines[end] ?? "").length + 1;
    }
    out.push(`[hidden link reference definition: ${lines.slice(at, end + 1).join("\n")}]`);
    at = end;
  }
  return out.join("\n");
}

/**
 * The elements whose content GitHub's sanitizer removes with the tag, so the labeller never sees
 * it. Source: the default `remove_contents` of Selma's sanitizer config (the library behind
 * html-pipeline's `SanitizationFilter`, which renders GitHub's Markdown):
 * iframe, math, noembed, noframes, noscript, plaintext, script, style, svg, xmp. `template` is
 * added: it is in no allowlist of html-pipeline, and a browser never draws its content.
 * Any other tag the sanitizer drops keeps its inner text, which the labeller sees.
 *
 * Some of these (script, style, xmp, iframe, noembed, noframes, plaintext) may be shown as literal
 * text by GitHub's Markdown step instead (GFM's tagfilter), and are marked as hidden all the same:
 * marking text a reader can see costs a few words, missing text they cannot see costs the point.
 */
const STRIPPED_CONTENT_TAGS = [
  "iframe",
  "math",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "svg",
  "template",
  "xmp",
] as const;

const STRIPPED_OPEN = new RegExp(`<(${STRIPPED_CONTENT_TAGS.join("|")})(?=[\\s/>])[^>]*>`, "gi");

/** For each stripped tag, its opening and closing tags (`<svg …>`, `</svg>`), to count nesting. */
const STRIPPED_PAIRS = new Map(
  STRIPPED_CONTENT_TAGS.map((tag) => [tag, new RegExp(`<(/?)${tag}(?=[\\s/>])[^>]*>`, "gi")]),
);

/**
 * Shows the content of every stripped tag, marked: from the opening tag to its own closing tag
 * (a tag of the same name inside it opens a level, so `<svg><svg>a</svg>b</svg>` is one block), or
 * to the end of the text when it is never closed. An element written self-closed (`<svg/>`) has
 * no content.
 */
function markStrippedContent(text: string): string {
  let out = "";
  let from = 0;
  STRIPPED_OPEN.lastIndex = 0;
  for (let open = STRIPPED_OPEN.exec(text); open !== null; open = STRIPPED_OPEN.exec(text)) {
    if (open[0].endsWith("/>")) continue;
    const tag = (open[1] ?? "").toLowerCase();
    const pairs = STRIPPED_PAIRS.get(tag as (typeof STRIPPED_CONTENT_TAGS)[number]);
    if (pairs === undefined) continue;
    const start = open.index + open[0].length;
    let contentEnd = text.length;
    let after = text.length;
    let depth = 1;
    pairs.lastIndex = start;
    for (let next = pairs.exec(text); next !== null; next = pairs.exec(text)) {
      if (next[1] === "" && next[0].endsWith("/>")) continue;
      depth += next[1] === "/" ? -1 : 1;
      if (depth === 0) {
        contentEnd = next.index;
        after = next.index + next[0].length;
        break;
      }
    }
    out += `${text.slice(from, open.index)}[hidden <${tag}> content: ${text.slice(start, contentEnd)}]`;
    from = after;
    STRIPPED_OPEN.lastIndex = after;
  }
  return out + text.slice(from);
}

/**
 * The named character references whose characters all draw nothing, from the WHATWG list
 * (https://html.spec.whatwg.org/entities.json, filtered by `isHidden`; `&Tab;` and `&NewLine;` are
 * left out on purpose). Numeric references are decoded by code, not by this table.
 */
const HIDDEN_ENTITIES: Readonly<Record<string, number>> = {
  ApplyFunction: 0x2061,
  InvisibleComma: 0x2063,
  InvisibleTimes: 0x2062,
  NegativeMediumSpace: 0x200b,
  NegativeThickSpace: 0x200b,
  NegativeThinSpace: 0x200b,
  NegativeVeryThinSpace: 0x200b,
  NoBreak: 0x2060,
  ZeroWidthSpace: 0x200b,
  af: 0x2061,
  ic: 0x2063,
  it: 0x2062,
  lrm: 0x200e,
  rlm: 0x200f,
  shy: 0xad,
  zwj: 0x200d,
  zwnj: 0x200c,
};

/**
 * A character reference, named or numeric, that draws a hidden character: shown as its code. A
 * reference without its `;`, past U+10FFFF, or of a visible character is left as written, as a
 * Markdown renderer leaves it.
 */
function namedEntity(match: string, hex?: string, decimal?: string, name?: string): string {
  let point: number | undefined;
  if (hex !== undefined) point = Number.parseInt(hex, 16);
  else if (decimal !== undefined) point = Number.parseInt(decimal, 10);
  else if (name !== undefined) point = HIDDEN_ENTITIES[name];
  if (point === undefined || point > 0x10ffff) return match;
  const char = String.fromCodePoint(point);
  return isHidden(char) ? named(char) : match;
}

/**
 * The issue's text as the labeller could see it: line separators made real lines; what GitHub's
 * rendering hides shown in plain view and marked: an HTML comment, declaration, processing
 * instruction or CDATA section, a link reference definition, the content of a tag its sanitizer
 * strips; and every invisible character (`HIDDEN_CHARACTER`), control character, or character
 * reference of one named by its code. The person chose the text they saw; nothing in the brief may
 * be hidden from them. Visible Markdown is left alone. (Not covered: the values of a tag's
 * attributes, and a link's title or an image's alt text, which a reader can reach by hovering.)
 */
export function visibleText(text: string): string {
  return markStrippedContent(markDefinitions(text.replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n")))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "[hidden CDATA: $1]")
    .replace(/<!([A-Za-z][^>]*)>/g, "[hidden HTML declaration: $1]")
    .replace(/<\?([\s\S]*?)\?>/g, "[hidden processing instruction: $1]")
    .replace(/<!--/g, "[hidden HTML comment: ")
    .replace(/-->/g, "]")
    .replace(/&(?:#[xX]0*([0-9a-fA-F]{1,6})|#0*([0-9]{1,7})|([A-Za-z][A-Za-z0-9]*));/g, namedEntity)
    .replace(HIDDEN_CHARACTER, (match, emoji: string | undefined) =>
      emoji === undefined ? named(match) : match,
    )
    .replace(/(?![\n\t])\p{Cc}/gu, named);
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

  const read = (args: string[], timeoutMs = GH_TIMEOUT_MS) =>
    world.gh(["api", "--hostname", "github.com", ...args], {
      env: world.env,
      folder: world.cwd,
      timeoutMs,
    });
  const unreadable = (what: string) =>
    refuse(`${what} of ${name}#${number} cannot be read from GitHub, so the issue is not used`);

  const viewed = await read([`repos/${name}/issues/${number}`]);
  if (viewed.kind === "failed" && /404|not found/i.test(viewed.err)) {
    return refuse(`${name} has no issue #${number}`);
  }
  if (viewed.kind !== "ok") return refuse(ghProblem(`read issue #${number}`, viewed, READ_WORDS));
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

  // Every page of a long history is read, so it gets the time of the one big read.
  const listed = await read(
    ["--paginate", "--slurp", `repos/${name}/issues/${number}/events?per_page=100`],
    GH_WRITE_TIMEOUT_MS,
  );
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
  const roles = new Map<string, boolean | PickOutcome>();
  const writer = async (login: string): Promise<boolean | PickOutcome> => {
    const known = roles.get(login);
    if (known !== undefined) return known;
    const answered = await roleOf(login);
    roles.set(login, answered);
    return answered;
  };
  const roleOf = async (login: string): Promise<boolean | PickOutcome> => {
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
  if (Number.isNaN(since)) return unreadable("the time the label was added");
  for (const event of events) {
    if (event.event !== "renamed") continue;
    const at = Date.parse(event.at);
    if (Number.isNaN(at)) return unreadable("the time of a rename");
    if (at < since) continue;
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
    `query=${EDITS_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${repoName}`,
    "-F",
    `number=${number}`,
  ]);
  const history = edited.kind === "ok" ? parseEdits(edited.out) : undefined;
  if (history === undefined) return unreadable("the edits of the text");
  if (history.more) {
    return refuse(
      `the text of #${number} was edited more than 100 times, more than this command reads; open a new issue`,
    );
  }
  for (const edit of history.edits) {
    const at = Date.parse(edit.at);
    if (Number.isNaN(at)) return unreadable("the time of an edit");
    if (at < since) continue;
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
      body: redactText(visibleText(body), world.home),
      labeledAt: last.at,
      labeledBy: plainLogin(last.actor),
      labels,
      number,
      readyLabel: label,
      repo: name,
      title: redactText(visibleText(issue.title), world.home).replace(/\s+/g, " ").trim(),
      url: issue.html_url,
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
