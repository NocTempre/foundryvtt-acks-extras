/* global game, foundry, ui */
/**
 * Applying a class document to a character: one batched update carrying the
 * printed values for the character's level — saves and attack throw (via the
 * released-key write layer), title, XP-to-next, hit-dice formula, cleaves,
 * and the vancian slot grid.
 *
 * Never silent: `applyClass` shows what it is about to change (old → new) and
 * marks fields whose current value differs from what the LAST apply wrote —
 * a hand edit — before anything lands. The written values are recorded on the
 * actor (`flags["acks-extras"].classes.applied`) so the next apply can make
 * that distinction again.
 */
import { savesUpdateData } from "../lib/actor-compat.mjs";
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { saveBandAt, attackBandAt, resolveLevelValue } from "./registry.mjs";
import { normalizeHd, rebuildHitPoints, xpForLevel } from "./hitpoints.mjs";

export { normalizeHd };

/** The vancian slot row for `level`: exact rung, else the highest below it. */
function slotRowAt(tradition, level) {
  const rows = (tradition?.slots ?? []).filter((r) => r.atLevel <= level);
  if (!rows.length) return null;
  return rows.reduce((best, r) => (r.atLevel > best.atLevel ? r : best));
}

/**
 * The update a class document prescribes for a character at `level`.
 * Pure build, no writes. Paths whose printed cell is absent are skipped —
 * an apply never zeroes a field the book left blank.
 *
 * @returns {{update: object, level: number, missing: string[]}}
 */
export function classUpdateData(actor, classItem, level) {
  const sys = classItem.system;
  const missing = [];
  const clamped = Math.max(1, Math.min(Number(level) || 1, sys.maximumLevel || 14));
  const update = {
    "system.details.class": classItem.name,
    "system.details.level": clamped,
  };

  const row = sys.levelRow(clamped);
  if (row) {
    if (row.title) update["system.details.title"] = row.title;
    const hd = normalizeHd(row.hd);
    if (hd) update["system.hp.hd"] = hd;
  } else missing.push("levels");

  const nextXp = sys.nextXp(clamped);
  if (nextXp != null) update["system.details.xp.next"] = nextXp;

  const saves = saveBandAt(classItem, clamped);
  if (saves) Object.assign(update, savesUpdateData(saves));
  else missing.push("saves");

  const attack = attackBandAt(classItem, clamped);
  if (attack?.throw != null) update["system.thac0.throw"] = attack.throw;
  else missing.push("attack");

  const cleaves = resolveLevelValue(sys.cleaves, clamped);
  if (typeof cleaves === "number") update["system.fight.cleaves"] = Math.max(0, Math.floor(cleaves));

  // Vancian slot grid. One tradition writes directly; with two (the Nobiran)
  // the arcane one takes the system grid — per-tradition pools are the
  // casting framework's surface, not this grid's.
  const traditions = sys.casting ?? [];
  const gridSource =
    traditions.length === 1 ? traditions[0] : traditions.find((t) => (t.key || "").toLowerCase() === "arcane");
  if (gridSource && gridSource.kind === "vancian") {
    const slots = slotRowAt(gridSource, clamped);
    if (slots) {
      let any = false;
      for (let n = 1; n <= 6; n++) {
        const max = slots[`s${n}`];
        if (typeof max === "number") {
          update[`system.spells.${n}.max`] = max;
          if (max > 0) any = true;
        }
      }
      update["system.spells.enabled"] = any;
    }
  }

  return { update, level: clamped, missing };
}

/** The current actor value at an update path (dot-path read). */
const currentAt = (actor, path) => foundry.utils.getProperty(actor, path);

/**
 * Apply `classItem` to `actor` at `level` (default: the actor's current
 * level, floored to 1). Shows a confirm dialog listing every change and
 * flagging hand-edited fields; `{confirm: false}` skips it (callers that
 * already confirmed). Records the applied ledger on the actor.
 *
 * @returns {Promise<{applied: boolean, update?: object, missing?: string[]}>}
 */
