/* global foundry, game, ui */
/**
 * The import manager: one window for the importer's controls, in five tabs.
 * Books — every book this build reads, whether it is open on this seat, the
 * server shelf, and the controls that connect them; the first-run walkthrough
 * heads it. Import — the chain, in its order, run whole or one step at a time.
 * Rebuild — a shelf, a book or the rules tables, rebuilt or repaired in place.
 * Adventures — each adventure book open on this seat, with what the library
 * holds of its Adventure, to rebuild, repair or write. Tools — the entry
 * picker, the audit, the repair window, overhead token art from an installed
 * compendium (Apply per source, Restore) and Remove All Imports. The window
 * holds nothing of its own: every tab reads the importer's api at render, and
 * every press hands off to a run that already exists and asks its own
 * questions. One window per seat, however it was opened.
 *
 * Books is the only tab a seat that is not a GM sees: connecting a book is a
 * per-seat act, and the other four write the world.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** The runs the window hands off to, given once at ready (`installImportManager`). */
let host = null;
let instance = null;

const loc = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.${key}`));

/**
 * Give the window what it runs. `api` is the importer's api;
 * `booksPanel({firstRun, notice})` builds the Books tab as `{html, wire}`
 * (the markup, and the listeners to attach once it is in the page); `steps` is
 * the import chain as `[key, run]` pairs and `runStep(key)` runs one;
 * `runEverything()` runs the chain; `merchandise()` builds the merchandise
 * items; `lib()` returns the shared lib api, for the repair window;
 * `tokenArt` is `{sources(), apply(source), restore(), hasFlag()}`, the overhead
 * token art controls of the Tools tab (`token-art.mjs`).
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
      importAll: ImportManagerApp.#onImportAll,
      runStep: ImportManagerApp.#onRunStep,
      rebuild: ImportManagerApp.#onRebuild,
      adventureDrop: ImportManagerApp.#onAdventure,
      adventureRepair: ImportManagerApp.#onAdventure,
      adventureForce: ImportManagerApp.#onAdventure,
      adventureWrite: ImportManagerApp.#onAdventure,
      entries: ImportManagerApp.#onTool,
      audit: ImportManagerApp.#onTool,
      repair: ImportManagerApp.#onTool,
      removeAll: ImportManagerApp.#onTool,
      merchandise: ImportManagerApp.#onTool,
      refresh: ImportManagerApp.#onRefresh,
      tokenArtApply: ImportManagerApp.#onTokenArt,
      tokenArtRestore: ImportManagerApp.#onTokenArt,
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

  /** The Books tab as last built (`booksPanel`): its listeners are attached after each render. */
  #panel = null;

  /** The token-art sources found at the last render, by package id: what Apply is handed. */
  #tokenSources = new Map();

  /** What the next build of the Books tab carries: the walkthrough forced open, and a report to show. */
  #booksOpts = { firstRun: false, notice: "" };

  /** The Rebuild tab's pick and mode as the user last set them: every render, the one a run makes before its confirm included, draws them selected. */
  #rebuildChoice = { pick: "", mode: "drop" };

  /** The Import tab's mode for Import everything as the user last set it: "import" runs the chain, any other mode runs over every open book. */
  #importMode = "import";

  /**
   * Ask for the Books tab's next build to carry `firstRun` and `notice`.
   * @param {{firstRun?: boolean, notice?: string}} opts
   */
  queueBooks({ firstRun = false, notice = "" } = {}) {
    this.#booksOpts = { firstRun: firstRun || this.#booksOpts.firstRun, notice: notice || this.#booksOpts.notice };
  }

  /** @override */
  async _prepareContext() {
    const isGM = !!game.user?.isGM;
    const api = host?.api ?? null;
    const ready = !!api;
    const steps = isGM ? (host?.steps ?? []).map(([key]) => ({ key, label: loc(`gs.${key}`) })) : [];
    const { pick, mode } = this.#rebuildChoice;
    const rebuild = (ready && isGM ? api.rebuildOptions() : []).map((g) => ({
      ...g,
      options: (g.options ?? []).map((o) => ({ ...o, selected: o.value === pick })),
    }));
    const adventures = ready && isGM ? (await api.adventureBooks()).map((row) => ({ ...row, census: this.#censusText(row.census) })) : [];
    // A seat that is not a GM sees the Books tab alone.
    const tabs = Object.fromEntries(Object.entries(this._prepareTabs("primary")).filter(([id]) => isGM || id === "books"));
    this.#panel = ready && host.booksPanel ? await host.booksPanel(this.#booksOpts) : null;
    this.#booksOpts = { firstRun: false, notice: "" };
    // Overhead token art: one Apply per installed package offering it, Restore while any monster carries the mark.
    const found = ready && isGM && host.tokenArt ? await host.tokenArt.sources().catch(() => []) : [];
    this.#tokenSources = new Map(found.map((s) => [s.id, s]));
    return {
      tokenArt: found.map((s) => ({ id: s.id, label: loc("manager.tokenArt.applyButton",{ title: s.title }) })),
      tokenArtRestore: ready && isGM && !!host.tokenArt?.hasFlag(),
      tabs,
      ready,
      isGM,
      busy: !!this.#busy,
      busyText: this.#busy,
      booksHtml: this.#panel?.html ?? "",
      steps,
      rebuild,
      adventures,
      modes: ["drop", "repair", "force"].map((value) => ({ value, selected: value === mode, label: loc(`ui.reimportMode${value[0].toUpperCase()}${value.slice(1)}`) })),
      importModes: ["import", "drop", "repair", "force"].map((value) => ({
        value,
        selected: value === this.#importMode,
        label: value === "import" ? loc("manager.importModeImport") : loc(`ui.reimportMode${value[0].toUpperCase()}${value.slice(1)}`),
      })),
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (options?.parts && !options.parts.includes("body")) return;
    this.#panel?.wire(this.element, {
      rerender: (notice = "") => {
        this.queueBooks({ notice });
        return this.render();
      },
    });
    this.element?.querySelector?.("[data-rebuild-form]")?.addEventListener("change", (event) => {
      const name = event.target?.name;
      if (name === "pick" || name === "mode") this.#rebuildChoice[name] = event.target.value;
    });
    this.element?.querySelector?.("[data-import-form]")?.addEventListener("change", (event) => {
      if (event.target?.name === "importMode") this.#importMode = event.target.value;
    });
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
    if (!game.user?.isGM) return ui.notifications.warn(loc("manager.gmOnly"));
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

  static async #onRefresh() {
    await this.render();
  }

  static async #onImportAll(_event, target) {
    const mode = target?.closest?.("[data-import-form]")?.querySelector?.("select[name=importMode]")?.value ?? this.#importMode;
    this.#importMode = mode;
    await this.#run(loc("manager.importAll"), () => host.runEverything(mode));
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
    this.#rebuildChoice = { pick, mode };
    await this.#run(loc("manager.tab.rebuild"), () => host.api.runRebuildPick(pick, mode));
  }

  static async #onAdventure(event, target) {
    const book = target.dataset.book;
    const action = target.dataset.action;
    const api = host.api;
    const label = `${target.textContent.trim()} · ${book}`;
    if (action === "adventureWrite") return this.#run(label, () => api.cookbookImportAdventures({ books: [book] }));
    const mode = action === "adventureForce" ? "force" : action === "adventureRepair" ? "repair" : "drop";
    return this.#run(label, () => api.cookbookReimportAdventure(book, { mode }));
  }

  static async #onTokenArt(_event, target) {
    if (!game.user?.isGM) return ui.notifications.warn(loc("manager.gmOnly"));
    if (target.dataset.action === "tokenArtRestore") return this.#run(target.textContent.trim(), () => host.tokenArt.restore());
    const source = this.#tokenSources.get(target.dataset.source);
    if (source) await this.#run(target.textContent.trim(), () => host.tokenArt.apply(source));
  }

  static async #onTool(_event, target) {
    const api = host.api;
    const tool = target.dataset.action;
    const label = target.textContent.trim();
    if (!game.user?.isGM) return ui.notifications.warn(loc("manager.gmOnly"));
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
 * Open the import manager, on `tab` when given. Any seat may open it, and a
 * seat that is not a GM is always on the Books tab, the only one it has. A
 * second call raises the open window instead of making another. `firstRun`
 * and `notice` are the Books tab's (`booksPanel`).
 * @param {{tab?: string|null, firstRun?: boolean, notice?: string}} [opts]
 * @returns {ImportManagerApp}
 */
export function openImportManager({ tab = null, firstRun = false, notice = "" } = {}) {
  // `instance` clears on close, so a window still rendering is reused rather than doubled.
  if (!instance) instance = new ImportManagerApp();
  const app = instance;
  app.queueBooks({ firstRun, notice });
  const on = game.user?.isGM ? tab : "books";
  Promise.resolve(app.render(true)).then(() => {
    app.bringToFront();
    if (on) app.changeTab(on, "primary");
  });
  return app;
}
