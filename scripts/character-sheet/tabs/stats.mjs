/* global game */
/**
 * The Stats tab's data: what is not a throw. The six attributes (checks are
 * not rolls in ACKS II, so no die), the training as the most explicit list
 * the vocabulary allows — every style, every weapon class opened to the
 * weapons the equipment table files under it, the heaviest armour rung —
 * movement by mode, vision light by light, the vitals, and the throw targets
 * the Rolls tab reads (this is the pen; Rolls is the gauge).
 */
import { LANG, SAVE_KEYS, ADVENTURING_KEYS, MOVE_MODES, LIGHT_ICONS } from "../constants.mjs";
import { makeLoc, locOr } from "../../lib/util.mjs";
import { profileStrips, SLOT_VOCAB } from "../../lib/proficiency-strip.mjs";
import { WEAPONS } from "../../equipment/config.mjs";
import { EFFECT_DOMAINS } from "../../equipment/constants.mjs";
import { weaponProficiency, isWeaponProficient, armorMax } from "../../equipment/proficiency.mjs";
import { focusGroup } from "../../equipment/profiles.mjs";
import { collectStringFlags } from "../../equipment/effects.mjs";
import { trainingSourceName } from "../../classes/training.mjs";
import { LIGHT_SOURCES } from "../../lib/light.mjs";
import { senseProfile, VISION_MODES } from "../../lib/senses.mjs";
import { ATTRIBUTES } from "../../lib/vocab.mjs";
import { signed } from "../view-model.mjs";
import { saveSystemKey, saveLabel } from "../snapshot.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** A weapon key as a name: the table's keys are run-together words. */
const WEAPON_NAMES = Object.freeze({
  battleaxe: "Battle axe", greataxe: "Great axe", handaxe: "Hand axe", compositebow: "Composite bow", longbow: "Long bow",
  shortbow: "Short bow", morningstar: "Morning star", warhammer: "War hammer", shortsword: "Short sword",
  twohandedsword: "Two-handed sword", silverdagger: "Silver dagger", staffsling: "Staff sling", militaryoil: "Military oil",
  holywater: "Holy water",
});
const weaponName = (key) => WEAPON_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

/** Every weapon class as a bucket opened to its weapons, lit by the attack roll's own test. */
function weaponBuckets(actor, strips) {
  const prof = weaponProficiency(actor);
  const focus = new Set([...collectStringFlags(actor, EFFECT_DOMAINS.WEAPON_FOCUS)].map(norm));
  const configured = strips.weapons.some((w) => !w.unset);
  return SLOT_VOCAB.weapons
    .filter((cls) => cls.key !== "unarmed")
    .map((cls) => {
      const strip = strips.weapons.find((w) => w.key === cls.key) ?? {};
      const weapons = Object.entries(WEAPONS)
        .filter(([, w]) => norm(w.cat) === cls.key)
        .map(([key, w]) => {
          const profile = { ...w, key };
          const group = focusGroup(profile);
          return {
            key,
            name: weaponName(key),
            on: configured && !prof.all ? isWeaponProficient(actor, profile, prof) : configured && prof.all,
            gold: !!group && focus.has(norm(group)),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        key: cls.key,
        label: locOr(cls.label, cls.fallback),
        on: !!strip.on,
        gold: !!strip.gold,
        unset: !!strip.unset,
        weapons,
      };
    });
}

/** Build the tab's data. */
export function buildStatsTab(actor, { openBuckets = new Set() } = {}) {
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

  const armourRank = strips.armour.reduce((best, a, i) => (a.on ? i : best), -1);
  const max = armorMax(actor);
  const training = {
    any: strips.any,
    styles: strips.styles,
    weaponsAll: strips.weapons.length > 1 && strips.weapons.filter((w) => w.key !== "unarmed").every((w) => w.on),
    buckets: weaponBuckets(actor, strips).map((b) => ({ ...b, open: openBuckets.has(b.key) })),
    armour: armourRank >= 0 ? strips.armour[armourRank] : null,
    armourMaxLabel: max ? locOr(`ACKS-LIB.armour.${max}`, max) : "",
    source: trainingSourceName(actor),
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

  return { scores, training, movement, vision, vitals, throws, retainer, editable: actor.isOwner, isNew: !!sys.isNew };
}
