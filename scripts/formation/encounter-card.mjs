/* global game, ChatMessage, foundry, fromUuid */
/**
 * The encounter throw on the table: runs the chain for a journeying
 * formation, resolves a drawn creature against the world and the imported
 * library, and posts ONE Judge-whispered card showing every step's roll —
 * the door-helper idiom, a decomposed throw shown before anything is acted
 * on. Detection states are GUIDANCE for core's own Surprise Matrix, which
 * opens at combat start and owns the matrix, the rolls and the evade
 * permission; reactions belong to the influence feature. This module only
 * asks the questions the chain answers.
 *
 * Triggers: the panel's own button always; walking a travel cadence unit
 * (the imported table's hex, in miles) and ending the day only under the world
 * setting — the cadence half reads the imported `encounterFrequency` table
 * (hunt and search slots throw per slot; a camp day throws its resting cells,
 * a night cell counted in nights gating the throw by its period on a die the
 * card declares).
 *
 * The encounter zones under the party's true position (`journeyZones`) shape
 * every throw here: a zone's target replaces the territory throw, a zone's
 * table is drawn onto the same card in place of the creature step, and a
 * zone's cadence decides which of the triggers above throw at all.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { makeLoc, gmIds } from "../lib/util.mjs";
import { nameKeys } from "../lib/vocab.mjs";
import { libraryActors } from "../lib/library.mjs";
import { readTable, TRAVEL_DOC } from "../vehicles/vehicle-speed.mjs";
import { travelOf, DAY_KINDS } from "./travel.mjs";
import {
  ENCOUNTER_OUTCOMES,
  ENCOUNTER_TERRAINS,
  encounterTerrainFor,
  evasionModifiers,
  evasionTarget,
  flattenTerrainDraw,
  headEquivalents,
  runEncounter,
  visibilityMax,
} from "./encounters.mjs";
import { getMemberActor } from "./formation-model.mjs";
import { mountOf } from "../lib/mount.mjs";
import { drawQuietly } from "../lib/roll-audience.mjs";
import { journeyZones } from "./encounter-zone.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** World setting: hex entries and End Day roll their owed throws. */
export const SETTING_TRAVEL_ENCOUNTERS = "travelEncounters";

/** Whether the world setting has the journey throw its owed encounters. */
export const encountersOn = () => {
  try {
    return !!game.settings.get(MODULE_ID, SETTING_TRAVEL_ENCOUNTERS);
  } catch {
    return false;
  }
};

/**
 * A printed creature name against the world's actors and the imported
 * library, matched through the name-form fold so "Horse, War" finds "War
 * Horse". Returns the actor or null — a miss is a book line, not an error.
 */
export function resolveCreature(name) {
  const wanted = nameKeys(name);
  const hits = (candidates) =>
    candidates.find((a) => {
      for (const k of nameKeys(a?.name ?? "")) if (wanted.has(k)) return true;
      return false;
    });
  return hits(game.actors?.contents ?? []) ?? hits(libraryActors() ?? []) ?? null;
}

/** Deepest indent class a nested line takes. */
const MAX_DEPTH = 3;

/** The localized word for a terrain kind's list: the label its territory outcome carries. */
const kindLabel = (kind) => {
  const outcome = Object.values(ENCOUNTER_OUTCOMES).find((o) => o.terrainKind === kind);
  return outcome ? game.i18n.localize(outcome.label) : "";
};

/**
 * A terrain draw as flat card lines, in resolution order:
 * `{ depth, text, roll, die, name, link, kind }`. `depth` is the nesting
 * depth capped for the CSS class; `kind` is the line's type (roll,
 * discarded, rerolled, follow, lookup, either, creature, exhausted). A node
 * gives its own line, then its sub-table rolls, lookups, share-split and
 * creature one level in; a creature name resolves through
 * `resolveCreature` for a link. A missing table gives no line (the card
 * names it once). Takes an old-shaped draw as a single node.
 */
