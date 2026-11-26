/* global game */
import { getFrontage, getPartyActor, getPartyScene, maxFrontage, updateFormation } from "./formation-model.mjs";
import { PARTY_TOKEN_SHAPES } from "./constants.mjs";
import { applyTravelForm, setJourneyMode, travelOf, TRAVEL_MODES } from "./travel.mjs";
import { barredNames, forcedMarchBar } from "./march-bar.mjs";

/**
 * The party sheet's record fields, written the same way from every seat: the
 * Judge's seat applies a submit directly (`applyPartyForm`, `judge: true`), and
 * a seat that owns a party member sends the form's allow-listed fields to the
 * Judge's client (`player-requests.mjs`, kind `partyForm`), which applies them
 * with `judge: false`. The Judge's own fields (the country overrides, the lost
 * note, what a seat is shown, who is in camp, the default table, the hex
 * label) are never in the allow-list, so no relayed form reaches them.
 *
 * A relayed write is blocked where the Judge's is warned: it never carries
 * `override`, and a forced march the survival ladder bars is refused before
 * anything is written. Neither path says a warning itself; `applyPartyForm`
 * answers it and the seat that pressed says it (`sayPartyFormAnswer`).
 */

/** Longest text a relayed form field carries, in characters. */
const FIELD_MAX = 200;

/**
 * Every dotted path of a form a seat that owns a member may write, other than
 * the day board's slots (`PARTY_FORM_SLOT`).
 */
export const PARTY_FORM_PATHS = Object.freeze([
  "name", "frontage", "tokenShape", "columnColor",
  "travel.mode", "travel.hour",
  "travel.settlement.pace", "travel.settlement.where", "travel.settlement.route",
  "travel.settlement.hour", "travel.settlement.intent", "travel.settlement.conveyance",
  "travel.movement.hoursAloft", "travel.movement.dayHours", "travel.movement.load",
  "travel.weather.season", "travel.weather.auto", "travel.weather.fronts", "travel.weather.temperature",
  "travel.weather.precipitation", "travel.weather.wind", "travel.weather.footingMud", "travel.weather.footingSnow",
  "travel.day.kind", "travel.day.declared", "travel.day.traps", "travel.day.noSleep",
  "travel.exposure.hours", "travel.exposure.atHeatSource", "travel.exposure.wet",
  "travel.camp.declared", "travel.camp.steal", "travel.camp.water", "travel.camp.sleepInArmour",
]);

/** The day board's hour slots, `travel.day.slot.<n>`. */
export const PARTY_FORM_SLOT = /^travel\.day\.slot\.\d{1,2}$/;

const ALLOWED = new Set(PARTY_FORM_PATHS);

/** Whether a dotted form path is one a relayed form may carry. */
export function isPartyFormPath(path) {
  return ALLOWED.has(path) || PARTY_FORM_SLOT.test(path);
}

/** A field value a relayed form carries: a boolean, a finite number or a short string. */
function isFieldValue(value) {
  if (typeof value === "string") return value.length <= FIELD_MAX;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

/**
 * The part of an expanded form a seat that owns a member may write: a new
 * object holding only the allow-listed paths whose values are plain fields.
 * Every other path is dropped, whatever its name, so a Judge's field in the
 * submit reaches nothing.
 * @param {object} data  the form, expanded
 * @returns {object}
 */
export function pickPartyForm(data) {
  const out = {};
  const put = (path, value) => {
    const parts = path.split(".");
    const last = parts.pop();
    let at = out;
    for (const part of parts) at = Object.hasOwn(at, part) ? at[part] : (at[part] = {});
    at[last] = value;
  };
  const walk = (node, path) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const at = path ? `${path}.${key}` : key;
      if (value && typeof value === "object") walk(value, at);
      else if (isPartyFormPath(at) && isFieldValue(value)) put(at, value);
    }
  };
  walk(data, "");
  return out;
}

/**
 * What a form answer says to the seat that pressed, by code, as the full lang
 * key. A refusal and a warning share the table; both are said as warnings.
 */
export const PARTY_FORM_SAYS = Object.freeze({
  forcedBarred: "ACKS-FORMATION.warn.forcedMarchBarred",
  frontageInvalid: "ACKS-FORMATION.warn.frontageInvalid",
  frontageMax: "ACKS-FORMATION.warn.frontageMax",
});

/**
 * The frontage a seat typed, or null to leave the width alone, and the warning
 * it earns. Blank is no error. A zero, negative or fractional value is refused
 * rather than rounded; a value wider than the scene is clamped to it.
 * @returns {{value: number|null, warned?: {code: string, max?: number}}}
 */
