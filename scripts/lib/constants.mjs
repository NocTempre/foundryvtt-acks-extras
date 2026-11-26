/** This module's id, the key of its flag scope and the prefix of its sub-types. */
export const MODULE_ID = "acks-extras";

/** The picture the importer gives an item it mints with no picture of its own; a surface that draws an item reads it as "no picture". */
export const MINTED_ITEM_IMG = "icons/containers/bags/sack-leather-tan.webp";

/** The root of the lib subsystem's lang keys. */
export const LANG_PREFIX = "ACKS-LIB";

/**
 * Flag key under `flags["acks-extras"]` holding the gear model (slots, worn
 * location, retrieval cost). Declared here rather than beside the DataModel
 * because the pure predicates in `item-model.mjs` read the flag without ever
 * instantiating the model, and both must name it once.
 */
export const FLAG_GEAR = "gear";

/**
 * Flag key under `flags["acks-extras"]` on an Active Effect holding the roll
 * modifiers the record carries (`roll-mods.mjs`): `{id, label, cite,
 * sourceAlignment, parts}`. Named here because the feature that writes it and
 * the library that reads it at the roll both name it.
 */
export const FLAG_ROLL_MODS = "rollMods";

/**
 * Flag key under `flags["acks-extras"]` on an Active Effect that lasts a number
 * of one combatant's turns inside one fight (`turn-life.mjs`): `{combatId,
 * combatantId, edge, count, seen}`. Named here because the feature that writes
 * the record and the tracker that lifts it both name it.
 */
export const FLAG_TURN_LIFE = "turnLife";

/**
 * Flag key under `flags["acks-extras"]` on an Active Effect that holds damage
 * to land on its bearer after a count of its turns (`delayed-damage.mjs`):
 * `{combatId, combatantId, edge, count, seen, amount|formula, source, cite}`, or
 * `{dueAt, amount|formula, source, cite}` on the world clock.
 * Its own key and never `FLAG_TURN_LIFE`: the tracker deletes a turn-life record
 * as it comes due, before anything could apply the damage.
 */
export const FLAG_DELAYED_DAMAGE = "delayedDamage";

/**
 * Token flag opting a token out of every automatic resize. Named here because
 * the battlemap's sizer reads it and the group deploy that remembers a hand's
 * size writes it.
 */
export const FLAG_FOOTPRINT_LOCK = "footprintLock";

/**
 * Token flag `{width, height}`: the size the module last wrote to the token,
 * stamped in the same write. A stored size that differs from both the
 * prototype's and this stamp is a hand's, which a gather remembers. It blocks
 * nothing; `FLAG_FOOTPRINT_LOCK` alone does.
 */
export const FLAG_SIZE_STAMP = "sizeStamp";

/**
 * Flag key under `flags["acks-extras"]` on an Active Effect that ends when its
 * bearer does something (`ends-on.mjs`): a list of causes, `damage` and
 * `attack`. Named here because the feature that writes the record and the
 * tracker's loss hooks that end it both name it.
 */
export const FLAG_ENDS_ON = "endsOn";

/**
 * The actor sub-types this library adds to the system. Named here, in the
 * one Foundry-free constants file, so a pure-logic module (and the Node test
 * harness that loads it) can import them without pulling in the sheets and
 * models that register them.
 */
export const ANIMAL_TYPE = `${MODULE_ID}.animal`;

/** The actor sub-type of a group, a stack of creatures kept on one actor. */
export const GROUP_TYPE = `${MODULE_ID}.group`;

/** The actor sub-type of a template, the generator that stamps out creatures. */
export const TEMPLATE_TYPE = `${MODULE_ID}.template`;

/** The lang root of the group actor's strings. */
export const GROUP_LANG_PREFIX = `${LANG_PREFIX}.group`;
/** The lang root of a lair's strings. */
export const LAIR_LANG_PREFIX = `${LANG_PREFIX}.lair`;
/** The lang root of the organisation chart's strings. */
export const ORG_LANG_PREFIX = `${LANG_PREFIX}.org`;
/** The Item sub-type a variation document is — one way an item differs from its plain self. */
export const VARIATION_TYPE = `${MODULE_ID}.variation`;

/**
 * The token create option that keeps the hit points the token's data carries
 * over the roll the system gives an unlinked monster token as it is created
 * (hp-logic.mjs, `keepsOwnHitPoints`). A caller making a token for a creature
 * it already holds passes it.
 */
export const KEEP_HIT_POINTS_OPTION = `${MODULE_ID}.keepHitPoints`;

/**
 * The operation option an unattended create carries, under the module's own
 * key: `{ [MODULE_ID]: { unattended: true } }`. A create made without a seat
 * watching (an import) passes it, so a create hook that would open a dialog
 * for the new document stays silent. `unattendedOperation` builds it and
 * `isUnattended` reads it back off the options a hook receives.
 */
export const UNATTENDED_OPTION = "unattended";

/** The operation options for a create: the unattended marker when `unattended`, else none. */
export const unattendedOperation = (unattended) => (unattended ? { [MODULE_ID]: { [UNATTENDED_OPTION]: true } } : {});

