/**
 * Live walk, lib/aura-fuse: the fuse item (a beastman's E2 shape) through its use,
 * its cards and its burst, on the GM seat and a real Player seat together.
 * Walks docs/lib/TESTING.md, "S9a: E2, the fuse item", steps 1 to 13, and "S9c: Light and Lit,
 * Swigs left, the Judge's call", step 6b (the bearer's sheet row and the Token HUD), and "S9d:
 * the second light, the second GM seat", step 6c (Item#use on a burning stack of one).
 * Machine values arrive through ./_env.mjs.
 *
 * WRITTEN FROM THE CODE AND NOT YET RUN. Every assertion below follows
 * scripts/lib/item-run.mjs, item-run-logic.mjs and the presenter as they read, and
 * none has met a live world: the first run may fail on a selector, a timing or a
 * rig value (core 14: a randomUniform near 0 throws the top face of a die, near 1
 * a 1; the mid value for an unlit throw is inferred), and a failure there is the
 * walk's to fix before it is the code's.
 *
 * Every figure is invented and registered for this run alone, under the document
 * `live-aura-fuse`, so no imported table is shadowed; each item refers to them the
 * way scripts/monsters/gear-run.mjs `fusedItem` writes them. The page prints no
 * range, miss or scatter, so no step asserts one (the owner: "No shipping house
 * rules please."): Move the spot's far point is checked as accepted.
 *
 * Dice are rigged on the page that rolls and restored after each press. What was
 * rolled is read off the stored card, never predicted. A press the card draws no
 * button for (a refusal from a seat that does not own the body, the bearer or the
 * vessel) is the lib's own call made in that seat's page, and its label says so.
 *
 * Fixtures, kept and found by marker (`api.fixture`):
 *   scene `lib/aura-fuse-scene`; monsters `lib/aura-fuse-bearer`, `lib/aura-fuse-near`
 *   and `lib/aura-fuse-far`; the character `lib/aura-fuse-player` (owned by the Player
 *   seat); the vehicle `lib/aura-fuse-vessel`; a linked token `<actor marker>-token`
 *   for each; items `lib/aura-fuse-item` (a stack) and `lib/aura-fuse-item-blank`.
 * Each step writes the shape it needs at its start. Nothing is rolled back at the end.
 *
 * The run's own products are tracked and swept by id: its combats, the disposable
 * bearer, item and token, and the cards its clients posted that name a fixture item.
 * The fixtures stay. Steps that need what this walk cannot build print `SKIP
 * <step>: <reason>`; a SKIP is not a check and is counted apart.
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

const MOD = "acks-extras";
const DOC = "live-aura-fuse";
const TABLE = "figures";
/** The breed key the bearer's item carries, and the invented figures of the two rows the items name. The blank row has no fumble. */
const BREED = "walkbreed";
const SHARED = { throw: 15, fuseDice: "1d2", proficiency: "Walk Proficiency", sizes: { [BREED]: 2 }, blast: [{ lb: 2, dice: "1d6", radius: 15, types: [] }], saveKind: "blast", saveFraction: 0.5 };
const FIGURES = Object.freeze({ fuse: { ...SHARED, fumble: 1 }, blank: { ...SHARED } });
/** The hit points and hull the walk writes at each step's start, and a body's stored Blast target. */
const HP = 40;
const HULL = 40;
const SAVE_TARGET = 10;
/** `CONFIG.Dice.randomUniform` values: the top face of every die, a 1 on every die, and a middle face. */
const DIE = Object.freeze({ top: 0.025, one: 0.975, mid: 0.5 });
const CITE = "MM p. 55";

/** The bodies and their places (pixels, top-left of a one-square token on a 100 px, 5 ft grid): the bearer, a body beside it, the Player's character, a body outside the area, and the vessel outside the bearer's area. */
const ROLES = Object.freeze({
  B: { stem: "bearer", name: "Aura Fuse Bearer", type: "monster", at: [1000, 700] },
  N: { stem: "near", name: "Aura Fuse Near", type: "monster", at: [1100, 700] },
  P: { stem: "player", name: "Aura Fuse Player", type: "character", at: [1000, 900], owned: true },
  F: { stem: "far", name: "Aura Fuse Far", type: "monster", at: [1600, 700] },
  V: { stem: "vessel", name: "Aura Fuse Vessel", type: "acks-extras.vehicle", at: [1000, 1100] },
});
/** Where Move the spot is sent: the vessel's centre, inside no other body's reach of the bearer. */
const VESSEL_SPOT = Object.freeze({ x: 1050, y: 1150 });

const ref = (row, figure) => ({ doc: DOC, table: TABLE, row, figure });
const itemData = (name, row, quantity) => ({
  name, type: "item",
  system: { description: "", subtype: "item", quantity, cost: 0, weight: 0, weight6: 0 },
  flags: { [MOD]: { cookbook: { id: `walk.aura-fuse.${row}`, cite: "Aura Fuse ref" }, itemRun: {
    activation: { kind: "fuse", state: { active: false, activationId: "", regionId: "" }, throw: ref(row, "throw"), fumble: ref(row, "fumble"), fuseDice: ref(row, "fuseDice"), proficiency: ref(row, "proficiency"), sizes: ref(row, "sizes"), blast: ref(row, "blast"), variant: BREED },
    rows: [{ key: "burst", reach: { pulse: "burst", save: ref(row, "saveKind"), fraction: ref(row, "saveFraction") } }],
  } } },
});
const ITEM_NAME = "Aura Fuse Item";
const BLANK_NAME = "Aura Fuse Item Blank";

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__fuseBoot = { phase: "load", phases: [], errors: [] });
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

