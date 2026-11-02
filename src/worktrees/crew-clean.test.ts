import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCrew, readLead, writeLead } from "../crew/store";
import { boardWorld, NOW } from "../testing/board-world";
import { LEAD_SESSION } from "../testing/crew-world";
import { git } from "../testing/temp";
import { runAutoClean } from "./auto-clean";
import { runWorktrees } from "./command";
import { cleanOrphanCrew, orphanCrewOf } from "./crew-clean";

const DAY = 24 * 60 * 60_000;

describe("crew work whose lead is gone", () => {
  test.each(["[null]", '[{"state":"working"}]'])(
    "partial agent view %s never proves a lead gone",
    async (json) => {
      const world = await boardWorld();
      const crew = await world.addCrew({ state: "done" });
      const lead = readLead(world.paths.stateDir, world.repo, LEAD_SESSION);
      if (lead === null) throw new Error("missing test lead");
      await writeLead(
        world.paths.stateDir,
        { ...lead, sessionUnknownSince: new Date(NOW - 2 * DAY).toISOString() },
        NOW,
      );
      const read = await orphanCrewOf(world.ctx({}, { FAKE_AGENTS_JSON: json }));
      expect(read.gone.has(crew.id)).toBe(false);
    },
  );
  test.each(["session", "watch"])("a live %s keeps orphan cleanup away", async (source) => {
    const world = await boardWorld();
    const crew = await world.addCrew({ state: "done" });
    const lead = readLead(world.paths.stateDir, world.repo, LEAD_SESSION);
    if (lead === null) throw new Error("missing test lead");
    await writeLead(
      world.paths.stateDir,
      {
        ...lead,
        sessionUnknownSince: new Date(NOW - 2 * DAY).toISOString(),
      },
      NOW,
    );
    const ctx = world.ctx({
      sessions: () =>
        source === "session"
          ? [{ pid: 42, sessionId: LEAD_SESSION, cwd: world.repo, name: lead.name }]
          : [],
      watchAlive: () => source === "watch",
    });
    expect((await orphanCrewOf(ctx)).gone.has(crew.id)).toBe(false);
    expect(
      readLead(world.paths.stateDir, world.repo, LEAD_SESSION)?.sessionUnknownSince,
    ).toBeNull();
  });
  test.each(["manual", "background"])(
    "%s clean removes merged orphan work and its agent record",
    async (mode) => {
      const world = await boardWorld();
      const crew = await world.addCrew({ state: "done", name: "renamed background job" });
      const lead = readLead(world.paths.stateDir, world.repo, LEAD_SESSION);
      if (lead === null) throw new Error("missing test lead");
      await writeLead(world.paths.stateDir, { ...lead, endedAt: new Date(NOW).toISOString() }, NOW);
      git(world.repo, "update-ref", "refs/remotes/origin/main", "HEAD");
      const ctx = world.ctx({ now: () => Date.now() + 2 * 60 * 60_000 });
      const lock = async () => ({ close() {} });
      if (mode === "manual") {
        expect(
          await runWorktrees(
            world.paths,
            { clean: true, json: false, noFetch: true, remove: null },
            ctx.env,
            world.repo,
            { print: () => {}, error: () => {} },
            lock,
            ctx,
          ),
        ).toBe(0);
      } else {
        expect(
          await runAutoClean(world.repo, "merge", {
            env: ctx.env,
            facts: ctx.scanFacts,
            hold: lock,
            now: ctx.now,
            paths: world.paths,
            crewContext: ctx,
          }),
        ).toBe("cleaned");
      }
      expect(existsSync(crew.worktree)).toBe(false);
      expect(readCrew(world.paths.stateDir, world.repo, crew.id)?.state).toBe("removed");
      expect(world.claudeCalls()).toContainEqual(["rm", crew.shortId ?? ""]);
    },
  );
  test.each(["ended", "unknown"])(
    "%s lead: only merged work is removed through crew rm, renamed session included",
    async (cause) => {
      const world = await boardWorld();
      const crew = await world.addCrew({ state: "done", name: "a renamed session" });
      writeFileSync(join(crew.worktree, "work.txt"), "finished\n");
      git(crew.worktree, "add", ".");
      git(crew.worktree, "commit", "-m", "finished work");
      git(world.repo, "merge", "--squash", crew.branch);
      git(world.repo, "commit", "-m", "squashed work");
      const lead = readLead(world.paths.stateDir, world.repo, LEAD_SESSION);
      if (lead === null) throw new Error("missing test lead");
      await writeLead(
        world.paths.stateDir,
        {
          ...lead,
          ...(cause === "ended"
            ? { endedAt: new Date(NOW).toISOString() }
            : { sessionUnknownSince: new Date(NOW - DAY - 1).toISOString() }),
        },
        NOW,
      );
      const ctx = world.ctx();
      const orphaned = await orphanCrewOf(ctx);
      expect(orphaned.gone.has(crew.id)).toBe(true);
      const lines: string[] = [];
      const result = await cleanOrphanCrew(
        ctx,
        orphaned,
        { label: "main", ref: git(world.repo, "rev-parse", "HEAD").trim() },
        (line) => lines.push(line),
      );
      expect(result.removed.map((one) => one.path)).toEqual([crew.worktree]);
      expect(existsSync(crew.worktree)).toBe(false);
      expect(readCrew(world.paths.stateDir, world.repo, crew.id)?.state).toBe("removed");
      expect(world.claudeCalls()).toContainEqual(["rm", crew.shortId ?? ""]);
      expect(lines.join("\n")).toContain("its lead is gone");
    },
  );

  test("unmerged work is kept with its next steps; unknown agent view proves nothing", async () => {
    const world = await boardWorld();
    const crew = await world.addCrew({ state: "stopped" });
    writeFileSync(join(crew.worktree, "work.txt"), "unmerged\n");
    git(crew.worktree, "add", ".");
    git(crew.worktree, "commit", "-m", "unmerged work");
    const lead = readLead(world.paths.stateDir, world.repo, LEAD_SESSION);
    if (lead === null) throw new Error("missing test lead");
    await writeLead(world.paths.stateDir, { ...lead, endedAt: new Date(NOW).toISOString() }, NOW);
    const ctx = world.ctx();
    const orphaned = await orphanCrewOf(ctx);
    const lines: string[] = [];
    const result = await cleanOrphanCrew(
      ctx,
      orphaned,
      { label: "main", ref: git(world.repo, "rev-parse", "HEAD").trim() },
      (line) => lines.push(line),
    );
    expect(result.removed).toEqual([]);
    expect(existsSync(crew.worktree)).toBe(true);
    expect(world.claudeVerbs()).not.toContain("rm");
    expect(lines.join("\n")).toContain(
      `its lead is gone: remove it with \`crew rm\`, or continue it with \`crew start ${crew.phase} --continue`,
    );

    await writeLead(
      world.paths.stateDir,
      { ...lead, endedAt: null, sessionUnknownSince: new Date(NOW - 2 * DAY).toISOString() },
      NOW,
    );
    const unknown = await orphanCrewOf(
      world.ctx({
        runProgram: () => ({
          error: null,
          exitCode: 1,
          stderr: "unavailable",
          stdout: "",
          timedOut: false,
        }),
      }),
    );
    expect(unknown.gone.size).toBe(0);
  });
});