/** Do these operation options mark the create as unattended? */
export const isUnattended = (options) => options?.[MODULE_ID]?.[UNATTENDED_OPTION] === true;

/** The prefix every custom hook this module fires is named under. */
const NAMESPACE = "acksExtras";

/**
 * Hooks the template generator fires. `RESOLVED` carries `{resolved,
 * template, type, choices}` once a generation's patches, items and flags are
 * merged and before the actor is written, so a feature may add what a
 * generated creature carries — the magic feature draws a repertoire onto a
 * slot block there — by mutating `resolved` in place.
 */
export const TEMPLATE_HOOKS = Object.freeze({
  RESOLVED: `${NAMESPACE}.templateResolved`,
});

/**
 * Fired with `(actor, ids, cause)` after states were taken off an actor because
 * of what it suffered: `ids` are the status ids lost, `cause` what cost them
 * (`damage`, `save` or `moved`). It does not fire when nothing was lost.
 */
export const STATES_LOST_HOOK = `${NAMESPACE}.statesLost`;

/**
 * Fired with `(combat, combatantId)` on the primary GM's client when a
 * combatant's turn begins: after the tracker has lifted what ends at that turn
 * (`turn-life.mjs` records and the conditions that end with a turn). A round
 * that opened before its initiative was rolled begins no turn until it is
 * rolled.
 */
export const TURN_BEGAN_HOOK = `${NAMESPACE}.turnBegan`;

/**
 * Fired with `(combat, combatantId)` on the primary GM's client when the
 * tracker leaves a combatant whose turn began: the round advanced or the turn
 * moved forward. The tracker re-sorting after an initiative roll and the Judge
 * stepping back end nothing. Records that end at that turn's end are already
 * lifted when it fires.
 */
export const TURN_ENDED_HOOK = `${NAMESPACE}.turnEnded`;

/**
 * Fired with `{summonerUuid, sceneId, tokenIds}` once a summoning's tokens are
 * on the scene, on the client that placed them (the GM's). A feature that
 * moves summons somewhere else, as the party does, listens; lib imports none.
 */
export const SUMMONS_PLACED_HOOK = `${NAMESPACE}.summonsPlaced`;

/**
 * The Region behavior sub-type of a live reach: config on a Region attached to
 * its bearer's token that says whose item raised it (`aura-reach.mjs`).
 */
export const AURA_BEHAVIOR_TYPE = `${MODULE_ID}.aura`;

/**
 * Fired with `(token, {cause})` on the primary GM's client once a bearer's
 * reaches were taken down because the bearer is down: `cause` is `hp` (hit
 * points at or below zero) or `defeated` (the defeated status landed). A
 * feature whose item breaks with its bearer keys on it.
 */
export const BEARER_DOWN_HOOK = `${NAMESPACE}.bearerDown`;

/**
 * Flag key under `flags["acks-extras"]` on an item that runs rows (`{activation,
 * rows}`) and on every Active Effect the item runner writes (`{source,
 * activationId, rowKey}`): `item-run.mjs`.
 */
export const FLAG_ITEM_RUN = "itemRun";

/**
 * Flag key under `flags["acks-extras"]` on a chat message that is an item
 * carrier's raised or prompt card (`item-run-card-logic.mjs` `newCard`): the
 * item, row and activation, the bearer, the subjects it lists and the `entries`
 * keyed by moment. Every key is free of dots, so a dotted update reaches one
 * entry. The GM's client reads a relayed press's entry state from it and writes
 * the entry back, so a press is held to what the card holds.
 */
export const FLAG_ITEM_RUN_CARD = "itemRunCard";

/**
 * Flag key under `flags["acks-extras"]` on the whispered save card: the raised
 * card's message id, the entry key and the subject it asks, so a press on it
 * writes the one entry the raised card holds.
 */
export const FLAG_ITEM_RUN_WHISPER = "itemRunWhisper";

/**
 * Flag key under `flags["acks-extras"]` on a condition record written outside a
 * fight: `{edge: "start"}`. Lib's turn start lifts it when the subject first
 * starts an initiative in a fight, as a record of a fight's clock is lifted
 * (`turn-life.mjs` `markLifts`).
 */
export const FLAG_TURN_MARK = "turnMark";

/**
 * The `rollKey` a morale part carries: a `reaction` part naming it is read on
 * a morale roll and never on a reaction roll, since `recordParts` sends a part
 * that names a roll to `pending` while its caller names none.
 */
export const MORALE_ROLL_KEY = "morale";

/**
 * Flag key under `flags["acks-extras"]` on an Active Effect of a bearer whose
 * item is burning toward a burst: `{source, activationId, spot, clock}`
 * (`item-run-logic.mjs`). Its own key and never `FLAG_TURN_LIFE`: the tracker
 * deletes a turn-life record before the burst could be dealt.
 */
export const FLAG_FUSE = "fuse";

/** Item flag key under `flags["acks-extras"]` of a consumable's drink figures: `{healDice, saveKind, condition, successHealDice, swigDice, ownKind}`. */
export const FLAG_DRINK = "drink";
