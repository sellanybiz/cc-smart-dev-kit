/**
 * The real readers behind `runWeight` (`classify.ts`): the folder's `package.json` scripts and
 * its files. The route hook and `job run` both weigh a line against the disk this way, so the
 * two readers are wired in one place and a line is judged the same where it is routed and where
 * it runs.
 */

import type { WeightSource } from "./classify";
import { fileExistsIn, packageScripts } from "./package-scripts";

/** A `WeightSource` that reads the disk, for a line that runs in `folder`. */
export function diskWeightSource(folder: string): WeightSource {
  return { folder, isFile: fileExistsIn, scriptsIn: packageScripts };
}
