/**
 * The kit recogniser the guards share: the line-level test (`namesKit`) that `session-escape-guard`
 * and the Bash judge both make before they read a computed program as the kit's.
 */
import { describe, expect, test } from "bun:test";
import { namesKit } from "./kit-invocation";

describe("namesKit: the kit command as a token of a line's text", () => {
  test("a line that binds or holds the kit by name or by launcher path names it", () => {
    for (const line of [
      "K=cc-smart-dev-kit; $K workflow",
      "$(command -v cc-smart-dev-kit) workflow",
      "$HOME/.local/bin/cc-smart-dev-kit workflow",
      "C:\\bin\\cc-smart-dev-kit.cmd workflow",
      "echo propose | xargs cc-smart-dev-kit workflow",
      // A launcher the person put in a folder of their own: a name that ends a path counts
      // wherever the path runs (the cost is `cd /repo/cc-smart-dev-kit && "$PY" …`, which counts
      // too, on purpose: RV4 finding F6).
      "K=/opt/tools/cc-smart-dev-kit; $K workflow",
    ]) {
      expect({ line, names: namesKit(line) }).toEqual({ line, names: true });
    }
  });

  test("a path to the kit's bundle written anywhere in the line names it, a variable's value included", () => {
    for (const line of [
      "C=$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/1.2.0/dist/cli.js; $(which bun) $C workflow",
      'C="/opt/plugin/dist/cli.js"; "$BUN" "$C" crew list',
      "export P=/opt/plugin/dist/portal.js && $NODE $P",
      "$(which bun) src/entries/cli.ts doctor",
      // The form the plugin's own hook commands take: the plugin folder is a variable, so no
      // folder of the path holds the kit's name (a rule that wanted one would miss this; the
      // cost is `"$PY" -m pytest src/entries/cli.ts …`, which counts too: RV4 finding F5).
      'B="$CLAUDE_PLUGIN_ROOT/dist/cli.js"; $(which bun) $B workflow',
    ]) {
      expect({ line, names: namesKit(line) }).toEqual({ line, names: true });
    }
    // Another program's bundle is no kit's.
    for (const line of ["S=$HOME/app/dist/server.js; $(which node) $S", "$NODE dist/cli.json"]) {
      expect({ line, names: namesKit(line) }).toEqual({ line, names: false });
    }
  });

  test("a path that only passes through a folder of that name does not", () => {
    for (const line of [
      '"$PY" -m pytest -k workflow',
      "$(which gh) workflow",
      "/repo/cc-smart-dev-kit/src/x.test.ts $PY",
      "$PY /home/user/cc-smart-dev-kit/scripts/run.py workflow",
      "cc-smart-dev-kit-bun.sh $PY",
      "",
    ]) {
      expect({ line, names: namesKit(line) }).toEqual({ line, names: false });
    }
  });
});
