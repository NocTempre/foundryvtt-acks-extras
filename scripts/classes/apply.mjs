/* global game, foundry, ui, ChatMessage */
/**
 * Applying a class document to a character: one batched update carrying the
 * printed values for the character's level — saves and attack throw (via the
 * released-key write layer), title, XP-to-next, hit-dice formula, cleaves,
 * and the vancian slot grid — and, when the level is being SET rather than
 * earned, the abilities that level owes.
 *
 * Never silent: `applyClass` shows what it is about to change (old → new) and
 * marks fields whose current value differs from what the LAST apply wrote —
 * a hand edit — before anything lands. The written values are recorded on the
 * actor (`flags["acks-extras"].classes.applied`) so the next apply can make
 * that distinction again.
 */
import { savesUpdateData } from "../lib/actor-compat.mjs";
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { saveBandAt, attackBandAt, resolveLevelValue, findByRef } from "./registry.mjs";
import { normalizeHd, rebuildHitPoints, xpForLevel } from "./hitpoints.mjs";
import { grantLanguages } from "./languages.mjs";
import { adventuringDoc, awardsThrough, grantAbility, grantAdventuring, ownsRef, refOf } from "./grants.mjs";
import { closesRung, grantableRefs, readRungs, rungLabel, rungOptions, rungSelectHtml } from "./picks.mjs";

export { normalizeHd };

/** The vancian slot row for `level`: exact rung, else the highest below it. */
function slotRowAt(tradition, level) {
  const rows = (tradition?.slots ?? []).filter((r) => r.atLevel <= level);
  if (!rows.length) return null;
  return rows.reduce((best, r) => (r.atLevel > best.atLevel ? r : best));
}

/**
 * The update a class document prescribes for a character at `level`.
 * Pure build, no writes. Paths whose printed cell is absent are skipped —
 * an apply never zeroes a field the book left blank.
 *
 * @returns {{update: object, level: number, missing: string[]}}
 */
export function classUpdateData(actor, classItem, level) {
  const sys = classItem.system;
  const missing = [];
  const clamped = Math.max(1, Math.min(Number(level) || 1, sys.maximumLevel || 14));
  const update = {
    "system.details.class": classItem.name,
    "system.details.level": clamped,
  };

  const row = sys.levelRow(clamped);
  if (row) {
    if (row.title) update["system.details.title"] = row.title;
    const hd = normalizeHd(row.hd);
    if (hd) update["system.hp.hd"] = hd;
  } else missing.push("levels");

  const nextXp = sys.nextXp(clamped);
  if (nextXp != null) update["system.details.xp.next"] = nextXp;

  const saves = saveBandAt(classItem, clamped);
  if (saves) Object.assign(update, savesUpdateData(saves));
  else missing.push("saves");

  const attack = attackBandAt(classItem, clamped);
  if (attack?.throw != null) update["system.thac0.throw"] = attack.throw;
  else missing.push("attack");

  const cleaves = resolveLevelValue(sys.cleaves, clamped);
  if (typeof cleaves === "number") update["system.fight.cleaves"] = Math.max(0, Math.floor(cleaves));

  // Vancian slot grid. One tradition writes directly; with two (the Nobiran)
  // the arcane one takes the system grid — per-tradition pools are the
  // casting framework's surface, not this grid's.
  const traditions = sys.casting ?? [];
  const gridSource =
    traditions.length === 1 ? traditions[0] : traditions.find((t) => (t.key || "").toLowerCase() === "arcane");
  if (gridSource && gridSource.kind === "vancian") {
    const slots = slotRowAt(gridSource, clamped);
    if (slots) {
      let any = false;
      for (let n = 1; n <= 6; n++) {
        const max = slots[`s${n}`];
        if (typeof max === "number") {
          update[`system.spells.${n}.max`] = max;
          if (max > 0) any = true;
        }
      }
      update["system.spells.enabled"] = any;
    }
  }

  return { update, level: clamped, missing };
}

/** The current actor value at an update path (dot-path read). */
const currentAt = (actor, path) => foundry.utils.getProperty(actor, path);

