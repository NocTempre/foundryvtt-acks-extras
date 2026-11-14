/**
 * Cookbook runtime: the debug window and the audit of raw executor output.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { BOOKS } from "../books.mjs";
import { executeEntry } from "../executor.mjs";
import { progressBar } from "../progress.mjs";
import { escape as esc } from "../../lib/util.mjs";
import { data, ctx, cookbookEntry, bookOf, bookLabel } from "./state.mjs";
import { runPageCache } from "./read.mjs";
import { packLabel, importedIdSet, actorEntriesAcrossBooks, familyMemberIds } from "./target.mjs";
import { importMany } from "./actor-import.mjs";
import { packLabelsFor, reportImport } from "./rebuild.mjs";

/**
 * PARSE every recipe against the connected books and report which ones fail,
 * writing nothing. Each entry is executed independently: one failure never
 * stops the pass. `ok: false` is the recipe's own name-anchor check failing;
 * `misses` names the fields that threw underneath. The pass shares ONE page
 * cache per book across every entry. See docs/importer/DECISIONS.md, "The
 * audit: a recipe answers for itself, without importing".
 *
 * @param {object} [options]
 * @param {string[]} [options.ids] audit only these entry ids
 * @param {string[]} [options.books] audit only entries from these book ids
 * @param {string[]} [options.kinds] audit only these entry kinds
 * @param {boolean} [options.art] decode page artwork too (default false) —
 *   costs seconds per entry where the rest of a recipe costs milliseconds.
 * @returns {Promise<{rows: object[], summary: object}>} every row, and the tally
 */
let lastAuditRows = [];

/** Rows the running (or last finished) audit has produced so far. */
export const lastAudit = () => {
  const tally = (k) => lastAuditRows.filter((r) => r.status === k).length;
  return {
    done: lastAuditRows.length,
    ok: tally("ok"),
    noMatch: tally("no-match"),
    threw: tally("threw"),
    noBook: tally("no-book"),
    okButEmpty: lastAuditRows.filter((r) => r.empty).length,
    failing: lastAuditRows
      .filter((r) => r.status === "no-match" || r.status === "threw" || r.empty)
      .map((r) => ({ id: r.id, name: r.name, book: r.book, page: r.page, status: r.status, empty: r.empty, reason: r.reason })),
    slowest: [...lastAuditRows].sort((a, b) => b.ms - a.ms).slice(0, 10).map((r) => ({ id: r.id, kind: r.kind, ms: r.ms })),
  };
};

