/**
 * Live walk, magic-power-ledger: the power ledger and its chip on the casting
 * strip (`scripts/magic/power-ledger*.mjs`, `scripts/classes/power-chip.mjs`).
 * Walks docs/magic/TESTING.md "The power ledger" on the GM seat and a Player
 * seat, and its section numbers are the recipe's step numbers: a gain through
 * the API stamped with the world's calendar day; the chip (a tag and a
 * disclosure per power, the panels closed, then opened); Add, Remove and Undo
 * through the panel with a typed amount, a press by hand folding into the last
 * entry and Undo refused on a gain partly spent; the arcane count; a Player who
 * owns the character reading every control and using each of them (a hand's
 * gain, an Undo, the count and a gain that stays all follow Foundry's ownership,
 * and no press by a Player folds into a Judge's entry); a Player who owns
 * nothing reading the tag and the rows and no control, and refused `owner` on
 * every call; expiry by the calendar day against a lifetime in the registry,
 * nothing expiring with none; the Fades / Stays switch, a lot that stays outliving
 * a backdated lifetime, a Remove on Fades drawing the fading lot first and on
 * Stays removing a point that stays; what a window keeps across the render each
 * write causes (the switch, which panels are open, the typed amount) and a second
 * window starting from nothing; and a bucket's power row capped by the balance.
 *
 * The lifetime is the registry's `divineLifetime` through its override layer
 * (invented, three days), so the walk needs no import and sets nothing a Judge
 * did not; a table another hand already overrode blocks the walk. Time is not
 * moved: the clock is shared by every seat, so an entry's day is written in the
 * past (the day a lot would have been gained) and the balance reads the clock as
 * it stands. Prints counts and booleans only; the seats' user ids are read in
 * page context at run time and compared there or here, never written down.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `magic/power-class` (a casting class), `magic/power-hero` (a linked character
 * the Player owns, bound to the class) and `magic/power-stranger` (a character
 * the Player may only observe). Their ledgers are cleared at the start and at the
 * end; the run's override is cleared in the finally. Nothing else is made.
 */
import { connect } from "./_driver.mjs";
import { seats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";

const M = seats();
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};
const section = (t) => console.log(`\n== ${t} ==`);

let gm;
let player;
let overrode = false;

/**
 * The page helpers every step shares, for the character at `uuid`. A power's panel
 * is opened by its disclosure first, as a user would; the amount is typed by
 * setting the box's value and sending `input`, which the chip keeps per window;
 * a write re-renders the strip, so every helper looks it up again.
 */
const kit = (uuid, otherUuid = "") => `
  const U = ${JSON.stringify(uuid)};
  const V = ${JSON.stringify(otherUuid)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, n = 60) => { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const actor = () => fromUuidSync(U);
  const power = () => acksExtras.magic.power;
  const flag = () => actor().flags?.["acks-extras"]?.power ?? {};
  const entries = (kind) => flag()[kind]?.entries ?? [];
  const writes = () => globalThis.__pl?.updates ?? 0;
  const strip = () => actor().sheet.element?.querySelector(".acks-extras-classes-strip");
  const tag = (kind) => strip()?.querySelector('[data-power="' + kind + '"]');
  const shown = (kind) => { const n = Number(tag(kind)?.querySelector(".acks-nums")?.textContent); return Number.isFinite(n) ? n : null; };
  const toggle = (kind) => strip()?.querySelector('[data-power-toggle][data-power-kind="' + kind + '"]');
  const panel = (kind) => strip()?.querySelector('[data-power-panel="' + kind + '"]');
  const amountBox = (kind) => panel(kind)?.querySelector('[data-power-amount][data-power-kind="' + kind + '"]');
  const rows = () => [...(strip()?.querySelectorAll(".acks-extras-classes-powerrow") ?? [])];
  const rowsOf = (kind) => [...(panel(kind)?.querySelectorAll(".acks-extras-classes-powerrow") ?? [])];
  const openSheet = async () => {
    const a = actor();
    await a.sheet.render({ force: true });
    await until(() => a.sheet.element?.isConnected);
    try { a.sheet.changeTab?.("magic", "primary"); } catch { /* a sheet with no Magic tab keeps the tab it opened on */ }
    await until(() => strip());
    await sleep(300);
    return a.sheet;
  };
  const closeSheet = async () => { await actor()?.sheet?.close({ animate: false }); };
  const openPanel = async (kind) => { if (panel(kind)?.hidden) { toggle(kind).click(); await sleep(150); } };
  const typeAmount = (kind, n) => { const box = amountBox(kind); box.value = String(n); box.dispatchEvent(new Event("input", { bubbles: true })); };
  const adjust = async (kind, sign) => { panel(kind).querySelector('[data-power-adjust="' + sign + '"][data-power-kind="' + kind + '"]').click(); await sleep(800); };
  const press = async (selector) => { strip().querySelector(selector).click(); await sleep(800); };
  const day = async () => (await import("/modules/acks-extras/scripts/lib/world-time.mjs")).dayOfWorldTime(game.time.worldTime);
`;
const run = (seat, uuid, body, other = "") => seat.eval(`(async () => { ${kit(uuid, other)} ${body} })()`);

/** Override or clear the registry's divine lifetime through the Ruledata Browser's own store. */
const lifetimeKit = `
  const STORE = await import("/modules/acks-extras/scripts/location/table-store.mjs");
  const D = "magicResearch";
  const poll = async (test) => { for (let i = 0; i < 80; i++) { if (test()) return true; await new Promise((r) => setTimeout(r, 100)); } return !!test(); };
  const read = () => acksExtras.magic.power.lifetimes(fromUuidSync(U)).divine;
`;

