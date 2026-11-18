/**
 * Live walk, magic-power-ledger: the power ledger and its chip on the casting
 * strip (`scripts/magic/power-ledger*.mjs`, `scripts/classes/power-chip.mjs`).
 * Walks docs/magic/TESTING.md "The power ledger" on the GM seat and a Player
 * seat: a Judge's gain through the API stamped with the world's calendar day,
 * the chip on the strip (a tag per power, the entries in its tooltip and as
 * rows), a Judge's plus, minus and Undo and the arcane count, a Player seat's
 * read-only strip and its refused calls (an owner, so only `isGM` can be what
 * gates), a Player's request on an actor it cannot write relayed to the GM's
 * client and refused there, expiry by the calendar day against a lifetime in the
 * registry, nothing expiring with none, and a bucket's power row capped by the
 * balance.
 *
 * The lifetime is the registry's `divineLifetime` through its override layer
 * (invented, three days), so the walk needs no import and sets nothing a Judge
 * did not; a table another hand already overrode blocks the walk. Time is not
 * moved: the clock is shared by every seat, so an entry's day is written in the
 * past (the day a lot would have been gained) and the balance reads the clock as
 * it stands. Prints counts and booleans only.
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

/** The page helpers every step shares, for the character at `uuid`. */
const kit = (uuid, otherUuid = "") => `
  const U = ${JSON.stringify(uuid)};
  const V = ${JSON.stringify(otherUuid)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, n = 60) => { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const actor = () => fromUuidSync(U);
  const power = () => acksExtras.magic.power;
  const flag = () => actor().flags?.["acks-extras"]?.power ?? {};
  const strip = () => actor().sheet.element?.querySelector(".acks-extras-classes-strip");
  const tag = (kind) => strip()?.querySelector('[data-power="' + kind + '"]');
  const shown = (kind) => { const n = Number(tag(kind)?.querySelector(".acks-nums")?.textContent); return Number.isFinite(n) ? n : null; };
  const rows = () => [...(strip()?.querySelectorAll(".acks-extras-classes-powerrow") ?? [])];
  const openSheet = async () => {
    const a = actor();
    await a.sheet.render({ force: true });
    await until(() => a.sheet.element?.isConnected);
    a.sheet.changeTab?.("magic", "primary");
    await until(() => strip());
    await sleep(300);
    return a.sheet;
  };
  const closeSheet = async () => { await actor()?.sheet?.close({ animate: false }); };
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
  const seated = await gm.eval(`({ gm: game.user.isGM, active: game.users.activeGM?.isSelf === true, power: typeof acksExtras?.magic?.power?.gain === "function" })`);
  const playerSeat = await player.eval(`({ gm: game.user.isGM, id: game.user.id, power: typeof acksExtras?.magic?.power?.gain === "function" })`);
  if (!seated.gm || !seated.active) blocked("the first seat is not the active GM");
  if (playerSeat.gm) blocked("the second seat is a GM, so a Player's read-only strip cannot be walked");
  check("the ledger's API is on both seats", seated.power && playerSeat.power);
  const taken = await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); return S.hasOverride("magicResearch", "divineLifetime"); })()`);
  if (taken) blocked("the divine lifetime is already overridden by another hand");

  section("Fixtures");
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
  const cleared = await run(gm, U, clear, S);
  check("both fixtures start with no ledger", cleared.every((held) => held === false), cleared);
  await gm.eval(`globalThis.__pl = { updates: 0, hook: Hooks.on("updateActor", (a) => { if (a.uuid === ${JSON.stringify(U)} || a.uuid === ${JSON.stringify(S)}) __pl.updates++; }) }`);
  const updates = () => gm.eval(`__pl.updates`);

  section("1. a gain is stamped with the calendar day, and the chip shows it");
  const g1 = await run(gm, U, `
    const today = await day();
    const result = await power().gain(actor(), "divine", { amount: 8, name: "QA Sacrifice source", ref: "qa-cast-1" });
    await sleep(500);
    const e = flag().divine?.entries?.[0] ?? {};
    return { result, stamp: e.day === today, today: Number.isInteger(today), by: e.by, balance: power().balance(actor(), "divine"), entries: (flag().divine?.entries ?? []).length };`);
  check("the gain answered ok with the balance, one entry stamped with the day the world clock is in", g1.result.ok && g1.result.balance === 8 && g1.balance === 8 && g1.entries === 1 && g1.today && g1.stamp && g1.by === "", g1);
  const c1 = await run(gm, U, `
    await openSheet();
    const t = tag("divine");
    const tip = t?.getAttribute("data-tooltip-text") ?? "";
    return { divine: shown("divine"), arcane: shown("arcane"), plus: strip().querySelectorAll('[data-power-adjust="1"]').length, minus: strip().querySelectorAll('[data-power-adjust="-1"]').length, count: strip().querySelectorAll("[data-power-count]").length, rows: rows().length, tipHasEntry: tip.includes("QA Sacrifice source") && tip.includes("+8"), tipHasPage: /\\bRR\\b/.test(tip), rowName: rows()[0]?.querySelector(".acks-extras-classes-powername")?.textContent.trim(), art: !!rows()[0]?.querySelector(".acks-extras-classes-powerart img, .acks-extras-classes-powerart i"), literalIds: [...strip().querySelectorAll("[id]")].filter((e) => !e.id.startsWith(actor().sheet.id + "-")).length };`);
  check("the Judge's strip draws both tags, the balance on the divine one, a plus and a minus on each and one count box", c1.divine === 8 && c1.arcane === 0 && c1.plus === 2 && c1.minus === 2 && c1.count === 1, c1);
  check("the tooltip lists the entry with its sign and the page, the entry is a row with the source's name and art, and no element carries an id but one lib's a11y binder seeds from the window", c1.tipHasEntry && c1.tipHasPage && c1.rows === 1 && c1.rowName === "QA Sacrifice source" && c1.art && c1.literalIds === 0, c1);

  section("2. a Judge's plus, minus and Undo on the strip");
  const w0 = await updates();
  const j1 = await run(gm, U, `
    await press('[data-power="divine"] ~ [data-power-adjust="1"]');
    const afterPlus = { shown: shown("divine"), api: power().balance(actor(), "divine"), by: flag().divine.entries.at(-1).by };
    await press('[data-power="divine"] ~ [data-power-adjust="-1"]');
    await press('[data-power="divine"] ~ [data-power-adjust="-1"]');
    const afterMinus = { shown: shown("divine"), api: power().balance(actor(), "divine"), spends: flag().divine.entries.filter((e) => e.amount < 0).length, by: flag().divine.entries.at(-1).by };
    const undo = strip().querySelectorAll("[data-power-undo]");
    const undoCount = undo.length;
    undo[0].click();
    await sleep(800);
    return { afterPlus, afterMinus, undoCount, afterUndo: { shown: shown("divine"), api: power().balance(actor(), "divine"), spends: flag().divine.entries.filter((e) => e.amount < 0).length } };`);
  const w1 = await updates();
  check("a plus added one by hand (by judge) and the face and the API agree", j1.afterPlus.shown === 9 && j1.afterPlus.api === 9 && j1.afterPlus.by === "judge", j1.afterPlus);
  check("two minuses spent two, as spends by hand, with Undo on each", j1.afterMinus.shown === 7 && j1.afterMinus.api === 7 && j1.afterMinus.spends === 2 && j1.afterMinus.by === "judge" && j1.undoCount === 2, { ...j1.afterMinus, undo: j1.undoCount });
  check("Undo took one spend back and the power came back", j1.afterUndo.shown === 8 && j1.afterUndo.api === 8 && j1.afterUndo.spends === 1, j1.afterUndo);
  check("each press wrote the actor once", w1 - w0 === 4, { writes: w1 - w0 });
  const j2 = await run(gm, U, `
    const before = (flag().arcane?.entries ?? []).length;
    await press('[data-power="arcane"] ~ [data-power-adjust="-1"]');
    return { entries: (flag().arcane?.entries ?? []).length - before, shown: shown("arcane") };`);
  check("a minus on a power with none held writes no entry and leaves the face at nothing", j2.entries === 0 && j2.shown === 0, j2);

  section("3. the arcane count is a Judge's field, blank until set");
  const k1 = await run(gm, U, `
    const box = strip().querySelector("[data-power-count]");
    const blank = box.value === "";
    const tip = box.getAttribute("data-tooltip-text") ?? "";
    box.value = "4";
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(800);
    const set = flag().arcane?.count;
    const kept = (flag().arcane?.entries ?? []).length;
    const box2 = strip().querySelector("[data-power-count]");
    box2.value = "";
    box2.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(800);
    return { blank, tipPage: /\\bRR\\b/.test(tip), set, kept, cleared: flag().arcane?.count ?? null };`);
  check("the box starts blank with the page reference in its tooltip, writes the count on change and leaves the entries, and blanks again", k1.blank && k1.tipPage && k1.set === 4 && k1.kept === 0 && k1.cleared === null, k1);

  section("4. a Player seat reads the strip and cannot change it");
  const wp0 = await updates();
  const p1 = await run(player, U, `
    await openSheet();
    const out = {
      isGM: game.user.isGM, isOwner: actor().isOwner,
      divine: shown("divine"), arcane: tag("arcane") === null || tag("arcane") === undefined,
      adjust: strip().querySelectorAll("[data-power-adjust]").length, undo: strip().querySelectorAll("[data-power-undo]").length, count: strip().querySelectorAll("[data-power-count]").length,
      rows: rows().length, tip: (tag("divine")?.getAttribute("data-tooltip-text") ?? "").includes("QA Sacrifice source"),
    };
    return out;`);
  check("the Player owns the character and is no GM, so only `isGM` can be what gates", p1.isGM === false && p1.isOwner === true, p1);
  check("the Player's strip shows the divine tag with its balance, its entries as rows and in the tooltip, no arcane tag, no plus, minus, Undo or count", p1.divine === 8 && p1.arcane && p1.adjust === 0 && p1.undo === 0 && p1.count === 0 && p1.rows === 3 && p1.tip, p1);
  const p2 = await run(player, U, `
    const before = JSON.stringify(flag());
    const r = {
      over: await power().spend(actor(), "divine", { amount: 99 }),
      byHand: await power().gain(actor(), "divine", { amount: 1, by: "judge" }),
      undo: await power().undo(actor(), "divine", flag().divine.entries.find((e) => e.amount < 0)?.id ?? "x"),
      count: await power().setCount(actor(), 3),
    };
    await sleep(500);
    return { ...r, same: JSON.stringify(flag()) === before };`);
  const wp1 = await updates();
  check("a spend past the balance is blocked, and the Judge's own acts (a hand's gain, an Undo, the count) are refused", p2.over.ok === false && p2.over.reason === "short" && p2.byHand.reason === "judge" && p2.undo.reason === "judge" && p2.count.reason === "judge" && p2.same, p2);
  check("no write reached the world from those calls", wp1 === wp0, { before: wp0, after: wp1 });
  const p3 = await run(player, U, `
    const r = await power().spend(actor(), "divine", { amount: 2, name: "QA Spent ritual", ref: "qa-cast-2" });
    await sleep(800);
    return { r, balance: power().balance(actor(), "divine"), last: flag().divine.entries.at(-1) };`);
  check("within the balance the owner's own spend is written, from the Player's seat, as an ordinary entry", p3.r.ok && p3.r.amount === 2 && p3.balance === 6 && p3.last.amount === -2 && p3.last.by === "", p3);
  const wp2 = await updates();
  const p4 = await run(gm, U, `
    await openSheet();
    return { shown: shown("divine"), spent: rows().filter((r) => r.querySelector(".is-spent")).length };`);
  check("the Judge's strip shows the Player's spend", p4.shown === 6 && p4.spent === 2, p4);
  await run(player, U, `await closeSheet();`);

  section("5. a request on an actor the Player cannot write is relayed to the GM's client and refused there");
  const r1 = await run(player, S, `
    const a = fromUuidSync(U);
    const writable = a.canUserModify(game.user, "update");
    const answer = await power().gain(a, "divine", { amount: 3, name: "QA Relay" });
    await sleep(800);
    return { writable, answer, held: (a.flags?.["acks-extras"]?.power?.divine?.entries ?? []).length };`);
  const wr = await updates();
  check("the Player may not write the actor, the call came back from the GM's client as an owner refusal and nothing was written", r1.writable === false && r1.answer.ok === false && r1.answer.reason === "owner" && r1.held === 0 && wr === wp2, { ...r1, writes: wr - wp2 });

  section("6. expiry by the calendar day against a lifetime in the registry");
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
    const lots = flag().divine.entries;
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

  section("7. a bucket's power row is capped by the balance");
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
