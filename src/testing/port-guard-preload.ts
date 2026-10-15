// Preloaded into every CLI subprocess a test starts (`subprocessGuard().args`): the
// live-router guard of port-guard.ts, in subprocess mode.
import { installPortGuard } from "./port-guard";

installPortGuard({ subprocess: true });
