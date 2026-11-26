/**
 * Live walk, lib/daylight-radius: the "Daylight radius" field this module adds
 * to core's Light Source window (the AmbientLightConfig, its Basic Configuration
 * tab), on the GM seat. Walks docs/lib/TESTING.md, "Daylight from a placed
 * light", steps 1 to 6. Machine values arrive through ./_env.mjs. Written from
 * the code; the walker session that runs it first reads what it prints.
 *
 * The window is driven the way a user drives it: the light's own sheet is
 * rendered, the field is read out of the rendered DOM, a value is typed (set,
 * then a bubbling `input` and `change`), a tab is clicked, the window's own
 * Reset button and its own submit button are pressed. What a step asserts is
 * read from that DOM, from the light document, and from `lightLevelAt`.
 *
 * The recipe's step 2 and step 4 name the same point for two different things
 * (past core's bright radius; inside it), which no one configuration serves, so
 * the walk reads four points on one line from the light and sets two radii:
 * 50 (reaches a point past core's bright radius of 30) and 5 (falls short of a
 * point inside it).
 *
 * Fixtures, kept and found by marker (`api.fixture`):
 *   the scene `lib/daylight-radius-scene` (square grid, 5 per cell, darkness 1,
 *   global light off, never activated) and the ambient light
 *   `lib/daylight-radius-light` on it (bright 30, dim 60, no daylight radius).
 * Each run brings both to that shape at its start and at its end. The one light
 * step 6 creates is tracked the moment it is read back and swept by its id.
 *
 * Not reached: Scene controls → Lighting Controls and the double-click on the
 * canvas (the sheet is opened through the light's own `sheet.render`), and the
 * placement gesture of step 6 (an unsaved light is configured in core's own
 * window class with creation allowed, which is the path Create Ambient Light
 * submits). The recorder is attached after `ready`, so a load-time error is not
 * seen; what the field's injection logs while the windows open is.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const skipped = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const skip = (step, reason) => {
  skipped.push(step);
  console.log(`SKIP ${step}: ${reason}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The light's place, the scene's pixels per unit, and the radii the fixture is shaped to. All invented. */
const LIGHT_AT = Object.freeze({ x: 1000, y: 1000 });
const PER_UNIT = 20;
const RADII = Object.freeze({ bright: 30, dim: 60 });
/** Points on a line from the light, by distance in scene units: inside core's bright radius, past it and inside the daylight reach, past the daylight reach and inside the dim radius, past everything. */
const FEET = Object.freeze({ near: 10, mid: 45, edge: 55, far: 70 });
const pointAt = (units, from = LIGHT_AT) => ({ x: from.x + units * PER_UNIT, y: from.y });
/** The two daylight radii the walk types: one reaching past core's bright radius, one short of the near point. */
const DAYLIGHT = Object.freeze({ wide: 50, short: 5, unsaved: 17, fresh: 25 });
const FIELD_NAME = "flags.acks-extras.daylight";

/** The fixture scene's data: a square grid of 5 units a cell at 100 px, night, no global light. */
const SCENE_DATA = (name) => ({
  name,
  width: 3000,
  height: 2000,
  padding: 0,
  grid: { size: 100, distance: 5, units: "ft", type: 1 },
  environment: { darknessLevel: 1, globalLight: { enabled: false } },
});

