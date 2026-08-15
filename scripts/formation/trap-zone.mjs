/* global game, foundry, fromUuid, CONFIG, ChatMessage, Roll, ui */
import { MODULE_ID, ROLES, TRAP_ITEM_TYPE } from "./constants.mjs";
import { getPartyToken, isDown, isHurried, marchingOrder, updateFormation } from "./formation-model.mjs";
import { setWallTrap, trapWallsCrossed, wallTrap } from "./trap-walls.mjs";
import { PARTY_CHECKS, resolveCheck } from "./party-rolls.mjs";
import { advanceRounds, advanceTurns } from "./turn-engine.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { gmIds, makeLoc } from "../lib/util.mjs";
import { findZone } from "./zones.mjs";
import {
  CRUDE,
  RESOLUTIONS,
  STATES,
  TRIGGER_DIE,
  disarmPlan,
  firingPlan,
  isBotch,
  lockAfterFailure,
  probeSequence,
  repeatLocked,
  triggerFires,
  victimsOf,
} from "./trap-rules.mjs";

/**
 * "Trap Zone" scene-region behavior: draw a Region over the squares a trap
 * covers, and the party walking through it is resolved by the book instead of
 * by the Judge's memory.
 *
 * The sequence is the one the delve's own sequence of play lays down, in that
 * order and for its reasons: anyone searching the ground throws FIRST, because
 * a trap found is a trap not sprung; then the 10' pole, which is an adventurer
 * moving 5' ahead of its bearer; then the party itself, rank by rank, each with
 * its own secret 1d6. The first throw that comes up inside the trigger band
 * ends the sequence — one trap goes off once.
 *
 * Everything the Judge sees is whispered. A trap the party crossed untouched is
 * reported too, and only to the Judge: knowing that the corridor was clear is
 * how a Judge keeps track of a trap that is still armed, and telling the table
 * would give away that there was ever anything to cross.
 *
 * The rule itself — probe order, who is caught, the disarm throw, the botch
 * bands — is `trap-rules.mjs`, which holds no dice and no documents. This file
 * is the world: the zone's stored state, the throws, and the cards.
 */

const LANG_PREFIX = "ACKS-FORMATION.traps";
const loc = makeLoc(LANG_PREFIX);

export const TRAP_ZONE_TYPE = `${MODULE_ID}.trapZone`;

/* -------------------------------------------- */
/*  The zone, as data                           */
/* -------------------------------------------- */

/**
 * One trap, buried in one place.
 *
 * The zone holds a REFERENCE to a trap Item and the state of this particular
 * burial, and nothing else. What a scything blade is belongs to the trap
 * document — shared, importable from the GM's own book, editable once for every
 * corridor it sits in. Whether THIS one is still armed, already spotted, or
 * spent belongs here, because it is true of the place and not of the idea.
 *
 * A zone naming no trap resolves nothing; it is an unfinished note to the Judge
 * rather than an error.
 */
export class TrapZoneBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["ACKS-FORMATION.TRAP_ZONE"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      /** The trap Item this zone is an instance of. */
      trapUuid: new fields.DocumentUUIDField({ type: "Item" }),

      state: new fields.StringField({ required: true, initial: STATES.armed, choices: Object.values(STATES) }),
      /**
       * Who has already failed a hasty attempt here, and at what level — the
       * "cannot repeat until higher level" rule needs to know WHEN, not just
       * that it happened. Cleared by re-arming.
       */
      repeatLock: new fields.ObjectField(),
    };
  }
}

/** Register the behavior subtype (called from the init hook). */
export function registerTrapZone() {
  CONFIG.RegionBehavior.dataModels[TRAP_ZONE_TYPE] = TrapZoneBehavior;
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[TRAP_ZONE_TYPE] = "fa-solid fa-triangle-exclamation";
}

/** The trap zone the party token currently stands in, if any. */
export function findTrapZone(formation) {
  return findZone(formation, TRAP_ZONE_TYPE);
}


/* -------------------------------------------- */
/*  Placements                                  */
/* -------------------------------------------- */

