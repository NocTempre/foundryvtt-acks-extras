/**
 * Live walk, lib/aura-presses: the presses on the sheets' item rows, the Token
 * HUD, the group sheet's stack-row press, the "and n more" strip, the reach
 * glyph and the item sheet's effect rows with the editor's reach group, on the GM
 * seat and a real Player seat together. Walks docs/lib/TESTING.md, "S8b-2: the
 * presses, the HUD, the glyph and an item's effect rows", steps W1 to W8. Machine
 * values arrive through ./_env.mjs. Both seats reload under a load recorder added
 * before the page's first script, so what `init`, `setup` and `ready` log is read
 * on each. Written from the code; the walker session that runs it first reads
 * what it prints.
 *
 * Every gate asserted is Foundry's own: an item's `isOwner`, the effect-row
 * store's `editable()`, and for the stack row `canDeploy` (the group's owner with
 * the TOKEN_CREATE permission). The walk reads the Player's Create Tokens and
 * never changes it, and asserts no role test.
 *
 * The figures a reach names are invented and registered for this run under the
 * document `live-aura-presses` (the registry's override layer, on both seats).
 * W3 and W4 read what the importer wrote instead: the stack row is built from
 * an imported equipment row, and the engaged bearers are T10's fixtures. With
 * no such import the step is held and the walk ends WALK BLOCKED after the steps
 * that could run; a held step is never a skip that reads as done.
 *
 * Fixtures, kept and found by marker (`api.fixture`):
 *   the scene `lib/aura-cards-scene` (found, or built from the cards walk's own
 *   data) and `lib/aura-press-scene-2` (a second scene, so a stack's carrier can
 *   stand "elsewhere");
 *   monsters `lib/aura-press-monster` (the bearer; the Player has no ownership
 *   but what a step gives it) and `lib/aura-press-source` (the stack's base);
 *   the character `lib/aura-press-char` (owned by the Player seat);
 *   items `lib/aura-press-monster-toggle`, `lib/aura-press-monster-once` (on the
 *   monster), `lib/aura-press-item` (the toggle item on the character) and
 *   `lib/aura-press-char-once` (a once-only item of quantity one on it);
 *   tokens `lib/aura-press-monster-token` and `lib/aura-press-char-token`;
 *   the group `lib/aura-press-group` and the location `lib/aura-press-place`
 *   (carrying `system.gmNotes`, so the empty-place prune leaves it).
 * W4 finds T10's `lib/aura-t10-*` fixtures and builds none of them.
 * Each step writes the shape it needs at its start: items lowered and not used
 * up, the bodies placed, the scene viewed, the ownership the step needs, read
 * back in the seat's own page, and the group's stack rewritten. Nothing is
 * rolled back at the end.
 *
 * The run's own products are tracked and swept by id: the bodies the stack-row
 * press sent out, the cards its two pages posted that name a fixture item or an
 * item of a body it sent out, the Combat W4 makes and any Region made during the
 * run. The fixtures stay.
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
const holds = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const skip = (step, reason) => {
  skipped.push(step);
  console.log(`SKIP ${step}: ${reason}`);
};
/** A step the world cannot serve: recorded, and the walk ends WALK BLOCKED once the steps that can run have. */
const hold = (step, reason) => {
  holds.push(`${step}: ${reason}`);
  console.log(`HELD ${step}: ${reason}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The module whose flags the fixtures carry. */
const MOD = "acks-extras";
/** The registry document and table this walk's invented figures live in, and the rows it names. */
const DOC = "live-aura-presses";
const TABLE = "figures";
const FIGURES = Object.freeze({
  standing: { radius: 30, bonus: 1 },
  once: { radius: 30, damage: 2 },
});
/** The viewport knob the narrow-window step raises, in px, and the width it asks for. */
const RAISED_BASE_PX = 22;
const NARROW = 320;
/** Where the bearer and the bodies stand: inside the bearer's ring, and well outside it. */
const SPOT = Object.freeze({ bearer: [300, 300], inside: [400, 300], outside: [1700, 1350] });
/** The cards walk's scene, whose data this walk reuses where it must build the scene itself. */
const SCENE_DATA = (name) => ({ name, width: 2000, height: 1400, padding: 0, grid: { size: 100, distance: 5, units: "ft", type: 1 } });

/** A figure reference as `gear-run.mjs` writes one. */
const ref = (row, figure) => ({ doc: DOC, table: TABLE, row, figure });
const filterOf = () => ({ kinds: [], exceptKinds: [], side: "any", unit: "any", self: "no" });
const shapes = {
  /** A toggle whose reach holds a part on armour class, attack and morale for whoever stands inside it. */
  standing: ({ showReach = false } = {}) => ({
    kind: "toggle", cookbook: { id: "walk.aura-presses.standing", cite: "Aura Presses ref S" },
    rows: [{ key: "reach", type: "modifier", reach: { radius: ref("standing", "radius"), modifier: ref("standing", "bonus"), on: ["ac", "attack", "morale"], filter: filterOf(), pulse: "standing", showReach }, }],
  }),
  /** A once-only use, a damage part that ends with the next attack. */
  once: () => ({
    kind: "once", cookbook: { id: "walk.aura-presses.once", cite: "Aura Presses ref O" },
    rows: [{ key: "reach", type: "modifier", reach: { radius: ref("once", "radius"), modifier: ref("once", "damage"), on: ["damage"], filter: filterOf(), pulse: "action", showReach: false }, endsOn: ["attack"] }],
  }),
};
const itemData = (name, shape) => {
  const s = shapes[shape]();
  return {
    name, type: "item",
    system: { description: "", subtype: "item", quantity: 1, cost: 0, weight: 0, weight6: 0 },
    flags: { [MOD]: { cookbook: s.cookbook, itemRun: { activation: { kind: s.kind, state: { active: false, activationId: "", regionId: "" } }, rows: s.rows } } },
  };
};

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__auraBoot = { phase: "load", phases: [], errors: [] });
  const push = (kind, text) => R.errors.push({ phase: R.phase, kind, text: String(text).slice(0, 300) });
  const error = console.error.bind(console);
  console.error = (...args) => { push("console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
  addEventListener("error", (e) => push("error", e.message));
  addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
  }, 2);
})()`;

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

/** Reload one seat's page under the load recorder, which a second DevTools session adds to every new document. */
async function reloadRecorded(api, port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next;
    const on = (event) => { const reply = JSON.parse(event.data); if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api);
  ws.close();
  return seconds;
}

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page,  */
/*  so none names a value of this file.                                */
/* ------------------------------------------------------------------ */
const P = {
  userId: (name) => game.users.find((u) => u.name === name)?.id ?? null,

  /** Arm the recorders and helpers every later call uses on this seat, and register the invented figures; replaces an earlier install in this page. */
  install: async ({ doc, table, figures }) => {
    globalThis.__lap?.disarm?.();
    const H = (globalThis.__lap = {});
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
    H.cards = [];
    // A monster's default sheet is lib's Follower Card, which draws neither item rows nor the reach strip; both live on the Full Monster sheet, opened as itself on a fresh instance kept per actor.
    H.kept = {};
    H.sheetOf = (uuid) => {
      const doc = fromUuidSync(uuid);
      if (doc?.type !== "monster") return doc?.sheet;
      if (!H.kept[uuid]) {
        const Full = Object.values(CONFIG.Actor.sheetClasses.monster ?? {}).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
        if (Full) H.kept[uuid] = new Full({ document: doc });
      }
      return H.kept[uuid] ?? doc.sheet;
    };
    H.closeSheet = async (uuid) => {
      try { await H.kept[uuid]?.close({ animate: false }); } catch { /* closed */ }
      delete H.kept[uuid];
      try { await fromUuidSync(uuid)?.sheet?.close({ animate: false }); } catch { /* closed */ }
    };
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
    const CM = foundry.documents.ChatMessage;
    const cmHad = Object.hasOwn(CM, "createDocuments");
    const cmOriginal = CM.createDocuments;
    CM.createDocuments = async function (...args) {
      const docs = await cmOriginal.apply(this, args);
      for (const d of docs ?? []) if (d?.uuid && !H.cards.includes(d.uuid)) H.cards.push(d.uuid);
      return docs;
    };
    H.knob = document.documentElement.style.getPropertyValue("--acks-fs-base");
    H.disarm = () => {
      for (const fn of undo) fn();
      console.error = consoleError;
      window.removeEventListener("unhandledrejection", onReject);
      if (cmHad) CM.createDocuments = cmOriginal; else delete CM.createDocuments;
      if (H.knob) document.documentElement.style.setProperty("--acks-fs-base", H.knob);
      else document.documentElement.style.removeProperty("--acks-fs-base");
    };
    /** The activation record an item carries, read off its flag. */
    H.run = (item) => item?.flags?.["acks-extras"]?.itemRun ?? null;
    /** The editor window open on an item's rows, at an index where one is given. */
    H.editor = (itemUuid, index = null) => [...foundry.applications.instances.values()].find((a) => a.rendered && typeof a.store?.key === "string" && a.store.key.startsWith(itemUuid) && (index === null || a.index === index)) ?? null;
    H.pressLabel = (key) => game.i18n.localize(`ACKS-LIB.itemRun.row.press.${key}`);

    const T = acksExtras.lib.tables;
    T.registerTable({ id: doc, source: "invented", tables: { [table]: figures } }, { priority: T.PRIORITY.OVERRIDE + 1, source: "live-test" });
    const read = Object.fromEntries(Object.entries(figures).map(([row, f]) => [row, Object.fromEntries(Object.keys(f).map((k) => [k, T.getDoc(doc).tables?.[table]?.[row]?.[k] ?? null]))]));
    try {
      if (!ui.chat?.rendered) { await ui.hotbar?.render?.({ force: true }); await ui.chat.render({ force: true }); }
    } catch { /* the walk finds out when it looks for a card */ }
    return { user: game.user.name, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, extras: game.modules.get("acks-extras")?.version, lib: acksExtras.lib.apiVersion, read, canCreateTokens: game.user.can("TOKEN_CREATE") };
  },

  /** What this seat's recorders caught since the install. */
  caught: () => ({ errors: globalThis.__lap?.errors ?? [], boot: globalThis.__auraBoot ?? null, said: (globalThis.__lap?.said ?? []).map((s) => `${s.kind}: ${s.text}`.slice(0, 200)) }),
  said: () => (globalThis.__lap?.said ?? []).map((s) => `${s.kind}: ${s.text}`.slice(0, 200)),

  /** The seat's view of the scene; a Player may or may not switch scenes itself, and the walk says which. */
  view: async ({ sceneUuid }) => {
    const H = globalThis.__lap;
    const scene = fromUuidSync(sceneUuid);
    if (!scene) return { viewing: false, reason: "no scene" };
    let threw = null;
    if (canvas.scene?.id !== scene.id) {
      try { await scene.view(); } catch (e) { threw = String(e?.message ?? e); }
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 12000);
    }
    return { viewing: canvas.scene?.id === scene.id, threw, isGM: game.user.isGM };
  },

  /** The seat's own reading of an ownership level on a document, by the page's own client. */
  levelOf: ({ uuid }) => {
    const doc = fromUuidSync(uuid);
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    return { owner: doc?.testUserPermission?.(game.user, "OWNER") === true, observer: doc?.testUserPermission?.(game.user, "OBSERVER") === true, isOwner: doc?.isOwner === true, limited: doc?.testUserPermission?.(game.user, L.LIMITED) === true };
  },

  /** Write an ownership map onto documents (the GM seat). Answers what each read back as for the user. */
  own: async ({ writes, playerId }) => {
    const out = {};
    for (const w of writes) {
      const doc = fromUuidSync(w.uuid);
      await doc.update({ ownership: { default: 0, [playerId]: w.level } });
      out[w.uuid] = doc.ownership?.[playerId] ?? null;
    }
    await globalThis.__lap.sleep(400);
    return out;
  },

  /** Bring the fixtures to the shape a step starts from. */
  reset: async ({ view, items, tokens, clear, regionsOf }) => {
    const H = globalThis.__lap;
    const out = { regions: 0, effects: 0, warnings: [], viewing: null };
    if (view) {
      const scene = fromUuidSync(view);
      if (canvas.scene?.id !== scene.id) { await scene.view(); await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 15000); }
      out.viewing = canvas.scene?.id === scene.id;
    }
    for (const tokenUuid of regionsOf) {
      for (const r of [...(fromUuidSync(tokenUuid)?.attachments?.regions ?? [])]) {
        if ([...r.behaviors].some((b) => b.type === "acks-extras.aura")) { await r.delete(); out.regions += 1; }
      }
    }
    if (out.regions) await H.sleep(700);
    for (const uuid of clear) {
      const actor = fromUuidSync(uuid);
      const ids = [...(actor?.effects ?? [])].filter((e) => e.flags?.["acks-extras"]?.itemRun).map((e) => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { "acks-extras": { managedDelete: true } });
      out.effects += ids.length;
    }
    for (const s of items) {
      const item = fromUuidSync(s.uuid);
      if (!item) { out.warnings.push(`no item ${s.uuid}`); continue; }
      await item.update({
        "flags.acks-extras.itemRun.rows": s.rows,
        "flags.acks-extras.itemRun.activation": { kind: s.kind, state: { active: false, activationId: "", regionId: "" } },
        "flags.acks-extras.cookbook": s.cookbook,
        "system.quantity": 1,
      });
    }
    for (const t of tokens) await fromUuidSync(t.uuid).update({ x: t.x, y: t.y, hidden: false, disposition: t.disposition }, { animate: false });
    await H.sleep(500);
    return out;
  },

  /** Use an item (a toggle raises or lowers, a once spends) and wait for it to settle. */
  use: async ({ itemUuid }) => {
    const H = globalThis.__lap;
    const item = fromUuidSync(itemUuid);
    await item.use();
    await H.sleep(900);
    const run = H.run(item);
    return { kind: run?.activation?.kind ?? null, active: run?.activation?.state?.active === true, activationId: run?.activation?.state?.activationId || null, quantity: item.system?.quantity ?? null };
  },

  /** An item's stored state, read fresh. */
  itemRead: ({ uuid }) => {
    const item = fromUuidSync(uuid);
    const run = globalThis.__lap.run(item);
    return { active: run?.activation?.state?.active === true, kind: run?.activation?.kind ?? null, activationId: run?.activation?.state?.activationId || null, quantity: item?.system?.quantity ?? null, rows: foundry.utils.deepClone(run?.rows ?? []), activation: foundry.utils.deepClone(run?.activation ?? null) };
  },

  /** The aura Regions attached to a token. */
  regionsOn: ({ tokenUuid }) => [...(fromUuidSync(tokenUuid)?.attachments?.regions ?? [])]
    .filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura"))
    .map((r) => ({ uuid: r.uuid, visibility: r.visibility })),
  /** Every aura Region on a scene (uuid only), for the ledger of what the run made. */
  regionUuids: ({ sceneUuid }) => [...(fromUuidSync(sceneUuid)?.regions ?? [])].filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura")).map((r) => r.uuid),
  visibilityModes: () => ({ ...CONST.REGION_VISIBILITY }),
  /** How many cards carry an activation id. */
  cardsFor: ({ aid }) => game.messages.filter((m) => m.flags?.["acks-extras"]?.itemRunCard?.activationId === aid).map((m) => m.id),

  /** Move tokens (by uuid) and wait for the region events to land. */
  move: async ({ moves, ms = 1500 }) => {
    for (const m of moves) await fromUuidSync(m.uuid).update({ x: m.x, y: m.y }, { animate: false });
    await globalThis.__lap.sleep(ms);
    return true;
  },

  /* ---- the sheets' rows ---- */

  /** Render an actor's sheet and show a tab. */
  openSheet: async ({ uuid, tab }) => {
    const H = globalThis.__lap;
    await H.closeSheet(uuid);
    const sheet = H.sheetOf(uuid);
    await sheet.render({ force: true });
    await H.until(() => sheet.rendered && sheet.element, 8000);
    let changed = null;
    if (tab) { try { await sheet.changeTab(tab, "primary", { force: true }); changed = true; } catch (e) { changed = String(e?.message ?? e); } }
    await H.sleep(700);
    return { rendered: !!sheet.rendered, sheet: sheet.constructor.name, changed };
  },
  closeSheet: async ({ uuid }) => { await globalThis.__lap.closeSheet(uuid); return true; },

  /** What an item's row says on an open actor sheet: the model, and the DOM's tags and presses. */
  rowRead: async ({ actorUuid, itemUuid }) => {
    const V = await import("/modules/acks-extras/scripts/lib/item-run-row-view.mjs");
    const item = fromUuidSync(itemUuid);
    const model = V.itemRunRowFor(item);
    const el = globalThis.__lap.sheetOf(actorUuid)?.element;
    const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    const buttons = [...(el?.querySelectorAll?.('button[data-action="itemRunPress"], button[data-action="itemRunCard"]') ?? [])].map((b) => ({ action: b.dataset.action, press: b.dataset.press ?? null, uuid: b.dataset.itemUuid ?? "", label: b.getAttribute("aria-label") ?? "", disabled: b.getAttribute("aria-disabled") === "true" }));
    const tags = [...(el?.querySelectorAll?.(".acks-extras-run") ?? [])].map((r) => ({ state: r.dataset.runState ?? "", tag: txt(r.querySelector(".acks-tag")) }));
    return { model: model ? { state: model.state, presses: model.presses.map((p) => ({ key: p.key, disabled: p.disabled })) } : null, buttons: buttons.filter((b) => b.uuid === itemUuid), allButtons: buttons.length, tags };
  },

  /** Press a row's control on an open actor sheet by clicking its button; false where it is not drawn or is off. */
  press: ({ actorUuid, itemUuid, key }) => {
    const H = globalThis.__lap;
    const el = H.sheetOf(actorUuid)?.element;
    const want = key === "card" ? "itemRunCard" : "itemRunPress";
    const label = H.pressLabel(key);
    const b = [...(el?.querySelectorAll?.(`button[data-action="${want}"]`) ?? [])].find((x) => x.dataset.itemUuid === itemUuid && (key === "card" || x.dataset.press === key || (x.getAttribute("aria-label") ?? "").startsWith(label)));
    if (!b || b.getAttribute("aria-disabled") === "true") return false;
    b.click();
    return true;
  },

  /** Wait until an item's stored state satisfies a predicate on `active` or `quantity`. */
  waitItem: async ({ uuid, active = null, quantity = null, ms = 9000 }) => {
    const H = globalThis.__lap;
    const ok = await H.until(() => {
      const item = fromUuidSync(uuid);
      const run = H.run(item);
      return (active === null || (run?.activation?.state?.active === true) === active) && (quantity === null || item?.system?.quantity === quantity);
    }, ms, 200);
    await H.sleep(400);
    return !!ok;
  },

  /* ---- the Token HUD ---- */

  /** Open the HUD on a token and read its item controls. */
  hud: async ({ tokenUuid }) => {
    const H = globalThis.__lap;
    const tok = fromUuidSync(tokenUuid)?.object;
    if (!tok) return { ok: false, reason: "no token on this seat's canvas" };
    let controlled = null;
    try { tok.control({ releaseOthers: true }); controlled = tok.controlled === true; } catch { controlled = false; }
    const bind = canvas.hud.bind ? canvas.hud : canvas.hud.token;
    await bind.bind(tok);
    const hud = canvas.hud.token;
    await H.until(() => hud.rendered && hud.element, 6000);
    await H.sleep(500);
    const controls = [...(hud.element?.querySelectorAll?.(".acks-extras-item-hud") ?? [])].map((b) => ({ label: b.getAttribute("aria-label") ?? "", active: b.classList.contains("active"), pressed: b.getAttribute("aria-pressed"), tip: b.dataset.tooltip ?? null, src: b.querySelector("img")?.getAttribute("src") ?? "" }));
    return { ok: true, controlled, controls };
  },
  hudClick: async ({ index }) => {
    const H = globalThis.__lap;
    const hud = canvas.hud.token;
    const b = [...(hud.element?.querySelectorAll?.(".acks-extras-item-hud") ?? [])][index];
    if (!b) return false;
    b.click();
    await H.sleep(1200);
    return true;
  },
  hudClose: () => { try { canvas.hud.clear(); } catch { /* none open */ } return true; },

  /* ---- the card button ---- */

  /** The id of the raised card posted for an activation, and whether this seat's open chat log holds it. */
  cardIn: ({ aid }) => {
    const m = game.messages.find((x) => x.flags?.["acks-extras"]?.itemRunCard?.activationId === aid);
    return { id: m?.id ?? null, inLog: !!(m && ui.chat?.element?.querySelector?.(`[data-message-id="${m.id}"]`)) };
  },
  deleteMessage: async ({ id }) => { await game.messages.get(id)?.delete(); await globalThis.__lap.sleep(500); return !game.messages.get(id); },

  /* ---- the group's stack row ---- */

  /** The imported equipment row a stack's gen.carry can name: the first whose minted item the carrier runs, a toggle by preference. Kind and cookbook id only. */
  carryRow: async () => {
    const O = await import("/modules/acks-extras/scripts/monsters/organisation.mjs");
    const org = O.importedOrganisation();
    let once = null;
    for (const row of org?.equipment?.rows ?? []) {
      for (const item of O.carriedGearItems(row.key, org) ?? []) {
        const kind = item?.flags?.["acks-extras"]?.itemRun?.activation?.kind;
        const found = { key: row.key, kind, cookbookId: item?.flags?.["acks-extras"]?.cookbook?.id ?? "" };
        if (kind === "toggle") return found;
        if (kind === "once" && !once) once = found;
      }
    }
    return once;
  },
  /** Rewrite the group's stacks to one stack of `count` bodies, built from a source actor, carrying `share` of the row. */
  stackSetup: async ({ groupUuid, sourceUuid, rowKey, count, share }) => {
    const G = await import("/modules/acks-extras/scripts/lib/group.mjs");
    const group = fromUuidSync(groupUuid);
    await group.update({ "system.stacks": [] });
    const key = await G.addStack(group, fromUuidSync(sourceUuid), { count, gen: { part: "walk", cite: "", carry: { [rowKey]: share } } });
    return { key, stacks: group.system.stacks?.length ?? 0 };
  },
  /** Change the share the stack records for a row. */
  stackShare: async ({ groupUuid, rowKey, share }) => {
    const group = fromUuidSync(groupUuid);
    const stacks = group.system.toObject().stacks;
    stacks[0].gen.carry = { [rowKey]: share };
    await group.update({ "system.stacks": stacks });
    return true;
  },
  /** Render the group sheet and read the first stack row's controls. */
  groupRead: async ({ groupUuid }) => {
    const H = globalThis.__lap;
    const group = fromUuidSync(groupUuid);
    const sheet = group.sheet;
    await sheet.render({ force: true });
    await H.until(() => sheet.rendered && sheet.element, 8000);
    await H.sleep(700);
    const row = sheet.element?.querySelector?.(".acks-lib-group-stack");
    const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    const controls = [...(row?.querySelectorAll?.(".stack-control") ?? [])].map((c) => {
      const b = c.querySelector(".stack-control-press");
      return { line: txt(c.querySelector(".stack-control-line")), lineTip: c.querySelector(".stack-control-line")?.dataset.tooltipText ?? "", press: !!b, label: txt(b), key: b?.dataset.controlKey ?? null, disabled: b?.getAttribute("aria-disabled") === "true" };
    });
    return { rendered: !!sheet.rendered && !!row, controls, canDeploy: group.isOwner === true && game.user.can("TOKEN_CREATE") };
  },
  groupClick: async ({ groupUuid, key }) => {
    const H = globalThis.__lap;
    const b = fromUuidSync(groupUuid).sheet.element?.querySelector?.(`.stack-control-press[data-control-key="${key}"]`);
    if (!b || b.getAttribute("aria-disabled") === "true") return false;
    b.click();
    await H.sleep(2500);
    return true;
  },
  /** The first stack's roster as the group holds it, with where each body's token is and what its item reads. */
  stackRead: ({ groupUuid, cookbookId }) => {
    const group = fromUuidSync(groupUuid);
    const stack = group.system.stacks?.[0];
    return (stack?.roster ?? []).map((m) => {
      const token = m.tokenUuid ? fromUuidSync(m.tokenUuid) : null;
      const item = token?.actor ? [...token.actor.items].find((i) => i.flags?.["acks-extras"]?.cookbook?.id === cookbookId) : null;
      const run = item?.flags?.["acks-extras"]?.itemRun;
      return { key: m.key, state: m.state, carries: [...(m.carries ?? [])], tokenUuid: m.tokenUuid ?? "", tokenHere: !!token && token.parent?.id === game.scenes.viewed?.id, itemUuid: item?.uuid ?? "", active: run?.activation?.state?.active === true, quantity: item?.system?.quantity ?? null };
    });
  },
  /** The lib's own press on a stack row, called in this page where a seat that may not press draws no button. */
  groupPressApi: async ({ groupUuid, stackKey, key }) => {
    const G = await import("/modules/acks-extras/scripts/lib/group.mjs");
    const out = await G.pressStackRowControl(fromUuidSync(groupUuid), stackKey, key);
    return { answered: out === undefined ? "undefined" : "value" };
  },

  /* ---- the glyph ---- */

  /** The glyph on a token of this seat's canvas, and what it was built from. */
  glyph: async ({ tokenUuid }) => {
    const L = await import("/modules/acks-extras/scripts/lib/reach-glyph-logic.mjs");
    const tok = fromUuidSync(tokenUuid)?.object;
    if (!tok) return { canvas: false };
    const g = tok.children?.find((c) => c?.name === L.REACH_GLYPH_NAME && !c.destroyed) ?? null;
    if (!g) return { canvas: true, has: false };
    const ui = canvas.dimensions?.uiScale ?? 1;
    const slot = L.glyphSlot({ w: tok.w, h: tok.h, ui });
    const texture = g.icon?.texture;
    const src = texture?.baseTexture?.cacheId ?? texture?.baseTexture?.resource?.src ?? texture?.textureCacheIds?.[0] ?? "";
    return { canvas: true, has: true, onToken: g.parent === tok, inEffects: !!tok.effects?.children?.includes?.(g), slotOk: Math.abs(g.icon.x - slot.x) < 1 && Math.abs(g.icon.y - slot.y) < 1 && Math.abs(g.icon.width - slot.size) < 1, aura: String(src).includes("aura.svg"), src: String(src).slice(-40) };
  },
  /** Hover a token as the pointer would, and read the readout's text. The handler is called directly where the pointer cannot be scripted. */
  hover: async ({ tokenUuid, on }) => {
    const H = globalThis.__lap;
    const L = await import("/modules/acks-extras/scripts/lib/reach-glyph-logic.mjs");
    const tok = fromUuidSync(tokenUuid)?.object;
    if (!tok) return { ok: false };
    let how = "pointer handler";
    try {
      if (on) tok._onHoverIn(new Event("pointerover"), { hoverOutOthers: false });
      else tok._onHoverOut(new Event("pointerout"));
    } catch {
      how = "hoverToken hook";
      Hooks.callAll("hoverToken", tok, on);
    }
    await H.sleep(300);
    const g = tok.children?.find((c) => c?.name === L.REACH_GLYPH_NAME && !c.destroyed) ?? null;
    const t = g?.readout && !g.readout.destroyed ? String(g.readout.text ?? "") : null;
    return { ok: true, how, text: t };
  },
  /** The model half of the glyph's seat test: how many of a Region's reaches the seat is shown at a visibility. */
  shown: async ({ visibility, isGM }) => {
    const L = await import("/modules/acks-extras/scripts/lib/reach-glyph-logic.mjs");
    return L.shownReaches([{ region: { visibility }, behavior: {} }], { isGM, observes: () => false }).length;
  },

  /* ---- the strip ---- */

  /** The engaged row an actor's always-on item holds: the kinds it names, read for the subject's filter. */
  engagedKinds: (a) => {
    const R = acksExtras.lib.itemRun.logic;
    for (const item of fromUuidSync(a.uuid)?.items ?? []) {
      if (!R.alwaysOn(item)) continue;
      for (const row of R.itemRunRowsOf(item)) if (row?.reach?.engaged === true) return [...(row.reach.filter?.kinds ?? [])];
    }
    return null;
  },
  /** The kept fixtures T10 left, by marker: actors and tokens. */
  t10: ({ markers, tokenMarkers }) => {
    const out = {};
    for (const [role, marker] of Object.entries(markers)) {
      const a = game.actors.contents.filter((x) => x.flags?.world?.fixture === marker);
      out[role] = a.length === 1 ? a[0].uuid : null;
    }
    const scenes = game.scenes.contents.filter((s) => s.flags?.world?.fixture === markers.scene);
    out.scene = scenes.length === 1 ? scenes[0].uuid : null;
    if (out.scene) {
      for (const role of ["U1", "U2", "S"]) {
        const t = fromUuidSync(out.scene).tokens.contents.filter((x) => x.flags?.world?.fixture === tokenMarkers[role]);
        out[`${role}Token`] = t.length === 1 ? t[0].uuid : null;
      }
    }
    return out;
  },
  /** Begin a combat the way the tracker's round write does, and wait for the engaged Regions. */
  fight: async ({ combatId, rows, inits, tokenId, want }) => {
    const H = globalThis.__lap;
    const combat = game.combats.get(combatId);
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    await combat.updateEmbeddedDocuments("Combatant", Object.keys(rows).map((k) => ({ _id: rows[k], initiative: inits[k], defeated: false, hidden: false })));
    combat.setupTurns();
    if (!combat.active && typeof combat.activate === "function") await combat.activate();
    const turn = combat.turns.findIndex((t) => t.tokenId === tokenId);
    await combat.update({ round: 1, turn: Math.max(0, turn) });
    const L = acksExtras.lib.auraReach.logic;
    const count = () => [...combat.scene.regions].filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura" && L.isEngagedActivation(b.system?.activationId))).length;
    const got = await H.until(() => (count() >= want ? count() : null), 15000, 600);
    return { regions: got ?? count() };
  },
  /** An open actor sheet's "In reach of" strip: its rows, the "more" span and its tooltip. */
  strip: async ({ uuid }) => {
    const H = globalThis.__lap;
    const sheet = H.sheetOf(uuid);
    await sheet.render({ force: true });
    await H.until(() => sheet.rendered && sheet.element, 8000);
    await H.sleep(900);
    const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    const rows = [...(sheet.element?.querySelectorAll?.(".acks-extras-reach-strip__row") ?? [])].map((r) => ({ more: txt(r.querySelector(".acks-extras-reach-strip__more")), moreTip: r.querySelector(".acks-extras-reach-strip__more")?.dataset.tooltipText ?? "" }));
    return { has: !!sheet.element?.querySelector?.(".acks-extras-reach-strip"), rows };
  },
  moreWord: ({ n }) => game.i18n.format("ACKS-LIB.itemRun.strip.more", { n }),

  /* ---- the item sheet's effect rows and the editor ---- */

  /** Render an item's sheet and read its effect-rows group. */
  itemSheet: async ({ uuid }) => {
    const H = globalThis.__lap;
    const item = fromUuidSync(uuid);
    await item.sheet.render({ force: true });
    await H.until(() => item.sheet.rendered && item.sheet.element?.querySelector?.(".acks-extras-gear-rows"), 8000);
    await H.sleep(500);
    const root = item.sheet.element;
    const groups = [...(root?.querySelectorAll?.(".acks-extras-gear-rows") ?? [])];
    const g = groups[0] ?? null;
    const n = (sel) => g?.querySelectorAll(sel).length ?? 0;
    return { groups: groups.length, tab: g?.closest("[data-tab]")?.dataset.tab ?? null, rows: n(".acks-extras-gear-rows__row"), add: n('[data-gear-rows="add"]'), edit: n('[data-gear-rows="edit"]'), del: n('[data-gear-rows="delete"]') };
  },
  /** Press the group's Add row, wait for the editor, and answer the new row's index. */
  addRow: async ({ uuid }) => {
    const H = globalThis.__lap;
    const item = fromUuidSync(uuid);
    const before = H.run(item)?.rows?.length ?? 0;
    item.sheet.element.querySelector('[data-gear-rows="add"]')?.click();
    const ed = await H.until(() => H.editor(uuid, before), 8000);
    await H.sleep(500);
    return { index: before, opened: !!ed, rows: H.run(item)?.rows?.length ?? 0 };
  },
  /** Open an existing row's editor from the group's Edit control. */
  editRow: async ({ uuid, index }) => {
    const H = globalThis.__lap;
    const item = fromUuidSync(uuid);
    for (const app of [...foundry.applications.instances.values()]) if (typeof app.store?.key === "string" && app.store.key.startsWith(uuid)) await app.close({ animate: false });
    const edit = await H.until(() => item.sheet.element?.querySelector(`[data-gear-rows="edit"][data-index="${index}"]`), 6000);
    edit?.click();
    const ed = await H.until(() => H.editor(uuid, index), 8000);
    await H.sleep(600);
    return { opened: !!ed };
  },
  /** The reach group's controls on an open editor. */
  editorRead: ({ uuid, index }) => {
    const ed = globalThis.__lap.editor(uuid, index);
    const el = ed?.element;
    if (!el) return { open: false };
    const fs = el.querySelector("fieldset.acks-extras-effect-reach");
    const use = el.querySelector("[data-acks-extras-item-use]");
    const names = (p) => [...el.querySelectorAll(`input[type="checkbox"][name^="${p}"]`)].map((i) => i.name.slice(p.length));
    return {
      open: true, group: !!fs, fieldsetDisabled: fs?.disabled === true,
      use: use ? { value: use.value, disabled: use.disabled, tip: use.closest(".form-group")?.dataset.tooltipText ?? "" } : null,
      mode: el.querySelector('[name="reach.mode"]')?.value ?? null, side: el.querySelector('[name="reach.side"]')?.value ?? null,
      showReach: el.querySelector('[name="reach.showReach"]')?.checked ?? null,
      kindNames: names("reach.kinds."), exceptNames: names("reach.exceptKinds."),
      readonly: [...el.querySelectorAll(".acks-extras-effect-readonly")].map((o) => o.tagName.toLowerCase()),
    };
  },
  /** Change one control on an open editor as a user would and let its form submit; answers the stored row and activation. */
  editorSet: async ({ uuid, index, selector, value = null, checked = null }) => {
    const H = globalThis.__lap;
    const el = H.editor(uuid, index)?.element;
    const target = el?.querySelector(selector);
    if (!target) return { ok: false, reason: "no control" };
    if (checked !== null) target.checked = checked;
    else target.value = value;
    target.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(900);
    const run = H.run(fromUuidSync(uuid));
    return { ok: true, row: foundry.utils.deepClone(run?.rows?.[index] ?? null), activation: foundry.utils.deepClone(run?.activation ?? null) };
  },
  /** Write an item's raised state straight (the editor holds the use select while it reads raised), without raising a Region. */
  setRaisedFlag: async ({ uuid, active }) => {
    await fromUuidSync(uuid).update({ "flags.acks-extras.itemRun.activation.state.active": active });
    await globalThis.__lap.sleep(500);
    return true;
  },
  /** The editor a seat that may not write opens through the store, and what its control does on a change. */
  readOnlyEditor: async ({ uuid, index }) => {
    const H = globalThis.__lap;
    const E = await import("/modules/acks-extras/scripts/lib/apps/effect-row-editor.mjs");
    const S = await import("/modules/acks-extras/scripts/lib/gear-effect-rows.mjs");
    const item = fromUuidSync(uuid);
    const store = S.gearEffectStore(item);
    const editable = store.editable();
    E.openEffectEditor(store, index);
    const ed = await H.until(() => H.editor(uuid, index), 8000);
    await H.sleep(700);
    const before = JSON.stringify(H.run(item)?.rows?.[index] ?? null);
    const side = ed?.element?.querySelector('[name="reach.side"]');
    if (side) { side.value = side.value === "foe" ? "all" : "foe"; side.dispatchEvent(new Event("change", { bubbles: true })); }
    await H.sleep(900);
    return { editable, opened: !!ed, fieldsetDisabled: ed?.element?.querySelector("fieldset.acks-extras-effect-reach")?.disabled === true, wrote: JSON.stringify(H.run(item)?.rows?.[index] ?? null) !== before };
  },
  closeEditors: async ({ uuid }) => {
    for (const app of [...foundry.applications.instances.values()]) if (typeof app.store?.key === "string" && app.store.key.startsWith(uuid)) await app.close({ animate: false });
    await globalThis.__lap.closeSheet(uuid);
    return true;
  },

  /* ---- the narrow windows ---- */

  /**
   * One window at a narrow width, at the type size the page holds (a raised `--acks-fs-base` where `px` is given): open it fresh,
   * ask for the width and read it back, scroll each control into view and count those left cut off. The knob is put back after.
   */
  layout: async ({ kind, uuid, tab = null, width, px = null }) => {
    const H = globalThis.__lap;
    const style = document.documentElement.style;
    const had = style.getPropertyValue("--acks-fs-base");
    if (px) style.setProperty("--acks-fs-base", `${px}px`);
    try {
      let app = null;
      if (kind === "editor") {
        const E = await import("/modules/acks-extras/scripts/lib/apps/effect-row-editor.mjs");
        const S = await import("/modules/acks-extras/scripts/lib/gear-effect-rows.mjs");
        const item = fromUuidSync(uuid);
        await E.closeEffectEditors(S.gearEffectStore(item));
        app = E.openEffectEditor(S.gearEffectStore(item), 0);
        await H.until(() => app.rendered && app.element, 8000);
      } else {
        await H.closeSheet(uuid);
        app = H.sheetOf(uuid);
        await app.render({ force: true });
        await H.until(() => app.rendered && app.element, 8000);
        if (tab) { try { await app.changeTab(tab, "primary", { force: true }); } catch { /* the sheet has no such tab */ } }
      }
      await H.sleep(600);
      app.setPosition({ width });
      await H.sleep(700);
      const root = app.element;
      const frame = root.querySelector(".window-content") ?? root;
      const sized = Math.round(app.position.width);
      const controls = [...root.querySelectorAll("button, select, input, a[href], textarea")].filter((c) => c.offsetParent !== null && !c.disabled && c.type !== "hidden");
      const cut = [];
      for (const c of controls) {
        c.scrollIntoView({ block: "center", inline: "center" });
        const r = c.getBoundingClientRect();
        // A header control sits above the content frame by design: it is cut off only where it leaves the window's own width.
        const inHeader = !!c.closest(".window-header");
        const f = (inHeader ? root : frame).getBoundingClientRect();
        if (r.width > 0 && (r.left < f.left - 1 || r.right > f.right + 1 || (!inHeader && (r.top < f.top - 1 || r.bottom > f.bottom + 1)))) cut.push(c.getAttribute("aria-label") || c.name || c.dataset.action || c.tagName.toLowerCase());
      }
      const scrolls = frame.scrollHeight > frame.clientHeight + 1 || [...frame.querySelectorAll("*")].some((n) => n.scrollHeight > n.clientHeight + 1 && ["auto", "scroll"].includes(getComputedStyle(n).overflowY));
      const base = getComputedStyle(document.documentElement).getPropertyValue("--acks-fs-base").trim();
      // The window's own CSS floor: a window may refuse to shrink below it, and the width read back is then the floor.
      const floor = Math.round(parseFloat(getComputedStyle(root).minWidth) || 0);
      return { sized, controls: controls.length, cut, scrolls, base, floor };
    } finally {
      if (had) style.setProperty("--acks-fs-base", had); else style.removeProperty("--acks-fs-base");
    }
  },

  /** The cards this page posted that the walk may claim: they name a fixture item, an item of a body the walk sent out, or speak as a fixture. */
  claim: ({ itemUuids, bodyUuids, aliases, names }) => {
    const out = [];
    for (const uuid of globalThis.__lap?.cards ?? []) {
      const m = fromUuidSync(uuid);
      if (!m) continue;
      const f = m.flags?.["acks-extras"] ?? {};
      const at = f.itemRunCard?.itemUuid ?? f.itemRunWhisper?.itemUuid ?? "";
      const mine = itemUuids.includes(at) || bodyUuids.some((b) => at.startsWith(b)) || aliases.includes(m.speaker?.alias) || names.some((n) => String(m.content ?? "").includes(n));
      if (mine) out.push(uuid);
    }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/*  The walk                                                           */
/* ------------------------------------------------------------------ */
let gm = null;
let pl = null;
const gmRun = (fn, arg) => gm.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const plRun = (fn, arg) => pl.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
/** Poll an async producer until it answers truthy or the time runs out; answers the last value either way. */
async function until(fn, ms = 10000, step = 500) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    if (Date.now() - t0 > ms) return last;
    await sleep(step);
  }
}
const S = { playerId: null, playerViews: false, playerCanTokens: null };
const A = {};
const I = {};
const T = {};
const SC = {};
const disposables = [];
const bodies = [];
const regionsBefore = new Set();
const marked = (marker) => (MACHINE.own ? `${marker}@${MACHINE.own}` : marker);
/** What the tracker holds for each, so a uuid is tracked once. */
const keep = (uuid, kind) => { disposables.push(gm.track(uuid, kind)); return uuid; };

