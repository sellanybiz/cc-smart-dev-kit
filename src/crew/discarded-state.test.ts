import { describe, expect, test } from "bun:test";
import { boardWorld } from "../testing/board-world";
import { resumePlace } from "./answer";
import { runCrew } from "./command";
import { finishesWait } from "./places";
import { holdsName } from "./start";
import { updateCrew } from "./store";

describe("discarded crew state", () => {
  test("an incomplete discard transaction refuses every shared resume path", async () => {
    const world = await boardWorld();
    const record = await world.addCrew({ state: "stopped" });
    const pending = await updateCrew(
      world.paths.stateDir,
      world.repo,
      record.id,
      {
        discardPending: {
          head: "a".repeat(40),
          archivedHead: "b".repeat(40),
          indexPath: "index",
          indexBackup: "backup",
          indexArchived: "archived",
        },
      },
      world.ctx().now(),
    );
    expect(resumePlace(pending).ok).toBe(false);
    expect(await runCrew(["resume", record.id], world.ctx())).toBe(1);
    expect(world.err.join("\n")).toContain("discard");
    expect(world.claudeVerbs()).toEqual([]);
  });
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
