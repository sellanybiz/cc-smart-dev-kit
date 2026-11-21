import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import * as sibling from "../entries/config-check";
import { parseCcSmartDevKitConfig } from "../project/config";
import { atomicWrite } from "../setup/write";
import { hookEnv, makeRepo } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { parseWorkflowText, personalWorkflowOrDefault } from "../workflow/resolve";
import {
  CHECKED_CACHE_LIMIT,
  CHECKED_DIR,
  CHECKED_FILE_MAX_BYTES,
  checkedCacheProblem,
  checkedKey,
  loadCheckedFile,
  loadCheckedProject,
  loadPersonalWorkflow,
  PARSER_FINGERPRINT,
  TEMP_NAME,
} from "./checked-config";

const ROOT = join(import.meta.dir, "..", "..");
const isRoot = process.getuid?.() === 0;
const posixModes = process.platform !== "win32";

/** A state folder in its own temp home, and a project file in a temp folder. */
function world(text = '{"sessionNames": true, "worktrees": {"base": "main"}}\n') {
  const paths = cliPaths(hookEnv());
  const file = join(tempDir("checked-project"), "cc-smart-dev-kit.json");
  writeFileSync(file, text);
  const entries = () => {
    const dir = join(paths.stateDir, CHECKED_DIR);
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  };
  return { paths, file, entries, dir: join(paths.stateDir, CHECKED_DIR) };
}

const EXPECTED = { sessionNames: true, worktrees: { base: "main" } };

afterEach(() => {
  mock.restore();
});

