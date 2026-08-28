/* global game, foundry, ChatMessage, Roll */
/**
 * The sea's throws on the table: the navigation and hazard dialogs in the
 * door-helper shape — the throw decomposed into its parts and shown BEFORE
 * anything is rolled — and the sinking clock. Every figure the dialogs show
 * comes from `navigation.mjs`'s registry reads; a missing table renders as
 * its stated reason and the roll buttons stand down, so the Judge is asked
 * to import or to roll from the book, never handed a guess.
 *
 * The arts and the helm are read from the people actually aboard: an
 * occupant with the Pathfinding power or the Navigation proficiency lights
 * the navigation bonus, and a captain whose Seafaring reaches master
 * mariner reads the hazard water better — both prefilled, both overridable,
 * because the dialog is a helper and the Judge is the authority.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { makeLoc, gmIds } from "../lib/util.mjs";
import { abilityRank } from "../lib/capabilities.mjs";
import { occupantsOf } from "./occupants.mjs";
import { WATERS, HAZARD_KINDS, navigationThrow, hazardThrow, hazardSpec } from "./navigation.mjs";
import { sinkFormula, isSinking } from "./vessel-damage.mjs";

const loc = makeLoc("ACKS-VEHICLES");

/** The flag holding a sinking vessel's countdown. */
export const SINKING_FLAG = "sinking";

/** Whether anyone aboard carries the named art. */
function aboardHas(vehicleActor, name, token) {
  return occupantsOf(vehicleActor).some((o) => {
    const actor = o.actor ?? game.actors?.get(o.id);
    return actor && abilityRank(actor, name, token) > 0;
  });
}

/** The best Seafaring rank among the crew, for the master-mariner read. */
function bestSeafaring(vehicleActor) {
  let best = Number(vehicleActor?.system?.seafaringRank) || 0;
  for (const o of occupantsOf(vehicleActor)) {
    const actor = o.actor ?? game.actors?.get(o.id);
    if (actor) best = Math.max(best, abilityRank(actor, "Seafaring", "kw:seafaring"));
  }
  return best;
}

const partsList = (parts) =>
  parts
    .map((p) => {
      const label = loc(`reason.${p.key}`);
      return p.missing ? `<li class="hint">${label}</li>` : `<li>${label}: <strong>${p.value}</strong></li>`;
    })
    .join("");

async function whisperThrowCard({ title, parts, target, effective, roll, extra = "" }) {
  const success = roll != null && effective != null && roll.total >= effective;
  const content = `
    <div class="acks-extras-sea-throw-card">
      <header><i class="fa-solid fa-compass"></i> <strong>${title}</strong></header>
      <ol class="acks-extras-sea-throw-parts">${partsList(parts)}</ol>
      ${effective != null ? `<p>${loc("sea.effective", { target: effective })}</p>` : ""}
      ${roll ? `<p class="acks-extras-sea-throw-result ${success ? "success" : "failure"}">
        ${loc(success ? "sea.made" : "sea.failed", { total: roll.total })}</p>` : ""}
      ${extra}
    </div>`;
  await ChatMessage.create({
    speaker: { alias: loc("sea.speaker") },
    whisper: gmIds(),
    content,
    rolls: roll ? [roll] : [],
  });
}

/**
 * The Navigation dialog: water, the arts aboard (prefilled from the crew),
 * the decomposed target — then one d20 whispered to the Judge.
 */
