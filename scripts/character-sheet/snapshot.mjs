/* global game, canvas, fromUuidSync */
/**
 * Reading a character into the plain snapshot the frame's view-model consumes.
 *
 * This is the only file on the sheet that reads the actor's fields and flags
 * for the BAND AND RAILS. Every read goes through the feature that owns the
 * fact — the loadout for the hands, the light model for what is burning, the
 * senses model for what sees in the dark, the class registry for the XP
 * threshold — so the rails show what the rest of the module computes and never
 * a second reading of the same flag. The tab panels read through their own
 * builders under `tabs/`.
 */
import { MODULE_ID, SHEET_FLAG, SUMMON_FLAG, CONDITION_SAVES, RAIL_CONDITIONS, SAVE_KEYS } from "./constants.mjs";
import { FLAG_RECORD } from "../henchmen/constants.mjs";
import { realMembers } from "../formation/formation-model.mjs";
import { getLoadout } from "../equipment/loadout.mjs";
import { bearerLights, LIGHT_SOURCES } from "../lib/light.mjs";
import { senseProfile, VISION_MODES } from "../lib/senses.mjs";
import { classForActor } from "../classes/registry.mjs";
import { pendingChoices } from "../classes/pending-choices.mjs";
import { unansweredGroups, actorPaths } from "../classes/paths.mjs";
import { poolState } from "../classes/casting.mjs";
import { isLanguageSlots, freeSlots } from "../classes/languages.mjs";
import { FLAG_MONSTER_LIST } from "../henchmen/constants.mjs";
import { BOOK_TO_RELEASED_SAVES } from "../lib/actor-compat.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The sheet's own actor flag, always an object. */
export const sheetFlag = (actor) => actor?.getFlag?.(MODULE_ID, SHEET_FLAG) ?? {};

/**
 * The key the RELEASED system stores a save under, from the sheet's book
 * vocabulary (`blast` is stored as `breath`): the lib's one mapping, whose
 * book key for Spells is the plural.
 */
export const saveSystemKey = (bookKey) => BOOK_TO_RELEASED_SAVES[bookKey === "spell" ? "spells" : bookKey] ?? bookKey;

/** The book key a released save key answers to, or null for one the sheet does not show. */
export const saveBookKey = (systemKey) => SAVE_KEYS.find((k) => saveSystemKey(k) === systemKey) ?? null;

/** A save's printed name: the system's own label under either key, else the sheet's. */
export function saveLabel(bookKey) {
  for (const key of [`ACKS.saves.${saveSystemKey(bookKey)}.long`, `ACKS.saves.${bookKey}.long`]) {
    if (game.i18n.has(key)) return game.i18n.localize(key);
  }
  return game.i18n.localize(`ACKS-CHARACTER.save.${bookKey}`);
}

