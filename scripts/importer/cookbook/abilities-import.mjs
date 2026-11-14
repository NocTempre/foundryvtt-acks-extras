/**
 * Cookbook runtime: bulk ability import, update and prune dialogs.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX, ITEM_TYPE } from "../constants.mjs";
import { blockSums, editedInBlocks } from "../prose.mjs";
import { handWrittenProse } from "../refresh.mjs";
import { decides, heldEdit } from "../held-edits.mjs";
import { BOOKS } from "../books.mjs";
import { progressBar } from "../progress.mjs";
import { elementOf, escape as esc, unset } from "../../lib/util.mjs";
import { ctx, cookbookEntry, bookOf, abilityEntries, cookbookAbilityIds } from "./state.mjs";
import { passedOver, runPageCache, readForImport } from "./read.mjs";
import {
  packLabel, WRITE_CHUNK, createDocs, importedIndex, importedDocs, deleteImported, importedItem, prepareItemShelves,
} from "./target.mjs";
import { bindAbility, ABILITY_EXTRAS_OPTIONAL, allAbilities, idForName, abilityNameIndex } from "./abilities.mjs";
import { laddersForEntry } from "./classes.mjs";
import { importAbility, abilityData, resolveCompanions } from "./actor-import.mjs";

/* -------------------------------------------- */
/*  Bulk import / update                        */
/* -------------------------------------------- */

/**
 * GM: browse every shipped ability and pick which to import.
 *
 * The counterpart to the monster import dialog. The header says which books
 * are open, because an ability imports from its book alone: one whose book is
 * not open on this seat is passed over, and the closing notice says how many.
 */
