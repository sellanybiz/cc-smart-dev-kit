/**
 * The port lock (`hold-port.ts`): one holder at a time, and a clear answer when another
 * program already listens there. Its one caller is `worktrees --clean` / `--remove`.
 */
import { describe, expect, test } from "bun:test";
import { holdPort } from "./hold-port";

describe("holdPort", () => {
  test("a port nobody holds is taken, and a second holder is refused", async () => {
    const first = await holdPort(0);
    if (!("held" in first)) throw new Error("the first hold failed");
    const address = first.held.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    first.held.close();

    const held = await holdPort(port);
    if (!("held" in held)) throw new Error("the second hold failed");
    expect(await holdPort(port)).toEqual({ taken: true });
    held.held.close();
    // Released with the close: the port is free again.
    const again = await holdPort(port);
    expect("held" in again).toBe(true);
    if ("held" in again) again.held.close();
  });

  test("a port the system keeps for itself is an error, not a taken lock", async () => {
    // Port 1 is privileged: `listen` is refused with EACCES, not EADDRINUSE. Only root can bind
    // it, so a root run has nothing to prove here.
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const refused = await holdPort(1);
    expect(refused).toEqual({ error: "EACCES" });
  });
});
