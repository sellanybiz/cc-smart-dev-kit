/**
 * The CLI's printer (`context.ts`): it writes each line to stdout, and notices when nobody reads
 * it any more (WF1) — a watch ends on that.
 */
import { describe, expect, test } from "bun:test";
import { stdoutPrinter } from "./context";

/** A stream that keeps what it is given and answers each write with `failure`. */
function stream(failure: null | Error) {
  const written: string[] = [];
  return {
    write: (text: string, done: (error?: Error | null) => void) => {
      written.push(text);
      done(failure);
      return failure === null;
    },
    written,
  };
}

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
});