try {
  gm = await connect({ browser: M.browser, origin: M.origin, user: M.gm, port: PORTS.gm, own: M.own });
  player = await connect({ browser: M.browser, origin: M.origin, user: M.player, port: PORTS.player, own: M.own });

  section("Boot");
  const seated = await gm.eval(`({ gm: game.user.isGM, id: game.user.id, active: game.users.activeGM?.isSelf === true, power: typeof acksExtras?.magic?.power?.gain === "function" })`);
  const playerSeat = await player.eval(`({ gm: game.user.isGM, id: game.user.id, power: typeof acksExtras?.magic?.power?.gain === "function" })`);
  if (!seated.gm || !seated.active) blocked("the first seat is not the active GM");
  if (playerSeat.gm) blocked("the second seat is a GM, so a Player's seat cannot be walked");
  check("the ledger's API is on both seats", seated.power && playerSeat.power);
  if (seated.id === playerSeat.id) blocked("both seats are the same user, so a fold and a refusal cannot be told apart");
  const taken = await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); return S.hasOverride("magicResearch", "divineLifetime"); })()`);
  if (taken) blocked("the divine lifetime is already overridden by another hand");

  section("Fixtures");
  // The Player's id keys the hero's ownership; it is read from the seat just now and printed nowhere, and an entry's `user` is compared with `game.user.id` in the page of the seat that wrote it.
  const playerId = playerSeat.id;
  const cls = await gm.fixture("magic/power-class", "Item", { name: "QA Power Class", type: "acks-extras.class", system: { key: "qapowerclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 2 }] }] } });
  const hero = await gm.fixture(
    "magic/power-hero",
    "Actor",
    { name: "QA Power Hero", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 } }, flags: { "acks-extras": { classes: { uuid: cls.uuid } } }, ownership: { default: 0, [playerId]: 3 } },
  );
  const stranger = await gm.fixture("magic/power-stranger", "Actor", { name: "QA Power Stranger", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 } }, ownership: { default: 2 } });
  const U = hero.uuid;
  const S = stranger.uuid;
  // A step that needs a known shape asserts it at its start: a kept fixture carries whatever the last walk left.
  const clear = `await Promise.all([actor(), fromUuidSync(V)].map((a) => a.update({ "flags.acks-extras.-=power": null }))); await sleep(300); return [actor(), fromUuidSync(V)].map((a) => !!a.flags?.["acks-extras"]?.power);`;
  // The chip's record lives on the open sheet window until it closes, so a run that died mid-section starts from a closed one.
  await run(gm, U, `await closeSheet();`);
  await run(player, U, `await closeSheet();`);
  await run(player, S, `await closeSheet();`);
  const cleared = await run(gm, U, clear, S);
  check("both fixtures start with no ledger", cleared.every((held) => held === false), cleared);
  await gm.eval(`globalThis.__pl = { updates: 0, hook: Hooks.on("updateActor", (a) => { if (a.uuid === ${JSON.stringify(U)} || a.uuid === ${JSON.stringify(S)}) __pl.updates++; }) }`);
  const updates = () => gm.eval(`__pl.updates`);

  section("1. a gain is stamped with the calendar day and the user's id");
  const g1 = await run(gm, U, `
    const today = await day();
    const result = await power().gain(actor(), "divine", { amount: 8, name: "QA Sacrifice source", ref: "qa-cast-1" });
    await sleep(500);
    const e = entries("divine")[0] ?? {};
    return { result, stamp: e.day === today, today: Number.isInteger(today), by: e.by, mine: e.user === game.user.id, balance: power().balance(actor(), "divine"), entries: entries("divine").length };`);
  check("the gain answered ok with the balance, one entry stamped with the day the world clock is in, not by hand, carrying the id of the seat that wrote it", g1.result.ok && g1.result.balance === 8 && g1.balance === 8 && g1.entries === 1 && g1.today && g1.stamp && g1.by === "" && g1.mine === true, g1);

  section("2. the chip: a tag and a disclosure per power, the panels closed, then opened");
  const w2 = await updates();
  const c1 = await run(gm, U, `
    await openSheet();
    const before = strip();
    const win = actor().sheet.id;
    const tip = tag("divine")?.getAttribute("data-tooltip-text") ?? "";
    const kinds = ["divine", "arcane"];
    const toggles = kinds.map((k) => ({ expanded: toggle(k)?.getAttribute("aria-expanded"), controls: toggle(k)?.getAttribute("aria-controls"), named: (toggle(k)?.getAttribute("aria-label") ?? "").length > 0 }));
    const panels = kinds.map((k) => ({ hidden: panel(k)?.hidden === true, id: panel(k)?.id }));
    const ids = [...strip().querySelectorAll("[id]")].map((e) => e.id);
    const closed = { divine: shown("divine"), arcane: shown("arcane"), toggles, panels, ids, foreign: ids.filter((id) => !id.startsWith(win + "-")).length, tipHasEntry: tip.includes("QA Sacrifice source") && tip.includes("+8"), tipHasPage: /\\bRR\\b/.test(tip) };
    await openPanel("divine");
    const row = rowsOf("divine")[0];
    const opened = {
      same: strip() === before,
      divineHidden: panel("divine")?.hidden, arcaneHidden: panel("arcane")?.hidden,
      expanded: toggle("divine")?.getAttribute("aria-expanded"), arcaneExpanded: toggle("arcane")?.getAttribute("aria-expanded"),
      groups: panel("divine").querySelectorAll('[role="group"].acks-extras-classes-powerstay').length,
      pressed: [...panel("divine").querySelectorAll("[data-power-stay]")].map((p) => p.getAttribute("aria-pressed")),
      amount: amountBox("divine")?.value,
      add: panel("divine").querySelectorAll('[data-power-adjust="1"]').length, remove: panel("divine").querySelectorAll('[data-power-adjust="-1"]').length,
      counts: panel("divine").querySelectorAll("[data-power-count]").length,
      rows: rowsOf("divine").length, rowName: row?.querySelector(".acks-extras-classes-powername")?.textContent.trim(),
      art: !!row?.querySelector(".acks-extras-classes-powerart img, .acks-extras-classes-powerart i"),
      rowTip: row?.querySelector(".acks-extras-classes-powerfig")?.getAttribute("data-tooltip-text") ?? "",
    };
    await openPanel("arcane");
    const arcane = { hidden: panel("arcane")?.hidden, counts: panel("arcane").querySelectorAll("[data-power-count]").length, divineCounts: panel("divine").querySelectorAll("[data-power-count]").length, amount: amountBox("arcane")?.value };
    return { closed, opened, arcane, wrote: writes() - ${w2} };`);
  check("the Judge's strip draws both tags, the balance on the divine one, and a disclosure beside each reading closed with both panels hidden", c1.closed.divine === 8 && c1.closed.arcane === 0 && c1.closed.toggles.every((t) => t.expanded === "false" && t.named) && c1.closed.panels.every((p) => p.hidden === true), c1.closed);
  check("the tooltip lists the entry with its sign and the page, and the only ids on the strip are the two panels', each starting with the window's own id and named by its disclosure's aria-controls (ids minted by lib's a11y binder start with it too)", c1.closed.tipHasEntry && c1.closed.tipHasPage && c1.closed.foreign === 0 && c1.closed.panels.every((p, i) => typeof p.id === "string" && p.id.length > 0 && p.id === c1.closed.toggles[i].controls && c1.closed.ids.includes(p.id)), c1.closed);
  check("opening the divine panel shows it and only it, with nothing written and nothing re-rendered", c1.opened.same && c1.opened.divineHidden === false && c1.opened.expanded === "true" && c1.opened.arcaneHidden === true && c1.opened.arcaneExpanded === "false" && c1.wrote === 0, { ...c1.opened, wrote: c1.wrote });
  check("the divine panel carries the Fades / Stays group with Fades pressed, an amount box reading 1, Add, Remove, no count box, and one row for the entry with its name, art and a tooltip", c1.opened.groups === 1 && c1.opened.pressed[0] === "true" && c1.opened.pressed[1] === "false" && c1.opened.amount === "1" && c1.opened.add === 1 && c1.opened.remove === 1 && c1.opened.counts === 0 && c1.opened.rows === 1 && c1.opened.rowName === "QA Sacrifice source" && c1.opened.art && c1.opened.rowTip.includes("QA Sacrifice source") && c1.opened.rowTip.includes("+8"), c1.opened);
  check("opening the arcane panel shows the count box, and only there", c1.arcane.hidden === false && c1.arcane.counts === 1 && c1.arcane.divineCounts === 0 && c1.arcane.amount === "1", c1.arcane);

  section("3. Add, Remove and Undo through the panel, with a typed amount");
  const d1 = await run(gm, U, `
    await actor().update({ "flags.acks-extras.-=power": null });
    await sleep(400);
    await openSheet();
    await openPanel("divine");
    const start = entries("divine").length;
    const out = { start };
    let was = strip();
    let w = writes();
    typeAmount("divine", 2);
    await adjust("divine", 1);
    const first = entries("divine");
    out.add = { n: first.length, amount: first[0]?.amount, by: first[0]?.by, mine: first[0]?.user === game.user.id, writes: writes() - w, fresh: strip() !== was, open: panel("divine")?.hidden === false, typed: amountBox("divine")?.value, shown: shown("divine") };
    const gainId = first[0]?.id;
    was = strip();
    w = writes();
    await adjust("divine", 1);
    const folded = entries("divine");
    out.fold = { n: folded.length, sameId: folded[0]?.id === gainId, amount: folded[0]?.amount, writes: writes() - w, fresh: strip() !== was, open: panel("divine")?.hidden === false, typed: amountBox("divine")?.value, shown: shown("divine") };
    typeAmount("divine", 1);
    w = writes();
    await adjust("divine", -1);
    await adjust("divine", -1);
    const spent = entries("divine");
    out.remove = { n: spent.length, spends: spent.filter((e) => e.amount < 0).length, amount: spent.at(-1)?.amount, by: spent.at(-1)?.by, mine: spent.at(-1)?.user === game.user.id, writes: writes() - w, shown: shown("divine"), api: power().balance(actor(), "divine"), open: panel("divine")?.hidden === false, typed: amountBox("divine")?.value };
    const spendId = spent.at(-1)?.id;
    const undoButton = (id) => panel("divine")?.querySelector('[data-power-undo="' + id + '"]');
    w = writes();
    out.undoCount = panel("divine").querySelectorAll("[data-power-undo]").length;
    undoButton(spendId).click();
    await sleep(800);
    out.undoSpend = { gone: !entries("divine").some((e) => e.id === spendId), n: entries("divine").length, shown: shown("divine"), api: power().balance(actor(), "divine"), writes: writes() - w };
    await adjust("divine", -1);
    const partial = entries("divine");
    const gainRow = () => rowsOf("divine").find((r) => !r.querySelector(".is-spent"));
    const spentId = partial.at(-1)?.id;
    w = writes();
    const viaApi = await power().undo(actor(), "divine", gainId);
    await sleep(500);
    out.refused = { n: partial.length, line: !!gainRow()?.querySelector(".acks-extras-classes-powerline.is-refused"), lineText: (gainRow()?.querySelector(".is-refused")?.textContent ?? "").trim().length > 0, gainUndo: !!gainRow()?.querySelector("[data-power-undo]"), buttons: panel("divine").querySelectorAll("[data-power-undo]").length, viaApi, unchanged: entries("divine").length === partial.length, writes: writes() - w };
    undoButton(spentId).click();
    await sleep(800);
    out.afterSpend = { n: entries("divine").length, line: !!gainRow()?.querySelector(".is-refused"), gainUndo: !!gainRow()?.querySelector("[data-power-undo]"), shown: shown("divine") };
    undoButton(gainId).click();
    await sleep(800);
    out.afterGain = { n: entries("divine").length, shown: shown("divine"), api: power().balance(actor(), "divine"), rows: rowsOf("divine").length };
    await openPanel("arcane");
    w = writes();
    await adjust("arcane", -1);
    out.none = { entries: entries("arcane").length, shown: shown("arcane"), writes: writes() - w };
    return out;`);
  check("with 2 typed, Add wrote one entry of +2 by hand carrying the seat's user id, in one write; the panel is still open and the box still reads 2 after the strip was drawn anew", d1.start === 0 && d1.add.n === 1 && d1.add.amount === 2 && d1.add.by === "judge" && d1.add.mine === true && d1.add.writes === 1 && d1.add.fresh && d1.add.open && d1.add.typed === "2" && d1.add.shown === 2, d1.add);
  check("Add again folded into the same entry, now +4, in one write, the panel open and the box still 2", d1.fold.n === 1 && d1.fold.sameId && d1.fold.amount === 4 && d1.fold.writes === 1 && d1.fold.fresh && d1.fold.open && d1.fold.typed === "2" && d1.fold.shown === 4, d1.fold);
  check("with 1 typed, Remove twice wrote one spend entry of -2 by hand (the second press folded), two writes, and the face and the API agree", d1.remove.n === 2 && d1.remove.spends === 1 && d1.remove.amount === -2 && d1.remove.by === "judge" && d1.remove.mine === true && d1.remove.writes === 2 && d1.remove.shown === 2 && d1.remove.api === 2 && d1.remove.open && d1.remove.typed === "1", d1.remove);
  check("with the gain partly spent by the folded spend, the spend's is the one Undo on the panel; Undo on it took the whole entry back, in one write, and the face and the API agree", d1.undoCount === 1 &&d1.undoSpend.gone && d1.undoSpend.n === 1 && d1.undoSpend.shown === 4 && d1.undoSpend.api === 4 && d1.undoSpend.writes === 1, { count: d1.undoCount, ...d1.undoSpend });
  check("with a point of the gain spent, its row carries the refusal line and no Undo (the one Undo left is the spend's), and undo of its id through the API answers `spent` and writes nothing", d1.refused.n === 2 && d1.refused.line && d1.refused.lineText && !d1.refused.gainUndo && d1.refused.buttons === 1 && d1.refused.viaApi.ok === false && d1.refused.viaApi.reason === "spent" && d1.refused.unchanged && d1.refused.writes === 0, d1.refused);
  check("with that spend undone the gain's row loses the line and takes its Undo, and Undo on the gain takes it back: no entry is left and the face reads nothing", d1.afterSpend.n === 1 && !d1.afterSpend.line && d1.afterSpend.gainUndo && d1.afterGain.n === 0 && d1.afterGain.shown === 0 && d1.afterGain.api === 0 && d1.afterGain.rows === 0, { afterSpend: d1.afterSpend, afterGain: d1.afterGain });
  check("a Remove on a power with none held writes no entry and leaves the face at nothing", d1.none.entries === 0 && d1.none.shown === 0 && d1.none.writes === 0, d1.none);

  section("4. the arcane count is a field of the arcane panel, blank until set");
  const k1 = await run(gm, U, `
    await openSheet();
    await openPanel("arcane");
    const boxes = strip().querySelectorAll("[data-power-count]").length;
    const box = panel("arcane").querySelector("[data-power-count]");
    const blank = box.value === "";
    const tip = box.getAttribute("data-tooltip-text") ?? "";
    box.value = "4";
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(800);
    const set = flag().arcane?.count;
    const kept = entries("arcane").length;
    const open = panel("arcane")?.hidden === false;
    const box2 = panel("arcane").querySelector("[data-power-count]");
    const shownBack = box2.value;
    box2.value = "";
    box2.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(800);
    return { boxes, blank, tipPage: /\\bRR\\b/.test(tip), set, kept, open, shownBack, cleared: flag().arcane?.count ?? null };`);
  check("the one box starts blank with the page reference in its tooltip, writes the count on change and leaves the entries, shows it again after the render with its panel open, and blanks again", k1.boxes === 1 && k1.blank && k1.tipPage && k1.set === 4 && k1.kept === 0 && k1.open && k1.shownBack === "4" && k1.cleared === null, k1);

  section("5. a Player who owns the character reads every control and uses each of them");
  const seed = await run(gm, U, `
    await actor().update({ "flags.acks-extras.-=power": null });
    await sleep(400);
    const base = await power().gain(actor(), "divine", { amount: 5, name: "QA Sacrifice source", ref: "qa-cast-1" });
    const hand = await power().gain(actor(), "divine", { amount: 1, by: "judge" });
    await sleep(500);
    const e = entries("divine");
    return { ok: base.ok && hand.ok, n: e.length, handBy: e[1]?.by, handMine: e[1]?.user === game.user.id, balance: power().balance(actor(), "divine") };`);
  check("the GM seat holds a plain gain of 5 and a gain of 1 by hand, two entries, the balance 6", seed.ok && seed.n === 2 && seed.handBy === "judge" && seed.handMine === true && seed.balance === 6, seed);
  const o1 = await run(player, U, `
    await until(() => entries("divine").length === 2, 50);
    await openSheet();
    await openPanel("divine");
    const count = (sel) => strip().querySelectorAll(sel).length;
    return {
      isGM: game.user.isGM, isOwner: actor().isOwner, canWrite: actor().canUserModify(game.user, "update"),
      divine: shown("divine"), arcane: shown("arcane"), toggles: count("[data-power-toggle]"), open: panel("divine")?.hidden === false,
      groups: count('[role="group"]'), amounts: count("[data-power-amount]"), adds: count('[data-power-adjust="1"]'), removes: count('[data-power-adjust="-1"]'), counts: count("[data-power-count]"),
      undos: count("[data-power-undo]"), rows: rowsOf("divine").length,
    };`);
  check("the Player owns the character, is no GM and may write it", o1.isGM === false && o1.isOwner === true && o1.canWrite === true, o1);
  check("the Player's strip draws both tags with the divine balance, a disclosure for each, and every control: a Fades / Stays group, an amount box, Add and Remove on each, the count box, an Undo on each of the two entries", o1.divine === 6 && o1.arcane === 0 && o1.toggles === 2 && o1.open && o1.groups === 2 && o1.amounts === 2 && o1.adds === 2 && o1.removes === 2 && o1.counts === 1 && o1.undos === 2 && o1.rows === 2, o1);
  const wo0 = await updates();
  const o2 = await run(player, U, `
    const before = strip();
    typeAmount("divine", 2);
    await adjust("divine", 1);
    await until(() => entries("divine").length === 3, 50);
    const e = entries("divine");
    return { n: e.length, last: { amount: e.at(-1)?.amount, by: e.at(-1)?.by, mine: e.at(-1)?.user === game.user.id }, handKept: e[1]?.amount === 1, handNotMine: e[1]?.user !== game.user.id, distinct: e[1]?.id !== e.at(-1)?.id, fresh: strip() !== before, open: panel("divine")?.hidden === false, typed: amountBox("divine")?.value, canWrite: actor().canUserModify(game.user, "update") };`);
  const wo1 = await updates();
  check("the Player typed 2 and pressed Add: one entry of +2 by hand carrying the Player's own user id, written in one write from the Player's seat (it may write the actor, so no relay), and the GM seat's entry of the same day by hand is untouched and not folded into", o2.n === 3 && o2.last.amount === 2 && o2.last.by === "judge" && o2.last.mine === true && o2.handKept && o2.handNotMine && o2.distinct && o2.canWrite && wo1 - wo0 === 1 && o2.fresh && o2.open && o2.typed === "2", { ...o2, writes: wo1 - wo0 });
  const o3 = await run(player, U, `
    const before = JSON.stringify(flag());
    const over = await power().spend(actor(), "divine", { amount: 99 });
    await sleep(500);
    return { over, same: JSON.stringify(flag()) === before };`);
  const wo2 = await updates();
  check("a spend past the balance is blocked as `short` and writes nothing", o3.over.ok === false && o3.over.reason === "short" && o3.same && wo2 === wo1, { ...o3, writes: wo2 - wo1 });
  const o4 = await run(player, U, `
    const mine = entries("divine").at(-1);
    const undone = await power().undo(actor(), "divine", mine.id);
    await until(() => entries("divine").length === 2, 50);
    const set = await power().setCount(actor(), 3);
    await until(() => flag().arcane?.count === 3, 50);
    const count = flag().arcane?.count;
    const blank = await power().setCount(actor(), null);
    await until(() => (flag().arcane?.count ?? null) === null, 50);
    return { undone, n: entries("divine").length, set, count, blank, cleared: flag().arcane?.count ?? null };`);
  const wo3 = await updates();
  check("the Player's undo of its own unspent gain and its setCount both succeed (an undo, a count and a blank: three writes)", o4.undone.ok === true && o4.n === 2 && o4.set.ok === true && o4.count === 3 && o4.blank.ok === true && o4.cleared === null && wo3 - wo2 === 3, { ...o4, writes: wo3 - wo2 });
  const o5 = await run(player, U, `
    const r = await power().spend(actor(), "divine", { amount: 2, name: "QA Spent ritual", ref: "qa-cast-2" });
    await sleep(800);
    const last = entries("divine").at(-1);
    return { r, balance: power().balance(actor(), "divine"), amount: last?.amount, by: last?.by, mine: last?.user === game.user.id };`);
  const wo4 = await updates();
  check("within the balance the owner's own spend is written, from the Player's seat, as an ordinary entry (not by hand) with the Player's user id, in one write", o5.r.ok && o5.r.amount === 2 && o5.balance === 4 && o5.amount === -2 && o5.by === "" && o5.mine === true && wo4 - wo3 === 1, { ...o5, writes: wo4 - wo3 });
  const o6 = await run(gm, U, `
    await openSheet();
    await openPanel("divine");
    return { shown: shown("divine"), spent: rowsOf("divine").filter((r) => r.querySelector(".is-spent")).length };`);
  check("the Judge's strip shows the Player's spend", o6.shown === 4 && o6.spent === 1, o6);
  await run(player, U, `await closeSheet();`);

  section("6. a seat that does not own the character reads the tag and the rows and nothing else");
  // The module's own sheet draws a Magic tab, which hosts the strip, only for a caster, and the stranger has no class: core's own spell switch makes it one.
  const x0 = await run(gm, S, `
    await actor().update({ "flags.acks-extras.-=power": null, "system.spells.enabled": true });
    await sleep(400);
    const r = await power().gain(actor(), "divine", { amount: 1, name: "QA Stranger source", ref: "qa-cast-3" });
    await sleep(500);
    return { ok: r.ok, n: entries("divine").length };`);
  check("the GM seat gained 1 on the stranger", x0.ok && x0.n === 1, x0);
  const x1 = await run(player, S, `
    await until(() => entries("divine").length === 1, 50);
    await openSheet();
    if (!strip()) return { strip: false };
    await openPanel("divine");
    const count = (sel) => strip().querySelectorAll(sel).length;
    return {
      strip: true, isGM: game.user.isGM, isOwner: actor().isOwner, writable: actor().canUserModify(game.user, "update"),
      divine: shown("divine"), arcaneTag: count('[data-power="arcane"]'), toggles: count("[data-power-toggle]"), arcanePanel: count('[data-power-panel="arcane"]'),
      open: panel("divine")?.hidden === false, rows: rowsOf("divine").length, rowName: rowsOf("divine")[0]?.querySelector(".acks-extras-classes-powername")?.textContent.trim(),
      tip: (tag("divine")?.getAttribute("data-tooltip-text") ?? "").includes("QA Stranger source"),
      controls: ["[data-power-stay]", "[data-power-amount]", "[data-power-adjust]", "[data-power-count]", "[data-power-undo]", ".is-refused", '[role="group"]'].map(count),
    };`);
  check("the Player owns nothing here (it may not write the actor), and its strip draws the divine tag, its disclosure and a panel with the row and the tooltip, no arcane tag or panel, and no pill, group, amount box, Add, Remove, count box, Undo or refusal line", x1.strip === true && x1.isGM === false && x1.isOwner === false && x1.writable === false && x1.divine === 1 && x1.arcaneTag === 0 && x1.toggles === 1 && x1.arcanePanel === 0 && x1.open && x1.rows === 1 && x1.rowName === "QA Stranger source" && x1.tip && x1.controls.every((n) => n === 0), x1);
  const wx0 = await updates();
  const x2 = await run(player, S, `
    const before = JSON.stringify(flag());
    const id = entries("divine")[0].id;
    const r = {
      gain: await power().gain(actor(), "divine", { amount: 3, name: "QA Relay" }),
      byHand: await power().gain(actor(), "divine", { amount: 1, by: "judge" }),
      undo: await power().undo(actor(), "divine", id),
      count: await power().setCount(actor(), 3),
    };
    await sleep(800);
    return { ...r, same: JSON.stringify(flag()) === before };`);
  const wx1 = await updates();
  check("a gain, a hand's gain, an undo and the count each came back from the GM's client as `owner` (a missing GM would answer `noGm`), and nothing was written", [x2.gain, x2.byHand, x2.undo, x2.count].every((a) => a?.ok === false && a?.reason === "owner") && x2.same && wx1 === wx0, { ...x2, writes: wx1 - wx0 });
  await run(player, S, `await closeSheet();`);

  section("7. expiry by the calendar day against a lifetime in the registry");
  overrode = true;
  const e1 = await run(gm, U, `
    ${lifetimeKit}
    const none = read();
    const before = { span: none.span, byHand: none.byHand };
    await STORE.setOverride(D, "divineLifetime", { count: 3, unit: "day" }, { sourceName: "qa-power-ledger" });
    const served = await poll(() => read().span === 3);
    return { before, served, span: read().span, byHand: read().byHand };`);
  check("the registry's divine lifetime reads as three days, set by hand", e1.served && e1.span === 3 && e1.byHand === true, e1);
  const e2 = await run(gm, U, `
    const today = await day();
    const SPAN = 3;
    await actor().update({ "flags.acks-extras.power.divine": { entries: [
      { id: "qa-old", amount: 5, day: today - SPAN, name: "QA Old lot", img: "", ref: "", by: "" },
      { id: "qa-edge", amount: 4, day: today - SPAN + 1, name: "QA Edge lot", img: "", ref: "", by: "" },
      { id: "qa-new", amount: 2, day: today, name: "QA New lot", img: "", ref: "", by: "" },
    ] } });
    await sleep(500);
    await openSheet();
    const rowsNow = rows().map((r) => ({ name: r.querySelector(".acks-extras-classes-powername")?.textContent.trim(), off: r.classList.contains("is-off") }));
    const expiry = power().expiry(actor(), "divine");
    return { balance: power().balance(actor(), "divine"), shown: shown("divine"), rows: rowsNow, expiry, today };`);
  check("a lot gained a whole lifetime of days ago has expired and the two newer lots stand", e2.balance === 6 && e2.shown === 6, { balance: e2.balance, shown: e2.shown });
  check("the expired lot's row is dimmed and the others are not", e2.rows.find((r) => r.name === "QA Old lot")?.off === true && e2.rows.filter((r) => r.off).length === 1, e2.rows);
  check("the next to fade is the edge lot, one day away", e2.expiry && e2.expiry.inDays === 1 && e2.expiry.amount === 4, e2.expiry);
  const e3 = await run(gm, U, `
    const today = await day();
    await power().spend(actor(), "divine", { amount: 5, name: "QA Spend after" });
    await sleep(500);
    const lots = entries("divine");
    return { balance: power().balance(actor(), "divine"), spendDay: lots.at(-1).day === today };`);
  check("a Judge's spend of five takes five of the six that stand, and is stamped with today", e3.balance === 1 && e3.spendDay, e3);
  const none = await run(gm, U, `
    ${lifetimeKit}
    await STORE.setOverride(D, "divineLifetime", { count: "", unit: "" },{ sourceName: "qa-power-ledger" });
    const served = await poll(() => read().span === null && read().byHand === true);
    return { served, span: read().span, balance: power().balance(actor(), "divine"), expiry: power().expiry(actor(), "divine") };`);
  check("with no lifetime read nothing expires: the lot that had expired counts again (the spend drew on it), so the balance is the gains less the spend, and nothing is due to fade", none.served && none.span === null && none.balance === 6 && none.expiry === null, none);
  const cleared2 = await run(gm, U, `
    ${lifetimeKit}
    await STORE.clearOverride(D, "divineLifetime");
    const gone = await poll(() => !STORE.hasOverride(D, "divineLifetime"));
    return { gone, byHand: read().byHand };`);
  overrode = !cleared2.gone;
  check("the override is cleared and the registry serves its own read again", cleared2.gone && cleared2.byHand === false, cleared2);

  section("8. a Judge's Fades / Stays switch sets what Add writes, and a Player who owns the character has it too");
  overrode = true;
  const s0 = await run(gm, U, `
    ${lifetimeKit}
    await STORE.setOverride(D, "divineLifetime", { count: 3, unit: "day" }, { sourceName: "qa-power-ledger" });
    const served = await poll(() => read().span === 3);
    await closeSheet();
    await actor().update({ "flags.acks-extras.-=power": null });
    await sleep(400);
    await openSheet();
    await openPanel("divine");
    const pills = (kind) => [...panel(kind).querySelectorAll('[data-power-stay][data-power-kind="' + kind + '"]')];
    const groups = [...strip().querySelectorAll('[role="group"].acks-extras-classes-powerstay')];
    return { served, groups: groups.length, named: groups.every((g) => (g.getAttribute("aria-label") ?? "").length > 0), pressed: ["divine", "arcane"].map((k) => pills(k).map((p) => p.getAttribute("aria-pressed"))), amount: amountBox("divine")?.value };`);
  check("the lifetime reads as three days, and the Judge's strip draws a named group on each panel with Fades pressed and Stays not, the amount at 1", s0.served && s0.groups === 2 && s0.named && s0.pressed.every(([fades, stays]) => fades === "true" && stays === "false") && s0.amount === "1", s0);
  const ws0 = await updates();
  const s1 = await run(gm, U, `
    const before = strip();
    await press('[data-power-stay="1"][data-power-kind="divine"]');
    return { same: strip() === before, divine: [...panel("divine").querySelectorAll('[data-power-stay][data-power-kind="divine"]')].map((p) => p.getAttribute("aria-pressed")), arcane: [...panel("arcane").querySelectorAll('[data-power-stay][data-power-kind="arcane"]')].map((p) => p.getAttribute("aria-pressed")), entries: entries("divine").length };`);
  const ws1 = await updates();
  check("pressing Stays on the divine panel moves its pressed state, leaves the arcane panel on Fades, re-renders nothing and writes nothing", s1.same && s1.divine[0] === "false" && s1.divine[1] === "true" && s1.arcane[0] === "true" && s1.entries === 0 && ws1 === ws0, { ...s1, writes: ws1 - ws0 });
  const s2 = await run(gm, U, `
    await adjust("divine", 1);
    const e = entries("divine");
    const line = rowsOf("divine")[0]?.querySelector(".acks-extras-classes-powerline");
    const tip = tag("divine")?.getAttribute("data-tooltip-text") ?? "";
    return { n: e.length, stays: e[0]?.stays === true, by: e[0]?.by, mine: e[0]?.user === game.user.id, pin: !!line?.querySelector(".fa-thumbtack"), caption: (line?.textContent ?? "").trim().toLowerCase(), tipSays: tip.toLowerCase().includes("stays until removed"), shown: shown("divine"), open: panel("divine")?.hidden === false, reset: [...panel("divine").querySelectorAll('[data-power-stay][data-power-kind="divine"]')].map((p) => p.getAttribute("aria-pressed")) };`);
  check("Stays then Add wrote one entry marked as staying, by hand, with the seat's user id; its row carries the pin and 'stays until removed', and so does the chip's tooltip", s2.n === 1 && s2.stays && s2.by === "judge" && s2.mine === true && s2.pin && s2.caption.includes("stays until removed") && s2.tipSays && s2.shown === 1, s2);
  check("the switch still shows Stays and the panel is still open after the render the write made", s2.reset[0] === "false" && s2.reset[1] === "true" && s2.open, s2.reset);
  const s3 = await run(gm, U, `
    const today = await day();
    const list = foundry.utils.deepClone(entries("divine"));
    list[0].day = today - 30;
    await actor().update({ "flags.acks-extras.power.divine": { entries: list } });
    await sleep(600);
    await openSheet();
    return { kept: entries("divine")[0].stays === true, balance: power().balance(actor(), "divine"), shown: shown("divine"), off: rows()[0].classList.contains("is-off"), expiry: power().expiry(actor(), "divine") };`);
  check("with the lot's day thirty days back against a three-day lifetime it still stands: the balance, the face and the row are as before and nothing is due to fade", s3.kept && s3.balance === 1 && s3.shown === 1 && s3.off === false && s3.expiry === null, s3);
  const s4 = await run(gm, U, `
    await openPanel("divine");
    await press('[data-power-stay="0"][data-power-kind="divine"]');
    await adjust("divine", 1);
    const added = entries("divine").at(-1);
    const fresh = { stays: added.stays === true, n: entries("divine").length, balance: power().balance(actor(), "divine") };
    const today = await day();
    const list = foundry.utils.deepClone(entries("divine"));
    list[1].day = today - 3;
    await actor().update({ "flags.acks-extras.power.divine": { entries: list } });
    await sleep(600);
    await openSheet();
    return { fresh, balance: power().balance(actor(), "divine"), off: rows().map((r) => r.classList.contains("is-off")) };`);
  check("Fades pressed, then Add wrote an entry with no mark, which stands the day it is gained (it did not fold into the entry thirty days back)", s4.fresh.stays === false && s4.fresh.n === 2 && s4.fresh.balance === 2, s4.fresh);
  check("once its day is a whole lifetime back it has faded and the one that stays has not (rows newest first)", s4.balance === 1 && s4.off[0] === true && s4.off[1] === false, s4);
  const s5 = await run(gm, U, `
    await openPanel("divine");
    await adjust("divine", 1);
    const balanceBefore = power().balance(actor(), "divine");
    await adjust("divine", -1);
    const P = await import("/modules/acks-extras/scripts/magic/power-ledger.mjs");
    const today = await day();
    const span = power().lifetimes(actor()).divine.span;
    const lots = P.standing(P.readLedger(flag()).divine.entries, today, span).map((l) => ({ stays: l.stays, left: l.left, expired: l.expired }));
    return { balanceBefore, balance: power().balance(actor(), "divine"), lots };`);
  check("a Remove drew the fresh fading lot, not the older lot that stays (and the lot that had faded was not drawn on)", s5.balanceBefore === 2 && s5.balance === 1 && s5.lots.length === 3 && s5.lots[0].stays === true && s5.lots[0].left === 1 && s5.lots[1].expired === true && s5.lots[2].left === 0, s5);
  const ws3 = await updates();
  const s6 = await run(player, U, `
    await until(() => entries("divine").length === 4, 50);
    await openSheet();
    await openPanel("divine");
    const pinned = () => rowsOf("divine").filter((r) => r.querySelector(".fa-thumbtack")).length;
    const pinsBefore = pinned();
    const asked = await power().gain(actor(), "divine", { amount: 1, stays: true });
    await until(() => entries("divine").length === 5, 50);
    await sleep(500);
    await openSheet();
    await openPanel("divine");
    const last = entries("divine").at(-1);
    return { isGM: game.user.isGM, pills: strip().querySelectorAll("[data-power-stay]").length, groups: strip().querySelectorAll('[role="group"]').length, pinsBefore, pinsAfter: pinned(), asked, last: { stays: last?.stays === true, by: last?.by, mine: last?.user === game.user.id, amount: last?.amount }, n: entries("divine").length };`);
  const ws2 = await updates();
  check("the Player owns the hero, so its strip draws the switch on each panel and shows the lot that stays with its pin, and its own `gain(actor, \"divine\", {amount: 1, stays: true})` writes a lot that stays, not by hand, with its user id, in one write", s6.isGM === false && s6.pills === 4 && s6.groups === 2 && s6.pinsBefore === 1 && s6.pinsAfter === 2 && s6.asked.ok === true && s6.n === 5 && s6.last.stays && s6.last.by === "" && s6.last.mine === true && s6.last.amount === 1 && ws2 - ws3 === 1, { ...s6, writes: ws2 - ws3 });
  await run(player, U, `await closeSheet();`);

  section("9. the switch, the open panel and the typed amount hold across a render, Remove follows the switch, and a second window starts from nothing");
  const h0 = await run(gm, U, `
    await closeSheet();
    await actor().update({ "flags.acks-extras.-=power": null });
    await sleep(400);
    await openSheet();
    await openPanel("divine");
    const pair = (kind) => [...panel(kind).querySelectorAll('[data-power-stay][data-power-kind="' + kind + '"]')].map((p) => p.getAttribute("aria-pressed"));
    const minusLabel = () => panel("divine").querySelector('[data-power-adjust="-1"][data-power-kind="divine"]')?.getAttribute("aria-label") ?? "";
    const fadesLabel = minusLabel();
    await press('[data-power-stay="1"][data-power-kind="divine"]');
    const stayLabel = minusLabel();
    const marks = [];
    for (let i = 0; i < 2; i++) {
      const was = strip();
      await adjust("divine", 1);
      marks.push({ rerendered: strip() !== was, open: panel("divine")?.hidden === false, divine: pair("divine"), arcane: pair("arcane"), label: minusLabel() === stayLabel });
    }
    return { labelsDiffer: fadesLabel.length > 0 && stayLabel.length > 0 && fadesLabel !== stayLabel, marks, entries: entries("divine").map((x) => ({ amount: x.amount, stays: x.stays === true })) };`);
  check("Stays pressed, then Add twice: after each render the panel is still open, the divine pair still shows Stays and its Remove keeps the staying label, and the arcane pair stays on Fades", h0.labelsDiffer && h0.marks.every((m) => m.rerendered && m.open && m.divine[0] === "false" && m.divine[1] === "true" && m.arcane[0] === "true" && m.arcane[1] === "false" && m.label), h0.marks);
  check("the two presses folded: one entry of 2 that stays", h0.entries.length === 1 && h0.entries[0].amount === 2 && h0.entries[0].stays, h0.entries);
  const h1 = await run(gm, U, `
    const P = await import("/modules/acks-extras/scripts/magic/power-ledger.mjs");
    const pair = () => [...panel("divine").querySelectorAll('[data-power-stay][data-power-kind="divine"]')].map((p) => p.getAttribute("aria-pressed"));
    await press('[data-power-stay="0"][data-power-kind="divine"]');
    await adjust("divine", 1);
    await press('[data-power-stay="1"][data-power-kind="divine"]');
    await adjust("divine", -1);
    const e = entries("divine");
    const lots = P.standing(P.readLedger(flag()).divine.entries, await day(), power().lifetimes(actor()).divine.span).map((l) => ({ stays: l.stays, left: l.left }));
    const caption = (rowsOf("divine")[0]?.querySelector(".acks-extras-classes-powerline")?.textContent ?? "").trim().toLowerCase();
    return { n: e.length, fading: e[1]?.stays !== true, removal: { amount: e[2]?.amount, by: e[2]?.by, fromStays: e[2]?.fromStays === true }, lots, balance: power().balance(actor(), "divine"), shown: shown("divine"), pair: pair(), caption };`);
  check("with a fading lot standing, a Remove on Stays wrote a removal marked as from the lots that stay, by hand, and took a point that stays, not the fading one", h1.n === 3 && h1.fading && h1.removal.amount === -1 && h1.removal.by === "judge" && h1.removal.fromStays && h1.lots.length === 2 && h1.lots[0].stays && h1.lots[0].left === 1 && !h1.lots[1].stays && h1.lots[1].left === 1 && h1.balance === 2 && h1.shown === 2, h1);
  check("the removal's row says a point that stays was removed, and the switch still shows Stays after the render", h1.caption.includes("removed a point that stays") && h1.pair[0] === "false" && h1.pair[1] === "true", { caption: h1.caption, pair: h1.pair });
  const h2 = await run(gm, U, `
    const P = await import("/modules/acks-extras/scripts/magic/power-ledger.mjs");
    await press('[data-power-stay="0"][data-power-kind="divine"]');
    await adjust("divine", -1);
    const e = entries("divine");
    const lots = P.standing(P.readLedger(flag()).divine.entries, await day(), power().lifetimes(actor()).divine.span).map((l) => ({ stays: l.stays, left: l.left }));
    return { n: e.length, plain: e[3]?.fromStays !== true && e[3]?.amount === -1, lots, balance: power().balance(actor(), "divine") };`);
  check("with the switch on Fades the Remove is the ordinary spend, a new entry (it did not fold into the removal beside it) that takes the fading lot and leaves the point that stays", h2.n === 4 && h2.plain && h2.lots.length === 2 && h2.lots[0].stays && h2.lots[0].left === 1 && !h2.lots[1].stays && h2.lots[1].left === 0 && h2.balance === 1, h2);
  const wd0 = await updates();
  const h2b = await run(gm, U, `
    await press('[data-power-stay="1"][data-power-kind="divine"]');
    await adjust("divine", -1);
    const afterFirst = { n: entries("divine").length, last: entries("divine").at(-1)?.fromStays === true, balance: power().balance(actor(), "divine") };
    await adjust("divine", -1);
    return { afterFirst, n: entries("divine").length, balance: power().balance(actor(), "divine") };`);
  const wd1 = await updates();
  check("the last point that stays goes to a Remove on Stays, and a second Remove on Stays, with none left, writes nothing (one update, the entry count and the balance hold)", h2b.afterFirst.n === 5 && h2b.afterFirst.last && h2b.afterFirst.balance === 0 && h2b.n === 5 && h2b.balance === 0 && wd1 - wd0 === 1, { ...h2b, writes: wd1 - wd0 });
  const wh0 = await updates();
  const h3 = await run(gm, U, `
    const winState = (app) => {
      const s = app.element.querySelector(".acks-extras-classes-strip");
      return { pair: [...s.querySelectorAll('[data-power-stay][data-power-kind="divine"]')].map((p) => p.getAttribute("aria-pressed")), hidden: s.querySelector('[data-power-panel="divine"]').hidden, amount: s.querySelector('[data-power-amount][data-power-kind="divine"]').value };
    };
    await press('[data-power-stay="1"][data-power-kind="divine"]');
    typeAmount("divine", 3);
    const first = actor().sheet;
    const second = new first.constructor({ document: actor(), id: "qa-power-second-window" });
    let out;
    try {
      await second.render({ force: true });
      await until(() => second.element?.isConnected);
      try { second.changeTab?.("magic", "primary"); } catch { /* as openSheet */ }
      await until(() => second.element?.querySelector(".acks-extras-classes-strip"));
      await sleep(300);
      const opened = { second: winState(second), first: winState(first) };
      const strip2 = second.element.querySelector(".acks-extras-classes-strip");
      strip2.querySelector('[data-power-toggle][data-power-kind="divine"]').click();
      await sleep(150);
      strip2.querySelector('[data-power-panel="divine"] [data-power-adjust="1"][data-power-kind="divine"]').click();
      await sleep(900);
      const e = entries("divine");
      out = { opened, added: e.length === 6 && e[5].stays !== true && e[5].amount === 1, after: { second: winState(second), first: winState(first) } };
    } finally {
      await second.close({ animate: false });
    }
    return out;`);
  const wh1 = await updates();
  check("a second window on the same actor opens with its panel closed, its divine pair on Fades and its amount at 1 while the first holds Stays, its panel open and 3 typed, and an Add pressed in it writes a fading point of 1", h3.opened.second.hidden === true && h3.opened.second.pair[0] === "true" && h3.opened.second.pair[1] === "false" && h3.opened.second.amount === "1" && h3.opened.first.hidden === false && h3.opened.first.pair[0] === "false" && h3.opened.first.pair[1] === "true" && h3.opened.first.amount === "3" && h3.added, h3);
  check("after the write both windows kept their own state: the second's panel is open on Fades at 1, the first is still open on Stays at 3", h3.after.second.hidden === false && h3.after.second.pair[0] === "true" && h3.after.second.amount === "1" && h3.after.first.hidden === false && h3.after.first.pair[1] === "true" && h3.after.first.amount === "3", h3.after);
  check("pressing Stays, typing and opening the second window wrote nothing to the actor: the one update between them is the Add pressed in the second window", wh1 - wh0 === 1, { writes: wh1 - wh0 });
  const h4 = await run(gm, U, `
    await closeSheet();
    await openSheet();
    return { pair: [...panel("divine").querySelectorAll('[data-power-stay][data-power-kind="divine"]')].map((p) => p.getAttribute("aria-pressed")), hidden: ["divine", "arcane"].map((k) => panel(k)?.hidden === true), expanded: ["divine", "arcane"].map((k) => toggle(k)?.getAttribute("aria-expanded")), amount: amountBox("divine")?.value };`);
  check("a window closed and opened again starts on Fades with both panels closed and the amount at 1", h4.pair[0] === "true" && h4.pair[1] === "false" && h4.hidden.every(Boolean) && h4.expanded.every((x) => x === "false") && h4.amount === "1", h4);
  await run(gm, U, `await closeSheet();`);
  const cleared3 = await run(gm, U, `
    ${lifetimeKit}
    await STORE.clearOverride(D, "divineLifetime");
    const gone = await poll(() => !STORE.hasOverride(D, "divineLifetime"));
    return { gone };`);
  overrode = !cleared3.gone;
  check("the override is cleared again", cleared3.gone, cleared3);

  section("10. a bucket's power row is capped by the balance");
  const b1 = await run(gm, U, `
    await actor().update({ "flags.acks-extras.-=power": null });
    await sleep(400);
    await power().gain(actor(), "divine", { amount: 5, name: "QA Cap" });
    const asked = power().row(actor(), "divine", { amount: 50 });
    const some = power().row(actor(), "divine", { amount: 2 });
    const none = power().row(actor(), "arcane", { amount: 3 });
    const settled = await power().settle(actor(), { uuid: "power:divine", kind: "power", qty: 4, action: "consume" }, { name: "QA Settled" });
    return { asked: { uuid: asked?.uuid, qty: asked?.qty, cap: asked?.cap, kind: asked?.kind }, some: some?.qty, none, settled: { ok: settled.ok, amount: settled.amount, balance: settled.balance } };`);
  check("a row asked for more than is held is held to the balance, a smaller ask stands, and a power with none held gives no row", b1.asked.uuid === "power:divine" && b1.asked.kind === "power" && b1.asked.qty === 5 && b1.asked.cap === 5 && b1.some === 2 && b1.none === null, b1);
  check("a settlement's handed power row is spent from the ledger", b1.settled.ok && b1.settled.amount === 4 && b1.settled.balance === 1, b1.settled);

  section("Teardown");
  await run(gm, U, `await closeSheet();`);
  await run(player, U, `await closeSheet();`);
  await run(player, S, `await closeSheet();`);
  await run(gm, U, clear, S);
  await gm.eval(`Hooks.off("updateActor", __pl.hook); delete globalThis.__pl;`);
  console.log("fixtures kept: magic/power-class, magic/power-hero, magic/power-stranger");
  walkDone();
} catch (e) {
  if (!(e instanceof WalkBlocked)) console.log("WALK ERROR:", e?.stack ?? e);
} finally {
  try {
    if (gm && overrode) console.log(`override cleared: ${await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); await S.clearOverride("magicResearch", "divineLifetime"); return !S.hasOverride("magicResearch", "divineLifetime"); })()`)}`);
  } catch {}
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  try { player?.close?.(); } catch {}
  try { gm?.close?.(); } catch {}
  process.exitCode = failed ? 1 : 0;
}
