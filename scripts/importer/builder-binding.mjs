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
import { createDoc, ensureItemFolder, importedItemFor, importedItemsByName, refForPrintedName } from "./cookbook.mjs";
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";
import { CLASS_TYPE, RACE_TYPE as RACE_ITEM_TYPE } from "../classes/constants.mjs";

const BUILDER_DOC_ID = "acks.classBuilder";

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

/** "…mage for arcane…" (the printed mapping sentence) → {category: chassis}. */
export function parseSavesMap(text) {
  const out = {};
  for (const m of String(text ?? "").matchAll(/\b(fighter|thief|crusader|mage)\s+for\s+(\w+)/gi)) {
    out[m[2].toLowerCase()] = m[1].toLowerCase();
  }
  return out;
}

/** "arcane, then divine, then …" → ["arcane","divine",…]. */
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

/** Canonical printed names of the racial value-0 powers, gated on the
 *  presence keys the prose extraction confirmed on the seat's page. */
const RACE_POWER_NAMES = {
  dwarf: {
    sensitivityToRockAndStone: "Sensitivity to Rock and Stone",
    dwarfTongues: "Dwarf Tongues",
    hardy: "Hardy",
  },
  elf: {
    animalFriendship: "Animal Friendship",
    attunementToNature: "Attunement to Nature",
    connectionToNature: "Connection to Nature",
    elfTongues: "Elf Tongues",
  },
};

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
  // The post-9th HIT-POINT rates pair the chassis differently from the
  // post-8th XP increments above — crusader+mage and fighter+thief, not
  // crusader+thief / fighter / mage — so the two cannot share keys. The
  // printed pairing is kept here and expanded by the consumer, as postEight
  // is. All-or-nothing: both rates come from one sentence on one page, so a
  // half-read is a broken read and must not present as a complete one.
  if (raw.hpAfterNine && [raw.hpAfterNine.crusaderMage, raw.hpAfterNine.fighterThief].every(isNum)) {
    budget.hpAfterNine = { crusaderMage: raw.hpAfterNine.crusaderMage, fighterThief: raw.hpAfterNine.fighterThief };
  }
  if (raw.racialCaps) {
    budget.racialCaps = Object.entries(raw.racialCaps)
      .filter(([, r]) => r && !r.__missing && isNum(r.maxLevel))
      .map(([points, r]) => ({ points: Number(points), maxLevel: r.maxLevel }));
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
  const raceLadder = (valuesRaw, powerNames, rules) => {
    if (!valuesRaw) return null;
    return Object.entries(valuesRaw)
      .filter(([, r]) => r && !r.__missing)
      .map(([value, r]) => ({
        value: Number(value),
        label: String(r.label ?? ""),
        xpCost: r.cost ?? null,
        // The value-0 rung grants the race's base powers; the prose presence
        // checks gate each name on the seat's page actually printing it.
        powerNames: Number(value) === 0 ? Object.entries(powerNames).filter(([k]) => rules?.[k]).map(([, name]) => name) : [],
      }))
      .sort((a, b) => a.value - b.value);
  };
  if (raw.dwarfRaw) {
    const values = raceLadder(raw.dwarfRaw, RACE_POWER_NAMES.dwarf, raw.dwarfRules);
    races.dwarf = {
      key: "dwarf",
      name: "Dwarf",
      values,
      minimumAttributes: isNum(raw.raceRequirements?.dwarfCon ?? raw.dwarfRules?.con)
        ? [{ attr: "con", min: raw.raceRequirements?.dwarfCon ?? raw.dwarfRules?.con }]
        : [],
      stacksWith: "",
      hpAfter9: raw.dwarfRules?.hpAfter9 ?? null,
      postEight: [
        ...(isNum(raw.dwarfRules?.post8Fighter) ? [{ chassis: "fighter", delta: raw.dwarfRules.post8Fighter }] : []),
        ...(isNum(raw.dwarfRules?.post8CrusaderThief) ? [{ chassis: "crusaderThief", delta: raw.dwarfRules.post8CrusaderThief }] : []),
      ],
    };
  }
  if (raw.elfRaw) {
    const values = raceLadder(raw.elfRaw, RACE_POWER_NAMES.elf, raw.elfRules);
    races.elf = {
      key: "elf",
      name: "Elf",
      values,
      minimumAttributes: isNum(raw.raceRequirements?.elfInt) ? [{ attr: "int", min: raw.raceRequirements.elfInt }] : [],
      stacksWith: raw.elfRules?.stacksWithArcane ? "arcane" : "",
      stackXpDiscount: raw.elfRules?.arcaneDiscount ?? null,
      hpAfter9: null,
      postEight: isNum(raw.elfRules?.post8) ? [{ chassis: "", delta: raw.elfRules.post8 }] : [],
    };
  }
  if (Object.keys(races).length) out.races = races;

  return out;
}

