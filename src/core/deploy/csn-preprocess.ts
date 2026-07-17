import type { TObjectTypeMode } from "./deploy-target-store";
import type { TCsnContent } from "./csn-model-types";

/**
 * Legacy's `buma`/`SAP_SF` modes each need their own CSN-reconciliation pass before the generic
 * `readCSNToFinalDB` tree-walk can run (BUMA's exported XML has no composition `on`-conditions and
 * isn't guaranteed tree-shaped; SAP_SF's is hardcoded to a fixed 5-table `MDG_SFU.User` graph).
 * Neither is ported yet (Phase 2) — fail loudly here rather than run the generic walker against
 * un-normalized CSN, which would silently produce broken/garbage CDS instead of an error.
 */
const UNSUPPORTED_MODES: TObjectTypeMode[] = ["buma", "SAP_SF"];

export function preprocessCsnForMode(mode: TObjectTypeMode, csnContent: TCsnContent): TCsnContent {
  if (UNSUPPORTED_MODES.includes(mode)) {
    throw new Error(`Deploy Model does not yet support the "${mode}" object type mode's DB-model generation (its XML→CSN needs mode-specific graph reconciliation not yet ported from the legacy tool).`);
  }
  return csnContent;
}
