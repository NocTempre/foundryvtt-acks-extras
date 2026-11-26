/* global game, ui, foundry, fromUuid */
/**
 * Ruledata Browser — the GM's audit-and-tweak surface over every imported
 * table. Imported tables become Foundry documents, prefilled with the current
 * data; every table gets a drag-a-replacement slot and a delete/revert.
 *
 *  - EXPORT materializes a table as a world document prefilled with the
 *    current data (RollTable when rollable, JSON journal page otherwise).
 *  - Drop a RollTable / journal page on a row to OVERRIDE that table
 *    (registry priority 30; the world import stays underneath, revert
 *    falls back to it).
 *  - EDIT opens the JSON directly for cross-cutting grids.
 *
 * A document's group lists the tables the engine reads first. The importer's
 * page reads of it (`acksExtras.importer.rawTablesOf`) sit under a collapsed
 * "Page reads" list with View and Export only, since nothing reads an override
 * of one; each says which table the engine reads instead. `openRuledataBrowser
 * ({focus})` opens the named documents' groups, scrolls to the first and
 * collapses the rest.
 */
import { MODULE_ID } from "./constants.mjs";
import { listEntries, entryCite, entryData, editableData, reshapeJson, exportEntry, parseDrop, groupEntries, focusPlan, tableLabel } from "./table-docs.mjs";
import { setOverride, clearOverride, hasOverride, overrideMeta } from "./table-store.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * The GM's audit surface over every imported rules table: what is present, what
 * is missing and which book it comes from, with export / override / revert per
 * row.
 */
