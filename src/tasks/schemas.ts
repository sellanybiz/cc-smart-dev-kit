import { z } from "zod";
import { projectTaskSchema } from "./project/format";
import { DESCRIPTION_LIMIT, NOTE_LIMIT, SUBJECT_LIMIT } from "./work/types";

const fields = projectTaskSchema.shape;
const subject = z.string().trim().min(1).max(SUBJECT_LIMIT);
const description = z.string().max(DESCRIPTION_LIMIT);
const note = z.string().trim().min(1).max(NOTE_LIMIT);
const ref = z.string().min(1);
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
      parent: ref.optional(),
      status: z.enum(["pending", "in_progress"]).optional(),
      waits_for: z.array(ref).optional(),
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
      waits_for_add: z.array(ref).optional(),
      waits_for_remove: z.array(ref).optional(),
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
  get: z.object({ task: ref, offset: z.number().int().nonnegative().default(0) }).strict(),
  search: z
    .object({ text: z.string().min(1), include_closed: z.boolean().default(false) })
    .strict(),
  delete: z.object({ task: ref }).strict(),
};
export type TaskOperation = keyof typeof taskSchemas;
