/* global game, Hooks */
/**
 * Moves the party check's old per-item scaling flags into the item's own throw.
 *
 * An ability once carried `flags["acks-extras"].thiefSkill` (the skill whose
 * ladder to read) and `levelFactor` (the fraction of the owner's level to read
 * it at), which only the party check consulted. Both are now what a borrowed
 * throw says of itself: the item's default throw becomes a `progression`
 * target naming the skill's ladder, the fraction and the rounding, so the skill
 * sheet, the Rolls tab and the party card read one figure. The flags are
 * removed once the throw holds them. Idempotent, and an item it cannot move
 * without changing its figure keeps its flags and is counted.
 */
import { MODULE_ID } from "./constants.mjs";
import { cookbookId, whenReady } from "../lib/library.mjs";
import { primaryGMSettled } from "../lib/util.mjs";
import { levelFraction } from "../lib/vocab.mjs";
import { readRolls, writeRolls, defaultKeyOf, keyOf, blankRoll } from "./ability-rolls.mjs";
import { importedLadderFor, refreshLadders } from "./skill-ladders.mjs";

/** The borrowed class: the registry falls back to the imported skill's ladder, so the key only has to be a class that is not a chassis. */
const BORROWED_FROM = "thief";

/** A cookbook skill id's key, or the empty string. */
const skillKeyOf = (item) => /^def\.skill\.([A-Za-z]+)$/.exec(cookbookId(item))?.[1] ?? "";

/** A level factor as the numerator and denominator a `progression` target stores, or null. */
export const factorFraction = levelFraction;

/**
 * What to do with one item carrying the legacy flags.
 *
 * @param {Item} item
 * @param {Actor|null} actor the owner, whose own copy of a skill is read first
 * @returns {{action: "none"|"clear"|"move"|"keep", table?: string, num?: number, den?: number, reason?: string}}
 *   `none` carries no legacy flag; `clear` drops flags that change nothing;
 *   `move` rewrites the default throw; `keep` leaves the flags and says why
 */
export function planSkillFlagMigration(item, actor = null) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  const named = String(flags.thiefSkill ?? "");
  const factor = flags.levelFactor == null ? null : Number(flags.levelFactor);
  if (!named && factor == null) return { action: "none" };

  const whole = factor == null || factor === 1;
  const table = named || (whole ? "" : skillKeyOf(item));
  if (!table) return whole ? { action: "clear" } : { action: "keep", reason: "noTable" };
  if (!importedLadderFor(table, actor)) return { action: "keep", reason: "notImported" };
  const fraction = whole ? null : factorFraction(factor);
  if (!whole && !fraction) return { action: "keep", reason: "fraction" };
  return { action: "move", table, ...(fraction ? { num: fraction.num, den: fraction.den } : {}) };
}

/** The target a moved throw carries. */
const progressionTarget = ({ table, num, den }) => ({
  kind: "progression",
  as: BORROWED_FROM,
  table,
  ...(num ? { atLevelNum: num, atLevelDen: den } : {}),
  round: "up",
});

const sameTarget = (a, b) => a?.kind === b.kind && a.as === b.as && a.table === b.table && (a.atLevelNum ?? null) === (b.atLevelNum ?? null) && (a.atLevelDen ?? null) === (b.atLevelDen ?? null) && (a.round ?? null) === b.round;

/**
 * Migrate one item: rewrite its default throw, then remove the flags. The
 * throw is written first, so an interruption leaves the flags for the next
 * run to finish.
 *
 * @returns {Promise<"none"|"cleared"|"moved"|"keep">}
 */
export async function migrateItem(item, actor = null) {
  const plan = planSkillFlagMigration(item, actor);
  if (plan.action === "none" || plan.action === "keep") return plan.action;
  if (plan.action === "move") {
    const rolls = readRolls(item);
    const target = progressionTarget(plan);
    if (!rolls.length) rolls.push({ ...blankRoll(), key: "primary", target, scale: "level" });
    else {
      const key = defaultKeyOf(item);
      const roll = rolls.find((r, i) => keyOf(r, i) === key) ?? rolls[0];
      if (!sameTarget(roll.target, target)) {
        roll.target = target;
        roll.scale = "level";
      }
    }
    await writeRolls(item, rolls);
  }
  // A flag that made the item a skill keeps doing so on its own once the flag is gone.
  if (item.flags?.[MODULE_ID]?.isSkill === undefined && item.flags?.[MODULE_ID]?.thiefSkill) await item.setFlag(MODULE_ID, "isSkill", true);
  await item.unsetFlag(MODULE_ID, "thiefSkill");
  await item.unsetFlag(MODULE_ID, "levelFactor");
  return plan.action === "move" ? "moved" : "cleared";
}

/**
 * Sweep the world's items and every character's. GM-only; its caller runs it in
 * one window.
 *
 * @returns {Promise<{moved: number, cleared: number, kept: number, keptReasons: object}>}
 */
export async function migrateSkillFlags() {
  const out = { moved: 0, cleared: 0, kept: 0, keptReasons: {} };
  if (!game.user?.isGM) return out;
  await refreshLadders();
  const visit = async (item, actor) => {
    if (item.type !== "ability") return;
    const done = await migrateItem(item, actor);
    if (done === "moved") out.moved++;
    else if (done === "cleared") out.cleared++;
    else if (done === "keep") {
      out.kept++;
      const reason = planSkillFlagMigration(item, actor).reason;
      out.keptReasons[reason] = (out.keptReasons[reason] ?? 0) + 1;
    }
  };
  for (const item of game.items ?? []) await visit(item, null);
  for (const actor of game.actors ?? []) for (const item of actor.items ?? []) await visit(item, actor);
  return out;
}

/** Run the sweep once the world is up, in the window that automates. */
export function installSkillFlagMigration() {
  Hooks.once("ready", () => {
    Promise.all([whenReady(), primaryGMSettled()])
      .then(([, primary]) => (primary ? migrateSkillFlags() : null))
      .then((r) => {
        if (r && (r.moved || r.cleared || r.kept)) {
          console.log(`${MODULE_ID} | party-roll skill flags moved onto the throws: ${r.moved} moved, ${r.cleared} cleared, ${r.kept} left (${JSON.stringify(r.keptReasons)})`);
        }
      })
      .catch((err) => console.error(`${MODULE_ID} | skill flag migration failed`, err));
  });
}
