import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    "Expected a calendar date (YYYY-MM-DD)",
  );
export const projectTaskSchema = z
  .object({
    id: z.string().regex(/^T-[a-z2-7]{6}$/),
    title: z.string().min(1).max(200),
    kind: z.enum(["production", "database", "teammate", "follow-up"]),
    status: z.enum(["open", "done", "dropped"]),
    when: z.enum(["now", "next-release", "any"]).optional(),
    weight: z.enum(["blocks-release", "after-deploy", "owner"]).optional(),
    flags: z
      .array(z.enum(["needs-yes", "twice-safe", "spends-money", "real-people", "destructive"]))
      .optional(),
    created: date,
    closed: date.optional(),
    from: z.string().optional(),
    refs: z.array(z.string()).optional(),
    evidence: z.string().optional(),
  })
  .passthrough();
export type ProjectTaskFields = z.infer<typeof projectTaskSchema>;
export type ProjectTaskKind = ProjectTaskFields["kind"];
export type ProjectTask = ProjectTaskFields & { body: string; file: string };
export const KIND_HEADINGS: Record<ProjectTaskKind, readonly string[]> = {
  production: ["What and why", "Steps", "How to check", "If it goes wrong"],
  database: ["What and why", "Steps", "How to check", "If it goes wrong"],
  teammate: ["What and why", "Steps", "How to check", "If it goes wrong"],
  "follow-up": ["What and why", "Steps", "How to check", "If it goes wrong"],
};
export type ParseProjectTask = { ok: true; task: ProjectTask } | { ok: false; why: string };
/** The task's own fields beside its front matter: no front-matter key may use these names. */
const RESERVED_KEYS = ["body", "file"] as const;
export function parseProjectTask(text: string, file: string): ParseProjectTask {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { ok: false, why: `${file}: missing front matter --- delimiters` };
  try {
    const raw: unknown = Bun.YAML.parse(match[1] ?? "");
    // Unknown keys are kept beside the task's own `body` and `file`, so those two names are reserved.
    for (const key of RESERVED_KEYS) {
      if (typeof raw === "object" && raw !== null && Object.hasOwn(raw, key)) {
        return {
          ok: false,
          why: `${file}: "${key}" is a reserved name and cannot be a front-matter key`,
        };
      }
    }
    const parsed = projectTaskSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, why: `${file}: invalid front matter: ${parsed.error.message}` };
    return { ok: true, task: { ...parsed.data, body: text.slice(match[0].length), file } };
  } catch (error) {
    return {
      ok: false,
      why: `${file}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
export function renderProjectTask(task: ProjectTask): string {
  const { body, file: _file, ...fields } = task;
  const known = Object.keys(projectTaskSchema.shape);
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
