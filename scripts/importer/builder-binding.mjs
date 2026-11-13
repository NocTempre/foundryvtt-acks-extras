/* global game, Item */
/**
 * Class-builder binding: raw `acks.classBuilder` extractions → the assembled
 * shape the classes builder engine consumes, plus the two world writes that
 * make the Ready-for-Play examples work after import — race Items
 * (`RACE_TYPE`, stamped `def.race.<key>`) and builder state on the matching
 * class documents.
 *
 * The assembly functions are pure (Node tests run them against the reference
 * PDFs); only the appliers at the bottom touch Foundry. Every number here is
 * ALREADY world data — extracted from the seat's own book by the table
 * import — so reshaping it is mechanical, never a promotion.
 */
import { cookbookContentFile, createDoc, ensureItemFolder, importedDocs, importedItemFor, importedItemsByName, refForPrintedName } from "./cookbook.mjs";
import { MODULE_ID } from "./constants.mjs";
import { foldLabel, printKey, titleCaseHeading } from "./printed-name.mjs";
import { countRepair, unrepaired } from "./refresh.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";
import { CLASS_TYPE, RACE_TYPE as RACE_ITEM_TYPE } from "../classes/constants.mjs";

const BUILDER_DOC_ID = "acks.classBuilder";

/**
 * The engine tables this binding assembles, each with the raw table(s) it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [BUILDER_DOC_ID]: {
    budget: ["basePoints", "savesRule", "smoothing", "xpRules", "hpAfterNine", "racialCaps", "proficiencyCount", "tradeoffPenalty"],
    hd: "hdRaw",
    fighting: "fightingRaw",
    thievery: "thieveryRaw",
    magicTypes: [
      "divineRaw", "divineSlots1", "divineSlots2", "divineSlots3", "divineSlots4",
      "arcaneRaw", "arcaneSlots1", "arcaneSlots2", "arcaneSlots3", "arcaneSlots4",
      "arcaneDelayed1", "arcaneDelayed2", "arcaneDelayed3", "savesRule",
    ],
    tradeoffs: "tradeoffsRaw",
  },
});

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const int = (s) => {
  const m = String(s ?? "").match(/-?\d[\d,]*/);
  return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
};

/** "+2 per 3 levels" → { step: 2, every: 3 }; "none"/blank → null. */
export function parseProgression(text) {
  const m = String(text ?? "").match(/\+?\s*(\d+)\s*per\s*(\d+)/i);
  return m ? { step: Number(m[1]), every: Number(m[2]) } : null;
}

/** "1 per level" → full; "1 per 2 levels" → half; "none" → none. */
export function parseCleaves(text) {
  const t = String(text ?? "").toLowerCase();
  if (/per\s*2/.test(t)) return "half";
  if (/per\s*level/.test(t)) return "full";
  if (/none/.test(t)) return "none";
  return "";
}

/** "150% Power" → 1.5; "no …" → 0; unparsable → null. */
export function parseFraction(text) {
  const t = String(text ?? "");
  const m = t.match(/(\d+)\s*%/);
  if (m) return Number(m[1]) / 100;
  if (/no\s/i.test(t) || /none/i.test(t)) return 0;
  return null;
}

/** A raw slot grid ({"1": {s1..casterLevel}, …}) → ordered slot rows. */
export function gridToRows(grid) {
  return Object.entries(grid ?? {})
    .filter(([, row]) => row && !row.__missing)
    .map(([level, row]) => ({
      atLevel: Number(level),
      s1: row.s1 ?? null,
      s2: row.s2 ?? null,
      s3: row.s3 ?? null,
      s4: row.s4 ?? null,
      s5: row.s5 ?? null,
      s6: row.s6 ?? null,
      casterLevel: row.casterLevel ?? null,
    }))
    .sort((a, b) => a.atLevel - b.atLevel);
}

/** The mapping sentence's `<chassis> for <category>` pairs → {category: chassis} (JJ p. 297). */
export function parseSavesMap(text) {
  const out = {};
  for (const m of String(text ?? "").matchAll(/\b(fighter|thief|crusader|mage)\s+for\s+(\w+)/gi)) {
    out[m[2].toLowerCase()] = m[1].toLowerCase();
  }
  return out;
}

