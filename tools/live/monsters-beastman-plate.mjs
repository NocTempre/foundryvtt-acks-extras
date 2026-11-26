/**
 * Live walk, the Beastman family's plate: docs/monsters/TESTING.md "Family plate",
 * marker `monsters/beastman-plate`. Repair in place on the family template through the
 * entry picker, then the template's `flags["acks-extras"].plate` ends in the plate's own
 * file while `img` is still the strip; the uploaded file is fetched, its pixel size logged
 * and a copy saved under the run's scratch for the walker to look at (the page foot is
 * for eyes); after a reload a faction host's Org chart draws `.acks-extras-org__plate`, and
 * Generate on the template gives the root group it makes the plate as its `img`. Machine
 * values arrive through ./_env.mjs, the Monstrous Manual through ACKS_TEST_BOOKS. The run
 * reads no figure of the book and names nothing it prints.
 *
 * Fixtures, kept and found again by marker: `monsters/beastman-plate` (the library's family
 * template, found by its cookbook id since a library document takes no marker) and `monsters/beastman-plate-host` (a faction host, built by
 * `api.fixture`). Disposable, by the run's own ledger: the root group Generate made.
 */
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books, logDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const BOOK = "mm";
const FAMILY = "mm.familyBeastman";
const MARKER = "monsters/beastman-plate";
const HOST_MARKER = "monsters/beastman-plate-host";
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const checks = [];
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in the GM seat's page. */
const P = {
  install: async () => {
    const H = (globalThis.__bp = globalThis.__bp ?? {});
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 80, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => {
      const el = app?.element;
      return el?.nodeType === 1 ? el : (el?.[0] ?? null);
    };
    H.dialogs = () => [...foundry.applications.instances.values()].filter((a) => a instanceof foundry.applications.api.DialogV2 && a.rendered);
    return {
      isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null,
      open: !!H.CB.cookbookSessionDoc("mm"),
    };
  },

  connectBook: async ({ id, path: file }) => {
    globalThis.__bpBook = { done: false };
    acksExtras.importer.connectBookUrl(id, file, { remember: false, bridge: false })
      .then(() => { globalThis.__bpBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__bpBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...(globalThis.__bpBook ?? {}), open: !!globalThis.__bp.CB.cookbookSessionDoc(id) }),

  /**
   * The library's family template: the one library document whose cookbook id is the
   * family. A library document is never marked and never written here (only Repair in
   * place writes it); the answer counts how many claim the family, so a twin stops the walk.
   */
  template: async ({ family }) => {
    const H = globalThis.__bp;
    const held = (await H.CB.importedDocs("Actor")).filter((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id === family);
    const doc = held.length === 1 ? held[0] : null;
    return { uuid: doc?.uuid ?? null, twins: held.length };
  },

  /**
   * `fromUuidSync` as the chart reads it: once before and once after the pack's client
   * `getIndex()`, since the server's startup index carries the class's core fields alone and the
   * plate field reaches an index only through that call. Whether each answers a Document or an
   * index entry, and the plate it carries.
   */
  indexRead: async ({ uuid }) => {
    const read = () => {
      const hit = fromUuidSync(uuid);
      return { hit: !!hit, isDocument: hit instanceof foundry.abstract.Document, plate: hit?.flags?.["acks-extras"]?.plate ?? null };
    };
    const before = read();
    // "Compendium.<package>.<pack>.Actor.<id>": the pack id is the second and third parts.
    await game.packs.get(uuid.split(".").slice(1, 3).join("."))?.getIndex();
    return { before, ...read() };
  },

  /** What the template holds now: the plate flag, the picture, and the strip's own file by its id. */
  read: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    const flag = doc?.flags?.["acks-extras"]?.plate ?? null;
    return { plate: flag, img: doc?.img ?? null, variants: (doc?.system?.axes ?? []).find((a) => a.key === "variant")?.options?.length ?? 0 };
  },

  /** The family's repair through the entry picker, as the Judge ticks it: Yes to the confirm; the held-edits list is answered by `repairDone`. */
  repair: async ({ family }) => {
    const H = globalThis.__bp;
    const before = H.dialogs().map((a) => a.id);
    // The reimport runs far past one evaluate's limit, so the flight is started here and read by `repairDone`; each wait below stays under it.
    H.flightDone = false;
    H.flightError = null;
    H.flight = acksExtras.importer.cookbookReimportEntries().catch((e) => { H.flightError = String(e?.message ?? e); }).finally(() => { H.flightDone = true; });
    const app = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector(".acks-extras-importer-mon-list")), { tries: 240 });
    if (!app) return { opened: false };
    const box = H.root(app).querySelector(`input[name='sel'][value='Monsters|${family}']`);
    if (!box) return { opened: true, ticked: false };
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const dialogsBefore = H.dialogs().map((a) => a.id);
    H.root(app).querySelector("button[data-action='ok']").click();
    const dlg = await H.poll(() => H.dialogs().find((a) => !dialogsBefore.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")), { tries: 160 });
    if (dlg) H.root(dlg).querySelector("button[data-action='yes']").click();
    return { opened: true, ticked: true, asked: !!dlg };
  },
  /** The reimport `repair` started: answers whether it has returned, answering the held-edits list with Apply if it asks (the library template is the one the repair is to rewrite). */
  repairDone: async () => {
    const H = globalThis.__bp;
    const choice = H.dialogs().find((a) => H.root(a)?.querySelector(".acks-extras-held-list"));
    if (choice) {
      const apply = H.root(choice).querySelector("button[data-action='apply']");
      if (apply) apply.click(); else await choice.close();
    }
    return { done: H.flightDone === true, error: H.flightError ?? null };
  },

  /** The uploaded file fetched in the page: its pixel size, and its bytes as base64 for the walker's copy. */
  file: async ({ src }) => {
    const res = await fetch(src);
    if (!res.ok) return { ok: false, status: res.status };
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true, type: blob.type, bytes: bytes.length, width: bitmap.width, height: bitmap.height, base64: btoa(bin) };
  },

  /** A faction host at one top row naming the family template, its sheet open on the Org chart tab. */
  host: async ({ id, template }) => {
    const actor = game.actors.get(id);
    await actor.update({ "system.units": [{ key: "top", parentKey: "", label: "", holderUuid: "", kind: "", notes: "", hidden: false, gen: { template } }] });
    actor.sheet.tabGroups.primary = "orgChart";
    await actor.sheet.render(true);
    await new Promise((r) => setTimeout(r, 1200));
    const img = actor.sheet.element.querySelector(".acks-extras-org__plate");
    return { drawn: !!img, src: img?.getAttribute("src") ?? null };
  },

  /** Press Generate on the template's sheet and read the root group it made, found by the template its top row names. */
  generate: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    const known = new Set(game.actors.map((a) => a.id));
    await doc.sheet.render(true);
    await new Promise((r) => setTimeout(r, 1200));
    const btn = doc.sheet.element.querySelector('[data-action="generate"]');
    if (!btn) return { pressed: false };
    btn.click();
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const made = game.actors.filter((a) => !known.has(a.id) && (a.system?.units ?? []).some((u) => u.gen?.template === uuid));
      if (made.length) return { pressed: true, uuid: made[0].uuid, img: made[0].img, count: made.length };
      await new Promise((r) => setTimeout(r, 300));
    }
    return { pressed: true, uuid: null };
  },

  closeAll: async () => {
    for (const app of [...foundry.applications.instances.values()]) { try { await app.close(); } catch { /* closed */ } }
    return true;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
/** Reads until `pred` holds and returns the last read, which is the failing one on a timeout. */
const until = async (api, fn, arg, pred, { tries = 40, every = 250 } = {}) => {
  let v = null;
  for (let n = 0; n < tries; n++) {
    v = await run(api, fn, arg);
    if (pred(v)) return v;
    await sleep(every);
  }
  return v;
};

async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.connectBookUrl`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const tail = (p) => String(p ?? "").split("/").pop();
let gm = null;
try {
  section("seat and book");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  // The importer's api is assigned only after its cookbook loads, which can be after ready.
  for (let n = 0; n < 60 && !(await gm.eval("!!globalThis.acksExtras?.importer?.connectBookUrl")); n++) await sleep(1000);
  let installed = await run(gm, P.install);
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, installed.module);
  if (!installed.activeGMIsSelf) blocked("another GM client is the active GM");
  const mm = books([BOOK])[0];
  if (!installed.open) {
    if (!mm) blocked("ACKS_TEST_BOOKS names no path for the Monstrous Manual");
    await run(gm, P.connectBook, mm);
    for (let n = 0; n < 60 && !installed.open; n++) { await sleep(2000); installed = { ...installed, ...(await run(gm, P.bookState, { id: BOOK })) }; }
  }
  if (!installed.open) blocked("the Monstrous Manual did not open");

  section("fixture: the library's family template");
  const found = await run(gm, P.template, { family: FAMILY });
  note("template", { marker: MARKER, ...found });
  check("the library holds exactly one template of the family", found.twins === 1 && !!found.uuid, { twins: found.twins });
  if (found.twins !== 1 || !found.uuid) blocked("the library does not hold exactly one family template; the walk reads it, never builds a twin (import it through the entry picker first)");
  const before = await run(gm, P.read, { uuid: found.uuid });
  note("before", { hasPlate: !!before.plate, variants: before.variants });

  section("Repair in place on the family row");
  const repaired = await run(gm, P.repair, { family: FAMILY });
  check("the entry picker ticked the family row and its confirm was answered", repaired.opened && repaired.ticked && repaired.asked, repaired);
  const flown = await until(gm, P.repairDone, null, (r) => r.done, { tries: 480, every: 1000 });
  check("the repair in place returned without an error", flown.done && !flown.error, flown);
  const after = await run(gm, P.read, { uuid: found.uuid });
  note("after", { plate: tail(after.plate), img: tail(after.img) });
  check("the template's plate flag ends in the plate's own file", /-plate\.png$/.test(String(after.plate ?? "")), tail(after.plate));
  check("img is still the strip, a file of another name", !!after.img && tail(after.img) !== tail(after.plate) && !/-plate\.png$/.test(String(after.img)), tail(after.img));
  check("the variants are unchanged", after.variants === before.variants && after.variants > 0, { before: before.variants, after: after.variants });

  section("the uploaded file");
  if (after.plate) {
    const file = await run(gm, P.file, { src: after.plate });
    check("the plate's file serves", file.ok, { status: file.status ?? 200, type: file.type });
    if (file.ok) {
      note("plate pixels", { width: file.width, height: file.height, bytes: file.bytes });
      const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "").replace("T", "-");
      const copy = path.join(logDir(), `beastman-plate-${stamp}.png`);
      fs.writeFileSync(copy, Buffer.from(file.base64, "base64"));
      note("copy saved for the walker to view (the plate, and no page foot)", copy);
      check("the file is a picture of its own: not the strip's shape", file.width / file.height < 3 && file.height / file.width < 3, { ratio: Number((file.width / file.height).toFixed(2)) });
    }
  }

  section("after a reload");
  await gm.eval("setTimeout(() => location.reload(), 200); true").catch(() => null);
  await sleep(4000);
  note("ready after (s)", await ready(gm));
  await run(gm, P.install);
  // Read raw, before anything loads the pack document: `fromUuid` caches it, and `fromUuidSync` then answers the document, which proves nothing about the index.
  const indexed = await run(gm, P.indexRead, { uuid: found.uuid });
  note("raw read after the reload, before the pack's getIndex()", { isDocument: indexed.before.isDocument, hit: indexed.before.hit, plate: tail(indexed.before.plate) });
  if (indexed.isDocument) note("not an index pass", "the pack document was already loaded at ready, so the next check does not test the index field");
  check("fromUuidSync on the pack's template carries the plate flag once the pack's getIndex() has run, as the chart reads it", indexed.hit && tail(indexed.plate) === tail(after.plate), { isDocument: indexed.isDocument, plate: tail(indexed.plate) });

  section("the Org chart draws the plate");
  const host = await gm.fixture(HOST_MARKER, "Actor", { name: `QA Plate host${TAG}`, type: "acks-extras.faction", items: [] });
  const drawn = await run(gm, P.host, { id: host.id, template: found.uuid });
  check("the Org chart draws .acks-extras-org__plate with the plate's file", drawn.drawn && tail(drawn.src) === tail(after.plate), { src: tail(drawn.src) });
  const reloaded = await run(gm, P.read, { uuid: found.uuid });
  check("the loaded document holds the same plate", reloaded.plate === after.plate, tail(reloaded.plate));

  section("Generate");
  const generated = await run(gm, P.generate, { uuid: found.uuid });
  if (generated.uuid) await gm.track(generated.uuid, "Actor");
  check("Generate on the template made one root group", generated.pressed && !!generated.uuid && generated.count === 1, generated);
  check("the root group's img is the plate", !!generated.uuid && generated.img === after.plate, { img: tail(generated.img) });

  note("not walked here", "the faction a village Roll makes takes the root group's img, walked by lib-beastman-warband; the Roll panel's Variant list read after a reload");
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
    checks.push(["the walk ran to its end", false]);
    process.exitCode = 1;
  }
} finally {
  section("teardown");
  if (gm) {
    try { await run(gm, P.closeAll); } catch { /* page gone */ }
    // The marked host stays as a kept fixture; only what this run made without a marker goes.
    const disposable = gm.tracked().filter((e) => !e.marker).map((e) => e.uuid);
    try { note("swept", await gm.sweepTracked({ only: disposable })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\nchecks: ${passed} passed, ${checks.length - passed} failed`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  try { gm?.close(); } catch { /* closed */ }
}
