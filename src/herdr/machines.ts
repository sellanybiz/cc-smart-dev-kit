import { readFileSync } from "node:fs";
import { z } from "zod";
import { withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";
export const MachinesSchema = z
  .object({
    version: z.literal(1),
    machines: z.record(
      z.string(),
      z
        .object({ allow: z.literal(true).optional(), production: z.literal(true).optional() })
        .strict(),
    ),
  })
  .strict();
export type Machines = z.infer<typeof MachinesSchema>;
export type MachineChange = { verb: "allow" | "forget" | "production"; name: string };
export function readMachines(file: string): Machines {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, machines: {} };
    throw error;
  }
  return MachinesSchema.parse(JSON.parse(text));
}
export function machineRule(list: Machines, name: string): "free" | "ask" | "production" {
  const entry = Object.hasOwn(list.machines, name) ? list.machines[name] : undefined;
  return entry?.production ? "production" : entry?.allow ? "free" : "ask";
}
export async function writeMachines(
  file: string,
  change: MachineChange,
  stateDir: string,
): Promise<Machines> {
  return withLock(stateDir, () => {
    if (!change.name.trim()) throw new Error("A machine name is required.");
    const list = readMachines(file);
    if (change.verb === "forget") delete list.machines[change.name];
    else
      Object.defineProperty(list.machines, change.name, {
        value: {
          ...(Object.hasOwn(list.machines, change.name) ? list.machines[change.name] : {}),
          [change.verb]: true,
        },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    atomicWrite(file, `${JSON.stringify(MachinesSchema.parse(list), null, 2)}\n`, 0o600);
    return list;
  });
}
