import { isAbsolute } from "node:path";
import { z } from "zod";
import { DEPLOY_ENVS, DEPLOY_TYPES, deployTaskSchema } from "./deploy/format";
import { DESCRIPTION_LIMIT, NOTE_LIMIT, SUBJECT_LIMIT } from "./work/types";

const fields = deployTaskSchema.shape;
const subject = z.string().trim().min(1).max(SUBJECT_LIMIT);
const description = z.string().max(DESCRIPTION_LIMIT);
const note = z.string().trim().min(1).max(NOTE_LIMIT);
const ref = z.string().min(1);
const type = z
  .enum(DEPLOY_TYPES)
  .describe(
    "blocking or non-blocking. A work task: blocking (the default) holds its parent while it is open; non-blocking holds nothing. A prod or staging deploy task: required; blocking holds the release gate until it is done, non-blocking is done or dropped with a reason.",
  );
const blockedBy = z
  .array(ref)
  .describe("Tasks (#n) it waits for: it cannot start or be done while one of them is open.");
const bindings = {
  agent: z.string().describe("The builder subagent's name or id.").optional(),
  branch: z.string().describe("The builder's git branch.").optional(),
  worktree: z
    .string()
    .refine(isAbsolute, "worktree must be an absolute path")
    .describe("The builder's absolute worktree path.")
    .optional(),
  base: z.string().describe("The commit sha the builder started from.").optional(),
};
/** The fields only a deploy task (kind prod or staging) has; a work task refuses each of them. */
const deployFields = {
  deploy: fields.deploy
    .optional()
    .describe(
      "Deploy task only, required there: when the step is owed, before or after the deploy.",
    ),
  flags: fields.flags,
  refs: fields.refs,
  from: fields.from,
};
export const taskSchemas = {
  create: z
    .object({
      subject,
      ...bindings,
      description: description.optional(),
      kind: z
        .enum(["work", ...DEPLOY_ENVS])
        .default("work")
        .describe(
          "work (the default): a task on this machine. prod or staging: a deploy task, a step owed around a deploy, written as a file to commit with your branch (deploy and type are then required).",
        ),
      pair: z
        .boolean()
        .optional()
        .describe(
          "Deploy task only, with kind staging: also create the prod task, each naming the other as its twin.",
        ),
      parent: ref
        .optional()
        .describe(
          "The task (#n) it goes under: a phase, or its plan (the task then waits there for a phase). Layers: plan › phase › task; a task holds nothing.",
        ),
      status: z.enum(["pending", "in_progress"]).optional(),
      type: type.optional(),
      blocked_by: blockedBy.optional(),
      phase: z.string().trim().min(1).optional().describe("Create the plan phase once, by its id."),
      plan: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "The plan's slug. For a phase it defaults to the caller's plan in flight, else the plan being finished, else the next queued plan (the lowest-numbered own open plan with an open phase), else its latest own open plan, never an older one; with no open default a phase needs plan. With no phase or parent, it makes the plan task. A task with neither plan nor parent is loose, whatever plans are open; to add a task to a plan, name its phase, or its plan, as parent.",
        ),
      ...deployFields,
    })
    .strict(),
  take: z
    .object({
      task: ref.describe("A plan slug or task reference (#n)."),
      from: z.string().min(1).optional(),
      force: z.boolean().default(false),
    })
    .strict(),
  update: z
    .object({
      task: ref,
      ...bindings,
      subject: subject.optional(),
      description: description.optional(),
      status: z
        .enum(["pending", "in_progress", "done", "dropped", "open"])
        .optional()
        .describe(
          "open reopens a closed deploy task (a deploy that was rolled back); a work task has pending and in_progress. Close a task with task_done.",
        ),
      parent: ref.nullable().optional(),
      type: type.optional(),
      blocked_by_add: blockedBy.optional(),
      blocked_by_remove: z.array(ref).optional(),
      ...deployFields,
    })
    .strict(),
  done: z
    .object({
      task: ref,
      outcome: z.enum(["done", "dropped"]).default("done"),
      evidence: note.optional(),
      note: note.optional(),
    })
    .strict(),
  note: z.object({ task: ref, text: note }).strict(),
  list: z
    .object({
      scope: z.enum(["mine", "plan", "project", "all"]).default("mine"),
      plan: z.string().trim().min(1).optional(),
      open_only: z.boolean().default(true),
    })
    .strict(),
  get: z
    .object({
      task: ref,
      offset: z.number().int().nonnegative().default(0),
      history: z
        .boolean()
        .default(false)
        .describe("Also print every earlier description in full, under its history line."),
    })
    .strict(),
  search: z
    .object({ text: z.string().min(1), include_closed: z.boolean().default(false) })
    .strict(),
  delete: z.object({ task: ref }).strict(),
};
export type TaskOperation = keyof typeof taskSchemas;
/** The operations that change nothing: the MCP read-only hint, and a read answers even when the caller's claims cannot be moved (`ops.ts`). */
export const READ_ONLY_OPERATIONS: ReadonlySet<TaskOperation> = new Set(["list", "get", "search"]);
