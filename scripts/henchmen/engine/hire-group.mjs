/* global game, ui, foundry, Actor, Hooks, ChatMessage */
/**
 * Hire a whole unit from the market as ONE lib group (skirmish scale).
 *
 * Troop rows become counted merc STACKS (per-body HP and casualties, no
 * actor-per-body), and an optional officer is hired as a lone leveled actor
 * through the full `hire()` pipeline and LINKED as the group's commander
 * (RR 171). A stack's prototype is one hidden stat-block actor the group
 * snapshots on `addStack`. Army-scale command is not this file's.
 */
import { MODULE_ID, HOOKS } from "../constants.mjs";
import { GROUP_ACTOR_TYPE as GROUP_TYPE } from "../../lib/group-logic.mjs";
import { hire, employerOwnership } from "./hire.mjs";
import { mercenaryMorale, officerMoraleModifier, officerTitle } from "../rules/wages.mjs";
import { optTable } from "../rules/tables.mjs";
import { takeFromRow } from "../rules/bulk-offer.mjs";
import { hiredClassName } from "../rules/candidates.mjs";
import { now } from "../time.mjs";

/** Mark `count` heads of a market row hired; the rest of the row stays on the market (`takeFromRow`). */
async function takeCandidateHeads(location, candidateId, count) {
  const candidates = (location.system.candidates ?? []).flatMap((c) => {
    const obj = c.toObject?.() ?? foundry.utils.deepClone(c);
    return obj.id === candidateId ? takeFromRow(obj, count, () => foundry.utils.randomID()).rows : [obj];
  });
  await location.update({ "system.market.candidates": candidates });
}

/** Flag on the group actor holding its pay state, `{ lastPaidTime, arrearsGp }`; a group never enters the core `henchmenList`. */
export const FLAG_GROUP_PAY = "groupPay";

const acksGroups = () => globalThis.acksExtras?.lib?.groups ?? null;

/** Mounted troop types, which weigh more toward the RR 169 command capacity. */
const MOUNTED_TYPES = new Set([
  "lightCavalry", "mountedCrossbowman", "horseArcher", "mediumCavalry", "heavyCavalry",
  "cataphractCavalry", "camelArcher", "camelLancer", "warElephant", "beastRider",
]);

/** The COMMAND level for RR 169 capacity: a hired mercOfficer's RR 171 rank if present, else the employer's level. A marshal never sets it. */
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

/** A bare stat-block prototype actor for a troop type, snapshotted by the group on addStack. Created through the base `Actor.create`, never `Actor.implementation.create`: the system's create override replaces `system` on a character created without `items`. */
async function createTroopPrototype(candidate, employer) {
  const data = {
    name: candidate.troopType || candidate.occupation || candidate.name || game.i18n.localize("ACKS-HENCHMEN.candidate.unnamed"),
    type: "character",
    ownership: employerOwnership(employer),
    prototypeToken: { actorLink: false },
    system: {
      details: { level: candidate.level ?? 0, class: hiredClassName(candidate) },
      hp: { hd: troopHd(candidate) },
    },
  };
  const scores = scoresFromAttributes(candidate.attributes);
  if (scores) data.system.scores = scores;
  return Actor.create(data);
}

/** Find the employer's existing merc group, else create one named for them. The unit block is set by a post-create update: the system's create override drops create-time `system` data. */
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
      // The employer commands until a hired mercOfficer overrides this.
      "system.unit.officerLevel": Number(employer.system?.details?.level ?? 0) || 0,
    });
    // Start the wage clock.
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
  if (!groups?.addStack) return { error: "no-lib-groups", stacks: [] };
  if (!employer) return { error: "no-employer", stacks: [] };
  if (!troops.length && !officerCandidateId) return { error: "empty", stacks: [] };

  const group = await findOrCreateGroup(employer, location);
  if (!group) return { error: "group-create-denied", stacks: [] };

  // Troops → counted merc stacks (one hidden prototype each).
  const stacks = [];
  for (const pick of troops) {
    const candidate = getCandidate(location, pick.candidateId);
    if (!candidate || candidate.status === "hired") continue;
    // a network find is in its holder's market and nobody else's
    if (candidate.networkFor && candidate.networkFor !== employer.uuid) continue;
    const count = Math.max(1, Math.floor(pick.quantity ?? candidate.quantity ?? 1));
    const proto = await createTroopPrototype(candidate, employer);
    if (!proto) continue;
    const key = await groups.addStack(group, proto, { count });
    if (key) {
      stacks.push(key);
      // Mounted weight (command capacity) and RR 166 base morale.
      const mounted = MOUNTED_TYPES.has(candidate.troopType);
      // An unread base is stored as null (unknown), never as a 0 that claims
      // the troop type adds nothing.
      const baseMorale = mercenaryMorale(candidate.troopType);
      await groups.patchStack(group, key, (s) => {
        if (candidate.troopType) s.template.label = candidate.troopType;
        s.mounted = mounted;
        s.baseMorale = baseMorale;
      });
    }
    await takeCandidateHeads(location, pick.candidateId, count);
  }

  // Officer: a lone leveled actor, linked as commander, with the RR 171 morale
  // modifier and level cached on the group.
  let officer = null;
  if (officerCandidateId) {
    const offCand = getCandidate(location, officerCandidateId);
    const specialistType = offCand?.specialistType ?? "";
    const result = await hire(location, officerCandidateId, employer, { category: "specialist" });
    officer = result?.actor ?? null;
    if (officer) {
      // An unread modifier is stored as null (unknown), never as a 0 that
      // claims the officer adds nothing.
      const modifier = officerMoraleModifier(specialistType);
      await group.update({
        "system.unit.officerUuid": officer.uuid,
        "system.unit.officerMoraleBonus": modifier === null ? null : Math.max(0, modifier),
        "system.unit.officerLevel": commandLevel(specialistType, employer),
      });
    }
  }

  // RR 169: warn when the unit is larger than its commander can lead; the hire still stands.
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