export function terrainDrawLines(draw) {
  const lines = [];
  const at = (depth, line) => lines.push({ roll: null, die: null, name: null, link: null, ...line, depth: Math.min(depth, MAX_DEPTH) });
  for (const { depth, node } of flattenTerrainDraw(draw)) {
    if (node.exhausted) {
      at(depth, { text: loc("travel.enc.draw.exhausted"), kind: "exhausted" });
      continue;
    }
    if (!node.ok) continue;
    const lead = node.setAside ?? node.via;
    const label = kindLabel(node.kind);
    at(depth, {
      text: lead ? [loc(`travel.enc.draw.${lead}`), label].filter(Boolean).join(": ") : label,
      roll: node.roll,
      die: 12,
      name: node.name,
      kind: node.setAside ?? "roll",
    });
    if (node.setAside) continue;
    for (const f of (node.follow ?? []).filter((x) => x.ok)) {
      at(depth + 1, { text: loc(`travel.enc.sub.${f.table}`), roll: f.roll, die: f.die, name: f.name, kind: "follow" });
    }
    for (const l of (node.lookups ?? []).filter((x) => x.ok)) {
      const value = typeof l.value === "number" && l.value > 0 ? `+${l.value}` : String(l.value);
      at(depth + 1, { text: loc(`travel.enc.lookup.${l.kind}`), name: value, kind: "lookup" });
    }
    if (node.either) {
      at(depth + 1, {
        text: `${loc("travel.enc.draw.either")} ≤${node.either.share}`,
        roll: node.either.roll,
        die: 100,
        name: kindLabel(node.either.kind),
        kind: "either",
      });
    }
    if (node.creature?.name) {
      const actor = resolveCreature(node.creature.name);
      at(depth + 1, {
        text: `${loc("travel.enc.draw.monster")}: ${loc(`travel.enc.rarity.${node.creature.rarity}`)}`,
        roll: node.creature.roll,
        die: 100,
        name: node.creature.name,
        link: actor ? `@UUID[${actor.uuid}]{${node.creature.name}}` : null,
        kind: "creature",
      });
    }
  }
  return lines;
}

/** Every table a step of the chain, or any node of its terrain draw, found unimported. */
function missingTables(chain) {
  const nodes = flattenTerrainDraw(chain.terrainEncounter).map((e) => e.node);
  const steps = [
    chain.creature,
    chain.rarity,
    ...nodes.flatMap((n) => [n, n.creature, ...(n.follow ?? []), ...(n.lookups ?? [])]),
    chain.distance,
  ];
  // A step names its missing table once however many rolls asked for it.
  return [...new Set(steps.filter((step) => step && !step.ok && step.missing).map((step) => step.missing))];
}

/** The party's head count for visibility and evasion: men, mounted double. */
function partyHeads(formation) {
  let men = 0;
  let mounted = 0;
  for (const member of formation.members ?? []) {
    if (member?.blank || !member?.actorId) continue;
    const actor = getMemberActor(member);
    if (!actor) continue;
    men += 1;
    if (mountOf(actor)) {
      men -= 1;
      mounted += 1;
    }
  }
  return { men, mounted };
}

/**
 * Run one throw for a journeying formation and post its card. `night` keys
 * the settled-country column shift (a rest through the dark), the activity is
 * the cadence line the card cites, and `hex` (`{label}`) names the hex the
 * throw was made in. The zones under the party's true position supply the
 * throw's target and table (`journeyZones`); a creature step the chain hands
 * to the zone's table is drawn here, quietly, and shown on the same card.
 */
export async function postEncounterThrow(formation, { activity = "travel", night = false, hex = null } = {}) {
  const t = travelOf(formation);
  const terrain = ENCOUNTER_TERRAINS[t.encounterTerrain] ? t.encounterTerrain : encounterTerrainFor(t.ground);
  const zones = journeyZones(formation);
  const chain = runEncounter({
    territory: t.territory,
    road: t.road !== "none",
    night,
    terrain,
    restingOrKnownRoute: t.day?.kind === "camp" || activity === "rest",
    zone: { target: zones.fields.encounterTarget, table: !!zones.fields.tableUuid },
  });
  const zoneDraw = chain.zoneDraw ? await drawZoneTable(zones) : null;
  await postEncounterCard(formation, chain, { terrain, activity, night, hex, travel: t, zones, zoneDraw });
  return chain;
}

