/* global game, foundry, document, ChatMessage, CONFIG */
/**
 * The Construction panel — what the item IS and where it sits, stated as the
 * declarations that outrank inference: its base type; a weapon's type, class,
 * size, grips and qualities; masterwork, condition, silver, material, a
 * shield's variant and a helmet's weight; the places it may sit; what a
 * harness secures; what reaching into a container costs.
 *
 * Built by hand rather than templated because every row is a live control
 * over a feature's own writer, and the writes happen INSIDE the sheet's
 * submit-on-change form: each control stops its own change event, or core's
 * form handler re-renders the sheet from its stale form data on top of the
 * write. `construction-model.mjs` makes the decisions on plain data; this file
 * reads the item and binds them.
 *
 * One rule for the controls: a registered enum picked ONE of is a dropdown, a
 * set picked SEVERAL of is a strip of chips showing every option with the
 * applying ones coloured — solid for a declaration, dashed for an inference —
 * and free text is the fallback for what no registered value names. Nothing
 * here writes until the sheet is armed (`editing`).
 */
import { MODULE_ID, ITEM_FLAGS, LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { SHIELD_VARIANTS, WEAPONS, SIZE, WEAPON_CATEGORY } from "../config.mjs";
import {
  setMasterwork, masterworkTiersFor, scavengeItem, clearScavenged, setScavengedRow, scavengedOptions,
  setShieldVariant, SHIELD_VARIANT_KEYS, setGearSlotList, setGearAccess, setGearRelief, SLOT_AUTO,
  setWeaponProfile, setWeaponSize, setWeaponGrips, setWeaponCategory,
} from "../actions.mjs";
import { masterworkTierOf, scavengedOf, layerSummary, silveredFlagOf } from "../properties.mjs";
import { canBeSilvered, isSilvered, setSilvered } from "../silver.mjs";
import { classifyWeapon, isHelmet, inferGear, weaponIdentity, inferredGrips, WEAPON_CATEGORY_VALUES } from "../profiles.mjs";
import { weaponName, CATEGORY_TOKENS } from "../training-view.mjs";
import { setBaseType } from "../variation-items.mjs";
import { baseTypesFor, baseTypeIsDeclared, baseTypeOf, BASE_TYPE_FLAG } from "../base-types.mjs";
import { inferBaseType } from "../base-type-infer.mjs";
import { declaresSlots, slotsOf, gearOf, reliefOf } from "../../lib/item-model.mjs";
import { ACCESS_COSTS, slotCapacity, ITEM_TYPE } from "../../lib/vocab.mjs";
import { LABELABLE } from "../../lib/a11y.mjs";
import { helmetType } from "../overlays/enclosing-helm.mjs";
import { MATERIALS, MATERIALS_BY_DAMAGE_TYPE, setMaterial, materialOf } from "../overlays/item-loss.mjs";
import { tableFor } from "../overlays/scavenged.mjs";
import { isContainer } from "../containers.mjs";
import { wearLabel } from "../wear.mjs";
import {
  CHIP, placeChips, nextPlaces, gripChips, nextGrips, qualityChips, nextQuality, otherTags, withTag, withoutTag,
} from "./construction-model.mjs";

const loc = makeLoc(LANG);

/** The class a chip wears in each state. */
const CHIP_CLASS = Object.freeze({ [CHIP.ON]: "acks-tag--solid", [CHIP.AUTO]: "is-auto", [CHIP.OFF]: "acks-tag--ghost" });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const escape = (s) => foundry.utils.escapeHTML?.(String(s)) ?? String(s);

/**
 * Core's registered weapon tags, read at build time: the key, the label a
 * reader sees, and the raw registry string core's own tag icons match on.
 */
function tagRegistry() {
  return Object.entries(CONFIG.ACKS?.tags ?? {}).map(([key, raw]) => ({ key, raw, label: game.i18n.localize(raw) }));
}

/** Chat card summarising a scavenged roll (d20s + the mechanical condition). */
async function postScavengeCard(item, { rolls, cond }) {
  const mech = [];
  if (cond.attack) mech.push(`${cond.attack} attack`);
  if (cond.damage) mech.push(`${cond.damage} damage`);
  if (cond.ac) mech.push(`${cond.ac} AC`);
  if (cond.encumbrance) mech.push(`+${cond.encumbrance} stone`);
  if (cond.initiative) mech.push(`${cond.initiative} initiative`);
  if (cond.breaks) mech.push("breaks on a natural 1");
  if (cond.cannotSneak) mech.push("cannot sneak/hide");
  const labels = cond.labels.length ? cond.labels.join("; ") : "Serviceable";
  const content =
    `<div class="acks-equipment-scavenge-card"><strong>${item.name}</strong> — ` +
    `${game.i18n.localize("ACKS-EQUIPMENT.action.scavenge")} (d20: ${rolls.join(", ")})<br>${labels}` +
    `${mech.length ? `<br><em>${mech.join(", ")}</em>` : ""}` +
    `<br>${Math.round(cond.valueMultiplier * 100)}% of normal value</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: item.parent }) });
}

/**
 * Build the panel. `editing` is the sheet's armed state: every control is
 * rendered either way, so the reading stays on screen, and is disabled until
 * the sheet is armed.
 */
export function buildConstructionPanel(item, { editing = false } = {}) {
  const section = el("section", "acks-extras-item-sheet__props");
  const guard = (fn) => Promise.resolve(fn()).catch((e) => console.error(`${MODULE_ID} | item property`, e));

  const row = (labelKey, control) => {
    const g = el("div", "acks-extras-item-sheet__prop");
    // The caption is a `<label>` only where the row holds something a label can
    // name. Half these rows carry a note or a strip of buttons instead, and a
    // `<label>` over one of those names nothing — a defect, not a style. The
    // class is what carries the look, so both tags render the same.
    const names = control.matches?.(LABELABLE) || !!control.querySelector?.(LABELABLE);
    g.append(el(names ? "label" : "span", "acks-extras-item-sheet__prop-label", labelKey ? game.i18n.localize(labelKey) : ""), control);
    section.append(g);
    return g;
  };
  const note = (text) => row("", el("span", "acks-extras-item-sheet__prop-note", text)).classList.add("is-note");

  // OUR CONTROLS LIVE INSIDE THE SHEET'S <form>, and it submits on change: an
  // un-stopped change event bubbles to the form handler, which re-renders the
  // sheet from ITS form data — throwing away the write we were in the middle
  // of making. So every control's change is stopped here before it reaches
  // the form.
  const onChange = (node, handler) =>
    node.addEventListener("change", (ev) => {
      ev.stopPropagation();
      guard(handler);
    });
  const onClick = (node, handler) =>
    node.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      guard(handler);
    });

  /** A dropdown — the control for "which ONE of these is it?". */
  const select = (options, current, onPick) => {
    const s = el("select", "acks-input acks-input--line acks-extras-item-sheet__prop-input");
    s.innerHTML = options.map((o) => `<option value="${escape(o.value)}">${escape(o.label)}</option>`).join("");
    s.value = current;
    s.disabled = !editing;
    onChange(s, () => onPick(s.value));
    return s;
  };

  /** A small inline action button — rolling, applying, removing. */
  const button = (text, tooltipKey, handler, extraClass = "") => {
    const b = el("button", `acks-btn acks-btn--quiet acks-btn--sm ${extraClass}`.trim(), text);
    b.type = "button";
    b.disabled = !editing;
    if (tooltipKey) b.dataset.tooltip = game.i18n.localize(tooltipKey);
    onClick(b, handler);
    return b;
  };

  /** One chip of a strip: a pressed button in one of the three states. */
  const chip = ({ label, state, locked = false, tooltip, handler }) => {
    const b = el("button", `acks-tag acks-extras-item-sheet__chip-toggle ${CHIP_CLASS[state]}${locked ? " is-locked" : ""}`, label);
    b.type = "button";
    b.setAttribute("aria-pressed", state === CHIP.OFF ? "false" : "true");
    if (tooltip) b.dataset.tooltip = tooltip;
    b.disabled = !editing || locked;
    onClick(b, handler);
    return b;
  };

  /** A strip: the Auto chip, then every option — the control for "which of these apply?". */
  const strip = ({ chips, declared, labelOf, tooltipOf, onAuto, onToggle }) => {
    const group = el("div", "acks-tag-group acks-extras-item-sheet__prop-strip");
    group.append(chip({ label: loc("props.auto"), state: declared ? CHIP.OFF : CHIP.AUTO, tooltip: loc("props.autoHint"), handler: onAuto }));
    for (const c of chips) {
      group.append(chip({ label: labelOf(c.key), state: c.state, locked: c.locked, tooltip: tooltipOf(c), handler: () => onToggle(c.key) }));
    }
    return group;
  };

  // BASE TYPE — what the item is, as the books sort equipment. "Auto" is the
  // name guess; the choices are the base types core lets this document type
  // carry.
  const baseGuess = baseTypeOf({ type: item.type, name: item.name, system: item.system, flags: {} }, { infer: inferBaseType });
  row("ACKS-EQUIPMENT.props.baseType", select(
    [{ value: "", label: loc("props.baseTypeAuto", { guess: game.i18n.localize(`ACKS-EQUIPMENT.baseType.${baseGuess}`) }) },
      ...baseTypesFor(item.type).map((k) => ({ value: k, label: game.i18n.localize(`ACKS-EQUIPMENT.baseType.${k}`) }))],
    baseTypeIsDeclared(item) ? item.getFlag(MODULE_ID, BASE_TYPE_FLAG) : "",
    (v) => setBaseType(item, v || null),
  ));

  // WHAT THE WEAPON IS. Everything a weapon does downstream — the proficiency
  // class a training grant is matched against, the Weapon Focus group, the
  // damage type, the size that sets its hand cost — is read off ONE table row,
  // and which row that is was inferred from the item's NAME. A template renames
  // the gear it grants to the words its own page printed ("Francisca", "Two-
  // handed iron sword"), so the inference misses or lands on the wrong row and
  // the sheet says non-proficient about a weapon the character trained on.
  // These controls are where that is stated instead of guessed.
  if (item.type === ITEM_TYPE.weapon) {
    const identity = weaponIdentity(item);
    const profile = classifyWeapon(item);
    const auto = weaponIdentity(item, { ignoreDeclared: true });
    const classLabel = (cat) => game.i18n.localize(`ACKS-LIB.weaponCat.${cat}`);

    row("ACKS-EQUIPMENT.props.weaponType", select(
      [{ value: SLOT_AUTO, label: auto.key ? loc("props.weaponTypeAuto", { guess: weaponName(auto.key) }) : loc("props.weaponTypeAutoNone") },
        ...Object.keys(WEAPONS).map((k) => ({ value: k, label: weaponName(k) })).sort((a, b) => a.label.localeCompare(b.label))],
      identity.source === "flag" ? identity.key : SLOT_AUTO,
      (v) => setWeaponProfile(item, v),
    ));
    // An unidentified weapon does not fail — it falls back to a medium,
    // class-`other` weapon and says nothing. Naming the consequence is the
    // only way a reader connects this control to the badge on the character
    // sheet that sent them here.
    note(identity.key
      ? loc("props.weaponTypeNote", {
        weapon: weaponName(identity.key),
        category: classLabel(profile.cat),
        source: game.i18n.localize(`ACKS-EQUIPMENT.props.weaponTypeSource.${identity.source}`),
      })
      : loc("props.weaponTypeNone"));

    // CLASS — the seven the character sheet's training lists, in its order
    // and its words. The table row's class is the "Auto" answer; declaring
    // one is what makes a weapon no row identifies count as trained.
    const declaredClass = item.getFlag(MODULE_ID, ITEM_FLAGS.CATEGORY);
    row("ACKS-EQUIPMENT.props.weaponClass", select(
      [{ value: SLOT_AUTO, label: loc("props.weaponClassAuto", { guess: classLabel(WEAPONS[identity.key]?.cat ?? WEAPON_CATEGORY.OTHER) }) },
        ...CATEGORY_TOKENS.map((c) => ({ value: c.cat, label: game.i18n.localize(c.label) }))],
      WEAPON_CATEGORY_VALUES.has(declaredClass) ? declaredClass : SLOT_AUTO,
      (v) => setWeaponCategory(item, v),
    ));

    row("ACKS-EQUIPMENT.props.weaponSize", select(
      [{ value: SLOT_AUTO, label: loc("props.weaponSizeAuto", { guess: game.i18n.localize(`ACKS-EQUIPMENT.size.${WEAPONS[identity.key]?.size ?? SIZE.MEDIUM}`) }) },
        ...Object.values(SIZE).map((s) => ({ value: s, label: game.i18n.localize(`ACKS-EQUIPMENT.size.${s}`) }))],
      String(item.getFlag(MODULE_ID, ITEM_FLAGS.SIZE) ?? SLOT_AUTO),
      (v) => setWeaponSize(item, v),
    ));

    // GRIPS — the hands the weapon may be held in, as two chips because that
    // is what the answer is: one of them, or both (versatile). The size table's
    // answer shows dashed until one is declared; both off returns to it.
    const grips = { declared: profile.grips, inferred: inferredGrips(profile) };
    row("ACKS-EQUIPMENT.props.grips", strip({
      chips: gripChips(grips),
      declared: !!grips.declared,
      labelOf: (k) => game.i18n.localize(`ACKS-EQUIPMENT.grip.${k}`),
      tooltipOf: () => loc("props.gripsHint"),
      onAuto: () => setWeaponGrips(item, SLOT_AUTO),
      onToggle: (k) => setWeaponGrips(item, nextGrips(grips, k) ?? SLOT_AUTO),
    }));
    note(loc(grips.declared ? "props.gripsNote" : "props.gripsAuto", { grips: game.i18n.localize(`ACKS-EQUIPMENT.grip.${grips.declared ?? grips.inferred}`) }));

    // QUALITIES — core's registered weapon tags, every one offered. Three of
    // them are the booleans the attack reads (melee, missile, slow), so the
    // chip writes the field and the tag together.
    const registry = tagRegistry();
    const stored = item.system?.tags ?? [];
    const qualities = el("div", "acks-tag-group acks-extras-item-sheet__prop-strip");
    for (const q of qualityChips(registry, stored, item.system)) {
      qualities.append(chip({
        label: q.label,
        state: q.on ? CHIP.ON : CHIP.OFF,
        tooltip: loc("props.qualitiesHint"),
        handler: () => item.update({ system: nextQuality(registry, stored, q.key, !q.on) }),
      }));
    }
    row("ACKS-EQUIPMENT.props.qualities", qualities);

    // OTHER TAGS — free text, and only for what no quality above names.
    const others = el("div", "acks-tag-group acks-extras-item-sheet__prop-strip");
    for (const text of otherTags(registry, stored)) {
      const tag = el("span", "acks-tag", text);
      if (editing) {
        const x = el("button", "acks-extras-item-sheet__tag-x");
        x.type = "button";
        x.innerHTML = '<i class="fa-solid fa-xmark" inert></i>';
        x.dataset.tooltip = loc("props.removeTag");
        onClick(x, () => item.update({ "system.tags": withoutTag(stored, text) }));
        tag.append(x);
      }
      others.append(tag);
    }
    const add = el("input", "acks-input acks-input--line acks-extras-item-sheet__prop-input is-tag");
    add.type = "text";
    add.placeholder = loc("props.otherTagsAdd");
    add.dataset.tooltip = loc("props.otherTagsHint");
    add.disabled = !editing;
    onChange(add, () => {
      const next = withTag(stored, add.value);
      if (next) return item.update({ "system.tags": next });
      add.value = "";
    });
    others.append(add);
    row("ACKS-EQUIPMENT.props.otherTags", others);
  }

  if (item.type === ITEM_TYPE.weapon || item.type === ITEM_TYPE.armor) {
    // MASTERWORK — a bucket of the RR p159 tiers.
    const tier = masterworkTierOf(item) ?? "none";
    row("ACKS-EQUIPMENT.props.masterwork", select(
      [{ value: "none", label: game.i18n.localize("ACKS-EQUIPMENT.masterwork.none") },
        ...masterworkTiersFor(item.type).map((t) => ({ value: t, label: game.i18n.localize(`ACKS-EQUIPMENT.masterwork.${t}`) }))],
      tier,
      (v) => setMasterwork(item, v),
    ));

    // CONDITION — pick a row of the applicable scavenged table directly, or
    // roll it. Both read the reader's OWN imported table (RR p160, extracted
    // by the importer) when the world has one; the built-in RAW table is the
    // fallback. "Pristine" clears.
    const profile = item.type === ITEM_TYPE.weapon ? classifyWeapon(item) : null;
    const tableKey = tableFor(item, profile);
    const opts = scavengedOptions(tableKey);
    const sc = scavengedOf(item);
    const cur = sc?.labels?.length === 1 ? String(opts.find((o) => o.label === sc.labels[0])?.value ?? "none") : "none";
    const picker = select(
      [{ value: "none", label: loc("props.pristine") }, ...opts.map((o) => ({ value: String(o.value), label: o.label }))],
      cur,
      (v) => (v === "none" ? clearScavenged(item) : setScavengedRow(item, tableKey, v)),
    );
    // A stacked condition (a 19-20 reroll produced several) has no single row —
    // say so rather than showing one of them as if it were the whole story.
    if (sc?.labels?.length > 1) picker.dataset.tooltip = sc.labels.join("; ");
    const g = el("div", "acks-extras-item-sheet__prop-group");
    g.append(picker, button(game.i18n.localize("ACKS-EQUIPMENT.action.scavengeRoll"), "ACKS-EQUIPMENT.action.scavengeHint",
      async () => {
        const r = await scavengeItem(item);
        if (r) await postScavengeCard(item, r);
      }));
    row("ACKS-EQUIPMENT.props.condition", g);

    // Masterwork buys numbers, never eligibility: a masterwork blade still
    // cannot touch a magical monster "unless forged of a material otherwise
    // capable of doing so (e.g. silver)" (RR p159). Said here because the tier
    // picker is exactly where a reader forms the opposite impression.
    if (item.type === ITEM_TYPE.weapon && tier !== "none" && !isSilvered(item)) note(loc("props.masterworkReachNote"));

    const summary = layerSummary(item);
    if (summary) row("ACKS-EQUIPMENT.props.net", el("span", "acks-extras-item-sheet__prop-note", summary));
  }

  // SILVER (RR ch.4) — a weapon quality, so weapons and ammunition only. "Auto"
  // hands the answer back to the weapon table and the name; picking Silvered
  // outright is what applies the 10× price, since the RAW list already charges
  // a Silver Dagger its silvered price and must not be billed twice.
  if (canBeSilvered(item)) {
    const flag = silveredFlagOf(item);
    row("ACKS-EQUIPMENT.props.silver", select(
      [{ value: "auto", label: loc("props.silverAuto", { guess: loc(isSilvered(item) ? "props.silverYes" : "props.silverNo") }) },
        { value: "true", label: loc("props.silverYes") },
        { value: "false", label: loc("props.silverNo") }],
      flag === null ? "auto" : String(flag),
      (v) => setSilvered(item, v === "auto" ? "auto" : v === "true"),
    ));
    // Silver moves no number — it decides what the blade COUNTS AS. Saying so
    // stops it reading as a picker that silently does nothing.
    note(loc(isSilvered(item) ? "props.silverNote" : "props.silverNoneNote"));
  }

  // MATERIAL (any physical item) — "Auto" clears the flag → the name/type guess.
  row("ACKS-EQUIPMENT.props.material", select(
    [{ value: "auto", label: loc("props.materialAuto", { guess: materialOf(item) }) }, ...MATERIALS.map((m) => ({ value: m, label: m }))],
    String(item.getFlag(MODULE_ID, ITEM_FLAGS.MATERIAL) ?? "auto").toLowerCase(),
    (v) => setMaterial(item, v),
  ));
  // Material has no standing modifier — it decides WHICH damage types can
  // destroy the item (JJ p398 item loss). Saying so stops it reading as a
  // setting that silently does nothing.
  const mat = materialOf(item);
  const harms = Object.entries(MATERIALS_BY_DAMAGE_TYPE).filter(([, list]) => list.includes(mat)).map(([dt]) => dt);
  note(harms.length ? loc("props.materialNote", { types: harms.join(", ") }) : loc("props.materialNoneNote"));

  if (item.type === ITEM_TYPE.armor && item.system?.type === "shield") {
    row("ACKS-EQUIPMENT.props.variant", select(
      SHIELD_VARIANT_KEYS.map((k) => ({ value: k, label: SHIELD_VARIANTS[k]?.label ?? k })),
      item.getFlag(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT) ?? "standard",
      (v) => setShieldVariant(item, v),
    ));
  }
  if (isHelmet(item)) {
    row("ACKS-EQUIPMENT.props.helm", select(
      [{ value: "light", label: game.i18n.localize("ACKS-EQUIPMENT.helm.light") }, { value: "heavy", label: game.i18n.localize("ACKS-EQUIPMENT.helm.heavy") }],
      helmetType(item),
      (v) => item.setFlag(MODULE_ID, ITEM_FLAGS.HELMET, v),
    ));
  }

  // WHERE IT MAY SIT — every place the character sheet knows, lit where this
  // item may go. The annotate pass infers the set and is sometimes wrong, so
  // the strip is the correction: a click declares the inferred set with that
  // one change, Auto hands it back, and a declared strip with nothing lit is
  // the "carried, worn nowhere" answer — which stops the name heuristics
  // putting a "Great Helm" back on the head. A weapon's hands are its own.
  const inferred = inferGear(item);
  const places = { declared: declaresSlots(item) ? slotsOf(item) : null, inferred: inferred.slots, weapon: item.type === ITEM_TYPE.weapon };
  row("ACKS-EQUIPMENT.props.slot", strip({
    chips: placeChips(places),
    declared: !!places.declared,
    labelOf: wearLabel,
    tooltipOf: (c) => loc(c.locked ? "props.handsLocked" : "props.slotHint"),
    onAuto: () => setGearSlotList(item, null),
    onToggle: (k) => setGearSlotList(item, nextPlaces(places, k)),
  }));
  const effective = places.declared ?? places.inferred;
  const named = effective.map(wearLabel).join(", ");
  note(places.declared
    ? (effective.length ? loc("props.slotDeclared", { slots: named }) : loc("props.slotNone"))
    : (effective.length ? loc("props.slotInferred", { slots: named }) : loc("props.slotAutoNone")));
  // A slot with a capacity is the only mechanic RAW hangs on one (TT: you
  // cannot wear two of the same thing), so say what it is rather than leaving
  // the control looking decorative.
  const cap = effective[0] ? slotCapacity(effective[0]) : null;
  if (Number.isFinite(cap)) note(loc("props.slotCapacity", { n: cap, slot: wearLabel(effective[0]) }));

  // WHAT A HARNESS SECURES — the book's figure, read from the item's own text
  // by the annotate pass or typed here. Unstated secures nothing.
  if (item.getFlag(MODULE_ID, ITEM_FLAGS.HARNESS)) {
    const reliefBox = el("input", "acks-input acks-input--line acks-nums acks-extras-item-sheet__prop-input");
    reliefBox.type = "number";
    reliefBox.min = "0";
    reliefBox.step = "0.5";
    reliefBox.placeholder = loc("props.reliefNone");
    reliefBox.disabled = !editing;
    const relief = reliefOf(item);
    reliefBox.value = relief === null ? "" : String(relief);
    onChange(reliefBox, () => setGearRelief(item, reliefBox.value));
    row("ACKS-EQUIPMENT.props.relief", reliefBox);
  }

  // RETRIEVAL COST — only meaningful once something can be inside it. The
  // capacity that makes it a container is the Details tab's own switch.
  if (isContainer(item)) {
    row("ACKS-EQUIPMENT.props.access", select(
      [{ value: SLOT_AUTO, label: loc("props.accessUnset") }, ...Object.keys(ACCESS_COSTS).map((k) => ({ value: k, label: game.i18n.localize(`ACKS-EQUIPMENT.access.${k}`) }))],
      gearOf(item).access || SLOT_AUTO,
      (v) => setGearAccess(item, v),
    ));
  }

  return section;
}
