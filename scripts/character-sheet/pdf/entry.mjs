/* global Hooks, game, ui, document */
/**
 * Where the official-sheet window is opened from: a control in a character's
 * window menu (an owner's), and a button in the Actors directory for a seat
 * that may create characters. Also points pdf.js at its worker, which the
 * importer's own boot skips when the legacy importer is active.
 */
import { MODULE_ID } from "../../lib/constants.mjs";
import { elementOf } from "../../lib/util.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";
import { setWasmUrl, setWorker } from "../../importer/extract.mjs";
import { LANG } from "../constants.mjs";
import { openSheetPdf } from "./app.mjs";
import { importSheet, keepSheetValue } from "./apply.mjs";
import { exportSheet, sheetValues } from "./export.mjs";
import { readForm } from "./form.mjs";
import { buildPlan } from "./plan.mjs";

/** What `acksExtras.characterSheet.pdf` exposes. */
export const sheetPdfApi = Object.freeze({
  /** Open the window on a character, or on a new one. */
  open: openSheetPdf,
  /** Read an open pdf.js document of the form: `{isForm, share, values}`. */
  readForm,
  /** The plan an import makes of what the form holds. */
  buildPlan,
  /** Import read values onto a character, or a new one. */
  importSheet,
  keepSheetValue,
  /** A character as the form's keys, and the export into an open blank form. */
  sheetValues,
  exportSheet,
});

/** Install the window's entry points. Called at `init`. */
export function installSheetPdf() {
  setWorker(`modules/${MODULE_ID}/vendor/pdfjs/pdf.worker.mjs`);
  setWasmUrl(`modules/${MODULE_ID}/vendor/pdfjs/wasm/`);

  Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
    const actor = app.document;
    if (actor?.type !== ACTOR_TYPE.character || !actor.isOwner) return;
    controls.push({
      action: "acksExtrasSheetPdf",
      icon: "fa-solid fa-file-pdf",
      label: `${LANG}.pdf.control`,
      onClick: () => openSheetPdf({ actor }),
    });
  });

  Hooks.on("renderActorDirectory", (_app, element) => {
    if (!game.user.can("ACTOR_CREATE")) return;
    const root = elementOf(element);
    if (!root || root.querySelector(".acks-extras-sheetpdf-open")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "acks-extras-sheetpdf-open";
    button.innerHTML = `<i class="fa-solid fa-file-pdf" aria-hidden="true"></i> ${game.i18n.localize(`${LANG}.pdf.directory`)}`;
    button.dataset.tooltip = game.i18n.localize(`${LANG}.pdf.directoryHint`);
    button.addEventListener("click", () => openSheetPdf());
    (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(button);
  });

  // The sidebar renders before `ready`, so the hook above misses its first
  // pass; one re-render catches it.
  Hooks.once("ready", () => {
    if (ui.actors?.rendered) ui.actors.render();
  });
}