/** The precedence sentence's comma-and-"then" list of categories → an ordered array of category keys (JJ p. 297). */
export const parseSavesPrecedence = (text) =>
  String(text ?? "")
    .split(/,|\bthen\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]+$/.test(s));

/** The printed style beside a fighting value, when it names a chassis. */
const chassisOfStyle = (style) => {
  const m = String(style ?? "").toLowerCase().match(/mage|crusader|thief|fighter/);
  return m ? m[0] : "";
};

/**
 * The races the builder reads, in JJ ch. 12's order, each with the name it
 * goes by when its ladder's value-0 label was not read. Every one reads its
 * tables under its own key: `<key>Raw` (the ladder), `<key>Powers` (the
 * value-0 powers), `<key>Rules` (post-8 increments, stacking, floors).
 */
const RACES = [
  { key: "dwarf", fallback: "Dwarf" },
  { key: "elf", fallback: "Elf" },
  { key: "people1", fallback: "People 1" },
  { key: "people2", fallback: "People 2" },
];

/** The attribute keys a race's floor may name, as `raceRequirements.<race><Attr>` or `<race>Rules.<attr>`. */
const FLOOR_ATTRS = ["str", "int", "wis", "dex", "con", "cha"];

/**
 * Assemble the engine-shaped tables from the raw extractions. Missing raw
 * tables simply leave their assembled key absent — the extras engine names
 * every gap itself.
 */