/** The save key a free-text `save` field names, or null. */
export function saveKeyOf(text) {
  const t = String(text ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return null;
  if (t.startsWith("paraly")) return "paralysis";
  if (t.startsWith("death") || t.startsWith("poison")) return "death";
  if (t.startsWith("blast") || t.startsWith("breath")) return "blast";
  if (t.startsWith("implement") || t.startsWith("wand") || t.startsWith("staff")) return "implements";
  if (t.startsWith("spell") || t.startsWith("magic")) return "spell";
  return null;
}

/**
 * A compact clock for an effect's duration: rounds as `3r`, turns as `2t`,
 * seconds as minutes, hours or days. An effect with no duration reads as `—`.
 *
 * Read off the SOURCE duration for the unit, because Foundry's prepared
 * duration restates a rounds-or-turns effect in seconds whenever no combat
 * is running; what is left is then the prepared `remaining`, converted back
 * through the world's round and turn lengths.
 * @returns {{clock: string, remaining: number|null, total: number}}
 */
export function effectClock(effect) {
  const src = effect?._source?.duration ?? effect?.duration ?? {};
  const d = effect?.duration ?? {};
  const units = d.units ?? d.type ?? "none";
  const prepared = Number.isFinite(d.remaining) ? Math.max(0, d.remaining) : null;
  const time = globalThis.CONFIG?.time ?? {};
  const inUnit = (per) => (prepared == null ? null : units === "seconds" && per > 0 ? prepared / per : prepared);
  if (num(src.rounds) > 0) {
    const total = num(src.rounds);
    const left = inUnit(num(time.roundTime, 0));
    return { clock: `${Math.ceil(left ?? total)}r`, remaining: left, total };
  }
  if (num(src.turns) > 0) {
    const total = num(src.turns);
    const left = inUnit(num(time.turnTime, 0));
    return { clock: `${Math.ceil(left ?? total)}t`, remaining: left, total };
  }
  if (num(src.seconds) > 0 || (units === "seconds" && num(d.seconds) > 0)) {
    const total = num(src.seconds) || num(d.seconds);
    const left = prepared ?? total;
    const clock = left >= 86400 ? `${Math.ceil(left / 86400)}d` : left >= 3600 ? `${Math.ceil(left / 3600)}h` : `${Math.ceil(left / 60)}m`;
    return { clock, remaining: left, total };
  }
  return { clock: "—", remaining: null, total: 0 };
}

/** Is this effect a timer — something with a duration that runs down? */
export const isTimer = (effect) => !effect?.disabled && effectClock(effect).total > 0;

/**
 * The conditions riding on a save: every enabled effect whose status ids map
 * to a save, or whose origin item names one.
 */
export function saveRiders(actor) {
  const riders = [];
  for (const effect of actor.appliedEffects ?? []) {
    if (effect.disabled) continue;
    const statuses = [...(effect.statuses ?? [])];
    let save = statuses.map((s) => CONDITION_SAVES[s]).find(Boolean) ?? null;
    if (!save && effect.origin) {
      let origin = null;
      try {
        origin = fromUuidSync(effect.origin);
      } catch {
        origin = null;
      }
      // Only a condition rides: an origin item names a save, but the effect
      // must also be a status or a timer, or every buff a spell grants would
      // sit on the rail as a harm.
      if (statuses.length || isTimer(effect)) save = saveKeyOf(origin?.system?.save);
    }
    if (!save) continue;
    const { clock, remaining, total } = effectClock(effect);
    riders.push({ id: effect.id, save, statuses, name: effect.name, img: effect.img, clock, remaining, total });
  }
  return riders;
}

/**
 * The signed modifier in force on each save: the all-save modifier plus any
 * ADD change to that save's own value, read off the applied effects.
 */
export function saveModifiers(actor) {
  const out = Object.fromEntries(SAVE_KEYS.map((k) => [k, 0]));
  const ADD = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;
  for (const effect of actor.appliedEffects ?? []) {
    if (effect.disabled) continue;
    for (const change of effect.changes ?? []) {
      if (Number(change.mode) !== ADD) continue;
      const value = Number(change.value);
      if (!Number.isFinite(value) || !value) continue;
      if (change.key === "system.save.mod") for (const k of SAVE_KEYS) out[k] += value;
      const m = /^system\.saves\.([a-z]+)\.value$/.exec(change.key ?? "");
      const book = m ? saveBookKey(m[1]) : null;
      // A change that LOWERS the target helps the throw; the cell states the
      // help as a positive number, the way a player reads it.
      if (book) out[book] -= value;
    }
  }
  return out;
}

/** Statuses on the actor that ride on a right-rail cell instead of a save. */
export function railConditions(actor) {
  const out = { move: [], hp: [], light: [] };
  for (const status of actor.statuses ?? []) {
    const cell = RAIL_CONDITIONS[status];
    if (cell) out[cell].push(status);
  }
  return out;
}

/**
 * Where this character stands, by light: "day" when the scene it is on is
 * lit, "dark" when it is not, null when it is on no scene at all.
 */
function ambientLight(actor) {
  let scene = null;
  try {
    const token = actor.getActiveTokens?.(true, true)?.[0] ?? null;
    scene = token?.parent ?? (actor.isToken ? actor.token?.parent : null) ?? canvas?.scene ?? null;
  } catch {
    scene = null;
  }
  if (!scene) return null;
  const darkness = num(scene.environment?.darknessLevel ?? scene.darkness, 0);
  return darkness < 0.5 ? "day" : "dark";
}

/** The brightest light this character is carrying lit and unshuttered, with its burn-down. */
function litSource(actor) {
  let best = null;
  for (const light of bearerLights(actor)) {
    if (!light?.lit || light.shielded) continue;
    const cfg = LIGHT_SOURCES[light.type];
    if (!cfg) continue;
    if (!best || cfg.dim > best.reach) {
      best = { id: light.id, type: light.type, reach: cfg.dim, turns: cfg.turns, remaining: Number.isFinite(light.remaining) ? light.remaining : null };
    }
  }
  return best;
}

/** The dark-sense this character sees by, if any: its kind and its reach. */
function darkSense(actor) {
  const profile = senseProfile(actor);
  if (!profile.seesInDark || !(profile.sightRange > 0)) return null;
  const kind = profile.visionMode === VISION_MODES.SHADOWY ? "shadowy" : "lightless";
  return { kind, range: profile.sightRange };
}

/**
 * Read the actor into the frame snapshot (shape documented in view-model.mjs).
 */
export function snapshotFrame(actor) {
  const sys = actor.system ?? {};
  const classItem = classForActor(actor);
  const level = Math.max(1, num(sys.details?.level, 1));
  const threshold = classItem ? classItem.system.nextXp?.(level) : null;

  const loadout = getLoadout(actor);
  const conditions = railConditions(actor);

  const monsters = (actor.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? []).filter((id) => game.actors.get(id)?.type === ACTOR_TYPE.monster);
  const hirelings = Object.values(actor.getHirelings?.() ?? {}).reduce((n, list) => n + (list?.length ?? 0), 0);

  const timers = (actor.appliedEffects ?? []).filter(isTimer).length + bearerLights(actor).filter((l) => l?.lit).length;
  const openLanguageSlots = actor.items.filter(isLanguageSlots).reduce((n, i) => n + num(freeSlots(i)), 0);

  return {
    id: actor.id,
    name: actor.name,
    img: actor.img,
    cls: {
      bound: !!classItem,
      name: classItem?.name ?? String(sys.details?.class ?? ""),
      img: classItem?.img ?? null,
      level,
      title: String(sys.details?.title ?? ""),
    },
    xp: { value: num(sys.details?.xp?.value), next: threshold ?? num(sys.details?.xp?.next), bonus: num(sys.details?.xp?.bonus) },
    hp: { value: num(sys.hp?.value), max: num(sys.hp?.max) },
    ac: { value: num(sys.aac?.value), shield: num(sys.aac?.shield), naked: num(sys.aac?.naked) },
    acMode: sheetFlag(actor).acMode ?? "shield",
    move: {
      modes: Object.fromEntries(Object.entries(sys.movementacks ?? {}).map(([k, v]) => [k, num(v)])),
      pct: num(sys.encumbrance?.pct),
      breakpoints: sys.encumbrance?.breakpoints ?? { low: 0, mid: 0, high: 100 },
      conditions: conditions.move,
    },
    grip: {
      weapons: loadout.weapons.map((w) => ({ id: w.item.id, name: w.item.name, twoHanded: !!w.wieldTwoHanded, canTwoHand: !!w.canTwoHand, grip: w.grip, blocked: !!w.gripBlocked })),
      shieldInHand: (loadout.handShields?.length ?? 0) > 0,
      cleaves: num(sys.fight?.cleaves),
      handsUsed: loadout.handsUsed,
      handBudget: loadout.handBudget,
    },
    light: {
      lit: litSource(actor),
      ambient: ambientLight(actor),
      sense: darkSense(actor),
      blinded: conditions.light.length > 0,
    },
    saves: Object.fromEntries(SAVE_KEYS.map((k) => [k, num(sys.saves?.[saveSystemKey(k)]?.value)])),
    riders: saveRiders(actor),
    saveMods: saveModifiers(actor),
    hpConditions: conditions.hp,
    formation: formationOf(actor),
    party: partyOf(actor),
    caster: !!sys.spells?.enabled || poolState(actor).length > 0,
    pending: pendingChoices(actor).length + openLanguageSlots,
    followers: hirelings + monsters.length,
    timers,
    hasClass: !!classItem,
    unansweredPaths: classItem ? unansweredGroups(classItem.system, actorPaths(actor)).length : 0,
    pins: Array.isArray(sheetFlag(actor).pins) ? sheetFlag(actor).pins : [],
    retainer: !!sys.retainer?.enabled,
  };
}

/** The party this character marches in, through the formation feature's own read. */
export function formationOf(actor) {
  const f = globalThis.acksExtras?.formation?.getFormationForActor?.(actor.id) ?? null;
  return f ? { id: f.id, name: f.name ?? f.label ?? "" } : null;
}

/** The scene the party cell counts on: the one on the canvas, else the world's active one. */
export const currentScene = () => canvas?.scene ?? game.scenes?.active ?? null;

/** The character a creature was summoned by, as the actor uuid its flag names, or null. */
export const summonerOf = (actor) => actor?.getFlag?.(MODULE_ID, SUMMON_FLAG) ?? null;

/** The ids of every henchman of this character: the system's list and the module's monster list. */
export function henchmanIds(actor) {
  return [...new Set([...(actor.system?.henchmenList ?? []), ...(actor.getFlag(MODULE_ID, "monsterHenchmenList") ?? [])])];
}

/**
 * The character's own party, and who of it is on the scene: the henchmen
 * (with a pending calamity read off the henchmen record), the summons (tokens
 * whose actor names this character as summoner), and the formation with
 * whether its party token is on this scene and how many of its members are.
 */
export function partyOf(actor) {
  const scene = currentScene();
  const tokens = scene ? [...scene.tokens] : [];
  const tokensOf = (id) => tokens.filter((t) => t.actorId === id);
  const henchmen = henchmanIds(actor)
    .map((id) => game.actors.get(id))
    .filter(Boolean)
    .map((h) => {
      const mine = tokensOf(h.id);
      return {
        id: h.id,
        name: h.name,
        img: h.img,
        type: h.type,
        onScene: mine.length > 0,
        tokenIds: mine.map((t) => t.id),
        calamity: !!h.getFlag(MODULE_ID, FLAG_RECORD)?.special?.pendingCalamity,
      };
    });
  const summons = tokens
    .filter((t) => summonerOf(t.actor) === actor.uuid)
    .map((t) => ({ tokenId: t.id, name: t.name, img: t.texture?.src ?? t.actor?.img ?? null }));

  let formation = null;
  const record = globalThis.acksExtras?.formation?.getFormationForActor?.(actor.id) ?? null;
  if (record) {
    const memberIds = realMembers(record).map((m) => m.actorId);
    formation = {
      id: record.id,
      name: record.name ?? "",
      onScene: !!scene && record.sceneId === scene.id,
      membersOnScene: memberIds.filter((id) => tokensOf(id).length > 0).length,
    };
  }
  return {
    scene: scene?.name ?? null,
    henchmen,
    summons,
    formation,
    calamity: henchmen.filter((h) => h.calamity).length,
  };
}
