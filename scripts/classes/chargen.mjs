/* global game, foundry, Hooks, ChatMessage, fromUuid */
/**
 * Chargen: applying a starting template — the printed selection rule, the
 * Intellect accounting, and the named-item skinning layer.
 *
 * RAW (RR p.23): roll 3d6, then take the rolled template or any template
 * from a LOWER band, never a higher one; a Judge may allow a straight pick.
 * The rolling and the choosing happen on the character's own Scores Generator
 * ([stat-page.mjs](stat-page.mjs)); this file applies what was chosen —
 * proficiencies as owned abilities (a printed rank N grants N copies — the
 * family's taken-multiple-times convention), equipment as SKINS — the
 * printed descriptor becomes the item's name over the base item's mechanics
 * — coin as a money item, and the Intellect bonus general picks.
 *
 * Base resolution for a skin: an explicit ref (cookbook id / `name:<Item>` /
 * `uuid:`), else the longest world-item name contained in the descriptor.
 * What resolves to nothing imports as a bare named item — visible, never
 * dropped.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { findByRef } from "./registry.mjs";
import { applyClass } from "./apply.mjs";
import { grantAbility, grantAdventuring } from "./grants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The money items the system's own coin bookkeeping recognises, by name.
 *
 * `Actor#manageMoney` finds a coin pile BY NAME and by nothing else, so these
 * are the names a purse has to carry to be reachable afterwards.
 */
const PURSES = { gp: "gold", sp: "silver" };

/** Coin documents already found this session, by lowercased name. */
const _coinCache = new Map();

/**
 * The document a purse of this coin is made from.
 *
 * A money item built from nothing takes the schema's copper valuation whatever
 * coin it claims to be, and what a gold piece is worth is a value read off a
 * page — which no repo in this family ships. So the coin is CLONED from the
 * system's own item: the world directory first, then the compendia, which is
 * where a system keeps the coins it shipped.
 */
async function coinSource(name) {
  if (_coinCache.has(name)) return _coinCache.get(name);
  const matches = (i) => i.type === ITEM_TYPE.money && String(i.name).toLowerCase() === name;
  let found = game.items?.find(matches)?.toObject() ?? null;
  if (!found) {
    for (const pack of game.packs?.filter((p) => p.documentName === "Item") ?? []) {
      const index = await pack.getIndex({ fields: ["type"] }).catch((err) => {
        console.warn(`${MODULE_ID} | coin source: index of ${pack.metadata.id} unreadable`, err);
        return null;
      });
      const hit = index?.find((e) => e.type === ITEM_TYPE.money && String(e.name).toLowerCase() === name);
      if (!hit) continue;
      found = (await pack.getDocument(hit._id).catch((err) => {
        console.warn(`${MODULE_ID} | coin source: ${name} in ${pack.metadata.id} unreadable`, err);
        return null;
      }))?.toObject() ?? null;
      if (found) break;
    }
  }
  _coinCache.set(name, found);
  return found;
}

/** Coin written the way a page prints it: "34 gp, 5 sp", or "" for nothing. */
export const coinLine = (coin = {}) =>
  Object.keys(PURSES)
    .map((key) => (Number(coin[key]) ? `${Number(coin[key])} ${key}` : ""))
    .filter(Boolean)
    .join(", ");

/**
 * Put the starting coin in the character's purses.
 *
 * A pile built from nothing takes the schema's copper valuation rather than the
 * coin's own, so a missing purse is CLONED from the world's item of that name
 * and only its quantity set; an existing one is topped up rather than
 * duplicated. Whether a template pays the coin or a 3d6×10 roll does, it lands
 * here.
 *
 * @param {object} coin - amounts by denomination key (`gp`, `sp`)
 */
export async function grantCoin(actor, coin = {}) {
  for (const [key, name] of Object.entries(PURSES)) {
    const amount = Number(coin[key]) || 0;
    if (!amount) continue;
    const matches = (i) => i.type === ITEM_TYPE.money && i.name.toLowerCase() === name;
    const purse = actor.items.find(matches);
    if (purse) {
      await purse.update({ "system.quantity": (Number(purse.system.quantity) || 0) + amount });
      continue;
    }
    const data = (await coinSource(name)) ?? { name: name.replace(/^\w/, (c) => c.toUpperCase()), type: "money", system: {} };
    delete data._id;
    data.system = { ...(data.system ?? {}), quantity: amount };
    await actor.createEmbeddedDocuments("Item", [data]);
  }
}

