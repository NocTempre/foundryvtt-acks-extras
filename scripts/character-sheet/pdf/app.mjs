/* global foundry, game, ui, fromUuid, Hooks */
/**
 * The official-sheet window: read a filled copy of the official character
 * sheet onto a character, or into a new one, and its domain page into the
 * character's domain; see what the import wrote and what disagreed with it;
 * and write a character into a blank copy of the form. One window per
 * character, and one for a new character.
 *
 * The file is read the moment it is picked, and the window shows what it
 * will match before anything is written. An export writes into the official
 * sheet the importer holds open on this seat (`blankSheet`), from Your Books
 * on the server or connected on this seat, and the window re-renders when a
 * book opens so its state is current.
 */
import { makeLoc } from "../../lib/util.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";
import { whenReady } from "../../lib/library.mjs";
import { openBook } from "../../importer/extract.mjs";
import { LANG, MODULE_ID } from "../constants.mjs";
import { readForm } from "./form.mjs";
import { buildPlan } from "./plan.mjs";
import { matchAbility, matchClass, matchHenchman, matchLanguage, matchSpell } from "./match.mjs";
import { domainWritable, importSheet, keepSheetValue } from "./apply.mjs";
import { exportSheet, saveExport, sheetDomain } from "./export.mjs";
import { clean } from "./parse.mjs";
import { SHEET_BOOK, blankSheet } from "./blank.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const loc = makeLoc(LANG);

/** Open windows, by actor id ("" for the new-character window). */
const windows = new Map();

/**
 * An id for a new-character window. A window that imported keeps the id it
 * opened with, so the next new one takes a free id beside it: a second window
 * under the same id would take over the first's frame.
 */
function newWindowId() {
  let id = "acks-extras-sheetpdf-new";
  for (let n = 2; foundry.applications.instances.has(id); n++) id = `acks-extras-sheetpdf-new-${n}`;
  return id;
}

/** The importer's api, absent while it is not running on this seat. */
const importer = () => globalThis.acksExtras?.importer ?? null;

/** Open a PDF's bytes in pdf.js, hand the document to `use`, and release it. */
async function withPdf(bytes, use) {
  const { doc } = await openBook(bytes);
  try {
    return await use(doc);
  } finally {
    await (doc.destroy?.() ?? doc.loadingTask?.destroy?.());
  }
}

/** A share of the form's fields, as a percentage for a message. */
const percent = (share) => Math.round((Number(share) || 0) * 100);

/** Where an import would write the domain page, and whether the reader may choose. */
function domainTarget(plan, actor) {
  const writable = domainWritable();
  if (writable !== "ok") return { text: loc(writable === "judgeOnly" ? "pdf.preview.domainJudgeOnly" : "pdf.preview.domainNoType"), choice: false };
  const name = clean(plan.domain["domain.name"]);
  const found = sheetDomain(actor, { name });
  return {
    text: found ? loc("pdf.preview.domainUpdates", { name: found.name }) : loc("pdf.preview.domainCreates", { name: name || game.i18n.localize("ACKS-DOMAINS.sheet.unnamed") }),
    choice: true,
  };
}

/**
 * What an import of these values will do, before it does it: the class, how
 * much of each list the world has, the henchmen the roster holds, and the
 * domain the domain page goes into.
 */
async function previewOf(values, actor) {
  await whenReady();
  const plan = buildPlan(values);
  const cls = matchClass(plan.className);
  const count = (list, match) => ({ found: list.filter(match).length, total: list.length });
  const abilities = count(plan.abilities, (a) => !!matchAbility(a));
  const languages = { found: (await Promise.all(plan.languages.map(matchLanguage))).filter(Boolean).length, total: plan.languages.length };
  const spells = count([...plan.spells.known.map((s) => s.name), ...plan.spells.rituals], (n) => !!matchSpell(n));
  const onRoster = actor ? plan.henchmen.filter((h) => h.name && matchHenchman(actor, h.name)).length : 0;
  const others = plan.henchmen.length - onRoster;
  const matched = ({ found, total }) => ({ text: loc("pdf.preview.matched", { found, total }), warn: found < total });
  const rows = [
    { label: loc("pdf.preview.character"), text: plan.name || loc("pdf.unnamed") },
    { label: loc("pdf.preview.target"), text: actor ? loc("pdf.preview.updates", { name: actor.name }) : loc("pdf.preview.creates") },
    {
      label: loc("pdf.preview.class"),
      text: cls ? [cls.name, plan.level].filter((x) => x !== null && x !== "").join(" ") : plan.className ? loc("pdf.preview.notFound", { name: plan.className }) : "—",
      warn: !cls && !!plan.className,
    },
  ];
  if (abilities.total) rows.push({ label: loc("pdf.preview.abilities"), ...matched(abilities) });
  if (languages.total) rows.push({ label: loc("pdf.preview.languages"), ...matched(languages) });
  if (spells.total) rows.push({ label: loc("pdf.preview.spells"), ...matched(spells) });
  if (plan.gear.length || plan.weapons.length) rows.push({ label: loc("pdf.preview.gear"), text: loc("pdf.preview.lines", { count: plan.gear.length + plan.weapons.length }) });
  if (plan.henchmen.length) rows.push({ label: loc("pdf.preview.henchmen"), text: loc("pdf.preview.henchmenCount", { roster: onRoster, other: others }) });
  const domain = Object.keys(plan.domain).length ? domainTarget(plan, actor) : null;
  if (domain) rows.push({ label: loc("pdf.preview.domain"), text: domain.text });
  return { rows, canCreateHenchmen: others > 0 && game.user.can("ACTOR_CREATE"), canWriteDomain: !!domain?.choice };
}

