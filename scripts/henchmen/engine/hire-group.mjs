/* global game, ui, Actor, Hooks, ChatMessage */
/**
 * Hire a whole unit from the market as ONE `acks-lib.group` (skirmish scale).
 *
 * Troop rows become counted merc STACKS — per-body HP and casualties, no
 * `retainer.quantity` label and no actor-per-body — and an optional officer is
 * hired as a lone leveled actor (a unique individual keeps the full `hire()`
 * pipeline) and LINKED as the group's commander (RR 171). A troop stack's
 * prototype is one hidden stat-block actor the group snapshots on `addStack`; a
 * platoon of 30 is then one prototype + one stack of 30, not 30 actors.
 *
 * Scope: this is the skirmish-scale unit. Domain-scale command (how many units
 * an officer leads across an army) and Battles integration are acks-troops.
 */
import { MODULE_ID, HOOKS } from "../constants.mjs";
import { hire, employerOwnership, updateCandidate } from "./hire.mjs";
import { mercenaryMorale } from "../rules/wages.mjs";
import { optTable } from "../rules/tables.mjs";
import { now } from "../time.mjs";

/** Group pay state lives in a henchmen flag on the group actor — a group is a
 *  paid unit that never enters the core `henchmenList` (so it costs no PC
 *  henchman-cap slot). `{ lastPaidTime, arrearsGp }`. */
export const FLAG_GROUP_PAY = "groupPay";

const GROUP_TYPE = "acks-lib.group";
const acksGroups = () => globalThis.acksLib?.groups ?? null;

/** Mounted troop types — they count DOUBLE toward the RR 169 command capacity
 *  (a platoon is 30 infantry OR 15 cavalry). */
const MOUNTED_TYPES = new Set([
  "lightCavalry", "mountedCrossbowman", "horseArcher", "mediumCavalry", "heavyCavalry",
  "cataphractCavalry", "camelArcher", "camelLancer", "warElephant", "beastRider",
]);

/** The mercenary-officer title from a specialist type ("mercOfficerCaptain" → "captain"). */
const officerTitle = (specialistType) => (String(specialistType ?? "").match(/^mercOfficer(.+)$/i)?.[1] ?? "").toLowerCase();

/** The officer's RR 171 morale modifier (mercOfficer* from the table; marshals /
 *  master mariners +1 per the RR 166 role group; else 0). */
function officerMoraleModifier(specialistType) {
  const title = officerTitle(specialistType);
  if (title) {
    const row = (optTable("wages", "mercenaryOfficers")?.rows ?? []).find((r) => r.title === title);
    if (row) return row.moraleModifier ?? 0;
  }
  return /^(marshal|marinerMaster)/i.test(specialistType ?? "") ? 1 : 0;
}

/** The COMMAND level for RR 169 capacity: a hired mercOfficer's RR 171 rank if
 *  present (lieutenant 4 … general 10), else the employer's level — the employer
 *  personally leads. A marshal trains and lifts morale but does not field-command,
 *  so it never sets this. */
function commandLevel(specialistType, employer) {
  const title = officerTitle(specialistType);
  if (title) {
    const row = (optTable("wages", "mercenaryOfficers")?.rows ?? []).find((r) => r.title === title);
    if (row?.level) return row.level;
  }
  return Number(employer?.system?.details?.level ?? 0) || 0;
}

/** acks scores block from a candidate's rolled attributes (acks stores WIS as `.wil`). */
function scoresFromAttributes(a) {
  if (!a || a.str == null) return undefined;
  return {
    str: { value: a.str },
    int: { value: a.int },
    wis: { value: a.wil },
    dex: { value: a.dex },
    con: { value: a.con },
    cha: { value: a.cha },
  };
}

/** The per-body hit-dice die from a candidate's "1/2 HD (1d4 hp)" line, else 1d8. */
function troopHd(candidate) {
  const m = String(candidate?.hitDice ?? "").match(/(\d+d\d+)/i);
  return m ? m[1] : "1d8";
}

function getCandidate(location, id) {
  return (location.system.candidates ?? []).find((c) => c.id === id) ?? null;
}

/** A bare stat-block prototype actor for a troop type — the body every stack
 *  member copies. Hidden, unlinked; the group snapshots it on addStack. */
async function createTroopPrototype(candidate, employer) {
  const data = {
    name: candidate.troopType || candidate.occupation || candidate.name || game.i18n.localize("ACKS-HENCHMEN.candidate.unnamed"),
    type: "character",
    ownership: employerOwnership(employer),
    prototypeToken: { actorLink: false },
    system: {
      details: { level: candidate.level ?? 0, class: candidate.classKey || candidate.occupation || "" },
      hp: { hd: troopHd(candidate) },
    },
  };
  const scores = scoresFromAttributes(candidate.attributes);
  if (scores) data.system.scores = scores;
  return Actor.implementation.create(data);
}

