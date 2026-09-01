/**
 * The Judge-facing half of the OSE path: registering a source, calibrating it,
 * and reviewing what the locator found before anything is created.
 *
 * The review step is the point of the whole flow. Nothing here imports on the
 * strength of a pattern match: the Judge sees the block as printed, what the
 * grammar read, what each value converted to and on whose authority, and every
 * axis the converter refused — and then decides. A candidate the locator marked
 * as another game's stat block, or as two creatures read as one, cannot be
 * imported by pressing the ordinary button at all — it is offered to the hand
 * editor instead, so a block the geometry will not vouch for is still reachable
 * rather than a dead end.
 *
 * Source PDFs are session-only, exactly as the shipped books are. Nothing about
 * a third-party book is written to disk beyond the Judge's own registry entry:
 * a name they typed, a page count, and the boxes they confirmed.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { openBook, pageItems } from "./extract.mjs";
import { findStatBlocks, unknownLabels } from "./ose-blocks.mjs";
import { parseOseStatline, OSE_CANONICAL } from "./ose-statline.mjs";
import { LINEAGES } from "./ose-convert.mjs";
import {
  oseSources,
  oseSource,
  oseIdFor,
  makeOseSource,
  checkOseSource,
  saveOseSource,
  profileFor,
  learnLabel,
  rememberBlocks,
  matchOseSources,
} from "./ose-source.mjs";
import { oseActorData, moraleBoundsFromSchema, convertUnconvertedOse } from "./ose-binding.mjs";
import { createDoc, cookbookContentFile, cookbookRegisters, cookbookSessionDoc, importFolderFor } from "./cookbook.mjs";
import { readScgConstants } from "./scg-constants.mjs";
import { BOOKS } from "./books.mjs";
import { oseManualDialog } from "./ose-manual.mjs";

/** Opened source PDFs, this session only. */
export const oseDocs = new Map();

const loc = (k, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${k}`, data) : game.i18n.localize(`${LANG_PREFIX}.${k}`));
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const content = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
};
const gmOnly = () => {
  if (game.user.isGM) return false;
  ui.notifications.warn(`${MODULE_ID} | GM only (creates documents and world settings).`);
  return true;
};

/** Read a picked file into an opened pdf.js document plus its fingerprint. */
async function openPicked(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { doc, numPages, title } = await openBook(bytes);
  return { doc, numPages, title, fileName: file.name, fileSize: file.size };
}

/* -------------------------------------------- */
/*  Registering a source                        */
/* -------------------------------------------- */

/**
 * Register an adventure the Judge owns.
 *
 * The name is typed rather than taken from the file, because a PDF's metadata
 * title is not reliable evidence of what the book is — one of the books this
 * was built against carries its author's word-processor filename there. The
 * title is still stored, as evidence for re-matching the same file later.
 */
/**
 * Every line this world already shelves books under, shipped and registered.
 *
 * Offered as a datalist rather than a fixed menu: the shipped list is the
 * handful of series this module has cookbooks for, and a Judge's own library is
 * everything else. Suggesting what is already there is what keeps two
 * adventures from the same publisher off two nearly-identical shelves; forcing
 * a choice from it would refuse every book nobody here has heard of.
 */
function knownLines() {
  const lines = new Set(Object.values(BOOKS).map((b) => b.line).filter(Boolean));
  for (const src of Object.values(oseSources())) if (src?.line) lines.add(src.line);
  return [...lines].sort();
}

export async function registerOseSourceDialog() {
  if (gmOnly()) return null;
  const lineages = Object.entries(LINEAGES)
    .map(([id, l]) => `<option value="${esc(id)}">${esc(l.label)}</option>`)
    .join("");
  const html = `
    <div class="form-group"><label>${loc("ose.fileLabel")}</label>
      <input type="file" name="pdf" accept="application/pdf"></div>
    <div class="form-group"><label>${loc("ose.nameLabel")}</label>
      <input type="text" name="label" placeholder="${esc(loc("ose.namePlaceholder"))}"></div>
    <div class="form-group"><label>${loc("ose.lineLabel")}</label>
      <input type="text" name="line" list="acks-extras-importer-ose-lines" placeholder="${esc(loc("ose.linePlaceholder"))}">
      <datalist id="acks-extras-importer-ose-lines">${knownLines()
        .map((l) => `<option value="${esc(l)}"></option>`)
        .join("")}</datalist></div>
    <p class="notes">${loc("ose.lineNote")}</p>
    <div class="form-group"><label>${loc("ose.lineageLabel")}</label>
      <select name="lineage">${lineages}</select></div>
    <p class="notes">${loc("ose.registerNote")}</p>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: loc("ose.registerTitle") },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: content(html),
    ok: {
      label: loc("ose.registerGo"),
      callback: async (event, button) => {
        const form = button.form;
        const file = form.elements.pdf.files?.[0];
        if (!file) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.needFile")}`);
        const label = form.elements.label.value.trim();
        const line = form.elements.line.value.trim();
        const lineage = form.elements.lineage.value;

        let opened;
        try {
          opened = await openPicked(file);
        } catch (err) {
          return ui.notifications.error(`${MODULE_ID} | ${loc("ose.openFailed", { err: err.message })}`);
        }

        const all = oseSources();
        // Tell the Judge when this looks like something already registered,
        // rather than silently making a second entry for the same book.
        const seen = matchOseSources(all, { pages: opened.numPages, title: opened.title, fileName: opened.fileName, fileSize: opened.fileSize });
        if (seen.length && seen[0].score > 1) {
          const hit = seen[0];
          oseDocs.set(hit.id, opened);
          ui.notifications.info(`${MODULE_ID} | ${loc("ose.reopened", { name: hit.source.label, why: hit.why.join(", ") })}`);
          return oseBrowseDialog(hit.id);
        }

        const rec = makeOseSource({
          id: oseIdFor(label || file.name, all),
          label: label || file.name.replace(/\.pdf$/i, ""),
          line,
          lineage,
          pages: opened.numPages,
          metaTitle: opened.title ?? "",
          fileName: opened.fileName,
          fileSize: opened.fileSize,
          addedBy: game.user?.name ?? "",
        });
        const problems = checkOseSource(rec);
        if (problems.length) return ui.notifications.warn(`${MODULE_ID} | ${problems.join("; ")}`);

        await saveOseSource(rec);
        oseDocs.set(rec.id, opened);
        ui.notifications.info(`${MODULE_ID} | ${loc("ose.registered", { name: rec.label, pages: rec.pages })}`);
        return oseBrowseDialog(rec.id);
      },
    },
  });
}

