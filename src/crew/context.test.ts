/**
 * The CLI's printer (`context.ts`): it writes each line to stdout, and notices when nobody reads
 * it any more (WF1) — a watch ends on that.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { stdoutPrinter } from "./context";

/** A stream that keeps what it is given and answers each write with `failure`. */
function stream(failure: null | Error) {
  const written: string[] = [];
  return {
    on: () => undefined,
    write: (text: string, done: (error?: Error | null) => void) => {
      written.push(text);
      done(failure);
      return failure === null;
    },
    written,
  };
}

/**
 * A bun program that prints 25 lines through the printer, 20 ms apart, then notes whether it is
 * still alive and what `closed` says.
 */
const PRINTS = `import { appendFileSync } from "node:fs";
import { stdoutPrinter } from ${JSON.stringify(join(import.meta.dir, "context.ts"))};
const printer = stdoutPrinter(process.stdout);
let i = 0;
const timer = setInterval(() => {
  i += 1;
  printer.print(\`line \${i}\`);
  if (i === 25) {
    appendFileSync(process.argv[2], \`alive closed=\${printer.closed()}\\n\`);
    clearInterval(timer);
  }
}, 20);
`;

describe("the printer to stdout", () => {
  test("a line a reader takes: written whole, and stdout stays open", () => {
    const open = stream(null);
    const printer = stdoutPrinter(open);
    printer.print("C my-app B6b portal-live: tests-green");
    expect(open.written).toEqual(["C my-app B6b portal-live: tests-green\n"]);
    expect(printer.closed()).toBe(false);
  });

  test("a line nobody reads (EPIPE): stdout is closed from then on", () => {
    const gone = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const closedPipe = stream(gone);
    const printer = stdoutPrinter(closedPipe);
    expect(printer.closed()).toBe(false);
    printer.print("C my-app B6b portal-live: tests-green");
    expect(printer.closed()).toBe(true);
  });

  test("a real closed pipe: the program lives on and knows nobody reads it", () => {
    // Without the printer's error listener, Bun 1.4.3 ends the program at the first write to a
    // closed pipe, with a stack trace: the note below is then never written.
    const folder = tempDir("printer");
    const script = join(folder, "prints.ts");
    const note = join(folder, "note.txt");
    writeFileSync(script, PRINTS);
    writeFileSync(note, "");
    const guard = subprocessGuard();
    const command = [process.execPath, ...guard.args, script, note]
      .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
      .join(" ");
    // `true` reads nothing and ends at once: every later write meets a closed pipe.
    const run = Bun.spawnSync(["sh", "-c", `${command} | true`], {
      cwd: folder,
      env: { ...process.env, ...guard.env },
      stderr: "pipe",
    });
    expect(run.stderr.toString()).toBe("");
    expect(readFileSync(note, "utf8")).toBe("alive closed=true\n");
  });
});