export async function cookbookImportAbilitiesDialog() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const rows = [];
  for (const [id, e] of abilityEntries()) {
    rows.push({ id, name: e.name, cite: e.cite, book: e.book, category: e.meta?.category ?? "proficiency", alias: !!e.aliasOf, deprecated: !!e.meta?.deprecated });
  }
  if (!rows.length) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);
  rows.sort((a, b) => a.name.localeCompare(b.name));

  // The present marks have to name the shelf the import writes to, or a
  // compendium-mode world shows every ability as missing and the GM ticks a
  // list they already hold.
  const have = new Set((await importedIndex()).keys());
  const openBooks = [...new Set(rows.map((r) => r.book))].filter((b) => ctx.sessionDocs.has(b));
  const cats = [...new Set(rows.map((r) => r.category))].sort();

  const list = rows
    .map((r) => {
      const marks = [
        r.alias ? `<i class="fa-solid fa-link" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilAlias`))}"></i>` : "",
        r.deprecated ? `<i class="fa-solid fa-triangle-exclamation" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilDeprecated`))}"></i>` : "",
        have.has(r.id) ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilPresent`))}"></i>` : "",
      ].join("");
      return `<label class="acks-extras-importer-browse-row" data-name="${esc(r.name.toLowerCase())}" data-cat="${esc(r.category)}" data-have="${have.has(r.id) ? 1 : 0}">
        <input type="checkbox" name="sel" value="${esc(r.id)}">
        <span>${esc(r.name)}</span><span class="acks-extras-importer-marks">${marks}</span>
        <span class="acks-extras-importer-cite">${esc(r.cite)}</span>
      </label>`;
    })
    .join("");

  const catOptions = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.abilIntro`, {
      n: rows.length,
      books: openBooks.length ? openBooks.map((b) => BOOKS[b].short).join(", ") : game.i18n.localize(`${LANG_PREFIX}.ui.abilNoBook`),
    })}</p>
    <div class="acks-extras-importer-abil-filters">
      <input type="text" name="filter" placeholder="${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookFilter`)}">
      <select name="cat"><option value="">${game.i18n.localize(`${LANG_PREFIX}.ui.abilAllCats`)}</option>${catOptions}</select>
      <label><input type="checkbox" name="hideHave"> ${game.i18n.localize(`${LANG_PREFIX}.ui.abilHidePresent`)}</label>
    </div>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="all">${game.i18n.localize(`${LANG_PREFIX}.ui.abilSelectShown`)}</button>
      <button type="button" data-act="none">${game.i18n.localize(`${LANG_PREFIX}.ui.abilClear`)}</button>
      <span class="acks-extras-importer-abil-count"></span>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-abil-list">${list}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.abilTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 620, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      const listEl = root.querySelector(".acks-extras-importer-abil-list");
      const count = root.querySelector(".acks-extras-importer-abil-count");
      const shown = () => [...listEl.querySelectorAll(".acks-extras-importer-browse-row")].filter((r) => r.style.display !== "none");
      const refresh = () => {
        const q = root.querySelector('[name="filter"]').value.toLowerCase();
        const cat = root.querySelector('[name="cat"]').value;
        const hide = root.querySelector('[name="hideHave"]').checked;
        for (const r of listEl.querySelectorAll(".acks-extras-importer-browse-row")) {
          const ok = r.dataset.name.includes(q) && (!cat || r.dataset.cat === cat) && (!hide || r.dataset.have === "0");
          r.style.display = ok ? "" : "none";
          if (!ok) r.querySelector('input[name="sel"]').checked = false;
        }
        tally();
      };
      const tally = () => {
        const n = listEl.querySelectorAll('input[name="sel"]:checked').length;
        count.textContent = game.i18n.format(`${LANG_PREFIX}.ui.abilCount`, { n, shown: shown().length });
      };
      for (const sel of ['[name="filter"]', '[name="cat"]', '[name="hideHave"]']) {
        root.querySelector(sel).addEventListener("input", refresh);
      }
      listEl.addEventListener("change", tally);
      root.querySelector('[data-act="all"]').addEventListener("click", () => {
        for (const r of shown()) r.querySelector('input[name="sel"]').checked = true;
        tally();
      });
      root.querySelector('[data-act="none"]').addEventListener("click", () => {
        for (const r of listEl.querySelectorAll('input[name="sel"]')) r.checked = false;
        tally();
      });
      tally();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.abilGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => el.value);
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAbilities`), picked.length);
        let done = 0;
        const passed = passedOver();
        try {
          await prepareItemShelves();
          const folder = null; // per-id shelf
          for (const id of picked) {
            if (await importAbility(id, folder, { passed }).catch((err) => (console.error(`${MODULE_ID} | import ${id}`, err), null))) done++;
            bar.step(cookbookEntry(id)?.entry?.name ?? id);
          }
        } finally {
          bar.finish();
        }
        ui.notifications.info(
          game.i18n.format(`${LANG_PREFIX}.ui.abilDone`, { done, picked: picked.length, pack: packLabel("Item") }) +
            (passed.closed ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.abilPassed`, { n: passed.closed })}` : ""),
        );
      },
    },
  });
}

/** GM: import every shipped ability as a shared, deduped item. */
export async function cookbookImportAbilities({ only = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const ids = cookbookAbilityIds().filter((id) => !only || only.has(id));
  if (!ids.length) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAbilities`), ids.length);
  let made = 0;
  let reused = 0;
  const passed = passedOver();
  try {
    await prepareItemShelves();
    const pageCache = runPageCache();
    // BUILD every document first, WRITE them a chunk at a time.
    // See docs/importer/DECISIONS.md, "Writes are batched, because a write costs what the shelf already holds".
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      // `createDocs` teaches the dedup index itself: every document it makes
      // goes through `remembered`, which reads the id off the document's own
      // flag, never the batch's position.
      const written = await createDocs(Item, batch.map((b) => b.data));
      made += written.filter(Boolean).length; // positional: nulls are failures, not imports
      batch = [];
    };
    for (const id of ids) {
      bar.step(cookbookEntry(id)?.entry?.name ?? id);
      if (await importedItem(id)) {
        reused++;
        continue;
      }
      const { data, reason } = await abilityData(id, { pageCache }).catch((err) => {
        console.error(`${MODULE_ID} | build ${id}`, err);
        return { data: null, reason: null };
      });
      if (!data) {
        passed.count(reason);
        continue;
      }
      batch.push({ id, data });
      if (batch.length >= WRITE_CHUNK) await flush();
    }
    await flush();
  } finally {
    bar.finish();
  }
  ui.notifications.info(`${MODULE_ID} | abilities: ${made} imported, ${reused} already present${passed.clause}.`);
  return { made, reused, closed: passed.closed, unmatched: passed.unmatched };
}

