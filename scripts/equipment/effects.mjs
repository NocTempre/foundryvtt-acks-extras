/* global game, foundry */
/**
 * Data-driven modifier discovery + the module-managed "Equipment Loadout"
 * Active Effect.
 *
 * Mechanics live as Active Effect changes keyed `flags.acks-extras.<domain>`
 * on `ability`/`weapon`/`armor` items (mirrors acks-henchmen). The collector
 * below reads them. The loadout AE translates the applicable ones — plus the
 * abilities' typed modifiers and the style and helmet figures the import
 * holds — into changes on the real
 * core fields (`system.ac.mod`, `system.initiative.mod`, `system.attack.mod.*`,
 * `system.damage.mod.melee`) so core's own AC computation and attack throw
 * consume them with zero patching.
 */
import { EFFECT_PREFIX, MODULE_ID, EFFECT_DOMAINS, LOADOUT_EFFECT_NAME, LOADOUT_EFFECT_FLAG, LOADOUT_EFFECT_ID, LOADOUT_PARTS_FLAG } from "./constants.mjs";
import { STYLE } from "./config.mjs";
import { shieldACCorrection, specApplies } from "./overlays/shield-variants.mjs";
import { HELM_TABLE, enclosingHelmActive, helmFigures } from "./overlays/enclosing-helm.mjs";
import { RULEDATA_DOC } from "./overlays/scavenged.mjs";
import { PRIORITY, citeOf, getDoc, getLayer, hasDoc } from "../lib/tables.mjs";
import { bridgeContributions } from "./abilities-bridge.mjs";
import { appliedEffects, makeEffectMeta, activeNumericChanges, csvFlagSet, sumModifiers } from "../lib/effect-scan.mjs";
import { standingModifiers, registerGate } from "../lib/typed-modifiers.mjs";
import { lightlyEquipped } from "./proficiency.mjs";
import { managedDelete } from "../lib/managed-effects.mjs";

const effectMeta = makeEffectMeta(MODULE_ID);

/**
 * Collect every modifier an actor's effects contribute to one numeric domain.
 * @returns {{id,label,value,situational,condition,source}[]}
 */
export function collectEffectModifiers(actor, domain) {
  const found = [];
  for (const { effect, value } of activeNumericChanges(actor, `${EFFECT_PREFIX}${domain}`)) {
    const meta = effectMeta(effect);
    found.push({
      id: `fx-${effect.id ?? foundry.utils.randomID()}-${domain}`,
      label: meta.target ? `${meta.label} (${meta.target})` : meta.label,
      value,
      situational: !!meta.condition,
      condition: meta.condition,
      source: "effect",
    });
  }
  // Abilities-modelled items contribute through the bridge (never both ways —
  // the bridge stands aside for items carrying native effect changes).
  for (const c of bridgeContributions(actor).numeric.get(domain) ?? []) {
    found.push({
      id: `bridge-${domain}-${found.length}`,
      label: c.label,
      value: c.value,
      situational: false,
      condition: null,
      source: "abilities",
    });
  }
  return found;
}

/** Sum the always-on (non-situational) modifiers of a numeric domain. */
export function sumEffectModifiers(actor, domain) {
  return sumModifiers(collectEffectModifiers(actor, domain));
}

/** True when any active effect — or a bridged ability — contributes to the domain.
 * A raw key scan by design (any change, even zero-valued, counts) — unlike
 * henchmen's collector-backed variant. */
export function hasEffectFlag(actor, domain) {
  const key = `${EFFECT_PREFIX}${domain}`;
  for (const effect of appliedEffects(actor)) {
    if (effect.disabled) continue;
    if ((effect.changes ?? []).some((c) => c.key === key)) return true;
  }
  const bridged = bridgeContributions(actor);
  return bridged.booleans.has(domain) || bridged.numeric.has(domain) || bridged.strings.has(domain);
}

/** Collect CSV string flags of a domain into a lowercased Set. */
export function collectStringFlags(actor, domain) {
  const out = csvFlagSet(actor, `${EFFECT_PREFIX}${domain}`);
  for (const token of bridgeContributions(actor).strings.get(domain) ?? []) out.add(token);
  return out;
}

