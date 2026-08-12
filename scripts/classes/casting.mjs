/* global game, foundry, Hooks, Actor */
/**
 * The casting framework: kind-typed traditions with extras-owned resource
 * pools, rendered as a per-tradition strip on the character sheet.
 *
 * The class DOCUMENT is authoritative for capacity (a vancian tradition's
 * slot row at the character's level; a pool schedule for points-like kinds);
 * the ACTOR carries only what is SPENT, under
 * `flags["acks-extras"].classes.pools[traditionKey]`. Deriving max live means
 * a level-up or an Update Classes never has to migrate pool state — spent
 * counts persist, capacity follows the document.
 *
 * The system's own `spells.1..6.max` grid stays what applyClass wrote (the
 * single-tradition vancian compatibility surface); this strip is the
 * per-tradition truth and the only surface that can show two traditions at
 * once (the Nobiran's arcane and divine pools live side by side).
 */
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { classForActor } from "./registry.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

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
    // rung (the gnostic classes' maximum invocation level) still shows what
    // the character can reach — the slot-equivalent, without a spend.
    const ladder = t.casterLevel ? (classItem.system.ladders ?? []).find((l) => l.key === t.casterLevel) : null;
    if (ladder) {
      const rungs = (ladder.values ?? []).filter((v) => v.atLevel <= level);
      const rung = rungs.length ? rungs.reduce((b, r) => (r.atLevel > b.atLevel ? r : b)) : null;
      const cap = rung ? (rung.text || (rung.value != null ? String(rung.value) : "")) : "";
      if (cap) out.push({ key: t.key, label: t.label || t.key, kind: t.kind, capacity: cap });
    }
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
  await actor.update({ [`flags.${MODULE_ID}.${FLAG_CLASSES}.-=pools`]: null });
}

/** Render the strip markup for one actor (empty string when nothing casts). */
function stripHtml(actor) {
  const state = poolState(actor);
  if (!state.length) return "";
  const parts = state.map((t) => {
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
  return `<div class="acks-extras-classes-strip">${parts.join("")}<a class="acks-extras-classes-rest" data-tooltip="${game.i18n.localize(`${LANG_PREFIX}.casting.restTip`)}"><i class="fa-solid fa-bed"></i></a></div>`;
}

function onRenderCharacterSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== ACTOR_TYPE.character) return;
  root.querySelector(".acks-extras-classes-strip")?.remove();
  const html = stripHtml(doc);
  if (!html) return;
  const anchor = root.querySelector('input[name="system.details.class"]')?.closest(".form-group") ?? root.querySelector("header");
  if (!anchor) return;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const strip = holder.firstElementChild;
  strip.addEventListener("click", (event) => {
    const pip = event.target.closest(".acks-extras-classes-pip");
    if (pip) {
      event.preventDefault();
      adjustPool(doc, pip.dataset.tradition, pip.dataset.slot, pip.classList.contains("spent") ? -1 : 1);
      return;
    }
    const pt = event.target.closest(".acks-extras-classes-ptbtn");
    if (pt) {
      event.preventDefault();
      adjustPool(doc, pt.dataset.tradition, "points", Number(pt.dataset.delta) || 0);
      return;
    }
    if (event.target.closest(".acks-extras-classes-rest")) {
      event.preventDefault();
      restPools(doc);
    }
  });
  anchor.insertAdjacentElement("afterend", strip);
}

/** Register the strip's render hook (called once from classes/module.mjs). */
export function registerCastingUi() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}
