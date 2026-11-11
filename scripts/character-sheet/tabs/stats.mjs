/* global game */
/**
 * The Stats tab's data: what is not a throw. The six attributes (checks are
 * not rolls in ACKS II, so no die), the training as the most explicit list
 * the grammar allows — every style, every weapon of the equipment table as
 * its own pill under whichever organisation the viewer chose, every armour
 * rung and the shield — each pill saying where it came from and whether a hand
 * moved it off what the class prints; movement by mode, vision light by
 * light, the vitals, and the throw targets and roll modifiers the Rolls tab
 * reads (this is the pen; Rolls is the gauge).
 */
import { LANG, SAVE_KEYS, ADVENTURING_KEYS, MOVE_MODES, LIGHT_ICONS } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { profileStrips, SLOT_VOCAB } from "../../lib/proficiency-strip.mjs";
import { EFFECT_DOMAINS } from "../../equipment/constants.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, grantMatches } from "../../equipment/proficiency.mjs";
import { focusGroup } from "../../equipment/profiles.mjs";
import { collectStringFlags, findLoadoutEffect, loadoutPart, partSource } from "../../equipment/effects.mjs";
import { getLoadout } from "../../equipment/loadout.mjs";
import { armourTrainingRows } from "../../equipment/abilities-bridge.mjs";
import { standingModifiers } from "../../lib/typed-modifiers.mjs";
import { SHORTCUT_LISTS, TRAINING_VIEWS, arrangeUnits, coverageOf, coveredUnits, shortcuts } from "../../equipment/training-view.mjs";
import { WEAPON_LISTS_DOC, categoryOptions, optionFindings, weaponOptions } from "../../lib/weapons.mjs";
import { citeOf } from "../../lib/tables.mjs";
import { trainingSourceName, trainingProvenance, editedSlots, editedWeaponTokens, classTraining, hasTraining } from "../../classes/training.mjs";
import { hitPointAuditText } from "../../classes/hitpoints.mjs";
import { LIGHT_SOURCES, lightFigures, lightCite } from "../../lib/light.mjs";
import { senseCite, senseProfile, VISION_MODES } from "../../lib/senses.mjs";
import { ATTRIBUTES, slug } from "../../lib/vocab.mjs";
import { carriesMorale, signed, storedSystem } from "../view-model.mjs";
import { saveSystemKey, saveLabel, saveModifiers } from "../snapshot.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * The names a pill's tooltip lists as its sources, class first. A flag has
 * no name; it reads as the sheet's own profile.
 */
