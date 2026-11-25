/**
 * Live walk, magic-sacrifice: the Blood sacrifice window (`scripts/magic/sacrifice*.mjs`,
 * `apps/sacrifice-window.mjs`). Walks docs/magic/TESTING.md "Blood sacrifice (M-s)" on the GM seat and a Player
 * seat together: the Sacrifice… button on the casting strip opened by a real click on each seat (and absent on a
 * character a Player has no claim on), a victim dropped by a real drop event, the Judge's checks inside each
 * victim's row, the facts set by the owner of the caster and shared through the record on the caster (the Player who
 * owns the caster ticks the site and the victim's helpless check and types a value, the Judge's open window shows them
 * live, and the Player's Sacrifice frees itself once nothing blocks it), the Player's own `judge` write admitted by the
 * GM's client for a caster it owns and refused `owner` for one it does not, a Player's drop written through it, a
 * successful sacrifice made by the Player (divine power on the ledger, the victim marked dead and never deleted, the
 * record cleared, one card with the power and the victim), a failed throw adding nothing of the traits, an unwilling
 * chaotic victim yielding nothing, the class power's arcane gain through the imported multiple, a figure not read
 * holding the act, a Player's mark and record write relayed to the GM's client and refused for a caster the Player
 * does not own, an owner's close clearing the record while keeping the class-power mark, and a seat that only
 * observes a caster reading the checks as text under a "Waiting on the caster's owner" line.
 *
 * The figures are the registry's `researchLadder`, `researchProse`, `sacrificeTraits` and `powerOfSacrifice`
 * through the override layer (invented), so the walk needs no import and sets nothing a Judge did not; a table
 * another hand already overrode blocks the walk. The die is rigged on both seats, since the seat that presses
 * Sacrifice rolls, and restored in the finally. Every card a step posts is tracked by id and swept by that list; a
 * card is waited for with a polling `until`. Prints counts and booleans only.
 *
 * Fixtures, kept and found by marker (the GM seat builds them): `magic/sacrifice-class` (a divine casting class),
 * `magic/sacrifice-caster` (a chaotic character the Player owns, bound to the class), `magic/sacrifice-stranger` (a
 * character the Player may only observe), `magic/sacrifice-observed` (a chaotic divine caster the Player seat only
 * observes: the observer seat of the recipe, since the walk has one Player seat), `magic/sacrifice-lawful` and `magic/sacrifice-chaotic` (creatures with an
 * XP award and a sapient mind). Their shapes are asserted at the start of each step: the caster's ledger, level,
 * alignment and open record, and the victims' dead mark, are put back by the step that moved them and again at the end.
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
let rigged = false;
/** The id of every card this run's acts posted, swept in the finally by id and nothing else. */
const tracked = [];

const TABLE_IDS = ["researchLadder", "researchProse", "sacrificeTraits", "powerOfSacrifice"];

/** The page helpers every step shares, for the caster at `uuid`. */
const kit = (uuid, ids = {}) => `
  const U = ${JSON.stringify(uuid)};
  const ID = ${JSON.stringify(ids)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, n = 60) => { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const caster = () => fromUuidSync(U);
  const appId = () => "acks-extras-sacrifice-" + caster().id;
  const W = () => document.getElementById(appId());
  const sheetButton = async () => {
    const sheet = caster().sheet;
    await sheet.render({ force: true });
    return until(() => sheet.element?.querySelector("[data-sacrifice-open]"), 100);
  };
  const open = async () => {
    const button = await sheetButton();
    if (!button) throw new Error("the strip drew no Sacrifice button");
    button.click();
    await until(() => W()?.querySelector(".acks-extras-sacrifice-body") && W()?.querySelector('[data-action="sacrifice"]'));
    await sleep(300);
  };
  const close = async () => { const app = foundry.applications.instances.get(appId()); if (app) await app.close({ animate: false }); await until(() => !W()); };
  const drop = async (uuid, type = "Actor") => {
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type, uuid }));
    W().querySelector("[data-bucket-drop]").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await until(() => W().querySelector('.acks-extras-bucket__row[data-uuid="' + uuid + '"]'));
    await sleep(300);
  };
  const tick = async (selector, want = true) => { const el = W().querySelector(selector); if (el && el.checked !== want) { el.click(); await sleep(800); } return !!el; };
  const lines = () => [...(W()?.querySelectorAll(".acks-extras-cast-verdicts li") ?? [])].map((li) => ({ sev: li.dataset.severity, text: li.textContent.trim() }));
  const btn = () => W()?.querySelector('[data-action="sacrifice"]');
  const yields = () => [...(W()?.querySelectorAll(".acks-extras-sacrifice-yield dd") ?? [])].map((d) => d.textContent.trim());
  const rowsOf = () => [...(W()?.querySelectorAll(".acks-extras-bucket__row") ?? [])].map((r) => ({ uuid: r.dataset.uuid, off: r.classList.contains("is-off"), text: r.textContent.replace(/\\s+/g, " ").trim() }));
  const dead = (uuid) => fromUuidSync(uuid)?.statuses?.has("dead") === true;
  const balance = (kind) => acksExtras.magic.power.balance(caster(), kind);
  const before = () => ({ msgs: [...game.messages].map((m) => m.id) });
  const cardsSince = (snap) => [...game.messages].filter((m) => !snap.msgs.includes(m.id) && m.speaker?.actor === caster().id && String(m.content).includes("acks-extras-roll-card"));
`;
const run = (seat, uuid, body, ids) => seat.eval(`(async () => { ${kit(uuid, ids)} ${body} })()`);

