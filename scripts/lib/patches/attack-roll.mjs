/* global game, foundry, Hooks, CONFIG, ChatMessage, Roll, ui */
/**
 * Core patch: the attack roll, remodeled as target vs auditable bonus stack.
 *
 *   roll  = 1d20 + labeled bonus terms      (each term visible in the roll tooltip)
 *   hits  ⇔ die + Σterms ≥ throw + targetAC (die specials preserved: nat 1 misses,
 *                                            nat 20 hits, unless exploding 20s)
 *
 * Outcomes are identical to core's for identical inputs (parity-tested in
 * tools/test-logic.mjs). The equipment feature's libWrapper wrapper composes on
 * top unchanged, naming any of its own deltas on `attData.acksLibTerms` to be
 * lifted out as terms of their own rather than folded into the weapon term.
 *
 * The chat card renders core's own template with core's data shape, so damage
 * application and every other chat listener keep working. Its math — the
 * throw, the bonuses, the defender's AC and both dice boxes — sits in a
 * private section (roll-audience.mjs); the outcome and the damage total stay
 * public, where core's apply-damage reads the total.
 *
 * See docs/lib/DECISIONS.md, "One owner for the attack roll, and one seam for
 * future modifiers".
 */
import { MODULE_ID } from "../constants.mjs";
import { toNum as num } from "../util.mjs";
import { attackTerms, termTotal, resolveAttack } from "../attack-logic.mjs";
import { rollDetailsDialog, skipDialogFor, situationalLabel } from "../roll-dialog.mjs";
import { mathIsPrivate, mathSection, showDice } from "../roll-audience.mjs";

/**
 * Fired before the attack roll, with `(actor, ctx)` — the seam for a combat
 * modifier or a replacer/dedup logic. `ctx.terms` (mutable) is the bonus
 * stack, `ctx.throwTarget` the movable target, `ctx.targetAc` the defender's.
 */
export const PRE_ATTACK_HOOK = "acksLibPreAttackRoll";

/**
 * Fired once the attack has RESOLVED, with `(actor, ctx, res)` — the seam for
 * consequences that hang off an attack having happened at all (the mounted
 * overlay's staying-mounted saves are the first). Listeners must not mutate
 * `res`; the roll is already made and displayed.
 */
export const POST_ATTACK_HOOK = "acksLibPostAttackRoll";
const L = (k, d) => (game.i18n.has(`ACKS-LIB.attack.${k}`) ? game.i18n.localize(`ACKS-LIB.attack.${k}`) : d);

/** Core's rollAttack, captured at install time — the fail-safe fallback. */
let coreRollAttack = null;

/* -------------------------------------------- */
/*  Roll construction                            */
/* -------------------------------------------- */

/**
 * The character's own best throw, from equipment's model — used only for the
 * weaponless Melee/Ranged buttons. Null when equipment is not live.
 */
function bestBonus(actor, type) {
  const api = globalThis.acksExtras?.equipment ?? game.modules?.get("acks-extras")?.api?.equipment ?? null;
  if (!api?.bestAttackBonus) return null;
  try {
    const b = api.bestAttackBonus(actor, type);
    return b && Number.isFinite(b.total) ? b : null;
  } catch {
    return null;
  }
}

