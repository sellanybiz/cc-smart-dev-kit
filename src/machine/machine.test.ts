import { afterEach, describe, expect, test } from "bun:test";
import { realMachine, TEST_HOST_VAR } from "./machine";

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("realMachine", () => {
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
    const url = `http://127.0.0.1:${server.port}/warp.asc`;
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
          macApp: "/nowhere/Warp.app",
        }),
      },
      null,
    );
    expect(machine.platform).toBe("darwin");
    expect(machine.arch).toBe("arm64");
    expect(machine.osRelease()).toBeNull();
    expect(machine.macApp).toBe("/nowhere/Warp.app");
  });
});
