/** Owner decision, 2026-11-11: Claude Code 2.1.322 maps fable to an older gateway model.
 * Subscription logins skip model discovery, so the gateway owns this one family pin.
 * prices.test.ts requires it to name the newest Fable price row the kit knows.
 */
import { familyEnv } from "./targets";

export const GATEWAY_FABLE_MODEL = "claude-fable-5-2";
export const GATEWAY_FABLE_ENV = familyEnv("fable");
