/**
 * The import manager: the Books tab folded into it, and who sees what.
 *
 * Connecting a book is a per-seat act, so the Books tab is the only one a seat
 * that is not a GM has; the other four write the world. The panel is built by
 * the importer (`booksPanel`) and handed over as `{html, wire}`: the manager
 * renders the markup, attaches the listeners after each render, and builds the
 * panel again, carrying a report, when a listener asks. No Foundry; the
 * application base is a small mock that renders the way a real one calls its
 * hooks, and the entry points of the importer are read from its source.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/* --- a mock application base ---------------------------------------------------------- */

class MockApplication {
  static DEFAULT_OPTIONS = {};
  rendered = false;
  element = { id: "root" };
  focused = 0;
  tab = null;
  renders = 0;
  _prepareTabs(group) {
    const tabs = this.constructor.TABS[group].tabs;
    return Object.fromEntries(tabs.map((t) => [t.id, { id: t.id, cssClass: "", label: `L.${t.id}` }]));
  }
  async render() {
    this.renders++;
    this.context = await this._prepareContext();
    this.rendered = true;
    await this._onRender(this.context, { parts: ["tabs", "body"] });
    return this;
  }
  async _onRender() {}
  _onClose() {}
  bringToFront() {
    this.focused++;
  }
  changeTab(tab, group) {
    this.tab = [tab, group];
  }
}

const notices = [];
globalThis.ui = { notifications: { warn: (m) => notices.push(["warn", m]), info: (m) => notices.push(["info", m]), error: (m) => notices.push(["error", m]) } };
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
};
globalThis.foundry = { applications: { api: { ApplicationV2: MockApplication, HandlebarsApplicationMixin: (Base) => class extends Base {} } } };

const { ImportManagerApp, installImportManager, openImportManager } = await import("../../scripts/importer/apps/import-manager.mjs");

/* --- the host: an api that counts what is read, and a panel that counts its build ------ */

const reads = { rebuild: 0, adventures: 0 };
const built = [];
const wired = [];
const api = {
  rebuildOptions: () => (reads.rebuild++, [{ key: "shelves", label: "Shelves", options: [] }]),
  adventureBooks: async () => (reads.adventures++, []),
};
installImportManager({
  api,
  steps: [["stepOne", () => {}]],
  booksPanel: async (opts) => {
    built.push(opts);
    return {
      html: `<div data-books-panel>built ${built.length}</div>`,
      wire: (element, hooks) => wired.push({ element, hooks }),
    };
  },
});

/* --- a GM sees five tabs and the panel -------------------------------------------------- */
{
  const app = new ImportManagerApp();
  await app.render();
  const ctx = app.context;
  ok("a GM has the five tabs, Books first", Object.keys(ctx.tabs).join() === "books,import,rebuild,adventures,tools", Object.keys(ctx.tabs).join());
  ok("and the importer's panel markup is handed to the template", ctx.booksHtml === "<div data-books-panel>built 1</div>", ctx.booksHtml);
  ok("the panel is built with no walkthrough forced and no notice", JSON.stringify(built[0]) === JSON.stringify({ firstRun: false, notice: "" }), JSON.stringify(built[0]));
  ok("a GM's rebuild options and adventure books are read", reads.rebuild === 1 && reads.adventures === 1);
  ok("the chain's steps are listed", ctx.steps.length === 1 && ctx.steps[0].key === "stepOne");
  ok("the mode select offers rebuild, repair and force repair, each from its own string", ctx.modes.map((m) => `${m.value}:${m.label}`).join() === "drop:ACKS-IMPORTER.ui.reimportModeDrop,repair:ACKS-IMPORTER.ui.reimportModeRepair,force:ACKS-IMPORTER.ui.reimportModeForce", JSON.stringify(ctx.modes));
  ok("the listeners are attached once the window is in the page", wired.length === 1 && wired[0].element === app.element);

  // The listener asks for a rebuild with a report: the manager renders again and
  // the panel is built with it, once.
  await wired[0].hooks.rerender("shelf report");
  ok("a rerender builds the panel again", built.length === 2 && app.renders === 2);
  ok("carrying the report it was given", built[1].notice === "shelf report", JSON.stringify(built[1]));
  await app.render();
  ok("and the report is spent after one build", built[2].notice === "" && built[2].firstRun === false, JSON.stringify(built[2]));
  ok("every build is wired again", wired.length === 3);
}