/**
 * Where a trap is buried, behind one interface.
 *
 * A trap can be laid two ways — along a wall the party crosses, or over a
 * region the party walks into — and the rules do not care which. The sequence,
 * the searching, the probe order, the disarm throws and the botch bands are one
 * body of code, and it reaches its placement only through these four members.
 *
 * @typedef {object} Placement
 * @property {"zone"|"wall"} kind
 * @property {string} trapUuid
 * @property {string} state one of `STATES`
 * @property {Record<string, number>} repeatLock
 * @property {(patch: object) => Promise<unknown>} write
 */

/** The region behavior as a placement. */
export function zonePlacement(zone) {
  const s = zone.behavior.system;
  return {
    kind: "zone",
    doc: zone.behavior,
    trapUuid: s.trapUuid ?? "",
    state: s.state,
    repeatLock: s.repeatLock ?? {},
    write: (patch) =>
      zone.behavior.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`system.${k}`, v]))),
  };
}

/** A trapped wall as a placement. */
export function wallPlacement(wall) {
  const t = wallTrap(wall) ?? {};
  return {
    kind: "wall",
    doc: wall,
    trapUuid: t.trapUuid ?? "",
    state: t.state ?? STATES.armed,
    repeatLock: t.repeatLock ?? {},
    write: (patch) => setWallTrap(wall, patch),
  };
}

/** The trap document a placement names, or null. */
export async function trapFor(placement) {
  if (!placement?.trapUuid) return null;
  const item = await fromUuid(placement.trapUuid);
  return item?.type === TRAP_ITEM_TYPE ? item : null;
}

/**
 * The placement the party is standing in or has just crossed, whichever is
 * live. A crossed WALL wins over a region: the party met the line on the way
 * in, so that is the trap they met first.
 */
export async function livePlacement(formation, { from = null, to = null } = {}) {
  const token = getPartyToken(formation);
  if (token && from && to) {
    // `from`/`to` arrive as the token's top-left corner, which is where a
    // TokenDocument stores itself. What meets a tripwire is the token's
    // CENTRE, so the path is shifted onto it before anything is intersected —
    // and `haltParty` shifts the crossing back the other way.
    const gs = token.parent.grid.size;
    const half = { x: (token.width * gs) / 2, y: (token.height * gs) / 2 };
    const path = [from, to].map((p) => ({ x: p.x + half.x, y: p.y + half.y }));
    const crossed = trapWallsCrossed(token.parent, path[0], path[1]).find((h) => h.trap.state === STATES.armed);
    if (crossed) return { placement: wallPlacement(crossed.wall), haltAt: crossed.at };
  }
  const zone = findTrapZone(formation);
  if (zone && zone.behavior.system.state === STATES.armed) return { placement: zonePlacement(zone), haltAt: null };
  return { placement: null, haltAt: null };
}

/* -------------------------------------------- */
/*  Cards                                       */
/* -------------------------------------------- */

/** Whisper one card to the Judges. Traps are secret; nothing here is public. */
async function whisper(html, formation, rolls = []) {
  return ChatMessage.create({
    content: html,
    rolls,
    whisper: gmIds(),
    speaker: { alias: formation?.name ?? game.i18n.localize(`${LANG_PREFIX}.title`) },
  });
}

/* -------------------------------------------- */
/*  Walking into it                             */
/* -------------------------------------------- */

/**
 * Who is close enough to notice the trap on the way past.
 *
 * The book gives a moving thief an AUTOMATIC hasty search within 5' of a hidden
 * feature, and 10' if they are probing with a pole. In a column that is the
 * front rank, plus a pole-bearer one rank further back whose pole reaches the
 * same ground. It is not offered to the whole party: a mage six ranks back is
 * not within 5' of anything.
 *
 * Being *capable* is left to `resolveCheck`, which answers null for anyone
 * without a real Searching skill — hasty searching is skill-only, so that gate
 * already says "thief" without this file having to name a class.
 */
function autoSearchers(order) {
  return (order ?? []).filter((row) => row.rank === 0 || ((row.roles ?? []).includes(ROLES.POLE) && row.rank <= 1));
}

/**
 * The searching throws, made before anything is stepped on.
 *
 * @returns {Promise<{found: boolean, rows: object[], rolls: Roll[]}>}
 */