/** Find the employer's existing merc group, else create one named for them.
 *  The unit block is set with a post-create update: create-time nested
 *  `system.unit.*` does not persist for this TypeDataModel (verified live —
 *  category/employer defaulted), but updates do. */
async function findOrCreateGroup(employer, location) {
  const existing = game.actors.find((a) => a.type === GROUP_TYPE && a.system?.unit?.employerUuid === employer.uuid);
  if (existing) return existing;
  const group = await Actor.implementation.create({
    name: game.i18n.format("ACKS-HENCHMEN.group.companyName", { name: employer.name }),
    type: GROUP_TYPE,
    ownership: employerOwnership(employer),
  });
  if (group) {
    await group.update({
      "system.unit.category": "mercenary",
      "system.unit.employerUuid": employer.uuid,
      "system.unit.locationUuid": location?.uuid ?? "",
      // Default field commander is the employer personally; a hired mercOfficer
      // overrides this with its higher rank.
      "system.unit.officerLevel": Number(employer.system?.details?.level ?? 0) || 0,
    });
    // Start the wage clock — the unit is a paid retainer from this month.
    await group.setFlag(MODULE_ID, FLAG_GROUP_PAY, { lastPaidTime: now(), arrearsGp: 0 });
  }
  return group;
}

/**
 * Hire troops (and optionally an officer) from the market as one group.
 * @param {Actor} location
 * @param {Actor} employer
 * @param {object} opts
 * @param {Array<{candidateId:string, quantity?:number}>} opts.troops
 * @param {string|null} [opts.officerCandidateId]
 * @returns {Promise<{group?:Actor, stacks:string[], officer?:Actor|null, error?:string}>}
 */
export async function hireAsGroup(location, employer, { troops = [], officerCandidateId = null } = {}) {
  const groups = acksGroups();
  if (!groups?.addStack) return { error: "no-acks-lib-groups", stacks: [] };
  if (!employer) return { error: "no-employer", stacks: [] };
  if (!troops.length && !officerCandidateId) return { error: "empty", stacks: [] };

  const group = await findOrCreateGroup(employer, location);
  if (!group) return { error: "group-create-denied", stacks: [] };

  // Troops → counted merc stacks (one hidden prototype each).
  const stacks = [];
  for (const pick of troops) {
    const candidate = getCandidate(location, pick.candidateId);
    if (!candidate || candidate.status === "hired") continue;
    const count = Math.max(1, Math.floor(pick.quantity ?? candidate.quantity ?? 1));
    const proto = await createTroopPrototype(candidate, employer);
    if (!proto) continue;
    const key = await groups.addStack(group, proto, { count });
    if (key) {
      stacks.push(key);
      // Troops addendum: cavalry weight (command capacity) + RR 166 base morale.
      const mounted = MOUNTED_TYPES.has(candidate.troopType);
      const baseMorale = mercenaryMorale(candidate.troopType) ?? 0;
      await groups.patchStack(group, key, (s) => {
        if (candidate.troopType) s.template.label = candidate.troopType;
        s.mounted = mounted;
        s.baseMorale = baseMorale;
      });
    }
    await updateCandidate(location, pick.candidateId, { status: "hired" });
  }

  // Officer → a lone leveled actor (full individual hire), linked as commander,
  // with the RR 171 morale modifier + level cached so command-morale and command
  // capacity are computable without loading the officer.
  let officer = null;
  if (officerCandidateId) {
    const offCand = getCandidate(location, officerCandidateId);
    const specialistType = offCand?.specialistType ?? "";
    const result = await hire(location, officerCandidateId, employer, { category: "specialist" });
    officer = result?.actor ?? null;
    if (officer) {
      await group.update({
        "system.unit.officerUuid": officer.uuid,
        "system.unit.officerMoraleBonus": Math.max(0, officerMoraleModifier(specialistType)),
        "system.unit.officerLevel": commandLevel(specialistType, employer),
      });
    }
  }

  // RR 169: warn if the unit is larger than its commander can personally lead
  // (needs a higher-rank officer, or past a platoon the army command structure
  // that is acks-troops). Advisory — the hire still stands.
  const settled = game.actors.get(group.id) ?? group;
  if (settled.system.overCommand) {
    ui.notifications?.warn(
      game.i18n.format("ACKS-HENCHMEN.group.overCommand", {
        strength: settled.system.troopStrength,
        cap: settled.system.commandCapacity,
      })
    );
  }

  Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer });
  ChatMessage.create({
    content: game.i18n.format("ACKS-HENCHMEN.group.hiredChat", {
      employer: employer.name,
      group: group.name,
      stacks: stacks.length,
      total: group.system.totalCurrent,
    }),
    speaker: ChatMessage.getSpeaker({ actor: employer }),
  });
  return { group, stacks, officer };
}
