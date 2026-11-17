/**
 * The one reader for a Markdown file's front matter: the lines between the first two `---`
 * lines. Two readers share this home because two callers need two things:
 * - `splitFrontmatter` takes text already in memory (a task file, a blob from git) and gives
 *   the header and the body.
 * - `readFrontmatterHeader` reads a file on disk only through its closing line, never the body
 *   (an agent or a skill file may be large, and a scan reads many).
 * Neither parses the header: the caller does (`Bun.YAML.parse`), with its own schema.
 */
import { closeSync, openSync, readSync } from "node:fs";

/** The header and the body of text that opens with a `---` front matter block, or null. */
export function splitFrontmatter(text: string): { header: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  return { header: match[1] ?? "", body: text.slice(match[0].length) };
}

/**
 * A file's front matter header, read through the closing `---` line only. Null when the file
 * does not start with `---` or the block never closes. Lines are joined with `\n`, and the
 * bytes are read as UTF-8, so a CRLF file gives the same header as an LF one.
 */
export function readFrontmatterHeader(file: string): string | null {
  const fd = openSync(file, "r");
  try {
    const byte = Buffer.alloc(1);
    const lines: string[] = [];
    let line = "";
    let opened = false;
    while (readSync(fd, byte, 0, 1, null) !== 0) {
      if (byte[0] !== 10) {
        line += byte.toString("latin1");
        continue;
      }
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (!opened) {
        if (normalized !== "---") return null;
        opened = true;
      } else if (normalized === "---") {
        return Buffer.from(lines.join("\n"), "latin1").toString("utf8");
      } else {
        lines.push(normalized);
      }
      line = "";
    }
    return opened && line === "---"
      ? Buffer.from(lines.join("\n"), "latin1").toString("utf8")
      : null;
  } finally {
    closeSync(fd);
  }
}