export function assembleBuilderTables(raw) {
  const out = {};

  // --- budget ---
  const budget = {};
  if (isNum(raw.basePoints?.basePoints)) budget.basePoints = raw.basePoints.basePoints;
  if (raw.savesRule?.precedence) budget.savesPrecedence = parseSavesPrecedence(raw.savesRule.precedence);
  if (isNum(raw.smoothing?.level) && isNum(raw.smoothing?.nearest)) budget.smoothing = { level: raw.smoothing.level, nearest: raw.smoothing.nearest };
  if (raw.xpRules && [raw.xpRules.crusaderThief, raw.xpRules.fighter, raw.xpRules.mage].every(isNum)) {
    budget.postEight = { crusaderThief: raw.xpRules.crusaderThief, fighter: raw.xpRules.fighter, mage: raw.xpRules.mage };
  }
  // The level those increments start after is a read of its own: missing it
  // costs the schedule past the 2nd level, never the increments.
  if (isNum(raw.xpRules?.afterLevel)) budget.xpFlatAfter = raw.xpRules.afterLevel;
  // The HIT-POINT rates past the last die level pair the chassis differently from the
  // post-8th XP increments above — crusader+mage and fighter+thief, not
  // crusader+thief / fighter / mage — so the two cannot share keys. The
  // printed pairing is kept here and expanded by the consumer, as postEight
  // is. All-or-nothing: both rates come from one sentence on one page, so a
  // half-read is a broken read and must not present as a complete one. The
  // level they begin after is a read of its own: missing it costs the dice
  // cells, never the rates, and missing a rate never costs it.
  const hp = {};
  if ([raw.hpAfterNine?.crusaderMage, raw.hpAfterNine?.fighterThief].every(isNum)) {
    hp.crusaderMage = raw.hpAfterNine.crusaderMage;
    hp.fighterThief = raw.hpAfterNine.fighterThief;
  }
  if (isNum(raw.hpAfterNine?.afterLevel)) hp.afterLevel = raw.hpAfterNine.afterLevel;
  if (Object.keys(hp).length) budget.hpAfterNine = hp;
  if (raw.racialCaps) {
    budget.racialCaps = Object.entries(raw.racialCaps)
      .filter(([, r]) => r && !r.__missing && isNum(r.maxLevel))
      .map(([points, r]) => ({ points: Number(points), maxLevel: r.maxLevel }));
  }
  // A human class's maximum level. No page states it outright: JJ 297 prints
  // the class list's proficiency count as a total less the maximum level, and
  // gives the count a typical class ends up with. That a typical class is a
  // human one is this module's inference (docs/classes/DECISIONS.md), so the
  // cap exists only when both integers were read and the difference is a level.
  if (isNum(raw.proficiencyCount?.total) && isNum(raw.proficiencyCount?.typical) && raw.proficiencyCount.total - raw.proficiencyCount.typical >= 1) {
    budget.humanMaxLevel = raw.proficiencyCount.total - raw.proficiencyCount.typical;
  }
  if (isNum(raw.tradeoffPenalty?.perPower)) budget.tradeInXp = raw.tradeoffPenalty.perPower;
  if (Object.keys(budget).length) out.budget = budget;

  // --- hd ---
  if (raw.hdRaw) {
    out.hd = Object.entries(raw.hdRaw)
      .filter(([, r]) => r && !r.__missing)
      .map(([value, r]) => ({
        value: Number(value),
        die: String(r.die ?? "").replace(/[()\s]/g, ""),
        mortalWounds: r.mortalWounds ?? 0,
        cost: r.cost ?? null,
      }))
      .sort((a, b) => a.value - b.value);
  }

  // --- fighting ---
  if (raw.fightingRaw) {
    out.fighting = Object.entries(raw.fightingRaw)
      .filter(([, r]) => r && !r.__missing)
      .map(([key, r]) => ({
        value: parseInt(key, 10),
        sub: key.replace(/^\d+/, ""),
        label: String(r.style ?? "").replace(/[()]/g, ""),
        cost: r.cost ?? null,
        attackAs: chassisOfStyle(r.style),
        attack: parseProgression(r.attack),
        damage: parseProgression(r.damage),
        cleaves: parseCleaves(r.cleaves),
        styles: r.styles ?? null,
        weapons: String(r.weapons ?? ""),
        armor: String(r.armor ?? ""),
      }))
      .sort((a, b) => a.value - b.value || a.sub.localeCompare(b.sub));
  }

  // --- thievery ---
  if (raw.thieveryRaw) {
    out.thievery = Object.entries(raw.thieveryRaw)
      .filter(([, r]) => r && !r.__missing)
      .map(([value, r]) => ({ value: Number(value), skills: int(r.skills) ?? 0, cost: r.cost ?? null }))
      .sort((a, b) => a.value - b.value);
  }

  // --- magicTypes: divine + arcane, printed grids attached per value ---
  const savesMap = parseSavesMap(raw.savesRule?.mapping);
  const magicType = (label, key, valuesRaw, slotsByValue, delayedByValue) => {
    if (!valuesRaw) return null;
    const values = Object.entries(valuesRaw)
      .filter(([, r]) => r && !r.__missing)
      .map(([value, r]) => {
        const row = { value: Number(value), cost: r.cost ?? null, fraction: parseFraction(r.power) };
        const slots = slotsByValue?.[row.value];
        if (slots?.length) row.slots = slots;
        const delayed = delayedByValue?.[row.value];
        if (delayed?.length) row.delayedSlots = delayed;
        return row;
      })
      .sort((a, b) => a.value - b.value);
    return { label, kind: "vancian", repertoire: "", savesAs: savesMap[key] ?? "", progenitor: savesMap[key] ?? "", values };
  };
  const magicTypes = {};
  const divine = magicType("Divine", "divine", raw.divineRaw, {
    1: gridToRows(raw.divineSlots1),
    2: gridToRows(raw.divineSlots2),
    3: gridToRows(raw.divineSlots3),
    4: gridToRows(raw.divineSlots4),
  });
  if (divine) magicTypes.divine = divine;
  const arcane = magicType(
    "Arcane",
    "arcane",
    raw.arcaneRaw,
    { 1: gridToRows(raw.arcaneSlots1), 2: gridToRows(raw.arcaneSlots2), 3: gridToRows(raw.arcaneSlots3), 4: gridToRows(raw.arcaneSlots4) },
    { 1: gridToRows(raw.arcaneDelayed1), 2: gridToRows(raw.arcaneDelayed2), 3: gridToRows(raw.arcaneDelayed3) },
  );
  if (arcane) magicTypes.arcane = arcane;
  if (Object.keys(magicTypes).length) out.magicTypes = magicTypes;

  // --- tradeoffs ---
  if (raw.tradeoffsRaw) {
    const per = isNum(budget.tradeInXp) ? budget.tradeInXp : 0;
    out.tradeoffs = Object.entries(raw.tradeoffsRaw)
      .filter(([, r]) => r && !r.__missing)
      .map(([key, r]) => {
        const powersGained = int(r.benefit) ?? 1;
        const weapon = key.startsWith("weapons.");
        return {
          key,
          label: key
            .replace(/^armor\./, "Armour: ")
            .replace(/^weapons\./, "Weapons: ")
            .replace(/^style\./, "Style: ")
            .replace(/^damage\./, "Damage: ")
            .replace(/([a-z])([A-Z])/g, "$1 → $2"),
          powersGained,
          // The printed penalty applies to weapon narrowing, and only once a
          // class fights at value 2 or higher.
          xpDelta: weapon ? per * powersGained : 0,
          xpDeltaMinFighting: weapon ? 2 : 0,
        };
      });
  }

  // --- races ---
  const races = {};
  for (const { key, fallback } of RACES) {
    const ladder = raw[`${key}Raw`];
    if (!ladder) continue;
    const rules = raw[`${key}Rules`] ?? {};
    // The value-0 rung grants the race's base powers: the run-in labels its
    // page prints under the ladder, as the reader's book spells them.
    const powerNames = (raw[`${key}Powers`]?.powers ?? []).map((p) => p.label).filter(Boolean);
    const values = Object.entries(ladder)
      .filter(([, r]) => r && !r.__missing)
      .map(([value, r]) => ({
        value: Number(value),
        label: String(r.label ?? ""),
        xpCost: r.cost ?? null,
        powerNames: Number(value) === 0 ? powerNames : [],
      }))
      .sort((a, b) => a.value - b.value);
    const floorOf = (attr) => raw.raceRequirements?.[`${key}${attr[0].toUpperCase()}${attr.slice(1)}`] ?? rules[attr];
    const stacksWith = rules.stacksWithArcane ? "arcane" : "";
    races[key] = {
      key,
      // What the race is called is its value-0 rung's label, read off the page.
      name: titleCaseHeading(values.find((v) => v.value === 0)?.label ?? "") || fallback,
      values,
      minimumAttributes: FLOOR_ATTRS.filter((a) => isNum(floorOf(a))).map((attr) => ({ attr, min: floorOf(attr) })),
      stacksWith,
      ...(stacksWith ? { stackXpDiscount: rules.arcaneDiscount ?? null } : {}),
      hpAfter9: rules.hpAfter9 ?? null,
      postEight: [
        ...(isNum(rules.post8) ? [{ chassis: "", delta: rules.post8 }] : []),
        ...(isNum(rules.post8Fighter) ? [{ chassis: "fighter", delta: rules.post8Fighter }] : []),
        ...(isNum(rules.post8CrusaderThief) ? [{ chassis: "crusaderThief", delta: rules.post8CrusaderThief }] : []),
      ],
    };
  }
  if (Object.keys(races).length) out.races = races;

  return out;
}