/* --- the Rebuild tab keeps the pick and mode across the renders a run makes --------------- */
{
  api.rebuildOptions = () => [{ key: "shelves", label: "Shelves", options: [{ value: "shelf:Alpha", label: "Alpha" }, { value: "shelf:Beta", label: "Beta" }] }];
  const app = new ImportManagerApp();
  let onChange = null;
  const form = {
    addEventListener: (type, fn) => type === "change" && (onChange = fn),
    querySelector: (sel) => ({ "select[name=pick]": { value: "shelf:Beta" }, "select[name=mode]": { value: "force" } })[sel] ?? null,
  };
  app.element = { id: "root", querySelector: (sel) => (sel === "[data-rebuild-form]" ? form : null) };
  await app.render();
  const pickedOf = (ctx) => ctx.rebuild[0].options.filter((o) => o.selected).map((o) => o.value).join();
  const modeOf = (ctx) => ctx.modes.filter((m) => m.selected).map((m) => m.value).join();
  ok("before any choice nothing is picked and the mode is Rebuild", pickedOf(app.context) === "" && modeOf(app.context) === "drop", `${pickedOf(app.context)}|${modeOf(app.context)}`);
  onChange?.({ target: { name: "mode", value: "repair" } });
  await app.render();
  ok("a mode the user changes is drawn selected on the next render", modeOf(app.context) === "repair", modeOf(app.context));
  // A rebuild press stores what the form reads, then the run renders before its confirm.
  let renderedDuringRun = null;
  api.runRebuildPick = async () => {
    renderedDuringRun = { pick: pickedOf(app.context), mode: modeOf(app.context) };
  };
  await app.constructor.DEFAULT_OPTIONS.actions.rebuild.call(app, {}, { closest: () => form });
  ok("the render a run makes before its confirm still shows the user's pick and mode", renderedDuringRun?.pick === "shelf:Beta" && renderedDuringRun?.mode === "force", JSON.stringify(renderedDuringRun));
  api.rebuildOptions = () => (reads.rebuild++, [{ key: "shelves", label: "Shelves", options: [] }]);
}

/* --- Import everything runs in the mode its select holds ---------------------------------- */
{
  const app = new ImportManagerApp();
  let onChange = null;
  const select = { value: "repair" };
  const form = {
    addEventListener: (type, fn) => type === "change" && (onChange = fn),
    querySelector: (sel) => (sel === "select[name=importMode]" ? select : null),
  };
  app.element = { id: "root", querySelector: (sel) => (sel === "[data-import-form]" ? form : null) };
  await app.render();
  const modeOf = (ctx) => ctx.importModes.filter((m) => m.selected).map((m) => m.value).join();
  ok(
    "the mode select offers importing what is missing, then rebuild, repair and force repair, each from its own string",
    app.context.importModes.map((m) => `${m.value}:${m.label}`).join() ===
      "import:ACKS-IMPORTER.manager.importModeImport,drop:ACKS-IMPORTER.ui.reimportModeDrop,repair:ACKS-IMPORTER.ui.reimportModeRepair,force:ACKS-IMPORTER.ui.reimportModeForce",
    JSON.stringify(app.context.importModes),
  );
  ok("before any choice the mode imports what is missing", modeOf(app.context) === "import", modeOf(app.context));
  onChange?.({ target: { name: "importMode", value: "force" } });
  await app.render();
  ok("a mode the user changes is drawn selected on the next render", modeOf(app.context) === "force", modeOf(app.context));
  const ran = [];
  installImportManager({ api, steps: [["stepOne", () => {}]], booksPanel: async () => ({ html: "", wire: () => {} }), runEverything: async (mode) => ran.push(mode) });
  await app.constructor.DEFAULT_OPTIONS.actions.importAll.call(app, {}, { closest: (sel) => (sel === "[data-import-form]" ? form : null) });
  ok("a press hands the select's mode to the run", ran.join() === "repair", ran.join());
  ok("and the press keeps that mode for the renders after it", modeOf(app.context) === "repair", modeOf(app.context));
  installImportManager({
    api,
    steps: [["stepOne", () => {}]],
    booksPanel: async (opts) => {
      built.push(opts);
      return { html: `<div data-books-panel>built ${built.length}</div>`, wire: (element, hooks) => wired.push({ element, hooks }) };
    },
  });
}

