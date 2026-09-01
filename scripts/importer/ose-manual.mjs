/**
 * Converting a stat block by hand.
 *
 * The automatic path needs a PDF it can read: a page of text, laid out in
 * columns it can separate. Plenty of blocks are not that. A scanned adventure
 * has no text layer at all, a block the locator refused is one it could not
 * vouch for, and a creature from a blog post, a forum, or the Judge's own head
 * was never in a book. All of those still deserve the same conversion.
 *
 * So this is the same pipeline with the page taken out of it. Paste a block and
 * it is read; correct anything it got wrong; convert. Or type it from nothing
 * and skip the reading entirely.
 *
 * ONE decision shapes the whole editor: each field holds its clause **in OSE's
 * own idiom** — "9 [10]", "1** (4hp)", "D13 W14 P13 B16 S15 (Magic-user 1)" —
 * and converting reassembles them into a stat line and runs the ordinary
 * grammar over it. It would have been easy to offer a widget per parsed value
 * instead, and that would have frozen this editor at whatever the grammar
 * understood on the day it was written. As written, every rule the grammar ever
 * learns — a new hit-dice spelling, a dash the extractor mangles, a movement
 * mode nobody had seen — reaches hand entry the moment it reaches the parser,
 * with no work here at all.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { parseOseStatline, OSE_CANONICAL, resolveProfile } from "./ose-statline.mjs";
import { LINEAGES } from "./ose-convert.mjs";
import { oseSource, oseSources, parsePastedBlock } from "./ose-source.mjs";
import { oseActorDataFromFields, moraleBoundsFromSchema } from "./ose-binding.mjs";
import { axisTable, currentScgConstants } from "./ose-app.mjs";
import { createDoc, importFolderFor, unlinedFolderFor } from "./cookbook.mjs";

const loc = (k, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${k}`, data) : game.i18n.localize(`${LANG_PREFIX}.${k}`));
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const content = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
};

/**
 * The editable fields, in the order a stat block prints them.
 *
 * Keyed to the canonical labels so the reassembled line is one the grammar
 * reads back — the label is both the form's caption and the token it emits.
 */
const ROWS = [
  { key: "ac", label: "AC", hint: "9 [10]" },
  { key: "hd", label: "HD", hint: "1** (4hp)" },
  { key: "att", label: "Att", hint: "1 x bite (1d6) or 1 x gaze" },
  { key: "thac0", label: "THAC0", hint: "19 [0]" },
  { key: "mv", label: "MV", hint: "120 (40)" },
  { key: "sv", label: "SV", hint: "D13 W14 P13 B16 S15 (Magic-user 1)" },
  { key: "ml", label: "ML", hint: "7" },
  { key: "al", label: "AL", hint: "Chaotic" },
  { key: "xp", label: "XP", hint: "16" },
  { key: "na", label: "NA", hint: "1d4 (2d6)" },
  { key: "tt", label: "TT", hint: "R" },
];

/** The canonical spelling of each label, so a reassembled line parses back. */
const labelFor = (key) => OSE_CANONICAL.labels[key]?.[0] ?? key.toUpperCase();

/**
 * Put the clauses back together into a stat line.
 *
 * Empty clauses are simply omitted — a field a Judge left blank is a field the
 * creature does not have, not one to emit as an empty label for the grammar to
 * puzzle over.
 */
export function assembleStatline(segments) {
  return ROWS.filter((r) => String(segments?.[r.key] ?? "").trim())
    .map((r) => `${labelFor(r.key)} ${String(segments[r.key]).trim()}`)
    .join(", ");
}

/** Read the form back into clauses. */
function collectSegments(form) {
  const out = {};
  for (const r of ROWS) {
    const v = form.elements[`seg-${r.key}`]?.value ?? "";
    if (String(v).trim()) out[r.key] = String(v).trim();
  }
  return out;
}

/* -------------------------------------------- */
/*  The editor                                  */
/* -------------------------------------------- */

/** The shelf a by-hand creature is filed on. */
const HAND_FOLDER = "Entered by Hand";