function readFrontage(value, formation) {
  if (value === "" || value === null || value === undefined) return { value: null };
  const wanted = Number(value);
  if (!Number.isInteger(wanted) || wanted < 1) return { value: null, warned: { code: "frontageInvalid" } };
  const max = maxFrontage(getPartyScene(formation) ?? game.scenes?.viewed);
  if (max && wanted > max) return { value: max, warned: { code: "frontageMax", max } };
  return { value: wanted };
}

/**
 * Apply a party sheet submit's record fields: the name (the record's and the
 * party actor's together), the shape and tint of the column, the frontage, the
 * mode, and the travel fields. Writes nothing but what the submit changed.
 *
 * `judge` is the executing seat's own standing, never a payload's. With it
 * false the submit is re-picked to the allow-list, the forced march bar blocks
 * (`override` is not read), and a travel group that arrives without
 * `settlement.wanted` keeps the stored one. With it true the submit is applied
 * as given and `override` is the Judge's answer to the bar's confirm.
 *
 * Nothing is said here. The answer carries what the seat must say:
 * `{ok: false, refused: "forcedBarred", names}` for a forced march the bar
 * stopped (with `judge: false` before any write), and `warned` for a frontage
 * that was refused or clamped.
 * @param {object} formation  a copy `getFormation` handed out
 * @param {object} picked  the form, expanded
 * @returns {Promise<{ok: boolean, changed: boolean, redraw: boolean, refused?: string, names?: string, warned?: object[]}>}
 */
export async function applyPartyForm(formation, picked, { judge = false, override = false } = {}) {
  const data = judge ? picked : pickPartyForm(picked);
  const answer = { ok: true, changed: false, redraw: false };
  const warned = [];
  const kind = data.travel?.day?.kind;
  if (!judge && kind === "forced" && kind !== travelOf(formation).day.kind) {
    const barred = forcedMarchBar(formation);
    if (barred.length) return { ok: false, changed: false, redraw: true, refused: "forcedBarred", names: barredNames(barred) };
  }
  let changed = false;
  // A refused or clamped entry writes nothing but must still redraw, or the
  // field keeps showing the number the formation did not take.
  let redraw = false;
  if (typeof data.name === "string" && data.name.trim() && data.name !== formation.name) {
    formation.name = data.name.trim();
    // The actor mirrors the formation identity (and vice versa on rename).
    await getPartyActor(formation)?.update({ name: formation.name });
    changed = true;
  }
  if (judge && typeof data.tableId === "string" && data.tableId !== (formation.tableId ?? "")) {
    formation.tableId = data.tableId || null;
    changed = true;
  }
  if ("frontage" in data) {
    const read = readFrontage(data.frontage, formation);
    if (read.warned) warned.push(read.warned);
    if (read.value === null || read.value !== Number(data.frontage)) redraw = true;
    if (read.value !== null && read.value !== getFrontage(formation)) {
      formation.frontage = read.value;
      changed = true;
    }
  }
  // The party's own shape, or blank to follow the world's default.
  if (typeof data.tokenShape === "string") {
    const shape = PARTY_TOKEN_SHAPES.includes(data.tokenShape) ? data.tokenShape : null;
    if (shape !== (formation.tokenShape ?? null)) {
      formation.tokenShape = shape;
      changed = true;
    }
  }
  // The column's tint, or blank to take the token's disposition colour.
  if (typeof data.columnColor === "string") {
    const color = /^#[0-9a-f]{6}$/i.test(data.columnColor) ? data.columnColor.toLowerCase() : null;
    if (color !== (formation.columnColor ?? null)) {
      formation.columnColor = color;
      changed = true;
    }
  }
  if (changed) await updateFormation(formation);
  // The travel fields ride the same form and write through their own TARGETED
  // patches. The whole write above carries only the fields this function set
  // on the copy, none of them travel, so it leaves what the patches lay down
  // alone in either order.
  let barred = [];
  if (data.travel) {
    // The band's mode picker rides this submit: a select reports its change
    // here, where an action (which fires on click) would read the old value.
    if (TRAVEL_MODES.includes(data.travel.mode) && data.travel.mode !== travelOf(formation).mode) {
      await setJourneyMode(formation.id, data.travel.mode, { sceneId: formation.sceneId });
    }
    const report = {};
    await applyTravelForm(formation.id, data.travel, { override: judge && override, keepWanted: !judge, report });
    barred = report.barred ?? [];
    redraw = true;
  }
  Object.assign(answer, { changed, redraw });
  if (barred.length) Object.assign(answer, { ok: false, refused: "forcedBarred", names: barredNames(barred) });
  if (warned.length) answer.warned = warned;
  return answer;
}
