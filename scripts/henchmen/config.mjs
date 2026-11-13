/**
 * Pure-data rarity tiers and name-presence patterns. No Foundry imports —
 * importable from Node tooling (tools/build-packs.mjs) and tests.
 */

/** Class rarity tiers (JJ 118), best → worst availability. */
export const RARITY_TIERS = Object.freeze([
  "ubiquitous",
  "common",
  "uncommon",
  "rare",
  "veryRare",
  "extremelyRare",
  "legendary",
]);

/**
 * Item-name regexes that prove a domain's power is PRESENT and nothing more:
 * the power's size is read from the page by the importer (a typed effect on
 * the ability) or set by a Judge's Active Effect, never supplied here. An
 * item matched only by its name makes `hasEffectFlag` true and contributes no
 * modifier, and `unvaluedPowers` names it so a surface can say its value is
 * missing. For a domain with no value (`skipCalamityLoyalty`), presence is the
 * whole of the power.
 */
export const NAME_PRESENCE = Object.freeze({
  hiring: "^diplomacy|^intimidation|^mystic aura|^seduction|^command of voice|^glamorous aura",
  retainBonus: "^leadership|^blood of (ancient )?kings|^scion of kings|^soul of the dragon|^familial loyalty",
  baseLoyalty: "^blood of (ancient )?kings|^scion of kings|^soul of the dragon|^familial loyalty",
  henchmanMorale:
    "^command$|^command \\(|^battlefield prowess|^animal magnetism|^chronicles of battle|^holy fervor|^unholy fanaticism|^dark charisma|^experience and hardiness",
  marketClass: "^mercantile network",
  skipCalamityLoyalty: "^utter domination",
});