/** Override or clear the registry's research tables through the Ruledata Browser's own store. */
const tablesKit = `
  const STORE = await import("/modules/acks-extras/scripts/location/table-store.mjs");
  const D = "magicResearch";
  const poll = async (test) => { for (let i = 0; i < 80; i++) { if (test()) return true; await new Promise((r) => setTimeout(r, 100)); } return !!test(); };
`;

/** The invented figures: a ladder rung for level 4, an automatic-failure band of a natural 1, two traits and a multiple. */
const FIGURES = `
  await STORE.setOverride(D, "researchLadder", { r0: { label: 4, rate: "30gp", throw: "15+", marked: false } }, { sourceName: "qa-sacrifice" });
  await STORE.setOverride(D, "researchProse", { autoFailBand: [1, 1] }, { sourceName: "qa-sacrifice" });
  await STORE.setOverride(D, "sacrificeTraits", { r0: { label: "QA Trait A", multiplier: "x 4" }, r1: { label: "QA Trait B", multiplier: "x 7" } }, { sourceName: "qa-sacrifice" });
  await STORE.setOverride(D, "powerOfSacrifice", { multiplier: 6 }, { sourceName: "qa-sacrifice" });
`;

/** The shape every step starts from: the caster chaotic at level 4 with no ledger and no open record, no victim dead, no window open. */
const RESET = `
  await close();
  for (const u of [ID.lawful, ID.chaotic]) { const a = fromUuidSync(u); if (a.statuses.has("dead")) await a.toggleStatusEffect("dead", { active: false }); }
  await caster().update({ "flags.acks-extras.-=power": null, "flags.acks-extras.magic.-=sacrifice": null, "system.details.level": 4, "system.details.alignment": "Chaotic" });
  const watched = ID.observed ? fromUuidSync(ID.observed) : null;
  if (watched?.flags?.["acks-extras"]?.magic?.sacrifice) await watched.update({ "flags.acks-extras.magic.-=sacrifice": null });
  await sleep(500);
`;