/** A description reduced to one readable line, so a dialog row fits on screen. */
function proseExcerpt(html, max = 160) {
  const text = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The name a kept-by-its-owner ability moves to.
 *
 * The rename is only worth anything if the new name stops folding to the
 * definition: folded names are how Update adopts an unflagged item, so a marker
 * that folds away to nothing would let the next run adopt the item again and
 * take the prose after all. Folding drops case and punctuation, so the marker
 * has to carry letters. A counter is added in the pathological case where a
 * shipped definition prints the marked name — bounded because each attempt is a
 * distinct name and only the finitely many in the index can collide.
 */
function asideName(index, present, name) {
  const marked = (n) => game.i18n.format(`${LANG_PREFIX}.ui.renamedName`, { name: n });
  let out = marked(name);
  for (let n = 2; n <= index.size + 2 && idForName(index, out, present); n++) out = marked(`${name} ${n}`);
  return out;
}

/**
 * Ask what happens to each name-adopted ability whose description Update would
 * replace, and resolve to a row index -> "rename" | "overwrite" map.
 *
 * ONE dialog for the whole run, with apply-to-all on both choices: a world that
 * imported the corpus produces collisions by the hundred, and a per-item prompt
 * a GM cannot answer in bulk gets clicked through, which is the same data loss
 * with more steps. Dismissal returns an empty map — every ambiguous item is
 * then left exactly as it was, because a closed dialog is not consent.
 */
async function askAboutAdoptedProse(rows) {
  const label = {
    rename: game.i18n.localize(`${LANG_PREFIX}.ui.collideRename`),
    overwrite: game.i18n.localize(`${LANG_PREFIX}.ui.collideOverwrite`),
  };
  const list = rows
    .map((r, i) => {
      const excerpt = proseExcerpt(r.prose);
      return `<div class="acks-extras-importer-collide-row">
        <div style="display:flex;gap:.5em;align-items:baseline;">
          <strong>${esc(r.name)}</strong>
          <span class="acks-extras-importer-cite">${esc(r.where)}${r.cite ? ` · ${esc(r.cite)}` : ""}</span>
        </div>
        ${excerpt ? `<div class="acks-extras-importer-cite" style="font-style:italic;">${esc(excerpt)}</div>` : ""}
        <div style="display:flex;gap:1em;flex-wrap:wrap;">
          <label><input type="radio" name="c${i}" value="rename" checked> ${esc(label.rename)} "${esc(r.aside)}"</label>
          <label><input type="radio" name="c${i}" value="overwrite"> ${esc(label.overwrite)}</label>
        </div>
      </div>`;
    })
    .join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.collideIntro`, { n: rows.length })}</p>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="rename">${game.i18n.localize(`${LANG_PREFIX}.ui.collideAllRename`)}</button>
      <button type="button" data-act="overwrite">${game.i18n.localize(`${LANG_PREFIX}.ui.collideAllOverwrite`)}</button>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-collide-list">${list}</div>`;

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.collideTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 640, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      for (const act of ["rename", "overwrite"]) {
        root.querySelector(`[data-act="${act}"]`).addEventListener("click", () => {
          for (const input of root.querySelectorAll(`.acks-extras-importer-collide-list input[value="${act}"]`)) {
            input.checked = true;
          }
        });
      }
    },
    buttons: [
      {
        action: "apply",
        default: true,
        label: game.i18n.localize(`${LANG_PREFIX}.ui.collideApply`),
        callback: (event, button) => {
          const out = new Map();
          for (let i = 0; i < rows.length; i++) {
            const choice = button.form.querySelector(`input[name="c${i}"]:checked`)?.value;
            if (choice) out.set(i, choice);
          }
          return out;
        },
      },
      { action: "keep", label: game.i18n.localize(`${LANG_PREFIX}.ui.collideKeepAll`), callback: () => new Map() },
    ],
    rejectClose: false,
  });
  return picked instanceof Map ? picked : new Map();
}

/**
 * Put the module's own item for a definition where the original one lives — on
 * the actor holding it, or in the item library. Never a second copy: a holder
 * that already carries this definition needs nothing added.
 */
async function placeGeneratedBeside(holder, id, built) {
  if (!holder) return (await importedItem(id)) ? null : importAbility(id, null);
  if (holder.items.some((i) => i.getFlag(MODULE_ID, "cookbook")?.id === id)) return null;
  const [made] = await holder.createEmbeddedDocuments("Item", [built]);
  return made ?? null;
}

