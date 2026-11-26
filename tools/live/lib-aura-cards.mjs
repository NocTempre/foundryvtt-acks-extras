/**
 * Live walk, lib/aura-cards: the raised-item card, the whispered save, the "In
 * reach of" strip, the morale line, the edge distance and the Count in ticks, on
 * the GM seat and a real Player seat together.
 * Walks docs/lib/TESTING.md, "The aura reach and the item carrier", steps W1 to
 * W12 and W9a to W9i. Machine values arrive through ./_env.mjs. Both seats
 * reload under a load recorder added before the page's first script, so what
 * `init`, `setup` and `ready` log is read on each.
 *
 * Every figure is invented and registered for this run alone (a document of its
 * own, `live-aura-cards`, so no imported table is shadowed). Each item row
 * refers to its figures the way `scripts/monsters/gear-run.mjs` writes them:
 * `{doc, table, row, figure}`. The walk registers the table on both seats,
 * since a press resolves its figures on the seat that presses and a card on the
 * seat that renders it, and prints which figures it read.
 *
 * The Player seat presses by clicking the card's own button in its page: Save on the raised
 * card and on the whisper (W3), Undo (W7), the strip's Save (W9b, W9c) and Count in (W9f, once
 * the bearer is handed to it). The Judge seat presses W8's early Save and the rest of the
 * Judge's controls; the Player's early press, a forged Undo and a second press are the lib's
 * calls made in the Player's page, since the card draws no button for them, and each check says
 * so. Dice are rigged in the presser's page to decide a save and restored after each press.
 *
 * Fixtures, kept and found by marker (`api.fixture`):
 *   scenes `lib/aura-cards-scene` (square, 5 ft cells), `lib/aura-cards-scene-hex`
 *   and `lib/aura-cards-scene-gridless`;
 *   monsters `lib/aura-cards-save-bearer`, `lib/aura-cards-save-bearer-2` (the
 *   twin of the first, bearing an item of the same kind), `lib/aura-cards-standing-bearer`,
 *   `lib/aura-cards-once-bearer`, `lib/aura-cards-mine` (owned by the Player seat),
 *   `lib/aura-cards-other`, `lib/aura-cards-ally` and `lib/aura-cards-morale`;
 *   the character `lib/aura-cards-char` (owned by the Player seat); each actor's
 *   linked token `<actor marker>-token`, and `lib/aura-cards-hex-<role>-token`
 *   and `lib/aura-cards-gridless-<role>-token` for the bearer and three bodies on the
 *   other two scenes;
 *   items `lib/aura-cards-save-item` and `lib/aura-cards-save-item-2` (the save
 *   shape), `lib/aura-cards-standing-item`, `lib/aura-cards-once-item` and
 *   `lib/aura-cards-once-save-item`.
 * Each step writes the shape it needs at its start: no reach standing on a
 * fixture scene, no record of the carrier on a fixture actor, each item's rows,
 * the tokens placed with their group and disposition, the ownership of the
 * actors, the stored save figure. Nothing is rolled back at the end.
 *
 * The run's own products are tracked and swept by id: its combat, the plain
 * effects it puts on fixture actors to prove a removal leaves them, the cards
 * its client posted that name a fixture item or speak as a fixture, and any
 * Region left on a fixture scene. The fixtures stay.
 *
 * W10 presses the item the imported equipment rows mint, on a Beastman generated
 * from the imported family template (one body, its item and its token tracked by id and
 * swept); where the world holds no such import it prints `HELD W10` and the walk ends
 * WALK BLOCKED after W11 and W12. Steps that need what this walk cannot build print
 * `SKIP <step>: <reason>`; a SKIP is not a check and is counted apart. `SHOTS=1` also takes two plates
 * of the raised card at a 320 px chat width, one waiting and one answered.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = SHOTS ? shotDir() : null;

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

/** The module whose flags the fixtures carry. */
const MOD = "acks-extras";
/** The registry document and table this walk's invented figures live in, and the rows it names. */
const DOC = "live-aura-cards";
const TABLE = "figures";
const FIGURES = Object.freeze({
  save: { radius: 30, saveKind: "blast", immunityTurns: 3 },
  once: { radius: 30, damage: 2 },
  standing: { radius: 30, bonus: 1 },
  onceSave: { radius: 30, saveKind: "blast", immunityTurns: 3 },
});
/** A body's stored Blast figure: a natural 20 passes and a natural 1 fails whatever the modifiers of a monster. */
const SAVE_TARGET = 10;
/** `CONFIG.Dice.randomUniform` values that throw a natural 20 and a natural 1 on core 14. */
const DIE = Object.freeze({ pass: 0.025, fail: 0.975 });
/** The two groups the tokens are placed in: the bearers' own, and another. */
const G1 = "walk-aura-group-1";
const G2 = "walk-aura-group-2";

/** The bearers, the bodies and the character, by role: the actor's marker stem, name, kind, group, disposition and whether the Player seat owns it. */
const ROLES = Object.freeze({
  B: { stem: "save-bearer", name: "Aura Cards Save Bearer", type: "monster", group: G1, disposition: -1 },
  B2: { stem: "save-bearer-2", name: "Aura Cards Save Bearer Two", type: "monster", group: G1, disposition: -1 },
  BS: { stem: "standing-bearer", name: "Aura Cards Standing Bearer", type: "monster", group: G1, disposition: -1 },
  BO: { stem: "once-bearer", name: "Aura Cards Once Bearer", type: "monster", group: G1, disposition: -1 },
  M: { stem: "mine", name: "Aura Cards Mine", type: "monster", group: G2, disposition: 1, owned: true },
  O: { stem: "other", name: "Aura Cards Other", type: "monster", group: G2, disposition: 1 },
  A: { stem: "ally", name: "Aura Cards Ally", type: "monster", group: G1, disposition: -1 },
  R: { stem: "morale", name: "Aura Cards Morale", type: "monster", group: G1, disposition: -1 },
  C: { stem: "char", name: "Aura Cards Char", type: "character", group: G1, disposition: 1, owned: true },
});
/** Where an idle token waits: outside every ring the walk raises (the rings are centred left of x 1000). */
const HOME = Object.freeze({ B: [1500, 1300], B2: [1600, 1300], BS: [1700, 1300], BO: [1800, 1300], M: [1500, 1100], O: [1600, 1100], A: [1700, 1100], R: [1800, 1100], C: [1900, 1100] });

