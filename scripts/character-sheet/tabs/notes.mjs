/* global game, foundry */
/**
 * The Notes tab's data: the character's notes as prose, and the
 * relationships the influence feature records as attitude items.
 */
import { MODULE_ID } from "../constants.mjs";
import { INFLUENCE_ATTITUDE_LABELS } from "../../influence/constants.mjs";

const ATTITUDE_TYPE = `${MODULE_ID}.attitude`;

/** Build the tab's data (async: the notes are enriched). */
export async function buildNotesTab(actor, { editing = false } = {}) {
  const source = String(actor.system?.details?.notes ?? "");
  const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(source, { relativeTo: actor, secrets: actor.isOwner });
  const relationships = actor.items
    .filter((i) => i.type === ATTITUDE_TYPE)
    .map((item) => ({
      id: item.id,
      name: item.system?.targetName || item.name,
      attitude: game.i18n.localize(INFLUENCE_ATTITUDE_LABELS.diplomacy?.[item.system?.attitude] ?? ""),
      img: item.img,
    }));
  return { notesHTML: html, notesSource: source, editing, relationships, editable: actor.isOwner };
}