function sourceNames(contributions) {
  const names = [];
  for (const c of contributions) {
    const name = c.source === "flag" ? loc("stats.sourceFlag") : c.name || loc(`stats.source.${c.source}`);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Decorate one pill with its provenance and its edit state. `covering` tests
 * whether a contribution's token reaches this pill.
 */
function annotate(pill, contributions, covering, { editing, edited }) {
  const mine = contributions.filter((c) => c.tokens.some(covering));
  const fromClass = mine.some((c) => c.source === "class");
  const others = sourceNames(mine.filter((c) => c.source !== "class"));
  const locked = editing && pill.on && !fromClass && others.length > 0;
  const tip = [pill.label];
  if (locked) tip.push(loc("stats.lockedTip", { names: others.join(", ") }));
  else if (others.length) tip.push(loc("stats.sourceTip", { names: others.join(", ") }));
  if (edited) tip.push(loc("stats.editedTip"));
  return { ...pill, fromClass, others, locked, edited, editing, tooltip: tip.join(" · ") };
}

/**
 * Where a printed option or Weapon Focus was read, as its tooltip names it:
 * its list, its marker where it has one, and its page. A Judge's override
 * carries no page (`citeOf` answers null), and says so.
 */
function optionWhere(option) {
  const where = [loc(`stats.optionList.${option.list}`), option.marker].filter(Boolean).join(" ");
  const table = option.list === "focus" ? "focus" : "options";
  const page = citeOf(WEAPON_LISTS_DOC, table);
  const cite = page ? option.cite || page : null;
  return cite ? loc("stats.optionWhereCited", { where, cite }) : loc("stats.optionWhereJudge", { where });
}

/** What every category header's tooltip reads, once: the options, which hold each category, the predicates and the findings. */
function tipContext() {
  return { options: weaponOptions(), held: categoryOptions(), predicates: shortcuts().filter((s) => s.kind === "predicate"), found: optionFindings() };
}

/**
 * The printed options a category group's tooltip names as holding its weapons:
 * the noun-list options the placement put a weapon of the group on
 * (`categoryOptions`) and the size-and-use options one of them satisfies, in
 * the order the import lists them, each by its printed words and where it was
 * read. The restricted list's single picks are the weapons themselves and are
 * not named. With no option list imported the tooltip says so and names none.
 * With options imported it also says where the options fall short: that none
 * holds any of the group's weapons, that no single option holds all of them,
 * and how many of its weapons are in no option at all.
 *
 * @param {{token: string}} group the category group, by its slugged token
 * @param {string} label the group's own name, the tooltip's first part
 * @param {{key: string}[]} members the group's weapons
 * @param {object} [context] `tipContext()`, read once for every group of a build
 */
export function categoryTip(group, label, members, context = tipContext()) {
  const { options, held, predicates, found } = context;
  if (!options.length) return [label, loc("stats.optionsNotImported")].join(" · ");
  const keys = new Set(members.map((m) => m.key));
  const token = Object.keys(held).find((t) => slug(t) === group.token);
  const named = new Set((held[token] ?? []).filter((id) => options.find((o) => o.id === id)?.list !== "restricted"));
  for (const s of predicates) if (s.units.some((k) => keys.has(k))) named.add(s.id);
  const holding = options.filter((o) => named.has(o.id)).map((o) => loc("stats.optionHeld", { label: o.label, where: optionWhere(o) }));
  const parts = [label, holding.length ? loc("stats.optionsHolding", { options: holding.join("; ") }) : loc("stats.optionsNoneHold")];
  if (found.notWhole.some((t) => slug(t) === group.token)) parts.push(loc("stats.optionsNotWhole"));
  const loose = members.filter((m) => found.unplaced.includes(m.key)).length;
  if (loose) parts.push(loc("stats.optionsLoose", { count: loose }));
  return parts.join(" · ");
}

/** The face and the `aria-pressed` of each coverage a shortcut can show. */
const SHORTCUT_FACE = Object.freeze({
  all: { icon: "fa-solid fa-circle-check", pressed: "true" },
  some: { icon: "fa-solid fa-circle-half-stroke", pressed: "mixed" },
  none: { icon: "fa-regular fa-circle", pressed: "false" },
});

/**
 * The quick-select rows under the Weapons heading: one per imported list that
 * holds a group (narrow, broad, martial, Weapon Focus), one button per group
 * by its printed words. A button's state is how much of its weapons the
 * weapons grant a press rewrites covers (`editedWeaponTokens`), so the face and
 * the press read one list. Its tooltip names the list, the marker, the page and
 * how many of its weapons are in the grant; a group no weapon is placed on is
 * `aria-disabled` and says so. With no list imported there are no rows and
 * `imported` is false.
 *
 * @returns {{imported: boolean, rows: {key: string, caption: string, buttons: object[]}[]}}
 */
export function trainingShortcuts(actor) {
  const all = shortcuts();
  if (!all.length) return { imported: false, rows: [] };
  const { units: covered } = coveredUnits(editedWeaponTokens(actor));
  const rows = [];
  for (const list of SHORTCUT_LISTS) {
    const buttons = all
      .filter((s) => s.list === list)
      .map((s) => {
        const state = coverageOf(s.units, covered);
        const held = s.units.filter((k) => covered.has(k)).length;
        const figures = { label: s.label, where: optionWhere(s), held, total: s.units.length };
        return {
          id: s.id,
          label: s.label,
          state,
          on: state === "all",
          partial: state === "some",
          icon: SHORTCUT_FACE[state].icon,
          pressed: SHORTCUT_FACE[state].pressed,
          count: `${held}/${s.units.length}`,
          empty: !s.units.length,
          aria: loc("stats.shortcutAria", { label: s.label, state: loc(`stats.shortcutState.${state}`), held, total: s.units.length }),
          tip: loc(s.units.length ? "stats.shortcutTip" : "stats.shortcutTipEmpty", figures),
        };
      });
    if (buttons.length) rows.push({ key: list, caption: loc(`stats.optionList.${list}`), buttons });
  }
  return { imported: true, rows };
}

/** The shortcut rows, or none when reading them throws: a convenience never kills the tab. */
function shortcutsOrNone(actor) {
  try {
    return trainingShortcuts(actor);
  } catch (err) {
    console.error("acks-extras | the training shortcuts could not be read; the pills stand alone", err);
    return { imported: true, rows: [] };
  }
}

/** The weapon list: every unit once, under the view's groups. */
function weaponGroups(actor, strips, { view, openBuckets, editing, prov, edited }) {
  const prof = weaponProficiency(actor);
  const focus = new Set([...collectStringFlags(actor, EFFECT_DOMAINS.WEAPON_FOCUS)].map(norm));
  const configured = strips.weapons.some((w) => !w.unset);
  const unitOn = (u) => (configured && !prof.all ? isWeaponProficient(actor, u.profile, prof, { grantsOnly: true }) : configured && prof.all);
  // The option tooltips are a convenience: a throw in reading them leaves the header's own name.
  let tips = null;
  if (view === "category") {
    try {
      tips = tipContext();
    } catch (err) {
      console.error("acks-extras | the printed options could not be read; the headers stand unannotated", err);
    }
  }
  const tipFor = (g, label, members) => {
    if (!tips || !g.token) return label;
    try {
      return categoryTip(g, label, members, tips);
    } catch (err) {
      console.error("acks-extras | a category header's printed options could not be named", err);
      return label;
    }
  };
  return arrangeUnits(view).map((g) => {
    const members = g.members.map((u) => {
      const group = focusGroup(u.profile);
      const pill = { key: u.key, token: u.token, label: u.name, icon: u.icon, on: unitOn(u), gold: !!group && focus.has(norm(group)), unset: !configured };
      return annotate(pill, prov.weapons, (t) => grantMatches(t, u.profile), { editing, edited: edited.weapons.has(u.key) });
    });
    const lit = members.filter((m) => m.on);
    const label = game.i18n.localize(g.label);
    const head = {
      key: g.key,
      token: g.token,
      label,
      // A category group says which printed options hold its weapons; another organisation's group is not one.
      tip: tipFor(g, label, members),
      tier: g.tier ? loc(`stats.tier.${g.tier}`) : "",
      on: members.length > 0 && lit.length === members.length,
      partial: lit.length > 0 && lit.length < members.length,
      unset: !configured,
      edited: members.some((m) => m.edited),
      locked: editing && lit.length > 0 && lit.every((m) => m.locked),
      open: view === "flat" || openBuckets.has(g.key),
      editing,
    };
    return { ...head, members };
  });
}

/**
 * The figure Rolls uses for one modifier row, as a signed note and the tooltip
 * that names where it comes from: the stored value the input holds, then the
 * effects that move it. `stored` and `inForce` are numbers.
 */
function inForceFigure(stored, inForce) {
  const value = signed(inForce);
  const effects = inForce - stored;
  const tip = effects
    ? loc("stats.modifierTip", { stored: signed(stored), effects: signed(effects), value })
    : loc("stats.modifierTipPlain", { value });
  return { value, tip };
}

/** Why a typed modifier is listed and not applied, as `loc` keys. */
const NOT_APPLIED_REASONS = {
  unresolved: "stats.reason.unresolved",
  gateOff: "stats.reason.gateOff",
  gate: "stats.reason.gate",
  condition: "stats.reason.condition",
  scope: "stats.reason.scope",
  narrowed: "stats.reason.narrowed",
  standAside: "stats.reason.standAside",
  notStacking: "stats.reason.notStacking",
};

/**
 * The typed modifiers resolved for this actor, or none: characters only, and
 * an actor with no items (a mock, a bare record) has none.
 */
function typedFor(actor) {
  if (actor?.type !== "character" || !actor.items) return { parts: [], listed: [] };
  let loadout = null;
  try {
    loadout = getLoadout(actor);
  } catch {
    loadout = null; // a gate with no loadout answers undecided, which lists it
  }
  return standingModifiers(actor, { ctx: { loadout } });
}

/**
 * The lines a modifier's tooltip adds under its total: each part the loadout
 * effect wrote to one of `paths`, named, with "unverified" on a scan's; then
 * the typed modifiers an ability carries for `target` that are not applied,
 * each with why. A change that lowers a save target is stated as the help it
 * gives, the way the row reads.
 */
function typedLines(actor, paths, target, typed) {
  const lines = [];
  const effect = findLoadoutEffect(actor);
  for (const change of effect?.changes ?? []) {
    if (!paths.includes(change.key)) continue;
    const part = loadoutPart(effect, change);
    if (!part) continue;
    const raw = Number(change.value);
    const n = change.type === "subtract" && !change.key.startsWith("system.saves.") ? -raw : raw;
    if (!Number.isFinite(n) || !n) continue;
    const label = part.label || (part.labelKey ? game.i18n.localize(part.labelKey) : loc("stats.partLoadout"));
    // A rule whose figure is an imported table names where it was read, at render.
    const source = partSource(part);
    const key = part.unverified ? "stats.partUnverified" : source?.cite ? "stats.partCited" : source?.judge ? "stats.partJudge" : "stats.part";
    lines.push(loc(key, { label, value: signed(n), ...(source?.cite ? { cite: source.cite } : {}) }));
  }
  const seen = new Set();
  const left = [];
  for (const l of typed.listed) {
    if (l.target !== target || seen.has(`${l.itemId}:${l.index}`)) continue;
    seen.add(`${l.itemId}:${l.index}`);
    const reason = loc(NOT_APPLIED_REASONS[l.reason] ?? NOT_APPLIED_REASONS.condition);
    left.push(loc("stats.notAppliedPart", { label: l.label, reason }));
  }
  if (left.length) lines.push(loc("stats.notApplied", { names: left.join(", ") }));
  return lines;
}

/** A tooltip's total followed by its typed lines, one string. */
const withLines = (tip, lines) => [tip, ...lines].join(" · ");

/**
 * The AC rows' tooltips: core's sum in its parts with the actor's numbers —
 * the armour core reads as its base, by name, Dexterity, the shield, the stored
 * bonus and what effects add — then each part the loadout effect wrote to
 * `system.ac.mod`. A record with no items reads its parts without the name.
 * @returns {{shield: string, armour: string, naked: string}}
 */
function acTips(actor, sys, stored, typed) {
  let base = null;
  try {
    base = actor?.type === "character" && actor.items ? getLoadout(actor).coreArmorBase : null;
  } catch {
    base = null; // no loadout to read: the base is stated without its name
  }
  const dex = actor?.type === "character" ? num(sys.scores?.dex?.mod) : 0;
  const shield = num(sys.ac?.shield);
  const storedMod = num(stored.ac?.mod);
  const total = num(sys.ac?.value);
  const parts = {
    armour: base ? loc("stats.acBaseNamed", { value: num(base.system?.ac?.value), name: base.name }) : loc("stats.acBaseNone"),
    dex: signed(dex),
    stored: signed(storedMod),
    effects: signed(num(sys.ac?.mod) - storedMod),
  };
  const lines = typedLines(actor, ["system.ac.mod"], "ac", typed);
  return {
    shield: withLines(loc("stats.acTip", { ...parts, shield: signed(shield), value: total }), lines),
    armour: withLines(loc("stats.acTipNoShield", { ...parts, value: total - shield }), lines),
    naked: loc("stats.acNakedTip", { dex: signed(dex), value: num(sys.ac?.naked) }),
  };
}

/**
 * The Stats tab's throw group: the targets (attack throw, saves, adventuring)
 * and the four modifiers. Every input renders the STORED value; each modifier
 * that Rolls also shows carries the signed figure in force beside it and a
 * tooltip saying how that figure is made. Initiative reads the prepared
 * total, which the system makes from the modifier and, on a character, the
 * Dexterity modifier; what is left over is the effects'. Each tooltip then
 * names the typed modifiers the loadout applied to that field and those an
 * ability carries for it and does not apply. The save row's figure is the
 * shared modifier in force; a save that a narrower modifier or a condition
 * moves further is named beside it.
 */
export function buildThrows(actor) {
  const sys = actor.system ?? {};
  const stored = storedSystem(actor);
  const typed = typedFor(actor);
  const surpriseOthers = num(stored.surprise?.surpriseothers);
  const avoidSurprise = num(stored.surprise?.avoidsurprise);
  const initiativeTotal = num(sys.initiative?.value);
  const initiative = signed(initiativeTotal);
  const initiativeStored = num(stored.initiative?.mod);
  const dex = actor.type === "character" ? num(sys.scores?.dex?.mod) : 0;
  const initiativeTip = withLines(
    loc("stats.initiativeTip", {
      stored: signed(initiativeStored),
      dex: signed(dex),
      effects: signed(initiativeTotal - initiativeStored - dex),
      value: initiative,
    }),
    typedLines(actor, ["system.initiative.mod"], "initiative", typed),
  );
  const saveModStored = num(stored.save?.mod);
  const saveModInForce = num(sys.save?.mod, saveModStored);
  const saveFigure = inForceFigure(saveModStored, saveModInForce);
  let perSave = {};
  try {
    perSave = actor.items ? saveModifiers(actor) : {};
  } catch {
    perSave = {}; // a record with no effects to read has no per-save figure
  }
  const further = SAVE_KEYS.filter((k) => Number.isFinite(perSave[k]) && perSave[k] !== saveModInForce).map((k) =>
    loc("stats.saveFor", { save: saveLabel(k), value: signed(perSave[k]) }),
  );
  const savePaths = ["system.save.mod", ...SAVE_KEYS.map((k) => `system.saves.${saveSystemKey(k)}.value`)];
  const surpriseOthersNow = inForceFigure(surpriseOthers, num(sys.surprise?.surpriseothers));
  const avoidSurpriseNow = inForceFigure(avoidSurprise, num(sys.surprise?.avoidsurprise));
  return {
    saves: SAVE_KEYS.map((k) => ({ key: k, label: saveLabel(k), value: num(stored.saves?.[saveSystemKey(k)]?.value), path: `system.saves.${saveSystemKey(k)}.value` })),
    saveMod: saveModStored,
    saveModNow: { value: saveFigure.value, tip: withLines(saveFigure.tip, [...further, ...typedLines(actor, savePaths, "save", typed)]) },
    adventuring: ADVENTURING_KEYS.map((k) => ({ key: k, label: game.i18n.localize(`ACKS.adventuring.${k}`), value: num(stored.adventuring?.[k]), path: `system.adventuring.${k}` })),
    initiativeMod: num(stored.initiative?.mod),
    initiative,
    initiativeTip,
    surpriseOthers,
    surpriseOthersNow,
    avoidSurprise,
    avoidSurpriseNow: { ...avoidSurpriseNow, tip: withLines(avoidSurpriseNow.tip, typedLines(actor, ["system.surprise.avoidsurprise"], "surprise", typed)) },
    healingRate: String(stored.hp?.bhr ?? ""),
    morale: carriesMorale(actor) ? { value: num(stored.details?.morale) } : null,
  };
}

/**
 * One light's vision row: how far it reaches, from the imported light table,
 * with the page it was read from as the tooltip. Until the table is imported
 * the row says so and shows no figure.
 */
export function lightRow(key) {
  const icon = LIGHT_ICONS[key] ?? LIGHT_ICONS.torch;
  const label = loc(`vision.${key}`);
  const dim = lightFigures(key).dim;
  if (dim == null) return { icon, label, value: "", note: loc("vision.notImported"), tip: loc("vision.notImportedTip") };
  const cite = lightCite();
  return { icon, label, value: `${dim}′`, tip: cite ? loc("vision.lightTip", { cite }) : loc("vision.lightTipJudge") };
}

/**
 * The reach cell of the dark sense a character sees by: its radius with the
 * page the shadowy senses' radius was read from as the tooltip, or, with no
 * radius imported, a "not imported" note and no figure in its place.
 */
function senseReach(profile, kind) {
  if (profile.sightRange == null) return { value: "", note: loc("vision.notImported"), tip: loc("vision.senseNotImportedTip") };
  const value = `${num(profile.sightRange)}′`;
  if (kind !== "shadowy") return { value, note: "" };
  const cite = senseCite("shadowy");
  return { value, note: "", tip: cite ? loc("vision.senseTip", { cite }) : loc("vision.senseTipJudge") };
}

/**
 * One armour-training ability's line under the armour rungs: the rungs it
 * adds, its step times its rank, with the parts and the page the import read
 * as the tooltip. With no step imported the line says so and shows no figure.
 */
export function armourStepRow({ name, step, rank, steps, cite }) {
  if (step == null) return { label: name, value: "", note: loc("stats.armourStepNotImported"), tip: loc("stats.armourStepNotImportedTip") };
  const parts = { step: num(step), rank: num(rank), steps: signed(num(steps)) };
  return { label: name, value: signed(num(steps)), tip: cite ? loc("stats.armourStepTip", { ...parts, cite }) : loc("stats.armourStepTipRow", parts) };
}

/** Build the tab's data. */
export function buildStatsTab(actor, { openBuckets = new Set(), editing = false, view = TRAINING_VIEWS[0].key } = {}) {
  const sys = actor.system ?? {};
  // Every input below renders `stored`; every figure it does not edit, `sys`.
  const stored = storedSystem(actor);
  const strips = profileStrips(actor);
  const scores = Object.keys(ATTRIBUTES).map((key) => ({
    key,
    label: ATTRIBUTES[key].label,
    long: game.i18n.localize(`ACKS.scores.${key}.long`),
    value: num(stored.scores?.[key]?.value),
    // Not `mod`: the system registers a Handlebars helper of that name, and a
    // bare `{{mod}}` in a template calls the helper instead of reading the field.
    modLabel: signed(num(sys.scores?.[key]?.mod)),
  }));

  const editable = !!actor.isOwner;
  editing = editable && !!editing;
  // The explainers never decide, so they never get to kill the sheet: a throw
  // in either leaves the pills lit by the profile's own answer, unannotated.
  let prov = { weapons: [], armour: [], styles: [] };
  let edited = { weapons: new Set(), armour: new Set(), styles: new Set(), known: false };
  try {
    prov = trainingProvenance(actor);
    edited = editedSlots(actor);
  } catch (err) {
    console.error("acks-extras | training provenance failed; the pills stand unannotated", err);
  }
  const styleKey = (t) => norm(String(t).split(":")[0]);
  const styles = strips.styles.map((s) =>
    annotate({ ...s, token: s.key }, prov.styles, (t) => styleKey(t) === s.key, { editing, edited: edited.styles.has(s.key) }),
  );

  const rank = (t) => SLOT_VOCAB.armour.findIndex((a) => a.key === norm(t));
  const classCeiling = rank(classTraining(actor).armour);
  const rungs = strips.armour
    .filter((a) => a.key !== "shield")
    .map((a, i) =>
      annotate(
        { ...a, token: a.key },
        prov.armour,
        (t) => (/^[+-]?\d+$/.test(String(t).trim()) ? i > classCeiling : rank(t) >= i),
        { editing, edited: edited.armour.has(a.key) },
      ),
    );
  const shieldStrip = strips.armour.find((a) => a.key === "shield");
  const shield = shieldStrip
    ? {
        ...annotate({ ...shieldStrip, token: "shield" }, prov.styles, (t) => styleKey(t) === "weaponshield", { editing, edited: edited.styles.has("weaponshield") }),
        tooltip: [shieldStrip.label, loc("stats.shieldTip")].join(" · "),
      }
    : null;

  const unarmed = strips.weapons.find((w) => w.key === "unarmed") ?? null;
  const currentView = TRAINING_VIEWS.find((v) => v.key === view) ?? TRAINING_VIEWS[0];
  const training = {
    any: strips.any,
    editable,
    editing,
    hasEffect: hasTraining(actor),
    view: currentView.key,
    viewLabel: game.i18n.localize(currentView.label),
    styles,
    unarmed: unarmed ? { ...unarmed, tooltip: unarmed.label } : null,
    groups: weaponGroups(actor, strips, { view: currentView.key, openBuckets, editing, prov, edited }),
    shortcuts: editing ? shortcutsOrNone(actor) : { imported: true, rows: [] },
    rungs,
    shield,
    armourSteps: armourTrainingRows(actor).map(armourStepRow),
    armourMaxLabel: (() => {
      const max = armorMax(actor);
      return max ? game.i18n.localize(`ACKS-LIB.armour.${max}`) : "";
    })(),
    source: trainingSourceName(actor),
    hasPrinted: edited.known,
    anyEdited: edited.weapons.size + edited.armour.size + edited.styles.size > 0,
  };

  // Computed speeds render disabled and submit nothing; typed ones are inputs.
  const moveAuto = !!sys.config?.movementAuto;
  const movement = {
    auto: moveAuto,
    rows: MOVE_MODES.map((m) => ({
      key: m.key,
      icon: m.icon,
      label: game.i18n.localize(`ACKS.movement.${m.key}`),
      value: num((moveAuto ? sys : stored).movementacks?.[m.key]),
      unit: loc(`unit.${m.unit}`),
      path: `system.movementacks.${m.key}`,
    })),
  };

  const profile = senseProfile(actor);
  const senseKind = profile.seesInDark ? (profile.visionMode === VISION_MODES.SHADOWY ? "shadowy" : "lightless") : null;
  const reach = senseReach(profile, senseKind);
  const vision = [
    { icon: LIGHT_ICONS.day, label: loc("vision.daylight"), value: "∞" },
    { icon: LIGHT_ICONS.dark, label: loc("vision.dark"), ...(profile.seesInDark ? reach : { value: "0′", note: loc("vision.darkNote") }) },
    ...Object.keys(LIGHT_SOURCES).map((key) => lightRow(key)),
    { icon: LIGHT_ICONS.shadowy, label: loc("vision.shadowy"), ...(senseKind === "shadowy" ? reach : { value: "0′" }) },
    { icon: LIGHT_ICONS.lightless, label: loc("vision.lightless"), ...(senseKind === "lightless" ? reach : { value: "0′", note: loc("vision.lightlessNote") }) },
  ];

  const acTip = acTips(actor, sys, stored, typedFor(actor));
  // The maximum's provenance (classes `hitPointAuditText`); a throw there leaves
  // the field without it rather than the tab unrendered.
  let hpAudit = null;
  try {
    hpAudit = hitPointAuditText(actor);
  } catch (err) {
    console.error("acks-extras | hit point record could not be read; the maximum stands without it", err);
  }
  const vitals = {
    hp: { value: num(stored.hp?.value), max: num(stored.hp?.max), audit: hpAudit },
    hd: String(stored.hp?.hd ?? ""),
    ac: [
      { icon: "fa-solid fa-shield-halved", label: loc("vitals.acShield"), value: num(sys.ac?.value), tip: acTip.shield, shown: num(sys.ac?.shield) > 0 },
      { icon: "fa-solid fa-shirt", label: loc("vitals.acArmour"), value: num(sys.ac?.value) - num(sys.ac?.shield), tip: acTip.armour, shown: true },
      { icon: "fa-regular fa-square", label: loc("vitals.acNaked"), value: num(sys.ac?.naked), tip: acTip.naked, shown: true },
    ].filter((r) => r.shown),
    acMod: num(stored.ac?.mod),
    cleaves: num(stored.fight?.cleaves),
    mortalWounds: num(stored.fight?.mortalwounds),
    attackThrow: num(stored.attack?.throw, 10),
  };

  const throws = buildThrows(actor);

  const retainer = sys.retainer?.enabled
    ? {
        wage: String(stored.retainer?.wage ?? ""),
        loyalty: num(stored.retainer?.loyalty),
        category: String(sys.retainer.category ?? ""),
        employer: actor.getManagerName?.() ?? "",
      }
    : null;

  return { scores, training, movement, vision, vitals, throws, retainer, editable, isNew: !!sys.isNew };
}
