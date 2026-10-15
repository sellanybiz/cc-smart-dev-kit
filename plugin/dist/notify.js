// @bun
// src/hooks/notify.ts
import { spawn } from "child_process";

// src/build-info/names.ts
var MARKETPLACE = "anymodel";
var PLUGIN = "anymodel";
var PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
var COMMAND = "anymodel";

// src/build-info/index.ts
var info = {
  version: "0.3.0",
  repo: "sellanybiz/anymodel",
  dependencies: [
    {
      name: "claude-mem",
      marketplace: "thedotmack",
      version: ">=13.29.0"
    },
    {
      name: "frontend-design",
      marketplace: "claude-plugins-official"
    }
  ]
};
var VERSION = info.version;
var MARKETPLACE_SOURCE = info.repo;
var DEPENDENCIES = info.dependencies;
var MARKETPLACE_ADD_COMMAND = `claude plugin marketplace add ${MARKETPLACE_SOURCE}`;
var PLUGIN_INSTALL_COMMAND = `claude plugin install ${PLUGIN_ID}`;
var PLUGIN_UPDATE_COMMAND = `claude plugin update ${PLUGIN_ID}`;

// src/setup/marketplace-access.ts
var TOKEN_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);

// src/update/apply.ts
var ROUTER_SETUP_HINT = `its router changed: to run it, ${COMMAND} gateway setup (it asks before the restart)`;
function notifyCommand(text, platform, which, title = PLUGIN) {
  if (platform === "linux") {
    const notifySend = which("notify-send");
    return notifySend === null ? null : [notifySend, title, text];
  }
  if (platform === "darwin") {
    const osascript = which("osascript");
    return osascript === null ? null : [
      osascript,
      "-e",
      `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`
    ];
  }
  return null;
}

// src/hooks/io.ts
var SILENT = {};

// src/hooks/notify.ts
var NOTIFY_TYPES = [
  "permission_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
  "worker_permission_prompt"
];
var TYPE_BODY = {
  agent_needs_input: "A background agent is waiting for you.",
  elicitation_dialog: "Claude asks you for input.",
  elicitation_url_dialog: "Claude asks you to open a page.",
  permission_prompt: "Claude is waiting for your permission.",
  worker_permission_prompt: "A background worker is waiting for your permission."
};
var MAX_TEXT = 180;
function oneLine(text) {
  return text.replaceAll(/\s+/g, " ").trim();
}
function shown(text, fallback) {
  const line = oneLine(text);
  if (line === "")
    return fallback;
  return line.length <= MAX_TEXT ? line : `${line.slice(0, MAX_TEXT - 1)}\u2026`;
}
function isWarp(env) {
  return (env.TERM_PROGRAM ?? "").toLowerCase() === "warpterminal";
}
function noticeFor(input, event, env) {
  if (isWarp(env))
    return null;
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return null;
  const fields = input;
  if (event === "Stop") {
    return { body: "Claude finished its turn.", title: "Claude Code" };
  }
  if (event !== "Notification")
    return null;
  const type = typeof fields.notification_type === "string" ? fields.notification_type : "";
  if (!NOTIFY_TYPES.includes(type))
    return null;
  const message = typeof fields.message === "string" ? fields.message : "";
  const title = typeof fields.title === "string" ? fields.title : "";
  return {
    body: shown(message, TYPE_BODY[type] ?? "Claude needs you."),
    title: shown(title, "Claude Code")
  };
}
var spawnNotify = (argv) => {
  const [file, ...args] = argv;
  if (file === undefined)
    return;
  try {
    const child = spawn(file, args, { detached: true, stdio: "ignore" });
    child.on("error", (error) => {
      console.error(`anymodel notify: could not show the notification: ${error.message}`);
    });
    child.unref();
  } catch (error) {
    console.error(`anymodel notify: ${error instanceof Error ? error.message : error}`);
  }
};
function notifyHook(input, event, deps) {
  const notice = noticeFor(input, event, deps.env);
  if (notice === null)
    return SILENT;
  const argv = notifyCommand(notice.body, deps.platform, deps.which, notice.title);
  if (argv === null)
    return SILENT;
  deps.run(argv);
  return SILENT;
}

// src/entries/notify.ts
async function hook() {
  let input;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    console.error("anymodel notify: the hook input is not JSON");
    return;
  }
  const event = typeof input === "object" && input !== null && !Array.isArray(input) ? input.hook_event_name : undefined;
  const env = process.env;
  const result = notifyHook(input, typeof event === "string" ? event : "", {
    env,
    platform: process.platform,
    run: spawnNotify,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" })
  });
  if (result.stderr !== undefined)
    await Bun.write(Bun.stderr, `${result.stderr}
`);
}
try {
  await hook();
} catch (error) {
  console.error(`anymodel notify: ${error instanceof Error ? error.message : String(error)}`);
}