/** A word as a regex alternative matches it literally. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first word of a label, folded: how a build paragraph names a race in front of its value. */
const firstWord = (label) => foldLabel(String(label ?? "").trim().split(/\s+/u)[0]);

/**
 * The class a build paragraph's run-in label names, among `classes`
 * (`[{id, name, hash, race}]`): the one whose name folds to the label, else
 * the one whose name op's locator is the label's `printKey` — the class a
 * register row withholds the name of. Null when none answers.
 */
export function matchBuildClass(label, classes) {
  const fold = foldLabel(label);
  const key = printKey(label);
  return (classes ?? []).find((c) => fold && foldLabel(c.name) === fold) ?? (classes ?? []).find((c) => key && c.hash === key) ?? null;
}

/**
 * The words a build paragraph names a race by, folded, each mapped to the
 * race's key: the first word of the race's value-0 label, and the first word
 * of every build label whose class belongs to an assembled race — the page
 * can call a race by its ladder's word or by its classes' adjective.
 * @param {object} races the assembled races, by key
 * @param {{label: string, race?: string|null}[]} [built] build labels with the race of the class each matched
 * @returns {Record<string, string>}
 */
export function buildRaceWords(races, built = []) {
  const words = {};
  for (const race of Object.values(races ?? {})) {
    const word = firstWord(race.values?.find((v) => v.value === 0)?.label);
    if (word) words[word] = race.key;
  }
  for (const { label, race } of built) {
    const word = firstWord(label);
    if (word && race && races?.[race] && !words[word]) words[word] = race;
  }
  return words;
}