describe("the cache", () => {
  test("a miss parses and writes one entry; the next run is a hit that equals the parse", async () => {
    const w = world();
    const first = await loadCheckedFile(w.file, "project", w);
    expect(first).toStrictEqual({ ok: true, value: EXPECTED, fact: "checked" });
    expect(w.entries()).toHaveLength(1);
    const spy = spyOn(sibling, "checkProjectText");
    const second = await loadCheckedFile(w.file, "project", w);
    expect(second).toStrictEqual({ ok: true, value: EXPECTED, fact: "cached" });
    expect(spy).not.toHaveBeenCalled();
  });

  test.skipIf(!posixModes)("the folder is 0700 and an entry 0600", async () => {
    const w = world();
    await loadCheckedFile(w.file, "project", w);
    expect(statSync(w.dir).mode & 0o777).toBe(0o700);
    const [entry = ""] = w.entries();
    expect(statSync(join(w.dir, entry)).mode & 0o777).toBe(0o600);
  });

  test("no file is the fact none, and nothing is written", async () => {
    const w = world();
    const result = await loadCheckedFile(join(w.dir, "absent.json"), "project", w);
    expect(result).toStrictEqual({ ok: true, value: null, fact: "none" });
    expect(w.entries()).toEqual([]);
  });

  test("a broken file says the parser's words every run and is never written", async () => {
    const w = world("{nope");
    for (let run = 0; run < 2; run += 1) {
      const result = await loadCheckedFile(w.file, "project", w);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fact).toBe("broken");
        expect(result.message.startsWith(`Invalid ${w.file}: not valid JSON (`)).toBe(true);
      }
    }
    expect(w.entries()).toEqual([]);
  });

  test("an entry that is not JSON, or names another key, kind or format, is a miss and is rewritten", async () => {
    const w = world();
    await loadCheckedFile(w.file, "project", w);
    const [name = ""] = w.entries();
    const entry = join(w.dir, name);
    const good = JSON.parse(readFileSync(entry, "utf8"));
    const spoiled = [
      "{",
      JSON.stringify({ ...good, key: "0".repeat(64) }),
      JSON.stringify({ ...good, format: 2 }),
      JSON.stringify({ ...good, kind: "workflow" }),
      JSON.stringify({ ...good, value: ["not", "an", "object"] }),
    ];
    for (const text of spoiled) {
      writeFileSync(entry, text);
      const result = await loadCheckedFile(w.file, "project", w);
      expect(result).toStrictEqual({ ok: true, value: EXPECTED, fact: "checked" });
      expect(JSON.parse(readFileSync(entry, "utf8"))).toStrictEqual(good);
    }
  });

  test("changed bytes miss, and a key depends on the fingerprint, the kind and the bytes", async () => {
    const w = world();
    await loadCheckedFile(w.file, "project", w);
    writeFileSync(w.file, '{"sessionNames": false}\n');
    expect(await loadCheckedFile(w.file, "project", w)).toStrictEqual({
      ok: true,
      value: { sessionNames: false },
      fact: "checked",
    });
    expect(w.entries()).toHaveLength(2);
    const bytes = Buffer.from("{}");
    expect(checkedKey("a", "project", bytes)).not.toBe(checkedKey("b", "project", bytes));
    expect(checkedKey("a", "project", bytes)).not.toBe(
      checkedKey("a", "project", Buffer.from("{ }")),
    );
  });

  test("the same bytes at two paths share one entry and give equal values", async () => {
    const w = world();
    const other = join(tempDir("checked-other"), "cc-smart-dev-kit.json");
    writeFileSync(other, readFileSync(w.file));
    expect(await loadCheckedFile(w.file, "project", w)).toStrictEqual({
      ok: true,
      value: EXPECTED,
      fact: "checked",
    });
    expect(await loadCheckedFile(other, "project", w)).toStrictEqual({
      ok: true,
      value: EXPECTED,
      fact: "cached",
    });
    expect(w.entries()).toHaveLength(1);
  });

  test("a state folder that cannot be written still answers", async () => {
    const w = world();
    const stateFile = join(tempDir("checked-state"), "state");
    writeFileSync(stateFile, "a file where the state folder should be");
    const result = await loadCheckedFile(w.file, "project", { paths: { stateDir: stateFile } });
    expect(result).toStrictEqual({ ok: true, value: EXPECTED, fact: "checked" });
  });

  test("the folder keeps at most the cap, the oldest go first", async () => {
    const w = world();
    await loadCheckedFile(w.file, "project", w);
    const [oldest = ""] = w.entries();
    utimesSync(join(w.dir, oldest), 1000, 1000);
    for (let n = 0; n < CHECKED_CACHE_LIMIT + 5; n += 1) {
      writeFileSync(w.file, `{"autoMode": ["rule ${n}"]}\n`);
      await loadCheckedFile(w.file, "project", w);
    }
    expect(w.entries().length).toBe(CHECKED_CACHE_LIMIT);
    expect(existsSync(join(w.dir, oldest))).toBe(false);
  });

  test("a temp file two minutes old is removed on a miss, one just written stays", async () => {
    const w = world();
    mkdirSync(w.dir, { recursive: true });
    const old = join(w.dir, ".aaa.json.cc-smart-dev-kit-tmp-1-x");
    const fresh = join(w.dir, ".bbb.json.cc-smart-dev-kit-tmp-2-y");
    writeFileSync(old, "");
    writeFileSync(fresh, "");
    const twoMinutesAgo = (Date.now() - 120_000) / 1000;
    utimesSync(old, twoMinutesAgo, twoMinutesAgo);
    await loadCheckedFile(w.file, "project", w);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("atomicWrite still names its temp file the way the sweep reads it", () => {
    const dir = tempDir("checked-temp");
    let seen: string[] = [];
    atomicWrite(join(dir, "entry.json"), "{}", 0o600, () => {
      seen = readdirSync(dir);
    });
    expect(seen).toHaveLength(1);
    expect(TEMP_NAME.test(seen[0] ?? "")).toBe(true);
  });

  test("a file over the size limit is parsed every run and never cached", async () => {
    const big = JSON.stringify({ autoMode: ["x".repeat(CHECKED_FILE_MAX_BYTES)] });
    const w = world(big);
    for (let run = 0; run < 2; run += 1) {
      const result = await loadCheckedFile(w.file, "project", w);
      expect(result.ok && result.fact).toBe("checked");
    }
    expect(w.entries()).toEqual([]);
  });
});