/** A step runs on its own: a throw is a failed check and the walk goes on, unless the world is not the walk's to drive. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name === "WalkBlocked") throw err;
    check(`${name} ran to its end`, false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
}

/** Bring the fixtures to a step's start shape. `place` names where the bearer and the character's token stand. */
async function reset({ place = { M: SPOT.bearer, C: SPOT.outside }, view = SC.main, owners = {} } = {}) {
  const items = [
    { uuid: I.MT.uuid, ...shapes.standing() },
    { uuid: I.MO.uuid, ...shapes.once() },
    { uuid: I.CT.uuid, ...shapes.standing() },
    { uuid: I.CO.uuid, ...shapes.once() },
  ];
  const tokens = [
    { uuid: T.M.uuid, x: place.M[0], y: place.M[1], disposition: -1 },
    { uuid: T.C.uuid, x: place.C[0], y: place.C[1], disposition: 1 },
  ];
  const out = await gmRun(P.reset, { view, items, tokens, clear: [A.M.uuid, A.C.uuid], regionsOf: [T.M.uuid, T.C.uuid] });
  // The ownership each step asks for, written and read back in the Player's own page.
  const levels = { monster: owners.monster ?? 0, char: owners.char ?? 3 };
  await gmRun(P.own, { writes: [{ uuid: A.M.uuid, level: levels.monster }, { uuid: A.C.uuid, level: levels.char }], playerId: S.playerId });
  out.seen = { monster: await plRun(P.levelOf, { uuid: A.M.uuid }), char: await plRun(P.levelOf, { uuid: A.C.uuid }) };
  return out;
}