/** The official-sheet window. */
export class SheetPdfApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-sheetpdf"],
    position: { width: 560, height: 640 },
    window: { title: `${LANG}.pdf.title`, icon: "fa-solid fa-file-pdf", resizable: true },
    actions: {
      import: SheetPdfApp.#onImport,
      keep: SheetPdfApp.#onKeep,
      export: SheetPdfApp.#onExport,
      books: SheetPdfApp.#onBooks,
      openActor: SheetPdfApp.#onOpenActor,
    },
  };

  // The body is its own scroller so a re-render keeps its place; the footer
  // is a second part so Import never scrolls away.
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/character-sheet/pdf.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/character-sheet/pdf-footer.hbs` },
  };

  /** @type {Actor|null} */
  #actor = null;
  /** The picked file's name and what reading it found: `{name, values, isForm, share}`. */
  #read = null;
  #readError = "";
  #preview = null;
  #createHenchmen = false;
  #writeDomain = true;
  /** The last import's report, and which of its checks were since kept. */
  #report = null;
  #kept = new Set();
  #exportNote = null;
  #busy = false;
  #bookHook = null;
  /**
   * The key this window is kept under in `windows`. A field of its own:
   * an application's options are frozen once it is constructed, so the key
   * an import moves the window to cannot be written back into them.
   */
  #windowKey = "";

  constructor(options = {}) {
    super(options);
    this.#actor = options.actor ?? null;
    this.#windowKey = options.windowKey ?? "";
  }

  /** @override */
  get title() {
    const base = game.i18n.localize(this.options.window.title);
    return this.#actor ? `${base}: ${this.#actor.name}` : base;
  }

  /** @override */
  async _prepareContext() {
    const actor = this.#actor;
    const report = this.#report;
    const books = importer();
    const sheetOpen = !!books?.bookOpen?.(SHEET_BOOK);
    const book = books?.BOOKS?.[SHEET_BOOK]?.label ?? "";
    return {
      importHint: actor ? loc("pdf.import.hintUpdate", { name: actor.name }) : loc("pdf.import.hintCreate"),
      fileName: this.#read?.name ?? "",
      readError: this.#readError,
      preview: this.#preview,
      createHenchmen: this.#createHenchmen,
      writeDomain: this.#writeDomain,
      report: report && {
        heading: loc(report.created ? "pdf.report.created" : "pdf.report.updated", { name: report.actor.name }),
        uuid: report.actor.uuid,
        counts: loc("pdf.report.counts", { written: report.written.length, granted: report.granted.length, checks: report.checks.length, unmatched: report.unmatched.length }),
        written: report.written,
        granted: report.granted.join(", "),
        checks: report.checks.map((c, index) => ({ ...c, index, canKeep: !!c.keep && !this.#kept.has(index), kept: this.#kept.has(index) })),
        unmatched: report.unmatched.map((u) => ({ kind: loc(`pdf.unmatched.${u.kind}`), name: u.name })),
        henchmen: report.henchmen.map((h) => ({ ...h, outcome: loc(`pdf.henchOutcome.${h.outcome}`) })),
        domain: report.domain && {
          ...report.domain,
          name: report.domain.name || loc("pdf.preview.domain"),
          outcome: loc(`pdf.domainOutcome.${report.domain.outcome}`),
        },
      },
      canExport: !!actor?.isOwner,
      sheetOpen,
      sheetNote: !books ? loc("pdf.export.noImporter") : loc(sheetOpen ? "pdf.export.sheetOpen" : "pdf.export.sheetClosed", { book }),
      canOpenBooks: typeof books?.bookStatus === "function",
      exportNote: this.#exportNote,
      busy: this.#busy,
      cannotImport: this.#busy || !this.#read?.isForm,
      cannotExport: this.#busy || !sheetOpen,
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => this.#onChange(event));
    this.#bookHook = Hooks.on("acksExtras.bookOpened", (bookId) => {
      if (bookId === SHEET_BOOK && !this.#busy) this.render();
    });
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (this.#bookHook !== null) Hooks.off("acksExtras.bookOpened", this.#bookHook);
    this.#bookHook = null;
    if (windows.get(this.#key) === this) windows.delete(this.#key);
  }

  get #key() {
    return this.#windowKey;
  }

  /** A control changed: a file was picked, or an opt-in toggled. */
  async #onChange(event) {
    const el = event.target;
    if (!el?.matches?.("input")) return;
    if (el.name === "createHenchmen") {
      this.#createHenchmen = el.checked;
      return;
    }
    if (el.name === "writeDomain") {
      this.#writeDomain = el.checked;
      return;
    }
    const file = el.name === "importFile" ? el.files?.[0] : null;
    if (!file || this.#busy) return;
    this.#busy = true;
    await this.render();
    try {
      await this.#readImport(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      console.error(`${MODULE_ID} | official sheet`, err);
      this.#readError = loc("pdf.error.unreadable", { name: file.name });
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  /** Read a filled sheet and preview what importing it will do. */
  async #readImport(name, bytes) {
    this.#readError = "";
    this.#preview = null;
    this.#report = null;
    this.#kept.clear();
    const read = await withPdf(bytes, (doc) => readForm(doc));
    this.#read = { name, ...read };
    if (!read.isForm) {
      this.#readError = loc("pdf.error.notForm", { name, share: percent(read.share) });
      return;
    }
    this.#preview = await previewOf(read.values, this.#actor);
  }

  /** Import the read sheet. */
  static async #onImport() {
    if (this.#busy || !this.#read?.isForm) return;
    this.#busy = true;
    await this.render({ parts: ["footer"] });
    try {
      this.#report = await importSheet({ actor: this.#actor, values: this.#read.values, createHenchmen: this.#createHenchmen, writeDomain: this.#writeDomain });
      this.#kept.clear();
      this.#actor = this.#report.actor;
      // The new-character window now belongs to the character it made, so
      // the directory's button opens a fresh one for the next.
      if (!this.#key) {
        windows.delete("");
        this.#windowKey = this.#actor.id;
        windows.set(this.#actor.id, this);
      }
      this.#preview = await previewOf(this.#read.values, this.#actor);
      ui.notifications.info(loc("pdf.report.done", { name: this.#actor.name }));
    } catch (err) {
      console.error(`${MODULE_ID} | official sheet import`, err);
      ui.notifications.error(err.message);
    } finally {
      this.#busy = false;
      this.render({ window: { title: this.title } });
    }
  }

  /** Write the sheet's value over the class's for one check. */
  static async #onKeep(_event, target) {
    const index = Number(target.dataset.index);
    const check = this.#report?.checks?.[index];
    if (!check?.keep || this.#busy) return;
    if (await keepSheetValue(this.#report.actor, check.keep)) this.#kept.add(index);
    this.render();
  }

  /** Fill the official sheet with this character and hand it to the browser. */
  static async #onExport() {
    if (this.#busy || !this.#actor) return;
    this.#busy = true;
    await this.render();
    try {
      const blank = await blankSheet(importer());
      if (!blank) {
        this.#exportNote = { error: true, text: loc("pdf.export.sheetClosed", { book: importer()?.BOOKS?.[SHEET_BOOK]?.label ?? "" }) };
        return;
      }
      const result = await withPdf(blank.bytes, (doc) => exportSheet(this.#actor, doc));
      if (result.refused) {
        this.#exportNote = { error: true, text: loc("pdf.error.notForm", { name: blank.label, share: percent(result.share) }) };
        return;
      }
      saveExport(this.#actor, result.bytes);
      const lines = [loc("pdf.export.done", { name: this.#actor.name })];
      for (const o of result.overflow) lines.push(loc("pdf.export.overflow", { table: loc(`pdf.table.${o.table.split(".")[0]}`), names: o.dropped.join(", ") }));
      if (result.moved) lines.push(loc("pdf.export.moved", { count: result.moved }));
      this.#exportNote = { error: false, lines };
    } catch (err) {
      console.error(`${MODULE_ID} | official sheet export`, err);
      this.#exportNote = { error: true, text: err.message };
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  /** Open Your Books, where the official sheet is put on the server or connected. */
  static #onBooks() {
    importer()?.bookStatus?.();
  }

  /** Open an actor the import made or updated. */
  static async #onOpenActor(_event, target) {
    const doc = await fromUuid(target.dataset.uuid);
    if (!doc?.sheet) return ui.notifications.warn(loc("pdf.error.gone"));
    doc.sheet.render(true);
  }
}

/**
 * Open the official-sheet window on a character, or on a new one when none
 * is given. Refused where the seat may not write the character, or may not
 * create one.
 * @param {{actor?: Actor|null}} [options]
 * @returns {SheetPdfApp|null}
 */
export function openSheetPdf({ actor = null } = {}) {
  if (actor && (actor.type !== ACTOR_TYPE.character || !actor.isOwner)) {
    ui.notifications.warn(loc(actor.type !== ACTOR_TYPE.character ? "pdf.error.notCharacter" : "pdf.error.notOwner", { name: actor.name }));
    return null;
  }
  if (!actor && !game.user.can("ACTOR_CREATE")) {
    ui.notifications.warn(loc("pdf.error.cannotCreate"));
    return null;
  }
  const key = actor?.id ?? "";
  const open = windows.get(key);
  if (open?.rendered) {
    open.bringToFront();
    return open;
  }
  const app = new SheetPdfApp({ actor, windowKey: key, id: key ? `acks-extras-sheetpdf-${key}` : newWindowId() });
  windows.set(key, app);
  app.render(true);
  return app;
}
