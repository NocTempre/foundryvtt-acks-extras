/**
 * Cookbook runtime: importing one actor or a batch, with the abilities and companions it resolves.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { entryText, sumsUpdate } from "../prose.mjs";
import { playStamp } from "../held-edits.mjs";
import { printedNameOf } from "../printed-name.mjs";
import { BOOKS } from "../books.mjs";
import { executeEntry, convertName } from "../executor.mjs";
import { progressBar } from "../progress.mjs";
import { stableDocId } from "../adventure-binding.mjs";
import { sheetValuesFromStatline, asPrintedBlock, classBehindQualifier } from "../character-binding.mjs";
import { slug } from "../../lib/vocab.mjs";
import { lineOfData, data, ctx, cookbookEntry, bookOf, characterEntry } from "./state.mjs";
import { readForImport } from "./read.mjs";
import {
  packOptsFor, isRewriting, keepsJudgeProse, createDoc, importedIndex, claimImport, importedActor, importedIdSet,
  primaryTypeOf, actorFolderFor, prepareFolders, IMPORT_CONCURRENCY, ensureItemFolder,
} from "./target.mjs";
import { bindAbility, allAbilities, idForName, abilityNameIndex, loadedAbilityIndex, reportGuess } from "./abilities.mjs";
import {
  bindMonster, monsterProseChannels, warmSpellPacksOnce, mintLeaderTemplate, importFamily, importTemplate, deferTarget,
  bindLegacyMonster, bindNpc,
} from "./monster.mjs";
import { laddersForEntry } from "./classes.mjs";

/**
 * Run a list of entry ids through importOne with a progress bar, bounded to
 * IMPORT_CONCURRENCY at a time.
 *
 * Each import parses pages out of the seat's PDF, so a whole book is minutes of
 * work: without feedback the client looks hung. Errors are per-entry — one
 * unreadable page must not abandon the other 286 — and the shared iterator means
 * a slow entry never blocks a free worker from starting the next.
 */
export async function importMany(ids, label) {
  const total = ids.length;
  const bar = progressBar(label, total);
  let done = 0;
  try {
    // Every id names its OWN book (a batch may span every connected book) and its
    // own destination folder; the tree is built up front so the workers below
    // only ever read the cache.
    await prepareFolders("Actor", ids);
    const it = ids[Symbol.iterator]();
    const worker = async () => {
      for (let n = it.next(); !n.done; n = it.next()) {
        const id = n.value;
        const found = cookbookEntry(id);
        const bookId = bookOf(found);
        const folder = await actorFolderFor(id, found);
        const actor = await importOne(bookId, id, folder?.id ?? null).catch(
          (err) => (console.error(`${MODULE_ID} | import ${id}`, err), null),
        );
        if (actor) done++;
        bar.step(found?.entry?.name ?? id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, total || 1) }, worker));
  } finally {
    bar.finish(label);
  }
  return done;
}