/**
 * Apply `classItem` to `actor` at `level` (default: the actor's current
 * level, floored to 1). Shows a confirm dialog listing every change and
 * flagging hand-edited fields; `{confirm: false}` skips it (callers that
 * already confirmed). Records the applied ledger on the actor.
 *
 * `{grantAwards: true}` also hands over the abilities the class owes AT AND
 * BELOW that level — Adventuring, every fixed award, and one pick per choice
 * award, asked in the same dialog. Only the paths that SET a level pass it
 * (the picker and a dropped class); chargen grants its own 1st level and the
 * level-up wizard has already granted the rung it just earned, so neither
 * wants the whole ladder handed over underneath it.
 *
 * `{answered}` records rungs a CALLER has already asked — the level-up wizard
 * and chargen both answer rungs of their own, and a rung answered anywhere is
 * a rung this dialog must not ask again. Without it a character levelled to 5th
 * met every pick from 1st to 5th a second time the moment their class was
 * re-applied.
 *
 * `{answers}` carries rung answers a caller has ALREADY collected, keyed by
 * award key — how a surface that asked the questions itself (the class picker,
 * assign-app.mjs) hands them over instead of having them asked a second time in
 * a confirm dialog. Answers gathered by this function's own dialog merge into
 * the same map, so there is one path from an answer to what it grants.
 *
 * @param {object} [options]
 * @param {string[]} [options.answered] award keys (`grants.awardKey`) the
 *   caller has already put to the player and does not want asked again
 * @param {Record<string, string>} [options.answers] award key → the ref chosen
 *   for it, or `picks.ANSWERED` for a rung the character already satisfies
 * @returns {Promise<{applied: boolean, update?: object, missing?: string[], grants?: object[]}>}
 */
/**
 * Carry the class's COMBAT TRAINING onto the character.
 *
 * A class document states what it is trained to fight with as an ActiveEffect
 * — `weaponProf`, `armourProficiency`, `styleProficient` — and `transfer: true`
 * on it means nothing here, because a character does not OWN the class
 * document: the class is recorded as a name and a ledger flag, and the world
 * item stays in the directory. So the effect sat on a document nothing read,
 * and every character was unrestricted: a Mage in full plate reported as
 * proficient with it, and no weapon or fighting style was ever untrained.
 *
 * The effect is copied onto the ACTOR, stamped with the class it came from so
 * a re-apply — or a change of class — removes exactly what a previous apply
 * put there and nothing a Judge added by hand. Copies rather than links,
 * because the character's proficiency is theirs: editing the class afterwards
 * should not silently retrain everyone who ever took it, and re-applying is
 * how a Judge asks for that.
 *
 * Nothing is written for a class stating no training; the character is left
 * unrestricted, which is what an unstated training means.
 */
export async function syncClassTraining(actor, classItem) {
  if (!actor) return [];
  const mine = actor.effects.filter((e) => e.getFlag?.(MODULE_ID, "fromClass"));
  if (mine.length) await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id));
  const source = (classItem?.effects ?? []).filter((e) => (e.changes ?? []).length);
  if (!source.length) return [];
  const data = source.map((e) => {
    const raw = e.toObject();
    delete raw._id;
    raw.transfer = false;
    raw.disabled = false;
    raw.flags = foundry.utils.mergeObject(raw.flags ?? {}, {
      [MODULE_ID]: { fromClass: classItem.uuid },
    });
    return raw;
  });
  const made = await actor.createEmbeddedDocuments("ActiveEffect", data);
  return made ?? [];
}