/* --- a seat that is not a GM sees the Books tab alone ------------------------------------ */
{
  game.user.isGM = false;
  reads.rebuild = 0;
  reads.adventures = 0;
  const app = new ImportManagerApp();
  await app.render();
  const ctx = app.context;
  ok("a player has the Books tab and no other", Object.keys(ctx.tabs).join() === "books", Object.keys(ctx.tabs).join());
  ok("the template is told so", ctx.isGM === false);
  ok("the world-writing lists are not read for it", reads.rebuild === 0 && reads.adventures === 0 && ctx.steps.length === 0 && ctx.rebuild.length === 0 && ctx.adventures.length === 0);
  ok("the panel is still built and wired for it", ctx.booksHtml.includes("data-books-panel"));

  // A press that writes the world refuses, whatever opened the window.
  const before = notices.length;
  await app.constructor.DEFAULT_OPTIONS.actions.importAll.call(app);
  ok("importing from a player's window warns and runs nothing", notices.length === before + 1 && notices.at(-1)[0] === "warn" && notices.at(-1)[1] === "ACKS-IMPORTER.manager.gmOnly", JSON.stringify(notices.at(-1)));

  // Opening it is open to every seat, always on Books.
  const opened = openImportManager({ tab: "tools", firstRun: true });
  await new Promise((r) => setTimeout(r, 0));
  ok("a player may open the manager and is put on Books whatever tab was asked", opened.tab?.[0] === "books" && opened.tab?.[1] === "primary", JSON.stringify(opened.tab));
  ok("the walkthrough request reaches the panel", built.at(-1).firstRun === true, JSON.stringify(built.at(-1)));
  ok("and a second open raises the same window", openImportManager() === opened);
  game.user.isGM = true;
}

/* --- a GM's open lands on the tab asked for, one window per seat ------------------------ */
{
  const first = openImportManager({ tab: "books" });
  await new Promise((r) => setTimeout(r, 0));
  ok("a GM's open lands on the tab it names", first.tab?.[0] === "books");
  const second = openImportManager({ tab: "rebuild" });
  await new Promise((r) => setTimeout(r, 0));
  ok("a second call raises the window and moves its tab", second === first && second.tab?.[0] === "rebuild" && second.focused >= 2);
}

/* --- the importer's entry points all open this tab, and no window of its own ------------- */
{
  const src = readFileSync(new URL("../../scripts/importer/module.mjs", import.meta.url), "utf8");
  ok("the Books entry point opens the manager on its Books tab", /const openBooksDialog = \(opts = \{\}\) => openImportManager\(\{ tab: "books", \.\.\.opts \}\);/.test(src));
  ok("the panel builds no dialog of its own", !/function booksDialog|singleton\(/.test(src) && !/DialogV2\.prompt\(\{\s*\/\/ One row per book/.test(src));
  for (const name of ["connectBook", "reconnectBooks", "bookStatus"]) {
    ok(`${name} still exists for macros already imported into worlds`, new RegExp(`\\b${name}\\b`).test(src));
  }
  ok("gettingStarted opens the walkthrough on the Books tab", /gettingStarted: \(\) => openBooksDialog\(\{ firstRun: true \}\)/.test(src));
  ok("the manager is handed the panel builder", /installImportManager\(\{[\s\S]*?\bbooksPanel,/.test(src));
  ok("the join-time offer keeps the first-run condition intact", /!Object\.keys\(shelf\(\)\)\.length && !gettingStartedDismissed\(\)/.test(src));
}

/* --- the template: one panel in the Books section, the rest GM-only, no literal id ------- */
{
  const hbs = readFileSync(new URL("../../templates/importer/import-manager.hbs", import.meta.url), "utf8");
  ok("the Books section prints the panel unescaped", /data-tab="books">[\s\S]*?\{\{\{booksHtml\}\}\}[\s\S]*?<\/section>/.test(hbs));
  ok("the other four sections sit under the GM check", /\{\{#if isGM\}\}[\s\S]*data-tab="import"[\s\S]*data-tab="tools"[\s\S]*\{\{\/if\}\}/.test(hbs));
  ok("no literal id", !/\sid=/.test(hbs));
  ok("no Books table or button that opened another window is left", !/openBooks|manager-table/.test(hbs));
}

delete globalThis.foundry;
delete globalThis.game;
delete globalThis.ui;
console.log(`test-import-manager: ${pass} checks passed`);
