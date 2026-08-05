/* global game, ui, foundry, fromUuid, TextEditor */
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
 */
import { MODULE_ID } from "./constants.mjs";
import { listEntries, entryData, exportEntry, parseDrop } from "./table-docs.mjs";
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
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/location/ruledata-browser.hbs` },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const docs = new Map();
    for (const entry of listEntries()) {
      const tableKey = entry.tableId; // overrides live per registry table
      const overridden = hasOverride(entry.docId, tableKey);
      const meta = overridden ? overrideMeta(entry.docId, tableKey) : null;
      const row = {
        ...entry,
        overridden,
        sourceName: meta?.sourceName ?? "",
        kindLabel: game.i18n.localize(entry.rollable ? "ACKS-LOCATION.browser.rolltable" : "ACKS-LOCATION.browser.journal"),
      };
      if (!docs.has(entry.docId)) docs.set(entry.docId, { docId: entry.docId, entries: [] });
      docs.get(entry.docId).entries.push(row);
    }
    context.docs = [...docs.values()];
    context.empty = !context.docs.length;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const rowEl of this.element.querySelectorAll("[data-entry-key]")) {
      rowEl.addEventListener("dragover", (ev) => ev.preventDefault());
      rowEl.addEventListener("drop", (ev) => this.#onDrop(ev, rowEl.dataset.entryKey));
    }
  }

  #entry(key) {
    return listEntries().find((e) => e.key === key) ?? null;
  }

  async #onDrop(event, key) {
    event.preventDefault();
    const entry = this.#entry(key);
    if (!entry || !game.user.isGM) return;
    let dropData;
    try {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
      dropData = TE.getDragEventData(event);
    } catch {
      return;
    }
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
    if (!entry || !game.user.isGM) return;
    const current = JSON.stringify(entryData(entry), null, 2);
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
            let parsed = JSON.parse(button.form.elements.json.value);
            if (entry.subId && entry.tableId === "occupationSubTables") {
              const table = globalThis.acksExtras?.lib.tables.getTable(entry.docId, entry.tableId);
              parsed = { categories: { ...(table?.categories ?? {}), [entry.subId]: parsed } };
            }
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

export function openRuledataBrowser() {
  new RuledataBrowser().render(true);
}
