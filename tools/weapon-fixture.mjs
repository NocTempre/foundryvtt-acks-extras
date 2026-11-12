/**
 * The weapon rows the suites run against: invented.
 *
 * The module ships no weapon table, so a suite that classifies a weapon has to
 * bring its rows. These stand in for an import. The names are the common words
 * a weapon is called by, because the readers identify a weapon by name; every
 * figure (die, size, quality, damage type) is made up for the suite, chosen for
 * what the checks exercise (a tiny thrown weapon, a versatile one, a two-handed
 * one, a launcher) and read from no book. A check pins these figures, never a
 * printed one.
 *
 * `useWeaponFixture()` registers a source over the rows, the lists that place a
 * pick on a category and a Weapon Focus group, and the spellings; it returns the
 * function that puts the previous source back.
 */
import { registerWeaponSource } from "../scripts/lib/weapons.mjs";
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";
import { librarySource } from "../scripts/equipment/weapon-source.mjs";

/** One row in the shape the weapon readers read. */
const row = (name, size, uses, damage, type, cat, extra = {}) => ({
  name,
  size,
  melee: uses.includes("m"),
  missile: uses.includes("r"),
  thrown: uses.includes("t"),
  handy: !!extra.handy,
  damage,
  type,
  cat,
  special: extra.special ?? [],
  ...(extra.damage2h ? { damage2h: extra.damage2h } : {}),
  twoHandedForced: !!extra.twoHandedForced,
  ...(extra.throwable ? { throwable: extra.throwable } : {}),
});

/** The invented rows, keyed as the readers key them: the name, run together. */
export const FIXTURE_ROWS = Object.freeze({
  arbalest: row("Arbalest", "medium", "r", "1d11", "piercing", "bowCrossbow", { handy: true, special: ["slow"] }),
  crossbow: row("Crossbow", "small", "r", "1d9", "piercing", "bowCrossbow", { handy: true, special: ["slow"] }),
  compositebow: row("Composite Bow", "medium", "r", "1d9", "piercing", "bowCrossbow"),
  longbow: row("Long Bow", "large", "r", "1d9", "piercing", "bowCrossbow"),
  shortbow: row("Short Bow", "small", "r", "1d9", "piercing", "bowCrossbow"),
  battleaxe: row("Battle Axe", "medium", "m", "1d9", "slashing", "axe", { damage2h: "1d11" }),
  greataxe: row("Great Axe", "large", "m", "1d13", "slashing", "axe"),
  handaxe: row("Hand Axe", "small", "mt", "1d9", "slashing", "axe", { special: ["thrown"] }),
  club: row("Club", "tiny", "m", "1d5", "bludgeoning", "other"),
  flail: row("Flail", "medium", "m", "1d9", "bludgeoning", "flailHammerMace", { damage2h: "1d11" }),
  mace: row("Mace", "medium", "m", "1d9", "bludgeoning", "flailHammerMace", { damage2h: "1d11" }),
  warhammer: row("War Hammer", "small", "mt", "1d9", "bludgeoning", "flailHammerMace", { special: ["thrown"] }),
  dagger: row("Dagger", "tiny", "mt", "1d5", "piercing", "swordDagger", { special: ["thrown"] }),
  silverdagger: row("Silver Dagger", "tiny", "mt", "1d5", "piercing", "swordDagger", { special: ["thrown", "silver"] }),
  shortsword: row("Short Sword", "small", "m", "1d9", "slashing", "swordDagger"),
  sword: row("Sword", "medium", "m", "1d9", "slashing", "swordDagger", { damage2h: "1d11" }),
  twohandedsword: row("Two-Handed Sword", "large", "m", "1d13", "slashing", "swordDagger"),
  dart: row("Dart", "tiny", "rt", "1d5", "piercing", "spearPolearm", { handy: true, special: ["thrown"] }),
  javelin: row("Javelin", "small", "mt", "1d9", "piercing", "spearPolearm", { special: ["thrown"] }),
  polearm: row("Polearm", "large", "m", "1d13", "slashing", "spearPolearm", { special: ["long"] }),
  spear: row("Spear", "medium", "mt", "1d9", "piercing", "spearPolearm", { damage2h: "1d11", special: ["long", "thrown"] }),
  bola: row("Bola", "small", "rt", "1d3", "bludgeoning", "other", { handy: true, special: ["entangling", "thrown"] }),
  net: row("Net", "medium", "mt", "", "", "other", { twoHandedForced: true, special: ["entangling", "thrown"] }),
  rock: row("Rock", "medium", "rt", "1d5", "bludgeoning", "other", { handy: true, special: ["thrown"] }),
  sling: row("Sling", "small", "r", "1d5", "bludgeoning", "other", { handy: true }),
  staff: row("Staff", "medium", "m", "1d5", "bludgeoning", "other", { damage2h: "1d7" }),
  staffsling: row("Staff-Sling", "medium", "mr", "1d5", "bludgeoning", "other", { damage2h: "1d7", twoHandedForced: true }),
  whip: row("Whip", "small", "m", "1d3", "slashing", "other", { special: ["flexible"] }),
  militaryoil: row("Military Oil", "small", "rt", "1d9", "fire", "other", {
    handy: true,
    special: ["thrown", "splash", "noDamageBonus"],
    throwable: { kind: "oil" },
  }),
  holywater: row("Holy Water", "small", "rt", "1d9", "holy", "other", {
    handy: true,
    special: ["thrown", "splash", "consumable", "noDamageBonus"],
    throwable: { kind: "holyWater" },
  }),
  torch: row("Torch", "small", "mt", "1d5", "fire", "other", {
    special: ["thrown", "noDamageBonus", "light"],
    throwable: { kind: "torch" },
  }),
});