async function searchAhead(order, { crude = false } = {}) {
  const rows = [];
  const rolls = [];
  let found = false;

  for (const row of autoSearchers(order)) {
    const actor = game.actors.get(row.actorId);
    if (!actor || isDown(actor)) continue;
    const check = resolveCheck(actor, PARTY_CHECKS.searchHasty);
    if (!check) continue; // no Searching skill: no automatic search to make

    const bonus = check.bonus + (crude ? CRUDE.find : 0);
    const formula = bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20";
    const roll = await new Roll(formula).evaluate();
    rolls.push(roll);
    const success = roll.total >= check.target;
    if (success) found = true;

    const breakdown = (check.parts ?? []).map((p) => `+${p.value} ${p.label}`);
    if (crude) breakdown.push(`+${CRUDE.find} ${loc("partCrude")}`);
    rows.push({
      name: actor.name,
      total: roll.total,
      target: check.target,
      detail: breakdown.length ? `${check.source}; ${breakdown.join(", ")}` : check.source,
      outcome: game.i18n.localize(`${LANG_PREFIX}.${success ? "spotted" : "sawNothing"}`),
      emphasis: success ? "success" : "failure",
    });
  }
  return { found, rows, rolls };
}

/**
 * The party crosses a trap zone: search, then probe, then walk into it.
 *
 * Called when the party token has moved. Answers null when there is nothing to
 * resolve — no zone, or a zone whose trap is already spotted, disarmed or
 * spent — so a party may walk back and forth over a dealt-with trap freely.
 *
 * @returns {Promise<{outcome: string, victims?: object[]}|null>}
 */
export async function runTrapCheck(formation, { from = null, to = null } = {}) {
  const { placement, haltAt } = await livePlacement(formation, { from, to });
  if (!placement) return null;
  const trap = await trapFor(placement);
  if (!trap) return null;
  const cfg = trap.system;

  const order = marchingOrder(formation);
  if (!order.length) return null;

  // At combat speed the party loses its pole and its hasty searching together
  // (RR p. 263) — it is moving too fast for either.
  const hurried = isHurried(formation);
  const rolls = [];

  /* (a) Anyone searching the ground throws first. */
  const search = await searchAhead(hurried ? [] : order, { crude: cfg.crude });
  rolls.push(...search.rolls);
  if (search.found) {
    await placement.write({ state: STATES.found });
    await haltParty(formation, haltAt);
    await whisper(
      renderRollCard({
        title: loc("foundTitle"),
        subtitle: formation.name,
        note: loc("foundNote"),
        sections: [{ rows: search.rows }],
      }),
      formation,
      rolls,
    );
    return { outcome: "found" };
  }

  /* (b) and (c): the pole, then the party, each with its own secret die. */
  const probes = probeSequence(order, { pole: !hurried });
  const probeRows = [];
  let sprungAt = -1;

  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    const actor = game.actors.get(probe.actorId);
    if (actor && isDown(actor)) continue;
    const die = await new Roll(`1d${TRIGGER_DIE}`).evaluate();
    rolls.push(die);
    const fires = triggerFires(die.total, cfg.triggerOn);
    probeRows.push({
      name: probe.kind === "pole" ? loc("poleOf", { name: probe.name ?? "" }) : (probe.name ?? ""),
      total: die.total,
      detail: loc("rankDetail", { rank: probe.rank + 1 }),
      outcome: game.i18n.localize(`${LANG_PREFIX}.${fires ? "sprung" : "passed"}`),
      emphasis: fires ? "failure" : "neutral",
    });
    if (fires) {
      sprungAt = i;
      break;
    }
  }

  if (sprungAt < 0) {
    await whisper(
      renderRollCard({
        title: loc("crossedTitle"),
        subtitle: formation.name,
        note: hurried ? loc("hurriedNote") : loc("crossedNote"),
        sections: [
          ...(search.rows.length ? [{ title: loc("searchSection"), rows: search.rows }] : []),
          { title: loc("probeSection"), rows: probeRows },
        ],
      }),
      formation,
      rolls,
    );
    return { outcome: "crossed" };
  }

  const caught = victimsOf(probes, sprungAt, { scope: cfg.scope, radiusFeet: cfg.radiusFeet });
  await haltParty(formation, haltAt);
  return fireTrap(formation, placement, trap, caught, {
    preface: [
      ...(search.rows.length ? [{ title: loc("searchSection"), rows: search.rows }] : []),
      { title: loc("probeSection"), rows: probeRows },
    ],
    rolls,
    sprungBy: probes[sprungAt],
  });
}