/* -------------------------------------------- */
/*  Choosing a page                             */
/* -------------------------------------------- */

/** Pick a registered source and a page, then review what is on it. */
export async function oseBrowseDialog(preselect = null) {
  if (gmOnly()) return null;
  const all = oseSources();
  const rows = Object.values(all);
  if (!rows.length) {
    ui.notifications.info(`${MODULE_ID} | ${loc("ose.noSources")}`);
    return registerOseSourceDialog();
  }
  const options = rows
    .map(
      (s) =>
        `<option value="${esc(s.id)}"${s.id === preselect ? " selected" : ""}>${esc(s.label)}${oseDocs.has(s.id) ? ` — ${loc("ose.open")}` : ` — ${loc("ose.closed")}`}</option>`,
    )
    .join("");
  const html = `
    <div class="form-group"><label>${loc("ose.sourceLabel")}</label>
      <select name="source">${options}</select></div>
    <div class="form-group"><label>${loc("ose.pageLabel")}</label>
      <input type="number" name="page" min="1" step="1"></div>
    <p class="notes">${loc("ose.browseNote")}</p>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: loc("ose.browseTitle") },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: content(html),
    ok: {
      label: loc("ose.browseGo"),
      callback: async (event, button) => {
        const form = button.form;
        const id = form.elements.source.value;
        const page = parseInt(form.elements.page.value, 10);
        if (!Number.isFinite(page) || page < 1) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.needPage")}`);
        if (!oseDocs.has(id)) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.notOpen")}`);
        return oseReviewDialog(id, page);
      },
    },
  });
}

/* -------------------------------------------- */
/*  Reviewing what was found                    */
/* -------------------------------------------- */

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

/**
 * Show every candidate on a page with its full reading, and import the ones the
 * Judge confirms.
 *
 * A candidate the locator marked is rendered with its warning and its checkbox
 * disabled: importing a foreign stat block inverts its armour class silently,
 * and importing two creatures read as one produces a confident mixture of both.
 * Neither is something to leave one careless click away.
 */
