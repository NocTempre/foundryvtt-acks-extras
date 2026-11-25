/**
 * Live walk, treasure deal: dealing treasure letters into a staged pot. Walks
 * docs/treasure/TESTING.md "Dealing letters (Judge seat)", steps 1 to 7. The GM
 * seat selects tokens, presses the scene control's tool and the pot's rail the
 * way a Judge does; the Player seat reads a monster sheet it only observes and
 * is refused a deal. Every observable is a boolean or a count: the walk prints
 * no treasure letter, no table figure and no card's content. Machine values
 * arrive through ./_env.mjs; the shared seat plumbing is ./_treasure-kit.mjs.
 *
 * Covers: fixtures (the imported registry, and a treasure type that deals both
 * magic and other cards, chosen in page from the type table's own keys); step 1
 * (three monster tokens and a character's token selected, the Token controls'
 * New treasure pot pressed: a staged pot with two rows under Hoards to deal, the
 * lettered kind at one hoard with its two tokens counted once, the bare kind
 * disabled with its reason, no row for the character, nothing dealt); step 2 (the lair warning
 * raised in the rail naming the toggle, nothing dealt, Cancel clearing it);
 * step 3 (Deal then Deal anyway: face-down cards from one hoard, the
 * notification, No magic and Force cursed honoured); step 4 (Met in their
 * lair: no callout, a second hoard at once, the lair, style and Special
 * choices read back after the window is reopened); step 5 (the list: + and -
 * on a row, - at one removing it, the lettered monster dropped on the drop zone
 * and dropped again, a character refused, the picker opened and a type picked
 * twice, Done, then Deal pressed for the four hoards and the disabled row
 * removed); step 6
 * (a Judge-only Deal beside Treasure type on the Ecology tab, disabled for a
 * monster with no letter, none for an Observer, and its press opening a staged
 * pot with that one row at one hoard and nothing dealt); step 7 (a pot opened to the
 * table has no rail, a deal into it is refused by lang string, a deal for a
 * style with no table says so by lang string and nothing throws); step 8 (jewelry
 * hoards: the classic type whose jewelry cell reads with the best chance, chosen
 * from the cells, set on a fresh pot as ten hoards by the picker's and the row's
 * presses and dealt by Deal on the real dice, which reach every band of the value
 * list; no deal warning or error carries `bad-value`, and every jewelry card the
 * pot holds is valued above zero; a page-side count over forty hoards on the
 * same dice says whether a band printed as a throw was dealt at all).
 *
 * Fixtures, kept and found by marker: `treasure/deal-scene` (a scene),
 * `treasure/monster-lettered` (a monster whose treasure type is the chosen
 * letter, the Player seat Observer on it), `treasure/monster-bare` (a monster
 * whose treasure type is none), `treasure/player-character` (a character the
 * Player seat owns) and `treasure/item-plain` (a plain item, one card for step
 * 7). Each step brings a fixture to its shape before its first check. The
 * tokens, the pots and the doorway card are the run's own, tracked by id and
 * swept by id; kept fixtures stay.
 *
 * Real gestures: the scene control's tool, each rail control (the toggles, the
 * steps and remove buttons, the picker, the style and Special choices, Deal,
 * Deal anyway, Cancel), the monster sheet's Deal and Open to the table are CDP
 * mouse presses at the control's centre when the control is the element under
 * that point. Scripted: the die under a Deal press (the GM page's
 * `CONFIG.Dice.randomUniform` is held at its floor around each Deal so a
 * chance cell always hits, and put back after each; step 8's Deal presses are the
 * exception and run on the real dice), the token selection
 * (`control()`), the scene being viewed, the window's reopen, the Ecology tab's
 * switch, the drops (the actor drop is a `drop` event carrying the drag data a
 * sidebar drag writes), and the refusals of step 7, which have no control.
 *
 * Not reached: step 7's "registry unimported" half. The world's registry is
 * imported and cannot be un-imported on a shared world, the pot offers only the
 * three styles whose tables are imported, and a style with no table is reached
 * only through the API, which says "table style is not available", a different
 * string from "not imported"; no stored choice produces a missing table. Also a
 * Deal with the Special treasure tick on (the tick is read back, not dealt
 * with), a Tab walk through the rail, and the Player seat pressing a Deal (it is
 * offered none).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, run, t, note, section, check, checks, clicks, idOf, openSeats, press, sleep, finish, watchdog } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "treasure/deal-scene",
  lettered: "treasure/monster-lettered",
  bare: "treasure/monster-bare",
  player: "treasure/player-character",
  plain: "treasure/item-plain",
};
const NAMES = { lettered: "QA Deal Lettered", bare: "QA Deal Bare", player: "QA Treasure Player Character" };
const PLAIN = { name: "QA Faces Plain", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 5 } };

const P = {
  ...K,
  /** The first key of the imported classic type table that deals both a magic card and another kind under a floor die, and that still deals cards with No magic on. */
  pickLetter: async () => {
    const T = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    const B = await import("/modules/acks-extras/scripts/importer/treasure-binding.mjs");
    const Hd = await import("/modules/acks-extras/scripts/treasure/hoard.mjs");
    if (!T.hasDoc(B.TREASURE_DOC_ID)) return { imported: false, letter: null, tried: 0 };
    const keys = Object.keys(T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {});
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;
    try {
      for (const letter of keys) {
        const open = await Hd.dealHoard({ letter, style: "classic", toggles: {} });
        const shut = await Hd.dealHoard({ letter, style: "classic", toggles: { noMagic: true } });
        const magic = open.truths.filter((x) => x.pool === "magic").length;
        if (magic > 0 && shut.truths.length > 0 && shut.truths.every((x) => x.pool !== "magic")) return { imported: true, letter, tried: keys.length };
      }
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { imported: true, letter: null, tried: keys.length };
  },
  /** Hold the die at its floor (a chance cell always hits) or put it back. */
  rig: async ({ on }) => {
    const H = globalThis.__tk;
    H.origRandom ??= CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = on ? () => 0 : H.origRandom;
    return true;
  },
  /** Count error notifications, which the shared install does not. */
  wrapErrors: async () => {
    const H = globalThis.__tk;
    if (H.errWrapped) return true;
    H.errWrapped = true;
    H.errNotes = [];
    H.notifyError = ui.notifications.error.bind(ui.notifications);
    ui.notifications.error = (msg, opts) => { H.errNotes.push(String(msg)); return H.notifyError(msg, opts); };
    return true;
  },
  takeErrors: async () => {
    const H = globalThis.__tk;
    const out = (H.errNotes ?? []).slice();
    H.errNotes = [];
    return out;
  },
  unwrapErrors: async () => {
    const H = globalThis.__tk;
    if (H?.errWrapped) { ui.notifications.error = H.notifyError; H.errWrapped = false; }
    return true;
  },
  /** Bring the kept actors to the shape the steps start from. */
  shape: async ({ ids, letter, playerId }) => {
    const lettered = game.actors.get(ids.lettered);
    const bare = game.actors.get(ids.bare);
    const pc = game.actors.get(ids.player);
    if (!lettered || !bare || !pc) return { ok: false };
    const wrote = [];
    const type = (a) => a.system?.details?.treasure?.type ?? null;
    if (type(lettered) !== letter) { await lettered.update({ "system.details.treasure.type": letter }); wrote.push("lettered:letter"); }
    if (type(bare) !== "none") { await bare.update({ "system.details.treasure.type": "none" }); wrote.push("bare:letter"); }
    for (const [key, a] of [["lettered", lettered], ["bare", bare]]) {
      if (a.prototypeToken.actorLink) { await a.update({ "prototypeToken.actorLink": false }); wrote.push(`${key}:unlinked`); }
    }
    if ((lettered.ownership?.[playerId] ?? 0) !== 2) { await lettered.update({ [`ownership.${playerId}`]: 2 }); wrote.push("lettered:observer"); }
    if ((pc.ownership?.[playerId] ?? 0) < 3) { await pc.update({ [`ownership.${playerId}`]: 3 }); wrote.push("playerOwnership"); }
    const user = game.users.get(playerId);
    return {
      ok: true,
      wrote,
      letterSet: type(lettered) === letter,
      bareSet: type(bare) === "none",
      observer: lettered.testUserPermission(user, "OBSERVER") && !lettered.testUserPermission(user, "OWNER"),
      playerOwns: pc.testUserPermission(user, "OWNER"),
    };
  },
  sees: async ({ ids }) => !!(await globalThis.__tk.poll(() => Object.values(ids).every((id) => !!game.actors.get(id)))),
  /** View the scene on this client only (never activate it), and wait for its canvas. */
  viewScene: async ({ id }) => {
    const H = globalThis.__tk;
    H.prevScene = H.prevScene === undefined ? (canvas.scene?.id ?? null) : H.prevScene;
    if (canvas.scene?.id !== id) await game.scenes.get(id).view();
    const ok = await H.poll(() => canvas.ready && canvas.scene?.id === id, { tries: 80, every: 250 });
    return { viewed: !!ok, hadPrev: H.prevScene !== null };
  },
  restoreScene: async () => {
    const H = globalThis.__tk;
    if (!H || H.prevScene === undefined) return "never viewed";
    const id = H.prevScene;
    H.prevScene = undefined;
    try { canvas.tokens?.releaseAll(); } catch { /* the canvas may be down */ }
    if (id && canvas.scene?.id !== id) await game.scenes.get(id)?.view();
    return id ? "restored" : "no previous scene";
  },
  /** Control exactly these tokens on the viewed canvas. */
  selectTokens: async ({ ids }) => {
    const H = globalThis.__tk;
    await H.poll(() => ids.every((id) => !!canvas.tokens.get(id)), { tries: 60, every: 250 });
    canvas.tokens.releaseAll();
    for (const id of ids) canvas.tokens.get(id)?.control({ releaseOthers: false });
    await H.poll(() => canvas.tokens.controlled.length === ids.length, { tries: 20, every: 150 });
    const got = canvas.tokens.controlled.map((x) => x.id);
    return { asked: ids.length, controlled: got.length, exact: ids.every((id) => got.includes(id)) && got.length === ids.length, linked: ids.map((id) => canvas.tokens.get(id)?.document.actorLink ?? null) };
  },
  /** Show the Token controls so the tool is in the DOM, and mark the windows open now so the new pot is found by difference. */
  armTool: async () => {
    const H = globalThis.__tk;
    H.before = new Set(foundry.applications.instances.values());
    await ui.controls.render({ force: true });
    ui.controls.activate({ control: "tokens" });
    await H.sleep(600);
    const registered = ui.controls.controls?.tokens?.tools?.acksTreasure ?? ui.controls.controls?.find?.((c) => c.name === "tokens")?.tools?.acksTreasure ?? null;
    return { tool: !!document.querySelector("#scene-controls [data-tool='acksTreasure']"), registered: !!registered };
  },
  armSheets: async () => {
    const H = globalThis.__tk;
    H.before = new Set(foundry.applications.instances.values());
    return true;
  },
  /** Run the macros compendium's Deal Treasure with the tokens still controlled; the new pot is found by difference. */
  runDealMacro: async () => {
    const H = globalThis.__tk;
    H.before = new Set(foundry.applications.instances.values());
    const m = await game.packs.get("acks-extras.macros")?.getDocument("acksTreasDeal000");
    if (!m) return { found: false, controlled: canvas.tokens.controlled.length };
    await m.execute();
    return { found: true, controlled: canvas.tokens.controlled.length };
  },
  /** Close one pot's window, so a second pot never sits over the one the next presses land on. */
  closePot: async ({ potId }) => {
    await globalThis.__tk.sheet(potId)?.close();
    return true;
  },
  awaitNewPot: async () => {
    const H = globalThis.__tk;
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !H.before.has(a) && a.rendered && a.constructor.name === "PotSheet") ?? null, { tries: 60, every: 250 });
    if (!app) return null;
    H.opened.push(app);
    await H.poll(() => H.root(app)?.querySelector("li[data-card-id], .acks-extras-treasure__empty"), { tries: 40, every: 200 });
    await H.sleep(500);
    return { potId: app.document.id, uuid: app.document.uuid, name: app.document.name };
  },
  /** The pot window's rail, the stored deal state and the pile, as this seat reads them. */
  rail: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    const pile = H.pile(potId);
    if (!root || !pile) return { rendered: false };
    const f = pile.getFlag("acks-extras", "treasure") ?? {};
    const rows = [...root.querySelectorAll(".acks-extras-treasure__hoard")].map((el) => {
      const less = el.querySelector("[data-action='dealStep'][data-step='-1']");
      const more = el.querySelector("[data-action='dealStep'][data-step='1']");
      const remove = el.querySelector("[data-action='dealRemove']");
      const source = el.querySelector(".acks-extras-treasure__hoard-source");
      return {
        list: less?.dataset.list ?? null,
        index: Number(less?.dataset.index),
        monster: el.classList.contains("is-monster"),
        off: el.classList.contains("is-off"),
        stepsDisabled: !!less?.disabled && !!more?.disabled,
        canRemove: !!remove && !remove.disabled,
        labelled: [less, more, remove].every((b) => !!b?.getAttribute("aria-label")),
        title: H.text(el.querySelector(".acks-extras-treasure__hoard-title")),
        source: H.text(source),
        sourceTip: source?.getAttribute("data-tooltip-text") ?? null,
        hoardsText: H.text(el.querySelector(".acks-extras-treasure__stepper-n")),
        tip: el.getAttribute("data-tooltip-text"),
      };
    });
    const add = root.querySelector("[data-action='dealPicker'][aria-expanded]");
    const pressed = (sel) => root.querySelector(sel)?.getAttribute("aria-pressed") ?? null;
    const warn = root.querySelector("[data-deal-warning]");
    return {
      rendered: true,
      phase: f.phase ?? null,
      rows,
      hoardsTotal: H.text(root.querySelector(".acks-extras-treasure__hoards-total")),
      runText: H.text(root.querySelector("[data-action='dealRun']")),
      hasDrop: !!root.querySelector("[data-accept-drop='deal']"),
      add: { present: !!add, disabled: !!add?.disabled, expanded: add?.getAttribute("aria-expanded") ?? null },
      picker: !!root.querySelector(".acks-extras-treasure__picker"),
      pick: [...root.querySelectorAll("[data-action='dealPick']")].map((b) => ({ letter: b.dataset.letter, listed: b.classList.contains("is-listed"), labelled: !!b.getAttribute("aria-label") })),
      style: Object.fromEntries([...root.querySelectorAll("[data-action='dealStyle']")].map((b) => [b.dataset.style, b.getAttribute("aria-pressed")])),
      special: pressed("[data-action='dealSpecial']"),
      lair: pressed("[data-action='dealLair']"),
      toggles: Object.fromEntries([...root.querySelectorAll("button[data-action='toggleDeal']")].map((b) => [b.dataset.toggle, b.getAttribute("aria-pressed")])),
      warning: !!warn,
      warningText: H.text(warn),
      warningConfirm: !!warn?.querySelector("[data-action='dealConfirm']"),
      warningCancel: !!warn?.querySelector("[data-action='dealCancel']"),
      dealBtn: !!root.querySelector("[data-action='dealRun']"),
      side: !!root.querySelector(".acks-extras-treasure__side"),
      cards: pile.cards.size,
      cardsDown: pile.cards.contents.filter((c) => c.face === null || c.face === undefined).length,
      magicCards: pile.cards.contents.filter((c) => c.getFlag("acks-extras", "card")?.pool === "magic").length,
      storedToggles: f.deal?.toggles ?? null,
      stored: f.deal ? { rows: (f.deal.monsters ?? []).map((m) => ({ hoards: m.hoards, count: m.count, hasLetter: !!m.letter })), hand: (f.deal.hand ?? []).map((h) => ({ letter: h.letter, hoards: h.hoards })), lair: f.deal.metInLair === true, special: f.deal.special === true, style: f.deal.style ?? null } : null,
    };
  },
  /** Wait for the deal's notification, which the Judge's press raises once the cards are staged. */
  waitInfo: async ({ ms = 25000 }) => {
    const H = globalThis.__tk;
    const head = game.i18n.localize("ACKS-TREASURE.deal.done").split("{n}")[0];
    const done = () => H.infos.some((m) => m.startsWith(head)) || (H.errNotes ?? []).length > 0;
    const got = await H.poll(done, { tries: Math.ceil(ms / 250), every: 250 });
    await H.sleep(900);
    return !!got;
  },
  /** Close the pot's window and open it again, and wait for its rail. */
  reopen: async ({ potId }) => {
    const H = globalThis.__tk;
    const pile = H.pile(potId);
    await pile.sheet.close({ animate: false });
    await pile.sheet.render(true);
    const ok = await H.poll(() => H.root(pile.sheet)?.querySelector(".acks-extras-treasure__side"), { tries: 40, every: 200 });
    if (!H.opened.includes(pile.sheet)) H.opened.push(pile.sheet);
    await H.sleep(500);
    return { rendered: !!ok };
  },
  /**
   * Drop an actor on the deal list's zone the way a drag from the Actors sidebar
   * does: a `drop` event carrying `{type: "Actor", uuid}`. Waits for the stored
   * rows to change, or the settle time where the drop is meant to change nothing.
   */
  dropActor: async ({ potId, uuid, expectChange }) => {
    const H = globalThis.__tk;
    const pile = H.pile(potId);
    const zone = H.root(H.sheet(potId))?.querySelector("[data-accept-drop='deal']");
    if (!zone || !pile) return { found: false };
    const sig = () => JSON.stringify(pile.getFlag("acks-extras", "treasure")?.deal?.monsters ?? []);
    const before = sig();
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const changed = expectChange ? await H.poll(() => sig() !== before) : await H.sleep(1200).then(() => sig() !== before);
    await H.sleep(700);
    return { found: true, changed: !!changed };
  },
  /** Record the pointer events around a press, in order, so a lost click can be told from a press that dealt nothing. */
  watchClicks: async () => {
    const H = globalThis.__tk;
    H.evLog = [];
    H.evT0 = performance.now();
    H.evOff?.();
    const types = ["mousedown", "mouseup", "click", "change"];
    const on = (event) => {
      const el = event.target;
      H.evLog.push({ t: Math.round(performance.now() - H.evT0), type: event.type, deal: !!el?.closest?.("[data-action='dealRun']"), connected: !!el?.isConnected });
    };
    for (const type of types) document.addEventListener(type, on, true);
    H.evOff = () => { for (const type of types) document.removeEventListener(type, on, true); H.evOff = null; };
    return true;
  },
  readClicks: async () => {
    const H = globalThis.__tk;
    H.evOff?.();
    return (H.evLog ?? []).slice();
  },
  /** A deal asked for through the API, worded as the window would word it. */
  dealApi: async ({ potId, letter, style = undefined, expectKey }) => {
    const H = globalThis.__tk;
    const pile = H.pile(potId);
    if (!pile) return { found: false };
    const D = await import("/modules/acks-extras/scripts/treasure/deal.mjs");
    const L = await import("/modules/acks-extras/scripts/treasure/deal-logic.mjs");
    const before = pile.cards.size;
    let threw = null;
    let outcome = null;
    try {
      outcome = await D.dealLettersIntoPot(pile, { letters: [letter], style, confirmLair: () => true });
    } catch (err) {
      threw = String(err?.message ?? err);
    }
    const msgs = outcome ? L.dealMessages(outcome).map((m) => ({ level: m.level, text: H.t(m.key, m.args) })) : [];
    const expected = H.t(expectKey, { letter });
    return {
      found: true,
      threw,
      ok: outcome?.ok ?? null,
      reason: outcome?.reason ?? null,
      codes: (outcome?.dealt ?? []).flatMap((d) => (d.errors ?? []).map((e) => e.code)),
      staged: (outcome?.staged ?? []).length,
      said: msgs.length === 1 && msgs[0].level === "warn" && msgs[0].text === expected,
      nMsgs: msgs.length,
      cardsDelta: pile.cards.size - before,
    };
  },
  /**
   * The classic type whose jewelry cell the engine reads with the best chance of a hit (a clause with no
   * chance counts as certain, a zero chance never fires), chosen from the cells alone: a deal that came
   * out empty would hide the fault the step is there to catch. Counts and the letter come back, no figure.
   */
  pickJewelry: async () => {
    const T = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    const B = await import("/modules/acks-extras/scripts/importer/treasure-binding.mjs");
    const HL = await import("/modules/acks-extras/scripts/treasure/hoard-logic.mjs");
    if (!T.hasDoc(B.TREASURE_DOC_ID)) return { imported: false, letter: null, tried: 0, readable: 0, refused: 0 };
    const rows = T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {};
    let readable = 0;
    let refused = 0;
    let letter = null;
    let top = 0;
    for (const key of Object.keys(rows)) {
      const parsed = HL.parseCell(rows[key]?.jewelry, { column: "jewelry" });
      if (parsed.error) { refused++; continue; }
      const chances = (parsed.terms ?? []).filter((x) => x.chance !== 0).map((x) => x.chance ?? 100);
      if (!chances.length) continue;
      readable++;
      if (Math.max(...chances) > top) { top = Math.max(...chances); letter = key; }
    }
    return { imported: true, letter, tried: Object.keys(rows).length, readable, refused };
  },
  /** `hoards` hoards of `letter` dealt on the real dice, page-side: the jewelry cards, those valued above zero, the thrown-value audit rows and the `bad-value` errors, as counts. */
  jewelryHoards: async ({ letter, hoards }) => {
    const Hd = await import("/modules/acks-extras/scripts/treasure/hoard.mjs");
    let jewelry = 0;
    let valued = 0;
    let thrown = 0;
    let bad = 0;
    for (let i = 0; i < hoards; i++) {
      const out = await Hd.dealHoard({ letter, style: "classic", toggles: { noMagic: true } });
      for (const x of out.truths) if (x.pool === "jewelry") { jewelry++; if (x.valueGp > 0) valued++; }
      thrown += out.audit.filter((a) => a.value === true).length;
      bad += out.errors.filter((e) => e.code === "bad-value").length;
    }
    return { hoards, jewelry, valued, thrown, bad };
  },
  /** The jewelry cards a pot holds, read from each card's truth, and how many of them carry a value above zero. */
  jewelryCards: async ({ potId }) => {
    const pile = globalThis.__tk.pile(potId);
    if (!pile) return { found: false };
    const jewelry = pile.cards.contents.map((c) => c.getFlag("acks-extras", "card")).filter((x) => x?.pool === "jewelry");
    return { found: true, cards: pile.cards.size, jewelry: jewelry.length, valued: jewelry.filter((x) => Number(x.valueGp) > 0).length };
  },
  /** Wait for any notification a Deal press raises (the deal's report, a warning or an error), which a deal that stages nothing never makes as the report. */
  waitNote: async ({ ms = 20000 }) => {
    const H = globalThis.__tk;
    const got = await H.poll(() => (H.infos ?? []).length + (H.warns ?? []).length + (H.errNotes ?? []).length > 0, { tries: Math.ceil(ms / 250), every: 250 });
    await H.sleep(900);
    return !!got;
  },
  /** A monster's sheet on its Ecology tab, and the Deal control beside Treasure type. */
  sheetEcology: async ({ actorId }) => {
    const H = globalThis.__tk;
    const a = game.actors.get(actorId);
    if (!a) return { found: false };
    // A monster's default sheet is the Follower Card, which expands into the Full Monster sheet; the registered Full Monster class is opened directly.
    const Full = Object.values(CONFIG.Actor.sheetClasses.monster ?? {}).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    if (!Full) return { found: false, why: "no Full Monster sheet registered" };
    const s = new Full({ document: a });
    await s.render(true);
    H.opened.push(s);
    await H.poll(() => H.root(s)?.querySelector(".window-title"), { tries: 40, every: 200 });
    await H.sleep(500);
    s.changeTab("ecology", "primary");
    await H.sleep(700);
    const root = H.root(s);
    const panel = root?.querySelector(".tab[data-tab='ecology']");
    const btn = panel?.querySelector("[data-action='dealTreasure']");
    return {
      found: true,
      sheetClass: s.constructor.name,
      tab: s.tabGroups?.primary ?? null,
      panel: !!panel,
      field: !!panel?.querySelector("input[name='system.details.treasure.type']"),
      buttons: panel?.querySelectorAll("[data-action='dealTreasure']").length ?? 0,
      disabled: !!btn?.disabled,
      tip: btn?.parentElement?.getAttribute("data-tooltip-text") ?? null,
      label: H.text(btn),
    };
  },
};

