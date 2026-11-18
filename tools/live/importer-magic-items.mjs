/**
 * Live walk, importer-magic-items: the Treasure Tome's magic-item chain and
 * its entries, read from the seat's own books. Walks docs/importer/TESTING.md
 * "The magic-item and arms tables" steps 8 to 12 (11: the Tome disconnected
 * and the import rerun; 12: the Browser's subtable entries, one exported, and a
 * classic list dropped back over its entry) and "Magic item entries" steps 1 to
 * 6, on the GM seat, and the registry read on the Player seat. With the Judges Journal
 * and the Treasure Tome connected, a Rules tables import of `magicItemTables`
 * writes `subtables` (45 lists, by category), every classic and heroic list
 * hops into one, and a roll from the type list, from each rarity and from the
 * top face of the potions list ends on an item with no flag; then the
 * MagicItems import (`acksExtras.importer.cookbookImportMagicItems`, the call
 * the Manage-imports Magic Items pick makes) writes one core item per
 * `kind.magicItem` row of the Tome's cookbook (the count is read from the
 * served `cookbook/tt.json`, never fixed here), each under its category
 * folder, the markets flag holding the located figures only; a hand edit
 * survives a repair, a deleted item comes back by the next import, and a
 * rolled row linked to an item names its document until that item is
 * deleted. Machine values arrive through ./_env.mjs.
 *
 * Step 11 takes the Tome's session entry out of the importer's open-books map
 * (the module has no per-book disconnect; `forgetBooks` drops every book and
 * the remembered locations), reruns the import, puts the same entry back and
 * reruns it again, and the world must end as it began; the teardown restores
 * the entry if a check threw. Step 12's drop calls what the Browser's drop
 * calls (`parseDrop`, then `setOverride`) and Remove override calls
 * `clearOverride`; the teardown clears an override this run set.
 *
 * Not walked: entries 6's "card unchanged" half (the branch's roll posts no
 * card, so only the steps are read: none carries a link, none ends flagged).
 *
 * Fixtures: none built. The imported documents are the world's. A step that
 * edits or deletes an item first stamps it `importer/magic-item-<n>` and
 * tracks it: `api.mark` refuses a compendium uuid (a fixture is a world
 * document), so the walk stamps `flags.world.fixture` itself and tracks the
 * uuid, and the ledger deletes it (`sweepTracked({only})`). The teardown
 * sweeps what is still tracked and imports the Tome's items again, so the
 * world ends with every item present and none edited. A RollTable the export
 * makes where none stood is tracked and swept. A roll is rigged by the roll
 * API's `roller` argument (as magic-items.mjs does), not the core dice rig.
 * Every line printed is a boolean, a count or an id (`tt.item<n>`): no book
 * word, item name or figure leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, books, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** The subtable counts per category the recipe gives (potions 7 ... armour 4; 45 in all). */