/**
 * Stop the party where it met the trap.
 *
 * A trap wall blocks nothing on its own — the party walks through it as if it
 * were not there, which is what a tripwire does — so the halt is applied here,
 * on detection, rather than by making the wall a barrier. Without it the party
 * would be told about a tripwire three squares after stepping over it.
 *
 * A region has no crossing point and needs no halt: the party is standing in
 * the thing already.
 */
async function haltParty(formation, haltAt) {
  if (!haltAt) return;
  const token = getPartyToken(formation);
  if (!token) return;
  const gs = token.parent.grid.size;
  // The crossing is where the token's CENTRE met the line; back the top-left
  // corner out of it, and pull up just short so the party stops ON the near
  // side rather than straddling it.
  await token.update(
    { x: Math.round(haltAt.x - (token.width * gs) / 2), y: Math.round(haltAt.y - (token.height * gs) / 2) },
    { animate: false },
  );
  formation.clock.lastPosition = { x: token.x, y: token.y };
  await updateFormation(formation);
}

/* -------------------------------------------- */
/*  Going off                                   */
/* -------------------------------------------- */

/**
 * The trap fires. Rolls each victim's save or the trap's attack throw, rolls
 * damage once per victim, and spends the trap.
 *
 * Damage is REPORTED, not applied. A trap's damage lands on a character sheet
 * through the Judge's own hand for the same reason the party's saves do: half
 * on a made save, none if a rider says so, and a Judge who wanted the pit to be
 * a bruise this once. The card carries the number; the sheet is nobody's to
 * write from here.
 */
async function fireTrap(formation, placement, trap, caught, { preface = [], rolls = [], sprungBy = null } = {}) {
  const cfg = trap.system;
  const plan = firingPlan({
    resolution: cfg.resolution,
    saveKey: cfg.saveKey,
    attackThrow: cfg.attackThrow,
    damageFormula: cfg.damageFormula,
    pitDepthFeet: cfg.pitDepthFeet,
    spiked: cfg.spiked,
    crude: cfg.crude,
  });

  const rows = [];
  for (const victim of caught) {
    const actor = game.actors.get(victim.actorId);
    if (!actor) continue;
    const name = actor.name;

    if (plan.resolution === RESOLUTIONS.save && plan.saveKey) {
      const target = Number(actor.system?.saves?.[plan.saveKey]?.value);
      const formula = plan.saveBonus ? `1d20 + ${plan.saveBonus}` : "1d20";
      const roll = await new Roll(formula).evaluate();
      rolls.push(roll);
      const made = Number.isFinite(target) && roll.total >= target;
      rows.push({
        name,
        total: roll.total,
        target: Number.isFinite(target) ? target : undefined,
        detail: loc(plan.saveBonus ? "saveDetailCrude" : "saveDetail", {
          save: game.i18n.localize(`ACKS.saves.${plan.saveKey}.long`),
          bonus: plan.saveBonus,
        }),
        outcome: game.i18n.localize(`${LANG_PREFIX}.${made ? "saved" : "failedSave"}`),
        emphasis: made ? "success" : "failure",
      });
    } else if (plan.resolution === RESOLUTIONS.attack) {
      const ac = Number(actor.system?.aac?.value) || 0;
      // The ACKS attack throw: 1d20 + modifiers against the throw value plus
      // the target's AC. A crude trap's -2 is already in `attackModifier`.
      const needed = plan.attackThrow + ac;
      const roll = await new Roll(plan.attackModifier ? `1d20 + ${plan.attackModifier}` : "1d20").evaluate();
      rolls.push(roll);
      const hit = roll.total >= needed;
      rows.push({
        name,
        total: roll.total,
        target: needed,
        detail: loc(plan.attackModifier ? "attackDetailCrude" : "attackDetail", { ac, throw: plan.attackThrow }),
        outcome: game.i18n.localize(`${LANG_PREFIX}.${hit ? "hit" : "missed"}`),
        emphasis: hit ? "failure" : "success",
      });
    } else if (plan.resolution === RESOLUTIONS.none) {
      rows.push({ name, total: "—", outcome: loc("judgeAdjudicates"), emphasis: "neutral" });
    } else {
      rows.push({ name, total: "—", outcome: loc("noThrow"), emphasis: "failure" });
    }

    if (plan.formula) {
      const dmg = await new Roll(plan.formula).evaluate();
      rolls.push(dmg);
      rows.push({
        name: loc("damageTo", { name }),
        total: dmg.total,
        detail: plan.formula,
        tooltip: plan.formula,
        outcome: loc("damageOutcome"),
        emphasis: "failure",
      });
    }
  }

  await placement.write({ state: STATES.discharged });

  const notes = [loc("sprungNote", { name: sprungBy?.name ?? "" })];
  if (sprungBy?.kind === "pole") notes.push(loc("sprungByPole"));
  if (!caught.length) notes.push(loc("caughtNobody"));
  if (cfg.rider) notes.push(cfg.rider);

  await whisper(
    renderRollCard({
      title: loc("firedTitle", { trap: trap.name, level: cfg.level }),
      subtitle: formation.name,
      note: notes.filter(Boolean).join(" "),
      sections: [...preface, ...(rows.length ? [{ title: loc("victimSection"), rows }] : [])],
      footnote: loc("damageIsReported"),
    }),
    formation,
    rolls,
  );

  return { outcome: "sprung", victims: caught };
}