/** Tags out of a result's description, which is HTML; the card shows its text. */
const plainText = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * The composed zone table drawn without a post of its own: `{table, total,
 * rows}`, each row `{text, link}`, or `{missing: true, zone}` naming the
 * region whose table no longer resolves.
 */
async function drawZoneTable(zones) {
  const zone = zones.sources.tableUuid?.region?.name ?? "";
  let table = null;
  try {
    table = (await fromUuid(zones.fields.tableUuid)) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | encounter zone table ${zones.fields.tableUuid} could not be read`, err);
  }
  if (typeof table?.draw !== "function") return { missing: true, zone };
  const drawn = await drawQuietly(table);
  const rows = (drawn?.results ?? []).map((r) => {
    const named = String(r.name ?? r.text ?? "").trim() || plainText(r.description);
    const text = named || loc("travel.enc.zoneRowBlank");
    return { text, link: r.documentUuid ? `@UUID[${r.documentUuid}]{${text}}` : null };
  });
  return { table: table.name ?? "", total: drawn?.roll?.total ?? null, rows };
}

/**
 * The chain as one whispered card. `zones` is `journeyZones`'s answer, named
 * on a line of its own; `zoneDraw` is what the zone's table drew, or names the
 * zone whose table is gone.
 */
export async function postEncounterCard(formation, chain, { terrain, activity, night, hex = null, travel, zones = null, zoneDraw = null } = {}) {
  const outcomeKey = chain.outcome ?? chain.territory?.outcome ?? "none";
  const creature = chain.creature?.ok ? chain.creature : null;
  const actor = creature ? resolveCreature(creature.name) : null;

  const heads = partyHeads(formation);
  const size = headEquivalents(heads);
  const evasion = terrain ? evasionTarget({ terrain, partySize: size }) : { ok: false };
  const mods = terrain ? evasionModifiers({ terrain }) : { parts: [] };
  const visible = visibilityMax({ light: "daylight", heads: size });

  const view = {
    activity: loc(`travel.enc.activity.${activity}`),
    hexLabel: hex?.label || null,
    night,
    terrain: terrain ? game.i18n.localize(ENCOUNTER_TERRAINS[terrain].label) : null,
    noTerrain: !terrain,
    rolls: (chain.territory?.rolls ?? []).map((r) => ({
      column: loc(`travel.enc.column.${r.column}`),
      roll: r.roll,
      outcome: game.i18n.localize(ENCOUNTER_OUTCOMES[r.outcome]?.label ?? ENCOUNTER_OUTCOMES.none.label),
    })),
    missingTerritory: chain.territory && !chain.territory.ok,
    outcome: game.i18n.localize(ENCOUNTER_OUTCOMES[outcomeKey]?.label ?? ENCOUNTER_OUTCOMES.none.label),
    isNone: outcomeKey === "none",
    downgraded: chain.downgraded ? game.i18n.localize(ENCOUNTER_OUTCOMES[chain.downgraded]?.label ?? "") : null,
    rarity: chain.rarity?.ok ? { roll: chain.rarity.roll, label: loc(`travel.enc.rarity.${chain.rarity.rarity}`) } : null,
    creature: creature
      ? { roll: creature.roll, name: creature.name, link: actor ? `@UUID[${actor.uuid}]{${creature.name}}` : null }
      : null,
    terrainLines: terrainDrawLines(chain.terrainEncounter),
    missing: missingTables(chain),
    noRow: [chain.distance].some((step) => step && !step.ok && step.noRow),
    distance: chain.distance?.ok
      ? { feet: chain.distance.feet, dice: chain.distance.dice, mult: chain.distance.mult }
      : null,
    visible,
    partySize: size,
    evasion: evasion.ok ? evasion.target : null,
    evasionMods: (mods.parts ?? []).map((p) => ({ label: loc(`travel.enc.mod.${p.key}`), value: p.value > 0 ? `+${p.value}` : `${p.value}` })),
    zone: (zones?.regions ?? []).map((r) => r?.name).filter(Boolean).join(", ") || null,
    zoneThrow: chain.zone ? { roll: chain.zone.roll, target: chain.zone.target } : null,
    zoneDraw: zoneDraw && !zoneDraw.missing ? zoneDraw : null,
    zoneMissing: zoneDraw?.missing ? zoneDraw.zone || "?" : null,
  };

  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/formation/encounter-card.hbs`,
    view,
  );
  await ChatMessage.create({
    speaker: { alias: loc("travel.enc.speaker") },
    whisper: gmIds(),
    content,
  });
}

