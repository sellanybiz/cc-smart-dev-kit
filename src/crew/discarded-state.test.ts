import { describe, expect, test } from "bun:test";
import { boardWorld } from "../testing/board-world";
import { runCrew } from "./command";
import { finishesWait } from "./places";
import { holdsName } from "./start";

describe("discarded crew state", () => {
  test("releases names and refuses stop/resume without acting on the old session", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "discarded", worktree: false });
    expect(holdsName(record)).toBe(false);
    expect(finishesWait(record)).toBe(false);
    expect(await runCrew(["stop", record.id], world.ctx())).toBe(1);
    expect(await runCrew(["resume", record.id], world.ctx())).toBe(1);
    expect(world.err).toEqual([
      `crew stop: ${record.name} is discarded; it has no session left`,
      `crew resume: ${record.name} is discarded; there is nothing to bring back`,
    ]);
    expect(world.claudeVerbs()).toEqual([]);
  });
});
