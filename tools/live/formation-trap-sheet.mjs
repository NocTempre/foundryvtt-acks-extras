/**
 * Live walk, the trap item sheet and the trap zone's config:
 * docs/formation/TESTING.md, "The trap item sheet and the trap zone's config",
 * on the GM seat. Machine values arrive through ./_env.mjs; nothing here names a
 * port, a world, a seat or a book.
 *
 * Covers steps 1, 2, 5, 6, 7 and 8, and step 2's halves for the world as it
 * stands: whichever of the `formation` tables `fall` and `pitSpikeCount` the
 * world holds is checked for its page, and whichever it does not for the page
 * reference alone. Steps 3 and 4 clear those tables, which every lane of the
 * shared world reads; this walk leaves them as they are, and
 * tools/test-trap-sheet-view.mjs pins both cases offline.
 *
 * Fixtures, found by marker or built carrying one and kept, each brought to the
 * shape a step needs at its start: `formation/trap-sheet-pit` (a trap Item at
 * level 3 with a pit depth on its level-3 row), `formation/trap-sheet-scene`
 * and the region `formation/trap-sheet-zone` on it, whose Trap Zone behavior
 * names the item. Every figure written is invented. Nothing is swept: the run
 * builds nothing it does not keep. The type size setting is client-scoped and
 * is restored in the `finally`.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const SCOPE = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/* Page side: each function is stringified and run in the seat's page. */