/**
 * GM: refresh every ability already in the world — loose items AND the
 * copies embedded on actors — against the current cookbook.
 *
 * Matched by cookbook id first, then by folded NAME, so abilities made by
 * hand or imported earlier get adopted and repaired rather than duplicated. Only the generated surface is rewritten; the item's name and
 * the system fields a GM may have tuned are left alone.
 *
 * An item this module FLAGGED is rewritten outright. An item matched only by
 * NAME is somebody else's, so its description is never replaced silently:
 * those are collected during the walk and settled by one dialog afterwards.
 * Both outcomes are idempotent — running twice leaves the same world as
 * running once.
 * A page is extracted once per run, however many definitions print on it.
 * See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create"
 * and "A bulk import reads each page once".
 *
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.only] cookbook ids to refresh; every ability when null
 * @param {object|null} [opts.repair] a `repairTally` to count into
 */
export async function cookbookUpdateAbilities({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const index = abilityNameIndex();
  if (!index.size) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);

  // Which definitions the world already holds — the signal that resolves a
  // name collision without guessing.
  const present = new Set((await importedIndex()).keys());
  const nodeCache = new Map();
  // One extraction per page for the whole run: a page prints several
  // definitions, and each is re-executed once. Ladders are resolved apart, with
  // their own reads.
  const pageCache = runPageCache();
  // Resolved once per definition like the node it sits beside: expanding a
  // fromLadders spec re-executes another entry, and a sweep touches many copies.
  const ladderCache = new Map();
  let updated = 0;
  let adopted = 0;
  let onActors = 0;
  let guessed = 0;
  let skipped = 0;
  let renamed = 0;
  let created = 0;
  let overwritten = 0;
  let kept = 0;
  let preserved = 0;
  // Entries passed over because their book is not open on this seat. Counted
  // apart from `preserved`: that one reports a Judge's own writing kept against
  // a rebuild that happened, and these had no rebuild worth writing.
  let unread = 0;
  // Name-adopted items whose description carries someone else's writing. The
  // write is held back until the GM has answered for them.
  const collisions = [];
  // Guessed resolutions by name, reported once each after the walk: a world
  // holds many copies of one ability, one per actor that carries it.
  const guesses = new Map();
  /** Rewrite the generated surface — the descriptor, the cookbook id, the
   * extras. The written extras carry a forced deletion for every optional
   * subkey the rebuild no longer emits (ABILITY_EXTRAS_OPTIONAL), in a copy —
   * `built` stays clean for the create path, which must not carry deletions
   * into fresh documents.
   *
   * `keepProse` holds back the description and nothing else; the mechanics
   * are always rewritten. */
  const writeGenerated = (doc, built, { keepProse = false } = {}) => {
    const extras = { ...built.flags[MODULE_ID].extras };
    for (const key of ABILITY_EXTRAS_OPTIONAL) {
      if (!(key in extras)) extras[key] = unset();
    }
    return doc.update({
      ...(keepProse ? {} : { "system.description": built.system.description }),
      // The description written is the one whose digest the stamp records.
      [`flags.${MODULE_ID}.cookbook`]: keepProse
        ? built.flags[MODULE_ID].cookbook
        : { ...built.flags[MODULE_ID].cookbook, sums: blockSums(built.system.description, "system.description") },
      [`flags.${MODULE_ID}.extras`]: extras,
    });
  };
  // Counted first: this walks every ability in the world, actors included, and
  // re-extracts each definition it has not seen — hundreds of items on a world
  // that imported the whole corpus.
  const all = await allAbilities();
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressUpdate`), all.length);
  try {
    for (const { doc, extras, on } of all) {
      bar.step(doc.name);
      const flagged = doc.getFlag(MODULE_ID, "cookbook")?.id;
      const guess = flagged ? null : idForName(index, doc.name, present);
      const id = flagged ?? guess?.id;
      if (only && !only.has(id)) continue;
      if (!id || !cookbookEntry(id)) {
        skipped++;
        continue;
      }
      if (guess?.ambiguous || guess?.ranked) {
        if (guess.ambiguous) guessed++;
        const seen = guesses.get(doc.name) ?? { guess, copies: 0 };
        seen.copies++;
        guesses.set(doc.name, seen);
      }
      const found = cookbookEntry(id);
      // Re-extract once per definition, not once per copy of it.
      if (!nodeCache.has(id)) {
        const read = await readForImport(id, { pageCache: pageCache(bookOf(found)) }).catch(() => ({ node: null }));
        nodeCache.set(id, read.node);
      }
      const node = nodeCache.get(id);
      // Nothing was read — this entry's book is not open on this seat, or its
      // extraction failed — so nothing can be rebuilt from it. Left exactly
      // as it is: connect the book and run it again.
      // See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create".
      if (!node) {
        unread++;
        continue;
      }
      if (!ladderCache.has(id)) ladderCache.set(id, await laddersForEntry(found.entry));
      const built = bindAbility(found.entry, node, id, {
        // A copy that recorded arriving under an older name keeps saying so.
        ...(extras.conversionStatus ? { conversionStatus: extras.conversionStatus } : {}),
        ...(extras.conversionFrom ? { conversionFrom: extras.conversionFrom } : {}),
        ...(ladderCache.get(id) ? { ladders: ladderCache.get(id) } : {}),
      });
      built.flags[MODULE_ID].extras.effects = await resolveCompanions(built.flags[MODULE_ID].extras.effects);
      // Authorship of the ITEM and authorship of its DESCRIPTION are
      // different questions: a Judge who annotated a description this
      // module created still wrote those words.
      const prose = doc.system?.description;
      // A forced repair writes the description of a document this module made
      // whatever a Judge put in it; a document it did not make (`!flagged`) is
      // still the Judge's own and still waits for an answer.
      // An edit inside the block the import wrote is the Judge's too (`editedInBlocks`).
      const edited = !!flagged && editedInBlocks(doc.flags?.[MODULE_ID]?.cookbook?.sums, "system.description", prose);
      let annotated = (handWrittenProse(prose) || edited) && !(flagged && repair?.force);
      // Under a decision a description this module made is the Judge's edit:
      // written where the decision takes it, else kept and listed.
      if (flagged && annotated && repair && "decision" in repair && prose !== built.system?.description) {
        const edit = heldEdit({ uuid: doc.uuid, name: doc.name, path: "system.description", current: prose, page: built.system?.description, cite: found.entry?.cite ?? "" });
        if (decides(repair.decision, edit.key) === "take") annotated = false;
        else (repair.edits ??= []).push(edit);
      }
      if (flagged && annotated) {
        await writeGenerated(doc, built, { keepProse: true });
        updated++;
        preserved++;
        if (on) onActors++;
        continue;
      }
      if (!flagged && annotated) {
        collisions.push({
          doc,
          on,
          id,
          built,
          prose,
          name: doc.name,
          cite: found.entry?.cite ?? "",
          where: on ? game.i18n.format(`${LANG_PREFIX}.ui.collideOn`, { actor: on.name }) : game.i18n.localize(`${LANG_PREFIX}.ui.collideWorld`),
          aside: asideName(index, present, doc.name),
        });
        continue;
      }
      await writeGenerated(doc, built);
      updated++;
      if (!flagged) adopted++;
      if (on) onActors++;
    }
  } finally {
    bar.finish();
  }

  if (collisions.length) {
    // A forced repair is not an answer to "whose is this": the documents here
    // are the Judge's own by name, and each is left as it is.
    // A merged repair's second pass already had its answer from the first.
    const choices = repair?.force || repair?.answered ? new Map() : await askAboutAdoptedProse(collisions);
    kept = collisions.length - choices.size;
    if (repair?.force) repair.handMade += kept;
    const bar2 = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressResolve`), choices.size);
    try {
      for (const [i, choice] of choices) {
        const row = collisions[i];
        bar2.step(row.name);
        if (choice === "overwrite") {
          await writeGenerated(row.doc, row.built);
          updated++;
          adopted++;
          if (row.on) onActors++;
          overwritten++;
          continue;
        }
        // The original moves aside with its prose and its own flags untouched;
        // the reference is created beside it, flagged, so later runs maintain
        // that one and leave this one alone forever.
        await row.doc.update({ name: row.aside });
        renamed++;
        if (await placeGeneratedBeside(row.on, row.id, row.built)) created++;
      }
    } finally {
      bar2.finish();
    }
  }

  for (const [name, { guess, copies }] of guesses) {
    const line = `${MODULE_ID} | "${name}" (${copies} cop${copies === 1 ? "y" : "ies"})`;
    if (guess.ambiguous) console.warn(`${line} matches several definitions; resolved to ${guess.id}.`);
    else console.debug(`${line} names definitions in several categories; ranked to ${guess.id}.`);
  }
  if (repair) {
    repair.replaced += updated;
    repair.keptProse += preserved;
    repair.refused += unread;
  }
  const stale = (await danglingAbilities()).length;
  ui.notifications.info(
    `${MODULE_ID} | abilities updated: ${updated} (${onActors} on actors, ${adopted} matched by name` +
      `${guessed ? `, ${guessed} of them ambiguous — see console` : ""}), ${skipped} not in the cookbook` +
      `${renamed ? `; ${renamed} of your own renamed aside, ${created} reference(s) created beside them` : ""}` +
      `${overwritten ? `; ${overwritten} replaced on request` : ""}` +
      `${preserved ? `; ${preserved} kept the description you wrote` : ""}` +
      `${unread ? `; ${unread} left untouched — their book is not open on this seat` : ""}` +
      `${kept ? `; ${kept} left untouched` : ""}` +
      `${stale ? `; ${stale} left over from a withdrawn definition — run Prune` : ""}.`,
  );
  return { updated, adopted, onActors, guessed, skipped, renamed, created, overwritten, kept, preserved, unread, stale };
}