/** The class names whose runins bound a build paragraph on p332–333. */
const BUILD_ROSTER =
  /\b(assassin|barbarian|bard|bladedancer|crusader|dwarven craftpriest|dwarven vaultguard|elven nightblade|elven spellsword|explorer|fighter|mage|nobiran wonderworker|paladin|priestess|shaman|thief|venturer|warlock|witch|zaharan ruinguard):/;

/**
 * Parse one Ready-for-Play build paragraph into builder state. The window may
 * bleed into the next class's paragraph — it is cut at the next roster runin.
 * Superscript runs interleave ("capped th at 10 level"), so no parse assumes
 * adjacency.
 */
export function parseBuild(window) {
  let text = String(window ?? "").toLowerCase();
  const next = text.slice(1).match(BUILD_ROSTER);
  if (next) text = text.slice(0, next.index + 1);

  const out = { magic: [], notes: text.trim() };
  const seen = new Set();
  for (const m of text.matchAll(/\b(hd|hit dice|fighting|thievery|thief|divine|arcane|dwarf|elf)\s+(?:value\s+)?(\d)([ab])?\b/g)) {
    const cat = m[1] === "hit dice" ? "hd" : m[1] === "thief" ? "thievery" : m[1];
    if (seen.has(cat)) continue;
    seen.add(cat);
    const value = Number(m[2]);
    if (cat === "hd") out.hdValue = value;
    else if (cat === "fighting") out.fighting = { value, sub: m[3] ?? "" };
    else if (cat === "thievery") out.thievery = value;
    else if (cat === "dwarf" || cat === "elf") out.race = { key: cat, value };
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
 * Runs after `importTables` whenever the classBuilder doc gained tables.
 * @returns {Promise<{assembled: string[], races: string[], builds: string[]}>}
 */
export async function applyBuilderImport() {
  const svc = services.get("ruledata-import");
  const report = { assembled: [], races: [], builds: [] };
  if (!svc || !hasDoc(BUILDER_DOC_ID)) return report;
  const doc = getDoc(BUILDER_DOC_ID);
  const assembled = assembleBuilderTables(doc.tables ?? {});
  const { races, ...engineTables } = assembled;
  if (Object.keys(engineTables).length) {
    await svc.importDoc(
      { id: BUILDER_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engineTables } },
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
    if (existing) await existing.update({ name: race.name, system });
    else
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
  const builds = doc.tables?.builds?.classes ?? {};
  for (const [id, block] of Object.entries(builds)) {
    if (!block?.build) continue;
    const parsed = parseBuild(block.build);
    const cls = await importedItemFor(`def.class.${id}`);
    if (cls?.type !== CLASS_TYPE) continue;
    const update = {
      "system.builder.enabled": true,
      "system.builder.hdValue": parsed.hdValue ?? 0,
      "system.builder.fighting.value": parsed.fighting?.value ?? 0,
      "system.builder.fighting.sub": parsed.fighting?.sub ?? "",
      "system.builder.thievery.value": parsed.thievery ?? 0,
      "system.builder.magic": parsed.magic,
      "system.builder.race.value": parsed.race?.value ?? 0,
      // The paragraph names the trade-offs in prose; keep it whole so the
      // Judge elects them by hand with the source in view.
      "system.builder.notes": parsed.notes,
    };
    if (parsed.race) {
      const raceItem = await importedItemFor(`def.race.${parsed.race.key}`);
      if (raceItem) update["system.race"] = raceItem.flags?.[MODULE_ID]?.cookbook?.id ?? `uuid:${raceItem.uuid}`;
    }
    await cls.update(update);
    report.builds.push(id);
  }
  return report;
}
