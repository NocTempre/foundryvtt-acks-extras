/**
 * Live walk, classes-legacy: who writes a player's legacy. Walks
 * docs/classes/TESTING.md "A player's legacy" on the GM and Player seats: the
 * Player whose ledger it is records the reserve fund from a character they own
 * (the coin leaves the purse, the ledger gains the entry, the card reaches the
 * Judge and the Player), starts a successor from it, names the player and
 * strikes the entry; the Player's window draws no Record funeral and no Settle
 * estate, and `record` with a funeral from the Player seat writes and pays
 * nothing, and so does `settleWill` on a will naming an heir; a character the
 * Player only observes, though it feeds the Player's ledger and holds coin,
 * draws no select, no Record, no Start and no delete, and `record` on it
 * writes and pays nothing. The GM seat's window still draws the funeral button
 * and Settle, and the GM records a funeral. Machine values arrive through
 * ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `classes/legacy-dead` (a character the
 * Player owns, holding a large invented experience as the prior and a will
 * naming the heir), `classes/legacy-next` (a character the Player owns, at 0
 * experience at the step's start), `classes/legacy-heir` (the will's heir) and
 * `classes/legacy-foreign` (a character the Player observes, naming the Player
 * as its player). The step's start empties each one's coin, will and named
 * player. The Player User's `legacy` flag is the one write outside a fixture:
 * it is read before anything changes, written to the log directory, and put
 * back to exactly that value at teardown (a run killed by the wall clock skips
 * teardown; the file is the value to put back). The coin rows the walk mints
 * and the cards the presses post are tracked by the ids read back and swept by
 * those ids alone. Every figure printed is a count or a boolean; the amounts
 * are invented and no figure read from the world leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import fs from "node:fs";
import path from "node:path";
import { seats as machineSeats, PORTS, logDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const DEAD = "classes/legacy-dead";
const NEXT = "classes/legacy-next";
const FOREIGN = "classes/legacy-foreign";
const HEIR = "classes/legacy-heir";
/** An invented amount for the reserve entry and the refused funeral. */
const GP = 1000;
/** An invented coin grant, enough for the entry and the refused funeral both. */
const MINT = 5000;
/** An invented estate for the will. */
const ESTATE = 400;
/** An invented experience for the prior, far above any grant, so the cap never binds. */
const PRIOR_XP = 10_000_000;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__lg = globalThis.__lg ?? {});
    H.LL = await import("/modules/acks-extras/scripts/classes/legacy-logic.mjs");
    H.MO = await import("/modules/acks-extras/scripts/lib/money.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : (app?.element?.[0] ?? null));
    H.win = (actorId) => foundry.applications.instances.get(`acks-extras-legacy-${actorId}`) ?? null;
    H.ledger = (userId) => acksExtras.classes.legacy.ledgerOf(game.users.get(userId));
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.chat = [];
      H.chatCreate = ChatMessage.create;
      ChatMessage.create = async function (...args) {
        const made = await H.chatCreate.apply(this, args);
        for (const m of Array.isArray(made) ? made : [made]) if (m?.id) H.chat.push(m.id);
        return made;
      };
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  userId: async ({ name }) => game.users.getName(name)?.id ?? null,
  /** The imported percentages as presence booleans; the figures stay on the page. */
  rates: async () => {
    const r = acksExtras.classes.legacy.rates();
    return { reserve: r.reserve != null, funeral: r.funeral != null, bankFee: r.bankFee != null };
  },
  /** A user's `legacy` flag as a plain value, null when there is none. */
  flagOf: async ({ userId }) => {
    const f = game.users.get(userId).getFlag("acks-extras", "legacy");
    return f === undefined ? null : structuredClone(f);
  },
  /** Put a user's `legacy` flag to exactly `value` (null unsets it), and answer whether the read-back equals it. */
  setFlag: async ({ userId, value }) => {
    const u = game.users.get(userId);
    await u.unsetFlag("acks-extras", "legacy");
    if (value !== null) await u.setFlag("acks-extras", "legacy", value);
    const now = u.getFlag("acks-extras", "legacy");
    return value === null ? now === undefined : foundry.utils.objectsEqual(now, value);
  },
  /**
   * The step's start: the four characters with no coin, no will and no named
   * player; the Player owning the prior and the successor and observing the
   * foreign one, which names the Player as its player; the prior holding the
   * invented experience and the successor none, and the prior's will naming
   * the heir.
   */
  shape: async ({ deadId, nextId, foreignId, heirId, playerId, priorXp, estate }) => {
    const OWN = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const dead = game.actors.get(deadId);
    const next = game.actors.get(nextId);
    const foreign = game.actors.get(foreignId);
    const heir = game.actors.get(heirId);
    for (const a of [dead, next, foreign, heir]) {
      const coin = a.items.filter((i) => i.type === "money").map((i) => i.id);
      if (coin.length) await a.deleteEmbeddedDocuments("Item", coin);
      await a.unsetFlag("acks-extras", "legacyPlayer");
      await a.unsetFlag("acks-extras", "will");
    }
    await dead.update({ [`ownership.${playerId}`]: OWN.OWNER, "system.details.xp.value": priorXp });
    await next.update({ [`ownership.${playerId}`]: OWN.OWNER, "system.details.xp.value": 0 });
    await foreign.update({ [`ownership.${playerId}`]: OWN.OBSERVER });
    await foreign.setFlag("acks-extras", "legacyPlayer", playerId);
    await dead.setFlag("acks-extras", "will", { heirUuid: heir.uuid, heirName: heir.name, estateGp: estate, note: "" });
    const L = acksExtras.classes.legacy;
    return {
      owned: dead.ownership[playerId] === OWN.OWNER && next.ownership[playerId] === OWN.OWNER,
      observed: foreign.ownership[playerId] === OWN.OBSERVER,
      noCoin: [dead, next, foreign, heir].every((a) => !a.items.some((i) => i.type === "money")),
      nextAtZero: next.system.details.xp.value === 0,
      feeds: [dead, next, foreign].every((a) => L.playerOf(a)?.id === playerId),
      willNamesHeir: dead.getFlag("acks-extras", "will")?.heirUuid === heir.uuid,
    };
  },
  mint: async ({ actorId, gp }) => {
    const H = globalThis.__lg;
    const a = game.actors.get(actorId);
    const before = new Set(a.items.filter((i) => i.type === "money").map((i) => i.id));
    await H.MO.mintCoin(a, gp);
    return { minted: a.items.filter((i) => i.type === "money" && !before.has(i.id)).map((i) => i.uuid), spendable: H.MO.spendableGp(a) >= gp };
  },
  /**
   * Open a character's Legacy window on this seat: through the sheet's Class tab
   * chip when `via` is "chip", else through the API. Answers how it was opened.
   */
  openWindow: async ({ actorId, via }) => {
    const H = globalThis.__lg;
    const a = game.actors.get(actorId);
    let how = "api";
    if (via === "chip") {
      a.sheet.tabGroups.primary = "class";
      await a.sheet.render({ force: true });
      await H.poll(() => H.root(a.sheet)?.isConnected);
      await H.sleep(600);
      const chip = H.root(a.sheet)?.querySelector('[data-action="legacy"]');
      if (chip) { chip.click(); how = "chip"; }
    }
    if (how === "api") acksExtras.classes.legacy.open(a);
    const app = await H.poll(() => { const x = H.win(actorId); return x && H.root(x)?.querySelector(".acks-extras-legacy__body") ? x : null; });
    return { opened: !!app, how };
  },
  /** What the window draws: counts and booleans of its controls. */
  readWindow: async ({ actorId }) => {
    const H = globalThis.__lg;
    const root = H.root(H.win(actorId));
    if (!root) return { open: false };
    const q = (s) => root.querySelector(s);
    const select = q('select[name="player"]');
    return {
      open: true,
      sections: root.querySelectorAll("[data-legacy-section]").length,
      playerOptions: select ? [...select.options].map((o) => o.value) : null,
      setPlayer: !!q('[data-action="setPlayer"]'),
      record: !!q('[data-action="record"][data-kind="reserve"]'),
      funeral: !!q('[data-action="record"][data-kind="funeral"]'),
      startSelect: !!q('select[name="prior"]'),
      startButton: !!q('[data-action="start"]'),
      deleteIds: [...root.querySelectorAll('[data-action="deleteEntry"]')].map((b) => b.dataset.entryId),
      deleteHeader: !!q('.acks-extras-legacy__ledger thead th[aria-label]'),
      rows: root.querySelectorAll(".acks-extras-legacy__ledger tbody tr").length,
      settle: !!q('[data-action="settleWill"]'),
      saveWill: !!q('[data-action="saveWill"]'),
    };
  },
  /** Press Record reserve with Pay ticked: what the press did to the purse, the ledger and the cards. */
  pressRecord: async ({ actorId, gp }) => {
    const H = globalThis.__lg;
    const a = game.actors.get(actorId);
    const user = acksExtras.classes.legacy.playerOf(a);
    const btn = H.root(H.win(actorId))?.querySelector('[data-action="record"][data-kind="reserve"]');
    if (!btn) return { pressed: false };
    const form = btn.closest("[data-legacy-section]");
    form.querySelector('[name="gp"]').value = String(gp);
    form.querySelector('[name="pay"]').checked = true;
    const entries0 = (H.ledger(user.id).entries ?? []).length;
    const purse0 = H.MO.spendableGp(a);
    H.chat.length = 0;
    btn.click();
    const landed = await H.poll(() => (H.ledger(user.id).entries ?? []).length > entries0);
    await H.sleep(800);
    const entries = H.ledger(user.id).entries ?? [];
    const entry = entries[entries.length - 1] ?? null;
    const ids = H.chat.splice(0);
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    const whispers = ids.map((id) => game.messages.get(id)?.whisper ?? []);
    return {
      pressed: true,
      landed: !!landed,
      entryId: landed ? entry.id : null,
      oneEntry: entries.length === entries0 + 1,
      entryShape: !!entry && entry.kind === "reserve" && entry.gp === gp && entry.xp > 0 && entry.actorUuid === a.uuid,
      fell: Math.round((purse0 - H.MO.spendableGp(a)) * 100) / 100 === gp,
      card: whispers.some((w) => w.includes(user.id) && gms.every((g) => w.includes(g))),
      cards: ids.filter((id) => game.messages.get(id)?.speaker?.actor === actorId).map((id) => game.messages.get(id).uuid),
    };
  },
  /**
   * Call `record` through the API on this seat and say what changed: the
   * result, the notices raised (by the funeral refusal's own text), the
   * ledger's entry count and the purse. `userId` names the ledger read.
   */
  callRecord: async ({ actorId, userId, kind, gp, pay }) => {
    const H = globalThis.__lg;
    const a = game.actors.get(actorId);
    const entries0 = (H.ledger(userId).entries ?? []).length;
    const purse0 = H.MO.spendableGp(a);
    const warns = [];
    const warn0 = ui.notifications.warn;
    ui.notifications.warn = function (...args) { warns.push(String(args[0])); return warn0.apply(this, args); };
    H.chat.length = 0;
    let result;
    try {
      result = await acksExtras.classes.legacy.record(a, { kind, gp, pay });
      await H.sleep(600);
    } finally {
      ui.notifications.warn = warn0;
    }
    const ids = H.chat.splice(0);
    return {
      nullResult: result === null,
      entryKind: result?.kind ?? null,
      entriesDelta: (H.ledger(userId).entries ?? []).length - entries0,
      purseDelta: Math.round((purse0 - H.MO.spendableGp(a)) * 100) / 100,
      funeralNotice: warns.includes(game.i18n.localize("ACKS-CLASSES.legacy.funeralJudge")),
      warns: warns.length,
      cards: ids.filter((id) => game.messages.get(id)?.speaker?.actor === actorId).map((id) => game.messages.get(id).uuid),
    };
  },
  /** Press Start in `nextId`'s window against `priorId`, and say what the successor and the ledger hold after. */
  pressStart: async ({ nextId, priorId, playerId }) => {
    const H = globalThis.__lg;
    const next = game.actors.get(nextId);
    const prior = game.actors.get(priorId);
    const root = H.root(H.win(nextId));
    const select = root?.querySelector('select[name="prior"]');
    const btn = root?.querySelector('[data-action="start"]');
    if (!select || !btn) return { pressed: false, hasSelect: !!select, hasButton: !!btn };
    const grant = H.LL.startingXp(H.ledger(playerId), prior.system.details.xp.value).xp;
    const xp0 = next.system.details.xp.value;
    const starts0 = (H.ledger(playerId).starts ?? []).length;
    H.chat.length = 0;
    select.value = prior.uuid;
    btn.click();
    const landed = await H.poll(() => next.system.details.xp.value !== xp0);
    await H.sleep(800);
    const starts = H.ledger(playerId).starts ?? [];
    const ids = H.chat.splice(0);
    return {
      pressed: true,
      optionOffered: [...select.options].some((o) => o.value === prior.uuid),
      grantPositive: grant > 0,
      xpBefore: xp0,
      landed: !!landed,
      xpIsGrant: next.system.details.xp.value === grant,
      startRow: starts.length === starts0 + 1 && starts[starts.length - 1]?.actorUuid === next.uuid,
      cards: ids.filter((id) => game.messages.get(id)?.speaker?.actor === nextId).map((id) => game.messages.get(id).uuid),
    };
  },
  /** Press an entry's delete button, and say whether the entry is gone from the User flag. */
  pressDelete: async ({ actorId, entryId, playerId }) => {
    const H = globalThis.__lg;
    const btn = H.root(H.win(actorId))?.querySelector(`[data-action="deleteEntry"][data-entry-id="${entryId}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    const gone = await H.poll(() => !(H.ledger(playerId).entries ?? []).some((e) => e.id === entryId));
    return { pressed: true, gone: !!gone };
  },
  /** Press Name the player with the select's one option, and say whether the actor's flag holds it. */
  pressSetPlayer: async ({ actorId, playerId }) => {
    const H = globalThis.__lg;
    const a = game.actors.get(actorId);
    const root = H.root(H.win(actorId));
    const select = root?.querySelector('select[name="player"]');
    const btn = root?.querySelector('[data-action="setPlayer"]');
    if (!select || !btn) return { pressed: false };
    select.value = playerId;
    btn.click();
    const landed = await H.poll(() => a.getFlag("acks-extras", "legacyPlayer") === playerId);
    return { pressed: true, landed: !!landed };
  },
  /** Call `settleWill` on this seat; answers whether it refused and the will flag stayed as it was. */
  callSettle: async ({ actorId }) => {
    const a = game.actors.get(actorId);
    const before = JSON.stringify(a.getFlag("acks-extras", "will") ?? null);
    const result = await acksExtras.classes.legacy.settleWill(a);
    await new Promise((r) => setTimeout(r, 400));
    return { hadHeir: !!JSON.parse(before)?.heirUuid, nullResult: result === null, unchanged: JSON.stringify(a.getFlag("acks-extras", "will") ?? null) === before };
  },
  /** GM seat: take the named player off the characters the walk named one on. */
  clearNamed: async ({ ids }) => {
    for (const id of ids) await game.actors.get(id)?.unsetFlag("acks-extras", "legacyPlayer");
    return true;
  },
  closeWindows: async ({ ids }) => {
    for (const id of ids) {
      await foundry.applications.instances.get(`acks-extras-legacy-${id}`)?.close({ force: true });
      await game.actors.get(id)?.sheet?.close();
    }
    return true;
  },
  drain: async () => ({ errors: (globalThis.__lg?.errors ?? []).slice() }),
  restore: async () => {
    const H = globalThis.__lg;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ChatMessage.create = H.chatCreate;
    H.patched = false;
    return "restored";
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.classes?.legacy?.open`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let player = null;
const made = [];
const actorIds = [];
let playerId = null;
let flagBefore;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 360_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const track = async (uuid, kind) => { if (!uuid || made.includes(uuid)) return; made.push(uuid); await gm.track(uuid, kind); };

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const gi = await run(gm, P.install);
  check("the GM seat is a GM", gi.isGM, gi);
  playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const rates = await run(gm, P.rates);
  if (!rates.reserve) blocked("the experience tables are not imported, so the reserve rate is blank and nothing records");

  section("fixtures");
  // Read before anything below writes the Player's ledger; teardown puts exactly this back.
  flagBefore = await run(gm, P.flagOf, { userId: playerId });
  fs.writeFileSync(path.join(logDir(), "classes-legacy-flag-before.json"), JSON.stringify(flagBefore));
  note("the Player's legacy flag before the run, kept in the log directory", { present: flagBefore !== null, entries: flagBefore?.entries?.length ?? 0, starts: flagBefore?.starts?.length ?? 0 });
  const dead = await gm.fixture(DEAD, "Actor", { name: "QA Legacy Dead", type: "character" });
  const next = await gm.fixture(NEXT, "Actor", { name: "QA Legacy Next", type: "character" });
  const foreign = await gm.fixture(FOREIGN, "Actor", { name: "QA Legacy Foreign", type: "character" });
  const heir = await gm.fixture(HEIR, "Actor", { name: "QA Legacy Heir", type: "character" });
  actorIds.push(dead.id, next.id, foreign.id, heir.id);
  const shaped = await run(gm, P.shape, { deadId: dead.id, nextId: next.id, foreignId: foreign.id, heirId: heir.id, playerId, priorXp: PRIOR_XP, estate: ESTATE });
  check("the Player owns the prior and the successor, observes the foreign one; no coin; the successor at 0 experience; the will names the heir", shaped.owned && shaped.observed && shaped.noCoin && shaped.nextAtZero && shaped.willNamesHeir, shaped);
  check("the Player is the one whose ledger the prior, the successor and the foreign character feed", shaped.feeds, { feeds: shaped.feeds });
  if (!shaped.owned || !shaped.feeds) blocked("the fixtures did not take the shape the walk needs");
  for (const id of [dead.id, foreign.id]) {
    const minted = await run(gm, P.mint, { actorId: id, gp: MINT });
    for (const uuid of minted.minted) await track(uuid, "Item");
    check("the purse holds the invented grant", minted.spendable, { rows: minted.minted.length });
  }

  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const pi = await run(player, P.install);
  check("the Player seat is not a GM", !pi.isGM, { isGM: pi.isGM });

  section("1: the Player opens the prior's Legacy window from its Class tab");
  const o1 = await run(player, P.openWindow, { actorId: dead.id, via: "chip" });
  note("opened", o1);
  check("the Legacy window opens from the Class tab's Legacy chip", o1.opened && o1.how === "chip", o1);
  const w1 = await run(player, P.readWindow, { actorId: dead.id });
  check("the select lists the Player alone", w1.playerOptions?.length === 1 && w1.playerOptions[0] === playerId && w1.setPlayer, { options: w1.playerOptions?.length ?? null });
  check("the Record and Start sections are drawn and the Record reserve button is there", w1.sections === 4 && w1.record && w1.startSelect && w1.startButton, { sections: w1.sections, record: w1.record, startSelect: w1.startSelect, startButton: w1.startButton });
  check("no Record funeral button and no Settle estate button on the Player's window", !w1.funeral && !w1.settle, { funeral: w1.funeral, settle: w1.settle });
  check("the will's own Save is the owner's", w1.saveWill, { saveWill: w1.saveWill });

  section("1b: the Player names the player on a character they own");
  const sp = await run(player, P.pressSetPlayer, { actorId: dead.id, playerId });
  check("Name the player writes the actor's flag from the Player seat", sp.pressed && sp.landed, sp);

  section("2: the Player records the reserve fund, paying from the purse");
  const r2 = await run(player, P.pressRecord, { actorId: dead.id, gp: GP });
  for (const uuid of r2.cards ?? []) await track(uuid, "ChatMessage");
  check("the press lands one reserve entry on the Player's User, in its shape", r2.pressed && r2.landed && r2.oneEntry && r2.entryShape, { landed: r2.landed, oneEntry: r2.oneEntry, entryShape: r2.entryShape });
  check("the character's coin falls by exactly the amount", r2.fell, { fell: r2.fell });
  check("a card is whispered to the Judge and the Player", r2.card && (r2.cards ?? []).length > 0, { card: r2.card, cards: (r2.cards ?? []).length });

  section("3: a funeral stays the Judge's press");
  check("the Player's window drew no Record funeral button (step 1)", !w1.funeral);
  const f3 = await run(player, P.callRecord, { actorId: dead.id, userId: playerId, kind: "funeral", gp: GP, pay: true });
  for (const uuid of f3.cards ?? []) await track(uuid, "ChatMessage");
  check("record with a funeral from the Player seat returns null, writes no entry, pays nothing, and tells the seat", f3.nullResult && f3.entriesDelta === 0 && f3.purseDelta === 0 && f3.funeralNotice && (f3.cards ?? []).length === 0, f3);

  section("4: the Player starts the successor from the legacy");
  const o4 = await run(player, P.openWindow, { actorId: next.id, via: "api" });
  check("the successor's Legacy window opens", o4.opened, o4);
  const s4 = await run(player, P.pressStart, { nextId: next.id, priorId: dead.id, playerId });
  for (const uuid of s4.cards ?? []) await track(uuid, "ChatMessage");
  check("the prior is offered, the grant is above 0 and the press is made", s4.pressed && s4.optionOffered && s4.grantPositive, { pressed: s4.pressed, offered: s4.optionOffered, grantPositive: s4.grantPositive });
  check("the successor's experience equals the grant the ledger gives, and the ledger gains a starts row for it", s4.landed && s4.xpIsGrant && s4.startRow, { landed: s4.landed, xpIsGrant: s4.xpIsGrant, startRow: s4.startRow });

  // The foreign character feeds the Player's ledger and holds coin, so only
  // ownership of it refuses; the step-2 entry is still on the ledger, so a
  // delete column that is not drawn is a column that would have had a button.
  section("5: a character the Player only observes, which feeds the Player's ledger");
  const o5 = await run(player, P.openWindow, { actorId: foreign.id, via: "api" });
  check("the foreign character's Legacy window opens", o5.opened, o5);
  const w5f = await run(player, P.readWindow, { actorId: foreign.id });
  check("the ledger is read: the entry's row is shown", w5f.rows >= 1, { rows: w5f.rows });
  check("no select, no Record, no Start, no delete column or button", w5f.sections === 2 && w5f.playerOptions === null && !w5f.setPlayer && !w5f.record && !w5f.funeral && !w5f.startButton && !w5f.startSelect && w5f.deleteIds.length === 0 && !w5f.deleteHeader, { sections: w5f.sections, select: w5f.playerOptions !== null, record: w5f.record, start: w5f.startButton, deletes: w5f.deleteIds?.length });
  check("no Settle estate, no Save will", !w5f.settle && !w5f.saveWill, { settle: w5f.settle, saveWill: w5f.saveWill });
  const f5 = await run(player, P.callRecord, { actorId: foreign.id, userId: playerId, kind: "reserve", gp: GP, pay: true });
  for (const uuid of f5.cards ?? []) await track(uuid, "ChatMessage");
  check("record on it from the Player seat refuses silently: no entry, no coin paid, no notice", f5.nullResult && f5.entriesDelta === 0 && f5.purseDelta === 0 && f5.warns === 0, f5);

  section("6: the Player strikes the entry step 2 made");
  const w6 = await run(player, P.readWindow, { actorId: dead.id });
  check("each ledger row carries a delete button, and the column has its header", w6.deleteIds?.includes(r2.entryId) && w6.deleteHeader, { buttons: w6.deleteIds?.length ?? 0, header: w6.deleteHeader });
  const d6 = await run(player, P.pressDelete, { actorId: dead.id, entryId: r2.entryId, playerId });
  check("the entry is gone from the User flag", d6.pressed && d6.gone, d6);

  section("7: settling a will stays the Judge's press");
  check("the Player's window drew no Settle estate over a will that names an heir (step 1)", !w1.settle);
  if (rates.bankFee) {
    const c7 = await run(player, P.callSettle, { actorId: dead.id });
    check("settleWill from the Player seat, on a will naming an heir, returns null and leaves the will as it was", c7.hadHeir && c7.nullResult && c7.unchanged, c7);
  } else {
    note("the bank fee is not imported", "settleWill's refusal is not told from the missing fee, so it is not walked");
  }

  section("8: the GM seat, unchanged");
  const o8 = await run(gm, P.openWindow, { actorId: dead.id, via: "api" });
  check("the GM's Legacy window opens", o8.opened, o8);
  const w8 = await run(gm, P.readWindow, { actorId: dead.id });
  check("the GM's window draws the select (every non-GM user), Record reserve and funeral, Start and Settle estate", w8.sections === 4 && (w8.playerOptions?.length ?? 0) >= 1 && w8.playerOptions.includes(playerId) && w8.record && w8.funeral && w8.settle, { sections: w8.sections, options: w8.playerOptions?.length ?? null, record: w8.record, funeral: w8.funeral, settle: w8.settle });
  if (rates.funeral) {
    const g8 = await run(gm, P.callRecord, { actorId: dead.id, userId: playerId, kind: "funeral", gp: GP, pay: false });
    for (const uuid of g8.cards ?? []) await track(uuid, "ChatMessage");
    check("a GM records a funeral through the API: one entry of that kind", !g8.nullResult && g8.entryKind === "funeral" && g8.entriesDelta === 1 && !g8.funeralNotice, { kind: g8.entryKind, entriesDelta: g8.entriesDelta });
  } else {
    note("the funeral rate is not imported", "the GM's funeral record is not walked");
  }

  const pe = await run(player, P.drain);
  const ge = await run(gm, P.drain);
  check("no console error on either seat from install to the end of the walk", !pe.errors.length && !ge.errors.length, { player: pe.errors.length, gm: ge.errors.length });
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["player", player], ["gm", gm]]) {
    try { if (seat && actorIds.length) await run(seat, P.closeWindows, { ids: actorIds }); } catch (err) { console.error(`close windows (${label}):`, err?.message ?? err); }
  }
  if (gm && actorIds.length) {
    try { await run(gm, P.clearNamed, { ids: actorIds }); } catch (err) { console.error("clear named player:", err?.message ?? err); }
  }
  if (gm && playerId && flagBefore !== undefined) {
    try { note("the Player's legacy flag restored to its value before the run", await run(gm, P.setFlag, { userId: playerId, value: flagBefore })); } catch (err) { console.error("restore legacy flag:", err?.message ?? err); }
  }
  if (gm && made.length) {
    try { note("swept", await gm.sweepTracked({ only: made })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixtures kept: ${DEAD}, ${NEXT}, ${FOREIGN}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