/**
 * Ability items this module generated whose definition no longer exists. A
 * withdrawn definition's items stay behind in every world that imported
 * them, pointing at nothing. They are unambiguously ours (minted, with a
 * cookbook id that no longer resolves), which is what makes them safe to
 * offer for removal.
 */
export async function danglingAbilities() {
  const out = [];
  for (const item of await importedDocs("Item")) {
    if (item.type !== ITEM_TYPE.ABILITY) continue;
    const flags = item.getFlag(MODULE_ID, "cookbook");
    if (!flags?.id || !item.getFlag(MODULE_ID, "minted")) continue;
    if (!cookbookEntry(flags.id)) out.push(item);
  }
  return out;
}

/**
 * GM: remove those items, after showing exactly what will go. Never silent —
 * deleting documents out of someone's world is not a thing to do quietly, even
 * when they are certainly stale.
 */
export async function cookbookPruneAbilities() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const stale = await danglingAbilities();
  if (!stale.length) return ui.notifications.info(game.i18n.localize(`${LANG_PREFIX}.ui.pruneNone`));
  const rows = stale
    .map((i) => `<li>${esc(i.name)} <code>${esc(i.getFlag(MODULE_ID, "cookbook").id)}</code></li>`)
    .join("");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.pruneTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.prunePrompt`, { n: stale.length })}</p>
      <ul class="acks-extras-importer-browse-list">${rows}</ul>`,
  });
  if (!ok) return null;
  await deleteImported("Item", stale);
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.pruneDone`, { n: stale.length }));
  return stale.length;
}

/**
 * GM-only Import All / Update All buttons at the top of the Item directory.
 *
 * Both are idempotent, which is what makes them safe to hand a GM: importing
 * twice reuses the existing items rather than duplicating them, and updating
 * only rewrites the generated surface. Buttons disable while running — these
 * touch every ability in the world and a double-click would interleave.
 */
export function registerAbilityDirectoryButtons() {
  Hooks.on("renderItemDirectory", (app, element) => {
    if (!game.user.isGM) return;
    const root = elementOf(element);
    if (!root || root.querySelector(".acks-extras-importer-ability-tools")) return;

    const bar = document.createElement("div");
    bar.className = "acks-extras-importer-ability-tools";
    const button = (labelKey, tipKey, icon, run) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i class="${icon}"></i> ${game.i18n.localize(`${LANG_PREFIX}.ui.${labelKey}`)}`;
      b.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.ui.${tipKey}`);
      b.addEventListener("click", async () => {
        for (const x of bar.querySelectorAll("button")) x.disabled = true;
        try {
          await run();
        } catch (err) {
          console.error(`${MODULE_ID} | ability tools`, err);
          ui.notifications.error(`${MODULE_ID} | ${err.message}`);
        } finally {
          for (const x of bar.querySelectorAll("button")) x.disabled = false;
        }
      });
      return b;
    };
    bar.append(
      button("browseAbilities", "browseAbilitiesTip", "fa-solid fa-list-check", cookbookImportAbilitiesDialog),
      button("importAllAbilities", "importAllAbilitiesTip", "fa-solid fa-download", cookbookImportAbilities),
      button("updateAllAbilities", "updateAllAbilitiesTip", "fa-solid fa-rotate", cookbookUpdateAbilities),
      button("pruneAbilities", "pruneAbilitiesTip", "fa-solid fa-broom", cookbookPruneAbilities),
    );
    (root.querySelector(".directory-header") ?? root).prepend(bar);
  });
  // The sidebar renders before this module's `ready` runs, so the hook above
  // misses that first pass — re-render once to catch it.
  if (ui.items?.rendered) ui.items.render();
}