/**
 * Parse one Ready-for-Play build paragraph into builder state. Allocation
 * tokens are read before the first "yield": past it the paragraph explains
 * what the allocation grants, and its value phrases are not purchases.
 * Superscript runs interleave ("capped th at 10 level"), so no parse assumes
 * adjacency.
 * @param {string} window the paragraph's text
 * @param {{raceWords?: Record<string, string>}} [opts] folded word → race key (`buildRaceWords`)
 */
export function parseBuild(window, { raceWords = {} } = {}) {
  const text = String(window ?? "").toLowerCase();
  const yields = text.search(/\byields?\b/);
  const allocation = yields >= 0 ? text.slice(0, yields) : text;

  const out = { magic: [], notes: text.trim() };
  const seen = new Set();
  const raceAlt = Object.keys(raceWords).map(escapeRe).join("|");
  const token = new RegExp(`\\b(hd|hit dice|fighting|thievery|thief|divine|arcane${raceAlt ? `|${raceAlt}` : ""})\\s+(?:value\\s+)?(\\d)([ab])?\\b`, "g");
  for (const m of allocation.matchAll(token)) {
    const cat = m[1] === "hit dice" ? "hd" : m[1] === "thief" ? "thievery" : m[1];
    if (seen.has(cat)) continue;
    seen.add(cat);
    const value = Number(m[2]);
    if (cat === "hd") out.hdValue = value;
    else if (cat === "fighting") out.fighting = { value, sub: m[3] ?? "" };
    else if (cat === "thievery") out.thievery = value;
    else if (raceWords[cat]) out.race = { key: raceWords[cat], value };
    else out.magic.push({ type: cat, value });
  }
  const xp = text.match(/yields an? ([\d,]+)\s*xp cost/);
  if (xp) out.xp = int(xp[1]);
  const finalXp = text.match(/final xp cost of ([\d,]+)/);
  if (finalXp) out.finalXp = int(finalXp[1]);
  const saves = text.match(/with (\w+) attack and saving throws/);
  if (saves) out.savesAs = saves[1];
  const cap = text.match(/capped[^.]*?\b(\d+)\b[^.]*?level/);
  if (cap) out.cap = Number(cap[1]);
  return out;
}

/**
 * The class `system.builder` fields one parsed build paragraph sets. A build
 * that names no race stores the racial value -1, no racial category; one that
 * names a race stores that race's value.
 */
export function builderUpdate(parsed) {
  return {
    "system.builder.enabled": true,
    "system.builder.hdValue": parsed.hdValue ?? 0,
    "system.builder.fighting.value": parsed.fighting?.value ?? 0,
    "system.builder.fighting.sub": parsed.fighting?.sub ?? "",
    "system.builder.thievery.value": parsed.thievery ?? 0,
    "system.builder.magic": parsed.magic,
    "system.builder.race.value": parsed.race?.value ?? -1,
    // The paragraph names the trade-offs in prose; keep it whole so the
    // Judge elects them by hand with the source in view.
    "system.builder.notes": parsed.notes,
  };
}

/* ------------------------------------------------------------------ */
/*  Foundry appliers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve an ability by printed name to its cookbook-or-uuid ref.
 *
 * An imported item answering to that exact name wins: it is what this seat
 * holds and what its GM meant. Failing that the name goes through the
 * `powerSource` register, because a rung prints the SHORT name while the
 * definition carries the full one — "Hardy" is `def.power.hardyPeople`, and
 * neither "Dwarf Tongues" nor "Elf Tongues" is any item's name at all.
 *
 * A register hit is returned even when nothing is imported yet: a `def.*` id is
 * a ref in its own right, so the rung points at the definition and lights up
 * the moment those powers arrive. Only a name the register cannot place stays
 * unresolved, which is what the rung's note is for.
 *
 * @param byName lower-cased name → imported item, from `importedItemsByName()`.
 *   Passed in rather than looked up: the caller asks it once per run, where a
 *   per-name compendium read would be dozens.
 */
function abilityRefByName(name, byName) {
  const item = byName.get(String(name).toLowerCase());
  if (item?.type === "ability") return item.flags?.[MODULE_ID]?.cookbook?.id ?? `uuid:${item.uuid}`;
  return refForPrintedName(name);
}

