/** Project commands that need the heavy slot: the schemas. Defaults and readers: `kind-defaults.ts`. */
import { z } from "zod";
import { KIND_NAME } from "./kind-defaults";

/** How the classifier knows a kind in a Bash command (`classify.ts`). */
export const matchRuleSchema = z.union([
  z.strictObject({
    /** The program, without a folder or `.exe`: `tsc`, `vitest`, `docker`. */
    tool: z.string().min(1),
    /** The first words after the program that are not options, in order: `["build"]`. */
    sub: z.array(z.string().min(1)).optional(),
    /** Options that must all be there: `["--build"]` (also as `--build=…`). */
    flags: z.array(z.string().min(1)).optional(),
    /** Some argument holds this text (case-insensitive): a config file's name. */
    argIncludes: z.string().min(1).optional(),
    /** Options of this program whose value is the next word (so it is not a `sub`). */
    valued: z.array(z.string().min(1)).optional(),
  }),
  z.strictObject({
    /** A `package.json` script, run with `npm run`, `bun run`, `pnpm`, `yarn`… */
    script: z.string().min(1),
  }),
]);

export type MatchRule = z.infer<typeof matchRuleSchema>;

export const kindSpecSchema = z.strictObject({
  /** Options that only print and stop (`--version`): such a run takes no slot. */
  printOnly: z.array(z.string().min(1)).optional(),
  /**
   * A run of this kind that names only existing files (`vitest run src/a.test.ts`, `bun run
   * test:run src/a.test.ts`), at most `LIGHT_FILE_LIMIT` of them, takes no slot: it never
   * waits behind full runs. More files, a folder, a filter that is no file, or no file at all:
   * a heavy slot. The operands are read past `skipWords` and the values of `valuedFlags`.
   * Came with 1.5.0 (`JOB_KIND_KEYS_SINCE` in `src/project/config.ts`); until 1.8.0 such a
   * run also took no slot.
   */
  noSlotForFiles: z.boolean().optional(),
  /** Leading words that are the tool's own command, not files (`vitest run`): `noSlotForFiles` reads past them. */
  skipWords: z.array(z.string().min(1)).optional(),
  /**
   * Options whose value is the next word (`--project x`), over vitest's and jest's own list, so
   * `noSlotForFiles` never reads it as a file. An option no list knows gives the run a slot.
   */
  valuedFlags: z.array(z.string().min(1)).optional(),
  /** How the classifier finds this kind in a Bash command. None: never by itself. */
  match: z.array(matchRuleSchema).optional(),
  /** One line for `cc-smart-dev-kit job kinds`. */
  about: z.string().min(1).optional(),

  /** ignored since 2.0 */
  gb: z.unknown().optional(),
  /** ignored since 2.0 */
  filesGb: z.unknown().optional(),
  /** ignored since 2.0 */
  maxFiles: z.unknown().optional(),
  /** ignored since 2.0 */
  workers: z.unknown().optional(),
  /** ignored since 2.0 */
  light: z.unknown().optional(),
});

export type KindSpec = z.infer<typeof kindSpecSchema>;
export type Kinds = Readonly<Record<string, KindSpec>>;

export const kindsSchema = z.record(
  z.string().regex(KIND_NAME, "a kind's name is lower-case letters, digits and : . _ -"),
  kindSpecSchema,
);

export {
  DEFAULT_KINDS,
  IGNORED_KIND_FIELDS,
  ignoredFieldsOf,
  isPrintOnly,
  isWatchRun,
  KIND_NAME,
  LIGHT_FILE_LIMIT,
  mergeKinds,
  namesOnlyFiles,
} from "./kind-defaults";
