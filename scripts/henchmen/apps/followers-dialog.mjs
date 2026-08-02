/* global game, ui, foundry, Roll, ChatMessage */
/**
 * Follower generation (RR 334-337) — roll & record. At 9th level with a
 * class-appropriate stronghold, roll the class's follower grants: troops
 * (with a per-platoon d100 type roll), companions (1d6 level each), and
 * apprentices. Results post as a GM-visible chat card; hiring the
 * companions/apprentices as no-slot henchmen is a follow-up the Judge does
 * with the normal tools (the card records everything needed).
 *
 * The stronghold prerequisite resolves through the "has X" chain
 * (scripts/facts.mjs): structures-module API → flag → inventory marker item
 * ("Stronghold: Castle", cost = value) → GM confirm.
 */
import { getTable, hasDoc } from "../rules/tables.mjs";
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
  const row = rows.find((r) => die >= r.min && die <= r.max);
  return { die, type: row?.type ?? "?" };
}

export async function openFollowersDialog(actor) {
  if (!hasDoc("followers")) {
    ui.notifications.warn("acks-henchmen: the followers tables are not imported yet (RR 334-337) - follower generation is disabled until then.");
    return;
  }

  const level = adapter.getLevel(actor);
  if (level < 9) {
    ui.notifications.warn(game.i18n.format("ACKS-HENCHMEN.followers.levelGate", { name: actor.name, level }));
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

  // Roll every grant.
  const companionLevels = getTable("followers", "companionLevel");
  const results = [];
  for (const grant of row.grants) {
    const count = await roll(grant.formula);
    if (grant.kind === "troops") {
      const platoons = Math.max(1, Math.ceil(count / 30));
      const types = [];
      for (let i = 0; i < platoons; i++) {
        const t = row.troopTable ? await rollTroopType(row.troopTable) : null;
        types.push(t ? `${t.type} (d100: ${t.die})` : game.i18n.localize("ACKS-HENCHMEN.followers.troopsGeneric"));
      }
      results.push({
        kind: grant.kind,
        text: game.i18n.format("ACKS-HENCHMEN.followers.troopsResult", {
          count,
          level: grant.level ?? 0,
          types: types.join("; "),
        }),
      });
    } else if (grant.kind === "companions") {
      const levels = [];
      for (let i = 0; i < count; i++) {
        if (grant.levelDie) {
          const die = await roll(companionLevels.formula);
          const lr = companionLevels.rows.find((r) => die >= r.min && die <= r.max);
          levels.push(lr?.level ?? 1);
        } else {
          levels.push(grant.level ?? 1);
        }
      }
      results.push({
        kind: grant.kind,
        text: game.i18n.format("ACKS-HENCHMEN.followers.companionsResult", {
          count,
          class: grant.class ?? row.class,
          levels: levels.join(", "),
        }),
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