/** Executes the matching entries, records a row of the outcome per entry as it goes, and returns the rows with a summary; GM only. */
export async function cookbookAudit({ ids = null, books = null, kinds = null, art = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const wanted = ids ? new Set(ids) : null;
  const entries = [];
  for (const source of [data.books, data.content]) {
    for (const cb of source.values()) {
      for (const [id, entry] of Object.entries(cb.entries ?? {})) {
        if (wanted && !wanted.has(id)) continue;
        if (kinds && !kinds.includes(entry.kind)) continue;
        const book = entry.book ?? cb.book?.id ?? (typeof cb.book === "string" ? cb.book : null);
        if (books && !books.includes(book)) continue;
        entries.push({ id, entry, cb, book });
      }
    }
  }
  if (!entries.length) {
    ui.notifications?.warn(`${MODULE_ID} | audit: nothing matched.`);
    return { rows: [], summary: { total: 0 } };
  }

  const pageCache = runPageCache();
  const artCache = runPageCache();
  const rows = [];
  // Published as it goes, not at the end. A whole-corpus pass takes tens of
  // minutes — monster recipes carry art extraction and cost orders more than a
  // proficiency — and a pass that reveals nothing until it returns cannot be
  // watched, cut short, or reported on. `acksExtras.importer.lastAudit()` reads it live.
  lastAuditRows = rows;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAudit`), entries.length);
  try {
    for (const { id, entry, cb, book } of entries) {
      const session = ctx.sessionDocs.get(book);
      const base = { id, name: entry.name, kind: entry.kind, book, page: entry.pages?.[0] ?? null, cite: entry.cite };
      if (!session) {
        rows.push({ ...base, status: "no-book", ms: 0 });
        bar.step(entry.name ?? id);
        continue;
      }
      const t0 = performance.now();
      let node = null;
      let threw = null;
      try {
        node = await executeEntry(session.doc, cb, data.registers, id, {
          pageCache: pageCache(book),
          artCache: artCache(book),
          ...(art ? {} : { skipOps: ["art"] }),
        });
      } catch (err) {
        threw = String(err?.message ?? err);
      }
      rows.push({
        ...base,
        status: threw ? "threw" : node?.ok ? "ok" : "no-match",
        ms: Math.round(performance.now() - t0),
        reason: threw ?? node?.reason ?? null,
        // Two shapes reach `misses`: a FIELD that threw or matched nothing, and
        // a register TOKEN the lookup tables do not know. The second carries no
        // field and is the more actionable of the two — it names a printed word
        // the register has no row for, which is register data to add rather
        // than page geometry to re-measure.
        misses: (node?.misses ?? []).map((m) =>
          m.table ? `register ${m.table}: unknown token "${m.token}"` : `${m.field}: ${m.error ?? "no result"}`,
        ),
        // A recipe can pass its name anchor and still bring back nothing to
        // say — but only counts as empty if it ASKED for prose. A classMeta
        // passage read for one name, or a table read for its grid, declares no
        // description field and is not a defect for lacking one.
        empty:
          !threw &&
          !!node?.ok &&
          !!entry.fields?.description &&
          !(node.fields?.description?.length > 0),
      });
      bar.step(entry.name ?? id);
    }
  } finally {
    bar.finish();
  }

  const tally = (k) => rows.filter((r) => r.status === k).length;
  const summary = {
    total: rows.length,
    ok: tally("ok"),
    noMatch: tally("no-match"),
    threw: tally("threw"),
    noBook: tally("no-book"),
    okButEmpty: rows.filter((r) => r.empty).length,
    withMisses: rows.filter((r) => r.misses?.length).length,
    totalMs: rows.reduce((n, r) => n + r.ms, 0),
  };
  const failing = rows.filter((r) => r.status === "no-match" || r.status === "threw" || r.empty);
  console.log(`${MODULE_ID} | recipe audit`, summary);
  if (failing.length) console.table(failing.map((r) => ({ id: r.id, name: r.name, book: r.book, page: r.page, status: r.status, empty: r.empty, reason: r.reason })));
  ui.notifications.info(
    `${MODULE_ID} | audit: ${summary.ok}/${summary.total} parsed` +
      `${summary.noMatch ? `, ${summary.noMatch} did not match` : ""}` +
      `${summary.threw ? `, ${summary.threw} threw` : ""}` +
      `${summary.okButEmpty ? `, ${summary.okButEmpty} matched but read nothing` : ""}` +
      `${summary.noBook ? `, ${summary.noBook} unreadable (book not connected)` : ""}. Details in console.`,
  );
  return { rows, summary };
}


/* -------------------------------------------- */
/*  Debug window: raw executor output           */
/* -------------------------------------------- */

/**
 * GM inspection popout: execute one cookbook entry against the connected book
 * and show the RAW extract JSON next to nothing — exactly what the binder
 * receives. Ephemeral (session memory only), so binder errors can be traced to
 * either the extraction (wrong here) or the binding (right here, wrong on the
 * actor).
 */
export async function cookbookDebug(entryId) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);

  if (!entryId) {
    const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
    if (!openBooks.length) return ui.notifications.warn(`${MODULE_ID} | connect a cookbook book first (PoC 2 / unlock).`);
    // Every connected book, grouped — debugging one book while three are open
    // should not mean reconnecting.
    const rows = openBooks
      .map((bookId) => {
        const opts = Object.entries(data.books.get(bookId).entries)
          .sort((a, b) => a[1].pages[0] - b[1].pages[0])
          .map(([id, e]) => `<option value="${esc(id)}">${esc(e.name)}${e.cite ? ` — ${esc(e.cite)}` : ""}</option>`)
          .join("");
        return `<optgroup label="${esc(BOOKS[bookId]?.label ?? bookId)}">${opts}</optgroup>`;
      })
      .join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.debugTitle`) },
      classes: ["acks-ui", "acks-extras-importer-dialog"],
      content: `<div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.debugPick`)}</label>
        <select name="entry">${rows}</select></div>`,
      ok: {
        label: game.i18n.localize(`${LANG_PREFIX}.ui.debugGo`),
        callback: (event, button) => cookbookDebug(button.form.elements.entry.value),
      },
    });
  }

  const found = cookbookEntry(entryId);
  if (!found) return ui.notifications.warn(`${MODULE_ID} | unknown cookbook id "${entryId}".`);
  // A content-type cookbook spans books and names one per ENTRY, so the file
  // carries no `book` at all — reading `cb.book.id` throws for every definition
  // id. `bookOf` is the one resolution that answers for both shapes.
  const bookId = bookOf(found);
  const session = bookId ? ctx.sessionDocs.get(bookId) : null;
  if (!session) {
    return ui.notifications.warn(`${MODULE_ID} | ${bookLabel(bookId) ?? entryId} is not open this session.`);
  }

  const node = await executeEntry(session.doc, found.cb, data.registers, entryId);
  // A FAMILY id resolves to a synthesized entry that lives in `cb.families`,
  // never in `cb.entries` — so there is nothing to execute and the node comes
  // back as a bare refusal with no `misses` to render.
  if (node.reason) return ui.notifications.warn(`${MODULE_ID} | ${entryId} is not executable (${node.reason}).`);
  const f = node.fields;
  const pre = (v) => `<pre class="acks-extras-importer-debug-pre">${esc(JSON.stringify(v, null, 1) ?? "null")}</pre>`;
  const statRows = Object.entries(f.stats ?? {})
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(JSON.stringify(v))}</code></td></tr>`)
    .join("");
  const paras = (f.description ?? [])
    .map((p, i) => `<p class="acks-extras-importer-debug-para"><b>[${i}]</b> ${esc(p.text)}</p>`)
    .join("");
  // Built from the parts that are actually present: an entry whose recipe
  // carries no citation would otherwise render its separators around nothing.
  const head = [
    bookLabel(bookId),
    node.cite || null,
    Array.isArray(found.entry.pages) ? `pages ${JSON.stringify(found.entry.pages)}` : null,
    `ok=${node.ok}`,
  ]
    .filter(Boolean)
    .map((part) => esc(String(part)))
    .join(" · ");
  const content = `<div class="acks-extras-importer-debug">
    <p><b>${esc(node.name ?? entryId)}</b> — ${head}</p>
    <details open><summary>expect</summary>${pre(f.name)}</details>
    <details open><summary>stats (${Object.keys(f.stats ?? {}).length})</summary>
      <table class="acks-extras-importer-debug-table">${statRows}</table></details>
    <details open><summary>attacks</summary>${pre(f.attacks ?? null)}</details>
    <details open><summary>spoils</summary>${pre(f.spoils ?? null)}</details>
    <details><summary>art</summary>${pre(f.art ?? null)}</details>
    <details><summary>description (${(f.description ?? []).length} paras — this seat's book, session only)</summary>${paras}</details>
    <details><summary>misses (${node.misses.length})</summary>${pre(node.misses)}</details>
  </div>`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize(`${LANG_PREFIX}.ui.debugTitle`)} — ${node.name}`, resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 640, height: 720 },
    content,
    ok: { label: game.i18n.localize(`${LANG_PREFIX}.ui.close`) },
  });
}

/**
 * GM/dev: import an explicit id list (QA + scripted tests — the same bounded
 * pool the dialog and import-all use, folders included).
 *
 * Builds only the actor kinds `importOne` dispatches (the `actorKindOf` set).
 * Any other kind returns null and goes uncounted, so a list this declines
 * returns the same `0` as a run over a world that already holds every id.
 */
export async function cookbookImportIds(ids) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  // The SAME bounded pool the dialog and import-all use means the same
  // already-present filter too. A monster import always creates — importOne has
  // no reuse to fall back on — so an unfiltered id list leaves two actors
  // claiming one cookbook id, and a companion slot then picks between them
  // arbitrarily.
  const present = await importedIdSet();
  return importMany((ids ?? []).filter((id) => !present.has(id)), game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
}

/** Opens the actor import dialog listing the entries of every open book; GM only. */
export async function cookbookImport() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  if (!openBooks.length) {
    return ui.notifications.warn(
      `${MODULE_ID} | no cookbook book is open this session — connect one first (PoC 2 / unlock dialog).`,
    );
  }
  const have = await importedIdSet();
  const { rows: entryRows } = actorEntriesAcrossBooks();
  // One list across every connected book, with a heading per book so a long
  // list still says where each block came from. The filter matches the book
  // label too, so typing "nethercity" narrows to that book.
  let lastBook = null;
  let lastGroup = null;
  const rows = entryRows
    .map(({ id, entry: e, bookId }) => {
      let head = "";
      if (bookId !== lastBook) {
        lastBook = bookId;
        lastGroup = null;
        head += `<div class="acks-extras-importer-book-head">${esc(BOOKS[bookId]?.label ?? bookId)}</div>`;
      }
      const group = e.meta?.group ?? null;
      if (group && group !== lastGroup) {
        lastGroup = group;
        head += `<div class="acks-extras-importer-group-head">${esc(group)}</div>`;
      }
      const searchable = `${e.name} ${BOOKS[bookId]?.label ?? bookId} ${group ?? ""}`.toLowerCase();
      return `${head}<label class="acks-extras-importer-browse-row" data-name="${esc(searchable)}" data-have="${have.has(id) ? 1 : 0}">
        <input type="checkbox" name="sel" value="${esc(id)}">
        <span>${esc(e.name)}</span>
        <span class="acks-extras-importer-marks">${
          have.has(id)
            ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.cookbookPresent`))}"></i>`
            : ""
        }</span>
        <span class="acks-extras-importer-cite">${esc(e.cite)}</span>
      </label>`;
    })
    .join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.cookbookIntro`, {
      n: entryRows.length,
      book: openBooks.map((b) => BOOKS[b]?.short ?? b).join(", "),
    })}</p>
    <div class="acks-extras-importer-abil-filters">
      <input type="text" name="filter" placeholder="${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookFilter`)}">
      <label><input type="checkbox" name="hideHave"> ${game.i18n.localize(`${LANG_PREFIX}.ui.abilHidePresent`)}</label>
    </div>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="all">${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookSelectAll`)}</button>
      <button type="button" data-act="shown">${game.i18n.localize(`${LANG_PREFIX}.ui.abilSelectShown`)}</button>
      <button type="button" data-act="none">${game.i18n.localize(`${LANG_PREFIX}.ui.abilClear`)}</button>
      <span class="acks-extras-importer-abil-count"></span>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-mon-list">${rows}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 560, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      const listEl = root.querySelector(".acks-extras-importer-mon-list");
      const count = root.querySelector(".acks-extras-importer-abil-count");
      const all = () => [...listEl.querySelectorAll(".acks-extras-importer-browse-row")];
      const shown = () => all().filter((r) => r.style.display !== "none");
      const tally = () => {
        const n = listEl.querySelectorAll('input[name="sel"]:checked').length;
        count.textContent = game.i18n.format(`${LANG_PREFIX}.ui.abilCount`, { n, shown: shown().length });
      };
      const refresh = () => {
        const q = root.querySelector('[name="filter"]').value.toLowerCase();
        const hide = root.querySelector('[name="hideHave"]').checked;
        for (const r of all()) {
          const ok = r.dataset.name.includes(q) && (!hide || r.dataset.have === "0");
          r.style.display = ok ? "" : "none";
          // A hidden row must not stay selected: what the list shows is the only
          // honest account of what pressing Import will do.
          if (!ok) r.querySelector('input[name="sel"]').checked = false;
        }
        tally();
      };
      const check = (rows_) => {
        for (const r of rows_) r.querySelector('input[name="sel"]').checked = true;
        tally();
      };
      for (const sel of ['[name="filter"]', '[name="hideHave"]']) {
        root.querySelector(sel).addEventListener("input", refresh);
      }
      listEl.addEventListener("change", tally);
      // "All" ignores the filter on purpose — it is the whole-book button, and
      // clearing the filter first would silently change what the user is looking
      // at. "Shown" is the filtered counterpart.
      root.querySelector('[data-act="all"]').addEventListener("click", () => {
        root.querySelector('[name="filter"]').value = "";
        root.querySelector('[name="hideHave"]').checked = false;
        refresh();
        check(all());
      });
      root.querySelector('[data-act="shown"]').addEventListener("click", () => check(shown()));
      root.querySelector('[data-act="none"]').addEventListener("click", () => {
        for (const el of listEl.querySelectorAll('input[name="sel"]')) el.checked = false;
        tally();
      });
      tally();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => el.value);
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        // Re-read rather than trusting the marks drawn when the dialog opened —
        // an import may have happened in another window since.
        const present = await importedIdSet();
        const todo = picked.filter((id) => !present.has(id));
        const done = await importMany(todo, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
        reportImport(done, picked.length, picked.length - todo.length, todo);
      },
    },
  });
}

/**
 * GM: import every monster the open book's cookbook ships.
 *
 * The counterpart to importing every ability. Skips what the world already has,
 * so it is a top-up after connecting more of the book, not a duplicator.
 */
export async function cookbookImportMonsters() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  if (!openBooks.length) {
    return ui.notifications.warn(
      `${MODULE_ID} | no cookbook book is open this session — connect one first (PoC 2 / unlock dialog).`,
    );
  }
  // Family MEMBERS don't import individually here — their family's generator
  // template covers them (baseline + select the special case). The dialog
  // still offers members one at a time.
  const members = familyMemberIds();
  const ids = actorEntriesAcrossBooks().rows.map((r) => r.id).filter((id) => !members.has(id));
  const present = await importedIdSet();
  const todo = ids.filter((id) => !present.has(id));
  if (!todo.length) {
    return ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllPresent`, { n: ids.length }));
  }
  // Reading a whole book takes minutes and makes hundreds of actors, so say what
  // is about to happen while it can still be called off.
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllConfirm`, {
      n: todo.length,
      book: openBooks.map((b) => BOOKS[b]?.label ?? b).join(", "),
      pack: packLabelsFor("Actor", todo) || packLabel("Actor"),
    })}${
      todo.length < ids.length
        ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllConfirmSkip`, { skipped: ids.length - todo.length })}`
        : ""
    }</p>`,
  });
  if (!ok) return null;
  const done = await importMany(todo, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
  reportImport(done, ids.length, ids.length - todo.length, todo);
  return { done, skipped: ids.length - todo.length };
}
