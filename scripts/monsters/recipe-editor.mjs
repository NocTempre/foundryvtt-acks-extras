/* global foundry, game, ui, Hooks, fromUuid */
/**
 * The recipe editor window: the Judge's tool over `extras.encounter.recipe`, the
 * parts the import read from a creature's Combat and Ecology text. Three doors
 * open it, each onto the document it opens from (`recipe-editor-view.mjs`
 * `doorOf`): a monster actor's own recipe, a family template's variant option, and
 * the option the chart's host records its Roll with. No door writes a second
 * document.
 *
 * Every change is written at once, one field at a time, through the logic's
 * `savePart` (`recipe-editor-logic.mjs`) against the recipe read again at the write,
 * so a field left alone is never rewritten and a part is marked hand-changed only
 * by a change that differs from the import's copy. A seat Foundry's ownership does
 * not allow to update the document gets the window read-only, and every write path
 * tests that ownership again before it writes.
 *
 * The body is its own scroller (`scrollable: [""]`) so a re-render after each change
 * keeps its place; the footer is a second part so Reset all and Close stay pinned.
 * Rulings: docs/monsters/MODEL.md, "The encounter recipe".
 */
import { ANIMAL_TYPE } from "../lib/constants.mjs";
import { libraryActors, whenReady } from "../lib/library.mjs";
import { hostGenOf, unitsOf } from "../lib/org.mjs";
import { templateOf } from "../lib/org-chart-ui-logic.mjs";
import { MODULE_ID } from "./constants.mjs";
import {
  LINKED_ROLES, RECIPE_TEXT, addPart, linkChanges, readCopyAt, readStored, recipeAt, recipeUpdate, resetAll, resetPart, savePart, sentenceMarks,
} from "./recipe-editor-logic.mjs";
import { RECIPE_STATES, buildContext, changesFor, doorOf, extrasAt, problemsOf } from "./recipe-editor-view.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const T = `modules/${MODULE_ID}/templates/monsters`;
const ROW_PARTIAL = `${T}/recipe-row.hbs`;

/** The lang root of the editor's strings. */
const ROOT = "ACKS-MONSTERS";
/** A lang key under the editor's recipe section, formatted. */
const say = (key, data = {}) => game.i18n.format(`${ROOT}.recipe.${key}`, data);
/** A full lang key, formatted (what the view module's `loc` takes). */
const loc = (key, data = {}) => game.i18n.format(key, data);

/** Open editors by document and target, so a second press brings the first to the front. */
const OPEN = new Map();

