/**
 * Live walk, magic-rung-editor: the inline editor for an imported
 * invocation-level ladder. Walks docs/magic/TESTING.md "The rung editor" on the
 * GM seat and a Player seat: the kind switch is a button group (Flat, By caster
 * level, By invocation level) and no window of its own opens; in the effect-row
 * editor the rungs are a draft, so an edited, added and removed rung writes
 * nothing, another field of the row still writes on change and leaves the draft
 * standing, an invalid draft keeps Save row off with its verdict in a pinned
 * footer, Restore puts edited rungs back and drops added ones, Cancel drops the
 * draft, and Save row writes the row once with the by-hand marks. The Overview's
 * figure behaves the same inline, and its own submit leaves the draft alone.
 * The edit right is the document's, never the role: a Player who owns the spell
 * edits its rungs, puts a figure on the invocation scale, saves, and ticks the
 * Overview's Unaudited mark; a Player who only observes a second spell sees its
 * rungs read-only, with no footer, no Unaudited mark and no write sent.
 *
 * Fixtures: two spell Items the walk creates, one owned by everyone and one
 * every player only observes, tracked by uuid so the closing sweep deletes
 * exactly them. They name no book word and hold invented figures. Prints counts
 * and booleans only.
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

/** Every document the walk made, by uuid. */
const own = [];
let gm;
let player;
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
// A sweep of the walk's own documents. What it swept leaves `own` too, so a later sweep never names a uuid the ledger no longer holds (which refuses the whole sweep).
const sweepStep = async (uuids) => {
  const out = await gm.sweepTracked({ only: uuids });
  for (const uuid of uuids) {
    const at = own.indexOf(uuid);
    if (at >= 0) own.splice(at, 1);
  }
  return out;
};

const ladder = (...rungs) => ({ kind: "conditional", on: "invocationLevel", breakpoints: rungs.map(([atLevel, value]) => ({ atLevel, value, outcome: "", text: "" })) });
const FIGURE = () => ladder([1, 3], [3, 5], [5, 8]);

/** The page helpers every step shares, for the spell at `uuid`. */
const kit = (uuid) => `
  const U = ${JSON.stringify(uuid)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, n = 60) => { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const doc = () => fromUuidSync(U);
  const apps = () => [...foundry.applications.instances.values()];
  const editor = () => apps().find((a) => a.element?.classList?.contains("acks-extras-effect-editor"));
  const flag = () => doc().getFlag("acks-extras", "spell") ?? {};
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const type = (el, v) => { el.value = String(v); fire(el, "input"); fire(el, "change"); };
  const ladderEl = (root, key) => [...root.querySelectorAll("[data-rung-ladder]")].find((e) => e.dataset.rungLadder === key);
  const atBox = (root, key, i) => ladderEl(root, key)?.querySelector('[data-rung-at="' + i + '"]');
  const figBox = (root, key, i) => ladderEl(root, key)?.querySelector('[data-rung-value="' + i + '"]');
  const read = (root, key) => [...(ladderEl(root, key)?.querySelectorAll("[data-rung-at]") ?? [])].map((a) => ({ at: a.value, value: figBox(root, key, a.dataset.rungAt).value }));
  const edgeCount = (root, key) => ladderEl(root, key)?.querySelectorAll("input.is-edited").length ?? 0;
  const act = (root, key, action) => [...root.querySelectorAll('[data-action="' + action + '"]')].find((b) => (b.dataset.rungKeys ?? b.dataset.rungKey ?? "").split(" ").includes(key));
  const rowValue = () => (flag().effects ?? [])[0]?.value;
  const marks = (lv) => (lv?.breakpoints ?? []).map((b) => [b.atLevel, b.value, b.hand ?? "", b.was ?? null]);
  const openEditor = async () => {
    const d = doc();
    await d.sheet.render({ force: true, tab: "mechanics" });
    await until(() => d.sheet.rendered);
    d.sheet.changeTab?.("mechanics", "primary");
    const b = await until(() => d.sheet.element.querySelector('[data-action="effectEdit"][data-index="0"]'));
    b.click();
    return await until(editor);
  };
  const openOverview = async () => {
    const d = doc();
    await d.sheet.render({ force: true, tab: "overview" });
    await until(() => d.sheet.rendered && d.sheet.element.querySelector("[data-figure]"));
    return d.sheet;
  };
  const closeAll = async () => { await editor()?.close(); await doc()?.sheet?.close(); };
`;
const run = (seat, uuid, body) => seat.eval(`(async () => { ${kit(uuid)} ${body} })()`);
const counter = `__rungWalk.updates`;