describe("reading the file itself is not a miss", () => {
  test("a project file that is a folder throws, and nothing is cached", async () => {
    const w = world();
    const folder = join(tempDir("checked-folder"), "cc-smart-dev-kit.json");
    mkdirSync(folder);
    await expect(loadCheckedFile(folder, "project", w)).rejects.toThrow("EISDIR");
    expect(w.entries()).toEqual([]);
  });

  test.skipIf(isRoot || !posixModes)(
    "a project file with no read permission throws, and nothing is cached (root reads anything, so this is skipped as root)",
    async () => {
      const w = world();
      chmodSync(w.file, 0o000);
      await expect(loadCheckedFile(w.file, "project", w)).rejects.toThrow("EACCES");
      expect(w.entries()).toEqual([]);
    },
  );
});

describe("the sibling", () => {
  test("a parser that throws a plain error is rethrown, not read as a config problem", async () => {
    const w = world();
    spyOn(sibling, "checkProjectText").mockImplementation(() => {
      throw new Error("a bug in the parser");
    });
    await expect(loadCheckedFile(w.file, "project", w)).rejects.toThrow("a bug in the parser");
    expect(w.entries()).toEqual([]);
  });

  test("an answer from another build is the reinstall problem, and nothing is cached", async () => {
    const w = world();
    spyOn(sibling, "checkProjectText").mockImplementation(() => ({
      ok: true,
      value: EXPECTED,
      fingerprint: "another build",
    }));
    const result = await loadCheckedFile(w.file, "project", w);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("to reinstall the plugin");
    expect(w.entries()).toEqual([]);
  });
});

describe("checkProjectText", () => {
  const FIXTURES: Record<string, string> = {
    "an empty file's object": "{}",
    "the repo's own file": readFileSync(join(ROOT, ".claude", "cc-smart-dev-kit.json"), "utf8"),
    "worktrees, checks and jobs": JSON.stringify({
      worktrees: { base: "main", bases: { "release/": "main" }, rebuildable: ["cache/"] },
      checks: { fast: "bun test" },
      jobs: { route: true, kinds: { slow: { match: [{ script: "slow" }], about: "slow" } } },
      tasks: { staleDays: 3, envs: ["prod"], deployCommands: { prod: ["vercel --prod"] } },
      ownHooks: ["tier-view"],
    }),
    "a byte order mark": `﻿${JSON.stringify({ sessionNames: true })}`,
  };

  test.each(Object.entries(FIXTURES))(
    "%s: the value equals the inline parse and survives a JSON round trip unchanged",
    (_name, text) => {
      const answer = sibling.checkProjectText(text, "x.json");
      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      expect(answer.value).toStrictEqual(parseCcSmartDevKitConfig(text, "x.json"));
      // `toEqual` would hide a key whose value is `undefined`, which a cache entry drops.
      expect(JSON.parse(JSON.stringify(answer.value))).toStrictEqual(answer.value);
    },
  );

  test("the answer carries this build's fingerprint", () => {
    expect(sibling.checkProjectText("{}", "x.json").fingerprint).toBe(PARSER_FINGERPRINT);
  });

  const PROBLEMS: [string, string, string][] = [
    [
      "a requires this plugin does not meet",
      '{"requires": ">=999"}',
      "x.json: this project needs cc-smart-dev-kit >=999; you have",
    ],
    [
      "a retired field",
      '{"worktrees": {"base": "main", "prefix": "app-wt-"}}',
      "Invalid x.json: worktrees.prefix is no longer supported: remove it",
    ],
    [
      "an unknown field",
      '{"nope": 1}',
      "Invalid x.json: nope: unknown field (a newer cc-smart-dev-kit may be needed)",
    ],
    [
      "a setting only the person's own file may hold",
      '{"workflow": {"plans": {"runMode": "auto"}}}',
      "Invalid x.json: workflow.plans.runMode is your own setting, not the project's",
    ],
  ];

  test.each(PROBLEMS)("%s: the message is the inline parser's own words", (_name, text, start) => {
    const answer = sibling.checkProjectText(text, "x.json");
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.message.startsWith(start)).toBe(true);
    expect(() => parseCcSmartDevKitConfig(text, "x.json")).toThrow(answer.message);
  });

  test("broken JSON says so with the file's name", () => {
    const answer = sibling.checkProjectText("{nope", "x.json");
    expect(!answer.ok && answer.message.startsWith("Invalid x.json: not valid JSON (")).toBe(true);
  });
});