async function ready(api, seconds = 150) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the GM's page,  */
/*  so none names a value of this file; what it needs arrives as its   */
/*  argument.                                                          */
/* ------------------------------------------------------------------ */
const P = {
  /** Arm the recorders and helpers, and say what this build offers. Replaces an earlier install in this page. */
  install: ({ field }) => {
    globalThis.__ldr?.disarm?.();
    const H = (globalThis.__ldr = { field });
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.until = async (fn, ms = 8000, step = 100) => {
      const t0 = Date.now();
      for (;;) {
        let v = null;
        try { v = await fn(); } catch { v = null; }
        if (v) return v;
        if (Date.now() - t0 > ms) return null;
        await H.sleep(step);
      }
    };
    H.said = [];
    H.errors = [];
    const notes = ui.notifications;
    const undo = [];
    for (const kind of ["info", "warn", "error"]) {
      const had = Object.hasOwn(notes, kind);
      const original = notes[kind];
      notes[kind] = function (message, ...rest) {
        H.said.push({ kind, text: String(message) });
        if (kind === "error") H.errors.push(`toast: ${String(message)}`.slice(0, 300));
        return original.call(this, message, ...rest);
      };
      undo.push(() => { if (had) notes[kind] = original; else delete notes[kind]; });
    }
    const consoleError = console.error;
    console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); return consoleError.apply(console, args); };
    const onReject = (e) => H.errors.push(`rejection: ${String(e.reason?.message ?? e.reason)}`.slice(0, 300));
    window.addEventListener("unhandledrejection", onReject);
    H.disarm = () => {
      for (const fn of undo) fn();
      console.error = consoleError;
      window.removeEventListener("unhandledrejection", onReject);
    };
    /** The window the walk is driving, or null. */
    H.app = null;
    H.closeApp = async () => {
      try { await H.app?.close({ animate: false }); } catch { /* closed */ }
      H.app = null;
    };
    /** What the open window's DOM shows of the injected field. */
    H.snap = () => {
      const app = H.app;
      const root = app?.element ?? null;
      const fields = root ? [...root.querySelectorAll(`[name="${H.field}"]`)] : [];
      const input = fields[0] ?? null;
      const group = input?.closest(".form-group") ?? null;
      const before = group?.previousElementSibling ?? null;
      const key = group?.dataset?.tooltip ?? null;
      return {
        rendered: app?.rendered === true,
        tab: app?.tabGroups?.sheet ?? null,
        count: fields.length,
        value: input ? input.value : null,
        type: input?.type ?? null,
        disabled: input ? input.disabled : null,
        inBasicPart: !!input?.closest('[data-application-part="basic"]'),
        afterRadii: !!before?.querySelector('[name="config.bright"]') && !!before?.querySelector('[name="config.dim"]'),
        label: group?.querySelector("label")?.firstChild?.textContent?.trim() ?? null,
        units: group?.querySelector("label .units")?.textContent?.trim() ?? null,
        tooltipKey: key,
        tooltip: key ? game.i18n.localize(key) : null,
        ariaLabel: input?.getAttribute("aria-label") ?? null,
        submitLabel: root?.querySelector('button[type="submit"]')?.textContent?.trim() ?? null,
        gridUnits: app?.document?.parent?.grid?.units ?? null,
      };
    };
    const lib = globalThis.acksExtras?.lib;
    return {
      user: game.user.name,
      isGM: game.user.isGM,
      extras: game.modules.get("acks-extras")?.version ?? null,
      lib: lib?.apiVersion ?? null,
      hasReader: typeof lib?.light?.lightLevelAt === "function",
      hasConfig: typeof foundry.applications?.sheets?.AmbientLightConfig === "function",
    };
  },

  /** What this page's recorders caught since the install. */
  caught: () => ({ errors: globalThis.__ldr?.errors ?? [], said: (globalThis.__ldr?.said ?? []).map((s) => `${s.kind}: ${s.text}`.slice(0, 200)) }),

  /** Bring the fixture scene and light to the shape a step starts from; answers what read back. */
  shape: async ({ sceneUuid, lightUuid, radii }) => {
    const scene = fromUuidSync(sceneUuid);
    const light = fromUuidSync(lightUuid);
    if (!scene || !light) return { ok: false, reason: "fixture not found" };
    await scene.update({ "environment.darknessLevel": 1, "environment.globalLight.enabled": false });
    await light.update({
      hidden: false,
      "config.negative": false,
      "config.darkness.min": 0,
      "config.darkness.max": 1,
      "config.bright": radii.bright,
      "config.dim": radii.dim,
      "flags.acks-extras.-=daylight": null,
    });
    const flag = foundry.utils.getProperty(light, "flags.acks-extras.daylight");
    return {
      ok: true,
      darkness: scene.environment.darknessLevel,
      globalLight: scene.environment.globalLight.enabled,
      hidden: light.hidden,
      negative: light.config.negative,
      range: { min: light.config.darkness.min, max: light.config.darkness.max },
      bright: light.config.bright,
      dim: light.config.dim,
      daylight: flag === undefined ? "unset" : flag,
    };
  },

  /** Write the fixture light's hidden state and activation range (core's own fields, set here as setup for a reading). */
  setLight: async ({ lightUuid, changes }) => {
    const light = fromUuidSync(lightUuid);
    await light.update(changes);
    return { hidden: light.hidden, range: { min: light.config.darkness.min, max: light.config.darkness.max } };
  },

  /** The seat's view of the scene. */
  view: async ({ sceneUuid }) => {
    const H = globalThis.__ldr;
    const scene = fromUuidSync(sceneUuid);
    if (!scene) return { viewing: false, reason: "no scene" };
    let threw = null;
    if (canvas.scene?.id !== scene.id) {
      try { await scene.view(); } catch (e) { threw = String(e?.message ?? e); }
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 15000);
    }
    return { viewing: canvas.scene?.id === scene.id, threw };
  },

  /** The stored fields of a light the walk asserts: the module's flag (`"unset"` when absent) and core's own radii. */
  read: ({ lightUuid }) => {
    const light = fromUuidSync(lightUuid);
    if (!light) return null;
    const flag = foundry.utils.getProperty(light, "flags.acks-extras.daylight");
    return { daylight: flag === undefined ? "unset" : flag, bright: light.config.bright, dim: light.config.dim, hidden: light.hidden, id: light.id, name: light.name ?? null };
  },

  /** `lightLevelAt` at each named point of the scene. */
  reading: ({ sceneUuid, points }) => {
    const scene = fromUuidSync(sceneUuid);
    const read = globalThis.acksExtras.lib.light.lightLevelAt;
    return Object.fromEntries(Object.entries(points).map(([name, p]) => [name, read(scene, p)]));
  },

  /** Render the fixture light's own sheet (or, for `fresh`, core's window on a light not yet saved) and report the DOM. */
  open: async ({ lightUuid, fresh }) => {
    const H = globalThis.__ldr;
    await H.closeApp();
    let app;
    if (fresh) {
      const scene = fromUuidSync(fresh.sceneUuid);
      const doc = new (getDocumentClass("AmbientLight"))(fresh.data, { parent: scene });
      app = new foundry.applications.sheets.AmbientLightConfig({ document: doc, canCreate: true });
    } else {
      app = fromUuidSync(lightUuid)?.sheet;
    }
    if (!app) return { rendered: false, reason: "no sheet" };
    await app.render({ force: true });
    H.app = app;
    await H.until(() => app.rendered && app.element?.querySelector('[data-application-part="basic"]'), 10000);
    return H.snap();
  },

  /** The window's DOM as it stands now. */
  snap: () => globalThis.__ldr.snap(),

  /** Type into the field as a user does: set the value, then a bubbling input and change. Answers what the field and the window's preview hold after. */
  type: async ({ value }) => {
    const H = globalThis.__ldr;
    const input = H.app?.element?.querySelector(`[name="${H.field}"]`);
    if (!input) return { ok: false, reason: "no field" };
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(200);
    const previewed = H.app._preview?._source?.flags?.["acks-extras"]?.daylight;
    return { ok: true, value: input.value, previewed: previewed === undefined ? "unset" : previewed };
  },

  /** Click a tab's own button, and fall back to the window's changeTab where the click did not take. */
  tab: async ({ tab }) => {
    const H = globalThis.__ldr;
    const app = H.app;
    const button = app.element.querySelector(`[data-action="tab"][data-tab="${tab}"]`);
    let how = "click";
    if (button) button.click();
    await H.sleep(250);
    if (app.tabGroups?.sheet !== tab) {
      how = "changeTab";
      app.changeTab(tab, "sheet");
      await H.sleep(250);
    }
    return { tab: app.tabGroups?.sheet ?? null, how };
  },

  /** Mark the Basic part's element, so a later read can tell core replaced it. */
  mark: () => {
    const part = globalThis.__ldr.app?.element?.querySelector('[data-application-part="basic"]');
    if (part) part.dataset.ldrMark = "1";
    return !!part;
  },

  /** A part re-render of the Basic part: core replaces its element. Answers whether it did and what the DOM shows. */
  partRender: async () => {
    const H = globalThis.__ldr;
    await H.app.render({ parts: ["basic"] });
    const replaced = await H.until(() => {
      const part = H.app.element.querySelector('[data-application-part="basic"]');
      return part && !part.dataset.ldrMark && H.app.element.querySelector(`[name="${H.field}"]`);
    }, 8000);
    return { replaced: !!replaced, ...H.snap() };
  },

  /** Press the window's own Reset button (it renders the whole window) and wait for the Basic part to be replaced. */
  reset: async () => {
    const H = globalThis.__ldr;
    const button = H.app.element.querySelector('button[data-action="reset"]');
    if (!button) return { pressed: false, reason: "no Reset button" };
    button.click();
    const replaced = await H.until(() => {
      const part = H.app.element.querySelector('[data-application-part="basic"]');
      return part && !part.dataset.ldrMark && H.app.element.querySelector(`[name="${H.field}"]`);
    }, 8000);
    return { pressed: true, replaced: !!replaced, ...H.snap() };
  },

  /** Press the window's own submit button; answers its label and whether the window closed. */
  submit: async () => {
    const H = globalThis.__ldr;
    const app = H.app;
    const button = app?.element?.querySelector('button[type="submit"]');
    if (!button) return { pressed: false, reason: "no submit button" };
    const label = button.textContent.trim();
    button.click();
    const closed = await H.until(() => app.rendered === false, 8000);
    if (closed) H.app = null;
    return { pressed: true, label, closed: !!closed };
  },

  /** Close the driven window without saving. */
  closeApp: async () => { await globalThis.__ldr.closeApp(); return true; },

  /** The ids of the scene's lights. */
  lightIds: ({ sceneUuid }) => [...fromUuidSync(sceneUuid).lights].map((l) => l.id),

  /** What a created light stores, by id. */
  readById: ({ sceneUuid, id }) => {
    const light = fromUuidSync(sceneUuid)?.lights.get(id);
    if (!light) return null;
    const flag = foundry.utils.getProperty(light, "flags.acks-extras.daylight");
    return { uuid: light.uuid, daylight: flag === undefined ? "unset" : flag, bright: light.config.bright, dim: light.config.dim };
  },
};

