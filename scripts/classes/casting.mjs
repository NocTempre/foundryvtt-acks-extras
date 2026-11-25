/* global game, foundry, Hooks, Actor */
/**
 * The casting framework: kind-typed traditions with extras-owned resource
 * pools, rendered as a per-tradition strip on the character sheet. The class
 * document is authoritative for capacity; the actor stores only what is
 * SPENT, under `flags["acks-extras"].classes.pools[traditionKey]`. See
 * docs/classes/MODEL.md, "Casting". The strip also hosts magic's power-ledger
 * chip (`power-chip.mjs`), which a rest does not clear.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { classForActor } from "./registry.mjs";
import { elementOf, ownsSheet, unset } from "../lib/util.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { forgetPowerSwitch, powerSectionHtml, powerSwitchOf, wirePowerChip } from "./power-chip.mjs";

/** The vancian slot row for `level`: exact rung, else the highest below it. */
export function slotRowAt(tradition, level) {
  const rows = (tradition?.slots ?? []).filter((r) => r.atLevel <= level);
  if (!rows.length) return null;
  return rows.reduce((best, r) => (r.atLevel > best.atLevel ? r : best));
}

/** The pool value for `level` on a points-like tradition. */
export function poolValueAt(tradition, level) {
  const rows = (tradition?.pool ?? []).filter((r) => r.atLevel <= level);
  if (!rows.length) return null;
  return rows.reduce((best, r) => (r.atLevel > best.atLevel ? r : best)).value;
}

/**
 * The rung of the ladder a tradition's `levelCap` names, at `level`: exact
 * rung, else the highest below it. Null where the row names no ladder, the
 * class has no such ladder, or no rung is at or below `level`.
 */
function capRungAt(classItem, tradition, level) {
  if (!tradition?.levelCap) return null;
  const ladder = (classItem?.system?.ladders ?? []).find((l) => l.key === tradition.levelCap);
  const rungs = (ladder?.values ?? []).filter((v) => v.atLevel <= level);
  return rungs.length ? rungs.reduce((b, r) => (r.atLevel > b.atLevel ? r : b)) : null;
}

/**
 * The number a tradition's level cap gives at class `level`: the rung of the
 * ladder its casting row's `levelCap` names. `tradition` is the casting row
 * or its key. Null where the row has no `levelCap`, the class has no such
 * ladder, or the rung is not a number.
 */