const PERSONAL_TEXT = '{"allowCommit": true, "switches": {"jobRoute": true}}\n';
const PERSONAL_VALUE = { allowCommit: true, switches: { jobRoute: true } };

describe("the person's workflow file", () => {
  /** A state folder in its own temp home, with the person's workflow file written as `text`. */
  function personal(text: string | null) {
    const w = world();
    if (text !== null) {
      mkdirSync(dirname(w.paths.workflowConfigFile), { recursive: true });
      writeFileSync(w.paths.workflowConfigFile, text);
    }
    return w;
  }
  const VALID = PERSONAL_TEXT;
  const VALUE = PERSONAL_VALUE;
  /** Valid JSON that breaks the schema, plain text, and a value of the wrong kind. */
  const BROKEN = ['{"switches": {"jobRoute": "yes"}}', "{nope", '{"allowCommit": 1}'];

  test("a valid file: checked once, then a hit, with the value personalWorkflowOrDefault gives", async () => {
    const w = personal(VALID);
    expect(await loadPersonalWorkflow(w.paths)).toStrictEqual(VALUE);
    expect(personalWorkflowOrDefault(w.paths)).toStrictEqual(VALUE);
    expect(w.entries()).toHaveLength(1);
    const spy = spyOn(sibling, "checkWorkflowText");
    expect(await loadPersonalWorkflow(w.paths)).toStrictEqual(VALUE);
    expect(spy).not.toHaveBeenCalled();
  });

  test.each(BROKEN)(
    "a broken file %j is {}, as personalWorkflowOrDefault says, and never cached",
    async (text) => {
      const w = personal(text);
      for (let run = 0; run < 2; run += 1) {
        expect(await loadPersonalWorkflow(w.paths)).toStrictEqual({});
      }
      expect(personalWorkflowOrDefault(w.paths)).toStrictEqual({});
      expect(w.entries()).toEqual([]);
    },
  );

  test("a missing file is {}, and writes nothing", async () => {
    const w = personal(null);
    expect(await loadPersonalWorkflow(w.paths)).toStrictEqual({});
    expect(personalWorkflowOrDefault(w.paths)).toStrictEqual({});
    expect(w.entries()).toEqual([]);
  });

  test("a file that is a folder is {}, never a crash", async () => {
    const w = world();
    mkdirSync(w.paths.workflowConfigFile, { recursive: true });
    expect(await loadPersonalWorkflow(w.paths)).toStrictEqual({});
    expect(personalWorkflowOrDefault(w.paths)).toStrictEqual({});
  });

  test("a checker that fails, or comes from another build, leaves {} too", async () => {
    const w = personal(VALID);
    const spy = spyOn(sibling, "checkWorkflowText");
    spy.mockImplementation(() => {
      throw new Error("a bug in the parser");
    });
    expect(await loadPersonalWorkflow(w.paths)).toStrictEqual({});
    spy.mockImplementation(() => ({ ok: true, value: VALUE, fingerprint: "another build" }));
    expect(await loadPersonalWorkflow(w.paths)).toStrictEqual({});
    expect(w.entries()).toEqual([]);
  });

  test("the same bytes as a project file and as a workflow file are two entries", async () => {
    const w = personal("{}");
    writeFileSync(w.file, "{}");
    await loadCheckedFile(w.file, "project", w);
    await loadPersonalWorkflow(w.paths);
    expect(w.entries()).toHaveLength(2);
    const bytes = Buffer.from("{}");
    expect(checkedKey("a", "project", bytes)).not.toBe(checkedKey("a", "workflow", bytes));
  });
});

