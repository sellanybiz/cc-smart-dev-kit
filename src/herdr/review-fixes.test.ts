import { expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import { reportPath, writeBrief, writePrivate } from "./brief";
import { dialogOptions, followEvents, WaitBarrier, waitFacts } from "./command";
import { herdrChecks } from "./doctor";
import type { HcRunner } from "./hc";
import { processAncestors } from "./identity";
import { parseHerdrArgs } from "./words";

test("1 dialog ignores conversation and requires contiguous numbers and one cursor", () => {
  expect(
    dialogOptions(
      "1. Old\n2. Old\n5. Old\n\nChoose\n❯ 1. Yes\n  2. Yes, always\n     for this session\n\nEnter to confirm",
    ),
  ).toEqual([
    { number: 1, label: "Yes", cursor: true },
    { number: 2, label: "Yes, always for this session", cursor: false },
  ]);
  for (const text of ["1. A\n2. B", "❯ 1. A\n❯ 2. B", "❯ 1. A\n3. C"])
    expect(dialogOptions(text)).toBeNull();
});
test("2/6 snapshots, since and all barrier", () => {
  const snapshot = {
    terminals: [
      { address: "t1", state: "live", status: { state: "blocked" }, status_ms: 8, turn: 6 },
      { address: "t2", state: "live", status: { state: "done" }, status_ms: 4, turn: 4 },
    ],
  };
  expect(waitFacts(snapshot, { t2: 4 })).toEqual([
    { terminal: "t1", state: "blocked", status_ms: 8, turn: 6 },
  ]);
  expect(waitFacts({ method: "missed", params: snapshot }, { t2: 4 })).toEqual([
    { terminal: "t1", state: "blocked", status_ms: 8, turn: 6 },
  ]);
  expect(waitFacts(snapshot)).toHaveLength(2);
  const barrier = new WaitBarrier("all", { t2: 4 });
  expect(barrier.consume(snapshot)).toBe(true);
  expect(
    barrier.consume({
      method: "event",
      params: { terminal: "t2", type: "status", data: { state: "done", status_ms: 9, turn: 5 } },
    }),
  ).toBe(true);
  expect(barrier.pending()).toEqual([]);
  expect(barrier.news).toHaveLength(2);
});
test("3 report names unique and 4 no global lock for brief writes", async () => {
  const dir = tempDir();
  const a = reportPath(dir, "core", "kit-one"),
    b = reportPath(dir, "core", "kit-one");
  expect(a).not.toBe(b);
  expect(a).toMatch(/\.report-\d{4}-.*Z.*\.md$/);
  await withLock(dir, async () => {
    await writeBrief(dir, "core", "kit-one", "brief", true);
    await writePrivate(dir, a, "report");
  });
  expect(readFileSync(a, "utf8")).toBe("report");
});
test("5 doctor core down warns, does not fail; a missing terminal is skipped", () => {
  const r: HcRunner = (args) =>
    args[0] === "--version"
      ? { exitCode: 0, stdout: "hc 0.1.20", stderr: "" }
      : {
          exitCode: 1,
          stdout: "",
          stderr: JSON.stringify({ error: { kind: "unavailable", message: "core down" } }),
        };
  const checks = herdrChecks(r);
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(checks.at(-1)).toMatchObject({ warn: true, fix: "Start Herdr, then run doctor again." });
});
test("doctor skips one disappearing terminal without losing other counts", () => {
  const r: HcRunner = (args) =>
    args[0] === "get"
      ? {
          exitCode: 3,
          stdout: "",
          stderr: JSON.stringify({ error: { kind: "not_found", message: "gone" } }),
        }
      : {
          exitCode: 0,
          stderr: "",
          stdout:
            args[0] === "--version"
              ? "hc 0.1.20"
              : JSON.stringify(
                  args[0] === "server"
                    ? { core: { id: "core", name: "local" }, version: "0.1.20" }
                    : { terminals: [{ address: "t1", state: "live" }] },
                ),
        };
  expect(herdrChecks(r)).toContainEqual({
    ok: true,
    warn: true,
    text: "Herdr: skipped t1: gone",
    fix: "Read its pane: hc attach t1",
  });
  expect(herdrChecks(r).at(-1)?.text).toBe(
    "Herdr: 0 live kit children, 0 independent sessions; 0 blocked.",
  );
});
test("8 event stream ignores blank lines and carries stderr errors", async () => {
  const dir = tempDir(),
    file = join(dir, "hc");
  const old = process.env.PATH;
  try {
    process.env.PATH = dir;
    writeFileSync(
      file,
      `#!/bin/sh\nprintf '\\n%s\\n' '{"terminals":[{"address":"t1","state":"live","status":{"state":"blocked"},"status_ms":8,"turn":6}]}'\n`,
    );
    chmodSync(file, 0o755);
    expect(await followEvents({}, 1000)).toEqual({
      news: [{ terminal: "t1", state: "blocked", status_ms: 8, turn: 6 }],
      pending: [],
      timeout: false,
    });
    writeFileSync(
      file,
      `#!/bin/sh\nprintf '%s' '{"error":{"kind":"unavailable","message":"stream down","hint":"Start Herdr"}}' >&2\nexit 1\n`,
    );
    await expect(followEvents({}, 1000)).rejects.toMatchObject({
      message: "stream down",
      hint: "Start Herdr",
    });
  } finally {
    if (old === undefined) delete process.env.PATH;
    else process.env.PATH = old;
  }
});
test("10 process list shares bounded ancestry walk and 11 since parses", () => {
  expect(
    processAncestors(30, "darwin", () => [
      { pid: 30, parentPid: 20, path: null },
      { pid: 20, parentPid: 10, path: null },
      { pid: 10, parentPid: 20, path: null },
    ]),
  ).toEqual([20, 10]);
  expect(parseHerdrArgs(["wait", "--seen", "t1:123"])).toEqual({
    verb: "wait",
    mode: "any",
    seen: { t1: 123 },
  });
});
