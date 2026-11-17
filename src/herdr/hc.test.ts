import { expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  coreId,
  defaultHcRunner,
  HcError,
  type HcRunner,
  hcGet,
  hcKill,
  hcLabel,
  hcList,
  hcNewEnough,
  hcPut,
  hcRead,
  hcRm,
  hcRun,
  hcSend,
  hcVersion,
} from "./hc";

const terminal = {
  address: "t7",
  state: "live" as const,
  status: { app: "claude-code", state: "blocked", kind: "question", msg: "q" },
  extra: 42,
};
const runner =
  (value: unknown): HcRunner =>
  () => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: "" });
test("tolerant shapes and version", () => {
  expect(hcGet(runner(terminal), "t7")).toEqual({ ...terminal, labels: {} });
  expect(
    hcGet(runner({ ...terminal, name: null, foreground: null, status: null }), "t7").status,
  ).toBeNull();
  expect(hcRun(runner(terminal), ["--bg", "claude"])).toMatchObject({ address: "t7" });
  expect(
    hcList(runner({ terminals: [{ address: "t7", state: "live", status: "working" }] }))
      .terminals[0]?.status,
  ).toBe("working");
  expect(() => hcList(runner({ terminals: [terminal] }))).toThrow(HcError);
  expect(coreId(runner({ core: { id: "core", name: "local" }, version: "0.1.20" }))).toBe("core");
  expect(hcVersion(() => ({ exitCode: 0, stdout: "hc 0.1.20\n", stderr: "" }))).toBe("0.1.20");
  for (const v of ["0.1.20", "0.1.21", "0.2.0", "1.0.0"]) expect(hcNewEnough(v)).toBe(true);
  for (const v of ["0.1.19", "bad", "0.1.20-beta"]) expect(hcNewEnough(v)).toBe(false);
});
test("literal argv for every wrapper", () => {
  const calls: string[][] = [];
  const fake: HcRunner = (args) => {
    calls.push(args);
    const verb = args[0];
    return runner(
      verb === "get" || verb === "run"
        ? terminal
        : verb === "ls"
          ? { terminals: [] }
          : verb === "read"
            ? { text: "screen", complete: true, how: "screen" }
            : verb === "put"
              ? { path: "/brief", bytes: 1 }
              : {},
    )(args);
  };
  hcGet(fake, "t7");
  hcList(fake, { all: true, labels: { "kit.lead": "core/t7", "kit.repo": "/repo" } });
  hcRun(fake, ["--bg", "claude", "a;b"]);
  hcSend(fake, "t7", "$(bad)", { ifStatus: "idle" });
  hcKill(fake, "t7");
  hcRm(fake, "t7");
  hcLabel(fake, "t7", { "kit.task": "#7" });
  expect(hcRead(fake, "t7", 5).text).toBe("screen");
  expect(hcPut(fake, "t7", "/brief").path).toBe("/brief");
  expect(calls).toEqual([
    ["get", "--json", "--", "t7"],
    ["ls", "--json", "--all", "--label", "kit.lead=core/t7", "--label", "kit.repo=/repo"],
    ["run", "--json", "--bg", "claude", "a;b"],
    ["send", "--json", "--if", "idle", "--", "t7", "$(bad)"],
    ["kill", "--json", "--", "t7"],
    ["rm", "--json", "--", "t7"],
    ["label", "--json", "--", "t7", "kit.task=#7"],
    ["read", "--json", "--lines", "5", "--", "t7"],
    ["put", "--json", "--", "t7", "/brief"],
  ]);
});
test("errors", () => {
  for (const [exitCode, kind] of [
    [3, "not_found"],
    [7, "needs_target"],
    [9, "blocked"],
    [10, "status_mismatch"],
    [11, "finished"],
  ] as const) {
    try {
      hcGet(
        () => ({
          exitCode,
          stdout: "",
          stderr: JSON.stringify({ error: { kind, message: "problem", hint: "fix" } }),
        }),
        "t7",
      );
      throw new Error("must fail");
    } catch (e) {
      expect(e).toBeInstanceOf(HcError);
      expect(e).toMatchObject({ kind, message: "problem", hint: "fix", exitCode });
    }
  }
  expect(() => hcGet(() => ({ exitCode: 1, stdout: "", stderr: "bad\nmore" }), "t7")).toThrow(
    "bad",
  );
  expect(() => hcGet(() => ({ exitCode: null, stdout: "", stderr: "" }), "t7")).toThrow(HcError);
  expect(() => hcGet(runner({}), "t7")).toThrow(HcError);
  expect(() => hcGet(() => ({ exitCode: 0, stdout: "bad", stderr: "" }), "t7")).toThrow(HcError);
});
test("default runner uses fake hc on PATH and timeout", () => {
  const dir = tempDir(),
    file = join(dir, "hc"),
    log = join(dir, "args");
  writeFileSync(file, '#!/bin/sh\nprintf "%s\\n" "$@" > "$HC_TEST_LOG"\nprintf \'{"ok":true}\'\n');
  chmodSync(file, 0o755);
  const path = process.env.PATH,
    oldLog = process.env.HC_TEST_LOG;
  try {
    process.env.PATH = dir;
    process.env.HC_TEST_LOG = log;
    expect(defaultHcRunner(["a;b", "two words"]).stdout).toBe('{"ok":true}');
    expect(readFileSync(log, "utf8")).toBe("a;b\ntwo words\n");
    writeFileSync(file, '#!/bin/sh\nIFS= read -r line\nprintf "%s" "$line"\n');
    expect(defaultHcRunner(["file", "write"], { stdin: "private brief\n" }).stdout).toBe(
      "private brief",
    );
    writeFileSync(file, "#!/bin/sh\nwhile :; do :; done\n");
    expect(() => hcGet((args) => defaultHcRunner(args, { timeoutMs: 10 }), "t7")).toThrow(HcError);
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    if (oldLog === undefined) delete process.env.HC_TEST_LOG;
    else process.env.HC_TEST_LOG = oldLog;
  }
});
