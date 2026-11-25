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
import { factionLineOf, joinFaction, leaveFaction, makeFaction, orgChart, worldFactions } from "./org.mjs";
import { rankOf } from "./org-chart-ui-logic.mjs";
import { underOptions } from "./org-tree-logic.mjs";
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

/**
 * The Under choices for a faction: its rows as this seat reads them (a hidden row is a Judge's alone),
 * in the chart's reading order, each named as its card names it, with "At the top" first.
 * @param {Actor|undefined} faction
 */
function underChoicesOf(faction) {
  return underOptions(faction ? orgChart(faction).rows.map((r) => ({ ...r, rank: rankOf(r) })) : [], loc("faction.underTop"));
}

/**
 * Bind the Faction select to the Under select: a change refills Under with the new faction's rows,
 * "At the top" chosen. Controls are told by what they are, never by `instanceof`, since the dialog may
 * be built by a detached window's document.
 */
function bindUnder(dialog, factions) {
  const form = dialog?.element?.querySelector?.("form");
  const faction = form?.elements?.namedItem?.("faction");
  const under = form?.elements?.namedItem?.("under");
  if (!faction || !under) return;
  faction.addEventListener("change", () => {
    const doc = under.ownerDocument;
    under.replaceChildren(
      ...underChoicesOf(factions.find((f) => f.uuid === faction.value)).map((o) => {
        const option = doc.createElement("option");
        option.value = o.key;
        option.textContent = o.text;
        return option;
      }),
    );
  });
}

/**
 * What the picker resolved to, as a join: `{faction, under}` only where the Join button returned a
 * chosen faction, else null. Cancel returns `{cancelled: true}` and the close × resolves null; a
 * button whose callback returns nothing would resolve to its action string, so a choice is tested
 * for its shape, never for truthiness.
 * @param {unknown} result what `DialogV2.wait` resolved to
 * @returns {{faction: string, under: string}|null}
 */
export function joinChoiceOf(result) {
  if (!result || typeof result !== "object" || typeof result.faction !== "string" || !result.faction) return null;
  return { faction: result.faction, under: typeof result.under === "string" ? result.under : "" };
}

/** The faction picker's choice, `{faction, under}` (`under` blank for the top), or null where it was cancelled or closed. */
async function askFaction(factions, preselected, group) {
  const first = factions.find((f) => f.uuid === preselected) ?? factions[0];
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/group-faction.hbs`, {
    factions: factions.map((f) => ({ uuid: f.uuid, name: f.name, selected: f.uuid === preselected })),
    under: underChoicesOf(first),
    underTip: loc("faction.underTip", { group: group?.name ?? "" }),
  });
  const { DialogV2 } = foundry.applications.api;
  const picked = await DialogV2.wait({
    classes: FACTION_DIALOG_CLASSES,
    window: { title: loc("faction.pickTitle") },
    content,
    buttons: [
      {
        action: "join",
        label: loc("faction.pickPress"),
        default: true,
        callback: (_event, button) => {
          const uuid = button.form.elements.namedItem("faction")?.value || "";
          return uuid ? { faction: uuid, under: button.form.elements.namedItem("under")?.value || "" } : { cancelled: true };
        },
      },
      { action: "cancel", label: loc("faction.pickCancel"), callback: () => ({ cancelled: true }) },
    ],
    render: (_event, dialog) => bindUnder(dialog, factions),
    rejectClose: false,
  });
  return joinChoiceOf(picked);
}

/**
 * Join a faction the Judge picks from the world's, at its top or under a row of its chart the
 * dialog's Under select names. A world with none says so and
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
  const picked = await askFaction(factions, factionLineOf(group).faction?.uuid ?? "", group);
  const faction = picked ? factions.find((f) => f.uuid === picked.faction) : null;
  if (!faction) return null;
  const result = await joinFaction(group, faction, picked.under);
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
