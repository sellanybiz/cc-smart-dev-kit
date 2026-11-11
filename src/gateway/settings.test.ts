/**
 * The address of a backend as output may show it, or a page may link to it: never a credential.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTarget } from "../setup/write";
import { tempDir } from "../testing/temp";
import { DEFAULT_ANTHROPIC_BASE_URL } from "./config";
import {
  BASE_URL_PATH,
  backendAddress,
  offAddressOf,
  settingsReport,
  shownBackendUrl,
  turnOff,
  turnOn,
} from "./settings";

describe("a backend's address, shown", () => {
  test("PB-7: no user name, no password, no key in the query, no fragment", () => {
    const url =
      "http://someone:PLANTED_PASS@127.0.0.1:20128/api?key=PLANTED_QUERY&x=1#PLANTED_HASH";
    expect(backendAddress(url)).toBe("http://127.0.0.1:20128/api");
    expect(shownBackendUrl(url, "omni_PLANTED_SECRET_a1b2")).toBe(
      "http://127.0.0.1:20128/api (key ••••a1b2)",
    );
  });

  test("a plain address stays as it is, without its last slash", () => {
    expect(backendAddress("http://127.0.0.1:20128/")).toBe("http://127.0.0.1:20128");
    expect(shownBackendUrl("http://127.0.0.1:20128", "short")).toBe(
      "http://127.0.0.1:20128 (key ••••)",
    );
  });

  test("text that is not a URL is never shown at all", () => {
    expect(backendAddress("not a url PLANTED")).toBeNull();
    expect(shownBackendUrl("not a url PLANTED", "omni_PLANTED_SECRET_a1b2")).toBe("(key ••••a1b2)");
  });
});

describe("the address `gateway off` leaves in one settings file", () => {
  /** A settings file and its state dir; `null` leaves no file at all. */
  function setup(content: unknown) {
    const dir = tempDir("off-address");
    const file = join(dir, "settings.json");
    const stateDir = join(dir, "state");
    mkdirSync(stateDir, { recursive: true });
    if (content !== null) writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
    return { file, stateDir, key: realTarget(file) };
  }

  /** owned.json as `applyManagedJson` leaves it: the key, and the value cc-smart-dev-kit wrote. */
  function own(stateDir: string, key: string, value: unknown) {
    writeFileSync(
      join(stateDir, "owned.json"),
      JSON.stringify({ [key]: [{ path: BASE_URL_PATH, value }] }),
    );
  }

  test("a file whose JSON cannot be parsed answers same: the managed write reports its error", () => {
    const dir = tempDir("off-address");
    const file = join(dir, "settings.json");
    writeFileSync(file, "{ not json");
    expect(offAddressOf(file, join(dir, "state"))).toEqual({ kind: "same" });
  });

  test("an env that is not an object answers same: the managed write reports its error", () => {
    const { file, stateDir } = setup({ env: "nope" });
    expect(offAddressOf(file, stateDir)).toEqual({ kind: "same" });
  });

  test("an absent key is the person's: never put back, whatever the record says", () => {
    const { file, stateDir, key } = setup({ env: { ENABLE_TOOL_SEARCH: "true" } });
    own(stateDir, key, "http://127.0.0.1:20100");
    expect(offAddressOf(file, stateDir)).toEqual({ kind: "theirs", present: false });
  });

  test("an owned router address is written to Anthropic's own address", () => {
    const { file, stateDir, key } = setup({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20100" },
    });
    own(stateDir, key, "http://127.0.0.1:20100");
    expect(offAddressOf(file, stateDir)).toEqual({
      kind: "write",
      value: DEFAULT_ANTHROPIC_BASE_URL,
    });
  });

  test("an owned address already Anthropic's own is left as it is", () => {
    const { file, stateDir, key } = setup({
      env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL },
    });
    own(stateDir, key, DEFAULT_ANTHROPIC_BASE_URL);
    expect(offAddressOf(file, stateDir)).toEqual({ kind: "same" });
  });

  test("Anthropic's own address with a trailing slash is still Anthropic's own", () => {
    const { file, stateDir, key } = setup({
      env: { ANTHROPIC_BASE_URL: `${DEFAULT_ANTHROPIC_BASE_URL}/` },
    });
    own(stateDir, key, `${DEFAULT_ANTHROPIC_BASE_URL}/`);
    expect(offAddressOf(file, stateDir)).toEqual({ kind: "same" });
  });

  test("a key cc-smart-dev-kit never wrote is the person's", () => {
    const { file, stateDir } = setup({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20100" } });
    expect(offAddressOf(file, stateDir)).toEqual({ kind: "theirs", present: true });
  });

  test("a key the person changed since cc-smart-dev-kit wrote it is theirs", () => {
    const { file, stateDir, key } = setup({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20101" },
    });
    own(stateDir, key, "http://127.0.0.1:20100");
    expect(offAddressOf(file, stateDir)).toEqual({ kind: "theirs", present: true });
  });

  test("Anthropic's own address that cc-smart-dev-kit never wrote is the person's", () => {
    const { file, stateDir } = setup({
      env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL },
    });
    expect(offAddressOf(file, stateDir)).toEqual({ kind: "theirs", present: true });
  });

  test("an older owned.json (path only) still counts as ours", () => {
    const { file, stateDir, key } = setup({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:20100" },
    });
    writeFileSync(join(stateDir, "owned.json"), JSON.stringify({ [key]: [BASE_URL_PATH] }));
    expect(offAddressOf(file, stateDir)).toEqual({
      kind: "write",
      value: DEFAULT_ANTHROPIC_BASE_URL,
    });
  });
});