export async function openNavigationDialog(vehicleActor) {
  const { DialogV2 } = foundry.applications.api;
  const prePath = aboardHas(vehicleActor, "Pathfinding", "kw:pathfinding");
  const preNav = aboardHas(vehicleActor, "Navigation", "kw:navigation");

  const waterOptions = Object.entries(WATERS)
    .map(([value, cfg]) => `<option value="${value}">${game.i18n.localize(cfg.label)}</option>`)
    .join("");
  const check = (name, label, on) =>
    `<label class="checkbox"><input type="checkbox" name="${name}" ${on ? "checked" : ""}> ${label}</label>`;

  const result = await DialogV2.prompt({
    window: { title: loc("sea.navigationTitle") },
    content: `
      <div class="acks-extras-sea-throw-dialog">
        <label>${loc("sea.water")} <select name="terrain">${waterOptions}</select></label>
        ${check("pathfinding", loc("sea.pathfinding"), prePath)}
        ${check("navigation", loc("sea.navigationArt"), preNav)}
      </div>`,
    ok: { label: loc("sea.roll"), callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
    rejectClose: false,
  });
  if (!result) return null;

  const spec = navigationThrow({
    terrain: result.terrain,
    pathfinding: !!result.pathfinding,
    navigation: !!result.navigation,
  });
  const roll = spec.effective != null ? await new Roll("1d20").evaluate() : null;
  await whisperThrowCard({
    title: loc("sea.navigationTitle"),
    parts: spec.parts,
    target: spec.target,
    effective: spec.effective,
    roll,
    extra: spec.missing ? `<p class="hint">${loc("sea.importHint")}</p>` : "",
  });
  return spec;
}

/**
 * The hazard dialog: which hazard, the helm's quality (prefilled from the
 * best Seafaring aboard), the two cautions — then the captain's throw, and
 * on a failure the hazard's own imported effects, stated for the Judge.
 */
export async function openHazardDialog(vehicleActor) {
  const { DialogV2 } = foundry.applications.api;
  const master = bestSeafaring(vehicleActor) >= 3;

  const hazardOptions = Object.entries(HAZARD_KINDS)
    .map(([value, cfg]) => `<option value="${value}">${game.i18n.localize(cfg.label)}</option>`)
    .join("");
  const check = (name, label, on) =>
    `<label class="checkbox"><input type="checkbox" name="${name}" ${on ? "checked" : ""}> ${label}</label>`;

  const result = await DialogV2.prompt({
    window: { title: loc("sea.hazardTitle") },
    content: `
      <div class="acks-extras-sea-throw-dialog">
        <label>${loc("sea.hazard")} <select name="kind">${hazardOptions}</select></label>
        ${check("masterMariner", loc("sea.masterMariner"), master)}
        ${check("halfSpeed", loc("sea.halfSpeed"), false)}
        ${check("shallowDraft", loc("sea.shallowDraft"), false)}
      </div>`,
    ok: { label: loc("sea.roll"), callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
    rejectClose: false,
  });
  if (!result) return null;

  const spec = hazardThrow({
    masterMariner: !!result.masterMariner,
    halfSpeed: !!result.halfSpeed,
    shallowDraft: !!result.shallowDraft,
  });
  const roll = spec.effective != null ? await new Roll("1d20").evaluate() : null;

  // A failed throw meets the hazard: state its imported effects — dice,
  // stranding, the half-speed halving — for the Judge to apply.
  let extra = spec.missing ? `<p class="hint">${loc("sea.importHint")}</p>` : "";
  if (roll && roll.total < spec.effective) {
    const hz = hazardSpec(result.kind);
    const lines = [];
    if (hz?.damage) {
      lines.push(loc(result.halfSpeed ? "sea.hazardDamageHalved" : "sea.hazardDamage", { dice: hz.damage }));
    } else if (hz?.harmless) {
      lines.push(loc("sea.hazardHolds"));
    }
    if (hz?.immobile && !hz?.harmless) lines.push(loc("sea.hazardAground"));
    if (hz?.missing) lines.push(loc("sea.importHint"));
    extra += `<p class="acks-extras-sea-throw-hazard">${game.i18n.localize(HAZARD_KINDS[result.kind].label)} — ${lines.join(" ")}</p>`;
  }
  await whisperThrowCard({
    title: loc("sea.hazardTitle"),
    parts: spec.parts,
    target: spec.target,
    effective: spec.effective,
    roll,
    extra,
  });
  return spec;
}

/**
 * The sinking clock. Starting it rolls the imported die once and writes the
 * count to a flag; each tick counts a round down; at zero she is gone. No
 * die imported = no clock to start — the button's hint says why.
 */
export async function startSinkingClock(vehicleActor) {
  const formula = sinkFormula();
  if (!formula || !isSinking(vehicleActor.system)) return null;
  const roll = await new Roll(formula).evaluate();
  await vehicleActor.setFlag(MODULE_ID, SINKING_FLAG, { rounds: roll.total, rolled: roll.total });
  await ChatMessage.create({
    speaker: { alias: loc("sea.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-sea-throw-card"><header><i class="fa-solid fa-water"></i>
      <strong>${loc("sea.sinkStarted", { name: vehicleActor.name, rounds: roll.total })}</strong></header></div>`,
    rolls: [roll],
  });
  return roll.total;
}

/** One round off the clock; announces the water closing over her at zero. */
export async function tickSinkingClock(vehicleActor) {
  const state = vehicleActor.getFlag(MODULE_ID, SINKING_FLAG);
  if (!state) return null;
  const rounds = Math.max(0, (Number(state.rounds) || 0) - 1);
  await vehicleActor.setFlag(MODULE_ID, SINKING_FLAG, { ...state, rounds });
  if (rounds === 0) {
    await ChatMessage.create({
      speaker: { alias: loc("sea.speaker") },
      whisper: gmIds(),
      content: `<div class="acks-extras-sea-throw-card"><header><i class="fa-solid fa-water"></i>
        <strong>${loc("sea.sunk", { name: vehicleActor.name })}</strong></header></div>`,
    });
  }
  return rounds;
}

/** A refloated hull clears its clock (the Judge healed shp above zero). */
export async function clearSinkingClock(vehicleActor) {
  if (vehicleActor.getFlag(MODULE_ID, SINKING_FLAG) != null) {
    await vehicleActor.unsetFlag(MODULE_ID, SINKING_FLAG);
  }
}