/** Reload one seat's page under the load recorder, so what `init`, `setup` and `ready` log is read. */
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
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  userId: (name) => game.users.find((u) => u.name === name)?.id ?? null,

  /** Arm the recorders and helpers on this seat and register the invented figures; replaces an earlier install. */
  install: async ({ doc, table, figures }) => {
    globalThis.__laf?.disarm?.();
    const H = (globalThis.__laf = {});
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
    H.errors = [];
    H.cards = [];
    H.said = [];
    const notes = ui.notifications;
    const undo = [];
    for (const kind of ["info", "warn", "error"]) {
      const had = Object.hasOwn(notes, kind);
      const original = notes[kind];
      notes[kind] = function (message, ...rest) {
        H.said.push(`${kind}: ${String(message)}`.slice(0, 160));
        if (kind === "error") H.errors.push(`toast: ${String(message)}`.slice(0, 300));
        return original.call(this, message, ...rest);
      };
      undo.push(() => { if (had) notes[kind] = original; else delete notes[kind]; });
    }
    const consoleError = console.error;
    console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); return consoleError.apply(console, args); };
    const CM = foundry.documents.ChatMessage;
    const cmHad = Object.hasOwn(CM, "createDocuments");
    const cmOriginal = CM.createDocuments;
    CM.createDocuments = async function (...args) {
      const docs = await cmOriginal.apply(this, args);
      for (const d of docs ?? []) if (d?.uuid && !H.cards.includes(d.uuid)) H.cards.push(d.uuid);
      return docs;
    };
    H.dice = null;
    H.rig = (v) => { H.dice ??= CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = () => v; };
    H.unrig = () => { if (H.dice) CONFIG.Dice.randomUniform = H.dice; H.dice = null; };
    H.disarm = () => {
      for (const fn of undo) fn();
      console.error = consoleError;
      if (cmHad) CM.createDocuments = cmOriginal; else delete CM.createDocuments;
      H.unrig();
    };

    const T = acksExtras.lib.tables;
    T.registerTable({ id: doc, source: "invented", tables: { [table]: figures } }, { priority: T.PRIORITY.OVERRIDE + 1, source: "live-test" });
    const read = Object.fromEntries(Object.entries(figures).map(([row, f]) => [row, Object.fromEntries(Object.keys(f).map((k) => [k, T.getDoc(doc).tables?.[table]?.[row]?.[k] ?? null]))]));

    const L = (key) => game.i18n.localize(key);
    const card = (k) => L(`ACKS-LIB.itemRun.card.${k}`);
    H.fmt = (key, data) => game.i18n.format(key, data);
    H.words = {
      light: L("ACKS-LIB.itemRun.press.light"), lit: card("lit"), unlit: card("unlit"), fumble: card("fumble"), judgeDecides: card("judgeDecides"), unlitLine: card("unlitLine"), judgeLine: card("judgeLine"),
      blankFumble: card("blankRow.fumble"), moveSpot: card("moveSpot"), setOff: card("setOff"), applyAll: card("applyAll"), handOn: card("handOn"), handed: card("handed"), structure: card("structure"), damage: card("damage"),
      inArea: card("inArea"), cite: card("citeFuse"), colResult: L("ACKS-LIB.rollCard.colResult"), colTarget: L("ACKS-LIB.rollCard.colTarget"), colTotal: L("ACKS-LIB.rollCard.colTotal"),
    };

    try { if (!ui.chat?.rendered) { await ui.hotbar?.render?.({ force: true }); await ui.chat.render({ force: true }); } } catch { /* the walk finds out when it looks for a card */ }

    H.msgEls = (id) => [...document.querySelectorAll(`li.chat-message[data-message-id="${id}"]`)];
    /** A card's rendered content on this seat: title, note, small-print lines, footer buttons and each row's cells by column heading. */
    H.read = (id) => {
      const el = H.msgEls(id).find((e) => e.querySelector(".acks-extras-roll-card"));
      if (!el) return null;
      const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
      const btn = (b) => ({ action: b.dataset.action, label: txt(b), tip: b.dataset.tooltipText ?? "", data: { ...b.dataset } });
      const rows = [...el.querySelectorAll("table.acks-table")].flatMap((t) => {
        const heads = [...t.querySelectorAll("thead th")].map(txt);
        return [...t.querySelectorAll("tbody tr")].map((tr) => {
          const tds = [...tr.children];
          const cells = {};
          heads.forEach((h, i) => { cells[h] = { text: txt(tds[i]), tip: tds[i]?.dataset.tooltipText ?? "" }; });
          return { name: (tds[0]?.childNodes[0]?.textContent ?? "").trim(), detail: txt(tds[0]?.querySelector(".acks-extras-roll-detail")), cells, buttons: [...tr.querySelectorAll("button[data-action]")].map(btn) };
        });
      });
      return {
        title: txt(el.querySelector(".acks-chat-title")), subtitle: txt(el.querySelector(".acks-chat-subtitle")), note: txt(el.querySelector(".acks-extras-roll-note")), noteTip: el.querySelector(".acks-extras-roll-note")?.dataset.tooltipText ?? "",
        lines: [...el.querySelectorAll("p.acks-extras-roll-footnote")].map(txt), footer: [...el.querySelectorAll("footer.acks-extras-roll-actions button")].map(btn), rows,
      };
    };
    return { user: game.user.name, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, extras: game.modules.get("acks-extras")?.version, words: H.words, read, chat: !!ui.chat?.rendered };
  },

  caught: () => ({ errors: globalThis.__laf?.errors ?? [], boot: globalThis.__fuseBoot ?? null, said: globalThis.__laf?.said ?? [] }),
  view: async ({ sceneUuid }) => {
    const H = globalThis.__laf;
    const scene = fromUuidSync(sceneUuid);
    if (!scene) return { viewing: false, reason: "no scene" };
    let threw = null;
    if (canvas.scene?.id !== scene.id) {
      try { await scene.view(); } catch (e) { threw = String(e?.message ?? e); }
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 12000);
    }
    return { viewing: canvas.scene?.id === scene.id, threw };
  },

  /** Bring the fixtures to a step's start shape. */
  reset: async ({ view, actors, tokens, items, playerId }) => {
    const H = globalThis.__laf;
    H.unrig();
    const out = { viewing: false, warnings: [], fuses: 0 };
    const scene = fromUuidSync(view);
    if (canvas.scene?.id !== scene.id) {
      await scene.view();
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 15000);
    }
    out.viewing = canvas.scene?.id === scene.id;
    for (const a of actors) {
      const actor = fromUuidSync(a.uuid);
      if (!actor) { out.warnings.push(`no actor ${a.uuid}`); continue; }
      const ids = [...actor.effects].filter((e) => e.flags?.["acks-extras"]?.fuse).map((e) => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
      out.fuses += ids.length;
      const patch = { ownership: { default: 0, [playerId]: a.owned ? 3 : 0 } };
      if (a.kind === "vehicle") { patch["system.shp.value"] = a.hull; patch["system.shp.max"] = a.hull; } else {
        patch["system.hp.value"] = a.hp; patch["system.hp.max"] = a.hp;
        patch["system.saves.blast.value"] = a.save;
      }
      await actor.update(patch);
    }
    for (const t of tokens) await fromUuidSync(t.uuid).update({ x: t.x, y: t.y, hidden: false }, { animate: false });
    for (const s of items) {
      const item = fromUuidSync(s.uuid);
      if (!item) { out.warnings.push(`no item ${s.uuid}`); continue; }
      await item.update({ "system.quantity": s.quantity, "flags.acks-extras.itemRun.activation.state": { active: false, activationId: "", regionId: "" } });
    }
    await H.sleep(500);
    return out;
  },

  rig: ({ value }) => { const H = globalThis.__laf; if (value === null) H.unrig(); else H.rig(value); return true; },

  /** Item#use as a hotbar macro calls it, rigged or not, on this seat: the notices this window showed while it ran. */
  useBare: async ({ itemUuid, die }) => {
    const H = globalThis.__laf;
    const from = H.said.length;
    if (die !== null) H.rig(die);
    try { await fromUuidSync(itemUuid).use(); } finally { if (die !== null) H.unrig(); }
    await H.sleep(300);
    return { said: H.said.slice(from) };
  },

  /** Use an item, rigged or not, and wait for its card to settle: the message that names the item and its stored state. */
  use: async ({ itemUuid, die }) => {
    const H = globalThis.__laf;
    const item = fromUuidSync(itemUuid);
    const before = new Set(game.messages.map((m) => m.id));
    if (die !== null) H.rig(die);
    try { await item.use(); } finally { if (die !== null) H.unrig(); }
    const id = await H.until(() => game.messages.find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.itemRunCard?.itemUuid === itemUuid)?.id ?? null, 8000);
    let last = "";
    for (let i = 0; i < 20 && id; i++) {
      await H.sleep(400);
      const now = JSON.stringify(game.messages.get(id)?.flags?.["acks-extras"]?.itemRunCard ?? null);
      if (now === last) break;
      last = now;
    }
    return { messageId: id, said: H.said.slice(-2) };
  },

  /** A card's stored state, trimmed to what the walk reads. */
  card: ({ id }) => {
    const c = game.messages.get(id)?.flags?.["acks-extras"]?.itemRunCard;
    if (!c) return null;
    return {
      kind: c.kind, activationId: c.activationId, outcome: c.outcome ?? null, roll: c.roll ?? null, fuse: c.fuse ?? null, blank: c.blank ?? [], burned: c.burned === true, bearer: c.bearer ?? null,
      rolled: c.rolled ?? null, dice: c.dice ?? null, radius: c.radius ?? null, spot: c.spot ?? null, reduction: c.reduction ?? null, saveName: c.saveName ?? "", blankWhy: c.blankWhy ?? null,
      subjects: Object.values(c.subjects ?? {}).map((s) => ({ uuid: s.uuid, name: s.name })),
      vehicles: Object.values(c.vehicles ?? {}).map((v) => ({ uuid: v.uuid, name: v.name, state: v.state })),
      entries: Object.entries(c.entries ?? {}).map(([key, e]) => ({ key, subject: e.subject, state: e.state, saved: e.saved ?? null, amount: e.amount ?? null, hp: e.hp ?? [], why: e.why ?? "" })),
    };
  },
  /** Wait for a card to stop changing. */
  settle: async ({ id, ms = 800 }) => {
    const H = globalThis.__laf;
    await H.sleep(ms);
    let last = "";
    for (let i = 0; i < 15; i++) {
      const now = JSON.stringify(game.messages.get(id)?.flags?.["acks-extras"]?.itemRunCard ?? null);
      if (now === last) break;
      last = now;
      await H.sleep(400);
    }
    return true;
  },
  /** A write to the card's own flag that changes nothing it reads, so a seat re-renders it (an ownership written meanwhile is read at render). */
  touch: async ({ id }) => { await game.messages.get(id).update({ "flags.acks-extras.itemRunCard.walkTouch": Date.now() }); await globalThis.__laf.sleep(700); return true; },

  /** Click a card's own button in this seat's page; false where it is not there. `match` names the button's data attributes. */
  click: ({ id, action, match = {} }) => {
    const H = globalThis.__laf;
    for (const el of H.msgEls(id)) {
      const b = [...el.querySelectorAll(`button[data-action="${action}"]`)].find((x) => Object.entries(match).every(([k, v]) => x.dataset[k] === v));
      if (b && !b.disabled) { b.click(); return true; }
    }
    return false;
  },
  /** The lib's own press, called in this page where the card draws no button for it. */
  api: async ({ call, args }) => {
    const out = await acksExtras.lib.itemRun[call](args);
    return { ok: out?.ok ?? null, reason: out?.reason ?? null, state: out?.state ?? null, applied: out?.applied ?? null, refused: out?.refused ?? null };
  },

  fuses: ({ uuid }) => [...(fromUuidSync(uuid)?.effects ?? [])].filter((e) => e.flags?.["acks-extras"]?.fuse).map((e) => ({ id: e.id, fuse: foundry.utils.deepClone(e.flags["acks-extras"].fuse) })),
  hp: ({ tokenUuid }) => fromUuidSync(tokenUuid)?.actor?.system?.hp?.value ?? null,
  hull: ({ tokenUuid }) => fromUuidSync(tokenUuid)?.actor?.system?.shp?.value ?? null,
  quantity: ({ uuid }) => { const i = fromUuidSync(uuid); return i ? i.system.quantity : null; },
  exists: ({ uuid }) => !!fromUuidSync(uuid),
  centre: ({ tokenUuid }) => { const c = fromUuidSync(tokenUuid).getCenterPoint(); return { x: Math.round(c.x), y: Math.round(c.y) }; },
  saveTarget: ({ actorUuid, save }) => acksExtras.lib.saves.saveSpec(fromUuidSync(actorUuid), save)?.target ?? null,
  setSave: async ({ actorUuid, value }) => { await fromUuidSync(actorUuid).update({ "system.saves.blast.value": value }); return true; },
  own: async ({ uuid, playerId, level }) => { await fromUuidSync(uuid).update({ ownership: { default: 0, [playerId]: level } }); return true; },
  expected: ({ rolled, saved, reduction }) => acksExtras.lib.itemRun.logic.burstAmount({ rolled, saved, reduction, stages: [] }),
  judges: () => game.users.filter((u) => u.isGM).map((u) => u.id).sort(),
  roundSeconds: () => acksExtras.lib.timeUnit.roundSeconds(),
  worldTime: () => game.time.worldTime,
  started: () => !!game.combat?.started,
  advance: async ({ seconds }) => { await game.time.advance(seconds); await globalThis.__laf.sleep(1200); return game.time.worldTime; },

  /** Write an item's stack size. */
  setQuantity: async ({ uuid, quantity }) => { await fromUuidSync(uuid).update({ "system.quantity": quantity }); await globalThis.__laf.sleep(500); return true; },

  /** An item's row as the bearer's sheet says it: the row model the sheet is given, and the DOM's tag and presses, read on a fresh render of the sheet's tab. */
  rowRead: async ({ actorUuid, itemUuid, tab }) => {
    const H = globalThis.__laf;
    const V = await import("/modules/acks-extras/scripts/lib/item-run-row-view.mjs");
    const item = fromUuidSync(itemUuid);
    // A monster's default sheet is lib's Follower Card, which draws no item rows; the rows are the Full Monster sheet's Inventory tab, so that class is opened as itself on a fresh instance each read.
    const Full = Object.values(CONFIG.Actor.sheetClasses.monster ?? {}).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    const sheet = new Full({ document: fromUuidSync(actorUuid) });
    await sheet.render({ force: true });
    await H.until(() => sheet.rendered && sheet.element, 8000);
    if (tab) { try { await sheet.changeTab(tab, "primary", { force: true }); } catch { /* the sheet has no such tab */ } }
    const rowSel = `[data-item-id="${item.id}"] .acks-extras-run`;
    await H.until(() => sheet.element?.querySelector?.(rowSel), 5000);
    await H.sleep(300);
    const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    const model = V.itemRunRowFor(item);
    const run = sheet.element?.querySelector?.(rowSel) ?? null;
    const tag = run?.querySelector?.(".acks-tag") ?? null;
    const read = {
      model: model ? { state: model.state, tag: { label: model.tag.label, tip: model.tag.tip ?? "" }, presses: model.presses.map((p) => ({ key: p.key, label: p.label, disabled: p.disabled })) } : null,
      dom: run ? { state: run.dataset.runState ?? "", tag: txt(tag), tagTip: tag?.dataset.tooltipText ?? "", presses: [...run.querySelectorAll('button[data-action="itemRunPress"]')].map((b) => ({ press: b.dataset.press ?? null, label: b.getAttribute("aria-label") ?? "", text: txt(b), uuid: b.dataset.itemUuid ?? "" })) } : null,
    };
    try { await sheet.close({ animate: false }); } catch { /* closed */ }
    return read;
  },
  closeSheet: async ({ uuid }) => { try { await fromUuidSync(uuid).sheet.close({ animate: false }); } catch { /* closed */ } return true; },

  /** Open the Token HUD on a token and read its item controls (each one's accessible name). */
  hud: async ({ tokenUuid }) => {
    const H = globalThis.__laf;
    const tok = fromUuidSync(tokenUuid)?.object;
    if (!tok) return { ok: false, reason: "no token on this seat's canvas", controls: [] };
    try { tok.control({ releaseOthers: true }); } catch { /* the bind below still names the token */ }
    const bind = canvas.hud.bind ? canvas.hud : canvas.hud.token;
    await bind.bind(tok);
    const hud = canvas.hud.token;
    await H.until(() => hud.rendered && hud.element, 6000);
    await H.sleep(500);
    const controls = [...(hud.element?.querySelectorAll?.(".acks-extras-item-hud") ?? [])].map((b) => ({ label: b.getAttribute("aria-label") ?? "", active: b.classList.contains("active") }));
    return { ok: true, controls };
  },
  hudClose: () => { try { canvas.hud.clear(); } catch { /* none open */ } return true; },

  /** The Judges' whispered lines naming an item and a bearer since a moment. */
  whispers: ({ since, item, bearer }) => game.messages.filter((m) => Number(m.timestamp) >= since && (m.whisper ?? []).length && !m.flags?.["acks-extras"]?.itemRunCard && String(m.content).includes(item) && String(m.content).includes(bearer)).map((m) => ({ id: m.id, to: [...m.whisper].sort() })),
  deleteToken: async ({ uuid }) => { await fromUuidSync(uuid).delete(); await globalThis.__laf.sleep(1500); return true; },

  /** The combat the walk runs its fight in: the tracker's flags and the initiatives, no turn begun. */
  fight: async ({ combatId, rows, inits }) => {
    const combat = game.combats.get(combatId);
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    await combat.updateEmbeddedDocuments("Combatant", Object.keys(rows).map((k) => ({ _id: rows[k], initiative: inits[k], defeated: false, hidden: false })));
    combat.setupTurns();
    if (!combat.active && typeof combat.activate === "function") await combat.activate();
    return { order: combat.turns.map((t) => t.name), active: !!combat.active };
  },
  /** Begin a combatant's turn in a given round, as the tracker does; the turn edges it crosses are lib's. */
  turnTo: async ({ combatId, round, tokenId, ms = 1800 }) => {
    const combat = game.combats.get(combatId);
    const turn = combat.turns.findIndex((t) => t.tokenId === tokenId);
    if (turn < 0) return { ok: false, reason: "no combatant" };
    await combat.update({ round, turn });
    await globalThis.__laf.sleep(ms);
    return { ok: true, round: combat.round, turn: combat.turn, worldTime: game.time.worldTime };
  },
  deleteCombat: async ({ combatId }) => { await game.combats.get(combatId)?.delete(); await globalThis.__laf.sleep(1500); return true; },

  /** Pan to a point and click the board there, as a seat does; answers whether a pick banner stood and whether it is gone. */
  pickAt: async ({ x, y, arm }) => {
    const H = globalThis.__laf;
    const banner = () => !!document.querySelector(".acks-extras-pick-banner");
    const up = await H.until(banner, 4000, 100);
    if (!up) return { banner: false, gone: null };
    await canvas.animatePan({ x, y, scale: 0.5, duration: 0 });
    await H.sleep(400);
    const p = canvas.stage.worldTransform.apply(new PIXI.Point(x, y));
    const r = canvas.app.view.getBoundingClientRect();
    const s = { x: r.left + p.x, y: r.top + p.y };
    const fire = (type, extra = {}) => canvas.app.view.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: s.x, clientY: s.y, screenX: s.x, screenY: s.y, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, ...extra }));
    if (arm === "escape") {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    } else {
      canvas.app.render();
      fire("pointerover"); fire("pointermove");
      await H.sleep(40);
      fire("pointerdown", { buttons: 1 });
      await H.sleep(40);
      fire("pointerup");
    }
    await H.sleep(700);
    return { banner: true, gone: !banner() };
  },
  /** Close a pick the walk could not finish, so no catcher is left on the board. */
  cancelPick: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true; },

  /** The cards this page posted that the walk may claim: they carry a fixture item or name one. */
  claim: ({ itemUuids, names }) => {
    const out = [];
    for (const uuid of globalThis.__laf?.cards ?? []) {
      const m = fromUuidSync(uuid);
      if (!m) continue;
      const f = m.flags?.["acks-extras"] ?? {};
      if (itemUuids.includes(f.itemRunCard?.itemUuid) || names.some((n) => String(m.content ?? "").includes(n) || String(m.flavor ?? "").includes(n) || m.speaker?.alias === n)) out.push(uuid);
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
/** A stored card read on the GM seat, polled until `pred` holds of it (the last read comes back either way). */
const cardWhen = async (id, pred, ms = 10000, run = gmRun) => { let last = null; await until(async () => { last = await run(P.card, { id }); return last && pred(last) ? last : null; }, ms); return last; };
const read = async (run, id) => until(async () => run((a) => globalThis.__laf.read(a.id), { id }), 8000, 400);
const keyOf = (uuid) => uuid.replaceAll(".", "~");

const S = { playerId: null, combat: null, round: 0, scene: null };
const A = {};
const T = {};
const I = {};
const disposables = [];
let W = null;

async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name === "WalkBlocked") throw err;
    check(`${name} ran to its end`, false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
}

/** Bring the fixtures to a step's start shape: all home, hit points full, the item a stack, no fuse record, the Player's ownership as the step needs it. */
async function reset({ own = [], quantity = 5 } = {}) {
  const actors = Object.entries(ROLES).map(([k, r]) => ({ uuid: A[k].uuid, kind: r.type.endsWith("vehicle") ? "vehicle" : "body", owned: !!r.owned || own.includes(k), hp: HP, hull: HULL, save: SAVE_TARGET }));
  const tokens = Object.keys(ROLES).map((k) => ({ uuid: T[k].uuid, x: ROLES[k].at[0], y: ROLES[k].at[1] }));
  const items = [{ uuid: I.item.uuid, quantity }, { uuid: I.blank.uuid, quantity: 1 }];
  const out = await gmRun(P.reset, { view: S.scene, actors, tokens, items, playerId: S.playerId });
  if (!out.viewing || out.warnings.length) check("the fixtures reset to a step's start shape", false, out);
  return out;
}
const useItem = async (item, die) => {
  const r = await gmRun(P.use, { itemUuid: item.uuid, die });
  if (!r.messageId) throw new Error(`no card was posted for ${item.uuid} (${JSON.stringify(r.said)})`);
  return r;
};
const rowOf = (card, name) => card?.rows?.find((r) => r.name === name) ?? null;
const hasBtn = (btns, action) => (btns ?? []).some((b) => b.action === action);
/** Press a button on a seat with the die rigged on that seat for the press, restored after. */
async function press(run, { id, action, match = {} }, die = null) {
  if (die !== null) await run(P.rig, { value: DIE[die] });
  const found = await run(P.click, { id, action, match });
  return { found, restore: () => (die !== null ? run(P.rig, { value: null }) : null) };
}
const go = (role, round) => gmRun(P.turnTo, { combatId: S.combat.id, round, tokenId: T[role].id });

/** A walk's wall clock past which the seats are closed and the run ends, so a stuck press cannot wait on the world forever. */
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_500_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { gm?.close(); } catch {}
  try { pl?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

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
  W = gi.words;
  check("the GM seat is a GM and the primary one, the Player seat is not a GM", gi.isGM && gi.activeGMIsSelf && pi.isGM === false, { active: gi.activeGMIsSelf });
  if (!gi.activeGMIsSelf) blocked("another client is the active GM; the carrier would run there");
  for (const [run, who] of [[gmRun, "gm"], [plRun, "player"]]) {
    const c = await run(P.caught);
    check(`${who}: init, setup and ready reached with no console error`, ["init", "setup", "ready"].every((p) => c.boot?.phases.includes(p)) && c.boot.errors.length === 0, { phases: c.boot?.phases, errors: c.boot?.errors });
  }
  if (await gmRun(P.started)) blocked("a started combat is on the GM seat; the outside-a-fight steps need none");

  /* ---------------------------------------------------------------- */
  section("fixtures");
  const scene = await gm.fixture("lib/aura-fuse-scene", "Scene", { name: "Aura Fuse Square", width: 2400, height: 1800, padding: 0, grid: { size: 100, distance: 5, units: "ft", type: 1 } });
  S.scene = scene.uuid;
  for (const [k, r] of Object.entries(ROLES)) {
    const data = { name: r.name, type: r.type, ownership: { default: 0, [S.playerId]: r.owned ? 3 : 0 } };
    if (r.type !== "character") data.prototypeToken = { actorLink: true };
    A[k] = await gm.fixture(`lib/aura-fuse-${r.stem}`, "Actor", data);
    T[k] = await gm.fixture(`lib/aura-fuse-${r.stem}-token`, "Token", { name: r.name, actorId: A[k].id, actorLink: true, x: r.at[0], y: r.at[1] }, { parent: scene.uuid });
  }
  I.item = await gm.fixture("lib/aura-fuse-item", "Item", itemData(ITEM_NAME, "fuse", 5), { parent: A.B.uuid });
  I.blank = await gm.fixture("lib/aura-fuse-item-blank", "Item", itemData(BLANK_NAME, "blank", 1), { parent: A.B.uuid });
  note("fixtures", { actors: Object.keys(A).length, tokens: Object.keys(T).length, built: gm.tracked().length });
  note("figures read back on the gm seat (invented; the registry's layer, above any import)", gi.read);
  check("the invented figures read back on both seats", same(gi.read, FIGURES) && same(pi.read, FIGURES));
  await reset();
  note("the Player seat's view of the walk's scene", await plRun(P.view, { sceneUuid: S.scene }));
  const centreB = await gmRun(P.centre, { tokenUuid: T.B.uuid });

  /* ---------------------------------------------------------------- */
  await step("1", async () => {
    section("1 Light, not lit");
    await reset();
    const r = await useItem(I.item, DIE.mid);
    const card = await gmRun(P.card, { id: r.messageId });
    note("1 the die and the target as the card stored them", { natural: card.roll?.natural, target: card.roll?.target });
    check("1 the card is a fuse card whose outcome is unlit, the die neither a 1 nor a 20 and under the target", card.kind === "fuse" && card.outcome === "unlit" && card.roll.natural !== 1 && card.roll.natural !== 20 && card.roll.total < card.roll.target && card.roll.proficiencyRead === true && card.roll.proficient === false, { outcome: card.outcome, roll: card.roll });
    const dom = await read(gmRun, r.messageId);
    const row = rowOf(dom, W.light);
    check("1 the Light row reads Not lit and its target cell's tooltip names the page", row?.cells[W.colResult]?.text === W.unlit && row.cells[W.colTarget].tip.includes(W.cite), row?.cells);
    check("1 the card says the fuse is not lit and offers no Move the spot or Set it off now", dom.lines.includes(W.unlitLine) && !hasBtn(dom.footer, "itemRun.moveSpot") && !hasBtn(dom.footer, "itemRun.setOff"), { lines: dom.lines, footer: dom.footer.map((b) => b.action) });
    check("1 nothing was written: no fuse record on the bearer, the quantity unchanged", (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 0 && (await gmRun(P.quantity, { uuid: I.item.uuid })) === 5);
  });

  /* ---------------------------------------------------------------- */
  await step("2", async () => {
    section("2 Light, fumble");
    await reset();
    const r = await useItem(I.item, DIE.one);
    const card = await cardWhen(r.messageId, (c) => c.kind === "burst" && c.rolled !== null);
    check("2 the fumble burst at once: the card is the burst table and kept the light's outcome", card?.kind === "burst" && card.outcome === "fumble" && card.roll?.natural === 1, { kind: card?.kind, outcome: card?.outcome, natural: card?.roll?.natural });
    check("2 the burst is at the bearer's token centre and no fuse record was written", same(card?.spot && { x: card.spot.x, y: card.spot.y }, centreB) && (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 0, { spot: card?.spot, centre: centreB });
    check("2 the quantity fell by one", (await gmRun(P.quantity, { uuid: I.item.uuid })) === 4);
    const names = (card?.subjects ?? []).map((s) => s.name).sort();
    check("2 the table lists the bearer, the near body and the Player's character, and not the far body or the vessel", same(names, [ROLES.B.name, ROLES.N.name, ROLES.P.name].sort()) && card.vehicles.length === 0, { names, vehicles: card?.vehicles });
    check("2 the dice were rolled once for the area, within the dice's faces", Number.isInteger(card?.rolled) && card.rolled >= 1 && card.rolled <= 6, { rolled: card?.rolled, dice: card?.dice });
  });

  /* ---------------------------------------------------------------- */
  await step("3", async () => {
    section("3 The item is used up");
    await reset();
    const last = await gm.create("Item", itemData("Aura Fuse Last", "fuse", 1), { parent: A.B.uuid });
    disposables.push(last.uuid);
    const r = await useItem(last, DIE.one);
    await cardWhen(r.messageId, (c) => c.kind === "burst" && c.rolled !== null);
    check("3 the last one of a stack is deleted by the burst", (await gmRun(P.exists, { uuid: last.uuid })) === false);
  });

  /* ---------------------------------------------------------------- */
  await step("4", async () => {
    section("4 A blank figure");
    await reset();
    const r = await useItem(I.blank, DIE.top);
    const card = await gmRun(P.card, { id: r.messageId });
    const dom = await read(gmRun, r.messageId);
    const row = rowOf(dom, W.blankFumble);
    check("4 nothing was rolled and nothing written: roll null, outcome null, the fumble figure listed blank, no fuse record", card.roll === null && card.outcome === null && card.blank.includes("fumble") && (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 0, { roll: card.roll, outcome: card.outcome, blank: card.blank });
    check("4 the blank row shows no number and a tooltip that is the page reference alone", !!row && Object.values(row.cells).every((c) => !/\d/.test(c.text)) && Object.values(row.cells).some((c) => c.tip === W.cite), row?.cells);
    check("4 the card says the Judge decides, and the item is still held", dom.lines.includes(W.judgeLine) && (await gmRun(P.exists, { uuid: I.blank.uuid })) === true, { lines: dom.lines });
  });

  /* ---------------------------------------------------------------- */
  await step("5", async () => {
    section("5 Lit outside a fight: the world clock");
    await reset();
    const rs = await gmRun(P.roundSeconds);
    const t0 = await gmRun(P.worldTime);
    const r = await useItem(I.item, DIE.top);
    const card = await gmRun(P.card, { id: r.messageId });
    const fuses = await gmRun(P.fuses, { uuid: A.B.uuid });
    const count = card.fuse?.count;
    check("5 the fuse is lit on the world clock: a record with dueAt and no clock", card.outcome === "lit" && card.fuse?.combat === false && fuses.length === 1 && "dueAt" in fuses[0].fuse && !fuses[0].fuse.clock, { outcome: card.outcome, fuse: card.fuse });
    check("5 dueAt is the world time at the use plus the count of rounds, rounded up", fuses[0]?.fuse.dueAt === Math.ceil(t0 + count * rs), { dueAt: fuses[0]?.fuse.dueAt, t0, count, rs });
    const dom = await read(gmRun, r.messageId);
    check("5 the note reads the world-clock wording with the count", dom.note === await gmRun((a) => globalThis.__laf.fmt("ACKS-LIB.itemRun.card.stepsWorld", a), { n: count }), { note: dom.note });
    const due = fuses[0]?.fuse.dueAt;
    await gmRun(P.advance, { seconds: due - 1 - (await gmRun(P.worldTime)) });
    check("5 one second short of dueAt it is still lit", (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 1);
    await gmRun(P.rig, { value: DIE.top });
    await gmRun(P.advance, { seconds: 1 });
    await gmRun(P.rig, { value: null });
    const burst = await cardWhen(r.messageId, (c) => c.kind === "burst" && c.rolled !== null);
    check("5 the next second burst it: the record is deleted and the card became the table", (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 0 && burst?.kind === "burst", { kind: burst?.kind });
  });

  /* ---------------------------------------------------------------- */
  await step("6", async () => {
    section("6 The bearer's token is deleted");
    await reset();
    const actor = await gm.create("Actor", { name: "Aura Fuse Disposable", type: "monster", prototypeToken: { actorLink: true } });
    const item = await gm.create("Item", itemData("Aura Fuse Disposable Item", "fuse", 2), { parent: actor.uuid });
    const token = await gm.create("Token", { name: "Aura Fuse Disposable", actorId: actor.id, actorLink: true, x: 200, y: 200 }, { parent: S.scene });
    disposables.push(actor.uuid, item.uuid, token.uuid);
    const since = Date.now() - 2000;
    const r = await useItem(item, DIE.top);
    const lit = await gmRun(P.card, { id: r.messageId });
    check("6 the disposable bearer's fuse is lit", lit.outcome === "lit" && (await gmRun(P.fuses, { uuid: actor.uuid })).length === 1, { outcome: lit.outcome });
    const hpBefore = [await gmRun(P.hp, { tokenUuid: T.N.uuid }), await gmRun(P.hp, { tokenUuid: T.P.uuid })];
    await gmRun(P.deleteToken, { uuid: token.uuid });
    check("6 the record is gone and nothing burst: the card never became a table", (await gmRun(P.fuses, { uuid: actor.uuid })).length === 0 && (await gmRun(P.card, { id: r.messageId })).kind !== "burst");
    const told = await gmRun(P.whispers, { since, item: "Aura Fuse Disposable Item", bearer: "Aura Fuse Disposable" });
    check("6 one line is whispered to the Judges alone, naming the item and the bearer", told.length === 1 && same(told[0]?.to, await gmRun(P.judges)), told);
    check("6 no body took damage and the item was not used up", same(hpBefore, [await gmRun(P.hp, { tokenUuid: T.N.uuid }), await gmRun(P.hp, { tokenUuid: T.P.uuid })]) && (await gmRun(P.quantity, { uuid: item.uuid })) === 2);
  });

  /* ---------------------------------------------------------------- */
  await step("6b", async () => {
    section("6b Light and Lit: the bearer's sheet row and the Token HUD");
    await reset({ quantity: 1 });
    const fmt = (key, data) => gmRun((a) => globalThis.__laf.fmt(a.key, a.data), { key, data });
    const hud = async () => { const h = await gmRun(P.hud, { tokenUuid: T.B.uuid }); await gmRun(P.hudClose); return h; };
    const row = () => gmRun(P.rowRead, { actorUuid: A.B.uuid, itemUuid: I.item.uuid, tab: "inventory" });
    const wantHud = await fmt("ACKS-LIB.itemRun.hud.light", { item: ITEM_NAME });
    const hasHud = (h) => h.ok && h.controls.some((c) => c.label === wantHud);

    // Ready: a stack of one, nothing burning.
    const r0 = await row();
    check("6b before the light the row is ready and offers one press, Light, labelled with the localized press.light", r0.model?.state === "ready" && r0.model.presses.length === 1 && r0.model.presses[0].key === "light" && r0.model.presses[0].label === W.light && r0.model.presses[0].disabled === false, r0.model);
    const d0 = r0.dom?.presses.filter((p) => p.uuid === I.item.uuid) ?? [];
    check("6b the sheet draws that one button: press light, its accessible name the Light word", r0.dom?.state === "ready" && d0.length === 1 && d0[0].press === "light" && d0[0].label === W.light, r0.dom);
    const h0 = await hud();
    check("6b the Token HUD draws a control for the fuse whose accessible name is '{item} · Light' and ends with the Light word", hasHud(h0) && wantHud.endsWith(W.light), { want: wantHud, controls: h0.controls, ok: h0.ok });

    // Lit, a stack of one: no spare to light.
    const r = await useItem(I.item, DIE.top);
    const card = await gmRun(P.card, { id: r.messageId });
    const count = card.fuse?.count;
    check("6b the light took (a fuse lit on the world clock, a count of rounds)", card.outcome === "lit" && card.fuse?.combat === false && count >= 1, { outcome: card.outcome, fuse: card.fuse });
    const litTag = await fmt("ACKS-LIB.itemRun.strip.tag.lit", { n: count });
    const litTip = await fmt("ACKS-LIB.itemRun.strip.tagTip.lit", { n: count });
    const r1 = await row();
    check("6b lit on a stack of one the row model reads lit, its tag naming the rounds left, and offers no press", r1.model?.state === "lit" && r1.model.tag.label === litTag && r1.model.presses.length === 0, { model: r1.model, want: litTag });
    check("6b the sheet reads the same: state lit, the tag's text naming the rounds, its tooltip set, and no press drawn for the item", r1.dom?.state === "lit" && r1.dom.tag === litTag && r1.dom.tagTip === litTip && r1.dom.presses.filter((p) => p.uuid === I.item.uuid).length === 0, r1.dom);
    const h1 = await hud();
    check("6b the HUD draws no control for the burning fuse with no spare, and still draws the other fuse item's", h1.ok && !hasHud(h1) && h1.controls.some((c) => c.label.startsWith(BLANK_NAME)), { want: wantHud, controls: h1.controls, ok: h1.ok });

    // Lit, a stack of two: a spare.
    await gmRun(P.setQuantity, { uuid: I.item.uuid, quantity: 2 });
    const r2 = await row();
    check("6b with the stack raised to 2 while one burns the row is still lit and Light is offered again", r2.model?.state === "lit" && r2.model.presses.length === 1 && r2.model.presses[0].key === "light" && r2.model.presses[0].label === W.light, r2.model);
    const d2 = r2.dom?.presses.filter((p) => p.uuid === I.item.uuid) ?? [];
    check("6b the sheet draws the Light button beside the lit tag", r2.dom?.state === "lit" && r2.dom.tag === litTag && d2.length === 1 && d2[0].press === "light" && d2[0].label === W.light, r2.dom);
    const h2 = await hud();
    check("6b the HUD's Light control for the item is back", hasHud(h2), { want: wantHud, controls: h2.controls, ok: h2.ok });
    await gmRun(P.closeSheet, { uuid: A.B.uuid });
    await reset();
  });

  await step("6c", async () => {
    section("6c The second light: a stack of one already burning, from the Player's item.use() and from the Judge's");
    await reset({ own: ["B"], quantity: 1 });
    const fmt = (key, data) => gmRun((a) => globalThis.__laf.fmt(a.key, a.data), { key, data });
    const fuses = () => gmRun(P.fuses, { uuid: A.B.uuid });
    const refusedWord = await fmt("ACKS-LIB.itemRun.refused.noSpare", {});
    const warnWord = await fmt("ACKS-LIB.itemRun.warn.noSpare", { item: ITEM_NAME });
    const r = await useItem(I.item, DIE.top);
    const card = await gmRun(P.card, { id: r.messageId });
    const lit0 = await fuses();
    check("6c the first light took: one fuse record on the bearer", card.outcome === "lit" && lit0.length === 1, { outcome: card.outcome, fuses: lit0.length });

    // The Player that owns the bearer, through item.use() as a hotbar macro calls it.
    const pu = await plRun(P.useBare, { itemUuid: I.item.uuid, die: null });
    check("6c the Player's item.use() is refused on the Player's own window with the noSpare notice", pu.said.includes(`warn: ${refusedWord}`), { said: pu.said, want: refusedWord });
    await sleep(1500);
    const lit1 = await fuses();
    check("6c nothing was lit or written for the Player: the bearer still holds one fuse record", lit1.length === 1, { fuses: lit1.length });
    // The GM's window that ran the relayed use tells its own seat with an error toast; that one is the runner's notice, not a fault, and leaves the close's error record.
    // An error toast is recorded twice: by the notification wrapper as `toast: <text>` and by core's own console copy of the text (trailing space and all). Both are the one refusal; the count is the toasts.
    const gmToast = await gmRun((w) => { const H = globalThis.__laf; const toasts = H.errors.filter((e) => e === `toast: ${w}`.slice(0, 300)).length; H.errors = H.errors.filter((e) => e !== `toast: ${w}`.slice(0, 300) && e.trim() !== w.slice(0, 300)); return toasts; }, refusedWord);
    check("6c the GM's window told its own seat of the relayed refusal, once", gmToast === 1, { gmToast });

    // The Judge's own: warned, and the light goes on.
    const gu = await gmRun(P.useBare, { itemUuid: I.item.uuid, die: DIE.top });
    check("6c the Judge's item.use() is warned with the noSpare warning naming the item", gu.said.includes(`warn: ${warnWord}`), { said: gu.said, want: warnWord });
    const lit2 = await until(async () => { const f = await fuses(); return f.length === 2 ? f : null; }, 8000, 400);
    check("6c the Judge's light went on: a second fuse record on the bearer", lit2?.length === 2, { fuses: lit2?.length ?? (await fuses()).length });
    await reset();
  });

  /* ---------------------------------------------------------------- */
  section("the fight: steps 7 to 12");
  let fight = false;
  await step("fight", async () => {
    await reset();
    const sceneId = await gmRun((u) => fromUuidSync(u).id, S.scene);
    S.combat = await gm.create("Combat", { scene: sceneId, active: true });
    disposables.push(S.combat.uuid);
    const rows = {};
    for (const k of ["B", "N", "P"]) rows[k] = (await gm.create("Combatant", { tokenId: T[k].id, sceneId, actorId: A[k].id }, { parent: S.combat.uuid })).id;
    const made = await gmRun(P.fight, { combatId: S.combat.id, rows, inits: { B: 25, N: 20, P: 15 } });
    check("the walk's combat is the tracker's, its order set, no turn begun", made.active && made.order.length === 3, made);
    fight = made.active;
  });

  if (fight) {
    let burst = null;
    await step("7", async () => {
      section("7 Light, lit, in a fight: the clock, the stepping and the burst");
      await reset();
      const t0 = await gmRun(P.worldTime);
      const began = await go("B", ++S.round);
      const r = await useItem(I.item, DIE.top);
      const card = await gmRun(P.card, { id: r.messageId });
      const fuses = await gmRun(P.fuses, { uuid: A.B.uuid });
      const count = card.fuse?.count;
      const clock = fuses[0]?.fuse.clock;
      check("7 the fuse is lit on the bearer's clock, read off the card", card.outcome === "lit" && card.fuse?.combat === true && count >= 1 && clock?.combatId === S.combat.id && clock.edge === "end" && clock.count === count && clock.seen === 0, { outcome: card.outcome, fuse: card.fuse, clock });
      check("7 the spot is the bearer's token centre", same(fuses[0] && { x: fuses[0].fuse.spot.x, y: fuses[0].fuse.spot.y }, centreB), fuses[0]?.fuse.spot);
      const dom = await read(gmRun, r.messageId);
      check("7 the note reads 'Goes off at the end of the bearer's initiative' with the count, its tooltip carrying the page", dom.note === await gmRun((a) => globalThis.__laf.fmt("ACKS-LIB.itemRun.card.stepsCombat", a), { n: count, bearer: card.bearer.name }) && dom.noteTip.includes(W.cite), { note: dom.note, tip: dom.noteTip });
      check("7 the GM seat is offered Move the spot and Set it off now", hasBtn(dom.footer, "itemRun.moveSpot") && hasBtn(dom.footer, "itemRun.setOff"), dom.footer.map((b) => b.action));
      for (let k = 1; k <= count; k++) {
        await go("N", S.round);
        const mid = (await gmRun(P.fuses, { uuid: A.B.uuid }))[0]?.fuse.clock;
        check(`7 the bearer's turn ended (turn ${k}): the fuse still burns with seen ${k - 1}`, mid?.seen === k - 1, mid);
        await go("B", ++S.round);
        const after = (await gmRun(P.fuses, { uuid: A.B.uuid }))[0]?.fuse.clock;
        check(`7 the bearer's turn began (turn ${k}): seen is ${k} and nothing burst`, after?.seen === k && (await gmRun(P.card, { id: r.messageId })).kind === "fuse", after);
      }
      await gmRun(P.rig, { value: DIE.top });
      await go("N", S.round);
      await gmRun(P.rig, { value: null });
      burst = await cardWhen(r.messageId, (c) => c.kind === "burst" && c.rolled !== null);
      S.burstId = r.messageId;
      check("7 the next end of the bearer's turn deleted the record and posted the burst table", (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 0 && burst?.kind === "burst", { kind: burst?.kind });
      check("7 the quantity fell by one and the table lists the bearer, the near body and the Player's character, not the far one", (await gmRun(P.quantity, { uuid: I.item.uuid })) === 4 && same(burst.subjects.map((s) => s.name).sort(), [ROLES.B.name, ROLES.N.name, ROLES.P.name].sort()), burst.subjects.map((s) => s.name));
      note("T-0848: world time over the fight's rounds (the module's round length is the world-clock leg's only reading; nothing asserted)", { t0, atBearerTurn: began.worldTime, now: await gmRun(P.worldTime), roundSeconds: await gmRun(P.roundSeconds), rounds: S.round });
    });

    await step("8", async () => {
      section("8 The burst table: Save, the share, Apply, Apply all, Undo");
      if (!burst || burst.kind !== "burst") return skip("8", "step 7 left no burst table");
      const id = S.burstId;
      const tgt = await gmRun(P.saveTarget, { actorUuid: A.P.uuid, save: burst.saveName });
      if (tgt === null) await gmRun(P.setSave, { actorUuid: A.P.uuid, value: SAVE_TARGET });
      if ((await gmRun(P.saveTarget, { actorUuid: A.P.uuid, save: burst.saveName })) === null) return skip("8", "the Player's character reads no save target from a stored figure");
      const hp = async (k) => gmRun(P.hp, { tokenUuid: T[k].uuid });
      const before = { N: await hp("N"), B: await hp("B"), P: await hp("P") };
      const entryState = (k) => (c) => c.entries.find((x) => x.subject === T[k].uuid)?.state === "rolled";
      const sN = await press(gmRun, { id, action: "itemRun.roll", match: { subject: T.N.uuid } }, "one");
      await cardWhen(id, entryState("N"), 12000);
      await sN.restore();
      const sB = await press(gmRun, { id, action: "itemRun.roll", match: { subject: T.B.uuid } }, "top");
      await cardWhen(id, entryState("B"), 12000);
      await sB.restore();
      const sP = await press(plRun, { id, action: "itemRun.roll", match: { subject: T.P.uuid } }, "top");
      check("8 each seat found its own Save press (GM: near body and bearer; Player: its character)", sN.found && sB.found && sP.found, { N: sN.found, B: sB.found, P: sP.found });
      const rolled = await cardWhen(id, (c) => ["N", "B", "P"].every((k) => entryState(k)(c)), 15000);
      await sP.restore();
      const e = (k) => rolled?.entries.find((x) => x.subject === T[k].uuid);
      check("8 each entry waits as rolled, the failed one unsaved and the passed ones saved, nothing written to hit points", e("N")?.saved === false && e("B")?.saved === true && e("P")?.saved === true && before.N === await hp("N") && before.B === await hp("B") && before.P === await hp("P"), rolled?.entries);
      const wants = {};
      for (const k of ["N", "B", "P"]) wants[k] = await gmRun(P.expected, { rolled: burst.rolled, saved: e(k)?.saved === true, reduction: burst.reduction });
      const g = await read(gmRun, id);
      const cellOf = (dom, k) => rowOf(dom, ROLES[k].name)?.cells[W.damage]?.text;
      check("8 each row's damage is the rolled figure on a failure and the figure after the imported share on a pass (a row the module cannot settle shows none)", ["N", "B", "P"].every((k) => (wants[k].judge ? cellOf(g, k) === "" : cellOf(g, k) === String(wants[k].amount))), Object.fromEntries(["N", "B", "P"].map((k) => [k, { cell: cellOf(g, k), want: wants[k] }])));
      check("8 a pass takes less than the roll when a share is set", wants.B.judge || wants.B.amount < burst.rolled, { rolled: burst.rolled, passed: wants.B.amount });
      const p = await read(plRun, id);
      check("8 the Player's page lists only its own character's row and no vessel", p.rows.length === 1 && p.rows[0].name === ROLES.P.name, p.rows.map((r) => r.name));
      const stale = await plRun(P.api, { call: "applyEntry", args: { messageId: id, entryKey: keyOf(T.N.uuid) } });
      check("8 the Player's Apply for the near body is refused notOwner (the lib's call from that page: the card draws it no button)", stale.ok === false && stale.reason === "notOwner", stale);
      const ap = await press(plRun, { id, action: "itemRun.apply", match: { entryKey: keyOf(T.P.uuid) } });
      const applied = await cardWhen(id, (c) => c.entries.find((x) => x.subject === T.P.uuid)?.state === "applied", 12000);
      const eP = applied?.entries.find((x) => x.subject === T.P.uuid);
      check("8 the Player's Apply wrote its character's damage: hit points fell by exactly the entry's amount, the entry kept what it took", ap.found && eP?.state === "applied" && before.P - await hp("P") === eP.amount && (eP.amount === 0 || eP.hp?.[0]?.amount === eP.amount), { found: ap.found, amount: eP?.amount, hp: eP?.hp });
      const all = await press(gmRun, { id, action: "itemRun.applyAll" });
      const done = await cardWhen(id, (c) => ["N", "B"].every((k) => c.entries.find((x) => x.subject === T[k].uuid)?.state === "applied"), 15000);
      check("8 Apply all applied the near body and the bearer, and the Player's own row was not applied twice", all.found && ["N", "B"].every((k) => done?.entries.find((x) => x.subject === T[k].uuid)?.state === "applied") && before.P - await hp("P") === eP?.amount, done?.entries.map((x) => [x.subject, x.state, x.amount]));
      const eN = done?.entries.find((x) => x.subject === T.N.uuid);
      check("8 the near body's hit points fell by the entry's amount", before.N - await hp("N") === eN?.amount, { before: before.N, now: await hp("N"), amount: eN?.amount });
      const un = await press(gmRun, { id, action: "itemRun.undo", match: { entryKey: keyOf(T.N.uuid) } });
      await cardWhen(id, (c) => c.entries.find((x) => x.subject === T.N.uuid)?.state === "undone", 12000);
      check("8 Undo on the near body gave back exactly the hit points the entry took", un.found && await hp("N") === before.N, { before: before.N, now: await hp("N") });
      const upl = await press(plRun, { id, action: "itemRun.undo", match: { entryKey: keyOf(T.P.uuid) } });
      await cardWhen(id, (c) => c.entries.find((x) => x.subject === T.P.uuid)?.state === "undone", 12000);
      check("8 the Player's Undo on its own row gave its character's hit points back", upl.found && await hp("P") === before.P, { before: before.P, now: await hp("P") });
      const gd = await read(gmRun, id);
      const buildings = await gmRun((a) => globalThis.__laf.fmt("ACKS-LIB.itemRun.card.buildingsLine", a), { rolled: burst.rolled, cite: W.cite });
      const pLines = (await read(plRun, id)).lines;
      check("12 the GM seat's table carries the buildings line with the rolled total and the page, and the Player's page does not", gd.lines.includes(buildings) && !pLines.includes(buildings), { gm: gd.lines, player: pLines });
    });

    await step("9", async () => {
      section("9 Move the spot");
      await reset();
      await go("B", ++S.round);
      const r = await useItem(I.item, DIE.top);
      const id = r.messageId;
      check("9 the fuse is lit on the fight's clock", (await gmRun(P.card, { id })).fuse?.combat === true);
      const spotOf = async () => (await gmRun(P.fuses, { uuid: A.B.uuid }))[0]?.fuse.spot;
      const first = await spotOf();
      const pd = await read(plRun, id);
      check("9 a Player without ownership of the bearer is offered neither control", !hasBtn(pd.footer, "itemRun.moveSpot") && !hasBtn(pd.footer, "itemRun.setOff"), pd.footer.map((b) => b.action));
      const refused = await plRun(P.api, { call: "moveFuseSpot", args: { activationId: (await gmRun(P.card, { id })).activationId, spot: { sceneId: first.sceneId, x: 1500, y: 1500 } } });
      check("9 its moveFuseSpot call is refused notOwner and the spot is unchanged (the lib's call from that page: the card draws it no button)", refused.ok === false && refused.reason === "notOwner" && same(await spotOf(), first), refused);
      const pressed = await press(gmRun, { id, action: "itemRun.moveSpot" });
      const esc = await gmRun(P.pickAt, { x: VESSEL_SPOT.x, y: VESSEL_SPOT.y, arm: "escape" });
      check("9 Move the spot arms a pick with a banner, and Escape cancels it with the spot unchanged", pressed.found && esc.banner && esc.gone === true && same(await spotOf(), first), { pressed: pressed.found, esc });
      const again = await press(gmRun, { id, action: "itemRun.moveSpot" });
      const click = await gmRun(P.pickAt, { x: VESSEL_SPOT.x, y: VESSEL_SPOT.y, arm: "click" });
      let moved = await spotOf();
      const landed = Math.abs(moved.x - VESSEL_SPOT.x) <= 2 && Math.abs(moved.y - VESSEL_SPOT.y) <= 2;
      if (!landed) {
        await gmRun(P.cancelPick);
        note("9 the scripted click did not set the spot headless; the write is then driven through the lib's relay and the gesture is reported not proven", { click, moved });
        await gmRun(P.api, { call: "moveFuseSpot", args: { activationId: (await gmRun(P.card, { id })).activationId, spot: { sceneId: first.sceneId, x: VESSEL_SPOT.x, y: VESSEL_SPOT.y } } });
        moved = await spotOf();
      }
      check("9 the spot is where the board was clicked, on the same scene, a point far from the bearer accepted", again.found && moved.sceneId === first.sceneId && Math.abs(moved.x - VESSEL_SPOT.x) <= 2 && Math.abs(moved.y - VESSEL_SPOT.y) <= 2 && Math.abs(moved.y - first.y) > 300, { gesture: landed, moved, first });
      S.litId = id;
    });

    await step("10", async () => {
      section("10 Set it off now");
      const id = S.litId;
      if (!id || !(await gmRun(P.fuses, { uuid: A.B.uuid })).length) return skip("10", "step 9 left no lit fuse");
      const activationId = (await gmRun(P.card, { id })).activationId;
      const refused = await plRun(P.api, { call: "setFuseOffNow", args: { activationId } });
      check("10 before the grant the Player's setFuseOffNow is refused notOwner and the fuse stands (the lib's call)", refused.ok === false && refused.reason === "notOwner" && (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 1, refused);
      await gmRun(P.own, { uuid: A.B.uuid, playerId: S.playerId, level: 3 });
      await gmRun(P.touch, { id });
      const pd = await read(plRun, id);
      check("10 owning the bearer, the Player's page is offered Move the spot and Set it off now", hasBtn(pd.footer, "itemRun.moveSpot") && hasBtn(pd.footer, "itemRun.setOff"), pd.footer.map((b) => b.action));
      await gmRun(P.rig, { value: DIE.top });
      const off = await press(plRun, { id, action: "itemRun.setOff" });
      const b = await cardWhen(id, (c) => c.kind === "burst" && c.rolled !== null, 15000);
      await gmRun(P.rig, { value: null });
      check("10 the Player's press set it off: the record is deleted and the card became the table for the moved spot", off.found && (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 0 && b?.kind === "burst" && Math.abs(b.spot.x - VESSEL_SPOT.x) <= 2, { found: off.found, spot: b?.spot });
      check("10 the table lists the Player's character and the vessel and not the bearer", same(b?.subjects.map((s) => s.name), [ROLES.P.name]) && same(b?.vehicles.map((v) => v.name), [ROLES.V.name]), { subjects: b?.subjects, vehicles: b?.vehicles });
      S.vesselBurst = b;
      S.vesselId = id;
    });

    await step("11", async () => {
      section("11 Hand on");
      const b = S.vesselBurst;
      if (!b || b.kind !== "burst") return skip("11", "step 10 left no burst at the vessel");
      const id = S.vesselId;
      const row = b.vehicles[0];
      const hull0 = await gmRun(P.hull, { tokenUuid: T.V.uuid });
      let pd = await read(plRun, id);
      check("11 a Player without ownership of the vessel is shown no vessel row and no Hand on", !pd.rows.some((r) => r.name === ROLES.V.name) && !hasBtn(pd.rows.flatMap((r) => r.buttons), "itemRun.handOn"), pd.rows.map((r) => r.name));
      const refused = await plRun(P.api, { call: "handOn", args: { messageId: id, vehicleUuid: row.uuid } });
      check("11 its handOn call is refused notOwner and the hull is unchanged (the lib's call from that page)", refused.ok === false && refused.reason === "notOwner" && (await gmRun(P.hull, { tokenUuid: T.V.uuid })) === hull0, refused);
      await gmRun(P.own, { uuid: A.V.uuid, playerId: S.playerId, level: 3 });
      await gmRun(P.touch, { id });
      pd = await read(plRun, id);
      const vRow = rowOf(pd, ROLES.V.name);
      check("11 owning the vessel, the Player's page shows its row reading structure, with Hand on", !!vRow && vRow.cells[W.damage]?.text === W.structure && hasBtn(vRow.buttons, "itemRun.handOn"), vRow);
      const h = await press(plRun, { id, action: "itemRun.handOn", match: { vehicleUuid: row.uuid } });
      await cardWhen(id, (c) => c.vehicles[0]?.state === "handed", 12000);
      check("11 Hand on lowered the hull by the rolled total, never below nothing, and the row reads handed", h.found && (await gmRun(P.hull, { tokenUuid: T.V.uuid })) === Math.max(0, hull0 - b.rolled), { hull0, rolled: b.rolled, now: await gmRun(P.hull, { tokenUuid: T.V.uuid }) });
      const second = await plRun(P.api, { call: "handOn", args: { messageId: id, vehicleUuid: row.uuid } });
      check("11 a second press is refused as applied and the hull stands", second.ok === false && second.reason === "applied" && (await gmRun(P.hull, { tokenUuid: T.V.uuid })) === Math.max(0, hull0 - b.rolled), second);
    });

    await step("13", async () => {
      section("13 A fight ends");
      await gmRun(P.deleteCombat, { combatId: S.combat.id });
      await reset();
      const sceneId = await gmRun((u) => fromUuidSync(u).id, S.scene);
      S.combat = await gm.create("Combat", { scene: sceneId, active: true });
      disposables.push(S.combat.uuid);
      const rows = {};
      for (const k of ["B", "N"]) rows[k] = (await gm.create("Combatant", { tokenId: T[k].id, sceneId, actorId: A[k].id }, { parent: S.combat.uuid })).id;
      await gmRun(P.fight, { combatId: S.combat.id, rows, inits: { B: 25, N: 20 } });
      S.round = 0;
      await go("B", ++S.round);
      const r = await useItem(I.item, DIE.top);
      const count = (await gmRun(P.card, { id: r.messageId })).fuse?.count;
      check("13 lit on the fight's clock", (await gmRun(P.fuses, { uuid: A.B.uuid }))[0]?.fuse.clock?.count === count);
      await gmRun(P.deleteCombat, { combatId: S.combat.id });
      const f = (await gmRun(P.fuses, { uuid: A.B.uuid }))[0]?.fuse;
      const rs = await gmRun(P.roundSeconds);
      const now = await gmRun(P.worldTime);
      check("13 the fight's end moved the record to the world clock: dueAt, no clock, the rounds it had left", !!f && "dueAt" in f && !f.clock && f.dueAt === Math.ceil(now + count * rs), { f, now, count, rs });
      if (!f) return;
      await gmRun(P.rig, { value: DIE.top });
      await gmRun(P.advance, { seconds: f.dueAt - (await gmRun(P.worldTime)) });
      await gmRun(P.rig, { value: null });
      const b = await cardWhen(r.messageId, (c) => c.kind === "burst" && c.rolled !== null, 15000);
      check("13 the world clock reaching dueAt burst it", b?.kind === "burst" && (await gmRun(P.fuses, { uuid: A.B.uuid })).length === 0, { kind: b?.kind });
    });
  }

  const late = await gmRun(P.caught);
  const lateP = await plRun(P.caught);
  note("errors this walk's seats recorded after ready", { gm: late.errors, player: lateP.errors });
  check("neither seat logged a console error during the walk", late.errors.length === 0 && lateP.errors.length === 0, { gm: late.errors.length, player: lateP.errors.length });
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      const claim = { itemUuids: [I.item?.uuid, I.blank?.uuid, ...disposables].filter(Boolean), names: [ITEM_NAME, BLANK_NAME, "Aura Fuse Last", "Aura Fuse Disposable Item", "Aura Fuse Disposable", ...Object.values(ROLES).map((r) => r.name)] };
      for (const u of await gmRun(P.claim, claim)) disposables.push(gm.track(u, "ChatMessage"));
      if (pl) for (const u of await plRun(P.claim, claim)) disposables.push(gm.track(u, "ChatMessage"));
      const tracked = new Set(gm.tracked().map((e) => e.uuid));
      const sw = await gm.sweepTracked({ only: [...new Set(disposables)].filter((u) => tracked.has(u)) });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm) await gmRun(() => globalThis.__laf?.disarm?.()); } catch {}
  try { if (pl) await plRun(() => globalThis.__laf?.disarm?.()); } catch {}
  try { if (pl) await pl.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const id of skipped) console.log(`SKIP  ${id}`);
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  console.log(`SKIPPED ${skipped.length} step(s) not reached`);
  console.log(`SUMMARY lib/aura-fuse: ${passed}/${checks.length} checks passed${failed.length ? `; failed: ${failed.join(" | ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}