/** Resolve a template item entry to its BASE world item (null = no base). */
export function resolveBase(entry) {
  if (entry.ref) {
    if (entry.ref.startsWith("name:")) {
      const name = entry.ref.slice(5);
      return game.items.find((i) => [ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item].includes(i.type) && i.name.toLowerCase() === name.toLowerCase()) ?? null;
    }
    const doc = findByRef(entry.ref);
    if (doc) return doc;
  }
  const f = fold(entry.name);
  let best = null;
  let bestLen = 0;
  for (const i of game.items) {
    if (![ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item].includes(i.type)) continue;
    const nf = fold(i.name);
    const nfStripped = fold(i.name.replace(/\([^)]*\)/g, " "));
    // The paren-stripped name is what an embellished instance contains:
    // "iron-shod spellbook…" holds "spellbook", never "(blank)".
    const hit =
      (nf.length >= 6 && f.includes(nf) && nf.length) ||
      (nfStripped.length >= 6 && f.includes(nfStripped) && nfStripped.length) ||
      0;
    if (hit > bestLen) {
      best = i;
      bestLen = hit;
    }
  }
  return best;
}

/**
 * What one template equipment entry is CALLED.
 *
 * The count lives on the quantity field — "2 flasks of holy water" is two of an
 * item called "Flasks of holy water", never one item with a numeral in its
 * name. The page that lists a package and the grant that materializes it read
 * this one rule, so neither says "3 javelins ×3".
 */
export function templateItemName(entry) {
  const printed = (entry.qty > 1 ? String(entry.name ?? "").replace(/^\d+\s+/, "") : String(entry.name ?? "")).replace(
    /^\w/,
    (c) => c.toUpperCase(),
  );
  return entry.skinName || printed;
}

/** Build the embedded-item payload for one template item entry (skinned). */
function skinPayload(entry) {
  const base = resolveBase(entry);
  const skinName = templateItemName(entry);
  if (!base) {
    return {
      name: skinName,
      type: "item",
      system: { quantity: { value: entry.qty || 1, max: 0 } },
      flags: { [MODULE_ID]: { skin: { base: null, descriptor: entry.name } } },
    };
  }
  const data = base.toObject();
  delete data._id;
  data.name = skinName;
  foundry.utils.setProperty(data, "system.quantity.value", entry.qty || 1);
  // The instance layer: which generic this is an embellished example of, and
  // the embellishment on its own — the descriptor with the base's name (or
  // its paren-stripped form) excised: "Crudely-crafted shortbow" over Short
  // Bow leaves "Crudely-crafted".
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  let embellishment = "";
  {
    const words = String(entry.name).split(/\s+/);
    const baseFolds = [fold(base.name), fold(base.name.replace(/\([^)]*\)/g, " "))].filter((x) => x.length >= 4);
    // Drop the shortest run of trailing/leading words whose fold matches the
    // base; whatever remains is the embellishment.
    for (let start = 0; start < words.length && !embellishment; start++) {
      for (let end = words.length; end > start; end--) {
        const seg = fold(words.slice(start, end).join(""));
        if (baseFolds.some((b) => seg === b)) {
          embellishment = [...words.slice(0, start), ...words.slice(end)].join(" ").replace(/^[\s,-]+|[\s,-]+$/g, "");
          break;
        }
      }
    }
  }
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: {
      skin: {
        base: entry.ref || `uuid:${base.uuid}`,
        baseName: base.name,
        descriptor: entry.name,
        ...(embellishment ? { embellishment } : {}),
      },
    },
  };
  return data;
}

/** INT-based bonus general picks per the RR sidebar (13–15/16–17/18). */
export function intBonusPicks(intScore) {
  if (intScore >= 18) return 3;
  if (intScore >= 16) return 2;
  if (intScore >= 13) return 1;
  return 0;
}

/**
 * The general picks the PLAYER still gets to make, after what the template has
 * already spent.
 *
 * Most templates assume no Intellect bonus (RR Ch. 2 §II.1: "we assumed that
 * the character had an Intellect score of 12 or less"), so the whole bonus is
 * theirs. A studious spellcaster's templates assume one, so a character in the
 * 13–15 band has already been given it and chooses nothing further.
 */
export const netBonusPicks = (intScore, assumed = 0) =>
  Math.max(0, intBonusPicks(intScore) - (Number(assumed) || 0));

/**
 * What a template hands out that its character cannot hold.
 *
 * A studious spellcaster below the band its templates assume "has more
 * proficiencies and spells than the character is eligible to possess", and the
 * book says which to remove: the bonus proficiency is the one listed LAST and
 * the bonus spell is the one listed SECOND. Returns how many of each to drop —
 * zero for every class whose templates assume nothing, which is most of them.
 */
export function templateShortfall(intScore, assumed = 0) {
  const short = Math.max(0, (Number(assumed) || 0) - intBonusPicks(intScore));
  return { profs: short, spells: short };
}

