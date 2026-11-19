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
/** The chat-message flag a concentration-ended card carries (`cast-held.mjs`). */
export const CAST_HELD_END_FLAG = "castHeldEnd";
/** The handler on lib's sockets through which a seat hands the records it cannot write to the GM's client when a held cast ends. */
export const HELD_END_HANDLER = "magicHeldEnd";
/** The handler on lib's sockets through which a seat has the GM's client set or clear a combatant's declared-spell flag. */
export const DECLARE_FLAG_HANDLER = "magicDeclareFlag";
/** The handler on lib's sockets through which a seat has the GM's client strip a lost item from the declared answers it could not write. */
export const LOST_ITEM_HANDLER = "magicLostItem";
/** Flag key under flags["acks-extras"] on an actor holding its power ledger (`power-ledger.mjs`). */
export const FLAG_POWER = "power";
/** The handler on lib's sockets through which a seat has the GM's client write a power ledger it cannot. */
export const POWER_HANDLER = "magicPower";
/** Flag key under flags["acks-extras"] on a location actor holding its research record (`research-project.mjs`). */
export const FLAG_MAGIC = "magic";
/** The handler on lib's sockets through which a seat has the GM's client write a research record it cannot. */
export const PROJECT_HANDLER = "magicProject";
/** Key under flags["acks-extras"].magic on a caster holding the open blood sacrifice's shared record (`sacrifice-record.mjs`). */
export const FLAG_SACRIFICE = "sacrifice";
/** The handler on lib's sockets through which a seat has the GM's client mark a blood sacrifice's victims dead, a write a Player's seat lacks, and write the open sacrifice's shared record (a request carrying an `op`). */
export const SACRIFICE_HANDLER = "magicSacrifice";
