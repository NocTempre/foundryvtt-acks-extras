/* global game, Hooks, foundry */
/**
 * The animal panel: what a mount or a draft beast is FOR, on its own sheet.
 *
 * An `acks-extras.animal` renders on the system's monster sheet, which knows
 * the creature's attacks and hit dice and nothing about the two facts the
 * mounted and vehicle rules actually ask of it — what it was trained for and
 * what it can carry. Those live in this library's own `system.animal` subtree,
 * so without a surface of their own they were reachable only from a console.
 * This injects one panel that both SHOWS what an import supplied and lets a
 * Judge type it where no book has.
 *
 * Three questions, kept apart because the rules keep them apart:
 *
 *  - **training** — what it was schooled for. A war-trained mount joins its
 *    rider's charge; an untrained one does not.
 *  - **mountable** — whether the species can be ridden at all, which is not
 *    the same question: an ox is rideable in principle and untrained in
 *    practice, and a war dog is trained for war and is still not a mount.
 * What it CARRIES is deliberately not edited here. A mount's capacity has one
 * live store — `flags[MODULE_ID].extras.load`, which `capacity6()` reads and
 * the monster sheet already edits further down this same sheet — so a second
 * pair of inputs would be two controls for one fact that can disagree on
 * screen. The panel READS that store instead, so the reader can see what the
 * beast can carry beside what it is for, and says when nothing has stated it.
 *
 * (`system.animal.capacity6` / `unencumbered6` are legacy fields no consumer
 * reads; nothing writes them, and the importer fills the live store.)
 *
 * The panel states its PROVENANCE: a value an import supplied reads as
 * imported, a field no book filled reads as unstated rather than as zero.
 */
import { MODULE_ID } from "./constants.mjs";
import { ANIMAL_TRAINING } from "./data/animal-data.mjs";
import { makeLoc } from "./util.mjs";

const loc = makeLoc("ACKS-LIB");

// Spelled here rather than imported from module.mjs, which imports THIS file
// to register the panel — the same string, no cycle.
const ANIMAL_TYPE = `${MODULE_ID}.animal`;

/** The one live load store — what `capacity6()` reads, in printed stone. */
const loadOf = (actor) => actor?.flags?.[MODULE_ID]?.extras?.load ?? null;

/** Was this animal's data written by an import rather than typed here? */
const isImported = (actor) => !!actor?.getFlag?.("acks-importer", "cookbook");

function buildPanel(actor) {
  const a = actor.system?.animal ?? {};
  const section = document.createElement("section");
  section.className = "acks-extras-animal-panel";

  const trainingOptions = Object.keys(ANIMAL_TRAINING)
    .map((key) => {
      const sel = (a.training || "untrained") === key ? " selected" : "";
      return `<option value="${key}"${sel}>${game.i18n.localize(ANIMAL_TRAINING[key])}</option>`;
    })
    .join("");

  const load = loadOf(actor);
  const normal = Number.isFinite(Number(load?.normal)) ? Number(load.normal) : null;
  const max = Number.isFinite(Number(load?.capacity)) ? Number(load.capacity) : null;
  const carries = normal == null && max == null
    ? `<span class="acks-extras-animal-unstated">${loc("animalPanel.loadUnstated")}</span>`
    : loc("animalPanel.loadReadout", { normal: normal ?? "—", max: max ?? "—" });

  section.innerHTML = `
    <h3 class="acks-extras-animal-panel-head">
      <i class="fa-solid fa-horse"></i> ${loc("animalPanel.legend")}
      ${isImported(actor) ? `<span class="acks-extras-animal-imported">${loc("animalPanel.imported")}</span>` : ""}
    </h3>
    <div class="acks-extras-animal-grid">
      <label class="acks-extras-animal-field" data-tooltip="${loc("animalPanel.trainingHint")}">
        <span>${loc("animalPanel.training")}</span>
        <select name="training">${trainingOptions}</select>
      </label>
      <label class="acks-extras-animal-field checkbox" data-tooltip="${loc("animalPanel.mountableHint")}">
        <input type="checkbox" name="mountable" ${a.mountable ? "checked" : ""}>
        <span>${loc("animalPanel.mountable")}</span>
      </label>
      <span class="acks-extras-animal-field acks-extras-animal-carries"
            data-tooltip="${loc("animalPanel.carriesHint")}">${carries}</span>
    </div>
    <p class="hint">${loc("animalPanel.hint")}</p>
  `;

  // One write per change, straight onto the animal subtree. The sheet is the
  // system's, so this panel owns its own submission rather than riding a form.
  section.addEventListener("change", async (event) => {
    const el = event.target;
    if (!el?.name) return;
    const patch = {};
    if (el.name === "training") patch["system.animal.training"] = el.value;
    else if (el.name === "mountable") patch["system.animal.mountable"] = el.checked;
    if (Object.keys(patch).length) await actor.update(patch);
  });

  return section;
}

/**
 * Inject the panel once per render. Gated on the ANIMAL sub-type, so a
 * monster's own sheet is untouched, and deduped because ApplicationV2 fires a
 * render hook per class in the chain.
 */
function onRenderAnimalSheet(app, element) {
  try {
    if (app?.document?.documentName !== "Actor" || app.document.type !== ANIMAL_TYPE) return;
    const root = element?.querySelector?.(".window-content") ?? element;
    if (!root || root.querySelector(".acks-extras-animal-panel")) return;
    if (!app.document.isOwner) return;
    root.prepend(buildPanel(app.document));
  } catch (err) {
    console.error(`${MODULE_ID} | animal panel failed; the sheet stands without it`, err);
  }
}

/** Registered at ready, beside the animal sheet the library falls back to. */
export function registerAnimalPanel() {
  Hooks.on("renderApplicationV2", onRenderAnimalSheet);
  Hooks.on("renderActorSheetV2", onRenderAnimalSheet);
}
