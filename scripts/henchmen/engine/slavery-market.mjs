/**
 * Slave-market chat card — the GM-facing surface for the optional RAW
 * slavery rules (JJ 409-410). Posts nothing unless the `enableSlavery`
 * world setting is on AND the slavery tables have been imported. Whispered
 * to GMs: what the market offers is the Judge's to reveal.
 */
import { MODULE_ID } from "../constants.mjs";
import { commonSlave, hirelingDisplacement, slaveUpkeep } from "../rules/slavery.mjs";
import * as adapter from "../acks-adapter.mjs";

export function slaveryEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, "enableSlavery");
  } catch {
    return false;
  }
}

/** Post the location's slave-market prices to GMs. Returns false if gated. */
export async function postSlaveMarketCard(location) {
  if (!slaveryEnabled()) return false;
  const types = ["laborer", "household", "pleasure", "professional"].map((t) => ({ id: t, row: commonSlave(t) }));
  if (!types.some((t) => t.row)) return false; // tables not imported yet

  const i18n = (k, d) => game.i18n.format(`ACKS-HENCHMEN.slavery.${k}`, d ?? {});
  const gp = (v) => (v == null ? "—" : `${v} gp`);
  const lines = [];
  for (const { id, row } of types) {
    if (!row) continue;
    const label = i18n(`type.${id}`);
    if (id === "pleasure") {
      lines.push(i18n("linePleasure", { label, min: gp(row.costMin), max: gp(row.costMax), upkeep: gp(row.upkeep), morale: row.baseMorale ?? "—" }));
    } else if (id === "professional") {
      lines.push(i18n("lineProfessional", { label, mult: row.wageMult ?? "—", less: row.wageLess ?? "—", upkeep: gp(row.upkeep), loyalty: row.baseLoyalty ?? "—" }));
    } else {
      lines.push(i18n("line", { label, cost: gp(row.cost), upkeep: gp(row.upkeep), loyalty: row.baseLoyalty ?? "—" }));
    }
  }
  const disp = hirelingDisplacement();
  if (disp) lines.push(i18n("displacement", { min: disp[0], max: disp[1] }));
  const soldierUpkeep = slaveUpkeep();
  if (soldierUpkeep != null) lines.push(i18n("soldierUpkeep", { upkeep: gp(soldierUpkeep) }));

  await ChatMessage.create({
    content: `<div class="acks-henchmen slave-market"><h3>${i18n("cardTitle", { name: location?.name ?? "" })}</h3><ul>${lines
      .map((l) => `<li>${l}</li>`)
      .join("")}</ul><p class="notes">${i18n("cardNote")}</p></div>`,
    whisper: adapter.gmIds(),
    speaker: ChatMessage.getSpeaker({ actor: location }),
  });
  return true;
}
