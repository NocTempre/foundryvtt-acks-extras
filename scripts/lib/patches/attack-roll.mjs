/* global game, foundry, Hooks, CONFIG, ChatMessage, Roll */
/**
 * Core patch: the attack roll, remodeled as TARGET vs AUDITABLE BONUS STACK.
 *
 * WHY: ACKS distinguishes the ATTACK THROW — a
 * target that MOVES (class/level, "attacks as 0th-level fighter") — from BONUSES
 * added to the roll (ability, magic, situational). Core's `rollAttack` folds the
 * target movement into the die pool (`bba = 10 − throw`) and resolves
 * `total ≥ AC + 10`: the same hit test algebraically, but the rolled value is
 * silently masked behind the target adjustment, no modifier is attributable, and
 * planned effect replacer/deduplication logic has no stack to operate on. This
 * patch owns the method and restores the model:
 *
 *   roll  = 1d20 + labeled bonus terms      (each term visible in the roll tooltip)
 *   hits  ⇔ die + Σterms ≥ throw + targetAC (die specials preserved: nat 1 misses,
 *                                            nat 20 hits, unless exploding 20s)
 *
 * Outcomes are IDENTICAL to core's for identical inputs (parity-tested in
 * tools/test-logic.mjs); what changes is the model and the audit.
 *
 * OWNERSHIP (one owner per wrapped core method): acks-lib OWNS `rollAttack`'s
 * implementation. acks-equipment's libWrapper WRAPPER composes on top unchanged —
 * it adjusts `attData.item.system.bonus` and calls through, so its RAW deltas
 * arrive in this model as part of the weapon term. The
 * `acksLibPreAttackRoll(actor, ctx)` hook fires before the roll with the mutable
 * term stack (`ctx.terms`), the movable target (`ctx.throwTarget`), and
 * `ctx.targetAc` — the seam for effect replacer/dedup logic and for equipment's
 * documented pre-roll-hook handoff.
 *
 * The chat card renders core's own template with core's data shape, so damage
 * application and every other chat listener keep working.
 */
import { MODULE_ID } from "../constants.mjs";
import { attackTerms, termTotal, resolveAttack } from "../attack-logic.mjs";

export const PRE_ATTACK_HOOK = "acksLibPreAttackRoll";
const L = (k, d) => (game.i18n.has(`ACKS-LIB.attack.${k}`) ? game.i18n.localize(`ACKS-LIB.attack.${k}`) : d);

/** Core's rollAttack, captured at install time — the fail-safe fallback. */
let coreRollAttack = null;

/* -------------------------------------------- */
/*  Roll construction                            */
/* -------------------------------------------- */

function buildContext(actor, attData, options) {
  const sys = actor.system;
  const type = options.type ?? "melee";
  const abilityKey = type === "missile" ? "dex" : "str";
  const terms = attackTerms({
    type,
    abilityMod: sys.scores?.[abilityKey]?.mod,
    attackMod: sys.thac0?.mod?.[type],
    itemBonus: attData?.item?.system?.bonus,
  }).map((t) => ({
    ...t,
    label:
      t.key === "ability"
        ? L(abilityKey, abilityKey.toUpperCase())
        : t.key === "adjustment"
          ? L("adjustment", "Attack adjustment")
          : attData?.item?.name || L("weapon", "Weapon"),
  }));
  const target = attData?.roll?.target ?? null;
  const ctx = {
    actor,
    item: attData?.item ?? null,
    type,
    terms,
    throwTarget: Number(sys.thac0?.throw ?? 10),
    targetAc: target ? Number(target.actor?.system?.aac?.value ?? 0) : null,
    targetName: target?.name ?? null,
    options,
  };

  // A caller-supplied override (the Follower Card's per-attack quick edits): it
  // MOVES the target and/or REPLACES the bonus stack, keeping the two kinds of
  // number distinct rather than folding one into the other.
  //
  // Read from attData FIRST: core's `targetAttack` rebuilds the options object as
  // `{type, skipDialog}` before calling rollAttack, so anything passed in options
  // is dropped on that path — attData is forwarded intact.
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

function damageParts(actor, attData, type) {
  const parts = [{ value: attData?.item?.system?.damage || "1d6", label: null }];
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

/** Minimal situational-bonus + roll-mode dialog (core's getRollDetails shape). */
async function rollDetailsDialog(title, formula) {
  const modes = Object.entries(CONFIG.Dice.rollModes).map(
    ([k, v]) => `<option value="${k}">${game.i18n.localize(v.label ?? v)}</option>`,
  );
  const content = `
    <p class="hint">${formula}</p>
    <div class="form-group"><label>${L("situational", "Situational bonus")}</label>
      <input type="number" name="bonus" value="0" step="1" autofocus /></div>
    <div class="form-group"><label>${game.i18n.localize("CHAT.RollVisibility")}</label>
      <select name="rollMode">${modes.join("")}</select></div>`;
  try {
    return await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title },
      content,
      ok: {
        label: game.i18n.localize("ACKS-LIB.attack.roll"),
        callback: (_ev, button) => ({
          bonus: Number(button.form.elements.bonus.value) || 0,
          rollMode: button.form.elements.rollMode.value,
        }),
      },
      rejectClose: true,
    });
  } catch {
    return null; // cancelled — no roll, like core
  }
}

