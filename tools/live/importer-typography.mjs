/**
 * Live walk, importer-typography: a community book read through its declared
 * typography. Walks docs/importer/TESTING.md, "A community book, read through
 * its declared typography", steps 1–5 on the book `cat`; step 1's Books-window
 * line and its boot check are not driven here. Machine values arrive
 * through ./_env.mjs, the book through ACKS_TEST_BOOKS ("cat"). Nothing is
 * invented: every document is the import's own, found by the cookbook id the
 * run imported and tracked, and swept by uuid. A check prints ids, counts and
 * booleans, never a book's words.
 *
 * Steps 3–5 open nothing: each reads the created document's data, which is what
 * its sheet renders, and the sheet templates are the core system's.
 *
 * The imports are scoped to the book's own ids (`importClasses({only})`,
 * `cookbookImportAbilities({only})`, `cookbookImportIds`): the seat reopens the
 * world's shelved books after ready, and a step with no scope would write every
 * one of them.
 *
 * Writes outside the fixture ledger, each reported:
 *   - the book connected on the GM seat with remember:false;
 *   - the GM seat's notification methods, patched to read what a run says
 *     (put back at teardown);
 *   - the shelves the line's first import opens (packs) and the folders filed
 *     in them: a pack this run opened is deleted at teardown once empty, and a
 *     folder this run added to a pack it found is tracked and swept.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books, ROOT } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const BOOK = "cat";
const BOOKS = books([BOOK]);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
/** A name whose line turn was welded reads lower-case straight into upper-case ("FightingStyle"). */
const welded = (name) => /[a-z][A-Z]/.test(String(name ?? ""));

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__bt = globalThis.__bt ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.BK = await import("/modules/acks-extras/scripts/importer/books.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    if (!H.notesPatched) {
      H.notes = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.notesPatched = true;
    }
    return { installed: true };
  },
  /** The seat, the book's registration and what the world already holds under the book's ids. */
  census: async ({ book, ids }) => {
    const H = globalThis.__bt;
    const row = H.BK.BOOKS[book] ?? null;
    const held = {};
    for (const id of ids.items) held[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    for (const id of ids.actors) held[id] = (await H.CB.importedActorFor(id))?.uuid ?? null;
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      registered: !!row,
      typography: !!row?.typography,
      bodyPt: row?.typography?.bodyPt ?? null,
      label: row?.label ?? null,
      api: ["importClasses", "cookbookImportAbilities", "cookbookImportIds", "cookbookImportScenes"].every((k) => typeof acksExtras.importer?.[k] === "function"),
      open: !!H.CB.cookbookSessionDoc(book),
      openBooks: Object.keys(H.BK.BOOKS).filter((b) => H.CB.cookbookSessionDoc(b)),
      held,
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__bt;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    H.notes.splice(0);
    globalThis.__btBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__btBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__btBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const H = globalThis.__bt;
    return { ...globalThis.__btBook, open: !!H.CB.cookbookSessionDoc(id), notes: H.notes.slice() };
  },
  line: async ({ book }) => globalThis.__bt.CB.lineOf(book),
  /** The world's shelves and the folders on the line's shelves, before and after. */
  shelves: async ({ line }) => {
    const H = globalThis.__bt;
    const packs = game.packs.filter((p) => p.metadata.packageType === "world").map((p) => p.collection);
    const folders = {};
    for (const type of ["Item", "Actor", "RollTable"]) {
      const pack = H.LIB.findLibraryPack(type, line);
      if (pack) folders[pack.collection] = pack.folders.map((f) => f.uuid);
    }
    return { packs, folders };
  },
  /** One import step, started; `stepState` reads its outcome. `fn` names the api method, `args` its call. */
  step: async ({ fn, args }) => {
    const H = globalThis.__bt;
    H.notes.splice(0);
    globalThis.__btStep = { done: false };
    const call = args?.only ? { only: new Set(args.only) } : args ?? undefined;
    (call === undefined ? acksExtras.importer[fn]() : acksExtras.importer[fn](call))
      .then((r) => {
        // What a step hands back: created documents (classes), counts
        // (abilities, monsters) or the scenes' counts with `created` uuids.
        const out = Array.isArray(r) ? { docs: r.map((d) => d.uuid) } : r && typeof r === "object" ? r : { value: r ?? null };
        globalThis.__btStep = { done: true, result: out };
      })
      .catch((e) => { globalThis.__btStep = { done: true, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  stepState: async () => ({ ...globalThis.__btStep, notes: globalThis.__bt.notes.slice() }),
  /** The uuid the world now holds under each id — the import's own documents, read back by the ids it was given. */
  heldNow: async ({ ids }) => {
    const H = globalThis.__bt;
    const held = {};
    for (const id of ids.items ?? []) held[id] = (await H.CB.importedItemFor(id))?.uuid ?? null;
    for (const id of ids.actors ?? []) held[id] = (await H.CB.importedActorFor(id))?.uuid ?? null;
    return held;
  },
  /** A class-power item: its type and how many paragraphs its description holds. */
  power: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const html = String(doc.system?.description ?? "");
    // Bare `<p>` is a printed paragraph; the page reference closes the text as a classed one.
    return { type: doc.type, paragraphs: (html.match(/<p>/g) ?? []).length, cite: /<p class=/.test(html), chars: html.replace(/<[^>]*>/g, "").length };
  },
  /** The monster actor: which stats landed, its attack modes, spoils and the order and wholeness of its prose sections. */
  monster: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const s = doc.system ?? {};
    const x = doc.flags?.["acks-extras"]?.extras ?? {};
    const items = doc.items.contents;
    const weapons = items.filter((i) => i.type === "weapon");
    const modes = [];
    for (const w of weapons) {
      const m = w.flags?.["acks-extras"]?.attackMode ?? 0;
      modes[m] = (modes[m] ?? 0) + 1;
    }
    const spoils = items.filter((i) => i.flags?.["acks-extras"]?.spoil);
    const sections = Object.entries(x.description ?? {}).map(([field, html]) => {
      const paras = [...String(html).matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
      const last = paras[paras.length - 1] ?? "";
      return { field, paragraphs: paras.length, lastEndsSentence: /[.!?)"”]$/.test(last) };
    });
    return {
      aac: s.aac?.value ?? null, hd: s.hp?.hd ?? null, movement: s.movement?.base ?? null,
      morale: s.details?.morale ?? null, xp: s.details?.xp ?? null, alignment: !!s.details?.alignment, treasure: !!s.details?.treasure?.type,
      saves: Object.keys(s.saves ?? {}).length, vision: (x.vision ?? []).length, types: (x.types ?? []).length,
      weapons: weapons.length, modes,
      abilities: items.filter((i) => i.type === "ability").length,
      spoils: spoils.map((i) => ({ cost: i.system?.cost ?? null, weight6: i.system?.weight6 ?? null, effects: (i.flags?.["acks-extras"]?.researchEffects ?? []).length })),
      sections,
    };
  },
  /** A class item: its header fields, its list's resolution and its description's run-in labels. */
  classItem: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const s = doc.system ?? {};
    const html = String(s.description ?? "");
    const paras = [...html.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
    return {
      type: doc.type, hitDie: !!s.hitDie, maximumLevel: s.maximumLevel ?? null,
      // A set field reads back as a Set, an array field as an array; both count the same way.
      keyAttributes: Array.from(s.keyAttributes ?? []).length, requirements: Array.from(s.requirements ?? []).length,
      resolved: (s.inventory?.classProfs ?? []).length, unresolved: s.unresolvedProfs ?? [],
      paragraphs: paras.length, runIn: paras.filter((p) => /^[A-Z][A-Za-z' ]{1,40}:/.test(p)).length,
      chassis: [s.saveChassis, s.attackChassis],
    };
  },
  closeAll: async () => {
    const open = [...foundry.applications.instances.values()];
    for (const app of open) { try { await app.close(); } catch {} }
    return { closed: open.length };
  },
  restore: async () => {
    const H = globalThis.__bt ?? {};
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; return { notes: "restored" }; }
    return {};
  },
  packEmpty: async ({ collection }) => {
    const pack = game.packs.get(collection);
    if (!pack) return { gone: true };
    const index = await pack.getIndex();
    if (index.size) return { kept: index.size };
    // Its folders go with it: a pack this run opened holds only the folders its imports filed.
    await pack.deleteCompendium();
    return { deleted: !game.packs.get(collection) };
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
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

/** The book's ids, read off the shipped cookbook so the walk follows a recompile. */
function bookIds(book) {
  const ids = { items: [], actors: [], classes: [], powers: [] };
  const dir = path.join(ROOT, "cookbook");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "registers.json") continue;
    const cb = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const [id, e] of Object.entries(cb.entries ?? {})) {
      if ((e.book ?? cb.book?.id) !== book) continue;
      if (e.kind === "kind.class") { ids.classes.push(id); ids.items.push(id); }
      else if (e.kind === "kind.power") { ids.powers.push(id); ids.items.push(id); }
      else if (e.kind === "kind.monster") ids.actors.push(id);
    }
  }
  return ids;
}

let gm = null;
const openedPacks = [];
/** One import step: started on the seat, polled to its end, its notes and result returned. */
async function runStep(label, fn, args) {
  await run(gm, P.step, { fn, args });
  const st = await poll(gm, P.stepState, undefined, { tries: 150 });
  if (!st?.done) throw new Error(`${label}: the step did not finish`);
  if (st.error) throw new Error(`${label}: the step threw: ${st.error}`);
  note(label, { result: st.result, notes: st.notes });
  return st;
}

try {
  const IDS = bookIds(BOOK);
  note("ids from the cookbook", { classes: IDS.classes.length, powers: IDS.powers.length, monsters: IDS.actors.length });

  section("seats and the book");
  gm = await seat("gm");
  note("install (gm)", await run(gm, P.install));
  let census = await run(gm, P.census, { book: BOOK, ids: IDS });
  note("gm census", census);
  check("the GM seat is a GM, the book is registered with a typography and the scoped import api is present", census.isGM && census.registered && census.typography && census.api, { bodyPt: census.bodyPt });
  const heldBefore = Object.entries(census.held).filter(([, u]) => u).map(([id]) => id);
  check("the world holds nothing under the book's ids before the run", !heldBefore.length, heldBefore);
  if (!census.isGM || !census.registered || !census.api || heldBefore.length) throw new Error("preconditions not met");

  section("1. connect the book");
  let connectNotes = [];
  if (!census.open) {
    if (!BOOKS.length) throw new Error(`${BOOK} is not open on the GM seat and ACKS_TEST_BOOKS names no copy of it`);
    note("connect", await run(gm, P.connectBook, BOOKS[0]));
    const bs = await poll(gm, P.bookState, { id: BOOK }, { tries: 150, until: (s) => s?.done || s?.open });
    connectNotes = bs.notes ?? [];
    note("book", { done: bs.done, ok: bs.ok, error: bs.error ?? null, open: bs.open, notes: connectNotes.length });
    census = await run(gm, P.census, { book: BOOK, ids: IDS });
  }
  check("1: the book is open this session", census.open);
  // The log keeps what the connect said; the console gets the verdict alone.
  note("connect notes", connectNotes);
  const opened = connectNotes.find((n) => n.kind === "info" && n.text.includes(census.label) && /\bopen\b/.test(n.text));
  check("1: the open is announced by the book's label", !!opened, { count: opened ? (/(\d+) entr/.exec(opened.text)?.[1] ?? null) : null, notes: connectNotes.map((n) => n.kind) });
  if (!census.open) throw new Error("stopped before the imports");

  const line = await run(gm, P.line, { book: BOOK });
  const before = await run(gm, P.shelves, { line });
  note("shelves before", { packs: before.packs.length, line, folders: Object.fromEntries(Object.entries(before.folders).map(([c, f]) => [c, f.length])) });

  section("2. import the book");
  const powers = await runStep("2: abilities (powers)", "cookbookImportAbilities", { only: IDS.powers });
  const classes = await runStep("2: classes", "importClasses", { only: IDS.classes });
  const monsters = await runStep("2: monsters", "cookbookImportIds", IDS.actors);
  // Track everything the run made: the classes from their own result, the
  // rest read back by the ids this run imported, which the census proved
  // absent beforehand.
  for (const uuid of classes.result?.docs ?? []) gm.track(uuid, "Item");
  const held = await run(gm, P.heldNow, { ids: { items: IDS.powers, actors: IDS.actors } });
  for (const [id, uuid] of Object.entries(held)) if (uuid) gm.track(uuid, IDS.actors.includes(id) ? "Actor" : "Item");
  const after = await run(gm, P.shelves, { line });
  for (const c of after.packs.filter((c) => !before.packs.includes(c))) openedPacks.push(c);
  for (const [collection, uuids] of Object.entries(after.folders)) {
    if (openedPacks.includes(collection)) continue; // goes with the pack
    for (const uuid of uuids.filter((u) => !(before.folders[collection] ?? []).includes(u))) gm.track(uuid, "Folder");
  }
  note("shelves opened by this run", openedPacks);

  check("2: five class powers imported, none already present", powers.result?.made === IDS.powers.length && powers.result?.reused === 0 && IDS.powers.length === 5, powers.result);
  check("2: three classes imported", (classes.result?.docs ?? []).length === IDS.classes.length && IDS.classes.length === 3, { made: (classes.result?.docs ?? []).length });
  check("2: one monster imported", monsters.result?.value === 1 && IDS.actors.length === 1, monsters.result);
  const stepErrors = [powers, classes, monsters].flatMap((s) => s.notes.filter((n) => n.kind === "error" || n.kind === "warn"));
  check("2: no step warned or erred", !stepErrors.length, stepErrors.map((n) => n.kind));
  const powerShapes = [];
  for (const id of IDS.powers) powerShapes.push(held[id] ? await run(gm, P.power, { uuid: held[id] }) : null);
  check("2: each power is one paragraph with a page reference", powerShapes.every((p) => p && p.paragraphs === 1 && p.cite), powerShapes.map((p) => p && { type: p.type, paragraphs: p.paragraphs, chars: p.chars }));

  section("3. the monster");
  const monsterId = IDS.actors[0];
  const m = held[monsterId] ? await run(gm, P.monster, { uuid: held[monsterId] }) : null;
  note("monster", m);
  check("3: AC, HD, movement, morale, XP, alignment, treasure, saves, vision and type landed", !!m && m.aac != null && !!m.hd && m.movement > 0 && m.morale != null && m.xp != null && m.alignment && m.treasure && m.saves > 0 && m.vision > 0 && m.types > 0);
  check("3: three natural attacks in the first mode and the weapon alternative as a second", !!m && m.modes.length === 2 && m.modes[0] === 3 && m.modes[1] === 1, m && { weapons: m.weapons, modes: m.modes });
  check("3: a proficiency list rides as embedded abilities", !!m && m.abilities > 0, m && { abilities: m.abilities });
  check("3: two spoils, each with a value, a weight and effects", !!m && m.spoils.length === 2 && m.spoils.every((s) => s.cost > 0 && s.weight6 != null && s.effects > 0), m && m.spoils);
  const combat = m?.sections.find((s) => s.field === "combat");
  check("3: the prose is sectioned, and the Combat section's last paragraph is whole across the page turn", !!m && m.sections.length >= 3 && !!combat && combat.lastEndsSentence, m && m.sections);

  section("4. the classes");
  const classShapes = [];
  for (const uuid of classes.result?.docs ?? []) classShapes.push(await run(gm, P.classItem, { uuid }));
  note("classes", classShapes);
  check("4: each class carries its hit die, maximum level, prime requisite and requirements", classShapes.length === 3 && classShapes.every((c) => c && c.hitDie && c.maximumLevel > 0 && c.keyAttributes > 0 && c.requirements > 0));
  check("4: the list resolves names the register knows and keeps the rest as text, none welded at a line turn", classShapes.every((c) => c && c.resolved > 0 && !c.unresolved.some(welded)), classShapes.map((c) => c && { resolved: c.resolved, unresolved: c.unresolved.length, welded: c.unresolved.filter(welded).length }));
  check("4: each description runs the whole spread, with passages opened by run-in labels", classShapes.every((c) => c && c.paragraphs >= 9 && c.runIn >= 1), classShapes.map((c) => c && { paragraphs: c.paragraphs, runIn: c.runIn }));
  check("4: the declared chassis is fighter/fighter", classShapes.every((c) => c && c.chassis[0] === "fighter" && c.chassis[1] === "fighter"));
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("5. teardown");
  try { if (gm) note("closed windows", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm) note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try {
    const sw = gm ? await gm.sweepTracked() : null;
    if (sw) note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  for (const collection of openedPacks) {
    try { note(`shelf ${collection} this run opened`, await run(gm, P.packEmpty, { collection })); } catch (err) { console.error("packEmpty:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