describe("workflow text through the checker", () => {
  test.each([
    PERSONAL_TEXT,
    "{}",
    '{"plans": {"maxPhases": 4, "runMode": "solo"}, "alerts": {"usagePercent": 70}}',
  ])("%j: the value equals the inline parse", (text) => {
    const answer = sibling.checkWorkflowText(text, "w.json");
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value).toStrictEqual(parseWorkflowText(text, "w.json"));
    expect(JSON.parse(JSON.stringify(answer.value))).toStrictEqual(answer.value);
    expect(answer.fingerprint).toBe(PARSER_FINGERPRINT);
  });

  test.each(["{nope", '{"switches": {"jobRoute": "yes"}}', '{"unknown": 1}'])(
    "%j: the message is the inline parser's own words",
    (text) => {
      const answer = sibling.checkWorkflowText(text, "w.json");
      expect(answer.ok).toBe(false);
      if (answer.ok) return;
      expect(answer.message.startsWith("Invalid w.json: ")).toBe(true);
      expect(() => parseWorkflowText(text, "w.json")).toThrow(answer.message);
    },
  );
});

describe("loadCheckedProject", () => {
  test("reads the checkout's own file, else the main checkout's, and none when neither exists", async () => {
    const w = world();
    const repo = makeRepo();
    const checkout = {
      root: repo,
      commonDir: join(repo, ".git"),
      isWorktree: false,
      mainCheckout: repo,
    };
    expect(await loadCheckedProject(checkout, w)).toStrictEqual({
      ok: true,
      project: { ...checkout, config: null, configFile: null },
      fact: "none",
    });
    mkdirSync(join(repo, ".claude"));
    const file = join(repo, ".claude", "cc-smart-dev-kit.json");
    writeFileSync(file, '{"sessionNames": true}');
    expect(await loadCheckedProject(checkout, w)).toStrictEqual({
      ok: true,
      project: { ...checkout, config: { sessionNames: true }, configFile: file },
      fact: "checked",
    });
    const linked = { ...checkout, root: tempDir("checked-linked"), isWorktree: true };
    const viaMain = await loadCheckedProject(linked, w);
    expect(viaMain.ok && viaMain.project.configFile).toBe(file);
    expect(viaMain.fact).toBe("cached");
  });
});

describe("checkedCacheProblem", () => {
  test("no problem before the folder exists, and after it is made", async () => {
    const w = world();
    expect(checkedCacheProblem(w.paths)).toBeNull();
    await loadCheckedFile(w.file, "project", w);
    expect(checkedCacheProblem(w.paths)).toBeNull();
  });

  test("a file where the folder should be is named", () => {
    const stateDir = tempDir("checked-problem");
    writeFileSync(join(stateDir, CHECKED_DIR), "");
    expect(checkedCacheProblem({ stateDir })).toBe("is not a folder");
  });

  test.skipIf(isRoot || !posixModes)(
    "a read-only folder is named with its code (skipped as root, which can write anywhere)",
    () => {
      const stateDir = tempDir("checked-readonly");
      const dir = join(stateDir, CHECKED_DIR);
      mkdirSync(dir);
      chmodSync(dir, 0o500);
      expect(checkedCacheProblem({ stateDir })).toBe("cannot be written (EACCES)");
    },
  );

  test("a state folder under a missing root is named, not walked forever", () => {
    expect(checkedCacheProblem({ stateDir: "/missing-root/state" }, () => false)).toBe(
      "cannot be written (no folder above it exists)",
    );
  });
});