/**
 * Paste a block, correct it, or type one from nothing.
 *
 * @param prefill  `{name, segments, lineage, raw, learned, extra, sourceId}`
 *                 when re-opening after a read; absent on a cold start.
 *                 `sourceId` is the registered book a blocked candidate was
 *                 sent here from, and it is what shelves the result with that
 *                 book rather than on the by-hand pile.
 */
export async function oseManualDialog(prefill = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(`${MODULE_ID} | GM only (creates documents).`);
    return null;
  }
  const seg = prefill.segments ?? {};
  const lineages = Object.entries(LINEAGES)
    .map(([id, l]) => `<option value="${esc(id)}"${id === (prefill.lineage ?? "ose") ? " selected" : ""}>${esc(l.label)}</option>`)
    .join("");

  const rows = ROWS.map(
    (r) => `
    <div class="form-group acks-extras-importer-ose-row">
      <label>${esc(r.label)}</label>
      <input type="text" name="seg-${r.key}" value="${esc(seg[r.key] ?? "")}" placeholder="${esc(r.hint)}">
    </div>`,
  ).join("");

  // What the reader recovered only because some book taught it that spelling.
  const learned = (prefill.learned ?? []).length
    ? `<p class="notes acks-extras-importer-ose-learned">${loc("ose.manualLearned", {
        list: prefill.learned.map((l) => `${l.spelling} (${l.from.join(", ") || loc("ose.manualLearnedUnknown")})`).join("; "),
      })}</p>`
    : "";
  // Anything the reader could not place. Shown so a Judge can put it somewhere
  // rather than discover later that it went nowhere.
  const leftover = (prefill.extra ?? []).length
    ? `<p class="notes acks-extras-importer-ose-leftover">${loc("ose.manualLeftover", { list: prefill.extra.join(" · ") })}</p>`
    : "";

  const html = `
    <p class="notes">${loc("ose.manualNote")}</p>
    <div class="form-group">
      <label>${loc("ose.manualPaste")}</label>
      <textarea name="paste" rows="4" placeholder="${esc(loc("ose.manualPastePlaceholder"))}">${esc(prefill.raw ?? "")}</textarea>
    </div>
    ${learned}${leftover}
    <hr>
    <div class="form-group">
      <label>${loc("ose.manualName")}</label>
      <input type="text" name="name" value="${esc(prefill.name ?? "")}" placeholder="${esc(loc("ose.creaturePlaceholder"))}">
    </div>
    <div class="form-group">
      <label>${loc("ose.lineageLabel")}</label>
      <select name="lineage">${lineages}</select>
    </div>
    <div class="acks-extras-importer-ose-fields">${rows}</div>`;

  // Each button reads the form while the dialog is still standing. Reaching for
  // it afterwards would find nothing — the window is gone by the time `wait`
  // resolves, and every field with it.
  const take = (action) => (event, button) => ({
    action,
    raw: button.form.elements.paste?.value ?? "",
    name: (button.form.elements.name?.value ?? "").trim(),
    lineage: button.form.elements.lineage?.value ?? "ose",
    segments: collectSegments(button.form),
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("ose.manualTitle"), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 560, height: 700 },
    content: content(html),
    buttons: [
      { action: "read", label: loc("ose.manualRead"), icon: "fa-solid fa-wand-magic-sparkles", callback: take("read") },
      { action: "convert", label: loc("ose.manualConvert"), icon: "fa-solid fa-arrow-right", default: true, callback: take("convert") },
    ],
    // Closing the window creates nothing.
    rejectClose: false,
  }).catch(() => null);
  if (!result?.action) return null;

  return result.action === "read"
    ? readIntoForm(result, prefill)
    : convertFromForm({ ...result, sourceId: prefill.sourceId ?? null });
}

/**
 * Read the pasted text and re-open the editor with its clauses filled in.
 *
 * Deliberately does not merge with whatever was already in the fields: a read
 * replaces, so what is on screen afterwards is exactly what the text said, and
 * a Judge can see whether the reading was any good before correcting it.
 */
