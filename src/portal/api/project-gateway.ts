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
import { projectSourceWords, projectStateOfAsync } from "../../gateway/commands-project";
import { fallbackOn, type GatewayConfig, profileView } from "../../gateway/config";
import {
  decisionWords,
  type GatewayDecision,
  PERSONAL_FILE,
  type ProjectGatewayState,
  type SettingsFileState,
  urlMeaning,
} from "../../gateway/project-state";
import { SLOT_ORDER, slotName } from "../facts";
import type { PageDataDeps } from "../page-data";
import { projectsList, projectsWorldOf } from "./projects";
import type {
  ProjectGatewayAnswer,
  ProjectGatewayDecision,
  ProjectGatewayFile,
  ProjectGatewayNote,
  ProjectProfile,
} from "./types";

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
    words: decisionWords(decision),
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
        : decisionWords({
            ...urlMeaning(file.url, view.routerUrl),
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
  const keys = [
    ...SLOT_ORDER.map((one) => `cc-smart-dev-kit-${slotName(one)}`),
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
      text: "This folder is not in a git project: it has no personal file, so its state cannot be set here.",
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
      text: `This project's sessions send their requests to another address: ${COMMAND} does not set it, and will not replace it. Remove it by hand to choose here.`,
      tone: "warn",
    });
  }
  return notes;
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
    onAllowed: configured && view.checkout !== null && view.checkout.personalTracked !== true,
    profile:
      view.effective.state === "on" && view.effective.profile !== null
        ? profileOf(config, view.effective.profile)
        : null,
    profiles: view.profiles,
    writable: view.checkout !== null,
  };
}