/** The Weapon Focus groups of the invented lists: key to the keys filed under it. */
export const FIXTURE_FOCUS = Object.freeze({
  axes: ["battleaxe", "greataxe", "handaxe"],
  macesflailshammers: ["flail", "mace", "warhammer"],
  swordsdaggers: ["dagger", "silverdagger", "shortsword", "sword", "twohandedsword"],
  bowscrossbows: ["compositebow", "longbow", "shortbow", "crossbow", "arbalest"],
  slingsthrown: ["sling", "staffsling", "bola", "dart", "rock", "militaryoil", "holywater"],
  spearspolearms: ["javelin", "polearm", "spear"],
});

/** The invented lists document: which nouns place a pick on a category and on a focus group. */
const LISTS = Object.freeze({
  id: "weaponLists",
  tables: {
    category: {
      swordDagger: ["sword", "dagger"],
      axe: ["axe"],
      flailHammerMace: ["flail", "hammer", "mace"],
      spearPolearm: ["spear", "polearm"],
      bowCrossbow: ["bow", "crossbow"],
    },
    focus: {
      axes: ["axe"],
      macesflailshammers: ["flail", "hammer", "mace"],
      swordsdaggers: ["sword", "dagger"],
      bowscrossbows: ["bow", "crossbow"],
      slingsthrown: ["sling", "thrown"],
      spearspolearms: ["spear", "polearm"],
    },
  },
});

/** The source over the invented rows. */
export const fixtureSource = Object.freeze({
  rows: FIXTURE_ROWS,
  aliases: librarySource.aliases,
  focusGroups: FIXTURE_FOCUS,
  throwsAsAnyone: librarySource.throwsAsAnyone,
});

/**
 * Register the invented rows and lists.
 * @returns {() => void} puts back the source that was registered before, and
 *   drops the lists.
 */
export function useWeaponFixture() {
  const before = registerWeaponSource(fixtureSource);
  registerTable(LISTS, { priority: PRIORITY.WORLD, source: "weapon-fixture" });
  return () => {
    registerWeaponSource(before);
    unregisterTable(LISTS.id, { priority: PRIORITY.WORLD });
  };
}