function buildContext(actor, attData, options) {
  const sys = actor.system;
  const type = options.type ?? "melee";
  // No item: the sheet's weaponless Melee/Ranged button, reading the same
  // figure the display box shows, from the same call. An item keeps the
  // per-weapon path below, where the loadout adjustment and the item's own
  // bonus belong.
  const quick = attData?.item ? null : bestBonus(actor, type);
  const abilityKey = quick?.abilityKey ?? (type === "missile" ? "dex" : "str");
  // Parts a wrapper already folded into the item's bonus (equipment's
  // non-proficiency package), each labelled: taken back out of the weapon's
  // term and shown as their own.
  const lifted = (Array.isArray(attData?.acksLibTerms) ? attData.acksLibTerms : []).filter((t) => num(t?.value));
  const terms = attackTerms({
    type,
    abilityMod: quick ? quick.abilityMod : sys.scores?.[abilityKey]?.mod,
    attackMod: quick ? 0 : sys.thac0?.mod?.[type],
    itemBonus: num(attData?.item?.system?.bonus) - termTotal(lifted),
  }).map((t) => ({
    ...t,
    label:
      t.key === "ability"
        ? L(abilityKey, abilityKey.toUpperCase())
        : t.key === "adjustment"
          ? L("adjustment", "Attack adjustment")
          : attData?.item?.name || L("weapon", "Weapon"),
  }));
  for (const t of lifted) terms.push({ key: String(t.key ?? "situational"), value: num(t.value), label: t.label || situationalLabel() });
  const target = attData?.roll?.target ?? null;
  const ctx = {
    actor,
    item: attData?.item ?? null,
    type,
    terms,
    throwTarget: Number(sys.thac0?.throw ?? 10),
    targetAc: target ? Number(target.actor?.system?.aac?.value ?? 0) : null,
    targetName: target?.name ?? null,
    // The defender itself, for listeners that need more than its AC (height
    // advantage compares mounts). Null when the roll had no target.
    targetActor: target?.actor ?? null,
    options,
  };

  // A caller-supplied override (the Follower Card's per-attack edits): moves
  // the target and/or replaces the bonus stack. Read from attData first —
  // core's `targetAttack` rebuilds options as `{type, skipDialog}` before
  // calling rollAttack, dropping anything passed there.
  const ov = attData?.acksLibOverride ?? options.acksLibOverride;
  if (ov) {
    if (Number.isFinite(Number(ov.target))) ctx.throwTarget = Number(ov.target);
    if (Number.isFinite(Number(ov.bonus))) {
      ctx.terms = [{ key: "override", value: Number(ov.bonus), label: L("override", "Override") }];
    }
  }
  // The replacer/dedup seam: mutate ctx.terms, move ctx.throwTarget.
  Hooks.callAll(PRE_ATTACK_HOOK, actor, ctx);
  return ctx;
}

/** "+2[Strength]" formula fragments — the labels surface in the roll tooltip. */
const termPart = (t) => `${t.value}[${String(t.label).replace(/[[\]]/g, "")}]`;

/**
 * A weapon's damage die, or the 1d6 default when the field is blank or
 * unparseable (a stat block may state damage as prose rather than dice). An
 * unparseable one also warns, naming the item — Foundry's parser throws on
 * the whole formula over one bad term, which would otherwise cost the attack,
 * not just the damage.
 */
function damageDie(item) {
  const raw = item?.system?.damage;
  if (!raw) return "1d6";
  const formula = String(raw);
  if (Roll.validate(formula)) return formula;
  ui.notifications.warn(
    game.i18n.format("ACKS-LIB.attack.badDamage", {
      item: item?.name ?? L("weapon", "Weapon"),
      formula,
    }),
  );
  return "1d6";
}

function damageParts(actor, attData, type) {
  const parts = [{ value: damageDie(attData?.item), label: null }];
  if (type === "melee") {
    const str = Number(actor.system.scores?.str?.mod ?? 0);
    if (str) parts.push({ value: str, label: L("str", "STR") });
  }
  if (type === "melee" || type === "missile") {
    const mod = Number(actor.system.damage?.mod?.[type] ?? 0);
    if (mod) parts.push({ value: mod, label: L("damageAdjustment", "Damage adjustment") });
  }
  return parts;
}

/** A public stand-in for the damage box: the total alone, where core's apply-damage reads it. */
const damageTotalOnly = (total) => `<div class="dice-roll"><div class="dice-result"><h4 class="dice-total">${total}</h4></div></div>`;

/* -------------------------------------------- */
/*  The patched roll                             */
/* -------------------------------------------- */

