/**
 * Which slot chain a Claude plan limit holds: the usage-limit alert (`src/hooks/stop-failure.ts`)
 * names a limit only when Claude answers the session's slot first.
 *
 * The router bundle never imports this module: it reads the gateway's config the way a command
 * does, so it may grow without changing `plugin/dist/router.js`.
 */
import { fallbackOn, type GatewayConfig, profileNames, profileView } from "./config";
import { stateKeyFor } from "./limit-state";
import { targetsInUse, withoutContextSuffix } from "./targets";

/**
 * The targets each slot would use now, from the config, keyed like the breakers are (the
 * router's state key: `<slot>` for the machine's chain, `<profile>/<slot>` for a profile's —
 * a profile's view of the machine's config, so a slot it does not name shows the machine's
 * chain under its own key too).
 */
export function targetsNow(config: GatewayConfig): Record<string, string[]> {
  const inUse = (view: GatewayConfig, profile: null | string): [string, string[]][] =>
    Object.entries(view.slots).map(([slot, chain]) => [
      stateKeyFor(slot, profile),
      targetsInUse(chain, fallbackOn(view, slot)),
    ]);
  return Object.fromEntries([
    ...inUse(config, null),
    ...profileNames(config).flatMap((name) => {
      const view = profileView(config, name);
      return view === null ? [] : inUse(view, name);
    }),
  ]);
}

/**
 * True when a plan limit of the Claude model `model` holds a session whose chain in use is under
 * `key` (its slot's state key: `<profile>/<slot>` in a profile, `stateKeyFor`): it runs on Claude
 * itself (no key), that chain is not known (no readable config — `inUse` null — or the key is
 * not in it), or the chain starts with that model. A chain that starts with another target
 * answers with that target, and the Claude model is only its fallback: its limit says nothing
 * about when the session's own model answers again.
 */
export function claudeLimitHolds(
  key: null | string,
  model: string,
  inUse: null | Record<string, string[]>,
): boolean {
  const first = key === null ? undefined : inUse?.[key]?.[0];
  return first === undefined || withoutContextSuffix(first) === model;
}
