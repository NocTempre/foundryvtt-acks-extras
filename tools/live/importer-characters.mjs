/**
 * Live walk, importer-characters: a person the page prints in full becomes a
 * character. Walks docs/importer/TESTING.md, "A person the page prints in full
 * becomes a character", steps 1–4, on AX1's character rows: its inhabitants
 * and its pregens, or one set of them (ROWS=people or ROWS=pregens). Machine
 * values arrive through ./_env.mjs, the book through ACKS_TEST_BOOKS ("ax1").
 * A check compares each imported figure with the page in the page and prints
 * a boolean; ids and counts are the only figures printed.
 *
 * Every section is setup (`.claude/rules/live-testing.md` step 4): the import's
 * first run, a rebuild through the entry picker, and a Judge's hand-out, each
 * a path by which a document comes to exist. Nothing the run makes is kept: a
 * standing inhabitant, or a world character claiming its entry, answers the
 * import's own "already imported?" question, so section 1 of the next run, and
 * every other walk that imports AX1, needs them absent (docs/importer/
 * DECISIONS.md, 2026-10-28). The sweep at teardown takes them by the run's own
 * ids. The claimant is marked `importer/claimant`, and section 1 retires one a
 * run that died before its sweep left standing.
 *
 * Fixtures and writes, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - every inhabitant the import makes, found under its stable id and
 *     tracked; the walk stops before the import when any of those ids already
 *     names a document, since that document is not this run's. With
 *     REBUILD_OK=1, the library owner's go-ahead, a world whose library holds
 *     every inhabitant has them all rebuilt in place through the entry picker
 *     instead, and none is tracked: each keeps its id, so the owner's library
 *     stands as it was, rebuilt from the page;
 *   - every ability definition the import supplies on demand: an id a made
 *     character embeds that the library did not hold before the import, read
 *     back under that id and tracked;
 *   - one world character claiming an inhabitant's entry and owned by the
 *     player seat, built with `api.fixture` under `importer/claimant`;
 *   - the rebuild of that inhabitant, driven through the entry picker's own
 *     dialogs (the rebuilt character keeps its id, so the ledger's uuid covers
 *     it);
 *   - where the rows hold a pregen, the world copy a Judge's hand-out makes of
 *     the last one (core's compendium Import, then OWNER for the player seat),
 *     tracked, and a second rebuild of that pregen's entry;
 *   - a shelf the import opens (deleted at teardown when empty).
 * Two create hooks observe the run, never sweep it: one proves the import
 * posts no chat card, the other that it made no actor beyond its own.
 *
 * With SHOTS=1 the run takes the release plate: an inhabitant's sheet on its
 * Stats tab, after the rebuild, into docs/releases/v<version>/.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const BOOK = "ax1";
const BOOKS = books([BOOK]);
const REBUILD_OK = process.env.REBUILD_OK === "1";
const ROWS = process.env.ROWS ?? "all";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const SHOTS = process.env.SHOTS === "1";
/** One release plate: `frame.keep` is the window `compose` leaves open, `frame.sel` what is shot (the window when absent). */
const plate = async (seat, slug, frame) => {
  if (!SHOTS || !frame?.keep) return null;
  try {
    await seat.compose(frame.keep);
    await sleep(500);
    const r = await seat.shot(`${shotDir()}/${slug}.png`, frame.sel ?? frame.keep);
    note(`shot ${slug}`, r);
    return r;
  } catch (err) {
    note(`shot ${slug} FAILED`, err?.message ?? String(err));
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ic = globalThis.__ic ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.AB = await import("/modules/acks-extras/scripts/importer/adventure-binding.mjs");
    H.CH = await import("/modules/acks-extras/scripts/importer/character-binding.mjs");
    H.EX = await import("/modules/acks-extras/scripts/importer/executor.mjs");
    H.CA = await import("/modules/acks-extras/scripts/classes/apply.mjs");
    H.MA = await import("/modules/acks-extras/scripts/character-sheet/pdf/match.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.LIB.whenReady?.();
    return { installed: true };
  },
  census: async ({ book, rows }) => {
    const H = globalThis.__ic;
    const doc = H.CB.cookbookSessionDoc(book);
    const ids = [];
    const pregens = [];
    let classesAnswered = 0;
    if (doc) {
      const cb = H.CB.cookbookEntry(`${book}.npc1`)?.cb;
      for (const [id, entry] of Object.entries(cb?.entries ?? {})) {
        const pregen = entry.kind === "kind.pregen";
        const person = entry.meta?.actor === "character";
        if ((pregen && rows !== "people") || (person && rows !== "pregens")) ids.push(id);
        if (pregen && rows !== "people") pregens.push(id);
      }
      const M = await import("/modules/acks-extras/scripts/character-sheet/pdf/match.mjs");
      for (const id of ids) {
        const node = await H.EX.executeEntry(doc, cb, {}, id);
        const name = node.fields.statline?.class?.name ?? "";
        if (M.matchClass(name) || H.CH.classBehindQualifier(name, M.matchClass)) classesAnswered++;
      }
    }
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      open: !!doc,
      characterType: game.documentTypes.Actor.includes("character"),
      ids,
      pregens,
      classesAnswered,
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__ic;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__icBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__icBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__icBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__icBook, open: !!globalThis.__ic.CB.cookbookSessionDoc(id) }),
  /** Every Actor document standing under one of the stable ids: the world's, and every world shelf's. */
  standing: async ({ ids }) => {
    const H = globalThis.__ic;
    const packs = game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world");
    const out = [];
    for (const id of ids) {
      const sid = H.AB.stableDocId(id);
      if (game.actors.has(sid)) out.push({ id, uuid: game.actors.get(sid).uuid });
      for (const p of packs) if (p.index.has(sid)) out.push({ id, uuid: `Compendium.${p.collection}.Actor.${sid}` });
    }
    return out;
  },
  actorPacks: async () => game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world").map((p) => p.collection),
  /** The cookbook ids of every ability definition the library holds. */
  libraryAbilityIds: async () => {
    const H = globalThis.__ic;
    return H.LIB.libraryItems().filter((i) => i.type === "ability").map((i) => i.flags?.["acks-extras"]?.cookbook?.id).filter(Boolean);
  },
  /**
   * The definitions the import supplied on demand: each ability a made
   * character embeds whose cookbook id the library did not hold before,
   * read back under that id.
   */
  onDemand: async ({ uuids, before }) => {
    const H = globalThis.__ic;
    const had = new Set(before);
    const ids = new Set();
    for (const uuid of uuids) {
      const actor = await fromUuid(uuid);
      for (const i of actor?.items ?? []) {
        const id = i.type === "ability" ? i.flags?.["acks-extras"]?.cookbook?.id : null;
        if (id && !had.has(id)) ids.add(id);
      }
    }
    const held = {};
    for (const id of ids) held[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    return held;
  },
  observe: async () => {
    const H = globalThis.__ic;
    H.seen = { chat: 0, actors: [] };
    H.observers = [
      ["createChatMessage", Hooks.on("createChatMessage", () => { H.seen.chat++; })],
      ["createActor", Hooks.on("createActor", (d) => H.seen.actors.push(d.uuid))],
    ];
    return { observing: true };
  },
  unobserve: async () => {
    const H = globalThis.__ic;
    for (const [hook, id] of H.observers ?? []) Hooks.off(hook, id);
    H.observers = [];
    return H.seen ?? null;
  },
  importIds: async ({ ids }) => {
    globalThis.__icImport = { done: false };
    acksExtras.importer.cookbookImportIds(ids)
      .then((n) => { globalThis.__icImport = { done: true, count: n ?? null }; })
      .catch((e) => { globalThis.__icImport = { done: true, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importState: async () => globalThis.__icImport,
  /** Each made character against its page, as booleans; counts of its block's lines. */
  verify: async ({ book, ids }) => {
    const H = globalThis.__ic;
    const doc = H.CB.cookbookSessionDoc(book);
    const cb = H.CB.cookbookEntry(ids[0])?.cb;
    const packs = game.packs.filter((p) => p.documentName === "Actor" && p.metadata.packageType === "world");
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const rows = [];
    for (const id of ids) {
      const sid = H.AB.stableDocId(id);
      const pack = packs.find((p) => p.index.has(sid));
      const actor = pack ? await pack.getDocument(sid) : null;
      if (!actor) { rows.push({ id, made: false }); continue; }
      const sl = (await H.EX.executeEntry(doc, cb, {}, id)).fields.statline ?? {};
      const sys = actor._source.system;
      const held = actor.getFlag("acks-extras", "classes");
      const classItem = held?.uuid ? await fromUuid(held.uuid) : null;
      let savesDerived = false;
      if (classItem) {
        const { update } = H.CA.classUpdateData(actor, classItem, Number(sys.details.level));
        const paths = Object.keys(update).filter((p) => p.startsWith("system.saves."));
        savesDerived = paths.length > 0 && paths.every((p) => foundry.utils.getProperty(actor._source, p) === update[p]);
      }
      const field = actor.system.schema.getField("details.morale");
      const morale = Number.isInteger(sl.ml) ? Math.clamp(sl.ml, field.min, field.max) : 0;
      const box = new DOMParser().parseFromString(sys.details.biography ?? "", "text/html").querySelectorAll(`.${H.CH.AS_PRINTED_CLASS}`);
      const printed = actor.getFlag("acks-extras", "printed") ?? {};
      const lines = box[0]?.querySelectorAll("p").length ?? 0;
      // A block row's text, by its label; compared here, never returned.
      const rowTexts = (key) => [...(box[0]?.querySelectorAll("p") ?? [])]
        .filter((p) => p.querySelector("strong")?.textContent === `${game.i18n.localize(key)}:`)
        .map((p) => p.textContent.replace(/^[^:]*:\s*/, "").trim());
      const className = sl.class?.name ?? "";
      const behind = H.MA.matchClass(className) ? null : H.CH.classBehindQualifier(className, H.MA.matchClass);
      rows.push({
        id,
        uuid: actor.uuid,
        made: true,
        character: actor.type === "character" && actor.id === sid && actor.getFlag("acks-extras", "cookbook")?.id === id,
        classAnswered: !!(classItem || H.MA.matchClass(className) || behind),
        classBound: !!classItem && Number(sys.details.level) === sl.class?.level,
        classMissing: !classItem && rowTexts("ACKS-IMPORTER.character.missing").includes(className),
        readBehind: !!behind,
        readAsNoted: !behind || (classItem?.name === behind && rowTexts("ACKS-IMPORTER.character.readAs").includes(behind)),
        scores: Object.entries(sl.abilities ?? {}).every(([k, v]) => sys.scores[k]?.value === v),
        hp: sys.hp.value === sl.hp && sys.hp.max === sl.hp,
        alignment: sys.details.alignment === (H.CH.ALIGN_WORD[sl.al] ?? sl.al),
        morale: sys.details.morale === morale,
        savesDerived,
        // The printed line, then a line per difference and per missing name, then any notes.
        block: box.length === 1 && box[0].dataset.acksEntry === id && Number.isInteger(printed.differences) && Number.isInteger(printed.missing) &&
          lines >= 1 + printed.differences + printed.missing,
        blockLines: lines,
        differences: printed.differences ?? null,
        missing: printed.missing ?? null,
        judgeOnly: actor.ownership.default === 0 &&
          !Object.entries(actor.ownership).some(([u, l]) => u !== "default" && l >= OWNER && game.users.get(u)?.isGM === false),
        kind: actor.getFlag("acks-extras", "cookbook")?.kind ?? null,
        folder: actor.folder?.name ?? null,
      });
    }
    return rows;
  },
  /** The player seat's user id, by the name the machine gives the seat; never printed. */
  playerId: async ({ name }) => game.users.getName(name)?.id ?? null,
  /** Run the entry picker for the entries `ids`, answer its confirm, and resolve when its refill is done. */
  rebuild: async ({ key, ids }) => {
    const find = (pred) => [...foundry.applications.instances.values()].find((a) => a instanceof foundry.applications.api.DialogV2 && a.rendered && pred(a));
    const wait = async (pred, tries = 120) => {
      for (let n = 0; n < tries; n++) {
        const a = find(pred);
        if (a) return a;
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    };
    globalThis.__icRebuild = { done: false };
    acksExtras.importer.cookbookReimportEntries()
      .then((r) => { globalThis.__icRebuild = { done: true, result: r ?? null }; })
      .catch((e) => { globalThis.__icRebuild = { done: true, error: String(e?.message ?? e) }; });
    const picker = await wait((a) => !!a.element?.querySelector(".acks-extras-importer-mon-list"));
    if (!picker) return { picker: false };
    const boxes = ids.map((id) => picker.element.querySelector(`input[name="sel"][value="${key}|${id}"]`));
    const absent = ids.filter((_, i) => !boxes[i]);
    if (absent.length) return { picker: true, row: false, absent };
    for (const box of boxes) box.checked = true;
    picker.element.querySelector('button[data-action="ok"]')?.click();
    const confirm = await wait((a) => a !== picker && !!a.element?.querySelector('button[data-action="yes"]'));
    if (!confirm) return { picker: true, row: true, confirm: false };
    confirm.element.querySelector('button[data-action="yes"]').click();
    return { picker: true, row: true, confirm: true };
  },
  rebuildState: async () => globalThis.__icRebuild,
  /** What stands under one stable id: its uuid and when it was made. */
  stamp: async ({ id }) => {
    const H = globalThis.__ic;
    const sid = H.AB.stableDocId(id);
    const pack = game.packs.find((p) => p.documentName === "Actor" && p.metadata.packageType === "world" && p.index.has(sid));
    const actor = pack ? await pack.getDocument(sid) : null;
    return actor ? { uuid: actor.uuid, created: actor._stats?.createdTime ?? null } : null;
  },
  exists: async ({ uuid }) => !!(await fromUuid(uuid)),
  /**
   * A Judge's hand-out: the compendium entry's Import, with the options core's
   * context menu passes (the dialog and the sheet aside), then OWNER for the
   * player.
   */
  handOut: async ({ id, playerId }) => {
    const H = globalThis.__ic;
    const sid = H.AB.stableDocId(id);
    const pack = game.packs.find((p) => p.documentName === "Actor" && p.metadata.packageType === "world" && p.index.has(sid));
    if (!pack) return { shelved: false };
    const copy = await game.actors.importFromCompendium(pack, sid, {}, { clearOwnership: false, renderSheet: false });
    if (!copy) return { shelved: true, imported: false };
    await copy.update({ [`ownership.${playerId}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    return {
      shelved: true,
      imported: true,
      uuid: copy.uuid,
      // Core's importDocument keeps the entry's id, so the copy shares it in the world collection.
      world: copy.pack == null && game.actors.get(copy.id) === copy,
      claims: copy.getFlag("acks-extras", "cookbook")?.id === id,
      character: copy.type === "character",
    };
  },
  /** On the player's seat: whether it owns the actor, and whether its sheet opens. */
  playerOpens: async ({ uuid }) => {
    const actor = await fromUuid(uuid);
    if (!actor) return { found: false };
    const sheet = actor.sheet;
    await sheet.render({ force: true });
    for (let i = 0; i < 50 && !sheet.rendered; i++) await new Promise((r) => setTimeout(r, 100));
    const out = { found: true, owner: actor.isOwner, rendered: !!sheet.rendered };
    await sheet.close({ force: true });
    return out;
  },
  /** A character's sheet opened on its Stats tab at the corner, for a plate: its window's `#id` and its sheet class. */
  sheetOnStats: async ({ uuid }) => {
    const app = (await fromUuid(uuid)).sheet;
    await app.render({ force: true });
    for (let i = 0; i < 50 && !app.element?.querySelector(".window-content"); i++) await new Promise((r) => setTimeout(r, 100));
    if (app.element.querySelector('[data-group="primary"][data-tab="stats"]')) app.changeTab("stats", "primary");
    app.setPosition({ left: 16, top: 16 });
    await new Promise((r) => setTimeout(r, 400));
    return { keep: `#${app.id}`, sheet: app.constructor.name };
  },
  closeAll: async () => {
    let n = 0;
    for (const a of foundry.applications.instances?.values() ?? []) {
      if (a.id === "sidebar" || a.constructor?.name?.startsWith("Hotbar")) continue;
      if (!a.window && !a.options?.window) continue;
      try { if (a.rendered && a.hasFrame) { await a.close({ force: true }); n++; } } catch {}
    }
    return n;
  },
  packEmpty: async ({ collection }) => {
    const pack = game.packs.get(collection);
    if (!pack) return { gone: true };
    const index = await pack.getIndex();
    if (index.size) return { kept: index.size };
    await pack.deleteCompendium();
    return { deleted: !game.packs.get(collection) };
  },
  playerSees: async ({ collections }) => ({
    visible: collections.filter((c) => game.packs.get(c)?.visible),
    listed: [...document.querySelectorAll("#compendium [data-pack]")].map((el) => el.dataset.pack).filter((c) => collections.includes(c)),
  }),
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.cookbookImportIds`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
async function poll(api, fn, args, { tries = 300, every = 2000, until = (s) => s?.done } = {}) {
  let state = null;
  for (let n = 0; n < tries; n++) {
    state = await run(api, fn, args);
    if (until(state)) return state;
    await sleep(every);
  }
  return state;
}
const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let gm = null;
const createdPacks = [];
const all = (rows, key) => rows.every((r) => r[key]);
const failing = (rows, key) => rows.filter((r) => !r[key]).map((r) => r.id);

try {
  section("seats and the book");
  gm = await seat("gm");
  note("install (gm)", await run(gm, P.install));
  let census = await run(gm, P.census, { book: BOOK, rows: ROWS });
  if (!census.open) {
    if (!BOOKS.length) throw new Error(`${BOOK} is not open on the GM seat and ACKS_TEST_BOOKS names no copy of it`);
    note("connect", await run(gm, P.connectBook, BOOKS[0]));
    note("book", await poll(gm, P.bookState, { id: BOOK }, { tries: 150, until: (s) => s?.done || s?.open }));
    census = await run(gm, P.census, { book: BOOK, rows: ROWS });
  }
  const ids = census.ids;
  const pregens = census.pregens;
  note("gm census", { module: census.module, isGM: census.isGM, open: census.open, characterType: census.characterType, rows: ROWS, characters: ids.length, pregens: pregens.length, classesAnswered: census.classesAnswered });
  check("the GM seat is a GM, the book is open, the world knows the character type, and the cookbook names its characters",
    census.isGM && census.open && census.characterType && ids.length > 0, { characters: ids.length });
  if (!census.isGM || !census.open || !ids.length) throw new Error("preconditions not met");
  note("printed classes the library answers", `${census.classesAnswered} of ${ids.length}`);

  section("what stands under the inhabitants' ids");
  // A claimant answers the import's presence check for its entry; one a dead run left goes first.
  note("retired importer/claimant", await gm.retire("importer/claimant", "Actor"));
  const standing = await run(gm, P.standing, { ids });
  // The library holds every inhabitant once, or none: a partial or doubled
  // set is nobody's known state, and neither path below answers for it.
  const library = REBUILD_OK && standing.length === ids.length && new Set(standing.map((s) => s.id)).size === ids.length;
  check(library ? "the owner's library holds every inhabitant once (REBUILD_OK=1: rebuilt in place, never swept)" : "no document stands under any inhabitant's stable id",
    library || !standing.length, standing.map((s) => s.uuid));
  if (standing.length && !library) throw new Error("stopped before the import: a document this run did not make stands under an inhabitant's id");

  section(library ? "1. each inhabitant is rebuilt a character, in place" : "1. each inhabitant is made a character");
  const packsBefore = await run(gm, P.actorPacks);
  const abilitiesBefore = await run(gm, P.libraryAbilityIds);
  const stampsBefore = library ? Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await run(gm, P.stamp, { id })]))) : null;
  if (library) await sleep(1100); // a rebuilt document's creation time must be able to differ
  await run(gm, P.observe);
  let imp = null;
  if (library) {
    const drove = await run(gm, P.rebuild, { key: "Monsters", ids });
    check("1: the entry picker lists every inhabitant, and its confirm is answered", drove.picker && drove.row && drove.confirm, drove);
    imp = await poll(gm, P.rebuildState, undefined, { tries: 450 });
  } else {
    await run(gm, P.importIds, { ids });
    imp = await poll(gm, P.importState, undefined, { tries: 450 });
  }
  const seen = await run(gm, P.unobserve);
  if (imp?.error) throw new Error(`the ${library ? "rebuild" : "import"} threw: ${imp.error}`);
  for (const c of (await run(gm, P.actorPacks)).filter((c) => !packsBefore.includes(c))) createdPacks.push(c);
  const made = await run(gm, P.standing, { ids });
  if (!library) for (const m of made) gm.track(m.uuid, "Actor");
  note(library ? "rebuild (the owner's, not tracked)" : "import", { counted: imp?.count ?? null, made: made.map((m) => m.uuid) });
  const supplied = await run(gm, P.onDemand, { uuids: made.map((m) => m.uuid), before: abilitiesBefore });
  for (const uuid of Object.values(supplied)) if (uuid) gm.track(uuid, "Item");
  note("definitions the import supplied on demand (tracked)", supplied);
  if (library) {
    const stampsAfter = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await run(gm, P.stamp, { id })])));
    const kept = ids.filter((id) => stampsAfter[id] && stampsAfter[id].uuid === stampsBefore[id]?.uuid);
    const rebuilt = kept.filter((id) => stampsAfter[id].created !== stampsBefore[id]?.created);
    check("1: every inhabitant is rebuilt, each under the id it stood under", made.length === ids.length && kept.length === ids.length && rebuilt.length === ids.length,
      { made: made.length, kept: kept.length, rebuilt: rebuilt.length });
  } else {
    check("1: the import counts every inhabitant, and each stands under its stable id", imp?.count === ids.length && made.length === ids.length, { counted: imp?.count, made: made.length });
  }
  const rows = await run(gm, P.verify, { book: BOOK, ids });
  check("1: each is a character carrying its entry's stamp, under its stable id", all(rows, "made") && all(rows, "character"), failing(rows, "character"));
  const answered = rows.filter((r) => r.classAnswered);
  const lacking = rows.filter((r) => r.made && !r.classAnswered);
  note("1: classes the library answers, and the rows whose class it lacks (ids)", { answered: answered.length, lacking: lacking.map((r) => r.id) });
  check("1: each class the library answers is bound at the printed level", all(answered, "classBound"), failing(answered, "classBound"));
  check("1: each class the library lacks is held by none, and the block names it as not in the library", all(lacking, "classMissing"), failing(lacking, "classMissing"));
  check("1: a class read behind its qualifier is noted in the block as the class it was read as", all(rows, "readAsNoted"),
    { read: rows.filter((r) => r.readBehind).map((r) => r.id), failing: failing(rows, "readAsNoted") });
  check("1: the scores, hit points and alignment are the page's", all(rows, "scores") && all(rows, "hp") && all(rows, "alignment"),
    { scores: failing(rows, "scores"), hp: failing(rows, "hp"), alignment: failing(rows, "alignment") });
  check("1: morale is the page's, within the system's bounds", all(rows, "morale"), failing(rows, "morale"));
  check("1: where a class is bound, the saves are its derivation", all(answered, "savesDerived"), failing(answered, "savesDerived"));
  check("1: the biography carries one stamped as-printed block, its lines the counts the actor records", all(rows, "block"), failing(rows, "block"));
  note("1: differences and missing names per character (counts)", rows.map((r) => ({ id: r.id, differences: r.differences, missing: r.missing, lines: r.blockLines })));
  check("1: each is owned by the Judges alone", all(rows, "judgeOnly"), failing(rows, "judgeOnly"));
  if (pregens.length) {
    const pregenRows = rows.filter((r) => pregens.includes(r.id));
    const filed = pregenRows.filter((r) => r.kind === "kind.pregen" && r.folder === "Pregenerated");
    check("1: each pregen carries its kind and is filed under Pregenerated", filed.length === pregens.length,
      pregenRows.filter((r) => !filed.includes(r)).map((r) => r.id));
  }
  check("1: the import posted no chat card", seen?.chat === 0, { chat: seen?.chat });
  const ours = new Set(made.map((m) => m.uuid));
  const strays = (seen?.actors ?? []).filter((u) => !ours.has(u));
  check("1: it made no actor beyond the inhabitants (observed, not swept)", !strays.length, { strays: strays.length });

  section("2. a rebuild keeps a Judge's character's id, and leaves a player's");
  const target = ids[0];
  const before = await run(gm, P.stamp, { id: target });
  const playerId = await run(gm, P.playerId, { name: SEATS.player });
  if (!playerId) throw new Error("the player seat's user is not in the world");
  const owned = await gm.fixture("importer/claimant", "Actor", {
    name: "QA player's character",
    type: "character",
    ownership: { default: 0, [playerId]: 3 },
    flags: { "acks-extras": { cookbook: { id: target, book: BOOK, kind: rows.find((r) => r.id === target)?.kind ?? "kind.npc" } } },
  });
  note("fixture", { uuid: owned.uuid, built: owned.built });
  check("2: the claimant is built this run, section 1 having retired any left standing", owned.built, { uuid: owned.uuid });
  await sleep(1100); // a rebuilt document's creation time must be able to differ
  const drove = await run(gm, P.rebuild, { key: "Monsters", ids: [target] });
  check("2: the entry picker and its confirm are answered", drove.picker && drove.row && drove.confirm, drove);
  const rb = await poll(gm, P.rebuildState, undefined, { tries: 150 });
  if (rb?.error) throw new Error(`the rebuild threw: ${rb.error}`);
  const after = await run(gm, P.stamp, { id: target });
  check("2: the inhabitant is rebuilt under the same id", !!after && after.uuid === before?.uuid && after.created !== before?.created,
    { same: after?.uuid === before?.uuid, rebuilt: after?.created !== before?.created });
  check("2: the player's character claiming the same entry is not deleted", await run(gm, P.exists, { uuid: owned.uuid }));
  note("closed (gm)", await run(gm, P.closeAll));
  if (SHOTS && made[0]) {
    const frame = await run(gm, P.sheetOnStats, { uuid: made[0].uuid });
    note("plate sheet", frame);
    await plate(gm, "importer-character", frame);
    note("closed (gm)", await run(gm, P.closeAll));
  }

  section("3. the player seat");
  const player = await seat("player");
  const collections = [...new Set(made.map((m) => m.uuid.split(".").slice(1, 3).join(".")))];
  const sees = await run(player, P.playerSees, { collections });
  check("3: no character's shelf is visible to the player", !sees.visible.length && !sees.listed.length, sees);

  if (pregens.length) {
    section("4. a pregen handed to the player is the player's");
    const given = pregens[pregens.length - 1];
    const out = await run(gm, P.handOut, { id: given, playerId });
    if (out.uuid) gm.track(out.uuid, "Actor");
    check("4: the Judge's Import makes a world character that still claims the pregen's entry", out.imported && out.world && out.claims && out.character, out);
    const shelvedBefore = await run(gm, P.stamp, { id: given });
    await sleep(1100);
    const again = await run(gm, P.rebuild, { key: "Monsters", ids: [given] });
    check("4: the entry picker and its confirm are answered", again.picker && again.row && again.confirm, again);
    const rb2 = await poll(gm, P.rebuildState, undefined, { tries: 150 });
    if (rb2?.error) throw new Error(`the rebuild threw: ${rb2.error}`);
    const shelvedAfter = await run(gm, P.stamp, { id: given });
    check("4: the library's pregen is rebuilt under the same id", !!shelvedAfter && shelvedAfter.uuid === shelvedBefore?.uuid && shelvedAfter.created !== shelvedBefore?.created);
    check("4: the player's copy is not deleted by the rebuild", !!out.uuid && (await run(gm, P.exists, { uuid: out.uuid })));
    const opens = out.uuid ? await run(player, P.playerOpens, { uuid: out.uuid }) : null;
    check("4: on the player's seat the copy is the player's, and its sheet opens", !!opens?.owner && !!opens?.rendered, opens);
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  // Every section is setup, and what it made answers the next import's presence check: all of it goes.
  try {
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  for (const collection of createdPacks) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