export async function oseReviewDialog(sourceId, page) {
  if (gmOnly()) return null;
  const rec = oseSource(sourceId);
  const opened = oseDocs.get(sourceId);
  if (!rec || !opened) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.notOpen")}`);
  if (page > opened.numPages) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.pastEnd", { n: opened.numPages })}`);

  const pageData = await pageItems(opened.doc, page);
  const profile = profileFor(rec);
  const found = findStatBlocks(pageData, profile);
  if (!found.length) {
    ui.notifications.warn(`${MODULE_ID} | ${loc("ose.noBlocks", { page })}`);
    return oseCalibrateDialog(sourceId, page, pageData);
  }

  const constants = await currentScgConstants();
  const bounds = moraleBoundsFromSchema();

  const previews = found.map((c, i) => {
    const data = oseActorData({
      name: "",
      candidate: c,
      source: rec,
      page,
      constants,
      moraleBounds: bounds,
    });
    const ose = data.flags[MODULE_ID].ose;
    const blocked = c.suspectLineage || c.mergedBlocks;
    const warn = [
      c.suspectLineage ? loc("ose.warnForeign") : null,
      c.mergedBlocks ? loc("ose.warnMerged") : null,
      !constants ? loc("ose.warnNoGuide") : null,
    ].filter(Boolean);
    return { i, candidate: c, ose, blocked, warn, suggested: parseOseStatline(c.text, profile).name ?? "" };
  });

  const blocks = previews
    .map(
      (p) => `
      <fieldset class="acks-extras-importer-ose-block${p.blocked ? " acks-extras-importer-ose-blocked" : ""}">
        <legend>
          <label><input type="checkbox" name="${p.blocked ? "hand" : "sel"}" value="${p.i}">
          ${loc("ose.candidate", { n: p.i + 1 })}${p.blocked ? ` — ${loc("ose.sendToHand")}` : ""}</label>
        </legend>
        ${p.warn.length ? `<p class="acks-extras-importer-ose-warn">${p.warn.map(esc).join("<br>")}</p>` : ""}
        <div class="form-group"><label>${loc("ose.creatureName")}</label>
          <input type="text" name="name-${p.i}" value="${esc(p.suggested)}" placeholder="${esc(loc("ose.creaturePlaceholder"))}"></div>
        <pre class="acks-extras-importer-ose-raw">${esc(p.ose.raw)}</pre>
        ${axisTable({ conversions: p.ose.conversions, gaps: p.ose.gaps })}
        ${p.ose.extra?.length ? `<p class="notes">${loc("ose.unread")}: ${esc(p.ose.extra.join(" · "))}</p>` : ""}
      </fieldset>`,
    )
    .join("");

  const unknown = unknownLabels(pageData, profile);
  const calibrate = unknown.length
    ? `<p class="notes">${loc("ose.unknownLabels", { labels: unknown.slice(0, 6).map((u) => u.label).join(", ") })}</p>`
    : "";

  return foundry.applications.api.DialogV2.prompt({
    window: { title: loc("ose.reviewTitle", { name: rec.label, page }), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 640, height: 720 },
    content: content(`<p class="notes">${loc("ose.reviewNote")}</p>${calibrate}${blocks}`),
    ok: {
      label: loc("ose.importGo"),
      callback: async (event, button) => {
        const form = button.form;
        const picked = [...form.querySelectorAll('input[name="sel"]:checked')].map((el) => previews[+el.value]);
        const byHand = [...form.querySelectorAll('input[name="hand"]:checked')].map((el) => previews[+el.value]);
        if (!picked.length && !byHand.length) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.nothingPicked")}`);
        const nameOf = (p) => form.elements[`name-${p.i}`]?.value?.trim() ?? "";
        if (picked.length) {
          const names = Object.fromEntries(picked.map((p) => [p.i, nameOf(p)]));
          await importOseBlocks(rec, page, picked, names, constants, bounds);
        }
        // A block the locator would not vouch for is not a dead end: its text
        // goes to the hand editor, where a person can settle what the geometry
        // could not. That is what keeps every block the sweep FINDS reachable,
        // whether or not the grammar could read it.
        for (const p of byHand) {
          await oseManualDialog({ name: nameOf(p), lineage: rec.lineage, raw: p.ose.raw, sourceId: rec.id });
        }
        return null;
      },
    },
  });
}