/**
 * Remote Control (`docs/claude-code-contract.md` § The gateway): Claude Code allows it only when
 * `ANTHROPIC_BASE_URL` is unset or its host is exactly `api.anthropic.com`. `gateway on` writes
 * the router's address, so it is off while the gateway is on; what `gateway off` leaves must
 * bring it back, and nothing the kit writes may turn it off by another way.
 */
describe("Remote Control", () => {
  /** The keys Claude Code also turns Remote Control off for (contract row): the kit writes none. */
  const OTHER_SWITCHES = [
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "DISABLE_GROWTHBOOK",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "ANTHROPIC_UNIX_SOCKET",
  ];

  function machine(settings: Record<string, unknown>) {
    const dir = tempDir("remote-control");
    const file = join(dir, "settings.json");
    const stateDir = join(dir, "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    const read = (): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8"));
    return { file, stateDir, read };
  }

  const envOf = (settings: Record<string, unknown>): Record<string, string> =>
    (settings.env ?? {}) as Record<string, string>;

  test("on preserves a personal Fable pin without a login or subagent warning", () => {
    const { file, stateDir, read } = machine({
      env: { ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5-1" },
    });
    const result = turnOn({ settingsFile: file, stateDir, port: 20123 });
    expect(envOf(read()).ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("claude-fable-5-1");
    expect(result.skipped).toContainEqual({
      path: ["env", "ANTHROPIC_DEFAULT_FABLE_MODEL"],
      reason: "set or changed by you; left alone",
    });
    expect(settingsReport(file).loginOverrides).toEqual([]);
    expect(settingsReport(file).subagentOverrides).toEqual([]);
  });

  test("on points Claude Code at the router, a host that is not api.anthropic.com", () => {
    const { file, stateDir, read } = machine({});
    turnOn({ settingsFile: file, stateDir, port: 20123 });
    expect(new URL(envOf(read()).ANTHROPIC_BASE_URL as string).host).toBe("127.0.0.1:20123");
  });

  test("Fable pin is owned while on, removed when off, and a changed value stays", () => {
    const { file, stateDir, read } = machine({ model: "fable" });
    turnOn({ settingsFile: file, stateDir, port: 20123 });
    expect(envOf(read()).ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("claude-fable-5-2");
    turnOff({ settingsFile: file, stateDir });
    expect(envOf(read())).not.toHaveProperty("ANTHROPIC_DEFAULT_FABLE_MODEL");
    turnOn({ settingsFile: file, stateDir, port: 20123 });
    const changed = read();
    changed.env = { ...envOf(changed), ANTHROPIC_DEFAULT_FABLE_MODEL: "0" };
    writeFileSync(file, JSON.stringify(changed));
    turnOff({ settingsFile: file, stateDir });
    expect(envOf(read()).ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("0");
    expect(read().model).toBe("fable");
  });

  test("off leaves api.anthropic.com as the address, and sets no other switch", () => {
    const { file, stateDir, read } = machine({});
    turnOn({ settingsFile: file, stateDir, port: 20123 });
    turnOff({ settingsFile: file, stateDir });
    const env = envOf(read());
    expect(new URL(env.ANTHROPIC_BASE_URL as string).host).toBe("api.anthropic.com");
    for (const key of OTHER_SWITCHES) expect(Object.keys(env)).not.toContain(key);
    expect(read()).not.toHaveProperty("remoteControlAtStartup");
    expect(read()).not.toHaveProperty("disableRemoteControl");
  });

  test("on writes none of the other switches either", () => {
    const { file, stateDir, read } = machine({});
    turnOn({ settingsFile: file, stateDir, port: 20123 });
    for (const key of OTHER_SWITCHES) expect(Object.keys(envOf(read()))).not.toContain(key);
    expect(read()).not.toHaveProperty("remoteControlAtStartup");
  });

  test("a remoteControlAtStartup the person set stays through on and off", () => {
    const { file, stateDir, read } = machine({ remoteControlAtStartup: true, model: "opus" });
    turnOn({ settingsFile: file, stateDir, port: 20123 });
    expect(read().remoteControlAtStartup).toBe(true);
    turnOff({ settingsFile: file, stateDir });
    expect(read().remoteControlAtStartup).toBe(true);
    expect(read().model).toBe("opus");
  });
});
