/* global foundry, game, CONFIG */
/**
 * The ACKS II "Follower Card" — the printed henchman/follower card, rendered as a
 * compact, theme-styled view of an actor.
 *
 * One layout serves two surfaces:
 *   - the editable FollowerCardSheet (a hireling's default sheet), and
 *   - the read-only cards the character sheet's hirelings tab is re-skinned into
 *     (acks-henchmen), where the SAME markup must emit no `name=` inputs — those
 *     would bind to the EMPLOYER's form — only the system's own hireling actions.
 *
 * Every derived number is precomputed HERE, in JS, so the template needs no system
 * Handlebars helper and one code path covers every actor that can be hired — the
 * system's `character` and `monster` and this module's `animal` alike (each carries
 * the same `retainer` schema, and the hire paths set `retainer.enabled`).
 *
 * WHICH FIELDS A CARD SHOWS IS DECIDED BY WHAT THE ACTOR'S DATA MODEL DECLARES,
 * never by `actor.type` — see `actorProvides` below. A rating the model does not carry
 * (a beast has no class, no ability scores, no encumbrance) is left out of the card
 * rather than read off a path that type does not have.
 */
import { toNum as num } from "./util.mjs";
import { MODULE_ID } from "./constants.mjs";
import { monsterHd } from "./actor-read.mjs";
import { isEquippable, isEquipped } from "./item-model.mjs";
import { attackOptionsFor, damageTypeLabel, DAMAGE_TYPE_ICONS, UNTYPED_ICON } from "./damage-type.mjs";
import { profileStrips, isProfileAbility, sizePips } from "./proficiency-strip.mjs";
import { ITEM_TYPE } from "./vocab.mjs";

export const FOLLOWER_CARD_TEMPLATE = `modules/${MODULE_ID}/templates/lib/follower-card.hbs`;

/** Printed-card ability order. "WIL" is the label; the system stores it as `wis`. */
const ABILITY_ROW = [
  { key: "str", label: "STR" },
  { key: "int", label: "INT" },
  { key: "wis", label: "WIL" },
  { key: "dex", label: "DEX" },
  { key: "con", label: "CON" },
  { key: "cha", label: "CHA" },
];

/** The character adventuring throws (RR 17), each rolled via actor.rollAdventuring. */
const ADVENTURING = [
  { key: "dungeonbashing", label: "ACKS.adventuring.dungeonbashing", icon: "fas fa-hammer" },
  { key: "climb", label: "ACKS.adventuring.climb", icon: "fas fa-mountain" },
  { key: "listening", label: "ACKS.adventuring.listening", icon: "fas fa-ear-listen" },
  { key: "searching", label: "ACKS.adventuring.searching", icon: "fas fa-magnifying-glass" },
  { key: "trapbreaking", label: "ACKS.adventuring.trapbreaking", icon: "fas fa-toolbox" },
];

const signed = (v) => {
  const n = num(v);
  return n >= 0 ? `+${n}` : `${n}`;
};

/** 1/6-stone weight → the stone figure the printed sheet writes (e.g. "3 2/6"). */
function stones(value6) {
  const n = Math.max(0, num(value6));
  const whole = Math.floor(n / 6);
  const sixths = n % 6;
  return sixths ? `${whole} ${sixths}/6` : String(whole);
}

/** Hit Dice as the printed card writes it: an integer, or the ½ fraction. */
function hdLabel(actor) {
  const hd = monsterHd(actor);
  return hd === 0.5 ? "½" : String(hd);
}

/**
 * Does this actor actually carry the field at `path`?
 *
 * True when the actor's data model DECLARES the field — so a declared-but-empty
 * one still counts — or when a derived pass has PUT it there (`encumbrance.value6`
 * and friends are computed, never declared). Foundry's `getField` walks a dotted
 * path and returns undefined the moment a segment is not a schema, so asking for
 * `details.xp.value` on a model whose `details.xp` is a plain number answers no.
 *
 * Every branch in the card selects on this instead of on `actor.type`: a type test
 * is a closed set, and an actor type added later silently takes some other type's
 * branch and renders that type's field paths against data of a different shape.
 *
 * @param {Actor} actor
 * @param {string} path dotted, relative to `system` — "details.xp.value"
 */
export function actorProvides(actor, path) {
  if (actor?.system?.schema?.getField?.(path)) return true;
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), actor?.system) !== undefined;
}

/**
 * The actor's own type name ("Monster", "Animal") — what stands in for a class on
 * a model that declares none. Blank when the type carries no label, so the card
 * shows nothing rather than a raw document type id.
 */
function typeLabel(actor) {
  const key = CONFIG?.Actor?.typeLabels?.[actor?.type] ?? `TYPES.Actor.${actor?.type}`;
  return game.i18n?.has?.(key) ? game.i18n.localize(key) : "";
}

