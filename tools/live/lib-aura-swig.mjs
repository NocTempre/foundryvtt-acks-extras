/**
 * Live walk, lib/aura-swig: a consumable's swig (a beastman's grog), a hit with
 * on-hit ammunition, and the grog's breakage, on the GM seat and a real Player
 * seat together. Walks docs/lib/TESTING.md, "S9b-2: E5 the swig, E8 on-hit, E5
 * breakage", steps 1 to 8, and "S9c: Light and Lit, Swigs left, the Judge's call", steps 9
 * and 10 and the leftFrom checks in step 6. Machine values arrive through ./_env.mjs.
 *
 * WRITTEN FROM THE CODE AND NOT YET RUN. Every assertion below follows
 * scripts/lib/item-run.mjs (`runConsume`, `swigOutcomeWriter`, `swigHeal`,
 * `swigAskSave`, `stampConsumeItem`), item-run-presenter.mjs, scripts/monsters/
 * grog-breakage.mjs and scripts/equipment/on-hit.mjs as they read, and none has
 * met a live world: the first run may fail on a selector, a timing or a rig value
 * (core 14: a randomUniform near 0 throws the top face of a die, near 1 a 1), and
 * a failure there is the walk's to fix before it is the code's.
 *
 * Every figure is invented, and the swig count is registered for this run alone
 * under the document `live-aura-swig`, so no imported table is shadowed; the
 * grog's `uses` refers to it the way scripts/monsters/organisation.mjs
 * `drinkItem` writes the live reference. The page prints no figure this walk
 * asserts (the owner: "No shipping house rules please."): a blank figure is
 * checked as writing nothing and showing the page reference alone.
 *
 * Which page rolls: a Save die rolls on the presser's page; a heal, a hand-on
 * count and a delayed-damage roll are made on the GM page. Dice are rigged on the
 * page that rolls and restored after each press. What was rolled is read off the
 * stored card, never predicted. A press the card draws no button for (a refusal
 * for a seat that does not own the drinker) is the lib's own call made in that
 * seat's page, and its label says so.
 *
 * Fixtures, kept and found by marker (`api.fixture`):
 *   scene `lib/aura-swig-scene`; actors `lib/aura-swig-bearer` (a beastman),
 *   `lib/aura-swig-human` (a character the Player seat owns, read as human through
 *   its `extras.types`), `lib/aura-swig-unknown` (a monster the Player seat owns,
 *   of no kind the module reads), `lib/aura-onhit-archer` and
 *   `lib/aura-onhit-target` (a character the Player seat owns); a linked token
 *   `<actor marker>-token` for each; grogs `lib/aura-swig-grog`,
 *   `lib/aura-swig-grog-blank` (the bearer's), `lib/aura-swig-grog-human`,
 *   `lib/aura-swig-grog-unknown`, `lib/aura-swig-grog-unknown-blank`; the archer's
 *   `lib/aura-onhit-launcher` and `lib/aura-onhit-ammo`.
 * Each step writes the shape it needs at its start. Nothing is rolled back at the end.
 *
 * The run's own products are tracked and swept by id: its combat, the disposable
 * bearers, recipients, tokens and the items handed on, and the cards its clients
 * posted that name a fixture item or speak as a fixture. The fixtures stay. Steps
 * that need what this walk cannot build print `SKIP <step>: <reason>`; a SKIP is
 * not a check and is counted apart.
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
let stepId = "0";
let inStep = 0;
/** One check, numbered by its step and its place in the step (`4.7`), so a failure names where it stands. */
const check = (label, ok, detail) => {
  const full = `${stepId}.${++inStep} ${label}`;
  checks.push([full, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${full}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const begin = (id, title) => {
  stepId = id;
  inStep = 0;
  section(`${id} ${title}`);
};
const skip = (step, reason) => {
  skipped.push(step);
  console.log(`SKIP ${step}: ${reason}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MOD = "acks-extras";
const DOC = "live-aura-swig";
const TABLE = "figures";
/** The invented swig count the grogs' `uses` names. */
const FIGURES = Object.freeze({ swig: { swigs: "1d3" } });
/** Invented figures: the bearer's heal and the success heal differ, the save is the one the fuse walk's fixtures already store, and the on-hit modifier is not zero. */
const HEAL = "1d4";
const SUCCESS = "1d6";
const SAVE = "blast";
const ITEM_CITE = "Aura Swig ref";
const ONHIT = Object.freeze({ saveKind: SAVE, saveMod: -2, formula: "1d6", delayTurns: 2, source: "Aura OnHit Shot", cite: ITEM_CITE });
/** Hit points written at each step's start (below the maximum, so a heal has room), the save target, and the ammunition count. */
const HP = 20;
const MAXHP = 40;
const SAVE_TARGET = 10;
const AMMO = 10;
/** `CONFIG.Dice.randomUniform` values: the top face of every die, a 1 on every die, and a middle face. */
const DIE = Object.freeze({ top: 0.025, one: 0.975, mid: 0.5 });

/** The bodies and their places (pixels, top-left of a one-square token on a 100 px, 5 ft grid). `types` is the `extras.types` the body is read by. */
const ROLES = Object.freeze({
  B: { marker: "lib/aura-swig-bearer", name: "Aura Swig Bearer", type: "monster", at: [1000, 700], types: ["beastman"] },
  H: { marker: "lib/aura-swig-human", name: "Aura Swig Human", type: "character", at: [1000, 900], owned: true, types: ["human"] },
  U: { marker: "lib/aura-swig-unknown", name: "Aura Swig Unknown", type: "monster", at: [1200, 900], owned: true, types: [] },
  A: { marker: "lib/aura-onhit-archer", name: "Aura OnHit Archer", type: "character", at: [700, 700], types: [] },
  X: { marker: "lib/aura-onhit-target", name: "Aura OnHit Target", type: "character", at: [700, 900], owned: true, types: [] },
});

/** The kept grogs: whose they are, their marker and name, and the drink flag each is reset to (`drink`, read when used, since the condition is chosen at run time). */
const GROGS = Object.freeze({
  bearer: { role: "B", marker: "lib/aura-swig-grog", name: "Aura Swig Grog", id: "grog", blank: false },
  blank: { role: "B", marker: "lib/aura-swig-grog-blank", name: "Aura Swig Grog Blank", id: "grog-blank", blank: true },
  human: { role: "H", marker: "lib/aura-swig-grog-human", name: "Aura Swig Grog Human", id: "grog-human", blank: false },
  unknown: { role: "U", marker: "lib/aura-swig-grog-unknown", name: "Aura Swig Grog Unknown", id: "grog-unknown", blank: false },
  unknownBlank: { role: "U", marker: "lib/aura-swig-grog-unknown-blank", name: "Aura Swig Grog Unknown Blank", id: "grog-unknown-blank", blank: true },
});
let COND = null;
/** The drink flag as `monsters/organisation.mjs` `drinkFlag` writes it: a blank heal is null. */
const drinkOf = (blank) => ({ healDice: blank ? null : HEAL, saveKind: SAVE, condition: COND, successHealDice: SUCCESS, swigDice: null, ownKind: "beastman" });

const ref = (row, figure) => ({ doc: DOC, table: TABLE, row, figure });
/** A grog item as `drinkItem` mints it: the drink flag, a consume activation whose `uses` is a live reference, `left` null and no bearer stamped. */
const grogData = (name, id, drink, left = null) => ({
  name, type: "item",
  system: { description: "", subtype: "item", quantity: 1, cost: 0, weight: 0, weight6: 0 },
  flags: { [MOD]: { cookbook: { id: `walk.aura-swig.${id}`, cite: ITEM_CITE }, drink, itemRun: { activation: { kind: "consume", uses: ref("swig", "swigs"), left, bearerUuid: "" } } } },
});
const ammoData = () => ({
  name: "Aura OnHit Arrows", type: "item",
  system: { description: "", subtype: "item", quantity: AMMO, cost: 0, weight: 0, weight6: 0 },
  flags: { [MOD]: { cookbook: { id: "walk.aura-swig.ammo", cite: ITEM_CITE }, onHit: { ...ONHIT }, nocked: true } },
});
/** The launcher: a weapon that can only be used at range and is declared a bow by its category flag, so the shot's stack is told by name (`arrow`). */
const launcherData = () => ({
  name: "Aura OnHit Bow", type: "weapon",
  system: { melee: false, missile: true, damage: { base: { formula: "1d6" } } },
  flags: { [MOD]: { category: "bowCrossbow" } },
});

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__swigBoot = { phase: "load", phases: [], errors: [] });
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

  /** The status id a failed swig's condition is written as: the first of a short list the catalogue holds, else any ordinary one. */
  pickCondition: () => {
    const ids = (CONFIG.statusEffects ?? []).map((s) => s.id);
    const special = new Set(Object.values(CONFIG.specialStatusEffects ?? {}));
    const want = ["slowed", "blinded", "prone", "deafened", "frightened", "stunned", "paralysed"];
    return want.find((k) => ids.includes(k)) ?? ids.find((id) => !special.has(id) && !/^(dead|defeated)/i.test(String(id))) ?? null;
  },

  /** Arm the recorders and helpers on this seat and register the invented figures; replaces an earlier install. */
  install: async ({ doc, table, figures }) => {
    globalThis.__las?.disarm?.();
    const H = (globalThis.__las = {});
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
      healed: card("healed"), saved: card("saved"), failed: card("failed"), undone: card("undone"), undo: card("undo"), heal: card("heal"), askSave: card("askSave"),
      unknownNote: card("unknownNote"), unknownNoteOther: card("unknownNoteOther"), unknownHealBlank: card("unknownHealBlank"), whyFigure: card("why.figure"),
      refusedSpent: L("ACKS-LIB.itemRun.refused.spent"),
      declared: card("declared"), declarePass: card("declarePass"), declareFail: card("declareFail"), noSaveLine: card("noSaveLine"), refusedNotOwner: L("ACKS-LIB.itemRun.refused.notOwner"),
    };

    try { if (!ui.chat?.rendered) { await ui.hotbar?.render?.({ force: true }); await ui.chat.render({ force: true }); } } catch { /* the walk finds out when it looks for a card */ }

    H.msgEls = (id) => [...document.querySelectorAll(`li.chat-message[data-message-id="${id}"]`)];
    /** A card's rendered content on this seat: its text, every tooltip it carries and every button with its data attributes. */
    H.read = (id) => {
      const el = H.msgEls(id).find((e) => e.querySelector(".acks-extras-roll-card"));
      if (!el) return null;
      const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
      const btn = (b) => ({ action: b.dataset.action, label: txt(b), tip: b.dataset.tooltipText ?? "", data: { ...b.dataset } });
      return {
        title: txt(el.querySelector(".acks-chat-title")), note: txt(el.querySelector(".acks-extras-roll-note")), text: txt(el),
        tips: [...el.querySelectorAll("[data-tooltip-text]")].map((n) => n.dataset.tooltipText ?? ""),
        lines: [...el.querySelectorAll("p.acks-extras-roll-footnote")].map(txt),
        rows: [...el.querySelectorAll("tbody tr")].map((tr) => ({ text: txt(tr), tips: [...tr.querySelectorAll("[data-tooltip-text]")].map((n) => n.dataset.tooltipText ?? ""), buttons: [...tr.querySelectorAll("button[data-action]")].map(btn) })),
        buttons: [...el.querySelectorAll("button[data-action]")].map(btn),
      };
    };
    return { user: game.user.name, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, extras: game.modules.get("acks-extras")?.version, words: H.words, read, chat: !!ui.chat?.rendered };
  },

  caught: () => ({ errors: globalThis.__las?.errors ?? [], boot: globalThis.__swigBoot ?? null, said: globalThis.__las?.said ?? [] }),
  view: async ({ sceneUuid }) => {
    const H = globalThis.__las;
    const scene = fromUuidSync(sceneUuid);
    if (!scene) return { viewing: false, reason: "no scene" };
    let threw = null;
    if (canvas.scene?.id !== scene.id) {
      try { await scene.view(); } catch (e) { threw = String(e?.message ?? e); }
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 12000);
    }
    return { viewing: canvas.scene?.id === scene.id, threw };
  },

  /** Bring the fixtures to a step's start shape: the scene viewed, effects the walk's presses wrote cleared, ownership, hit points and save, tokens home, and each item's patch. */
  reset: async ({ view, actors, tokens, items, playerId, cond }) => {
    const H = globalThis.__las;
    H.unrig();
    const out = { viewing: false, warnings: [], cleared: 0 };
    const scene = fromUuidSync(view);
    if (canvas.scene?.id !== scene.id) {
      await scene.view();
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 15000);
    }
    out.viewing = canvas.scene?.id === scene.id;
    for (const a of actors) {
      const actor = fromUuidSync(a.uuid);
      if (!actor) { out.warnings.push(`no actor ${a.uuid}`); continue; }
      const ids = [...actor.effects].filter((e) => {
        const f = e.flags?.["acks-extras"] ?? {};
        return f.itemRun || f.delayedDamage || f.turnMark || f.turnLife || (cond && e.statuses?.has(cond));
      }).map((e) => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { "acks-extras": { managedDelete: true } });
      out.cleared += ids.length;
      const patch = { ownership: { default: 0, [playerId]: a.owned ? 3 : 0 }, "system.hp.value": a.hp, "system.hp.max": a.max, "system.saves.blast.value": a.save };
      if (a.types.length) patch["flags.acks-extras.extras.types"] = a.types;
      await actor.update(patch);
    }
    for (const t of tokens) await fromUuidSync(t.uuid).update({ x: t.x, y: t.y, hidden: false }, { animate: false });
    for (const s of items) {
      const item = fromUuidSync(s.uuid);
      if (!item) { out.warnings.push(`no item ${s.uuid}`); continue; }
      await item.update(s.patch);
    }
    await H.sleep(500);
    return out;
  },

  rig: ({ value }) => { const H = globalThis.__las; if (value === null) H.unrig(); else H.rig(value); return true; },

  /** Use an item, rigged or not, and wait for its card to settle: the message that names the item and its stored state. A refused use posts none, and `ms` bounds the wait for one. */
  use: async ({ itemUuid, die, ms = 8000 }) => {
    const H = globalThis.__las;
    const item = fromUuidSync(itemUuid);
    const before = new Set(game.messages.map((m) => m.id));
    const said0 = H.said.length;
    if (die !== null) H.rig(die);
    try { await item.use(); } finally { if (die !== null) H.unrig(); }
    const id = await H.until(() => game.messages.find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.itemRunCard?.itemUuid === itemUuid)?.id ?? null, ms);
    let last = "";
    for (let i = 0; i < 20 && id; i++) {
      await H.sleep(400);
      const now = JSON.stringify(game.messages.get(id)?.flags?.["acks-extras"]?.itemRunCard ?? null);
      if (now === last) break;
      last = now;
    }
    return { messageId: id, said: H.said.slice(said0) };
  },

  /** A card's stored state, trimmed to what the walk reads. */
  card: ({ id }) => {
    const c = game.messages.get(id)?.flags?.["acks-extras"]?.itemRunCard;
    if (!c) return null;
    return {
      kind: c.kind, rowKey: c.rowKey ?? null, itemUuid: c.itemUuid ?? "", outcome: c.outcome ?? null, heal: c.heal ?? null, why: c.why ?? "", left: c.left ?? null,
      title: c.title ?? "", subtitle: c.subtitle ?? "", cite: c.cite ?? "", bearer: c.bearer ?? null,
      resolved: c.resolved ?? null, resolvedBy: c.resolvedBy ?? "", amount: c.amount ?? null, rolled: c.rolled ?? null, asked: c.asked === true, askedBy: c.askedBy ?? "",
      saveName: c.saveName ?? "", saveMod: c.saveMod ?? null, saveKind: c.saveKind ?? null, healDice: c.healDice ?? null, successHealDice: c.successHealDice ?? null, condition: c.condition ?? null,
      drinkerActorUuid: c.drinkerActorUuid ?? "", drinkerTokenUuid: c.drinkerTokenUuid ?? "",
      formula: c.formula ?? null, delayTurns: c.delayTurns ?? null, source: c.source ?? "", struckAt: c.struckAt ?? null,
      subjects: Object.values(c.subjects ?? {}).map((s) => ({ uuid: s.uuid, name: s.name })),
      entries: Object.entries(c.entries ?? {}).map(([key, e]) => ({ key, subject: e.subject, state: e.state, saved: e.saved ?? null, declared: e.declared === true, total: e.total ?? null, target: e.target ?? null, amount: e.amount ?? null, hp: e.hp ?? [], recordIds: e.recordIds ?? [], names: e.names ?? [], life: e.life ?? "", why: e.why ?? "", presser: e.presser ?? "" })),
    };
  },

  /** Click a card's own button in this seat's page; false where it is not there. `match` names the button's data attributes. */
  click: ({ id, action, match = {} }) => {
    const H = globalThis.__las;
    for (const el of H.msgEls(id)) {
      const b = [...el.querySelectorAll(`button[data-action="${action}"]`)].find((x) => Object.entries(match).every(([k, v]) => x.dataset[k] === v));
      if (b && !b.disabled) { b.click(); return true; }
    }
    return false;
  },
  /** The lib's own press, called in this page where the card draws no button for it. */
  api: async ({ call, args }) => {
    const out = await acksExtras.lib.itemRun[call](args);
    return { ok: out?.ok ?? null, reason: out?.reason ?? null, state: out?.state ?? null, amount: out?.amount ?? null };
  },

  hp: ({ tokenUuid }) => fromUuidSync(tokenUuid)?.actor?.system?.hp?.value ?? null,
  actorHp: ({ uuid }) => fromUuidSync(uuid)?.system?.hp?.value ?? null,
  setHp: async ({ uuid, value, max }) => { await fromUuidSync(uuid).update({ "system.hp.value": value, "system.hp.max": max }); return true; },
  kinds: ({ uuid }) => [...acksExtras.lib.actorRead.creatureKinds(fromUuidSync(uuid))].sort(),
  saveTarget: ({ actorUuid, save }) => acksExtras.lib.saves.saveSpec(fromUuidSync(actorUuid), save)?.target ?? null,
  attackThrow: ({ uuid }) => fromUuidSync(uuid)?.system?.attack?.throw ?? null,
  /** An item's activation as stored: its count, its stamped bearer, whether it resolves. */
  activation: ({ uuid }) => {
    const i = fromUuidSync(uuid);
    const a = i?.flags?.["acks-extras"]?.itemRun?.activation;
    return { exists: !!i, left: a?.left ?? null, leftFrom: a?.leftFrom ? foundry.utils.deepClone(a.leftFrom) : null, bearerUuid: a?.bearerUuid ?? "" };
  },
  actorItems: ({ uuid }) => [...(fromUuidSync(uuid)?.items ?? [])].map((i) => ({ uuid: i.uuid, name: i.name })),
  /** What an actor holds as effects, with the carrier's flags. */
  effects: ({ uuid }) => [...(fromUuidSync(uuid)?.effects ?? [])].map((e) => {
    const f = e.flags?.["acks-extras"] ?? {};
    return { id: e.id, name: e.name, statuses: [...(e.statuses ?? [])], turnLife: f.turnLife ? foundry.utils.deepClone(f.turnLife) : null, mark: !!f.turnMark, delayed: f.delayedDamage ? foundry.utils.deepClone(f.delayedDamage) : null };
  }),
  own: async ({ uuid, playerId, level }) => { await fromUuidSync(uuid).update({ ownership: { default: 0, [playerId]: level } }); return true; },
  judges: () => game.users.filter((u) => u.isGM).map((u) => u.id).sort(),
  turnSeconds: () => acksExtras.lib.timeUnit.turnSeconds(),
  worldTime: () => game.time.worldTime,
  started: () => !!game.combat?.started,
  advance: async ({ seconds }) => { await game.time.advance(seconds); await globalThis.__las.sleep(1500); return game.time.worldTime; },

  /** The Judges' whispered lines naming two strings since a moment. */
  whispers: ({ since, a, b }) => game.messages.filter((m) => Number(m.timestamp) >= since && (m.whisper ?? []).length && !m.flags?.["acks-extras"]?.itemRunCard && String(m.content).includes(a) && String(m.content).includes(b)).map((m) => ({ id: m.id, to: [...m.whisper].sort() })),

  /** A copy of an item put on another actor, as a drop does (`createEmbeddedDocuments`), without the fixture marker; waits for the stamp the primary GM's window writes, with `die` rigged for the count it may roll. */
  handOn: async ({ sourceUuid, actorUuid, die }) => {
    const H = globalThis.__las;
    const source = fromUuidSync(sourceUuid);
    const data = source.toObject();
    delete data._id;
    if (data.flags?.world) delete data.flags.world;
    if (die !== null) H.rig(die);
    let made;
    try {
      [made] = await fromUuidSync(actorUuid).createEmbeddedDocuments("Item", [data]);
      await H.until(() => made.flags?.["acks-extras"]?.itemRun?.activation?.bearerUuid === actorUuid, 8000);
      await H.sleep(800);
    } finally {
      if (die !== null) H.unrig();
    }
    const a = made.flags?.["acks-extras"]?.itemRun?.activation;
    return { uuid: made.uuid, left: a?.left ?? null, leftFrom: a?.leftFrom ? foundry.utils.deepClone(a.leftFrom) : null, bearerUuid: a?.bearerUuid ?? "" };
  },

  /** Mark a body defeated by the token HUD's status control, as a user does; the status written by the actor's own toggle where the control is not found. */
  defeat: async ({ tokenUuid }) => {
    const H = globalThis.__las;
    const doc = fromUuidSync(tokenUuid);
    const actor = doc?.actor;
    const id = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
    if (!actor) return { has: false, gesture: false, why: "no actor", status: id };
    let gesture = false;
    let why = "";
    const obj = doc.object ?? canvas.tokens.get(doc.id);
    if (obj) {
      obj.control({ releaseOthers: true });
      await canvas.tokens.hud.bind(obj);
      await H.sleep(500);
      const control = () => document.querySelector("#token-hud")?.querySelector(`[data-status-id="${id}"]`);
      if (!control()) { document.querySelector("#token-hud")?.querySelector('[data-action="togglePalette"][data-palette="effects"]')?.click(); await H.sleep(400); }
      const b = control();
      if (b) {
        b.click();
        await H.sleep(1500);
        gesture = actor.statuses.has(id);
        if (!gesture) why = "the control was clicked and no status landed";
      } else why = "no defeated control in the HUD";
      try { canvas.tokens.hud.close(); } catch { /* a HUD already closed */ }
    } else why = "no placeable";
    if (!actor.statuses.has(id)) { await actor.toggleStatusEffect(id, { active: true }); await H.sleep(1500); }
    return { has: actor.statuses.has(id), gesture, why, status: id };
  },
  /** A second status event on the same actor: the defeated effect is rewritten, then the status is switched off and on. */
  statusAgain: async ({ uuid }) => {
    const H = globalThis.__las;
    const actor = fromUuidSync(uuid);
    const id = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
    const effect = [...actor.effects].find((e) => e.statuses?.has(id));
    if (effect) await effect.update({ "flags.world.walkTouch": Date.now() });
    await H.sleep(1500);
    await actor.toggleStatusEffect(id, { active: false });
    await H.sleep(800);
    await actor.toggleStatusEffect(id, { active: true });
    await H.sleep(1500);
    return { touched: !!effect, has: actor.statuses.has(id) };
  },

  /** The combat the walk runs its fight in: the tracker's flags and the initiatives, no turn begun. */
  fight: async ({ combatId, rows, inits }) => {
    const combat = game.combats.get(combatId);
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    await combat.updateEmbeddedDocuments("Combatant", Object.keys(rows).map((k) => ({ _id: rows[k], initiative: inits[k], defeated: false, hidden: false })));
    combat.setupTurns();
    if (!combat.active && typeof combat.activate === "function") await combat.activate();
    return { order: combat.turns.map((t) => t.name), active: !!combat.active, combatants: Object.fromEntries(combat.turns.map((t) => [t.tokenId, t.id])) };
  },
  /** Begin a combatant's turn in a given round, as the tracker does; the turn edges it crosses are lib's. */
  turnTo: async ({ combatId, round, tokenId, ms = 1800 }) => {
    const combat = game.combats.get(combatId);
    const turn = combat.turns.findIndex((t) => t.tokenId === tokenId);
    if (turn < 0) return { ok: false, reason: "no combatant" };
    await combat.update({ round, turn });
    await globalThis.__las.sleep(ms);
    return { ok: true, round: combat.round, turn: combat.turn };
  },
  deleteCombat: async ({ combatId }) => { await game.combats.get(combatId)?.delete(); await globalThis.__las.sleep(1500); return true; },

  /** One missile attack as a user makes it: `makeAttackThrow` on the archer, against this seat's target (none where `targetTokenId` is null), the dice rigged for the throw. Marks the messages that stand now. */
  attack: async ({ actorUuid, itemUuid, targetTokenId, die }) => {
    const H = globalThis.__las;
    const actor = fromUuidSync(actorUuid);
    const weapon = fromUuidSync(itemUuid);
    canvas.tokens.setTargets(targetTokenId ? [targetTokenId] : []);
    await H.sleep(200);
    H.mark = new Set(game.messages.map((m) => m.id));
    H.rig(die);
    let outcome = null;
    let error = null;
    try { outcome = await actor.makeAttackThrow({ item: weapon, attackType: "missile", skipDialog: true }); } catch (e) { error = String(e?.message ?? e); } finally { H.unrig(); }
    canvas.tokens.setTargets([]);
    return { rolled: !!outcome, isHit: outcome?.resolution?.isHit ?? null, error, worldTime: game.time.worldTime };
  },
  /** The on-hit cards posted since the last `attack`, polled for `ms`: the post is not awaited by the attack. */
  newOnHit: async ({ ms }) => {
    const H = globalThis.__las;
    const find = () => game.messages.filter((m) => !H.mark.has(m.id) && m.flags?.["acks-extras"]?.itemRunCard?.kind === "onHit").map((m) => m.id);
    const found = await H.until(() => { const f = find(); return f.length ? f : null; }, ms, 200);
    await H.sleep(600);
    return found ? find() : [];
  },
  /** A save as the card's press throws it, on this page with the die rigged, with or without the card's modifier. */
  control: async ({ actorUuid, save, mod, die }) => {
    const H = globalThis.__las;
    H.rig(die);
    try {
      const r = await acksExtras.lib.saves.saveThrow(fromUuidSync(actorUuid), save, mod ? { situational: mod } : {});
      return { total: Number(r?.total), target: Number(r?.target) };
    } finally {
      H.unrig();
    }
  },

  /* ---- the sheets' "Swigs left" box ---- */

  /** Whether this seat owns a document by Foundry's own test, and at what level. */
  owns: ({ uuid }) => { const d = fromUuidSync(uuid); return { owner: d?.isOwner === true, level: d?.getUserLevel?.(game.user) ?? null }; },
  /** Write the drink flag of an item (merged), so a step can blank one figure. */
  setDrink: async ({ uuid, drink }) => { await fromUuidSync(uuid).update({ "flags.acks-extras.drink": drink }); return true; },
  /** Open an actor's sheet on a tab and wait for its element; a tab the sheet lacks is not an error. */
  openSheet: async ({ uuid, tab }) => {
    const H = globalThis.__las;
    const sheet = fromUuidSync(uuid).sheet;
    await sheet.render({ force: true });
    await H.until(() => sheet.rendered && sheet.element, 8000);
    let changed = null;
    if (tab) { try { await sheet.changeTab(tab, "primary", { force: true }); changed = true; } catch (e) { changed = String(e?.message ?? e); } }
    await H.sleep(700);
    return { rendered: !!sheet.rendered, sheet: sheet.constructor.name, changed };
  },
  closeSheet: async ({ uuid }) => { try { await fromUuidSync(uuid).sheet.close({ animate: false }); } catch { /* closed */ } return true; },
  /** The "Swigs left" boxes an open actor sheet draws (each with its item, text, tooltip and whether it is wired) and the item uuids of the Use presses it draws. */
  leftBoxes: ({ uuid }) => {
    const sheet = fromUuidSync(uuid).sheet;
    const el = sheet.element;
    const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      rendered: !!sheet.rendered,
      boxes: [...(el?.querySelectorAll?.("input[data-acks-extras-run-left]") ?? [])].map((i) => ({ itemUuid: i.dataset.itemUuid ?? "", value: i.value, tip: i.dataset.tooltipText ?? "", wired: i.dataset.wired === "1", label: txt(i.closest("label")) })),
      presses: [...(el?.querySelectorAll?.('button[data-action="itemRunPress"]') ?? [])].map((b) => b.dataset.itemUuid ?? ""),
    };
  },
  /** Type into an item's box as a user does: the text is set and a real `change` event is dispatched on the input; false where no such box is drawn. */
  typeLeft: async ({ uuid, itemUuid, text }) => {
    const H = globalThis.__las;
    const input = [...(fromUuidSync(uuid).sheet.element?.querySelectorAll?.("input[data-acks-extras-run-left]") ?? [])].find((i) => i.dataset.itemUuid === itemUuid);
    if (!input) return false;
    input.value = text;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(900);
    return true;
  },
  /** The sheet's own write for the box, called with a box-shaped stand-in where this seat's sheet draws none; answers whether anything was written. */
  writeLeft: async ({ itemUuid, text }) => {
    const V = await import("/modules/acks-extras/scripts/lib/item-run-row-view.mjs");
    const input = { dataset: { itemUuid }, value: text };
    const done = await V.writeRunLeft(input);
    return { written: !!done, boxText: input.value };
  },

  /** The cards this page posted that the walk may claim: they carry a fixture item or name one. */
  claim: ({ itemUuids, names }) => {
    const out = [];
    for (const uuid of globalThis.__las?.cards ?? []) {
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
const cardWhen = async (id, pred, ms = 10000) => { let last = null; await until(async () => { last = await gmRun(P.card, { id }); return last && pred(last) ? last : null; }, ms); return last; };
/** A card as a seat draws it, polled until it is there. */
const read = async (run, id) => until(async () => run((a) => globalThis.__las.read(a.id), { id }), 8000, 400);
const keyOf = (uuid) => uuid.replaceAll(".", "~");
const fmt = (key, data) => gmRun((a) => globalThis.__las.fmt(a.key, a.data), { key, data });
const hasBtn = (btns, action) => (btns ?? []).some((b) => b.action === action);

const S = { playerId: null, combat: null, scene: null, round: 0, cond: null };
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
    stepId = String(name);
    check(`${name} ran to its end`, false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
}

/** Bring the fixtures to a step's start shape: all home, hit points below the maximum, no effect a press wrote, each grog's count as `left` says (null where not named) and stamped to its own actor, the Player's ownership as `own` says. */
async function reset({ own = {}, left = {}, hp = HP } = {}) {
  const actors = Object.entries(ROLES).map(([k, r]) => ({ uuid: A[k].uuid, owned: own[k] ?? !!r.owned, hp, max: MAXHP, save: SAVE_TARGET, types: r.types }));
  const tokens = Object.keys(ROLES).map((k) => ({ uuid: T[k].uuid, x: ROLES[k].at[0], y: ROLES[k].at[1] }));
  const items = Object.entries(GROGS).map(([k, g]) => ({ uuid: I[k].uuid, patch: { "flags.acks-extras.cookbook.cite": ITEM_CITE, "flags.acks-extras.drink": drinkOf(g.blank), "flags.acks-extras.itemRun.activation.kind": "consume", "flags.acks-extras.itemRun.activation.uses": ref("swig", "swigs"), "flags.acks-extras.itemRun.activation.left": left[k] ?? null, "flags.acks-extras.itemRun.activation.leftFrom": null, "flags.acks-extras.itemRun.activation.bearerUuid": A[g.role].uuid, "system.quantity": 1 } }));
  items.push({ uuid: I.ammo.uuid, patch: { "system.quantity": AMMO, "flags.acks-extras.cookbook.cite": ITEM_CITE, "flags.acks-extras.onHit": { ...ONHIT }, "flags.acks-extras.nocked": true } });
  const out = await gmRun(P.reset, { view: S.scene, actors, tokens, items, playerId: S.playerId, cond: COND });
  if (!out.viewing || out.warnings.length) check("the fixtures reset to a step's start shape", false, out);
  await plRun(P.view, { sceneUuid: S.scene });
  return out;
}
/** Use an item and answer its settled card; throws where no card came. */
const useItem = async (item, die) => {
  const r = await gmRun(P.use, { itemUuid: item.uuid, die });
  if (!r.messageId) throw new Error(`no card was posted for ${item.uuid} (${JSON.stringify(r.said)})`);
  return r;
};
const hp = (k) => gmRun(P.hp, { tokenUuid: T[k].uuid });
const activation = (item) => gmRun(P.activation, { uuid: item.uuid });
const effectsOf = (k) => gmRun(P.effects, { uuid: A[k].uuid });
/**
 * Press a button on a seat with the dice rigged on the page that rolls (`gmDie` the GM page's, `plDie` the Player page's), wait until `pred` holds of the stored card, and restore both.
 * Answers `{found, card}`.
 */
async function press(run, { id, action, match = {} }, { gmDie = null, plDie = null, until: pred = null, ms = 12000 } = {}) {
  if (gmDie !== null) await gmRun(P.rig, { value: DIE[gmDie] });
  if (plDie !== null) await plRun(P.rig, { value: DIE[plDie] });
  let found = false;
  let card = null;
  try {
    found = await run(P.click, { id, action, match });
    if (found && pred) card = await cardWhen(id, pred, ms);
  } finally {
    if (gmDie !== null) await gmRun(P.rig, { value: null });
    if (plDie !== null) await plRun(P.rig, { value: null });
  }
  return { found, card };
}
const entryOf = (card, k) => card?.entries?.find((e) => e.subject === T[k].uuid) ?? null;
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
  begin("0", "seats and fixtures");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after reload (s)", await reloadRecorded(gm, PORTS.gm));
  pl = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after reload (s)", await reloadRecorded(pl, PORTS.player));
  S.playerId = await gmRun(P.userId, MACHINE.player);
  if (!S.playerId) blocked("no Player user on this world");
  COND = await gmRun(P.pickCondition);
  if (!COND) blocked("the status catalogue offers no condition for a failed swig to write");
  const install = { doc: DOC, table: TABLE, figures: FIGURES };
  const gi = await gmRun(P.install, install);
  const pi = await plRun(P.install, install);
  W = gi.words;
  check("the GM seat is a GM and the primary one, the Player seat is not a GM", gi.isGM && gi.activeGMIsSelf && pi.isGM === false, { active: gi.activeGMIsSelf });
  if (!gi.activeGMIsSelf) blocked("another client is the active GM; the stamp and the breakage would run there");
  for (const [run, who] of [[gmRun, "gm"], [plRun, "player"]]) {
    const c = await run(P.caught);
    check(`${who}: init, setup and ready reached with no console error`, ["init", "setup", "ready"].every((p) => c.boot?.phases.includes(p)) && c.boot.errors.length === 0, { phases: c.boot?.phases, errors: c.boot?.errors });
  }
  if (await gmRun(P.started)) blocked("a started combat is on the GM seat; the outside-a-fight steps need none");

  const scene = await gm.fixture("lib/aura-swig-scene", "Scene", { name: "Aura Swig Square", width: 2400, height: 1800, padding: 0, grid: { size: 100, distance: 5, units: "ft", type: 1 } });
  S.scene = scene.uuid;
  for (const [k, r] of Object.entries(ROLES)) {
    const data = { name: r.name, type: r.type, ownership: { default: 0, [S.playerId]: r.owned ? 3 : 0 } };
    if (r.type !== "character") data.prototypeToken = { actorLink: true };
    if (r.types.length) data.flags = { [MOD]: { extras: { types: r.types } } };
    A[k] = await gm.fixture(r.marker, "Actor", data);
    T[k] = await gm.fixture(`${r.marker}-token`, "Token", { name: r.name, actorId: A[k].id, actorLink: true, x: r.at[0], y: r.at[1] }, { parent: scene.uuid });
  }
  for (const [k, g] of Object.entries(GROGS)) I[k] = await gm.fixture(g.marker, "Item", grogData(g.name, g.id, drinkOf(g.blank)), { parent: A[g.role].uuid });
  I.launcher = await gm.fixture("lib/aura-onhit-launcher", "Item", launcherData(), { parent: A.A.uuid });
  I.ammo = await gm.fixture("lib/aura-onhit-ammo", "Item", ammoData(), { parent: A.A.uuid });
  // A kept launcher keeps whatever shape the last walk left: the weapon fields and the category are written again.
  await gmRun(async (a) => { await fromUuidSync(a.uuid).update(a.patch); return true; }, { uuid: I.launcher.uuid, patch: { "system.melee": false, "system.missile": true, "flags.acks-extras.category": "bowCrossbow" } });
  note("fixtures", { actors: Object.keys(A).length, tokens: Object.keys(T).length, built: gm.tracked().length, condition: COND });
  await reset();
  await sleep(1000);
  const read0 = { gm: gi.read, pl: pi.read };
  check("the invented swig count reads back on both seats", same(read0.gm, FIGURES) && same(read0.pl, FIGURES), read0);
  const kinds = { B: await gmRun(P.kinds, { uuid: A.B.uuid }), H: await gmRun(P.kinds, { uuid: A.H.uuid }), U: await gmRun(P.kinds, { uuid: A.U.uuid }) };
  check("the bearer reads as a beastman, the human drinker as human and not a beastman, the unknown drinker as neither", kinds.B.includes("beastman") && kinds.H.includes("human") && !kinds.H.includes("beastman") && !kinds.U.includes("beastman") && !kinds.U.includes("human") && !kinds.U.includes("demi-human"), kinds);
  const targets = { H: await gmRun(P.saveTarget, { actorUuid: A.H.uuid, save: SAVE }), U: await gmRun(P.saveTarget, { actorUuid: A.U.uuid, save: SAVE }), X: await gmRun(P.saveTarget, { actorUuid: A.X.uuid, save: SAVE }) };
  check("the human drinker, the unknown drinker and the on-hit target each read a stored save target", Object.values(targets).every((t) => Number.isFinite(t)), targets);

  /* ---------------------------------------------------------------- */
  await step("1", async () => {
    begin("1", "The bearer's swig: healed, shown, and the swigs left");
    await reset({ left: { bearer: 3 } });
    const hp0 = await hp("B");
    const r = await useItem(I.bearer, DIE.top);
    const card = await cardWhen(r.messageId, (c) => c.kind === "consume");
    note("1 what the card stored", { outcome: card?.outcome, heal: card?.heal, left: card?.left, cite: card?.cite });
    check("the card is the bearer's own swig: a heal of the drink's dice, rolled once, within the dice's faces", card?.kind === "consume" && card.outcome === "heal" && card.heal?.dice === HEAL && Number.isInteger(card.heal.rolled) && card.heal.rolled >= 1 && card.heal.rolled <= 4, card?.heal);
    check("the hit points rose by exactly the amount the card stored", Number.isInteger(card?.heal?.amount) && card.heal.amount > 0 && (await hp("B")) - hp0 === card.heal.amount, { before: hp0, now: await hp("B"), amount: card?.heal?.amount });
    const after = await activation(I.bearer);
    check("a counted grog spent one: the card says 3 before and 2 after, and the item holds 2", card?.left?.before === 3 && card.left.after === 2 && after.left === 2, { left: card?.left, item: after.left });
    const dom = await read(gmRun, r.messageId);
    const healedLine = await fmt("ACKS-LIB.itemRun.card.healedLine", { amount: card?.heal?.amount });
    check("the card shows Healed with the amount, and a tooltip carrying the dice, the rolled figure and the page", !!dom && dom.text.includes(healedLine) && dom.tips.some((t) => t.includes(HEAL) && t.includes(String(card.heal.rolled)) && t.includes(ITEM_CITE)), { text: dom?.text, tips: dom?.tips });
    const left = await fmt("ACKS-LIB.itemRun.card.swigsLeft", { after: 2 });
    const leftTip = await fmt("ACKS-LIB.itemRun.card.swigsLeftTip", { before: 3 });
    check("the card shows the swigs left, its tooltip naming the count before and the page", !!dom && dom.text.includes(left) && dom.tips.some((t) => t.includes(leftTip) && t.includes(ITEM_CITE)), { text: dom?.text, tips: dom?.tips });
    const pd = await read(plRun, r.messageId);
    check("the card draws no press on either seat", !!dom && !!pd && dom.buttons.length === 0 && pd.buttons.length === 0, { gm: dom?.buttons.map((b) => b.action), player: pd?.buttons.map((b) => b.action) });
  });

  /* ---------------------------------------------------------------- */
  await step("2", async () => {
    begin("2", "Spent, and uncounted");
    await reset({ left: { bearer: 0 } });
    const hp0 = await hp("B");
    const r = await gmRun(P.use, { itemUuid: I.bearer.uuid, die: DIE.top, ms: 1500 });
    check("a grog with none left is refused: no card, and the notice reads 'Nothing is left in it.'", r.messageId === null && r.said.some((s) => s.includes(W.refusedSpent)), r);
    check("nothing was written: hit points as they were, the count still 0", (await hp("B")) === hp0 && (await activation(I.bearer)).left === 0, { hp: await hp("B"), left: (await activation(I.bearer)).left });
    await reset({ left: {} });
    const a = await useItem(I.bearer, DIE.top);
    const b = await useItem(I.bearer, DIE.top);
    const ca = await cardWhen(a.messageId, (c) => c.kind === "consume");
    const cb = await cardWhen(b.messageId, (c) => c.kind === "consume");
    check("an uncounted grog is never spent: two swigs, each a heal, the count still blank on the item and on both cards", ca?.outcome === "heal" && cb?.outcome === "heal" && ca.left?.after === null && cb.left?.after === null && (await activation(I.bearer)).left === null, { a: ca?.left, b: cb?.left, item: (await activation(I.bearer)).left });
    const tail = (await fmt("ACKS-LIB.itemRun.card.swigsLeft", { after: "@@" })).split("@@")[1] ?? "";
    const da = await read(gmRun, a.messageId);
    const db = await read(gmRun, b.messageId);
    check("neither uncounted card draws a swigs-left row", tail.trim() !== "" && !!da && !!db && !da.text.includes(tail) && !db.text.includes(tail), { tail, a: da?.text, b: db?.text });
  });

  /* ---------------------------------------------------------------- */
  await step("3", async () => {
    begin("3", "A blank heal figure on the bearer's own swig");
    await reset({});
    const hp0 = await hp("B");
    const r = await useItem(I.blank, DIE.top);
    const card = await cardWhen(r.messageId, (c) => c.kind === "consume");
    check("nothing is rolled or written: the outcome is the Judge's with the blank figure as its reason, hit points unchanged", card?.outcome === "judge" && card.why === "figure" && card.heal === null && (await hp("B")) === hp0, { outcome: card?.outcome, why: card?.why, hp: await hp("B"), hp0 });
    const dom = await read(gmRun, r.messageId);
    check("the card reads the Judge's line, and its tooltip is the page reference alone", !!dom && dom.text.includes(W.whyFigure) && dom.tips.some((t) => t.includes(ITEM_CITE) && !/\d/.test(t.replace(ITEM_CITE, ""))), { text: dom?.text, tips: dom?.tips });
  });

  /* ---------------------------------------------------------------- */
  await step("4", async () => {
    begin("4", "A human drinker: the save card, pass, fail, Undo, and the condition's life");
    await reset({ left: { human: 5 } });
    const hp0 = await hp("H");
    const entryKey = keyOf(T.H.uuid);
    const r = await useItem(I.human, null);
    const card = await cardWhen(r.messageId, (c) => c.kind === "swig");
    check("the swig posted a save card for the drinker's token: the save, the success heal, the condition and the page on the card, no entry yet, one swig spent", card?.kind === "swig" && card.rowKey === "swig" && card.saveName === SAVE && card.successHealDice === SUCCESS && card.condition === COND && same(card.subjects.map((s) => s.uuid), [T.H.uuid]) && card.entries.length === 0 && (await activation(I.human)).left === 4, { card: card && { kind: card.kind, save: card.saveName, heal: card.successHealDice, cond: card.condition }, left: (await activation(I.human)).left });
    const pd = await read(plRun, r.messageId);
    const save = pd?.buttons.find((b) => b.action === "itemRun.roll");
    check("the Player's page draws Save on the drinker's row, the press carrying the entry key and the subject", !!save && save.data.entryKey === entryKey && save.data.subject === T.H.uuid, save?.data);
    const pass = await press(plRun, { id: r.messageId, action: "itemRun.roll", match: { entryKey } }, { plDie: "top", gmDie: "top", until: (c) => entryOf(c, "H")?.state === "applied" });
    const ep = entryOf(pass.card, "H");
    check("the Player's Save passed and healed: the entry holds saved, the amount healed, and the heal as a negative hit-point write", pass.found && ep?.saved === true && Number.isInteger(ep.amount) && ep.amount > 0 && ep.hp?.[0]?.amount === -ep.amount && ep.presser === S.playerId, ep);
    check("the hit points rose by exactly the entry's amount", (await hp("H")) - hp0 === ep?.amount, { before: hp0, now: await hp("H"), amount: ep?.amount });
    const afterDom = await read(plRun, r.messageId);
    check("the row reads Saved with the healed amount, and offers the Player Undo", !!afterDom && afterDom.text.includes(W.saved) && afterDom.text.includes(String(ep?.amount)) && hasBtn(afterDom.buttons, "itemRun.undo"), { text: afterDom?.text, actions: afterDom?.buttons.map((b) => b.action) });
    const undo = await press(plRun, { id: r.messageId, action: "itemRun.undo", match: { entryKey } }, { until: (c) => entryOf(c, "H")?.state === "undone" });
    check("the Player's Undo took the heal back: the entry reads undone and the hit points are as they were", undo.found && entryOf(undo.card, "H")?.state === "undone" && (await hp("H")) === hp0, { now: await hp("H"), hp0 });

    // A failed save outside a fight writes the mark.
    await reset({ left: { human: 5 } });
    const r2 = await useItem(I.human, null);
    const fail = await press(plRun, { id: r2.messageId, action: "itemRun.roll", match: { entryKey } }, { plDie: "one", until: (c) => entryOf(c, "H")?.state === "applied" });
    const ef = entryOf(fail.card, "H");
    const held = (await effectsOf("H")).filter((e) => e.statuses.includes(COND));
    check("a failed save wrote the condition, and outside a fight it carries the mark and no turn-life", fail.found && ef?.saved === false && ef.life === "mark" && held.length === 1 && held[0].mark === true && held[0].turnLife === null, { entry: ef, held });
    const failDom = await read(plRun, r2.messageId);
    check("the row reads Failed with the condition's name", !!failDom && failDom.text.includes(W.failed) && ef?.names?.length > 0 && failDom.text.includes(ef.names[0]), { text: failDom?.text, names: ef?.names });
    const undo2 = await press(plRun, { id: r2.messageId, action: "itemRun.undo", match: { entryKey } }, { until: (c) => entryOf(c, "H")?.state === "undone" });
    check("Undo removed the condition record", undo2.found && (await effectsOf("H")).filter((e) => e.statuses.includes(COND)).length === 0);

    // A failed save in a fight ends at the end of the drinker's next turn.
    await reset({ left: { human: 5 } });
    const sceneId = await gmRun((u) => fromUuidSync(u).id, S.scene);
    S.combat = await gm.create("Combat", { scene: sceneId, active: true });
    disposables.push(S.combat.uuid);
    const rows = {};
    for (const k of ["B", "H"]) rows[k] = (await gm.create("Combatant", { tokenId: T[k].id, sceneId, actorId: A[k].id }, { parent: S.combat.uuid })).id;
    try {
    const made = await gmRun(P.fight, { combatId: S.combat.id, rows, inits: { B: 25, H: 15 } });
    check("the walk's combat is the tracker's, its order set, no turn begun", made.active && made.order.length === 2, made);
    S.round = 0;
    await go("B", ++S.round);
    const r3 = await useItem(I.human, null);
    const f3 = await press(plRun, { id: r3.messageId, action: "itemRun.roll", match: { entryKey } }, { plDie: "one", until: (c) => entryOf(c, "H")?.state === "applied" });
    const e3 = entryOf(f3.card, "H");
    const life = (await effectsOf("H")).find((e) => e.statuses.includes(COND))?.turnLife;
    check("failed on another's turn, the condition carries a turn-life that ends at the end of the drinker's next turn (edge end, count 1, the drinker's combatant)", e3?.saved === false && e3.life === "turn" && life?.edge === "end" && life.count === 1 && life.combatantId === made.combatants[T.H.id] && life.combatId === S.combat.id, { life, entry: e3 });
    await go("H", S.round);
    check("the drinker's next turn began: the condition stands, counted as seen", (await effectsOf("H")).some((e) => e.statuses.includes(COND) && e.turnLife?.seen === 1), await effectsOf("H"));
    await go("B", ++S.round);
    const gone = await until(async () => (await effectsOf("H")).every((e) => !e.statuses.includes(COND)), 8000, 500);
    check("that turn ended: the condition is lifted", !!gone, await effectsOf("H"));
    } finally {
      await gmRun(P.deleteCombat, { combatId: S.combat.id });
    }
  });

  /* ---------------------------------------------------------------- */
  await step("5", async () => {
    begin("5", "A drinker the module cannot tell: Heal, Ask the save, a seat that does not own it, a blank figure");
    await reset({ left: { unknown: 5 } });
    const hp0 = await hp("U");
    const r = await useItem(I.unknown, null);
    const card = await cardWhen(r.messageId, (c) => c.kind === "swigUnknown");
    check("the card is the unknown drinker's: it names the drinker's actor and token, the heal, the save, and one swig was spent", card?.kind === "swigUnknown" && card.outcome === null && card.drinkerActorUuid === A.U.uuid && card.drinkerTokenUuid === T.U.uuid && card.healDice === HEAL && card.saveKind === SAVE && (await activation(I.unknown)).left === 4, { card: card && { kind: card.kind, actor: card.drinkerActorUuid, heal: card.healDice, save: card.saveKind }, left: (await activation(I.unknown)).left });
    const pd = await read(plRun, r.messageId);
    const gd = await read(gmRun, r.messageId);
    check("the Player that owns the drinker is drawn Heal and Ask the save, and so is the GM seat", hasBtn(pd?.buttons, "itemRun.swigHeal") && hasBtn(pd?.buttons, "itemRun.swigAskSave") && hasBtn(gd?.buttons, "itemRun.swigHeal") && hasBtn(gd?.buttons, "itemRun.swigAskSave"), { player: pd?.buttons.map((b) => b.action), gm: gd?.buttons.map((b) => b.action) });

    const heal = await press(plRun, { id: r.messageId, action: "itemRun.swigHeal" }, { gmDie: "top", until: (c) => !!c.resolved });
    const hc = heal.card;
    check("the Player's Heal healed the drinker: the card is resolved heal with the amount rolled on the dice, by the Player", heal.found && hc?.resolved === "heal" && Number.isInteger(hc.amount) && hc.amount > 0 && hc.resolvedBy === S.playerId && Number.isInteger(hc.rolled), { resolved: hc?.resolved, amount: hc?.amount, by: hc?.resolvedBy });
    check("the hit points rose by exactly that amount", (await hp("U")) - hp0 === hc?.amount, { before: hp0, now: await hp("U"), amount: hc?.amount });
    const healedLine = await fmt("ACKS-LIB.itemRun.card.healedLine", { amount: hc?.amount });
    const hd = await read(plRun, r.messageId);
    check("the card now reads Healed with its tooltip, and draws neither press", !!hd && hd.text.includes(healedLine) && hd.tips.some((t) => t.includes(HEAL)) && !hasBtn(hd.buttons, "itemRun.swigHeal") && !hasBtn(hd.buttons, "itemRun.swigAskSave"), { text: hd?.text, actions: hd?.buttons.map((b) => b.action) });
    const again = await plRun(P.api, { call: "swigHeal", args: { messageId: r.messageId } });
    const againAsk = await plRun(P.api, { call: "swigAskSave", args: { messageId: r.messageId } });
    check("a second press is refused as applied, Heal and Ask the save alike (the lib's call from the Player's page: the card draws no button), and nothing more was healed", again.ok === false && again.reason === "applied" && againAsk.ok === false && againAsk.reason === "applied" && (await hp("U")) - hp0 === hc?.amount, { again, againAsk });

    // Ask the save: the same card becomes the save card.
    await reset({ left: { unknown: 5 } });
    const hp1 = await hp("U");
    const r2 = await useItem(I.unknown, null);
    const ask = await press(plRun, { id: r2.messageId, action: "itemRun.swigAskSave" }, { until: (c) => c.asked });
    const ac = ask.card;
    check("the Player's Ask the save turned the card into the save card in place: the same message, kind swig, the saved save name, asked by the Player", ask.found && ac?.kind === "swig" && ac.rowKey === "swig" && ac.asked === true && ac.askedBy === S.playerId && ac.saveName === SAVE, { kind: ac?.kind, save: ac?.saveName, by: ac?.askedBy });
    const ad = await read(plRun, r2.messageId);
    const entryKey = keyOf(T.U.uuid);
    check("the Player's page now draws Save on the drinker's row, with the entry key, and neither Heal nor Ask the save", !!ad && ad.buttons.some((b) => b.action === "itemRun.roll" && b.data.entryKey === entryKey) && !hasBtn(ad.buttons, "itemRun.swigHeal") && !hasBtn(ad.buttons, "itemRun.swigAskSave"), ad?.buttons.map((b) => b.action));
    const late = await plRun(P.api, { call: "swigHeal", args: { messageId: r2.messageId } });
    check("a Heal on the turned card is refused as applied", late.ok === false && late.reason === "applied" && (await hp("U")) === hp1, late);
    const pass = await press(plRun, { id: r2.messageId, action: "itemRun.roll", match: { entryKey } }, { plDie: "top", gmDie: "top", until: (c) => entryOf(c, "U")?.state === "applied" });
    const eu = entryOf(pass.card, "U");
    check("the Save on the turned card works as on any swig card: passed, healed by the success dice, the hit points rose by the entry's amount", pass.found && eu?.saved === true && eu.amount > 0 && (await hp("U")) - hp1 === eu.amount, { entry: eu, now: await hp("U"), hp1 });

    // A seat that does not own the drinker.
    await reset({ own: { U: false }, left: { unknown: 5 } });
    const hp2 = await hp("U");
    const r3 = await useItem(I.unknown, null);
    const nd = await read(plRun, r3.messageId);
    const gd3 = await read(gmRun, r3.messageId);
    check("a Player that does not own the drinker reads the note alone and is drawn neither press, while the GM seat still is", !!nd && nd.text.includes(W.unknownNoteOther) && !hasBtn(nd.buttons, "itemRun.swigHeal") && !hasBtn(nd.buttons, "itemRun.swigAskSave") && hasBtn(gd3?.buttons, "itemRun.swigHeal"), { player: nd?.buttons.map((b) => b.action), gm: gd3?.buttons.map((b) => b.action), note: nd?.note });
    const refusedHeal = await plRun(P.api, { call: "swigHeal", args: { messageId: r3.messageId } });
    const refusedAsk = await plRun(P.api, { call: "swigAskSave", args: { messageId: r3.messageId } });
    const still = await gmRun(P.card, { id: r3.messageId });
    check("its Heal and Ask the save calls are refused notOwner (the lib's call from that page), the card stands unresolved and nothing was healed", refusedHeal.ok === false && refusedHeal.reason === "notOwner" && refusedAsk.ok === false && refusedAsk.reason === "notOwner" && !still.resolved && !still.asked && (await hp("U")) === hp2, { refusedHeal, refusedAsk });

    // A blank heal figure.
    await reset({ left: {} });
    const hp3 = await hp("U");
    const r4 = await useItem(I.unknownBlank, null);
    const bd = await read(plRun, r4.messageId);
    check("a card whose heal figure is blank shows the Heal row with no number and a tooltip that is the page reference alone", !!bd && bd.text.includes(W.unknownHealBlank) && bd.rows.some((row) => row.text.includes(W.unknownHealBlank) && row.tips.some((t) => t.includes(ITEM_CITE) && !/\d/.test(t.replace(ITEM_CITE, "")))), bd?.rows);
    const blank = await press(plRun, { id: r4.messageId, action: "itemRun.swigHeal" }, { gmDie: "top", until: (c) => !!c.resolved });
    const bdAfter = await read(plRun, r4.messageId);
    check("Heal on it leaves the Judge's line: resolved judge for the blank figure, nothing written, and the card reads that line and no Healed", blank.found && blank.card?.resolved === "judge" && blank.card.why === "figure" && (await hp("U")) === hp3 && !!bdAfter && bdAfter.text.includes(W.whyFigure), { resolved: blank.card?.resolved, why: blank.card?.why, text: bdAfter?.text });
  });

  /* ---------------------------------------------------------------- */
  await step("6", async () => {
    begin("6", "Hand on: the count is rolled once, kept when set, and never rolled for a first bearer");
    await reset({ left: {} });
    const first = await gm.create("Actor", { name: "Aura Swig First Bearer", type: "monster", prototypeToken: { actorLink: true }, items: [grogData("Aura Swig First Grog", "first", drinkOf(false), null)] });
    disposables.push(first.uuid);
    await sleep(2500);
    const firstItems = await gmRun(P.actorItems, { uuid: first.uuid });
    const fa = firstItems[0] ? await gmRun(P.activation, { uuid: firstItems[0].uuid }) : null;
    check("an actor created with the grog stamps it with its own uuid and rolls no count, so no provenance is stored either", firstItems.length === 1 && fa?.bearerUuid === first.uuid && fa.left === null && fa.leftFrom === null, { items: firstItems.length, activation: fa });

    const recipient = await gm.create("Actor", { name: "Aura Swig Recipient", type: "monster", prototypeToken: { actorLink: true } });
    disposables.push(recipient.uuid);
    const before = await activation(I.bearer);
    const dragged = await gmRun(P.handOn, { sourceUuid: I.bearer.uuid, actorUuid: recipient.uuid, die: DIE.top });
    disposables.push(gm.track(dragged.uuid, "Item"));
    note("6 the count rolled for the drag (a 1d3 swig count)", dragged.left);
    check("the grog copied from its bearer onto another actor, as a drop does, is stamped with the new actor and rolled its count once, within the swig dice's faces", dragged.bearerUuid === recipient.uuid && Number.isInteger(dragged.left) && dragged.left >= 1 && dragged.left <= 3, dragged);
    const from = dragged.leftFrom;
    check("the roll is recorded where the count is: leftFrom is a roll, its formula the swig dice and its total a whole number equal to the count", from?.by === "roll" && /^1d3$/i.test(String(from.formula ?? "").replace(/\s+/g, "")) && Number.isInteger(from.total) && from.total === dragged.left, { leftFrom: from, left: dragged.left });
    const opened = await gmRun(P.openSheet, { uuid: recipient.uuid, tab: "inventory" });
    const boxes = await gmRun(P.leftBoxes, { uuid: recipient.uuid });
    const box = boxes.boxes.find((b) => b.itemUuid === dragged.uuid);
    check("the recipient's sheet draws the Swigs left box with the rolled count, and its tooltip names the total, the formula and the page", opened.rendered === true && !!box && box.value === String(dragged.left) && box.tip.includes(String(from?.total)) && box.tip.includes(String(from?.formula)) && box.tip.includes(ITEM_CITE), { opened, box });
    await gmRun(P.closeSheet, { uuid: recipient.uuid });
    const afterSource = await activation(I.bearer);
    check("the copy leaves its source alone (a drop is driven as a copy; whether a real drop copies or moves is the walker's to see): still stamped with the bearer and its count as it was", afterSource.bearerUuid === before.bearerUuid && afterSource.left === before.left, { before, afterSource });

    await gmRun(async (a) => { await fromUuidSync(a.uuid).update({ "flags.acks-extras.itemRun.activation.left": 2 }); return true; }, { uuid: I.bearer.uuid });
    const kept = await gmRun(P.handOn, { sourceUuid: I.bearer.uuid, actorUuid: recipient.uuid, die: DIE.top });
    disposables.push(gm.track(kept.uuid, "Item"));
    check("a part-drunk grog copied on keeps its count (2) and takes the new bearer's stamp, and no roll is recorded for it", kept.bearerUuid === recipient.uuid && kept.left === 2 && kept.leftFrom === null, kept);
  });

  /* ---------------------------------------------------------------- */
  await step("7", async () => {
    begin("7", "Breakage: a beastman's grog on its defeated status, never on its hit points");
    await reset({});
    const sceneId = S.scene;
    const make = async (name, types) => {
      const data = { name, type: "monster", prototypeToken: { actorLink: true }, items: [grogData(`${name} Grog`, "breakage", drinkOf(false), null)] };
      if (types.length) data.flags = { [MOD]: { extras: { types } } };
      const actor = await gm.create("Actor", data);
      const token = await gm.create("Token", { name, actorId: actor.id, actorLink: true, x: 300, y: 300 }, { parent: sceneId });
      disposables.push(actor.uuid, token.uuid);
      return { actor, token, grog: `${name} Grog` };
    };
    const one = await make("Aura Swig Breakage One", ["beastman"]);
    const two = await make("Aura Swig Breakage Two", []);
    await sleep(2000);
    const held = async (d) => (await gmRun(P.actorItems, { uuid: d.actor.uuid })).filter((i) => i.name === d.grog);
    const since = Date.now() - 2000;
    await gmRun(P.setHp, { uuid: one.actor.uuid, value: 0, max: 10 });
    await sleep(3000);
    check("at no hit points and no status the beastman keeps its grog and nothing was whispered", (await held(one)).length === 1 && (await gmRun(P.whispers, { since, a: one.grog, b: one.actor.name })).length === 0, { held: (await held(one)).length });
    const d = await gmRun(P.defeat, { tokenUuid: one.token.uuid });
    note("7 the defeated status, by the HUD's control or by the actor's toggle", d);
    await until(async () => (await held(one)).length === 0, 8000, 500);
    check("marked defeated, the beastman's grog is deleted", d.has && (await held(one)).length === 0, d);
    const told = await gmRun(P.whispers, { since, a: one.grog, b: one.actor.name });
    check("exactly one line is whispered to the Judges alone, naming the grog and the bearer", told.length === 1 && same(told[0]?.to, await gmRun(P.judges)), told);
    await gmRun(P.statusAgain, { uuid: one.actor.uuid });
    check("a second status event on the same body posts nothing more", (await gmRun(P.whispers, { since, a: one.grog, b: one.actor.name })).length === 1);
    const dTwo = await gmRun(P.defeat, { tokenUuid: two.token.uuid });
    await sleep(3000);
    check("a body that is not a beastman keeps a grog flagged for the beastman when it is defeated, and nothing is whispered", dTwo.has && (await held(two)).length === 1 && (await gmRun(P.whispers, { since, a: two.grog, b: two.actor.name })).length === 0, { defeated: dTwo.has, held: (await held(two)).length });
  });

  /* ---------------------------------------------------------------- */
  await step("8", async () => {
    begin("8", "On-hit ammunition: a hit asks the target's save; its failure sets delayed damage");
    await reset({});
    const throwValue = await gmRun(P.attackThrow, { uuid: A.A.uuid });
    if (!Number.isFinite(throwValue)) return skip("8", "the archer reads no numeric attack throw");
    const entryKey = keyOf(T.X.uuid);
    const attack = (target, die) => gmRun(P.attack, { actorUuid: A.A.uuid, itemUuid: I.launcher.uuid, targetTokenId: target, die: DIE[die] });

    const miss = await attack(T.X.id, "one");
    const missCards = await gmRun(P.newOnHit, { ms: 3000 });
    check("a miss posts no on-hit card", miss.rolled && missCards.length === 0, { miss, cards: missCards });
    await reset({});
    const noTarget = await attack(null, "top");
    const noCards = await gmRun(P.newOnHit, { ms: 3000 });
    check("a hit with no target posts no on-hit card", noTarget.rolled && noCards.length === 0, { noTarget, cards: noCards });

    await reset({});
    const hit = await attack(T.X.id, "top");
    const ids = await gmRun(P.newOnHit, { ms: 8000 });
    check("a hit on a target posts exactly one on-hit card", hit.rolled && hit.isHit !== false && ids.length === 1, { hit, ids });
    if (ids.length !== 1) return skip("8", "no on-hit card to press");
    const id = ids[0];
    const card = await gmRun(P.card, { id });
    check("the card speaks for the archer and holds the stack's figures: the target as its one subject, the save, the modifier, the formula, the count of turns and the source", card?.itemUuid === I.ammo.uuid && card.saveName === SAVE && card.saveMod === ONHIT.saveMod && card.formula === ONHIT.formula && card.delayTurns === ONHIT.delayTurns && card.source === ONHIT.source && card.subtitle === ROLES.A.name && same(card.subjects.map((s) => s.uuid), [T.X.uuid]), card);
    check("it stores the world time of the strike", Number.isFinite(card?.struckAt) && card.struckAt >= hit.worldTime - 1 && card.struckAt <= hit.worldTime + 1, { struckAt: card?.struckAt, hit: hit.worldTime });
    const pd = await read(plRun, id);
    const save = pd?.buttons.find((b) => b.action === "itemRun.roll");
    check("the Player that owns the target is drawn Save on its row, the press carrying the entry key, the row naming the save with the modifier", !!save && save.data.entryKey === entryKey && pd.text.includes(SAVE), { data: save?.data, text: pd?.text });

    // The clock moves between the strike and the press: the delay counts from the strike.
    await gmRun(P.advance, { seconds: 60 });
    const failed = await press(plRun, { id, action: "itemRun.roll", match: { entryKey } }, { plDie: "one", until: (c) => entryOf(c, "X")?.state === "applied" });
    const ef = entryOf(failed.card, "X");
    const turn = await gmRun(P.turnSeconds);
    const records = (await effectsOf("X")).filter((e) => e.delayed);
    const rec = records[0]?.delayed;
    check("the Player's failed Save wrote exactly one delayed-damage record on the target: the formula, the source and the page", failed.found && ef?.saved === false && records.length === 1 && rec?.formula === ONHIT.formula && rec.source === ONHIT.source && rec.cite === ONHIT.cite, { entry: ef, records });
    check("it falls due the card's count of turns after the STRIKE (the clock moved a minute before the press)", Number.isFinite(rec?.dueAt) && rec.dueAt === card.struckAt + ONHIT.delayTurns * turn, { dueAt: rec?.dueAt, struckAt: card.struckAt, turn });
    const c0 = await plRun(P.control, { actorUuid: A.X.uuid, save: SAVE, mod: 0, die: DIE.one });
    const c1 = await plRun(P.control, { actorUuid: A.X.uuid, save: SAVE, mod: ONHIT.saveMod, die: DIE.one });
    check("the card's imported modifier rode the throw: the press's margin equals a throw carrying the modifier and differs from one without", Number.isFinite(ef?.total) && ef.total - ef.target === c1.total - c1.target && c1.total - c1.target !== c0.total - c0.target, { entry: { total: ef?.total, target: ef?.target }, withMod: c1, without: c0 });
    const hpBefore = await gmRun(P.actorHp, { uuid: A.X.uuid });
    const dueAt = rec?.dueAt ?? 0;
    await gmRun(P.advance, { seconds: dueAt - 1 - (await gmRun(P.worldTime)) });
    check("one second short of its due time the record stands and nothing was taken", (await effectsOf("X")).filter((e) => e.delayed).length === 1 && (await gmRun(P.actorHp, { uuid: A.X.uuid })) === hpBefore);
    await gmRun(P.rig, { value: DIE.top });
    await gmRun(P.advance, { seconds: 1 });
    await gmRun(P.rig, { value: null });
    await until(async () => (await effectsOf("X")).filter((e) => e.delayed).length === 0, 8000, 500);
    const taken = hpBefore - (await gmRun(P.actorHp, { uuid: A.X.uuid }));
    check("at its due time the record is deleted and the formula took hit points within its faces", (await effectsOf("X")).filter((e) => e.delayed).length === 0 && taken >= 1 && taken <= 6, { hpBefore, taken });

    // A passed save writes nothing.
    await reset({});
    await attack(T.X.id, "top");
    const ids2 = await gmRun(P.newOnHit, { ms: 8000 });
    if (ids2.length !== 1) return skip("8 pass", "no second on-hit card to press");
    const passed = await press(plRun, { id: ids2[0], action: "itemRun.roll", match: { entryKey } }, { plDie: "top", until: (c) => entryOf(c, "X")?.state === "applied" });
    const ep = entryOf(passed.card, "X");
    check("a passed Save writes nothing: the entry reads saved with no record and the target holds no delayed damage", passed.found && ep?.saved === true && ep.recordIds.length === 0 && (await effectsOf("X")).filter((e) => e.delayed).length === 0, { entry: ep });
  });

  /* ---------------------------------------------------------------- */
  await step("9", async () => {
    begin("9", "Swigs left: the box on an owner's sheet, a hand's write, a blank, an invalid entry, and a seat that does not own the item");
    const uuid = A.U.uuid;
    const item = I.unknown.uuid;
    const rollTip = (total, formula) => fmt("ACKS-LIB.itemRun.row.leftTipRolled", { total, formula, cite: ITEM_CITE });
    const handTip = () => fmt("ACKS-LIB.itemRun.row.leftTipHand");
    const blankTip = () => fmt("ACKS-LIB.itemRun.row.leftTipBlank", { cite: ITEM_CITE });
    const boxOn = async (run, actorUuid) => (await run(P.leftBoxes, { uuid: actorUuid })).boxes.find((b) => b.itemUuid === item) ?? null;
    const stored = async (want, ms = 6000) => (await until(async () => { const a = await activation(I.unknown); return want(a) ? a : null; }, ms, 400)) ?? activation(I.unknown);
    /** Type into the box on the Player's seat, as a user does, and answer the item's stored count and provenance once `want` holds (or after the wait). */
    const typeAs = async (text, want, ms) => { const typed = await plRun(P.typeLeft, { uuid, itemUuid: item, text }); return { typed, a: await stored(want, ms) }; };

    // The start shape: a count that was rolled at hand-on, so a hand's write has a provenance to replace.
    await reset({ left: { unknown: 2 } });
    await gmRun(async (a) => { await fromUuidSync(a.uuid).update({ "flags.acks-extras.itemRun.activation.leftFrom": a.from }); return true; }, { uuid: item, from: { by: "roll", formula: FIGURES.swig.swigs, total: 2 } });
    const hpU0 = await hp("U");
    const own = await plRun(P.owns, { uuid: item });
    check("the Player seat owns the unknown drinker's grog by Foundry's own test", own.owner === true, own);
    const opened = await plRun(P.openSheet, { uuid, tab: "inventory" });
    const b0 = await boxOn(plRun, uuid);
    const label = await fmt("ACKS-LIB.itemRun.row.left");
    check("the Player's sheet of the drinker draws the Swigs left box for the grog: wired, labelled, holding the rolled count, its tooltip naming the roll and the page", opened.rendered === true && !!b0 && b0.wired === true && b0.label.includes(label) && b0.value === "2" && b0.tip === (await rollTip(2, FIGURES.swig.swigs)), { opened, box: b0 });

    const t3 = await typeAs("3", (a) => a.left === 3);
    check("typing 3 and a real change event wrote left 3, and leftFrom is exactly {by: hand} (the rolled provenance's formula and total did not linger)", t3.typed === true && t3.a.left === 3 && same(t3.a.leftFrom, { by: "hand" }), { typed: t3.typed, activation: t3.a });
    const b3 = await boxOn(plRun, uuid);
    check("the box reads 3 and its tooltip now says the count was typed", b3?.value === "3" && b3.tip === (await handTip()), b3);

    const neg = await typeAs("-2", (a) => a.left !== 3, 1500);
    const bNeg = await boxOn(plRun, uuid);
    check("-2 wrote nothing: the count is still 3, by hand, and the box is set back to 3", neg.typed === true && neg.a.left === 3 && same(neg.a.leftFrom, { by: "hand" }) && bNeg?.value === "3", { activation: neg.a, box: bNeg?.value });
    const frac = await typeAs("1.5", (a) => a.left !== 3, 1500);
    const bFrac = await boxOn(plRun, uuid);
    check("1.5 wrote nothing either: the count is still 3 and the box reads 3", frac.typed === true && frac.a.left === 3 && same(frac.a.leftFrom, { by: "hand" }) && bFrac?.value === "3", { activation: frac.a, box: bFrac?.value });

    const blank = await typeAs("", (a) => a.left === null);
    const bBlank = await boxOn(plRun, uuid);
    check("a blank box cleared both: left null and leftFrom null, the box empty and its tooltip the not-yet-rolled one with the page", blank.typed === true && blank.a.left === null && blank.a.leftFrom === null && bBlank?.value === "" && bBlank.tip === (await blankTip()), { activation: blank.a, box: bBlank });
    check("none of these writes touched the drinker's hit points", (await hp("U")) === hpU0);

    // Below owner: the box is not drawn, and the sheet's own write refuses.
    await gmRun(P.own, { uuid, playerId: S.playerId, level: 2 });
    const seen = await until(async () => (await plRun(P.owns, { uuid: item })).owner === false, 6000, 400);
    const lowered = await plRun(P.owns, { uuid: item });
    await plRun(P.openSheet, { uuid, tab: "inventory" });
    const gone = await boxOn(plRun, uuid);
    check("with the Player's ownership lowered to Observer the grog is no longer the Player's (isOwner false) and the Player's sheet draws no Swigs left box for it", !!seen && lowered.owner === false && gone === null, { lowered, box: gone });
    await gmRun(P.openSheet, { uuid, tab: "inventory" });
    const gmBox = await boxOn(gmRun, uuid);
    check("the GM seat's sheet of the same drinker still draws the box", !!gmBox && gmBox.wired === true, gmBox);
    const refused = await plRun(P.writeLeft, { itemUuid: item, text: "7" });
    check("the sheet's own write called from the Player's page is refused and nothing is written", refused.written === false && (await activation(I.unknown)).left === null, { refused, activation: await activation(I.unknown) });
    await plRun(P.closeSheet, { uuid });
    await gmRun(P.closeSheet, { uuid });

    // The character sheet's gear row hides its presses and keeps the box.
    await reset({ left: { human: null } });
    const hItem = I.human.uuid;
    const openedH = await plRun(P.openSheet, { uuid: A.H.uuid, tab: "equipment" });
    const hb = await plRun(P.leftBoxes, { uuid: A.H.uuid });
    const hBox = hb.boxes.find((b) => b.itemUuid === hItem) ?? null;
    check("the Player's character sheet (Equipment tab) draws the box on the grog's gear row, wired, and no press for it", openedH.rendered === true && !!hBox && hBox.wired === true && !hb.presses.includes(hItem), { opened: openedH, box: hBox, presses: hb.presses.length });
    if (hBox) {
      await plRun(P.typeLeft, { uuid: A.H.uuid, itemUuid: hItem, text: "2" });
      const a = (await until(async () => { const x = await activation(I.human); return x.left === 2 ? x : null; }, 6000, 400)) ?? (await activation(I.human));
      check("a typed 2 on the character sheet's row wrote left 2, by hand", a.left === 2 && same(a.leftFrom, { by: "hand" }), a);
    }
    await plRun(P.closeSheet, { uuid: A.H.uuid });
    await reset({ left: {} });
  });

  /* ---------------------------------------------------------------- */
  await step("10", async () => {
    begin("10", "The Judge's call: a swig card that names no save");
    const entryKey = keyOf(T.H.uuid);
    const noSave = () => gmRun(P.setDrink, { uuid: I.human.uuid, drink: { ...drinkOf(false), saveKind: null } });
    const idsOf = (d) => ({ itemUuid: d.itemUuid, rowKey: d.rowKey, activationId: d.activationId, subject: d.subject, messageId: d.messageId, entryKey: d.entryKey });
    const gmId = await gmRun(P.userId, MACHINE.gm);

    await reset({ left: { human: 5 } });
    await noSave();
    const hp0 = await hp("H");
    const r = await useItem(I.human, null);
    const id = r.messageId;
    const card = await cardWhen(id, (c) => c.kind === "swig");
    check("the swig posted a card whose save name is blank, for the drinker's token, with no entry yet", card?.kind === "swig" && card.saveName === "" && same(card.subjects.map((s) => s.uuid), [T.H.uuid]) && card.entries.length === 0, { kind: card?.kind, save: card?.saveName, entries: card?.entries.length });
    const gd = await read(gmRun, id);
    const pd = await read(plRun, id);
    const declares = (gd?.buttons ?? []).filter((b) => b.action === "itemRun.declare");
    check("the GM seat is drawn two declare buttons on the drinker's row, Passed (data-declared true) and Failed (false), each carrying the subject and the entry key, and no Save", declares.length === 2 && declares.some((b) => b.data.declared === "true" && b.label.includes(W.declarePass)) && declares.some((b) => b.data.declared === "false" && b.label.includes(W.declareFail)) && declares.every((b) => b.data.subject === T.H.uuid && b.data.entryKey === entryKey) && !hasBtn(gd.buttons, "itemRun.roll"), { buttons: gd?.buttons.map((b) => [b.action, b.data.declared, b.label]) });
    check("the Player seat that owns the drinker is drawn no declare button and no Save, and both seats read the Judge's line", !!pd && !hasBtn(pd.buttons, "itemRun.declare") && !hasBtn(pd.buttons, "itemRun.roll") && gd.text.includes(W.noSaveLine) && pd.text.includes(W.noSaveLine), { player: pd?.buttons.map((b) => b.action), line: W.noSaveLine });
    const ids = declares[0] ? idsOf(declares[0].data) : null;
    const judgeOnly = ids ? await plRun(P.api, { call: "pressRoll", args: { ...ids, declared: true } }) : null;
    const still = await gmRun(P.card, { id });
    check("the Player's call to the lib with declared true answers judgeOnly (the lib's call from that page: the card draws it no button), and nothing was written", judgeOnly?.ok === false && judgeOnly.reason === "judgeOnly" && still.entries.length === 0 && (await hp("H")) === hp0, { judgeOnly, entries: still.entries.length });

    // Failed: the condition's write, the Judge's call as the verdict.
    const fail = await press(gmRun, { id, action: "itemRun.declare", match: { declared: "false" } }, { until: (c) => entryOf(c, "H")?.state === "applied" });
    const ef = entryOf(fail.card, "H");
    const held = (await effectsOf("H")).filter((e) => e.statuses.includes(COND));
    check("the GM's Failed wrote the entry as the Judge's call: state applied, saved false, declared true, no total and no target, pressed by the GM seat's user", fail.found && ef?.state === "applied" && ef.saved === false && ef.declared === true && ef.total === null && ef.target === null && ef.presser === gmId, ef);
    check("the failure wrote the condition, outside a fight as the mark, as a rolled failure does", ef?.life === "mark" && held.length === 1 && held[0].mark === true, { life: ef?.life, held });
    const gAfter = await read(gmRun, id);
    const pAfter = await read(plRun, id);
    check("the row reads Failed with the condition's name and the Judge's call after it, on both seats; the GM seat is offered Undo", !!gAfter && !!pAfter && [gAfter, pAfter].every((d) => d.text.includes(W.failed) && d.text.includes(`(${W.declared})`) && ef?.names?.length > 0 && d.text.includes(ef.names[0])) && hasBtn(gAfter.buttons, "itemRun.undo") && !hasBtn(gAfter.buttons, "itemRun.declare"), { gm: gAfter?.text, actions: gAfter?.buttons.map((b) => b.action) });
    const again = await gmRun(P.api, { call: "pressRoll", args: { ...ids, declared: true } });
    check("a second declared press on the settled row is refused as applied and nothing more is written", again.ok === false && again.reason === "applied" && (await effectsOf("H")).filter((e) => e.statuses.includes(COND)).length === 1, again);
    const undo = await press(gmRun, { id, action: "itemRun.undo", match: { entryKey } }, { until: (c) => entryOf(c, "H")?.state === "undone" });
    check("Undo took the Judge's call back: the entry reads undone and the condition record is gone", undo.found && entryOf(undo.card, "H")?.state === "undone" && (await effectsOf("H")).filter((e) => e.statuses.includes(COND)).length === 0, entryOf(undo.card, "H"));

    // Passed: the success heal, rolled on the GM's page.
    await reset({ left: { human: 5 } });
    await noSave();
    const hp1 = await hp("H");
    const r2 = await useItem(I.human, null);
    const pass = await press(gmRun, { id: r2.messageId, action: "itemRun.declare", match: { declared: "true" } }, { gmDie: "top", until: (c) => entryOf(c, "H")?.state === "applied" });
    const ep = entryOf(pass.card, "H");
    check("the GM's Passed wrote saved true as the Judge's call with the success heal: declared true, no total or target, an amount within the success dice's faces, the hit points risen by exactly it", pass.found && ep?.saved === true && ep.declared === true && ep.total === null && ep.target === null && Number.isInteger(ep.amount) && ep.amount >= 1 && ep.amount <= 6 && (await hp("H")) - hp1 === ep.amount, { entry: ep, hp1, now: await hp("H") });
    const passDom = await read(gmRun, r2.messageId);
    check("the row reads Saved with the healed amount and the Judge's call after it", !!passDom && passDom.text.includes(W.saved) && passDom.text.includes(String(ep?.amount)) && passDom.text.includes(`(${W.declared})`), passDom?.text);
    const undo2 = await press(gmRun, { id: r2.messageId, action: "itemRun.undo", match: { entryKey } }, { until: (c) => entryOf(c, "H")?.state === "undone" });
    check("Undo gave the healed hit points back", undo2.found && (await hp("H")) === hp1, { now: await hp("H"), hp1 });

    // A card that names a save refuses a declared press, even from the Judge's seat.
    await reset({ left: { human: 5 } });
    const r3 = await useItem(I.human, null);
    const named = await read(gmRun, r3.messageId);
    const save = named?.buttons.find((b) => b.action === "itemRun.roll");
    const refused = save ? await gmRun(P.api, { call: "pressRoll", args: { ...idsOf(save.data), declared: true } }) : null;
    check("a card that names a save draws no declare button, and a declared press on it from the GM seat is refused figure with nothing written", !!save && !hasBtn(named.buttons, "itemRun.declare") && refused?.ok === false && refused.reason === "figure" && (await gmRun(P.card, { id: r3.messageId })).entries.length === 0, { refused, actions: named?.buttons.map((b) => b.action) });
    await reset({ left: {} });
  });

  const late = await gmRun(P.caught);
  const lateP = await plRun(P.caught);
  note("errors this walk's seats recorded after ready", { gm: late.errors, player: lateP.errors });
  begin("11", "the walk's close");
  check("neither seat logged a console error during the walk", late.errors.length === 0 && lateP.errors.length === 0, { gm: late.errors.length, player: lateP.errors.length });
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      const claim = { itemUuids: [...Object.keys(GROGS).map((k) => I[k]?.uuid), I.launcher?.uuid, I.ammo?.uuid, ...disposables].filter(Boolean), names: [...Object.values(GROGS).map((g) => g.name), "Aura Swig First Grog", "Aura Swig Breakage One", "Aura Swig Breakage Two", "Aura Swig Recipient", ...Object.values(ROLES).map((r) => r.name)] };
      for (const u of await gmRun(P.claim, claim)) disposables.push(gm.track(u, "ChatMessage"));
      if (pl) for (const u of await plRun(P.claim, claim)) disposables.push(gm.track(u, "ChatMessage"));
      const tracked = new Set(gm.tracked().map((e) => e.uuid));
      const sw = await gm.sweepTracked({ only: [...new Set(disposables)].filter((u) => tracked.has(u)) });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm) await gmRun(() => globalThis.__las?.disarm?.()); } catch {}
  try { if (pl) await plRun(() => globalThis.__las?.disarm?.()); } catch {}
  try { if (pl) await pl.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const id of skipped) console.log(`SKIP  ${id}`);
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  console.log(`SKIPPED ${skipped.length} step(s) not reached`);
  console.log(`SUMMARY lib/aura-swig: ${passed}/${checks.length} checks passed${failed.length ? `; failed: ${failed.join(" | ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}
