/**
 * Live walk, magic-spell-die: the damage prompt of a spell row that states no
 * die, its two saves and the Judge's offer card (docs/magic/TESTING.md, "A spell
 * damage row with no die"), walked on the GM and Player seats. The spells are
 * invented world spells on invented names and an invented definition id, each
 * with one damage row that states no roll; the dice the walk types are its own
 * (a flat figure and an invented formula), and no book word or printed figure is
 * in the script. The Player seat owns the first caster and not the second, so
 * the owner's save and the Judge's save are each a real seat's.
 *
 * Steps: the Player casts the first caster's copy of the no-throw spell, the
 * window opens with the character's-copy box, a word is refused on the window
 * and a flat figure is taken, the figure is kept on that copy alone and the
 * card rolls it; the next cast asks nothing; the Judge's seat holds the
 * whispered offer, drawn with its press, and pressing it writes the figure on
 * the source entry and the blank copy and leaves the copy that states a die as
 * it was; the Judge's own window offers the every-copy box and keeps on a ticked
 * press; a thrown row asks once at its first throw. The scene stage is isolated
 * (a failure there is its own failed check).
 *
 * Fixtures, kept and found by marker: `magic/spell-die-class`,
 * `magic/spell-die-caster` (a character the Player owns), `magic/spell-die-other`
 * (a character only the GM owns), `magic/spell-die-source` (a world spell with a
 * definition id), `magic/spell-die-mine` (the source's copy on the first
 * caster), `magic/spell-die-blank` and `magic/spell-die-has` (copies on the
 * second, the last stating a die), `magic/spell-die-thrown` (a thrown row on the
 * first caster), `magic/spell-die-scene`, `-foe`. Every run brings the kept dice
 * off all of them before its first check. The run's own cards are tracked by
 * uuid and swept alone. Shots of the whispered card are cropped to its body,
 * since its header prints user names. Machine values arrive through ./_env.mjs.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P, note, section, check, idOf, run, ready, ledgerFor, finish, summarize, stage,
  SAVE_TARGET, LEVEL, rowOf, spellFlag,
} from "./_magic-cast-kit.mjs";

const { browser, origin } = MACHINE;
const KEY = "magic-spell-die-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 900_000);
const COOKBOOK = "def.spell.qaspelldie";
/** The walk's own figures: a flat figure (the field takes what the row's roll field takes) and an invented formula. */
const FLAT = "7";
const FORMULA = "2d4+1";