/** A figure reference as `gear-run.mjs` writes one. */
const ref = (row, figure) => ({ doc: DOC, table: TABLE, row, figure });
const filterOf = (unit = "any", side = "any", self = "no") => ({ kinds: [], exceptKinds: [], side, unit, self });
let COND = null;
const shapes = {
  /** The save shape (a toggle, `turnStart+moveIn`, a save and an immunity window, the condition folded onto a catalogue key). */
  save: ({ filter = filterOf(), showReach = false } = {}) => ({
    kind: "toggle", cookbook: { id: "walk.aura-cards.save", cite: "Aura Cards ref S" },
    rows: [{ key: "reach", type: "conditionGrant", conditions: [COND], reach: { radius: ref("save", "radius"), save: ref("save", "saveKind"), immunity: ref("save", "immunityTurns"), filter, pulse: "turnStart+moveIn", showReach } }],
  }),
  /** The standing shape (a toggle, `standing`, the bearer's unit and those under it, a part on armour class, attack and morale). */
  standing: ({ filter = filterOf("under"), showReach = false } = {}) => ({
    kind: "toggle", cookbook: { id: "walk.aura-cards.standing", cite: "Aura Cards ref T" },
    rows: [{ key: "reach", type: "modifier", reach: { radius: ref("standing", "radius"), modifier: ref("standing", "bonus"), on: ["ac", "attack", "morale"], filter, pulse: "standing", showReach } }],
  }),
  /** The once shape (`action`, the bearer's unit and those under it, a damage part that ends with the next attack). */
  once: () => ({
    kind: "once", cookbook: { id: "walk.aura-cards.once", cite: "Aura Cards ref O" },
    rows: [{ key: "reach", type: "modifier", reach: { radius: ref("once", "radius"), modifier: ref("once", "damage"), on: ["damage"], filter: filterOf("under"), pulse: "action", showReach: false }, endsOn: ["attack"] }],
  }),
  /** A once-only use that asks a save (a Judge-made item: no import mints one). */
  onceSave: () => ({
    kind: "once", cookbook: { id: "walk.aura-cards.once-save", cite: "Aura Cards ref OS" },
    rows: [{ key: "reach", type: "conditionGrant", conditions: [COND], reach: { radius: ref("onceSave", "radius"), save: ref("onceSave", "saveKind"), immunity: ref("onceSave", "immunityTurns"), filter: filterOf("under"), pulse: "action", showReach: false } }],
  }),
};
/** The item each bearer carries, by key: the owner role and the shape. */
const ITEMS = Object.freeze({
  S: { owner: "B", marker: "lib/aura-cards-save-item", name: "Aura Cards Save Item", shape: "save" },
  S2: { owner: "B2", marker: "lib/aura-cards-save-item-2", name: "Aura Cards Save Item", shape: "save" },
  T: { owner: "BS", marker: "lib/aura-cards-standing-item", name: "Aura Cards Standing Item", shape: "standing" },
  O: { owner: "BO", marker: "lib/aura-cards-once-item", name: "Aura Cards Once Item", shape: "once" },
  OS: { owner: "BO", marker: "lib/aura-cards-once-save-item", name: "Aura Cards Once Save Item", shape: "onceSave" },
});
const itemData = (spec) => {
  const s = shapes[spec.shape]();
  return {
    name: spec.name, type: "item",
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

/**
 * Reload one seat's page under the load recorder. A second DevTools session adds
 * it to every new document and stays open until the page is ready, since the
 * script lasts no longer than the session that added it.
 */
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

  /** A status the catalogue holds that is not a special one, for the save's failure to write. */
  pickCondition: () => {
    const ids = (CONFIG.statusEffects ?? []).map((s) => s.id);
    const special = new Set(Object.values(CONFIG.specialStatusEffects ?? {}));
    const want = ["slowed", "blinded", "prone", "deafened", "frightened", "stunned", "paralysed"];
    return want.find((k) => ids.includes(k)) ?? ids.find((id) => !special.has(id) && !/^(dead|defeated)/i.test(String(id))) ?? null;
  },

  /** Arm the recorders and the helpers every later call uses on this seat, and register the invented figures; replaces an earlier install in this page. */
  install: async ({ doc, table, figures }) => {
    globalThis.__lac?.disarm?.();
    const H = (globalThis.__lac = {});
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
    H.dice = null;
    H.rig = (v) => { H.dice ??= CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = () => v; };
    H.unrig = () => { if (H.dice) CONFIG.Dice.randomUniform = H.dice; H.dice = null; };
    H.disarm = () => {
      for (const fn of undo) fn();
      console.error = consoleError;
      window.removeEventListener("unhandledrejection", onReject);
      if (cmHad) CM.createDocuments = cmOriginal; else delete CM.createDocuments;
      H.unrig();
    };

    // The figures, registered above whatever the world imported, under a document no other code reads.
    const T = acksExtras.lib.tables;
    T.registerTable({ id: doc, source: "invented", tables: { [table]: figures } }, { priority: T.PRIORITY.OVERRIDE + 1, source: "live-test" });
    const read = Object.fromEntries(Object.entries(figures).map(([row, f]) => [row, Object.fromEntries(Object.keys(f).map((k) => [k, acksExtras.lib.tables.getDoc(doc).tables?.[table]?.[row]?.[k] ?? null]))]));

    const L = (key) => game.i18n.localize(key);
    const card = (k) => L(`ACKS-LIB.itemRun.card.${k}`);
    const col = (k) => L(`ACKS-LIB.rollCard.${k}`);
    H.words = {
      waiting: card("waiting"), asked: card("asked"), saved: card("saved"), failed: card("failed"), out: card("out"), notTarget: card("notTarget"), undetermined: card("undetermined"),
      counted: card("counted"), always: card("always"), undone: card("undone"), save: card("save"), rollSave: card("rollSave"), undo: card("undo"), countIn: card("countIn"), countOut: card("countOut"),
      check: card("check"), lower: card("lower"), bearer: card("bearer"), given: card("given"), colDistance: card("colDistance"), countSubjectRaisedTip: card("countSubjectRaisedTip"),
      colResult: col("colResult"), colActions: col("colActions"), colTarget: col("colTarget"), colTotal: col("colTotal"),
      tagOwed: L("ACKS-LIB.itemRun.strip.tag.owed"), tagFailed: L("ACKS-LIB.itemRun.strip.tag.failed"), tagAlways: L("ACKS-LIB.itemRun.strip.tag.always"), tagImmune: L("ACKS-LIB.itemRun.strip.tag.immune"),
      stripTitle: L("ACKS-LIB.itemRun.strip.title"), stripUnseen: L("ACKS-LIB.itemRun.strip.unseen"), inReachOf: L("ACKS-LIB.itemRun.strip.inReachOf"),
    };

    // Chat: the log must be rendered for a card's buttons to exist in this page.
    try {
      if (!ui.chat?.rendered) { await ui.hotbar?.render?.({ force: true }); await ui.chat.render({ force: true }); }
    } catch { /* the walk finds out when it looks for a card */ }

    /** The message ids of the raised or once card posted for an activation. */
    H.cardFor = (aid) => game.messages.find((m) => m.flags?.["acks-extras"]?.itemRunCard?.activationId === aid)?.id ?? null;
    H.msgEls = (id) => [...document.querySelectorAll(`li.chat-message[data-message-id="${id}"]`)];
    H.read = (id) => {
      const el = H.msgEls(id).find((e) => e.querySelector(".acks-extras-roll-card"));
      if (!el) return null;
      const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
      const btn = (b) => ({ action: b.dataset.action, label: txt(b), tip: b.dataset.tooltipText ?? "", subject: b.dataset.subject ?? "", entryKey: b.dataset.entryKey ?? "", disabled: b.disabled });
      const tables = [...el.querySelectorAll("table.acks-table")].map((t) => {
        const prev = t.previousElementSibling;
        const heads = [...t.querySelectorAll("thead th")].map(txt);
        const rows = [...t.querySelectorAll("tbody tr")].map((tr) => {
          const tds = [...tr.children];
          const cells = {};
          heads.forEach((h, i) => { cells[h] = { text: txt(tds[i]), tip: tds[i]?.dataset.tooltipText ?? "", bold: !!tds[i]?.querySelector("strong") }; });
          return { name: (tds[0]?.childNodes[0]?.textContent ?? "").trim(), cls: tr.className, cells, buttons: [...tr.querySelectorAll("button[data-action]")].map(btn) };
        });
        return { title: prev?.matches?.("h4") ? txt(prev) : "", heads, rows };
      });
      const content = el.querySelector(".message-content")?.innerHTML ?? "";
      let hash = 2166136261;
      for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619) >>> 0;
      return {
        title: txt(el.querySelector(".acks-chat-title")), subtitle: txt(el.querySelector(".acks-chat-subtitle")), note: txt(el.querySelector(".acks-extras-roll-note")),
        noteTip: el.querySelector(".acks-extras-roll-note")?.dataset.tooltipText ?? "", footnote: txt(el.querySelector(".acks-extras-roll-footnote")),
        footer: [...el.querySelectorAll("footer.acks-extras-roll-actions button")].map(btn), tables, hash, length: content.length,
      };
    };
    return { user: game.user.name, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, extras: game.modules.get("acks-extras")?.version, lib: acksExtras.lib.apiVersion, words: H.words, read, chat: !!ui.chat?.rendered };
  },

  /** What this seat's recorders caught since the install. */
  caught: () => ({ errors: globalThis.__lac?.errors ?? [], boot: globalThis.__auraBoot ?? null, said: (globalThis.__lac?.said ?? []).map((s) => `${s.kind}: ${s.text}`.slice(0, 160)) }),

  /** The Player seat's view of the scene: a Player may or may not switch scenes itself, and the walk says which. */
  view: async ({ sceneUuid }) => {
    const H = globalThis.__lac;
    const scene = fromUuidSync(sceneUuid);
    if (!scene) return { viewing: false, reason: "no scene" };
    let threw = null;
    if (canvas.scene?.id !== scene.id) {
      try { await scene.view(); } catch (e) { threw = String(e?.message ?? e); }
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 12000);
    }
    return { viewing: canvas.scene?.id === scene.id, threw, isGM: game.user.isGM };
  },

  /** Bring the fixtures to the shape a step starts from. */
  reset: async ({ view, scenes, items, actors, clear, tokens, playerId }) => {
    const H = globalThis.__lac;
    const out = { regions: 0, effects: 0, warnings: [] };
    if (view) {
      const scene = fromUuidSync(view);
      if (canvas.scene?.id !== scene.id) {
        await scene.view();
        await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 15000);
      }
      out.viewing = canvas.scene?.id === scene.id;
    }
    for (const uuid of scenes) {
      for (const r of [...(fromUuidSync(uuid)?.regions ?? [])]) {
        if ([...r.behaviors].some((b) => b.type === "acks-extras.aura")) { await r.delete(); out.regions += 1; }
      }
    }
    if (out.regions) await H.sleep(900);
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
      });
    }
    for (const a of actors) {
      const actor = fromUuidSync(a.uuid);
      const patch = { ownership: { default: 0, [playerId]: a.owned ? 3 : 0 } };
      if (a.saveTarget != null) patch["system.saves.blast.value"] = a.saveTarget;
      if (a.fullHp) { patch["system.hp.value"] = 8; patch["system.hp.max"] = 8; }
      await actor.update(patch);
      if (a.fullHp) {
        const dead = CONFIG.specialStatusEffects.DEFEATED;
        if (actor.statuses.has(dead)) await actor.toggleStatusEffect(dead, { active: false });
      }
    }
    for (const t of tokens) {
      await fromUuidSync(t.uuid).update({ x: t.x, y: t.y, hidden: false, disposition: t.disposition, "flags.acks-extras.group": t.group }, { animate: false });
    }
    await H.sleep(500);
    return out;
  },

  /** Use an item and wait for its card to settle: the activation, the message and the card's shape. */
  use: async ({ itemUuid }) => {
    const H = globalThis.__lac;
    const item = fromUuidSync(itemUuid);
    const before = new Set(game.messages.map((m) => m.id));
    await item.use();
    await H.sleep(300);
    const run = item.flags?.["acks-extras"]?.itemRun;
    const kind = run?.activation?.kind;
    let aid = run?.activation?.state?.activationId || null;
    let id = null;
    if (kind === "toggle" && aid) id = await H.until(() => H.cardFor(aid), 8000);
    else {
      id = await H.until(() => game.messages.find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.itemRunCard?.itemUuid === itemUuid)?.id ?? null, 8000);
      aid = id ? game.messages.get(id).flags["acks-extras"].itemRunCard.activationId : null;
    }
    let last = "";
    for (let i = 0; i < 20 && id; i++) {
      await H.sleep(400);
      const now = JSON.stringify(game.messages.get(id)?.flags?.["acks-extras"]?.itemRunCard ?? null);
      if (now === last) break;
      last = now;
    }
    return { ok: !!id, messageId: id, activationId: aid, kind, state: foundry.utils.deepClone(item.flags?.["acks-extras"]?.itemRun?.activation?.state ?? null), notes: H.said.slice(-3).map((s) => s.text.slice(0, 120)) };
  },

  /** Wait for a card to stop changing. */
  settle: async ({ id, ms = 800 }) => {
    const H = globalThis.__lac;
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

  /** A raised or once card's stored state. */
  card: ({ id }) => {
    const c = game.messages.get(id)?.flags?.["acks-extras"]?.itemRunCard;
    if (!c) return null;
    return {
      activationId: c.activationId, kind: c.kind, lowered: c.lowered === true, selfCount: c.selfCount === true, regionUuid: c.regionUuid, bearer: c.bearer, direct: c.direct === true,
      subjects: Object.values(c.subjects ?? {}).map((s) => ({ uuid: s.uuid, name: s.name, state: s.state, latest: s.latest })),
      undetermined: Object.values(c.undetermined ?? {}).map((s) => s.uuid),
      counted: Object.values(c.counted ?? {}).map((s) => s.uuid),
      entries: Object.entries(c.entries ?? {}).map(([key, e]) => ({ key, subject: e.subject, state: e.state, saved: e.saved ?? null, total: e.total ?? null, target: e.target ?? null, recordIds: e.recordIds ?? [], presser: e.presser ?? "", whisperId: e.whisperId ?? "", early: !!e.early, momentKey: e.momentKey ?? "" })),
    };
  },

  /** Every whispered save card of an activation: its recipients, subject, entry and answer. */
  whispers: ({ aid }) => game.messages
    .filter((m) => m.flags?.["acks-extras"]?.itemRunWhisper?.activationId === aid)
    .map((m) => ({ id: m.id, to: [...(m.whisper ?? [])].sort(), subject: m.flags["acks-extras"].itemRunWhisper.subject, entryKey: m.flags["acks-extras"].itemRunWhisper.entryKey, answered: m.flags["acks-extras"].itemRunWhisper.answered ?? null })),

  /** The users that own a document, by Foundry's own test, sorted. */
  owners: ({ uuid }) => {
    const doc = fromUuidSync(uuid);
    return game.users.filter((u) => doc?.testUserPermission?.(u, "OWNER")).map((u) => u.id).sort();
  },
  judges: () => game.users.filter((u) => u.isGM).map((u) => u.id).sort(),

  /** What an actor holds as effects, with the carrier's flags. */
  effects: ({ uuid }) => [...(fromUuidSync(uuid)?.effects ?? [])].map((e) => {
    const f = e.flags?.["acks-extras"] ?? {};
    return {
      id: e.id, name: e.name, statuses: [...(e.statuses ?? [])], run: f.itemRun ?? null, managed: !!f.managed, endsOn: f.endsOn ?? null,
      immune: (f.rollMods?.parts ?? []).some((p) => p.on === "immune"), partsOn: (f.rollMods?.parts ?? []).map((p) => `${p.on}${p.value !== undefined ? ":" + p.value : ""}`), cite: f.rollMods?.cite ?? null, turnLife: !!f.turnLife, mark: !!f.turnMark,
    };
  }),

  /** An item's stored carrier flag. */
  itemFlag: ({ uuid }) => foundry.utils.deepClone(fromUuidSync(uuid)?.flags?.["acks-extras"]?.itemRun ?? null),

  /** The aura Regions on a scene: id, visibility, hidden, the bearer token it follows. */
  regions: ({ sceneUuid }) => [...(fromUuidSync(sceneUuid)?.regions ?? [])]
    .filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura"))
    .map((r) => ({ id: r.id, uuid: r.uuid, visibility: r.visibility, hidden: r.hidden, visibleObject: r.object?.visible ?? null, tokens: [...(r.tokens ?? [])].map((t) => t.id) })),
  visibilityModes: () => ({ ...CONST.REGION_VISIBILITY }),

  /** Move tokens (by uuid) and wait for the region events to land. */
  move: async ({ moves, ms = 1500 }) => {
    const H = globalThis.__lac;
    for (const m of moves) await fromUuidSync(m.uuid).update({ x: m.x, y: m.y }, { animate: false });
    await H.sleep(ms);
    return true;
  },
  /** Patch a raised card's stored state (a stale row), as a window that missed an event would hold it. */
  patchCard: async ({ id, patch }) => {
    const base = "flags.acks-extras.itemRunCard";
    await game.messages.get(id).update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`${base}.${k}`, v])));
    await globalThis.__lac.sleep(600);
    return true;
  },

  /** Click a card's own button in this seat's page; false where it is not there. */
  click: ({ id, action, subject = null, label = null }) => {
    const H = globalThis.__lac;
    for (const el of H.msgEls(id)) {
      const b = [...el.querySelectorAll(`button[data-action="${action}"]`)].find((x) => (subject === null || x.dataset.subject === subject) && (label === null || x.textContent.replace(/\s+/g, " ").trim() === label));
      if (b && !b.disabled) { b.click(); return true; }
    }
    return false;
  },
  /** Rig a die for the press about to be made in this page, or restore it. */
  rig: ({ value }) => { const H = globalThis.__lac; if (value === null) H.unrig(); else H.rig(value); return true; },

  /** The lib's own presses, called in this page where the card has no button to click. */
  api: async ({ call, args }) => {
    const L = acksExtras.lib.itemRun;
    const out = await L[call](args);
    return { ok: out?.ok ?? null, reason: out?.reason ?? null, saved: out?.saved ?? null, removed: out?.removed ?? null };
  },

  /** The combat the walk runs its fight in: the tracker's flags, the initiatives, and no turn begun. */
  fight: async ({ combatId, rows, inits }) => {
    const combat = game.combats.get(combatId);
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    await combat.updateEmbeddedDocuments("Combatant", Object.keys(rows).map((k) => ({ _id: rows[k], initiative: inits[k], defeated: false, hidden: false })));
    combat.setupTurns();
    if (!combat.active && typeof combat.activate === "function") await combat.activate();
    return { order: combat.turns.map((t) => t.name), active: !!combat.active };
  },
  /** Begin a body's turn in a given round, as the tracker does, and wait for the reach's prompt to land. */
  turnTo: async ({ combatId, round, tokenId, ms = 2200 }) => {
    const H = globalThis.__lac;
    const combat = game.combats.get(combatId);
    const turn = combat.turns.findIndex((t) => t.tokenId === tokenId);
    if (turn < 0) return { ok: false, reason: "no combatant" };
    await combat.update({ round, turn });
    await H.sleep(ms);
    return { ok: true, round: combat.round, turn: combat.turn, up: combat.combatant?.name ?? null };
  },

  /** A body's save as the item row would roll it: the target the figures give. */
  target: ({ actorUuid, save }) => { const s = acksExtras.lib.saves?.saveSpec?.(fromUuidSync(actorUuid), save); return { target: s?.target ?? null, formula: s?.formula ?? null }; },
  turnSeconds: () => acksExtras.lib.timeUnit.turnSeconds(),
  worldTime: () => game.time.worldTime,

  /** The core save card a body rolls, which no module code touches. */
  coreSave: async ({ actorUuid }) => {
    const H = globalThis.__lac;
    const actor = fromUuidSync(actorUuid);
    const skip = game.settings.get("acks", "skip-dialog-key");
    const before = new Set(game.messages.map((m) => m.id));
    await actor.rollSave("blast", { event: { [skip]: true } });
    const id = await H.until(() => game.messages.find((m) => !before.has(m.id))?.id ?? null, 8000);
    return { id };
  },

  /** The cards this page posted that the walk may claim: they carry a fixture item, speak as a fixture, or name a fixture item. */
  claim: ({ itemUuids, aliases, names }) => {
    const H = globalThis.__lac;
    const out = [];
    for (const uuid of H.cards ?? []) {
      const m = fromUuidSync(uuid);
      if (!m) continue;
      const f = m.flags?.["acks-extras"] ?? {};
      const mine = itemUuids.includes(f.itemRunCard?.itemUuid) || itemUuids.includes(f.itemRunWhisper?.itemUuid)
        || aliases.includes(m.speaker?.alias) || names.some((n) => String(m.content ?? "").includes(n));
      if (mine) out.push(uuid);
    }
    return out;
  },

  /** Walk a scene's grid for the distance step: place the bearer and three bodies, raise the bearer's item, read the card's distances. */
  grid: async ({ sceneUuid, kind, tokens, itemUuid, playerId }) => {
    const H = globalThis.__lac;
    const scene = fromUuidSync(sceneUuid);
    if (canvas.scene?.id !== scene.id) { await scene.view(); await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 15000); }
    for (const r of [...scene.regions]) if ([...r.behaviors].some((b) => b.type === "acks-extras.aura")) await r.delete();
    await H.sleep(600);
    const g = scene.grid;
    const centre = (x, y) => ({ x: x + g.size / 2, y: y + g.size / 2 });
    const pos = {};
    const out = { kind, size: g.size, distance: g.distance, units: g.units, expect: {} };
    if (kind === "hex") {
      const b = { i: 6, j: 6 };
      const adj = g.getAdjacentOffsets?.(b);
      if (!Array.isArray(adj) || adj.length < 2) return { ...out, ok: false, reason: "this grid offers no adjacent offsets" };
      const key = (o) => `${o.i},${o.j}`;
      const near = new Set([key(b), ...adj.map(key)]);
      const touch = adj[0];
      const far = (g.getAdjacentOffsets(touch) ?? []).filter((o) => !near.has(key(o)));
      if (far.length < 2) return { ...out, ok: false, reason: "no offset two cells from the bearer" };
      const at = (o) => { const p = g.getTopLeftPoint(o); return [p.x, p.y]; };
      Object.assign(pos, { B: at(b), M: at(touch), O: at(far[0]), A: at(far[1]) });
      out.expect = { M: 0, O: g.distance };
    } else {
      Object.assign(pos, { B: [700, 700], M: [800, 700], O: [900, 700], A: [900, 900] });
      const diag = kind === "square" ? g.measurePath([{ x: 50, y: 50 }, { x: 150, y: 150 }]).distance : g.distance * Math.SQRT2;
      out.expect = { M: 0, O: g.distance, A: Math.round(diag) };
    }
    for (const role of ["B", "M", "O", "A"]) await fromUuidSync(tokens[role]).update({ x: pos[role][0], y: pos[role][1], hidden: false }, { animate: false });
    await H.sleep(500);
    const item = fromUuidSync(itemUuid);
    const before = new Set(game.messages.map((m) => m.id));
    await item.use();
    await H.sleep(300);
    const aid = item.flags?.["acks-extras"]?.itemRun?.activation?.state?.activationId || null;
    const id = aid ? await H.until(() => H.cardFor(aid), 8000) : null;
    await H.sleep(2500);
    const card = id ? H.read(id) : null;
    const rows = Object.fromEntries((card?.tables ?? []).flatMap((t) => t.rows).map((r) => [r.name, r.cells?.[H.words.colDistance]?.text ?? null]));
    for (const r of [...scene.regions]) if ([...r.behaviors].some((b) => b.type === "acks-extras.aura")) await r.delete();
    await H.sleep(700);
    return { ...out, ok: !!card, aid, id, rows, newMessages: game.messages.filter((m) => !before.has(m.id)).length };
  },

  /** Open the morale page for a body and roll it; return the card the roll posted. */
  morale: async ({ actorUuid }) => {
    const H = globalThis.__lac;
    const infl = acksExtras.influence;
    if (typeof infl?.open !== "function") return { opened: false, reason: "no influence api" };
    const actor = fromUuidSync(actorUuid);
    const before = new Set(game.messages.map((m) => m.id));
    await infl.open(null, { mode: "morale", targetActor: actor });
    const app = await H.until(() => [...foundry.applications.instances.values()].find((a) => a.constructor?.name === "InfluenceApp" && a.rendered), 8000);
    if (!app) return { opened: false, reason: "the page did not render" };
    const rollBtn = app.element?.querySelector?.('[data-action="roll"]');
    if (!rollBtn) { await app.close({ animate: false }); return { opened: true, rolled: false, reason: "no Roll control" }; }
    rollBtn.click();
    const id = await H.until(() => game.messages.find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.mode === "morale")?.id ?? null, 10000);
    const msg = id ? game.messages.get(id) : null;
    const html = msg?.content ?? "";
    const tips = [...html.matchAll(/data-tooltip-text="([^"]*)"/g)].map((m) => m[1]);
    try { await app.close({ animate: false }); } catch { /* closed */ }
    return { opened: true, rolled: !!msg, id, uuid: msg?.uuid ?? null, content: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), tips };
  },

  /**
   * The imported equipment rows whose minted item the carrier runs, one row key per activation kind (`toggle`, `once`), or null for a kind
   * no row mints. Read only; the key is read at run time and never written here.
   */
  w10Rows: async () => {
    const O = await import("/modules/acks-extras/scripts/monsters/organisation.mjs");
    const org = O.importedOrganisation();
    const out = { toggle: null, once: null };
    for (const row of org?.equipment?.rows ?? []) {
      for (const item of O.carriedGearItems(row.key, org) ?? []) {
        const kind = item?.flags?.["acks-extras"]?.itemRun?.activation?.kind;
        if (kind in out && !out[kind]) out[kind] = row.key;
      }
    }
    return out;
  },

  /**
   * One Beastman from the imported family template, given the item the imported row mints (`carriedGearItems`, the call a deploy's
   * carry takes) and a linked token on the scene. Answers each uuid the moment it exists, so a failure part way leaves ids to sweep.
   */
  w10Make: async ({ sceneUuid, rowKey, x, y }) => {
    const out = { ok: false, held: 0, actor: null, name: null, item: null, token: null };
    try {
      const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
      const GEN = await import("/modules/acks-extras/scripts/lib/template-generate.mjs");
      const O = await import("/modules/acks-extras/scripts/monsters/organisation.mjs");
      const held = (await CB.importedDocs("Actor")).filter((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id === "mm.familyBeastman");
      out.held = held.length;
      if (held.length !== 1) return { ...out, reason: "template" };
      const actor = await GEN.generateFromTemplate(held[0]);
      if (!actor) return { ...out, reason: "generate" };
      out.actor = actor.uuid;
      out.name = actor.name;
      const wanted = (O.carriedGearItems(rowKey) ?? []).filter((i) => i?.flags?.["acks-extras"]?.itemRun?.activation?.kind);
      const [item] = await actor.createEmbeddedDocuments("Item", wanted.slice(0, 1));
      out.item = item?.uuid ?? null;
      const data = (await actor.getTokenDocument({ x, y })).toObject();
      delete data._id;
      data.actorLink = true;
      const [token] = await fromUuidSync(sceneUuid).createEmbeddedDocuments("Token", [data]);
      out.token = token?.uuid ?? null;
      out.ok = !!out.item && !!out.token;
      return out;
    } catch (err) {
      return { ...out, reason: String(err?.message ?? err).slice(0, 200) };
    }
  },

  /** Sheet: open an actor's sheet in this seat and read its strip (rows and the surrounding frame). */
  strip: async ({ actorUuid, open = true }) => {
    const H = globalThis.__lac;
    const actor = fromUuidSync(actorUuid);
    const sheet = actor.sheet;
    if (open && !sheet.rendered) await sheet.render({ force: true });
    const el = await H.until(() => sheet.element, 6000);
    await H.sleep(open ? 900 : 100);
    const root = sheet.element ?? el;
    const strip = root?.querySelector?.(".acks-extras-reach-strip") ?? null;
    const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    let scrolls = null;
    let aboveTabs = null;
    if (strip) {
      for (let n = strip.parentElement; n && n !== root.parentElement; n = n.parentElement) {
        if (["auto", "scroll"].includes(getComputedStyle(n).overflowY)) { scrolls = true; break; }
      }
      const tabs = root.querySelector("nav.tabs, .sheet-tabs, [role='tablist']");
      aboveTabs = tabs ? !!(strip.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    }
    return {
      sheet: sheet.constructor.name, rendered: !!sheet.rendered, has: !!strip, scrolls, aboveTabs, title: txt(strip?.querySelector("h3")),
      rows: [...(strip?.querySelectorAll(".acks-extras-reach-strip__row") ?? [])].map((r) => ({
        key: r.dataset.reach, name: txt(r.querySelector("strong")), tag: txt(r.querySelector(".acks-tag")), tagTip: r.querySelector(".acks-tag")?.dataset.tooltipText ?? "",
        line: txt(r.querySelector(".acks-extras-reach-strip__line")),
        nums: [...r.querySelectorAll(".acks-extras-reach-strip__line .acks-nums")].map((n) => ({ text: txt(n), tip: n.dataset.tooltipText ?? "" })),
        leftText: txt(r.querySelector(".acks-tag .acks-nums")),
        buttons: [...r.querySelectorAll("button[data-action]")].map((b) => ({ action: b.dataset.action, label: txt(b), subject: b.dataset.subject, entryKey: b.dataset.entryKey, messageId: b.dataset.messageId })),
      })),
    };
  },
  /** Click the strip's Save in this seat's open sheet. */
  stripSave: ({ actorUuid }) => {
    const b = fromUuidSync(actorUuid).sheet.element?.querySelector?.('.acks-extras-reach-strip button[data-action="reachStripSave"]');
    if (!b) return false;
    b.click();
    return true;
  },
  closeSheet: async ({ actorUuid }) => { try { await fromUuidSync(actorUuid).sheet.close({ animate: false }); } catch { /* closed */ } return true; },
  /** The strip model the seat's own API reads for an actor, null where the strip is absent. */
  stripModel: ({ actorUuid }) => { const s = acksExtras.lib.itemRun.reachStrip(fromUuidSync(actorUuid)); return s ? { count: s.count } : null; },
  /** The name core shows this seat for a token. */
  shownName: ({ tokenUuid }) => {
    const t = fromUuidSync(tokenUuid);
    const modes = CONST.TOKEN_DISPLAY_MODES;
    const hidden = t.isSecret === true || t.displayName === modes.NONE || ((t.displayName === modes.OWNER || t.displayName === modes.OWNER_HOVER) && t.testUserPermission?.(game.user, "OWNER") !== true);
    return { name: hidden ? null : t.name };
  },

/** The tooltip of a card button, by action and subject, or null where it is not drawn. */
  tipOf: ({ id, action, subject }) => {
    const b = globalThis.__lac.msgEls(id).flatMap((e) => [...e.querySelectorAll(`button[data-action="${action}"]`)]).find((x) => x.dataset.subject === subject);
    return b?.dataset.tooltipText ?? null;
  },

  /** The popout log at the plate's width, scrolled to a card; returns the selector to clip to. */
  popout: async ({ id, width }) => {
    const H = globalThis.__lac;
    await ui.hotbar.render(true);
    const pop = await ui.chat.renderPopout();
    await H.sleep(1500);
    pop.setPosition({ left: 16, top: 16, width, height: 860 });
    await H.sleep(600);
    const sel = `#${pop.id} li.chat-message[data-message-id="${id}"] .message-content`;
    document.querySelector(sel)?.scrollIntoView({ block: "nearest" });
    await H.sleep(600);
    H.popout = pop;
    return { sel, found: !!document.querySelector(sel) };
  },
  closePopout: async () => { const p = globalThis.__lac?.popout; if (p) { try { await p.close({ animate: false }); } catch { /* closed */ } globalThis.__lac.popout = null; } return true; },
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
/** A card read on a seat, polled until `pred` holds of it (the last read comes back either way). */
async function waitCard(run, id, pred, ms = 9000) {
  let last = null;
  await until(async () => { last = await run(P_read, { id }); return last && pred(last) ? last : null; }, ms, 500);
  return last;
}
/** The read function, as a named page function. */
const P_read = (a) => globalThis.__lac.read(a.id);

const rowsOf = (card) => (card?.tables ?? []).flatMap((t) => t.rows.map((r) => ({ ...r, section: t.title })));
const rowNamed = (card, name) => rowsOf(card).find((r) => r.name === name) ?? null;
let W = null;
const outcomeOf = (row) => row?.cells?.[W.colResult]?.text ?? "";
const hasBtn = (row, action) => (row?.buttons ?? []).some((b) => b.action === action);
const anyBtn = (card, action) => rowsOf(card).some((r) => hasBtn(r, action)) || (card?.footer ?? []).some((b) => b.action === action);
const muted = (row) => !!row && String(row.cls).includes("is-muted") && !Object.values(row.cells).some((c) => c.bold);

const S = { round: 0, combat: null, playerViews: false, playerId: null };
const NAME = Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, r.name]));
const A = {};
const T = {};
const I = {};
const SC = {};
const TK = { hex: {}, gridless: {} };
const disposables = [];
/** What W10's generated bodies add to the teardown's claim: the item uuids and the names their cards speak as. */
const W10 = { itemUuids: [], aliases: [] };
/** Why W10 could not run on this world; the walk ends WALK BLOCKED with it after W11 and W12, never earlier. */
let w10Hold = null;
const marked = (marker) => (MACHINE.own ? `${marker}@${MACHINE.own}` : marker);

