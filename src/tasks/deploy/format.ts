/**
 * The deploy task's file format (`docs/design/tasks.md`): one Markdown file per step owed around
 * a deploy to staging or prod. The front matter is one JSON value per line, so a diff of a task
 * shows the field that changed. Every shape of the file has one home here: the id, the
 * environments, the schema, the parse and the render.
 */
import { z } from "zod";
import { splitFrontmatter } from "../../project/frontmatter";

/** The environments a deploy task can belong to, in the order a release visits them. */
export const DEPLOY_ENVS = ["staging", "prod"] as const;
export type DeployEnv = (typeof DEPLOY_ENVS)[number];

/**
 * The environments with the riskiest first (prod, then staging): the order a short summary lists
 * them in. Derived from `DEPLOY_ENVS`, so an environment added there is never left out of it.
 */
export const DEPLOY_ENVS_RISK_FIRST: readonly DeployEnv[] = [...DEPLOY_ENVS].reverse();

/** When in the deploy the step is owed. */
export const DEPLOY_STEPS = ["before", "after"] as const;
export type DeployStep = (typeof DEPLOY_STEPS)[number];

/** What an open task does to the release: a blocking one must be done, a non-blocking one may be dropped. */
export const DEPLOY_TYPES = ["blocking", "non-blocking"] as const;
export type DeployType = (typeof DEPLOY_TYPES)[number];

export const DEPLOY_FLAGS = [
  "needs-yes",
  "twice-safe",
  "spends-money",
  "real-people",
  "destructive",
] as const;

/**
 * A deploy task's id: `<env>-<YYYYMMDD>-<HHMMSS>` in UTC, with `-2`, `-3` when the second is
 * taken. The one regex for the shape; the id's env is its first part.
 */
export const DEPLOY_TASK_ID = /^(prod|staging)-\d{8}-\d{6}(-\d+)?$/;

/** True when `value` is a deploy task id as written. */
export function isDeployTaskId(value: string): boolean {
  return DEPLOY_TASK_ID.test(value);
}

/** The environment an id names, or null when `value` is not a deploy task id. */
export function deployIdEnv(value: string): DeployEnv | null {
  return DEPLOY_TASK_ID.test(value) ? (value.split("-")[0] as DeployEnv) : null;
}

/**
 * The id a task file's name starts with (`<id>-<slug>.md`), or null. The slug may start with a
 * number (`...-144503-2fa.md`), so the longer id (`-2`) is taken only when it is a whole id.
 */
export function deployIdOfFileName(name: string): string | null {
  const parts = name.replace(/\.md$/, "").split("-");
  for (const length of [4, 3]) {
    const candidate = parts.slice(0, length).join("-");
    if (parts.length >= length && DEPLOY_TASK_ID.test(candidate)) return candidate;
  }
  return null;
}

/**
 * An ISO date-time in UTC, written with a `Z` and nothing else (`2026-11-17T14:45:03Z`; a
 * fraction of a second is allowed). A zone offset would make the same task read differently on
 * two machines, so it is refused, and a date that does not exist (`2026-02-31`) is refused too.
 */
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "Expected a UTC date-time ending in Z")
  .refine((value) => {
    const parsed = new Date(value);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19)
    );
  }, "Expected a calendar date-time that exists");

/** `now` as a task's `created` / `closed` value: UTC, whole seconds, ending in `Z`. */
export function taskInstant(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const deployTaskSchema = z
  .object({
    id: z.string().regex(DEPLOY_TASK_ID),
    title: z.string().min(1).max(200),
    env: z.enum(DEPLOY_ENVS),
    status: z.enum(["open", "done", "dropped"]),
    deploy: z.enum(DEPLOY_STEPS),
    type: z.enum(DEPLOY_TYPES),
    twin: z.string().regex(DEPLOY_TASK_ID).optional(),
    flags: z.array(z.enum(DEPLOY_FLAGS)).optional(),
    created: instant,
    closed: instant.optional(),
    from: z.string().optional(),
    refs: z.array(z.string()).optional(),
    evidence: z.string().optional(),
  })
  .passthrough();
export type DeployTaskFields = z.infer<typeof deployTaskSchema>;
export type DeployTask = DeployTaskFields & { body: string; file: string };

export type ParseDeployTask = { ok: true; task: DeployTask } | { ok: false; why: string };

/** The task's own fields beside its front matter: no front-matter key may use these names. */
const RESERVED_KEYS = ["body", "file"] as const;

/**
 * Where a task file sits, from its path below the tasks folder as segments: `<env>/x.md` is open,
 * `<env>/archive/x.md` is closed. Null for any other place. Callers split with `path` functions
 * (Windows) or on `/` (git's paths) and share this one rule.
 */
export function folderPlace(
  segments: readonly string[],
): { env: DeployEnv; archived: boolean } | null {
  const env = DEPLOY_ENVS.find((name) => name === segments[0]);
  if (env === undefined) return null;
  if (segments.length === 2) return { env, archived: false };
  if (segments.length === 3 && segments[1] === "archive") return { env, archived: true };
  return null;
}

/**
 * Parses a task file's text. `env` is the environment of the folder it was found in: the
 * front matter's `env` and the id's first part must both equal it, or the file is broken (a
 * task in the wrong folder would be released with the wrong deploy).
 */
export function parseDeployTask(text: string, file: string, env: DeployEnv): ParseDeployTask {
  const parts = splitFrontmatter(text);
  if (!parts) return { ok: false, why: `${file}: missing front matter --- delimiters` };
  try {
    const raw: unknown = Bun.YAML.parse(parts.header);
    // Unknown keys are kept beside the task's own `body` and `file`, so those two names are reserved.
    for (const key of RESERVED_KEYS) {
      if (typeof raw === "object" && raw !== null && Object.hasOwn(raw, key)) {
        return {
          ok: false,
          why: `${file}: "${key}" is a reserved name and cannot be a front-matter key`,
        };
      }
    }
    const parsed = deployTaskSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, why: `${file}: invalid front matter: ${parsed.error.message}` };
    const fields = parsed.data;
    if (fields.env !== env)
      return {
        ok: false,
        why: `${file}: env is "${fields.env}" but the file is in the ${env} folder: move it, or fix the env`,
      };
    if (deployIdEnv(fields.id) !== env)
      return {
        ok: false,
        why: `${file}: id ${fields.id} does not start with "${env}-" like the folder it is in`,
      };
    return { ok: true, task: { ...fields, body: parts.body, file } };
  } catch (error) {
    return {
      ok: false,
      why: `${file}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function renderDeployTask(task: DeployTask): string {
  const { body, file: _file, ...fields } = task;
  const known = Object.keys(deployTaskSchema.shape);
  const keys = [
    ...known,
    ...Object.keys(fields)
      .filter((key) => !known.includes(key))
      .sort(),
  ];
  return `---\n${keys
    .filter((key) => fields[key] !== undefined)
    .map(
      (key) =>
        `${/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) ? key : JSON.stringify(key)}: ${JSON.stringify(fields[key])}`,
    )
    .join("\n")}\n---\n${body}`;
}
