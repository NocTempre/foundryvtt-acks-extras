/* global foundry, game, ui */
/**
 * The import manager: one window for a Judge's import controls, in five tabs.
 * Books — which books this build reads and which are open on this seat, and
 * the way to the Books window that connects them. Import — the chain, in its
 * order, run whole or one step at a time. Rebuild — a shelf, a book or the
 * rules tables, rebuilt or repaired in place. Adventures — each adventure
 * book open on this seat, with what the library holds of its Adventure, to
 * rebuild, repair or write. Tools — the entry picker, the audit, the repair
 * window and Remove All Imports. The window holds nothing of its own: every
 * tab reads the importer's api at render, and every press hands off to a run
 * that already exists and asks its own questions. One window per seat,
 * however it was opened.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** The runs the window hands off to, given once at ready (`installImportManager`). */
let host = null;
let instance = null;

const loc = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.${key}`));

/**
 * Give the window what it runs. `api` is the importer's api; `openBooks()`
 * opens the Books window; `bookRows()` lists every book this build reads
 * with whether it is open here; `steps` is the import chain as `[key, run]`
 * pairs and `runStep(key)` runs one; `runEverything()` runs the chain;
 * `merchandise()` builds the merchandise items; `lib()` returns the shared
 * lib api, for the repair window.
 */
export function installImportManager(h) {
  host = h;
}

/** The import manager window. */
export class ImportManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-import-manager",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-importer-manager"],
    position: { width: 680, height: 600 },
    window: { title: `${LANG_PREFIX}.manager.title`, icon: "fa-solid fa-hanging-sign", resizable: true },
    actions: {
      openBooks: ImportManagerApp.#onOpenBooks,
      importAll: ImportManagerApp.#onImportAll,
      runStep: ImportManagerApp.#onRunStep,
      rebuild: ImportManagerApp.#onRebuild,
      adventureDrop: ImportManagerApp.#onAdventure,
      adventureRepair: ImportManagerApp.#onAdventure,
      adventureWrite: ImportManagerApp.#onAdventure,
      entries: ImportManagerApp.#onTool,
      audit: ImportManagerApp.#onTool,
      repair: ImportManagerApp.#onTool,
      removeAll: ImportManagerApp.#onTool,
      merchandise: ImportManagerApp.#onTool,
      refresh: ImportManagerApp.#onRefresh,
    },
  };

  // The tab strip is its own part so it stays put while the body scrolls.
  static PARTS = {
    tabs: { template: `modules/${MODULE_ID}/templates/importer/import-manager-tabs.hbs` },
    body: { template: `modules/${MODULE_ID}/templates/importer/import-manager.hbs`, scrollable: [""] },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "books", icon: "fa-solid fa-book" },
        { id: "import", icon: "fa-solid fa-download" },
        { id: "rebuild", icon: "fa-solid fa-rotate" },
        { id: "adventures", icon: "fa-solid fa-dungeon" },
        { id: "tools", icon: "fa-solid fa-toolbox" },
      ],
      initial: "books",
      labelPrefix: `${LANG_PREFIX}.manager.tab`,
    },
  };

  /** What is running, as the status line says it, or "". */
  #busy = "";

  /** @override */
  async _prepareContext() {
    const api = host?.api ?? null;
    const ready = !!api;
    const steps = (host?.steps ?? []).map(([key]) => ({ key, label: loc(`gs.${key}`) }));
    const books = ready ? host.bookRows() : [];
    const rebuild = ready ? api.rebuildOptions() : [];
    const adventures = ready ? (await api.adventureBooks()).map((row) => ({ ...row, census: this.#censusText(row.census) })) : [];
    return {
      tabs: this._prepareTabs("primary"),
      ready,
      busy: !!this.#busy,
      busyText: this.#busy,
      books,
      openCount: books.filter((b) => b.open).length,
      steps,
      rebuild,
      adventures,
      modes: ["drop", "repair"].map((value) => ({ value, label: loc(`ui.reimportMode${value === "drop" ? "Drop" : "Repair"}`) })),
    };
  }

  /** One line for what the shelf holds of a book's Adventure. */
  #censusText(census) {
    if (!census?.adventure) return loc("manager.censusNone");
    const contents = census.adventure.contents ?? {};
    const parts = Object.entries(contents)
      .filter(([, n]) => n)
      .map(([kind, n]) => `${n} ${kind}`)
      .join(", ");
    const legacy = census.legacy ? ` ${loc("manager.censusLegacy", { n: census.legacy })}` : "";
    return `${loc("manager.census", { parts: parts || "—" })}${legacy}`;
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (instance === this) instance = null;
  }

  /** Run `fn` as the window's one job at a time, saying what runs, then redraw. */
  async #run(label, fn) {
    if (this.#busy) return;
    if (!host?.api) return ui.notifications.warn(loc("manager.notReady"));
    this.#busy = loc("manager.running", { what: label });
    await this.render();
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} | import manager: ${label}`, err);
      ui.notifications.error(`${MODULE_ID} | ${label}: ${err?.message ?? err}`);
    } finally {
      this.#busy = "";
      this.render();
    }
  }

  static #onOpenBooks() {
    host?.openBooks?.();
  }

  static async #onRefresh() {
    await this.render();
  }

  static async #onImportAll() {
    await this.#run(loc("manager.importAll"), () => host.runEverything());
  }

  static async #onRunStep(_event, target) {
    const key = target.dataset.step;
    await this.#run(loc(`gs.${key}`), () => host.runStep(key));
  }

  static async #onRebuild(_event, target) {
    const form = target.closest("[data-rebuild-form]");
    const pick = form?.querySelector("select[name=pick]")?.value ?? "";
    const mode = form?.querySelector("select[name=mode]")?.value ?? "drop";
    if (!pick) return;
    await this.#run(loc("manager.tab.rebuild"), () => host.api.runRebuildPick(pick, mode));
  }

  static async #onAdventure(event, target) {
    const book = target.dataset.book;
    const action = target.dataset.action;
    const api = host.api;
    const label = `${target.textContent.trim()} · ${book}`;
    if (action === "adventureWrite") return this.#run(label, () => api.cookbookImportAdventures({ books: [book] }));
    return this.#run(label, () => api.cookbookReimportAdventure(book, { mode: action === "adventureRepair" ? "repair" : "drop" }));
  }

  static async #onTool(_event, target) {
    const api = host.api;
    const tool = target.dataset.action;
    const label = target.textContent.trim();
    if (tool === "repair") {
      // The repair window's importer checks, every check where it has none.
      // The lib api is read now, not at install: the two ready hooks race.
      const lib = host.lib?.();
      if (!lib?.repair?.open) return ui.notifications.warn(loc("manager.notReady"));
      const ids = (lib.repair.checks?.() ?? []).filter((c) => c.feature === "importer").map((c) => c.id);
      return lib.repair.open({ only: ids.length ? ids : null, scan: true });
    }
    if (tool === "merchandise") return this.#run(label, () => host.merchandise?.());
    const run = { entries: api.cookbookReimportEntries, audit: api.cookbookAudit, removeAll: api.cookbookRemoveImports }[tool];
    if (run) await this.#run(label, () => run());
  }
}

/** The settings-menu entry: Foundry builds its own instance, which hands off to the open one. */
export class ImportManagerMenu extends ImportManagerApp {
  async render(...args) {
    if (instance && instance !== this && instance.rendered) {
      instance.bringToFront();
      return this;
    }
    instance = this;
    return super.render(...args);
  }
}

/**
 * Open the import manager, on `tab` when given. GM only; a second call raises
 * the open window instead of making another.
 * @returns {ImportManagerApp|null}
 */
export function openImportManager({ tab = null } = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn(loc("manager.gmOnly"));
    return null;
  }
  if (!instance?.rendered) instance = new ImportManagerApp();
  const app = instance;
  Promise.resolve(app.render(true)).then(() => {
    app.bringToFront();
    if (tab) app.changeTab(tab, "primary");
  });
  return app;
}