/** Grant one ability ref N times (rank N = N copies, the family convention). */
async function grantRanked(actor, entry, report) {
  const source = findByRef(entry.ref);
  if (!source) {
    report.unresolved.push(entry.name || entry.ref);
    return;
  }
  const data = source.toObject();
  delete data._id;
  if (entry.selection) data.name = `${data.name} (${entry.selection})`;
  const copies = Array.from({ length: Math.max(1, entry.rank || 1) }, () => foundry.utils.deepClone(data));
  await actor.createEmbeddedDocuments("Item", copies);
  report.granted.push(copies.length > 1 ? `${data.name} ×${copies.length}` : data.name);
}

/**
 * Apply one template's full bundle to the actor.
 *
 * @param {object} [options]
 * @param {number|null} [options.gold] the coin actually granted; the printed
 *   `gp` when nothing overrides it (the page shows the figure it will write,
 *   and a Judge may set it there)
 */
export async function applyTemplate(actor, classItem, template, { generalRefs = [], intScore = null, gold = null } = {}) {
  const gp = Number(gold ?? template.gp) || 0;
  const sp = Number(template.sp) || 0;
  const report = { granted: [], items: [], unresolved: [], gp, sp, dropped: [] };
  // A template that assumes an Intellect bonus its character does not have
  // prints more than they may hold. The book names the entries to remove
  // rather than leaving it to taste — the LAST proficiency and the SECOND
  // spell — so the drop is positional, taken before anything is granted.
  const assumed = classItem?.system?.templatesAssumeIntBonus ?? 0;
  const short = intScore == null ? { profs: 0, spells: 0 } : templateShortfall(intScore, assumed);

  let abilities = [...(template.abilities ?? [])];
  if (short.profs > 0) {
    const kept = abilities.slice(0, Math.max(0, abilities.length - short.profs));
    for (const gone of abilities.slice(kept.length)) report.dropped.push(gone.name || gone.ref);
    abilities = kept;
  }
  for (const entry of abilities) {
    if (entry.ref) await grantRanked(actor, entry, report);
    else if (entry.name) report.unresolved.push(entry.name);
  }
  const payloads = (template.items ?? []).map(skinPayload);
  if (payloads.length) {
    await actor.createEmbeddedDocuments("Item", payloads);
    report.items = payloads.map((p) => (p.system?.quantity?.value > 1 ? `${p.name} ×${p.system.quantity.value}` : p.name));
  }
  // The template names the coin a character starts with, so this is the one
  // write of it. Core's own gold row adds to a money item the character ALREADY
  // owns and returns silently when they own none — which is every character
  // being generated — so there is nothing here to double.
  await grantCoin(actor, { gp, sp });
  // The spells a spellbook carries land as spell ITEMS — a linked uuid first,
  // else the printed name matched against the world's spells; what no world
  // spell answers to stays visible on the unresolved list.
  // The bonus spell is the one listed SECOND, so a shortfall removes that
  // entry rather than the last — the spellbook's first spell is the one every
  // character of the class begins with.
  let spells = [...(template.spells ?? [])];
  if (short.spells > 0 && spells.length > 1) {
    const removed = spells.splice(1, Math.min(short.spells, spells.length - 1));
    for (const gone of removed) report.dropped.push(gone.name || gone.uuid);
  }
  for (const s of spells) {
    const name = s.name ?? "";
    let doc = null;
    if (s.uuid) doc = await fromUuid(s.uuid).catch(() => null);
    if (!doc && name) {
      const f = fold(name);
      doc =
        game.items.find((i) => i.type === ITEM_TYPE.spell && fold(i.name) === f) ??
        game.items.find((i) => i.type === ITEM_TYPE.spell && f.length >= 6 && fold(i.name).includes(f)) ??
        null;
    }
    if (doc) {
      const data = doc.toObject();
      delete data._id;
      await actor.createEmbeddedDocuments("Item", [data]);
      report.granted.push(doc.name);
    } else if (name) {
      report.unresolved.push(name);
    }
  }
  for (const ref of generalRefs) await grantRanked(actor, { ref, rank: 1 }, report);
  return report;
}

/** The templates a 3d6 roll legally offers: the rolled band and every lower one. */
export const legalTemplates = (templates, roll) =>
  templates.filter((t) => t.rollMin <= roll).sort((a, b) => a.rollMin - b.rollMin);

/**
 * Apply a chosen class and template to a character.
 *
 * The CHOOSING happens on the character's own Scores Generator (stat-page.mjs)
 * — the page that already rolls the attributes and the template die — so this
 * takes the decisions rather than asking for them. Keeping it separate is what
 * lets the same sequence be driven from a page, a macro or a test.
 *
 * Order matters: the class lands first so the template's grants sit on a
 * character who already has their level-1 row, and the class's own first-level
 * awards land last so `grantAbility`'s dedupe can see what the template
 * already gave.
 *
 * @param {object} [options]
 * @param {boolean} [options.wipe] clear what the character already holds
 *   first. Generating a character REPLACES the last run of the page, so a
 *   class rerolled is a character rebuilt rather than a character carrying two
 *   starting packages. A Judge who means to add a second one says so on the
 *   page.
 */
