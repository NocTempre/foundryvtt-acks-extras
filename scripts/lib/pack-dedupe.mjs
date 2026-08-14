/* global game, Hooks, ui */
/**
 * Hiding the system compendiums a world has already replaced.
 *
 * The importer materializes the same content out of the GM's own books, in
 * more of it and in this family's shapes — so a world that has imported ends
 * up with two of everything in the sidebar, and the pair that is NOT the one
 * the module reads is the one people open by accident.
 *
 * THE HIDE IS COVERAGE-GATED, never a flat list. A system pack disappears only
 * once the world actually holds imported documents that cover it: enabling the
 * setting in a world that has imported nothing changes nothing at all, and a
 * pack whose replacement is later deleted comes back. Nothing is destroyed and
 * nothing is unlinked — the packs stay loadable, their uuids keep resolving,
 * and turning the setting off restores the rows.
 *
 * WHERE A SYSTEM PACK IS NOT SUPERSEDED, THAT IS AN IMPORTER GAP, not a reason
 * to hide it: those packs are absent from the map below and named in
 * acks-importer's ROADMAP so the gap is worked rather than papered over.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";

export const SETTING_HIDE_SUPERSEDED = "hideSupersededPacks";

const IMPORTER_ID = "acks-importer";

/** Does this document come from an import? Both stamps count — the cookbook's
 * own id flag, and the extras model the importer writes alongside it. */
const isImported = (doc) =>
  !!(doc?.flags?.[IMPORTER_ID]?.cookbook || doc?.flags?.[MODULE_ID]?.extras?.cookbookId);

/**
 * System pack → what must exist in the world before it is considered replaced.
 * Each probe counts imported world documents; `min` is a floor low enough that
 * a partial import still counts (a GM who imported one book has replaced the
 * pack for their purposes) but high enough that a stray item does not.
 */
const SUPERSEDED = Object.freeze({
  "acks.acks-all-equipment": { probe: "item", types: ["weapon", "armor"], min: 20 },
  "acks.acks-adventuring-equipment": { probe: "item", types: ["item"], min: 20 },
  "acks.acks-clothing": { probe: "item", types: ["item"], min: 20 },
  "acks.acks-proficiencies": { probe: "item", types: ["ability"], min: 20 },
  "acks.acks-class-abilities": { probe: "item", types: ["ability"], min: 20 },
  "acks.acks-monster-abilities": { probe: "item", types: ["ability"], min: 20 },
  "acks.acks-monsters": { probe: "actor", types: ["monster"], min: 10 },
  "acks.acks-treasure": { probe: "table", min: 5 },
});

/** How many imported documents of a kind the world holds. */
function importedCount(spec) {
  if (spec.probe === "actor") {
    return game.actors.filter((a) => spec.types.includes(a.type) && isImported(a)).length;
  }
  if (spec.probe === "table") {
    return game.tables.filter((t) => isImported(t)).length;
  }
  let n = 0;
  for (const item of game.items) if (spec.types.includes(item.type) && isImported(item)) n++;
  // Items imported onto actors count too: a world that imported equipment
  // straight onto its party has replaced the shop list just the same.
  for (const actor of game.actors) {
    for (const item of actor.items) if (spec.types.includes(item.type) && isImported(item)) n++;
  }
  return n;
}

/** The system pack ids this world has genuinely replaced, right now. */
export function supersededPackIds() {
  if (!game.settings.get(MODULE_ID, SETTING_HIDE_SUPERSEDED)) return new Set();
  const hidden = new Set();
  for (const [id, spec] of Object.entries(SUPERSEDED)) {
    if (!game.packs.get(id)) continue;
    if (importedCount(spec) >= spec.min) hidden.add(id);
  }
  return hidden;
}

const STYLE_ID = `${MODULE_ID}-pack-dedupe`;

/**
 * Publish the hide as a STYLESHEET rather than as inline styles on the rows.
 * The directory rebuilds its list during render — an element hidden in the
 * render hook is replaced by a fresh visible one a moment later (measured: the
 * row came back with `display: flex`). A rule keyed on `data-pack` applies to
 * whatever rows exist, whenever they exist, and needs no re-application.
 */
function publishHideRule() {
  const ids = [...supersededPackIds()];
  let style = document.getElementById(STYLE_ID);
  if (!ids.length) {
    style?.remove();
    return 0;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `${ids.map((id) => `[data-pack="${id}"]`).join(",\n")} { display: none !important; }`;
  return ids.length;
}

/**
 * Fold the replaced rows out of the compendium sidebar. A DISPLAY rule: the
 * packs remain loaded and reachable by uuid, by the importer, and by any macro
 * that names them.
 */
export function installPackDedupe() {
  game.settings.register(MODULE_ID, SETTING_HIDE_SUPERSEDED, {
    name: `${LANG_PREFIX}.settings.hideSuperseded.name`,
    hint: `${LANG_PREFIX}.settings.hideSuperseded.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => publishHideRule(),
  });

  // Coverage changes as documents arrive and leave, so the rule is refreshed
  // on the events that can change it — cheaply, and never during a render.
  Hooks.once("ready", () => publishHideRule());
  for (const hook of ["createActor", "deleteActor", "createItem", "deleteItem", "createRollTable", "deleteRollTable"]) {
    Hooks.on(hook, () => publishHideRule());
  }
}

/** Recompute and republish the rule. Exposed for a world that imports through
 *  its own automation and wants the sidebar to catch up at once. */
export const refreshPackDedupe = () => publishHideRule();
