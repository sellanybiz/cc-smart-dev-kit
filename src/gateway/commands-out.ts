/**
 * How a gateway command prints, and what a settings change looks like when it does: the
 * output module over the gateway's own print sink (`gatewayOut`), and the `~` lines a managed
 * settings change prints. One home for the words `gateway on`, `gateway off`, `gateway setup`
 * and `gateway project` all say. No import of `commands.ts` (a type only), which imports this.
 */

import { tildify } from "../cli/paths";
import { createOut, type Out } from "../cli/ui/out";
import { detectTerminal } from "../cli/ui/terminal";
import { formatKeyPath, type ManagedJsonResult } from "../setup/managed-json";
import type { GatewayContext } from "./commands";

/**
 * The output module over the gateway's own print sink: the same words through `ctx.print` (the
 * portal hands its own), with colour and wrapping only when `ctx.term` is a terminal. A table is
 * printed through `ctx.print` as it is: its columns must not wrap.
 */
export function gatewayOut(ctx: GatewayContext): Out {
  const plain = detectTerminal({ env: {}, isTTY: false, platform: ctx.platform });
  return createOut(ctx.term ?? plain, {
    line: (text) => ctx.print(text),
    raw: () => undefined,
  });
}

/** A value as a settings change shows it: JSON, and `(none)` for a key that was not there. */
export function show(value: unknown): string {
  return value === undefined ? "(none)" : JSON.stringify(value);
}

/** One `~` line per key a managed settings change set or removed. */
export function changeLines(result: ManagedJsonResult, home: string): string[] {
  return result.changes.map(
    (change) =>
      `~ ${tildify(result.file, home)}: ${formatKeyPath(change.path)}: ${show(change.before)} -> ${show(change.after)}`,
  );
}

/** A settings change, each key on its own `~` line. */
export function printChanges(out: Out, result: ManagedJsonResult, home: string): void {
  out.marked(changeLines(result, home));
}
