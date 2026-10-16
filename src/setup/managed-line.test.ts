import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { applyManagedLine, removeManagedLines } from "./managed-line";
import { restore } from "./restore";
import { listBackups } from "./write";

const LINE = "set -g allow-passthrough all";

function setup(content: string | null) {
  const dir = tempDir("line");
  const file = join(dir, "tmux.conf");
  if (content !== null) writeFileSync(file, content);
  return { file, stateDir: join(dir, "state") };
}

const read = (file: string) => readFileSync(file, "utf8");

describe("applyManagedLine", () => {
  test("appends the line at the end, keeping the person's own lines and their order", () => {
    const { file, stateDir } = setup("set -g mouse on\nset -g history-limit 5000\n");
    expect(applyManagedLine({ file, line: LINE, stateDir }).outcome).toBe("updated");
    expect(read(file)).toBe(`set -g mouse on\nset -g history-limit 5000\n${LINE}\n`);
  });

  test("adds the missing final newline before the line", () => {
    const { file, stateDir } = setup("set -g mouse on");
    applyManagedLine({ file, line: LINE, stateDir });
    expect(read(file)).toBe(`set -g mouse on\n${LINE}\n`);
  });

  test("creates a missing file with only the line", () => {
    const { file, stateDir } = setup(null);
    expect(applyManagedLine({ file, line: LINE, stateDir }).outcome).toBe("created");
    expect(read(file)).toBe(`${LINE}\n`);
  });

  test("the same line again writes nothing: no backup, same mtime, nothing newly claimed", () => {
    const { file, stateDir } = setup("set -g mouse on\n");
    applyManagedLine({ file, line: LINE, stateDir });
    const mtime = statSync(file).mtimeMs;
    expect(applyManagedLine({ file, line: LINE, stateDir })).toEqual({
      outcome: "unchanged",
      backup: null,
      removed: [],
    });
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(listBackups(stateDir, file)).toHaveLength(1);
  });

  test("a line the person wrote themselves is left alone, and restore does not take it out", () => {
    const { file, stateDir } = setup(`${LINE}\nset -g mouse on\n`);
    expect(applyManagedLine({ file, line: LINE, stateDir }).outcome).toBe("unchanged");
    restore(stateDir);
    expect(read(file)).toBe(`${LINE}\nset -g mouse on\n`);
  });

  test("a dry run reports the outcome and writes nothing", () => {
    const { file, stateDir } = setup("set -g mouse on\n");
    expect(applyManagedLine({ file, dryRun: true, line: LINE, stateDir }).outcome).toBe("updated");
    expect(read(file)).toBe("set -g mouse on\n");
    expect(existsSync(stateDir)).toBe(false);
  });
});

describe("removeManagedLines", () => {
  test("takes exactly that line out and keeps every other line", () => {
    const { file, stateDir } = setup(`set -g mouse on\n${LINE}\nset -g history-limit 5000\n`);
    const result = removeManagedLines({ file, lines: [LINE], stateDir });
    expect(result.removed).toEqual([LINE]);
    expect(result.outcome).toBe("updated");
    expect(read(file)).toBe("set -g mouse on\nset -g history-limit 5000\n");
  });

  test("a missing line, or a file that is not there: nothing is written", () => {
    const withMouse = setup("set -g mouse on\n");
    expect(
      removeManagedLines({ file: withMouse.file, lines: [LINE], stateDir: withMouse.stateDir }),
    ).toEqual({ backup: null, outcome: "unchanged", removed: [] });
    expect(listBackups(withMouse.stateDir, withMouse.file)).toHaveLength(0);

    const missing = setup(null);
    const result = removeManagedLines({
      file: missing.file,
      lines: [LINE],
      stateDir: missing.stateDir,
    });
    expect(result.outcome).toBe("unchanged");
    expect(existsSync(missing.file)).toBe(false);
  });

  test("a line the person edited since stays: only the exact line goes", () => {
    const { file, stateDir } = setup(`set -g allow-passthrough on\nset -g mouse on\n`);
    expect(removeManagedLines({ file, lines: [LINE], stateDir }).removed).toEqual([]);
    expect(read(file)).toBe("set -g allow-passthrough on\nset -g mouse on\n");
  });

  test("restore takes the line out; a file cc-smart-dev-kit created with only the line is removed", () => {
    const kept = setup("set -g mouse on\n");
    applyManagedLine({ file: kept.file, line: LINE, stateDir: kept.stateDir });
    expect(restore(kept.stateDir)).toEqual([
      {
        action: "cleaned",
        details: [`the line ${JSON.stringify(LINE)}`],
        file: kept.file,
        savedAs: expect.any(String),
      },
    ]);
    expect(read(kept.file)).toBe("set -g mouse on\n");

    const created = setup(null);
    applyManagedLine({ file: created.file, line: LINE, stateDir: created.stateDir });
    expect(restore(created.stateDir)[0]?.action).toBe("removed");
    expect(existsSync(created.file)).toBe(false);
  });

  test("a second restore changes nothing", () => {
    const { file, stateDir } = setup("set -g mouse on\n");
    applyManagedLine({ file, line: LINE, stateDir });
    restore(stateDir);
    expect(restore(stateDir)).toEqual([]);
  });
});
