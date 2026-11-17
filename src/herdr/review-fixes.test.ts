import { expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import { reportPath, writeBrief, writePrivate } from "./brief";
import { followEvents, WaitBarrier, waitFacts } from "./command";
import { herdrChecks } from "./doctor";
import type { HcRunner } from "./hc";
import { processAncestors } from "./identity";
import { parseHerdrArgs } from "./words";

test("2/6 snapshots, since and all barrier", () => {
  const snapshot = {
    terminals: [
      { address: "t1", state: "live", status: { state: "error" }, status_ms: 8, turn: 6 },
      { address: "t2", state: "live", status: { state: "done" }, status_ms: 4, turn: 4 },
    ],
  };
  expect(waitFacts(snapshot, { t2: { turn: 4, state: "done" } })).toEqual([
    { terminal: "t1", state: "error", status_ms: 8, turn: 6 },
  ]);
  expect(
    waitFacts({ method: "missed", params: snapshot }, { t2: { turn: 4, state: "done" } }),
  ).toEqual([{ terminal: "t1", state: "error", status_ms: 8, turn: 6 }]);
  expect(waitFacts(snapshot)).toHaveLength(2);
  const barrier = new WaitBarrier("all", { t2: { turn: 4, state: "done" } });
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
  expect(a).toMatch(/\/report-\d{4}-.*Z.*\.md$/);
  await withLock(dir, async () => {
    await writeBrief(dir, "core", "kit-one", "brief", true);
    await writePrivate(a, "report");
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
      `#!/bin/sh\nprintf '\\n%s\\n' '{"terminals":[{"address":"t1","state":"live","status":{"state":"done"},"status_ms":8,"turn":6}]}'\n`,
    );
    chmodSync(file, 0o755);
    expect(await followEvents({}, 1000)).toEqual({
      addresses: ["t1"],
      news: [{ terminal: "t1", state: "done", status_ms: 8, turn: 6 }],
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
test("buffered status news is drained and enrich disappearance reports finished", async () => {
  const dir = tempDir(),
    file = join(dir, "hc"),
    old = process.env.PATH;
  try {
    process.env.PATH = dir;
    const lines = [
      {
        terminals: [
          { address: "a", state: "live", status: { state: "working" }, turn: 1 },
          { address: "b", state: "live", status: { state: "working" }, turn: 1 },
        ],
      },
      {
        method: "event",
        params: { terminal: "a", type: "status", data: { state: "done", turn: 2 } },
      },
      {
        method: "event",
        params: { terminal: "b", type: "status", data: { state: "done", turn: 2 } },
      },
    ]
      .map((v) => JSON.stringify(v))
      .join("\n");
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${lines}'\n`);
    chmodSync(file, 0o755);
    const result = await followEvents({}, 1000);
    expect(result).toMatchObject({
      news: [
        { terminal: "a", state: "done", turn: 2 },
        { terminal: "b", state: "done", turn: 2 },
      ],
    });
    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = get ]; then printf '%s' '{"error":{"kind":"not_found","message":"gone"}}' >&2; exit 3; fi\nprintf '%s\\n' '{"method":"event","params":{"terminal":"a","type":"status","data":{"state":"done"}}}'\n`,
    );
    expect(await followEvents({}, 1000)).toMatchObject({
      news: [{ terminal: "a", state: "finished", turn: null }],
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
  expect(parseHerdrArgs(["wait", "--seen", "t1:123:done"])).toEqual({
    verb: "wait",
    mode: "any",
    seen: { t1: { turn: 123, state: "done" } },
  });
});