/** Create the actors, and remember the boxes the Judge confirmed. */
async function importOseBlocks(rec, page, picked, names, constants, bounds) {
  let made = 0;
  const confirmed = [];
  // The source's own shelf, in whichever line's compendium it belongs to.
  // These used to be created with no folder, which piled every book a Judge
  // registered loose at the top of the library with the ACKS creatures.
  const folderId = (await importFolderFor("Actor", rec.id))?.id ?? null;
  for (const p of picked) {
    const name = names[p.i] || loc("ose.untitled", { n: p.i + 1 });
    const data = oseActorData({
      name,
      candidate: p.candidate,
      source: rec,
      page,
      constants,
      moraleBounds: bounds,
      folderId,
    });
    const actor = await createDoc(Actor, data);
    if (actor) {
      made++;
      confirmed.push({ box: p.candidate.box, name });
    }
  }
  if (confirmed.length) await saveOseSource(rememberBlocks(rec, page, confirmed));
  ui.notifications.info(
    `${MODULE_ID} | ${loc(constants ? "ose.imported" : "ose.importedUnconverted", { n: made, name: rec.label, page })}`,
  );
}

/* -------------------------------------------- */
/*  Calibration                                 */
/* -------------------------------------------- */

/**
 * Teach ONE source a label spelling it uses and the canonical grammar does not.
 *
 * The scan proposes the word; the Judge says what it means. Nothing is inferred
 * from the page, and what is learned is confined to this source — widening the
 * shared grammar would turn one confirmed reading of one book into a claim
 * about every book nobody has opened.
 */
export async function oseCalibrateDialog(sourceId, page, pageData = null) {
  if (gmOnly()) return null;
  const rec = oseSource(sourceId);
  const opened = oseDocs.get(sourceId);
  if (!rec || !opened) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.notOpen")}`);
  const pd = pageData ?? (await pageItems(opened.doc, page));
  const unknown = unknownLabels(pd, profileFor(rec));
  if (!unknown.length) return ui.notifications.info(`${MODULE_ID} | ${loc("ose.nothingToCalibrate")}`);

  const fieldOptions = ["", ...Object.keys(OSE_CANONICAL.labels)]
    .map((k) => `<option value="${esc(k)}">${k ? loc(`ose.field.${k}`) : loc("ose.ignore")}</option>`)
    .join("");
  const rows = unknown
    .slice(0, 12)
    .map(
      (u, i) => `<div class="form-group">
        <label>${esc(u.label)}</label>
        <select name="map-${i}" data-label="${esc(u.label)}">${fieldOptions}</select></div>`,
    )
    .join("");

  return foundry.applications.api.DialogV2.prompt({
    window: { title: loc("ose.calibrateTitle", { name: rec.label }) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: content(`<p class="notes">${loc("ose.calibrateNote")}</p>${rows}`),
    ok: {
      label: loc("ose.calibrateGo"),
      callback: async (event, button) => {
        const form = button.form;
        let updated = oseSource(sourceId);
        let learned = 0;
        for (const sel of form.querySelectorAll("select[name^='map-']")) {
          const key = sel.value;
          if (!key) continue;
          updated = learnLabel(updated, key, sel.dataset.label);
          learned++;
        }
        if (!learned) return ui.notifications.info(`${MODULE_ID} | ${loc("ose.nothingLearned")}`);
        await saveOseSource(updated);
        ui.notifications.info(`${MODULE_ID} | ${loc("ose.learned", { n: learned, name: updated.label })}`);
        return oseReviewDialog(sourceId, page);
      },
    },
  });
}

/* -------------------------------------------- */
/*  Stage B                                     */
/* -------------------------------------------- */

/**
 * The guide's constants, if this seat has the guide open. Imported lazily so
 * this module does not force the cookbook to load when it is not being used.
 */
export async function currentScgConstants() {
  const doc = cookbookSessionDoc("scg");
  const file = cookbookContentFile("constants");
  if (!doc || !file) return null;
  try {
    return await readScgConstants(doc, file, cookbookRegisters());
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read the conversion constants`, err);
    return null;
  }
}

/**
 * Fill in the axes that needed the guide, on everything imported without it.
 * Idempotent: a second run finds nothing and says so.
 */
export async function oseConvertAll() {
  if (gmOnly()) return;
  const constants = await currentScgConstants();
  if (!constants) return ui.notifications.warn(`${MODULE_ID} | ${loc("ose.needGuide")}`);
  const n = await convertUnconvertedOse(constants);
  ui.notifications.info(`${MODULE_ID} | ${n ? loc("ose.converted", { n }) : loc("ose.nothingToConvert")}`);
}
