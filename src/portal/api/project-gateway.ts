/**
 * `GET /api/projects/<id>/gateway` (GP4b): the Project page's Gateway card. A project's own
 * gateway state (D29, GP2) — on, off or default, and the file that decides it — and what a
 * session started in its folder effectively gets, with the profile its address names and that
 * profile's chains slot by slot over the machine's.
 *
 * **One reader.** The state is `projectGatewayStateAsync` (`src/gateway/project-state.ts`), the
 * awaited twin of the reader `gateway project status`, `gateway projects` and the doctor use: its
 * git reads are `Bun.spawn`, so the server stays free (`.claude/rules/portal.md`). The words are
 * the command's own (`decisionWords`, `projectSourceWords`). The chains are the config's own
 * readers (`profileSlotChain`, `profileView`, `fallbackOn`) over the portal's one config read.
 *
 * **Nothing is guessed, nothing secret.** A file that cannot be read is `unknown`, never the next
 * file's value; an address that is neither Anthropic's nor the router's reaches the page only
 * masked, through `decisionWords`. A change is the CLI's own command in a child
 * (`project.gateway.set`, `project.gateway.profile` in `src/portal/actions.ts`): the refusals the
 * notes foresee are the command's, and it makes them again under its lock.
 */

import { COMMAND } from "../../build-info";
import { tildify } from "../../cli/paths";
import {
  planProjectChange,
  projectSourceWords,
  projectStateOfAsync,
} from "../../gateway/commands-project";
import { fallbackOn, type GatewayConfig, profileView } from "../../gateway/config";
import {
  decisionWords,
  type GatewayDecision,
  PERSONAL_FILE,
  type ProjectGatewayState,
  type SettingsFileState,
  urlMeaning,
} from "../../gateway/project-state";
import { backendAddress, shownValue } from "../../gateway/settings";
import { SLOT_ORDER, slotName } from "../facts";
import type { PageDataDeps } from "../page-data";
import { projectsList, projectsWorldOf } from "./projects";
import type {
  ProjectGatewayAnswer,
  ProjectGatewayDecision,
  ProjectGatewayFile,
  ProjectGatewayNote,
  ProjectGatewayWrites,
  ProjectProfile,
} from "./types";

/**
 * A decision in the command's words (`decisionWords`), except another gateway's address: a page
 * gets it as `backendAddress` gives one — no user name, password, query or fragment, where a key
 * can ride — then `shownValue`, as every address a page shows (`.claude/rules/portal.md`).
 */
function wordsOf(decision: GatewayDecision): string {
  if (decision.state !== "other" || decision.url === null) return decisionWords(decision);
  const address = backendAddress(decision.url);
  return `another address: ${address === null ? "(not a URL)" : shownValue(address)}`;
}

/**
 * The command's own words with every settings file's address as a page may show it: the planner
 * quotes another gateway's address through `shownValue`, which keeps a short query token, so each
 * one becomes its `backendAddress` form here.
 */
function withoutRawAddresses(text: string, view: ProjectGatewayState): string {
  let out = text;
  for (const file of view.files) {
    if (file.url === null) continue;
    const address = backendAddress(file.url);
    out = out.replaceAll(
      shownValue(file.url),
      address === null ? "(not a URL)" : shownValue(address),
    );
  }
  return out;
}

/** One decision as the page reads it: the command's two lines, and nothing raw. */
function decisionOf(
  decision: GatewayDecision,
  view: ProjectGatewayState,
  home: string,
): ProjectGatewayDecision {
  return {
    from: projectSourceWords(decision, home, view),
    profile: decision.profile,
    source: decision.source,
    state: decision.state,
    words: wordsOf(decision),
  };
}

/** One settings file as the page lists it, in the words `gateway project status` uses. */
function fileOf(
  file: SettingsFileState,
  view: ProjectGatewayState,
  home: string,
): ProjectGatewayFile {
  const holds =
    file.problem !== null
      ? `cannot be read (${file.problem})`
      : file.url === null
        ? "sets nothing"
        : wordsOf({
            ...urlMeaning(file.url, view.routerUrl),
            path: file.path,
            source: file.kind,
            url: file.url,
          });
  return { holds, kind: file.kind, path: tildify(file.path, home), problem: file.problem !== null };
}

/**
 * The profile `name`, slot by slot: the machine's chain in use, the profile's own entry, and the
 * fallback switch its view gives. The slots are the Slots page's, in its order (`SLOT_ORDER`),
 * then any other slot the profile itself names.
 */
function profileOf(config: GatewayConfig | null, name: string): ProjectProfile {
  const profile =
    config?.profiles !== undefined && Object.hasOwn(config.profiles, name)
      ? config.profiles[name]
      : undefined;
  if (config === null || profile === undefined) return { exists: false, name, slots: [] };
  const view = profileView(config, name) ?? config;
  // The Slots page's slots in its order, then the machine's own slots (they answer in the
  // profile with the machine's chain) and any other slot the profile names.
  const keys = [
    ...SLOT_ORDER.map((one) => `cc-smart-dev-kit-${slotName(one)}`),
    ...Object.keys(config.slots),
    ...Object.keys(profile.slots ?? {}),
  ];
  return {
    exists: true,
    name,
    slots: [...new Set(keys)].map((key) => {
      const own =
        profile.slots !== undefined && Object.hasOwn(profile.slots, key)
          ? (profile.slots[key] ?? null)
          : null;
      return {
        fallback: fallbackOn(view, key),
        key,
        machine: Object.hasOwn(config.slots, key) ? (config.slots[key] ?? null) : null,
        name: slotName(key),
        own,
      };
      // `machine` by construction, so the page draws the two and never a third reading.
    }),
  };
}