/** The recipe editor. One window is one document and one stored recipe. */
export class RecipeEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-recipe-{id}",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-recipe"],
    position: { width: 900, height: 640 },
    window: { icon: "fa-solid fa-list-check", resizable: true },
    actions: {
      state: RecipeEditor.#onState,
      editPart: RecipeEditor.#onEditPart,
      donePart: RecipeEditor.#onDonePart,
      addPart: RecipeEditor.#onAddPart,
      sentence: RecipeEditor.#onSentence,
      resetPart: RecipeEditor.#onResetPart,
      resetAll: RecipeEditor.#onResetAll,
      openCreature: RecipeEditor.#onOpenCreature,
      changeLink: RecipeEditor.#onChangeLink,
      linkEntry: RecipeEditor.#onLinkEntry,
    },
  };

  static PARTS = {
    body: { template: `${T}/recipe-editor.hbs`, scrollable: [""] },
    footer: { template: `${T}/recipe-editor-footer.hbs` },
  };

  /** The document written, and where its recipe sits (`recipeTarget`). */
  #doc;
  #target;
  /** The window's title names: the document, and the variant option where the door is one. */
  #name;
  #option;
  #state = RECIPE_STATES[0];
  #place = "";
  #editKey = "";
  /** What a hand typed that `savePart` refused: `{key, values, problems}`. */
  #draft = null;
  #changing = false;
  #linkQuery = "";
  /** Set where the next render scrolls the reading pane to the part in edit's sentence. */
  #scrollPane = false;
  #hook = [];

  /**
   * @param {{doc: object, target: object, name: string, option: string}} door `doorOf`'s answer
   * @param {object} [options]
   */
  constructor({ doc, target, name, option }, options = {}) {
    super(options);
    this.#doc = doc;
    this.#target = target;
    this.#name = name;
    this.#option = option;
  }

  /** @override */
  get title() {
    return this.#option ? say("titleOption", { name: this.#name, option: this.#option }) : say("title", { name: this.#name });
  }

  /** Foundry's own test of the document this window writes; a locked pack's document is read-only. */
  #canWrite() {
    const d = this.#doc;
    if (!d || d.collection?.locked) return false;
    return !!(d.canUserModify?.(game.user, "update") ?? d.isOwner);
  }

  /** @override */
  async _preFirstRender(context, options) {
    await super._preFirstRender?.(context, options);
    await foundry.applications.handlebars.loadTemplates([ROW_PARTIAL]);
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener("change", (event) => this.#onChange(event));
    const id = this.#doc.id;
    this.#hook = [
      ["updateActor", Hooks.on("updateActor", (actor) => { if (actor.id === id) this.render(); })],
      ["deleteActor", Hooks.on("deleteActor", (actor) => { if (actor.id === id) this.close(); })],
    ];
  }

  /** @override */
  _onClose(options) {
    for (const [name, id] of this.#hook) Hooks.off(name, id);
    this.#hook = [];
    for (const [key, app] of OPEN) if (app === this) OPEN.delete(key);
    super._onClose?.(options);
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this.#scrollPane) return;
    this.#scrollPane = false;
    this.element.querySelector(".acks-extras-recipe-sentence.is-selected")?.scrollIntoView?.({ block: "nearest" });
  }

  /** The prose the reading pane marks: the stored Combat and Ecology fields and the encounter lines, read again by the reader. */
  #read(recipe) {
    const extras = extrasAt(this.#doc, this.#target);
    const read = readStored({
      combat: extras.description?.combat ?? "", ecology: extras.description?.ecology ?? "", encounter: extras.encounter ?? null,
      variant: this.#target.optionKey ?? "", cite: "",
    });
    return sentenceMarks(read.paragraphs, recipe, read.sentences);
  }

  /** The library's monsters and animals, as the Roll builds the index its mount and beast words resolve against. */
  async #library() {
    await whenReady();
    return libraryActors().filter((a) => a.type === "monster" || a.type === ANIMAL_TYPE).map((a) => ({ name: a.name, uuid: a.uuid }));
  }

  /** @override */
  async _prepareContext() {
    const doc = this.#doc;
    const recipe = recipeAt(doc, this.#target);
    const readCopy = readCopyAt(doc, this.#target);
    const edited = recipe.find((p) => p?.key === this.#editKey);
    const role = this.#draft?.values?.role ?? edited?.role;
    const library = this.#editKey && LINKED_ROLES.includes(role) ? await this.#library() : [];
    const cite = readCopy.find((p) => p?.cite)?.cite || recipe.find((p) => p?.cite)?.cite || "";
    const ctx = buildContext({
      recipe, readCopy, state: this.#state, place: this.#place, editKey: edited ? this.#editKey : "", draft: this.#draft,
      canWrite: this.#canWrite(), library, changing: this.#changing, linkQuery: this.#linkQuery, marks: this.#read(recipe), cite, loc,
    });
    return { ...ctx, name: this.#name, optionName: this.#option, art: doc.img ?? "" };
  }

  /* -------------------------------------------- */
  /*  Writing                                      */
  /* -------------------------------------------- */

  /**
   * Write what `mutate` makes of the recipe as it is now. The document's ownership
   * is tested again here, the recipe and the import's copy are read again, and the
   * window re-renders. `mutate` answers the new recipe, or null where nothing is to
   * be written.
   * @param {(recipe: object[], readCopy: object[]) => object[]|null} mutate
   * @returns {Promise<boolean>} whether a write landed
   */
  async #write(mutate) {
    if (!this.#canWrite()) {
      ui.notifications.warn(say("notice.noWrite", { name: this.#name }));
      return false;
    }
    const next = mutate(recipeAt(this.#doc, this.#target), readCopyAt(this.#doc, this.#target));
    if (!next) return false;
    await this.#doc.update(recipeUpdate(this.#doc, this.#target, next));
    this.render();
    return true;
  }

  /** The draft with `field` taken out, or null where it held nothing else. */
  #draftWithout(field) {
    const d = this.#draft;
    if (!d) return null;
    const values = { ...d.values };
    delete values[field];
    const problems = d.problems.filter((p) => p.field !== field);
    return Object.keys(values).length || problems.length ? { key: d.key, values, problems } : null;
  }

  /** Open `key` in edit and bring its row into view: the tab of its encounter state, and every place where its own is filtered out. */
  #select(key) {
    const part = recipeAt(this.#doc, this.#target).find((p) => p?.key === key);
    this.#editKey = key;
    this.#draft = null;
    this.#changing = false;
    this.#linkQuery = "";
    if (RECIPE_STATES.includes(part?.when?.state)) this.#state = part.when.state;
    if (this.#place && part?.when?.place && part.when.place !== this.#place) this.#place = "";
  }

  /** A control changed: a view filter, a link search, or one field of the part in edit written at once. */
  async #onChange(event) {
    const el = event.target;
    if (!el || el.nodeType !== 1) return;
    const control = el.closest("[data-field]");
    if (!control) return;
    const field = control.dataset.field;
    if (field === "place") { this.#place = control.value; return this.render(); }
    if (field === "linkQuery") { this.#linkQuery = control.value; return this.render(); }
    if (!this.#editKey || !this.#canWrite()) return;
    const part = recipeAt(this.#doc, this.#target).find((p) => p?.key === this.#editKey);
    if (!part) return ui.notifications.warn(say("notice.noPart"));
    const value = control.type === "checkbox" ? control.checked : control.value;
    const made = changesFor(field, value, part, control.dataset.word ?? "");
    const mine = made.ok ? problemsOf(part, made.changes).filter((p) => p.field === field) : [{ field: "count", key: RECIPE_TEXT.problemCount }];
    if (mine.length) {
      const base = this.#draftWithout(field) ?? { key: part.key, values: {}, problems: [] };
      this.#draft = { key: part.key, values: { ...base.values, [field]: value }, problems: [...base.problems, ...mine] };
      return this.render();
    }
    this.#draft = this.#draftWithout(field);
    // A part whose encounter changes moves to that tab, and the window follows it.
    if (field === "state" && RECIPE_STATES.includes(value)) this.#state = value;
    if (!(await this.#write((recipe, copy) => savePart(recipe, copy, part.key, made.changes)))) this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  /** A state tab. */
  static #onState(_event, target) {
    this.#state = target.dataset.state;
    this.render();
  }

  /** Open or close the part's edit box. */
  static #onEditPart(_event, target) {
    const key = target.dataset.key;
    if (this.#editKey === key) return RecipeEditor.#onDonePart.call(this);
    this.#select(key);
    this.#scrollPane = true;
    this.render();
  }

  /** Close the edit box. */
  static #onDonePart() {
    this.#editKey = "";
    this.#draft = null;
    this.#changing = false;
    this.#linkQuery = "";
    this.render();
  }

  /** Add a part of a Judge's own to the tab's state and open it. */
  static async #onAddPart() {
    await this.#startPart(null);
  }

  /** Start a part: from a sentence the import read no part from, or blank. */
  async #startPart(sentence) {
    let key = "";
    const landed = await this.#write((recipe) => {
      const made = addPart(recipe, { state: this.#state, sentence, newId: () => foundry.utils.randomID() });
      key = made.key;
      return made.recipe;
    });
    if (!landed) return;
    this.#select(key);
    this.#scrollPane = !!sentence;
    this.render();
  }

  /** A sentence of the reading pane: a read one selects its part, an unread one starts a part. */
  static async #onSentence(_event, target) {
    const { fieldName, paragraph, sentence, keys } = target.dataset;
    const recipe = recipeAt(this.#doc, this.#target);
    const first = String(keys ?? "").split(" ").find((k) => k && recipe.some((p) => p?.key === k));
    if (first) {
      this.#select(first);
      this.#scrollPane = true;
      return this.render();
    }
    const mark = this.#read(recipe).find((m) => m.field === fieldName && m.paragraph === Number(paragraph) && m.sentence === Number(sentence));
    if (!mark) return;
    const cite = readCopyAt(this.#doc, this.#target).find((p) => p?.cite)?.cite || recipe.find((p) => p?.cite)?.cite || "";
    await this.#startPart({ text: mark.text, cite });
  }

  /** Put the part in edit back to the import's copy. */
  static async #onResetPart(_event, target) {
    const key = target.dataset.key;
    this.#draft = null;
    if (!(await this.#write((recipe, copy) => resetPart(recipe, copy, key)))) this.render();
  }

  /** Put the whole recipe back to the import's copy; a part a hand added is removed. */
  static async #onResetAll() {
    this.#editKey = "";
    this.#draft = null;
    if (!(await this.#write((_recipe, copy) => resetAll(copy)))) this.render();
  }

  /** Open a linked creature's own sheet. */
  static async #onOpenCreature(_event, target) {
    const doc = await fromUuid(target.dataset.uuid).catch(() => null);
    doc?.sheet?.render(true);
  }

  /** Offer the library for a linked part's creature. */
  static #onChangeLink() {
    this.#changing = true;
    this.render();
  }

  /** Link the part in edit to a library entry. */
  static async #onLinkEntry(_event, target) {
    const key = this.#editKey;
    const entry = { uuid: target.dataset.uuid, name: target.dataset.name };
    const landed = await this.#write((recipe, copy) => savePart(recipe, copy, key, linkChanges(entry)));
    if (!landed) return;
    this.#changing = false;
    this.#linkQuery = "";
    this.render();
  }
}

/**
 * Open the recipe editor onto the document an entry point names: a monster actor,
 * a family template with `optionKey`, or an organisation host (a faction or a group
 * whose Roll record names the variant). A second call for the same document brings
 * the open window to the front. Nothing opens, with a notice saying why, where the
 * subject or the option it needs is missing.
 * @param {string|object} subject a uuid or a document
 * @param {{optionKey?: string, axisKey?: string}} [options]
 * @returns {Promise<RecipeEditor|null>}
 */
export async function openRecipeEditor(subject, { optionKey = "", axisKey = "variant" } = {}) {
  const doc = typeof subject === "string" ? await fromUuid(subject).catch(() => null) : subject ?? null;
  let hostTemplate = null;
  if (doc && Array.isArray(doc.system?.units)) {
    const rows = unitsOf(doc);
    const gen = hostGenOf(doc);
    const found = gen?.template ? { template: String(gen.template), variant: String(gen.variant ?? "") } : templateOf(rows, rows[0]?.key ?? "", null);
    hostTemplate = { doc: found.template ? await fromUuid(found.template).catch(() => null) : null, variant: found.variant };
  }
  const door = doorOf(doc, { optionKey, axisKey, hostTemplate });
  if (!door.ok) {
    ui.notifications.warn(say(`notice.${door.reason}`, { name: door.name }));
    return null;
  }
  const key = `${door.doc.uuid}|${door.target.path}`;
  let app = OPEN.get(key);
  if (!app) {
    app = new RecipeEditor(door);
    OPEN.set(key, app);
  }
  await app.render({ force: true });
  app.bringToFront?.();
  return app;
}