let gm = null;
let player = null;
const ledger = ledgerFor(() => gm);
const W = {};
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** The one damage row every fixture spell carries, stating no die; `delivery` makes it a thrown row. */
const flagFor = (delivery, recur) => spellFlag({ rows: [rowOf("bolt", "damage", { roll: "", damage: ["fire"], ...(delivery ? { delivery } : {}), ...(recur ? { recur } : {}) })] });

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const D = {
  /** The helpers the walk's page functions share, put on the kit's own `__mck`. */
  install: async () => {
    const H = globalThis.__mck;
    H.dieWindow = () => [...document.querySelectorAll(".application")].find((a) => a.querySelector("[data-spell-die-error]")) ?? null;
    /** Drive the damage window: each attempt types an answer, sets the keep box and presses its one button. */
    H.driveDie = async (attempts) => {
      const win = await H.poll(() => H.dieWindow(), { tries: 80, every: 150 });
      if (!win) return { opened: false };
      const keep = win.querySelector('input[name="keep"]');
      const keepText = keep?.closest("label")?.textContent.trim() ?? "";
      const out = {
        opened: true,
        inScroll: win.classList.contains("acks-extras-scroll"),
        hasKeep: !!keep,
        keepIsCopy: keepText === game.i18n.localize("ACKS-MAGIC.spellDie.copyLabel"),
        keepIsAll: keepText === game.i18n.localize("ACKS-MAGIC.spellDie.allLabel"),
        hasHint: !!win.querySelector(".hint"),
        errorHiddenAtStart: win.querySelector("[data-spell-die-error]")?.hidden === true,
        attempts: [],
      };
      for (const a of attempts) {
        const input = win.querySelector('input[name="formula"]');
        input.value = a.answer;
        const box = win.querySelector('input[name="keep"]');
        if (box) { box.checked = !!a.tick; box.dispatchEvent(new Event("change", { bubbles: true })); }
        const face = win.querySelector('button[data-action="attack"] span')?.textContent.trim() ?? "";
        win.querySelector('button[data-action="attack"]').click();
        await H.sleep(500);
        const open = document.contains(win) && !!H.dieWindow();
        out.attempts.push({ stillOpen: open, errorShown: win.querySelector("[data-spell-die-error]")?.hidden === false, invalidMarked: win.querySelector('input[name="formula"]')?.getAttribute("aria-invalid") === "true", faceIsSave: face === game.i18n.localize("ACKS-MAGIC.spellDie.save") });
        if (!open) break;
      }
      return out;
    };
    return true;
  },
  /** Cast a spell as a user does, answer its damage window if it opens, and wait for the card. */
  castAsk: async ({ casterId, spellId, attempts, noWindowMs }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    item.use({ skipDialog: true });
    const found = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    document.querySelector('.application.acks-extras-cast button[data-action="cast"]').click();
    let win = { opened: false };
    if (noWindowMs) {
      await H.sleep(noWindowMs);
      win = { opened: !!H.dieWindow() };
    } else win = await H.driveDie(attempts);
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 80, every: 250 });
    const model = message ? game.messages.get(message.id).flags["acks-extras"].castCard : null;
    return { dialog: true, window: win, card: !!message, messageId: message?.id ?? null, rows: model?.rows ?? null, model };
  },
  /** The kept dice on each named item, by uuid, and the spell flag's own roll for each: strings only. */
  kept: async ({ uuids }) => Object.fromEntries(uuids.map((u) => { const i = fromUuidSync(u); return [u, { kept: i?.getFlag("acks-extras", "spellDie")?.bolt ?? null, roll: Array.from(i?.getFlag("acks-extras", "spell")?.effects ?? [])[0]?.roll ?? null }]; })),
  /** Bring every fixture spell to the shape a run starts from: no kept die, and the flag's own rows. */
  reset: async ({ items }) => {
    for (const { uuid, flag, roll } of items) {
      const i = fromUuidSync(uuid);
      await i.update({ "flags.acks-extras.-=spellDie": null, "flags.acks-extras.spell": { ...flag, effects: flag.effects.map((r) => ({ ...r, roll })) } });
    }
    return items.length;
  },
  /** The whispered offer cards on this seat, newest first, drawn: whether the press shows and what the result line says. */
  offers: async ({ since }) => {
    const H = globalThis.__mck;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(500);
    return [...game.messages].filter((m) => m.timestamp >= since && m.flags?.["acks-extras"]?.spellDieOffer).reverse().map((m) => {
      const el = document.querySelector(`[data-message-id="${m.id}"]`);
      const press = el?.querySelector("[data-spell-die-offer-save]");
      const result = el?.querySelector("[data-spell-die-offer-result]");
      return { id: m.id, uuid: m.uuid, die: m.flags["acks-extras"].spellDieOffer.die, whisperedToMe: m.whisper.includes(game.user.id), drawn: !!el, pressShown: !!press && !press.hidden, result: result && !result.hidden ? result.textContent.trim() : "" };
    });
  },
  /** Press an offer card's one control as the Judge does. */
  pressOffer: async ({ messageId }) => {
    const H = globalThis.__mck;
    const press = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"] [data-spell-die-offer-save]`), { tries: 40, every: 200 });
    if (!press || press.hidden) return { pressed: false };
    press.click();
    await H.sleep(1500);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    return { pressed: true, pressHidden: el.querySelector("[data-spell-die-offer-save]").hidden, result: el.querySelector("[data-spell-die-offer-result]").textContent.trim() };
  },
  /** The lock state of the compendium that holds the world's importer shelf of Items, by label: a boolean or null where none exists. */
  shelfLock: async () => {
    const pack = game.packs.find((p) => p.documentName === "Item" && /Cookbook/.test(p.metadata.label));
    return pack ? { found: true, locked: !!pack.locked } : { found: false, locked: null };
  },
};

