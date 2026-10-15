/**
 * `anymodel search`: a web search, or one page's text, through the gateway's OmniRoute
 * backend.
 *
 * It reuses the gateway's own config reader (`src/gateway/config.ts`), so the address and
 * the key are the ones the gateway uses, with the same file-mode check, and the key never
 * reaches the command line or any output. The gateway must be set up (there must be an
 * `omniroute` backend): search is OmniRoute's, on its own API.
 *
 * The design, the cost and the limits: docs/search.md.
 */

import { existsSync } from "node:fs";
import { COMMAND } from "../build-info";
import { type CliPaths, tildify } from "../cli/paths";
import { type GatewayConfig, loadConfigFile, messageOf } from "../gateway/config";
import { privateHostKind } from "../gateway/hosts";
import { printableJson } from "../gateway/plain-text";
import { fetchPage, type SearchBackend, searchWeb } from "./client";
import { pageOutput, searchOutput } from "./format";

/** How many results a search asks for when `--max` is not given. */
export const DEFAULT_MAX = 5;

/** The most results `--max` may ask for. */
export const MAX_RESULTS = 50;

/** The backend search goes through: OmniRoute's. The gateway's `setup` writes that name. */
const SEARCH_BACKEND = "omniroute";

export const USAGE = `Usage: ${COMMAND} search "<query>" [--max <n>] [--json]
       ${COMMAND} search --fetch <url> [--json]

Searches the web through the gateway's OmniRoute backend (Ollama's web search among its
providers) and prints each result's title, its URL and a short snippet. The whole output
is cut to about 2500 characters; --json prints OmniRoute's whole answer instead. The
query, or the URL, goes to that search or fetch provider on the internet.

  --max <n>       how many results to ask for, 1 to ${MAX_RESULTS} (default ${DEFAULT_MAX}; the provider may cap it)
  --fetch <url>   fetch one page's text, instead of searching (not a local or private address)
  --json          the answer as JSON, uncut

Needs the gateway: ${COMMAND} gateway setup --backend-key-stdin omniroute`;

export interface SearchArgs {
  fetch: null | string;
  json: boolean;
  max: number;
  query: null | string;
}

/** An http(s) URL, or null. */
function httpUrl(text: string): null | URL {
  const url = URL.parse(text);
  return url !== null && (url.protocol === "http:" || url.protocol === "https:") ? url : null;
}

/**
 * Why `--fetch` refuses `url`, or null when it may go. A local or private address
 * (`privateHostKind`) is refused: the URL goes to a fetch provider on the internet, which
 * cannot reach it, and the address would leave this machine for nothing.
 */
function refusedFetchUrl(url: URL): null | string {
  const kind = privateHostKind(url.hostname);
  if (kind === null) return null;
  return (
    `--fetch does not read ${url.hostname}: it is ${kind}. The page is read by a fetch ` +
    "provider on the internet, which cannot reach it, and the address would leave this machine."
  );
}

/** What the arguments mean, or `{ error }` with the reason they do not work. */
export function parseSearchArgs(args: string[]): SearchArgs | { error: string } {
  const parsed: SearchArgs = { fetch: null, json: false, max: DEFAULT_MAX, query: null };
  const rest: string[] = [];
  let maxGiven = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--json") parsed.json = true;
    else if (arg === "--max") {
      const value = args[index + 1];
      if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) {
        return { error: `--max needs a whole number of results, 1 or more (not "${value ?? ""}")` };
      }
      if (Number(value) > MAX_RESULTS) {
        return { error: `--max asks for at most ${MAX_RESULTS} results (not "${value}")` };
      }
      parsed.max = Number(value);
      maxGiven = true;
      index += 1;
    } else if (arg === "--fetch") {
      const value = args[index + 1];
      const url = value === undefined ? null : httpUrl(value);
      if (value === undefined || url === null) {
        return { error: `--fetch needs an http(s) URL (not "${value ?? ""}")` };
      }
      const refused = refusedFetchUrl(url);
      if (refused !== null) return { error: refused };
      parsed.fetch = value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `Unknown option: ${arg}` };
    else rest.push(arg);
  }
  if (rest.length > 1) return { error: "give one query, in quotes" };
  const query = rest[0]?.trim() ?? null;
  parsed.query = query === "" ? null : query;
  if (parsed.fetch !== null && parsed.query !== null) {
    return { error: "give either a query or --fetch <url>, not both" };
  }
  if (parsed.fetch !== null && maxGiven) {
    return { error: "--max counts search results; --fetch reads one page, so leave --max out" };
  }
  if (parsed.fetch === null && parsed.query === null) {
    return { error: "give a query, or --fetch <url>" };
  }
  return parsed;
}

/**
 * The gateway's OmniRoute backend, with the address and the key from the config file.
 * `{ error }` with what to do when there is no config, when it cannot be used, or when it
 * names no `omniroute` backend. Never a key in the text: `loadConfigFile`'s own errors
 * name the file and the mode only.
 */
export function searchBackend(configFile: string): { backend: SearchBackend } | { error: string } {
  if (!existsSync(configFile)) {
    return {
      error:
        `the gateway is not set up: ${configFile} does not exist.\n` +
        `Search goes through the gateway's OmniRoute backend. Set it up with: ${COMMAND} gateway setup --backend-key-stdin omniroute`,
    };
  }
  let config: GatewayConfig;
  try {
    config = loadConfigFile(configFile);
  } catch (error) {
    return { error: messageOf(error) };
  }
  const backend = Object.hasOwn(config.backends, SEARCH_BACKEND)
    ? config.backends[SEARCH_BACKEND]
    : undefined;
  if (backend === undefined) {
    const names = Object.keys(config.backends);
    return {
      error:
        `the gateway has no "${SEARCH_BACKEND}" backend: ${configFile} names ${names.length === 0 ? "none" : names.join(", ")}.\n` +
        `Search goes through OmniRoute. Add it with: ${COMMAND} gateway setup --backend-key-stdin omniroute`,
    };
  }
  return { backend: { apiKey: backend.apiKey, baseUrl: backend.baseUrl } };
}

/** What a request that failed prints: its reason, and which config it came from. */
function failed(reason: string, paths: CliPaths): number {
  console.error(reason);
  console.error(`  config: ${tildify(paths.gatewayConfigFile, paths.home)}`);
  return 1;
}

export interface SearchContext {
  paths: CliPaths;
}

/** Runs `anymodel search`; the exit code. */
export async function runSearch(args: string[], ctx: SearchContext): Promise<number> {
  const parsed = parseSearchArgs(args);
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  const { paths } = ctx;
  const found = searchBackend(paths.gatewayConfigFile);
  if ("error" in found) {
    console.error(found.error);
    return 1;
  }
  if (parsed.fetch !== null) {
    const said = await fetchPage({ backend: found.backend, url: parsed.fetch });
    if ("error" in said) return failed(said.error, paths);
    console.log(parsed.json ? printableJson(said.raw) : pageOutput(said.page));
    return 0;
  }
  const query = parsed.query ?? "";
  const said = await searchWeb({ backend: found.backend, max: parsed.max, query });
  if ("error" in said) return failed(said.error, paths);
  console.log(parsed.json ? printableJson(said.raw) : searchOutput(query, said.answer));
  return 0;
}
