export { MODULE_ID } from "../lib/constants.mjs";

/** Lang root for this feature's own keys. */
export const LANG_PREFIX = "ACKS-MAGIC";


/** The core `spell` item type this feature extends. */
export const SPELL_TYPE = "spell";
/** Flag key under flags["acks-extras"] holding the spell primitive. */
export const FLAG_SPELL = "spell";
/** Flag key under flags["acks-extras"] on an Active Effect a cast left behind. */
export const FLAG_SPELL_EFFECT = "spellEffect";
/** The capability every spell record's roll-mod part provides, so two spell records never add (`lib/roll-mods.mjs`). */
export const SPELL_RECORD_CAP = "kw:spellrecord";