try {
  gm = await connect({ browser: M.browser, origin: M.origin, user: M.gm, port: PORTS.gm, own: M.own });
  player = await connect({ browser: M.browser, origin: M.origin, user: M.player, port: PORTS.player, own: M.own });

  section("Boot");
  const seated = await gm.eval(`({ gm: game.user.isGM, active: game.users.activeGM?.isSelf === true, api: typeof acksExtras?.magic?.sacrifice?.open === "function" })`);
  const playerSeat = await player.eval(`({ gm: game.user.isGM, id: game.user.id, api: typeof acksExtras?.magic?.sacrifice?.open === "function" })`);
  if (!seated.gm || !seated.active) blocked("the first seat is not the active GM");
  if (playerSeat.gm) blocked("the second seat is a GM, so a Player's blocked window cannot be walked");
  check("the sacrifice API is on both seats", seated.api && playerSeat.api);
  const taken = await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); return ${JSON.stringify(TABLE_IDS)}.filter((id) => S.hasOverride("magicResearch", id)); })()`);
  if (taken.length) blocked(`the sacrifice tables are already overridden by another hand: ${taken.join(", ")}`);

  section("Fixtures");
  const playerId = playerSeat.id;
  const base = { prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 } } };
  const cls = await gm.fixture("magic/sacrifice-class", "Item", { name: "QA Sacrifice Class", type: "acks-extras.class", system: { key: "qasacrificeclass", casting: [{ key: "divine", label: "Divine", kind: "vancian", slots: [{ atLevel: 1, s1: 2 }] }] } });
  const caster = await gm.fixture("magic/sacrifice-caster", "Actor", { name: "QA Sacrifice Caster", type: "character", ...base, system: { ...base.system, details: { alignment: "Chaotic", level: 4 } }, flags: { "acks-extras": { classes: { uuid: cls.uuid } } }, ownership: { default: 0, [playerId]: 3 } });
  const stranger = await gm.fixture("magic/sacrifice-stranger", "Actor", { name: "QA Sacrifice Stranger", type: "character", ...base, ownership: { default: 2 } });
  const observed = await gm.fixture("magic/sacrifice-observed", "Actor", { name: "QA Sacrifice Observed", type: "character", ...base, system: { ...base.system, details: { alignment: "Chaotic", level: 4 } }, flags: { "acks-extras": { classes: { uuid: cls.uuid } } }, ownership: { default: 2 } });
  const mind = { "acks-extras": { extras: { secondary: { intelligence: "sapient" } } } };
  const lawful = await gm.fixture("magic/sacrifice-lawful", "Actor", { name: "QA Sacrifice Lawful", type: "monster", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, details: { xp: 100, alignment: "Lawful" } }, flags: mind, ownership: { default: 2 } });
  const chaotic = await gm.fixture("magic/sacrifice-chaotic", "Actor", { name: "QA Sacrifice Chaotic", type: "monster", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, details: { xp: 40, alignment: "Chaotic" } }, flags: mind, ownership: { default: 2 } });
  // A kept caster carries whichever Player seat built it: the seated Player is made its owner here, and the
  // Player seat's own read of its permission is the proof, since a GM-side write can report and not land.
  const owned = await gm.eval(`(async () => {
    const a = fromUuidSync(${JSON.stringify(caster.uuid)});
    const was = a.ownership?.[${JSON.stringify(playerId)}] ?? 0;
    if (was !== 3) await a.update({ [\`ownership.${playerId}\`]: 3 });
    return { was };
  })()`);
  const seen = await player.eval(`(async () => {
    for (let i = 0; i < 40; i++) { if (fromUuidSync(${JSON.stringify(caster.uuid)})?.isOwner) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  })()`);
  check("the kept caster is owned by the seated Player, as the Player seat reads it", seen === true, { ...owned, seen });
  // The observed caster is the observer seat: the Player seat must read it as no more than an Observer, or step 10 proves nothing.
  const watching = await player.eval(`(async () => {
    for (let i = 0; i < 40; i++) { if (fromUuidSync(${JSON.stringify(observed.uuid)})) break; await new Promise((r) => setTimeout(r, 100)); }
    const a = fromUuidSync(${JSON.stringify(observed.uuid)});
    return { found: !!a, owner: a?.isOwner === true, observer: a?.testUserPermission(game.user, "OBSERVER") === true };
  })()`);
  if (!watching.found || watching.owner || !watching.observer) blocked(`the kept observed caster is not an Observer-only caster for the Player seat: ${JSON.stringify(watching)}`);
  const U = caster.uuid;
  const ids = { lawful: lawful.uuid, chaotic: chaotic.uuid, stranger: stranger.uuid, observed: observed.uuid };
  overrode = true;
  await run(gm, U, `${tablesKit} ${FIGURES} await poll(() => STORE.hasOverride(D, "powerOfSacrifice")); return true;`, ids);
  // `CONFIG.Dice.randomUniform` reads from the top: 1 - (die - 0.5) / 20 throws that natural die on core 14. Restored in the finally.
  const rig = async (die) => {
    rigged = true;
    for (const seat of [gm, player]) await seat.eval(`(() => { globalThis.__saDice ??= CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = () => 1 - (${die} - 0.5) / 20; return true; })()`);
  };
  const s0 = await run(gm, U, `${RESET} return { level: Number(caster().system.details.level), alignment: caster().system.details.alignment, held: acksExtras.magic.power.balance(caster(), "divine"), dead: [dead(ID.lawful), dead(ID.chaotic)], hasClass: !!caster().getFlag("acks-extras", "classes")?.uuid };`, ids);
  check("every step starts from a known shape: the caster chaotic at level 4 bound to a casting class with nothing held, and no victim dead", s0.level === 4 && /chaotic/i.test(s0.alignment) && s0.held === 0 && s0.dead.every((d) => d === false) && s0.hasClass, s0);

  section("1. the casting strip's button opens the window, and a victim dropped by a real drop event is a row");
  const b1 = await run(gm, U, `
    const button = await sheetButton();
    const out = { onStrip: !!button?.closest(".acks-extras-classes-strip"), beside: !!button?.parentElement?.classList.contains("acks-extras-classes-powerchips"), tip: button?.getAttribute("data-tooltip-text") ?? "", text: button?.textContent.trim() ?? "" };
    button.click();
    await until(() => W()?.querySelector(".acks-extras-sacrifice-body") && W()?.querySelector('[data-action="sacrifice"]'));
    await sleep(300);
    out.opened = !!W();
    return out;`, ids);
  check("the Judge's seat draws a Sacrifice… button on the casting strip beside the power tags, its tooltip naming the caster and the page, and a real click opens the window", b1.onStrip && b1.beside && /QA Sacrifice Caster/.test(b1.tip) && /RR/.test(b1.tip) && b1.opened, b1);
  const b2 = await run(player, U, `
    const button = await sheetButton();
    return { shown: !!button, tip: button?.getAttribute("data-tooltip-text") ?? "" };`, ids);
  check("the Player's seat draws it too, on a chaotic caster of a divine class, though the caster's ledger holds nothing", b2.shown && /QA Sacrifice Caster/.test(b2.tip), b2);
  const b3 = await player.eval(`(async () => {
    const stranger = fromUuidSync(${JSON.stringify(ids.stranger)});
    await stranger.sheet.render({ force: true });
    await new Promise((r) => setTimeout(r, 1500));
    const shown = !!stranger.sheet.element?.querySelector("[data-sacrifice-open]");
    await stranger.sheet.close({ animate: false });
    return { rendered: true, shown };
  })()`);
  check("a Player's seat draws no button on a character with no divine class and no mark", b3.rendered && b3.shown === false, b3);
  const w1 = await run(gm, U, `
    const root = W();
    const empty = { rows: rowsOf().length, lines: lines(), disabled: btn()?.getAttribute("aria-disabled") === "true", describedBy: btn()?.getAttribute("aria-describedby") ?? "" };
    await drop(ID.lawful);
    const rows = rowsOf();
    const row = root.querySelector('.acks-extras-bucket__row[data-uuid="' + ID.lawful + '"]');
    const figure = row?.querySelector(".acks-extras-bucket__figure");
    const firstCheck = row?.querySelector("[data-victim]");
    return {
      empty,
      classes: { scroll: root.classList.contains("acks-extras-scroll"), frame: root.classList.contains("acks-extras-frame-vars"), resize: !!root.querySelector(".window-resize-handle") },
      title: root.querySelector(".window-title")?.textContent ?? "",
      body: !!root.querySelector(".acks-extras-sacrifice-body"), foot: !!root.querySelector(".acks-extras-cast-foot"), footInBody: !!root.querySelector(".acks-extras-sacrifice-body .acks-extras-cast-foot"),
      rows: rows.length, rowText: rows[0]?.text ?? "",
      valueTip: figure?.getAttribute("data-tooltip-text") ?? "",
      art: !!row?.querySelector(".acks-extras-bucket__art img, .acks-extras-bucket__art i"),
      removeLabel: row?.querySelector(".acks-extras-bucket__x")?.getAttribute("aria-label") ?? "",
      toggles: [...(row?.querySelectorAll("[data-victim]") ?? [])].map((e) => (e.dataset.field ?? (e.dataset.trait !== undefined ? "trait" + e.dataset.trait : "value"))),
      inRow: !!firstCheck && !!firstCheck.closest(".acks-extras-bucket__extra") && !!figure && !!(figure.compareDocumentPosition(firstCheck) & Node.DOCUMENT_POSITION_FOLLOWING),
      noStates: !root.querySelector(".acks-extras-sacrifice-states"),
      tips: [...root.querySelectorAll(".acks-extras-bucket__extra label, .acks-extras-sacrifice-band label")].every((l) => (l.getAttribute("data-tooltip-text") ?? "").length > 0),
      unboundLabels: [...root.querySelectorAll("label")].filter((l) => !l.control).length,
      badIds: [...root.querySelectorAll("[id]")].filter((e) => e.id !== root.id && !e.id.startsWith(root.id)).length,
    };`, ids);
  check("the window opens titled for the caster inside the scroll contract, with a drag corner and a body that scrolls apart from its pinned footer", /QA Sacrifice Caster/.test(w1.title) && w1.classes.scroll && w1.classes.frame && w1.classes.resize && w1.body && w1.foot && !w1.footInBody, w1);
  check("with no victim the Sacrifice button is disabled and says why; the dropped creature is one row with its picture, its XP value and the page in the value's tooltip", w1.empty.rows === 0 && w1.empty.disabled && w1.empty.lines.some((l) => l.sev === "block") && w1.rows === 1 && /100/.test(w1.rowText) && w1.art && /RR/.test(w1.valueTip) && /QA Sacrifice Lawful/.test(w1.removeLabel), { empty: w1.empty, rows: w1.rows, rowText: w1.rowText, valueTip: w1.valueTip });
  check("a lawful creature's checks sit inside its own row under the value line (helpless, the imported traits, young, a Judge's value box), each labelled with a tooltip, with no section of states, no literal id and no label left unbound", w1.toggles.join() === "helpless,trait0,trait1,young,value" && w1.inRow && w1.noStates && w1.tips && w1.unboundLabels === 0 && w1.badIds === 0, { toggles: w1.toggles, inRow: w1.inRow, tips: w1.tips, unbound: w1.unboundLabels, badIds: w1.badIds });
  check("the disabled button (no victim yet) is described by the verdict list that carries the reason", w1.empty.describedBy.length > 0 && w1.empty.describedBy.endsWith("-why"), w1.empty.describedBy);

  section("2. the facts are the owner's: the Player who owns the caster sets them, the Judge's window shows them live, and the Player's Sacrifice frees itself once nothing blocks it");
  const g1 = await run(gm, U, `
    return { lines: lines(), enabled: btn()?.getAttribute("aria-disabled") !== "true", stored: caster().flags?.["acks-extras"]?.magic?.sacrifice?.list?.map((v) => v.uuid) };`, ids);
  check("at the Judge's seat a victim not helpless and no site are two warnings, none a block, and the button is live; the dropped victim is stored on the caster", g1.lines.length === 2 && g1.lines.every((l) => l.sev === "warn") && g1.enabled && g1.stored?.join() === ids.lawful, g1);
  const g2 = await run(player, U, `
    await open();
    await until(() => W().querySelector('.acks-extras-bucket__row[data-uuid="' + ID.lawful + '"]'), 80);
    const row = W().querySelector('.acks-extras-bucket__row[data-uuid="' + ID.lawful + '"]');
    const out = {
      rows: rowsOf().length,
      inputsInRow: row?.querySelectorAll("input").length ?? -1,
      value: !!W().querySelector("[data-value]"),
      siteEnabled: W().querySelector('input[name="site"]')?.disabled === false,
      power: !!W().querySelector('input[name="power"]'),
      lines: lines(),
      disabled: btn()?.getAttribute("aria-disabled") === "true",
    };
    const snap = { balance: balance("divine"), dead: dead(ID.lawful) };
    btn().click();
    await sleep(1500);
    out.after = { same: snap.balance === balance("divine") && snap.dead === dead(ID.lawful), balance: balance("divine"), dead: dead(ID.lawful), rows: rowsOf().length };
    return out;`, ids);
  check("the Judge's dropped victim shows in the Player's own window though the Player dropped nothing, and the Player, who owns the caster, is drawn the controls: an input in the row, the value box, the class-power check and an enabled site check", g2.rows === 1 && g2.inputsInRow > 0 && g2.value && g2.power && g2.siteEnabled, g2);
  check("an owner's footer waits on no one: its verdicts name the site and the helpless victim as they stand, none is a \"Waiting on\" line, the Sacrifice button is disabled, and pressing it changes nothing: no power gained, no victim marked", g2.lines.length >= 1 && g2.lines.every((l) => l.sev !== "wait") && g2.lines.some((l) => /site/i.test(l.text)) && g2.disabled && g2.after.same && g2.after.balance === 0 && g2.after.dead === false && g2.after.rows === 1, { lines: g2.lines, disabled: g2.disabled, after: g2.after });
  const g3 = await run(player, U, `
    await tick('input[name="site"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-field="helpless"]', true);
    const box = W().querySelector('input[data-victim="' + ID.lawful + '"][data-value]');
    if (box) { box.value = "100"; box.dispatchEvent(new Event("change", { bubbles: true })); }
    const mine = () => caster().flags?.["acks-extras"]?.magic?.sacrifice;
    await until(() => mine()?.site === true && mine()?.list?.[0]?.helpless === true && Number(mine()?.list?.[0]?.value) === 100, 100);
    await until(() => btn()?.getAttribute("aria-disabled") !== "true", 80);
    return { boxed: !!box, site: mine()?.site, helpless: mine()?.list?.[0]?.helpless, value: Number(mine()?.list?.[0]?.value), lines: lines(), enabled: btn()?.getAttribute("aria-disabled") !== "true", yields: yields() };`, ids);
  check("the Player ticks the site and the victim's helpless check and types the victim's value: each write lands on the caster's record through the GM's client, the verdicts clear, the yield still reads 100 and the Player's Sacrifice is live", g3.boxed && g3.site === true && g3.helpless === true && g3.value === 100 && g3.lines.length === 0 && g3.enabled && g3.yields[0] === "100", g3);
  const g4 = await run(gm, U, `
    const helpless = () => W().querySelector('input[data-victim="' + ID.lawful + '"][data-field="helpless"]');
    await until(() => W().querySelector('input[name="site"]')?.checked === true && helpless()?.checked === true, 80);
    return { site: W().querySelector('input[name="site"]')?.checked === true, helpless: helpless()?.checked === true, value: W().querySelector('input[data-victim="' + ID.lawful + '"][data-value]')?.value ?? null, lines: lines() };`, ids);
  check("the Judge's open window shows what the Player set, live with no reload: the site and the helpless check ticked, the value typed, and no verdict left", g4.site && g4.helpless && Number(g4.value) === 100 && g4.lines.length === 0, g4);
  const d1 = await run(player, U, `
    const L = await import("/modules/acks-extras/scripts/magic/sacrifice-record-live.mjs");
    const mine = () => caster().flags?.["acks-extras"]?.magic?.sacrifice?.site;
    const off = await L.writeRecord(caster(), { op: "judge", site: false });
    await until(() => mine() === false, 60);
    const afterOff = mine();
    const on = await L.writeRecord(caster(), { op: "judge", site: true });
    await until(() => mine() === true, 60);
    const afterOn = mine();
    const stranger = fromUuidSync(ID.stranger);
    const refused = await L.writeRecord(stranger, { op: "judge", site: true });
    await sleep(800);
    return { off, afterOff, on, afterOn, refused, stranger: stranger.flags?.["acks-extras"]?.magic?.sacrifice ?? null };`, ids);
  check("the owning Player's own `judge` write is admitted by the GM's client from the attested sender: the site reads back unticked, then ticked again", d1.off?.ok === true && d1.afterOff === false && d1.on?.ok === true && d1.afterOn === true, { off: d1.off, afterOff: d1.afterOff, on: d1.on, afterOn: d1.afterOn });
  check("a non-owner seat's `judge` write, the Player's on a caster it only observes, is refused `owner` by the GM's client and writes no record", d1.refused?.ok === false && d1.refused?.reason === "owner" && d1.stranger === null, { refused: d1.refused, record: d1.stranger });
  const d2 = await run(player, U, `
    await drop(ID.chaotic);
    const row = await until(() => W().querySelector('.acks-extras-bucket__row[data-uuid="' + ID.chaotic + '"]'), 80);
    return { rows: rowsOf().length, stored: caster().flags?.["acks-extras"]?.magic?.sacrifice?.list?.map((v) => v.uuid), row: !!row };`, ids);
  const d3 = await run(gm, U, `
    await until(() => W().querySelector('.acks-extras-bucket__row[data-uuid="' + ID.chaotic + '"]'), 80);
    return { rows: rowsOf().length };`, ids);
  check("a victim the Player drops is written through the GM's client: it is stored on the caster and the Judge's window shows its row live", d2.row && d2.stored?.includes(ids.chaotic) && d3.rows === 2, { d2, d3 });
  const d4 = await run(player, U, `
    W().querySelector('.acks-extras-bucket__row[data-uuid="' + ID.chaotic + '"] .acks-extras-bucket__x').click();
    await until(() => !W().querySelector('.acks-extras-bucket__row[data-uuid="' + ID.chaotic + '"]'), 80);
    return { rows: rowsOf().length, stored: caster().flags?.["acks-extras"]?.magic?.sacrifice?.list?.map((v) => v.uuid) };`, ids);
  check("the Player's X on that row removes it from the stored record", d4.rows === 1 && d4.stored?.join() === ids.lawful, d4);
  await run(gm, U, `
    await until(() => rowsOf().length === 1, 80);
    return true;`, ids);
  const g5 = await run(gm, U, `
    await caster().update({ "system.details.alignment": "Lawful" });
    await open();
    const lawfulCaster = lines();
    await caster().update({ "system.details.alignment": "Chaotic" });
    await open();
    return { lawfulCaster, cleared: lines(), yields: yields() };`, ids);
  check("a lawful caster's sapient victim is a warning at the Judge's seat that names the victim, and with the caster chaotic again it clears", g5.lawfulCaster.length === 1 && g5.lawfulCaster[0].sev === "warn" && /QA Sacrifice Lawful/.test(g5.lawfulCaster[0].text) && g5.cleared.length === 0, g5);

  section("3. a successful sacrifice made by the Player: divine power on the ledger, the victim marked dead and never deleted, the record cleared");
  await rig(20);
  await run(player, U, `
    await tick('input[data-victim="' + ID.lawful + '"][data-trait="0"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-trait="1"]', true);
    return true;`, ids);
  const a1 = await run(player, U, `
    await until(() => yields().join() === "100,1100", 80);
    const shown = { yields: yields(), lines: lines(), enabled: btn()?.getAttribute("aria-disabled") !== "true" };
    const snap = before();
    btn().click();
    await until(() => cardsSince(snap).length > 0, 150);
    await sleep(1200);
    const cards = cardsSince(snap).map((m) => ({ id: m.uuid, success: /is-success/.test(String(m.content)), power: /1200/.test(String(m.content)), dead: /QA Sacrifice Lawful: marked dead/.test(String(m.content).replace(/<[^>]*>/g, "")), rolls: m.rolls?.length ?? 0 }));
    await until(() => rowsOf().length === 0, 80);
    return { shown, cards, rows: rowsOf().length, record: caster().flags?.["acks-extras"]?.magic?.sacrifice ?? null };`, ids);
  for (const c of a1.cards) { tracked.push(c.id); gm.track(c.id, "ChatMessage"); }
  const a2 = await run(gm, U, `
    await until(() => rowsOf().length === 0, 80);
    return { balance: balance("divine"), arcane: balance("arcane"), dead: dead(ID.lawful), exists: !!fromUuidSync(ID.lawful), overlay: fromUuidSync(ID.lawful).effects.some((e) => e.statuses?.has("dead")), rows: rowsOf().length, entries: (caster().flags?.["acks-extras"]?.power?.divine?.entries ?? []).length };`, ids);
  check("before the press the Player, who ticked both traits, reads the yield as the XP value now and the traits' sum on a success (100 and (4 + 7) x 100 = 1100), with nothing waiting and the button live", a1.shown.yields.join() === "100,1100" && a1.shown.lines.length === 0 && a1.shown.enabled, a1.shown);
  check("the Player's act lands 1200 divine power on the ledger as one entry and none on the arcane ledger; the victim is marked dead through the GM's client, still exists, and left the bucket on both seats", a2.balance === 1200 && a2.arcane === 0 && a2.entries === 1 && a2.dead && a2.exists && a2.overlay && a2.rows === 0 && a1.rows === 0, { a1rows: a1.rows, a2 });
  check("one card posts, a success naming the power gained and the victim marked dead, spoken as the caster with the die; the record is cleared from the caster", a1.cards.length === 1 && a1.cards[0].success && a1.cards[0].power && a1.cards[0].dead && a1.cards[0].rolls === 1 && a1.record === null, { cards: a1.cards, record: a1.record });

  section("4. a failed throw gives the base yield and nothing of the traits; the victim is marked all the same");
  await rig(2);
  const f1 = await run(gm, U, `
    ${RESET}
    await open();
    await drop(ID.lawful);
    await tick('input[name="site"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-field="helpless"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-trait="0"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-trait="1"]', true);
    const snap = before();
    btn().click();
    await until(() => cardsSince(snap).length > 0, 100);
    await sleep(900);
    return { cards: cardsSince(snap).map((m) => ({ id: m.uuid, failure: /is-failure/.test(String(m.content)) })), balance: balance("divine"), dead: dead(ID.lawful) };`, ids);
  for (const c of f1.cards) { tracked.push(c.id); gm.track(c.id, "ChatMessage"); }
  check("a natural 2 against the ladder's rung fails: 100 divine power, none of the 1100 in traits, the victim dead, one failure card", f1.balance === 100 && f1.dead && f1.cards.length === 1 && f1.cards[0].failure, f1);

  section("5. an unwilling chaotic victim yields nothing and is not blocked; with a willing one it yields");
  await rig(20);
  const u1 = await run(gm, U, `
    ${RESET}
    await open();
    await drop(ID.chaotic);
    await tick('input[name="site"]', true);
    const unwilling = { lines: lines(), yields: yields(), row: rowsOf()[0], enabled: btn()?.getAttribute("aria-disabled") !== "true", boxes: [...W().querySelectorAll("[data-victim][data-field]")].map((e) => e.dataset.field) };
    const snap = before();
    btn().click();
    await until(() => cardsSince(snap).length > 0, 100);
    await sleep(900);
    const act = { cards: cardsSince(snap).map((m) => ({ id: m.uuid, rolls: m.rolls?.length ?? 0 })), balance: balance("divine"), dead: dead(ID.chaotic), rows: rowsOf().length };
    await tick('input[data-victim="' + ID.chaotic + '"][data-field="willing"]', true);
    const willing = { yields: yields(), off: rowsOf()[0]?.off };
    return { unwilling, act, willing };`, ids);
  for (const c of u1.act.cards) { tracked.push(c.id); gm.track(c.id, "ChatMessage"); }
  check("an unwilling chaotic victim is a dimmed row with its reason, willing and young checks, no verdict and a live button; its yield now reads zero", u1.unwilling.lines.length === 0 && u1.unwilling.row.off && u1.unwilling.boxes.join() === "willing,young" && u1.unwilling.enabled && u1.unwilling.yields[0] === "0", u1.unwilling);
  check("pressing Sacrifice yields nothing: a card with no die, no power gained, the victim neither marked dead nor removed from the bucket", u1.act.cards.length === 1 && u1.act.cards[0].rolls === 0 && u1.act.balance === 0 && u1.act.dead === false && u1.act.rows === 1, u1.act);
  check("ticking willing makes it count: the yield now reads the creature's own XP value (40) and the row is no longer dimmed", u1.willing.yields[0] === "40" && u1.willing.off === false, u1.willing);

  section("6. the class power: arcane power through the imported multiple, base and traits alike");
  await rig(20);
  const p1 = await run(gm, U, `
    ${RESET}
    await open();
    await drop(ID.lawful);
    await tick('input[name="site"]', true);
    await tick('input[name="power"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-field="helpless"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-trait="0"]', true);
    const label = W().querySelector(".acks-extras-sacrifice-yield dt")?.textContent.trim();
    const shown = yields();
    const snap = before();
    btn().click();
    await until(() => cardsSince(snap).length > 0, 100);
    await sleep(900);
    return { label, shown, cards: cardsSince(snap).map((m) => m.uuid), arcane: balance("arcane"), divine: balance("divine"), dead: dead(ID.lawful) };`, ids);
  for (const c of p1.cards) { tracked.push(c); gm.track(c, "ChatMessage"); }
  check("with the class power ticked the yield is arcane: (100) x 6 now and (4 x 100) x 6 on a success, and the act lands 3000 on the arcane ledger and none on the divine", p1.shown.join() === "600,2400" && p1.arcane === 3000 && p1.divine === 0 && p1.dead && p1.cards.length === 1, p1);

  section("7. a figure not read holds the act for everyone");
  const h1 = await run(gm, U, `
    ${RESET}
    await caster().update({ "system.details.level": 9 });
    await open();
    await drop(ID.lawful);
    await tick('input[name="site"]', true);
    await tick('input[data-victim="' + ID.lawful + '"][data-field="helpless"]', true);
    const out = { lines: lines(), disabled: btn()?.getAttribute("aria-disabled") === "true", yields: yields() };
    const snap = before();
    btn().click();
    await sleep(1500);
    out.after = { cards: cardsSince(snap).length, dead: dead(ID.lawful), balance: balance("divine") };
    await caster().update({ "system.details.level": 4 });
    await open();
    out.restored = { disabled: btn()?.getAttribute("aria-disabled") === "true", lines: lines().length };
    return out;`, ids);
  check("with no ladder rung for the caster's level the Judge's Sacrifice is disabled with the reason and the page; pressing it posts no card and marks no one", h1.disabled && h1.lines.some((l) => l.sev === "block" && /RR|\bp\./.test(l.text)) && h1.after.cards === 0 && h1.after.dead === false && h1.after.balance === 0, h1);
  check("the yield is still shown while the throw is held, and reading the rung again lifts the hold", h1.yields[0] === "100" && h1.restored.disabled === false && h1.restored.lines === 0, { yields: h1.yields, restored: h1.restored });

  section("8. a Player's mark is relayed to the GM's client, and refused for a caster the Player does not own");
  const r1 = await run(player, U, `
    const L = await import("/modules/acks-extras/scripts/magic/sacrifice-live.mjs");
    const writable = fromUuidSync(ID.lawful).canUserModify(game.user, "update");
    const done = await L.markVictims({ uuid: U }, [ID.lawful]);
    await until(() => dead(ID.lawful), 80);
    return { writable, marked: done.marked, failed: done.failed, refused: done.refused, deadHere: dead(ID.lawful), exists: !!fromUuidSync(ID.lawful) };`, ids);
  check("the Player's seat cannot write the creature, so it asks the GM's client, which marks it dead for the owner of the caster; nothing is deleted", r1.writable === false && r1.marked.join() === ids.lawful && r1.failed.length === 0 && r1.deadHere && r1.exists, r1);
  const r2 = await run(player, U, `
    const L = await import("/modules/acks-extras/scripts/magic/sacrifice-live.mjs");
    const done = await L.markVictims({ uuid: ID.stranger }, [ID.chaotic]);
    await sleep(1200);
    return { marked: done.marked, refused: done.refused, deadHere: dead(ID.chaotic) };`, ids);
  check("the same request naming a caster the Player does not own is refused by the GM's client and marks no one", r2.marked.length === 0 && r2.refused === "owner" && r2.deadHere === false, r2);

  const r3 = await run(player, U, `
    const L = await import("/modules/acks-extras/scripts/magic/sacrifice-record-live.mjs");
    const stranger = fromUuidSync(ID.stranger);
    const refused = await L.writeRecord(stranger, { op: "add", uuid: ID.chaotic });
    await sleep(1200);
    return { refused, stored: stranger.flags?.["acks-extras"]?.magic?.sacrifice ?? null };`, ids);
  check("a Player's drop on a caster the Player does not own is refused by the GM's client (owner) and writes no record", r3.refused?.ok === false && r3.refused?.reason === "owner" && r3.stored === null, r3);

  section("9. an owner's close clears the record and keeps the class-power mark");
  await run(gm, U, `${RESET} return true;`, ids);
  const c1 = await run(player, U, `
    const rec = () => caster().flags?.["acks-extras"]?.magic?.sacrifice ?? null;
    await close();
    await open();
    await drop(ID.lawful);
    await tick('input[name="site"]', true);
    await until(() => rec()?.site === true, 60);
    const open1 = { site: rec()?.site, victims: rec()?.list?.length ?? 0 };
    await close();
    await until(() => rec() === null, 80);
    return { open1, after: rec() };`, ids);
  check("the Player who owns the caster drops a victim and ticks the site, then closes the window from its own seat: the record is cleared from the caster", c1.open1.site === true && c1.open1.victims === 1 && c1.after === null, c1);
  await run(gm, U, `
    const L = await import("/modules/acks-extras/scripts/magic/sacrifice-record-live.mjs");
    await caster().update({ "system.details.alignment": "Lawful" });
    const marked = await L.writeRecord(caster(), { op: "judge", power: true });
    await until(() => caster().flags?.["acks-extras"]?.magic?.sacrifice?.power === true, 60);
    return marked;`, ids);
  const c2 = await run(player, U, `
    const rec = () => caster().flags?.["acks-extras"]?.magic?.sacrifice ?? null;
    await close();
    await open();
    await drop(ID.lawful);
    await tick('input[name="site"]', true);
    await until(() => rec()?.site === true, 60);
    const open2 = { site: rec()?.site, power: rec()?.power, victims: rec()?.list?.length ?? 0, powerBox: W().querySelector('input[name="power"]')?.checked === true };
    await close();
    await until(() => (rec()?.list?.length ?? 0) === 0 && rec()?.site === false, 80);
    const after = rec();
    const sheet = caster().sheet;
    await sheet.close({ animate: false });
    const stripButton = !!(await sheetButton());
    return { open2, after, stripButton };`, ids);
  check("with the class power marked on a Lawful caster, the owner's close takes the victims and the site and leaves the mark: the record reads site off, power on, no victims, and the Player's strip button is still drawn", c2.open2.site === true && c2.open2.power === true && c2.open2.victims === 1 && c2.open2.powerBox && c2.after?.site === false && c2.after?.power === true && c2.after?.list?.length === 0 && c2.stripButton, c2);

  section("10. a seat that only observes the caster reads the checks as text under the waiting line");
  await run(gm, U, `${RESET} return true;`, ids);
  const o0 = await run(gm, ids.observed, `
    const L = await import("/modules/acks-extras/scripts/magic/sacrifice-record-live.mjs");
    const added = await L.writeRecord(caster(), { op: "add", uuid: ID.lawful });
    await until(() => caster().flags?.["acks-extras"]?.magic?.sacrifice?.list?.length === 1, 60);
    return { added, victims: caster().flags?.["acks-extras"]?.magic?.sacrifice?.list?.length ?? 0 };`, ids);
  check("the Judge's seat drops a victim on the observed caster", o0.added?.ok === true && o0.victims === 1, o0);
  const o1 = await run(player, ids.observed, `
    await acksExtras.magic.sacrifice.open(caster());
    await until(() => W()?.querySelector('.acks-extras-bucket__row[data-uuid="' + ID.lawful + '"]'), 80);
    await sleep(300);
    const row = W().querySelector('.acks-extras-bucket__row[data-uuid="' + ID.lawful + '"]');
    const site = W().querySelector('input[name="site"]');
    return {
      owner: caster().isOwner, rows: rowsOf().length,
      inputsInRow: row?.querySelectorAll("input").length ?? -1,
      readonly: row?.querySelector(".acks-extras-sacrifice-readonly")?.textContent.trim() ?? "",
      value: !!W().querySelector("[data-value]"), power: !!W().querySelector('input[name="power"]'),
      site: site ? (site.disabled ? "disabled" : "enabled") : "absent",
      lines: lines(), disabled: btn()?.getAttribute("aria-disabled") === "true",
    };`, ids);
  check("the Player seat that is no owner of the caster reads the Judge's victim with its checks as text and no input, no value box and no class-power check, and the site check unavailable", o1.owner === false && o1.rows === 1 && o1.inputsInRow === 0 && /helpless/i.test(o1.readonly) && o1.value === false && o1.power === false && o1.site !== "enabled", o1);
  check("its footer carries the waiting line, \"Waiting on the caster's owner\", and the Sacrifice button is disabled", o1.lines.some((l) => l.sev === "wait" && /Waiting on the caster's owner/.test(l.text)) && !o1.lines.some((l) => /Waiting on the Judge/.test(l.text)) && o1.disabled, { lines: o1.lines, disabled: o1.disabled });
  const o2 = await run(player, ids.observed, `
    const L = await import("/modules/acks-extras/scripts/magic/sacrifice-record-live.mjs");
    const rec = () => caster().flags?.["acks-extras"]?.magic?.sacrifice ?? null;
    const judge = await L.writeRecord(caster(), { op: "judge", site: true });
    const add = await L.writeRecord(caster(), { op: "add", uuid: ID.chaotic });
    await sleep(1000);
    const held = { site: rec()?.site, victims: rec()?.list?.length ?? 0 };
    await close();
    await sleep(1500);
    return { judge, add, held, afterClose: { site: rec()?.site, victims: rec()?.list?.length ?? 0 } };`, ids);
  check("the observer's `judge` and `add` ops are refused `owner` and change nothing, and closing its window leaves the record where it was", o2.judge?.reason === "owner" && o2.add?.reason === "owner" && o2.held.site === false && o2.held.victims === 1 && o2.afterClose.site === false && o2.afterClose.victims === 1, o2);

  section("Teardown");
  for (const seat of [gm, player]) await run(seat, U, `await close(); await caster().sheet.close({ animate: false });`, ids);
  await run(player, ids.observed, `await close();`, ids);
  await run(gm, U, `
    ${RESET}
    ${tablesKit}
    for (const id of ${JSON.stringify(TABLE_IDS)}) await STORE.clearOverride(D, id);
    return true;`, ids);
  overrode = false;
  console.log("fixtures kept: magic/sacrifice-class, magic/sacrifice-caster, magic/sacrifice-stranger, magic/sacrifice-observed, magic/sacrifice-lawful, magic/sacrifice-chaotic");
  walkDone();
} catch (e) {
  if (!(e instanceof WalkBlocked)) console.log("WALK ERROR:", e?.stack ?? e);
} finally {
  try {
    if (gm && overrode) console.log(`overrides cleared: ${await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); for (const id of ${JSON.stringify(TABLE_IDS)}) await S.clearOverride("magicResearch", id); return ${JSON.stringify(TABLE_IDS)}.every((id) => !S.hasOverride("magicResearch", id)); })()`)}`);
  } catch {}
  try {
    if (rigged) for (const seat of [gm, player]) if (seat) await seat.eval(`(() => { if (globalThis.__saDice) { CONFIG.Dice.randomUniform = globalThis.__saDice; delete globalThis.__saDice; } return true; })()`);
  } catch {}
  try {
    if (gm && tracked.length) console.log("swept:", JSON.stringify(await gm.sweepTracked({ only: tracked })));
  } catch (e) { console.log("sweep:", e?.message ?? e); }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  try { player?.close?.(); } catch {}
  try { gm?.close?.(); } catch {}
  process.exitCode = failed ? 1 : 0;
}