/* ---------------------------- setup ---------------------------------- */
async function stageSetup() {
  W.playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!W.playerId) throw new Error("no Player user on this world");
  const cls = await gm.fixture("magic/spell-die-class", "Item", { name: "QA Die Class", type: "acks-extras.class", system: { key: "qadieclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 9 }] }] } });
  const a = await gm.fixture("magic/spell-die-caster", "Actor", { name: "QA Die Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.playerId]: 3 } });
  const b = await gm.fixture("magic/spell-die-other", "Actor", { name: "QA Die Other", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0 } });
  W.caster = { a: idOf(a), b: idOf(b) };
  const source = await gm.fixture("magic/spell-die-source", "Item", { name: "QA Die Spell", type: "spell", system: { lvl: 1 }, flags: { "acks-extras": { cookbook: { id: COOKBOOK } } } });
  const mine = await gm.fixture("magic/spell-die-mine", "Item", { name: "QA Die Spell", type: "spell", system: { lvl: 1 }, flags: { "acks-extras": { cookbook: { id: COOKBOOK } } } }, { parent: a.uuid });
  const blank = await gm.fixture("magic/spell-die-blank", "Item", { name: "QA Die Spell", type: "spell", system: { lvl: 1 }, flags: { "acks-extras": { cookbook: { id: COOKBOOK } } } }, { parent: b.uuid });
  const has = await gm.fixture("magic/spell-die-has", "Item", { name: "QA Die Spell", type: "spell", system: { lvl: 1 }, flags: { "acks-extras": { cookbook: { id: COOKBOOK } } } }, { parent: b.uuid });
  const thrown = await gm.fixture("magic/spell-die-thrown", "Item", { name: "QA Die Thrown", type: "spell", system: { lvl: 1 }, flags: { "acks-extras": { cookbook: { id: `${COOKBOOK}.thrown` } } } }, { parent: a.uuid });
  const recur = await gm.fixture("magic/spell-die-recur", "Item", { name: "QA Die Recurring", type: "spell", system: { lvl: 1 }, flags: { "acks-extras": { cookbook: { id: `${COOKBOOK}.recur` } } } }, { parent: a.uuid });
  W.item = { source: source.uuid, mine: mine.uuid, blank: blank.uuid, has: has.uuid, thrown: thrown.uuid, recur: recur.uuid };
  W.id = { mine: idOf(mine), thrown: idOf(thrown), blank: idOf(blank), has: idOf(has), recur: idOf(recur) };
  for (const who of ["a", "b"]) await run(gm, P.shapeCaster, { casterId: W.caster[who], classUuid: cls.uuid, level: LEVEL, alignment: "Lawful" });
  await run(gm, D.install);
  await run(player, D.install);
  const reset = await run(gm, D.reset, {
    items: [
      { uuid: W.item.source, flag: flagFor(), roll: "" }, { uuid: W.item.mine, flag: flagFor(), roll: "" },
      { uuid: W.item.blank, flag: flagFor(), roll: "" }, { uuid: W.item.has, flag: flagFor(), roll: "1d8" },
      { uuid: W.item.thrown, flag: flagFor("missile"), roll: "" }, { uuid: W.item.recur, flag: flagFor(null, "laterRounds"), roll: "" },
    ],
  });
  check("setup: the six spells carry one damage row each, and none a kept die", reset === 6);
}

/** The kept die and the flag's own roll of each fixture spell, read on the GM seat. */
const keptNow = () => run(gm, D.kept, { uuids: Object.values(W.item) });

/* ---------------------------- the owner's save ----------------------- */
async function stageOwner() {
  const since = Date.now();
  W.since = since;
  const c = await run(player, D.castAsk, { casterId: W.caster.a, spellId: W.id.mine, attempts: [{ answer: "a lot", tick: true }, { answer: FLAT, tick: true }] });
  if (c.messageId) await ledger.track(`ChatMessage.${c.messageId}`, "ChatMessage");
  if (c.model?.castId) ledger.castIds.push(c.model.castId);
  check("owner: a spell row that states no die opens a window, in the scroll contract, with a hint and the character's-copy box", c.window?.opened && c.window.inScroll && c.window.hasHint && c.window.hasKeep && c.window.keepIsCopy && !c.window.keepIsAll && c.window.errorHiddenAtStart, { opened: c.window?.opened, scroll: c.window?.inScroll, keep: [c.window?.keepIsCopy, c.window?.keepIsAll] });
  check("owner: a word is refused on the window, which stays open and marks the field; ticking the box turns the button to Save and attack", !!c.window?.attempts?.[0]?.stillOpen && !!c.window.attempts[0].errorShown && !!c.window.attempts[0].invalidMarked && !!c.window.attempts[0].faceIsSave, c.window?.attempts?.[0]);
  check("owner: a flat figure is taken, the window closes and the card rolls it", c.window?.attempts?.[1] && !c.window.attempts[1].stillOpen && c.card && Number(c.rows?.bolt?.total) === Number(FLAT), { attempt: c.window?.attempts?.[1], rolled: c.rows?.bolt?.total === Number(FLAT) });
  const k = await keptNow();
  check("owner: the figure is kept on that copy alone, and the source and the other copies are as they were", k[W.item.mine].kept === FLAT && k[W.item.source].kept === null && k[W.item.blank].kept === null && k[W.item.has].kept === null, Object.fromEntries(Object.entries(k).map(([u, v]) => [u.split(".").pop(), v.kept])));
  const again = await run(player, D.castAsk, { casterId: W.caster.a, spellId: W.id.mine, noWindowMs: 2500 });
  if (again.messageId) await ledger.track(`ChatMessage.${again.messageId}`, "ChatMessage");
  if (again.model?.castId) ledger.castIds.push(again.model.castId);
  check("owner: the next cast opens no window and rolls the kept figure", again.dialog && !again.window.opened && again.card && Number(again.rows?.bolt?.total) === Number(FLAT), { opened: again.window?.opened, total: again.rows?.bolt?.total });
  await run(gm, P.setSpent, { casterId: W.caster.a });
}

/* ---------------------------- the forwarded offer --------------------- */
async function stageOffer() {
  const offers = await run(gm, D.offers, { since: W.since });
  const o = offers.find((x) => x.die === FLAT);
  if (o?.id) await ledger.track(`ChatMessage.${o.id}`, "ChatMessage");
  check("offer: the Judge's seat holds the whispered card, drawn with its press", !!o && o.whisperedToMe && o.drawn && o.pressShown, o);
  const seen = await run(player, D.offers, { since: W.since });
  check("offer: the Player seat is not shown the card", !seen.some((x) => x.drawn), seen.map((x) => ({ drawn: x.drawn })));
  const lock = await run(gm, D.shelfLock);
  note("importer shelf of Items", lock);
  const pressed = await run(gm, D.pressOffer, { messageId: o?.id });
  check("offer: pressing it hides the press and says what was written", pressed.pressed && pressed.pressHidden && pressed.result.length > 0, pressed);
  const k = await keptNow();
  check("offer: the figure is now on the source entry and the blank copy, and the copy that states a die is as it was", k[W.item.source].kept === FLAT && k[W.item.blank].kept === FLAT && k[W.item.has].kept === null && k[W.item.has].roll === "1d8", Object.fromEntries(Object.entries(k).map(([u, v]) => [u.split(".").pop(), v.kept])));
}

/* ---------------------------- the Judge's own window ------------------ */
async function stageJudge() {
  await run(gm, D.reset, { items: [{ uuid: W.item.source, flag: flagFor(), roll: "" }, { uuid: W.item.mine, flag: flagFor(), roll: "" }, { uuid: W.item.blank, flag: flagFor(), roll: "" }, { uuid: W.item.has, flag: flagFor(), roll: "1d8" }] });
  await run(gm, P.setSpent, { casterId: W.caster.b });
  const c = await run(gm, D.castAsk, { casterId: W.caster.b, spellId: W.id.blank, attempts: [{ answer: FORMULA, tick: true }] });
  if (c.messageId) await ledger.track(`ChatMessage.${c.messageId}`, "ChatMessage");
  if (c.model?.castId) ledger.castIds.push(c.model.castId);
  check("judge: the Judge's window offers the every-copy box, and a ticked press closes it and rolls a formula", c.window?.opened && c.window.keepIsAll && !c.window.keepIsCopy && c.window.attempts?.[0] && !c.window.attempts[0].stillOpen && c.card && Number.isFinite(c.rows?.bolt?.total), { keep: [c.window?.keepIsAll, c.window?.keepIsCopy], total: c.rows?.bolt?.total });
  const k = await keptNow();
  check("judge: the formula is on the entry and on each blank copy, and the copy that states a die keeps it", k[W.item.source].kept === FORMULA && k[W.item.mine].kept === FORMULA && k[W.item.blank].kept === FORMULA && k[W.item.has].kept === null && k[W.item.has].roll === "1d8", Object.fromEntries(Object.entries(k).map(([u, v]) => [u.split(".").pop(), v.kept])));
  const again = await run(gm, D.castAsk, { casterId: W.caster.b, spellId: W.id.has, noWindowMs: 2500 });
  if (again.messageId) await ledger.track(`ChatMessage.${again.messageId}`, "ChatMessage");
  if (again.model?.castId) ledger.castIds.push(again.model.castId);
  check("judge: a copy that states a die casts with no window", again.dialog && !again.window.opened && again.card, { opened: again.window?.opened });
}

/* ---------------------------- a thrown row ---------------------------- */
async function stageThrown() {
  const scene = await gm.fixture("magic/spell-die-scene", "Scene", { name: "QA Die Field", active: false, navigation: true, width: 1000, height: 700, padding: 0, backgroundColor: "#55606b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  const foe = await gm.fixture("magic/spell-die-foe", "Actor", { name: "QA Die Foe", type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
  W.scene = idOf(scene);
  await run(gm, P.shapeMonster, { actorId: idOf(foe), hp: 40, hd: 2, kinds: [], saveTarget: SAVE_TARGET });
  check("thrown: both seats view the field", (await run(player, P.view, { sceneId: W.scene })) && (await run(gm, P.view, { sceneId: W.scene })));
  const made = await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: W.caster.a, name: "Die Caster", x: 100, y: 200, disposition: 1 }, { actorId: idOf(foe), name: "Die Foe", x: 400, y: 200 }] });
  for (const t of made) await ledger.track(t.uuid, "Token");
  const foeTok = made.find((t) => t.actorId === idOf(foe));
  await run(gm, D.reset, { items: [{ uuid: W.item.thrown, flag: flagFor("missile"), roll: "" }] });
  await run(gm, P.setSpent, { casterId: W.caster.a });
  const got = await run(player, P.target, { sceneId: W.scene, tokenIds: [foeTok.id] });
  check("thrown: the Player seat targets the foe", Array.isArray(got) && got.length === 1, got);
  const c = await run(player, P.cast, { casterId: W.caster.a, spellId: W.id.thrown });
  if (c.model?.castId) ledger.castIds.push(c.model.castId);
  if (c.messageId) await ledger.track(`ChatMessage.${c.messageId}`, "ChatMessage");
  const opened = await run(player, D.dieOpen);
  check("thrown: a thrown row posts its card with no window open, since its die is asked at the throw", c.card && !opened, { card: c.card, opened });
  const entry = Object.keys(c.model?.targets ?? {})[0];
  const row = c.model?.order?.[0] ?? "bolt";
  const press = await run(player, D.pressThrow, { messageId: c.messageId, target: entry, row });
  const win = await run(player, D.drive, { attempts: [{ answer: FLAT, tick: true }] });
  check("thrown: pressing Throw opens one damage window, which takes the figure and closes", press.pressed && win.opened && win.attempts?.[0] && !win.attempts[0].stillOpen, { pressed: press.pressed, opened: win.opened });
  const k = await keptNow();
  check("thrown: the figure is kept on the character's copy of the thrown spell", k[W.item.thrown].kept === FLAT, k[W.item.thrown]);
}
D.dieOpen = async () => !!globalThis.__mck.dieWindow();

/* ---------------------------- a recurring row ------------------------- */
async function stageRecur() {
  await run(gm, P.setSpent, { casterId: W.caster.a });
  const c = await run(player, D.castAsk, { casterId: W.caster.a, spellId: W.id.recur, attempts: [{ answer: FORMULA, tick: false }] });
  if (c.messageId) await ledger.track(`ChatMessage.${c.messageId}`, "ChatMessage");
  if (c.model?.castId) ledger.castIds.push(c.model.castId);
  check("recur: a recurring damage row that states no die opens the window at the cast and takes a formula", c.window?.opened && c.window.attempts?.[0] && !c.window.attempts[0].stillOpen && c.card, { opened: c.window?.opened });
  check("recur: the card carries the typed formula for the row, and the cast rolled nothing for it", c.model?.dice?.bolt === FORMULA && !c.model?.rows?.bolt, { dice: c.model?.dice, row: !!c.model?.rows?.bolt });
  const k = await keptNow();
  check("recur: nothing is kept on any copy, since the box was not ticked", Object.values(k).every((v) => v.kept === null || v.kept === FLAT || v.kept === FORMULA) && k[W.item.recur].kept === null, k[W.item.recur]);
}
D.pressThrow = async ({ messageId, target, row }) => {
  const H = globalThis.__mck;
  try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
  await H.sleep(400);
  const button = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"] [data-action="magicCastThrow"][data-target="${target}"][data-row="${row}"]`), { tries: 40, every: 200 });
  if (!button) return { pressed: false };
  button.click();
  return { pressed: true };
};
D.drive = async ({ attempts }) => globalThis.__mck.driveDie(attempts);

/* ---------------------------- run ------------------------------------ */
try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  if (!installed.isGM || seated.isGM) blocked("a seat did not join as the walk's own role");

  await stage("A. setup", stageSetup);
  if (W.item) {
    await stage("B. the owner's save on the character's copy", stageOwner);
    await stage("C. the forwarded offer and the Judge's press", stageOffer);
    await stage("D. the Judge's own window", stageJudge);
    await stage("E. a thrown row", stageThrown);
    await stage("F. a recurring row", stageRecur);
  }
  section("console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, P.drain);
    check(`${label}: no console error was recorded since the seat was installed`, d.errors.length === 0, d.errors.slice(0, 3));
  }
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    check("walk ran to the end", false);
  }
} finally {
  await finish({ gm, player, ledger, fixtureRe: "^magic/spell-die-", restore: P.restore });
  console.log("fixtures kept: magic/spell-die-class, -caster, -other, -source, -mine, -blank, -has, -thrown, -recur, -scene, -foe");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