/** A body's own state tag, as the row localizes it. */
const tagWord = (run, state) => run((s) => game.i18n.localize(`ACKS-LIB.itemRun.row.tag.${s}`), state);

/** A raise and its lowering through the sheet row of an item, read on the seat that presses; `held` is a press the seat may not make. */
async function pressFlow(label, run, { actorUuid, tokenUuid, tog, once }) {
  const rowOf = (uuid) => run(P.rowRead, { actorUuid, itemUuid: uuid });
  const hud = async () => { const h = await run(P.hud, { tokenUuid }); await run(P.hudClose); return h; };
  const r0 = await rowOf(tog.uuid);
  check(`${label}: the toggle's row reads Lowered with Raise offered`, r0.model?.state === "lowered" && r0.model.presses.some((p) => p.key === "raise") && r0.buttons.some((b) => b.action === "itemRunPress"), { state: r0.model?.state, presses: r0.model?.presses, buttons: r0.buttons.length });
  const lowWord = await tagWord(run, "lowered");
  check(`${label}: its tag reads the lowered word`, r0.tags.some((t) => t.state === "lowered" && t.tag === lowWord), { tags: r0.tags.map((t) => t.state) });
  const pressed = await run(P.press, { actorUuid, itemUuid: tog.uuid, key: "raise" });
  check(`${label}: Raise was drawn and pressed`, pressed === true);
  const up = await run(P.waitItem, { uuid: tog.uuid, active: true });
  const st = await run(P.itemRead, { uuid: tog.uuid });
  check(`${label}: the item's activation reads active`, up && st.active === true, { active: st.active });
  const regions = await until(async () => { const r = await gmRun(P.regionsOn, { tokenUuid }); return r.length ? r : null; }, 8000, 500);
  check(`${label}: a Region with the aura behavior stands on the body's token`, !!regions && regions.length === 1, { regions: regions?.length ?? 0 });
  const cards = st.activationId ? await gmRun(P.cardsFor, { aid: st.activationId }) : [];
  check(`${label}: exactly one raised card (one door, never two)`, cards.length === 1, { cards: cards.length });
  const r1 = await rowOf(tog.uuid);
  check(`${label}: the row reads Raised, offering Card and Lower`, r1.model?.state === "raised" && r1.model.presses.map((p) => p.key).sort().join() === "card,lower", { state: r1.model?.state, presses: r1.model?.presses });
  const lowered = await run(P.press, { actorUuid, itemUuid: tog.uuid, key: "lower" });
  check(`${label}: Lower was drawn and pressed`, lowered === true);
  await run(P.waitItem, { uuid: tog.uuid, active: false });
  const st2 = await run(P.itemRead, { uuid: tog.uuid });
  const gone = await until(async () => ((await gmRun(P.regionsOn, { tokenUuid })).length === 0 ? true : null), 8000, 500);
  check(`${label}: Lower clears the activation and the Region`, st2.active === false && !!gone, { active: st2.active, regionsGone: !!gone });
  // The HUD: one control per run item, active while raised; clicking it toggles.
  const ctl = await run(P.hud, { tokenUuid });
  check(`${label}: the HUD opened on the body's token with one control per run item`, ctl.ok === true && ctl.controls.length === 2, { ok: ctl.ok, controlled: ctl.controlled, controls: ctl.controls?.length });
  if (ctl.ok) {
    const first = ctl.controls[0];
    const want = await run((n) => game.i18n.format("ACKS-LIB.itemRun.hud.raise", { item: n }), tog.name);
    check(`${label}: the toggle's control is named for its verb, not active, with an empty tooltip`, ctl.controls.some((c) => c.label === want && c.active === false && c.tip === ""), { labels: ctl.controls.map((c) => c.label), tip: first?.tip });
    check(`${label}: each control wears a picture`, ctl.controls.every((c) => c.src.length > 0), { srcs: ctl.controls.map((c) => c.src.slice(-24)) });
    const at = ctl.controls.findIndex((c) => c.label === want);
    await run(P.hudClick, { index: at });
    const hot = await run(P.waitItem, { uuid: tog.uuid, active: true });
    const lit = await run(P.hud, { tokenUuid });
    const wantLower = await run((n) => game.i18n.format("ACKS-LIB.itemRun.hud.lower", { item: n }), tog.name);
    check(`${label}: a HUD click raised it, and the control now reads Lower and carries active`, hot && lit.controls.some((c) => c.label === wantLower && c.active === true && c.pressed === "true"), { labels: lit.controls?.map((c) => [c.label === wantLower, c.active]) });
    await run(P.hudClick, { index: lit.controls.findIndex((c) => c.label === wantLower) });
    const cold = await run(P.waitItem, { uuid: tog.uuid, active: false });
    check(`${label}: a HUD click on the raised control lowers it`, cold);
    await run(P.hudClose);
  }
  // The once-only item: Use spends its count, the row reads Used up, the HUD draws no control for it.
  const o0 = await rowOf(once.uuid);
  check(`${label}: the once item reads Ready with Use offered`, o0.model?.state === "ready" && o0.model.presses.some((p) => p.key === "use" && !p.disabled), { state: o0.model?.state });
  const used = await run(P.press, { actorUuid, itemUuid: once.uuid, key: "use" });
  check(`${label}: Use was drawn and pressed`, used === true);
  const spent = await run(P.waitItem, { uuid: once.uuid, quantity: 0 });
  check(`${label}: Use spent the item's count`, spent, { quantity: (await run(P.itemRead, { uuid: once.uuid })).quantity });
  const o1 = await rowOf(once.uuid);
  check(`${label}: the row reads Used up with its press off`, o1.model?.state === "spent" && o1.model.presses.every((p) => p.disabled), { state: o1.model?.state, presses: o1.model?.presses });
  const h2 = await hud();
  check(`${label}: a used-up item draws no HUD control`, h2.ok && h2.controls.length === 1, { controls: h2.controls?.length });
}