/** Imports one actor entry from a book the seat has open, routing each kind to its binder; returns the created actor, or null when the entry is passed over. */
export async function importOne(bookId, id, folderId) {
  await warmSpellPacksOnce();
  const found = cookbookEntry(id);
  // Adventure kinds route to their own binders; journals/tables have their own
  // importers and are never built here.
  const kind = found?.entry?.kind;
  if (kind === "kind.npc" || kind === "kind.pregen" || kind === "kind.monsterLegacy") return importAdventureActor(bookId, id, folderId);
  if (kind === "kind.monsterTemplate") return importTemplate(bookId, id, folderId);
  if (kind === "kind.monsterFamily") return importFamily(bookId, id, folderId);
  if (kind && kind !== "kind.monster") return null;
  const session = ctx.sessionDocs.get(bookId);
  // Skip the `art` op outright when the file is already on disk — see
  // docs/importer/DECISIONS.md, "The art op is skipped when the picture is
  // already on disk".
  const artOnDisk = await ctx.cachedArt?.(id).catch(() => null);
  const node = await executeEntry(session.doc, found.cb, data.registers, id, artOnDisk ? { skipOps: ["art"] } : {});
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const { system, items, flags, prototypeToken } = bindMonster(node);

  // The Full Monster Sheet is acks-extras' own sheet. Prose always routes to
  // its extras flag; system.details.biography is never a fallback destination.
  const { extras } = monsterProseChannels(node, id, found.entry.cite);

  // FILE IT NOW: the stat block has just told us the creature's TYPE, the axis
  // monsters are grouped by, and nothing afterwards decides a destination.
  const typed = primaryTypeOf(node);
  const folder = (await actorFolderFor(id, found, { type: typed }))?.id ?? folderId;

  // ONE write, not four: the embedded items, the cookbook id and the FMS extras
  // fold into the single create rather than costing a socket round-trip each.
  // Art follows separately — it needs the uploaded file path.
  const actor = await createDoc(Actor, {
    // A person's row ships a neutral label; the name is the page's own.
    name: printedNameOf(node, found.entry.name),
    type: "monster",
    folder,
    system,
    ...(prototypeToken ? { prototypeToken } : {}),
    // Merge, don't replace: an embedded shared ability keeps its cookbook id
    // (that id is what marks it as the shared one).
    items: items.map((i) => ({
      ...i,
      flags: { ...(i.flags ?? {}), [MODULE_ID]: { ...(i.flags?.[MODULE_ID] ?? {}), minted: true } },
    })),
    flags: {
      ...(flags ?? {}),
      // The stat block's TYPE rides on OUR flag, not only the Full Monster
      // Sheet's extras: it is the axis monsters are filed by, and a monster
      // with no extras would otherwise have nothing to group on.
      [MODULE_ID]: {
        ...((flags ?? {})[MODULE_ID] ?? {}),
        cookbook: { id, cite: found.entry.cite, ...(typed ? { type: typed } : {}) },
        extras,
      },
    },
  });
  // Foundry reports a schema-validation failure and returns undefined rather
  // than throwing, so an unimportable monster reads as one skipped rather
  // than a crash in the importer.
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: the system rejected the extracted stats — skipped (see console).`);
    return null;
  }
  // Gated on the RECIPE asking for art, not on the op having run — see
  // docs/importer/DECISIONS.md, "The art op is skipped when the picture is
  // already on disk".
  const artInstr = found.entry.fields?.art ?? null;
  if ((artInstr || node.fields.art) && ctx.importArtForPage && !isRewriting(id)) {
    await ctx.importArtForPage(actor, session.doc, {
      id,
      page: artInstr?.page ?? found.entry.pages[0],
      name: artInstr?.name ?? node.fields.art?.name ?? null,
      box: artInstr?.box ?? null,
    });
  }
  await mintLeaderTemplate({ id, found, node, bound: { system, items, flags, prototypeToken }, extras, folder, bindDoc: session.doc, img: actor.img ?? "" });
  return actor;
}

/** Actor import for kind.npc / kind.monsterLegacy (with the defer rule). */
async function importAdventureActor(bookId, id, folderId) {
  const target = deferTarget(id);
  if (target) {
    // The deferred TARGET id gets its own already-present check — the caller
    // only filtered on the adventure id, and a world that imported the MM
    // entry directly must not get a twin.
    if ((await importedIdSet()).has(target)) {
      ui.notifications.info(`${MODULE_ID} | ${id} defers to ${target}, which this world already has — skipped.`);
      return null;
    }
    const tb = target.split(".")[0];
    ui.notifications.info(`${MODULE_ID} | ${id} is reprinted in ${BOOKS[tb]?.label ?? tb} — importing ${target} instead.`);
    // File it under the book it actually came FROM, not the adventure that
    // pointed at it.
    const tFolder = await actorFolderFor(target);
    return importOne(tb, target, tFolder?.id ?? folderId);
  }
  const found = cookbookEntry(id);
  const session = ctx.sessionDocs.get(bookId);
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const kind = found.entry.kind;
  if (characterEntry(found.entry)) {
    const character = await importCharacter(bookId, id, folderId, node, found);
    await adventureActorArt(character, session, id, found, node);
    return character;
  }
  const bound = kind === "kind.npc" ? bindNpc(node) : bindLegacyMonster(node);
  const sl = bound.statline;
  const classLine = sl?.class ? `<p><em>${sl.class.name} ${sl.class.level}${sl.class.note ? ` (${sl.class.note})` : ""}</em></p>` : "";
  bound.system.details = {
    ...(bound.system.details ?? {}),
    biography: classLine + entryText(node, id, found.entry.cite),
  };
  // Proficiency tokens resolve through the shared ability-provider tiers.
  if (sl?.proficiencies?.length) {
    const { items: profItems, missing } = await resolveAbilities(sl.proficiencies);
    bound.items = [...(bound.items ?? []), ...profItems];
    if (missing.length) console.log(`${MODULE_ID} | ${id}: unresolved proficiencies ${missing.join(", ")}`);
  }
  const actor = await createDoc(Actor, {
    // The entry ships an ordinal label; the person is named from the page the
    // recipe just read, like every other document the book fills.
    name: printedNameOf(node, found.entry.name),
    type: "monster",
    folder: folderId,
    system: bound.system,
    // Stamped as the import's own so a repair replaces them and keeps any a Judge added.
    items: (bound.items ?? []).map((i) => ({
      ...i,
      flags: { ...(i.flags ?? {}), [MODULE_ID]: { ...(i.flags?.[MODULE_ID] ?? {}), minted: true } },
    })),
    flags: {
      [MODULE_ID]: {
        cookbook: { id, book: bookId, kind },
        ...(sl
          ? {
              npc: {
                ...(sl.class ? { class: sl.class } : {}),
                ...(sl.abilities ? { abilities: sl.abilities } : {}),
                ...(sl.equipment ? { equipment: sl.equipment } : {}),
                ...(sl.classAbilities ? { classAbilities: sl.classAbilities } : {}),
                ...(sl.spells ? { spells: sl.spells } : {}),
                ...(sl.hpEach ? { hpEach: true } : {}),
              },
            }
          : {}),
      },
    },
  });
  await adventureActorArt(actor, session, id, found, node);
  return actor;
}

/**
 * Same art path as the MM import: the compiled entry names ITS illustration
 * (associated by placement inside the entry's claimed region), and the seat
 * extracts + uploads it. A shipped placement BOX needs no runtime XObject
 * resolution (the AX books' art never registers on page.objs), so the box
 * alone is enough to proceed.
 */
async function adventureActorArt(actor, session, id, found, node) {
  const artInstr = found.entry.fields?.art ?? null;
  if (actor && artInstr && (artInstr.box || node.fields.art) && ctx.importArtForPage && !isRewriting(id)) {
    await ctx.importArtForPage(actor, session.doc, {
      id,
      page: artInstr.page ?? found.entry.pages[0],
      name: artInstr.name ?? node.fields.art.name ?? null,
      box: artInstr.box ?? null,
    });
  }
}

/**
 * The library's name for a printed one, by kind: a class or spell the library
 * answers keeps its name, else the conversion table's rename; a class neither
 * answers is then read behind its qualifier, and pushed to `read` as
 * `{printed, as}`; a proficiency resolves through the ability index, whose
 * aliases carry the older names.
 */
function libraryNameFor({ matchClass, matchSpell }, read = []) {
  const nameIndex = abilityNameIndex();
  const present = new Set(loadedAbilityIndex().keys());
  const renamed = (name, category) => {
    const conv = convertName(data.registers, name);
    return conv?.status === "renamed" && conv.category === category && conv.to ? conv.to : name;
  };
  return (kind, name) => {
    if (kind === "class") {
      if (matchClass(name)) return name;
      const to = renamed(name, "class");
      if (to !== name) return to;
      const base = classBehindQualifier(name, matchClass);
      if (base) read.push({ printed: name, as: base });
      return base ?? name;
    }
    if (kind === "spell") return matchSpell(name) ? name : renamed(name, "spell");
    const guess = idForName(nameIndex, name, present);
    return (guess && cookbookEntry(guess.id)?.entry?.name) || name;
  };
}

/**
 * A person the page prints in full, as a core character (DECISIONS
 * 2026-10-17, "A person the page prints in full becomes a character, and the
 * derivation wins"). The shell takes the entry's stable id, so a rebuild keeps
 * every reference to it; the sheet import binds the class at the printed level
 * and writes the scores, hit points and alignment; morale is written here, to
 * the system's bounds; and the biography carries the page's prose, then the
 * stamped "as printed" block with every figure the class works out differently
 * and every name the library could not answer. Owned by the Judges alone.
 */
async function importCharacter(bookId, id, folderId, node, found) {
  const sl = node.fields.statline ?? {};
  const kind = found.entry.kind;
  const _id = stableDocId(id);
  const shell = {
    _id,
    name: printedNameOf(node, found.entry.name),
    type: "character",
    folder: folderId,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [MODULE_ID]: { cookbook: { id, book: bookId, kind } } },
  };
  // A document already standing under the stable id is this entry's from an
  // earlier run; making another under it is a duplicate-id throw.
  // A character answered rewrite is held: the create below returns it, and the
  // sheet import and the biography write that follow land on it where it stands;
  // a biography a Judge wrote in is kept under a decision (`keepsJudgeProse`).
  const { pack } = await packOptsFor("Actor", lineOfData(shell));
  if (!isRewriting(id) && (pack ? game.packs.get(pack)?.index.has(_id) : game.actors.has(_id))) {
    console.warn(`${MODULE_ID} | ${id}: a character already stands under its id — skipped.`);
    return null;
  }
  const actor = await createDoc(Actor, shell, { keepId: true });
  if (!actor) return null;
  const standing = new Set(actor.items.map((i) => i.id));
  // Loaded on use: the sheet import's tree registers hooks as it loads, and
  // this module is also loaded where no Foundry runs.
  const [{ importSheet }, matchers] = await Promise.all([import("../../character-sheet/pdf/apply.mjs"), import("../../character-sheet/pdf/match.mjs")]);
  const read = [];
  const { values, morale, unplaced } = sheetValuesFromStatline(sl, { rename: libraryNameFor(matchers, read) });
  // The sheet import grants what the library holds, so a proficiency the
  // cookbook can supply is imported first, through the tiers a monster's list
  // resolves by; what nothing supplies is reported below as unmatched.
  await resolveAbilities([...(sl.proficiencies ?? []), ...(sl.classProficiencies ?? [])]);
  const report = await importSheet({ actor, values, writeDomain: false, record: false });
  // What the sheet import granted is the import's own, stamped so a repair can
  // tell it from an item a Judge gave the character.
  const granted = actor.items.filter((i) => !standing.has(i.id) && !i.flags?.[MODULE_ID]?.minted);
  if (granted.length) await actor.updateEmbeddedDocuments("Item", granted.map((i) => ({ _id: i.id, [`flags.${MODULE_ID}.minted`]: true })));
  const moraleField = actor.system.schema?.getField?.("details.morale");
  const missing = [...report.unmatched, ...unplaced];
  const words = {
    heading: game.i18n.localize(`${LANG_PREFIX}.character.asPrinted`),
    differs: (d) => game.i18n.format(`${LANG_PREFIX}.character.differs`, { printed: d.sheet, inForce: d.inForce }),
  };
  const rows = [
    ...read.map((r) => ({ label: game.i18n.localize(`${LANG_PREFIX}.character.readAs`), text: r.as })),
    ...missing.map((u) => ({ label: game.i18n.localize(`${LANG_PREFIX}.character.missing`), text: u.name })),
    ...report.noted,
  ];
  const biography = entryText(node, id, found.entry.cite) + asPrintedBlock({ id, statline: sl.text, differences: report.checks, rows }, words);
  const keepBiography = isRewriting(id) && keepsJudgeProse(actor, "system.details.biography", actor.system?.details?.biography, biography, found.entry.cite ?? "");
  await actor.update({
    ...(keepBiography ? {} : { "system.details.biography": biography, ...sumsUpdate(biography, "system.details.biography") }),
    ...(Number.isInteger(morale) && moraleField ? { "system.details.morale": Math.clamp(morale, moraleField.min, moraleField.max) } : {}),
    [`flags.${MODULE_ID}.printed`]: { differences: report.checks.length, missing: missing.length },
  });
  // Recorded after the last write, so a repair tells a character played since from one as imported (`playStamp`).
  await actor.update({ [`flags.${MODULE_ID}.playStamp`]: playStamp(actor.toObject()) });
  return actor;
}

/**
 * Build — or REUSE — the shared ability item for a definition id. Deduped by
 * cookbook id, so every monster/NPC referencing a proficiency links to the SAME
 * item instead of minting a per-actor copy. Nothing is imported without the
 * citing book: the entry is passed over (`readForImport`), counted into
 * `passed` where a `passedOver` tally is given.
 */
export async function importAbility(id, folderId, { pageCache = null, passed = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return null;
  // NOTE an alias gets its OWN item. The books list a name whose rules text is
  // printed under another entry; that makes it a distinct ability sharing a
  // passage, not a synonym to redirect away. Its recipe already carries a
  // pointer to where that text lives, so it extracts and classifies normally —
  // it just does not stack with the entry it points at.
  return claimImport(id, async () => {
    const { data: built, reason } = await abilityData(id, { folderId, pageCache });
    if (!built) return passed?.count(reason) ?? null;
    return createDoc(Item, built);
  });
}

/**
 * Everything an ability import does EXCEPT the write. Split out so a bulk
 * run can build every document first and write them in chunks (`createDocs`),
 * which building and writing as one call cannot do. Resolves to `{data}`,
 * the creation data with its folder resolved, or to `{data: null, reason}` —
 * `no-entry` when the cookbook does not know the id, else `readForImport`'s
 * reason. See docs/importer/DECISIONS.md, "Writes are batched, because a
 * write costs what the shelf already holds".
 */
export async function abilityData(id, { folderId = null, pageCache = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return { data: null, reason: "no-entry" };
  const bookId = bookOf(found);
  const { node, reason } = await readForImport(id, pageCache ? { pageCache: pageCache(bookId) } : {});
  if (!node) return { data: null, reason };
  const folder = folderId ?? (await ensureItemFolder(id))?.id ?? null;
  const ladders = await laddersForEntry(found.entry, { pageCache: pageCache ? pageCache(bookId) : null });
  const doc = bindAbility(found.entry, node, id, ladders ? { ladders } : {});
  const extras = doc.flags[MODULE_ID].extras;
  extras.effects = await resolveCompanions(extras.effects);
  return { data: { ...doc, folder }, reason: null };
}


/* -------------------------------------------- */
/*  Companions                                  */
/* -------------------------------------------- */

/**
 * Fill a companion effect's actor slot. `ref` names the monster entry the
 * ability confers — a pointer the recipe can ship because it is not the book's
 * text. When that book is connected we import the creature and link it; when it
 * is not, the slot stays EMPTY on purpose so a GM can drop an actor in, or so
 * `cookbookFillCompanions()` can fill it once the book loads.
 *
 * Abilities whose creature is BUILT rather than named (a totem animal, a
 * familiar chosen from a list) carry no `ref` at all and keep an empty slot for
 * good — there is no single entry to point at.
 */
async function resolveCompanion(effect) {
  if (effect?.type !== "companion" || effect.actorUuid || !effect.ref) return effect;
  const found = cookbookEntry(effect.ref);
  if (!found) return effect;
  // The library's own creature, never a copy dragged out of it: the slot is a
  // link that outlives the copy, and a copy answering would stop the import.
  const existing = await importedActor(effect.ref, { copies: false });
  if (existing) return { ...effect, actorUuid: existing.uuid };
  const bookId = bookOf(found);
  if (!ctx.sessionDocs.has(bookId)) return effect; // bookless: leave the bucket
  // No fallback folder: importOne resolves the creature's own destination from
  // its freshly extracted type, which is strictly better than anything a caller
  // could name before the page has been read.
  const actor = await importOne(bookId, effect.ref, null).catch((err) => {
    console.error(`${MODULE_ID} | companion ${effect.ref}`, err);
    return null;
  });
  return actor ? { ...effect, actorUuid: actor.uuid } : effect;
}

/** Resolve every companion slot in an effects array, in order (creates actors). */
export async function resolveCompanions(effects) {
  if (!effects?.some((e) => e?.type === "companion" && !e.actorUuid && e.ref)) return effects;
  const out = [];
  for (const e of effects) out.push(await resolveCompanion(e));
  return out;
}

/**
 * Fill companion slots left empty because the citing book was not connected.
 * Safe to re-run: a slot already holding an actor is never touched.
 */
export async function cookbookFillCompanions() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  let filled = 0;
  // A slot that resolves IMPORTS the creature from the seat's book, so this is
  // an actor import wearing a different name — same page extraction, same wait.
  const all = await allAbilities();
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressCompanions`), all.length);
  try {
    for (const { doc, extras } of all) {
      bar.step(doc.name);
      const effects = await resolveCompanions(extras.effects);
      if (effects === extras.effects) continue;
      await doc.update({ [`flags.${MODULE_ID}.extras.effects`]: effects });
      filled += effects.filter((e, i) => e.actorUuid && !extras.effects[i]?.actorUuid).length;
    }
  } finally {
    bar.finish();
  }
  ui.notifications.info(`${MODULE_ID} | companions: ${filled} slot(s) linked to an actor.`);
  return filled;
}

