/* global game, Hooks */
/**
 * Core patch (display half of patches/attack-roll.mjs): the character sheet's
 * Melee/Ranged boxes, REPLACED at every render.
 *
 * Core's attributes tab prints Melee/Ranged as `ability mod + attack adjustment`
 * — a bonus-only number with the attack throw (the moving target) omitted, so
 * editing the throw never visibly changes it and the number contradicts what the
 * roll actually does. Core is a read-only reference, so the wrong display cannot
 * be deleted at the source; instead this hook overwrites the rendered value and
 * tooltip on every render, making the folded number UNREACHABLE in play. The
 * replacement states the model the patched roll uses:
 *
 *     10+ +2      — attack throw (target, moves with class/level) · roll bonus
 *
 * The rollable headers keep their own `data-action="rollAttack"` wiring — only
 * the displayed value/tooltip are superseded. Character sheets only: monsters
 * have no such boxes, and the Follower Card already renders the split.
 */
import { toNum as num } from "../util.mjs";
import { MODULE_ID } from "../constants.mjs";
import { ACTOR_TYPE } from "../vocab.mjs";

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Is Weapon Finesse in force for this character's melee attacks?
 *
 * Read through the equipment API rather than off the actor's effects: the
 * proficiency usually arrives as an ability item from the Judge's own books and
 * reaches the domain through the abilities bridge, so a bare effect scan misses
 * exactly the characters that have it. Equipment's own automation setting gates
 * it too — with that off nothing re-keys the roll, and a box claiming otherwise
 * would state a bonus the dice never see. Absent or unreadable equipment means
 * no substitution, never an assumed one.
 */
function meleeFinesse(actor) {
  const api = equipment();
  const domain = api?.EFFECT_DOMAINS?.FINESSE;
  if (!api?.hasEffectFlag || !domain) return false;
  try {
    if (!game.settings.get(MODULE_ID, "rollAutomation")) return false;
    return !!api.hasEffectFlag(actor, domain);
  } catch {
    return false; // equipment not registered here — nothing re-keys anything
  }
}

/** The equipment subsystem, when it is live. Optional by design. */
const equipment = () => globalThis.acksExtras?.equipment ?? game.modules?.get(MODULE_ID)?.api?.equipment ?? null;

/**
 * Style bonus this character is trained for but is not currently equipped to
 * collect — Specialization on a style they are not holding, the dual-weapon
 * bonus with only one weapon in hand.
 *
 * Equipment owns the arithmetic (`attackBonusHeadroom`), and it returns a
 * DIFFERENCE rather than a total precisely so this can be added to
 * `thac0.mod`: that field already carries whatever the current loadout earns,
 * and adding an absolute best would count the same bonus twice.
 */
function styleHeadroom(actor, type) {
  const api = equipment();
  if (!api?.attackBonusHeadroom) return 0;
  try {
    return num(api.attackBonusHeadroom(actor, type));
  } catch {
    return 0;
  }
}

/** A score's own name, from the system's field labels; the key if it has none. */
function scoreLabel(key) {
  const path = globalThis.CONFIG?.ACKS?.scores?.[key];
  const label = typeof path === "string" ? game.i18n.localize(path) : "";
  return label && label !== path ? label : key.toUpperCase();
}

function fixAttackDisplays(app, element) {
  if (game.system?.id !== "acks") return;
  const actor = app.actor ?? app.document;
  if (actor?.type !== ACTOR_TYPE.character) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const sys = actor.system;
  const T = num(sys.thac0?.throw, 10);
  const finesse = meleeFinesse(actor);
  for (const type of ["melee", "missile"]) {
    const header = root.querySelector(`a[data-action="rollAttack"][data-attack="${type}"]`);
    const input = header?.closest(".form-group")?.querySelector("input");
    if (!input) continue; // not this sheet's markup (e.g. the Follower Card)
    // These boxes name no weapon, so they state the character's BEST — what
    // this character reaches with gear they are trained for, which is the
    // reading a player wants from a summary. Two parts, and each is a
    // replacement or a difference so neither can stack with what is already
    // counted:
    //
    //   attribute — Strength, unless Weapon Finesse lets the character take
    //     Dexterity instead. An election, so the better of the two and never
    //     both; `thac0.mod` never carries this term, so it substitutes cleanly.
    //   style     — Specialization and the dual-weapon bonus. `thac0.mod`
    //     already holds whatever the CURRENT loadout earns, so only the unearned
    //     remainder is added (see equipment's attackBonusHeadroom).
    const substitutes = type === "melee" && finesse && num(sys.scores?.dex?.mod) > num(sys.scores?.str?.mod);
    const abilityKey = type === "missile" || substitutes ? "dex" : "str";
    const ability = num(sys.scores?.[abilityKey]?.mod);
    const adjustment = num(sys.thac0?.mod?.[type]) + styleHeadroom(actor, type);
    input.value = `${T}+ ${signed(ability + adjustment)}`;
    input.dataset.dtype = "String";
    input.dataset.tooltip = game.i18n.format("ACKS-LIB.attack.displayTooltip", {
      target: T,
      bonus: signed(ability + adjustment),
      ability: `${signed(ability)} (${scoreLabel(abilityKey)})`,
      adjustment: signed(adjustment),
    });
  }
}

/** Registered alongside the roll patch, under the same world setting. */
export function installAttackDisplayPatch() {
  Hooks.on("renderActorSheetV2", (app, element) => {
    try {
      fixAttackDisplays(app, element);
    } catch (err) {
      console.warn(`${MODULE_ID} | attack display replacement failed`, err);
    }
  });
}