export function traditionCapAt(classItem, tradition, level) {
  const row = typeof tradition === "string" ? (classItem?.system?.casting ?? []).find((t) => t.key === tradition) : tradition;
  const value = capRungAt(classItem, row, level)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The ladder a tradition's `levelCap` names, as the cast dialog's invocation-level
 * menu reads it: `{key, label, top}` where `top` is the highest whole level any
 * rung gives. Null where the row names no ladder, the class has none by that key,
 * or no rung is a whole number from one up. `tradition` is the casting row or its key.
 */
export function traditionCapLadder(classItem, tradition) {
  const row = typeof tradition === "string" ? (classItem?.system?.casting ?? []).find((t) => t.key === tradition) : tradition;
  if (!row?.levelCap) return null;
  const ladder = (classItem?.system?.ladders ?? []).find((l) => l.key === row.levelCap);
  const rungs = (ladder?.values ?? []).map((v) => Number(v.value)).filter((n) => Number.isInteger(n) && n >= 1);
  return rungs.length ? { key: ladder.key, label: String(ladder.label || ladder.key), top: Math.max(...rungs) } : null;
}

/** Spent state for one actor: `{ [traditionKey]: {s1..s6 | points} }`. */
const spentFor = (actor) => actor.getFlag(MODULE_ID, FLAG_CLASSES)?.pools ?? {};

/**
 * The live pool state a sheet renders: per tradition, per spell level, max
 * from the class document and used from the actor. Empty when the actor has
 * no bound class or the class has no casting.
 */
export function poolState(actor) {
  const classItem = classForActor(actor);
  if (!classItem) return [];
  const level = Math.max(1, Number(actor.system?.details?.level) || 1);
  const spent = spentFor(actor);
  const out = [];
  for (const t of classItem.system.casting ?? []) {
    const used = spent[t.key] ?? {};
    if (t.kind === "vancian") {
      const row = slotRowAt(t, level);
      if (!row) continue;
      const slots = [];
      for (let n = 1; n <= 6; n++) {
        const max = row[`s${n}`];
        if (typeof max === "number" && max > 0) slots.push({ n, max, used: Math.min(Number(used[`s${n}`]) || 0, max) });
      }
      if (slots.length) out.push({ key: t.key, label: t.label || t.key, kind: t.kind, slots });
      continue;
    }
    const max = poolValueAt(t, level);
    if (typeof max === "number" && max > 0) {
      out.push({ key: t.key, label: t.label || t.key, kind: t.kind, pool: { max, used: Math.min(Number(used.points) || 0, max) } });
      continue;
    }
    // No slots and no pool schedule: a tradition whose capacity is a LADDER
    // rung (the gnostic classes' maximum invocation level, named by the row's
    // `levelCap`) still shows what the character can reach — the
    // slot-equivalent, without a spend.
    const rung = capRungAt(classItem, t, level);
    const cap = rung ? (rung.text || (rung.value != null ? String(rung.value) : "")) : "";
    if (cap) out.push({ key: t.key, label: t.label || t.key, kind: t.kind, capacity: cap });
  }
  return out;
}

/** Spend (delta +1) or refund (delta −1) one slot / pool point. */
export async function adjustPool(actor, traditionKey, slotKey, delta) {
  const pools = foundry.utils.deepClone(spentFor(actor));
  const t = (pools[traditionKey] ??= {});
  t[slotKey] = Math.max(0, (Number(t[slotKey]) || 0) + delta);
  await actor.update({ [`flags.${MODULE_ID}.${FLAG_CLASSES}.pools`]: pools });
}

/** A night's rest: every tradition's spent count returns to zero. */
export async function restPools(actor) {
  // `update` MERGES objects — an empty object merged into pools changes
  // nothing, so the key must be deleted for the spend to reset.
  await actor.update({ [`flags.${MODULE_ID}.${FLAG_CLASSES}.pools`]: unset() });
}

/** Render the strip markup for one actor (empty string when nothing casts and no power is held). */
function stripHtml(actor, switches, { traditions = true } = {}) {
  const state = poolState(actor);
  const power = powerSectionHtml(actor, state.length > 0, switches);
  if (!state.length && !power) return "";
  const parts = (traditions ? state : []).map((t) => {
    if (t.slots) {
      const cells = t.slots
        .map((s) => {
          const pips = Array.from({ length: s.max }, (_, i) =>
            `<a class="acks-extras-classes-pip ${i < s.used ? "spent" : ""}" data-tradition="${t.key}" data-slot="s${s.n}" data-tooltip="${game.i18n.localize(`${LANG_PREFIX}.casting.pipTip`)}"></a>`,
          ).join("");
          return `<span class="acks-extras-classes-slotgroup"><label>${s.n}</label>${pips}</span>`;
        })
        .join("");
      return `<div class="acks-extras-classes-tradition"><label>${foundry.utils.escapeHTML(t.label)}</label>${cells}</div>`;
    }
    if (t.pool) {
      // A points pool spends by count, not by pip — the +/− pair adjusts the
      // spent total and rest clears it like any other tradition.
      return `<div class="acks-extras-classes-tradition"><label>${foundry.utils.escapeHTML(t.label)}</label><span class="acks-extras-classes-slotgroup acks-extras-classes-pool">
        <a class="acks-extras-classes-ptbtn" data-tradition="${t.key}" data-delta="-1" data-tooltip="${game.i18n.localize(`${LANG_PREFIX}.casting.refundTip`)}"><i class="fa-solid fa-minus"></i></a>
        <span class="acks-extras-classes-poolcount">${t.pool.used}/${t.pool.max}</span>
        <a class="acks-extras-classes-ptbtn" data-tradition="${t.key}" data-delta="1" data-tooltip="${game.i18n.localize(`${LANG_PREFIX}.casting.spendTip`)}"><i class="fa-solid fa-plus"></i></a>
      </span></div>`;
    }
    // Capacity-only (the gnostic invocation level): shown, never spent.
    return `<div class="acks-extras-classes-tradition"><label>${foundry.utils.escapeHTML(t.label)}</label><span class="acks-extras-classes-slotgroup">${foundry.utils.escapeHTML(t.capacity ?? "")}</span></div>`;
  });
  return `<div class="acks-extras-classes-strip">${parts.join("")}<a class="acks-extras-classes-rest" data-tooltip="${game.i18n.localize(`${LANG_PREFIX}.casting.restTip`)}"><i class="fa-solid fa-bed"></i></a>${power}</div>`;
}

/**
 * The strip as an element with its controls wired — a pip spends or refunds
 * a slot, the +/− pair adjusts a points pool, the bed rests. Null when nothing
 * casts. The core-sheet injector below and the module's own character sheet
 * mount exactly this, so the two cannot drift. `app` is the window that hosts
 * the strip: it keys the power ledger's record (Fades / Stays, which panels are
 * open, the typed amounts, the panel ids), which each render of the strip reads
 * back (`power-chip.mjs`). With `traditions: false` the strip draws no
 * per-tradition pips or points pair, which a host that groups spells under
 * each tradition's heading draws there instead; the rest control and the
 * power section stay.
 */
export function castingStripElement(actor, app, { traditions = true } = {}) {
  const switches = powerSwitchOf(app);
  const html = stripHtml(actor, switches, { traditions });
  if (!html) return null;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const strip = holder.firstElementChild;
  wirePowerChip(strip, actor, switches);
  strip.addEventListener("click", (event) => {
    const pip = event.target.closest(".acks-extras-classes-pip");
    if (pip) {
      event.preventDefault();
      adjustPool(actor, pip.dataset.tradition, pip.dataset.slot, pip.classList.contains("spent") ? -1 : 1);
      return;
    }
    const pt = event.target.closest(".acks-extras-classes-ptbtn");
    if (pt) {
      event.preventDefault();
      adjustPool(actor, pt.dataset.tradition, "points", Number(pt.dataset.delta) || 0);
      return;
    }
    if (event.target.closest(".acks-extras-classes-rest")) {
      event.preventDefault();
      restPools(actor);
    }
  });
  return strip;
}

function onRenderCharacterSheet(app, element) {
  const root = elementOf(element);
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== ACTOR_TYPE.character) return;
  // A sheet this module draws itself places the strip where its own Magic
  // tab wants it; this injector dresses the system's sheet alone.
  if (ownsSheet(app)) return;
  root.querySelector(".acks-extras-classes-strip")?.remove();
  const strip = castingStripElement(doc, app);
  if (!strip) return;
  // Core's class field, else core's own header SECTION — never a bare
  // `header`, which matches the window frame's header on every sheet and put
  // the strip between the frame and the content of any non-core one.
  const anchor = root.querySelector('input[name="system.details.class"]')?.closest(".form-group") ?? root.querySelector(".sheet-header");
  if (!anchor) return;
  anchor.insertAdjacentElement("afterend", strip);
}

/** Register the strip's render hook and the close hook that ends a window's power record (called once from classes/module.mjs). */
export function registerCastingUi() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
  Hooks.on("closeApplicationV2", (app) => forgetPowerSwitch(app));
}