// The gates the loadout can decide: how heavily the character is dressed and
// which fighting style it fights in. Lazy reads, so the cycle with
// proficiency.mjs (which reads this file's collectors) resolves at call time.
registerGate("lightlyEquipped", (actor, gate, ctx) => (ctx.loadout ? lightlyEquipped(actor, ctx.loadout, gate) : null));
registerGate("activeStyle", (actor, gate, ctx) => {
  if (!gate.style || !ctx.loadout) return null;
  return String(ctx.loadout.activeStyle ?? "").toLowerCase() === String(gate.style).toLowerCase();
});
// The active style, and the character specialized in it: Fighting Style
// Specialization's bonuses (RR ch. 3) stand on the one style a pick names,
// read from the trained styles every copy contributes. The Weapon and Shield
// bonus is withheld where the shield variant says the shield cannot take it.
registerGate("specializedStyle", (actor, gate, ctx) => {
  if (!gate.style || !ctx.loadout) return null;
  const style = String(gate.style).toLowerCase();
  if (String(ctx.loadout.activeStyle ?? "").toLowerCase() !== style) return false;
  if (!specializedIn(actor).has(style)) return false;
  return style === STYLE.WEAPON_SHIELD.toLowerCase() ? specApplies(ctx.loadout) : true;
});

/** The styles a character is specialized in, lowercased: the `<style>:spec` tokens of its trained styles. */
function specializedIn(actor) {
  const out = new Set();
  for (const s of collectStringFlags(actor, EFFECT_DOMAINS.STYLE_PROFICIENT)) {
    const [style, kind] = s.split(":");
    if (kind === "spec") out.add(style);
  }
  return out;
}

/** The equipment table the dual weapon style's attack modifier is imported into (RR ch. 10, "Fighting Style"). */
export const DUAL_STYLE_TABLE = "dualWeaponStyle";

/**
 * The dual weapon style's attack modifier as the Judge's import holds it, or
 * null until imported; nothing applies in its place.
 */