/* -------------------------------------------- */
/*  Disabling it                                */
/* -------------------------------------------- */

/**
 * Thieves' tools. The book gates disabling traps on holding a set, so the
 * pattern is matched against carried gear the same way the 10' pole is.
 */
export const TOOLS_ITEM_PATTERN = /thie(f|ves)'?s?\s*tools|lock\s*picks?|pick\s*locks?/i;

const carriesTools = (actor) =>
  (actor?.items ?? []).some((i) => TOOLS_ITEM_PATTERN.test(i.name ?? ""));

/**
 * Why a character may not work on this trap right now, or null if they may.
 *
 * Every refusal is reported BEFORE anything is rolled, which is the shape the
 * obstacle helper and the door helper both use: a throw nobody is allowed to
 * make should be said, not silently skipped.
 */
export function disarmRefusal(placement, actor, mode) {
  if (!placement) return "noZone";
  if (!placement.trapUuid) return "noTrap";
  if (placement.state === STATES.discharged) return "alreadyDischarged";
  if (placement.state === STATES.disarmed) return "alreadyDisarmed";
  if (!carriesTools(actor)) return "noTools";

  const check = resolveCheck(actor, PARTY_CHECKS[mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical"]);
  if (!check) return "cannotTry";
  // "Using Adventuring: not permitted" — a hasty attempt is skill-only.
  if (mode === "hasty" && !check.skilled) return "hastyNeedsSkill";

  const level = Number(actor?.system?.details?.level) || 1;
  if (mode === "hasty" && repeatLocked(placement.repeatLock, actor.id, level)) return "alreadyFailedHasty";
  return null;
}

/**
 * Work on the trap: one character, one throw, by the column of the table they
 * chose.
 *
 * The outcomes are the book's and they are not symmetrical. A made throw lets
 * the thief choose whether the trap is disarmed (and so re-armable) or
 * deliberately discharged; a plain failure ends a hasty attempt for good at
 * this level but leaves a methodical one open; and the botch bands — an
 * unmodified 1–3 hastily, 1 methodically — set the thing off with the thief on
 * top of it.
 *
 * @param {object} formation
 * @param {Actor} actor the character doing the work
 * @param {object} [opts]
 * @param {"hasty"|"methodical"} [opts.mode]
 * @param {number} [opts.extra] the Judge's own modifier
 * @returns {Promise<{ok: boolean, reason?: string, outcome?: string}>}
 */
export async function attemptDisarm(formation, actor, { mode = "methodical", extra = 0 } = {}) {
  // The trap being worked on is the one the party is standing at: a region
  // under the party token, or a trapped wall they have stopped against.
  const { placement } = await livePlacement(formation);
  const target = placement ?? nearestTrappedWall(formation);
  if (!target) return { ok: false, reason: "noZone" };

  const refusal = disarmRefusal(target, actor, mode);
  if (refusal) {
    ui.notifications.warn(loc(`refuse.${refusal}`, { name: actor?.name ?? "" }));
    return { ok: false, reason: refusal };
  }

  const trap = await trapFor(target);
  if (!trap) return { ok: false, reason: "noTrap" };
  const crude = !!trap.system.crude;
  const cfgKey = mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical";
  const check = resolveCheck(actor, PARTY_CHECKS[cfgKey]);
  const plan = disarmPlan({ mode, crude, skilled: check.skilled, extra });

  // `resolveCheck` already carries the methodical +4 and Trapfinding's +2; the
  // plan adds what is true of the TRAP rather than of the character.
  const bonus = check.bonus + (crude ? CRUDE.remove : 0) + (Number(extra) || 0);
  const roll = await new Roll(bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20").evaluate();
  const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total - bonus;
  const success = roll.total >= check.target;
  const botched = isBotch(natural, mode);

  const breakdown = (check.parts ?? []).map((p) => `+${p.value} ${p.label}`);
  if (crude) breakdown.push(`+${CRUDE.remove} ${loc("partCrude")}`);

  let outcome;
  if (success) {
    // The thief's own call: a disarmed trap can be re-armed later, a
    // discharged one is spent. Only they can say which they wanted.
    const discharge = await askDischarge(actor);
    outcome = discharge ? STATES.discharged : STATES.disarmed;
    await target.write({ state: outcome });
  } else if (botched) {
    outcome = "botched";
  } else {
    outcome = "failed";
    if (mode === "hasty") {
      const level = Number(actor?.system?.details?.level) || 1;
      await target.write({ repeatLock: lockAfterFailure(target.repeatLock, actor.id, level) });
    }
  }

  await whisper(
    renderRollCard({
      title: loc(mode === "hasty" ? "disarmHastyTitle" : "disarmMethodicalTitle"),
      subtitle: formation?.name,
      note: loc(`disarm.${outcome}`, { name: actor.name }),
      sections: [
        {
          rows: [
            {
              name: actor.name,
              total: roll.total,
              target: check.target,
              detail: breakdown.length ? `${check.source}; ${breakdown.join(", ")}` : check.source,
              outcome: loc(`disarmOutcome.${outcome}`),
              emphasis: outcome === STATES.disarmed || outcome === STATES.discharged ? "success" : "failure",
            },
          ],
        },
      ],
      footnote: plan.repeatable ? loc("mayTryAgain") : loc("noSecondHastyTry"),
    }),
    formation,
    [roll],
  );

  // A botch springs it, with the thief on top of it and nobody else near.
  if (botched) {
    await fireTrap(
      formation,
      target,
      trap,
      [{ actorId: actor.id, name: actor.name, rank: 0, file: 0, kind: "body" }],
      { rolls: [], sprungBy: { name: actor.name, kind: "body" } },
    );
  }

  // Time cost: a round hastily, a full turn methodically.
  if (mode === "hasty") await advanceRounds(formation, 1, { reason: "action" });
  else await advanceTurns(formation, 1, { reason: "trapbreaking" });

  return { ok: true, outcome };
}

/**
 * Disarm, or set it off on purpose? The book gives the choice to whoever made
 * the throw, so it is asked rather than assumed — and it matters, because only
 * a disarmed trap can be re-armed afterwards.
 */
async function askDischarge(actor) {
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("chooseTitle"), icon: "fa-solid fa-screwdriver-wrench" },
    content: `<p>${loc("chooseHint", { name: actor.name })}</p>`,
    buttons: [
      { action: "disarm", default: true, icon: "fa-solid fa-lock", label: loc("chooseDisarm"), callback: () => false },
      { action: "discharge", icon: "fa-solid fa-burst", label: loc("chooseDischarge"), callback: () => true },
    ],
    rejectClose: false,
  }).catch(() => null);
  // Dismissing the question leaves the trap disarmed: it is the safer of the
  // two and the one a thief who stopped paying attention already achieved.
  return chosen === true;
}