/**
 * `ability-provider` (the lib service contract, v1): resolve proficiency name
 * tokens into embeddable ability ItemData. Tier 1 reuses the world's own
 * imported items (the same name index the monster import uses, including its
 * proficiency-vs-class-power disambiguation); tier 2 imports the definition
 * from the cookbook, where its book is open on this seat; an unresolvable
 * token, a definition whose book is closed included, is reported, never fatal. A
 * "(specialty)" suffix survives onto the embedded copy's name only.
 */
export async function resolveAbilities(tokens) {
  const items = [];
  const missing = [];
  const nameIndex = abilityNameIndex();
  const loadedById = await importedIndex();
  const present = new Set(loadedById.keys());
  for (const raw of tokens ?? []) {
    const printed = String(raw).trim();
    if (!printed) continue;
    const token = rebracket(printed, (name) => nameIndex.has(slug(name)));
    const m = token.match(/^(.*?)\s*\(([^)]+)\)\s*\d*$/);
    const base = (m ? m[1] : token.replace(/\s*\d+$/, "")).trim();
    const specialty = m?.[2] ?? null;
    // A short form the books print for a name this module already ships is
    // authored on the entry as an alias and reaches the index through it, so
    // nothing here needs to know which words a printing merged.
    const guess = idForName(nameIndex, base, present);
    reportGuess(base, guess);
    const id = guess?.id ?? null;
    let item = id ? loadedById.get(id) : null;
    if (!item && id) item = await importAbility(id).catch(() => null);
    if (!item) {
      missing.push(printed);
      continue;
    }
    const data = item.toObject();
    delete data._id;
    if (specialty) data.name = `${data.name} (${specialty})`;
    items.push(data);
  }
  return { items, missing };
}

/**
 * A statline token whose specialty lost its opening bracket in the book's own
 * text layer ("Name spec) 2"), read as the token it stands for ("Name (spec)
 * 2"). The name is the longest run of leading words `known` accepts; a token
 * with both brackets or none, or whose words name nothing, comes back as it
 * was. No extraction can supply the bracket — the printing does not hold it.
 * @param {string} token
 * @param {(name: string) => boolean} known  whether a name is a defined ability
 * @returns {string}
 */
export function rebracket(token, known) {
  if (!token.includes(")") || token.includes("(")) return token;
  const m = /^(.*?)\s*\)\s*(\d*)\s*$/.exec(token);
  if (!m) return token;
  const words = m[1].split(/\s+/).filter(Boolean);
  for (let k = words.length - 1; k >= 1; k--) {
    const name = words.slice(0, k).join(" ");
    if (known(name)) return `${name} (${words.slice(k).join(" ")})${m[2] ? ` ${m[2]}` : ""}`;
  }
  return token;
}
