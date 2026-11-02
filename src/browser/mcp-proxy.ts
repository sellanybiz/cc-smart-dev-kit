import { Buffer } from "node:buffer";

export interface McpSink {
  write: (bytes: Uint8Array) => unknown;
  flush?: () => unknown;
  end: () => unknown;
}

interface ProxyDeps {
  clientInput: ReadableStream<Uint8Array>;
  clientOutput: Pick<McpSink, "write" | "flush">;
  childInput: McpSink;
  childOutput: ReadableStream<Uint8Array>;
  startChrome: () => Promise<{ ok: true } | { ok: false; why: string }>;
}

function isCall(value: unknown): value is { method: "tools/call"; id: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "method" in value &&
    value.method === "tools/call" &&
    "id" in value
  );
}

function parse(line: Buffer): unknown {
  try {
    return JSON.parse(line.toString("utf8"));
  } catch {
    return undefined;
  } // Invalid protocol input belongs to the child, unchanged.
}

/** Original byte spans of batch elements, used only when a failed call must be removed. */
function batchElements(line: Buffer): Buffer[] {
  const elements: Buffer[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = line.indexOf(91) + 1;
  for (let i = start; i < line.length; i++) {
    const byte = line[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === 92) escaped = true;
      else if (byte === 34) quoted = false;
    } else if (byte === 34) quoted = true;
    else if (byte === 123 || byte === 91) depth++;
    else if (byte === 125 || (byte === 93 && depth > 0)) depth--;
    else if ((byte === 44 || byte === 93) && depth === 0) {
      elements.push(line.subarray(start, i));
      start = i + 1;
      if (byte === 93) break;
    }
  }
  return elements;
}

/** A byte-preserving stdio bridge. Only browser tool requests wait for Chrome. */
export function proxyMcp(deps: ProxyDeps): {
  done: Promise<void>;
  outputDone: Promise<void>;
  stop: () => Promise<void>;
} {
  const input = deps.clientInput.getReader();
  const output = deps.childOutput.getReader();
  let stopped = false;
  let proved = false;
  let ended = false;
  let pumping: Promise<void> | undefined;
  const queue: Buffer[] = [];
  const failed = Promise.withResolvers<never>();

  async function write(sink: Pick<McpSink, "write" | "flush">, bytes: Uint8Array) {
    if (stopped) return;
    await sink.write(bytes);
    await sink.flush?.();
  }

  async function reject(line: Buffer, why: string) {
    const value = parse(line);
    if (Array.isArray(value) && value.some(isCall)) {
      // Keep non-call elements' original bytes; never serialize a forwarded message.
      const replies = value.filter(isCall).map((call) => failure(call.id, why));
      await write(deps.clientOutput, Buffer.from(`${JSON.stringify(replies)}\n`));
      const kept = batchElements(line).filter((element) => !isCall(parse(element)));
      if (kept.length)
        await write(
          deps.childInput,
          Buffer.concat([
            Buffer.from("["),
            ...kept.flatMap((element, i) => (i ? [Buffer.from(","), element] : [element])),
            Buffer.from("]\n"),
          ]),
        );
    } else if (isCall(value)) {
      await write(deps.clientOutput, Buffer.from(`${JSON.stringify(failure(value.id, why))}\n`));
    } else await write(deps.childInput, line);
  }

  async function pump() {
    while (queue.length && !stopped) {
      const line = queue[0];
      if (!line) break;
      const value = parse(line);
      if (!proved && (isCall(value) || (Array.isArray(value) && value.some(isCall)))) {
        const result = await deps.startChrome();
        if (stopped) break;
        if (!result.ok) {
          // All complete lines received during this attempt share its result. New input retries.
          const held = queue.splice(0);
          for (const pending of held) await reject(pending, result.why);
          continue;
        }
        proved = true;
      }
      queue.shift();
      await write(deps.childInput, line);
    }
    if (ended && !stopped) await deps.childInput.end();
  }

  function kick() {
    if (!pumping)
      pumping = pump()
        .catch((error) => {
          stopped = true;
          failed.reject(error);
        })
        .finally(() => {
          pumping = undefined;
          if (queue.length && !stopped) kick();
        });
  }

  const receive = (async () => {
    let pieces: Buffer[] = [];
    while (!stopped) {
      const chunk = await input.read();
      if (chunk.done) break;
      const bytes = Buffer.from(chunk.value);
      let start = 0;
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 10) continue;
        pieces.push(bytes.subarray(start, i + 1));
        queue.push(Buffer.concat(pieces));
        pieces = [];
        start = i + 1;
      }
      if (start < bytes.length) pieces.push(bytes.subarray(start));
      kick();
    }
    if (pieces.length) queue.push(Buffer.concat(pieces));
    ended = true;
    kick();
    await pumping;
  })();
  const send = (async () => {
    let pieces: Buffer[] = [];
    while (!stopped) {
      const chunk = await output.read();
      if (chunk.done) break;
      const bytes = Buffer.from(chunk.value);
      let start = 0;
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 10) continue;
        pieces.push(bytes.subarray(start, i + 1));
        await write(deps.clientOutput, Buffer.concat(pieces));
        pieces = [];
        start = i + 1;
      }
      if (start < bytes.length) pieces.push(bytes.subarray(start));
    }
    if (pieces.length) await write(deps.clientOutput, Buffer.concat(pieces));
  })();
  return {
    done: Promise.race([Promise.all([receive, send]).then(() => undefined), failed.promise]),
    outputDone: send,
    stop: async () => {
      stopped = true;
      queue.length = 0;
      await Promise.all([input.cancel(), output.cancel()]);
    },
  };
}

function failure(id: unknown, why: string) {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: why }], isError: true } };
}