export async function applyClass(
  actor,
  classItem,
  { level, confirm = true, rebuildVitals = false, grantAwards = false, answered = [], answers = {} } = {},
) {
  if (!actor || classItem?.type !== `${MODULE_ID}.class`) return { applied: false };
  if (classItem.system.isStub) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.apply.stub`, { name: classItem.name }));
    return { applied: false };
  }
  const targetLevel = level ?? Math.max(1, Number(actor.system?.details?.level) || 1);
  const { update, level: clamped, missing } = classUpdateData(actor, classItem, targetLevel);

  // Setting a level by hand leaves hit points and experience describing the
  // character you no longer have — a 4th-level thief keeping 1st-level hit
  // points and an experience total three bands away. The PICKER and CHARGEN
  // both ask for this — neither rolls hit dice of its own. The level-up wizard
  // never does: it has already rolled the one die it means to add, and a
  // rebuild underneath it would discard the roll the player watched.
  let hpSteps = null;
  if (rebuildVitals) {
    const previousLevel = Math.max(1, Number(actor.system?.details?.level) || 1);
    const built = await rebuildHitPoints(actor, classItem, clamped);
    hpSteps = built.steps;
    update["system.hp.max"] = built.max;
    // A rebuilt maximum with the old current value beside it reads as a wound
    // nobody took, so a fresh build arrives whole.
    update["system.hp.value"] = built.max;
    const xp = xpForLevel(classItem, clamped, previousLevel);
    if (xp != null) update["system.details.xp.value"] = xp;
  }

  // The stored ledger's dotted paths expanded into nested objects on write,
  // so lookups navigate with getProperty rather than key membership.
  const previous = actor.getFlag(MODULE_ID, FLAG_CLASSES)?.applied ?? null;
  const rows = [];
  for (const [path, next] of Object.entries(update)) {
    const now = currentAt(actor, path);
    if (now === next) continue;
    const prevVal = previous == null ? undefined : foundry.utils.getProperty(previous, path);
    const handEdited = prevVal !== undefined && prevVal !== now;
    rows.push({ path, from: now ?? "—", to: next, handEdited });
  }

  // Requirements gate: a demi-human class's minimums are checked, named, and
  // overridable — the Judge decides, the dialog informs.
  const unmet = (classItem.system.requirements ?? []).filter(
    (r) => r.attr && typeof r.min === "number" && (Number(actor.system?.scores?.[r.attr]?.value) || 0) < r.min,
  );
  const unmetNote = unmet.length
    ? `<p class="notification warning">${game.i18n.format(`${LANG_PREFIX}.apply.unmet`, {
        parts: unmet.map((r) => `${r.attr.toUpperCase()} ${r.min}`).join(", "),
      })}</p>`
    : "";

  // What the class owes a character who HOLDS this level, not merely one who
  // just reached it: every rung of the award ladder at or below it. A fixed
  // award the character already carries is dropped, so the dialog offers only
  // what would actually land.
  const takenAlready = actor.getFlag(MODULE_ID, FLAG_CLASSES)?.awardsTaken ?? [];
  const owed = grantAwards
    ? awardsThrough(actor, classItem, clamped, takenAlready)
    : { fixed: [], choices: [] };
  // Adventuring is free with every class (RR Ch. 3 §III.4) and is matched by
  // the importer's stamp OR by name, so whether it is owed is asked of the
  // document rather than of a constant.
  const adventuring = grantAwards ? adventuringDoc() : null;
  const owedAdventuring = !!adventuring && !ownsRef(actor, refOf(adventuring));
  const awardCount = owed.fixed.length + owed.choices.length + (owedAdventuring ? 1 : 0);

  /** Every rung answer this call knows about, keyed by award key: what a caller
   *  brought with it, plus whatever the dialog below collects. */
  const given = { ...answers };

  // A level whose numbers already agree can still owe abilities — re-applying
  // the same class at the same level is exactly how a character bound before
  // this catch-up existed gets what they were always owed.
  if (!rows.length && !awardCount) {
    ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.apply.noChanges`, { name: actor.name }));
  } else if (confirm) {
    const edited = game.i18n.localize(`${LANG_PREFIX}.apply.handEdited`);
    const list = rows
      .map(
        (r) =>
          `<tr${r.handEdited ? ' class="acks-extras-classes-hand-edited"' : ""}><td><code>${r.path}</code>${
            r.handEdited ? ` <em>(${edited})</em>` : ""
          }</td><td>${r.from}</td><td>${r.to}</td></tr>`,
      )
      .join("");
    // The abilities half of the dialog: what will be handed over, and one
    // picker per choice the ladder leaves open. A choice is asked here because
    // the level-up wizard only ever offers the rung it is climbing — a pick
    // owed at 2nd is unreachable forever once a character stands at 5th.
    const grantedNames = [
      ...(owedAdventuring ? [adventuring.name] : []),
      ...owed.fixed.map((a) => findByRef(a.ref)?.name ?? a.name ?? a.ref),
    ];
    // Every option this rung lists, the held ones marked rather than dropped —
    // a character bound at a level they have already played to answers most of
    // these rungs with a proficiency they are already carrying, and a list that
    // hides those leaves the rung answerable only by a pick to delete later.
    const choiceBlocks = owed.choices
      .map((a, index) =>
        rungSelectHtml({
          name: `award-${index}`,
          label: rungLabel(a),
          atLevel: a.atLevel ?? 1,
          options: rungOptions(a.choice, classItem, actor),
        }),
      )
      .join("");
    const awardsBlock = awardCount
      ? `<p><strong>${game.i18n.localize(`${LANG_PREFIX}.apply.awards`)}</strong></p>${
          grantedNames.length
            ? `<ul>${grantedNames.map((n) => `<li>${foundry.utils.escapeHTML(n)}</li>`).join("")}</ul>`
            : ""
        }${choiceBlocks}`
      : "";
    const content = `${unmetNote}<p>${game.i18n.format(`${LANG_PREFIX}.apply.prompt`, {
      actor: actor.name,
      class: classItem.name,
      level: clamped,
    })}</p>${
      rows.length
        ? `<p>${game.i18n.localize(`${LANG_PREFIX}.apply.fields`)}</p><table class="acks-extras-classes-diff"><tr><th></th><th>${game.i18n.localize(
            `${LANG_PREFIX}.apply.from`,
          )}</th><th>${game.i18n.localize(`${LANG_PREFIX}.apply.to`)}</th></tr>${list}</table>`
        : ""
    }${
      // The dice are shown, not just their conclusion — a rebuilt total is a
      // handful of rolls the player did not watch happen.
      hpSteps?.length
        ? `<p class="hint">${game.i18n.localize(`${LANG_PREFIX}.apply.hpRolls`)} ${hpSteps
            .map((s) => `${s.level}: ${s.formula} → ${s.total}`)
            .join(", ")}</p>`
        : ""
    }${awardsBlock}`;
    // This body is the longest in the subsystem — a change row per field, the
    // level-by-level hit dice, the owed abilities and a picker per open choice
    // — so it carries the module's scroll contract (`acks-extras-scroll`,
    // styles/lib.css). Without it core's `.window-content { overflow: hidden }`
    // cuts the content off at the window edge, taking the Yes button with it.
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.localize(`${LANG_PREFIX}.apply.title`), resizable: true },
      content,
      modal: true,
      // The yes button submits, so its callback is where the pickers can still
      // be read; returning the picks rather than `true` carries them out of the
      // dialog without a second surface to collect them.
      yes: {
        // One entry per offered rung, EMPTY included — the position is what
        // says which rung an answer belongs to.
        callback: (_event, button) => readRungs(button.form, "award-", owed.choices.length),
      },
    });
    if (!ok) return { applied: false };
    // The callback returns one entry per offered rung, in order, so position is
    // what says which rung an answer belongs to — resolved to its key here and
    // never carried as a position again.
    const picks = Array.isArray(ok) ? ok : [];
    owed.choices.forEach((choice, index) => {
      if (picks[index] !== undefined) given[choice.key] = picks[index];
    });
  }

  // A choice rung that was answered is remembered as answered, so re-applying
  // — the way a character collects what they were owed — adds what is missing
  // rather than asking every question a second time. "Already on the sheet"
  // closes a rung exactly as a pick does: the question has been answered, and
  // what closes it is not the same as what grants from it.
  const closed = [
    ...Object.entries(given)
      .filter(([, answer]) => closesRung(answer))
      .map(([key]) => key),
    ...answered,
  ];
  const applied = {};
  for (const [path, value] of Object.entries(update)) applied[path] = value;
  await actor.update({
    ...update,
    [`flags.${MODULE_ID}.${FLAG_CLASSES}`]: {
      uuid: classItem.uuid,
      key: classItem.system.key || classItem.name.toLowerCase(),
      appliedLevel: clamped,
      applied,
      ...(closed.length || grantAwards ? { awardsTaken: [...new Set([...takenAlready, ...closed])] } : {}),
    },
  });
  await syncClassTraining(actor, classItem);
  if (missing.length) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.apply.missing`, { parts: missing.join(", ") }));
  }

  // The abilities land AFTER the level does, so a granted ability reading the
  // character's level reads the one they now hold. Every grant dedupes by ref,
  // so nothing the character already carried is doubled.
  const grants = [];
  if (grantAwards) {
    await grantAdventuring(actor, grants);
    for (const a of owed.fixed) await grantAbility(actor, a.ref, grants);
    // "Already on the sheet" closes its rung without materializing anything,
    // and a ref the character already holds materializes nothing either —
    // `grantAbility` declines it — so a rung answered truthfully costs no item.
    for (const ref of grantableRefs(Object.values(given))) await grantAbility(actor, ref, grants);
    // Tongues ride the same path: the class's list and the bound race's ADD,
    // Intellect buys the open slots, and re-applying refreshes the carriers
    // rather than making a second pair (a character whose Intellect rose owes
    // more slots; one who already filled some keeps every entry).
    await grantLanguages(actor, classItem, grants);
    if (grants.length) {
      // What a character was handed is a record, not a toast — the same place
      // level-up and chargen put theirs. A ref the world cannot resolve is
      // named with a question mark rather than dropped in silence.
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${game.i18n.format(`${LANG_PREFIX}.apply.grantedChat`, {
          name: actor.name,
          class: classItem.name,
          level: clamped,
        })}</p><p>${grants
          .map((g) => foundry.utils.escapeHTML(g.missing ? `${g.name} (?)` : g.name))
          .join(", ")}</p>`,
      });
    }
  }
  return { applied: true, update, missing, grants };
}
