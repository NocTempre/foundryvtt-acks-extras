/* global game, foundry, ui, ChatMessage, Roll, fromUuid, Hooks */
import { findEncounterZone } from "./encounter-zone.mjs";
import {
  LIGHT_SOURCES,
  MODULE_ID,
  RATION_PATTERN,
  REST_INTERVAL,
  ROUNDS_PER_TURN,
  TURN_SECONDS,
  TURNS_PER_DAY,
  WINDED_EFFECT_NAME,
} from "./constants.mjs";
import { effectiveSpeed, formationHasLight, getMemberActor, getFormation, isDown, isHurried, isPartyInDark, updateFormation } from "./formation-model.mjs";

/**
 * The dungeon-turn engine. Implements step 5 of the Judges Journal sequence of
 * play ("mark off 1 turn of game time") plus the every-2-turns wandering
 * monster throw: spell-duration expiry, rest & winded tracking, light-source
 * burn, and elapsed-time bookkeeping for rations. See acks-rules/acks-formation/RULES.md §9, §14.
 *
 * Everything here runs on a (the) GM client only.
 */

function gmIds() {
  return game.users.filter((u) => u.isGM).map((u) => u.id);
}

function loc(key, data = {}) {
  return game.i18n.format(`ACKS-FORMATION.${key}`, data);
}