const PER_CATEGORY = { potions: 7, rings: 5, scrolls: 5, implements: 6, misc: 10, swords: 4, weapons: 4, armors: 4 };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__mt = globalThis.__mt ?? {});
    H.T = acksExtras.lib.tables;
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.RF = await import("/modules/acks-extras/scripts/importer/refresh.mjs");
    H.IC = await import("/modules/acks-extras/scripts/importer/constants.mjs");
    H.TD = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    H.ST = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    H.SS = await import("/modules/acks-extras/scripts/importer/cookbook/state.mjs");
    H.table = (id) => H.T.getTable("magicItemTables", id);
    H.tiles = (bands) => {
      if (!Array.isArray(bands) || !bands.length) return false;
      const lo = (b) => Number(b?.min ?? b?.lo);
      const hi = (b) => Number(b?.max ?? b?.hi ?? b?.min ?? b?.lo);
      const s = [...bands].sort((a, b) => lo(a) - lo(b));
      return lo(s[0]) === 1 && s.every((b, i) => !i || lo(b) === hi(s[i - 1]) + 1);
    };
    H.top = (bands) => Math.max(...bands.map((b) => Number(b?.max ?? b?.hi ?? b?.min ?? 0)));
    H.fromTT = (cite) => /\bTT\b|"tt"/.test(typeof cite === "string" ? cite : JSON.stringify(cite ?? ""));
    /** The leaf bands of a list: every band with no inner bands, and every inner band. */
    H.leaves = (bands) => (bands ?? []).flatMap((b) => (Array.isArray(b.sub) ? b.sub : [b]));
    /** A number standing for a value's JSON, so two reads compare without a figure being printed. */
    H.digest = (v) => {
      const text = JSON.stringify(v ?? null);
      let h = 5381;
      for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
      return h;
    };
    /** Every band's hop, outer then its inner bands, in order (null where a band has none). */
    H.hopList = (bands) => (bands ?? []).flatMap((b) => [b.hop ?? null, ...(Array.isArray(b.sub) ? b.sub.map((x) => x.hop ?? null) : [])]);
    /** Polls `fn` every 100 ms for up to `tries` times; resolves its last answer. */
    H.settle = async (fn, tries = 50) => {
      for (let i = 0; i < tries; i++) {
        if (fn()) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return !!fn();
    };
    /** A roller that answers the faces in `plan` in call order ("top" is the die's last face) and 1 after. */
    H.roller = (plan) => {
      let n = 0;
      return (expr) => {
        const sides = Number(/^1d(\d+)$/.exec(String(expr))?.[1]);
        const want = plan[n++];
        return { total: want === "top" ? sides : (want ?? 1), sides };
      };
    };
    /** A roll as booleans, ids and counts: no text, caption, cite or field leaves the page. */
    H.sum = (r) => {
      const steps = r.steps ?? [];
      return {
        ok: !!r.ok, reason: r.reason ?? null, flag: r.item?.flag ?? null,
        lists: steps.map((s) => s.list),
        inner: steps.map((s) => !!s.inner),
        citesTT: steps.map((s) => H.fromTT(s.cite)),
        stepsCarryNoLink: steps.every((s) => !("ref" in s) && !("uuid" in s)),
        named: typeof r.item?.text === "string" && r.item.text.length > 0,
        cues: typeof r.item?.fields?.cues === "string" && r.item.fields.cues.length > 0,
        ref: r.item?.ref ?? null, uuid: r.item?.uuid ?? null,
      };
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return {
      isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf,
      hasRoll: typeof acksExtras.magicItems?.roll === "function",
      hasImport: typeof acksExtras.importer?.cookbookImportMagicItems === "function",
      hasRepairTally: typeof H.RF.repairTally === "function" && typeof H.CB.forgetImportedIndex === "function" && typeof H.CB.importedItemFor === "function",
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__mt;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__mtBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__mtBook = { done: true, ok: true }; })
      .catch(() => { globalThis.__mtBook = { done: true, ok: false, error: "threw" }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const open = !!globalThis.__mt.CB.cookbookSessionDoc(id);
    return { ...(globalThis.__mtBook ?? {}), open, done: !!(globalThis.__mtBook?.done || open) };
  },
  /** The Tome's magic-item rows, read off the served cookbook file: the ids and their categories. */
  cookbook: async () => {
    const H = globalThis.__mt;
    const res = await fetch("/modules/acks-extras/cookbook/tt.json");
    if (!res.ok) return { ok: false };
    const cb = await res.json();
    const rows = Object.entries(cb.entries ?? {}).filter(([, e]) => e?.kind === "kind.magicItem");
    H.ids = rows.map(([id]) => id);
    H.cats = Object.fromEntries(rows.map(([id, e]) => [id, e.meta?.category ?? null]));
    const perCategory = {};
    for (const c of Object.values(H.cats)) perCategory[c] = (perCategory[c] ?? 0) + 1;
    return { ok: true, ids: H.ids, perCategory };
  },

  /** A run of the tables import or of the item import, as a job the driver polls. */
  tablesJob: async () => {
    globalThis.__mtJob = { done: false };
    acksExtras.importer.cookbookImportTables(["magicItemTables"])
      .then((r) => {
        const mine = (id) => /^magicItemTables\b/.test(String(id?.docId ?? id));
        const tome = acksExtras.importer.BOOKS?.tt?.label;
        globalThis.__mtJob = {
          done: true, ok: !!r, incomplete: (r?.incomplete ?? []).filter(mine).length, unread: (r?.missingTables ?? []).filter(mine).length,
          optionalBooks: [...(r?.optionalBooks ?? [])].length, optionalNamesTome: !!tome && [...(r?.optionalBooks ?? [])].includes(tome),
          missingNamesTome: !!tome && [...(r?.missingBooks ?? [])].includes(tome),
        };
      })
      .catch(() => { globalThis.__mtJob = { done: true, ok: false, error: "threw" }; });
    return { started: true };
  },
  itemsJob: async ({ repair = false, only = null }) => {
    const H = globalThis.__mt;
    globalThis.__mtJob = { done: false };
    const args = {};
    if (only) args.only = new Set(only);
    if (repair) args.repair = H.RF.repairTally();
    acksExtras.importer.cookbookImportMagicItems(args)
      .then((r) => {
        globalThis.__mtJob = {
          done: true, ok: !!r && typeof r === "object", made: r?.made ?? null, already: r?.already ?? null, refused: r?.refused ?? null,
          created: r?.created?.items?.length ?? null, replaced: args.repair?.replaced ?? null, repairRefused: args.repair?.refused ?? null,
        };
      })
      .catch(() => { globalThis.__mtJob = { done: true, ok: false, error: "threw" }; });
    return { started: true };
  },
  jobState: async () => globalThis.__mtJob ?? { done: false },

  /** The subtables document and the hops into it, as booleans and counts. */
  chain: async () => {
    const H = globalThis.__mt;
    if (!H.T.hasDoc("magicItemTables")) return { doc: false };
    const sub = H.table("subtables") ?? {};
    const keys = Object.keys(sub);
    const per = {};
    for (const k of keys) {
      const m = /^([A-Za-z]+)\d+$/.exec(k);
      per[m ? m[1] : "?"] = (per[m ? m[1] : "?"] ?? 0) + 1;
    }
    const hopsInto = (bands) => {
      const leaves = H.leaves(bands);
      return leaves.length > 0 && leaves.every((b) => typeof b.hop === "string" && b.hop.startsWith("subtables.") && keys.includes(b.hop.slice("subtables.".length)));
    };
    const classic = H.table("classic") ?? {};
    const heroic = H.table("heroic") ?? {};
    const types = H.table("classicType")?.bands ?? [];
    const hops = types.map((b) => b.hop ?? null);
    return {
      doc: true, subtables: keys.length, per,
      subtablesTile: keys.filter((k) => H.tiles(sub[k])).length,
      classicLists: Object.keys(classic).length, classicHop: Object.values(classic).filter(hopsInto).length,
      armorsHop: hopsInto(classic.armors),
      heroicLists: Object.keys(heroic).length, heroicHop: Object.values(heroic).filter(hopsInto).length,
      typeBands: types.length, typeHopsDistinct: new Set(hops).size,
      typeHopsResolve: hops.filter((h) => typeof h === "string" && h.startsWith("classic.") && Object.hasOwn(classic, h.slice("classic.".length))).length,
      rarities: Object.keys(heroic),
    };
  },
  /** One roll per Random Type row, the first die rigged onto that row, the rest on the first face. */
  typeRolls: async () => {
    const H = globalThis.__mt;
    const out = [];
    for (const b of H.table("classicType")?.bands ?? []) {
      const r = await acksExtras.magicItems.roll({ from: "classicType.bands", roller: H.roller([b.min]) });
      out.push({ hop: b.hop ?? null, ...H.sum(r) });
    }
    return out;
  },
  /** Rolls on the Foundry dice: `n` from the type list, `n` from each rarity. */
  realRolls: async ({ n, rarities }) => {
    const H = globalThis.__mt;
    const classic = [];
    for (let i = 0; i < n; i++) classic.push(H.sum(await acksExtras.magicItems.roll({ style: "classic" })));
    const heroic = [];
    for (const rarity of rarities) {
      for (let i = 0; i < n; i++) heroic.push({ rarity, ...H.sum(await acksExtras.magicItems.roll({ style: "heroic", rarity })) });
    }
    return { classic, heroic };
  },
  /** From classic.potions on the top face, then the first inner band, then the first row of whichever list that hops into. */
  potionsTail: async () => {
    const H = globalThis.__mt;
    const bands = H.table("classic")?.potions ?? [];
    const last = bands.at(-1);
    const r = await acksExtras.magicItems.roll({ from: "classic.potions", roller: H.roller(["top", 1, 1]) });
    return { tailHasInner: Array.isArray(last?.sub) && last.sub.length >= 2, ...H.sum(r) };
  },

  /** The Ruledata Browser's entries for the subtables. */
  entries: async () => {
    const H = globalThis.__mt;
    const all = H.TD.listEntries().filter((e) => e.docId === "magicItemTables" && e.tableId === "subtables");
    return { subtables: all.length, rollable: all.filter((e) => e.rollable).length };
  },
  /** Export one list as its RollTable, the Browser's own path; report its shape against the bands. */
  exportList: async ({ docId, tableId, subId }) => {
    const H = globalThis.__mt;
    const entry = H.TD.listEntries().find((e) => e.docId === docId && e.tableId === tableId && (subId == null || e.subId === subId));
    if (!entry) return { entry: false };
    const before = new Set(game.tables.map((t) => t.uuid));
    const packsBefore = new Set();
    for (const p of game.packs.filter((p) => p.documentName === "RollTable")) for (const i of p.index) packsBefore.add(`Compendium.${p.collection}.RollTable.${i._id}`);
    const out = await H.TD.exportEntry(entry);
    const table = out?.uuid ? await fromUuid(out.uuid) : null;
    const raw = H.T.getTable(docId, tableId);
    const bands = subId != null ? raw?.[subId] : (raw?.bands ?? raw);
    const created = !!out?.uuid && !before.has(out.uuid) && !packsBefore.has(out.uuid);
    const text = (r) => [r.description, r.text, r.name].map((v) => String(v ?? "")).join(" ");
    return {
      entry: true, uuid: out?.uuid ?? null, kind: out?.kind ?? null, created,
      results: table?.results?.size ?? null, bands: Array.isArray(bands) ? bands.length : null,
      formulaReachesTop: !!table && Array.isArray(bands) && table.formula === `1d${H.top(bands)}`,
      everyResultHasText: !!table && [...table.results].every((r) => text(r).trim().length > 0),
      someResultHasCue: !!table && [...table.results].some((r) => text(r).includes(" — ")),
    };
  },

  /** Tables 11: take the Tome's session entry out of the importer's open-books map, keeping it to put back. */
  tomeClose: async () => {
    const H = globalThis.__mt;
    const map = H.SS.ctx?.sessionDocs;
    if (!map?.has("tt")) return { had: false, open: !!acksExtras.importer.bookOpen("tt"), jjOpen: !!acksExtras.importer.bookOpen("jj") };
    H.tomeHeld = map.get("tt");
    map.delete("tt");
    return { had: true, open: !!acksExtras.importer.bookOpen("tt"), jjOpen: !!acksExtras.importer.bookOpen("jj") };
  },
  /** Tables 11: put the held session entry back, as it was. */
  tomeOpen: async () => {
    const H = globalThis.__mt;
    const map = H.SS.ctx?.sessionDocs;
    const held = !!H.tomeHeld;
    if (map && H.tomeHeld && !map.has("tt")) map.set("tt", H.tomeHeld);
    if (map?.has("tt")) H.tomeHeld = null;
    return { held, open: !!acksExtras.importer.bookOpen("tt") };
  },
  /** The magicItemTables document as the Tome's tables stand in it, as counts and a digest. */
  tomeState: async () => {
    const H = globalThis.__mt;
    const doc = H.T.getDoc("magicItemTables");
    const tables = doc.tables ?? {};
    const hopsIn = (t) => Object.values(t ?? {}).reduce((n, bands) => n + H.leaves(bands).filter((b) => typeof b.hop === "string").length, 0);
    return {
      open: !!acksExtras.importer.bookOpen("tt"),
      tables: Object.keys(tables).length, cites: Object.keys(doc.cites ?? {}).length,
      citesTT: Object.values(doc.cites ?? {}).filter(H.fromTT).length,
      hasSubtables: Object.hasOwn(tables, "subtables"), subtables: Object.keys(tables.subtables ?? {}).length,
      classicHops: hopsIn(tables.classic), heroicHops: hopsIn(tables.heroic),
      typeHops: (tables.classicType?.bands ?? []).filter((b) => typeof b.hop === "string").length,
      digest: H.digest([tables.classic, tables.heroic, tables.classicType, tables.subtables]),
    };
  },

  /** Tables 12, the drop: what the Browser's drop does (`parseDrop`, then `setOverride`), the stored layer read back against the list as it read. */
  dropRound: async ({ docId, tableId, subId, uuid }) => {
    const H = globalThis.__mt;
    const entry = H.TD.listEntries().find((e) => e.docId === docId && e.tableId === tableId && e.subId === subId);
    if (!entry) return { entry: false };
    if (H.ST.hasOverride(docId, tableId)) return { entry: true, refused: true };
    const whole = foundry.utils.deepClone(H.T.getTable(docId, tableId));
    const before = whole[subId];
    H.dropBefore = { digest: H.digest(before), hops: H.hopList(before), keys: Object.keys(whole).sort().join(",") };
    const { data, sourceUuid, sourceName } = await H.TD.parseDrop(entry, { uuid });
    await H.ST.setOverride(docId, tableId, data, { sourceUuid, sourceName });
    const set = await H.settle(() => H.ST.hasOverride(docId, tableId) && !!H.T.getLayer(docId, H.T.PRIORITY.OVERRIDE)?.tables?.[tableId]);
    const layer = H.T.getLayer(docId, H.T.PRIORITY.OVERRIDE)?.tables?.[tableId];
    const stored = layer?.[subId];
    const innerOf = (bands) => (bands ?? []).flatMap((b) => (Array.isArray(b.sub) ? b.sub : []));
    const hopped = (list) => list.filter((h) => typeof h === "string").length;
    return {
      entry: true, refused: false, set, stored: Array.isArray(stored),
      bands: before.length, storedBands: stored?.length ?? null,
      innerBefore: innerOf(before).length, innerStored: innerOf(stored).length,
      hopsBefore: hopped(H.dropBefore.hops), hopsStored: hopped(H.hopList(stored)),
      innerHopsBefore: innerOf(before).filter((b) => typeof b.hop === "string").length,
      innerHopsStored: innerOf(stored).filter((b) => typeof b.hop === "string").length,
      hopsSame: JSON.stringify(H.hopList(stored)) === JSON.stringify(H.dropBefore.hops),
      sameBands: H.digest(stored) === H.dropBefore.digest,
      otherListsKept: Object.keys(layer ?? {}).sort().join(",") === H.dropBefore.keys,
      readsSame: H.digest(H.T.getTable(docId, tableId)[subId]) === H.dropBefore.digest,
      sourced: typeof H.ST.overrideMeta(docId, tableId)?.sourceUuid === "string",
    };
  },
  /** Tables 12, Remove override: what the Browser's Remove override calls (`clearOverride`); the table read back against the list before the drop. */
  removeOverride: async ({ docId, tableId, subId }) => {
    const H = globalThis.__mt;
    await H.ST.clearOverride(docId, tableId);
    const gone = await H.settle(() => !H.ST.hasOverride(docId, tableId) && !H.T.getLayer(docId, H.T.PRIORITY.OVERRIDE)?.tables?.[tableId]);
    const now = H.T.getTable(docId, tableId)[subId];
    return {
      gone, hadBefore: !!H.dropBefore,
      sameBands: !!H.dropBefore && H.digest(now) === H.dropBefore.digest,
      hopsSame: !!H.dropBefore && JSON.stringify(H.hopList(now)) === JSON.stringify(H.dropBefore.hops),
    };
  },

  /** What the import wrote for every cookbook row of the Tome, as booleans and counts. */
  inspect: async () => {
    const H = globalThis.__mt;
    H.CB.forgetImportedIndex();
    const TYPE = { swords: "weapon", weapons: "weapon", armors: "armor" };
    const folders = {};
    const parents = new Set();
    let found = 0, named = 0, described = 0, typed = 0, inFolder = 0, nested = 0, folderNamed = 0, magic = 0, packed = 0;
    for (const id of H.ids) {
      const doc = await H.CB.importedItemFor(id);
      if (!doc) continue;
      found++;
      const cat = H.cats[id];
      if (String(doc.name ?? "").trim()) named++;
      if (String(doc.system?.description ?? "").replace(/<[^>]*>/g, "").trim()) described++;
      if (doc.type === (TYPE[cat] ?? "item")) typed++;
      if (doc.getFlag("acks-extras", "markets")?.magic === true) magic++;
      if (doc.pack) packed++;
      if (!doc.folder) continue;
      inFolder++;
      (folders[cat] ??= new Set()).add(doc.folder.id);
      if (doc.folder.name === game.i18n.localize([H.IC.LANG_PREFIX, "magicItems", "category", cat].join("."))) folderNamed++;
      if (doc.folder.folder) { nested++; parents.add(doc.folder.folder.id); }
    }
    const sets = Object.values(folders);
    return {
      found, named, described, typed, magic, packed, inFolder, folderNamed, nested,
      oneFolderPerCategory: sets.every((s) => s.size === 1), categoryFolders: sets.length,
      foldersDistinct: new Set(sets.map((s) => [...s][0])).size === sets.length,
      parentFolders: parents.size,
    };
  },
  /** The markets flag of one imported item: its keys, its flag and whether both figures are numbers. */
  markets: async ({ id }) => {
    const H = globalThis.__mt;
    const doc = await H.CB.importedItemFor(id);
    const m = doc?.getFlag("acks-extras", "markets");
    if (!m) return { found: !!doc, markets: false };
    return { found: true, markets: true, keys: Object.keys(m).sort(), magic: m.magic === true, base: typeof m.baseCostGp === "number" && Number.isFinite(m.baseCostGp), apparent: typeof m.apparentValueGp === "number" && Number.isFinite(m.apparentValueGp) };
  },
  /** The uuid each id's imported item has now, null where none stands. */
  uuids: async ({ ids }) => {
    const H = globalThis.__mt;
    H.CB.forgetImportedIndex();
    const out = {};
    for (const id of ids) out[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    return out;
  },
  /** Of `ids`, those whose markets flag holds both figures as numbers. */
  figured: async ({ ids }) => {
    const H = globalThis.__mt;
    const out = [];
    for (const id of ids) {
      const m = (await H.CB.importedItemFor(id))?.getFlag("acks-extras", "markets");
      if (typeof m?.baseCostGp === "number" && typeof m?.apparentValueGp === "number") out.push(id);
    }
    return out;
  },
  /** The fixture stamp the driver's `mark` cannot write on a compendium document. */
  stamp: async ({ uuid, marker }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return { ok: false };
    await doc.update({ "flags.world.fixture": marker });
    return { ok: (await fromUuid(uuid))?.flags?.world?.fixture === marker };
  },
  /** Entries 3, before the repair: `a` gets a hand edit and a quantity, `b` is as an earlier import left it (figure and stamp agree, stale). */
  edit: async ({ a, b }) => {
    const H = globalThis.__mt;
    const A = await H.CB.importedItemFor(a);
    const B = await H.CB.importedItemFor(b);
    if (!A || !B) return { ok: false };
    const mk = (d) => d.getFlag("acks-extras", "markets");
    H.held = { a: { uuid: A.uuid, base: mk(A).baseCostGp, apparent: mk(A).apparentValueGp }, b: { uuid: B.uuid, base: mk(B).baseCostGp, apparent: mk(B).apparentValueGp } };
    await A.update({ "flags.acks-extras.markets.baseCostGp": H.held.a.base + 7, "system.quantity.value": 3 });
    await B.update({ "flags.acks-extras.markets.baseCostGp": H.held.b.base + 7, "flags.acks-extras.cookbook.read.markets.baseCostGp": H.held.b.base + 7 });
    const A2 = await fromUuid(H.held.a.uuid);
    const B2 = await fromUuid(H.held.b.uuid);
    return { ok: true, aEdited: mk(A2).baseCostGp === H.held.a.base + 7 && A2.system.quantity?.value === 3, bEdited: mk(B2).baseCostGp === H.held.b.base + 7 };
  },
  /** Entries 3, after the repair. */
  afterRepair: async () => {
    const H = globalThis.__mt;
    const A = await fromUuid(H.held.a.uuid);
    const B = await fromUuid(H.held.b.uuid);
    const mk = (d) => d?.getFlag("acks-extras", "markets");
    return {
      aStands: mk(A)?.baseCostGp === H.held.a.base + 7,
      aApparentFromPage: mk(A)?.apparentValueGp === H.held.a.apparent,
      aQuantityKept: A?.system?.quantity?.value === 3,
      bRewritten: mk(B)?.baseCostGp === H.held.b.base,
      bStampRewritten: B?.getFlag("acks-extras", "cookbook")?.read?.markets?.baseCostGp === H.held.b.base,
      bQuantityKept: B?.system?.quantity?.value === 1,
    };
  },
  /** Entries 5: potions4's rows against the cookbook, and the faces that land on a linked and an unlinked row. */
  linkRows: async () => {
    const H = globalThis.__mt;
    const bands = H.table("subtables")?.potions4 ?? [];
    const leaves = bands.flatMap((b) => (Array.isArray(b.sub) ? b.sub.map((s) => ({ s, plan: [b.min, s.min] })) : [{ s: b, plan: [b.min] }]));
    const linked = leaves.filter(({ s }) => typeof s.ref === "string");
    const bare = leaves.find(({ s }) => s.ref === null);
    return {
      leaves: leaves.length, everyLeafHasRef: leaves.every(({ s }) => Object.hasOwn(s, "ref")),
      refShape: leaves.every(({ s }) => s.ref === null || /^tt\.item\d+$/.test(s.ref)),
      linked: linked.length, linkedKnown: linked.every(({ s }) => H.ids.includes(s.ref)),
      linkedPlan: linked[0]?.plan ?? null, linkedRef: linked[0]?.s.ref ?? null, barePlan: bare?.plan ?? null,
    };
  },
  /** Entries 5: a roll from potions4 on the rigged faces. */
  rollSub: async ({ plan }) => {
    const H = globalThis.__mt;
    return H.sum(await acksExtras.magicItems.roll({ from: "subtables.potions4", roller: H.roller(plan) }));
  },

  /** The Player seat's read of the registry. */
  registry: async () => {
    const H = globalThis.__mt;
    if (!H.T.hasDoc("magicItemTables")) return { doc: false };
    const sub = H.table("subtables") ?? {};
    const classic = H.table("classic") ?? {};
    const hops = (H.table("classicType")?.bands ?? []).map((b) => b.hop ?? null);
    return {
      doc: true, subtables: Object.keys(sub).length,
      classicHop: Object.values(classic).filter((bands) => H.leaves(bands).every((b) => typeof b.hop === "string")).length,
      typeHopsDistinct: new Set(hops).size,
      canRoll: (await acksExtras.magicItems.roll({ style: "classic" })).ok,
    };
  },
  drain: async () => ({ errors: globalThis.__mt.errors.slice() }),
  restore: async () => {
    const H = globalThis.__mt;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    H.patched = false;
    return "restored";
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer && !!globalThis.acksExtras?.lib?.tables && typeof globalThis.acksExtras?.magicItems?.roll === "function"`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

async function waitFor(api, fn, args, label, seconds = 300) {
  const t0 = Date.now();
  for (;;) {
    const state = await run(api, fn, args);
    if (state.done) return state;
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not done after ${seconds}s`);
    await sleep(2000);
  }
}

let gm = null;
let player = null;
/** Uuids this run tracked and has not yet swept. */
const own = [];
/** Whether an item import ran, so the teardown restores what the run swept. */
let touched = false;
/** The Tome cookbook's row count, once read. */
let COUNT = 0;
/** The Tome's staged path, kept so the teardown can reconnect it if the session entry cannot be put back. */
let ttPath = null;
/** Whether step 11 took the Tome off the seat and has not yet put it back. */
let tomeClosed = false;
/** Whether step 12's drop wrote an override this run has not yet removed. */
let overrideSet = false;
const CLASSIC_POTIONS = { docId: "magicItemTables", tableId: "classic", subId: "potions" };
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 3_000_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** The recipe's marker for an item, `importer/magic-item-<n>`, tag-suffixed as the driver would. */
const markerOf = (id) => `importer/magic-item-${id.replace(/^tt\.item/, "")}${MACHINE.own ? `@${MACHINE.own}` : ""}`;

/** Mark an imported item and track it; the driver's mark refuses a compendium uuid, so the stamp is written here. */
async function markItem(uuid, id) {
  const marker = markerOf(id);
  let how = "marked";
  try {
    await gm.mark(uuid, marker.replace(/@.*$/, ""));
  } catch (err) {
    how = /compendium/i.test(String(err?.message ?? err)) ? "stamped" : "failed";
    if (how === "failed") throw err;
    const s = await run(gm, P.stamp, { uuid, marker });
    if (!s.ok) throw new Error(`the stamp on ${id} did not land`);
    await gm.track(uuid, "Item", marker);
  }
  if (!own.includes(uuid)) own.push(uuid);
  return how;
}

/** Delete a tracked item by the ledger; resolves the sweep's counts. */
async function sweepItem(uuid) {
  const out = await gm.sweepTracked({ only: [uuid] });
  const at = own.indexOf(uuid);
  if (at >= 0 && out.removed.length === 1) own.splice(at, 1);
  return out;
}

/** The item import as one job; resolves its counts. */
async function importItems(args = {}) {
  touched = true;
  await run(gm, P.itemsJob, args);
  return waitFor(gm, P.jobState, {}, "import the magic items", 900);
}

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  if (!installed.isGM) blocked("the GM seat joined is not a GM");
  if (!installed.hasRoll || !installed.hasImport || !installed.hasRepairTally) blocked("the served module lacks the magic-item roll, the item import or the repair tally: it is not the importer-books build");
  check("the GM seat is a GM and the served module carries the roll, the item import and the repair tally", true, { role: installed.role, activeGMIsSelf: installed.activeGMIsSelf });

  section("books");
  const staged = books(["jj", "tt"]);
  if (staged.length !== 2) blocked(`ACKS_TEST_BOOKS names ${staged.length} of jj and tt`);
  for (const { id, path } of staged) {
    if (id === "tt") ttPath = path;
    await run(gm, P.connectBook, { id, path });
    const state = await waitFor(gm, P.bookState, { id }, `connect ${id}`);
    check(`${id} is open on the seat`, state.open, { ok: state.ok ?? null, error: state.error ?? null });
  }

  section("the Tome's magic-item rows");
  const cb = await run(gm, P.cookbook);
  if (!cb.ok || !cb.ids?.length) blocked("the served cookbook/tt.json is missing or holds no kind.magicItem rows: it is not the importer-books build");
  const IDS = cb.ids;
  COUNT = IDS.length;
  note("kind.magicItem rows in the served tt cookbook", { count: COUNT, perCategory: cb.perCategory });
  check("every row id is tt.item<n>, all distinct", IDS.every((id) => /^tt\.item\d+$/.test(id)) && new Set(IDS).size === COUNT);

  section("tables: the Rules tables import of magicItemTables");
  await run(gm, P.tablesJob);
  const job = await waitFor(gm, P.jobState, {}, "import magicItemTables", 420);
  check("the Rules tables import of magicItemTables ran with nothing unread or incomplete", job.ok && !job.incomplete && !job.unread, job);

  section("The magic-item and arms tables: 8");
  const ch = await run(gm, P.chain);
  note("chain", ch);
  check("8. the magicItemTables document is written", ch.doc);
  check("8. subtables holds 45 lists, each category with the recipe's count", ch.subtables === 45 && JSON.stringify(Object.entries(ch.per ?? {}).sort()) === JSON.stringify(Object.entries(PER_CATEGORY).sort()), { subtables: ch.subtables, per: ch.per });
  check("8. every subtable tiles its die", ch.subtablesTile === ch.subtables, { tile: ch.subtablesTile });
  check("8. all eight classic lists have every row hopping into a subtable, the armour list included", ch.classicLists === 8 && ch.classicHop === 8 && ch.armorsHop, { lists: ch.classicLists, hop: ch.classicHop, armors: ch.armorsHop });
  check("8. all five heroic lists have every row hopping into a subtable", ch.heroicLists === 5 && ch.heroicHop === 5, { lists: ch.heroicLists, hop: ch.heroicHop });

  section("The magic-item and arms tables: 9");
  check("9. eight Random Type rows, each hopping to a different classic list that exists", ch.typeBands === 8 && ch.typeHopsDistinct === 8 && ch.typeHopsResolve === 8, { bands: ch.typeBands, distinct: ch.typeHopsDistinct, resolve: ch.typeHopsResolve });
  const types = await run(gm, P.typeRolls);
  const walkedOk = (t) => t.ok && t.flag === null && t.lists.length === 3 && t.lists[0] === "classicType.bands" && t.lists[1] === t.hop && /^subtables\./.test(t.lists[2]);
  note("type rolls", { rolls: types.length, walked: types.filter(walkedOk).length, hopsDistinct: new Set(types.map((t) => t.lists?.[1])).size });
  check("9. a roll rigged onto each Random Type row shows a type step, a category step and a subtable step, and ends unflagged for all eight categories", types.length === 8 && types.every(walkedOk) && new Set(types.map((t) => t.lists[1])).size === 8, types.map((t) => ({ lists: t.lists, flag: t.flag })));
  const real = await run(gm, P.realRolls, { n: 4, rarities: ch.rarities ?? [] });
  const heroicOk = (t) => t.ok && t.flag === null && t.lists.length === 2 && t.lists[0] === `heroic.${t.rarity}` && /^subtables\./.test(t.lists[1]) && t.citesTT[1];
  note("real rolls", { classic: real.classic.length, heroic: real.heroic.length });
  check("9. Foundry-dice rolls from the type list end unflagged, each a type, a category and a subtable step", real.classic.length === 4 && real.classic.every((t) => t.ok && t.flag === null && t.lists.length === 3 && t.lists[0] === "classicType.bands" && /^subtables\./.test(t.lists[2])), real.classic.map((t) => t.flag));
  check("9. rolls from each of the five heroic rarities show a rarity step then a subtable step, end unflagged, and cite the Tome on the subtable step", (ch.rarities ?? []).length === 5 && real.heroic.length === 20 && real.heroic.every(heroicOk), { flags: real.heroic.filter((t) => t.flag !== null).length, notTT: real.heroic.filter((t) => !t.citesTT?.[1]).length });
  check("entries 6. no rolled step carries a link of its own and none ends flagged, from the type list and the rarities", [...real.classic, ...real.heroic, ...types].every((t) => t.stepsCarryNoLink && t.flag === null));

  section("The magic-item and arms tables: 10");
  const tail = await run(gm, P.potionsTail);
  note("potions tail", { lists: tail.lists, inner: tail.inner, flag: tail.flag, ok: tail.ok });
  check("10. the top face of the potions list is a tail of inner bands and its step shows the inner roll", tail.tailHasInner && tail.ok && tail.inner?.[0] === true, { tailHasInner: tail.tailHasInner, inner: tail.inner });
  check("10. the walk continues into a potions subtable and the item is named, carrying its cues", tail.lists?.length === 2 && tail.lists[0] === "classic.potions" && /^subtables\.potions\d+$/.test(tail.lists[1]) && tail.flag === null && tail.named && tail.cues, { lists: tail.lists, named: tail.named, cues: tail.cues });
  check("10. each step of the rigged roll cites the Tome's page", tail.citesTT?.length === 2 && tail.citesTT.every(Boolean), tail.citesTT);

  section("The magic-item and arms tables: 11");
  const pre = await run(gm, P.tomeState);
  note("before the Tome is disconnected", { open: pre.open, tables: pre.tables, subtables: pre.subtables, classicHops: pre.classicHops, heroicHops: pre.heroicHops, citesTT: pre.citesTT });
  tomeClosed = true;
  const closed = await run(gm, P.tomeClose);
  check("11. the Tome is disconnected from the seat and the Judges Journal stays open", closed.had && !closed.open && closed.jjOpen, closed);
  await run(gm, P.tablesJob);
  const jobClosed = await waitFor(gm, P.jobState, {}, "import magicItemTables without the Tome", 420);
  note("import without the Tome", jobClosed);
  check("11. the import report names the Tome as an optional book that is not open", jobClosed.ok && jobClosed.optionalNamesTome && !jobClosed.missingNamesTome, { ok: jobClosed.ok, optional: jobClosed.optionalBooks, namesTome: jobClosed.optionalNamesTome, missingNamesTome: jobClosed.missingNamesTome });
  const during = await run(gm, P.tomeState);
  const chClosed = await run(gm, P.chain);
  check("11. the Tome's raw tables stay in the document: the same table keys, the same subtables, the same Tome cites", !during.open && during.tables === pre.tables && during.hasSubtables && during.subtables === pre.subtables && during.cites === pre.cites && during.citesTT === pre.citesTT && pre.citesTT > 0, { tables: [pre.tables, during.tables], subtables: [pre.subtables, during.subtables], citesTT: [pre.citesTT, during.citesTT] });
  check("11. the same lists still stand as the Tome's: every classic and heroic list keeps its hops, the type list its eight", during.classicHops === pre.classicHops && during.heroicHops === pre.heroicHops && during.typeHops === pre.typeHops && chClosed.classicHop === ch.classicHop && chClosed.heroicHop === ch.heroicHop && chClosed.armorsHop && chClosed.typeHopsResolve === ch.typeHopsResolve, { classicHops: [pre.classicHops, during.classicHops], heroicHops: [pre.heroicHops, during.heroicHops], classicHop: chClosed.classicHop, heroicHop: chClosed.heroicHop });
  const realClosed = await run(gm, P.realRolls, { n: 1, rarities: ch.rarities ?? [] });
  check("11. a roll from the type list and one from each rarity still end unflagged and cite the Tome on the subtable step", realClosed.classic.length === 1 && realClosed.classic.every((t) => t.ok && t.flag === null && t.lists.length === 3) && realClosed.heroic.length === (ch.rarities ?? []).length && realClosed.heroic.every(heroicOk), { classic: realClosed.classic.map((t) => t.flag), heroicFlags: realClosed.heroic.filter((t) => t.flag !== null).length, notTT: realClosed.heroic.filter((t) => !t.citesTT?.[1]).length });
  let opened = await run(gm, P.tomeOpen);
  if (!opened.open && ttPath) {
    await run(gm, P.connectBook, { id: "tt", path: ttPath });
    await waitFor(gm, P.bookState, { id: "tt" }, "reconnect tt", 240);
    opened = { ...opened, reconnected: true, open: (await run(gm, P.bookState, { id: "tt" })).open };
  }
  check("11. the Tome is open on the seat again, the held session entry put back", opened.open, opened);
  await run(gm, P.tablesJob);
  const jobBack = await waitFor(gm, P.jobState, {}, "import magicItemTables with the Tome again", 420);
  if (opened.open && jobBack.ok) tomeClosed = false;
  const post = await run(gm, P.tomeState);
  const chBack = await run(gm, P.chain);
  check("11. the import with the Tome again ran with nothing unread or incomplete and no optional book left unopened", jobBack.ok && !jobBack.incomplete && !jobBack.unread && !jobBack.optionalNamesTome, jobBack);
  check("11. the world ends as it began: the same subtables key count, hop counts and tables", post.open && post.subtables === pre.subtables && post.classicHops === pre.classicHops && post.heroicHops === pre.heroicHops && post.typeHops === pre.typeHops && post.tables === pre.tables && post.citesTT === pre.citesTT && post.digest === pre.digest && chBack.subtables === ch.subtables && chBack.classicHop === ch.classicHop && chBack.heroicHop === ch.heroicHop, { subtables: [pre.subtables, post.subtables], classicHops: [pre.classicHops, post.classicHops], heroicHops: [pre.heroicHops, post.heroicHops], sameDigest: post.digest === pre.digest });

  section("The magic-item and arms tables: 12");
  const en = await run(gm, P.entries);
  note("entries", en);
  check("12. the 45 subtable entries are in the Browser and every one is rollable", en.subtables === 45 && en.rollable === 45, en);
  const ex = await run(gm, P.exportList, { docId: "magicItemTables", tableId: "subtables", subId: "potions1" });
  if (ex.created && ex.uuid) { own.push(ex.uuid); await gm.track(ex.uuid, "RollTable"); }
  note("export of a potions subtable", { kind: ex.kind, created: ex.created, results: ex.results, bands: ex.bands });
  check("12. a potions subtable exports as a RollTable of one result per band, its formula the die its bands reach, each result with text and the cue joined to its name", ex.entry && ex.kind === "rolltable" && ex.results === ex.bands && ex.formulaReachesTop && ex.everyResultHasText && ex.someResultHasCue, ex);

  const exC = await run(gm, P.exportList, CLASSIC_POTIONS);
  if (exC.created && exC.uuid) { own.push(exC.uuid); await gm.track(exC.uuid, "RollTable"); }
  note("export of the classic potions list", { kind: exC.kind, created: exC.created, results: exC.results, bands: exC.bands });
  check("12. a classic category list exports as a RollTable of one result per band, its formula the die its bands reach", exC.entry && exC.kind === "rolltable" && exC.results === exC.bands && exC.formulaReachesTop, exC);
  if (exC.uuid) {
    overrideSet = true;
    const dr = await run(gm, P.dropRound, { ...CLASSIC_POTIONS, uuid: exC.uuid });
    if (!dr.entry || dr.refused) overrideSet = false;
    note("drop of the exported list back over its entry", dr);
    check("12. no override stood on the classic table before the drop, and the drop wrote one with its source", dr.entry && !dr.refused && dr.set && dr.stored && dr.sourced, { refused: dr.refused, set: dr.set, stored: dr.stored, sourced: dr.sourced });
    check("12. the stored layer keeps every hop, inner bands included, the same bands and the other lists of the table", dr.hopsBefore > 0 && dr.innerBefore >= 2 && dr.innerHopsBefore >= 2 && dr.hopsStored === dr.hopsBefore && dr.innerStored === dr.innerBefore && dr.innerHopsStored === dr.innerHopsBefore && dr.hopsSame && dr.storedBands === dr.bands && dr.otherListsKept, { hops: [dr.hopsBefore, dr.hopsStored], inner: [dr.innerBefore, dr.innerStored], innerHops: [dr.innerHopsBefore, dr.innerHopsStored], bands: [dr.bands, dr.storedBands], otherListsKept: dr.otherListsKept });
    note("the dropped list against the list before", { sameBands: dr.sameBands, readsSame: dr.readsSame });
    if (overrideSet) {
      const rm = await run(gm, P.removeOverride, CLASSIC_POTIONS);
      overrideSet = false;
      check("12. Remove override clears the layer and the table reads as before, hops included", rm.gone && rm.hadBefore && rm.sameBands && rm.hopsSame, rm);
    }
  }

  section("Magic item entries: 1, 2");
  const imp = await importItems();
  note("import", imp);
  check("1. the import answered counts and refused none", imp.ok && imp.refused === 0, { made: imp.made, already: imp.already, refused: imp.refused });
  check("1. imported plus already present equals the Tome cookbook's kind.magicItem rows", imp.made + imp.already === COUNT, { made: imp.made, already: imp.already, count: COUNT });
  const ins = await run(gm, P.inspect);
  note("inspect", ins);
  check("1. every row is found by its cookbook id as a core item of its category's type, named, with a description", ins.found === COUNT && ins.named === COUNT && ins.described === COUNT && ins.typed === COUNT, { found: ins.found, named: ins.named, described: ins.described, typed: ins.typed, count: COUNT });
  check("1. each item sits in a category folder named for its category, one folder per category, all under one book folder, in a compendium", ins.inFolder === COUNT && ins.folderNamed === COUNT && ins.oneFolderPerCategory && ins.foldersDistinct && ins.nested === COUNT && ins.parentFolders === 1 && ins.packed === COUNT, { inFolder: ins.inFolder, named: ins.folderNamed, categories: ins.categoryFolders, parents: ins.parentFolders, packed: ins.packed });
  check("1. the folders cover the categories the cookbook names", ins.categoryFolders === Object.keys(cb.perCategory).length, { folders: ins.categoryFolders, categories: Object.keys(cb.perCategory).length });
  const m1 = await run(gm, P.markets, { id: "tt.item1" });
  check("2. tt.item1's markets flag is magic: true with baseCostGp and apparentValueGp numbers and no other key", m1.markets && m1.magic && m1.base && m1.apparent && JSON.stringify(m1.keys) === JSON.stringify(["apparentValueGp", "baseCostGp", "magic"]), { keys: m1.keys, magic: m1.magic, base: m1.base, apparent: m1.apparent });
  check("2. the markets flag of every imported item carries magic: true", ins.magic === COUNT, { magic: ins.magic });

  section("Magic item entries: 5, the link (read)");
  const lk = await run(gm, P.linkRows);
  note("potions4 rows", { leaves: lk.leaves, linked: lk.linked });
  check("5. every potions4 row carries ref, a tt.item<n> id of the cookbook or null", lk.leaves > 0 && lk.everyLeafHasRef && lk.refShape && lk.linkedKnown, { leaves: lk.leaves, refShape: lk.refShape, known: lk.linkedKnown });
  check("5. at least one potions4 row is linked to an entry", lk.linked >= 1 && !!lk.linkedPlan, { linked: lk.linked });
  const D = lk.linkedRef;

  section("Magic item entries: 3, a held edit");
  const rest = IDS.filter((id) => id !== D).slice(0, 24);
  const figured = await run(gm, P.figured, { ids: rest });
  const [A, B] = figured;
  const C = rest.find((id) => id !== A && id !== B);
  note("items driven", { edit: A ?? null, stale: B ?? null, deleted: C ?? null, linked: D ?? null });
  if (!A || !B || !C || !D) blocked("the walk found no two items with both figures, a third item and a linked potions4 row to drive");
  const uuidsNow = await run(gm, P.uuids, { ids: [A, B, C, D] });
  const how = [await markItem(uuidsNow[A], A), await markItem(uuidsNow[B], B), await markItem(uuidsNow[C], C)];
  note("markers written", { how });
  const ed = await run(gm, P.edit, { a: A, b: B });
  check("3. the hand edit and the stale-by-an-earlier-import state are in place", ed.ok && ed.aEdited && ed.bEdited, ed);
  await run(gm, P.itemsJob, { repair: true, only: [A, B] });
  const rep = await waitFor(gm, P.jobState, {}, "repair the two items", 300);
  check("3. the repair ran over both items and refused none", rep.ok && rep.already === 2 && rep.made === 0 && rep.replaced === 2 && rep.repairRefused === 0, rep);
  const after = await run(gm, P.afterRepair);
  check("3. the hand-edited figure stands, the other figure is read from the page, quantity keeps its value", after.aStands && after.aApparentFromPage && after.aQuantityKept, after);
  check("3. the untouched item's figure is rewritten from the page and its stamp with it, quantity kept", after.bRewritten && after.bStampRewritten && after.bQuantityKept, after);

  section("Magic item entries: 4, the delete path");
  const swept4 = await sweepItem(uuidsNow[C]);
  check("4. the ledger deleted the marked item", swept4.removed.length === 1 && !swept4.failed.length, { removed: swept4.removed.length, missing: swept4.missing.length, failed: swept4.failed.length });
  const gone = await run(gm, P.uuids, { ids: [C] });
  check("4. the item is gone from the library", gone[C] === null);
  const re = await importItems();
  note("reimport", re);
  check("4. Magic Items again: one imported, the rest already present, none refused", re.ok && re.made === 1 && re.already === COUNT - 1 && re.refused === 0, { made: re.made, already: re.already, refused: re.refused });
  const back = await run(gm, P.uuids, { ids: [C] });
  // The import keeps a stable id per cookbook row (target.mjs createDoc, keepId), so the
  // re-created document answers the deleted one's uuid; "back" is that it resolves again.
  check("4. the item is back (re-created under its stable id)", !!back[C] && back[C] === uuidsNow[C], { sameId: back[C] === uuidsNow[C] });
  const ins2 = await run(gm, P.inspect);
  check("4. every row is found again and every item still sits in its category folder", ins2.found === COUNT && ins2.inFolder === COUNT && ins2.folderNamed === COUNT && ins2.oneFolderPerCategory && ins2.parentFolders === 1, { found: ins2.found, inFolder: ins2.inFolder, named: ins2.folderNamed });

  section("Magic item entries: 5, the link");
  const linked = await run(gm, P.rollSub, { plan: lk.linkedPlan });
  note("linked roll", { ok: linked.ok, flag: linked.flag, lists: linked.lists, ref: linked.ref, uuidIsNull: linked.uuid === null });
  check("5. a roll on potions4 rigged onto a linked row ends on item.ref = the row's id and item.uuid = the imported item's uuid", linked.ok && linked.flag === null && linked.ref === D && linked.uuid === uuidsNow[D], { ref: linked.ref, expected: D, uuidMatches: linked.uuid === uuidsNow[D] });
  if (lk.barePlan) {
    const bare = await run(gm, P.rollSub, { plan: lk.barePlan });
    check("5. a roll rigged onto an unlinked row has ref null and uuid null", bare.ok && bare.ref === null && bare.uuid === null, { ref: bare.ref, uuidIsNull: bare.uuid === null });
  }
  await markItem(uuidsNow[D], D);
  const swept5 = await sweepItem(uuidsNow[D]);
  check("5. the ledger deleted the linked item", swept5.removed.length === 1 && !swept5.failed.length, { removed: swept5.removed.length, failed: swept5.failed.length });
  const unlinked = await run(gm, P.rollSub, { plan: lk.linkedPlan });
  check("5. after the delete the same roll keeps ref and answers uuid null", unlinked.ok && unlinked.ref === D && unlinked.uuid === null, { ref: unlinked.ref, uuidIsNull: unlinked.uuid === null });
  const re5 = await importItems();
  check("5. the import brings it back: one imported, the rest already present, none refused", re5.ok && re5.made === 1 && re5.already === COUNT - 1 && re5.refused === 0, { made: re5.made, already: re5.already, refused: re5.refused });
  const relinked = await run(gm, P.rollSub, { plan: lk.linkedPlan });
  const fresh = await run(gm, P.uuids, { ids: [D] });
  check("5. the same roll names the re-created document", relinked.uuid !== null && relinked.uuid === fresh[D], { uuidMatches: relinked.uuid === fresh[D], sameId: fresh[D] === uuidsNow[D] });

  section("Player seat: the registry reads the same");
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const seated = await run(player, P.install);
  const preg = await run(player, P.registry);
  check("the Player seat is a player and reads the same subtables and hops as the GM seat", !seated.isGM && preg.doc && preg.subtables === ch.subtables && preg.classicHop === ch.classicLists && preg.typeHopsDistinct === ch.typeHopsDistinct && preg.canRoll, { role: seated.role, subtables: preg.subtables });

  const drained = await run(gm, P.drain);
  check("no console error on the GM seat over the walk (recorder attached after ready)", !drained.errors.length, { errors: drained.errors.length });
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && overrideSet) {
    try {
      const rm = await run(gm, P.removeOverride, CLASSIC_POTIONS);
      note("override removed", { gone: rm.gone });
      check("teardown: the override this run set is removed", rm.gone, { gone: rm.gone });
    } catch (err) { console.error("remove override:", err?.message ?? err); checks.push(["teardown: the override this run set is removed", false]); }
  }
  if (gm && tomeClosed) {
    try {
      let o = await run(gm, P.tomeOpen);
      if (!o.open && ttPath) {
        await run(gm, P.connectBook, { id: "tt", path: ttPath });
        await waitFor(gm, P.bookState, { id: "tt" }, "reconnect tt", 240);
        o = { ...o, reconnected: true, open: (await run(gm, P.bookState, { id: "tt" })).open };
      }
      await run(gm, P.tablesJob);
      const j = await waitFor(gm, P.jobState, {}, "import magicItemTables after the walk", 420);
      note("Tome reconnected", { held: o.held, open: o.open, reconnected: !!o.reconnected, import: j.ok });
      check("teardown: the Tome is open on the seat and the tables import ran again", o.open && j.ok, { open: o.open, ok: j.ok });
    } catch (err) { console.error("restore Tome:", err?.message ?? err); checks.push(["teardown: the Tome is open on the seat and the tables import ran again", false]); }
  }
  let swept = 0;
  if (gm && own.length) {
    try {
      const out = await gm.sweepTracked({ only: [...own] });
      swept = out.removed.length;
      note("tracked documents swept", { removed: out.removed.length, missing: out.missing.length, failed: out.failed.length });
    } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  if (gm && touched) {
    try {
      await run(gm, P.itemsJob, {});
      const back = await waitFor(gm, P.jobState, {}, "restore the items", 900);
      note("items imported again", { made: back.made, already: back.already, refused: back.refused });
      check("teardown: every Tome item stands again, none refused", back.ok && back.refused === 0 && back.already + back.made > 0, { made: back.made, swept });
    } catch (err) { console.error("restore import:", err?.message ?? err); checks.push(["teardown: every Tome item stands again", false]); }
  }
  for (const api of [gm, player]) { try { if (api) note("restored", await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); } }
  console.log("imports kept: magicItemTables, the Tome's magic items");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
