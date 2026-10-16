/**
 * The gateway commands' context (`context.ts`), and the ONE decision it makes about a terminal:
 * `--omniroute-password` asks for OmniRoute's dashboard password with no echo, which needs a
 * `readSecret` — and that is only possible on a terminal whose echo can be switched off.
 *
 * Live-shaped bug (2026-10-17): the context was built inside the CLI entry and never set
 * `readSecret`, so `gateway setup --omniroute-password` always answered "this terminal cannot
 * hide what you type" — on a real terminal too — while the README, the installer and the gateway
 * skill all send people to that flag. The tests below are what fails when that field goes
 * missing: a terminal-shaped stdin must get a `readSecret`, and a pipe must not.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { gatewayContext } from "./context";

/** A terminal whose echo can be switched off, answering with `lines` (as `readSecretLine` reads). */
function fakeTty(lines: string[]): {
  modes: boolean[];
  terminal: {
    isTTY: boolean;
    off: () => void;
    on: (event: "data", listener: (chunk: Buffer) => void) => void;
    setRawMode: (on: boolean) => void;
  };
} {
  let listener: ((chunk: Buffer) => void) | undefined;
  const modes: boolean[] = [];
  return {
    modes,
    terminal: {
      isTTY: true,
      off: () => {
        listener = undefined;
      },
      on: (_event: "data", next: (chunk: Buffer) => void) => {
        listener = next;
        // The terminal answers once the read has begun, as a real one does.
        queueMicrotask(() => {
          for (const line of lines) listener?.(Buffer.from(line, "utf8"));
        });
      },
      setRawMode: (on: boolean) => {
        modes.push(on);
      },
    },
  };
}

function options(terminal: unknown) {
  return {
    account: null,
    bundle: "/nowhere/router.js",
    confirm: null,
    paths: cliPaths({ CLAUDE_CONFIG_DIR: join(tempDir("gateway-context"), ".claude") }),
    platform: "linux" as NodeJS.Platform,
    runner: () => ({ exitCode: 0, output: "" }),
    service: "systemd" as const,
    terminal: terminal as never,
  };
}

describe("the gateway context: the terminal for --omniroute-password", () => {
  test("a terminal that can hide what is typed gets a readSecret, and it reads one line", async () => {
    const tty = fakeTty(["the-dashboard-password\r"]);
    const ctx = gatewayContext(options(tty.terminal));
    expect(typeof ctx.readSecret).toBe("function");
    // No echo while it is read (`setRawMode`), and the line comes back cleaned.
    expect(await ctx.readSecret?.()).toBe("the-dashboard-password");
    expect(tty.modes).toEqual([true, false]);
  });

  test("a terminal that cannot hide it gets none, so the flag says to use stdin", () => {
    // `setRawMode` missing: a terminal would ECHO the password while it is typed.
    const ctx = gatewayContext(options({ isTTY: true }));
    expect(ctx.readSecret).toBeUndefined();
  });

  test("a pipe gets none", () => {
    const ctx = gatewayContext(options({ isTTY: false, setRawMode: () => undefined }));
    expect(ctx.readSecret).toBeUndefined();
  });

  test("everything else the commands need is there, whatever the terminal is", () => {
    const ctx = gatewayContext(options({ isTTY: false }));
    expect(ctx.readStdin).toBeFunction();
    expect(ctx.probe.fetch).toBeFunction();
    expect(ctx.apiFetch).toBeFunction();
    expect(ctx.print).toBeFunction();
    expect(ctx.error).toBeFunction();
    expect(ctx.platform).toBe("linux");
  });
});
