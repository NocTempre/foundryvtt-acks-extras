/* global game */
/**
 * The module's world-clock policy — the one switch deciding whether this module
 * writes to `game.time`.
 *
 * Two features move the clock: formation's dungeon turns (a minute per
 * bookkeeping round) and the location sheet's "Advance 1 week" fallback. They
 * differ only in step size — both write the same shared resource through the
 * same `game.time.advance` contract — so a GM is answering one question, not
 * two: does this module drive the clock, or does another module own it? The key
 * is registered once (module.mjs) and read from here by both features, because a
 * per-feature answer would give the same toggle two labels and two defaults.
 */
import { MODULE_ID } from "./constants.mjs";

/** World setting gating every `game.time.advance` this module performs. */
export const SETTING_ADVANCE_WORLD_TIME = "advanceWorldTime";

/** True when this module may move the world clock. */
export const mayAdvanceWorldTime = () => game.settings.get(MODULE_ID, SETTING_ADVANCE_WORLD_TIME);