/**
 * Set a disarmed trap going again. Only a DISARMED trap can be re-armed — a
 * discharged one has already fired and there is nothing left to re-arm.
 */
export async function attemptRearm(formation, actor) {
  const target = disarmedPlacementAt(formation);
  if (!target) return { ok: false, reason: "noZone" };
  if (target.state !== STATES.disarmed) {
    ui.notifications.warn(loc("refuse.notDisarmed"));
    return { ok: false, reason: "notDisarmed" };
  }
  if (!carriesTools(actor)) {
    ui.notifications.warn(loc("refuse.noTools", { name: actor?.name ?? "" }));
    return { ok: false, reason: "noTools" };
  }
  const check = resolveCheck(actor, PARTY_CHECKS.trapbreakMethodical);
  if (!check?.skilled) {
    ui.notifications.warn(loc("refuse.rearmNeedsSkill", { name: actor?.name ?? "" }));
    return { ok: false, reason: "rearmNeedsSkill" };
  }

  const roll = await new Roll(check.bonus ? `1d20 + ${check.bonus}` : "1d20").evaluate();
  const success = roll.total >= check.target;
  if (success) await target.write({ state: STATES.armed, repeatLock: {} });

  await whisper(
    renderRollCard({
      title: loc("rearmTitle"),
      subtitle: formation?.name,
      sections: [
        {
          rows: [
            {
              name: actor.name,
              total: roll.total,
              target: check.target,
              detail: check.source,
              outcome: loc(success ? "rearmed" : "rearmFailed"),
              emphasis: success ? "success" : "failure",
            },
          ],
        },
      ],
    }),
    formation,
    [roll],
  );
  return { ok: true, outcome: success ? "rearmed" : "failed" };
}