try {
  /* ---------------------------------------------------------------- */
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after reload (s)", await reloadRecorded(gm, PORTS.gm));
  pl = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after reload (s)", await reloadRecorded(pl, PORTS.player));
  S.playerId = await gmRun(P.userId, MACHINE.player);
  if (!S.playerId) blocked("no Player user on this world");
  const install = { doc: DOC, table: TABLE, figures: FIGURES };
  const gi = await gmRun(P.install, install);
  const pi = await plRun(P.install, install);
  note("gm", { extras: gi.extras, lib: gi.lib });
  note("player", { extras: pi.extras, canCreateTokens: pi.canCreateTokens });
  S.playerCanTokens = pi.canCreateTokens === true;
  check("the invented figures read back on both seats", same(gi.read, FIGURES) && same(pi.read, FIGURES));
  check("the GM seat is a GM and the primary one", gi.isGM && gi.activeGMIsSelf, { active: gi.activeGMIsSelf });
  check("the Player seat is not a GM", pi.isGM === false);
  if (!gi.activeGMIsSelf) blocked("another client is the active GM; the carrier would run there");
  const bootOf = async (run, who) => {
    const c = await run(P.caught);
    check(`${who}: init, setup and ready reached with no console error`, ["init", "setup", "ready"].every((p) => c.boot?.phases.includes(p)) && c.boot.errors.length === 0, { phases: c.boot?.phases, errors: c.boot?.errors });
  };
  await bootOf(gmRun, "gm");
  await bootOf(plRun, "player");
  const sup = await gmRun(() => acksExtras.lib.auraReach.support());
  if (!sup.ok) blocked(`this core build lacks what a reach is made of: ${JSON.stringify(sup.missing)}`);

  /* ---------------------------------------------------------------- */
  section("fixtures");
  const sceneMain = await gm.fixture("lib/aura-cards-scene", "Scene", SCENE_DATA("Aura Cards Square"));
  const sceneTwo = await gm.fixture("lib/aura-press-scene-2", "Scene", SCENE_DATA("Aura Press Second"));
  SC.main = sceneMain.uuid;
  SC.two = sceneTwo.uuid;
  const monsterData = (name, extra = {}) => ({ name, type: "monster", ownership: { default: 0 }, prototypeToken: { actorLink: true, disposition: -1 }, ...extra });
  A.M = await gm.fixture("lib/aura-press-monster", "Actor", monsterData("Aura Press Monster"));
  A.SRC = await gm.fixture("lib/aura-press-source", "Actor", monsterData("Aura Press Source"));
  A.C = await gm.fixture("lib/aura-press-char", "Actor", { name: "Aura Press Char", type: "character", ownership: { default: 0, [S.playerId]: 3 } });
  I.MT = await gm.fixture("lib/aura-press-monster-toggle", "Item", itemData("Aura Press Toggle", "standing"), { parent: A.M.uuid });
  I.MO = await gm.fixture("lib/aura-press-monster-once", "Item", itemData("Aura Press Once", "once"), { parent: A.M.uuid });
  I.CT = await gm.fixture("lib/aura-press-item", "Item", itemData("Aura Press Char Toggle", "standing"), { parent: A.C.uuid });
  I.CO = await gm.fixture("lib/aura-press-char-once", "Item", itemData("Aura Press Char Once", "once"), { parent: A.C.uuid });
  T.M = await gm.fixture("lib/aura-press-monster-token", "Token", { name: "Aura Press Monster", actorId: A.M.id, actorLink: true, x: SPOT.bearer[0], y: SPOT.bearer[1], disposition: -1 }, { parent: SC.main });
  T.C = await gm.fixture("lib/aura-press-char-token", "Token", { name: "Aura Press Char", actorId: A.C.id, actorLink: true, x: SPOT.outside[0], y: SPOT.outside[1], disposition: 1 }, { parent: SC.main });
  const group = await gm.fixture("lib/aura-press-group", "Actor", { name: "Aura Press Group", type: "acks-extras.group", ownership: { default: 0 } });
  const place = await gm.fixture("lib/aura-press-place", "Actor", { name: "Aura Press Place", type: "acks-extras.location", items: [], system: { gmNotes: "<p>Aura press place</p>" } });
  note("fixtures", { actors: 5, items: 4, tokens: 2, group: group.uuid ? 1 : 0, place: place.uuid ? 1 : 0, built: gm.tracked().length });
  for (const s of [SC.main, SC.two]) for (const u of await gmRun(P.regionUuids, { sceneUuid: s })) regionsBefore.add(u);
  const first = await reset();
  check("the shape reset ran on the fixture scene", first.viewing === true && first.warnings.length === 0, first);
  const pv = await plRun(P.view, { sceneUuid: SC.main });
  S.playerViews = pv.viewing === true;
  note("the Player seat's view of the walk's scene", pv);

  /* ---------------------------------------------------------------- */
  await step("W1", async () => {
    section("W1 the sheet rows' presses and the Token HUD, on both seats");
    // GM seat, the monster sheet's Inventory tab.
    await reset({ owners: { monster: 0, char: 3 } });
    const open = await gmRun(P.openSheet, { uuid: A.M.uuid, tab: "inventory" });
    check("W1 gm: the monster sheet's Inventory tab opened", open.rendered === true, open);
    await pressFlow("W1 gm monster", gmRun, { actorUuid: A.M.uuid, tokenUuid: T.M.uuid, tog: { uuid: I.MT.uuid, name: "Aura Press Toggle" }, once: { uuid: I.MO.uuid } });
    await gmRun(P.closeSheet, { uuid: A.M.uuid });
    // GM seat on the character sheet's Equipment tab.
    await reset({ place: { M: SPOT.bearer, C: SPOT.inside }, owners: { monster: 0, char: 3 } });
    const openC = await gmRun(P.openSheet, { uuid: A.C.uuid, tab: "equipment" });
    check("W1 gm: the character sheet's Equipment tab opened", openC.rendered === true, openC);
    await pressFlow("W1 gm character", gmRun, { actorUuid: A.C.uuid, tokenUuid: T.C.uuid, tog: { uuid: I.CT.uuid, name: "Aura Press Char Toggle" }, once: { uuid: I.CO.uuid } });
    await gmRun(P.closeSheet, { uuid: A.C.uuid });

    // Player seat: the character it owns presses and acts; the monster it only observes shows a tag and no press, and no HUD control.
    await reset({ place: { M: SPOT.bearer, C: SPOT.inside }, owners: { monster: 2, char: 3 } });
    const lv = await Promise.all([plRun(P.levelOf, { uuid: A.C.uuid }), plRun(P.levelOf, { uuid: A.M.uuid })]);
    check("W1 player: the ownership each seat reads is the one this step wrote", lv[0].owner === true && lv[1].observer === true && lv[1].owner === false, { char: lv[0], monster: lv[1] });
    const pvv = await plRun(P.view, { sceneUuid: SC.main });
    S.playerViews = pvv.viewing === true;
    if (S.playerViews) {
      const openPC = await plRun(P.openSheet, { uuid: A.C.uuid, tab: "equipment" });
      check("W1 player: the character sheet opened on the Player's own page", openPC.rendered === true, openPC);
      await pressFlow("W1 player character", plRun, { actorUuid: A.C.uuid, tokenUuid: T.C.uuid, tog: { uuid: I.CT.uuid, name: "Aura Press Char Toggle" }, once: { uuid: I.CO.uuid } });
      await plRun(P.closeSheet, { uuid: A.C.uuid });
    } else skip("W1 player character presses and HUD", "the Player seat cannot view the walk's scene (a Player's scene view is the world's active scene), and a raise from a seat that is not viewing the body's scene is refused; the rows read below are the only part reachable");
    await reset({ place: { M: SPOT.bearer, C: SPOT.inside }, owners: { monster: 2, char: 3 } });
    const openPM = await plRun(P.openSheet, { uuid: A.M.uuid, tab: "inventory" });
    check("W1 player: the monster sheet rendered for an observer", openPM.rendered === true, openPM);
    const rowM = await plRun(P.rowRead, { actorUuid: A.M.uuid, itemUuid: I.MT.uuid });
    check("W1 player: the monster's row reads its state tag and draws no press", rowM.model?.state === "lowered" && rowM.model.presses.length === 0 && rowM.buttons.length === 0 && rowM.tags.length >= 1, { state: rowM.model?.state, presses: rowM.model?.presses.length, buttons: rowM.buttons.length, tags: rowM.tags.length });
    const rowO = await plRun(P.rowRead, { actorUuid: A.M.uuid, itemUuid: I.MO.uuid });
    check("W1 player: the monster's once-only row draws no press either", rowO.model?.presses.length === 0 && rowO.buttons.length === 0, { state: rowO.model?.state });
    if (S.playerViews) {
      const hudM = await plRun(P.hud, { tokenUuid: T.M.uuid });
      check("W1 player: the HUD opened on the monster's token draws no item control", hudM.ok ? hudM.controls.length === 0 : true, { ok: hudM.ok, controls: hudM.controls?.length ?? null });
      await plRun(P.hudClose);
    }
    await plRun(P.closeSheet, { uuid: A.M.uuid });
    // The once-only item of the non-owned monster: the Player's own call to the door is refused with nothing spent.
    const stillReady = await gmRun(P.itemRead, { uuid: I.MO.uuid });
    check("W1 player: nothing of the monster was used or raised by the Player seat", stillReady.quantity === 1 && (await gmRun(P.itemRead, { uuid: I.MT.uuid })).active === false);
  });

  /* ---------------------------------------------------------------- */
  await step("W2", async () => {
    section("W2 Card on a raised item's row");
    await reset({ owners: { monster: 0, char: 3 } });
    await gmRun(P.openSheet, { uuid: A.M.uuid, tab: "inventory" });
    await gmRun(P.press, { actorUuid: A.M.uuid, itemUuid: I.MT.uuid, key: "raise" });
    await gmRun(P.waitItem, { uuid: I.MT.uuid, active: true });
    const st = await gmRun(P.itemRead, { uuid: I.MT.uuid });
    const aid = st.activationId;
    check("W2 the item is raised and holds an activation id", st.active === true && !!aid, { active: st.active });
    const said0 = (await gmRun(P.said)).length;
    const pressed = await gmRun(P.press, { actorUuid: A.M.uuid, itemUuid: I.MT.uuid, key: "card" });
    check("W2 Card is offered on a raised row and pressed", pressed === true);
    await sleep(800);
    const where = await gmRun(P.cardIn, { aid });
    check("W2 the chat log holds the raise's card and the press raised no refusal", !!where.id && where.inLog === true && (await gmRun(P.said)).length === said0, { card: !!where.id, inLog: where.inLog });
    const caught = await gmRun(P.caught);
    check("W2 the console stayed clean", caught.errors.length === 0, caught.errors);
    // The unpinned case: the card's message deleted, then Card pressed again.
    const deleted = await gmRun(P.deleteMessage, { id: where.id });
    check("W2 the card's message was deleted", deleted === true);
    const sayBefore = (await gmRun(P.said)).length;
    const again = await gmRun(P.press, { actorUuid: A.M.uuid, itemUuid: I.MT.uuid, key: "card" });
    await sleep(800);
    const said = (await gmRun(P.said)).slice(sayBefore);
    note("W2 (reported, not pinned offline) Card pressed after its message was deleted", { pressed: again, notices: said });
    check("W2 the press after the delete threw no error", (await gmRun(P.caught)).errors.length === 0);
    await gmRun(P.press, { actorUuid: A.M.uuid, itemUuid: I.MT.uuid, key: "lower" });
    await gmRun(P.waitItem, { uuid: I.MT.uuid, active: false });
    await gmRun(P.closeSheet, { uuid: A.M.uuid });
  });

  /* ---------------------------------------------------------------- */
  await step("W3", async () => {
    section("W3 the stack row's press on the group sheet");
    const carry = await gmRun(P.carryRow);
    if (!carry) {
      hold("W3", "the world holds no imported equipment row whose item the carrier runs (a toggle or a once item), so no stack can name one: run the Beastman import, then walk again");
      return;
    }
    note("W3 the row the stack names (kind only)", { kind: carry.kind });
    const sheetOf = (run) => run(P.groupRead, { groupUuid: group.uuid });
    const setup = async () => {
      await reset({ owners: { monster: 0, char: 3 } });
      const s = await gmRun(P.stackSetup, { groupUuid: group.uuid, sourceUuid: A.SRC.uuid, rowKey: carry.key, count: 3, share: 2 });
      return s.key;
    };
    const stackKey = await setup();
    check("W3 the stack was written with one stack", !!stackKey);
    const roster = () => gmRun(P.stackRead, { groupUuid: group.uuid, cookbookId: carry.cookbookId });
    const seeBodies = async () => {
      for (const b of await roster()) if (b.tokenUuid && !bodies.includes(b.tokenUuid)) { bodies.push(b.tokenUuid); keep(b.tokenUuid, "Token"); }
    };

    // The Player seat without the group's ownership (observing it): no press, and the lib's own press sends nothing.
    await gmRun(P.own, { writes: [{ uuid: group.uuid, level: 2 }], playerId: S.playerId });
    const seen = await plRun(P.levelOf, { uuid: group.uuid });
    check("W3 the Player reads OBSERVER and not OWNER of the group in its own page", seen.observer === true && seen.owner === false, seen);
    const obs = await sheetOf(plRun);
    check("W3 a non-owner's group sheet draws no stack-row press", obs.rendered === true && obs.controls.every((c) => !c.press), { rendered: obs.rendered, controls: obs.controls.length, lines: obs.controls.filter((c) => c.line).length });
    note("W3 (reported) whether the non-owner's row keeps its line", { lines: obs.controls.length });
    const api = await plRun(P.groupPressApi, { groupUuid: group.uuid, stackKey, key: carry.key });
    check("W3 (d) the lib's press from a seat that is not the group's owner sends nothing", api.answered === "undefined" && (await roster()).every((b) => b.state !== "deployed"), api);
    await plRun(P.closeSheet, { uuid: group.uuid });

    // The Player seat with OWNER of the group: the press is drawn where it can deploy and would own the body that acts.
    await gmRun(P.own, { writes: [{ uuid: group.uuid, level: 3 }], playerId: S.playerId });
    const owned = await plRun(P.levelOf, { uuid: group.uuid });
    check("W3 the Player reads OWNER of the group in its own page after the write", owned.owner === true, owned);
    const baseOwned = (await plRun(P.levelOf, { uuid: A.SRC.uuid })).owner === true;
    const own = await sheetOf(plRun);
    const drawn = own.controls.some((c) => c.press);
    check("W3 the owner's press is drawn only where Create Tokens is true and the seat owns the stack's base actor", drawn === (S.playerCanTokens && baseOwned), { createTokens: S.playerCanTokens, baseOwned, drawn });
    note("W3 (reported) which the world gave", { createTokens: S.playerCanTokens, baseOwnedByPlayer: baseOwned, pressDrawn: drawn });
    await plRun(P.closeSheet, { uuid: group.uuid });

    // The GM seat: (a) no carrier out, press sends one and acts; (b) the carrier out, press acts through it; (c) every slot spent elsewhere.
    await reset({ owners: { monster: 0, char: 3 } });
    await gmRun(P.stackSetup, { groupUuid: group.uuid, sourceUuid: A.SRC.uuid, rowKey: carry.key, count: 3, share: 2 });
    const g0 = await sheetOf(gmRun);
    const row0 = g0.controls.find((c) => c.key === carry.key);
    check("W3 the GM seat's row reads its line with the share's provenance tooltip and a press", !!row0 && row0.line.length > 0 && row0.lineTip.length > 0 && row0.press === true, { line: !!row0?.line, tip: !!row0?.lineTip, press: row0?.press });
    const pressA = await gmRun(P.groupClick, { groupUuid: group.uuid, key: carry.key });
    check("W3 (a) the press was drawn and pressed with no carrier out", pressA === true);
    await seeBodies();
    const a = await until(async () => { const r = (await roster()).filter((b) => b.state === "deployed"); return r.length ? r : null; }, 10000, 700);
    check("W3 (a) one body was sent out onto the viewed scene", !!a && a.length === 1 && a[0].tokenHere === true, { deployed: a?.length ?? 0, here: a?.[0]?.tokenHere });
    check("W3 (a) the roster record names the row and the body's token carries the item", !!a && a[0].carries.includes(carry.key) && !!a[0].itemUuid, { carries: a?.[0]?.carries.length, item: !!a?.[0]?.itemUuid });
    if (a?.[0]?.itemUuid) {
      const acted = carry.kind === "toggle" ? a[0].active === true : a[0].quantity === 0;
      check("W3 (a) the item acted through that body's own copy", acted, { kind: carry.kind, active: a[0].active, quantity: a[0].quantity });
    }
    const g1 = await sheetOf(gmRun);
    const row1 = g1.controls.find((c) => c.key === carry.key);
    const lowerWord = await gmRun((k) => game.i18n.localize(`ACKS-LIB.itemRun.row.press.${k}`), "lower");
    if (carry.kind === "toggle") check("W3 (b) with the carrier out and its item raised the press reads Lower", !!row1 && row1.press === true && row1.label === lowerWord, { label: row1?.label === lowerWord });
    if (row1?.press && !row1.disabled) {
      await gmRun(P.groupClick, { groupUuid: group.uuid, key: carry.key });
      await seeBodies();
      const b = await roster();
      check("W3 (b) the second press acted through the carrier already out and sent no new body", b.filter((x) => x.state === "deployed").length === 1 && b.filter((x) => x.carries.includes(carry.key)).length === 1, { deployed: b.filter((x) => x.state === "deployed").length, stamped: b.filter((x) => x.carries.includes(carry.key)).length });
      if (carry.kind === "toggle") check("W3 (b) the second press lowered the item", (b.find((x) => x.state === "deployed")?.active) === false);
    } else note("W3 (b)", `the press is off or absent once the carrier has acted (${carry.kind}); no second press made`);

    // (c) every slot of the share spent on bodies that are not here: view the other scene and cut the share to the one stamped body.
    await gmRun(P.stackShare, { groupUuid: group.uuid, rowKey: carry.key, share: 1 });
    await gmRun(P.view, { sceneUuid: SC.two });
    const g2 = await sheetOf(gmRun);
    const row2 = g2.controls.find((c) => c.key === carry.key);
    check("W3 (c) with every slot spent on a body that is not here the row keeps its line and draws no press", !!row2 && row2.line.length > 0 && row2.press === false, { line: !!row2?.line, press: row2?.press });
    await gmRun(P.view, { sceneUuid: SC.main });
    await gmRun(P.closeSheet, { uuid: group.uuid });
    await seeBodies();
  });

  /* ---------------------------------------------------------------- */
  await step("W4", async () => {
    section("W4 the strip's \"and n more\"");
    const markers = { scene: marked("lib/aura-t10-scene"), U1: marked("lib/aura-t10-unit"), U2: marked("lib/aura-t10-unit-2"), S: marked("lib/aura-t10-subject") };
    const tokenMarkers = { U1: marked("lib/aura-t10-unit-token"), U2: marked("lib/aura-t10-unit-2-token"), S: marked("lib/aura-t10-subject-token") };
    const f = await gmRun(P.t10, { markers, tokenMarkers });
    if (!f.scene || !f.U1 || !f.U2 || !f.S || !f.U1Token || !f.U2Token || !f.SToken) {
      hold("W4", "T10's kept fixtures are not all in this world (the scene, two bearers, the subject and their tokens); run lib-aura-engaged first, which builds them from an imported template");
      return;
    }
    const kinds = await gmRun(P.engagedKinds, { uuid: f.U1 });
    if (!kinds) {
      hold("W4", "T10's bearer no longer holds an engaged row (the import changed); retire it by its marker and run lib-aura-engaged again");
      return;
    }
    await gmRun(P.view, { sceneUuid: f.scene });
    const place = { U1: [700, 700], S: [800, 700], U2: [900, 700] };
    const away = { U2: [300, 600] };
    await gmRun(async (a) => {
      const subject = fromUuidSync(a.S);
      const ids = [...subject.effects].filter((e) => e.flags?.["acks-extras"]?.itemRun).map((e) => e.id);
      if (ids.length) await subject.deleteEmbeddedDocuments("ActiveEffect", ids, { "acks-extras": { managedDelete: true } });
      await subject.update({ "flags.acks-extras.extras.types": a.kinds });
      for (const [role, uuid] of Object.entries(a.tokens)) await fromUuidSync(uuid).update({ x: a.place[role][0], y: a.place[role][1], hidden: false, disposition: role === "S" ? 1 : -1 }, { animate: false });
    }, { S: f.S, kinds, tokens: { U1: f.U1Token, S: f.SToken, U2: f.U2Token }, place });
    for (const u of await gmRun(P.regionUuids, { sceneUuid: f.scene })) regionsBefore.add(u);
    const sceneId = f.scene.split(".").pop();
    const combat = await gm.create("Combat", { scene: sceneId, active: true });
    disposables.push(combat.uuid);
    const rows = {};
    const ids = { U1: f.U1.split(".").pop(), S: f.S.split(".").pop(), U2: f.U2.split(".").pop() };
    for (const [role, tokenUuid] of Object.entries({ U1: f.U1Token, S: f.SToken, U2: f.U2Token })) rows[role] = (await gm.create("Combatant", { tokenId: tokenUuid.split(".").pop(), sceneId, actorId: ids[role] }, { parent: combat.uuid })).id;
    const begun = await gmRun(P.fight, { combatId: combat.id, rows, inits: { U1: 25, U2: 20, S: 15 }, tokenId: f.U1Token.split(".").pop(), want: 2 });
    check("W4 the combat began and each bearer holds its engaged Region", begun.regions >= 2, begun);
    const two = await gmRun(P.strip, { uuid: f.S });
    const more = await gmRun(P.moreWord, { n: 1 });
    check("W4 two bearers of one engaged kind collapse to one row on the subject's strip", two.has && two.rows.length === 1, { rows: two.rows.length });
    check("W4 that row reads the \"and 1 more\" span, its tooltip naming the other bearer", two.rows[0]?.more === more && two.rows[0].moreTip.length > 0, { more: two.rows[0]?.more === more, tipNamed: (two.rows[0]?.moreTip.length ?? 0) > 0 });
    // One bearer alone: the second walks off.
    await gmRun(P.move, { moves: [{ uuid: f.U2Token, x: away.U2[0], y: away.U2[1] }], ms: 2200 });
    const one = await gmRun(P.strip, { uuid: f.S });
    check("W4 with one bearer left the row reads no \"more\" text", one.rows.length === 1 && one.rows[0].more === "", { rows: one.rows.length, more: one.rows[0]?.more });
    await gmRun(P.move, { moves: [{ uuid: f.U2Token, x: place.U2[0], y: place.U2[1] }], ms: 1500 });
    await gmRun(P.closeSheet, { uuid: f.S });
    skip("W4 a non-engaged reach never collapses", "a second bearer of one raised reach kind is not built here; the collapse is `oneRowPerEngagedKind` in item-run-strip.mjs, which only groups rows holding an engaged kind, and its unit suite is the proof");
    await gm.sweepTracked({ only: [combat.uuid] });
    disposables.splice(disposables.indexOf(combat.uuid), 1);
  });

  /* ---------------------------------------------------------------- */
  await step("W5", async () => {
    section("W5 the reach glyph and its readout");
    const modes = await gmRun(P.visibilityModes);
    const setShow = async (show) => {
      await gmRun(P.reset, { view: null, items: [{ uuid: I.MT.uuid, ...shapes.standing({ showReach: show }) }], tokens: [], clear: [], regionsOf: [T.M.uuid] });
    };
    const polled = (run, uuid, want) => until(async () => { const g = await run(P.glyph, { tokenUuid: uuid }); return g.canvas && g.has === want ? g : null; }, 6000, 500);
    await reset({ place: { M: SPOT.bearer, C: SPOT.inside }, owners: { monster: 0, char: 3 } });
    await setShow(false);
    const up = await gmRun(P.use, { itemUuid: I.MT.uuid });
    check("W5 the reach is raised over the body", up.active === true, up);
    const g = await polled(gmRun, T.C.uuid, true);
    check("W5 gm: the body inside the reach carries one glyph, a child of its token, drawn from the aura icon at the token's right edge", !!g && g.onToken === true && g.slotOk === true && g.aura === true, g);
    check("W5 gm: the glyph is not a child of token.effects", !!g && g.inEffects === false);
    const hov = await gmRun(P.hover, { tokenUuid: T.C.uuid, on: true });
    note("W5 gm: the readout's trigger", hov.how === "pointer handler" ? "the token's own hover handler was called (a synthetic hover; no pointer was moved)" : "the hoverToken hook was called (a synthetic hover; the token's handler threw)");
    check("W5 gm: the readout over the token carries a line naming the item", typeof hov.text === "string" && hov.text.includes("Aura Press Toggle"), { text: hov.text === null ? null : hov.text.length });
    await gmRun(P.hover, { tokenUuid: T.C.uuid, on: false });
    await gmRun(P.move, { moves: [{ uuid: T.C.uuid, x: SPOT.outside[0], y: SPOT.outside[1] }], ms: 1500 });
    const out = await polled(gmRun, T.C.uuid, false);
    check("W5 gm: the token outside the reach carries none", !!out);
    await gmRun(P.move, { moves: [{ uuid: T.C.uuid, x: SPOT.inside[0], y: SPOT.inside[1] }], ms: 1500 });
    await gmRun(P.use, { itemUuid: I.MT.uuid });
    const lowered = await polled(gmRun, T.C.uuid, false);
    check("W5 gm: lowering the reach removes the glyph", !!lowered);

    // The Player seat: the Region's own visibility decides, as core states it.
    for (const show of [false, true, false]) {
      await setShow(show);
      await gmRun(P.use, { itemUuid: I.MT.uuid });
      const regions = await until(async () => { const r = await gmRun(P.regionsOn, { tokenUuid: T.M.uuid }); return r.length ? r : null; }, 8000, 500);
      const vis = regions?.[0]?.visibility;
      const gmShown = await gmRun(P.shown, { visibility: vis, isGM: true });
      const plShown = await plRun(P.shown, { visibility: vis, isGM: false });
      check(`W5 showReach ${show}: the Region is stored ${show ? "visible to everyone" : "for the Judge alone"}, and the model shows the glyph to the Judge and ${show ? "to a Player" : "not to a Player"}`, vis === (show ? modes.ALWAYS : modes.GAMEMASTER) && gmShown === 1 && plShown === (show ? 1 : 0), { vis, gmShown, plShown });
      if (S.playerViews) {
        await plRun(P.view, { sceneUuid: SC.main });
        const pg = await until(async () => { const r = await plRun(P.glyph, { tokenUuid: T.C.uuid }); return r.canvas && r.has === show ? r : null; }, 7000, 500);
        check(`W5 showReach ${show}: the Player's own token inside the reach shows ${show ? "the glyph" : "no glyph"}`, !!pg);
        if (!show) {
          const hp = await plRun(P.hover, { tokenUuid: T.C.uuid, on: true });
          check("W5 player: with showReach unticked no readout stands over the token", hp.text === null || hp.text === "", { text: hp.text });
          await plRun(P.hover, { tokenUuid: T.C.uuid, on: false });
        }
      }
      await gmRun(P.use, { itemUuid: I.MT.uuid });
      await sleep(700);
    }
    if (!S.playerViews) skip("W5 the Player's canvas half", "the Player seat does not view the walk's scene, so only the Region's stored visibility and `shownReaches` were read for it");
  });

  /* ---------------------------------------------------------------- */
  await step("W6", async () => {
    section("W6 the item sheet's effect rows and the editor's reach group");
    await reset({ owners: { monster: 0, char: 3 } });
    // The owner seat is the Player: it owns the character, so the store's `editable()` answers true for it.
    const sheet = await plRun(P.itemSheet, { uuid: I.CT.uuid });
    check("W6 the owner's item sheet carries one effect-rows group in a tab, with Add row, and Edit and Delete on its row", sheet.groups === 1 && sheet.add === 1 && sheet.edit >= 1 && sheet.del >= 1, sheet);
    note("W6 the group sits in the tab", sheet.tab);
    const added = await plRun(P.addRow, { uuid: I.CT.uuid });
    check("W6 Add row wrote a row and opened its editor", added.opened === true && added.rows === sheet.rows + 1, added);
    const ix = added.index;
    const ed = await plRun(P.editorRead, { uuid: I.CT.uuid, index: ix });
    check("W6 the editor ends with the reach group, its figure and unit read-only", ed.open && ed.group && ed.fieldsetDisabled === false && ed.readonly.every((t) => t === "output"), { group: ed.group, readonly: ed.readonly });
    const sel = (name) => `[name="${name}"]`;
    const set = (selector, v) => plRun(P.editorSet, { uuid: I.CT.uuid, index: ix, selector, ...v });
    // How it is used.
    const u1 = await set("[data-acks-extras-item-use]", { value: "spent" });
    check("W6 How it is used: Used up writes a spending kind", ["once", "fuse", "consume"].includes(u1.activation?.kind), { kind: u1.activation?.kind });
    const u2 = await set("[data-acks-extras-item-use]", { value: "toggle" });
    check("W6 How it is used: Raised and lowered writes toggle", u2.activation?.kind === "toggle", { kind: u2.activation?.kind });
    const u3 = await set("[data-acks-extras-item-use]", { value: "always" });
    check("W6 How it is used: Always on removes the activation", u3.activation === null || u3.activation?.kind === undefined, { activation: u3.activation });
    await set("[data-acks-extras-item-use]", { value: "toggle" });
    // The reach group's own controls, each read back; one control writes its own path only.
    const m1 = await set(sel("reach.mode"), { value: "engaged" });
    check("W6 A distance or Engaged: Engaged writes reach.engaged", m1.row?.reach?.engaged === true, { engaged: m1.row?.reach?.engaged });
    const s1 = await set(sel("reach.side"), { value: "foe" });
    check("W6 Who counts: Opposing writes reach.filter.side", s1.row?.reach?.filter?.side === "opposing", { side: s1.row?.reach?.filter?.side });
    check("W6 a change that moves one control wrote that control's path only (the engaged write stayed)", s1.row?.reach?.engaged === true && s1.row?.reach?.pulse === m1.row?.reach?.pulse, { engaged: s1.row?.reach?.engaged });
    const edr = await plRun(P.editorRead, { uuid: I.CT.uuid, index: ix });
    check("W6 the editor offers kinds counted and left out", edr.kindNames.length > 0 && edr.exceptNames.length > 0, { kinds: edr.kindNames.length, except: edr.exceptNames.length });
    if (edr.kindNames.length && edr.exceptNames.length) {
      const kind = edr.kindNames[0];
      const except = edr.exceptNames[edr.exceptNames.length - 1];
      const k1 = await set(sel(`reach.kinds.${kind}`), { checked: true });
      check("W6 Kinds counted: a ticked kind is stored in reach.filter.kinds", (k1.row?.reach?.filter?.kinds ?? []).includes(kind), { stored: k1.row?.reach?.filter?.kinds?.length });
      const k2 = await set(sel(`reach.exceptKinds.${except}`), { checked: true });
      check("W6 Kinds left out: a ticked kind is stored in reach.filter.exceptKinds", (k2.row?.reach?.filter?.exceptKinds ?? []).includes(except), { stored: k2.row?.reach?.filter?.exceptKinds?.length });
    }
    const r1 = await set(sel("reach.showReach"), { checked: true });
    check("W6 Players see the ring: ticked writes reach.showReach", r1.row?.reach?.showReach === true);
    const r0 = await set(sel("reach.showReach"), { checked: false });
    check("W6 Players see the ring: unticked writes false", r0.row?.reach?.showReach === false);
    await plRun(P.closeEditors, { uuid: I.CT.uuid });

    // A seat whose store is not editable: the Player observing the item.
    await gmRun(P.own, { writes: [{ uuid: A.C.uuid, level: 2 }], playerId: S.playerId });
    const lvl = await plRun(P.levelOf, { uuid: I.CT.uuid });
    check("W6 the Player reads OBSERVER and not OWNER of the item in its own page", lvl.observer === true && lvl.owner === false, lvl);
    const ro = await plRun(P.itemSheet, { uuid: I.CT.uuid });
    check("W6 a seat that may not write sees the rows listed with no Add, Edit or Delete", ro.groups === 1 && ro.rows >= 1 && ro.add === 0 && ro.edit === 0 && ro.del === 0, ro);
    const roe = await plRun(P.readOnlyEditor, { uuid: I.CT.uuid, index: 0 });
    check("W6 the editor opened another way writes nothing for it, its group disabled", roe.editable === false && roe.wrote === false && roe.fieldsetDisabled === true, roe);
    await plRun(P.closeEditors, { uuid: I.CT.uuid });
    await gmRun(P.own, { writes: [{ uuid: A.C.uuid, level: 3 }], playerId: S.playerId });
  });

  /* ---------------------------------------------------------------- */
  await step("W7", async () => {
    section("W7 the reach group's two holds");
    await reset({ owners: { monster: 0, char: 3 } });
    await plRun(P.itemSheet, { uuid: I.CT.uuid });
    await plRun(P.editRow, { uuid: I.CT.uuid, index: 0 });
    const lowerRead = await plRun(P.editorRead, { uuid: I.CT.uuid, index: 0 });
    const tipUse = await plRun(() => game.i18n.localize("ACKS-LIB.effectEditor.reach.useTip"));
    check("W7 lowered: How it is used is enabled, carrying its own tooltip", lowerRead.open && lowerRead.use?.disabled === false && lowerRead.use.tip === tipUse, { disabled: lowerRead.use?.disabled });
    // Raised: the stored state is written straight (a raise would need a body on the scene), and the editor opened fresh.
    await plRun(P.setRaisedFlag, { uuid: I.CT.uuid, active: true });
    await plRun(P.editRow, { uuid: I.CT.uuid, index: 0 });
    const raisedRead = await plRun(P.editorRead, { uuid: I.CT.uuid, index: 0 });
    const tipRaised = await plRun(() => game.i18n.localize("ACKS-LIB.effectEditor.reach.useRaisedTip"));
    check("W7 raised: How it is used is disabled and its tooltip says to lower the item first", raisedRead.use?.disabled === true && raisedRead.use.tip === tipRaised, { disabled: raisedRead.use?.disabled });
    await plRun(P.setRaisedFlag, { uuid: I.CT.uuid, active: false });
    await plRun(P.editRow, { uuid: I.CT.uuid, index: 0 });
    const loweredAgain = await plRun(P.editorRead, { uuid: I.CT.uuid, index: 0 });
    check("W7 lowered again: the select is enabled", loweredAgain.use?.disabled === false);
    // Engaged holds the engaged pulse; A distance takes it back off and leaves any other stored pulse.
    const set = (selector, v) => plRun(P.editorSet, { uuid: I.CT.uuid, index: 0, selector, ...v });
    const before = await plRun(P.itemRead, { uuid: I.CT.uuid });
    const otherPulse = before.rows[0]?.reach?.pulse;
    const e1 = await set('[name="reach.mode"]', { value: "engaged" });
    const engagedPulse = e1.row?.reach?.pulse;
    check("W7 Engaged: the row's reach holds the engaged pulse", e1.row?.reach?.engaged === true && typeof engagedPulse === "string" && engagedPulse !== otherPulse, { engaged: e1.row?.reach?.engaged, changedPulse: engagedPulse !== otherPulse });
    const e2 = await set('[name="reach.mode"]', { value: "distance" });
    check("W7 A distance: the stored engaged pulse is gone", e2.row?.reach?.engaged === false && e2.row?.reach?.pulse === undefined, { engaged: e2.row?.reach?.engaged, pulse: e2.row?.reach?.pulse ?? null });
    // A hand-set other pulse survives a switch that never touched the engaged pulse.
    await gmRun(P.reset, { view: null, items: [{ uuid: I.CT.uuid, ...shapes.standing() }], tokens: [], clear: [], regionsOf: [] });
    await plRun(P.editRow, { uuid: I.CT.uuid, index: 0 });
    const s1 = await set('[name="reach.side"]', { value: "foe" });
    check("W7 a pulse that is not the engaged one stays through an edit of another control", s1.row?.reach?.pulse === otherPulse, { kept: s1.row?.reach?.pulse === otherPulse });
    await plRun(P.closeEditors, { uuid: I.CT.uuid });
  });

  /* ---------------------------------------------------------------- */
  await step("W8", async () => {
    section("W8 the windows at a narrow width and a raised type size");
    await reset({ place: { M: SPOT.bearer, C: SPOT.inside }, owners: { monster: 0, char: 3 } });
    await gmRun(P.own, { writes: [{ uuid: group.uuid, level: 3 }], playerId: S.playerId });
    const windows = [
      { label: "the monster sheet (Inventory)", kind: "sheet", uuid: A.M.uuid, tab: "inventory" },
      { label: "the character sheet (Equipment)", kind: "sheet", uuid: A.C.uuid, tab: "equipment" },
      { label: "the group sheet", kind: "sheet", uuid: group.uuid, tab: null },
      { label: "the item sheet with its effect rows", kind: "sheet", uuid: I.CT.uuid, tab: null },
      { label: "the effect-row editor with the reach group", kind: "editor", uuid: I.CT.uuid, tab: null },
    ];
    for (const w of windows) {
      for (const px of [null, RAISED_BASE_PX]) {
        const r = await gmRun(P.layout, { kind: w.kind, uuid: w.uuid, tab: w.tab, width: NARROW, px });
        const at = px ? `at --acks-fs-base ${px}px` : "at the type size the page holds";
        check(`W8 ${w.label} ${at}: the width asked for is the width read back`, Math.abs(r.sized - Math.max(NARROW, r.floor)) <= 2, { asked: NARROW, got: r.sized, floor: r.floor });
        check(`W8 ${w.label} ${at}: every control is reachable and none is cut off`, r.controls > 0 && r.cut.length === 0, { controls: r.controls, cut: r.cut.slice(0, 6), scrolls: r.scrolls });
        if (px) check(`W8 ${w.label}: the knob took (the page read it back)`, r.base === `${px}px`, { base: r.base });
      }
      await gmRun(P.closeEditors, { uuid: w.uuid }).catch(() => {});
    }
    // The HUD at the raised size: its controls are still drawn.
    await gmRun((a) => document.documentElement.style.setProperty("--acks-fs-base", `${a.px}px`), { px: RAISED_BASE_PX });
    const hud = await gmRun(P.hud, { tokenUuid: T.M.uuid });
    check("W8 the HUD still draws its controls at the raised size", hud.ok && hud.controls.length >= 1, { controls: hud.controls?.length });
    await gmRun(P.hudClose);
    await gmRun(() => document.documentElement.style.removeProperty("--acks-fs-base"));
    skip("W8 the glyph keeps its slot on a resized token", "a token resize and the glyph's slot are `glyphSlot` and `layGlyph` in reach-glyph.mjs; W5 reads the slot at the token's own size, and no resized token is built here");
  });

  const late = await gmRun(P.caught);
  const lateP = await plRun(P.caught);
  note("errors this walk's seats recorded after ready", { gm: late.errors, player: lateP.errors });
  check("neither seat logged a console error during the walk", late.errors.length === 0 && lateP.errors.length === 0, { gm: late.errors.length, player: lateP.errors.length });
  if (holds.length) blocked(holds.join(" | "));
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  if (err?.name !== "WalkBlocked") checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      const itemUuids = Object.values(I).map((i) => i.uuid);
      const claimArgs = { itemUuids, bodyUuids: bodies, aliases: ["Aura Press Monster", "Aura Press Char", "Aura Press Source"], names: ["Aura Press Toggle", "Aura Press Once", "Aura Press Char Toggle", "Aura Press Char Once"] };
      for (const u of await gmRun(P.claim, claimArgs)) keep(u, "ChatMessage");
      if (pl) for (const u of await plRun(P.claim, claimArgs)) keep(u, "ChatMessage");
      for (const scene of [SC.main, SC.two].filter(Boolean)) {
        for (const u of await gmRun(P.regionUuids, { sceneUuid: scene })) if (!regionsBefore.has(u)) keep(u, "Region");
      }
      const tracked = new Set(gm.tracked().map((e) => e.uuid));
      const sw = await gm.sweepTracked({ only: [...new Set(disposables)].filter((u) => tracked.has(u)) });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm) await gmRun(() => globalThis.__lap?.disarm?.()); } catch { /* the page is gone */ }
  try { if (pl) await plRun(() => globalThis.__lap?.disarm?.()); } catch { /* the page is gone */ }
  try { if (pl) await pl.close(); } catch { /* closed */ }
  try { if (gm) await gm.close(); } catch { /* closed */ }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const id of skipped) console.log(`SKIP  ${id}`);
  for (const h of holds) console.log(`HELD  ${h}`);
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  console.log(`SKIPPED ${skipped.length} step(s) not reached; HELD ${holds.length}`);
  console.log(`SUMMARY lib/aura-presses: ${passed}/${checks.length} checks passed${failed.length ? `; failed: ${failed.join(" | ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}