export async function applyChargen(
  actor,
  cls,
  template,
  { generalRefs = [], awardPicks = [], roll = null, gold = null, wipe = true } = {},
) {
  if (!actor || !cls) return null;
  const intScore = Number(actor.system?.scores?.int?.value) || 0;

  if (wipe) {
    const ids = actor.items.map((i) => i.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  }

  // Chargen rolls no hit dice of its own, so the 1st-level total is built here:
  // one roll of the class's own die with Constitution applied per die and its
  // floor of one (hitpoints.mjs). Without it a generated character keeps
  // whatever hit points the bare actor was created with — no die, no floor and
  // no Constitution.
  await applyClass(actor, cls, { level: 1, confirm: false, rebuildVitals: true });

  // No template is a build made the Judges Journal's way (JJ Ch. 16,
  // Generating Characters without Templates): no package, so no equipment and
  // no spellbook, every proficiency the character is owed chosen rather than
  // printed, and 3d6×10 gold to outfit themselves with.
  let report;
  if (template) {
    report = await applyTemplate(actor, cls, template, { generalRefs, intScore, gold });
  } else {
    report = { granted: [], items: [], unresolved: [], gp: Number(gold) || 0, sp: 0, dropped: [] };
    for (const ref of generalRefs) await grantRanked(actor, { ref, rank: 1 }, report);
    await grantCoin(actor, { gp: report.gp });
  }
  // The class's own first-level awards land with the template: every fixed
  // award granted, every pick taken above granted as chosen. grantAbility
  // dedupes by ref, so a power the template already carried is not doubled.
  const startingGrants = [];
  // Adventuring is free with every class (RR Ch. 3 §III.4), so it is granted
  // rather than offered as a pick.
  await grantAdventuring(actor, startingGrants);
  for (const a of (cls.system.awards ?? []).filter((x) => x.atLevel === 1 && x.kind === "fixed" && x.ref)) {
    await grantAbility(actor, a.ref, startingGrants);
  }
  for (const ref of awardPicks ?? []) {
    await grantAbility(actor, ref, startingGrants);
  }
  report.granted.push(...startingGrants.filter((g) => !g.missing).map((g) => g.name));
  report.unresolved.push(...startingGrants.filter((g) => g.missing).map((g) => g.name));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.chargen.chat`, {
      name: actor.name,
      class: cls.name,
      template: template?.name ?? game.i18n.localize(`${LANG_PREFIX}.chargen.manualPackage`),
      roll: roll ?? "—",
    })}</p><p>${[...report.granted, ...report.items].map((n) => foundry.utils.escapeHTML(n)).join(", ")}${
      coinLine(report) ? ` — ${coinLine(report)}` : ""
    }</p>${
      // What the template printed but this character may not hold is said out
      // loud — a silently shorter starting package reads as a missing import.
      report.dropped.length
        ? `<p><em>${game.i18n.localize(`${LANG_PREFIX}.chargen.dropped`)}</em> ${report.dropped
            .map((n) => foundry.utils.escapeHTML(n))
            .join(", ")}</p>`
        : ""
    }${report.unresolved.length ? `<p><em>?</em> ${report.unresolved.map((n) => foundry.utils.escapeHTML(n)).join(", ")}</p>` : ""}`,
  });
  return report;
}

/** A skinned item's sheet names what it is an instance of. */
function onRenderItemSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  const skin = doc?.flags?.[MODULE_ID]?.skin;
  if (!skin?.baseName || root.querySelector(".acks-extras-classes-skinbadge")) return;
  const badge = document.createElement("p");
  badge.className = "acks-extras-classes-skinbadge hint";
  badge.textContent = skin.embellishment
    ? game.i18n.format(`${LANG_PREFIX}.skin.badgeEmbellished`, { embellishment: skin.embellishment, base: skin.baseName })
    : game.i18n.format(`${LANG_PREFIX}.skin.badge`, { base: skin.baseName });
  const anchor = root.querySelector(".sheet-header, header") ?? root.firstElementChild;
  anchor?.insertAdjacentElement("afterend", badge);
}

/**
 * Register the chargen hooks (called once from classes/module.mjs).
 *
 * There is no dice control beside the class picker any more: the character's
 * own Scores Generator already rolls the attributes and the template die, so a
 * second button opening a second dialog asked the same questions twice and
 * rolled the template a second time. The page carries the whole of chargen
 * (stat-page.mjs); what remains here is the skin badge.
 */
export function registerChargen() {
  Hooks.on("renderApplicationV2", onRenderItemSheet);
}
