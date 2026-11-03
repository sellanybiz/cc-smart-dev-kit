import { z } from "zod";
import { projectTaskSchema } from "./project/format";
import { DESCRIPTION_LIMIT, NOTE_LIMIT, SUBJECT_LIMIT } from "./work/types";

const fields = projectTaskSchema.shape;
const subject = z.string().trim().min(1).max(SUBJECT_LIMIT);
const description = z.string().max(DESCRIPTION_LIMIT);
const note = z.string().trim().min(1).max(NOTE_LIMIT);
const ref = z.string().min(1);
const type = z
  .enum(["blocking", "non-blocking"])
  .describe(
    "blocking (the default): its parent cannot be done, and a crew session cannot hand back, while it is open. non-blocking: noted work that holds nothing.",
  );
const blockedBy = z
  .array(ref)
  .describe("Tasks (#n) it waits for: it cannot start or be done while one of them is open.");
const projectFields = {
  when: fields.when,
  weight: fields.weight,
  flags: fields.flags,
  refs: fields.refs,
  from: fields.from,
};
export const taskSchemas = {
  create: z
    .object({
      subject,
      description: description.optional(),
      kind: z.enum(["work", ...fields.kind.options]).default("work"),
      parent: ref
        .optional()
        .describe(
          "The task (#n) it goes under. Three layers: phase › task › subtask; a subtask holds no subtasks. A crew session's tasks go under its phase by themselves.",
        ),
      status: z.enum(["pending", "in_progress"]).optional(),
      type: type.optional(),
      blocked_by: blockedBy.optional(),
      phase: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Lay out a phase of the plan by its id (as `crew start` names it): its task is made once, and `crew start` for that phase takes it over.",
        ),
      plan: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "The plan's slug (as `crew lead --plan` names it); a lead's own plan when left out. With no phase, it makes the plan's own task, subject its title.",
        ),
      ...projectFields,
    })
    .strict(),
  update: z
    .object({
      task: ref,
      subject: subject.optional(),
      description: description.optional(),
      status: z.enum(["pending", "in_progress", "done", "dropped"]).optional(),
      parent: ref.nullable().optional(),
      type: type.optional(),
      blocked_by_add: blockedBy.optional(),
      blocked_by_remove: z.array(ref).optional(),
      ...projectFields,
    })
    .strict(),
  done: z
    .object({
      task: ref,
      outcome: z.enum(["done", "dropped"]).default("done"),
      evidence: note.optional(),
      note: note.optional(),
      for_everyone: z.boolean().optional(),
    })
    .strict(),
  note: z.object({ task: ref, text: note }).strict(),
  list: z
    .object({
      scope: z.enum(["mine", "plan", "project", "all"]).default("mine"),
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
