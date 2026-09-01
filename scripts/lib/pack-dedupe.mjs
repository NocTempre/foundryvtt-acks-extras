/* global game, Hooks, ui, foundry, Folder */
/**
 * Gathering the family's compendiums into one folder, and hiding the ones a
 * world has already replaced.
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
 * to hide it: those packs are absent from the map below and named in the
 * importer's ROADMAP so the gap is worked rather than papered over.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";

export const SETTING_HIDE_SUPERSEDED = "hideSupersededPacks";

/** Does this document come from an import? Both stamps count — the cookbook's
 * own id flag, and the extras model the importer writes alongside it. */
const isImported = (doc) =>
  !!(doc?.flags?.[MODULE_ID]?.cookbook || doc?.flags?.[MODULE_ID]?.extras?.cookbookId);

/**
 * System pack → what must exist in the world before it is considered replaced.
 * Each probe counts imported world documents; `min` is a floor low enough that
 * a partial import still counts (a GM who imported one book has replaced the
 * pack for their purposes) but high enough that a stray item does not.
 *
 * A FLOOR IS NOT A COVERAGE PROOF, and only `acks-languages` currently has
 * one: a 2026-08-15 audit imported everything the cookbook can materialize and
 * compared it against each pack document by document, and languages was the
 * single pack that came back complete — all 58, with neither side carrying an
 * Active Effect. Every other entry here is replaced only in the sense that its
 * subject matter is imported; each still has named documents the import does
 * not produce, recorded as gaps in the importer's ROADMAP. `idPrefix` exists
 * so a probe can count the pack's OWN content rather than a type-wide floor,
 * which is what a coverage proof needs.
 */
const SUPERSEDED = Object.freeze({
  "acks.acks-all-equipment": { probe: "item", types: ["weapon", "armor"], min: 20 },
  "acks.acks-adventuring-equipment": { probe: "item", types: ["item"], min: 20 },
  "acks.acks-clothing": { probe: "item", types: ["item"], min: 20 },
  "acks.acks-proficiencies": { probe: "item", types: ["ability"], min: 20 },
  "acks.acks-class-abilities": { probe: "item", types: ["ability"], min: 20 },
  "acks.acks-monster-abilities": { probe: "item", types: ["ability"], min: 20 },
  "acks.acks-monsters": { probe: "actor", types: ["monster"], min: 10 },
  // The taxonomy is READ from the seat's own book (since importer 2.9.x), so
  // the probe counts the languages themselves rather than abilities at large
  // — a world with 100 imported proficiencies and no book has replaced
  // nothing. It counts the SYSTEM's `language` type: an import that lands
  // anything else has not replaced this pack, whatever it named the documents.
  "acks.acks-languages": { probe: "item", types: ["language"], idPrefix: "def.language.", min: 40 },
});

/** The cookbook id an import stamped on a document, or "". Both stamps count
 *  — the cookbook's own id flag, and the extras model the importer writes
 *  alongside it. */
const cookbookIdOf = (doc) =>
  String(doc?.flags?.[MODULE_ID]?.cookbook?.id ?? doc?.flags?.[MODULE_ID]?.extras?.cookbookId ?? "");

/** Does this document count towards `spec` — right type, and right content? */
const counts = (doc, spec) =>
  spec.types.includes(doc.type) && isImported(doc) && (!spec.idPrefix || cookbookIdOf(doc).startsWith(spec.idPrefix));

/** How many imported documents of a kind the world holds. */
function importedCount(spec) {
  if (spec.probe === "actor") {
    return game.actors.filter((a) => counts(a, spec)).length;
  }
  if (spec.probe === "table") {
    return game.tables.filter((t) => isImported(t)).length;
  }
  let n = 0;
  for (const item of game.items) if (counts(item, spec)) n++;
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

/* -------------------------------------------- */
/*  Gathering the family's packs into one folder */
/* -------------------------------------------- */

/** The one folder every ACKS compendium belongs under. */
const FAMILY_FOLDER = "ACKS II";
const SYSTEM_ID = "acks";

/**
 * The modules place their OWN packs through `packFolders` in their manifests,
 * matched by folder name so both land in the same folder. The SYSTEM's packs
 * cannot be placed that way — a manifest folder only accepts packs belonging
 * to the package that declares it — so they are filed here instead, by writing
 * the same assignment Foundry's own initializer writes.
 */
function familyFolder() {
  return game.folders?.find((f) => f.type === "Compendium" && f.name === FAMILY_FOLDER) ?? null;
}

/**
 * File the system's ACKS compendiums beside the modules' own.
 *
 * A pack the GM has deliberately placed is left alone. A pack pointing at a
 * folder that NO LONGER EXISTS is repaired: Foundry only assigns a folder to a
 * pack whose config does not already name one, so a stale id — left behind
 * when a folder is deleted — strands that pack at the sidebar root forever and
 * silently defeats every `packFolders` declaration, the system's included.
 *
 * @returns {Promise<number>} how many packs were filed.
 */
export async function organizeFamilyPacks() {
  if (!game.user?.isGM) return 0;
  let folder = familyFolder();
  if (!folder) {
    folder = await Folder.create({ name: FAMILY_FOLDER, type: "Compendium", color: "#822638" }).catch(() => null);
    if (!folder) return 0;
  }
  const config = foundry.utils.deepClone(game.settings.get("core", "compendiumConfiguration") ?? {});
  let filed = 0;
  for (const pack of game.packs) {
    if (pack.metadata?.packageName !== SYSTEM_ID) continue;
    const entry = config[pack.collection] ?? {};
    const current = entry.folder ?? null;
    if (current === folder.id) continue;
    // Someone's real choice, honoured. Only an empty or dangling slot is ours.
    if (current && game.folders.get(current)) continue;
    config[pack.collection] = { ...entry, folder: folder.id };
    filed++;
  }
  if (filed) {
    await game.settings.set("core", "compendiumConfiguration", config);
    ui.compendium?.render();
  }
  return filed;
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
    // Default ON, which is safe precisely because the hide is coverage-gated:
    // a world that has imported nothing has replaced nothing, so every row
    // stays exactly where it was. Only a world holding the imported documents
    // sees its duplicate rows fold away.
    type: Boolean,
    default: true,
    onChange: () => publishHideRule(),
  });

  // Coverage changes as documents arrive and leave, so the rule is refreshed
  // on the events that can change it — cheaply, and never during a render.
  Hooks.once("ready", () => {
    publishHideRule();
    organizeFamilyPacks().catch((err) => console.error(`${MODULE_ID} | filing the ACKS compendiums failed`, err));
  });
  for (const hook of ["createActor", "deleteActor", "createItem", "deleteItem", "createRollTable", "deleteRollTable"]) {
    Hooks.on(hook, () => publishHideRule());
  }
}

/** Recompute and republish the rule. Exposed for a world that imports through
 *  its own automation and wants the sidebar to catch up at once. */
export const refreshPackDedupe = () => publishHideRule();