/** A step runs on its own: a throw is a failed check and the walk goes on, unless the world is not the walk's to drive. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name === "WalkBlocked") throw err;
    check(`${name} ran to its end`, false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
}

/** Bring the fixtures to a step's start shape. `place` names the roles that stand in a ring: `{role: [x, y]}`; every other token goes home. */
async function reset({ place = {}, over = {}, view = SC.main, owned = true } = {}) {
  const items = Object.entries(ITEMS).map(([k, spec]) => {
    const s = (over[k] ?? shapes[spec.shape])();
    return { uuid: I[k].uuid, rows: s.rows, kind: s.kind, cookbook: s.cookbook };
  });
  const tokens = Object.keys(ROLES).map((k) => {
    const [x, y] = place[k] ?? HOME[k];
    return { uuid: T[k].uuid, x, y, group: ROLES[k].group, disposition: ROLES[k].disposition };
  });
  const actors = Object.entries(ROLES).map(([k, r]) => ({ uuid: A[k].uuid, owned: owned && !!r.owned, saveTarget: r.type === "monster" ? SAVE_TARGET : null, fullHp: k.startsWith("B") }));
  return gmRun(P.reset, { view, scenes: [SC.main, SC.hex, SC.gridless], items, actors, clear: Object.keys(ROLES).map((k) => A[k].uuid), tokens, playerId: S.playerId });
}
/** A ring layout: the bearer, its bodies near it. */
const RING = Object.freeze({ B: [700, 700], M: [800, 700], O: [900, 700], A: [900, 900] });

/** The page's own copy of a raised item's use: raise it on this seat and settle. */
const raise = (key) => gmRun(P.use, { itemUuid: I[key].uuid });
/** Press a card's button on a seat, with the die rigged there for the press, and restore it after. */
async function press(run, { id, action, subject = null, label = null }, die = null) {
  if (die !== null) await run(P.rig, { value: DIE[die] });
  const found = await run(P.click, { id, action, subject, label });
  return { found, restore: async () => { if (die !== null) await run(P.rig, { value: null }); } };
}
/** The open or answered entry of a body on a card. */
const entryOf = (card, uuid, pred = () => true) => card?.entries?.filter((e) => e.subject === uuid && pred(e)).at(-1) ?? null;
/** The record ids and kinds of an actor's carrier effects. */
const carrier = async (key) => (await gmRun(P.effects, { uuid: A[key].uuid })).filter((e) => e.run);
const nextRound = () => ++S.round;
const turn = (role, ms) => gmRun(P.turnTo, { combatId: S.combat.id, round: nextRound(), tokenId: T[role].id, ms });