/** The facts that change what the card may do, and the faults, in words. */
function notesOf(
  view: ProjectGatewayState,
  config: { error: string } | { config: GatewayConfig },
  home: string,
): ProjectGatewayNote[] {
  const notes: ProjectGatewayNote[] = [];
  if (view.checkoutProblem !== null) {
    notes.push({
      text: `The project's checkout cannot be read: ${view.checkoutProblem}`,
      tone: "bad",
    });
  } else if (view.checkout === null) {
    notes.push({
      text: "This folder is not in a git project: only its own .claude/settings.local.json and settings.json are read here, so its state cannot be set.",
      tone: "info",
    });
  }
  if (view.effective.state === "unknown") {
    notes.push({
      text: "A settings file this project's sessions read cannot be read, so its gateway state is unknown: fix the file by hand, or move it aside.",
      tone: "bad",
    });
  }
  if (view.configProblem !== null) {
    notes.push({
      text: `The gateway config cannot be read (${view.configProblem}): until it is fixed, the router runs on its default config.`,
      tone: "bad",
    });
  } else if ("error" in config) {
    notes.push({
      text: `This machine's gateway is not set up (${config.error}), so a project can be off or default here, never on.`,
      tone: "info",
    });
  }
  if (view.checkout?.personalTracked === true) {
    notes.push({
      text: `Git tracks this project's personal file (.claude/${PERSONAL_FILE}), so a router address written there would be committed with it: on is refused until it is untracked (git rm --cached -- .claude/${PERSONAL_FILE}).`,
      tone: "warn",
    });
  }
  for (const file of view.files) {
    if (file.loginOverrides.length === 0) continue;
    notes.push({
      text: `${file.loginOverrides.join(", ")} ${file.loginOverrides.length === 1 ? "is" : "are"} set in ${tildify(file.path, home)}: it replaces your own Claude login, so this project cannot be turned on or off until it is removed by hand.`,
      tone: "warn",
    });
  }
  const named = view.effective.profile;
  if (named !== null && !view.profiles.includes(named) && view.configProblem === null) {
    notes.push({
      text: `The router has no profile "${named}": this project's requests answer as plain Claude. Pick another profile, or make it on the command line.`,
      tone: "warn",
    });
  }
  if (view.effective.state === "other") {
    notes.push({
      text: `This project's sessions send their requests to another address, which ${COMMAND} did not set and never replaces: remove it by hand, or set the state in a file that decides before it.`,
      tone: "warn",
    });
  }
  return notes;
}

/**
 * What `gateway project <state>` would refuse in one file, from its own planner
 * (`planProjectChange`, pure over the state just read): null where it would write. The
 * command plans again under its lock when it runs, so this is what the card offers, never what
 * it trusts. `on` also needs this machine's gateway: without a config the command's router check
 * would fail, so the card says so first.
 */
function writesOf(
  view: ProjectGatewayState,
  config: GatewayConfig | null,
  configured: boolean,
  paths: { gatewayConfigFile: string; home: string; stateDir: string },
  team: boolean,
): ProjectGatewayWrites {
  const refusal = (state: "default" | "off" | "on"): null | string => {
    const plan = planProjectChange(view, {
      config,
      configPath: paths.gatewayConfigFile,
      home: paths.home,
      request: { folder: view.folder, profile: null, state, team },
      stateDir: paths.stateDir,
    });
    if ("error" in plan) return withoutRawAddresses(plan.error, view);
    if (state === "on" && !configured) {
      return "On needs this machine's gateway, and it is not set up: set it up on Machine first.";
    }
    return null;
  };
  return { default: refusal("default"), off: refusal("off"), on: refusal("on") };
}

/**
 * The Gateway card's answer for project `id`, or a plain refusal for an id the list does not
 * have. The root is the server's own list's (`projectsList`): a path from a request never
 * reaches the reader.
 */
export async function projectGatewayAnswerFor(
  deps: PageDataDeps,
  id: string,
): Promise<ProjectGatewayAnswer | { error: string }> {
  const list = await projectsList(projectsWorldOf(deps));
  const project = list.projects.find((one) => one.id === id);
  if (project === undefined) {
    return { error: `no project has the id "${id}"; the list on /api/projects names them` };
  }
  const { paths } = deps.action.portal;
  const view = await projectStateOfAsync({ paths }, project.root);
  const config = "config" in deps.found ? deps.found.config : null;
  const configured = config !== null && view.configProblem === null;
  return {
    choice: decisionOf(view.choice, view, paths.home),
    configured,
    effective: decisionOf(view.effective, view, paths.home),
    files: view.files.map((file) => fileOf(file, view, paths.home)),
    notes: notesOf(view, deps.found, paths.home),
    personalTracked: view.checkout?.personalTracked ?? null,
    refusals: {
      personal: writesOf(view, config, configured, paths, false),
      team: writesOf(view, config, configured, paths, true),
    },
    profile:
      view.effective.state === "on" && view.effective.profile !== null
        ? profileOf(config, view.effective.profile)
        : null,
    profiles: view.profiles,
    writable: view.checkout !== null,
  };
}
