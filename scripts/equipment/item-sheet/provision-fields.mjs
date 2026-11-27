/**
 * The item sheet's Provision fields: what the item provides, the days one unit
 * lasts, and for water the days left in what is carried.
 *
 * `provisionView` shapes what the Details tab shows from the ONE supply reader
 * (`provisionOf`), so the sheet and the camp read an item the same way;
 * `foldProvisionForm` turns the form's three controls into the flag write. The
 * flag is `flags["acks-extras"].provision = {kind, perUnit, left}`; a blank
 * control leaves its key out, and a blank form leaves no flag at all.
 * See docs/equipment/MODEL.md, "Provision fields".
 */
import { MODULE_ID } from "../constants.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { unset } from "../../lib/util.mjs";
import { provisionOf, pageDays, figureOf, sizeFigure } from "../../formation/provisions.mjs";

/** The kinds the Provides control sets; an empty value is "as it reads". */
const DECLARED_KINDS = Object.freeze(["food", "water", "none"]);

/** The kind a declaration may also hold, offered only while one is declared. */
const GAME_KIND = "hunt";

/** The flag's keys the form writes. */
const FIELDS = Object.freeze(["kind", "perUnit", "left"]);

/** A figure as the sheet prints it: at most three decimals, no trailing zeros. */
const shown = (n) => String(Math.round(n * 1000) / 1000);

/** The stored declaration, whichever way the document exposes its flags. */
const storedOf = (item) => item?.getFlag?.(MODULE_ID, "provision") ?? item?.flags?.[MODULE_ID]?.provision ?? null;

/**
 * What the Provision fieldset shows for an item.
 *
 * `t` formats an ACKS-EQUIPMENT key. Nothing here states a figure of its own:
 * the sizes are the reading's, the page references are lang strings, and an
 * item with no size shows a blank field and the page reference alone.
 *
 * @param {object} item an Item document
 * @param {(key: string, data?: object) => string} t
 * @returns {{offered: boolean, options: {value: string, label: string, on: boolean}[],
 *   perUnit: number|"", placeholder: string, tip: string, showLeft: boolean,
 *   left: number|"", leftPlaceholder: string, leftTip: string, readsAs: string}}
 */
export function provisionView(item, t) {
  const stored = storedOf(item) ?? {};
  const reading = provisionOf(item);
  const declaredKind = [...DECLARED_KINDS, GAME_KIND].includes(stored.kind) ? stored.kind : "";
  const handSize = sizeFigure(stored.perUnit);
  const handLeft = figureOf(stored.left);
  const name = String(item?.name ?? "");
  const cite = reading && reading.kind !== GAME_KIND ? t(`itemSheet.provision.cite.${reading.kind}`) : "";

  const kinds = declaredKind === GAME_KIND ? [...DECLARED_KINDS, GAME_KIND] : DECLARED_KINDS;
  const options = ["", ...kinds].map((value) => ({
    value,
    label: t(`itemSheet.provision.provides.${value || "reads"}`),
    on: value === declaredKind,
  }));

  // Where the days a unit holds came from, as a sentence; the page reference alone where nothing gave one.
  let tip = t("itemSheet.provision.perUnitHint");
  if (reading && !reading.sized) tip = cite || tip;
  else if (reading?.sizeSource === "declared") {
    tip = pageDays(item, reading.kind) !== null ? t("printed.editedByHand", { name, cite }) : t("printed.byHand", { name });
  } else if (reading?.sizeSource === "page") tip = t("printed.fromPage", { name, cite });
  else if (reading?.sizeSource === "name") tip = t("itemSheet.provision.fromName", { name });
  else if (reading?.sizeSource === "foraged") tip = t("itemSheet.provision.fromForage");

  const sizeWords = reading?.sized
    ? reading.perUnit === 1 ? t("itemSheet.provision.sizeOne") : t("itemSheet.provision.sizeMany", { n: shown(reading.perUnit) })
    : "";
  const sourceWords = {
    declared: t("itemSheet.provision.sourceHand"),
    page: t("itemSheet.provision.sourcePage", { cite }),
    name: t("itemSheet.provision.sourceName"),
    foraged: t("itemSheet.provision.sourceForaged"),
  }[reading?.sizeSource ?? ""] ?? "";
  const kindWord = reading ? t(`itemSheet.provision.kind.${reading.kind}`) : "";
  let readsAs = t("itemSheet.provision.readsNot");
  if (reading?.sized) readsAs = t("itemSheet.provision.readsSized", { kind: kindWord, size: sizeWords, source: sourceWords });
  else if (reading) readsAs = cite ? t("itemSheet.provision.readsUnsized", { kind: kindWord, cite }) : t("itemSheet.provision.readsBare", { kind: kindWord });

  return {
    offered: item?.type === ITEM_TYPE.item || declaredKind !== "" || handSize !== null || handLeft !== null,
    options,
    perUnit: handSize ?? "",
    // The size the item reads as, in the input's place, only where something other than a hand gave it.
    placeholder: handSize === null && reading?.sized ? shown(reading.perUnit) : "",
    tip,
    showLeft: reading?.kind === "water",
    left: handLeft ?? "",
    leftPlaceholder: reading?.kind === "water" && reading.sized ? shown(reading.units * reading.perUnit) : "",
    leftTip: reading?.kind === "water" ? t("itemSheet.provision.leftHint") : "",
    readsAs,
  };
}

/**
 * Fold the Provision form's values into the flag write, in place on the form's
 * expanded `data`.
 *
 * A control absent from the form (Left is drawn for water only) is not a clear:
 * its stored figure carries. A control left blank clears its key; where every
 * key ends up cleared the flag is removed whole, and where nothing is stored
 * and nothing is typed nothing is written at all.
 *
 * @param {object} data the form's expanded data
 * @param {object|null} stored the item's stored `provision` flag
 * @returns {object} `data`
 */
export function foldProvisionForm(data, stored) {
  const flags = data?.flags?.[MODULE_ID];
  const typed = flags?.provision;
  if (!typed || typeof typed !== "object") return data;
  const held = stored && typeof stored === "object" ? stored : {};
  const pick = (key) => (key in typed ? typed[key] : held[key]);

  const next = {};
  if ([...DECLARED_KINDS, GAME_KIND].includes(pick("kind"))) next.kind = pick("kind");
  const perUnit = sizeFigure(pick("perUnit"));
  if (perUnit !== null) next.perUnit = perUnit;
  const left = figureOf(pick("left"));
  if (left !== null && left >= 0) next.left = left;

  const stale = FIELDS.filter((key) => key in held && !(key in next));
  if (!Object.keys(next).length) {
    if (Object.keys(held).length) flags.provision = unset();
    else delete flags.provision;
    return data;
  }
  flags.provision = { ...next, ...Object.fromEntries(stale.map((key) => [key, unset()])) };
  return data;
}
