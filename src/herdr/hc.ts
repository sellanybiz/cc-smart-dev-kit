import { z } from "zod";
import { isOlder } from "../update/check";
export const HC_TIMEOUT_MS = 15_000;
export const MIN_HC_VERSION = "0.1.20";
export type HcRunner = (
  args: string[],
  opts?: { timeoutMs?: number; stdin?: string },
) => { exitCode: number | null; stdout: string; stderr: string };
export class HcError extends Error {
  override name = "HcError";
  constructor(
    public kind: string,
    message: string,
    public hint: string | null = null,
    public exitCode: number | null = null,
  ) {
    super(message);
  }
}
export const defaultHcRunner: HcRunner = (args, opts) => {
  try {
    const result = Bun.spawnSync(["hc", ...args], {
      env: process.env,
      ...(opts?.stdin === undefined ? {} : { stdin: Buffer.from(opts.stdin) }),
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts?.timeoutMs ?? HC_TIMEOUT_MS,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error) {
    throw new HcError(
      "unknown",
      error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? "hc failed") : "hc failed",
      "Check that hc is installed and its core is running.",
    );
  }
};
const ForegroundSchema = z
  .object({
    argv: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    name: z.string().nullable().optional(),
    pid: z.number().nullable().optional(),
  })
  .passthrough();
export const TerminalSchema = z
  .object({
    address: z.string(),
    name: z.string().nullable().optional(),
    argv: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    labels: z.record(z.string(), z.string()).default({}),
    parent: z.string().nullable().optional(),
    pid: z.number().nullable().optional(),
    state: z.enum(["live", "finished"]),
    status: z
      .object({
        app: z.string().optional(),
        state: z.string(),
        kind: z.string().nullable().optional(),
        msg: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .default(null),
    status_ms: z.number().nullable().optional(),
    turn: z.number().optional(),
    first_message: z.unknown().optional(),
    foreground: ForegroundSchema.nullable().optional(),
  })
  .passthrough();
export type Terminal = z.infer<typeof TerminalSchema>;
export const LsTerminalSchema = z
  .object({
    address: z.string(),
    name: z.string().nullable().optional(),
    agent: z.string().optional(),
    cwd: z.string().optional(),
    state: z.enum(["live", "finished"]),
    status: z.string().nullable().optional(),
    turn: z.number().optional(),
    where: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
export type LsTerminal = z.infer<typeof LsTerminalSchema>;
export const ListSchema = z
  .object({
    terminals: z.array(LsTerminalSchema),
    machines: z.array(z.object({ name: z.string(), state: z.string() }).passthrough()).optional(),
    hidden_finished: z.number().optional(),
  })
  .passthrough();
export const ServerStatusSchema = z
  .object({
    core: z.object({ id: z.string(), name: z.string() }).passthrough(),
    version: z.string(),
  })
  .passthrough();
const ObjectSchema = z.object({}).passthrough();
export const ReadSchema = z
  .object({
    text: z.string(),
    complete: z.boolean(),
    how: z.string(),
    why: z.string().nullable().optional(),
  })
  .passthrough();
export const PutSchema = z.object({ path: z.string(), bytes: z.number() }).passthrough();
export function invoke(
  runner: HcRunner,
  args: string[],
  opts?: { timeoutMs?: number; stdin?: string },
): string {
  const result = runner(args, opts);
  if (result.exitCode === 0) return result.stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stderr);
  } catch {
    parsed = null;
  }
  const failure = z
    .object({
      error: z.object({
        kind: z.string(),
        message: z.string(),
        hint: z.string().nullable().optional(),
      }),
    })
    .safeParse(parsed);
  if (failure.success)
    throw new HcError(
      failure.data.error.kind,
      failure.data.error.message,
      failure.data.error.hint ?? null,
      result.exitCode,
    );
  throw new HcError(
    "unknown",
    result.stderr.split(/\r?\n/)[0]?.trim() || "hc did not finish (timeout or signal).",
    "Check hc and its core, then try again.",
    result.exitCode,
  );
}
function json<S extends z.ZodType>(runner: HcRunner, args: string[], schema: S): z.output<S> {
  const text = invoke(runner, args);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HcError(
      "invalid_response",
      "hc returned invalid JSON.",
      "Check the installed hc version.",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HcError(
      "invalid_response",
      `hc returned an unexpected shape: ${parsed.error.message}`,
      "Check the installed hc version.",
    );
  return parsed.data;
}
export function hcVersion(runner: HcRunner): string {
  const text = invoke(runner, ["--version"]).trim();
  const match = /^hc (\d+\.\d+\.\d+)$/.exec(text);
  if (!match?.[1]) throw new HcError("invalid_response", "hc returned an unknown version.");
  return match[1];
}
export function hcNewEnough(version: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  return !isOlder(version, MIN_HC_VERSION);
}
export function coreId(runner: HcRunner): string {
  return json(runner, ["server", "status", "--json"], ServerStatusSchema).core.id;
}
export function hcGet(runner: HcRunner, target: string): Terminal {
  return json(runner, ["get", "--json", "--", target], TerminalSchema);
}
export function hcList(
  runner: HcRunner,
  opts: { all?: boolean; labels?: Record<string, string> } = {},
) {
  const args = ["ls", "--json"];
  if (opts.all) args.push("--all");
  for (const [k, v] of Object.entries(opts.labels ?? {})) args.push("--label", `${k}=${v}`);
  return json(runner, args, ListSchema);
}
export function hcRun(runner: HcRunner, args: string[]): Terminal {
  return json(runner, ["run", "--json", ...args], TerminalSchema);
}
export function hcSend(
  runner: HcRunner,
  target: string,
  text: string,
  opts: { ifStatus?: "idle" | "working" },
) {
  return json(
    runner,
    ["send", "--json", ...(opts.ifStatus ? ["--if", opts.ifStatus] : []), "--", target, text],
    ObjectSchema,
  );
}
export function hcKeys(runner: HcRunner, target: string, keys: string[]) {
  return json(runner, ["keys", "--json", "--", target, ...keys], ObjectSchema);
}
export function hcKill(runner: HcRunner, target: string) {
  return json(runner, ["kill", "--json", "--", target], ObjectSchema);
}
export function hcRm(runner: HcRunner, target: string) {
  return json(runner, ["rm", "--json", "--", target], ObjectSchema);
}
export function hcLabel(runner: HcRunner, target: string, pairs: Record<string, string>) {
  return json(
    runner,
    ["label", "--json", "--", target, ...Object.entries(pairs).map(([k, v]) => `${k}=${v}`)],
    ObjectSchema,
  );
}
export function hcRead(runner: HcRunner, target: string, lines: number) {
  return json(runner, ["read", "--json", "--lines", String(lines), "--", target], ReadSchema);
}
export function hcPut(runner: HcRunner, target: string, file: string) {
  return json(runner, ["put", "--json", "--", target, file], PutSchema);
}