/**
 * Assemble the imported raw tables and merge the engine-shaped tables into
 * the same ruledata doc; then materialize races and stamp builds.
 * Runs after `importTables` whenever the classBuilder doc gained tables. A race
 * this world holds is written over in place whenever it runs (its name and
 * system fields); `repair`, a tally (`repairTally`), counts each one.
 * @param {{repair?: object|null}} [opts]
 * @returns {Promise<{assembled: string[], races: string[], builds: string[]}>}
 */
export async function applyBuilderImport({ repair = null } = {}) {
  const svc = services.get("ruledata-import");
  const report = { assembled: [], races: [], builds: [] };
  const doc = getLayer(BUILDER_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return report;
  const assembled = assembleBuilderTables(doc.tables ?? {});
  const { races, ...engineTables } = assembled;
  if (Object.keys(engineTables).length) {
    await svc.importDoc(
      assembledDoc(doc, engineTables, PRODUCES[BUILDER_DOC_ID]),
      { priority: PRIORITY.WORLD, source: MODULE_ID },
    );
    report.assembled = Object.keys(engineTables);
  }

  // --- race items (acks-extras.race), stamped def.race.<key> ---
  // One index read for the whole run: every rung of every race resolves its
  // powers against it.
  const byName = await importedItemsByName();
  for (const race of Object.values(races ?? {})) {
    const cookbookId = `def.race.${race.key}`;
    const system = {
      key: race.key,
      source: { book: "jj", ref: cookbookId },
      minimumAttributes: race.minimumAttributes,
      stacksWith: race.stacksWith,
      stackXpDiscount: race.stackXpDiscount ?? null,
      hpAfter9: race.hpAfter9 ?? null,
      postEight: race.postEight,
      values: race.values.map((rung) => ({
        value: rung.value,
        label: rung.label,
        xpCost: rung.xpCost,
        maxLevel: null,
        powers: rung.powerNames.map((n) => abilityRefByName(n, byName)).filter(Boolean),
        note: rung.powerNames.filter((n) => !abilityRefByName(n, byName)).join(", "),
      })),
    };
    // Written through createDoc, into the shelf ensureItemFolder names — a race
    // is an import like any other, and a bare Item.create here put two of them
    // in the sidebar while the rest of the library sat in the pack.
    const existing = await importedItemFor(cookbookId);
    if (existing) {
      await existing.update({ name: race.name, system });
      if (repair && unrepaired(repair, existing)) countRepair(repair, {});
    } else
      await createDoc(Item, {
        name: race.name,
        type: RACE_ITEM_TYPE,
        folder: (await ensureItemFolder(cookbookId))?.id ?? null,
        system,
        flags: { [MODULE_ID]: { cookbook: { id: cookbookId } } },
      });
    report.races.push(race.key);
  }

  // --- Ready-for-Play builds onto the matching class documents ---
  // Each run-in label is matched against the class documents of ids the
  // cookbook ships now, so a document left under an id that has since left
  // the cookbook is never written.
  const classEntries = cookbookContentFile("classes")?.entries ?? {};
  const classes = (await importedDocs("Item"))
    .filter((d) => d.type === CLASS_TYPE && classEntries[d.flags?.[MODULE_ID]?.cookbook?.id])
    .map((d) => {
      const id = d.flags[MODULE_ID].cookbook.id;
      return { id, doc: d, name: d.name, hash: classEntries[id].fields?.name?.hash ?? null, race: d.flags?.[MODULE_ID]?.tongues?.race ?? null };
    });
  const runins = Object.values(doc.tables?.builds?.classes ?? {}).flatMap((block) => block?.runins ?? []);
  const matched = runins.map((r) => ({ ...r, cls: matchBuildClass(r.label, classes) })).filter((r) => r.cls && r.text);
  const raceWords = buildRaceWords(races, matched.map((r) => ({ label: r.label, race: r.cls.race })));
  for (const { text, cls } of matched) {
    const parsed = parseBuild(text, { raceWords });
    const update = builderUpdate(parsed);
    if (parsed.race) {
      const raceItem = await importedItemFor(`def.race.${parsed.race.key}`);
      if (raceItem) update["system.race"] = raceItem.flags?.[MODULE_ID]?.cookbook?.id ?? `uuid:${raceItem.uuid}`;
    }
    await cls.doc.update(update);
    report.builds.push(cls.id);
  }
  return report;
}