async function acksLibRollAttack(actor, attData, options = {}) {
  const ctx = buildContext(actor, attData, options);
  const exploding = !!game.settings.get("acks", "exploding20s");

  let label = game.i18n.format("ACKS.roll.attacks", { name: actor.name });
  if (attData?.item) label = game.i18n.format("ACKS.roll.attacksWith", { name: attData.item.name });

  const attackParts = [exploding ? "1d20x" : "1d20", ...ctx.terms.map(termPart)];
  // The dialog opens on the mode the roller's chat is already set to, as
  // core's does: a Judge whose chat whispers to the GMs never posts an attack
  // in the open by pressing Roll.
  let messageMode = game.settings.get("core", "messageMode");
  if (!skipDialogFor(options.event, options.skipDialog)) {
    const details = await rollDetailsDialog({ title: label, formula: attackParts.join(" + "), messageMode });
    if (!details) return null; // cancelled — no roll, like core
    if (details.bonus) {
      ctx.terms.push({ key: "situational", value: details.bonus, label: situationalLabel() });
      attackParts.push(termPart(ctx.terms.at(-1)));
    }
    messageMode = details.messageMode || messageMode;
  }

  const roll = new Roll(attackParts.join(" + "));
  await roll.evaluate();

  const dmg = damageParts(actor, attData, ctx.type);
  const dmgRoll = new Roll(dmg.map((p) => (p.label ? termPart(p) : String(p.value))).join(" + "));
  await dmgRoll.evaluate();
  if (dmgRoll.total < 1) dmgRoll._total = 1;

  const die = roll.dice[0]?.total ?? roll.total;
  const res = resolveAttack({
    die,
    bonus: termTotal(ctx.terms),
    throwTarget: ctx.throwTarget,
    targetAc: ctx.targetAc ?? 0,
    exploding,
  });
  // Consequences of the attack having happened (staying-mounted saves and
  // their kin). After resolution, before display: listeners read, never move
  // the result.
  Hooks.callAll(POST_ATTACK_HOOK, actor, ctx, res);

  // The auditable line: target stated as a target, bonuses as roll-adds. The
  // defender's AC is shown only when it changes the number needed — against
  // AC 0 it would just restate the throw.
  const acShifts = ctx.targetAc != null && res.effectiveTarget !== ctx.throwTarget;
  const vsAc = acShifts ? game.i18n.format("ACKS-LIB.attack.vsAc", { ac: ctx.targetAc, need: res.effectiveTarget }) : "";
  const stack = `${die}${ctx.terms.map((t) => ` ${t.value >= 0 ? "+" : "−"} ${Math.abs(t.value)} (${t.label})`).join("")} = ${res.total}`;
  let outcome;
  let word;
  if (res.isFumble) outcome = word = game.i18n.localize("ACKS-LIB.attack.fumble");
  else if (res.isCritical) outcome = word = game.i18n.localize("ACKS-LIB.attack.critical");
  else if (res.isSuccess) {
    outcome = game.i18n.format("ACKS-LIB.attack.hitsAc", { ac: res.acHit });
    word = game.i18n.localize("ACKS-LIB.attack.hit");
  } else {
    outcome = game.i18n.format("ACKS-LIB.attack.missesAc", { ac: res.acHit });
    word = game.i18n.localize("ACKS-LIB.attack.miss");
  }
  const math = `${game.i18n.format("ACKS-LIB.attack.throwLine", { target: ctx.throwTarget })}${vsAc}<br/>${stack} → <b>${outcome}</b>`;
  const attackBox = await roll.render();
  const damageBox = await dmgRoll.render();
  // Private math: every reader gets the outcome word and the damage total;
  // the speaker's owners and the GMs also get the line and both dice boxes.
  const hidden = mathIsPrivate();

  // Core-shaped chat flow: same template, same data shape, same listeners.
  const rollData = {
    actor,
    item: attData?.item ?? null,
    roll: {
      type: ctx.type,
      thac0: res.effectiveTarget,
      dmg: dmg.map((p) => p.value),
      save: attData?.roll?.save,
      target: attData?.roll?.target,
    },
  };
  // Core owns the audience; no mode name is compared here. See
  // docs/lib/DECISIONS.md, "The attack roll delegates its audience to core,
  // and offers four modes".
  const chatData = { user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }) };
  ChatMessage.applyMode(chatData, messageMode);

  const templateData = {
    title: label,
    flavor: label,
    data: rollData,
    config: CONFIG.ACKS ?? {},
    result: {
      isSuccess: res.isSuccess,
      isFailure: res.isFailure,
      target: res.effectiveTarget,
      total: res.total,
      victim: ctx.targetName,
      details: hidden ? `<b>${word}</b>${mathSection(`${math}${attackBox}${res.isSuccess ? damageBox : ""}`)}` : math,
      dmg: dmgRoll.total,
    },
    rollACKS: hidden ? null : attackBox,
    rollDamage: hidden ? damageTotalOnly(dmgRoll.total) : damageBox,
  };
  chatData.content = await foundry.applications.handlebars.renderTemplate(
    "systems/acks/templates/chat/roll-attack.hbs",
    templateData,
  );

  if (game.dice3d) {
    await showDice(res.isSuccess ? [roll, dmgRoll] : [roll], { whisper: chatData.whisper, blind: chatData.blind });
  } else {
    chatData.sound = CONFIG.sounds.dice;
  }
  ChatMessage.create(chatData);
  return roll;
}

