/* global game, Hooks */
/**
 * The module's world-clock policy — the one switch deciding whether this module
 * writes to `game.time`, and the one place features WATCH it from.
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

/**
 * Register a callback fired when world time moves forward, on the one GM
 * client that is responsible for acting on it.
 *
 * Every feature that reacts to the calendar shares this registrar rather than
 * guarding a hook of its own: the "am I the active GM" test is what stops a
 * two-GM table processing the same day twice, and one copy of it is the only
 * way it stays one answer. Callbacks must be idempotent — each keeps its own
 * watermark, because the hook also fires for a clock the Judge dragged.
 *
 * @param {(worldTime: number, dt: number) => void} callback  seconds, and the
 *   forward step that produced them.
 */
export function onWorldTimeAdvanced(callback) {
  Hooks.on("updateWorldTime", (worldTime, dt) => {
    if (!game.users.activeGM || game.user !== game.users.activeGM) return;
    if (dt <= 0) return;
    callback(Math.floor(worldTime), dt);
  });
}