let gm = null;
let player = null;
const made = [];
watchdog(() => [gm, player], Number(process.env.WALK_WALL_MS ?? 800_000));

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /treasure|pot-sheet|deal|hoard|monster-actions|monster-sheet/i });
  await run(gm, P.wrapErrors);

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const picked = await run(gm, P.pickLetter);
  if (!picked.imported) blocked("the world's treasure registry is not imported, so every Deal would report it (recipe step 6); import the Treasure Tome first");
  if (!picked.letter) blocked("no treasure type in the imported classic table deals both a magic card and another kind under a floor die, so the walk cannot show No magic doing anything");
  const LETTER = picked.letter;
  check("the registry is imported, and one treasure type deals a magic card without No magic and only other cards with it, under a floor die", picked.imported && !!LETTER, { tried: picked.tried });

  const fxScene = await gm.fixture(MARKS.scene, "Scene", { name: "QA Deal Scene", width: 1200, height: 800, grid: { size: 100 } });
  const monster = (name, type) => ({ name, type: "monster", system: { details: { treasure: { type } } }, prototypeToken: { actorLink: false, disposition: -1 }, ownership: { default: 0, [playerId]: 2 } });
  const fxLettered = await gm.fixture(MARKS.lettered, "Actor", monster(NAMES.lettered, LETTER));
  const fxBare = await gm.fixture(MARKS.bare, "Actor", { ...monster(NAMES.bare, "none"), ownership: { default: 0 } });
  const fxPlayer = await gm.fixture(MARKS.player, "Actor", { name: NAMES.player, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 } });
  const fxPlain = await gm.fixture(MARKS.plain, "Item", PLAIN);
  const ids = { lettered: idOf(fxLettered), bare: idOf(fxBare), player: idOf(fxPlayer) };
  const shaped = await run(gm, P.shape, { ids, letter: LETTER, playerId });
  check("the kept fixtures stand in the shape the steps start from: the lettered monster carries the letter and is unlinked with the Player seat Observer, the bare one carries none, the Player seat owns its character", shaped.ok && shaped.letterSet && shaped.bareSet && shaped.observer && shaped.playerOwns, { wrote: shaped.wrote });
  check("the Player seat sees the lettered monster", await run(player, P.sees, { ids: { lettered: ids.lettered } }));

  const dealPress = async (spec, label) => {
    await run(gm, P.rig, { on: true });
    try {
      await run(gm, K.takeNotes);
      await run(gm, P.takeErrors);
      const pressed = await press(gm, PORTS.gm, spec, label);
      const waited = await run(gm, P.waitInfo, {});
      await run(gm, P.rig, { on: false });
      const notes = await run(gm, K.takeNotes);
      const errs = await run(gm, P.takeErrors);
      return { pressed, waited, notes, errs };
    } finally {
      await run(gm, P.rig, { on: false });
    }
  };
  const doneText = (n, letters) => t(gm, "deal.done", { n, letters });
  const doneHead = (await t(gm, "deal.done", { n: "@@", letters: "" })).split("@@")[0];

  section("Step 1. selected tokens");
  const sceneUuid = fxScene.uuid;
  const sceneId = idOf(fxScene);
  const spots = [["lettered", true, 100], ["lettered", false, 300], ["bare", false, 500], ["player", true, 700]];
  const tokenIds = [];
  for (const [key, link, x] of spots) {
    const tok = await gm.create("Token", { name: NAMES[key], actorId: ids[key], actorLink: link, x, y: 100, disposition: key === "player" ? 1 : -1 }, { parent: sceneUuid });
    made.push(tok.uuid);
    tokenIds.push(idOf(tok));
  }
  const viewed = await run(gm, P.viewScene, { id: sceneId });
  const sel = await run(gm, P.selectTokens, { ids: tokenIds });
  check("the GM seat views the fixture scene, and the four tokens are controlled: the lettered monster's two (one linked, one not), the bare one's, the character's", viewed.viewed && sel.exact && sel.controlled === 4 && sel.linked[0] === true && sel.linked[1] === false, { viewed: viewed.viewed, controlled: sel.controlled, linked: sel.linked });
  const armed = await run(gm, P.armTool);
  const tool = await press(gm, PORTS.gm, { scope: "doc", sel: "#scene-controls [data-tool='acksTreasure']" }, "Scene controls, Token controls, New treasure pot");
  const potA = await run(gm, P.awaitNewPot);
  check("New treasure pot is on the Token controls for the Judge, was pressed, and opened a pot window", armed.tool && armed.registered && tool.found && !!potA, { tool: armed.tool, real: tool.real });
  if (!potA) throw new Error("the tool opened no pot window");
  made.push(gm.track(potA.uuid, "Cards"));
  const r1 = await run(gm, P.rail, { potId: potA.potId });
  const expName = await t(gm, "deal.monster", { name: NAMES.lettered, count: 2 });
  const expBare = await t(gm, "deal.monster", { name: NAMES.bare, count: 1 });
  const lettered1 = r1.rows.find((r) => r.source === expName);
  const bare1 = r1.rows.find((r) => r.source === expBare);
  const cite = await t(gm, "cite.deal");
  const expLetterText = await t(gm, "search.letter", { letter: LETTER });
  const expTipLetter = await t(gm, "deal.tip.letter", { name: NAMES.lettered, letter: LETTER, cite });
  const expTipNone = await t(gm, "deal.tip.noLetter", { name: NAMES.bare, cite });
  const expNoLetter = await t(gm, "deal.noLetter");
  const expCount = await t(gm, "deal.tip.count", { count: 2 });
  const expHoards1 = await t(gm, "deal.hoardsTotalOne", { n: 1 });
  const expRun1 = await t(gm, "deal.runOne", { n: 1 });
  const expCount1 = await t(gm, "deal.hoardCount", { n: 1 });
  check("the staged pot has exactly two rows under Hoards to deal, none for the character, with the drop zone and the add button beside them", r1.rendered && r1.phase === "staging" && r1.rows.length === 2 && !!lettered1 && !!bare1 && !r1.rows.some((r) => r.source.includes(NAMES.player)) && r1.hasDrop && r1.add.present && !r1.add.disabled && r1.add.expanded === "false" && !r1.picker, { rows: r1.rows.length, drop: r1.hasDrop, add: r1.add });
  check("the lettered kind's row reads its type and its name with its two tokens counted once, at one hoard, tinted as a monster row and enabled, and its tooltip names the sheet and the page", !!lettered1 && lettered1.title === expLetterText && lettered1.hoardsText === expCount1 && lettered1.monster && !lettered1.off && !lettered1.stepsDisabled && lettered1.labelled && lettered1.tip === expTipLetter && lettered1.sourceTip === expCount, { title: lettered1?.title === expLetterText, tip: lettered1?.tip === expTipLetter, count: lettered1?.sourceTip === expCount });
  check("the bare monster's row is disabled with its no-letter reason on the row and in its tooltip, its steps off and its remove still enabled", !!bare1 && bare1.off && bare1.stepsDisabled && bare1.canRemove && bare1.title === expNoLetter && bare1.tip === expTipNone, { off: bare1?.off, title: bare1?.title === expNoLetter, tip: bare1?.tip === expTipNone });
  check("the header counts one hoard and the Deal button says so: only the lettered row deals", r1.hoardsTotal === expHoards1 && r1.runText === expRun1, { total: r1.hoardsTotal === expHoards1, run: r1.runText === expRun1 });
  check("the stored deal state holds the same two rows at one hoard each, no by-hand row, and nothing was dealt: no card in the pot", r1.stored?.rows.length === 2 && r1.stored.rows.every((x) => x.hoards === 1) && r1.stored.hand.length === 0 && r1.cards === 0, { stored: r1.stored?.rows.length, cards: r1.cards });
  const mac = await run(gm, P.runDealMacro);
  const potM = mac.found ? await run(gm, P.awaitNewPot) : null;
  if (potM) made.push(gm.track(potM.uuid, "Cards"));
  const rM = potM ? await run(gm, P.rail, { potId: potM.potId }) : null;
  if (potM) await run(gm, P.closePot, { potId: potM.potId });
  check("the macros compendium's Deal Treasure, run with the same four tokens controlled, opens a second staged pot with the same two rows, the lettered one enabled and the bare one disabled, nothing dealt", mac.found && mac.controlled === 4 && !!rM && rM.phase === "staging" && rM.rows.length === 2 && rM.rows.some((r) => r.source === expName && !r.off) && rM.rows.some((r) => r.source === expBare && r.off && r.stepsDisabled) && rM.cards === 0, { found: mac.found, controlled: mac.controlled, rows: rM?.rows.length });
  const pa = (sel) => ({ scope: "sheet", potId: potA.potId, sel });

  section("Step 2. the lair warning");
  check("Met in their lair starts off", r1.lair === "false" && r1.stored?.lair === false, { lair: r1.lair });
  await run(gm, K.takeNotes);
  const deal1 = await press(gm, PORTS.gm, pa("aside [data-action='dealRun']"), "Deal");
  await sleep(900);
  const w2 = await run(gm, P.rail, { potId: potA.potId });
  const notes2 = await run(gm, K.takeNotes);
  const expWarn = await t(gm, "deal.warn.body", { toggle: await t(gm, "deal.lair") });
  const expLabel = await t(gm, "deal.warn.label");
  check("Deal pressed with the toggle off raises the rail's callout, which names the toggle and offers Deal anyway and Cancel", deal1.found && w2.warning && w2.warningText.includes(expWarn) && w2.warningText.includes(expLabel) && w2.warningConfirm && w2.warningCancel, { warning: w2.warning, body: w2.warningText.includes(expWarn) });
  check("the pot holds no new card and no deal was reported", w2.cards === 0 && !notes2.infos.some((m) => m.startsWith(doneHead)) && w2.stored?.lair === false, { cards: w2.cards });
  const cancel = await press(gm, PORTS.gm, pa("[data-deal-warning] [data-action='dealCancel']"), "Cancel");
  await sleep(900);
  const c2 = await run(gm, P.rail, { potId: potA.potId });
  check("Cancel clears the callout, and the pot still holds no card", cancel.found && !c2.warning && c2.cards === 0, { warning: c2.warning, cards: c2.cards });

  section("Step 3. Deal anyway");
  const noMagic = await press(gm, PORTS.gm, pa("button[data-action='toggleDeal'][data-toggle='noMagic']"), "No magic");
  await sleep(700);
  const force = await press(gm, PORTS.gm, pa("button[data-action='toggleDeal'][data-toggle='forceCursed']"), "Force cursed");
  await sleep(700);
  const tg = await run(gm, P.rail, { potId: potA.potId });
  check("No magic and Force cursed are on in the pot, as the buttons and the stored state read", noMagic.found && force.found && tg.toggles.noMagic === "true" && tg.toggles.forceCursed === "true" && tg.storedToggles?.noMagic === true && tg.storedToggles?.forceCursed === true, tg.toggles);
  const first = await press(gm, PORTS.gm, pa("aside [data-action='dealRun']"), "Deal");
  await sleep(900);
  const asked = await run(gm, P.rail, { potId: potA.potId });
  check("Deal raises the callout again and deals nothing yet (the Cancel cleared it, nothing was remembered)", first.found && asked.warning && asked.cards === 0, { warning: asked.warning, cards: asked.cards });
  const any = await dealPress(pa("[data-deal-warning] [data-action='dealConfirm']"), "Deal anyway");
  const s3 = await run(gm, P.rail, { potId: potA.potId });
  const n1 = s3.cards;
  const wantDone1 = await doneText(n1, LETTER);
  check("Deal anyway deals at once: the callout is gone and the pot holds face-down cards", any.pressed.found && any.waited && !s3.warning && n1 > 0 && s3.cardsDown === n1, { cards: n1, down: s3.cardsDown });
  check("one notification reports the deal with the card count and the letter named once, so the two tokens of the lettered kind dealt one hoard, and the bare monster dealt none", any.notes.infos.includes(wantDone1) && any.errs.length === 0, { reported: any.notes.infos.includes(wantDone1), errors: any.errs.length });
  check("the toggles are honoured: no magic card in the pot, and both toggles still on", s3.magicCards === 0 && s3.toggles.noMagic === "true" && s3.toggles.forceCursed === "true", { magic: s3.magicCards });

  section("Step 4. Met in their lair");
  const lairOn = await press(gm, PORTS.gm, pa("[data-action='dealLair']"), "Met in their lair");
  await sleep(900);
  const l4 = await run(gm, P.rail, { potId: potA.potId });
  check("Met in their lair is ticked, as the button and the stored state read", lairOn.found && l4.lair === "true" && l4.stored?.lair === true, { lair: l4.lair });
  const second = await dealPress(pa("aside [data-action='dealRun']"), "Deal");
  const s4 = await run(gm, P.rail, { potId: potA.potId });
  const n2 = s4.cards - n1;
  const wantDone2 = await doneText(n2, LETTER);
  check("one press of Deal, with no callout, dealt a second hoard at once: new face-down cards, one notification naming the letter once", second.pressed.found && second.waited && !s4.warning && n2 > 0 && s4.cardsDown === s4.cards && second.notes.infos.includes(wantDone2) && second.errs.length === 0 && s4.magicCards === 0, { added: n2, reported: second.notes.infos.includes(wantDone2) });
  const heroic = await press(gm, PORTS.gm, pa("[data-action='dealStyle'][data-style='heroic']"), "Heroic");
  await sleep(700);
  const special = await press(gm, PORTS.gm, pa("[data-action='dealSpecial']"), "Special treasure");
  await sleep(700);
  const left = await run(gm, P.rail, { potId: potA.potId });
  check("Heroic and Special treasure are chosen, as the buttons and the stored state read", heroic.found && special.found && left.style.heroic === "true" && left.style.classic === "false" && left.special === "true" && left.stored?.style === "heroic" && left.stored?.special === true, { style: left.style, special: left.special });
  const reopened = await run(gm, P.reopen, { potId: potA.potId });
  const back = await run(gm, P.rail, { potId: potA.potId });
  check("the window is closed and opened again: the lair toggle, the style and the Special treasure tick read back as left, and the cards are still there", reopened.rendered && back.lair === "true" && back.style.heroic === "true" && back.special === "true" && back.cards === s4.cards, { lair: back.lair, style: back.style, special: back.special, cards: back.cards === s4.cards });
  await press(gm, PORTS.gm, pa("[data-action='dealStyle'][data-style='classic']"), "Classic");
  await sleep(600);
  await press(gm, PORTS.gm, pa("[data-action='dealSpecial']"), "Special treasure off");
  await sleep(600);

  section("Step 5. the list: steps, remove, a dropped monster, the picker");
  const stepSel = (list, index, step) => `[data-action='dealStep'][data-list='${list}'][data-index='${index}'][data-step='${step}']`;
  const removeSel = (list, index) => `[data-action='dealRemove'][data-list='${list}'][data-index='${index}']`;
  const expOne = await t(gm, "deal.monster", { name: NAMES.lettered, count: 1 });
  const expHand = await t(gm, "judge.byHand");
  const countText = (n) => t(gm, "deal.hoardCount", { n });
  const before5 = await run(gm, P.rail, { potId: potA.potId });
  const row5 = before5.rows.find((r) => r.source === expName);
  const up = await press(gm, PORTS.gm, pa(stepSel("monsters", row5?.index, 1)), "+ on the lettered row");
  await sleep(900);
  const up5 = await run(gm, P.rail, { potId: potA.potId });
  const upRow = up5.rows.find((r) => r.source === expName);
  check("+ on the lettered row raises it to two hoards: the row, the stored state, the header and the Deal button all say two", up.found && !!row5 && upRow?.hoardsText === (await countText(2)) && up5.stored?.rows[row5.index]?.hoards === 2 && up5.hoardsTotal === (await t(gm, "deal.hoardsTotal", { n: 2 })) && up5.runText === (await t(gm, "deal.runN", { n: 2 })), { row: upRow?.hoardsText, stored: up5.stored?.rows[row5?.index]?.hoards, total: up5.hoardsTotal });
  await press(gm, PORTS.gm, pa(stepSel("monsters", row5?.index, -1)), "- on the lettered row");
  await sleep(900);
  const down5 = await run(gm, P.rail, { potId: potA.potId });
  check("- on a row at two hoards lowers it to one and leaves the row", down5.rows.find((r) => r.source === expName)?.hoardsText === expCount1 && down5.stored?.rows[row5.index]?.hoards === 1 && down5.rows.length === 2, { rows: down5.rows.length });
  await press(gm, PORTS.gm, pa(stepSel("monsters", row5?.index, -1)), "- on the lettered row at one");
  await sleep(900);
  const gone5 = await run(gm, P.rail, { potId: potA.potId });
  check("- at one hoard removes the lettered row: only the disabled row stands, the header counts none and the Deal button is the plain Deal", gone5.rows.length === 1 && gone5.rows[0].source === expBare && gone5.stored?.rows.length === 1 && gone5.hoardsTotal === (await t(gm, "deal.hoardsTotal", { n: 0 })) && gone5.runText === (await t(gm, "deal.run")), { rows: gone5.rows.length, total: gone5.hoardsTotal, run: gone5.runText });

  await run(gm, K.takeNotes);
  const drop1 = await run(gm, P.dropActor, { potId: potA.potId, uuid: fxLettered.uuid, expectChange: true });
  const d1 = await run(gm, P.rail, { potId: potA.potId });
  const dropped1 = d1.rows.find((r) => r.source === expOne);
  check("the lettered monster dropped on the zone adds its row at one hoard, tinted as a monster row, enabled, with its type", drop1.found && drop1.changed && !!dropped1 && dropped1.hoardsText === expCount1 && dropped1.monster && !dropped1.off && dropped1.title === expLetterText && d1.rows.length === 2, { rows: d1.rows.length });
  const drop2 = await run(gm, P.dropActor, { potId: potA.potId, uuid: fxLettered.uuid, expectChange: true });
  const d2 = await run(gm, P.rail, { potId: potA.potId });
  check("the same monster dropped again raises that row to two hoards and adds no second row", drop2.changed && d2.rows.length === 2 && d2.rows.find((r) => r.source === expOne)?.hoardsText === (await countText(2)), { rows: d2.rows.length });
  const dropPc = await run(gm, P.dropActor, { potId: potA.potId, uuid: fxPlayer.uuid, expectChange: false });
  const dNotes = await run(gm, K.takeNotes);
  const d3 = await run(gm, P.rail, { potId: potA.potId });
  check("a character dropped on the zone adds nothing and is refused by lang string", dropPc.found && !dropPc.changed && d3.rows.length === 2 && dNotes.warns.includes(await t(gm, "deal.dropKind")), { rows: d3.rows.length, warned: dNotes.warns.includes(await t(gm, "deal.dropKind")) });

  const openPick = await press(gm, PORTS.gm, pa("[data-action='dealPicker'][aria-expanded]"), "+ Add treasure type");
  await sleep(700);
  const k1 = await run(gm, P.rail, { potId: potA.potId });
  check("+ Add treasure type opens the picker: one button per type the imported classic table holds, the chosen one among them, none listed yet", openPick.found && k1.add.expanded === "true" && k1.picker && k1.pick.length === picked.tried && k1.pick.some((x) => x.letter === LETTER) && k1.pick.every((x) => x.labelled && !x.listed), { expanded: k1.add.expanded, buttons: k1.pick.length, types: picked.tried });
  const pickSel = `[data-action='dealPick'][data-letter=${JSON.stringify(LETTER)}]`;
  await press(gm, PORTS.gm, pa(pickSel), "pick the type");
  await sleep(900);
  const k2 = await run(gm, P.rail, { potId: potA.potId });
  const handRow = k2.rows.find((r) => r.source === expHand);
  check("picking a type adds one by-hand row at one hoard, plain rather than tinted, and tints that type in the picker, which stays open", !!handRow && !handRow.monster && handRow.title === expLetterText && handRow.hoardsText === expCount1 && k2.stored?.hand.length === 1 && k2.stored.hand[0].letter === LETTER && k2.pick.find((x) => x.letter === LETTER)?.listed && k2.picker, { row: !!handRow, hand: k2.stored?.hand.length });
  await press(gm, PORTS.gm, pa(pickSel), "pick the same type");
  await sleep(900);
  const k3 = await run(gm, P.rail, { potId: potA.potId });
  check("picking it again raises that row to two hoards and adds no second row", k3.stored?.hand.length === 1 && k3.stored.hand[0].hoards === 2 && k3.rows.find((r) => r.source === expHand)?.hoardsText === (await countText(2)), { hand: k3.stored?.hand.length });
  await press(gm, PORTS.gm, pa(stepSel("hand", 0, -1)), "- on the by-hand row");
  await sleep(900);
  await press(gm, PORTS.gm, pa(stepSel("hand", 0, 1)), "+ on the by-hand row");
  await sleep(900);
  const k4 = await run(gm, P.rail, { potId: potA.potId });
  check("- then + on the by-hand row lands it back at two hoards", k4.stored?.hand[0]?.hoards === 2, { hoards: k4.stored?.hand[0]?.hoards });
  const done = await press(gm, PORTS.gm, pa(".acks-extras-treasure__picker [data-action='dealPicker']"), "Done");
  await sleep(700);
  const k5 = await run(gm, P.rail, { potId: potA.potId });
  check("Done closes the picker", done.found && !k5.picker && k5.add.expanded === "false", { picker: k5.picker });

  section("Step 5b. Deal the list");
  const expRun4 = await t(gm, "deal.runN", { n: 4 });
  check("the list holds the lettered monster at two hoards and the by-hand type at two: the header and the Deal button say four", k5.hoardsTotal === (await t(gm, "deal.hoardsTotal", { n: 4 })) && k5.runText === expRun4, { total: k5.hoardsTotal, run: k5.runText === expRun4 });
  await run(gm, P.watchClicks);
  const hand = await dealPress(pa("aside [data-action='dealRun']"), "Deal 4 hoards");
  const evs = await run(gm, P.readClicks);
  note("step 5, the pointer events around the press, in order (t ms, type, on Deal, still in the document)", evs.map((e) => `${e.t}:${e.type}${e.deal ? ":deal" : ""}${e.connected ? "" : ":detached"}`).join(" "));
  const s5 = await run(gm, P.rail, { potId: potA.potId });
  const n3 = s5.cards - s4.cards;
  const wantDone3 = await doneText(n3, Array(4).fill(LETTER).join(", "));
  check("Deal pressed once dealt all four hoards: no callout, new face-down cards, one notification naming the letter once per hoard", hand.pressed.found && hand.waited && !s5.warning && n3 > 0 && s5.cardsDown === s5.cards && hand.notes.infos.includes(wantDone3) && hand.errs.length === 0, { added: n3, reported: hand.notes.infos.includes(wantDone3), real: hand.pressed.real, warns: hand.notes.warns.length });
  const bare5 = s5.rows.find((r) => r.source === expBare);
  await press(gm, PORTS.gm, pa(removeSel("monsters", bare5?.index)), "remove the disabled row");
  await sleep(900);
  const r5 = await run(gm, P.rail, { potId: potA.potId });
  check("the disabled row is removed by its remove button, and the two dealt rows stand", !!bare5 && bare5.canRemove && r5.rows.length === 2 && !r5.rows.some((r) => r.source === expBare) && r5.stored?.rows.length === 1, { rows: r5.rows.length });
  note("the type lookup's case folding is the table's own, reached by no control", "covered offline by test-hoard-map");

  section("Step 6. the monster sheet");
  const gL = await run(gm, P.sheetEcology, { actorId: ids.lettered });
  const tipOn = await t(gm, "monster.dealTip");
  const tipOff = await t(gm, "monster.dealNone");
  const labelDeal = await t(gm, "monster.deal");
  check("the lettered monster's sheet is the module's monster sheet, on its Ecology tab, with one enabled Deal beside Treasure type and its tooltip", gL.found && gL.tab === "ecology" && gL.panel && gL.field && gL.buttons === 1 && !gL.disabled && gL.label === labelDeal && gL.tip === tipOn, { sheet: gL.sheetClass, tab: gL.tab, buttons: gL.buttons, disabled: gL.disabled });
  await run(gm, K.closeAll);
  const gB = await run(gm, P.sheetEcology, { actorId: ids.bare });
  check("the bare monster's Deal is there and disabled, its tooltip saying the sheet states no type", gB.found && gB.tab === "ecology" && gB.panel && gB.buttons === 1 && gB.disabled && gB.tip === tipOff, { buttons: gB.buttons, disabled: gB.disabled, tip: gB.tip === tipOff });
  await run(gm, K.closeAll);
  const pL = await run(player, P.sheetEcology, { actorId: ids.lettered });
  check("the Player seat, Observer on the lettered monster, reaches its Ecology tab and Treasure type field and is offered no Deal", pL.found && pL.tab === "ecology" && pL.panel && pL.field && pL.buttons === 0, { sheet: pL.sheetClass, tab: pL.tab, panel: pL.panel, field: pL.field, buttons: pL.buttons });
  await run(player, K.closeAll);
  const gL2 = await run(gm, P.sheetEcology, { actorId: ids.lettered });
  await run(gm, P.armSheets);
  const dealBtn = await press(gm, PORTS.gm, { scope: "doc", sel: ".tab[data-tab='ecology'] [data-action='dealTreasure']" }, "Deal beside Treasure type");
  const potB = await run(gm, P.awaitNewPot);
  check("pressing Deal on the sheet opened a pot window", gL2.found && dealBtn.found && !dealBtn.disabled && !!potB, { real: dealBtn.real });
  if (!potB) throw new Error("the monster sheet's Deal opened no pot window");
  made.push(gm.track(potB.uuid, "Cards"));
  const r6 = await run(gm, P.rail, { potId: potB.potId });
  check("the pot is staged with that one monster's row at one hoard, enabled, and nothing was dealt", r6.phase === "staging" && r6.rows.length === 1 && r6.rows[0].source === expOne && !r6.rows[0].off && r6.rows[0].hoardsText === expCount1 && r6.rows[0].title === expLetterText && r6.cards === 0 && r6.stored?.rows.length === 1 && r6.stored.rows[0].hoards === 1, { rows: r6.rows.length, cards: r6.cards });
  await run(gm, K.closeAll);

  section("Step 7. refusals");
  const bogus = await run(gm, P.dealApi, { potId: potA.potId, letter: LETTER, style: "bogus", expectKey: "deal.error.unknown-style" });
  check("a deal for a style with no table says so by lang string, stages nothing and throws nothing (the API route: no control can pick such a style)", bogus.found && bogus.threw === null && bogus.ok === true && bogus.codes.includes("unknown-style") && bogus.staged === 0 && bogus.said && bogus.cardsDelta === 0, { threw: bogus.threw, codes: bogus.codes, said: bogus.said, staged: bogus.staged });
  const potC = await run(gm, P.newPot);
  if (!potC) throw new Error("no pot window opened on the GM seat");
  made.push(gm.track(potC.uuid, "Cards"));
  const drop = await run(gm, P.dropAndWait, { potId: potC.potId, zone: "pot", uuid: fxPlain.uuid });
  check("a small pot is stocked with one plain item, so the open pot below holds no dealt placeholder", drop.ok, { ids: drop.ids.length });
  const staged7 = await run(gm, P.rail, { potId: potC.potId });
  check("while staging the rail is there: Deal, the drop zone and the add button, and Open to the table", staged7.dealBtn && staged7.hasDrop && staged7.add.present && staged7.side);
  const open7 = await press(gm, PORTS.gm, { scope: "sheet", potId: potC.potId, sel: "aside [data-action='openTable']" }, "Open to the table");
  const w7 = await run(gm, K.waitState, { potId: potC.potId, until: "phase", phase: "open" });
  const st7 = await run(gm, K.stage, { potId: potC.potId });
  if (st7.messageId) made.push(gm.track(st7.messageId, "ChatMessage"));
  await run(gm, K.rerender, { potId: potC.potId });
  const o7 = await run(gm, P.rail, { potId: potC.potId });
  check("on a pot opened to the table the rail is gone: no Deal, no drop zone, no list rows, no side panel", open7.found && w7.met && o7.phase === "open" && !o7.dealBtn && !o7.hasDrop && !o7.side && o7.rows.length === 0, { phase: o7.phase, deal: o7.dealBtn, side: o7.side });
  const refusedGm = await run(gm, P.dealApi, { potId: potC.potId, letter: LETTER, expectKey: "deal.refuse.phase" });
  check("a deal into the open pot is refused as no longer staging, worded by lang string, and stages nothing", refusedGm.found && refusedGm.threw === null && refusedGm.ok === false && refusedGm.reason === "phase" && refusedGm.said && refusedGm.cardsDelta === 0, { reason: refusedGm.reason, said: refusedGm.said });
  const refusedPl = await run(player, P.dealApi, { potId: potC.potId, letter: LETTER, expectKey: "deal.refuse.notAllowed" });
  check("the Player seat's deal into that pot is refused as Judge-only, worded by lang string, and stages nothing", refusedPl.found && refusedPl.threw === null && refusedPl.ok === false && refusedPl.reason === "notAllowed" && refusedPl.said && refusedPl.cardsDelta === 0, { found: refusedPl.found, reason: refusedPl.reason, said: refusedPl.said });
  note("step 7, the registry-unimported half", "not reached: the shared world's registry is imported, and every style the pot offers has its table");

  section("Step 8. jewelry hoards, dealt on the real dice");
  const jw = await run(gm, P.pickJewelry);
  note("jewelry: the imported classic grid's cells, by how the engine reads them", { types: jw.tried, readable: jw.readable, refused: jw.refused });
  if (!jw.imported || !jw.letter) note("step 8, jewelry hoards", `not reached: no classic type's jewelry cell reads with a chance of a hit (${jw.refused} refused whole)`);
  else {
    const JEWELRY_HOARDS = 10;
    await run(gm, K.closeAll);
    const potJ = await run(gm, P.newPot);
    if (!potJ) throw new Error("no pot window opened on the GM seat for the jewelry hoards");
    made.push(gm.track(potJ.uuid, "Cards"));
    const pj = (sel) => ({ scope: "sheet", potId: potJ.potId, sel });
    await press(gm, PORTS.gm, pj("button[data-action='toggleDeal'][data-toggle='noMagic']"), "No magic");
    await sleep(700);
    await press(gm, PORTS.gm, pj("[data-action='dealLair']"), "Met in their lair");
    await sleep(900);
    await press(gm, PORTS.gm, pj("[data-action='dealPicker'][aria-expanded]"), "+ Add treasure type");
    await sleep(700);
    await press(gm, PORTS.gm, pj(`[data-action='dealPick'][data-letter=${JSON.stringify(jw.letter)}]`), "pick the jewelry type");
    await sleep(900);
    for (let n = 1; n < JEWELRY_HOARDS; n++) {
      await press(gm, PORTS.gm, pj(stepSel("hand", 0, 1)), `+ on the by-hand row (${n})`);
      await sleep(600);
    }
    const setJ = await run(gm, P.rail, { potId: potJ.potId });
    check("the jewelry pot stands ready: classic, No magic and Met in their lair on, one by-hand row at the hoard count asked for, nothing dealt", setJ.style.classic === "true" && setJ.toggles.noMagic === "true" && setJ.lair === "true" && setJ.stored?.hand.length === 1 && setJ.stored.hand[0].letter === jw.letter && setJ.stored.hand[0].hoards === JEWELRY_HOARDS && setJ.cards === 0, { hand: setJ.stored?.hand.length, hoards: setJ.stored?.hand[0]?.hoards, cards: setJ.cards });
    const presses = [];
    let jc = { jewelry: 0, valued: 0 };
    for (let n = 0; n < 3 && jc.jewelry === 0; n++) {
      await run(gm, K.takeNotes);
      await run(gm, P.takeErrors);
      const pressed = await press(gm, PORTS.gm, pj("aside [data-action='dealRun']"), `Deal ${JEWELRY_HOARDS} hoards, press ${n + 1}`);
      const waited = await run(gm, P.waitNote, {});
      const notes = await run(gm, K.takeNotes);
      const errs = await run(gm, P.takeErrors);
      presses.push({ found: pressed.found, waited, said: [...notes.warns, ...errs].some((m) => m.includes("bad-value")), warns: notes.warns.length, errs: errs.length });
      jc = await run(gm, P.jewelryCards, { potId: potJ.potId });
    }
    const live = await run(gm, P.jewelryHoards, { letter: jw.letter, hoards: 40 });
    note("step 8, the thrown-value path (a band printed as a throw), counted page-side over 40 hoards on the real dice", { jewelry: live.jewelry, thrownValueRows: live.thrown });
    if (!live.thrown) note("step 8, thrown values", "not reached: no band this type dealt on the real dice was printed as a throw, so only plain figures were read");
    check("no deal warning or error carries the code bad-value, in any Deal press or in 40 hoards dealt page-side on the same dice", presses.length > 0 && presses.every((x) => x.found && !x.said) && live.bad === 0, { presses: presses.length, said: presses.filter((x) => x.said).length, bad: live.bad });
    check("the Deal presses dealt at least one jewelry card, and every jewelry card the pot holds carries a value above zero", jc.found && jc.jewelry > 0 && jc.valued === jc.jewelry, { presses: presses.length, jewelry: jc.jewelry, valued: jc.valued });
    check("hoards dealt page-side on the same dice give jewelry, each card valued above zero", live.jewelry > 0 && live.valued === live.jewelry, { hoards: live.hoards, jewelry: live.jewelry, valued: live.valued });
    await run(gm, K.closeAll);
  }

  section("console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, K.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3).map((e) => e.slice(0, 120)));
  }
  const errNotes = await run(gm, P.takeErrors);
  check("gm: no error notification over the last step", errNotes.length === 0, { errors: errNotes.length });
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [key, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, K.closeAll); } catch {}
    try { await run(api, P.rig, { on: false }); } catch {}
    try { await run(api, P.unwrapErrors); } catch {}
    try { note(`scene (${key})`, await run(api, P.restoreScene)); } catch (err) { console.error("scene:", err?.message ?? err); }
    try { note(`restored (${key})`, await run(api, K.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    // Only the run's own ids: the tokens, the pots, the doorway card. Kept fixtures stay.
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