export async function applyClass(actor, classItem, { level, confirm = true, rebuildVitals = false } = {}) {
  if (!actor || classItem?.type !== `${MODULE_ID}.class`) return { applied: false };
  if (classItem.system.isStub) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.apply.stub`, { name: classItem.name }));
    return { applied: false };
  }
  const targetLevel = level ?? Math.max(1, Number(actor.system?.details?.level) || 1);
  const { update, level: clamped, missing } = classUpdateData(actor, classItem, targetLevel);

  // Setting a level by hand leaves hit points and experience describing the
  // character you no longer have — a 4th-level thief keeping 1st-level hit
  // points and an experience total three bands away. Only the PICKER asks for
  // this: chargen builds its own 1st level and the level-up wizard has already
  // rolled the one die it means to add, so neither wants the whole total
  // rebuilt underneath it.
  let hpSteps = null;
  if (rebuildVitals) {
    const previousLevel = Math.max(1, Number(actor.system?.details?.level) || 1);
    const built = await rebuildHitPoints(actor, classItem, clamped);
    hpSteps = built.steps;
    update["system.hp.max"] = built.max;
    // A rebuilt maximum with the old current value beside it reads as a wound
    // nobody took, so a fresh build arrives whole.
    update["system.hp.value"] = built.max;
    const xp = xpForLevel(classItem, clamped, previousLevel);
    if (xp != null) update["system.details.xp.value"] = xp;
  }

  // The stored ledger's dotted paths expanded into nested objects on write,
  // so lookups navigate with getProperty rather than key membership.
  const previous = actor.getFlag(MODULE_ID, FLAG_CLASSES)?.applied ?? null;
  const rows = [];
  for (const [path, next] of Object.entries(update)) {
    const now = currentAt(actor, path);
    if (now === next) continue;
    const prevVal = previous == null ? undefined : foundry.utils.getProperty(previous, path);
    const handEdited = prevVal !== undefined && prevVal !== now;
    rows.push({ path, from: now ?? "—", to: next, handEdited });
  }

  // Requirements gate: a demi-human class's minimums are checked, named, and
  // overridable — the Judge decides, the dialog informs.
  const unmet = (classItem.system.requirements ?? []).filter(
    (r) => r.attr && typeof r.min === "number" && (Number(actor.system?.scores?.[r.attr]?.value) || 0) < r.min,
  );
  const unmetNote = unmet.length
    ? `<p class="notification warning">${game.i18n.format(`${LANG_PREFIX}.apply.unmet`, {
        parts: unmet.map((r) => `${r.attr.toUpperCase()} ${r.min}`).join(", "),
      })}</p>`
    : "";

  if (!rows.length) {
    ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.apply.noChanges`, { name: actor.name }));
  } else if (confirm) {
    const edited = game.i18n.localize(`${LANG_PREFIX}.apply.handEdited`);
    const list = rows
      .map(
        (r) =>
          `<tr${r.handEdited ? ' class="acks-extras-classes-hand-edited"' : ""}><td><code>${r.path}</code>${
            r.handEdited ? ` <em>(${edited})</em>` : ""
          }</td><td>${r.from}</td><td>${r.to}</td></tr>`,
      )
      .join("");
    const content = `${unmetNote}<p>${game.i18n.format(`${LANG_PREFIX}.apply.prompt`, {
      actor: actor.name,
      class: classItem.name,
      level: clamped,
    })}</p><table class="acks-extras-classes-diff"><tr><th></th><th>${game.i18n.localize(
      `${LANG_PREFIX}.apply.from`,
    )}</th><th>${game.i18n.localize(`${LANG_PREFIX}.apply.to`)}</th></tr>${list}</table>${
      // The dice are shown, not just their conclusion — a rebuilt total is a
      // handful of rolls the player did not watch happen.
      hpSteps?.length
        ? `<p class="hint">${game.i18n.localize(`${LANG_PREFIX}.apply.hpRolls`)} ${hpSteps
            .map((s) => `${s.level}: ${s.formula} → ${s.total}`)
            .join(", ")}</p>`
        : ""
    }`;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${LANG_PREFIX}.apply.title`) },
      content,
      modal: true,
    });
    if (!ok) return { applied: false };
  }

  const applied = {};
  for (const [path, value] of Object.entries(update)) applied[path] = value;
  await actor.update({
    ...update,
    [`flags.${MODULE_ID}.${FLAG_CLASSES}`]: {
      uuid: classItem.uuid,
      key: classItem.system.key || classItem.name.toLowerCase(),
      appliedLevel: clamped,
      applied,
    },
  });
  if (missing.length) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.apply.missing`, { parts: missing.join(", ") }));
  }
  return { applied: true, update, missing };
}
