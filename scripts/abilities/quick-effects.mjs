/* global game */
/**
 * Quick effects: an Active Effect the Judge starts from one imported modifier
 * row, on the character's own copy of the ability, carrying that row's figure
 * at the holder's level and rank.
 *
 * It is the route for a row the sheet does not apply by itself (situational,
 * a gate that is not met or cannot be judged, a scope settled at the roll),
 * and the way to pin a standing one. While it is enabled it is the ability's
 * own effect on that field, so the imported row stands aside
 * (`lib/typed-modifiers.mjs`) and the figure counts once. A row that does not
 * apply by itself is created DISABLED: the Judge turns it on when the
 * circumstance holds. Deleting the ability deletes the effect with it.
 *
 * The effect remembers the row it came from (`flags.acks-extras.quickEffect`:
 * the row's `specKey`, its target, the value and the level and rank it was
 * resolved at), so the sheet can say it is stale when the level, the rank or
 * the row changed, and Refresh rewrites it in one update.
 */
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import { DISPOSITION, modifierDisposition, modifierPaths, modifierValue, specKey } from "../lib/typed-modifiers.mjs";

/** The flag key, under `flags["acks-extras"]`, a quick effect carries. */
export const QUICK_FLAG = "quickEffect";

/** Dispositions a quick effect may be started from; the rest have no field or another reader. */
const STARTABLE = new Set([DISPOSITION.STANDING, DISPOSITION.GATED, DISPOSITION.SITUATIONAL, DISPOSITION.AT_ROLL]);

const extrasOf = (item) => item?.getFlag?.(MODULE_ID, FLAG_EXTRAS) ?? item?.flags?.[MODULE_ID]?.[FLAG_EXTRAS] ?? null;

/**
 * What a quick effect for row `index` of `item` would write, or null when the
 * row offers none: no owning actor, not a modifier, a disposition with no
 * field, or a value that does not resolve. Pure over its inputs.
 *
 * @returns {{key: string, target: string, changes: object[], value: number, level: number, rank: number, startsOff: boolean}|null}
 */
export function quickEffectPlan(item, index) {
  const actor = item?.actor ?? item?.parent ?? null;
  const spec = extrasOf(item)?.effects?.[index];
  if (!actor || spec?.type !== "modifier") return null;
  const disposition = modifierDisposition(spec, { actorType: actor.type });
  if (!disposition || !STARTABLE.has(disposition.kind)) return null;
  // A row narrowed by scope still names its field; the effect writes that.
  const paths = disposition.paths.length ? disposition.paths : modifierPaths(spec, actor.type);
  if (!paths.length) return null;
  const { value, level, rank } = modifierValue(actor, item, spec);
  if (value === null || value === 0) return null;
  return {
    key: specKey(spec),
    target: String(spec.target ?? ""),
    changes: paths.map((p) => ({ key: p.path, type: p.type, value: String(value), priority: 20 })),
    value,
    level,
    rank,
    startsOff: disposition.kind !== DISPOSITION.STANDING,
  };
}

/** The quick effect already on `item` for the row with `key`, or null. */
export function findQuickEffect(item, key) {
  for (const effect of [...(item?.effects ?? [])]) {
    const flag = effect?.getFlag?.(MODULE_ID, QUICK_FLAG) ?? effect?.flags?.[MODULE_ID]?.[QUICK_FLAG];
    if (flag?.key === key) return effect;
  }
  return null;
}

/**
 * The state of row `index`'s quick effect: `null` when the row offers none,
 * else `{state, effect, plan}` where `state` is "none" (offered, not started),
 * "on", "off", or "stale" (started at another value, level or rank).
 */
export function quickEffectStatus(item, index) {
  const plan = quickEffectPlan(item, index);
  if (!plan) return null;
  const effect = findQuickEffect(item, plan.key);
  if (!effect) return { state: "none", effect: null, plan };
  const flag = effect.getFlag?.(MODULE_ID, QUICK_FLAG) ?? effect.flags?.[MODULE_ID]?.[QUICK_FLAG] ?? {};
  const stale = flag.value !== plan.value || flag.level !== plan.level || flag.rank !== plan.rank;
  return { state: stale ? "stale" : effect.disabled ? "off" : "on", effect, plan };
}

/** The effect's name: the ability's, the field's, and whether it starts off. */
function effectName(item, plan) {
  const target = game.i18n.localize(TARGET_KEYS[plan.target] ?? "ACKS-ABILITIES.quick.target.other");
  return game.i18n.format(plan.startsOff ? "ACKS-ABILITIES.quick.nameOff" : "ACKS-ABILITIES.quick.name", { name: item.name, target });
}

/** The lang key naming each target a quick effect can write. */
const TARGET_KEYS = {
  ac: "ACKS-ABILITIES.quick.target.ac",
  save: "ACKS-ABILITIES.quick.target.save",
  initiative: "ACKS-ABILITIES.quick.target.initiative",
  surprise: "ACKS-ABILITIES.quick.target.surprise",
  cleaves: "ACKS-ABILITIES.quick.target.cleaves",
  attackThrow: "ACKS-ABILITIES.quick.target.attackThrow",
  damage: "ACKS-ABILITIES.quick.target.damage",
};

const flagOf = (plan) => ({ key: plan.key, target: plan.target, value: plan.value, level: plan.level, rank: plan.rank });

/**
 * Start row `index`'s quick effect on the character's copy. A row that does
 * not apply by itself starts disabled. Resolves to the created effect, or
 * null when the row offers none or one is already started.
 */
export async function startQuickEffect(item, index) {
  const status = quickEffectStatus(item, index);
  if (!status || status.state !== "none") return null;
  const { plan } = status;
  const [created] = await item.createEmbeddedDocuments("ActiveEffect", [
    {
      name: effectName(item, plan),
      img: item.img,
      transfer: true,
      disabled: plan.startsOff,
      changes: plan.changes,
      flags: { [MODULE_ID]: { [QUICK_FLAG]: flagOf(plan) } },
    },
  ]);
  return created ?? null;
}

/**
 * Rewrite a stale quick effect at the row's current value, level and rank, in
 * one update; its enabled state is the Judge's and is kept. Resolves to the
 * effect, or null when there is nothing stale to refresh.
 */
export async function refreshQuickEffect(item, index) {
  const status = quickEffectStatus(item, index);
  if (!status || status.state !== "stale") return null;
  const { plan, effect } = status;
  await effect.update({ changes: plan.changes, [`flags.${MODULE_ID}.${QUICK_FLAG}`]: flagOf(plan) });
  return effect;
}

/** The row a clicked control names, from its `data-effect-index`. */
const rowOf = (target) => Number(target?.dataset?.effectIndex);

/**
 * The ability sheet's actions, bound to the sheet (`this.item`): Start and
 * Refresh on a modifier row of the Mechanics tab.
 */
export const QUICK_EFFECT_ACTIONS = {
  async quickEffectStart(event, target) {
    const index = rowOf(target);
    if (!Number.isInteger(index) || !this.isEditable) return;
    await startQuickEffect(this.item, index);
  },
  async quickEffectRefresh(event, target) {
    const index = rowOf(target);
    if (!Number.isInteger(index) || !this.isEditable) return;
    await refreshQuickEffect(this.item, index);
  },
};