/* -------------------------------------------- */
/*  Judge's controls                            */
/* -------------------------------------------- */

/**
 * Put a trap back the way it was. A discharged trap can be reset by the Judge
 * (the mechanism is rebuilt); a DISARMED one is what a thief may re-arm, which
 * is the throw `attemptRearm` makes. Clears the hasty repeat-lock either way:
 * a rebuilt trap is not the one anybody failed against.
 */
export async function resetTrap(placement) {
  return placement.write({ state: STATES.armed, repeatLock: {} });
}

/**
 * Every trapped wall within a square of the party token.
 *
 * A thief kneels at the wall they are standing against, so "which trap am I
 * working on" is a question of proximity — and a trap wall, being non-blocking,
 * cannot be found by asking what the party bumped into.
 */
function trappedWallsNear(formation, squares = 1) {
  const token = getPartyToken(formation);
  if (!token) return [];
  const gs = token.parent.grid.size;
  const cx = token.x + (token.width * gs) / 2;
  const cy = token.y + (token.height * gs) / 2;
  const reach = gs * squares + (Math.max(token.width, token.height) * gs) / 2;

  const near = [];
  for (const wall of token.parent.walls) {
    if (!wallTrap(wall)) continue;
    const [x1, y1, x2, y2] = wall.c;
    // Distance from the token's centre to the wall segment.
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2));
    const dist = Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy));
    if (dist <= reach) near.push({ wall, dist });
  }
  return near.sort((a, b) => a.dist - b.dist).map((n) => wallPlacement(n.wall));
}

/** The nearest trapped wall the party is standing at, or null. */
function nearestTrappedWall(formation) {
  return trappedWallsNear(formation)[0] ?? null;
}

/** The disarmed trap the party is standing at — a region first, then a wall. */
function disarmedPlacementAt(formation) {
  const zone = findTrapZone(formation);
  if (zone && zone.behavior.system.state === STATES.disarmed) return zonePlacement(zone);
  return trappedWallsNear(formation).find((p) => p.state === STATES.disarmed) ?? null;
}