/* -------------------------------------------- */
/*  The patched roll                             */
/* -------------------------------------------- */

async function acksLibRollAttack(actor, attData, options = {}) {
  const ctx = buildContext(actor, attData, options);
  const exploding = !!game.settings.get("acks", "exploding20s");

  let label = game.i18n.format("ACKS.roll.attacks", { name: actor.name });
  if (attData?.item) label = game.i18n.format("ACKS.roll.attacksWith", { name: attData.item.name });

  // Skip-key on the triggering event, exactly like core.
  let skipDialog = !!options.skipDialog;
  try {
    const skipKey = game.settings.get("acks", "skip-dialog-key");
    if (options.event && options.event[skipKey]) skipDialog = true;
  } catch {
    /* setting absent */
  }

  const attackParts = [exploding ? "1d20x" : "1d20", ...ctx.terms.map(termPart)];
  let rollMode = game.settings.get("core", "rollMode");
  if (!skipDialog) {
    const details = await rollDetailsDialog(label, attackParts.join(" + "));
    if (!details) return null; // cancelled
    if (details.bonus) {
      ctx.terms.push({ key: "situational", value: details.bonus, label: L("situational", "Situational") });
      attackParts.push(termPart(ctx.terms.at(-1)));
    }
    rollMode = details.rollMode || rollMode;
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

  // The auditable line: target stated as a target, bonuses as roll-adds.
  // The defender's AC earns its place only by changing the number needed. Against
  // AC 0 it restates the throw, so it is dropped rather than printed twice.
  const acShifts = ctx.targetAc != null && res.effectiveTarget !== ctx.throwTarget;
  const vsAc = acShifts ? game.i18n.format("ACKS-LIB.attack.vsAc", { ac: ctx.targetAc, need: res.effectiveTarget }) : "";
  const stack = `${die}${ctx.terms.map((t) => ` ${t.value >= 0 ? "+" : "−"} ${Math.abs(t.value)} (${t.label})`).join("")} = ${res.total}`;
  let outcome;
  if (res.isFumble) outcome = game.i18n.localize("ACKS-LIB.attack.fumble");
  else if (res.isCritical) outcome = game.i18n.localize("ACKS-LIB.attack.critical");
  else if (res.isSuccess) outcome = game.i18n.format("ACKS-LIB.attack.hitsAc", { ac: res.acHit });
  else outcome = game.i18n.format("ACKS-LIB.attack.missesAc", { ac: res.acHit });
  const details = `${game.i18n.format("ACKS-LIB.attack.throwLine", { target: ctx.throwTarget })}${vsAc}<br/>${stack} → <b>${outcome}</b>`;

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
  const chatData = { user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }) };
  if (["gmroll", "blindroll"].includes(rollMode)) chatData.whisper = ChatMessage.getWhisperRecipients("GM");
  if (rollMode === "selfroll") chatData.whisper = [game.user.id];
  else if (rollMode === "blindroll") {
    chatData.blind = true;
    rollData.roll.blindroll = true;
  }

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
      details,
      dmg: dmgRoll.total,
    },
    rollACKS: await roll.render(),
    rollDamage: await dmgRoll.render(),
  };
  chatData.content = await foundry.applications.handlebars.renderTemplate(
    "systems/acks/templates/chat/roll-attack.hbs",
    templateData,
  );

  if (game.dice3d) {
    await game.dice3d.showForRoll(roll, game.user, true, chatData.whisper, chatData.blind);
    if (res.isSuccess) await game.dice3d.showForRoll(dmgRoll, game.user, true, chatData.whisper, chatData.blind);
  } else {
    chatData.sound = CONFIG.sounds.dice;
  }
  ChatMessage.create(chatData);
  return roll;
}

/** The installed method body — fail-safe: any error falls back to core's roll. */
function patchedRollAttack(attData, options = {}) {
  try {
    return acksLibRollAttack(this, attData, options);
  } catch (err) {
    console.error(`${MODULE_ID} | patched attack roll failed; falling back to core`, err);
    return coreRollAttack ? coreRollAttack.call(this, attData, options) : undefined;
  }
}

/**
 * Wrappers to compose AROUND this patch, innermost-last — the equipment
 * feature's pre-roll adjustment is the only one today.
 *
 * This exists because libWrapper permits many PACKAGES to wrap one method but
 * not one package to register twice for it. Before the merge, lib's OVERRIDE
 * and equipment's WRAPPER were two packages and composed for free; afterwards
 * they are one, and the second registration threw at `ready` — taking the
 * whole ready hook with it. Composing here reproduces libWrapper's own
 * ordering (wrappers outside, override inside) inside a single registration.
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
 * Install at `ready` (the actor class is final).
 *
 * ONE registration always lands, whichever way `useModel` falls: `composed` is
 * reachable only from the installed chain, so every feature that registered
 * through `wrapRollAttack` — acks-equipment's per-weapon RAW modifiers and its
 * ammunition spend — is silently dead without it. Never gate the install on the
 * remodeled roll's setting; that setting chooses only what sits INNERMOST.
 *
 * @param {boolean} useModel  true → the remodeled roll replaces core's (OVERRIDE);
 *                            false → core's roll runs, carrying the chain (WRAPPER).
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