export class RuledataBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-location-ruledata-browser",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "ruledata-browser"],
    position: { width: 640, height: 640 },
    window: { title: "ACKS-LOCATION.browser.title", resizable: true },
    actions: {
      exportEntry: RuledataBrowser.#onExport,
      revertEntry: RuledataBrowser.#onRevert,
      editEntry: RuledataBrowser.#onEdit,
      viewEntry: RuledataBrowser.#onView,
    },
    // Every row the engine reads is an override-by-drop target (see the file header); a page read is not.
    dragDrop: [{ dropSelector: "[data-entry-key]:not([data-read-only])" }],
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/location/ruledata-browser.hbs` },
  };

  /** The document ids a focus asked to open; spent by the next render, so a later render keeps what the Judge opened or closed. */
  #focus = null;

  /** Which groups are open, by document id; a group never toggled is open. */
  #open = new Map();

  /** The documents whose "Page reads" list is open. */
  #readsOpen = new Set();

  /** The document the next render scrolls to, once. */
  #scrollTo = null;

  /** Elements the toggle listener is bound on; a window's element persists across its renders. */
  #bound = new WeakSet();

  /** Ask the next render to open only these documents' groups and scroll to the first. */
  focusOn(focus) {
    this.#focus = Array.isArray(focus) && focus.length ? focus : null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rows = listEntries().map((entry) => {
      const tableKey = entry.tableId; // overrides live per registry table
      const overridden = hasOverride(entry.docId, tableKey);
      const meta = overridden ? overrideMeta(entry.docId, tableKey) : null;
      return {
        ...entry,
        overridden,
        sourceName: meta?.sourceName ?? "",
        cite: entryCite(entry),
        kindLabel: game.i18n.localize(entry.rollable ? "ACKS-LOCATION.browser.rolltable" : "ACKS-LOCATION.browser.journal"),
        readByText: entry.readOnly ? game.i18n.format("ACKS-LOCATION.browser.readBy", { tables: entry.readBy.map(tableLabel).join(", ") }) : "",
      };
    });
    const groups = groupEntries(rows);
    if (this.#focus) {
      const plan = focusPlan(groups, this.#focus);
      this.#open = new Map(Object.entries(plan.open));
      this.#scrollTo = plan.scrollTo;
      this.#focus = null;
    }
    context.docs = groups.map((group) => ({
      ...group,
      open: this.#open.get(group.docId) ?? true,
      readsOpen: this.#readsOpen.has(group.docId),
      entriesTip: game.i18n.format("ACKS-LOCATION.browser.entriesTip", { n: group.entries.length }),
      readsText: game.i18n.format("ACKS-LOCATION.browser.readsSummary", { n: group.reads.length }),
      readsTip: game.i18n.format("ACKS-LOCATION.browser.readsTip", { n: group.reads.length }),
      overriddenText: game.i18n.format("ACKS-LOCATION.browser.overriddenCount", { n: group.overriddenCount }),
      overriddenTip: game.i18n.localize("ACKS-LOCATION.browser.overriddenCountTip"),
    }));
    context.empty = !context.docs.length;
    return context;
  }

  /** DragDrop instances for the declared configs; _onRender only re-binds them. */
  #dragDrop;

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dragDrop ??= (this.options.dragDrop ?? []).map(
      (config) =>
        new foundry.applications.ux.DragDrop.implementation({
          ...config,
          callbacks: { drop: (ev) => this.#onDrop(ev, ev.currentTarget.dataset.entryKey) },
        })
    );
    for (const dragDrop of this.#dragDrop) dragDrop.bind(this.element);
    // `toggle` does not bubble, so it is heard in the capture phase; what a Judge opened stays open through a re-render.
    if (!this.#bound.has(this.element)) {
      this.#bound.add(this.element);
      this.element.addEventListener(
        "toggle",
        (ev) => {
          const details = ev.target;
          if (details?.nodeType !== 1) return;
          if (details.matches("details[data-group]")) this.#open.set(details.dataset.group, details.open);
          else if (details.matches("details[data-reads]")) {
            if (details.open) this.#readsOpen.add(details.dataset.reads);
            else this.#readsOpen.delete(details.dataset.reads);
          }
        },
        true,
      );
    }
    if (this.#scrollTo) {
      const group = [...this.element.querySelectorAll("details[data-group]")].find((el) => el.dataset.group === this.#scrollTo);
      this.#scrollTo = null;
      group?.scrollIntoView?.({ block: "start" });
    }
  }

  #entry(key) {
    return listEntries().find((e) => e.key === key) ?? null;
  }

  async #onDrop(event, key) {
    const entry = this.#entry(key);
    if (!entry || entry.readOnly || !game.user.isGM) return;
    const dropData = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    try {
      const { data, sourceUuid, sourceName } = await parseDrop(entry, dropData);
      await setOverride(entry.docId, entry.tableId, data, { sourceUuid, sourceName });
      ui.notifications.info(game.i18n.format("ACKS-LOCATION.browser.overridden", { key: entry.key, name: sourceName }));
      this.render();
    } catch (err) {
      ui.notifications.error(`${MODULE_ID} | ${err.message}`);
    }
  }

  static async #onExport(_event, target) {
    const entry = this.#entry(target.closest("[data-entry-key]")?.dataset.entryKey);
    if (!entry) return;
    try {
      const { uuid, kind } = await exportEntry(entry);
      const doc = await fromUuid(uuid);
      ui.notifications.info(game.i18n.format("ACKS-LOCATION.browser.exported", { key: entry.key, kind }));
      doc?.sheet?.render(true);
    } catch (err) {
      ui.notifications.error(`${MODULE_ID} | ${err.message}`);
    }
  }

  static async #onRevert(_event, target) {
    const entry = this.#entry(target.closest("[data-entry-key]")?.dataset.entryKey);
    if (!entry) return;
    await clearOverride(entry.docId, entry.tableId);
    ui.notifications.info(game.i18n.format("ACKS-LOCATION.browser.reverted", { key: entry.key }));
    this.render();
  }

  static async #onView(_event, target) {
    const entry = this.#entry(target.closest("[data-entry-key]")?.dataset.entryKey);
    if (!entry) return;
    const data = entryData(entry);
    await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-location-ruledata-view"],
      // A whole rules table serialised: only the window's own height bounds it.
      window: { title: entry.key, resizable: true },
      position: { width: 560, height: 600 },
      content: `<pre class="acks-location-json ruledata-json">${JSON.stringify(data, null, 2).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
      ok: { label: game.i18n.localize("Close") },
    }).catch(() => null);
  }

  static async #onEdit(_event, target) {
    const entry = this.#entry(target.closest("[data-entry-key]")?.dataset.entryKey);
    if (!entry || entry.readOnly || !game.user.isGM) return;
    const current = JSON.stringify(editableData(entry), null, 2);
    await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-location-ruledata-edit"],
      window: { title: game.i18n.format("ACKS-LOCATION.browser.editTitle", { key: entry.key }), resizable: true },
      position: { width: 560, height: 600 },
      content: `<textarea class="ruledata-editor" name="json" rows="20" style="width:100%;font-family:monospace;">${current
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</textarea>`,
      ok: {
        label: game.i18n.localize("ACKS-LOCATION.browser.saveOverride"),
        callback: async (_ev, button) => {
          try {
            const parsed = reshapeJson(entry, JSON.parse(button.form.elements.json.value));
            await setOverride(entry.docId, entry.tableId, parsed, { sourceName: "manual edit" });
            ui.notifications.info(game.i18n.format("ACKS-LOCATION.browser.overridden", { key: entry.key, name: "edit" }));
          } catch (err) {
            ui.notifications.error(`${MODULE_ID} | ${err.message}`);
          }
        },
      },
    }).catch(() => null);
    this.render();
  }
}

/**
 * Opens the Ruledata Browser window, or brings the open one forward. With a
 * `focus` (document ids, most wanted first) the named groups open and the
 * window scrolls to the first; the rest collapse.
 * @param {{focus?: string[]}} [options]
 */
export function openRuledataBrowser({ focus = null } = {}) {
  const open = foundry.applications.instances?.get(RuledataBrowser.DEFAULT_OPTIONS.id);
  const app = typeof open?.focusOn === "function" ? open : new RuledataBrowser();
  app.focusOn(focus);
  return app.render({ force: true }).then((rendered) => {
    rendered.bringToFront?.();
    return rendered;
  });
}
