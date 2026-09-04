/* global game, fromUuidSync */
/**
 * The Effects tab's data: what is burning and what is blessing you (timers,
 * each with its bar in the tone of what it is), what is riding on a save,
 * what the module manages and a hand cannot delete, the counts a player
 * checks between fights (resources), and the modifiers in force.
 */
import { MODULE_ID, LANG, CONDITION_SAVES, RAIL_CONDITIONS } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { isManagedEffect } from "../../lib/managed-effects.mjs";
import { bearerLights, LIGHT_SOURCES } from "../../lib/light.mjs";
import { poolState } from "../../classes/casting.mjs";
import { trainingEffects } from "../../classes/training.mjs";
import { effectClock, isTimer, saveRiders, sheetFlag, saveLabel } from "../snapshot.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** A one-line reading of an effect's changes: `system.aac.mod +1 · …`. */
function changesLine(effect) {
  return (effect.changes ?? [])
    .slice(0, 4)
    .map((c) => `${String(c.key).replace(/^system\./, "").replace(/^flags\.acks-extras\./, "")} ${c.value}`)
    .join(" · ");
}

/** The tone a timer wears: mundane, magic, negative or positive. */
function toneOf(effect) {
  const statuses = [...(effect.statuses ?? [])];
  if (statuses.some((s) => CONDITION_SAVES[s] || RAIL_CONDITIONS[s])) return "neg";
  let origin = null;
  try {
    origin = effect.origin ? fromUuidSync(effect.origin) : null;
  } catch {
    origin = null;
  }
  if (origin?.type === ITEM_TYPE.spell) return "ts";
  return "pos";
}

/** Build the tab's data. */
export function buildEffectsTab(actor) {
  const pins = new Set(sheetFlag(actor).pins ?? []);
  const effects = [...(actor.effects ?? [])];
  const riderIds = new Set(saveRiders(actor).map((r) => r.id));
  const lights = bearerLights(actor);

  const timers = [];
  for (const light of lights) {
    if (!light?.lit) continue;
    const cfg = LIGHT_SOURCES[light.type];
    const turns = num(cfg?.turns);
    const remaining = Number.isFinite(light.remaining) ? light.remaining : null;
    timers.push({
      id: `light:${light.id}`,
      kind: "light",
      lightId: light.id,
      name: game.i18n.localize(cfg?.label ?? light.type),
      icon: light.type === "lantern" ? "fa-solid fa-lightbulb" : "fa-solid fa-fire-flame-curved",
      line: remaining == null ? loc("effects.burning") : loc("effects.burningLeft", { left: remaining, of: turns }),
      pct: turns > 0 && remaining != null ? Math.round((remaining / turns) * 100) : 100,
      tone: "tm",
      shielded: !!light.shielded,
      shieldable: light.type === "lantern",
      pinned: pins.has(`light:${light.id}`),
    });
  }
  for (const effect of effects) {
    if (!isTimer(effect) || isManagedEffect(effect)) continue;
    const { clock, remaining, total } = effectClock(effect);
    timers.push({
      id: `timer:${effect.id}`,
      kind: "effect",
      effectId: effect.id,
      name: effect.name,
      img: effect.img,
      line: [clock, changesLine(effect)].filter(Boolean).join(" · "),
      pct: total > 0 && remaining != null ? Math.round((remaining / total) * 100) : 100,
      tone: toneOf(effect),
      rider: riderIds.has(effect.id),
      pinned: pins.has(`timer:${effect.id}`),
      disabled: !!effect.disabled,
    });
  }

  const riders = saveRiders(actor).map((r) => ({ ...r, saveLabel: saveLabel(r.save) }));

  // A training row's control goes to Stats, the one editor of what it holds;
  // core's effect config is a text field for the storage format.
  const trainingIds = new Set(trainingEffects(actor).map((e) => e.id));
  const managed = effects
    .filter(isManagedEffect)
    .map((e) => ({ id: e.id, name: e.name, img: e.img, line: changesLine(e), disabled: !!e.disabled, training: trainingIds.has(e.id) }));

  const modifiers = effects
    .filter((e) => !isTimer(e) && !isManagedEffect(e))
    .map((e) => ({ id: e.id, name: e.name, img: e.img, line: changesLine(e), disabled: !!e.disabled, statuses: [...(e.statuses ?? [])] }));

  const stacks = (pattern, exclude = null) =>
    actor.items
      .filter((i) => i.type === ITEM_TYPE.item && pattern.test(i.name) && !(exclude && exclude.test(i.name)))
      .reduce((n, i) => n + num(i.system?.quantity?.value), 0);
  const resources = [
    { key: "rations", name: loc("effects.res.rations"), icon: "fa-solid fa-bread-slice", count: stacks(/ration/i), line: loc("effects.res.rationsLine") },
    { key: "oil", name: loc("effects.res.oil"), icon: "fa-solid fa-flask", count: stacks(/\boil\b/i, /military/i), line: loc("effects.res.oilLine") },
    { key: "torches", name: loc("effects.res.torches"), icon: "fa-solid fa-fire-flame-curved", count: stacks(/torch/i), line: loc("effects.res.torchesLine") },
    { key: "fate", name: game.i18n.localize("ACKS.details.fate"), icon: "fa-solid fa-star", count: num(actor.system?.details?.fatepoints), line: loc("effects.res.fateLine"), adjustable: true },
  ].map((r) => ({ ...r, pinned: pins.has(`res:${r.key}`), id: `res:${r.key}` }));
  const pools = poolState(actor);
  if (pools.length) {
    for (const t of pools) {
      const line = t.slots ? t.slots.map((s) => `${s.n}: ${s.max - s.used}/${s.max}`).join(" · ") : t.pool ? `${t.pool.max - t.pool.used}/${t.pool.max}` : t.capacity ?? "";
      const left = t.slots ? t.slots.reduce((n, s) => n + (s.max - s.used), 0) : t.pool ? t.pool.max - t.pool.used : null;
      resources.push({ key: `pool-${t.key}`, id: `res:pool-${t.key}`, name: t.label, icon: "fa-solid fa-wand-magic-sparkles", count: left, line, pinned: pins.has(`res:pool-${t.key}`) });
    }
  }

  return { timers, riders, managed, resources, modifiers, editable: actor.isOwner, count: timers.length };
}
