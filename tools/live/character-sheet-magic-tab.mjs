/**
 * Live walk, character-sheet-magic-tab: the Magic tab by list and the cast gate
 * behind its Cast button. Walks docs/character-sheet/TESTING.md "The Magic tab by
 * list, and its cast gates" on the GM and Player seats, and its section numbers
 * are the recipe's step numbers: the tab grouped by list (a group per list the
 * class casts from, a slot figure and hand pips per level, a spell on two lists
 * as two rows of one item, "Other spells" for what stands on none, the casting
 * strip drawing no per-list pips); every figure carrying a tooltip and nothing
 * carrying a `title`; a hand pip spending and giving back one write; the owning
 * Player's seat pressing a pip, written from that seat, and the rows blocked when
 * a list's level has no slot left or the spell is on none of the class's lists;
 * the same casts refused at `item.use()` with the tab out of it, and a Cast
 * pressed under a list's heading spending that list's slot; the Judge warned and
 * not stopped; Rest and Reset slots; a seat that only observes; a character with
 * no class bound reading by level; and the tab at the sheet's smallest width.
 * Prints counts, booleans and the fixtures' invented labels, never a user name or
 * an id. The seats' user ids are read in page context at run time and compared
 * there or here. Machine values arrive
 * through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them; every figure and
 * name is invented): `character-sheet/tab-class` (a class casting from two lists),
 * `character-sheet/tab-hero` (a linked character the Player owns, bound to it) with
 * its spells `tab-spell-one` (list one), `tab-spell-both` (list one at level 1,
 * list two at level 2), `tab-spell-off` (a list the class does not cast from) and
 * `tab-spell-bare` (no list, no class string); `character-sheet/tab-stranger` (bound
 * to the class, the Player only observes) with `tab-stranger-spell`; and
 * `character-sheet/tab-plain` (no class) with `tab-plain-spell`. Every step that
 * needs a known shape writes it at its start: the class's casting rows, the
 * binding, the ownership, the spells' flags, level and count, and the pools.
 * The run's own documents (the cards its casts post) are tracked by uuid and
 * swept alone; the fixtures stay.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const M = machineSeats();

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  The invented class and spells                                      */
/* ------------------------------------------------------------------ */
// A list's key and label fold to the same string, so a spell naming either matches it.
const ONE = { key: "qatabone", label: "QA Tab One" };
const TWO = { key: "qatabtwo", label: "QA Tab Two" };
const AWAY = "QA Tab Away";
const CLASS_NAME = "QA Tab Class";
const CASTING = [
  { key: ONE.key, label: ONE.label, kind: "vancian", slots: [{ atLevel: 1, s1: 2 }] },
  { key: TWO.key, label: TWO.label, kind: "vancian", slots: [{ atLevel: 1, s1: 1, s2: 1 }] },
];
const list = (source, level) => ({ source, level, classes: [], note: "" });
/** The hero's spells: a spell's own lists and core level; `lists: null` writes no spell flag at all. */
const SPELLS = {
  one: { marker: "character-sheet/tab-spell-one", name: "QA Tab Spell One", lvl: 1, lists: [list(ONE.label, 1)] },
  both: { marker: "character-sheet/tab-spell-both", name: "QA Tab Spell Both", lvl: 1, lists: [list(ONE.label, 1), list(TWO.label, 2)] },
  off: { marker: "character-sheet/tab-spell-off", name: "QA Tab Spell Off", lvl: 1, lists: [list(AWAY, 1)] },
  bare: { marker: "character-sheet/tab-spell-bare", name: "QA Tab Spell Bare", lvl: 1, lists: null },
};
const upper = (s) => { const x = String(s ?? "").trim(); return x ? x.charAt(0).toUpperCase() + x.slice(1) : ""; };
/** A lists line's entry for one list: the source as the spell writes it with its first letter raised (the module's `traditionLabel`), then the level. */
const shownOf = (source, level) => `${upper(source)} ${level}`;
const NOTICE = {
  blockedNoSlot: "ACKS-MAGIC.cast.notice.blocked.noSlot",
  blockedOffList: "ACKS-MAGIC.cast.notice.blocked.offList",
  verdictNoSlot: "ACKS-MAGIC.cast.notice.verdict.noSlot",
  verdictOffList: "ACKS-MAGIC.cast.notice.verdict.offList",
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__mt = globalThis.__mt ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.writes = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn;
      ui.notifications.warn = function (msg, ...rest) { H.warns.push(String(msg)); return H.warn.call(this, msg, ...rest); };
      // Every actor and item update this client is told of, with the user that wrote it: the hooks fire on each client for each write.
      const keysOf = (changes) => { try { return Object.keys(foundry.utils.flattenObject(changes)); } catch { return []; } };
      H.hooks = [
        ["updateActor", Hooks.on("updateActor", (doc, changes, _options, userId) => H.writes.push({ kind: "actor", actor: doc.id, by: userId, keys: keysOf(changes) }))],
        ["updateItem", Hooks.on("updateItem", (doc, changes, _options, userId) => H.writes.push({ kind: "item", actor: doc.parent?.id ?? null, by: userId, keys: keysOf(changes) }))],
      ];
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    const gate = await import("/modules/acks-extras/scripts/magic/cast-gate.mjs");
    return { isGM: game.user.isGM, role: game.user.role, self: game.user.id, activeGMIsSelf: !!game.users.activeGM?.isSelf, gate: typeof gate.castGateClaims === "function" };
  },
  restore: async () => {
    const H = globalThis.__mt;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
    for (const [name, id] of H.hooks) Hooks.off(name, id);
    H.patched = false;
    for (const actor of game.actors) if (actor.sheet?.rendered && /^QA Tab /.test(actor.name)) await actor.sheet.close({ animate: false });
    return "restored";
  },
  /** The id of the next write this seat is told of, and of the next warning it shows. */
  marks: async () => ({ writes: globalThis.__mt.writes.length, warns: globalThis.__mt.warns.length }),
  /** What this seat was told of since a mark, for one actor: the writes to it (the actor's and its items'), the ones to the pools flag, who wrote them, and the warnings shown. */
  since: async ({ from, actorId }) => {
    const H = globalThis.__mt;
    const mine = H.writes.slice(from.writes).filter((w) => w.actor === actorId);
    const pools = mine.filter((w) => w.kind === "actor" && w.keys.some((k) => k.includes("pools")));
    return {
      writes: mine.length,
      itemWrites: mine.filter((w) => w.kind === "item").length,
      poolWrites: pools.length,
      poolWritesByMe: pools.filter((w) => w.by === game.user.id).length,
      itemWritesByMe: mine.filter((w) => w.kind === "item" && w.by === game.user.id).length,
      warns: H.warns.slice(from.warns),
    };
  },
  locs: async ({ keys }) => Object.fromEntries(keys.map((k) => [k, game.i18n.localize(k)])),
  level: async ({ uuids }) => Object.fromEntries(uuids.map((u) => { const d = fromUuidSync(u); return [u, d ? { owner: d.isOwner, observer: !!d.testUserPermission(game.user, "OBSERVER"), items: d.items?.size ?? null } : null]; })),
  messageIds: async () => game.messages.map((m) => m.id),
  newMessages: async ({ since, actorIds }) => game.messages.filter((m) => !since.includes(m.id) && actorIds.includes(m.speaker?.actor)).map((m) => m.uuid),
  /** Seed state on the Judge's seat. */
  shapeOwnership: async ({ uuid, userId, level }) => {
    const doc = await fromUuid(uuid);
    await doc.update({ "ownership.default": 0, [`ownership.${userId}`]: level });
    const source = doc._source.ownership ?? {};
    return { stored: source[userId] ?? null, def: source.default ?? null };
  },
  shapeClass: async ({ classId, casting }) => {
    const item = game.items.get(classId);
    await item.update({ "system.casting": casting });
    return { rows: item.system.casting.length, keys: item.system.casting.map((t) => t.key) };
  },
  /** Level, spells enabled, core's two grids at 0, the class binding, and the pools: unset first, then the ones asked for. */
  shapeActor: async ({ actorId, classUuid, level, pools }) => {
    const actor = game.actors.get(actorId);
    const { unset } = await import("/modules/acks-extras/scripts/lib/util.mjs");
    const update = { "system.details.level": level, "system.details.class": "", "system.spells.enabled": true, "system.spells.1.max": 0, "system.spells.2.max": 0 };
    if (classUuid) update["flags.acks-extras.classes.uuid"] = classUuid;
    else if (actor.getFlag("acks-extras", "classes")?.uuid) update["flags.acks-extras.classes.uuid"] = unset();
    await actor.update(update);
    if (actor.getFlag("acks-extras", "classes")?.pools) await actor.update({ "flags.acks-extras.classes.pools": unset() });
    if (pools) await actor.update({ "flags.acks-extras.classes.pools": pools });
    return { level: actor.system.details.level, enabled: actor.system.spells.enabled, max1: actor.system.spells[1].max, max2: actor.system.spells[2].max };
  },
  /** A spell written whole: the old spell flag deleted first so no stale key stays, core's level, class string and counts set. */
  shapeSpell: async ({ actorId, itemId, flag, lvl, cast }) => {
    const item = game.actors.get(actorId).items.get(itemId);
    const { unset } = await import("/modules/acks-extras/scripts/lib/util.mjs");
    if (item.flags?.["acks-extras"]?.spell) await item.update({ "flags.acks-extras.spell": unset() });
    await item.update({ "system.lvl": lvl, "system.class": "", "system.cast": cast, "system.memorized": 0, ...(flag ? { "flags.acks-extras.spell": flag } : {}) });
    return { lvl: item.system.lvl, cls: item.system.class, cast: item.system.cast, lists: Array.from(item.flags?.["acks-extras"]?.spell?.lists ?? []).length };
  },
  /** What the world holds of an actor: the stored pools, the counts by name, the pools as the tab derives them, and the class it resolves. */
  state: async ({ actorId, itemIds }) => {
    const actor = game.actors.get(actorId);
    const { poolState } = await import("/modules/acks-extras/scripts/classes/casting.mjs");
    const { classForActor } = await import("/modules/acks-extras/scripts/classes/registry.mjs");
    const spent = actor.getFlag("acks-extras", "classes")?.pools ?? null;
    return {
      pools: spent ? JSON.parse(JSON.stringify(spent)) : null,
      counts: Object.fromEntries(Object.entries(itemIds).map(([name, id]) => [name, actor.items.get(id)?.system?.cast ?? null])),
      derived: poolState(actor).map((p) => ({ key: p.key, slots: (p.slots ?? []).map((s) => ({ n: s.n, max: s.max, used: s.used })) })),
      bound: classForActor(actor)?.name ?? null,
      owner: actor.isOwner,
      items: actor.items.size,
    };
  },
  /** Whether the cast window's claimant takes each spell and whether the cast gate does (it takes the ones the window declines). */
  claims: async ({ actorId, itemIds }) => {
    const { castSpellClaims } = await import("/modules/acks-extras/scripts/magic/cast-spell.mjs");
    const { castGateClaims } = await import("/modules/acks-extras/scripts/magic/cast-gate.mjs");
    const { classForActor } = await import("/modules/acks-extras/scripts/classes/registry.mjs");
    const actor = game.actors.get(actorId);
    return Object.fromEntries(Object.entries(itemIds).map(([name, id]) => [name, { window: castSpellClaims(actor.items.get(id), undefined, classForActor), gate: castGateClaims(actor.items.get(id), classForActor) }]));
  },
  /** Open the sheet on the Magic tab (unfolded: a folded card has no tabs), once the tab is the active panel. */
  open: async ({ actorId }) => {
    const H = globalThis.__mt;
    const actor = game.actors.get(actorId);
    const { unset } = await import("/modules/acks-extras/scripts/lib/util.mjs");
    if (game.user.getFlag("acks-extras", "sheetFold")?.[actorId]) await game.user.update({ "flags.acks-extras.sheetFold": { [actorId]: unset() } });
    await actor.sheet.render({ force: true });
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("magic", "primary");
    const tab = await H.poll(() => H.root(actor.sheet)?.querySelector('section[data-tab="magic"].active'));
    await H.sleep(500);
    return { rendered: !!tab };
  },
  close: async ({ actorId }) => { await game.actors.get(actorId)?.sheet?.close({ animate: false }); return true; },
  /** The tab as it stands: every group, level, figure, pip and row, read from the DOM. A write redraws the tab, so a step reads it again each time. */
  read: async ({ actorId }) => {
    const H = globalThis.__mt;
    const actor = game.actors.get(actorId);
    const root = H.root(actor?.sheet);
    const tab = root?.querySelector('section[data-tab="magic"]');
    if (!tab) return { tab: false };
    const norm = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const ownText = (el) => [...(el?.childNodes ?? [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
    const figure = (el) => { const m = /(\d+)\s*\/\s*(\d+)/.exec(norm(el)); return m ? { used: Number(m[1]), max: Number(m[2]) } : null; };
    const rowOf = (row) => {
      const lists = row.querySelector("[data-spell-lists]");
      const count = row.querySelector('input[data-item-field="system.cast"]');
      const cast = row.querySelector('button[data-action="spellCast"]');
      const gate = row.querySelector("[data-gate]");
      return {
        id: row.dataset.itemId,
        tradition: row.dataset.tradition ?? null,
        lists: lists ? { text: norm(lists), tip: lists.getAttribute("data-tooltip-text") ?? "" } : null,
        count: count ? { value: count.value, tip: count.getAttribute("data-tooltip-text") ?? "", aria: count.getAttribute("aria-label") ?? "", disabled: count.disabled } : null,
        cast: cast ? { disabled: cast.disabled, named: (cast.getAttribute("aria-label") ?? "").length > 0 } : null,
        gate: gate ? { key: gate.dataset.gate, text: ownText(gate), role: gate.getAttribute("role") } : null,
      };
    };
    // The rows of a level are the siblings after its subhead, up to the next subhead.
    const rowsAfter = (sub) => {
      const out = [];
      for (let n = sub.nextElementSibling; n && !n.matches("[data-list-level]"); n = n.nextElementSibling) if (n.matches("[data-item-id]")) out.push(rowOf(n));
      return out;
    };
    const levelsOf = (group) => [...group.querySelectorAll(":scope > [data-list-level]")].map((sub) => {
      const slots = sub.querySelector("[data-list-slots]");
      return {
        n: sub.dataset.listLevel,
        figure: slots ? figure(slots) : null,
        tip: slots?.getAttribute("data-tooltip-text") ?? "",
        pips: [...sub.querySelectorAll(".acks-extras-classes-handpip")].map((p) => ({ tag: p.tagName.toLowerCase(), spent: p.classList.contains("is-spent"), label: p.getAttribute("aria-label") ?? "", spentAttr: p.dataset.spent ?? null })),
        rows: rowsAfter(sub),
      };
    });
    const other = tab.querySelector("[data-list-other]");
    const strip = tab.querySelector(".acks-extras-classes-strip");
    return {
      tab: true,
      moduleSheet: !!tab.querySelector('[data-mount="casting"]'),
      owner: actor.isOwner,
      groups: [...tab.querySelectorAll("[data-list]")].map((g) => ({ key: g.dataset.list, title: norm(g.querySelector(".acks-extras-frame__rule-title")), levels: levelsOf(g) })),
      other: other ? { levels: levelsOf(other) } : null,
      allRows: [...tab.querySelectorAll(".acks-extras-frame__row.is-spell")].map(rowOf),
      poolButtons: tab.querySelectorAll('button[data-action="poolSlot"]').length,
      pointsButtons: tab.querySelectorAll('button[data-action="poolPoints"]').length,
      controls: { rest: !!tab.querySelector('button[data-action="rest"]'), reset: !!tab.querySelector('button[data-action="spellReset"]') },
      levelsInputs: [...tab.querySelectorAll('input[name^="system.spells."][name$=".max"]')].map((i) => ({ name: i.name, disabled: i.disabled })),
      titles: tab.querySelectorAll("[title]").length,
      strip: strip ? {
        rest: strip.querySelectorAll(".acks-extras-classes-rest").length,
        pips: strip.querySelectorAll(".acks-extras-classes-pip").length,
        pointsPairs: strip.querySelectorAll(".acks-extras-classes-ptbtn").length,
        traditions: strip.querySelectorAll(".acks-extras-classes-tradition").length,
        power: strip.querySelectorAll(".acks-extras-classes-power").length,
      } : null,
    };
  },
  /** Press a hand pip under a list's level: the first one reading spent or not as asked. */
  pressPip: async ({ actorId, tradition, level, spent }) => {
    const H = globalThis.__mt;
    const sub = H.root(game.actors.get(actorId).sheet)?.querySelector(`section[data-tab="magic"] [data-list="${tradition}"] > [data-list-level="${level}"]`);
    const pip = sub?.querySelector(`button[data-action="poolSlot"][data-spent="${spent}"]`);
    if (!pip) return { found: false };
    pip.click();
    await H.sleep(300);
    return { found: true };
  },
  /** Press Cast on a spell's row: under a list's heading by that list's key, under a level or Other spells by `tradition: null`. */
  press: async ({ actorId, itemId, tradition }) => {
    const H = globalThis.__mt;
    const tab = H.root(game.actors.get(actorId).sheet)?.querySelector('section[data-tab="magic"]');
    const row = tab?.querySelector(`[data-item-id="${itemId}"]${tradition ? `[data-tradition="${tradition}"]` : ":not([data-tradition])"}`);
    const button = row?.querySelector('button[data-action="spellCast"]');
    if (!button) return { found: false };
    if (button.disabled) return { found: true, disabled: true };
    button.click();
    await H.sleep(300);
    return { found: true, disabled: false };
  },
  /** Press a control of the tab by selector (Rest, Reset slots, the strip's rest). */
  pressControl: async ({ actorId, selector }) => {
    const H = globalThis.__mt;
    const button = H.root(game.actors.get(actorId).sheet)?.querySelector(`section[data-tab="magic"] ${selector}`);
    if (!button) return { found: false };
    button.click();
    await H.sleep(300);
    return { found: true };
  },
  /** The door every cast ends in; the system does not await what it starts, so a step polls for its outcome. */
  use: async ({ actorId, itemId }) => { game.actors.get(actorId).items.get(itemId).use(); return true; },
  /** The sheet at the window's floor width: the scroller's and the tab's overflow, and where each gate line sits against its row. */
  layout: async ({ actorId }) => {
    const H = globalThis.__mt;
    const sheet = game.actors.get(actorId).sheet;
    const root = H.root(sheet);
    const floor = parseFloat(getComputedStyle(root).minWidth) || 0;
    const before = Math.round(root.getBoundingClientRect().width);
    await sheet.setPosition({ width: floor });
    await H.sleep(900);
    const tab = root.querySelector('section[data-tab="magic"]');
    const scroller = root.querySelector(".acks-extras-frame__scroll");
    const gates = [...tab.querySelectorAll(".acks-extras-frame__gate")].map((g) => {
      const row = g.parentElement;
      const rest = [...row.children].filter((c) => c !== g);
      const bottom = Math.max(...rest.map((c) => c.getBoundingClientRect().bottom));
      const gr = g.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      return { key: g.dataset.gate, below: gr.top >= bottom - 1, wide: gr.width >= rr.width * 0.9, within: gr.right <= rr.right + 1 };
    });
    const out = {
      floor,
      before,
      width: Math.round(root.getBoundingClientRect().width),
      scroller: { sw: scroller.scrollWidth, cw: scroller.clientWidth },
      tab: { sw: tab.scrollWidth, cw: tab.clientWidth },
      overflowingRows: [...tab.querySelectorAll(".acks-extras-frame__row.is-spell")].filter((r) => r.scrollWidth > r.clientWidth + 1).length,
      gates,
    };
    await sheet.setPosition({ width: before });
    return out;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Poll a page read until `test(result)` holds or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 60, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}

/** Key order and `null` vs absent do not matter to a comparison of pools. */
const canon = (v) => (v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

const groupOf = (t, key) => t.groups?.find((g) => g.key === key) ?? null;
const levelOf = (group, n) => group?.levels.find((l) => l.n === String(n)) ?? null;
const rowAt = (t, key, n, id) => levelOf(groupOf(t, key), n)?.rows.find((r) => r.id === id) ?? null;
const otherRow = (t, id) => t.other?.levels.flatMap((l) => l.rows).find((r) => r.id === id) ?? null;
const figure = (t, key, n) => levelOf(groupOf(t, key), n)?.figure ?? null;
const usedOf = (st, key, n) => st.derived.find((p) => p.key === key)?.slots.find((s) => s.n === n)?.used ?? null;

let gm = null;
let player = null;
/** The uuids of what this run made: the only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 900_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  gm = await connect({ browser: M.browser, origin: M.origin, user: M.gm, port: PORTS.gm, own: M.own });
  player = await connect({ browser: M.browser, origin: M.origin, user: M.player, port: PORTS.player, own: M.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const seatG = await run(gm, P.install);
  const seatP = await run(player, P.install);
  if (!seatG.isGM || !seatG.activeGMIsSelf) blocked("the first seat is not the active GM");
  if (seatP.isGM) blocked("the second seat is a GM, so a Player's owner seat cannot be walked");
  if (seatG.self === seatP.self) blocked("both seats are the same user, so a write by one cannot be told from the other");
  check("the GM seat is the active GM, the other seat a Player, and both carry the cast gate", seatG.isGM && seatG.activeGMIsSelf && !seatP.isGM && seatP.role <= 2 && seatG.gate && seatP.gate, { gm: seatG.role, player: seatP.role });
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const marksG = async () => run(gm, P.marks);
  const marksP = async () => run(player, P.marks);

  section("fixtures");
  const playerId = seatP.self;
  const cls = await gm.fixture("character-sheet/tab-class", "Item", { name: CLASS_NAME, type: "acks-extras.class", system: { key: "qatabclass", casting: CASTING } });
  const hero = await gm.fixture("character-sheet/tab-hero", "Actor", { name: "QA Tab Hero", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0, [playerId]: 3 } });
  const stranger = await gm.fixture("character-sheet/tab-stranger", "Actor", { name: "QA Tab Stranger", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0, [playerId]: 2 } });
  const plain = await gm.fixture("character-sheet/tab-plain", "Actor", { name: "QA Tab Plain", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0 } });
  const clsId = idOf(cls);
  const heroId = idOf(hero);
  const strangerId = idOf(stranger);
  const plainId = idOf(plain);
  const spellIds = {};
  for (const [name, def] of Object.entries(SPELLS)) {
    spellIds[name] = idOf(await gm.fixture(def.marker, "Item", { name: def.name, type: "spell", system: { lvl: def.lvl, cast: 0, memorized: 0, class: "" } }, { parent: hero.uuid }));
  }
  const strangerSpell = idOf(await gm.fixture("character-sheet/tab-stranger-spell", "Item", { name: "QA Tab Stranger Spell", type: "spell", system: { lvl: 1, cast: 0, memorized: 0, class: "" } }, { parent: stranger.uuid }));
  const plainSpell = idOf(await gm.fixture("character-sheet/tab-plain-spell", "Item", { name: "QA Tab Plain Spell", type: "spell", system: { lvl: 1, cast: 0, memorized: 0, class: "" } }, { parent: plain.uuid }));

  // Ownership is rewritten every run: a kept fixture is returned as it stands, and the Player's id is read from the Player seat just now.
  const ownedHero = await run(gm, P.shapeOwnership, { uuid: hero.uuid, userId: playerId, level: 3 });
  const ownedStranger = await run(gm, P.shapeOwnership, { uuid: stranger.uuid, userId: playerId, level: 2 });
  const ownedPlain = await run(gm, P.shapeOwnership, { uuid: plain.uuid, userId: playerId, level: 0 });
  const seen = await until(player, P.level, { uuids: [hero.uuid, stranger.uuid] }, (v) => v[hero.uuid]?.owner === true && v[hero.uuid]?.items === 4 && v[stranger.uuid]?.owner === false && v[stranger.uuid]?.observer === true && v[stranger.uuid]?.items === 1);
  check("the Player seat owns the hero (four spells) and only observes the stranger (one spell), as the GM seat wrote it and the Player seat reads it", ownedHero.stored === 3 && ownedHero.def === 0 && ownedStranger.stored === 2 && ownedPlain.stored === 0 && seen[hero.uuid]?.owner === true && seen[hero.uuid]?.items === 4 && seen[stranger.uuid]?.owner === false && seen[stranger.uuid]?.observer === true && seen[stranger.uuid]?.items === 1, { hero: seen[hero.uuid], stranger: seen[stranger.uuid] });

  const flagOf = (lists) => ({ lists });
  /** The hero in a known shape: the class's rows, the binding, level 1, core's grids at 0, every spell written whole with its count, and the pools as given (none by default). */
  async function shapeHero({ pools = null, counts = {} } = {}) {
    await run(gm, P.shapeClass, { classId: clsId, casting: CASTING });
    await run(gm, P.shapeActor, { actorId: heroId, classUuid: cls.uuid, level: 1, pools });
    for (const [name, def] of Object.entries(SPELLS)) await run(gm, P.shapeSpell, { actorId: heroId, itemId: spellIds[name], flag: def.lists ? flagOf(def.lists) : null, lvl: def.lvl, cast: counts[name] ?? 0 });
    return run(gm, P.state, { actorId: heroId, itemIds: spellIds });
  }
  async function shapeStranger({ pools = null } = {}) {
    await run(gm, P.shapeClass, { classId: clsId, casting: CASTING });
    await run(gm, P.shapeActor, { actorId: strangerId, classUuid: cls.uuid, level: 1, pools });
    await run(gm, P.shapeSpell, { actorId: strangerId, itemId: strangerSpell, flag: flagOf([list(ONE.label, 1)]), lvl: 1, cast: 0 });
    return run(gm, P.state, { actorId: strangerId, itemIds: { spell: strangerSpell } });
  }
  const zeros = { one: 0, both: 0, off: 0, bare: 0 };
  /** A seat reads the hero as the Judge shaped it. */
  const seatSees = (seat, pools, counts = zeros) => until(seat, P.state, { actorId: heroId, itemIds: spellIds }, (st) => same(st.pools, pools) && same(st.counts, { ...zeros, ...counts }) && st.items === 4);
  const msgSince = await run(gm, P.messageIds);

  const locs = await run(gm, P.locs, { keys: Object.values(NOTICE) });
  check("the four cast notices the walk compares against are lang keys the world knows (each localizes to text, not to itself)", Object.entries(locs).every(([k, v]) => v && v !== k), Object.fromEntries(Object.entries(locs).map(([k, v]) => [k, v.length])));

  const st0 = await shapeHero();
  const claims = await run(gm, P.claims, { actorId: heroId, itemIds: spellIds });
  check("shape: the hero is bound to the class, level 1, no pool spent, every count 0; core's slot grid and each spell's class string are blank", st0.bound === CLASS_NAME && st0.pools === null && Object.values(st0.counts).every((n) => n === 0) && st0.derived.length === 2, { bound: st0.bound, derived: st0.derived });
  check("shape: the cast window takes none of the four spells and the cast gate takes all four", Object.values(claims).every((c) => c.window === false && c.gate === true), claims);

  // ---------------------------------------------------------------- 1
  section("1. the tab by list, on the Judge's seat");
  const open1 = await run(gm, P.open, { actorId: heroId });
  const t1 = await run(gm, P.read, { actorId: heroId });
  check("the Magic tab is open on the module's own sheet", open1.rendered && t1.tab && t1.moduleSheet, { rendered: open1.rendered, moduleSheet: t1.moduleSheet });
  const g1 = groupOf(t1, ONE.key);
  const g2 = groupOf(t1, TWO.key);
  check("two groups stand in the class's order, headed with each list's label", t1.groups.length === 2 && t1.groups[0].key === ONE.key && t1.groups[1].key === TWO.key && g1.title === ONE.label && g2.title === TWO.label, t1.groups.map((g) => [g.key, g.title]));
  check("list one has one level subhead, 1, reading 0 / 2 with two pips; list two has levels 1 and 2, each reading 0 / 1 with one pip", g1.levels.length === 1 && g1.levels[0].n === "1" && g1.levels[0].figure?.used === 0 && g1.levels[0].figure?.max === 2 && g1.levels[0].pips.length === 2 && g2.levels.length === 2 && g2.levels.map((l) => l.n).join() === "1,2" && g2.levels.every((l) => l.figure?.used === 0 && l.figure?.max === 1 && l.pips.length === 1), { one: g1.levels.map((l) => [l.n, l.figure, l.pips.length]), two: g2.levels.map((l) => [l.n, l.figure, l.pips.length]) });
  const oneRows = levelOf(g1, 1).rows;
  const twoRows1 = levelOf(g2, 1).rows;
  const twoRows2 = levelOf(g2, 2).rows;
  check("list one level 1 holds the list-one spell and the two-list spell, each row carrying list one's key; list two level 1 holds none and level 2 holds the two-list spell carrying list two's key", oneRows.map((r) => r.id).sort().join() === [spellIds.one, spellIds.both].sort().join() && oneRows.every((r) => r.tradition === ONE.key) && twoRows1.length === 0 && twoRows2.length === 1 && twoRows2[0].id === spellIds.both && twoRows2[0].tradition === TWO.key, { one: oneRows.length, twoLevel1: twoRows1.length, twoLevel2: twoRows2.length });
  const bothRows = t1.allRows.filter((r) => r.id === spellIds.both);
  const bothOne = rowAt(t1, ONE.key, 1, spellIds.both);
  const bothTwo = rowAt(t1, TWO.key, 2, spellIds.both);
  check("the two-list spell is two rows of one item id, one under each list, each lists line naming its own list and level first and the other list after", bothRows.length === 2 && bothOne?.lists?.text.startsWith(shownOf(ONE.label, 1)) && bothOne.lists.text.includes(shownOf(TWO.label, 2)) && bothTwo?.lists?.text.startsWith(shownOf(TWO.label, 2)) && bothTwo.lists.text.includes(shownOf(ONE.label, 1)), { one: bothOne?.lists?.text, two: bothTwo?.lists?.text });
  check("the list-one spell's lists line names list one at level 1 and nothing else", rowAt(t1, ONE.key, 1, spellIds.one)?.lists?.text === shownOf(ONE.label, 1), rowAt(t1, ONE.key, 1, spellIds.one)?.lists?.text);
  const otherLevels = t1.other?.levels ?? [];
  const offRow = otherRow(t1, spellIds.off);
  const bareRow = otherRow(t1, spellIds.bare);
  check("Other spells holds the off-list spell (its lists line naming the list it stands on) and the no-list spell (no lists line), both at level 1, and neither stands under a list", t1.other !== null && otherLevels.length === 1 && otherLevels[0].n === "1" && otherLevels[0].rows.length === 2 && offRow?.lists?.text === shownOf(AWAY, 1) && bareRow?.lists === null && offRow.tradition === null && bareRow.tradition === null && !t1.allRows.some((r) => (r.id === spellIds.off || r.id === spellIds.bare) && r.tradition), { rows: otherLevels.map((l) => l.rows.length), off: offRow?.lists?.text });
  check("the tab is in lists mode: core's typed slot-max inputs are not drawn", t1.levelsInputs.length === 0, t1.levelsInputs);
  check("the casting strip mounted on this sheet draws no per-list pips, no points pair and no tradition row, and keeps its rest control", t1.strip !== null && t1.strip.pips === 0 && t1.strip.pointsPairs === 0 && t1.strip.traditions === 0 && t1.strip.rest === 1, t1.strip);
  note("the strip's power line is drawn (it depends on the power registry; not asserted)", t1.strip?.power === 1);
  check("the Judge's seat is offered the tab's own Rest and Reset slots", t1.controls.rest && t1.controls.reset, t1.controls);

  // ---------------------------------------------------------------- 2
  section("2. the figures say where they came from");
  const levelsAll = [...t1.groups.flatMap((g) => g.levels)];
  check("every slot figure carries a non-empty tooltip, and each names the class", levelsAll.length === 3 && levelsAll.every((l) => l.tip.length > 0 && l.tip.includes(CLASS_NAME)), levelsAll.map((l) => l.tip.length));
  const allListRows = [...t1.groups.flatMap((g) => g.levels.flatMap((l) => l.rows)), ...otherLevels.flatMap((l) => l.rows)];
  check("every row's count field carries a non-empty tooltip naming its spell, and is named for assistive technology by the same text", allListRows.length === 5 && allListRows.every((r) => r.count && r.count.tip.length > 0 && r.count.aria === r.count.tip), allListRows.map((r) => r.count?.tip.length));
  const withLists = allListRows.filter((r) => r.lists);
  check("every lists line carries a non-empty tooltip (four rows hold one; the no-list spell holds none)", withLists.length === 4 && withLists.every((r) => r.lists.tip.length > 0), withLists.map((r) => r.lists.tip.length));
  check("no element under the Magic tab carries a `title` attribute", t1.titles === 0, t1.titles);

  // ---------------------------------------------------------------- 3
  section("3. a hand pip, on the Judge's seat");
  await shapeHero();
  await run(gm, P.open, { actorId: heroId });
  const first3 = await run(gm, P.read, { actorId: heroId });
  const pips0 = levelOf(groupOf(first3, ONE.key), 1).pips;
  check("each pip is a button carrying a non-empty aria-label, and none is spent", pips0.length === 2 && pips0.every((p) => p.tag === "button" && p.label.length > 0 && p.spent === false && p.spentAttr === "false"), pips0);
  const m3 = await marksG();
  const press3a = await run(gm, P.pressPip, { actorId: heroId, tradition: ONE.key, level: 1, spent: false });
  const after3a = await until(gm, P.read, { actorId: heroId }, (t) => figure(t, ONE.key, 1)?.used === 1);
  const st3a = await run(gm, P.state, { actorId: heroId, itemIds: spellIds });
  const w3a = await run(gm, P.since, { from: m3, actorId: heroId });
  const pips1 = levelOf(groupOf(after3a, ONE.key), 1).pips;
  check("pressing an empty pip under list one level 1 is one write to the pools flag, the figure reads 1 / 2, the first pip reads spent, and the stored count is 1", press3a.found && w3a.poolWrites === 1 && w3a.poolWritesByMe === 1 && figure(after3a, ONE.key, 1)?.max === 2 && pips1[0].spent === true && pips1[0].spentAttr === "true" && pips1[1].spent === false && same(st3a.pools, { [ONE.key]: { s1: 1 } }), { write: w3a.poolWrites, figure: figure(after3a, ONE.key, 1), stored: st3a.pools });
  check("a spent pip's name differs from an empty pip's (give back, spend), both non-empty", pips1[0].label.length > 0 && pips1[1].label.length > 0 && pips1[0].label !== pips1[1].label, { spent: pips1[0].label.length, empty: pips1[1].label.length });
  const press3b = await run(gm, P.pressPip, { actorId: heroId, tradition: ONE.key, level: 1, spent: true });
  const after3b = await until(gm, P.read, { actorId: heroId }, (t) => figure(t, ONE.key, 1)?.used === 0);
  const st3b = await run(gm, P.state, { actorId: heroId, itemIds: spellIds });
  const w3b = await run(gm, P.since, { from: m3, actorId: heroId });
  check("pressing the spent pip gives the slot back in one more write: the figure reads 0 / 2 and no pip is spent", press3b.found && w3b.poolWrites === 2 && figure(after3b, ONE.key, 1)?.used === 0 && levelOf(groupOf(after3b, ONE.key), 1).pips.every((p) => p.spent === false) && st3b.derived.find((p) => p.key === ONE.key).slots[0].used === 0, { writes: w3b.poolWrites, stored: st3b.pools });

  // ---------------------------------------------------------------- 4
  section("4. the owner's seat: the Player presses a pip and fills a list's level");
  await run(gm, P.close, { actorId: heroId });
  const st4 = await shapeHero();
  check("shape: pools empty and every count 0 at the start of step 4", st4.pools === null && Object.values(st4.counts).every((n) => n === 0), st4);
  await seatSees(player, null);
  const open4 = await run(player, P.open, { actorId: heroId });
  const t4 = await run(player, P.read, { actorId: heroId });
  check("the Player's seat opens the same two groups with the same levels and figures, is the owner and no GM, and the pips are buttons (four, one per slot)", open4.rendered && t4.owner === true && seatP.isGM === false && t4.groups.length === 2 && t4.groups[0].key === ONE.key && t4.groups[1].key === TWO.key && t4.poolButtons === 4 && figure(t4, ONE.key, 1)?.max === 2 && figure(t4, TWO.key, 2)?.max === 1 && t4.strip?.pips === 0, { owner: t4.owner, buttons: t4.poolButtons });
  const m4 = await marksP();
  const press4a = await run(player, P.pressPip, { actorId: heroId, tradition: ONE.key, level: 1, spent: false });
  const after4a = await until(player, P.read, { actorId: heroId }, (t) => figure(t, ONE.key, 1)?.used === 1);
  const w4a = await run(player, P.since, { from: m4, actorId: heroId });
  const st4a = await run(player, P.state, { actorId: heroId, itemIds: spellIds });
  check("a pip pressed on the Player's seat is written from the Player's seat: one write to the pools flag, authored by that seat's user, the figure 1 / 2 and the stored count 1", press4a.found && w4a.poolWrites === 1 && w4a.poolWritesByMe === 1 && figure(after4a, ONE.key, 1)?.used === 1 && same(st4a.pools, { [ONE.key]: { s1: 1 } }), { writes: w4a.poolWrites, byMe: w4a.poolWritesByMe, stored: st4a.pools });
  const gmSees = await seatSees(gm, { [ONE.key]: { s1: 1 } });
  check("the Judge's seat reads the Player's write", same(gmSees.pools, { [ONE.key]: { s1: 1 } }), gmSees.pools);
  const press4b = await run(player, P.pressPip, { actorId: heroId, tradition: ONE.key, level: 1, spent: false });
  const t4b = await until(player, P.read, { actorId: heroId }, (t) => figure(t, ONE.key, 1)?.used === 2);
  const locs4 = await run(player, P.locs, { keys: Object.values(NOTICE) });
  const noSlotOne = rowAt(t4b, ONE.key, 1, spellIds.one);
  const noSlotBoth = rowAt(t4b, ONE.key, 1, spellIds.both);
  const freeBoth = rowAt(t4b, TWO.key, 2, spellIds.both);
  const off4 = otherRow(t4b, spellIds.off);
  const bare4 = otherRow(t4b, spellIds.bare);
  check("with both of list one's level 1 slots used (2 / 2), the list-one spell's row and the two-list spell's list-one row each carry the noSlot gate, its sentence shown as the row's own text, and Cast is disabled", press4b.found && noSlotOne?.gate?.key === "noSlot" && noSlotOne.gate.text === locs4[NOTICE.blockedNoSlot] && noSlotOne.cast?.disabled === true && noSlotBoth?.gate?.key === "noSlot" && noSlotBoth.gate.text === locs4[NOTICE.blockedNoSlot] && noSlotBoth.cast?.disabled === true, { one: noSlotOne?.gate, both: noSlotBoth?.gate });
  check("the two-list spell's list-two row (list two's level 2 slot unused) has no gate and Cast is on", freeBoth?.gate === null && freeBoth.cast?.disabled === false && figure(t4b, TWO.key, 2)?.used === 0, { gate: freeBoth?.gate, disabled: freeBoth?.cast?.disabled });
  check("the off-list spell's row carries the offList gate with the blocked sentence and Cast is disabled; the no-list spell's row has no gate and Cast is on", off4?.gate?.key === "offList" && off4.gate.text === locs4[NOTICE.blockedOffList] && off4.cast?.disabled === true && bare4?.gate === null && bare4.cast?.disabled === false, { off: off4?.gate?.key, bare: bare4?.gate });
  check("each gate line is a note (its role), and Cast keeps its aria-label on a disabled row and on an enabled one", [noSlotOne, noSlotBoth, off4].every((r) => r?.gate?.role === "note") && [noSlotOne, off4, freeBoth, bare4].every((r) => r?.cast?.named === true), { roles: [noSlotOne?.gate?.role, off4?.gate?.role] });

  // ---------------------------------------------------------------- 5
  section("5. the gate holds off the tab too, and Cast under a heading spends that heading's slot");
  await seatSees(player, { [ONE.key]: { s1: 2 } });
  const m5 = await marksP();
  await run(player, P.use, { actorId: heroId, itemId: spellIds.one });
  const warned5 = await until(player, P.since, { from: m5, actorId: heroId }, (s) => s.warns.length >= 1);
  await sleep(1800);
  const w5 = await run(player, P.since, { from: m5, actorId: heroId });
  const st5 = await run(player, P.state, { actorId: heroId, itemIds: spellIds });
  check("item.use() on the list-one spell from the Player's seat, its level full: one warning shown with the blocked sentence, no write to the hero seen by any client, the count and the pools unchanged", warned5.warns.length >= 1 && w5.warns.filter((w) => w === locs4[NOTICE.blockedNoSlot]).length === 1 && w5.writes === 0 && st5.counts.one === 0 && same(st5.pools, { [ONE.key]: { s1: 2 } }), { warns: w5.warns.length, writes: w5.writes, count: st5.counts.one });
  const m5b = await marksP();
  await run(player, P.use, { actorId: heroId, itemId: spellIds.off });
  await until(player, P.since, { from: m5b, actorId: heroId }, (s) => s.warns.length >= 1);
  await sleep(1800);
  const w5b = await run(player, P.since, { from: m5b, actorId: heroId });
  const st5b = await run(player, P.state, { actorId: heroId, itemIds: spellIds });
  check("item.use() on the off-list spell from the Player's seat: one warning with the offList blocked sentence, no write, the count unchanged", w5b.warns.filter((w) => w === locs4[NOTICE.blockedOffList]).length === 1 && w5b.writes === 0 && st5b.counts.off === 0, { warns: w5b.warns.length, writes: w5b.writes });
  const m5c = await marksP();
  const press5c = await run(player, P.press, { actorId: heroId, itemId: spellIds.both, tradition: TWO.key });
  const st5c = await until(player, P.state, { actorId: heroId, itemIds: spellIds }, (st) => st.counts.both === 1 && same(st.pools, { [ONE.key]: { s1: 2 }, [TWO.key]: { s2: 1 } }));
  const w5c = await run(player, P.since, { from: m5c, actorId: heroId });
  const t5c = await until(player, P.read, { actorId: heroId }, (t) => figure(t, TWO.key, 2)?.used === 1);
  check("Cast pressed on the two-list spell's list-two row from the Player's seat: its count rises to 1, list two's level 2 slot is used (1 / 1) and list one's pools are unchanged (2 / 2), no warning shown", press5c.found && press5c.disabled === false && st5c.counts.both === 1 && same(st5c.pools, { [ONE.key]: { s1: 2 }, [TWO.key]: { s2: 1 } }) && figure(t5c, TWO.key, 2)?.used === 1 && figure(t5c, ONE.key, 1)?.used === 2 && w5c.warns.length === 0, { count: st5c.counts.both, pools: st5c.pools, writes: { items: w5c.itemWrites, pools: w5c.poolWrites } });
  check("that cast's two writes were made from the Player's seat: the count (the item) and list two's pool", w5c.itemWritesByMe >= 1 && w5c.poolWritesByMe === 1, { item: w5c.itemWritesByMe, pool: w5c.poolWritesByMe });
  const m5d = await marksP();
  const press5d = await run(player, P.press, { actorId: heroId, itemId: spellIds.bare, tradition: null });
  const st5d = await until(player, P.state, { actorId: heroId, itemIds: spellIds }, (st) => st.counts.bare === 1);
  await sleep(1200);
  const w5d = await run(player, P.since, { from: m5d, actorId: heroId });
  const st5e = await run(player, P.state, { actorId: heroId, itemIds: spellIds });
  check("Cast on the no-list spell (Other spells) from the Player's seat raises its count to 1 with no warning and no write to the pools", press5d.found && press5d.disabled === false && st5d.counts.bare === 1 && w5d.warns.length === 0 && w5d.poolWrites === 0 && same(st5e.pools, { [ONE.key]: { s1: 2 }, [TWO.key]: { s2: 1 } }), { count: st5d.counts.bare, warns: w5d.warns.length, poolWrites: w5d.poolWrites });

  // ---------------------------------------------------------------- 6
  section("6. the Judge is warned, not stopped");
  const st6 = await shapeHero({ pools: { [ONE.key]: { s1: 2 } } });
  check("shape: list one's level 1 is full (stored 2, derived 2 of 2), every count 0", same(st6.pools, { [ONE.key]: { s1: 2 } }) && usedOf(st6, ONE.key, 1) === 2 && Object.values(st6.counts).every((n) => n === 0), { pools: st6.pools });
  await run(gm, P.open, { actorId: heroId });
  const locs6 = await run(gm, P.locs, { keys: Object.values(NOTICE) });
  const t6 = await run(gm, P.read, { actorId: heroId });
  const row6 = rowAt(t6, ONE.key, 1, spellIds.one);
  const off6 = otherRow(t6, spellIds.off);
  check("the list-one row carries the noSlot gate with the warning sentence (it ends 'Casting anyway.', and is not the blocked sentence) and Cast is on", row6?.gate?.key === "noSlot" && row6.gate.text === locs6[NOTICE.verdictNoSlot] && /Casting anyway\.$/.test(row6.gate.text) && row6.gate.text !== locs6[NOTICE.blockedNoSlot] && row6.cast?.disabled === false, { gate: row6?.gate, disabled: row6?.cast?.disabled });
  check("the off-list row carries the offList gate with the warning sentence and Cast is on", off6?.gate?.key === "offList" && off6.gate.text === locs6[NOTICE.verdictOffList] && /Casting anyway\.$/.test(off6.gate.text) && off6.cast?.disabled === false, { gate: off6?.gate, disabled: off6?.cast?.disabled });
  const m6 = await marksG();
  const poolsBefore6 = (await run(gm, P.state, { actorId: heroId, itemIds: spellIds })).pools;
  const press6 = await run(gm, P.press, { actorId: heroId, itemId: spellIds.one, tradition: ONE.key });
  const st6b = await until(gm, P.state, { actorId: heroId, itemIds: spellIds }, (st) => st.counts.one === 1);
  const w6 = await run(gm, P.since, { from: m6, actorId: heroId });
  const t6b = await until(gm, P.read, { actorId: heroId }, (t) => rowAt(t, ONE.key, 1, spellIds.one)?.count?.value === "1");
  check("the Judge's Cast on the list-one row with the level full raises the count to 1 and shows the warning once", press6.found && press6.disabled === false && st6b.counts.one === 1 && w6.warns.filter((w) => w === locs6[NOTICE.verdictNoSlot]).length === 1, { count: st6b.counts.one, warns: w6.warns.length });
  const storedAfter = st6b.pools?.[ONE.key]?.s1;
  check("the pool holds at the maximum: the cast past the last slot stores no more than the maximum (stored stays 2 on a level whose maximum is 2, with no pool write), and the derived count and the figure read 2 / 2", storedAfter === 2 && poolsBefore6[ONE.key].s1 === 2 && w6.poolWrites === 0 && usedOf(st6b, ONE.key, 1) === 2 && figure(t6b, ONE.key, 1)?.used === 2 && figure(t6b, ONE.key, 1)?.max === 2, { before: poolsBefore6[ONE.key].s1, stored: storedAfter, poolWrites: w6.poolWrites, derived: usedOf(st6b, ONE.key, 1), figure: figure(t6b, ONE.key, 1) });
  const poolsAfter6 = st6b.pools;
  const m6b = await marksG();
  const press6b = await run(gm, P.press, { actorId: heroId, itemId: spellIds.off, tradition: null });
  const st6c = await until(gm, P.state, { actorId: heroId, itemIds: spellIds }, (st) => st.counts.off === 1);
  await sleep(1200);
  const w6b = await run(gm, P.since, { from: m6b, actorId: heroId });
  const st6d = await run(gm, P.state, { actorId: heroId, itemIds: spellIds });
  check("the Judge's Cast on the off-list spell raises its count to 1, shows the offList warning once and writes no pool", press6b.found && press6b.disabled === false && st6c.counts.off === 1 && w6b.warns.filter((w) => w === locs6[NOTICE.verdictOffList]).length === 1 && w6b.poolWrites === 0 && same(st6d.pools, poolsAfter6), { count: st6c.counts.off, poolWrites: w6b.poolWrites });
  const m6c = await marksG();
  const press6c = await run(gm, P.pressPip, { actorId: heroId, tradition: ONE.key, level: 1, spent: true });
  const t6c = await until(gm, P.read, { actorId: heroId }, (t) => figure(t, ONE.key, 1)?.used === 1);
  const st6e = await run(gm, P.state, { actorId: heroId, itemIds: spellIds });
  const w6c = await run(gm, P.since, { from: m6c, actorId: heroId });
  check("a give-back press on the full level lowers the figure by one (1 / 2) in one pool write, and the stored count is 1", press6c.found && figure(t6c, ONE.key, 1)?.used === 1 && usedOf(st6e, ONE.key, 1) === 1 && st6e.pools?.[ONE.key]?.s1 === 1 && w6c.poolWrites === 1, { figure: figure(t6c, ONE.key, 1), stored: st6e.pools, writes: w6c.poolWrites });

  // ---------------------------------------------------------------- 7
  section("7. Rest and Reset slots, from the Player's seat");
  const st7 = await shapeHero({ pools: { [ONE.key]: { s1: 1 }, [TWO.key]: { s2: 1 } }, counts: { one: 2, both: 1 } });
  check("shape: pools {one s1 1, two s2 1} and counts one 2, both 1", same(st7.pools, { [ONE.key]: { s1: 1 }, [TWO.key]: { s2: 1 } }) && st7.counts.one === 2 && st7.counts.both === 1, { pools: st7.pools, counts: st7.counts });
  await seatSees(player, { [ONE.key]: { s1: 1 }, [TWO.key]: { s2: 1 } }, { one: 2, both: 1 });
  await run(gm, P.close, { actorId: heroId });
  await run(player, P.open, { actorId: heroId });
  const t7 = await run(player, P.read, { actorId: heroId });
  check("the Player's tab reads 1 / 2 on list one level 1, 1 / 1 on list two level 2, and offers Rest and Reset slots", figure(t7, ONE.key, 1)?.used === 1 && figure(t7, TWO.key, 2)?.used === 1 && t7.controls.rest && t7.controls.reset, { one: figure(t7, ONE.key, 1), two: figure(t7, TWO.key, 2) });
  const m7 = await marksP();
  const rest7 = await run(player, P.pressControl, { actorId: heroId, selector: 'button[data-action="rest"]' });
  const st7a = await until(player, P.state, { actorId: heroId, itemIds: spellIds }, (st) => st.pools === null);
  const t7a = await until(player, P.read, { actorId: heroId }, (t) => figure(t, ONE.key, 1)?.used === 0);
  const w7 = await run(player, P.since, { from: m7, actorId: heroId });
  check("the tab's own Rest (not the strip's) removes the pools flag (absent, not an empty object) in one write by the Player, leaves every spell's count (one 2, both 1), and every figure reads 0", rest7.found && st7a.pools === null && st7a.counts.one === 2 && st7a.counts.both === 1 && w7.poolWrites === 1 && w7.poolWritesByMe === 1 && w7.itemWrites === 0 && figure(t7a, ONE.key, 1)?.used === 0 && figure(t7a, TWO.key, 2)?.used === 0, { stored: st7a.pools, counts: st7a.counts, writes: w7.poolWrites });
  await run(gm, P.shapeActor, { actorId: heroId, classUuid: cls.uuid, level: 1, pools: { [ONE.key]: { s1: 1 } } });
  await seatSees(player, { [ONE.key]: { s1: 1 } }, { one: 2, both: 1 });
  const m7b = await marksP();
  const reset7 = await run(player, P.pressControl, { actorId: heroId, selector: 'button[data-action="spellReset"]' });
  const st7b = await until(player, P.state, { actorId: heroId, itemIds: spellIds }, (st) => Object.values(st.counts).every((n) => n === 0));
  const w7b = await run(player, P.since, { from: m7b, actorId: heroId });
  check("Reset slots sets every spell's count to 0 through the items, and leaves the pools flag as it stood ({one s1 1}) with no write to it", reset7.found && Object.values(st7b.counts).every((n) => n === 0) && same(st7b.pools, { [ONE.key]: { s1: 1 } }) && w7b.itemWritesByMe >= 1 && w7b.poolWrites === 0, { counts: st7b.counts, pools: st7b.pools, itemWrites: w7b.itemWritesByMe, poolWrites: w7b.poolWrites });
  const strip7 = await run(player, P.pressControl, { actorId: heroId, selector: ".acks-extras-classes-strip .acks-extras-classes-rest" });
  const st7c = await until(player, P.state, { actorId: heroId, itemIds: spellIds }, (st) => st.pools === null);
  check("the strip's own rest control, the one the system's sheet also carries, removes the pools flag too", strip7.found && st7c.pools === null, { found: strip7.found, stored: st7c.pools });

  // ---------------------------------------------------------------- 8
  section("8. a seat that only observes");
  await run(player, P.close, { actorId: heroId });
  const st8 = await shapeStranger({ pools: { [ONE.key]: { s1: 1 } } });
  check("shape: the stranger is bound to the class with one slot of list one spent, and its one spell is on list one", st8.bound === CLASS_NAME && same(st8.pools, { [ONE.key]: { s1: 1 } }) && st8.items === 1, st8);
  await until(player, P.state, { actorId: strangerId, itemIds: { spell: strangerSpell } }, (st) => same(st.pools, { [ONE.key]: { s1: 1 } }) && st.items === 1);
  const open8 = await run(player, P.open, { actorId: strangerId });
  const t8 = await until(player, P.read, { actorId: strangerId }, (t) => t.tab === true && figure(t, ONE.key, 1)?.used === 1);
  const pips8 = levelOf(groupOf(t8, ONE.key), 1)?.pips ?? [];
  check("the observer's tab draws the list group, the figure (1 / 2) and two pips that are not buttons (the first spent), and no pool button anywhere on the tab", open8.rendered && t8.owner === false && t8.groups.length === 2 && figure(t8, ONE.key, 1)?.max === 2 && pips8.length === 2 && pips8.every((p) => p.tag !== "button") && pips8[0].spent === true && pips8[1].spent === false && t8.poolButtons === 0 && t8.pointsButtons === 0, { owner: t8.owner, pips: pips8.map((p) => p.tag), buttons: t8.poolButtons });
  check("the observer's tab offers neither of the tab's own Rest and Reset slots buttons, and its spell stands under list one", t8.controls.rest === false && t8.controls.reset === false && rowAt(t8, ONE.key, 1, strangerSpell) !== null, t8.controls);
  check("the observer's casting strip draws no rest control", t8.strip?.rest === 0, { rest: t8.strip?.rest ?? null });
  note("whether the stranger's Cast is disabled (printed, not asserted)", { castDisabled: rowAt(t8, ONE.key, 1, strangerSpell)?.cast?.disabled ?? null });

  // ---------------------------------------------------------------- 9
  section("9. a character with no class bound reads by level");
  await run(player, P.close, { actorId: strangerId });
  const plainShape = await run(gm, P.shapeActor, { actorId: plainId, classUuid: null, level: 1, pools: null });
  await run(gm, P.shapeSpell, { actorId: plainId, itemId: plainSpell, flag: null, lvl: 1, cast: 0 });
  const st9 = await run(gm, P.state, { actorId: plainId, itemIds: { spell: plainSpell } });
  check("shape: the character has no class bound (none resolves, the typed class name is blank), spells enabled, the one spell at level 1 with count 0", st9.bound === null && st9.derived.length === 0 && st9.counts.spell === 0 && plainShape.enabled === true, { bound: st9.bound, derived: st9.derived.length });
  await run(gm, P.open, { actorId: plainId });
  const t9 = await run(gm, P.read, { actorId: plainId });
  const maxInput = t9.levelsInputs.find((i) => i.name === "system.spells.1.max");
  check("the tab reads by level as before: no list group, no Other spells, the typed slot-max input for level 1 is there and editable, and the spell's row has no gate", t9.tab && t9.groups.length === 0 && t9.other === null && maxInput !== undefined && maxInput.disabled === false && t9.allRows.length === 1 && t9.allRows[0].id === plainSpell && t9.allRows[0].gate === null && t9.allRows[0].lists === null, { groups: t9.groups.length, other: t9.other, inputs: t9.levelsInputs });
  const m9 = await marksG();
  const press9 = await run(gm, P.press, { actorId: plainId, itemId: plainSpell, tradition: null });
  const st9b = await until(gm, P.state, { actorId: plainId, itemIds: { spell: plainSpell } }, (st) => st.counts.spell === 1);
  await sleep(1000);
  const w9 = await run(gm, P.since, { from: m9, actorId: plainId });
  check("Cast on that spell raises its count to 1 through the system, with no warning and no write to a pools flag: the gate takes nothing where no class is bound", press9.found && st9b.counts.spell === 1 && w9.warns.length === 0 && w9.poolWrites === 0, { count: st9b.counts.spell, warns: w9.warns.length });

  // ---------------------------------------------------------------- 10
  section("10. narrow");
  await run(gm, P.close, { actorId: plainId });
  const st10 = await shapeHero({ pools: { [ONE.key]: { s1: 2 } } });
  check("shape: list one full again, every count 0", same(st10.pools, { [ONE.key]: { s1: 2 } }) && Object.values(st10.counts).every((n) => n === 0), st10.pools);
  await run(gm, P.open, { actorId: heroId });
  const lay = await run(gm, P.layout, { actorId: heroId });
  check("at the sheet's floor width the window is at the floor (the width the frame's min-width gives)", lay.floor > 0 && lay.width <= lay.floor + 2 && lay.width < lay.before, { floor: lay.floor, width: lay.width, before: lay.before });
  check("the tab's scroller and the tab have no horizontal overflow, and no spell row overflows", lay.scroller.sw <= lay.scroller.cw && lay.tab.sw <= lay.tab.cw && lay.overflowingRows === 0, lay);
  check("each gate line (the noSlot and offList rows) sits below the rest of its row, across its width", lay.gates.length >= 3 && lay.gates.every((g) => g.below && g.wide && g.within), lay.gates);

  // ---------------------------------------------------------------- end
  section("teardown");
  for (const uuid of await run(gm, P.newMessages, { since: msgSince, actorIds: [heroId, strangerId, plainId] })) await track(uuid, "ChatMessage");
  const errP = await run(player, async () => globalThis.__mt.errors.slice());
  const errG = await run(gm, async () => globalThis.__mt.errors.slice());
  check("no console error on either seat over the walk (recorded from the walk's start, after `ready`; the load itself is not covered)", errP.length === 0 && errG.length === 0, { player: errP.length, gm: errG.length });
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("restore");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the cards the run's casts posted go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: character-sheet/tab-class, tab-hero, tab-spell-one, tab-spell-both, tab-spell-off, tab-spell-bare, tab-stranger, tab-stranger-spell, tab-plain, tab-plain-spell");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