/** A damage die with the actor's damage modifier appended (blank stays blank). */
function withMod(dice, mod) {
  if (!dice) return "";
  return mod ? `${dice}${signed(mod)}` : `${dice}`;
}

/**
 * Does this body bring spells to the table?
 *
 * THE one answer to that question. A class caster declares the slot model, but a
 * creature with spell-like powers carries the spells themselves and never sets
 * the flag — asking only the flag hides exactly the monsters whose spells the
 * table needs to see. Either is enough.
 */
export function isSpellcaster(actor) {
  if (actor?.system?.spells?.enabled) return true;
  return (actor?.items?.contents ?? []).some((i) => i.type === ITEM_TYPE.spell);
}

/**
 * Build the Follower Card view model for an actor.
 * @param {Actor} actor
 * @param {{editable?: boolean, interactive?: boolean}} [opts]
 *   `interactive` marks the card as the FollowerCardSheet's own render, where this
 *   module's actions are bound. The read-only cards on a character sheet's
 *   hirelings tab sit inside the EMPLOYER's application, which knows nothing of
 *   them, so controls that dispatch an action are drawn only when it is set.
 * @returns {Promise<object>} a flat view model consumed by follower-card.hbs
 */
export async function followerCardContext(actor, { editable = false, interactive = false } = {}) {
  const sys = actor?.system ?? {};
  const items = actor?.items?.contents ?? [];
  // Ability scores are the card's one structural fork: a model that declares them
  // is a person (mods feed the attack bonus, the grid has something to show), one
  // that does not is a creature fighting with its own routine.
  const hasScores = actorProvides(actor, "scores");
  // Sticky card-only overrides (flags.acks-extras.fcOverrides): the quick sheet reads
  // and rolls with these, the main character sheet ignores them. Reset clears them;
  // Commit bakes them into the real base fields. Shape: { ac, adventuring: {key} }.
  const overrides = actor?.getFlag?.(MODULE_ID, "fcOverrides") ?? {};
  const advOv = overrides.adventuring ?? {};

  const weapons = items.filter((i) => i.type === ITEM_TYPE.weapon);
  // Powers/prof and equipment carry ids so the editable sheet can roll them and
  // toggle equipped state; the read-only grid just reads `.name`.
  // Proficiencies that DO something. The ones that merely record a fighting
  // style / armour / weapon-proficiency state live in the strips instead, and a
  // non-rolling entry gets no button at all — a d20 means "this rolls".
  // `hasText` earns the power a Read-aloud button: a named power whose prose the
  // book supplies is the thing a table stops to read out ("Terrifying Visage"),
  // and it is worth posting whether or not it also rolls.
  const powers = items
    .filter((i) => i.type === ITEM_TYPE.ability && !isProfileAbility(i))
    .map((i) => ({ id: i.id, name: i.name, rollable: !!i.system?.roll, hasText: !!i.system?.description }));
  const equipment = items
    .filter((i) => i.type === ITEM_TYPE.weapon || i.type === ITEM_TYPE.armor || i.type === ITEM_TYPE.item)
    .map((i) => {
      const q = num(i.system?.quantity?.value, 1);
      return {
        id: i.id,
        name: q > 1 ? `${i.name} ×${q}` : i.name,
        equippable: isEquippable(i),
        equipped: isEquipped(i),
      };
    });

  // Caster strip: the card deliberately omits the spell PAGE (memorized lists,
  // reset buttons — that is the full sheet's job), but a caster whose card
  // shows nothing at all reads as "the module lost my spells". One line of
  // per-level slots says otherwise, and links out for the rest. Slot shape per
  // the released system: system.spells.enabled + spells[level] = {value: used,
  // max} under numeric keys — read defensively, core owns that model.
  const spellLevels = Object.entries(sys.spells ?? {})
    .filter(([key, slot]) => /^\d+$/.test(key) && slot && (num(slot.max) > 0 || num(slot.value) > 0))
    .map(([key, slot]) => ({ lvl: key, used: num(slot.value), max: num(slot.max) }));

  // The spells THEMSELVES, by level. A creature that casts is usually met before
  // it is read up on, so the names belong where the block is — the full sheet
  // keeps the page that memorizes and resets them.
  const byLevel = new Map();
  for (const s of items.filter((i) => i.type === ITEM_TYPE.spell)) {
    const lvl = String(num(s.system?.lvl, 1));
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push({ id: s.id, name: s.name, hasText: !!s.system?.description });
  }
  const spellRows = [...byLevel.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([lvl, spells]) => ({ lvl, spells }));

  const caster = isSpellcaster(actor)
    ? { slots: spellLevels, empty: !spellLevels.length && !spellRows.length, levels: spellRows }
    : null;

  // A character keeps a dedicated notes field; a creature model carries its prose
  // in the biography instead.
  const hasNotes = actorProvides(actor, "details.notes");
  const notesPath = hasNotes ? "system.details.notes" : "system.details.biography";
  const notes = (hasNotes ? sys.details?.notes : sys.details?.biography) ?? "";

  // CLASS — a model with no class field has its type name in that slot instead
  // ("Monster", "Animal"), and nothing to edit there.
  const hasClass = actorProvides(actor, "details.class");

  const ctx = {
    editable,
    interactive,
    caster,
    id: actor?.id,
    uuid: actor?.uuid,
    name: actor?.name ?? "",
    img: actor?.img,
    alignment: sys.details?.alignment ?? "",
    klass: hasClass ? (sys.details?.class ?? "") : typeLabel(actor),
    klassPath: hasClass ? "system.details.class" : null,
    ac: overrides.ac != null ? num(overrides.ac) : num(sys.aac?.value),
    acOverridden: overrides.ac != null,
    hp: { value: num(sys.hp?.value), max: num(sys.hp?.max) },
    morale: num(sys.details?.morale),
    loyalty: num(sys.retainer?.loyalty),
    attackThrow: num(sys.thac0?.throw, 10),
    powers,
    equipment,
    notesPath,
    notes,
  };

  // Enriched for display only; the raw text is what the editor edits (its
  // `value`). Both branches render HTML that core stored as HTML.
  ctx.notesHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(notes, {
    relativeTo: actor,
    secrets: !!actor?.isOwner,
  });

  // LEVEL / HD — a class level where the model declares one, Hit Dice where it
  // declares the die formula instead. `levelPath` is the field the editable card
  // binds to; null means the rating has no editable home here (HD is edited on
  // the full sheet), and an empty `level` means this actor carries no rating at
  // all rather than a zero it never had.
  if (actorProvides(actor, "details.level")) {
    ctx.levelLabel = "ACKS.details.level";
    ctx.level = num(sys.details?.level, 1);
    ctx.levelPath = "system.details.level";
  } else if (actorProvides(actor, "hp.hd")) {
    ctx.levelLabel = "ACKS.HitDiceShort";
    ctx.level = hdLabel(actor);
    ctx.levelPath = null;
  } else {
    ctx.levelLabel = "ACKS.details.level";
    ctx.level = "";
    ctx.levelPath = null;
  }

  // XP — the character model NESTS it (`details.xp` is {value, next, …}); the
  // creature models store a flat award number at `details.xp`. Bind the input to
  // whichever the model declares, or the edit writes an object over a number.
  if (actorProvides(actor, "details.xp.value")) {
    ctx.xp = num(sys.details?.xp?.value);
    ctx.xpNext = num(sys.details?.xp?.next);
    ctx.xpPath = "system.details.xp.value";
  } else if (actorProvides(actor, "details.xp")) {
    ctx.xp = num(sys.details?.xp);
    ctx.xpPath = "system.details.xp";
  } else {
    ctx.xp = "";
    ctx.xpPath = null;
  }

  // Abilities — only where the model declares scores; core computes the mods for
  // no other type, so there is nothing to show for a creature.
  ctx.hasAbilities = hasScores;
  ctx.abilities = hasScores
    ? ABILITY_ROW.map(({ key, label }) => ({
        key,
        label,
        value: num(sys.scores?.[key]?.value),
        mod: signed(sys.scores?.[key]?.mod),
      }))
    : [];

  // Speed: the ACKS II block (combat / exploration) where the model declares it,
  // else the creature's base rate and its own printed movement string. The
  // PRIMARY rate takes an override like AC does; the secondary stays derived,
  // because the two are one printed pair and a card that let both drift would
  // say a thing the book never does.
  if (actorProvides(actor, "movementacks.combat")) {
    ctx.speed = { primary: num(sys.movementacks?.combat), secondary: num(sys.movementacks?.exploration) };
  } else if (actorProvides(actor, "movement.base")) {
    ctx.speed = { primary: num(sys.movement?.base), secondary: sys.movement?.value ?? "" };
  } else {
    ctx.speed = null;
  }
  if (ctx.speed && overrides.speed != null) {
    ctx.speed.primary = num(overrides.speed);
    ctx.speed.overridden = true;
  }

  // Encumbrance — only for a model that tracks a carrying limit. The 1/6-stone
  // figures themselves are derived (core computes them for owners only), so the
  // row is gated on the DECLARED limit and shows zeroes where the derived pass
  // did not run, never a row for a body that carries no load at all.
  //
  // Its override is CARD-ONLY by construction: the carried figure is summed from
  // the items on the body, so there is no base field to bake it into. Commit
  // therefore leaves it standing, exactly as it leaves an unarmed attack's edit
  // standing — Reset is how it goes away.
  ctx.enc = actorProvides(actor, "encumbrance.max")
    ? { value: stones(sys.encumbrance?.value6), max: stones(sys.encumbrance?.max6) }
    : null;
  if (ctx.enc && overrides.enc != null) {
    ctx.enc.value = num(overrides.enc);
    ctx.enc.overridden = true;
  }

  // ATTACKS — one row per option the body actually has, each with its damage-type
  // icon. Target vs bonus stays DISTINCT (the ACKS model the patched roll uses):
  // the attack throw is the MOVING TARGET (class/level); the ability mod and
  // attack adjustment are ROLL-ADD bonuses. Never folded into one number.
  const throwTarget = num(sys.thac0?.throw, 10);
  const bonusFor = (type) =>
    // What rides here is an ability mod and the attack adjustment paired with it,
    // and both belong to a body with scores. A creature shows its bare throw.
    !hasScores
      ? 0
      : type === "missile"
        ? num(sys.scores?.dex?.mod) + num(sys.thac0?.mod?.missile)
        : num(sys.scores?.str?.mod) + num(sys.thac0?.mod?.melee);
  const dmgModFor = (type) => num(sys.damage?.mod?.[type]);

  const equippedWeapons = weapons.filter((w) => w.system?.equipped);
  if (!hasScores && !equippedWeapons.length) {
    // A creature with no gear fights with its own routine, not "unarmed" — the
    // unarmed / improvised repertoire belongs to a body that has hands and scores.
    ctx.attacks = [
      {
        key: "natural",
        label: game.i18n?.has?.("ACKS-LIB.followerCard.attack")
          ? game.i18n.localize("ACKS-LIB.followerCard.attack")
          : "Attack",
        type: "attack",
        itemId: null,
        icon: DAMAGE_TYPE_ICONS.varies ?? UNTYPED_ICON,
        damageTypeLabel: "",
        target: throwTarget,
        bonus: signed(0),
        at: 1,
        dmg: "",
      },
    ];
  } else {
    const atkOv = overrides.attacks ?? {};
    ctx.attacks = attackOptionsFor(actor).map((o) => {
      const item = o.itemId ? actor.items.get(o.itemId) : null;
      const ov = atkOv[o.key] ?? {};
      const baseBonus = bonusFor(o.type);
      const baseDmgMod = dmgModFor(o.type === "missile" ? "missile" : "melee");
      const dmgDie = ov.damage ?? o.damage;
      const dmgBonus = ov.damageBonus != null ? num(ov.damageBonus) : baseDmgMod;
      return {
        ...o,
        label: ov.label || o.label,
        damageTypeLabel: damageTypeLabel(o.damageType),
        size: item ? sizePips(item) : { count: 0, label: "", pips: [] },
        target: ov.target != null ? num(ov.target) : throwTarget,
        bonus: signed(ov.bonus != null ? num(ov.bonus) : baseBonus),
        dmg: dmgDie ? withMod(dmgDie, dmgBonus) : "",
        // raw values for the edit row + the roll
        edit: {
          label: ov.label ?? o.label,
          target: ov.target != null ? num(ov.target) : throwTarget,
          bonus: ov.bonus != null ? num(ov.bonus) : baseBonus,
          damage: dmgDie ?? "",
          damageBonus: dmgBonus,
        },
        overridden: Object.keys(ov).length > 0,
      };
    });
  }

  // Adventuring throws get their own rollable row — only where the model declares
  // the throws, and only for a hireling actually trained in Adventuring (matched
  // on the proficiency name). No throws, no panel: an empty panel reads as a bug.
  ctx.adventuring = actorProvides(actor, "adventuring")
    ? ADVENTURING.map(({ key, label, icon }) => ({
        key,
        label,
        icon,
        value: advOv[key] != null ? num(advOv[key]) : num(sys.adventuring?.[key]),
        overridden: advOv[key] != null,
      }))
    : [];
  ctx.hasAdventuring =
    !!ctx.adventuring.length && items.some((i) => i.type === ITEM_TYPE.ability && /adventuring/i.test(i.name ?? ""));

  ctx.strips = profileStrips(actor);
  ctx.hasOverrides =
    overrides.ac != null ||
    overrides.speed != null ||
    overrides.enc != null ||
    Object.keys(advOv).length > 0 ||
    Object.keys(overrides.attacks ?? {}).length > 0;
  return ctx;
}

/**
 * Render the Follower Card to an HTML string.
 * @param {Actor} actor
 * @param {{editable?: boolean}} [opts]
 * @returns {Promise<string>}
 */
export async function renderFollowerCard(actor, { editable = false, interactive = false } = {}) {
  const ctx = await followerCardContext(actor, { editable, interactive });
  return foundry.applications.handlebars.renderTemplate(FOLLOWER_CARD_TEMPLATE, ctx);
}