/** "Xh YYm" for a number of dungeon turns. */
export function formatTurns(turns) {
  const minutes = turns * 10;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/* -------------------------------------------- */
/*  Effect expiry                               */
/* -------------------------------------------- */

function memberEffects(actor) {
  const effects = [];
  if (!actor) return effects;
  const iter = typeof actor.allApplicableEffects === "function" ? actor.allApplicableEffects() : actor.effects;
  for (const effect of iter) effects.push(effect);
  return effects;
}

/** Effects on members that still have time on the clock (duration in seconds/rounds/turns). */
function snapshotRunningEffects(formation) {
  const running = [];
  for (const member of formation.members) {
    const actor = getMemberActor(member);
    for (const effect of memberEffects(actor)) {
      const remaining = effect.duration?.remaining;
      if (typeof remaining === "number" && remaining > 0) {
        running.push({ actorName: actor.name, uuid: effect.uuid, name: effect.name });
      }
    }
  }
  return running;
}

/** Which of the snapshotted effects have run out now that time advanced. */
function findExpiredEffects(formation, snapshot) {
  const expired = [];
  for (const member of formation.members) {
    const actor = getMemberActor(member);
    for (const effect of memberEffects(actor)) {
      const was = snapshot.find((s) => s.uuid === effect.uuid);
      if (!was) continue;
      const remaining = effect.duration?.remaining;
      if (typeof remaining === "number" && remaining <= 0) {
        expired.push({ actorName: was.actorName, name: effect.name });
      }
    }
  }
  return expired;
}

/* -------------------------------------------- */
/*  Winded marker                               */
/* -------------------------------------------- */

function hasEndurance(actor) {
  return actor?.items?.some((i) => /endurance/i.test(i.name)) ?? false;
}

async function setWindedMarkers(formation, winded) {
  for (const member of formation.members) {
    const actor = getMemberActor(member);
    if (!actor) continue;
    const existing = actor.effects.find((e) => e.getFlag(MODULE_ID, "winded"));
    if (winded && !existing && !hasEndurance(actor)) {
      await actor.createEmbeddedDocuments("ActiveEffect", [
        {
          name: game.i18n.localize("ACKS-FORMATION.winded.effectName") || WINDED_EFFECT_NAME,
          img: "icons/svg/degen.svg",
          description: game.i18n.localize("ACKS-FORMATION.winded.effectDescription"),
          flags: { [MODULE_ID]: { winded: true } },
        },
      ]);
    } else if (!winded && existing) {
      await existing.delete();
    }
  }
}

/* -------------------------------------------- */
/*  Wandering monster throw                     */
/* -------------------------------------------- */

/**
 * The effective wandering-monster parameters for a formation: an Encounter
 * Zone region under the party token wins, then the formation's default table,
 * then the world settings. Zone overrides of 0 mean "inherit".
 */
export function getEncounterParams(formation) {
  const zone = findEncounterZone(formation);
  const zoneEvery = zone?.behavior?.system?.encounterEvery ?? 0;
  const zoneTarget = zone?.behavior?.system?.encounterTarget ?? 0;
  return {
    zone,
    every: zoneEvery > 0 ? zoneEvery : game.settings.get(MODULE_ID, "encounterEvery"),
    target: zoneTarget > 0 ? zoneTarget : game.settings.get(MODULE_ID, "encounterTarget"),
  };
}

/** The RollTable to draw wandering monsters from, if one is configured. */
async function resolveEncounterTable(formation, zone) {
  if (zone?.behavior?.system?.tableUuid) {
    const table = await fromUuid(zone.behavior.system.tableUuid);
    if (table) return table;
  }
  if (formation.tableId) return game.tables.get(formation.tableId) ?? null;
  return null;
}

/**
 * Make the wandering-monster encounter throw (1d6, encounter on `target`+,
 * default every 2 turns / 6+). Result is whispered to GMs; on an encounter the
 * distance (2d6×10 ft) and minute-of-turn (1d10) are pre-rolled and the
 * zone/formation encounter table (if any) is drawn from privately.
 */
export async function encounterCheck(formation, { manual = false, params = null } = {}) {
  const { zone, target } = params ?? getEncounterParams(formation);

  // The party's signature: what the dungeon can see and hear of them. RAW
  // (extracts) ties this to surprise and earshot; an OPTIONAL setting lets
  // it sway the throw itself (+1 hurried/loud, -1 dark and careful).
  const lit = formationHasLight(formation);
  const hurried = isHurried(formation);
  let signalMod = 0;
  if (game.settings.get(MODULE_ID, "signalAffectsEncounters")) {
    if (hurried) signalMod += 1;
    if (!lit && !hurried && isPartyInDark(formation)) signalMod -= 1;
  }

  const roll = await new Roll(signalMod ? `1d6 + ${signalMod}` : "1d6").evaluate();
  const encounter = roll.total >= target;

  let content = `<div class="acks-formation-card"><strong>${foundry.utils.escapeHTML(formation.name)}</strong> — ${loc(
    "chat.encounterCheck",
    { target },
  )}`;
  if (zone) content += ` <em>${loc("chat.inZone", { name: foundry.utils.escapeHTML(zone.region.name) })}</em>`;
  if (manual) content += ` <em>(${loc("chat.manual")})</em>`;
  content += `<br><span class="src">${loc("chat.signature", {
    light: game.i18n.localize(lit ? "ACKS-FORMATION.chat.sigLit" : "ACKS-FORMATION.chat.sigDark"),
    noise: game.i18n.localize(hurried ? "ACKS-FORMATION.chat.sigLoud" : "ACKS-FORMATION.chat.sigQuiet"),
  })}${signalMod ? ` (${signalMod > 0 ? "+" : ""}${signalMod})` : ""}</span>`;
  content += `</div>`;

  const messages = [
    {
      whisper: gmIds(),
      blind: false,
      rolls: [roll],
      flavor: content,
      speaker: { alias: formation.name },
    },
  ];

  if (encounter) {
    const distance = await new Roll("2d6*10").evaluate();
    const minute = await new Roll("1d10").evaluate();
    messages.push({
      whisper: gmIds(),
      rolls: [distance, minute],
      flavor: `<div class="acks-formation-card encounter"><strong>${loc("chat.encounterTriggered")}</strong><br>${loc(
        "chat.encounterDetail",
        { distance: distance.total, minute: minute.total },
      )}</div>`,
      speaker: { alias: formation.name },
    });
    // Turn-boundary throws fire when the clock reaches the rolled minute of
    // the turn now beginning; manual checks are immediate.
    if (!manual) {
      formation.clock.pendingEncounter = {
        atRounds: totalRounds(formation.clock) + (minute.total - 1),
        minute: minute.total,
      };
    }
  }

  for (const msg of messages) await ChatMessage.create(msg);

  if (encounter) {
    const table = await resolveEncounterTable(formation, zone);
    if (table) {
      // v14: messageMode string key ("gm" = visible to GMs only)
      await table.draw({ messageMode: "gm" });
    }
  }
  return encounter;
}

/* -------------------------------------------- */
/*  Rations                                     */
/* -------------------------------------------- */

function findRationItem(actor) {
  const rations = actor.items.filter(
    (i) => RATION_PATTERN.test(i.name) && (i.system?.quantity?.value ?? 0) > 0,
  );
  if (!rations.length) return null;
  // Prefer day rations over week rations, standard over iron.
  rations.sort((a, b) => {
    const dayA = /day/i.test(a.name) ? 0 : 1;
    const dayB = /day/i.test(b.name) ? 0 : 1;
    return dayA - dayB;
  });
  return rations[0];
}

/**
 * Decrement one ration per member; report who consumed what and who is out.
 * Week rations are consumed as 7 uses (tracked in an item flag) before the
 * item quantity itself decrements.
 */
export async function consumeRations(formation) {
  const fed = [];
  const hungry = [];
  for (const member of formation.members) {
    const actor = getMemberActor(member);
    if (!actor) continue;
    const ration = findRationItem(actor);
    if (ration) {
      if (/week/i.test(ration.name)) {
        const uses = (ration.getFlag(MODULE_ID, "uses") ?? 0) + 1;
        if (uses >= 7) {
          await ration.update({
            "system.quantity.value": ration.system.quantity.value - 1,
            [`flags.${MODULE_ID}.uses`]: 0,
          });
        } else {
          await ration.setFlag(MODULE_ID, "uses", uses);
        }
        fed.push({ name: actor.name, ration: `${ration.name} (${Math.min(uses, 7)}/7)` });
      } else {
        await ration.update({ "system.quantity.value": ration.system.quantity.value - 1 });
        fed.push({ name: actor.name, ration: ration.name });
      }
    } else {
      hungry.push(actor.name);
    }
  }
  let content = `<div class="acks-formation-card"><strong>${foundry.utils.escapeHTML(formation.name)}</strong> — ${loc("chat.rationsTitle")}<ul>`;
  for (const f of fed) content += `<li>${foundry.utils.escapeHTML(f.name)}: ${foundry.utils.escapeHTML(f.ration)}</li>`;
  content += "</ul>";
  if (hungry.length) {
    content += `<p class="warning">${loc("chat.rationsMissing", { names: hungry.join(", ") })}</p>`;
  }
  content += "</div>";
  await ChatMessage.create({ content, speaker: { alias: formation.name } });
}

/* -------------------------------------------- */
/*  The clock: rounds and turns                 */
/* -------------------------------------------- */

/** Absolute rounds elapsed (10 bookkeeping rounds per turn, RR p. 263). */
export function totalRounds(clock) {
  return (clock.turnsTotal ?? 0) * ROUNDS_PER_TURN + (clock.roundsPartial ?? 0);
}

/** Fire the pre-rolled wandering encounter when the clock reaches its round. */
async function firePendingEncounter(formation, notes) {
  const pending = formation.clock.pendingEncounter;
  if (!pending || totalRounds(formation.clock) < pending.atRounds) return;
  formation.clock.pendingEncounter = null;
  notes.push({ type: "bad", text: loc("chat.encounterNow", { minute: pending.minute }) });
  await ChatMessage.create({
    content: `<div class="acks-formation-card encounter"><strong>${loc("chat.encounterNowTitle")}</strong><br>${loc(
      "chat.encounterNow",
      { minute: pending.minute },
    )}</div>`,
    whisper: gmIds(),
    speaker: { alias: formation.name },
  });
}

/** Per-turn bookkeeping: rest, lights, spells, and the encounter throw. */
async function onTurnCompleted(formation, notes, resting) {
  /* --- Rest & winded (RR p. 271: rest 1 turn per 5 turns) --- */
  if (resting) {
    formation.clock.turnsSinceRest = 0;
    if (formation.clock.winded) {
      formation.clock.winded = false;
      notes.push({ type: "good", text: loc("chat.restedRecovered") });
    }
  } else {
    formation.clock.turnsSinceRest += 1;
    if (formation.clock.turnsSinceRest > REST_INTERVAL && !formation.clock.winded) {
      formation.clock.winded = true;
      notes.push({ type: "bad", text: loc("chat.becameWinded") });
    }
  }

  /* --- Light sources burn down --- */
  for (const light of formation.lights) {
    if (!light.lit) continue;
    light.remaining -= 1;
    const bearer = game.actors.get(light.bearerId);
    const bearerName = bearer?.name ?? "?";
    const label = game.i18n.localize(LIGHT_SOURCES[light.type]?.label ?? light.type);
    if (light.remaining <= 0) {
      light.lit = false;
      light.remaining = 0;
      notes.push({ type: "bad", text: loc("chat.lightOut", { light: label, bearer: bearerName }) });
      lightChanged(light.bearerId, light, "burntOut"); // frees the hand it occupied
    } else if (light.remaining === 1) {
      notes.push({ type: "warn", text: loc("chat.lightGuttering", { light: label, bearer: bearerName }) });
    }
  }

  /* --- Tracked spell durations burn down --- */
  formation.spells ??= [];
  for (const spell of formation.spells) {
    spell.remaining -= 1;
    const caster = game.actors.get(spell.casterId)?.name ?? "?";
    if (spell.remaining <= 0) {
      notes.push({ type: "bad", text: loc("chat.spellExpired", { spell: spell.name, caster }) });
    } else if (spell.remaining === 1) {
      notes.push({ type: "warn", text: loc("chat.spellEnding", { spell: spell.name, caster }) });
    }
  }
  formation.spells = formation.spells.filter((s) => s.remaining > 0);

  /* --- Wandering monster throw every N turns (JJ p. 36) ---
   * The throw is made at the turn boundary; on a hit, the 1d10 minute is
   * pre-rolled and the encounter FIRES when the clock reaches that round of
   * the turn now beginning. */
  formation.clock.movedThisTurn = false;

  formation.clock.encounterCounter += 1;
  const params = getEncounterParams(formation);
  if (params.every > 0 && formation.clock.encounterCounter >= params.every) {
    formation.clock.encounterCounter = 0;
    await encounterCheck(formation, { params });
  }
}

/**
 * Advance the clock by bookkeeping rounds (10 per turn, 1 minute each for
 * time-keeping). Movement, hasty 1-round actions, and combat all spend the
 * same currency; full-turn bookkeeping fires whenever a turn completes.
 * @param {object} formation                the formation record (mutated & saved)
 * @param {number} rounds                   rounds to advance
 * @param {object} [options]
 * @param {boolean} [options.resting]       the party is resting through these rounds
 * @param {string}  [options.reason]        display hint ("movement", "action", "combat", ...)
 */
export async function advanceRounds(formation, rounds, { resting = false, reason = "manual" } = {}) {
  if (!game.user.isGM) return;
  rounds = Math.max(1, Math.floor(rounds));

  const notes = [];
  const snapshot = snapshotRunningEffects(formation);
  const dayBefore = Math.floor(formation.clock.turnsTotal / TURNS_PER_DAY);
  let completedTurns = 0;

  // Advance world time so effect durations & calendar modules stay in sync
  // (60 seconds per bookkeeping round).
  if (game.settings.get(MODULE_ID, "advanceWorldTime")) {
    await game.time.advance((TURN_SECONDS / ROUNDS_PER_TURN) * rounds);
  }

  for (let i = 0; i < rounds; i++) {
    formation.clock.roundsPartial = (formation.clock.roundsPartial ?? 0) + 1;
    await firePendingEncounter(formation, notes);
    if (formation.clock.roundsPartial >= ROUNDS_PER_TURN) {
      formation.clock.roundsPartial = 0;
      formation.clock.turnsTotal += 1;
      completedTurns += 1;
      await onTurnCompleted(formation, notes, resting);
    }
  }

  // Remove spent lights.
  formation.lights = formation.lights.filter((l) => l.lit || l.remaining > 0);

  /* --- Expired spell/effect durations --- */
  const expired = findExpiredEffects(formation, snapshot);
  for (const e of expired) {
    notes.push({ type: "warn", text: loc("chat.effectExpired", { effect: e.name, actor: e.actorName }) });
  }

  /* --- Day boundary: ration reminder --- */
  const dayAfter = Math.floor(formation.clock.turnsTotal / TURNS_PER_DAY);
  if (dayAfter > dayBefore) {
    notes.push({ type: "warn", text: loc("chat.dayPassed") });
  }

  await setWindedMarkers(formation, formation.clock.winded);
  await updateFormation(formation);

  if (completedTurns > 0) {
    await postTurnCard(formation, completedTurns, { resting, reason, notes });
  } else if (notes.length) {
    // Round-level events (mid-turn expiries, fired encounters) reach the GM.
    let html = `<div class="acks-formation-card"><ul class="notes">`;
    for (const note of notes) html += `<li class="${note.type}">${note.text}</li>`;
    html += `</ul></div>`;
    await ChatMessage.create({ content: html, whisper: gmIds(), speaker: { alias: formation.name } });
  }

  // Keep the working Map item's record current (skips when the GM is not
  // viewing the scene; the next tick catches up).
  if (completedTurns > 0 && formation.mapSession) {
    try {
      const { archiveSession } = await import("./map-items.mjs");
      await archiveSession(formation);
    } catch (err) {
      console.error(`${MODULE_ID} | map archive failed`, err);
    }
  }
}

/** Advance whole dungeon turns (10 rounds each). */
export async function advanceTurns(formation, n = 1, options = {}) {
  return advanceRounds(formation, Math.max(1, Math.floor(n)) * ROUNDS_PER_TURN, options);
}

/* -------------------------------------------- */
/*  Chat card                                   */
/* -------------------------------------------- */

async function postTurnCard(formation, n, { resting, reason, notes }) {
  const litLights = formation.lights.filter((l) => l.lit);
  const rest = formation.clock.turnsSinceRest;

  let html = `<div class="acks-formation-card">`;
  html += `<header><strong>${foundry.utils.escapeHTML(formation.name)}</strong> — `;
  html += resting ? loc("chat.turnRested", { n }) : loc("chat.turnAdvanced", { n });
  if (reason === "movement") html += ` <em>(${loc("chat.byMovement")})</em>`;
  html += `</header>`;

  html += `<ul class="status">`;
  html += `<li>${loc("chat.elapsed", { turns: formation.clock.turnsTotal, time: formatTurns(formation.clock.turnsTotal) })}</li>`;
  if (formation.clock.winded) {
    html += `<li class="bad">${loc("chat.windedStatus")}</li>`;
  } else if (!resting) {
    html += `<li>${loc("chat.restStatus", { n: rest, max: REST_INTERVAL })}</li>`;
  }
  if (isHurried(formation)) html += `<li class="warn">${loc("chat.hurriedStatus")}</li>`;
  for (const light of litLights) {
    const label = game.i18n.localize(LIGHT_SOURCES[light.type]?.label ?? light.type);
    const bearer = game.actors.get(light.bearerId)?.name ?? "?";
    html += `<li>${loc("chat.lightStatus", { light: label, bearer, turns: light.remaining })}</li>`;
  }
  if (!litLights.length) html += `<li class="warn">${loc("chat.noLight")}</li>`;
  for (const spell of formation.spells ?? []) {
    const caster = game.actors.get(spell.casterId)?.name ?? "?";
    html += `<li>${loc("chat.spellStatus", { spell: foundry.utils.escapeHTML(spell.name), caster, turns: spell.remaining })}</li>`;
  }
  html += `</ul>`;

  if (notes.length) {
    html += `<ul class="notes">`;
    for (const note of notes) html += `<li class="${note.type}">${note.text}</li>`;
    html += `</ul>`;
  }
  html += `</div>`;

  const publicCard = game.settings.get(MODULE_ID, "publicTurnCards");
  await ChatMessage.create({
    content: html,
    speaker: { alias: formation.name },
    whisper: publicCard ? [] : gmIds(),
  });
}

/* -------------------------------------------- */
/*  Movement-driven turns                       */
/* -------------------------------------------- */

/**
 * Process a party-token position change: convert the distance to feet,
 * accumulate it, and mark off dungeon turns each time a full exploration
 * move's worth of distance is spent. Straight-line distance between the last
 * processed position and the new one (waypoint drags are approximated).
 */
export async function onPartyTokenMoved(tokenDoc, formationId) {
  const formation = getFormation(formationId);
  if (!formation || formation.clock.paused) return;
  // While members are deployed for combat, camp moves don't consume turns.
  if (formation.combat?.active) return;

  const scene = tokenDoc.parent;
  const last = formation.clock.lastPosition ?? { x: tokenDoc.x, y: tokenDoc.y };
  const dx = tokenDoc.x - last.x;
  const dy = tokenDoc.y - last.y;
  formation.clock.lastPosition = { x: tokenDoc.x, y: tokenDoc.y };
  if (!dx && !dy) return;

  const feet = (Math.hypot(dx, dy) / scene.grid.size) * scene.grid.distance;
  // Hurried parties cover combat speed × 10 rounds per turn (RR p. 263).
  const speed = effectiveSpeed(formation);

  if (speed <= 0) {
    await updateFormation(formation);
    ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.overburdened"));
    return;
  }

  // Rounds, not whole turns: each tenth of an exploration move is a round.
  const roundFeet = speed / ROUNDS_PER_TURN;
  formation.clock.carryFeet = (formation.clock.carryFeet ?? 0) + feet;
  let rounds = 0;
  while (formation.clock.carryFeet >= roundFeet) {
    formation.clock.carryFeet -= roundFeet;
    rounds += 1;
  }
  formation.clock.carryFeet = Math.round(formation.clock.carryFeet * 10) / 10;

  if (rounds > 0) {
    formation.clock.movedThisTurn = true;
    await advanceRounds(formation, rounds, { reason: "movement" });
    if (rounds >= 3 * ROUNDS_PER_TURN) {
      await ChatMessage.create({
        content: `<div class="acks-formation-card"><em>${loc("chat.bigMove", { turns: Math.floor(rounds / ROUNDS_PER_TURN) })}</em></div>`,
        whisper: gmIds(),
        speaker: { alias: formation.name },
      });
    }
  } else {
    await updateFormation(formation);
  }
}

/* -------------------------------------------- */
/*  Lights                                      */
/* -------------------------------------------- */

/**
 * Light a new light source carried by a member, consuming a matching
 * inventory item (torch/candle: the item itself; lantern: a flask of oil).
 */
export async function addLight(formation, type, bearerId) {
  const config = LIGHT_SOURCES[type];
  if (!config) return;
  const bearer = game.actors.get(bearerId);
  if (!bearer) return;

  // Two-way hand check (acks-equipment, optional): a light is held in hand, so
  // lighting one needs a free hand. Degrade-gracefully — no equipment module,
  // no check. This is the reverse of heldLightCount: equipment counts a held
  // light as a used hand, and here we refuse to light with none to hold it.
  //
  // BLOCKING BY DESIGN. Sheathe or stow something first; acks-equipment's own
  // sheet controls (drawItem/sheatheItem) are where a hand is freed. Only the
  // call is defended — a companion module throwing must never break a core
  // mutation, and an unreadable hand count means no check, not a refusal.
  let freeHands;
  try {
    freeHands = globalThis.acksExtras.equipment?.freeHands?.(bearer);
  } catch (err) {
    console.error(`${MODULE_ID} | acks-equipment freeHands failed`, err);
  }
  if (Number.isFinite(freeHands) && freeHands <= 0) {
    ui.notifications.warn(
      game.i18n.has("ACKS-FORMATION.warn.noFreeHand")
        ? game.i18n.format("ACKS-FORMATION.warn.noFreeHand", { bearer: bearer.name })
        : `${bearer.name} has no free hand to hold a light.`,
    );
    return;
  }

  // Equipment requirement (RR p265). "require" (default) blocks lighting without
  // the gear; "warn" lights anyway with a warning; "off" ignores it. A torch/
  // candle IS its own fuel; a lantern needs the lantern (holder, kept) AND a
  // flask of oil (fuel, consumed). A torch supplied as an equipped WEAPON (it is
  // both a light and a 1d4 weapon) is tolerated — quantity-bearing or not.
  const enforcement = game.settings.get(MODULE_ID, "lightItemEnforcement");
  if (enforcement !== "off") {
    const hasQty = (i) => (i.system?.quantity?.value ?? 1) > 0; // non-stackable weapon-torch counts as 1
    const fuel = bearer.items.find((i) => config.consumes.test(i.name) && hasQty(i));
    const missing = [];
    if (config.holder) {
      const holder = bearer.items.find((i) => config.holder.test(i.name));
      if (!holder) missing.push(game.i18n.localize(config.label)); // the lantern device
      if (!fuel) missing.push(game.i18n.localize(config.fuelLabel ?? config.label)); // a flask of oil
    } else if (!fuel) {
      missing.push(game.i18n.localize(config.label)); // the torch/candle itself
    }

    if (missing.length) {
      const msg = game.i18n.has("ACKS-FORMATION.warn.needLightItem")
        ? game.i18n.format("ACKS-FORMATION.warn.needLightItem", { bearer: bearer.name, items: missing.join(", ") })
        : `${bearer.name} needs ${missing.join(", ")} to light this.`;
      ui.notifications.warn(msg);
      if (enforcement === "require") return; // block — no proper equipment
      // "warn": fall through and light anyway
    }

    // Consume one unit of the FUEL, but only when it is a genuine STACK. A
    // stackable light item (a bundle of torches, a flask of oil, candles) has a
    // core `system.quantity` and loses one to the flame. A torch carried as a
    // WEAPON has no quantity field (core weapons don't) — it is a single
    // wielded torch that simply burns out on its own timer, so there is nothing
    // to decrement. A lantern (the reusable device) is never consumed; only its
    // oil is. Reuse acks-equipment's ammunition-tracker decrement when present so
    // fuel burn-down and ammo share one code path.
    if (fuel && fuel.system?.quantity?.value != null) {
      const consume = globalThis.acksExtras.equipment?.consumeItem;
      if (typeof consume === "function") await consume(fuel, 1);
      else await fuel.update({ "system.quantity.value": Math.max(0, fuel.system.quantity.value - 1) });
    }
  }

  const light = {
    id: foundry.utils.randomID(),
    type,
    bearerId,
    remaining: config.turns,
    lit: true,
  };
  formation.lights.push(light);
  await updateFormation(formation);
  lightChanged(bearerId, light, "lit");
  // Lighting with flint and steel takes a full round (RR equipment: tinderbox).
  await advanceRounds(formation, 1, { reason: "action" });
}

export async function removeLight(formation, lightId) {
  const light = formation.lights.find((l) => l.id === lightId);
  formation.lights = formation.lights.filter((l) => l.id !== lightId);
  await updateFormation(formation);
  if (light) lightChanged(light.bearerId, light, "removed");
}

export async function toggleLight(formation, lightId) {
  const light = formation.lights.find((l) => l.id === lightId);
  if (!light) return;
  if (!light.lit && light.remaining <= 0) return;
  light.lit = !light.lit;
  await updateFormation(formation);
  lightChanged(light.bearerId, light, light.lit ? "lit" : "doused");
}

/**
 * Close/open a lantern's shutter (RR equipment: "Lanterns can be closed to
 * conceal the light"): sheds no light but keeps burning oil.
 */
export async function toggleShield(formation, lightId) {
  const light = formation.lights.find((l) => l.id === lightId);
  if (!light || !LIGHT_SOURCES[light.type]?.shieldable) return;
  light.shielded = !light.shielded;
  await updateFormation(formation);
  lightChanged(light.bearerId, light, light.shielded ? "shuttered" : "opened");
}

/**
 * Announce a light-state change so companion modules can react (acks-equipment
 * recomputes hands — a held light occupies one). The module previously fired no
 * custom hooks; this is the first, namespaced per the family rule. Best-effort:
 * a listener throwing must never break the light mutation.
 */
function lightChanged(bearerId, light, state) {
  try {
    const bearer = game.actors.get(bearerId) ?? null;
    Hooks.callAll("acksFormation.lightChanged", bearer, { bearerId, light, state });
  } catch (err) {
    console.error(`${MODULE_ID} | acksFormation.lightChanged listener failed`, err);
  }
}

/* -------------------------------------------- */
/*  Tracked spells                              */
/* -------------------------------------------- */

/**
 * Parse a spell duration string into turns. Handles flat ("6 turns") and
 * per-level ("1 turn/level", "2 turns per caster level") durations, the
 * latter multiplied by the caster's class level from their sheet.
 */
export function parseSpellTurns(duration, casterLevel = 1) {
  const perLevel = /(\d+)\s*turns?\s*(?:\/|per)\s*(?:caster\s*)?level/i.exec(duration ?? "");
  if (perLevel) return Number(perLevel[1]) * Math.max(1, Number(casterLevel) || 1);
  const flat = /(\d+)\s*turn/i.exec(duration ?? "");
  return flat ? Number(flat[1]) : null;
}

/** Track an ongoing spell: counts down 1 per dungeon turn, announced at 1 and 0. */
export async function addSpell(formation, { name, casterId, turns }) {
  if (!name || !(turns > 0)) return;
  formation.spells ??= [];
  formation.spells.push({
    id: foundry.utils.randomID(),
    name,
    casterId: casterId ?? null,
    remaining: Math.floor(turns),
  });
  await updateFormation(formation);
}

export async function removeSpell(formation, spellId) {
  formation.spells = (formation.spells ?? []).filter((s) => s.id !== spellId);
  await updateFormation(formation);
}

export async function adjustSpell(formation, spellId, delta) {
  const spell = (formation.spells ?? []).find((s) => s.id === spellId);
  if (!spell) return;
  spell.remaining = Math.max(1, spell.remaining + delta);
  await updateFormation(formation);
}

/* -------------------------------------------- */
/*  Party saving throws                         */
/* -------------------------------------------- */

/**
 * A save called on the party: every member rolls it automatically against
 * their own sheet's target, posted as one public summary card. The `magical`
 * toggle applies the sheet's "Bonus vs Magic" (`save.mod`) and the WIS
 * modifier — both apply only against magical effects (ACKS II RR).
 */
export async function rollPartySave(formation, save, { magical = true } = {}) {
  const label = game.i18n.localize(`ACKS.saves.${save}.long`);
  const rows = [];
  const rolls = [];
  for (const member of formation.members) {
    const actor = game.actors.get(member.actorId);
    const target = actor?.system?.saves?.[save]?.value;
    if (typeof target !== "number") continue;
    if (isDown(actor)) continue; // the down do not roll
    let bonus = 0;
    if (magical && actor.type === "character") {
      bonus += Number(actor.system.save?.mod ?? 0) + Number(actor.system.scores?.wis?.mod ?? 0);
    }
    const formula = bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20";
    const roll = await new Roll(formula).evaluate();
    rolls.push(roll);
    rows.push({ name: actor.name, total: roll.total, target, success: roll.total >= target });
  }
  if (!rows.length) return;

  let html = `<div class="acks-formation-card party-rolls">`;
  html += `<header><strong>${foundry.utils.escapeHTML(formation.name)}</strong> — ${loc("chat.saveTitle", { save: label })}`;
  html += ` <em>(${game.i18n.localize(magical ? "ACKS-FORMATION.chat.saveMagical" : "ACKS-FORMATION.chat.saveMundane")})</em></header>`;
  html += `<ul class="results">`;
  for (const row of rows) {
    html += `<li class="${row.success ? "good" : "bad"}"><strong>${foundry.utils.escapeHTML(row.name)}</strong>: `;
    html += `${row.total} vs ${row.target}+ — `;
    html += row.success
      ? `<strong>${game.i18n.localize("ACKS-FORMATION.rolls.success")}</strong>`
      : game.i18n.localize("ACKS-FORMATION.rolls.failure");
    html += `</li>`;
  }
  html += `</ul></div>`;
  await ChatMessage.create({ content: html, rolls, speaker: { alias: formation.name } });
}
