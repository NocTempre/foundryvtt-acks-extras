/* global game, ui, foundry, Roll, ChatMessage */
/**
 * Follower generation (RR 334-337) — roll & record. Once the character reaches
 * the class level the followers rules name (the imported `followers`
 * `arrivalLevel`) and holds a class-appropriate stronghold, roll the class's
 * follower grants: troops (with a type roll per platoon), companions (a level
 * roll each), and apprentices. Results post as a GM-visible chat card; hiring
 * the companions/apprentices as no-slot henchmen is a follow-up the Judge does
 * with the normal tools (the card records everything needed). The roll does
 * nothing until the arrival level and the tables it reads are imported, a
 * level a table did not print is left off the card, and a troop grant lists no
 * platoon types while the platoon size is unread.
 *
 * The stronghold prerequisite resolves through the "has X" chain
 * (scripts/facts.mjs): structures-module API → flag → inventory marker item
 * ("Stronghold: Castle", cost = value) → GM confirm.
 */
import { bracketRow, getTable } from "../rules/tables.mjs";
import { arrivalLevel, arrivalLevelCite, followerTablesImported, knownLevel, platoonCount, platoonSizeCite } from "../rules/followers.mjs";
import { getStronghold } from "../facts.mjs";
import * as adapter from "../acks-adapter.mjs";
import { gmIds } from "../acks-adapter.mjs";

async function roll(formula) {
  // Formulas in followers.json use × for multiplication and (NdM+K) groups.
  const cleaned = String(formula).replace(/×/g, "*");
  return (await new Roll(cleaned).evaluate()).total;
}

/** Roll one platoon-type row on a class's d100 troop table. */
async function rollTroopType(tableId) {
  const tables = getTable("followers", "troopTypeTables").tables;
  const rows = tables[tableId];
  if (!rows) return null;
  const die = await roll("1d100");
  const row = bracketRow(rows, die);
  return { die, type: row?.type ?? "?" };
}

/** Rolls the follower grants for `actor` and posts the results as a GM-visible chat card; does nothing where the arrival level or the tables the roll reads are not imported. */
export async function openFollowersDialog(actor) {
  const arrival = arrivalLevel();
  if (arrival == null || !followerTablesImported()) return;

  const level = adapter.getLevel(actor);
  if (level < arrival) {
    const cite = arrivalLevelCite();
    ui.notifications.warn(
      game.i18n.format("ACKS-HENCHMEN.followers.levelGate", {
        name: actor.name,
        level,
        arrival,
        cite: cite ? ` (${cite})` : "",
      })
    );
    return;
  }

  const rows = getTable("followers", "followersByClass").rows;
  const className = String(actor.system?.details?.class ?? "").toLowerCase();
  const autoRow = rows.find((r) => className.includes(r.class)) ?? null;

  const stronghold = getStronghold(actor);
  const options = rows
    .map(
      (r) =>
        `<option value="${r.class}" ${autoRow?.class === r.class ? "selected" : ""}>${r.class} — ${game.i18n.format(
          "ACKS-HENCHMEN.followers.strongholdReq",
          { stronghold: r.stronghold, value: r.value }
        )}</option>`
    )
    .join("");
  const strongholdLine = stronghold
    ? game.i18n.format("ACKS-HENCHMEN.followers.strongholdFound", {
        name: stronghold.name,
        value: stronghold.value ?? "?",
      })
    : game.i18n.localize("ACKS-HENCHMEN.followers.strongholdMissing");

  const classKey = await foundry.applications.api.DialogV2.prompt({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: game.i18n.format("ACKS-HENCHMEN.followers.title", { name: actor.name }) },
    content: `<p>${strongholdLine}</p><select name="classKey">${options}</select>`,
    ok: { callback: (_e, button) => button.form.elements.classKey.value },
  }).catch(() => null);
  if (!classKey) return;
  const row = rows.find((r) => r.class === classKey);
  if (!row) return;

  if (!stronghold && !game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.followers.strongholdMissing"));
  }

  const companionLevels = getTable("followers", "companionLevel");
  const results = [];
  for (const grant of row.grants) {
    const count = await roll(grant.formula);
    if (grant.kind === "troops") {
      // One type roll per platoon or fraction of one; with the platoon size
      // unread there is no count of platoons, so no type is rolled.
      const platoons = platoonCount(count) ?? 0;
      const platoonCite = platoonSizeCite() ? ` (${platoonSizeCite()})` : "";
      const types = [];
      for (let i = 0; i < platoons; i++) {
        const t = row.troopTable ? await rollTroopType(row.troopTable) : null;
        types.push(t ? `${t.type} (d100: ${t.die})` : game.i18n.localize("ACKS-HENCHMEN.followers.troopsGeneric"));
      }
      const troopLevel = knownLevel(grant.level);
      results.push({
        kind: grant.kind,
        text: game.i18n.format(
          troopLevel == null ? "ACKS-HENCHMEN.followers.troopsUnleveled" : "ACKS-HENCHMEN.followers.troopsResult",
          {
            count,
            level: troopLevel,
            types: types.length ? game.i18n.format("ACKS-HENCHMEN.followers.troopsTypes", { list: types.join("; "), cite: platoonCite }) : "",
          }
        ),
      });
    } else if (grant.kind === "companions") {
      // A level the tables did not print is left off, never stood in for.
      const levels = [];
      for (let i = 0; i < count; i++) {
        let printed = null;
        if (!grant.levelDie) printed = knownLevel(grant.level);
        else if (companionLevels.formula) {
          const die = await roll(companionLevels.formula);
          printed = knownLevel(bracketRow(companionLevels.rows ?? [], die)?.level);
        }
        if (printed != null) levels.push(printed);
      }
      results.push({
        kind: grant.kind,
        text: game.i18n.format(
          levels.length ? "ACKS-HENCHMEN.followers.companionsResult" : "ACKS-HENCHMEN.followers.companionsUnleveled",
          { count, class: grant.class ?? row.class, levels: levels.join(", ") }
        ),
      });
    } else {
      results.push({
        kind: grant.kind,
        text: game.i18n.format("ACKS-HENCHMEN.followers.apprenticesResult", { count }),
      });
    }
  }

  const loyaltyTable = getTable("followers", "followerLoyalty");
  const fanatic = loyaltyTable.fanatic.classes.includes(row.class);
  const loyaltyNote = fanatic
    ? game.i18n.localize("ACKS-HENCHMEN.followers.loyaltyFanatic")
    : game.i18n.localize("ACKS-HENCHMEN.followers.loyaltyDefault");

  const lines = results.map((r) => `<li>${r.text}</li>`).join("");
  ChatMessage.create({
    content: `<div class="acks-henchmen-card event-card"><header class="card-header"><h3>${game.i18n.format(
      "ACKS-HENCHMEN.followers.cardTitle",
      { name: actor.name, class: row.class }
    )}</h3></header><div class="card-content"><ul>${lines}</ul><p class="hint">${loyaltyNote}</p><p class="hint">${game.i18n.localize(
      "ACKS-HENCHMEN.followers.slotNote"
    )}</p></div></div>`,
    whisper: gmIds(),
    speaker: ChatMessage.getSpeaker({ actor }),
  });
  ui.notifications.info(game.i18n.localize("ACKS-HENCHMEN.followers.rolled"));
}
