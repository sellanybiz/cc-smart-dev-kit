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
import { currentTerminal } from "../cli/ui/terminal";
import { tempDir } from "../testing/temp";
import { gatewayContext } from "./context";

describe("the gateway context: how its lines are drawn", () => {
  test("its own stdout gets this process's terminal; a caller's collector gets none: plain text", () => {
    // Whatever the test's own stdout is, the CLI's context reads that very one.
    expect(gatewayContext(options({ isTTY: false })).term).toEqual(
      currentTerminal(process.env, "linux"),
    );
    const collected = gatewayContext({ ...options({ isTTY: false }), print: () => undefined });
    expect(collected.term).toBeUndefined();
  });
});

/** A terminal whose echo can be switched off, answering with `lines` (as `readSecretLine` reads). */
function fakeTty(lines: string[]): {
  modes: boolean[];
  /** How often the read was paused: once per secret read, or stdin keeps the process alive. */
  pauses: () => number;
  terminal: {
    isTTY: boolean;
    off: () => void;
    on: (event: "data", listener: (chunk: Buffer) => void) => void;
    pause: () => void;
    setRawMode: (on: boolean) => void;
  };
} {
  let listener: ((chunk: Buffer) => void) | undefined;
  let pauses = 0;
  const modes: boolean[] = [];
  return {
    modes,
    pauses: () => pauses,
    terminal: {
      isTTY: true,
      off: () => {
        listener = undefined;
      },
      pause: () => {
        pauses += 1;
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

/** What the questions showed: a test never writes to the real terminal. */
const shown: string[] = [];

function options(terminal: unknown) {
  return {
    account: null,
    bundle: "/nowhere/router.js",
    confirm: null,
    paths: cliPaths({ CLAUDE_CONFIG_DIR: join(tempDir("gateway-context"), ".claude") }),
    platform: "linux" as NodeJS.Platform,
    questionIO: {
      readLine: (text: string) => {
        shown.push(text);
        return null;
      },
      write: (text: string) => {
        shown.push(text);
      },
    },
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
    // The whole set of questions too, for `gateway setup` on a terminal.
    expect(ctx.prompts?.secret).toBe(ctx.readSecret);
    // No echo while it is read (`setRawMode`), and the line comes back cleaned.
    shown.length = 0;
    expect(await ctx.readSecret?.("Password")).toBe("the-dashboard-password");
    // The question goes to the context's own output, never straight to stdout.
    expect(shown.join("")).toStartWith("Password ");
    expect(tty.modes).toEqual([true, false]);
    // The read is paused again, so the process can end when the command is done.
    expect(tty.pauses()).toBe(1);
  });

  test("a terminal that cannot hide it gets none, so the flag says to use stdin", () => {
    // `setRawMode` missing: a terminal would ECHO the password while it is typed.
    const ctx = gatewayContext(options({ isTTY: true }));
    expect(ctx.readSecret).toBeUndefined();
    // Still a terminal: its typed questions are asked, and its secret read is null.
    expect(ctx.prompts?.ask).toBeFunction();
    expect(ctx.prompts?.secret).toBeNull();
  });

  test("a pipe gets none", () => {
    const ctx = gatewayContext(options({ isTTY: false, setRawMode: () => undefined }));
    expect(ctx.readSecret).toBeUndefined();
    // No questions at all: setup takes its flags only.
    expect(ctx.prompts).toBeUndefined();
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
