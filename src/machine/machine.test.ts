import { afterEach, describe, expect, test } from "bun:test";
import { realMachine, TEST_HOST_VAR } from "./machine";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("realMachine", () => {
  test("native Apple Silicon capability is injected independently of Rosetta runtime arch", () => {
    for (const nativeAppleSilicon of [true, false]) {
      const machine = realMachine(
        {
          PATH: "",
          [TEST_HOST_VAR]: JSON.stringify({ platform: "darwin", arch: "x64", nativeAppleSilicon }),
        },
        null,
      );
      expect(machine.arch).toBe("x64");
      expect(machine.nativeAppleSilicon).toBe(nativeAppleSilicon);
    }
  });
  test("subprocess sanitization removes installer controls only, without changing the parent", () => {
    const env = {
      PATH: "",
      HOME: "/test-home",
      XDG_DATA_HOME: "/test-data",
      LOCALAPPDATA: "/test-local",
      PROCESSOR_ARCHITECTURE: "AMD64",
      HC_VERSION: "pinned",
      HC_INSTALL_DIR: "/override",
      HC_BUNDLE_ONLY: "1",
      HERDR_RELEASES_URL: "https://invalid.example",
      hc_session: "override",
    };
    const machine = realMachine(env, null);
    const result = machine.run(
      [process.execPath, "-e", "console.log(JSON.stringify(process.env))"],
      { unsetEnvPrefixes: ["HERDR_", "HC_"] },
    );
    const child = JSON.parse(result.output);
    expect(child.HC_VERSION).toBeUndefined();
    expect(child.HC_INSTALL_DIR).toBeUndefined();
    expect(child.HC_BUNDLE_ONLY).toBeUndefined();
    expect(child.HERDR_RELEASES_URL).toBeUndefined();
    expect(child.hc_session).toBeUndefined();
    expect(child.HOME).toBe("/test-home");
    expect(child.XDG_DATA_HOME).toBe("/test-data");
    expect(child.LOCALAPPDATA).toBe("/test-local");
    expect(child.PROCESSOR_ARCHITECTURE).toBe("AMD64");
    expect(env.HC_VERSION).toBe("pinned");
    expect(
      JSON.parse(
        machine.run([process.execPath, "-e", "console.log(JSON.stringify(process.env))"]).output,
      ).HC_VERSION,
    ).toBe("pinned");
  });
  test("fetchText downloads over HTTPS only: a plain http address is refused before any request", async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        requests += 1;
        return new Response("-----BEGIN PGP PUBLIC KEY BLOCK-----\n");
      },
    });
    servers.push(server);
    const machine = realMachine({ PATH: "" }, null);
    const url = `http://127.0.0.1:${server.port}/download.txt`;
    await expect(machine.fetchText(url)).rejects.toThrow(
      `${url} led to ${url}, which is not an HTTPS address`,
    );
    expect(requests).toBe(0);
  });

  test("the host's facts come from CC_SMART_DEV_KIT_TEST_HOST when it is set", () => {
    const machine = realMachine(
      {
        PATH: "",
        [TEST_HOST_VAR]: JSON.stringify({
          platform: "darwin",
          arch: "arm64",
          osRelease: null,
          userId: 1234,
        }),
      },
      null,
    );
    expect(machine.platform).toBe("darwin");
    expect(machine.arch).toBe("arm64");
    expect(machine.osRelease()).toBeNull();
    expect(machine.userId).toBe(1234);
  });
});
