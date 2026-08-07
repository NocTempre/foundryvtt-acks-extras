/* global game, ui, Hooks, Actor, foundry, document */
/**
 * Reaching an ability's throws from the character sheet.
 *
 * The system's sheet offers exactly one control per ability — the row's icon,
 * the d20 in Favorites — and core's roller can only ever make one throw, so a
 * proficiency the book prints with two ways to attempt it (hastily, or
 * methodically for a turn and a bonus) had one of them reachable and the other
 * only from inside the item. roll-wrap.mjs already routes every one of those
 * controls through the multi-roll roller; what was missing was a way to SAY
 * which throw is meant.
 *
 * Three surfaces, one rule each:
 *
 * - The tag strip in an expanded row already prints every throw with its
 *   target. Each tag now carries its throw's key and rolls it. The strip is
 *   built by `getTags` (roll-wrap.mjs) and inserted by core when the row is
 *   expanded, long after this render — so the click is DELEGATED from the
 *   sheet root rather than bound to tags that do not exist yet.
 * - A multi-throw row gains a cycle control naming its default throw. The
 *   default is what the row's own icon and every other route reach.
 * - Favorites renders one control per throw, because a favourite exists to be
 *   rolled without going looking for it, and going looking for the other throw
 *   is the thing being fixed.
 *
 * INJECTED, NOT SUBCLASSED, and REBUILT EVERY RENDER — the reason the Storage
 * tab documents: core declares its parts as statics, ApplicationV2 replaces
 * them on re-render, and a latched control outlives the node it was measured
 * against. Ours are removed and re-added instead.
 */
import { MODULE_ID, ABILITY_TYPE } from "./constants.mjs";
import { rollsOf, keyOf, targetOf, rollAbility, defaultKeyOf, setDefaultKey, nextKeyAfter } from "./ability-rolls.mjs";

/** Marks a tag in the strip as one of an ability's throws (carries its key). */
export const THROW_TAG_CLASS = "acks-extras-abilities-throw";
/** Marks the throw a bare roll reaches, so the strip shows which one that is. */
export const THROW_DEFAULT_CLASS = "acks-extras-abilities-throw-default";

const CYCLE_CLASS = "acks-extras-abilities-default-cycle";
const FAV_CLASS = "acks-extras-abilities-fav-throw";
const BOUND = "acksAbilitiesRolls";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** How a throw's target reads on a control: "15+", "3-", "12", or "—". */
function targetText(roll, actor, item) {
  const target = targetOf(roll, actor, item);
  if (target == null) return "—";
  const type = roll.rollType || "above";
  return `${target}${type === "below" ? "-" : type === "result" ? "" : "+"}`;
}

/** A throw's name for a tooltip: its label and target, or just its target. */
const throwLabel = (roll, actor, item) => [roll.label, targetText(roll, actor, item)].filter(Boolean).join(" ");

/** The ability a row stands for, or null when the row is not one. */
function abilityOf(element, actor) {
  const id = element?.closest("[data-item-id]")?.dataset.itemId;
  const item = id ? actor?.items?.get(id) : null;
  return item?.type === ABILITY_TYPE ? item : null;
}

/* -------------------------------------------- */
/*  The delegated click                          */
/* -------------------------------------------- */

/**
 * One listener per sheet, bound once, covering all three surfaces.
 *
 * Delegation is not a tidiness choice here: the tag strip is written into the
 * row by core's own summary toggle after this code has finished, so there is
 * nothing to bind to at render time.
 */
function bindActions(root, actor) {
  if (root.dataset[BOUND]) return;
  root.dataset[BOUND] = "1";

  root.addEventListener("click", async (event) => {
    const tag = event.target.closest(`.${THROW_TAG_CLASS}[data-acks-throw]`);
    const fav = event.target.closest(`.${FAV_CLASS}[data-acks-throw]`);
    const cycle = event.target.closest(`.${CYCLE_CLASS}`);
    const hit = tag ?? fav ?? cycle;
    if (!hit) return;

    const item = abilityOf(hit, actor);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();

    try {
      if (cycle) {
        const next = nextKeyAfter(item, defaultKeyOf(item));
        if (next) await setDefaultKey(item, next);
        return;
      }
      await rollAbility(item, hit.dataset.acksThrow);
    } catch (err) {
      console.error(`${MODULE_ID} | rolling an ability throw failed`, err);
      ui.notifications?.error(game.i18n.localize("ACKS-ABILITIES.roll.failed"));
    }
  });
}

/* -------------------------------------------- */
/*  The cycle control                            */
/* -------------------------------------------- */

/**
 * Name the default throw on every row that has a choice to make.
 *
 * Only rows with two or more throws get one — on a single-throw proficiency
 * there is nothing to cycle and the control would be a button that does
 * nothing, which is the defect this release is removing elsewhere.
 */
function injectCycles(root, actor) {
  for (const controls of root.querySelectorAll(".item__controls")) {
    const item = abilityOf(controls, actor);
    if (!item) continue;
    const rolls = rollsOf(item);
    if (rolls.length < 2) continue;

    const current = defaultKeyOf(item);
    const index = rolls.findIndex((r, i) => keyOf(r, i) === current);
    const roll = rolls[index] ?? rolls[0];

    const a = document.createElement("a");
    a.className = `item-control ${CYCLE_CLASS}`;
    a.dataset.tooltip = game.i18n.format("ACKS-ABILITIES.roll.defaultIs", {
      label: throwLabel(roll, actor, item),
    });
    a.innerHTML = `<i class="fa-solid fa-rotate"></i>`;
    controls.prepend(a);
  }
}

/* -------------------------------------------- */
/*  Favorites                                    */
/* -------------------------------------------- */

/**
 * One control per throw on a favourited multi-throw ability.
 *
 * Core's single d20 is removed only once the replacements are built, so a
 * failure here leaves the row rolling its default rather than rolling nothing.
 */
function injectFavorites(root, actor) {
  for (const dice of root.querySelectorAll(".favorites .item__dice")) {
    const item = abilityOf(dice, actor);
    if (!item) continue;
    const rolls = rollsOf(item);
    if (rolls.length < 2) continue;

    const made = rolls.map((roll, i) => {
      const a = document.createElement("a");
      a.className = FAV_CLASS;
      a.dataset.acksThrow = keyOf(roll, i);
      a.dataset.tooltip = `${esc(item.name)} — ${esc(throwLabel(roll, actor, item))}`;
      a.innerHTML = `<i class="fa-solid fa-dice-d20"></i><span>${esc(targetText(roll, actor, item))}</span>`;
      return a;
    });
    if (!made.length) continue;

    dice.querySelector('a[data-action="itemUse"]')?.remove();
    for (const a of made) dice.appendChild(a);
  }
}

/* -------------------------------------------- */
/*  Install                                      */
/* -------------------------------------------- */

const clear = (root) => {
  for (const el of root.querySelectorAll(`.${CYCLE_CLASS}, .${FAV_CLASS}`)) el.remove();
};

/** Register the sheet injection (called once from abilities/module.mjs). */
export function registerSheetRolls() {
  Hooks.on("renderActorSheetV2", (app, element) => {
    try {
      if (game.system?.id !== "acks") return;
      const actor = app.actor ?? app.document;
      if (!(actor instanceof Actor) || !actor.isOwner) return;
      const root = element instanceof HTMLElement ? element : element?.[0];
      if (!root) return;

      clear(root);
      bindActions(root, actor);
      injectCycles(root, actor);
      injectFavorites(root, actor);
    } catch (err) {
      console.error(`${MODULE_ID} | ability roll controls failed to inject`, err);
    }
  });
}