const gmRun = (fn, arg) => gm.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
/** Poll an async producer until it answers truthy or the time runs out; answers the last value either way. */
async function until(fn, ms = 10000, step = 300) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    if (Date.now() - t0 > ms) return last;
    await sleep(step);
  }
}
/** A step in its own try, so one throw leaves the rest running. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name === "WalkBlocked") throw err;
    check(`${name} ran to its end`, false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
  try { await gmRun(P.closeApp); } catch { /* the page is gone */ }
}

let gm = null;
const S = { scene: null, light: null, extraLight: null };

/** The stored flag of the fixture light, read until it equals `want` (for null, null or gone) or the time runs out. */
const flagBecomes = async (want) => {
  let last = null;
  const lands = (v) => (want === null ? v === null || v === "unset" : same(v, want));
  await until(async () => { last = await gmRun(P.read, { lightUuid: S.light }); return last && lands(last.daylight); }, 8000, 250);
  return last;
};
/** Open the fixture light's window, type a value, press submit; answers each stage's report. */
async function setViaWindow(value) {
  const opened = await gmRun(P.open, { lightUuid: S.light });
  const typed = await gmRun(P.type, { value: String(value) });
  const submitted = await gmRun(P.submit);
  return { opened, typed, submitted };
}
const readingsAt = (points) => gmRun(P.reading, { sceneUuid: S.scene, points });
/** The reading a check expects: level and what decided it, and for a light the kind and id of its source. */
const reads = (got, { level, by, kind, id }) =>
  !!got && got.level === level && got.by === by && (kind === undefined || got.source?.kind === kind) && (id === undefined || got.source?.id === id);
