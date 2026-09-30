/* global game, foundry */
/**
 * The Class tab's data: the class document with its level and title, the
 * XP pair, and — while the XP bar is full — what the next level brings,
 * previewed from the same `classUpdateData` the level-up writes with, so the
 * preview and the write cannot disagree. Nothing here writes; the Level up
 * button opens the wizard.
 */
import { LANG, MODULE_ID } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { classForActor, findByRef } from "../../classes/registry.mjs";
import { classUpdateData } from "../../classes/apply.mjs";
import { awardsAt } from "../../classes/grants.mjs";
import { pathGroups, chosenOption, actorPaths, groupLabel } from "../../classes/paths.mjs";
import { FLAG_CLASSES } from "../../classes/constants.mjs";
import { xpBar, storedSystem } from "../view-model.mjs";
import { xpBonusFor } from "../../classes/xp-bonus.mjs";
import { playerOf, ledgerOf } from "../../classes/legacy.mjs";
import { legacyTotals } from "../../classes/legacy-logic.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** A readable label for a path the class row writes, or null to skip it. */
function fieldLabel(key) {
  const m = /^system\.saves\.([a-z]+)\.value$/.exec(key);
  if (m) return game.i18n.localize(`ACKS.saves.${m[1]}.long`);
  const s = /^system\.spells\.(\d+)\.max$/.exec(key);
  if (s) return loc("class.spellsAt", { n: s[1] });
  const labels = {
    "system.thac0.throw": game.i18n.localize("ACKS.ABShort"),
    "system.hp.hd": game.i18n.localize("ACKS.HitDice"),
    "system.fight.cleaves": game.i18n.localize("ACKS.Cleaves"),
    "system.details.title": game.i18n.localize("ACKS.details.title"),
    "system.details.xp.next": game.i18n.localize("ACKS.details.experience.next"),
    "system.damage.mod.melee": loc("class.meleeDamage"),
    "system.damage.mod.missile": loc("class.missileDamage"),
  };
  return labels[key] ?? null;
}

/** What the class row for `level` would change, against the sheet as it is. */
function previewRow(actor, classItem, level) {
  let update = {};
  try {
    ({ update } = classUpdateData(actor, classItem, level));
  } catch {
    update = {};
  }
  const deltas = [];
  for (const [key, to] of Object.entries(update ?? {})) {
    const label = fieldLabel(key);
    if (!label) continue;
    const from = foundry.utils.getProperty(actor, key);
    if (String(from ?? "") === String(to ?? "")) continue;
    deltas.push({ label, from: from ?? "—", to });
  }
  return deltas;
}

/**
 * The experience adjustment as the XP label's note: "+5% · CON" read from the
 * key attribute, "+5% · Tweaks" typed by the Judge, or a pointer at the import
 * when the class names key attributes and no table has been read.
 */
function bonusNote(actor) {
  const b = xpBonusFor(actor);
  if (b.source) {
    const from = b.source === "tweaks" ? loc("class.xpBonusTweaks") : b.attrLabel;
    return { text: `${b.bonus > 0 ? "+" : ""}${b.bonus}% · ${from}`, hint: loc(b.source === "tweaks" ? "class.xpBonusTweaksHint" : "class.xpBonusHint") };
  }
  if (b.unread) return { text: loc("class.xpBonusUnread"), hint: loc("class.xpBonusUnreadHint") };
  return null;
}

/** The character's player's reserve fund in XP, or null where there is no player or nothing recorded. */
function legacyFund(actor) {
  const user = playerOf(actor);
  if (!user) return null;
  const { fund, funerals } = legacyTotals(ledgerOf(user));
  return fund || funerals ? fund + funerals : null;
}

/** Build the tab's data. */
export function buildClassTab(actor) {
  const sys = actor.system ?? {};
  // The inputs render `stored`; the level the tab reasons about is `sys`'s.
  const stored = storedSystem(actor);
  const classItem = classForActor(actor);
  const level = Math.max(1, num(sys.details?.level, 1));
  const threshold = classItem ? classItem.system.nextXp?.(level) : null;
  const xp = xpBar({ value: sys.details?.xp?.value, next: threshold ?? sys.details?.xp?.next });
  const out = {
    bound: !!classItem,
    className: classItem?.name ?? String(sys.details?.class ?? ""),
    img: classItem?.img ?? null,
    uuid: classItem?.uuid ?? null,
    level,
    levelField: num(stored.details?.level, 1),
    title: String(sys.details?.title ?? ""),
    maxLevel: classItem?.system?.maximumLevel ?? null,
    xp: { ...xp, bonus: bonusNote(actor), share: num(sys.details?.xp?.share, 100), valueField: num(stored.details?.xp?.value), nextField: num(stored.details?.xp?.next) },
    full: xp.full && !!classItem,
    atCap: !!classItem && level >= (classItem.system?.maximumLevel || 14),
    nextLevel: level + 1,
    preview: null,
    paths: [],
    editable: actor.isOwner,
    isNew: !!sys.isNew,
    reserveFund: legacyFund(actor),
  };
  if (classItem) {
    const taken = actor.getFlag(MODULE_ID, FLAG_CLASSES)?.awardsTaken ?? [];
    let fixed = [];
    let choices = [];
    try {
      ({ fixed, choices } = awardsAt(actor, classItem, level + 1, taken));
    } catch {
      fixed = [];
      choices = [];
    }
    out.preview = {
      deltas: out.atCap ? [] : previewRow(actor, classItem, level + 1),
      granted: fixed.map((a) => findByRef(a.ref)?.name ?? a.name ?? a.ref),
      choices: choices.map((a) => a.choice?.label || a.name || loc("class.aChoice")),
    };
    const selections = actorPaths(actor);
    out.paths = pathGroups(classItem.system).filter((g) => g.options.length).map((g) => {
      const chosen = chosenOption(classItem.system, g.key, selections[g.key]);
      return { key: g.key, label: groupLabel(g), chosen: chosen?.label ?? chosen?.name ?? null, options: g.options.map((o) => ({ key: o.key, label: o.label ?? o.name ?? o.key, on: chosen?.key === o.key })) };
    });
  }
  return out;
}