export function dualStyleFigure() {
  const raw = hasDoc(RULEDATA_DOC) ? getDoc(RULEDATA_DOC)?.tables?.[DUAL_STYLE_TABLE]?.attack : null;
  if (raw == null || raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/**
 * Where a ledger part's figure was read, at render: `{judge: true}` where the
 * Judge's own edit holds the table the part names, `{cite}` where the import
 * recorded the page it read, or null for a part that names no table or a
 * table with no page recorded.
 */
export function partSource(part) {
  if (!part?.table) return null;
  if (getLayer(RULEDATA_DOC, PRIORITY.OVERRIDE)?.tables?.[part.table] != null) return { judge: true };
  const cite = citeOf(RULEDATA_DOC, part.table);
  return cite ? { cite } : null;
}

/**
 * Compute the loadout Active Effect changes for the current loadout.
 * Returns AE `changes` entries; `buildLoadoutParts` adds the ledger naming
 * each one.
 * @param {Actor} actor
 * @param {import("./loadout.mjs").Loadout} loadout
 */
export function buildLoadoutChanges(actor, loadout) {
  return buildLoadoutParts(actor, loadout).changes;
}

/**
 * The loadout effect's changes with the ledger that names them: `parts[i]`
 * says what wrote `changes[i]` (`{label}` for a named source, `{labelKey}`
 * for one of this feature's own rules, plus `itemId`, `unverified` and
 * `gated` for an ability's typed modifier). Every change is its own
 * contribution, so a tooltip can name each ability with its figure.
 * @param {Actor} actor
 * @param {import("./loadout.mjs").Loadout} loadout
 * @returns {{changes: object[], parts: object[]}}
 */
export function buildLoadoutParts(actor, loadout) {
  // v14: an AE change carries a string `type` (a key of
  // CONST.ACTIVE_EFFECT_CHANGE_TYPES; the enum's numbers are default
  // priorities). The old numeric `mode` survives only as a compatibility shim
  // whose SETTER does Number(mode) — so writing mode:"add" yields NaN and never
  // sets type at all. Write `type` directly.
  const ADD = "add";
  const changes = [];
  const parts = [];
  // Every change is priority 20, so the order Foundry applies them is document
  // order and `parts[i]` stays beside `changes[i]`.
  const write = (key, type, value, part) => {
    if (!value) return;
    changes.push({ key, type, value: String(value), priority: 20 });
    parts.push(part);
  };
  // A rule whose figure is an imported table names it, so a tooltip can cite the page at render.
  const rule = (labelKey, table) => (table ? { labelKey, table } : { labelKey });
  const add = (key, value, part = rule("ACKS-EQUIPMENT.part.rule")) => write(key, ADD, value, part);
  const domain = (key, dom) => {
    for (const m of collectEffectModifiers(actor, dom)) if (!m.situational) add(key, m.value, { label: m.label });
  };

  // Fighting Style Specialization's bonuses are the proficiency's own typed
  // modifiers, gated `specializedStyle`, and arrive with the abilities' parts
  // below. The specialized styles still decide the shield correction.
  const spec = specializedIn(actor);

  // The dual weapon style's own modifier (RR ch. 10, "Fighting Style"):
  // independent of Specialization, whose bonus adds to it. Untrained use still
  // takes the non-proficiency penalty, applied per-weapon in attack-mods.mjs.
  if (loadout.activeStyle === STYLE.DUAL) add("system.attack.mod.melee", dualStyleFigure(), rule("ACKS-EQUIPMENT.part.dualWield", DUAL_STYLE_TABLE));

  // Hand-made domain effects that are NOT style-gated, one change per effect.
  domain("system.initiative.mod", EFFECT_DOMAINS.STYLE_INIT);
  domain("system.attack.mod.melee", EFFECT_DOMAINS.STYLE_ATTACK_MELEE);
  domain("system.attack.mod.missile", EFFECT_DOMAINS.STYLE_ATTACK_MISSILE);
  // The one outlet for this domain — an ability, a hand-made Active Effect
  // (see docs/equipment/DECISIONS.md, "The melee-damage domain had no
  // outlet (2026-09-22)").
  domain("system.damage.mod.melee", EFFECT_DOMAINS.STYLE_DAMAGE_MELEE);
  domain("system.ac.mod", EFFECT_DOMAINS.STYLE_AC);

  // The abilities' typed modifiers: every standing or gated spec, after
  // stacking and stand-aside (lib/typed-modifiers.mjs), one change each. The
  // gates read this loadout, so armour put on drops a gated part here.
  for (const p of standingModifiers(actor, { ctx: { loadout } }).parts) {
    write(p.path, p.type, p.value, { label: p.label, itemId: p.itemId, target: p.target, unverified: p.unverified, gated: p.gated });
  }

  // Non-proficient use (RR p. 15): bonuses only — an attribute PENALTY
  // still applies, so cancel max(0, dex.mod).
  if (loadout.nonProficientUse) {
    add("system.ac.mod", -Math.max(0, Number(actor.system?.scores?.dex?.mod ?? 0)), rule("ACKS-EQUIPMENT.part.nonProficient"));
  }

  // Core's AC computation adds the last equipped shield's AC unconditionally;
  // two rules can say it grants nothing (see docs/equipment/MODEL.md, "The
  // shield and its style").
  const variantCut = shieldACCorrection(loadout, spec.has(STYLE.WEAPON_SHIELD.toLowerCase()), actor);
  const lastShield = loadout.shields?.[loadout.shields.length - 1] ?? null;
  const styleCut = loadout.shieldStyled === false && lastShield ? -Number(lastShield.system?.ac?.value ?? 0) : 0;
  add("system.ac.mod", Math.min(variantCut, styleCut), rule("ACKS-EQUIPMENT.part.shield"));

  // Enclosing (heavy) helmet (RR ch. 4, "Helmet, Heavy"): affects the field
  // the surprise matrix reads (system.surprise.avoidsurprise), by the figure
  // the import holds and not before. Listening is a proficiency throw with no
  // field; Mortal Wounds is core's, via hasHeavyHelm.
  if (enclosingHelmActive(actor)) add("system.surprise.avoidsurprise", helmFigures().surprise, rule("ACKS-EQUIPMENT.part.helm", HELM_TABLE));

  return { changes, parts };
}

/**
 * Stable hash of an AE changes array and its ledger, for dedupe. The ledger
 * is hashed with the changes in document order, so a renamed ability or a
 * part that moved rewrites the effect even where the sums are unchanged.
 */
function changesHash(changes, parts = []) {
  // Read `type`, never `mode`: touching the shimmed `mode` getter logs a v14
  // deprecation warning on every rebuild.
  return JSON.stringify([changes.map((c) => [c.key, c.type, String(c.value)]), parts]);
}

/**
 * What wrote one change of the loadout effect: the ledger entry beside it,
 * or null for an effect that is not the loadout or a change it does not
 * name. Readers name a part by `label`, else by localizing `labelKey`.
 */
export function loadoutPart(effect, change) {
  if (!effect?.getFlag?.(MODULE_ID, LOADOUT_EFFECT_FLAG) && effect?.flags?.[MODULE_ID]?.[LOADOUT_EFFECT_FLAG] !== true) return null;
  const index = (effect.changes ?? []).indexOf(change);
  const parts = effect.flags?.[MODULE_ID]?.[LOADOUT_PARTS_FLAG];
  return index >= 0 && Array.isArray(parts) ? (parts[index] ?? null) : null;
}

/** Every module-managed loadout effect on an actor. There should be exactly one. */
function loadoutEffects(actor) {
  return (actor.effects ?? []).filter((e) => e.getFlag?.(MODULE_ID, LOADOUT_EFFECT_FLAG) === true);
}

/** Find the module-managed loadout effect on an actor, if any — the one under `LOADOUT_EFFECT_ID` first. */
export function findLoadoutEffect(actor) {
  const all = loadoutEffects(actor);
  return all.find((e) => e.id === LOADOUT_EFFECT_ID) ?? all[0] ?? null;
}

/**
 * Run a loadout write that a second writer may have overtaken: a refusal is
 * swallowed when `overtaken()` finds the document already created, or already
 * gone, under it, and rethrown otherwise. The refusal reaches this client
 * after the other writer's change does, so the read after it is current.
 * Swallowing is safe because each writer's last sync reads the settled actor,
 * and two syncs reading one state write one answer.
 */
async function writeUnlessRaced(write, overtaken) {
  try {
    return await write();
  } catch (err) {
    if (overtaken()) return null;
    throw err;
  }
}

/**
 * Delete every managed loadout effect but the one `findLoadoutEffect` keeps.
 *
 * There must only ever be one — its changes are the WHOLE loadout, so a
 * second copy doubles every bonus on the actor (see
 * docs/equipment/DECISIONS.md, "Concurrent syncs could create duplicate
 * loadout effects (2026-09-22)"). `queueSync` in enforce.mjs serialises one
 * client's syncs and `LOADOUT_EFFECT_ID` makes a second client's create
 * fail; this is the repair for a world that already has copies, run on the
 * ordinary sync path.
 */
async function collapseDuplicates(actor) {
  const keep = findLoadoutEffect(actor);
  const extra = loadoutEffects(actor).filter((e) => e !== keep);
  if (!extra.length) return;
  console.warn(`${MODULE_ID} | ${actor.name} carried ${extra.length + 1} loadout effects; keeping one.`);
  const ids = extra.map((e) => e.id);
  await writeUnlessRaced(
    () => actor.deleteEmbeddedDocuments("ActiveEffect", ids, managedDelete()),
    () => !ids.some((id) => actor.effects.has(id)),
  );
}

/**
 * Create/update/delete the managed loadout Active Effect to match the computed
 * changes. No-ops when unchanged. Only runs where the user may modify the actor;
 * otherwise a GM client handles it (see module.mjs primary-GM routing).
 * @returns {Promise<void>}
 */
export async function syncLoadoutEffect(actor, loadout) {
  if (!actor?.isOwner) return;
  const { changes, parts } = buildLoadoutParts(actor, loadout);
  await collapseDuplicates(actor);
  let existing = findLoadoutEffect(actor);

  if (!changes.length) {
    if (existing) {
      const id = existing.id;
      await writeUnlessRaced(() => existing.delete(managedDelete()), () => !actor.effects.has(id));
    }
    return;
  }

  const desired = {
    name: LOADOUT_EFFECT_NAME,
    icon: "icons/svg/upgrade.svg",
    img: "icons/svg/upgrade.svg",
    changes,
    transfer: false,
    disabled: false,
    flags: { [MODULE_ID]: { [LOADOUT_EFFECT_FLAG]: true, [LOADOUT_PARTS_FLAG]: parts } },
  };

  if (!existing) {
    // Refused when another writer created it first; this one then reconciles
    // the effect that writer made, as if it had been here all along.
    const made = await writeUnlessRaced(
      () => actor.createEmbeddedDocuments("ActiveEffect", [{ ...desired, _id: LOADOUT_EFFECT_ID }], { keepId: true }),
      () => actor.effects.has(LOADOUT_EFFECT_ID),
    );
    if (made) return;
    existing = findLoadoutEffect(actor);
  }
  const stored = existing.flags?.[MODULE_ID]?.[LOADOUT_PARTS_FLAG] ?? [];
  if (changesHash(existing.changes ?? [], stored) !== changesHash(changes, parts)) {
    const id = existing.id;
    // The ledger is an array: an update replaces it whole, so a shorter one
    // leaves no stale tail.
    await writeUnlessRaced(
      () => existing.update({ changes, disabled: false, [`flags.${MODULE_ID}.${LOADOUT_PARTS_FLAG}`]: parts }),
      () => !actor.effects.has(id),
    );
  }
}