/**
 * The imported travelling cadence for a territory, in miles — the distance one
 * encounter-frequency hex spans — or null when the table is not imported or
 * the cell is not a per-hex one.
 */
export function cadenceMilesFor(territory) {
  const cell = readTable(TRAVEL_DOC, "encounterFrequency")?.traveling?.[territory];
  const miles = Number(cell?.mileHex);
  return cell?.kind === "perHex" && miles > 0 ? miles : null;
}

/**
 * A cadence unit was walked on a journey, or a zone entered: throw, when the
 * setting says to. `night` keys the column shift; `hex` names the hex on the
 * card; `activity` is the cadence line it cites.
 */
export async function maybeHexThrow(formation, { night = false, hex = null, activity = "travel" } = {}) {
  if (!formation || !encountersOn()) return null;
  const t = travelOf(formation);
  if (t.mode !== "journey") return null;
  return postEncounterThrow(formation, { activity, night, hex });
}

/**
 * End Day's owed throws, from the imported frequency table and the finished
 * day's own slots: one per hunt or search hour, and the camp's resting
 * cells — a cell counted in nights gates its throw on a die of that many
 * sides (the book randomizes timing within a period; the card says which
 * die gated it). Hex throws already fired as the hexes were entered.
 *
 * Inside zones whose composed cadence is `periods`, a stated `dayThrows`
 * replaces the day's cells — the hunt and search slots and the resting day —
 * with that many throws, as travel on a day that travelled and as rest
 * otherwise; a stated `nightThrows` replaces the resting night with that many
 * night throws. A count of 0 leaves its half to the imported cells.
 */
export async function rollDayEncounters(formation, entry) {
  if (!formation || !encountersOn()) return;
  const t = travelOf(formation);
  if (t.mode !== "journey") return;
  const zone = journeyZones(formation).fields;
  const periods = zone.journeyCadence === "periods";
  const dayThrows = periods ? zone.dayThrows : 0;
  const nightThrows = periods ? zone.nightThrows : 0;
  const travelled = DAY_KINDS[entry?.dayKind]?.travels !== false;

  const freq = readTable(TRAVEL_DOC, "encounterFrequency");
  const cell = (activity) => freq?.[activity]?.[t.territory];

  if (dayThrows) {
    for (let n = 0; n < dayThrows; n++) await postEncounterThrow(formation, { activity: travelled ? "travel" : "rest" });
  } else if (freq) {
    for (const slot of entry?.activities ?? []) {
      if (slot === "hunt" && cell("hunting")) await postEncounterThrow(formation, { activity: "hunt" });
      if (slot === "search" && cell("searching")) await postEncounterThrow(formation, { activity: "search" });
    }
    if (!travelled) {
      const day = cell("restingDay");
      if (day?.kind === "perPeriod") await postEncounterThrow(formation, { activity: "rest" });
    }
  }

  if (nightThrows) {
    for (let n = 0; n < nightThrows; n++) await postEncounterThrow(formation, { activity: "rest", night: true });
  } else if (freq) {
    const nightCell = cell("restingNight");
    if (nightCell?.kind === "perPeriod") {
      const nights = Number(nightCell.nights) || 0;
      const due = nights <= 1 || Math.floor(Math.random() * nights) === 0;
      if (due) await postEncounterThrow(formation, { activity: "rest", night: true });
    }
  }
}