const P = {
  census: async () => ({ role: game.user.role, isGM: game.user.isGM }),

  install: async () => {
    const H = (globalThis.__ts = globalThis.__ts ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.tables = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    H.rules = await import("/modules/acks-extras/scripts/formation/trap-rules.mjs");
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.renders = 0;
    if (!H.watch) { H.watch = true; Hooks.on("renderTrapSheet", () => { H.renders += 1; }); }
    return { ok: typeof H.rules.pitFigures === "function" };
  },

  /** The pit fixture at the shape a step needs: level 3, its row's depth and spikes, its band. */
  shapeTrap: async ({ uuid, depth, spiked, triggerOn }) => {
    const item = fromUuidSync(uuid);
    const levels = foundry.utils.deepClone(item.system.levels ?? []);
    while (levels.length < 6) levels.push({});
    levels[2] = { ...levels[2], pitDepthFeet: depth, spiked, damageFormula: "" };
    await item.update({ "system.level": 3, "system.levels": levels, "system.triggerOn": triggerOn });
    const t = item.system.levels[2];
    return { level: item.system.level, depth: t.pitDepthFeet, spiked: !!t.spiked, triggerOn: item.system.triggerOn };
  },

  /** Open the item's sheet fresh and read what U16 put on it. */
  readSheet: async ({ uuid }) => {
    const H = globalThis.__ts;
    const item = fromUuidSync(uuid);
    if (item.sheet.rendered) await item.sheet.close({ animate: false });
    await item.sheet.render(true);
    await H.poll(() => item.sheet.rendered, { tries: 100, every: 150 });
    await H.sleep(400);
    const root = H.root(item.sheet);
    const strip = root.querySelector(".acks-extras-trap-strip");
    const steps = [...(strip?.querySelectorAll("li") ?? [])].map((li) => ({
      current: li.getAttribute("aria-current"),
      sr: li.querySelector(".acks-extras-trap-sr")?.textContent.trim() ?? "",
      tip: li.dataset.tooltipText ?? "",
      srVisible: (() => { const r = li.querySelector(".acks-extras-trap-sr")?.getBoundingClientRect(); return !!r && r.width > 2 && r.height > 2; })(),
    }));
    const pit = root.querySelector(".acks-extras-trap-derived");
    const band = root.querySelector(".acks-extras-trap-band");
    const level = root.querySelector('input[name="system.level"]');
    return {
      cls: item.sheet.constructor.name,
      width: item.sheet.position.width,
      stripLabel: strip?.getAttribute("aria-label") ?? null,
      steps,
      caption: root.querySelector(".acks-extras-trap-strip-state")?.textContent.trim() ?? null,
      captionTip: root.querySelector(".acks-extras-trap-strip-state")?.dataset.tooltip ?? null,
      pit: pit ? { figure: pit.querySelector(".acks-extras-trap-figure")?.textContent.trim() ?? "", tip: pit.dataset.tooltipText ?? "" } : null,
      band: band ? { figure: band.querySelector(".acks-extras-trap-figure")?.textContent.trim() ?? "", tip: band.dataset.tooltipText ?? "" } : null,
      levelMax: level?.getAttribute("max") ?? null,
      inlineStyle: !!root.querySelector("prose-mirror[style]"),
      titles: root.querySelectorAll("[title]").length,
    };
  },

  /** What the world holds for the pit and the band, and the words the tooltips should carry. */
  expect: async () => {
    const H = globalThis.__ts;
    const figs = H.rules.pitFigures();
    const band = H.rules.trapFigures();
    const cite = (t) => H.tables.citeOf("formation", t);
    return {
      fall: figs.fall ? { count: figs.fall.count, faces: figs.fall.faces, feet: figs.fall.feetPerDie, cite: cite("fall") } : null,
      spike: figs.spike ? { count: figs.spike.count, faces: figs.spike.faces, cite: cite("pitSpikeCount") } : null,
      band: band.triggerOn ?? null,
      bandCite: cite("trapTriggerOn"),
      refFall: game.i18n.localize("ACKS-FORMATION.crossing.ref.jumping"),
      refSpikes: game.i18n.localize("ACKS-FORMATION.traps.ref.spikes"),
      refTrap: game.i18n.localize("ACKS-FORMATION.traps.ref.trap"),
      depthWord: game.i18n.localize("ACKS-FORMATION.crossing.fallPart.depth"),
      ownWord: game.i18n.format("ACKS-FORMATION.traps.band.own", { page: "\u0000" }).split("\u0000")[0],
      importedWord: game.i18n.format("ACKS-FORMATION.traps.band.imported", { page: "\u0000" }).split("\u0000")[0],
      ownOverWord: game.i18n.format("ACKS-FORMATION.traps.band.ownOver", { band: "\u0000", page: "\u0000" }).split("\u0000")[0],
      pitFormula: { plain: H.rules.pitDamage(30, false, figs)?.formula ?? null, spiked: H.rules.pitDamage(30, true, figs)?.formula ?? null },
    };
  },

  /** Shrink the sheet, scroll its form to the bottom, change a field through the form, and read the scroll back. */
  scroll: async ({ uuid }) => {
    const H = globalThis.__ts;
    const sheet = fromUuidSync(uuid).sheet;
    sheet.setPosition({ height: 300 });
    await H.sleep(500);
    const root = H.root(sheet);
    const part = sheet.parts?.form ?? root.querySelector('[data-application-part="form"]');
    const content = root.querySelector(".window-content");
    const scrolls = !!part && part.scrollHeight > part.clientHeight + 4;
    // A mid offset: core puts an auto-height window back to `auto` on every
    // render, so the frame regrows and an offset past its new reach would clamp.
    part.scrollTop = 150;
    await H.sleep(200);
    const top0 = part.scrollTop;
    const n0 = H.renders;
    const input = root.querySelector('input[name="system.triggerOn"]');
    input.value = String((Number(input.value) || 1) === 1 ? 2 : 1);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const drew = await H.poll(() => H.renders > n0, { tries: 60, every: 150 });
    await H.sleep(500);
    const part1 = sheet.parts?.form ?? H.root(sheet).querySelector('[data-application-part="form"]');
    return {
      heights: { before: { scroll: part.scrollHeight, client: part.clientHeight }, after: { scroll: part1?.scrollHeight, client: part1?.clientHeight }, frame: sheet.position.height },
      found: !!part, scrolls, top0, top1: part1?.scrollTop ?? null, drew: !!drew, replaced: part1 !== part || !input.isConnected,
      contentScrolls: content.scrollHeight > content.clientHeight + 4 && getComputedStyle(content).overflowY !== "hidden",
      partOverflow: part1 ? getComputedStyle(part1).overflowY : null,
    };
  },

  close: async ({ uuid }) => { const s = fromUuidSync(uuid)?.sheet; if (s?.rendered) await s.close({ animate: false }); return true; },

  /** The zone's behavior config: the State select's options and the Known field's label and hint. */
  zoneConfig: async ({ uuid }) => {
    const H = globalThis.__ts;
    const region = fromUuidSync(uuid);
    const behavior = region.behaviors.find((b) => b.type === "acks-extras.trapZone");
    if (!behavior) return { behavior: false };
    const sheet = behavior.sheet;
    await sheet.render(true);
    await H.poll(() => sheet.rendered, { tries: 80, every: 150 });
    await H.sleep(400);
    const root = H.root(sheet);
    const select = root.querySelector('select[name="system.state"]');
    const known = root.querySelector('input[name="system.known"]');
    const group = known?.closest(".form-group");
    const out = {
      behavior: true,
      options: [...(select?.options ?? [])].map((o) => ({ value: o.value, text: o.textContent.trim() })),
      // Each state's label is the lang key named for its id.
      labels: Object.fromEntries([...(select?.options ?? [])].map((o) => [o.value, game.i18n.localize(`ACKS-FORMATION.traps.state.${o.value}`)])),
      knownLabel: group?.querySelector("label")?.textContent.trim() ?? null,
      knownHint: group?.querySelector(".hint")?.textContent.trim() ?? null,
      wantLabel: game.i18n.localize("ACKS-FORMATION.TRAP_ZONE.FIELDS.known.label"),
      wantHint: game.i18n.localize("ACKS-FORMATION.TRAP_ZONE.FIELDS.known.hint"),
    };
    await sheet.close({ animate: false });
    return out;
  },

  /**
   * The width a sheet built now opens at. An item keeps one sheet instance, and
   * the width is decided when that instance is built, so a fresh one is what a
   * client loaded at this type size opens.
   */
  freshWidth: async ({ uuid }) => {
    const H = globalThis.__ts;
    const item = fromUuidSync(uuid);
    if (item.sheet.rendered) await item.sheet.close({ animate: false });
    const app = new item.sheet.constructor({ document: item });
    await app.render(true);
    await H.poll(() => app.rendered, { tries: 100, every: 150 });
    const width = app.position.width;
    await app.close({ animate: false });
    return width;
  },

  getKnob: async () => game.settings.get("acks-extras", "fontScale"),
  setKnob: async ({ px }) => { await game.settings.set("acks-extras", "fontScale", px); await globalThis.__ts.sleep(400); return game.settings.get("acks-extras", "fontScale"); },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    const ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation`).catch(() => false);
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`gm: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let knob0 = null;
let pitUuid = null;
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm));
  const census = await run(gm, P.census);
  check("the walk's seat is a GM", census.isGM, census);
  if (!census.isGM) blocked("the GM seat is not a GM");
  note("installed", await run(gm, P.install));
  knob0 = await run(gm, P.getKnob);

  section("fixtures");
  const pit = await gm.fixture("formation/trap-sheet-pit", "Item", { name: "QA Trap Sheet Pit", type: `${SCOPE}.trap` });
  pitUuid = pit.uuid;
  const scene = await gm.fixture("formation/trap-sheet-scene", "Scene", { name: "QA Trap Sheet Ground", active: false, navigation: false, width: 1000, height: 800, grid: { size: 100 } });
  const zone = await gm.fixture("formation/trap-sheet-zone", "Region", {
    name: "QA Trap Sheet Zone", color: "#aa3333",
    shapes: [{ type: "rectangle", x: 200, y: 200, width: 200, height: 200, rotation: 0, hole: false }],
    behaviors: [{ type: `${SCOPE}.trapZone`, name: "QA Trap Sheet Pit", system: { trapUuid: pit.uuid, state: "armed" } }],
  }, { parent: scene.uuid });
  const E = await run(gm, P.expect);
  note("world holds", { fall: !!E.fall, fallCite: !!E.fall?.cite, spike: !!E.spike, spikeCite: !!E.spike?.cite, band: E.band !== null, bandCite: !!E.bandCite });

  section("1. the level strip");
  await run(gm, P.setKnob, { px: 14 });
  let shaped = await run(gm, P.shapeTrap, { uuid: pit.uuid, depth: 30, spiked: true, triggerOn: 1 });
  check("start: the pit is at level 3 with a spiked 30-foot row and its own band", shaped.level === 3 && shaped.depth === 30 && shaped.spiked && shaped.triggerOn === 1, shaped);
  let s = await run(gm, P.readSheet, { uuid: pit.uuid });
  check("the trap opens on this module's sheet", s.cls === "TrapSheet", s.cls);
  check("1: the strip is named and has six steps", !!s.stripLabel && s.steps.length === 6, { label: !!s.stripLabel, steps: s.steps.length });
  check("1: the third step alone carries aria-current=step", s.steps.map((x) => x.current).join() === ",,step,,,", s.steps.map((x) => x.current));
  check("1: each step names its level and state in text for assistive technology and in its tooltip", s.steps.every((x, i) => x.sr && x.sr === x.tip && x.sr.includes(String(i + 1))), s.steps.map((x) => x.sr));
  check("1: that text is hidden from sight but kept in the page", s.steps.every((x) => !x.srVisible), s.steps.map((x) => x.srVisible));
  check("1: the caption gives the level on screen and the count filled, with its tooltip", !!s.caption && /\b3\b/.test(s.caption) && /\b6\b/.test(s.caption) && !!s.captionTip, { caption: s.caption, tip: s.captionTip });
  check("1: the level field's max is the trap's level count, and no inline style or title remains", s.levelMax === "6" && !s.inlineStyle && s.titles === 0, { max: s.levelMax, inline: s.inlineStyle, titles: s.titles });

  section("2. the pit's damage line, spiked");
  const parts = (tip) => tip.split(" · ");
  check("2: the line stands with a figure equal to the world's pit formula (blank where no fall is held)", !!s.pit && s.pit.figure === (E.pitFormula.spiked ?? ""), { figure: s.pit?.figure, want: E.pitFormula.spiked });
  let p = s.pit ? parts(s.pit.tip) : [];
  check("2: the tooltip's first part is the depth", p[0] === `${E.depthWord} 30`, p[0]);
  if (E.fall) {
    check("2: the fall part names its dice and the page it was read from", p[1]?.includes(String(E.fall.faces)) && p[1]?.endsWith(`(${E.fall.cite ?? E.refFall})`), { part: p[1], cited: !!E.fall.cite });
  } else {
    check("2: no fall held: the fall part is the page reference alone, no digit beside it", p[1] === E.refFall, p[1]);
  }
  if (E.spike) {
    check("2: the spike part names its dice and the page it was read from", p[2]?.endsWith(`(${E.spike.cite ?? E.refSpikes})`) && /\d/.test(p[2]), { part: p[2], cited: !!E.spike.cite });
  } else {
    check("2: no spike figures held: the spike part is the page reference alone, no digit", p[2] === E.refSpikes, p[2]);
  }
  shaped = await run(gm, P.shapeTrap, { uuid: pit.uuid, depth: 30, spiked: false, triggerOn: 1 });
  s = await run(gm, P.readSheet, { uuid: pit.uuid });
  p = s.pit ? parts(s.pit.tip) : [];
  check("2: unspiked, the tooltip names no spikes and the figure is the plain pit's", !!s.pit && p.length === 2 && !s.pit.tip.includes(E.refSpikes) && s.pit.figure === (E.pitFormula.plain ?? ""), { parts: p.length, figure: s.pit?.figure });
  note("not walked", "steps 3 and 4 (clearing the spike and fall tables of the shared world); pinned offline");

  section("5. the band in force");
  await run(gm, P.shapeTrap, { uuid: pit.uuid, depth: 30, spiked: true, triggerOn: null });
  s = await run(gm, P.readSheet, { uuid: pit.uuid });
  if (E.band !== null) {
    check("5: blank, the line reads the imported band and its tooltip names the import and its page", s.band?.figure === String(E.band) && s.band.tip.startsWith(E.importedWord) && s.band.tip.includes(E.bandCite ?? E.refTrap), s.band);
  } else {
    check("5: blank with nothing imported, the figure is blank and the tooltip is the page reference alone", s.band?.figure === "" && s.band.tip === E.refTrap, s.band);
  }
  await run(gm, P.shapeTrap, { uuid: pit.uuid, depth: 30, spiked: true, triggerOn: 1 });
  s = await run(gm, P.readSheet, { uuid: pit.uuid });
  check("5: typed, the line reads the trap's own figure and the tooltip says so", s.band?.figure === "1" && (E.band !== null ? s.band.tip.startsWith(E.ownOverWord) : s.band.tip.startsWith(E.ownWord)), s.band);
  await run(gm, P.shapeTrap, { uuid: pit.uuid, depth: 30, spiked: true, triggerOn: 0 });
  s = await run(gm, P.readSheet, { uuid: pit.uuid });
  check("5: typed 0, the line reads 0", s.band?.figure === "0", s.band);
  await run(gm, P.shapeTrap, { uuid: pit.uuid, depth: 30, spiked: true, triggerOn: 1 });

  section("6. the form part scrolls");
  await run(gm, P.readSheet, { uuid: pit.uuid });
  const sc = await run(gm, P.scroll, { uuid: pit.uuid });
  check("6: shrunk, the form part is the scroller and the frame is not", sc.found && sc.scrolls && sc.partOverflow === "auto" && !sc.contentScrolls, sc);
  check("6: a changed field re-renders the form, and the part is at the same offset after", sc.drew && sc.replaced && sc.top0 > 0 && Math.abs(sc.top1 - sc.top0) <= 2, sc);
  await run(gm, P.close, { uuid: pit.uuid });

  section("7. the zone's config");
  const z = await run(gm, P.zoneConfig, { uuid: zone.uuid });
  check("7: the region holds its Trap Zone behavior", z.behavior, z);
  check("7: the State select lists the lang labels, not the raw ids", z.options.length >= 4 && z.options.every((o) => o.text === z.labels[o.value] && !o.text.startsWith("ACKS-")) && z.options.some((o) => o.text !== o.value), z.options);
  check("7: the Known checkbox carries its label and hint", z.knownLabel === z.wantLabel && z.knownHint === z.wantHint, { label: z.knownLabel, hint: z.knownHint });

  section("8. the type size");
  const small = await run(gm, P.freshWidth, { uuid: pit.uuid });
  await run(gm, P.setKnob, { px: 18 });
  const large = await run(gm, P.freshWidth, { uuid: pit.uuid });
  check("8: built at the largest type size, the sheet opens wider by the knob's factor", Math.abs(large / small - 18 / 14) < 0.03, { small, large });
  await run(gm, P.close, { uuid: pit.uuid });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  tally.fail += 1;
} finally {
  section("teardown");
  if (gm) {
    try {
      if (knob0 !== null) note("type size restored", await run(gm, P.setKnob, { px: knob0 }));
      if (pitUuid) await run(gm, P.close, { uuid: pitUuid });
    } catch (err) { console.error("teardown:", err?.message ?? err); }
    try { await gm.close(); } catch {}
  }
  section("summary");
  console.log(`${tally.pass}/${tally.pass + tally.fail} checks passed`);
  process.exitCode = tally.fail ? 1 : 0;
}
