/* global foundry, game, CONFIG */
/**
 * The ACKS II "Follower Card" — the printed henchman/follower card, rendered as a
 * compact, theme-styled view of an actor. See docs/lib/FOLLOWER-CARD.md.
 *
 * One layout serves two surfaces: the editable FollowerCardSheet, and the
 * read-only cards a character sheet's hirelings tab is re-skinned into (the
 * henchmen feature), where the SAME markup must emit no `name=` inputs.
 *
 * Which fields a card shows is decided by what the actor's data model
 * DECLARES, never by `actor.type` — see `actorProvides` below and
 * docs/lib/DECISIONS.md, "The Follower Card selects fields by schema, never
 * by actor type".
 */
import { toNum as num } from "./util.mjs";
import { MODULE_ID } from "./constants.mjs";
import { monsterHd } from "./actor-read.mjs";
import { isEquippable, isEquipped } from "./item-model.mjs";
import { borneWeight6 } from "./capacity.mjs";
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
  return { 0.5: "½", 0.25: "¼", 0.125: "⅛" }[hd] ?? String(hd);
}

/**
 * Does this actor actually carry the field at `path`? True when the actor's
 * data model DECLARES the field, or when a derived pass has put it there.
 * Every branch in the card selects on this instead of on `actor.type`. See
 * docs/lib/DECISIONS.md, "The Follower Card selects fields by schema, never
 * by actor type".
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
  // toggle equipped state; the read-only grid just reads `.name`. `rollable`
  // gates the roll button; `hasText` gates a Read-aloud button. Computed up
  // front, since strips renders nothing for a non-character actor and a
  // monster's proficiency item must stay in this list.
  const strips = profileStrips(actor);
  const powers = items
    .filter((i) => i.type === ITEM_TYPE.ability && (!isProfileAbility(i) || !strips.any))
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

  // Caster strip: one line of per-level slots, no memorize/reset controls
  // (that stays the full sheet's job). Slot shape per the released system:
  // spells[level] = {value: used, max} under numeric keys, read defensively.
  const spellLevels = Object.entries(sys.spells ?? {})
    .filter(([key, slot]) => /^\d+$/.test(key) && slot && (num(slot.max) > 0 || num(slot.value) > 0))
    .map(([key, slot]) => ({ lvl: key, used: num(slot.value), max: num(slot.max) }));

  // The spells themselves, by level.
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

  // LEVEL / HD — class level where declared, else Hit Dice. `levelPath` null
  // means no editable home here (HD is edited on the full sheet); an empty
  // `level` means no rating at all, never a zero it never had.
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

  // XP — nested (`{value, next, …}`) on a character, flat on a creature; bind
  // to whichever the model declares, or the edit writes an object over a number.
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

  // Speed: the ACKS II block (combat/exploration) where declared, else the
  // creature's base rate and printed movement string. The primary rate takes
  // an override like AC does; the secondary stays derived.
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

  // Encumbrance — only for a model with a carrying limit. Core's `value6` is
  // computed for an owner/GM viewer only (`computeEncumbrance` gates on
  // `isOwner || game.user.isGM`), so a non-owner viewer falls back to the
  // lib's own item-weight sum. `max` reads the declared limit, not the
  // ephemeral `max6`.
  ctx.enc = actorProvides(actor, "encumbrance.max")
    ? {
        value: stones(Number.isFinite(sys.encumbrance?.value6) ? sys.encumbrance.value6 : borneWeight6(actor)),
        max: stones(num(sys.encumbrance?.max, 20) * 6),
      }
    : null;
  if (ctx.enc && overrides.enc != null) {
    ctx.enc.value = num(overrides.enc);
    ctx.enc.overridden = true;
  }

  // ATTACKS — one row per option the body has. Target vs bonus stays
  // distinct, the same model attack-logic.mjs uses; see docs/lib/DECISIONS.md,
  // "One owner for the attack roll, and one seam for future modifiers".
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

  ctx.strips = strips;
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