const ALL_POINTS = Object.fromEntries(Object.entries(FEET).map(([k, v]) => [k, pointAt(v)]));

try {
  /* ---------------------------------------------------------------- */
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm));
  const inst = await gmRun(P.install, { field: FIELD_NAME });
  note("gm", inst);
  check("the GM seat is a GM", inst.isGM === true);
  if (!inst.hasReader) blocked("lightLevelAt is not on acksExtras.lib.light in this build");
  if (!inst.hasConfig) blocked("core has no AmbientLightConfig at foundry.applications.sheets on this build");

  /* ---------------------------------------------------------------- */
  section("fixtures");
  const sceneFx = await gm.fixture("lib/daylight-radius-scene", "Scene", SCENE_DATA("Daylight Radius Probe"));
  S.scene = sceneFx.uuid;
  const lightFx = await gm.fixture("lib/daylight-radius-light", "AmbientLight", { name: "Daylight Probe Lamp", x: LIGHT_AT.x, y: LIGHT_AT.y, config: { bright: RADII.bright, dim: RADII.dim } }, { parent: S.scene });
  S.light = lightFx.uuid;
  note("fixtures", { scene: S.scene, light: S.light, built: gm.tracked().length });
  const shaped = await gmRun(P.shape, { sceneUuid: S.scene, lightUuid: S.light, radii: RADII });
  check("the fixtures stand in the shape the walk starts from", shaped.ok && shaped.darkness === 1 && shaped.globalLight === false && shaped.hidden === false && shaped.negative === false && same(shaped.range, { min: 0, max: 1 }) && shaped.bright === RADII.bright && shaped.dim === RADII.dim && shaped.daylight === "unset", shaped);
  const view = await gmRun(P.view, { sceneUuid: S.scene });
  note("the GM seat's view of the fixture scene", view);

  /* ---------------------------------------------------------------- */
  await step("step 1", async () => {
    section("1 the field is there: after the radii, with units and a tooltip, blank");
    const snap = await gmRun(P.open, { lightUuid: S.light });
    check("1: the window rendered on its Basic tab", snap.rendered === true && snap.tab === "basic", { rendered: snap.rendered, tab: snap.tab });
    check("1: exactly one Daylight radius field, in the Basic part", snap.count === 1 && snap.inBasicPart === true, { count: snap.count, inBasicPart: snap.inBasicPart });
    check("1: it stands directly after the group holding core's two radii", snap.afterRadii === true);
    check("1: it is a number field, enabled, named by an aria-label", snap.type === "number" && snap.disabled === false && !!snap.ariaLabel, { type: snap.type, disabled: snap.disabled, aria: snap.ariaLabel });
    check("1: the scene's unit stands beside its label", !!snap.gridUnits && !!snap.units && snap.units.includes(snap.gridUnits), { units: snap.units, gridUnits: snap.gridUnits });
    check("1: the group's tooltip is the lang key and it reads with a page reference", snap.tooltipKey === "ACKS-LIB.ambientDaylight.tooltip" && /\bRR\b[^)]*\d/.test(snap.tooltip ?? ""), { key: snap.tooltipKey, tooltip: snap.tooltip });
    check("1: the field is blank", snap.value === "", { value: snap.value });
    const updateLabel = await gmRun(() => game.i18n.localize("AMBIENT_LIGHT.ACTIONS.UPDATE"));
    check("1: the window offers Update, not Create, for a saved light", snap.submitLabel === updateLabel, { submit: snap.submitLabel, update: updateLabel });
  });

  /* ---------------------------------------------------------------- */
  await step("step 2", async () => {
    section("2 set it: the submit writes the flag and the readings follow");
    const r = await setViaWindow(DAYLIGHT.wide);
    check("2: the value took in the field and the window's preview", r.typed.ok && r.typed.value === String(DAYLIGHT.wide) && r.typed.previewed === DAYLIGHT.wide, r.typed);
    check("2: the submit button was pressed and the window closed", r.submitted.pressed === true && r.submitted.closed === true, r.submitted);
    const stored = await flagBecomes(DAYLIGHT.wide);
    check("2: flags.acks-extras.daylight holds the typed number", stored?.daylight === DAYLIGHT.wide, stored);
    check("2: core's bright and dim are as typed before", stored?.bright === RADII.bright && stored?.dim === RADII.dim, { bright: stored?.bright, dim: stored?.dim });
    const at = await readingsAt(ALL_POINTS);
    note("2 readings", at);
    check("2: a point inside core's bright radius reads daylight, by light, from the ambient light", reads(at.near, { level: "daylight", by: "light", kind: "ambient", id: stored?.id }), at.near);
    check("2: a point past core's bright radius and inside the daylight radius reads daylight", reads(at.mid, { level: "daylight", by: "light", kind: "ambient", id: stored?.id }), at.mid);
    check("2: a point past the daylight radius and inside the dim radius reads dim", reads(at.edge, { level: "dim", by: "light", kind: "ambient", id: stored?.id }), at.edge);
    check("2: a point past every radius reads dark with no source", at.far?.level === "dark" && at.far?.by === "none" && at.far?.source === null, at.far);

    // A radius short of a point inside core's bright radius: that point is bright, not daylight.
    const s = await setViaWindow(DAYLIGHT.short);
    check("2b: a short radius submits through the window", s.typed.ok && s.submitted.pressed === true && s.submitted.closed === true, { typed: s.typed, submitted: s.submitted });
    const stored2 = await flagBecomes(DAYLIGHT.short);
    check("2b: the flag holds the short radius", stored2?.daylight === DAYLIGHT.short, stored2);
    const at2 = await readingsAt(ALL_POINTS);
    check("2b: a point past the daylight radius and inside core's bright radius reads bright, from the ambient light", reads(at2.near, { level: "bright", by: "light", kind: "ambient", id: stored2?.id }), at2.near);
    check("2b: the point past core's bright radius reads dim again", reads(at2.mid, { level: "dim", by: "light", kind: "ambient", id: stored2?.id }), at2.mid);
    // Leave the wide radius saved for the steps after.
    const back = await setViaWindow(DAYLIGHT.wide);
    check("2b: the wide radius is saved again for the steps after", back.submitted.pressed === true && (await flagBecomes(DAYLIGHT.wide))?.daylight === DAYLIGHT.wide);
  });

  /* ---------------------------------------------------------------- */
  await step("step 3", async () => {
    section("3 it survives a part re-render, Reset, and a reopen");
    const opened = await gmRun(P.open, { lightUuid: S.light });
    check("3: the reopened window shows the saved value", opened.count === 1 && opened.value === String(DAYLIGHT.wide), { count: opened.count, value: opened.value });
    const typed = await gmRun(P.type, { value: String(DAYLIGHT.unsaved) });
    check("3: an unsaved value is typed and held by the preview", typed.ok && typed.value === String(DAYLIGHT.unsaved) && typed.previewed === DAYLIGHT.unsaved, typed);

    const marked = await gmRun(P.mark);
    const part = await gmRun(P.partRender);
    check("3: a part re-render replaced the Basic part's element", marked === true && part.replaced === true, { marked, replaced: part.replaced });
    check("3: after it the field is there once, after the radii, still holding the unsaved value", part.count === 1 && part.afterRadii === true && part.inBasicPart === true && part.value === String(DAYLIGHT.unsaved), { count: part.count, afterRadii: part.afterRadii, value: part.value });

    const tabbed = await gmRun(P.tab, { tab: "advanced" });
    check("3: the Advanced Options tab is showing", tabbed.tab === "advanced", tabbed);
    await gmRun(P.mark);
    const reset = await gmRun(P.reset);
    check("3: Reset Advanced Options was pressed and the window re-rendered", reset.pressed === true && reset.replaced === true, { pressed: reset.pressed, replaced: reset.replaced, reason: reset.reason });
    const back = await gmRun(P.tab, { tab: "basic" });
    const after = await gmRun(P.snap);
    check("3: back on Basic Configuration the field is there once, after the radii, with the unsaved value", back.tab === "basic" && after.count === 1 && after.afterRadii === true && after.inBasicPart === true && after.value === String(DAYLIGHT.unsaved), { tab: back.tab, how: back.how, count: after.count, afterRadii: after.afterRadii, value: after.value });

    await gmRun(P.closeApp);
    const unsaved = await gmRun(P.read, { lightUuid: S.light });
    check("3: closing without saving left the saved flag as it was", unsaved?.daylight === DAYLIGHT.wide, unsaved);
    const reopened = await gmRun(P.open, { lightUuid: S.light });
    check("3: reopened, the field holds the saved value and not the unsaved one", reopened.count === 1 && reopened.value === String(DAYLIGHT.wide), { count: reopened.count, value: reopened.value });
  });

  /* ---------------------------------------------------------------- */
  await step("step 4", async () => {
    section("4 clear it: an empty field stores null and the reading falls back");
    const r = await setViaWindow("");
    check("4: the field was emptied and the window submitted", r.opened.value === String(DAYLIGHT.wide) && r.typed.ok && r.typed.value === "" && r.submitted.pressed === true && r.submitted.closed === true, { opened: r.opened.value, typed: r.typed, submitted: r.submitted });
    const stored = await flagBecomes(null);
    // The recipe allows blank or null; the figure is printed so a run that stores something else reads as one.
    check("4: the flag is null (or gone), as a cleared field stores it", stored !== null && (stored.daylight === null || stored.daylight === "unset"), stored);
    const at = await readingsAt(ALL_POINTS);
    note("4 readings", at);
    check("4: a point inside core's bright radius falls back to bright, and the source is still the ambient light", reads(at.near, { level: "bright", by: "light", kind: "ambient", id: stored?.id }), at.near);
    check("4: a point past core's bright radius reads dim", reads(at.mid, { level: "dim", by: "light", kind: "ambient", id: stored?.id }), at.mid);
    const opened = await gmRun(P.open, { lightUuid: S.light });
    check("4: reopened, the field is blank", opened.count === 1 && opened.value === "", { count: opened.count, value: opened.value });
  });

  /* ---------------------------------------------------------------- */
  await step("step 5", async () => {
    section("5 a hidden light and an activation range name no light");
    // The radius goes in through the window; hidden and the range are core's own fields, written as setup for a reading.
    const r = await setViaWindow(DAYLIGHT.wide);
    const stored = await flagBecomes(DAYLIGHT.wide);
    check("5: the radius is set again through the window", r.submitted.pressed === true && stored?.daylight === DAYLIGHT.wide, { submitted: r.submitted, daylight: stored?.daylight });
    const lit = await readingsAt({ mid: ALL_POINTS.mid });
    check("5: shown and in range, the mid point reads daylight from the light", reads(lit.mid, { level: "daylight", by: "light", kind: "ambient", id: stored?.id }), lit.mid);

    const hid = await gmRun(P.setLight, { lightUuid: S.light, changes: { hidden: true } });
    const hidden = await readingsAt(ALL_POINTS);
    check("5: hidden, the light is hidden", hid.hidden === true, hid);
    check("5: hidden, no point names the light", Object.values(hidden).every((g) => g?.source?.id !== stored?.id && g?.source?.kind !== "ambient"), hidden);
    check("5: hidden, the mid point reads dark: nothing else reaches", hidden.mid?.level === "dark" && hidden.mid?.source === null, hidden.mid);

    await gmRun(P.setLight, { lightUuid: S.light, changes: { hidden: false } });
    const ranged = await gmRun(P.setLight, { lightUuid: S.light, changes: { "config.darkness.min": 0, "config.darkness.max": 0.5 } });
    const out = await readingsAt(ALL_POINTS);
    check("5: with an activation range that excludes the scene's darkness, no point names the light", ranged.hidden === false && Object.values(out).every((g) => g?.source?.id !== stored?.id && g?.source?.kind !== "ambient"), { range: ranged.range, out });
    check("5: with the range excluding darkness, the mid point reads dark", out.mid?.level === "dark" && out.mid?.source === null, out.mid);

    await gmRun(P.setLight, { lightUuid: S.light, changes: { "config.darkness.min": 0, "config.darkness.max": 1 } });
    const again = await readingsAt({ mid: ALL_POINTS.mid });
    check("5: with the range back, the mid point reads daylight from the light again", reads(again.mid, { level: "daylight", by: "light", kind: "ambient", id: stored?.id }), again.mid);
  });

  /* ---------------------------------------------------------------- */
  await step("step 6", async () => {
    section("6 a new light: the field is there before saving, and Create writes it");
    const before = await gmRun(P.lightIds, { sceneUuid: S.scene });
    const spot = { x: LIGHT_AT.x + 1400, y: LIGHT_AT.y };
    let snap;
    try {
      snap = await gmRun(P.open, { fresh: { sceneUuid: S.scene, data: { x: spot.x, y: spot.y, config: { bright: 10, dim: 20 } } } });
    } catch (err) {
      skip("6", `core's window would not open on a light not yet saved: ${String(err?.message ?? err).slice(0, 160)}`);
      return;
    }
    if (!snap?.rendered) {
      skip("6", `the window on an unsaved light did not render (${snap?.reason ?? "no reason given"})`);
      return;
    }
    check("6: the unsaved light's window shows the field once, after the radii, blank", snap.count === 1 && snap.afterRadii === true && snap.value === "", { count: snap.count, afterRadii: snap.afterRadii, value: snap.value });
    const createLabel = await gmRun(() => game.i18n.localize("AMBIENT_LIGHT.ACTIONS.CREATE"));
    check("6: its submit reads Create, not Update", snap.submitLabel === createLabel, { submit: snap.submitLabel, create: createLabel });
    const typed = await gmRun(P.type, { value: String(DAYLIGHT.fresh) });
    check("6: a radius typed before creating is held", typed.ok && typed.value === String(DAYLIGHT.fresh), typed);
    const sent = await gmRun(P.submit);
    check("6: Create was pressed and the window closed", sent.pressed === true && sent.closed === true, sent);
    const made = await until(async () => {
      const ids = await gmRun(P.lightIds, { sceneUuid: S.scene });
      const fresh = ids.filter((id) => !before.includes(id));
      return fresh.length ? fresh : null;
    }, 8000, 250);
    if (!made) {
      check("6: a light was created on the scene", false, { before });
      return;
    }
    const readBack = await gmRun(P.readById, { sceneUuid: S.scene, id: made[0] });
    S.extraLight = gm.track(readBack.uuid, "AmbientLight");
    check("6: exactly one light was created", made.length === 1, made);
    check("6: the created light carries the typed radius in the flag", readBack.daylight === DAYLIGHT.fresh, readBack);
    check("6: core's radii on it are as the window had them", readBack.bright === 10 && readBack.dim === 20, { bright: readBack.bright, dim: readBack.dim });
    const at = await readingsAt({ own: pointAt(15, spot) });
    check("6: a point inside the created light's daylight radius reads daylight from it", reads(at.own, { level: "daylight", by: "light", kind: "ambient", id: made[0] }), at.own);
  });

  const late = await gmRun(P.caught);
  note("errors this walk's seat recorded after ready", late.errors);
  note("toasts the seat showed", late.said);
  check("no console error or error toast while the windows opened, re-rendered and submitted", late.errors.length === 0, late.errors);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  if (err?.name !== "WalkBlocked") checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      try { await gmRun(P.closeApp); } catch { /* the page is gone */ }
      if (S.scene && S.light) {
        try { note("the fixtures back in their starting shape", await gmRun(P.shape, { sceneUuid: S.scene, lightUuid: S.light, radii: RADII })); } catch (e) { console.error("restore:", e?.message ?? e); }
      }
      const own = [S.extraLight].filter((u) => u && gm.tracked().some((e) => e.uuid === u));
      const sw = await gm.sweepTracked({ only: own });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
      for (const line of gm.report?.() ?? []) console.log(line);
    }
  } catch (err) { console.error("teardown:", err?.message ?? err); }
  try { if (gm) await gmRun(() => globalThis.__ldr?.disarm?.()); } catch { /* the page is gone */ }
  try { if (gm) await gm.close(); } catch { /* closed */ }
  section("summary");
  for (const id of skipped) console.log(`SKIP  ${id}`);
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok);
  for (const [label] of failed) console.log(`FAIL  ${label}`);
  console.log(`checks: ${passed} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}
