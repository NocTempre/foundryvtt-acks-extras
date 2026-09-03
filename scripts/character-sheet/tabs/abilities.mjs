/* global game */
/**
 * The Abilities tab's data: proficiencies, powers and languages filed by
 * bucket, each row carrying one d20 per throw the ability offers (the
 * abilities feature's roller, never core's singleton), a pending pick shown
 * where the choice will land, and the open language slots as a pick.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { abilityBucket, racialRefsOf, ABILITY_BUCKETS } from "../../classes/sheet-tabs.mjs";
import { FLAG_PENDING_CHOICE } from "../../classes/constants.mjs";
import { isLanguageSlots, freeSlots, filledLanguages } from "../../classes/languages.mjs";
import { rollsOf, keyOf, throwText, labelOf } from "../../abilities/ability-rolls.mjs";
import { isProfileAbility } from "../../lib/proficiency-strip.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";

const loc = makeLoc(LANG);

const bucketLabel = (cat) => game.i18n.localize(`ACKS-CLASSES.cattabs.${cat}`);

/** Build the tab's data. `filter` is the bucket the viewer picked, or "all". */
export function buildAbilitiesTab(actor, { filter = "all" } = {}) {
  const racial = racialRefsOf(actor);
  const abilities = actor.items.filter((i) => i.type === ITEM_TYPE.ability || i.type === ITEM_TYPE.language);

  const pending = [];
  const byBucket = new Map(ABILITY_BUCKETS.map((k) => [k, []]));
  for (const item of abilities) {
    if (item.getFlag(MODULE_ID, FLAG_PENDING_CHOICE)) {
      pending.push({ id: item.id, name: item.name, img: item.img });
      continue;
    }
    if (isLanguageSlots(item)) continue; // the carrier is rendered as its open slots below
    const cat = abilityBucket(item, racial);
    const rolls = rollsOf(item);
    byBucket.get(cat)?.push({
      id: item.id,
      name: item.name,
      img: item.img,
      cat,
      line: item.type === ITEM_TYPE.language ? "" : String(item.system?.requirements ?? ""),
      throws: rolls.map((r, i) => ({ id: `abl:${item.id}:${keyOf(r, i)}`, label: rolls.length > 1 ? r.label || labelOf(r) || "" : "", value: throwText(r, actor, item) })),
      favorite: !!item.system?.favorite,
      profile: isProfileAbility(item),
      hidden: filter !== "all" && filter !== cat,
      editable: actor.isOwner,
    });
  }

  const carriers = actor.items.filter(isLanguageSlots).map((item) => ({
    id: item.id,
    name: item.name,
    free: freeSlots(item),
    filled: filledLanguages(item).map((l) => l.name),
  }));
  const openSlots = carriers.reduce((n, c) => n + c.free, 0);

  const groups = ABILITY_BUCKETS.filter((k) => byBucket.get(k).length || (k === "language" && openSlots)).map((key) => ({
    key,
    label: bucketLabel(key),
    rows: byBucket.get(key),
    n: byBucket.get(key).length,
    hidden: filter !== "all" && filter !== key,
    openSlots: key === "language" ? openSlots : 0,
    carriers: key === "language" ? carriers.filter((c) => c.free > 0) : [],
  }));

  const filters = [{ key: "all", label: game.i18n.localize("ACKS-CLASSES.cattabs.all"), n: abilities.length - pending.length - carriers.length, on: filter === "all" }];
  for (const g of groups) filters.push({ key: g.key, label: g.label, n: g.n, on: filter === g.key });

  return {
    filters: filters.length > 2 ? filters : [],
    groups,
    pending,
    pendingNote: pending.length ? loc("abilities.pendingNote") : "",
    editable: actor.isOwner,
    empty: !groups.length && !pending.length,
  };
}