try {
  gm = await connect({ browser: M.browser, origin: M.origin, user: M.gm, port: PORTS.gm, own: M.own });
  player = await connect({ browser: M.browser, origin: M.origin, user: M.player, port: PORTS.player, own: M.own });

  section("Boot");
  const seated = await gm.eval(`({ gm: game.user.isGM, active: game.users.filter((u) => u.active).map((u) => u.name) })`);
  const playerSeat = await player.eval(`({ gm: game.user.isGM, name: game.user.name })`);
  console.log(`seated: ${JSON.stringify(seated.active)}`);
  if (!seated.gm) blocked("the first seat is not a GM");
  if (playerSeat.gm) blocked("the second seat is a GM, so a Player's read-only view cannot be walked");

  const created = await gm.create(
    "Item",
    {
      name: "QA Rung Spell",
      type: "spell",
      ownership: { default: 3 },
      flags: { "acks-extras": { spell: { target: { model: "creature", count: FIGURE() }, effects: [{ key: "_walk-rung", type: "damage", origin: "", value: FIGURE() }] } } },
    },
    {},
  );
  await track(created.uuid, "Item");
  const U = created.uuid;
  await gm.eval(`globalThis.__rungWalk = { updates: 0, keys: [], hook: Hooks.on("updateItem", (item, changes) => { if (item.uuid !== ${JSON.stringify(U)}) return; __rungWalk.updates++; __rungWalk.keys.push(...Object.keys(foundry.utils.flattenObject(changes ?? {})).filter((k) => k !== "_id")); }) }`);
  // A second spell every player only observes: the read-only half of the Player's walk.
  const observed = await gm.create(
    "Item",
    {
      name: "QA Rung Spell Observed",
      type: "spell",
      ownership: { default: 2 },
      flags: { "acks-extras": { spell: { target: { model: "creature", count: FIGURE() }, effects: [{ key: "_walk-rung", type: "damage", origin: "", value: FIGURE() }] } } },
    },
    {},
  );
  await track(observed.uuid, "Item");
  const O = observed.uuid;
  await gm.eval(`__rungWalk.observed = 0; __rungWalk.observedHook = Hooks.on("updateItem", (item) => { if (item.uuid === ${JSON.stringify(O)}) __rungWalk.observed++; });`);
  const start = await run(gm, U, `return { made: !!doc(), rows: (flag().effects ?? []).length, count: marks(flag().target?.count), row: marks(rowValue()) };`);
  check("the fixture spell holds the invented ladder on its row and on the overview's count", start.made && start.rows === 1 && start.row.length === 3 && start.count.length === 3, start);

  section("rung 1. the kind switch is a button group and the rungs open inline, in no window of their own");
  const r1 = await run(gm, U, `
    const ed = await openEditor();
    const root = ed.element;
    const group = root.querySelector('fieldset.acks-extras-effect-value [role="group"]');
    const footer = root.querySelector(".acks-extras-rung-footer");
    const rect = footer?.getBoundingClientRect();
    return {
      buttons: [...(group?.querySelectorAll("button") ?? [])].map((b) => [b.dataset.kind, b.getAttribute("aria-pressed")]),
      select: !!root.querySelector('select[name="value.kind"]'),
      hidden: root.querySelector('input[name="value.kind"]')?.value,
      rungs: read(root, "value").length,
      named: [...root.querySelectorAll("[data-rung-at], [data-rung-value]")].filter((b) => b.name).length,
      footerShown: !!footer && !footer.hidden && rect.height > 0,
      saveOn: act(root, "value", "rungSave")?.getAttribute("aria-disabled") !== "true",
      windows: apps().filter((a) => a.element?.classList?.contains("acks-extras-rung-editor")).length,
    };`);
  check("the kind switch is three buttons, By invocation level pressed, and no select", JSON.stringify(r1.buttons) === JSON.stringify([["flat", "false"], ["perLevel", "false"], ["invocation", "true"]]) && r1.select === false && r1.hidden === "invocation", r1);
  check("the ladder's three rungs show inline with no form name, in no window of their own", r1.rungs === 3 && r1.named === 0 && r1.windows === 0, r1);
  check("the pinned footer is drawn with Save row on", r1.footerShown && r1.saveOn, r1);

  section("rung 2. an edited, an added and a removed rung write nothing; another field still writes and the draft stands");
  const r2 = await run(gm, U, `
    const root = editor().element;
    const before = ${counter};
    type(figBox(root, "value", 2), 11);
    ladderEl(root, "value").querySelector('[data-action="rungAdd"]').click();
    await until(() => read(editor().element, "value").length === 4);
    let now = editor().element;
    now.querySelector('[data-rung-key="value"][data-action="rungRemove"][data-index="1"]').click();
    await until(() => read(editor().element, "value").length === 3);
    now = editor().element;
    await sleep(500);
    const drafted = read(now, "value");
    const tip = figBox(now, "value", 1)?.getAttribute("data-tooltip-text") ?? "";
    const gold = edgeCount(now, "value");
    const noWrite = ${counter} === before && marks(rowValue()).length === 3;
    const note = now.querySelector('input[name="note"]');
    type(note, "walk-rung-note");
    await until(() => ${counter} === before + 1);
    await sleep(500);
    const after = read(editor().element, "value");
    return { drafted, tip, gold, noWrite, wrote: ${counter} - before, noteStored: (flag().effects ?? [])[0]?.note, after, stored: marks(rowValue()) };`);
  check("the draft shows rung 3's new figure, the added rung and no second rung, with nothing written", JSON.stringify(r2.drafted) === JSON.stringify([{ at: "1", value: "3" }, { at: "5", value: "11" }, { at: "6", value: "" }]) && r2.noWrite, r2);
  check("the edited figure carries the gold edge and a tooltip naming the figure it replaced", r2.gold >= 2 && /8/.test(r2.tip), { gold: r2.gold, tip: r2.tip });
  check("another field of the row wrote on change, once, and the stored ladder is as imported", r2.wrote === 1 && r2.noteStored === "walk-rung-note" && JSON.stringify(r2.stored.map((r) => r.slice(0, 2))) === JSON.stringify([[1, 3], [3, 5], [5, 8]]), { wrote: r2.wrote, stored: r2.stored });
  check("the redraw after that write kept the draft", JSON.stringify(r2.after) === JSON.stringify(r2.drafted), r2.after);

  section("rung 3. an invalid draft keeps Save row off with its verdict in the pinned footer");
  const r3 = await run(gm, U, `
    const root = editor().element;
    const before = ${counter};
    type(atBox(root, "value", 2), read(root, "value")[1].at);
    await sleep(200);
    const state = root.querySelector("[data-rung-state-text]")?.textContent.trim() ?? "";
    const save = act(root, "value", "rungSave");
    const marked = atBox(root, "value", 2).getAttribute("aria-invalid");
    save.click();
    await sleep(600);
    const footer = root.querySelector(".acks-extras-rung-footer").getBoundingClientRect();
    const win = root.getBoundingClientRect();
    return { state: state.length > 0, off: save.getAttribute("aria-disabled"), described: save.getAttribute("aria-describedby") === root.querySelector("[data-rung-state-text]").parentElement.id, marked, wrote: ${counter} - before, pinned: footer.bottom <= win.bottom + 1 && footer.height > 0 };`);
  check("the verdict names the fault, the level box is marked and Save row is off and points at it", r3.state && r3.off === "true" && r3.described && r3.marked === "true", r3);
  check("a click on the off Save row writes nothing, and the footer stays inside the window", r3.wrote === 0 && r3.pinned, r3);

  section("rung 4. Restore puts an edit back and drops an added rung; a removed rung stays removed");
  const r4 = await run(gm, U, `
    const root = editor().element;
    type(atBox(root, "value", 2), 9);
    await sleep(150);
    const before = ${counter};
    ladderEl(root, "value").querySelector('[data-action="rungRestore"]').click();
    await until(() => read(editor().element, "value").length === 2);
    const now = editor().element;
    return { rungs: read(now, "value"), gold: edgeCount(now, "value"), wrote: ${counter} - before, state: now.querySelector("[data-rung-state-text]")?.textContent.trim() };`);
  check("Restore leaves the imported rungs a hand did not remove, with no gold edge and no write", JSON.stringify(r4.rungs) === JSON.stringify([{ at: "1", value: "3" }, { at: "5", value: "8" }]) && r4.gold === 0 && r4.wrote === 0 && r4.state === "", r4);

  section("rung 5. Cancel drops the draft");
  const r5 = await run(gm, U, `
    const root = editor().element;
    const before = ${counter};
    act(root, "value", "rungCancel").click();
    await until(() => read(editor().element, "value").length === 3);
    return { rungs: read(editor().element, "value"), wrote: ${counter} - before };`);
  check("Cancel shows the stored ladder again and writes nothing", JSON.stringify(r5.rungs) === JSON.stringify([{ at: "1", value: "3" }, { at: "3", value: "5" }, { at: "5", value: "8" }]) && r5.wrote === 0, r5);

  section("rung 6. Save row writes the row once, with the by-hand marks");
  const r6 = await run(gm, U, `
    const root = editor().element;
    const before = ${counter};
    type(figBox(root, "value", 2), 11);
    ladderEl(root, "value").querySelector('[data-action="rungAdd"]').click();
    await until(() => read(editor().element, "value").length === 4);
    type(figBox(editor().element, "value", 3), 14);
    act(editor().element, "value", "rungSave").click();
    await until(() => ${counter} === before + 1);
    await sleep(800);
    const now = editor().element;
    return { wrote: ${counter} - before, stored: marks(rowValue()), origin: (flag().effects ?? [])[0]?.origin ?? "", rungs: read(now, "value"), state: now.querySelector("[data-rung-state-text]")?.textContent.trim(), gold: edgeCount(now, "value") };`);
  check("one write, with the edited rung marked and its replaced figure kept, and the added rung marked", r6.wrote === 1 && JSON.stringify(r6.stored) === JSON.stringify([[1, 3, "", null], [3, 5, "", null], [5, 11, "edited", 8], [6, 14, "added", null]]) && r6.origin === "", r6);
  check("after the save the window shows the saved ladder, clean, with the marks as gold edges", r6.rungs.length === 4 && r6.state === "" && r6.gold >= 2, { rungs: r6.rungs.length, gold: r6.gold });

  section("rung 7. the kind buttons apply at once and the ladder returns with its rungs");
  const r7 = await run(gm, U, `
    const root = editor().element;
    const before = ${counter};
    root.querySelector('[data-action="figureKind"][data-field="value"][data-kind="perLevel"]').click();
    await until(() => ${counter} === before + 1 && !ladderEl(editor().element, "value"));
    const away = { kind: rowValue()?.kind, ladder: !!ladderEl(editor().element, "value"), footer: editor().element.querySelector(".acks-extras-rung-footer")?.hidden };
    editor().element.querySelector('[data-action="figureKind"][data-field="value"][data-kind="invocation"]').click();
    await until(() => ${counter} === before + 2 && read(editor().element, "value").length === 4);
    return { away, wrote: ${counter} - before, back: read(editor().element, "value").length, kind: rowValue()?.kind, on: rowValue()?.on };`);
  check("By caster level writes at once and removes the ladder and the footer; By invocation level brings the four rungs back", r7.away.kind === "perLevel" && r7.away.ladder === false && r7.away.footer === true && r7.wrote === 2 && r7.back === 4 && r7.kind === "conditional" && r7.on === "invocationLevel", r7);
  await run(gm, U, `await closeAll();`);

  section("overview 1. the Overview's figure drafts inline: no write on a change, and the sheet's own submit leaves the draft alone");
  await run(gm, U, `await doc().update({ "flags.acks-extras.spell.target.count": ${JSON.stringify(FIGURE())} }); await sleep(300);`);
  const o1 = await run(gm, U, `
    const sheet = await openOverview();
    // Setup: the fixture's flag was written raw, so the sheet's first submit fills the schema's defaults into it. That write is the sheet normalising a hand-made flag, not the draft; it is taken here so the submit under test has nothing left to fill.
    await sheet.submit();
    await sleep(600);
    const root = sheet.element;
    const K = "target.count";
    const group = root.querySelector('[data-figure="' + K + '"] [role="group"]');
    const before = ${counter};
    type(figBox(root, K, 1), 7);
    ladderEl(root, K).querySelector('[data-action="rungAdd"]').click();
    await until(() => read(sheet.element, K).length === 4);
    await sleep(500);
    const draftWrote = ${counter} - before;
    __rungWalk.keys.length = 0;
    await sheet.submit();
    await sleep(600);
    return {
      buttons: [...(group?.querySelectorAll("button") ?? [])].map((b) => [b.dataset.kind, b.getAttribute("aria-pressed")]),
      select: !!root.querySelector('select[name$="target.count.kind"]'),
      rungs: read(sheet.element, K), draftWrote, submitWrote: ${counter} - before - draftWrote,
      submitKeys: [...__rungWalk.keys], stored: marks(flag().target?.count).map((r) => r.slice(0, 2)),
    };`);
  check("the Overview's count is the same button group, By invocation level pressed, with no select", JSON.stringify(o1.buttons) === JSON.stringify([["flat", "false"], ["perLevel", "false"], ["invocation", "true"]]) && o1.select === false, o1.buttons);
  check("the draft's edit and added rung wrote nothing, and survived the sheet's own submit and redraw, which wrote nothing either", o1.draftWrote === 0 && o1.submitWrote === 0 && JSON.stringify(o1.rungs) === JSON.stringify([{ at: "1", value: "3" }, { at: "3", value: "7" }, { at: "5", value: "8" }, { at: "6", value: "" }]) && JSON.stringify(o1.stored) === JSON.stringify([[1, 3], [3, 5], [5, 8]]), o1);

  section("overview 2. an invalid draft keeps Save off, Restore and Cancel behave, and Save writes once");
  const o2 = await run(gm, U, `
    const sheet = doc().sheet;
    const K = "target.count";
    const bar = () => [...sheet.element.querySelectorAll("[data-rung-actions]")].find((b) => b.dataset.rungGroup === K);
    const before = ${counter};
    type(atBox(sheet.element, K, 3), 5);
    await sleep(200);
    const verdict = bar().querySelector("[data-rung-state-text]").textContent.trim();
    const off = bar().querySelector('[data-action="rungSave"]').getAttribute("aria-disabled");
    bar().querySelector('[data-action="rungSave"]').click();
    await sleep(500);
    const blockedWrite = ${counter} - before;
    ladderEl(sheet.element, K).querySelector('[data-action="rungRestore"]').click();
    await until(() => read(sheet.element, K).length === 3);
    const restored = read(sheet.element, K);
    bar().querySelector('[data-action="rungCancel"]').click();
    await sleep(300);
    const cancelled = read(sheet.element, K);
    type(figBox(sheet.element, K, 2), 12);
    await sleep(150);
    bar().querySelector('[data-action="rungSave"]').click();
    await until(() => ${counter} === before + 1);
    await sleep(800);
    return { verdict: verdict.length > 0, off, blockedWrite, restored, cancelled, wrote: ${counter} - before, stored: marks(flag().target?.count), clean: bar().querySelector("[data-rung-state-text]").textContent.trim() === "" };`);
  check("the duplicate level shows a verdict, Save is off and a click writes nothing", o2.verdict && o2.off === "true" && o2.blockedWrite === 0, o2);
  check("Restore dropped the added rung and put the edit back; Cancel left the stored ladder", JSON.stringify(o2.restored) === JSON.stringify([{ at: "1", value: "3" }, { at: "3", value: "5" }, { at: "5", value: "8" }]) && JSON.stringify(o2.cancelled) === JSON.stringify(o2.restored), { restored: o2.restored, cancelled: o2.cancelled });
  check("Save wrote the figure once with the edited rung marked", o2.wrote === 1 && JSON.stringify(o2.stored) === JSON.stringify([[1, 3, "", null], [3, 5, "", null], [5, 12, "edited", 8]]) && o2.clean, { wrote: o2.wrote, stored: o2.stored });
  await run(gm, U, `await closeAll();`);

  section("player 1. a Player who owns the spell edits its rungs and saves them, with no GM press");
  const g0 = await gm.eval(`${counter}`);
  const p1 = await run(player, U, `
    const ed = await openEditor();
    const root = ed.element;
    const footer = root.querySelector(".acks-extras-rung-footer");
    const rect = footer?.getBoundingClientRect();
    const boxes = [...root.querySelectorAll("[data-rung-at], [data-rung-value]")];
    const kinds = [...root.querySelectorAll('[data-action="figureKind"]')].map((b) => [b.dataset.field, b.dataset.kind, b.disabled]);
    const actions = ed.constructor.DEFAULT_OPTIONS.actions;
    const changed = ed.rungs.change("value", 0, { value: 77 });
    await actions.rungSave.call(ed, null, { dataset: { rungKeys: "value" } });
    await until(() => marks(rowValue())[0]?.[1] === 77, 50);
    const out = {
      isGM: game.user.isGM, isOwner: doc().isOwner, boxes: boxes.length, editable: boxes.length > 0 && boxes.every((b) => !b.readOnly),
      footerShown: !!footer && !footer.hidden && (rect?.height ?? 0) > 0, kinds, changed, first: marks(rowValue())[0],
    };
    await closeAll();
    return out;`);
  // The Player's write reaches the GM seat's hook by the server's broadcast, a moment after the Player's own copy shows it.
  const g1 = await gm.eval(`(async () => { for (let i = 0; i < 50 && ${counter} < ${g0} + 1; i++) await new Promise((r) => setTimeout(r, 100)); return ${counter}; })()`);
  check("the Player owns the spell and is no GM, so only ownership can be what opens the editor", p1.isGM === false && p1.isOwner === true, { isGM: p1.isGM, isOwner: p1.isOwner });
  check("the rungs are editable with the pinned footer drawn and every kind button on", p1.editable && p1.footerShown && p1.kinds.length > 0 && p1.kinds.every(([, , off]) => !off), p1);
  check("the Player's Save wrote the edited rung once, marked as a hand's edit", p1.changed === true && p1.first?.[1] === 77 && p1.first?.[2] === "edited" && g1 - g0 === 1, { first: p1.first, writes: g1 - g0 });

  section("player 2. on the Overview the owner puts the count on the invocation scale and ticks Unaudited");
  const g2 = await gm.eval(`${counter}`);
  const p2 = await run(player, U, `
    const sheet = await openOverview();
    const root = sheet.element;
    const K = "target.count";
    const boxes = [...(ladderEl(root, K)?.querySelectorAll("[data-rung-at], [data-rung-value]") ?? [])];
    const kinds = [...root.querySelectorAll('[data-figure="' + K + '"] [data-action="figureKind"]')].map((b) => [b.dataset.kind, b.disabled]);
    const box = root.querySelector('input[type="checkbox"][name$=".unaudited"]');
    const was = flag().unaudited === true;
    if (box) { box.checked = !was; fire(box, "change"); }
    await until(() => (flag().unaudited === true) === !was, 50);
    await closeAll();
    const again = await openOverview();
    const reopened = again.element.querySelector('input[type="checkbox"][name$=".unaudited"]')?.checked;
    await closeAll();
    return { boxes: boxes.length, editable: boxes.length > 0 && boxes.every((b) => !b.readOnly), kinds, box: !!box, was, now: flag().unaudited === true, reopened };`);
  const g3 = await gm.eval(`(async () => { for (let i = 0; i < 50 && ${counter} <= ${g2}; i++) await new Promise((r) => setTimeout(r, 100)); return ${counter}; })()`);
  check("the Overview's ladder is editable and the count's kind buttons are on", p2.editable && p2.kinds.length === 3 && p2.kinds.every(([, off]) => !off), p2);
  check("the Unaudited mark is drawn for the owner, its tick persists across a reopen", p2.box && p2.now === !p2.was && p2.reopened === p2.now && g3 > g2, { ...p2, writes: g3 - g2 });

  section("player 3. a Player who only observes a spell sees its rungs read-only, no Unaudited mark, and sends no write");
  const w0 = await gm.eval(`__rungWalk.observed`);
  // A seat that cannot edit the spell is drawn no row Edit at all, so the row editor is not reachable from it; the Overview is where its rungs show.
  const p3 = await run(player, O, `
    const d = doc();
    await d.sheet.render({ force: true, tab: "mechanics" });
    await until(() => d.sheet.rendered);
    d.sheet.changeTab?.("mechanics", "primary");
    await sleep(300);
    const rowEdit = !!d.sheet.element.querySelector('[data-action="effectEdit"]');
    await closeAll();
    const sheet = await openOverview();
    const root = sheet.element;
    const K = "target.count";
    const boxes = [...(ladderEl(root, K)?.querySelectorAll("[data-rung-at], [data-rung-value]") ?? [])];
    if (boxes[1]) type(boxes[1], 40);
    await sleep(500);
    const view = {
      isOwner: doc().isOwner, rowEdit, boxes: boxes.length, readonly: boxes.every((b) => b.readOnly),
      kinds: [...root.querySelectorAll('[data-figure="' + K + '"] [data-action="figureKind"]')].map((b) => [b.dataset.kind, b.disabled]),
      buttons: root.querySelectorAll('[data-figure="' + K + '"] [data-action^="rung"]').length,
      unaudited: !!root.querySelector('input[type="checkbox"][name$=".unaudited"]'),
      draft: sheet.rungs.draft(K).map((r) => r.at), stored: marks(flag().target?.count).map((r) => r[0]),
    };
    await closeAll();
    return view;`);
  const w1 = await gm.eval(`__rungWalk.observed`);
  check("the observer does not own the spell and is drawn no row Edit", p3.isOwner === false && p3.rowEdit === false, { isOwner: p3.isOwner, rowEdit: p3.rowEdit });
  check("the Overview shows its rungs read-only with no control, the count's kind buttons off, and typing changes nothing", p3.boxes > 0 && p3.readonly && p3.kinds.length === 3 && p3.kinds.every(([, off]) => off) && p3.buttons === 0 && JSON.stringify(p3.draft) === JSON.stringify(p3.stored), p3);
  check("no Unaudited mark is drawn and the GM seat heard no write", p3.unaudited === false && w1 === w0, { unaudited: p3.unaudited, writes: w1 - w0 });

  section("Teardown");
  await gm.eval(`Hooks.off("updateItem", __rungWalk.hook); Hooks.off("updateItem", __rungWalk.observedHook); delete globalThis.__rungWalk;`);
  const swept = await sweepStep([...own]);
  console.log(`sweep: ${JSON.stringify(swept)}`);
  check("the sweep removed the walk's two spells and left nothing missing or refused", (swept.removed?.length ?? 0) === 2 && !(swept.failed?.length) && !(swept.missing?.length), swept);
  walkDone();
} catch (e) {
  if (!(e instanceof WalkBlocked)) console.log("WALK ERROR:", e?.stack ?? e);
  try {
    if (gm && own.length) console.log(`sweep after a fault: ${JSON.stringify(await sweepStep([...own]))}`);
  } catch {}
} finally {
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  try { player?.close?.(); } catch {}
  try { gm?.close?.(); } catch {}
  process.exitCode = failed ? 1 : 0;
}
