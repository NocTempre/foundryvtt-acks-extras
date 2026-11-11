/**
 * The per-axis conversion table the OSE review and hand-entry dialogs both
 * render, and the value formatter under it.
 *
 * A leaf: it imports only the importer's constants, so the review dialog
 * (`ose-app.mjs`) and the hand editor (`ose-manual.mjs`) share one rendering
 * without importing each other.
 */
import { LANG_PREFIX } from "./constants.mjs";

const loc = (k, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${k}`, data) : game.i18n.localize(`${LANG_PREFIX}.${k}`));
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** One candidate's per-axis table: printed, on whose authority, and result. */
export function axisTable(converted) {
  const rows = [
    ...converted.conversions.map(
      (c) =>
        `<tr><td>${esc(c.axis)}</td><td>${esc(showVal(c.printed))}</td><td>${esc(loc(`ose.route.${c.route}`))}</td><td>${esc(showVal(c.value))}</td></tr>`,
    ),
    ...converted.gaps.map(
      (g) => `<tr class="acks-extras-importer-ose-gap"><td>${esc(g.axis)}</td><td>${esc(showVal(g.printed))}</td><td colspan="2">${esc(loc(`ose.gap.${g.reason}`))}</td></tr>`,
    ),
  ].join("");
  return `<table class="acks-extras-importer-ose-axes"><thead><tr>
      <th>${loc("ose.axis")}</th><th>${loc("ose.printed")}</th><th>${loc("ose.authority")}</th><th>${loc("ose.result")}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Render a printed or converted value compactly.
 *
 * Nested one deep on purpose: several converted values are objects OF objects —
 * the saving-throw row arrives as `{death: {value: 8}, …}` — and a renderer
 * that skipped anything object-valued showed a correctly converted save row as
 * an em dash, which reads as "nothing happened" to the one person checking.
 */
export function showVal(v, depth = 0) {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map((x) => showVal(x, depth + 1)).join("; ") || "—";
  if (typeof v === "object") {
    // A lone `{value: n}` wrapper carries nothing worth printing but the number.
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === "value") return showVal(v.value, depth + 1);
    return (
      Object.entries(v)
        .filter(([, x]) => x !== null && x !== undefined)
        .map(([k, x]) => (depth > 1 ? String(x) : `${k} ${showVal(x, depth + 1)}`))
        .join(", ") || "—"
    );
  }
  return String(v);
}
