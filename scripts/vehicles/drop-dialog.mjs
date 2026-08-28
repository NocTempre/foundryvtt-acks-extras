/* global foundry, game */
import { makeLoc } from "../lib/util.mjs";
/**
 * What is this dropped actor to the vehicle? A dialog that ASKS.
 *
 * A drop used to be routed silently by target — hold meant passenger,
 * anywhere else meant the traces — and the guide's promise of a choice was
 * TESTING.md's documented mismatch. This dialog closes it: every actor drop
 * offers the stations the vehicle actually has (from `stationsFor`, so the
 * options and the sheet's groups can never disagree), each with its cost
 * stated before anything is written. The caller attaches; this only asks.
 */
import { VEHICLE_TYPE, LANG_PREFIX } from "./constants.mjs";
import { stationsFor } from "./stations.mjs";
import { guessDraftKind, draftPullOf, occupantsOf } from "./occupants.mjs";
import { DRAFT_EQUIVALENTS } from "./vehicle-data.mjs";
import { borneBy6 } from "../lib/capacity.mjs";
import { bodyCount } from "../lib/group-logic.mjs";
import { STONE } from "../lib/item-model.mjs";

const loc = makeLoc(LANG_PREFIX);

/**
 * Ask what a dropped actor should be aboard `vehicle`.
 *
 * @param {Actor} vehicle
 * @param {Actor} doc the dropped actor
 * @param {object} [o]
 * @param {string} [o.preselect] a station key from the drop target, checked
 *   first so a drop ON a slot is one click
 * @param {boolean} [o.auto] the drop landed ON a specific seat — when the
 *   preselect names a real option, take it without asking
 * @returns {Promise<{role, station, kind}|null>} the pick, or null if closed
 */
export async function routeActorDrop(vehicle, doc, { preselect = null, auto = false } = {}) {
  const sys = vehicle.system;
  const options = optionsFor(sys, vehicle, doc);
  if (!options.length) return null;
  if (options.length === 1) return options[0];

  const preselected = options.find((o) => preselect && (o.station === preselect || o.id === preselect)) ?? null;
  if (auto && preselected) return preselected;
  const checked = preselected ?? options.find((o) => o.recommended) ?? options[0];
  const rows = options
    .map(
      (o, i) => `
      <label class="acks-extras-vehicle-drop-option">
        <input type="radio" name="station" value="${i}" ${o === checked ? "checked" : ""}>
        <span class="acks-extras-vehicle-drop-label">${o.label}</span>
        <span class="acks-extras-vehicle-drop-note">${o.note ?? ""}</span>
      </label>`,
    )
    .join("");

  const pick = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("dropDialog.title", { name: doc.name, vehicle: vehicle.name }) },
    content: `<fieldset class="acks-extras-vehicle-drop">${rows}</fieldset>`,
    rejectClose: false,
    ok: {
      label: loc("dropDialog.ok"),
      callback: (_event, button) => {
        const i = Number(button.form?.elements?.station?.value);
        return Number.isInteger(i) ? options[i] : null;
      },
    },
  });
  return pick ?? null;
}

/**
 * The stations this actor could take on this vehicle, cost stated per option.
 * Another VEHICLE can only be lashed on as cargo; anything else is offered
 * the vehicle's real groups.
 */
function optionsFor(sys, vehicle, doc) {
  // TRUE weight: the specific actor's specific mass (a stack, all its bodies).
  const stone = round2(borneBy6(doc) / STONE);
  const bodies = bodyCount(doc);
  const asCargo = {
    id: "cargo",
    role: "cargo",
    station: null,
    kind: null,
    label: game.i18n.localize(`${LANG_PREFIX}.bucket.cargo`),
    note: loc("dropDialog.stone", { stone }),
  };
  if (doc.type === VEHICLE_TYPE) return [asCargo];

  const groups = stationsFor(sys, occupantsOf(vehicle), { pull: draftPullOf(vehicle) });
  const options = [];
  for (const g of groups) {
    const label = g.labelText || game.i18n.localize(g.labelKey);
    const complement = g.required != null ? ` ${g.filled}/${g.required}` : "";
    if (g.role === "passenger") {
      options.push({
        id: g.key, role: "passenger", station: null, kind: null, label,
        note: loc("dropDialog.stone", { stone }),
        recommended: doc.type === "character",
      });
    } else if (g.role === "draft") {
      const kind = guessDraftKind(doc);
      options.push({
        id: g.key, role: "draft", station: null, kind, label,
        note: loc("dropDialog.pull", {
          pull: (DRAFT_EQUIVALENTS[kind] ?? 0) * bodies,
          kind: game.i18n.localize(`${LANG_PREFIX}.draft.${kind}`),
        }),
        recommended: doc.type !== "character",
      });
    } else if (g.role === "crew") {
      options.push({
        id: g.key, role: "crew", station: g.station, kind: null,
        label: `${label}${complement}`,
        note: game.i18n.localize(`${LANG_PREFIX}.dropDialog.crewNote`),
      });
    }
  }
  options.push(asCargo);
  return options;
}

const round2 = (n) => Math.round(n * 100) / 100;