/* A wall clock past which the seats are closed and the run ends, since a stuck press would otherwise wait on the world. */
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
  COND = await gmRun(P.pickCondition);
  if (!COND) blocked("the status catalogue offers no condition for a failed save to write");

  const install = { doc: DOC, table: TABLE, figures: FIGURES };
  const gi = await gmRun(P.install, install);
  const pi = await plRun(P.install, install);
  W = gi.words;
  note("gm", { user: gi.user, extras: gi.extras, lib: gi.lib, chatRendered: gi.chat });
  note("player", { extras: pi.extras, chatRendered: pi.chat });
  note("figures read back on the gm seat (invented; the registry's layer, above any import)", gi.read);
  note("figures read back on the player seat", pi.read);
  const figuresOk = (r) => same(r, FIGURES);
  check("the invented figures read back on both seats", figuresOk(gi.read) && figuresOk(pi.read), { gm: figuresOk(gi.read), player: figuresOk(pi.read) });
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
  const grid = (type) => ({ size: 100, distance: 5, units: "ft", type });
  const scMain = await gm.fixture("lib/aura-cards-scene", "Scene", { name: "Aura Cards Square", width: 2000, height: 1400, padding: 0, grid: grid(1) });
  const scHex = await gm.fixture("lib/aura-cards-scene-hex", "Scene", { name: "Aura Cards Hex", width: 2000, height: 1400, padding: 0, grid: grid(2) });
  const scNone = await gm.fixture("lib/aura-cards-scene-gridless", "Scene", { name: "Aura Cards Gridless", width: 2000, height: 1400, padding: 0, grid: grid(0) });
  Object.assign(SC, { main: scMain.uuid, hex: scHex.uuid, gridless: scNone.uuid });
  for (const [k, r] of Object.entries(ROLES)) {
    const data = { name: r.name, type: r.type, ownership: { default: 0, [S.playerId]: r.owned ? 3 : 0 } };
    if (r.type === "monster") data.prototypeToken = { actorLink: true, disposition: r.disposition };
    A[k] = await gm.fixture(`lib/aura-cards-${r.stem}`, "Actor", data);
  }
  for (const [k, spec] of Object.entries(ITEMS)) I[k] = await gm.fixture(spec.marker, "Item", itemData(spec), { parent: A[spec.owner].uuid });
  const token = (marker, role, scene, [x, y]) => gm.fixture(marker, "Token", { name: ROLES[role].name, actorId: A[role].id, actorLink: true, x, y, disposition: ROLES[role].disposition }, { parent: scene });
  for (const k of Object.keys(ROLES)) T[k] = await token(`lib/aura-cards-${ROLES[k].stem}-token`, k, SC.main, HOME[k]);
  for (const k of ["B", "M", "O", "A"]) {
    TK.hex[k] = await token(`lib/aura-cards-hex-${ROLES[k].stem}-token`, k, SC.hex, [100, 100]);
    TK.gridless[k] = await token(`lib/aura-cards-gridless-${ROLES[k].stem}-token`, k, SC.gridless, [100, 100]);
  }
  note("fixtures", { actors: Object.keys(A).length, items: Object.keys(I).length, tokens: Object.keys(T).length + 8, built: gm.tracked().length });

  /* The Player seat: the scene it sees, which strips and the region's drawing need. */
  const first = await reset({ place: RING });
  check("the shape reset ran on a clean fixture scene", first.viewing === true && first.warnings.length === 0, first);
  const pv = await plRun(P.view, { sceneUuid: SC.main });
  S.playerViews = pv.viewing === true;
  note("the Player seat's view of the walk's scene", pv);

  const itemUuids = Object.values(I).map((i) => i.uuid);
  const fixtureNames = [...new Set(Object.values(ITEMS).map((s) => s.name))];
  const fixtureAliases = Object.values(ROLES).map((r) => r.name);

  /* ---------------------------------------------------------------- */
  await step("W1", async () => {
    section("W1 raise outside a fight, bodies already inside");
    check("no fight is running on the walk's scene", !(await gmRun(() => !!game.combat?.started)));
    await reset({ place: RING });
    const r = await raise("S");
    check("W1 the raise posted a card", r.ok && r.kind === "toggle" && r.state?.active === true, { ok: r.ok, state: r.state, notes: r.notes });
    const cards = await gmRun((a) => game.messages.filter((m) => m.flags?.["acks-extras"]?.itemRunCard?.activationId === a).length, r.activationId);
    check("W1 one raised card for the activation", cards === 1, { cards });
    const card = await waitCard(gmRun, r.messageId, (c) => ["M", "O", "A"].every((k) => rowNamed(c, NAME[k])));
    const rows = Object.fromEntries(["M", "O", "A"].map((k) => [k, rowNamed(card, NAME[k])]));
    check("W1 each body is a waiting row", ["M", "O", "A"].every((k) => outcomeOf(rows[k]) === W.waiting), { ...Object.fromEntries(Object.entries(rows).map(([k, row]) => [k, outcomeOf(row)])), heads: (card?.tables ?? []).map((t) => t.heads), keys: Object.fromEntries(Object.entries(rows).map(([k, row]) => [k, Object.keys(row?.cells ?? {})])) });
    const feet = Object.fromEntries(Object.entries(rows).map(([k, row]) => [k, row?.cells?.[W.colDistance]?.text ?? ""]));
    check("W1 each body carries a distance in feet", Object.values(feet).every((t) => /^\d+′$/.test(t)), feet);
    const tipWant = await gmRun((a) => game.i18n.format("ACKS-LIB.itemRun.card.tip.distance", a), { feet: parseInt(feet.O, 10), name: NAME.B });
    check("W1 a distance's tooltip names the measurement, between the nearest edges, from the bearer", rows.O?.cells?.[W.colDistance]?.tip === tipWant, { tip: rows.O?.cells?.[W.colDistance]?.tip });
    const bearerRow = rowsOf(card).find((x) => x.section === W.bearer && x.name === NAME.B);
    check("W1 the bearer is in its own section, undetermined", !!bearerRow && outcomeOf(bearerRow) === W.undetermined, { section: bearerRow?.section, outcome: outcomeOf(bearerRow) });
    check("W1 no body outside the ring is listed", !rowNamed(card, NAME.R) && !rowNamed(card, NAME.C));
    const whispers = await gmRun(P.whispers, { aid: r.activationId });
    check("W1 zero whispers", whispers.length === 0, { whispers: whispers.length });
    if (SHOTS) await shootCard(r.messageId, "lib-aura-card-waiting");
    S.w1 = r;
  });

  /* ---------------------------------------------------------------- */
  await step("W6", async () => {
    section("W6 a body out and back, a body the filter refuses, Check range again");
    await reset({ place: { B: RING.B, M: RING.M, O: RING.O } , over: { S: () => shapes.save({ filter: filterOf("any", "opposing") }) } });
    const r = await raise("S");
    let card = await waitCard(gmRun, r.messageId, (c) => rowNamed(c, NAME.M) && rowNamed(c, NAME.O));
    check("W6 the inside bodies are waiting rows", outcomeOf(rowNamed(card, NAME.M)) === W.waiting && outcomeOf(rowNamed(card, NAME.O)) === W.waiting);
    await gmRun(P.move, { moves: [{ uuid: T.O.uuid, x: HOME.O[0], y: HOME.O[1] }] });
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.O)) === W.out);
    const oRow = rowNamed(card, NAME.O);
    check("W6 a body walked out reads Out of reach, in soft ink and not bold", outcomeOf(oRow) === W.out && muted(oRow), { outcome: outcomeOf(oRow), cls: oRow?.cls });
    await gmRun(P.move, { moves: [{ uuid: T.A.uuid, x: RING.A[0], y: RING.A[1] }] });
    card = await waitCard(gmRun, r.messageId, (c) => rowNamed(c, NAME.A));
    const aRow = rowNamed(card, NAME.A);
    check("W6 a body the filter refuses reads Not a target, in soft ink and not bold", outcomeOf(aRow) === W.notTarget && muted(aRow), { outcome: outcomeOf(aRow), cls: aRow?.cls });
    await gmRun(P.move, { moves: [{ uuid: T.O.uuid, x: RING.O[0], y: RING.O[1] }] });
    card = await waitCard(gmRun, r.messageId, (c) => rowNamed(c, NAME.O));
    note("W6 a body walked back in reads", outcomeOf(rowNamed(card, NAME.O)));
    // Check range again: a row a window missed an event for is listed again, and nobody is asked.
    const stored = await gmRun(P.card, { id: r.messageId });
    const m = stored.subjects.find((s) => s.uuid === T.M.uuid);
    const a = stored.subjects.find((s) => s.uuid === T.A.uuid);
    const key = (u) => u.replaceAll(".", "~");
    const entriesBefore = stored.entries.length;
    const whispersBefore = (await gmRun(P.whispers, { aid: r.activationId })).length;
    await gmRun(P.patchCard, { id: r.messageId, patch: { [`subjects.${key(T.M.uuid)}`]: { uuid: T.M.uuid, name: NAME.M, state: "out", latest: "" }, [`subjects.${key(T.A.uuid)}`]: { uuid: T.A.uuid, name: NAME.A, state: "out", latest: "" } } });
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.out);
    check("W6 a stale card holds the inside bodies as out", outcomeOf(rowNamed(card, NAME.M)) === W.out && !!m && !!a);
    const pressed = await gmRun(P.click, { id: r.messageId, action: "itemRun.recheck" });
    check("W6 the card offers Check range again", pressed === true);
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.waiting && outcomeOf(rowNamed(c, NAME.A)) === W.notTarget);
    const after = await gmRun(P.card, { id: r.messageId });
    const whispersAfter = (await gmRun(P.whispers, { aid: r.activationId })).length;
    check("W6 Check range again lists them again, the refused one as Not a target", outcomeOf(rowNamed(card, NAME.M)) === W.waiting && outcomeOf(rowNamed(card, NAME.A)) === W.notTarget, { m: outcomeOf(rowNamed(card, NAME.M)), a: outcomeOf(rowNamed(card, NAME.A)) });
    check("W6 Check range again asked nobody", after.entries.length === entriesBefore && whispersAfter === whispersBefore, { entries: [entriesBefore, after.entries.length], whispers: [whispersBefore, whispersAfter] });
  });

  /* ---------------------------------------------------------------- */
  await step("W8", async () => {
    section("W8 the Judge's early Save on a waiting row, and a Player owner's waiting row");
    await reset({ place: { B: RING.B, M: RING.M, O: RING.O } });
    const r = await raise("S");
    const gcard = await waitCard(gmRun, r.messageId, (c) => rowNamed(c, NAME.M) && rowNamed(c, NAME.O));
    const mRow = rowNamed(gcard, NAME.M);
    check("W8 a waiting row offers the Judge a Save", hasBtn(mRow, "itemRun.roll"), mRow?.buttons);
    const stamp = await gmRun(() => Date.now());
    const p = await press(gmRun, { id: r.messageId, action: "itemRun.roll", subject: T.M.uuid }, "fail");
    check("W8 the Judge pressed the early Save", p.found === true);
    const done = await until(async () => { const c = await gmRun(P.card, { id: r.messageId }); return entryOf(c, T.M.uuid, (e) => e.state === "applied") ? c : null; }, 12000);
    await p.restore();
    const entry = entryOf(done, T.M.uuid);
    check("W8 the early Save went through, recorded as early, failed and written", entry?.state === "applied" && entry.early === true && entry.saved === false && entry.recordIds.length >= 1, entry);
    const warn = await until(async () => gmRun((a) => game.messages.find((m) => Number(m.timestamp) >= a.t - 5000 && !m.flags?.["acks-extras"]?.itemRunCard && !m.flags?.["acks-extras"]?.itemRunWhisper && (m.whisper ?? []).length && String(m.content).includes(a.item) && String(m.content).includes(a.name))?.id ?? null, { t: stamp, item: ITEMS.S.name, name: NAME.M }), 8000);
    const to = warn ? await gmRun((id) => [...game.messages.get(id).whisper].sort(), warn) : [];
    check("W8 a warning line is whispered to the Judges alone", !!warn && same(to, await gmRun(P.judges)), { to, judges: await gmRun(P.judges) });
    const pcard = await waitCard(plRun, r.messageId, (c) => rowNamed(c, NAME.M));
    const pm = rowNamed(pcard, NAME.M);
    check("W8 a Player owner reads the row answered as failed, with no Save left on it", !!pm && !hasBtn(pm, "itemRun.roll") && outcomeOf(pm) === W.failed, { outcome: outcomeOf(pm), buttons: pm?.buttons });
    // A second waiting body, answered by nobody: the Player owner sees it waiting with no press.
    await reset({ place: { B: RING.B, M: RING.M, O: RING.O } });
    const r2 = await raise("S");
    const pc2 = await waitCard(plRun, r2.messageId, (c) => rowNamed(c, NAME.M));
    const pm2 = rowNamed(pc2, NAME.M);
    check("W8 a Player owner sees its row waiting with no press", !!pm2 && outcomeOf(pm2) === W.waiting && (pm2.buttons ?? []).length === 0, { outcome: outcomeOf(pm2), buttons: pm2?.buttons });
    const early = await plRun(P.api, { call: "pressRoll", args: { itemUuid: I.S.uuid, rowKey: "reach", activationId: r2.activationId, subject: T.M.uuid, messageId: r2.messageId, entryKey: "" } });
    check("W8 a Player's early press on a waiting row is refused (the lib's press, called from the Player seat: the card draws no button for it)", early.ok === false, early);
    const stillWaiting = entryOf(await gmRun(P.card, { id: r2.messageId }), T.M.uuid, (e) => e.state === "applied");
    check("W8 the refused early press wrote nothing", !stillWaiting && (await carrier("M")).length === 0, { applied: !!stillWaiting });
  });

  /* ---------------------------------------------------------------- */
  section("the fight: W2 to W5, W7, W9a to W9c, W9f, W9h");
  let fightReady = false;
  await step("fight", async () => {
    await reset({ place: { ...RING, C: [800, 900] } });
    const scene = await gmRun((u) => fromUuidSync(u).id, SC.main);
    const combat = await gm.create("Combat", { scene, active: true });
    S.combat = combat;
    disposables.push(combat.uuid);
    const rows = {};
    for (const k of ["B", "M", "O", "A", "C"]) rows[k] = (await gm.create("Combatant", { tokenId: T[k].id, sceneId: scene, actorId: A[k].id }, { parent: combat.uuid })).id;
    const made = await gmRun(P.fight, { combatId: combat.id, rows, inits: { B: 25, M: 20, O: 15, A: 10, C: 5 } });
    check("the walk's combat is the tracker's, its order set, no turn begun", made.active && made.order.length === 5, made);
    fightReady = made.active;
  });

  if (fightReady) {
    /* W2 */
    await step("W2", async () => {
      section("W2 the fight starts: one whisper per body per initiative");
      await reset({ place: { ...RING, C: [800, 900] } });
      const r = await raise("S");
      S.w2 = r;
      const per = {};
      for (const k of ["M", "O", "A"]) {
        await turn(k);
        per[k] = (await gmRun(P.whispers, { aid: r.activationId })).filter((w) => w.subject === T[k].uuid);
      }
      check("W2 each body was whispered exactly once for its initiative", ["M", "O", "A"].every((k) => per[k].length === 1), Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.length])));
      let recipients = true;
      const detail = {};
      for (const k of ["M", "O", "A"]) {
        const want = await gmRun(P.owners, { uuid: T[k].uuid });
        detail[k] = { want: want.length, got: per[k][0]?.to.length ?? 0 };
        if (!same(per[k][0]?.to ?? [], want)) recipients = false;
      }
      check("W2 each whisper's recipients equal the owners of the body's token, Judges included", recipients, detail);
      const mWant = await gmRun(P.owners, { uuid: T.M.uuid });
      check("W2 the Player seat is among the owners of the body it is whispered for", mWant.includes(S.playerId), { owners: mWant.length });
      const judges = await gmRun(P.judges);
      check("W2 the Judges are among every whisper's recipients", ["M", "O", "A"].every((k) => judges.every((id) => per[k][0]?.to.includes(id))), { judges: judges.length });
      const unowned = per.O[0]?.to ?? [];
      check("W2 a body the Player does not own is not whispered to the Player", !unowned.includes(S.playerId), { to: unowned.length });
    });

    /* W3 */
    await step("W3", async () => {
      section("W3 the press from the Player seat, on the raised card and on the whisper");
      await reset({ place: { ...RING, C: [800, 900] } });
      const r = await raise("S");
      await turn("M");
      const aid = r.activationId;
      const ws = (await gmRun(P.whispers, { aid })).filter((w) => w.subject === T.M.uuid);
      let pcard = await waitCard(plRun, r.messageId, (c) => rowNamed(c, NAME.M) && hasBtn(rowNamed(c, NAME.M), "itemRun.roll"));
      const mRow = rowNamed(pcard, NAME.M);
      check("W3 the Player's own body's row offers the Save on the raised card", hasBtn(mRow, "itemRun.roll"), { outcome: outcomeOf(mRow), buttons: mRow?.buttons });
      check("W3 a non-owner's bodies are not on the Player's raised card, so no Save for them", !rowNamed(pcard, NAME.O) && !rowNamed(pcard, NAME.A));
      const wcard = ws[0] ? await waitCard(plRun, ws[0].id, (c) => rowsOf(c).length) : null;
      check("W3 the whisper reaches the Player with the Roll the save control", !!wcard && rowsOf(wcard).some((x) => hasBtn(x, "itemRun.roll") && x.buttons.some((b) => b.label === W.rollSave)), { whispers: ws.length, rows: rowsOf(wcard).map((x) => x.buttons?.map((b) => b.label)) });
      const before = await carrier("M");
      const p = await press(plRun, { id: r.messageId, action: "itemRun.roll", subject: T.M.uuid }, "fail");
      check("W3 the Player pressed Save on the raised card, from its own page", p.found === true);
      const done = await until(async () => { const c = await gmRun(P.card, { id: r.messageId }); return entryOf(c, T.M.uuid, (e) => e.state === "applied") ? c : null; }, 14000);
      await p.restore();
      const entry = entryOf(done, T.M.uuid);
      check("W3 the entry is applied, failed, written by the Player's press", entry?.state === "applied" && entry.saved === false && entry.presser === S.playerId && entry.recordIds.length >= 1, { state: entry?.state, saved: entry?.saved, presser: entry?.presser === S.playerId, records: entry?.recordIds.length, total: entry?.total, target: entry?.target });
      const after = await carrier("M");
      const cond = after.find((e) => e.statuses.includes(COND));
      check("W3 the condition reads back on the actor under the activation, with a turn-life", !!cond && cond.run.activationId === aid && cond.turnLife === true, { count: after.length - before.length, statuses: after.map((e) => e.statuses) });
      const gcard = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.failed);
      const wans = await gmRun(P.whispers, { aid });
      check("W3 the entry reads applied on the raised card and on the whisper", outcomeOf(rowNamed(gcard, NAME.M)) === W.failed && wans.find((w) => w.subject === T.M.uuid)?.answered === "applied", { row: outcomeOf(rowNamed(gcard, NAME.M)), whisper: wans.find((w) => w.subject === T.M.uuid)?.answered });
      pcard = await waitCard(plRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.failed);
      const wcard2 = ws[0] ? await waitCard(plRun, ws[0].id, (c) => rowsOf(c).some((x) => !hasBtn(x, "itemRun.roll"))) : null;
      check("W3 no press is left on either card for the answered entry", !hasBtn(rowNamed(pcard, NAME.M), "itemRun.roll") && !!wcard2 && !rowsOf(wcard2).some((x) => hasBtn(x, "itemRun.roll")));
      check("W3 no Apply control exists on either card, for either seat", ![pcard, gcard, wcard2].some((c) => rowsOf(c).some((x) => x.buttons?.some((b) => /apply/i.test(b.label + b.action))) || (c?.footer ?? []).some((b) => /apply/i.test(b.label + b.action))));
      const second = await plRun(P.api, { call: "pressRoll", args: { itemUuid: I.S.uuid, rowKey: "reach", activationId: aid, subject: T.M.uuid, messageId: r.messageId, entryKey: entry?.key } });
      check("W3 a second press is refused (the lib's press, called from the Player seat: the card has no button for it)", second.ok === false, second);
      const stillOne = (await carrier("M")).filter((e) => e.statuses.includes(COND)).length;
      check("W3 the refused press wrote nothing more", stillOne === 1, { conditions: stillOne });
      // The next initiative asks again, under a new entry; a press on the whisper writes it.
      await turn("M");
      const next = await gmRun(P.card, { id: r.messageId });
      const entries = next.entries.filter((e) => e.subject === T.M.uuid);
      check("W3 the body is asked again at its next initiative under a new entry", entries.length === 2 && entries.at(-1).state === "open" && entries[0].key !== entries[1].key, entries.map((e) => [e.key, e.state]));
      const lifted = (await carrier("M")).filter((e) => e.statuses.includes(COND)).length;
      check("W3 the failed save's condition went at the body's next turn start", lifted === 0, { conditions: lifted });
      const w2 = (await gmRun(P.whispers, { aid })).filter((w) => w.subject === T.M.uuid).find((w) => w.entryKey === entries.at(-1).key);
      const w2card = w2 ? await waitCard(plRun, w2.id, (c) => rowsOf(c).some((x) => hasBtn(x, "itemRun.roll"))) : null;
      const pw = await press(plRun, { id: w2?.id, action: "itemRun.roll", subject: T.M.uuid }, "pass");
      check("W3 the Player pressed Roll the save on the whisper", !!w2card && pw.found === true);
      const done2 = await until(async () => { const c = await gmRun(P.card, { id: r.messageId }); return entryOf(c, T.M.uuid, (e) => e.state === "applied" && e.key === entries.at(-1).key) ? c : null; }, 14000);
      await pw.restore();
      const e2 = entryOf(done2, T.M.uuid, (e) => e.key === entries.at(-1).key);
      const win = (await carrier("M")).find((e) => e.immune);
      check("W3 the whisper's press applied the entry, a pass, and wrote the immunity window", e2?.state === "applied" && e2.saved === true && e2.presser === S.playerId && !!win?.run?.dueAt, { saved: e2?.saved, dueAt: win?.run?.dueAt ?? null });
      S.shotCard = r.messageId;
      if (SHOTS) await shootCard(r.messageId, "lib-aura-card-answered");
    });

    /* W4 */
    await step("W4", async () => {
      section("W4 two overlapping bearers of one item kind");
      await reset({ place: { B: [600, 700], B2: [900, 700], M: [750, 900], O: HOME.O } });
      const r1 = await raise("S");
      const r2 = await raise("S2");
      await turn("M");
      const w1 = (await gmRun(P.whispers, { aid: r1.activationId })).filter((w) => w.subject === T.M.uuid);
      const w2 = (await gmRun(P.whispers, { aid: r2.activationId })).filter((w) => w.subject === T.M.uuid);
      check("W4 one prompt for the body across both bearers", w1.length + w2.length === 1, { first: w1.length, second: w2.length });
      const owner = w1.length ? r1 : r2;
      const other = w1.length ? r2 : r1;
      const ownerItem = w1.length ? "S" : "S2";
      const ownerBearer = w1.length ? "B" : "B2";
      const otherBearer = w1.length ? "B2" : "B";
      const p = await press(gmRun, { id: owner.messageId, action: "itemRun.roll", subject: T.M.uuid }, "fail");
      await until(async () => { const c = await gmRun(P.card, { id: owner.messageId }); return entryOf(c, T.M.uuid, (e) => e.state === "applied") ? c : null; }, 14000);
      await p.restore();
      let cond = (await carrier("M")).filter((e) => e.statuses.includes(COND));
      check("W4 the failed save wrote one condition under the asking bearer's activation", cond.length === 1 && cond[0].run.activationId === owner.activationId && p.found, { count: cond.length });
      await gmRun(P.click, { id: owner.messageId, action: "itemRun.lower" });
      await sleep(2500);
      cond = (await carrier("M")).filter((e) => e.statuses.includes(COND));
      check("W4 lowering the first hands the condition to the second", cond.length === 1 && cond[0].run.activationId === other.activationId, { count: cond.length, handed: cond[0]?.run?.activationId === other.activationId });
      await gmRun(P.click, { id: other.messageId, action: "itemRun.lower" });
      await sleep(2500);
      cond = (await carrier("M")).filter((e) => e.statuses.includes(COND));
      check("W4 lowering both deletes it", cond.length === 0, { count: cond.length });
      note("W4 the bearer whose item asked", ownerItem);
    });

    /* W5 */
    await step("W5", async () => {
      section("W5 lowering: conditions go, the window stays, a re-raise skips the immune body");
      await reset({ place: { ...RING, C: [800, 900] } });
      const r = await raise("S");
      await turn("M");
      await turn("A");
      const pf = await press(gmRun, { id: r.messageId, action: "itemRun.roll", subject: T.M.uuid }, "fail");
      await until(async () => entryOf(await gmRun(P.card, { id: r.messageId }), T.M.uuid, (e) => e.state === "applied"), 14000);
      await pf.restore();
      const pp = await press(gmRun, { id: r.messageId, action: "itemRun.roll", subject: T.A.uuid }, "pass");
      await until(async () => entryOf(await gmRun(P.card, { id: r.messageId }), T.A.uuid, (e) => e.state === "applied"), 14000);
      await pp.restore();
      const condBefore = (await carrier("M")).some((e) => e.statuses.includes(COND));
      const winBefore = (await carrier("A")).find((e) => e.immune);
      check("W5 before lowering: M holds the condition and A holds the immunity window", condBefore && !!winBefore?.run?.dueAt, { cond: condBefore, window: !!winBefore });
      const now = await gmRun(P.worldTime);
      const secs = await gmRun(P.turnSeconds);
      check("W5 the window ends the imported turns after now, on the world clock", winBefore && Math.abs(winBefore.run.dueAt - (now + FIGURES.save.immunityTurns * secs)) < 5, { dueAt: winBefore?.run?.dueAt, now, turns: FIGURES.save.immunityTurns, secs });
      const lowered = await gmRun(P.click, { id: r.messageId, action: "itemRun.lower" });
      check("W5 the card's Lower was pressed", lowered === true);
      await until(async () => (await gmRun(P.card, { id: r.messageId }))?.lowered === true, 10000);
      await sleep(1500);
      const condAfter = (await carrier("M")).some((e) => e.statuses.includes(COND));
      const winAfter = (await carrier("A")).find((e) => e.immune);
      const regions = (await gmRun(P.regions, { sceneUuid: SC.main })).length;
      check("W5 the conditions went, the immunity window stayed, no Region is left", !condAfter && !!winAfter && regions === 0, { cond: condAfter, window: !!winAfter, regions });
      const r2 = await raise("S");
      await turn("M");
      await turn("A");
      const stored = await gmRun(P.card, { id: r2.messageId });
      const aAsked = stored.entries.filter((e) => e.subject === T.A.uuid).length;
      const mAsked = stored.entries.filter((e) => e.subject === T.M.uuid).length;
      check("W5 a re-raise skips the immune body and asks the other", aAsked === 0 && mAsked === 1, { immune: aAsked, other: mAsked });
    });

    /* W7 */
    await step("W7", async () => {
      section("W7 Undo from the seat that applied it, from an owner, and from a seat that is neither");
      await reset({ place: { ...RING, C: [800, 900] } });
      const plain = await gm.create("ActiveEffect", { name: "Aura Cards Plain Effect", disabled: false }, { parent: A.M.uuid });
      disposables.push(plain.uuid);
      const r = await raise("S");
      // The Judge applies M's entry; M's owner (the Player seat) takes it back.
      await turn("M");
      const pg = await press(gmRun, { id: r.messageId, action: "itemRun.roll", subject: T.M.uuid }, "fail");
      const e1 = await until(async () => entryOf(await gmRun(P.card, { id: r.messageId }), T.M.uuid, (e) => e.state === "applied"), 14000);
      await pg.restore();
      const idsBefore = (await gmRun(P.effects, { uuid: A.M.uuid })).map((e) => e.id);
      const stored = e1?.recordIds ?? [];
      const pcard = await waitCard(plRun, r.messageId, (c) => hasBtn(rowNamed(c, NAME.M), "itemRun.undo"));
      check("W7 the Judge applied it; an owner of the body is offered Undo", stored.length >= 1 && hasBtn(rowNamed(pcard, NAME.M), "itemRun.undo"), { stored: stored.length });
      const u1 = await plRun(P.click, { id: r.messageId, action: "itemRun.undo", subject: T.M.uuid });
      const undone1 = await until(async () => entryOf(await gmRun(P.card, { id: r.messageId }), T.M.uuid, (e) => e.state === "undone"), 12000);
      const idsAfter = (await gmRun(P.effects, { uuid: A.M.uuid })).map((e) => e.id);
      check("W7 an owner's Undo removed exactly the stored record ids and the entry reads Undone", u1 === true && !!undone1 && same(idsBefore.filter((id) => !stored.includes(id)).sort(), idsAfter.sort()), { removed: idsBefore.length - idsAfter.length, stored: stored.length });
      check("W7 the plain effect on the same body was left", idsAfter.includes(plain.id ?? String(plain.uuid).split(".").pop()), { kept: idsAfter.length });
      const ucard = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.undone);
      check("W7 the row reads Undone", outcomeOf(rowNamed(ucard, NAME.M)) === W.undone, { outcome: outcomeOf(rowNamed(ucard, NAME.M)) });
      // The Player applies its own; the Player takes it back (the seat that applied it).
      await turn("M");
      const pp = await press(plRun, { id: r.messageId, action: "itemRun.roll", subject: T.M.uuid }, "fail");
      const e2 = await until(async () => entryOf(await gmRun(P.card, { id: r.messageId }), T.M.uuid, (e) => e.state === "applied" && e.presser === S.playerId), 14000);
      await pp.restore();
      const stored2 = e2?.recordIds ?? [];
      const clicked = await until(async () => plRun(P.click, { id: r.messageId, action: "itemRun.undo", subject: T.M.uuid }), 8000, 600);
      const undone2 = await until(async () => entryOf(await gmRun(P.card, { id: r.messageId }), T.M.uuid, (e) => e.state === "undone" && e.key === e2?.key), 12000);
      const left = (await gmRun(P.effects, { uuid: A.M.uuid })).filter((e) => stored2.includes(e.id)).length;
      check("W7 the seat that applied it took it back: its ids are gone", !!clicked && !!undone2 && stored2.length >= 1 && left === 0, { stored: stored2.length, left });
      // A body the Player does not own, applied by the Judge: the Player seat is neither.
      await turn("O");
      const po = await press(gmRun, { id: r.messageId, action: "itemRun.roll", subject: T.O.uuid }, "fail");
      const e3 = await until(async () => entryOf(await gmRun(P.card, { id: r.messageId }), T.O.uuid, (e) => e.state === "applied"), 14000);
      await po.restore();
      const pc3 = await waitCard(plRun, r.messageId, (c) => rowNamed(c, NAME.M));
      check("W7 the third seat has no Undo on the card", !anyBtn(pc3, "itemRun.undo"), { rows: rowsOf(pc3).map((x) => x.name) });
      const forged = await plRun(P.api, { call: "undoCardEntry", args: { messageId: r.messageId, entryKey: e3?.key } });
      const survived = (await gmRun(P.effects, { uuid: A.O.uuid })).filter((e) => (e3?.recordIds ?? []).includes(e.id)).length;
      check("W7 a forged relayed Undo from the third seat is refused and removes nothing (the lib's Undo, called from the Player seat)", forged.ok === false && survived === (e3?.recordIds ?? []).length && survived >= 1, { ...forged, survived });
    });

    /* W9a, W9b, W9c, W9h: the strip */
    await step("W9a-c,h", async () => {
      section("W9a, W9b, W9c, W9h the strip on the character's sheet");
      if (!S.playerViews) {
        for (const id of ["W9a", "W9b", "W9c", "W9h"]) skip(id, "the Player seat cannot view the walk's scene (a Player's scene view is the world's active scene), so a sheet there finds no token for the strip to read");
        return;
      }
      await reset({ place: { B: [700, 700], BS: [600, 900], C: [800, 700], M: [900, 700] } });
      const rs = await raise("S");
      await turn("C");
      const before = await carrier("C");
      let strip = await until(async () => { const s = await plRun(P.strip, { actorUuid: A.C.uuid }); return s.has ? s : null; }, 12000, 800) ?? (await plRun(P.strip, { actorUuid: A.C.uuid, open: false }));
      note("W9a the sheet that opened", { sheet: strip.sheet, strip: strip.has });
      const row = strip.rows.find((x) => x.name === ITEMS.S.name);
      check("W9a an In reach of strip stands above the tabs, inside the sheet's scroll frame", strip.has && strip.title.startsWith(W.stripTitle) && strip.scrolls === true && strip.aboveTabs !== false, { title: strip.title, scrolls: strip.scrolls, aboveTabs: strip.aboveTabs });
      check("W9a one row for the item, tagged Save owed", strip.rows.length === 1 && !!row && row.tag.startsWith(W.tagOwed), { rows: strip.rows.length, tag: row?.tag });
      const shown = await plRun(P.shownName, { tokenUuid: T.B.uuid });
      check("W9a the source is the bearer's name as the Player's own view shows that token", !!row && row.line.startsWith(shown.name ?? W.stripUnseen), { shown: shown.name, line: row?.line });
      const dist = row?.nums?.[0];
      const feet = dist ? parseInt(dist.text, 10) : NaN;
      const tipWant = await plRun((a) => game.i18n.format("ACKS-LIB.itemRun.card.tip.distance", a), { feet, name: shown.name ?? W.stripUnseen });
      check("W9a a distance in feet whose tooltip says it is measured between nearest edges", /^\d+′$/.test(dist?.text ?? "") && dist.tip === tipWant, { text: dist?.text, tip: dist?.tip?.slice(0, 80) });
      const radius = row?.nums?.[1];
      check("W9a the reach, in feet, with a tooltip naming the figure", /^\d+′$/.test(radius?.text ?? "") && (radius.tip ?? "").includes(`${FIGURES.save.radius}′`), { text: radius?.text, tip: radius?.tip });
      const save = row?.buttons?.find((b) => b.action === "reachStripSave");
      check("W9a a Save button naming the target", !!save && /\d+\+/.test(save.label), { label: save?.label });
      const unowned = await plRun(P.stripModel, { actorUuid: A.O.uuid });
      check("W9a a body this seat does not own has no strip for it (the Player seat does not own O)", unowned === null, { model: unowned });
      skip("W9a a seat that owns neither the character nor any body in reach", "the world has two walk seats, a Judge and a Player owning the body; a third that owns nothing is unavailable, so the Player seat's own non-owned body stands in (the line above)");

      // W9b: the press from the strip.
      const canPress = !!save && /\d+\+/.test(save.label);
      let open = null;
      if (!canPress) skip("W9b", "the character's save figure is not stored (a character's save is derived from its class), so the strip offers no Save and a press has no target to roll against");
      else {
        open = entryOf(await gmRun(P.card, { id: rs.messageId }), T.C.uuid, (e) => e.state === "open");
        await plRun(P.rig, { value: DIE.fail });
        const clicked = await plRun(P.stripSave, { actorUuid: A.C.uuid });
        const done = await until(async () => entryOf(await gmRun(P.card, { id: rs.messageId }), T.C.uuid, (e) => e.state === "applied"), 14000);
        await plRun(P.rig, { value: null });
        check("W9b the Save was pressed on the strip, in the Player seat's page", clicked === true && !!open);
        check("W9b the entry reads applied under the same moment key a card press writes, by the Player seat", done?.key === open?.key && done?.presser === S.playerId && done?.saved === false, { same: done?.key === open?.key, saved: done?.saved, presser: done?.presser === S.playerId });
        strip = await until(async () => { const s = await plRun(P.strip, { actorUuid: A.C.uuid, open: false }); return s.rows.some((x) => x.tag.startsWith(W.tagFailed)) ? s : null; }, 10000, 700) ?? (await plRun(P.strip, { actorUuid: A.C.uuid, open: false }));
        check("W9b the strip row's tag changes to Failed", strip.rows.some((x) => x.tag.startsWith(W.tagFailed)), strip.rows.map((x) => x.tag));
        check("W9b the strip has no Save left, a second press is refused (the lib's press from the Player seat)", !strip.rows.some((x) => x.buttons.some((b) => b.action === "reachStripSave")) && (await plRun(P.api, { call: "pressRoll", args: { itemUuid: I.S.uuid, rowKey: "reach", activationId: rs.activationId, subject: T.C.uuid, messageId: rs.messageId, entryKey: open?.key } })).ok === false);
      }
      skip("W9b a seat owning the actor but not the token is refused", "a linked token's ownership is its actor's, so no seat can own one and not the other on a linked fixture; an unlinked body would need its own ownership split, which this walk does not build");

      // W9c: a standing item's body, and the immunity row.
      const rt = await raise("T");
      await sleep(1500);
      strip = await until(async () => { const s = await plRun(P.strip, { actorUuid: A.C.uuid, open: false }); return s.rows.some((x) => x.name === ITEMS.T.name) ? s : null; }, 10000, 700) ?? (await plRun(P.strip, { actorUuid: A.C.uuid, open: false }));
      const trow = strip.rows.find((x) => x.name === ITEMS.T.name);
      const part = trow?.nums?.find((n) => n.text.includes(`+${FIGURES.standing.bonus}`));
      const rolls = await plRun(() => ["ac", "attack", "morale"].map((k) => game.i18n.localize(`ACKS-LIB.itemRun.strip.on.${k}`)));
      check("W9c a standing item's row is tagged Always on, with the imported figure and the rolls it names", !!trow && trow.tag.startsWith(W.tagAlways) && !!part && rolls.every((w) => part.text.includes(w)), { tag: trow?.tag, part: part?.text });
      check("W9c the part's tooltip lists the parts: the item, the source, the reach, the figure and the page", !!part && part.tip.includes(ITEMS.T.name) && part.tip.includes(`+${FIGURES.standing.bonus}`) && part.tip.includes("Aura Cards ref T"), { tip: part?.tip });
      check("W9c nothing to press on an Always on row", !!trow && trow.buttons.length === 0);
      if (!canPress) skip("W9c Immune", "no save target for the character, so no pass can be pressed to write the window");
      else {
        await turn("C");
        const open2 = entryOf(await gmRun(P.card, { id: rs.messageId }), T.C.uuid, (e) => e.state === "open");
        await plRun(P.rig, { value: DIE.pass });
        const clicked2 = await until(async () => plRun(P.stripSave, { actorUuid: A.C.uuid }), 10000, 700);
        const done2 = await until(async () => entryOf(await gmRun(P.card, { id: rs.messageId }), T.C.uuid, (e) => e.state === "applied" && e.saved === true), 14000);
        await plRun(P.rig, { value: null });
        check("W9c a passed save, pressed on the strip", !!clicked2 && !!open2 && !!done2, { saved: done2?.saved });
        const win = (await carrier("C")).find((e) => e.immune);
        const now = await gmRun(P.worldTime);
        const secs = await gmRun(P.turnSeconds);
        const wantTurns = win?.run?.dueAt ? Math.ceil((win.run.dueAt - now) / secs) : null;
        strip = await until(async () => { const s = await plRun(P.strip, { actorUuid: A.C.uuid, open: false }); return s.rows.some((x) => x.tag.startsWith(W.tagImmune)) ? s : null; }, 10000, 700) ?? (await plRun(P.strip, { actorUuid: A.C.uuid, open: false }));
        const irow = strip.rows.find((x) => x.tag.startsWith(W.tagImmune));
        const shownTurns = parseInt(irow?.leftText ?? "", 10);
        check("W9c the Immune row's turns left equal the remaining seconds over a turn, rounded up", !!win && wantTurns !== null && shownTurns === wantTurns, { shown: shownTurns, want: wantTurns, dueAt: win?.run?.dueAt, now, secs });
      }

      // W9h: the open sheet follows a change with no reload.
      const had = strip.rows.length;
      await gmRun(P.move, { moves: [{ uuid: T.C.uuid, x: HOME.C[0], y: HOME.C[1] }], ms: 2500 });
      const gone = await until(async () => { const s = await plRun(P.strip, { actorUuid: A.C.uuid, open: false }); return s.has ? null : s; }, 10000, 700);
      check("W9a/W9h stepping the token out of reach removes the strip from the open sheet, with no reload", !!gone && gone.rendered === true && had >= 2, { rowsBefore: had });
      await gmRun(P.move, { moves: [{ uuid: T.C.uuid, x: 800, y: 700 }], ms: 2500 });
      const back = await until(async () => { const s = await plRun(P.strip, { actorUuid: A.C.uuid, open: false }); return s.has ? s : null; }, 10000, 700);
      check("W9h a token walking in brings the strip back on the open sheet, with no reload", !!back, { rows: back?.rows?.length });
      await plRun(P.closeSheet, { actorUuid: A.C.uuid });
    });

    /* W9f: Count in, Count out on a prompting reach and a standing one */
    await step("W9f", async () => {
      section("W9f Count in and Count out for the bearer");
      await reset({ place: { B: [700, 700], M: [800, 700] } });
      let r = await raise("S");
      const flagOf = async () => (await gmRun(P.itemFlag, { uuid: I.S.uuid }))?.rows?.[0]?.reach?.filter?.self ?? null;
      let card = await waitCard(gmRun, r.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.B));
      const pc = await waitCard(plRun, r.messageId, (c) => !!c);
      check("W9f a seat that does not own the item sees neither control", !anyBtn(pc, "itemRun.tick") && !anyBtn(pc, "itemRun.untick"));
      await gmRun(async (a) => { await fromUuidSync(a.uuid).update({ ownership: { default: 0, [a.player]: 3 } }); return true; }, { uuid: A.B.uuid, player: S.playerId });
      await plRun(async () => { await ui.chat.render({ force: true }); return true; });
      await sleep(1500);
      const owning = await waitCard(plRun, r.messageId, (c) => anyBtn(c, "itemRun.tick"));
      check("W9f a seat that owns the bearer is offered Count in", anyBtn(owning, "itemRun.tick"));
      const clickedIn = await plRun(P.click, { id: r.messageId, action: "itemRun.tick" });
      await until(async () => (await flagOf()) === "count", 8000);
      check("W9f Count in: the item's filter reads count", clickedIn === true && (await flagOf()) === "count", { self: await flagOf() });
      card = await waitCard(gmRun, r.messageId, (c) => anyBtn(c, "itemRun.untick"));
      check("W9f the bearer's row is listed and offers Count out", anyBtn(card, "itemRun.untick") && rowsOf(card).some((x) => x.name === NAME.B && x.section === W.bearer));
      await turn("B");
      const asked = entryOf(await gmRun(P.card, { id: r.messageId }), T.B.uuid, (e) => e.state === "open");
      check("W9f at its own turn start the counted bearer is asked", !!asked, asked);
      const clickedOut = await gmRun(P.click, { id: r.messageId, action: "itemRun.untick" });
      await until(async () => (await flagOf()) === "no", 8000);
      await sleep(1000);
      const after = await gmRun(P.card, { id: r.messageId });
      check("W9f Count out: the filter reads no and the open prompt for the bearer is struck", clickedOut === true && (await flagOf()) === "no" && !entryOf(after, T.B.uuid, (e) => e.state === "open"), { self: await flagOf(), open: after.entries.filter((e) => e.subject === T.B.uuid).length });
      // Count in, lower, raise again: the bearer is counted as the item left it.
      await gmRun(P.click, { id: r.messageId, action: "itemRun.tick" });
      await until(async () => (await flagOf()) === "count", 8000);
      await gmRun(P.click, { id: r.messageId, action: "itemRun.lower" });
      await until(async () => (await gmRun(P.card, { id: r.messageId }))?.lowered === true, 10000);
      await sleep(1200);
      r = await raise("S");
      card = await waitCard(gmRun, r.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.B && x.section === W.bearer));
      check("W9f a lowering and re-raise shows the bearer counted as the item left it", (await flagOf()) === "count" && anyBtn(card, "itemRun.untick"), { self: await flagOf() });
      await gmRun(P.click, { id: r.messageId, action: "itemRun.untick" });
      await until(async () => (await flagOf()) === "no", 8000);

      // The standing item.
      await reset({ place: { BS: [700, 700], A: [800, 700] } });
      const plain = await gm.create("ActiveEffect", { name: "Aura Cards Plain Effect", disabled: false }, { parent: A.BS.uuid });
      disposables.push(plain.uuid);
      const plainId = plain.id ?? String(plain.uuid).split(".").pop();
      const rt = await raise("T");
      const flagT = async () => (await gmRun(P.itemFlag, { uuid: I.T.uuid }))?.rows?.[0]?.reach?.filter?.self ?? null;
      let tcard = await waitCard(gmRun, rt.messageId, (c) => anyBtn(c, "itemRun.tick"));
      const heldBefore = (await carrier("BS")).length;
      await gmRun(P.click, { id: rt.messageId, action: "itemRun.tick" });
      await until(async () => (await carrier("BS")).length > heldBefore, 8000);
      const held = (await carrier("BS"));
      check("W9f standing Count in holds one standing part on the bearer, carrying the card's activation id", (await flagT()) === "count" && held.length === heldBefore + 1 && held.some((e) => e.run.activationId === rt.activationId && e.partsOn.length), { held: held.map((e) => e.run.activationId === rt.activationId) });
      tcard = await waitCard(gmRun, rt.messageId, (c) => { const row = rowsOf(c).find((x) => x.name === NAME.BS && x.section === W.bearer); return outcomeOf(row) === W.always; });
      const brow = rowsOf(tcard).find((x) => x.name === NAME.BS && x.section === W.bearer);
      const tip = brow?.cells?.[W.colResult]?.tip ?? "";
      check("W9f the bearer's row reads Always on with the part and the page in the Result's tooltip, and no Save", outcomeOf(brow) === W.always && tip.includes(`+${FIGURES.standing.bonus}`) && tip.includes("Aura Cards ref T") && !hasBtn(brow, "itemRun.roll"), { outcome: outcomeOf(brow), tip });
      await gmRun(P.click, { id: rt.messageId, action: "itemRun.untick" });
      await until(async () => (await carrier("BS")).length === heldBefore, 8000);
      const stillThere = (await gmRun(P.effects, { uuid: A.BS.uuid })).some((e) => e.id === plainId);
      check("W9f standing Count out takes exactly that part off and leaves every other effect", (await carrier("BS")).length === heldBefore && stillThere && (await flagT()) === "no", { self: await flagT(), plainKept: stillThere });
      await gmRun(P.click, { id: rt.messageId, action: "itemRun.tick" });
      await until(async () => (await carrier("BS")).length > heldBefore, 8000);
      await gmRun(P.click, { id: rt.messageId, action: "itemRun.lower" });
      await until(async () => (await carrier("BS")).length === heldBefore, 10000);
      check("W9f counted in, then lowered: the part is gone", (await carrier("BS")).length === heldBefore);
      const rt2 = await raise("T");
      await sleep(1200);
      const reheld = (await carrier("BS")).filter((e) => e.run.activationId === rt2.activationId);
      tcard = await waitCard(gmRun, rt2.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.BS));
      const row2 = rowsOf(tcard).find((x) => x.name === NAME.BS);
      check("W9f raised again with the bearer still counted: the part is held from the raise and the row reads Always on, no press", reheld.length === 1 && outcomeOf(row2) === W.always && !hasBtn(row2, "itemRun.roll"), { held: reheld.length, outcome: outcomeOf(row2) });
      const ptcard = await waitCard(plRun, rt2.messageId, (c) => !!c);
      check("W9f no Save for a Player on the standing card", !anyBtn(ptcard, "itemRun.roll"));
      await gmRun(P.click, { id: rt2.messageId, action: "itemRun.untick" });
      await until(async () => (await flagT()) === "no", 8000);
    });
  } else {
    for (const id of ["W2", "W3", "W4", "W5", "W7", "W9a", "W9b", "W9c", "W9f", "W9h"]) skip(id, "the walk's combat could not be made, and each of these needs a turn to begin");
  }

  /* The fight is the run's own: delete it, so the steps after it run outside one. */
  if (S.combat) {
    const sw = await gm.sweepTracked({ only: [S.combat.uuid] });
    note("sweep (the fight)", { removed: sw.removed.length, missing: sw.missing.length, failed: sw.failed.length });
    const i = disposables.indexOf(S.combat.uuid);
    if (i >= 0) disposables.splice(i, 1);
  }

  /* ---------------------------------------------------------------- */
  await step("W9g", async () => {
    section("W9g a once-only use whose filter answers null for a body");
    await reset({ place: { BO: [700, 700], A: [800, 700], M: [900, 700], O: [900, 900] } });
    const verdict = await gmRun((a) => {
      const L = acksExtras.lib.auraReach.logic;
      const tok = (u) => fromUuidSync(u);
      const b = tok(a.b);
      const mk = (u) => ({ token: tok(u), actor: tok(u).actor });
      return { m: L.reachAdmits({ token: b, actor: b.actor }, mk(a.m), { kinds: [], exceptKinds: [], side: "any", unit: "under", self: "no" }), a: L.reachAdmits({ token: b, actor: b.actor }, mk(a.a), { kinds: [], exceptKinds: [], side: "any", unit: "under", self: "no" }) };
    }, { b: T.BO.uuid, m: T.M.uuid, a: T.A.uuid });
    if (verdict.m !== null || verdict.a !== true) {
      skip("W9g", `the unit clause settles a body of another group on this build (another group: ${verdict.m}, own group: ${verdict.a}); the walk builds a null case only from a build that registers no unit ancestry`);
      return;
    }
    const itemBefore = await gmRun(P.itemFlag, { uuid: I.O.uuid });
    const r = await raise("O");
    check("W9g the once-only use posted its card", r.ok && r.kind === "once", { ok: r.ok, kind: r.kind });
    const gcard = await waitCard(gmRun, r.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.M));
    const mRow = rowNamed(gcard, NAME.M);
    check("W9g the card lists the body under Could not be settled, with a Count in for the owner of the item", mRow?.section === W.undetermined && hasBtn(mRow, "itemRun.tickSubject"), { section: mRow?.section, buttons: mRow?.buttons?.map((b) => b.label) });
    const pcard = await waitCard(plRun, r.messageId, (c) => !!c);
    check("W9g a seat owning only the body sees neither the row nor the control", !rowNamed(pcard, NAME.M) && !anyBtn(pcard, "itemRun.tickSubject"), { rows: rowsOf(pcard).map((x) => x.name) });
    const click = await gmRun(P.click, { id: r.messageId, action: "itemRun.tickSubject", subject: T.M.uuid });
    await until(async () => (await carrier("M")).length > 0, 10000);
    const parts = await carrier("M");
    const stored = await gmRun(P.card, { id: r.messageId });
    check("W9g ticking moves the body into the use: a part written under an applied entry", click === true && parts.some((e) => e.run.activationId === r.activationId && e.endsOn?.includes("attack")) && entryOf(stored, T.M.uuid, (e) => e.state === "applied"), { parts: parts.length, entries: stored.entries.length });
    check("W9g ticking writes nothing to the item", same(await gmRun(P.itemFlag, { uuid: I.O.uuid }), itemBefore));
    // The same body under a use that asks a save: the body's own Save is open after the tick.
    await reset({ place: { BO: [700, 700], A: [800, 700], M: [900, 700], O: [900, 900] } });
    const rs = await raise("OS");
    const c2 = await waitCard(gmRun, rs.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.M));
    check("W9g (a use with a save) the body is listed under Could not be settled", rowNamed(c2, NAME.M)?.section === W.undetermined, { section: rowNamed(c2, NAME.M)?.section });
    const osBefore = await gmRun(P.itemFlag, { uuid: I.OS.uuid });
    await gmRun(P.click, { id: rs.messageId, action: "itemRun.tickSubject", subject: T.M.uuid });
    const c3 = await waitCard(gmRun, rs.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.M && hasBtn(x, "itemRun.roll")));
    const p3 = await waitCard(plRun, rs.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.M && hasBtn(x, "itemRun.roll")));
    check("W9g (a use with a save) ticking opens the body's own Save, for the Judge and for the body's owner", rowsOf(c3).some((x) => x.name === NAME.M && hasBtn(x, "itemRun.roll")) && rowsOf(p3).some((x) => x.name === NAME.M && hasBtn(x, "itemRun.roll")));
    check("W9g (a use with a save) ticking writes nothing to the item", same(await gmRun(P.itemFlag, { uuid: I.OS.uuid }), osBefore));
  });

  /* ---------------------------------------------------------------- */
  await step("W9i", async () => {
    section("W9i a standing item whose filter answers null for a body of another group");
    await reset({ place: { BS: [700, 700], A: [800, 700], M: [900, 700], O: [900, 900], C: [700, 900] } });
    const verdict = await gmRun((a) => {
      const L = acksExtras.lib.auraReach.logic;
      const b = fromUuidSync(a.b);
      const f = { kinds: [], exceptKinds: [], side: "any", unit: "under", self: "no" };
      const mk = (u) => ({ token: fromUuidSync(u), actor: fromUuidSync(u).actor });
      return { m: L.reachAdmits({ token: b, actor: b.actor }, mk(a.m), f), a: L.reachAdmits({ token: b, actor: b.actor }, mk(a.a), f) };
    }, { b: T.BS.uuid, m: T.M.uuid, a: T.A.uuid });
    if (verdict.m !== null || verdict.a !== true) {
      skip("W9i", `the unit clause settles a body of another group on this build (another group: ${verdict.m}, own group: ${verdict.a}); the walk builds a null case only from a build that registers no unit ancestry`);
      return;
    }
    const r = await raise("T");
    // A raise writes the item's activation state, so the baseline is read after it: Count in is what must leave the flags alone.
    const itemBefore = await gmRun(P.itemFlag, { uuid: I.T.uuid });
    const gcard = await waitCard(gmRun, r.messageId, (c) => rowsOf(c).some((x) => x.name === NAME.M));
    const mRow = rowNamed(gcard, NAME.M);
    const tickTip = await gmRun(P.tipOf, { id: r.messageId, action: "itemRun.tickSubject", subject: T.M.uuid });
    check("W9i the card lists the body under Could not be settled, with a Count in whose tooltip says it lasts while the item stays raised", mRow?.section === W.undetermined && hasBtn(mRow, "itemRun.tickSubject") && tickTip === W.countSubjectRaisedTip, { section: mRow?.section, tip: tickTip });
    const pcard = await waitCard(plRun, r.messageId, (c) => !!c);
    check("W9i a seat owning only the body sees neither the row nor the control", !rowNamed(pcard, NAME.M) && !anyBtn(pcard, "itemRun.tickSubject"), { rows: rowsOf(pcard).map((x) => x.name) });
    // Count in.
    await gmRun(P.click, { id: r.messageId, action: "itemRun.tickSubject", subject: T.M.uuid });
    await until(async () => (await carrier("M")).length > 0, 10000);
    let card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.counted);
    const mParts = (await carrier("M")).filter((e) => e.run.activationId === r.activationId);
    check("W9i Count in: the row moves to the table reading Counted in, the actor holds one standing part carrying the card's activation id", outcomeOf(rowNamed(card, NAME.M)) === W.counted && rowNamed(card, NAME.M)?.section !== W.undetermined && mParts.length === 1, { outcome: outcomeOf(rowNamed(card, NAME.M)), parts: mParts.length });
    check("W9i the item's flags are unchanged", same(await gmRun(P.itemFlag, { uuid: I.T.uuid }), itemBefore));
    // Out and in again.
    await gmRun(P.move, { moves: [{ uuid: T.M.uuid, x: HOME.M[0], y: HOME.M[1] }] });
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.out);
    const off = (await carrier("M")).filter((e) => e.run.activationId === r.activationId).length;
    check("W9i stepping the counted body out mutes the row and takes the part off", outcomeOf(rowNamed(card, NAME.M)) === W.out && off === 0, { outcome: outcomeOf(rowNamed(card, NAME.M)), parts: off });
    await gmRun(P.move, { moves: [{ uuid: T.M.uuid, x: 900, y: 700 }] });
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.M)) === W.counted);
    const on = (await carrier("M")).filter((e) => e.run.activationId === r.activationId).length;
    check("W9i walking it back in returns both: the row reads Counted in and the part is held again", outcomeOf(rowNamed(card, NAME.M)) === W.counted && on === 1, { outcome: outcomeOf(rowNamed(card, NAME.M)), parts: on });
    // An uncounted body held undetermined, out and in.
    await gmRun(P.move, { moves: [{ uuid: T.O.uuid, x: HOME.O[0], y: HOME.O[1] }] });
    card = await waitCard(gmRun, r.messageId, (c) => !rowNamed(c, NAME.O));
    check("W9i an uncounted body held undetermined leaves that list at its exit, and no muted row is made of it", !rowNamed(card, NAME.O), { rows: rowsOf(card).map((x) => x.name) });
    await gmRun(P.move, { moves: [{ uuid: T.O.uuid, x: 900, y: 900 }] });
    card = await waitCard(gmRun, r.messageId, (c) => rowNamed(c, NAME.O)?.section === W.undetermined);
    check("W9i walking back in lists it again", rowNamed(card, NAME.O)?.section === W.undetermined);
    // Check range again with one outside.
    await gmRun(P.move, { moves: [{ uuid: T.O.uuid, x: HOME.O[0], y: HOME.O[1] }] });
    const key = (u) => u.replaceAll(".", "~");
    await gmRun(P.patchCard, { id: r.messageId, patch: { [`undetermined.${key(T.O.uuid)}`]: { uuid: T.O.uuid, name: NAME.O } } });
    card = await waitCard(gmRun, r.messageId, (c) => rowNamed(c, NAME.O)?.section === W.undetermined);
    await gmRun(P.click, { id: r.messageId, action: "itemRun.recheck" });
    card = await waitCard(gmRun, r.messageId, (c) => !rowNamed(c, NAME.O));
    check("W9i Check range again with the body outside drops it from the list too", !rowNamed(card, NAME.O));
    // An admitted body: Always on after the recheck, no Save for either seat.
    await gmRun(P.click, { id: r.messageId, action: "itemRun.recheck" });
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.A)) === W.always);
    const aRow = rowNamed(card, NAME.A);
    const aTip = aRow?.cells?.[W.colResult]?.tip ?? "";
    check("W9i Check range again lists the admitted body as Always on, not waiting, with no Save for the Judge", outcomeOf(aRow) === W.always && !hasBtn(aRow, "itemRun.roll"), { outcome: outcomeOf(aRow) });
    check("W9i hovering the Result names the part held on it and the item's page", aTip.includes(`+${FIGURES.standing.bonus}`) && aTip.includes("Aura Cards ref T"), { tip: aTip });
    const cRow = rowNamed(await waitCard(plRun, r.messageId, (c) => rowNamed(c, NAME.C)), NAME.C);
    check("W9i the Player owner's admitted body reads Always on with no Save", outcomeOf(cRow) === W.always && !hasBtn(cRow, "itemRun.roll"), { outcome: outcomeOf(cRow) });
    await gmRun(P.move, { moves: [{ uuid: T.A.uuid, x: HOME.A[0], y: HOME.A[1] }] });
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.A)) === W.out);
    check("W9i stepping the admitted body out mutes its row", outcomeOf(rowNamed(card, NAME.A)) === W.out && muted(rowNamed(card, NAME.A)));
    await gmRun(P.move, { moves: [{ uuid: T.A.uuid, x: 800, y: 700 }] });
    card = await waitCard(gmRun, r.messageId, (c) => outcomeOf(rowNamed(c, NAME.A)) === W.always);
    check("W9i and in again it reads Always on", outcomeOf(rowNamed(card, NAME.A)) === W.always);
    // Lower: the part is gone; a re-raise lists the body under Could not be settled again.
    await gmRun(P.click, { id: r.messageId, action: "itemRun.lower" });
    await until(async () => (await gmRun(P.card, { id: r.messageId }))?.lowered === true, 10000);
    await sleep(1500);
    const gone = (await carrier("M")).filter((e) => e.run.activationId === r.activationId).length;
    const r2 = await raise("T");
    card = await waitCard(gmRun, r2.messageId, (c) => rowNamed(c, NAME.M));
    check("W9i lowering took the part and a re-raise lists the body under Could not be settled again", gone === 0 && rowNamed(card, NAME.M)?.section === W.undetermined, { parts: gone, section: rowNamed(card, NAME.M)?.section });
    // Under a prompting reach.
    await reset({ place: { B: [700, 700], A: [800, 700], M: [900, 700] }, over: { S: () => shapes.save({ filter: filterOf("under") }) } });
    const rp = await raise("S");
    card = await waitCard(gmRun, rp.messageId, (c) => rowNamed(c, NAME.M));
    check("W9i (a prompting reach) the body of another group is listed under Could not be settled", rowNamed(card, NAME.M)?.section === W.undetermined, { section: rowNamed(card, NAME.M)?.section });
    await gmRun(P.move, { moves: [{ uuid: T.M.uuid, x: HOME.M[0], y: HOME.M[1] }] });
    card = await waitCard(gmRun, rp.messageId, (c) => rowNamed(c, NAME.M)?.section !== W.undetermined);
    const only = rowsOf(card).filter((x) => x.name === NAME.M);
    check("W9i (a prompting reach) at its exit the body reads Out in the table and is no longer under Could not be settled, never both", only.length === 1 && outcomeOf(only[0]) === W.out, only.map((x) => [x.section, outcomeOf(x)]));
    await gmRun(P.move, { moves: [{ uuid: T.M.uuid, x: 900, y: 700 }] });
    card = await waitCard(gmRun, rp.messageId, (c) => rowNamed(c, NAME.M)?.section === W.undetermined);
    const back = rowsOf(card).filter((x) => x.name === NAME.M);
    check("W9i (a prompting reach) walking back in lists it under Could not be settled with its Out row gone", back.length === 1 && back[0].section === W.undetermined, back.map((x) => [x.section, outcomeOf(x)]));
  });

  /* ---------------------------------------------------------------- */
  await step("W9d", async () => {
    section("W9d the morale page's line for a record an item's reach wrote");
    await reset({ place: { BS: [700, 700], R: [800, 700] } });
    const r = await raise("T");
    await sleep(1200);
    const part = (await carrier("R")).find((e) => e.run.activationId === r.activationId);
    check("W9d the morale body stands in a standing reach and holds the part", !!part, { parts: (await carrier("R")).length });
    const out = await gmRun(P.morale, { actorUuid: A.R.uuid });
    if (!out.opened || !out.rolled) {
      skip("W9d", `the morale page could not be driven from here: ${out.reason ?? "no card posted"}`);
      return;
    }
    if (out.uuid) disposables.push(gm.track(out.uuid, "ChatMessage"));
    const label = `${W.inReachOf} ${ITEMS.T.name}`;
    check("W9d the card's working lists In reach of the item with the figure", out.content.includes(label) && out.content.includes(`+${FIGURES.standing.bonus}`), { has: out.content.includes(label) });
    check("W9d the record's page is on the line", out.content.includes("Aura Cards ref T"), { cite: out.content.includes("Aura Cards ref T") });
    check("W9d the row's tooltip names where the figure came from", out.tips.some((t) => t.includes("Aura Cards ref T")), { tips: out.tips.length });
    skip("W9d (a spell's record on the same page keeps its own label)", "this walk writes no spell record on the body; the label rule for a spell is the unit suite's (`test-influence-records.mjs`)");
    skip("W9d (a henchman of the character)", "the body is a monster of the standing item's own group with a morale of its own; hiring a henchman for the character is not built here");
  });

  /* ---------------------------------------------------------------- */
  await step("W9e", async () => {
    section("W9e the edge distance on a square, a hex and a gridless scene");
    for (const [kind, scene, toks] of [["square", SC.main, null], ["hex", SC.hex, TK.hex], ["gridless", SC.gridless, TK.gridless]]) {
      await reset({ place: {} });
      const tokens = toks ? Object.fromEntries(["B", "M", "O", "A"].map((k) => [k, toks[k].uuid])) : { B: T.B.uuid, M: T.M.uuid, O: T.O.uuid, A: T.A.uuid };
      const g = await gmRun(P.grid, { sceneUuid: scene, kind, tokens, itemUuid: I.S.uuid, playerId: S.playerId });
      if (!g.ok) {
        skip(`W9e ${kind}`, g.reason ?? "the card did not list the bodies");
        continue;
      }
      const read = (k) => parseInt(g.rows[NAME[k]] ?? "", 10);
      note(`W9e ${kind} the card's distances (feet)`, { M: g.rows[NAME.M], O: g.rows[NAME.O], A: g.rows[NAME.A], expect: g.expect, cell: g.distance });
      check(`W9e ${kind}: tokens touching read 0′ and one empty cell apart reads one cell's feet`, read("M") === g.expect.M && read("O") === g.expect.O, { M: g.rows[NAME.M], O: g.rows[NAME.O], expect: g.expect });
      if (kind === "hex") skip("W9e hex (one square apart, diagonally)", "a hex grid has no diagonal; its two-cell reading is the one above");
      else check(`W9e ${kind}: diagonally one square apart reads one diagonal square's feet`, read("A") === g.expect.A, { A: g.rows[NAME.A], expect: g.expect.A });
    }
    // Leave the main scene viewed for the steps that follow.
    await reset({ place: {} });
  });

  /* ---------------------------------------------------------------- */
  await step("W10", async () => {
    section("W10 kinds on a generated Beastman");
    const rows = await gmRun(P.w10Rows);
    const kinds = ["toggle", "once"].filter((k) => rows[k]);
    note("W10 the activation kinds the import's equipment rows mint", kinds);
    if (!kinds.length) {
      w10Hold = "no imported equipment row mints an item the carrier runs, so there is no minted item to press";
      console.log(`HELD W10: ${w10Hold}`);
      return;
    }
    for (const kind of kinds) {
      await reset({ place: {} });
      const made = await gmRun(P.w10Make, { sceneUuid: SC.main, rowKey: rows[kind], x: 100, y: 1300 });
      // Tracked the moment each id is read, so a failure part way is still swept by id.
      for (const [uuid, docKind] of [[made.actor, "Actor"], [made.token, "Token"]]) if (uuid) disposables.push(gm.track(uuid, docKind));
      if (made.item) W10.itemUuids.push(made.item);
      if (made.name) W10.aliases.push(made.name);
      if (!made.ok && made.reason === "template") {
        w10Hold = `no imported Beastman template is present (${made.held} found), so there is no creature to generate and press an item on`;
        console.log(`HELD W10: ${w10Hold}`);
        return;
      }
      check(`W10 ${kind}: a Beastman was generated, given the imported row's minted item and placed on the scene`, made.ok === true, { reason: made.reason ?? null });
      if (!made.ok) continue;
      const regionsOn = () => gmRun((a) => [...(fromUuidSync(a.t)?.attachments?.regions ?? [])].filter((x) => [...x.behaviors].some((b) => b.type === "acks-extras.aura")).length, { t: made.token });
      const r = await gmRun(P.use, { itemUuid: made.item });
      if (!r.ok && (r.notes ?? []).length) {
        note(`W10 ${kind}: the press was refused with a notice`, r.notes);
        skip(`W10 ${kind}`, "the minted item's figures read blank on this world (an imported figure is missing), so the press was refused with a notice and wrote nothing, as a blank figure should");
        continue;
      }
      check(`W10 ${kind}: item.use() on the minted item acted and posted its card`, r.ok === true && r.kind === kind, { ok: r.ok, kind: r.kind });
      const card = r.messageId ? await gmRun(P.card, { id: r.messageId }) : null;
      check(`W10 ${kind}: the card's kind is the item's activation kind`, card?.kind === kind, { card: card?.kind ?? null });
      if (kind === "toggle") {
        check("W10 toggle: the item reads raised and a Region stands on the body's token", r.state?.active === true && (await regionsOn()) === 1, { active: r.state?.active });
        const down = await gmRun(P.use, { itemUuid: made.item });
        check("W10 toggle: using it again lowers it and the Region is gone", down.state?.active === false && (await regionsOn()) === 0, { active: down.state?.active });
      }
    }
  });

  /* ---------------------------------------------------------------- */
  await step("W11", async () => {
    section("W11 an untouched card is identical before and after");
    await reset({ place: { ...RING } });
    const made = await gmRun(P.coreSave, { actorUuid: A.M.uuid });
    check("W11 a core save card posted", !!made.id);
    if (made.id) disposables.push(gm.track(made.id, "ChatMessage"));
    const hashes = async (run) => { const c = await until(async () => run(P_read_html, { id: made.id }), 8000, 500); return c; };
    const gBefore = await hashes(gmRun);
    const pBefore = await hashes(plRun);
    // Everything the presenter does: a raise, a prompt, a press, a lowering.
    const r = await raise("S");
    await gmRun(P.click, { id: r.messageId, action: "itemRun.recheck" });
    await sleep(1500);
    await gmRun(P.click, { id: r.messageId, action: "itemRun.lower" });
    await sleep(2500);
    const gAfter = await hashes(gmRun);
    const pAfter = await hashes(plRun);
    check("W11 the card's content is identical on the GM seat after the carrier ran", !!gBefore && gBefore.hash === gAfter?.hash && gBefore.length === gAfter?.length, { before: gBefore, after: gAfter });
    if (pBefore) check("W11 and on the Player seat", pBefore.hash === pAfter?.hash && pBefore.length === pAfter?.length, { before: pBefore, after: pAfter });
    if (!pBefore) skip("W11 (Player seat)", "the Player seat holds no rendered copy of the card, so only the GM seat's copy is compared");
  });

  /* ---------------------------------------------------------------- */
  await step("W12", async () => {
    section("W12 showReach");
    const modes = await gmRun(P.visibilityModes);
    for (const [show, want, label] of [[true, modes.ALWAYS, "a Player"], [false, modes.GAMEMASTER, "the Judge alone"]]) {
      await reset({ place: { B: RING.B, M: RING.M }, over: { S: () => shapes.save({ showReach: show }) } });
      const r = await raise("S");
      await sleep(1000);
      const gmRegions = await gmRun(P.regions, { sceneUuid: SC.main });
      const plRegions = await plRun(P.regions, { sceneUuid: SC.main });
      check(`W12 showReach ${show}: the Region is drawn to ${label}`, gmRegions.length === 1 && gmRegions[0].visibility === want && plRegions.length === 1 && plRegions[0].visibility === want, { gm: gmRegions[0]?.visibility, player: plRegions[0]?.visibility, want });
      if (S.playerViews) note(`W12 showReach ${show}: the Region as the Player seat's canvas holds it`, plRegions[0]?.visibleObject);
      else note(`W12 showReach ${show}: the Player seat does not view the scene, so only the Region's stored visibility is read`, plRegions[0]?.visibility);
      void r;
    }
  });

  const late = await gmRun(P.caught);
  const lateP = await plRun(P.caught);
  note("errors this walk's seats recorded after ready", { gm: late.errors, player: lateP.errors });
  check("neither seat logged a console error during the walk", late.errors.length === 0 && lateP.errors.length === 0, { gm: late.errors.length, player: lateP.errors.length });
  if (w10Hold) blocked(`W10: ${w10Hold}`);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  try {
    if (gm) {
      const claimed = await gmRun(P.claim, { itemUuids: [...Object.values(I).map((i) => i.uuid), ...W10.itemUuids], aliases: [...Object.values(ROLES).map((r) => r.name), ...W10.aliases], names: [...new Set(Object.values(ITEMS).map((s) => s.name))] });
      for (const u of claimed) disposables.push(gm.track(u, "ChatMessage"));
      // The Player page records the cards it posted itself; the GM seat deletes them by those ids.
      if (pl) {
        const posted = await plRun(P.claim, { itemUuids: [...Object.values(I).map((i) => i.uuid), ...W10.itemUuids], aliases: [...Object.values(ROLES).map((r) => r.name), ...W10.aliases], names: [...new Set(Object.values(ITEMS).map((s) => s.name))] });
        for (const u of posted) if (!claimed.includes(u)) disposables.push(gm.track(u, "ChatMessage"));
      }
      const left = [];
      for (const scene of [SC.main, SC.hex, SC.gridless].filter(Boolean)) left.push(...(await gmRun(P.regions, { sceneUuid: scene })).map((r) => r.uuid));
      for (const u of left) disposables.push(gm.track(u, "Region"));
      await gmRun(P.closePopout);
      const tracked = new Set(gm.tracked().map((e) => e.uuid));
      const sw = await gm.sweepTracked({ only: [...new Set(disposables)].filter((u) => tracked.has(u)) });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm) await gmRun(() => globalThis.__lac?.disarm?.()); } catch {}
  try { if (pl) await plRun(() => globalThis.__lac?.disarm?.()); } catch {}
  try { if (pl) await pl.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const id of skipped) console.log(`SKIP  ${id}`);
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  console.log(`SKIPPED ${skipped.length} step(s) not reached`);
  console.log(`SUMMARY lib/aura-cards: ${passed}/${checks.length} checks passed${failed.length ? `; failed: ${failed.join(" | ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}

/** The read function for a card's rendered content, as a page function. */
function P_read_html(a) {
  const el = globalThis.__lac.msgEls(a.id)[0];
  const content = el?.querySelector(".message-content")?.innerHTML ?? null;
  if (content === null) return null;
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619) >>> 0;
  return { hash, length: content.length };
}

/** Two plates of the raised card at a 320 px chat width, taken only under SHOTS=1: the popout log, clipped to the card's own content. */
async function shootCard(id, slug) {
  try {
    const where = await gmRun(P.popout, { id, width: 320 });
    if (!where.found) { note(`shot ${slug}`, "the card is not in the popout log"); return; }
    const shot = await gm.shot(`${SHOT_DIR}/${slug}.png`, where.sel);
    note(`shot ${slug}`, { file: shot.file, bytes: shot.bytes });
  } catch (err) {
    note(`shot ${slug}`, `not taken: ${err?.message ?? err}`);
  } finally {
    await gmRun(P.closePopout).catch(() => {});
  }
}
