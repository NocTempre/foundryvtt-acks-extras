/* global game */
/**
 * The Stats tab's data: what is not a throw. The six attributes (checks are
 * not rolls in ACKS II, so no die), the training as the most explicit list
 * the grammar allows — every style, every weapon of the equipment table as
 * its own pill under whichever organisation the viewer chose, every armour
 * rung and the shield — each pill saying where it came from and whether a hand
 * moved it off what the class prints; movement by mode, vision light by
 * light, the vitals, and the throw targets the Rolls tab reads (this is the
 * pen; Rolls is the gauge).
 */
import { LANG, SAVE_KEYS, ADVENTURING_KEYS, MOVE_MODES, LIGHT_ICONS } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { profileStrips, SLOT_VOCAB } from "../../lib/proficiency-strip.mjs";
import { EFFECT_DOMAINS } from "../../equipment/constants.mjs";
import { weaponProficiency, isWeaponProficient, armorMax, grantMatches } from "../../equipment/proficiency.mjs";
import { focusGroup } from "../../equipment/profiles.mjs";
import { collectStringFlags } from "../../equipment/effects.mjs";
import { TRAINING_VIEWS, arrangeUnits } from "../../equipment/training-view.mjs";
import { trainingSourceName, trainingProvenance, editedSlots, classTraining, hasTraining } from "../../classes/training.mjs";
import { LIGHT_SOURCES } from "../../lib/light.mjs";
import { senseProfile, VISION_MODES } from "../../lib/senses.mjs";
import { ATTRIBUTES } from "../../lib/vocab.mjs";
import { signed } from "../view-model.mjs";
import { saveSystemKey, saveLabel } from "../snapshot.mjs";

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

/** The weapon list: every unit once, under the view's groups. */
function weaponGroups(actor, strips, { view, openBuckets, editing, prov, edited }) {
  const prof = weaponProficiency(actor);
  const focus = new Set([...collectStringFlags(actor, EFFECT_DOMAINS.WEAPON_FOCUS)].map(norm));
  const configured = strips.weapons.some((w) => !w.unset);
  const unitOn = (u) => (configured && !prof.all ? isWeaponProficient(actor, u.profile, prof) : configured && prof.all);
  return arrangeUnits(view).map((g) => {
    const members = g.members.map((u) => {
      const group = focusGroup(u.profile);
      const pill = { key: u.key, token: u.token, label: u.name, icon: u.icon, on: unitOn(u), gold: !!group && focus.has(norm(group)), unset: !configured };
      return annotate(pill, prov.weapons, (t) => grantMatches(t, u.profile), { editing, edited: edited.weapons.has(u.key) });
    });
    const lit = members.filter((m) => m.on);
    const head = {
      key: g.key,
      token: g.token,
      label: game.i18n.localize(g.label),
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

/** Build the tab's data. */
export function buildStatsTab(actor, { openBuckets = new Set(), editing = false, view = TRAINING_VIEWS[0].key } = {}) {
  const sys = actor.system ?? {};
  const strips = profileStrips(actor);
  const scores = Object.keys(ATTRIBUTES).map((key) => ({
    key,
    label: ATTRIBUTES[key].label,
    long: game.i18n.localize(`ACKS.scores.${key}.long`),
    value: num(sys.scores?.[key]?.value),
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
    rungs,
    shield,
    armourMaxLabel: (() => {
      const max = armorMax(actor);
      return max ? game.i18n.localize(`ACKS-LIB.armour.${max}`) : "";
    })(),
    source: trainingSourceName(actor),
    hasPrinted: edited.known,
    anyEdited: edited.weapons.size + edited.armour.size + edited.styles.size > 0,
  };

  const movement = {
    auto: !!sys.config?.movementAuto,
    rows: MOVE_MODES.map((m) => ({
      key: m.key,
      icon: m.icon,
      label: game.i18n.localize(`ACKS.movement.${m.key}`),
      value: num(sys.movementacks?.[m.key]),
      unit: loc(`unit.${m.unit}`),
      path: `system.movementacks.${m.key}`,
    })),
  };

  const profile = senseProfile(actor);
  const senseKind = profile.seesInDark ? (profile.visionMode === VISION_MODES.SHADOWY ? "shadowy" : "lightless") : null;
  const vision = [
    { icon: LIGHT_ICONS.day, label: loc("vision.daylight"), value: "∞" },
    { icon: LIGHT_ICONS.dark, label: loc("vision.dark"), value: profile.seesInDark ? `${num(profile.sightRange)}′` : "0′", note: profile.seesInDark ? "" : loc("vision.darkNote") },
    ...Object.entries(LIGHT_SOURCES).map(([key, cfg]) => ({ icon: LIGHT_ICONS[key] ?? LIGHT_ICONS.torch, label: loc(`vision.${key}`), value: `${cfg.dim}′` })),
    { icon: LIGHT_ICONS.shadowy, label: loc("vision.shadowy"), value: senseKind === "shadowy" ? `${num(profile.sightRange)}′` : "0′" },
    { icon: LIGHT_ICONS.lightless, label: loc("vision.lightless"), value: senseKind === "lightless" ? `${num(profile.sightRange)}′` : "0′", note: senseKind === "lightless" ? "" : loc("vision.lightlessNote") },
  ];

  const vitals = {
    hp: { value: num(sys.hp?.value), max: num(sys.hp?.max) },
    hd: String(sys.hp?.hd ?? ""),
    ac: [
      { icon: "fa-solid fa-shield-halved", label: loc("vitals.acShield"), value: num(sys.aac?.value), shown: num(sys.aac?.shield) > 0 },
      { icon: "fa-solid fa-shirt", label: loc("vitals.acArmour"), value: num(sys.aac?.value) - num(sys.aac?.shield), shown: true },
      { icon: "fa-regular fa-square", label: loc("vitals.acNaked"), value: num(sys.aac?.naked), shown: true },
    ].filter((r) => r.shown),
    acMod: num(sys.aac?.mod),
    cleaves: num(sys.fight?.cleaves),
    mortalWounds: num(sys.fight?.mortalwounds),
    attackThrow: num(sys.thac0?.throw, 10),
  };

  const throws = {
    saves: SAVE_KEYS.map((k) => ({ key: k, label: saveLabel(k), value: num(sys.saves?.[saveSystemKey(k)]?.value), path: `system.saves.${saveSystemKey(k)}.value` })),
    saveMod: num(sys.save?.mod),
    adventuring: ADVENTURING_KEYS.map((k) => ({ key: k, label: game.i18n.localize(`ACKS.adventuring.${k}`), value: num(sys.adventuring?.[k]), path: `system.adventuring.${k}` })),
    initiativeMod: num(sys.initiative?.mod),
    initiative: signed(num(sys.initiative?.value)),
    surpriseOthers: num(sys.surprise?.surpriseothers),
    avoidSurprise: num(sys.surprise?.avoidsurprise),
    healingRate: String(sys.hp?.bhr ?? ""),
  };

  const retainer = sys.retainer?.enabled
    ? {
        wage: String(sys.retainer.wage ?? ""),
        morale: num(sys.details?.morale),
        loyalty: num(sys.retainer.loyalty),
        category: String(sys.retainer.category ?? ""),
        employer: actor.getManagerName?.() ?? "",
      }
    : null;

  return { scores, training, movement, vision, vitals, throws, retainer, editable, isNew: !!sys.isNew };
}
