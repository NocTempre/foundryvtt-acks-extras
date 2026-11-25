/* global game, foundry, ui */
/**
 * The faction line of a group's sheet (docs/lib/ORGANISATION.md, "A group's own
 * gestures"): the view the line draws and the four presses behind it, join a
 * faction, make a faction card of its own, leave it, and open it. The writes are
 * `org.mjs`'s; this file picks the faction, says what happened, and refuses
 * nothing of its own. A press is a control, not a gate: the only refusals are
 * `org.mjs`'s, a seat that cannot write a document among them, and each is said
 * in a notification and never thrown.
 *
 * Kept out of the sheet class so it imports under Node and is tested offline
 * (tools/test-group-faction.mjs); the sheet only binds the four actions.
 */
import { MODULE_ID, ORG_LANG_PREFIX } from "./constants.mjs";
import { factionLineOf, joinFaction, leaveFaction, makeFaction, worldFactions } from "./org.mjs";
import { makeLoc } from "./util.mjs";

const loc = makeLoc(ORG_LANG_PREFIX);

/** The classes the faction picker carries: the scroll contract and the group dialogs' own. */
export const FACTION_DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-lib-group-dialog"];

/**
 * The faction line as the sheet's template reads it, or null where the sheet shows
 * none (a group listed in another group's chart, or inside a group that hosts none).
 * @param {Actor} group
 * @param {boolean} editable whether this seat may edit the group, which is what shows the presses
 * @returns {{joined: boolean, name: string, rowLabel: string, canEdit: boolean}|null}
 */
export function factionView(group, editable) {
  const line = factionLineOf(group);
  if (line.state === "hidden") return null;
  const joined = line.state === "joined";
  return { joined, name: joined ? (line.faction?.name ?? "") : "", rowLabel: joined ? (line.row?.label ?? "") : "", canEdit: !!editable };
}

/**
 * Say why nothing moved, in the reason's own words where the lang file has them.
 * `fallbackName` names the document where the refusal names none (a leave's
 * `notOwner` is the faction's, refused before any plan is made). `verb` is the
 * press, `join` or `leave`, since a write that stopped partway reads differently
 * for each.
 */
function refusal(result, { fallbackName = "", verb = "join" } = {}) {
  const reason = result.reason === "failed" ? `failed.${verb}` : result.reason;
  const key = `${ORG_LANG_PREFIX}.refused.${reason}`;
  const message = game.i18n.has(key) ? game.i18n.format(key, { name: result.name || fallbackName }) : loc("refused.other");
  ui.notifications.warn(message);
  return result;
}

/** The faction picker's one choice, or null where the dialog closed. */
async function askFaction(factions, preselected) {
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/group-faction.hbs`, {
    factions: factions.map((f) => ({ uuid: f.uuid, name: f.name, selected: f.uuid === preselected })),
  });
  const { DialogV2 } = foundry.applications.api;
  const picked = await DialogV2.prompt({
    classes: FACTION_DIALOG_CLASSES,
    window: { title: loc("faction.pickTitle") },
    content,
    ok: { label: loc("faction.pickPress"), callback: (_event, button) => button.form.elements.namedItem("faction")?.value || null },
    rejectClose: false,
  });
  return picked || null;
}

/**
 * Join a faction the Judge picks from the world's. A world with none says so and
 * opens nothing; a closed dialog writes nothing. A group a stopped join already
 * wrote to offers that faction first, so a second press completes it.
 * @param {Actor} group
 * @returns {Promise<{ok: boolean, reason?: string}|null>} null where nothing was asked or the dialog closed
 */
export async function pressJoin(group) {
  const factions = worldFactions();
  if (!factions.length) {
    ui.notifications.warn(loc("faction.noneExist"));
    return null;
  }
  const picked = await askFaction(factions, factionLineOf(group).faction?.uuid ?? "");
  const faction = picked ? factions.find((f) => f.uuid === picked) : null;
  if (!faction) return null;
  const result = await joinFaction(group, faction);
  if (!result.ok) return refusal(result);
  ui.notifications.info(loc("faction.joined", { name: group.name, faction: faction.name }));
  return result;
}

/**
 * Make a faction card from the group and join it. The card is named from the group
 * and its leader is the group's officer where one is set.
 * @param {Actor} group
 * @returns {Promise<{ok: boolean, reason?: string, faction?: Actor}>}
 */
export async function pressMakeOwn(group) {
  const result = await makeFaction(group);
  if (!result.ok) return refusal(result);
  ui.notifications.info(loc("faction.made", { name: group.name, faction: result.faction.name }));
  return result;
}

/**
 * Take the group out of the faction that lists it.
 * @param {Actor} group
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function pressLeave(group) {
  const faction = factionLineOf(group).faction;
  const result = await leaveFaction(group);
  if (!result.ok) return refusal(result, { fallbackName: faction?.name ?? "", verb: "leave" });
  ui.notifications.info(loc("faction.left", { name: group.name, faction: faction?.name ?? "" }));
  return result;
}

/**
 * Open the faction card that lists the group.
 * @param {Actor} group
 * @returns {boolean} whether a card was there to open
 */
export function pressOpen(group) {
  const faction = factionLineOf(group).faction;
  if (!faction) return false;
  faction.sheet?.render(true);
  return true;
}