/**
 * The installed method body — fail-safe: any error falls back to core's roll.
 * Must `await` the remodeled roll rather than return its promise unawaited, or
 * a rejection raised inside it (a bad formula, a failed render) would surface
 * past this `try` as an unhandled rejection instead of falling back.
 */
async function patchedRollAttack(attData, options = {}) {
  try {
    return await acksLibRollAttack(this, attData, options);
  } catch (err) {
    console.error(`${MODULE_ID} | patched attack roll failed; falling back to core`, err);
    return coreRollAttack ? coreRollAttack.call(this, attData, options) : undefined;
  }
}

/**
 * Wrappers to compose AROUND this patch, innermost-last — the equipment
 * feature's pre-roll adjustment is the only one today. libWrapper permits many
 * packages to wrap one method but not one package to register twice for it, so
 * this reproduces its own ordering (wrappers outside, override inside) inside
 * a single registration. See docs/lib/DECISIONS.md, "History the source
 * comments carried, recorded".
 *
 * Each entry has libWrapper's WRAPPER signature: `(wrapped, ...args)`, called
 * with the actor as `this`.
 */
const composed = [];

/** Register a wrapper to run around the innermost rollAttack. */
export function wrapRollAttack(fn) {
  if (typeof fn === "function" && !composed.includes(fn)) composed.push(fn);
}

/**
 * Fold every registered wrapper around `inner`, innermost-last, and return the
 * resulting `(attData, options)` entry point. Built per call, not per install:
 * a feature that registers after the install still composes.
 */
function foldComposed(actor, inner) {
  let next = inner;
  for (const w of [...composed].reverse()) {
    const outer = next;
    next = (a, o) => w.call(actor, outer, a, o);
  }
  return next;
}

/** OVERRIDE form: the remodeled roll sits innermost. */
function chainedRollAttack(attData, options = {}) {
  return foldComposed(this, (a, o) => patchedRollAttack.call(this, a, o))(attData, options);
}

/**
 * WRAPPER form: core's own roll sits innermost, because the world switched the
 * remodeled roll off. libWrapper's `wrapped` is used rather than the captured
 * `coreRollAttack` — with another package's OVERRIDE in play the captured
 * method is libWrapper's own dispatcher, and calling it re-enters the chain.
 */
function chainedCoreRollAttack(wrapped, attData, options = {}) {
  return foldComposed(this, (a, o) => wrapped(a, o))(attData, options);
}

/**
 * Install at `ready` (the actor class is final). One registration always
 * lands, whichever way `useModel` falls — `composed` is reachable only from
 * the installed chain, so a feature that registered through `wrapRollAttack`
 * (the equipment feature's per-weapon modifiers and ammunition spend) is
 * silently dead without it. Never gate the install on the remodeled roll's
 * setting; that setting chooses only what sits innermost.
 *
 * @param {boolean} useModel  true: the remodeled roll replaces core's
 *   (OVERRIDE); false: core's roll runs, carrying the chain (WRAPPER).
 */
export function installAttackRollPatch(useModel = true) {
  if (game.system?.id !== "acks") return false;
  const proto = CONFIG.Actor.documentClass?.prototype;
  if (typeof proto?.rollAttack !== "function") {
    console.warn(`${MODULE_ID} | rollAttack not found on the actor class; attack patch skipped.`);
    return false;
  }
  coreRollAttack = proto.rollAttack;
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(
      MODULE_ID,
      "CONFIG.Actor.documentClass.prototype.rollAttack",
      useModel ? chainedRollAttack : chainedCoreRollAttack,
      useModel ? "OVERRIDE" : "WRAPPER",
    );
  } else if (useModel) {
    proto.rollAttack = chainedRollAttack;
  } else {
    // No libWrapper: nothing else has replaced the prototype method, so the
    // method captured above IS core's and is safe as the innermost link.
    const core = coreRollAttack;
    proto.rollAttack = function (attData, options = {}) {
      return chainedCoreRollAttack.call(this, (a, o) => core.call(this, a, o), attData, options);
    };
  }
  console.log(
    useModel
      ? `${MODULE_ID} | attack roll patched: throw as target, bonuses as auditable terms.`
      : `${MODULE_ID} | remodeled attack roll off; core's roll stands, carrying ${composed.length} feature wrapper(s).`,
  );
  return true;
}
