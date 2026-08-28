/* global game, ChatMessage, foundry */
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
 * Triggers: the panel's own button always; entering a hex and ending the
 * day only under the world setting — the cadence half reads the imported
 * `encounterFrequency` table (hunt and search slots throw per slot; a camp
 * day throws its resting cells, a night cell counted in nights gating the
 * throw by its period on a die the card declares).
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
  headEquivalents,
  runEncounter,
  visibilityMax,
} from "./encounters.mjs";
import { getMemberActor } from "./formation-model.mjs";
import { mountOf } from "../lib/mount.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** World setting: hex entries and End Day roll their owed throws. */
export const SETTING_TRAVEL_ENCOUNTERS = "travelEncounters";

const encountersOn = () => {
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
 * the settled-country column shift (a rest through the dark), and the
 * activity is the cadence line the card cites.
 */
export async function postEncounterThrow(formation, { activity = "travel", night = false } = {}) {
  const t = travelOf(formation);
  const terrain = ENCOUNTER_TERRAINS[t.encounterTerrain] ? t.encounterTerrain : encounterTerrainFor(t.ground);
  const chain = runEncounter({
    territory: t.territory,
    road: t.road !== "none",
    night,
    terrain,
    restingOrKnownRoute: t.day?.kind === "camp" || activity === "rest",
  });
  await postEncounterCard(formation, chain, { terrain, activity, night, travel: t });
  return chain;
}

/** The chain as one whispered card. */
export async function postEncounterCard(formation, chain, { terrain, activity, night, travel } = {}) {
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
    terrainEncounter: chain.terrainEncounter?.ok
      ? { roll: chain.terrainEncounter.roll, name: chain.terrainEncounter.name }
      : null,
    missing: [chain.creature, chain.rarity, chain.terrainEncounter, chain.distance]
      .filter((step) => step && !step.ok && step.missing)
      .map((step) => step.missing),
    noRow: [chain.distance].some((step) => step && !step.ok && step.noRow),
    distance: chain.distance?.ok
      ? { feet: chain.distance.feet, dice: chain.distance.dice, mult: chain.distance.mult }
      : null,
    visible,
    partySize: size,
    evasion: evasion.ok ? evasion.target : null,
    evasionMods: (mods.parts ?? []).map((p) => ({ label: loc(`travel.enc.mod.${p.key}`), value: p.value > 0 ? `+${p.value}` : `${p.value}` })),
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

/** A hex was entered on a journey: throw, when the setting says to. */
export async function maybeHexThrow(formation) {
  if (!formation || !encountersOn()) return null;
  const t = travelOf(formation);
  if (t.mode !== "journey") return null;
  return postEncounterThrow(formation, { activity: "travel" });
}

/**
 * End Day's owed throws, from the imported frequency table and the finished
 * day's own slots: one per hunt or search hour, and the camp's resting
 * cells — a cell counted in nights gates its throw on a die of that many
 * sides (the book randomizes timing within a period; the card says which
 * die gated it). Hex throws already fired as the hexes were entered.
 */
export async function rollDayEncounters(formation, entry) {
  if (!formation || !encountersOn()) return;
  const t = travelOf(formation);
  if (t.mode !== "journey") return;
  const freq = readTable(TRAVEL_DOC, "encounterFrequency");
  if (!freq) return;
  const territory = t.territory;
  const cell = (activity) => freq[activity]?.[territory];

  for (const slot of entry?.activities ?? []) {
    if (slot === "hunt" && cell("hunting")) await postEncounterThrow(formation, { activity: "hunt" });
    if (slot === "search" && cell("searching")) await postEncounterThrow(formation, { activity: "search" });
  }

  if (DAY_KINDS[entry?.dayKind]?.travels === false) {
    const day = cell("restingDay");
    if (day?.kind === "perPeriod") await postEncounterThrow(formation, { activity: "rest" });
  }
  const nightCell = cell("restingNight");
  if (nightCell?.kind === "perPeriod") {
    const nights = Number(nightCell.nights) || 0;
    const due = nights <= 1 || Math.floor(Math.random() * nights) === 0;
    if (due) await postEncounterThrow(formation, { activity: "rest", night: true });
  }
}