async function readIntoForm({ raw, name, lineage }, prefill) {
  if (!String(raw).trim()) {
    ui.notifications.warn(`${MODULE_ID} | ${loc("ose.manualNothingPasted")}`);
    return oseManualDialog({ ...prefill, name, lineage });
  }
  // Read with everything this world has learned, not only the canonical
  // labels — a spelling calibrated on any adventure is understood here.
  const { parsed, learned } = parsePastedBlock(raw, oseSources());
  if (!Object.keys(parsed.segments).length) {
    ui.notifications.warn(`${MODULE_ID} | ${loc("ose.manualUnreadable")}`);
  }
  return oseManualDialog({
    name: name || parsed.name || "",
    lineage,
    raw,
    segments: parsed.segments,
    extra: parsed.extra,
    learned,
    sourceId: prefill.sourceId ?? null,
  });
}

/**
 * Convert what is in the form.
 *
 * The clauses are reassembled and read by the ordinary grammar rather than
 * interpreted here, so hand entry and page import cannot drift apart: there is
 * one reader, and this is a second way of feeding it.
 */
async function convertFromForm({ segments, name, lineage, raw, sourceId = null }) {
  if (!Object.keys(segments).length) {
    ui.notifications.warn(`${MODULE_ID} | ${loc("ose.manualEmpty")}`);
    return oseManualDialog({ name, lineage, raw, sourceId });
  }

  const line = assembleStatline(segments);
  const parsed = parseOseStatline(line, resolveProfile(null));
  const constants = await currentScgConstants();
  const bounds = moraleBoundsFromSchema();

  const data = oseActorDataFromFields({
    name: name || loc("ose.manualUntitled"),
    fields: parsed.fields,
    extra: parsed.extra,
    dialect: "ose.hand",
    raw: line,
    // The registered book this block came from, when it came from one. It names
    // the shelf the creature is filed on and the provenance line on its sheet;
    // a block typed from nothing has no source and says so.
    source: sourceId ? oseSource(sourceId) : null,
    page: null,
    box: null,
    origin: "hand",
    lineage,
    constants,
    moraleBounds: bounds,
  });
  const rec = data.flags[MODULE_ID].ose;

  return confirmManual({ data, rec, segments, name, lineage, raw, line, constants, sourceId });
}

/* -------------------------------------------- */
/*  Confirming                                  */
/* -------------------------------------------- */

/** Show what the conversion produced, and create the creature on confirmation. */
async function confirmManual({ data, rec, segments, name, lineage, raw, line, constants, sourceId = null }) {
  const warn = !constants ? `<p class="acks-extras-importer-ose-warn">${loc("ose.warnNoGuide")}</p>` : "";
  const leftover = rec.extra?.length
    ? `<p class="notes acks-extras-importer-ose-leftover">${loc("ose.manualLeftover", { list: rec.extra.join(" · ") })}</p>`
    : "";
  const html = `
    <p class="notes">${loc("ose.manualConfirmNote")}</p>
    ${warn}
    <pre class="acks-extras-importer-ose-raw">${esc(line)}</pre>
    ${axisTable({ conversions: rec.conversions, gaps: rec.gaps })}
    ${leftover}`;

  const action = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("ose.manualConfirmTitle", { name: data.name }), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 560 },
    content: content(html),
    buttons: [
      { action: "back", label: loc("ose.manualBack"), icon: "fa-solid fa-arrow-left" },
      { action: "create", label: loc("ose.manualCreate"), icon: "fa-solid fa-check", default: true },
    ],
    submit: (a) => a,
    rejectClose: false,
  }).catch(() => null);

  if (action === "back") return oseManualDialog({ name, lineage, raw, segments, sourceId });
  if (action !== "create") return null;

  // A block from a registered book is filed with that book; one typed from
  // nothing belongs to no book, and gets a shelf of its own rather than being
  // created loose at the top of the library.
  const folder = sourceId
    ? await importFolderFor("Actor", sourceId, HAND_FOLDER)
    : await unlinedFolderFor("Actor", HAND_FOLDER);
  const actor = await createDoc(Actor, { ...data, folder: folder?.id ?? null });
  if (!actor) return null;
  ui.notifications.info(`${MODULE_ID} | ${loc(constants ? "ose.manualMade" : "ose.manualMadeUnconverted", { name: actor.name })}`);
  return actor;
}
