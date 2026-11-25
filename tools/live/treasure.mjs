/**
 * Live walk, treasure: the treasure pot, slice R1. Walks docs/treasure/TESTING.md
 * on both seats: the GM seat stocks, opens and closes a pot the way a Judge
 * does, and the Player seat's own client turns and takes, so every player act
 * travels the real relay to the GM seat's client. Every observable is a
 * boolean or a count. Machine values arrive through ./_env.mjs.
 *
 * Covers: the boot recorder and styles/treasure.css being loaded on both
 * seats; fixtures; Judge seat 1 to 5 (the scene control's tool, three kinds of
 * card dropped on the grid, an Add and a Replace card dropped in their
 * buckets, a value card through its dialog, the mode, Open to the table and
 * what it writes); Player seat 1 to 4 (the doorway button, the face-down cards
 * and what they say, a flip, a Take onto the seat's own character through the
 * actor pick); Refusals (a flip while staging, a Take onto an actor the seat
 * does not own, a Take of a face-down card, a seat set to None after the
 * opening and a seat holding LIMITED that the audience copy never named, a
 * planted Card the pot's `order`
 * does not list, and a request after the pot is gone); the window contract on
 * both seats; Close (leftovers to a place, the chat card rewritten as the
 * record, the pile gone, no chat message from the delete); teardown.
 *
 * Fixtures, kept and found by marker: `treasure/player-character` (a
 * character the Player seat owns), `treasure/judge-character` (a character
 * the Player seat does not own), `treasure/item-masked` (an item, magical,
 * undetected, identification none, disguised as a plain item),
 * `treasure/coin` (a money item with a count and a rate) and
 * `treasure/place` (a location that keeps goods). Each step brings the shape
 * it needs before its first check; nothing is restored at the end. A pot is
 * the run's own: the scene control makes it, the walk marks it `treasure/pot`
 * after retiring any standing one (a setup check), and its close deletes it.
 * Everything the run made is swept by tracked id: the pot if its close failed,
 * the doorway card, the planted Card, the rows the Take and the close created
 * on the characters and the place. Kept fixtures stay.
 *
 * Real gestures: every click on a control (the scene tool, Turn, Take, Open
 * the table, Open to the table, the mode buttons, Add a value card, Close the
 * pot, each dialog's confirm) is a CDP mouse press at the control's centre,
 * when the control is the element under that point; one that is covered or
 * outside the viewport is pressed with `click()` and printed as a note, and
 * the run's tally of each is printed. Scripted: a drag (a `drop` event with
 * the data a drag of an item carries, dispatched on the zone, since the
 * sheet's listener is on its root); the text typed into the value dialog and
 * the actor and place picks (set by value, then `change`); every relay call a
 * refusal check sends from the Player page (the sheet offers no way to send
 * one); the planted Card (created on the GM seat); the flip and claim a
 * check reads back from documents rather than from a click.
 *
 * Not reached: a real drag with pointer travel and the zone's highlight; a
 * Take onto a monster or a token actor; a seat that joined (a real new user)
 * after Open, which Refusals stands in for by emptying the audience copy; a table with more than one non-Judge seat taking at once; the
 * "left behind" wording (a close with no place chosen); the Player seat's
 * keyboard route through the cards; bands, deal toggles and later slices.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const LANG = "ACKS-TREASURE";

const MARKS = {
  player: "treasure/player-character",
  judge: "treasure/judge-character",
  item: "treasure/item-masked",
  coin: "treasure/coin",
  place: "treasure/place",
  pot: "treasure/pot",
};
const NAMES = { player: "QA Treasure Player Character", judge: "QA Treasure Judge Character", place: "QA Treasure Place" };
const TRUE_ITEM = {
  name: "QA Treasure Trinket", type: "item", img: "icons/svg/item-bag.svg",
  system: { cost: 120, description: "<p>QA true description.</p>" },
  flags: { "acks-extras": { markets: { magic: true, aura: "arcane", identified: "none", detected: false } } },
};
const APPARENT = { name: "Plain thing", img: "icons/svg/item-bag.svg" };
const COIN = { name: "QA Treasure Coin", type: "money", img: "icons/svg/coins.svg", system: { coppervalue: 100, quantity: 40 } };
const COIN_GP = (COIN.system.quantity * COIN.system.coppervalue) / 100;
const VALUE = { pool: "gems", label: "QA Treasure Gem", gp: 25 };
const TIMEOUT_MS = 25_000;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__twBoot = { phase: "load", phases: [], errors: [] });
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

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ lang }) => {
    const H = (globalThis.__tw = globalThis.__tw ?? {});
    const base = "/modules/acks-extras/scripts";
    H.LANG = lang;
    H.S = await import(`${base}/lib/sockets.mjs`);
    H.STO = await import(`${base}/lib/storage.mjs`);
    H.STL = await import(`${base}/lib/storage-logic.mjs`);
    H.IM = await import(`${base}/lib/item-model.mjs`);
    H.DL = await import(`${base}/equipment/disguise-logic.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ timeout: true }), ms))]);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.t = (key, data) => {
      const full = H.LANG + "." + key;
      return data ? game.i18n.format(full, data) : game.i18n.localize(full);
    };
    H.gp = (n) => (Math.round(n * 100) / 100).toLocaleString(game.i18n.lang);
    H.pile = (potId) => game.cards.get(potId) ?? null;
    H.sheet = (potId) => H.pile(potId)?.sheet ?? null;
    /** A chat card's doorway or record, read from the DOM of this seat's chat log. */
    H.doorway = async (messageId) => {
      const li = document.querySelector(`[data-message-id='${messageId}']`);
      if (!li) return { found: false };
      const door = li.querySelector(".acks-extras-treasure-door");
      const record = li.querySelector(".acks-extras-treasure-record");
      return {
        found: true,
        door: !!door,
        record: !!record,
        title: H.text(li.querySelector(".acks-extras-treasure-door__title")),
        turned: H.text(li.querySelector("[data-field='turned']")),
        haul: H.text(li.querySelector("[data-field='haul']")),
        pips: li.querySelectorAll(".acks-extras-treasure-door__pip").length,
        pipsUp: li.querySelectorAll(".acks-extras-treasure-door__pip.is-up").length,
        open: !!li.querySelector("[data-action='openTable']"),
        recordTitle: H.text(record?.querySelector("h3")),
        recordHaul: H.text(record?.querySelector("p")),
        rows: [...(record?.querySelectorAll("li") ?? [])].map(H.text),
      };
    };
    H.dialog = () => [...foundry.applications.instances.values()].find((a) => a.rendered && a.options?.classes?.includes("acks-extras-treasure-dialog")) ?? null;
    H.opened = H.opened ?? [];
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      userId: game.user.id,
      activeGM: !!game.users.activeGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      socketlib: typeof globalThis.socketlib !== "undefined",
      treasure: !!globalThis.acksExtras?.treasure,
      boot: globalThis.__twBoot ?? null,
    };
  },
  t: async ({ key, data }) => globalThis.__tw.t(key, data),
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  users: async () => ({ gm: game.user.id, others: game.users.filter((u) => !u.isGM).map((u) => u.id) }),

  /** CSS as the page sees it: the stylesheet link, and a computed style the file alone sets, on a probe element. */
  styles: async () => {
    const links = [...document.querySelectorAll("link[rel='stylesheet']")].map((l) => l.href).filter((h) => /\/styles\/treasure\.css/.test(h));
    const sheets = [...document.styleSheets].map((s) => s.href ?? "").filter((h) => /\/styles\/treasure\.css/.test(h));
    const probe = document.createElement("div");
    probe.className = "acks-extras-treasure";
    probe.style.cssText = "position:fixed;left:-9999px;top:0;width:200px;height:100px";
    probe.innerHTML = "<section class='acks-extras-treasure__root'></section>";
    document.body.append(probe);
    const out = {
      links: links.length,
      sheets: sheets.length,
      overflowY: getComputedStyle(probe.firstElementChild).overflowY,
      bandToken: getComputedStyle(probe).getPropertyValue("--acks-extras-treasure-band-0").trim() !== "",
      manifest: JSON.stringify([...(game.modules.get("acks-extras")?.styles ?? [])]).includes("treasure.css"),
    };
    probe.remove();
    return out;
  },

  /** Source data for the masked item fixture: the truth dressed by the equipment feature's own disguise. */
  itemData: async ({ truth, apparent }) => globalThis.__tw.DL.disguiseData(truth, apparent),

  /** Bring the kept fixtures to the shape every step starts from, and say what had to be written. */
  shape: async ({ ids, playerId, want, coin, placeId }) => {
    const H = globalThis.__tw;
    const wrote = [];
    const playerChar = game.actors.get(ids.player);
    const judgeChar = game.actors.get(ids.judge);
    const item = game.items.get(ids.item);
    const coinItem = game.items.get(ids.coin);
    const place = game.actors.get(placeId);
    if (!playerChar || !judgeChar || !item || !coinItem || !place) return { ok: false, found: { player: !!playerChar, judge: !!judgeChar, item: !!item, coin: !!coinItem, place: !!place } };
    if ((playerChar.ownership?.[playerId] ?? 0) < 3) { await playerChar.update({ [`ownership.${playerId}`]: 3 }); wrote.push("playerOwnership"); }
    if (judgeChar.testUserPermission(game.users.get(playerId), "OWNER")) { await judgeChar.update({ "ownership.default": 0, [`ownership.${playerId}`]: 0 }); wrote.push("judgeOwnership"); }
    const flags = item.flags?.["acks-extras"] ?? {};
    const patch = {};
    if (item.name !== want.name) patch.name = want.name;
    if (JSON.stringify(flags.disguise) !== JSON.stringify(want.flags["acks-extras"].disguise)) patch["flags.acks-extras.disguise"] = want.flags["acks-extras"].disguise;
    for (const [k, v] of Object.entries({ magic: true, aura: "arcane", identified: "none", detected: false })) if (item.getFlag("acks-extras", "markets")?.[k] !== v) patch[`flags.acks-extras.markets.${k}`] = v;
    if (Object.keys(patch).length) { await item.update(patch); wrote.push("item"); }
    if (Number(coinItem.system.quantity) !== coin.quantity || Number(coinItem.system.coppervalue) !== coin.coppervalue) { await coinItem.update({ "system.quantity": coin.quantity, "system.coppervalue": coin.coppervalue }); wrote.push("coin"); }
    if (!H.STO.isProvider(place)) { await place.update({ "flags.acks-extras.storage.provider": true }); wrote.push("place"); }
    return {
      ok: true,
      wrote,
      itemName: item.name,
      itemMagical: H.IM.isMagical(item),
      itemDisguised: !!item.getFlag("acks-extras", "disguise"),
      itemDetected: item.getFlag("acks-extras", "markets")?.detected,
      itemIdentified: item.getFlag("acks-extras", "markets")?.identified,
      playerOwns: playerChar.testUserPermission(game.users.get(playerId), "OWNER"),
      judgeOwnedByPlayer: judgeChar.testUserPermission(game.users.get(playerId), "OWNER"),
      coinType: coinItem.type,
      placeProvider: H.STO.isProvider(place),
    };
  },
  sees: async ({ ids }) => {
    const H = globalThis.__tw;
    return !!(await H.poll(() => !!game.actors.get(ids.player) && !!game.actors.get(ids.judge) && !!game.items.get(ids.item) && !!game.items.get(ids.coin) && !!game.actors.get(ids.place)));
  },

  /* ---- Finding and clicking a control --------------------------------- */
  /** Resolve a control and report where a real pointer would land on it. `scope`: `doc`, `sheet` (the pot's window) or `dialog`. */
  locate: async ({ scope, potId, sel, nth = 0, scroll = true }) => {
    const H = globalThis.__tw;
    const root = scope === "sheet" ? H.root(H.sheet(potId)) : scope === "dialog" ? H.root(H.dialog()) : document;
    if (!root) return { found: false, why: "no scope" };
    const list = [...root.querySelectorAll(sel)];
    const el = list[nth] ?? null;
    H.target = el;
    if (!el) return { found: false, count: list.length };
    // A second reading, taken after the pointer arrived, leaves the scroll alone: it reports where the control is now.
    if (scroll) {
      el.scrollIntoView({ block: "center", inline: "center" });
      await H.sleep(150);
    }
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const hit = r.width > 0 && r.height > 0 ? document.elementFromPoint(x, y) : null;
    return { found: true, ok: !!hit && (hit === el || el.contains(hit)), x, y, disabled: !!el.disabled, count: list.length };
  },
  pressTarget: async () => {
    const H = globalThis.__tw;
    if (!H.target) return false;
    H.target.click();
    return true;
  },
  /** Record every click that reaches a doorway's Open button, and which copy of the card it was (the chat log's, or the chat notification's). */
  watchDoorClicks: async () => {
    globalThis.__doorClicks = [];
    if (globalThis.__doorWatch) return true;
    globalThis.__doorWatch = true;
    document.addEventListener("click", (event) => {
      const btn = event.target?.closest?.(".acks-extras-treasure-door [data-action='openTable']");
      if (!btn) return;
      const copies = document.querySelectorAll(".acks-extras-treasure-door [data-action='openTable']").length;
      globalThis.__doorClicks.push({ inNotification: !!btn.closest("#chat-notifications"), inLog: !!btn.closest(".chat-log"), copies, connected: btn.isConnected });
    }, true);
    return true;
  },
  /** Why a seat's doorway press opened no window: the clicks the doorway heard, each copy of the button with its rect now, the focused element, and the sheet's state. */
  doorDiag: async ({ potId }) => {
    const pile = game.cards.get(potId);
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
    const active = document.activeElement;
    return {
      clicks: globalThis.__doorClicks ?? null,
      copies: [...document.querySelectorAll(".acks-extras-treasure-door [data-action='openTable']")].map((b) => ({ in: b.closest("#chat-notifications") ? "notification" : b.closest(".chat-log") ? "log" : "other", rect: rectOf(b) })),
      active: active ? { tag: active.tagName.toLowerCase(), cls: String(active.className ?? "").slice(0, 80) } : null,
      limited: pile ? pile.testUserPermission(game.user, "LIMITED") : null,
      sheet: pile?.sheet ? { rendered: !!pile.sheet.rendered, state: pile.sheet.state ?? null } : null,
    };
  },

  /* ---- Reading the pot ------------------------------------------------ */
  stage: async ({ potId }) => {
    const H = globalThis.__tw;
    const pile = H.pile(potId);
    if (!pile) return { gone: true };
    const f = pile.getFlag("acks-extras", "treasure") ?? {};
    const directory = ui.cards?.element ? !!ui.cards.element.querySelector(`[data-entry-id="${potId}"]`) : null;
    return {
      gone: false,
      name: pile.name,
      phase: f.phase ?? null,
      mode: f.mode ?? null,
      order: f.order ?? [],
      buckets: { add: f.buckets?.add ?? [], replace: f.buckets?.replace ?? [] },
      replaced: f.replaced ?? [],
      audience: f.audience ?? [],
      messageId: f.messageId ?? null,
      sheetClass: pile.flags?.core?.sheetClass ?? null,
      ownership: JSON.parse(JSON.stringify(pile.ownership ?? {})),
      directory,
      cards: pile.cards.contents.map((c) => {
        const t = c.getFlag("acks-extras", "card") ?? {};
        return {
          id: c.id, face: c.face ?? null, faceName: c.faces?.[0]?.name ?? null, suit: c.suit, value: c.value,
          pool: t.pool ?? null, bucket: t.bucket ?? null, label: t.label ?? "", coin: t.coin ?? null, valueGp: t.valueGp ?? null,
          source: t.source?.uuid ?? null, claimedBy: t.claimedBy ?? null, maskName: t.mask?.name ?? null, detected: t.detected,
        };
      }),
    };
  },
  /** The pot's window as a seat reads it. */
  sheetRead: async ({ potId }) => {
    const H = globalThis.__tw;
    const pile = H.pile(potId);
    const app = pile?.sheet;
    const root = H.root(app);
    if (!root) return { rendered: false };
    const isGM = game.user.isGM;
    const q = (s, el = root) => el.querySelector(s);
    const qa = (s, el = root) => [...el.querySelectorAll(s)];
    const cards = qa("ol.acks-extras-treasure__grid > li[data-card-id]").map((li) => {
      const id = li.dataset.cardId;
      const card = pile.cards.get(id);
      const back = li.querySelector(".acks-extras-treasure-back");
      const tipEl = li.matches("[data-tooltip-text]") ? li : li.querySelector("[data-tooltip-text]");
      const tagEl = back ? back.querySelector(".acks-extras-treasure-back__pool") : li.querySelector(".acks-extras-treasure-card__tag span");
      const out = {
        id,
        down: !!back,
        up: !!li.querySelector("[data-up]") || (isGM && !!li.querySelector(".acks-extras-treasure-card--judge")),
        suit: card?.suit ?? null,
        tag: H.text(tagEl),
        name: H.text(li.querySelector(".acks-extras-treasure-card__name")),
        notes: qa(".acks-extras-treasure-card__note", li).map(H.text),
        aura: !!li.querySelector(".acks-tag"),
        take: !!li.querySelector("[data-action='take']"),
        flip: !!li.querySelector("[data-action='flip']"),
        by: H.text(li.querySelector(".acks-extras-treasure-card__by")),
        label: back?.getAttribute("aria-label") ?? null,
        tip: tipEl?.dataset.tooltipText ?? null,
      };
      if (!isGM && card) {
        out.labelOk = !back || out.label === H.t("card.backLabel", { pool: H.t(`pool.${card.suit}`), band: H.t(`band.${card.value}`) });
        out.tipOk = out.tip === H.t("tip.pool", { pool: H.t(`pool.${card.suit}`), cite: H.t(`cite.${card.suit}`) });
      }
      return out;
    });
    const figure = q(".acks-extras-treasure__figure");
    return {
      rendered: true,
      title: H.text(q(".window-title")),
      text: H.text(root),
      cards,
      empty: !!q(".acks-extras-treasure__empty"),
      figure: H.text(figure),
      figureTip: figure?.dataset.tooltipText ?? null,
      turned: H.text(q(".acks-extras-treasure__turned")),
      hoards: H.text(q(".acks-extras-treasure__hoards")),
      modes: qa("[data-action='setMode']").map((b) => ({ mode: b.dataset.mode, pressed: b.getAttribute("aria-pressed"), text: H.text(b) })),
      modeHint: H.text(q("[role='group'][aria-labelledby$='-mode'] .acks-extras-treasure__hint")),
      openText: H.text(q("aside [data-action='openTable']")),
      buckets: qa("section.acks-extras-treasure__bucket").map((s) => ({ key: s.dataset.acceptDrop, title: H.text(q("h3", s)), rows: qa(".acks-extras-treasure__bucket-name", s).map(H.text) })),
      gridZone: !!q("ol.acks-extras-treasure__grid[data-accept-drop='pot']"),
      controls: { close: !!q("[data-action='closePot']"), open: !!q("aside [data-action='openTable']"), addValue: !!q("[data-action='addValue']"), zones: qa("[data-accept-drop]").length, remove: qa("[data-action='removeCard']").length },
    };
  },
  /** Render the pot's sheet again and read it, for a seat whose window is already open. */
  rerender: async ({ potId }) => {
    const H = globalThis.__tw;
    const app = H.sheet(potId);
    if (app?.rendered) await app.render();
    await H.sleep(500);
    return true;
  },
  waitSheet: async ({ potId }) => {
    const H = globalThis.__tw;
    const app = await H.poll(() => { const s = H.sheet(potId); return s?.rendered && H.root(s)?.querySelector("li[data-card-id], .acks-extras-treasure__empty") ? s : null; }, { tries: 60, every: 250 });
    if (app && !H.opened.includes(app)) H.opened.push(app);
    await H.sleep(300);
    if (app) return { rendered: true };
    // Not rendered: say what the seat holds, so a failure names its cause.
    const pile = H.pile(potId);
    const s = pile?.sheet;
    // The two reads come before the render below, so they report what the press left and not the walk's own render.
    const appRendered = !!s?.rendered;
    const root = !!H.root(s);
    // A press's render is not awaited, so what it threw reached no recorder: render once more and catch it.
    let threw = null;
    try { await s?.render(true); } catch (err) { threw = String(err?.stack ?? err).slice(0, 700); }
    await H.sleep(600);
    return {
      rendered: false,
      pile: !!pile,
      limited: !!pile?.testUserPermission(game.user, "LIMITED"),
      sheetClass: s?.constructor?.name ?? null,
      appRendered,
      root,
      threw,
      errors: H.errors.slice(-5),
    };
  },
  /** The sheet the scene control's tool opened, or, where the tool is absent, one made through the feature's API. */
  armTool: async () => {
    const H = globalThis.__tw;
    H.before = new Set(foundry.applications.instances.values());
    try {
      await ui.controls.render({ force: true });
      ui.controls.activate({ control: "tokens" });
    } catch (err) {
      return { tool: false, error: String(err?.message ?? err) };
    }
    await H.sleep(600);
    const registered = ui.controls.controls?.tokens?.tools?.acksTreasure ?? ui.controls.controls?.find?.((c) => c.name === "tokens")?.tools?.acksTreasure ?? null;
    return { tool: !!document.querySelector("#scene-controls [data-tool='acksTreasure']"), registered: !!registered };
  },
  newPotApi: async () => {
    const H = globalThis.__tw;
    H.before = new Set(foundry.applications.instances.values());
    await acksExtras.treasure.newPot();
    return true;
  },
  awaitNewSheet: async () => {
    const H = globalThis.__tw;
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !H.before.has(a) && a.rendered && a.constructor.name === "PotSheet") ?? null, { tries: 60, every: 250 });
    if (!app) return null;
    H.opened.push(app);
    await H.sleep(500);
    return { potId: app.document.id, uuid: app.document.uuid, name: app.document.name };
  },
  /** Dispatch the drop a drag of an item makes onto a zone, wait until the card and its listing both landed. */
  dropAndWait: async ({ potId, zone, uuid }) => {
    const H = globalThis.__tw;
    const pile = H.pile(potId);
    const el = H.root(pile.sheet)?.querySelector(`[data-accept-drop='${zone}']`);
    if (!el) return { ok: false, why: "no zone" };
    const before = new Set(pile.cards.map((c) => c.id));
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const ids = await H.poll(() => {
      const f = pile.getFlag("acks-extras", "treasure") ?? {};
      const listed = new Set([...(f.order ?? []), ...(f.buckets?.add ?? []), ...(f.buckets?.replace ?? [])]);
      const fresh = pile.cards.filter((c) => !before.has(c.id));
      return fresh.length && fresh.every((c) => listed.has(c.id)) ? fresh.map((c) => c.id) : null;
    });
    await H.sleep(400);
    return { ok: !!ids, ids: ids ?? [] };
  },
  waitState: async ({ potId, until, cardId = null, mode = null }) => {
    const H = globalThis.__tw;
    const met = () => {
      const pile = H.pile(potId);
      if (until === "gone") return !pile;
      if (!pile) return false;
      const f = pile.getFlag("acks-extras", "treasure") ?? {};
      if (until === "phase") return f.phase === mode;
      if (until === "mode") return f.mode === mode;
      const card = pile.cards.get(cardId);
      if (!card) return false;
      if (until === "up") return card.face === 0;
      if (until === "claimed") return !!card.getFlag("acks-extras", "card")?.claimedBy?.actorName;
      return false;
    };
    return { met: !!(await H.poll(met, { tries: 60, every: 250 })) };
  },
  cardsSnap: async ({ potId }) => {
    const pile = globalThis.__tw.pile(potId);
    return pile ? pile.cards.contents.map((c) => ({ id: c.id, face: c.face ?? null, faces: JSON.stringify(c.faces ?? []), claimed: !!c.getFlag("acks-extras", "card")?.claimedBy })) : [];
  },

  /* ---- Observers, only to prove what was NOT written ------------------- */
  watchCards: async ({ potId }) => {
    const H = globalThis.__tw;
    H.upd = [];
    H.updPot = potId;
    H.updHooks = [
      ["updateCard", Hooks.on("updateCard", (card, change) => { if (card.parent?.id === H.updPot) H.upd.push({ cardId: card.id, keys: Object.keys(change), faces: "faces" in change, face: "face" in change }); })],
      ["updateCards", Hooks.on("updateCards", (pile) => { if (pile.id === H.updPot) H.upd.push({ pile: true }); })],
    ];
    return true;
  },
  readCards: async () => {
    const H = globalThis.__tw;
    const out = H.upd ?? [];
    H.upd = [];
    return out;
  },
  unwatchCards: async () => {
    const H = globalThis.__tw;
    for (const [name, id] of H.updHooks ?? []) Hooks.off(name, id);
    H.updHooks = [];
    return true;
  },
  watchChat: async () => {
    const H = globalThis.__tw;
    H.chatSeen = [];
    H.chatOthers = 0;
    H.chatHook = Hooks.on("createChatMessage", (m, _o, userId) => {
      if (userId === game.user.id) H.chatSeen.push({ id: m.id, flags: Object.keys(m.flags ?? {}), length: (m.content ?? "").length });
      else H.chatOthers++;
    });
    return true;
  },
  readChat: async () => {
    const H = globalThis.__tw;
    if (H.chatHook != null) { Hooks.off("createChatMessage", H.chatHook); H.chatHook = null; }
    return { own: H.chatSeen ?? [], others: H.chatOthers ?? 0 };
  },

  /* ---- Messages -------------------------------------------------------- */
  messages: async ({ uuid }) => game.messages.filter((m) => m.getFlag("acks-extras", "treasure")?.uuid === uuid).map((m) => m.id),
  messageRead: async ({ messageId, needles }) => {
    const m = game.messages.get(messageId);
    if (!m) return { exists: false };
    const flag = m.getFlag("acks-extras", "treasure") ?? null;
    const content = m.content ?? "";
    return {
      exists: true,
      flagKeys: flag ? Object.keys(flag) : null,
      uuid: flag?.uuid ?? null,
      door: content.includes("acks-extras-treasure-door"),
      record: content.includes("acks-extras-treasure-record"),
      leaks: needles.filter((n) => content.includes(n)).length,
    };
  },
  doorway: async ({ messageId }) => globalThis.__tw.doorway(messageId),
  waitDoorway: async ({ messageId, turned = null, record = false }) => {
    const H = globalThis.__tw;
    const met = await H.poll(async () => { const d = await H.doorway(messageId); return d.found && (record ? d.record : d.door && (turned === null || d.turned === turned)) ? d : null; }, { tries: 80, every: 250 });
    return met ?? (await H.doorway(messageId));
  },

  /* ---- Dialogs --------------------------------------------------------- */
  dialogWait: async ({ timeout = 5000 }) => {
    const H = globalThis.__tw;
    const app = await H.poll(() => H.dialog(), { tries: Math.ceil(timeout / 150), every: 150 });
    if (!app) return { found: false };
    await H.sleep(200);
    const root = H.root(app);
    const select = root.querySelector("select");
    return {
      found: true,
      title: H.text(root.querySelector(".window-title")),
      fields: [...root.querySelectorAll("[name]")].map((e) => e.name),
      options: select ? [...select.options].map((o) => o.value) : [],
      optionsAllOwned: select && select.name === "actor" ? [...select.options].every((o) => { try { return !!fromUuidSync(o.value)?.isOwner; } catch { return false; } }) : null,
    };
  },
  dialogSet: async ({ values }) => {
    const H = globalThis.__tw;
    const root = H.root(H.dialog());
    if (!root) return { ok: false };
    const missing = [];
    for (const [name, value] of Object.entries(values)) {
      const el = root.querySelector(`[name='${name}']`);
      if (!el) { missing.push(name); continue; }
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: !missing.length, missing, readBack: Object.fromEntries(Object.keys(values).map((n) => [n, root.querySelector(`[name='${n}']`)?.value ?? null])) };
  },

  /* ---- Relay calls a refusal check sends from this seat ------------------ */
  relay: async ({ potId, op, cardId, actorUuid }) => {
    const H = globalThis.__tw;
    const payload = { potId, op, cardId };
    if (actorUuid !== undefined) payload.actorUuid = actorUuid;
    const r = await H.race(H.S.executeAsGM("treasurePot", payload), 25000);
    return r === undefined ? { none: true } : r;
  },
  /**
   * Set one seat's ownership level on the pile, and optionally the audience
   * copy the opening wrote, then answer what the pile and the flag read back
   * and whether Foundry now counts the seat LIMITED. The relay reads the level
   * when an act arrives, never the copy.
   */
  setSeat: async ({ potId, userId, level, audience }) => {
    const H = globalThis.__tw;
    const pile = H.pile(potId);
    const update = {};
    if (level !== undefined) update[`ownership.${userId}`] = level;
    if (audience !== undefined) update["flags.acks-extras.treasure.audience"] = audience;
    await pile.update(update);
    await H.sleep(500);
    return {
      level: pile.ownership?.[userId] ?? 0,
      audience: pile.getFlag("acks-extras", "treasure")?.audience ?? [],
      limited: pile.testUserPermission(game.users.get(userId), "LIMITED"),
    };
  },
  plant: async ({ potId, fromId }) => {
    const H = globalThis.__tw;
    const pile = H.pile(potId);
    const truth = foundry.utils.deepClone(pile.cards.get(fromId).getFlag("acks-extras", "card"));
    truth.claimedBy = null;
    const made = await pile.createEmbeddedDocuments("Card", [{
      name: "QA Planted", type: "base", suit: "item", value: 0, back: { name: "QA Planted", text: "", img: "icons/svg/item-bag.svg" },
      faces: [{ name: "QA Planted", text: "", img: "icons/svg/item-bag.svg" }], face: 0,
      flags: { "acks-extras": { card: truth } },
    }]);
    return made[0] ? { id: made[0].id, uuid: made[0].uuid } : null;
  },
  forceDeletePot: async ({ potId }) => {
    const pile = globalThis.__tw.pile(potId);
    if (!pile) return { gone: true };
    await pile.delete({ chatNotification: false });
    return { deleted: !game.cards.get(potId) };
  },

  /* ---- Actors, items, the place ---------------------------------------- */
  actorRows: async ({ actorId }) => {
    const a = game.actors.get(actorId);
    return (a?.items ?? []).map((i) => {
      const m = i.getFlag("acks-extras", "markets") ?? {};
      const d = i.getFlag("acks-extras", "disguise") ?? null;
      const q = Number(i.system?.quantity ?? 0);
      return { id: i.id, uuid: i.uuid, name: i.name, type: i.type, qty: q, detected: m.detected ?? "absent", magic: !!m.magic, disguised: !!d, trueName: d?.true?.name ?? null };
    });
  },
  placeRead: async ({ placeId }) => {
    const H = globalThis.__tw;
    const place = game.actors.get(placeId);
    if (!place) return { found: false };
    const rows = place.items.map((i) => {
      const q = H.STL.quantityOf(i.toObject());
      return { id: i.id, uuid: i.uuid, name: i.name, type: i.type, qty: q ? q.value : 1, cp: i.type === "money" ? Number(i.system?.quantity ?? 0) * Number(i.system?.coppervalue ?? 0) : 0, owner: H.STL.storageFlagOf(i)?.ownerUuid ?? null };
    });
    return {
      found: true,
      provider: H.STO.isProvider(place),
      name: place.name,
      uuid: place.uuid,
      ids: rows.map((r) => r.id),
      houseGoods: rows.filter((r) => r.type !== "money" && r.owner === H.STL.HOUSE_OWNER).reduce((n, r) => n + r.qty, 0),
      cp: rows.reduce((n, r) => n + r.cp, 0),
      rows: rows.map((r) => ({ id: r.id, uuid: r.uuid, type: r.type })),
    };
  },
  /** A fresh item sheet on this seat, read for the magic it shows. */
  itemSheet: async ({ actorId, itemId }) => {
    const H = globalThis.__tw;
    const item = game.actors.get(actorId)?.items.get(itemId);
    if (!item) return { rendered: false };
    await item.sheet.render(true);
    H.opened.push(item.sheet);
    await H.poll(() => H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__badge"), { tries: 40, every: 200 });
    await H.sleep(500);
    const root = H.root(item.sheet);
    if (!root) return { rendered: false };
    return {
      rendered: true,
      band: !!root.querySelector(".acks-extras-item-sheet__band"),
      magicMount: !!root.querySelector("[data-mount='magic']"),
      magicPanel: !!root.querySelector(".acks-extras-markets-magic h3"),
      aura: !!root.querySelector(".acks-extras-item-sheet__aura-label"),
      auraClass: !!root.querySelector(".acks-extras-item-sheet__art.has-aura"),
      identifyBox: !!root.querySelector(".acks-extras-markets-identify"),
      name: H.text(root.querySelector(".window-title")).includes(item.name),
    };
  },

  /* ---- The window contract --------------------------------------------- */
  windowRead: async ({ potId }) => {
    const H = globalThis.__tw;
    const app = H.sheet(potId);
    const el = H.root(app);
    if (!el) return { rendered: false };
    const root = el.querySelector(".acks-extras-treasure__root");
    const content = el.querySelector(".window-content");
    if (!root || !content) return { rendered: true, root: !!root, content: !!content };
    return {
      rendered: true,
      handle: !!el.querySelector(":scope > .window-resize-handle"),
      overflowY: getComputedStyle(root).overflowY,
      scrollable: JSON.stringify(app.constructor.PARTS?.body?.scrollable ?? null),
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      within: root.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom + 1,
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height),
    };
  },
  resize: async ({ potId, width, height }) => {
    const H = globalThis.__tw;
    H.sheet(potId).setPosition({ width, height });
    await H.sleep(600);
    return true;
  },
  scrollToEnd: async ({ potId }) => {
    const H = globalThis.__tw;
    const root = H.root(H.sheet(potId))?.querySelector(".acks-extras-treasure__root");
    if (!root) return null;
    root.scrollTop = root.scrollHeight;
    await H.sleep(200);
    return root.scrollTop;
  },

  closeAll: async () => {
    const H = globalThis.__tw;
    let n = 0;
    for (const app of H?.opened ?? []) { try { await app.close({ force: true, animate: false }); n++; } catch { /* already closed */ } }
    if (H) H.opened = [];
    return n;
  },
  drain: async () => ({ errors: globalThis.__tw.errors.slice() }),
  restore: async () => {
    const H = globalThis.__tw;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    H.patched = false;
    for (const [name, id] of H.updHooks ?? []) Hooks.off(name, id);
    if (H.chatHook != null) Hooks.off("createChatMessage", H.chatHook);
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
const t = (api, key, data) => run(api, P.t, { key, data });
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.treasure`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s (is the treasure feature loaded? a module.json change needs a world relaunch)`);
    await sleep(1000);
  }
}
/** A CDP session on the seat's page: the boot recorder, and the real pointer. */
async function cdp(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((x) => x.type === "page" && x.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 700000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close() };
}
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const s = await cdp(port);
  await s.send("Page.enable");
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await s.send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  s.close();
  return seconds;
}
const idOf = (fx) => fx.id ?? String(fx.uuid).split(".").pop();

const clicks = { real: 0, scripted: 0 };
/**
 * Press a control the way a user does: a real pointer press at its centre when
 * that point is the control (or inside it), else `click()` and a note saying so.
 * The control is read again once the pointer has arrived, and the press lands at
 * that reading; where its centre is no longer the control the press is not made
 * and nothing is retried, so a control that moves under the pointer stays visible.
 * Resolves to `{found, disabled?, real?, aimed?, moved?, now?}`.
 */
async function press(api, port, spec, label) {
  const at = await run(api, P.locate, spec);
  if (!at?.found) return { found: false };
  if (at.disabled) return { found: true, disabled: true };
  if (at.ok) {
    const s = await cdp(port);
    let now = null;
    try {
      await s.send("Page.bringToFront");
      await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await sleep(120);
      now = await run(api, P.locate, { ...spec, scroll: false });
      if (now?.found && now.ok) {
        await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: now.x, y: now.y, button: "left", buttons: 1, clickCount: 1 });
        await sleep(60);
        await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: now.x, y: now.y, button: "left", buttons: 0, clickCount: 1 });
      }
    } finally {
      s.close();
    }
    const aimed = { x: at.x, y: at.y };
    if (!now?.found || !now.ok) {
      note(`press not made (the control moved or was covered after the pointer arrived)`, { label: label ?? spec.sel, aimed, now });
      await sleep(300);
      return { found: true, real: false, moved: true, aimed, now };
    }
    clicks.real++;
    await sleep(300);
    return { found: true, real: true, aimed, now: { x: now.x, y: now.y } };
  }
  await run(api, P.pressTarget);
  clicks.scripted++;
  note(`scripted click (the control was not the element under its centre)`, label ?? spec.sel);
  await sleep(300);
  return { found: true, real: false };
}

let gm = null;
let player = null;
let potId = null;
let placeId = null;
let potClosed = false;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 900_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  const seatG = await run(gm, P.install, { lang: LANG });
  const seatP = await run(player, P.install, { lang: LANG });
  if (!seatG.isGM || !seatG.activeGMIsSelf) blocked("the GM seat is not the active GM: another GM client holds it, so a player's relayed request would reach that client and not this one");
  if (seatP.isGM || seatP.role > 2) blocked("the player seat is not a player");
  if (!seatP.activeGM || !seatP.socketlib) blocked("the player seat cannot reach a GM client (no active GM, or socketlib is absent): a relayed request would never settle");
  check("the GM seat is the active GM and the player seat is a player with a GM to reach", seatG.isGM && seatG.activeGMIsSelf && !seatP.isGM && seatP.activeGM && seatP.socketlib, { gm: seatG.role, player: seatP.role });
  for (const [key, c] of Object.entries({ gm: seatG, player: seatP })) {
    const phases = c.boot?.phases ?? [];
    const errors = c.boot?.errors ?? [];
    const naming = errors.filter((e) => /treasure|pot-sheet|pot-relay|pot-logic|doorway|\/pot\.mjs|hoard/i.test(e.text));
    note(`${key}: errors recorded from load through ready (any text)`, errors.length);
    check(`${key}: init, setup and ready ran and no error names a treasure file`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && naming.length === 0 && c.treasure, { phases, naming: naming.length, api: c.treasure });
  }

  section("styles");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const s = await run(api, P.styles);
    note(`${key}: module.json styles entry names treasure.css (read of the loaded module)`, s.manifest);
    // Core 14 serves module styles without a <link> naming the file, so the computed style is the proof.
    note(`${key}: a stylesheet link or sheet names treasure.css`, s.links > 0 || s.sheets > 0);
    check(`${key}: styles/treasure.css is applied: the computed style and the band token only it sets (FAIL here means a world relaunch is needed, since module.json styles are read at world launch)`, s.manifest && s.overflowY === "auto" && s.bandToken, s);
  }

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const fxPlayer = await gm.fixture(MARKS.player, "Actor", { name: NAMES.player, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 } });
  const fxJudge = await gm.fixture(MARKS.judge, "Actor", { name: NAMES.judge, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
  const want = await run(gm, P.itemData, { truth: TRUE_ITEM, apparent: APPARENT });
  const fxItem = await gm.fixture(MARKS.item, "Item", want);
  const fxCoin = await gm.fixture(MARKS.coin, "Item", COIN);
  const fxPlace = await gm.fixture(MARKS.place, "Actor", { name: NAMES.place, type: "acks-extras.location", flags: { "acks-extras": { storage: { provider: true } } } });
  const ids = { player: idOf(fxPlayer), judge: idOf(fxJudge), item: idOf(fxItem), coin: idOf(fxCoin), place: idOf(fxPlace) };
  placeId = ids.place;
  const shaped = await run(gm, P.shape, { ids, playerId, want, coin: { quantity: COIN.system.quantity, coppervalue: COIN.system.coppervalue }, placeId });
  check("the kept fixtures stand in the shape the steps start from: the character is the Player seat's, the other is not; the item is magical, undetected, unidentified and disguised; the coin is a money item; the place keeps goods", shaped.ok && shaped.playerOwns && !shaped.judgeOwnedByPlayer && shaped.itemMagical && shaped.itemDisguised && shaped.itemDetected === false && shaped.itemIdentified === "none" && shaped.itemName === APPARENT.name && shaped.coinType === "money" && shaped.placeProvider, shaped);
  check("the Player seat sees every fixture", await run(player, P.sees, { ids }));
  const itemUuid = fxItem.uuid;
  const coinUuid = fxCoin.uuid;
  const playerUuid = fxPlayer.uuid;
  const judgeUuid = fxJudge.uuid;
  const judgeRowsBefore = await run(gm, P.actorRows, { actorId: ids.judge });
  const place0 = await run(gm, P.placeRead, { placeId });
  const users = await run(gm, P.users);

  section("Judge seat 1. the scene control makes a pot");
  note("a pot left standing by an earlier run is retired first (setup is this section's subject)", await gm.retire(MARKS.pot, "Cards"));
  const armed = await run(gm, P.armTool);
  let opened = null;
  if (armed.tool) {
    const c = await press(gm, PORTS.gm, { scope: "doc", sel: "#scene-controls [data-tool='acksTreasure']" }, "Scene controls, Token controls, New treasure pot");
    check("the New treasure pot tool is on the Token controls and was pressed", c.found, { real: c.real });
    opened = await run(gm, P.awaitNewSheet);
  } else {
    note("the scene control's tool button was not found in #scene-controls", `${armed.error ?? "the selector or layout differs from the one this walk infers"}; the pot is made through acksExtras.treasure.newPot(), the function the tool calls`);
    check("the New treasure pot tool is registered on the Token controls for the Judge", armed.registered, armed);
    await run(gm, P.newPotApi);
    opened = await run(gm, P.awaitNewSheet);
  }
  if (!opened) throw new Error("no PotSheet opened on the GM seat after the pot was made");
  potId = opened.potId;
  made.push(gm.track(opened.uuid, "Cards"));
  await gm.mark(opened.uuid, MARKS.pot);
  const s1 = await run(gm, P.stage, { potId });
  const r1 = await run(gm, P.sheetRead, { potId });
  const tTitle = await t(gm, "pot.defaultName");
  const tHoards = await t(gm, "deal.hoardsTitle");
  const tDrop = await t(gm, "deal.dropZone");
  const tOpen = await t(gm, "judge.open");
  const tJudge = await t(gm, "judge.modeJudge");
  const tTable = await t(gm, "judge.modeTable");
  const tAdd = await t(gm, "judge.bucket.add");
  const tReplace = await t(gm, "judge.bucket.replace");
  const tJudgeHint = await t(gm, "judge.modeJudgeHint");
  check("a window titled for the pot opened in staging", r1.rendered && r1.title === tTitle && s1.name === tTitle, { title: r1.title === tTitle });
  check("it reads Hoards to deal with its drop zone, offers the Judge / Table toggle and Open to the table", r1.hoards.includes(tHoards) && r1.hoards.includes(tDrop) && r1.modes.map((m) => m.text).join("|") === `${tJudge}|${tTable}` && r1.openText === tOpen, { hoards: r1.hoards.includes(tHoards), modes: r1.modes.map((m) => m.mode), open: r1.openText === tOpen });
  check("two buckets, Add and Replace, sit beneath an empty grid that takes a drop", r1.buckets.map((b) => b.key).join(",") === "add,replace" && r1.buckets[0].title === tAdd && r1.buckets[1].title === tReplace && r1.empty && r1.cards.length === 0 && r1.gridZone, { buckets: r1.buckets.map((b) => b.key), empty: r1.empty, cards: r1.cards.length });
  check("the Judge is shown Judge selected and its hint", r1.modes[0].pressed === "true" && r1.modes[1].pressed === "false" && r1.modeHint === tJudgeHint, r1.modes);
  check("the pile's flag reads phase staging and an empty order, its sheet is the pot's, and the Cards collection holds it", s1.phase === "staging" && s1.order.length === 0 && s1.sheetClass === "acks-extras.PotSheet" && s1.cards.length === 0, { phase: s1.phase, order: s1.order.length, sheet: s1.sheetClass });
  check("the Cards directory lists the pile where it is rendered", s1.directory !== false, { directory: s1.directory });
  check("the pile is closed to everyone but the Judge: default ownership none, no seat listed", s1.ownership.default === 0 && users.others.every((id) => !s1.ownership[id]), s1.ownership);

  section("Judge seat 2. items and coin dropped on the grid and into the buckets");
  const dItem = await run(gm, P.dropAndWait, { potId, zone: "pot", uuid: itemUuid });
  const dCoin = await run(gm, P.dropAndWait, { potId, zone: "pot", uuid: coinUuid });
  check("an item and a coin dropped on the grid each made one card, listed in order", dItem.ok && dItem.ids.length === 1 && dCoin.ok && dCoin.ids.length === 1, { item: dItem.ids.length, coin: dCoin.ids.length });
  const C = { item: dItem.ids[0], coin: dCoin.ids[0] };

  section("Refusals (staging): a flip while the pot is staged");
  const flipStaging = await run(player, P.relay, { potId, op: "flip", cardId: C.item });
  const sStaging = await run(gm, P.stage, { potId });
  check("a flip asked for from the Player seat while staging is refused with phase", flipStaging.ok === false && flipStaging.reason === "phase", flipStaging);
  check("and nothing was turned: every card is still face down", sStaging.cards.every((c) => c.face === null && c.faceName === null), { cards: sStaging.cards.length });

  const dAdd = await run(gm, P.dropAndWait, { potId, zone: "add", uuid: itemUuid });
  const dReplace = await run(gm, P.dropAndWait, { potId, zone: "replace", uuid: itemUuid });
  C.add = dAdd.ids[0];
  C.replace = dReplace.ids[0];
  const s2 = await run(gm, P.stage, { potId });
  const r2 = await run(gm, P.sheetRead, { potId });
  const cardOf = (s, id) => s.cards.find((c) => c.id === id);
  const itemCard = cardOf(s2, C.item);
  const coinCard = cardOf(s2, C.coin);
  const tMasked = await t(gm, "card.maskedAs", { name: APPARENT.name });
  const potValue = await t(gm, "bar.gp", { gp: COIN_GP });
  check("an item dropped into each bucket made one seed card each, listed in its bucket", dAdd.ok && dReplace.ok && s2.buckets.add.join() === C.add && s2.buckets.replace.join() === C.replace, { add: s2.buckets.add.length, replace: s2.buckets.replace.length });
  check("order lists the two grid cards only; the bucket cards are not in it; every pile card is face down", s2.order.join() === [C.item, C.coin].join() && !s2.order.includes(C.add) && !s2.order.includes(C.replace) && s2.cards.length === 4 && s2.cards.every((c) => c.face === null), { order: s2.order.length, cards: s2.cards.length });
  check("the truths are on the cards: the item is a magic pool card with its mask, the coin has its count and rate, each seed carries its bucket", itemCard.pool === "magic" && itemCard.maskName === APPARENT.name && itemCard.label === TRUE_ITEM.name && coinCard.pool === "coins" && coinCard.coin?.count === COIN.system.quantity && coinCard.coin?.cv === COIN.system.coppervalue && cardOf(s2, C.add).bucket === "add" && cardOf(s2, C.replace).bucket === "replace", { item: itemCard.pool, coin: coinCard.coin });
  const jItem = r2.cards.find((c) => c.id === C.item);
  const jCoin = r2.cards.find((c) => c.id === C.coin);
  check("the grid shows the item with its Judge face (the true name) and 'Shown as' the mask, and the coin with its count", r2.cards.length === 2 && jItem?.name === TRUE_ITEM.name && jItem.notes.includes(tMasked) && jCoin?.name === coinCard.label, { cards: r2.cards.length, item: jItem?.name === TRUE_ITEM.name, masked: jItem?.notes.includes(tMasked), coin: jCoin?.name === coinCard.label });
  check("each bucket lists its one item", r2.buckets[0].rows.join() === TRUE_ITEM.name && r2.buckets[1].rows.join() === TRUE_ITEM.name, r2.buckets.map((b) => b.rows.length));
  check("the pot value reads the coin's worth", r2.figure === potValue, { reads: r2.figure === potValue });

  section("Judge seat 3. a value card");
  const press3 = await press(gm, PORTS.gm, { scope: "sheet", potId, sel: "[data-action='addValue']" });
  const dlg3 = await run(gm, P.dialogWait, { timeout: 6000 });
  check("Add a value card opened its dialog with a kind, a name and a worth", press3.found && dlg3.found && ["pool", "label", "gp"].every((n) => dlg3.fields.includes(n)), dlg3);
  const set3 = await run(gm, P.dialogSet, { values: { pool: VALUE.pool, label: VALUE.label, gp: VALUE.gp } });
  const ok3 = await press(gm, PORTS.gm, { scope: "dialog", sel: "button[data-action='ok']" });
  note("step 3 scripted", "the dialog's fields are set by value and a change event; its confirm button is pressed");
  let s3 = null;
  for (let n = 0; n < 40; n++) { s3 = await run(gm, P.stage, { potId }); if (s3.cards.length === 5 && s3.order.length === 3) break; await sleep(250); }
  const r3 = await run(gm, P.sheetRead, { potId });
  C.value = s3.cards.find((c) => !s2.cards.some((x) => x.id === c.id))?.id;
  const valueCard = cardOf(s3, C.value);
  const tGem = await t(gm, "pool.gems");
  const potValue2 = await t(gm, "bar.gp", { gp: COIN_GP + VALUE.gp });
  check("the dialog's confirm made a gem card joining the grid, in order, with the figure it was given", set3.ok && ok3.found && valueCard?.pool === VALUE.pool && valueCard.valueGp === VALUE.gp && valueCard.label === VALUE.label && s3.order.includes(C.value) && r3.cards.length === 3 && r3.cards.find((c) => c.id === C.value)?.tag === tGem, { set: set3.ok, pool: valueCard?.pool, gp: valueCard?.valueGp, grid: r3.cards.length });
  check("the pot value rose by that figure", r3.figure === potValue2, { reads: r3.figure === potValue2 });

  section("Judge seat 4. the mode");
  const mTable = await press(gm, PORTS.gm, { scope: "sheet", potId, sel: "[data-action='setMode'][data-mode='table']" });
  const w4a = await run(gm, P.waitState, { potId, until: "mode", mode: "table" });
  const hintTable = await t(gm, "judge.modeTableHint");
  let r4a = await run(gm, P.sheetRead, { potId });
  for (let n = 0; n < 20 && r4a.modeHint !== hintTable; n++) { await sleep(200); r4a = await run(gm, P.sheetRead, { potId }); }
  check("Table pressed: the pot's mode follows and the hint changes", mTable.found && w4a.met && r4a.modeHint === hintTable && r4a.modes[1].pressed === "true", { mode: w4a.met, hint: r4a.modeHint === hintTable });
  const mJudge = await press(gm, PORTS.gm, { scope: "sheet", potId, sel: "[data-action='setMode'][data-mode='judge']" });
  const w4b = await run(gm, P.waitState, { potId, until: "mode", mode: "judge" });
  let r4b = await run(gm, P.sheetRead, { potId });
  for (let n = 0; n < 20 && r4b.modeHint !== tJudgeHint; n++) { await sleep(200); r4b = await run(gm, P.sheetRead, { potId }); }
  check("Judge pressed: the pot's mode follows back and the hint changes back", mJudge.found && w4b.met && r4b.modeHint === tJudgeHint && r4b.modes[0].pressed === "true", { mode: w4b.met, hint: r4b.modeHint === tJudgeHint });

  section("Judge seat 5. open to the table");
  const before5 = await run(gm, P.stage, { potId });
  const gmOwnBefore = before5.ownership[users.gm] ?? null;
  const open5 = await press(gm, PORTS.gm, { scope: "sheet", potId, sel: "aside [data-action='openTable']" });
  const w5 = await run(gm, P.waitState, { potId, until: "phase", mode: "open" });
  const s5 = await run(gm, P.stage, { potId });
  const idx = (id) => s5.order.indexOf(id);
  check("Open to the table pressed: the pot's phase is open", open5.found && w5.met && s5.phase === "open", { phase: s5.phase });
  // A seed that strikes no lot joins the add cards and lands at a random place; one that strikes a lot takes the first struck lot's slot.
  const seedRow = s5.replaced.find((p) => p.seedId === C.replace);
  const struckIds = seedRow?.struck ?? [];
  const staged = before5.order;
  const firstStruck = staged.find((id) => struckIds.includes(id));
  const expectBase = struckIds.length ? staged.filter((id) => !struckIds.includes(id) || id === firstStruck).map((id) => (id === firstStruck ? C.replace : id)) : staged;
  const baseNow = s5.order.filter((id) => id !== C.add && (struckIds.length || id !== C.replace));
  const holdsAll = struckIds.length ? struckIds.every((id) => idx(id) < 0) : s5.order.length === 5 && new Set(s5.order).size === 5 && [C.item, C.coin, C.value, C.add, C.replace].every((id) => idx(id) >= 0);
  check("order holds the staged cards in their staged order, the add card among them, and the replace card in the first struck lot's slot, or anywhere when it strikes none", !!seedRow && idx(C.add) >= 0 && idx(C.replace) >= 0 && new Set(s5.order).size === s5.order.length && holdsAll && baseNow.join() === expectBase.join(), { order: s5.order.length, struck: struckIds.length, replaceAt: idx(C.replace), addAt: idx(C.add) });
  note("the add card's position and the replace card's (a seed that strikes no lot lands at random)", { add: idx(C.add), replace: idx(C.replace) });
  check("both buckets are empty", s5.buckets.add.length === 0 && s5.buckets.replace.length === 0, s5.buckets);
  const lim = 1;
  check("the pile's ownership is LIMITED for every seat but the Judge's and never higher, the Judge's own entry unchanged, the default still none", users.others.length > 0 && users.others.every((id) => s5.ownership[id] === lim) && (s5.ownership[users.gm] ?? null) === gmOwnBefore && s5.ownership.default === 0, { others: users.others.map((id) => s5.ownership[id]), gm: s5.ownership[users.gm] ?? null, gmBefore: gmOwnBefore, default: s5.ownership.default });
  check("the audience in the flag is every non-Judge seat", s5.audience.length === users.others.length && users.others.every((id) => s5.audience.includes(id)), { audience: s5.audience.length });
  const messageId = s5.messageId;
  if (messageId) made.push(gm.track(messageId, "ChatMessage"));
  const doorIds = await run(gm, P.messages, { uuid: opened.uuid });
  const needles = [TRUE_ITEM.name, COIN.name, VALUE.label];
  const msg5 = await run(gm, P.messageRead, { messageId, needles });
  const tDoorTitle = await t(gm, "door.title");
  const tTurned0 = await t(gm, "door.turned", { turned: 0, count: 5 });
  const door5 = await run(gm, P.waitDoorway, { messageId, turned: tTurned0 });
  check("one chat card carries the pot, and the pile's flag names it", doorIds.length === 1 && doorIds[0] === messageId && msg5.exists && msg5.door, { messages: doorIds.length, named: doorIds[0] === messageId });
  check("it carries only the pot's uuid and none of what is in the pot", msg5.uuid === opened.uuid && msg5.flagKeys?.join() === "uuid" && msg5.leaks === 0, { keys: msg5.flagKeys, leaks: msg5.leaks });
  check("it reads 'Treasure on the table' and shows 0 of 5 turned, filled from the live pile", door5.found && door5.title === tDoorTitle && door5.turned === tTurned0 && door5.pips === 5 && door5.pipsUp === 0, { title: door5.title === tDoorTitle, turned: door5.turned === tTurned0, pips: door5.pips });

  section("Player seat 1. the doorway");
  const doorP = await run(player, P.waitDoorway, { messageId, turned: tTurned0 });
  check("the doorway card is on the Player seat and reads 0 of 5 turned", doorP.found && doorP.door && doorP.turned === tTurned0, { found: doorP.found, turned: doorP.turned === tTurned0 });
  await run(player, P.watchDoorClicks);
  const openP = await press(player, PORTS.player, { scope: "doc", sel: `[data-message-id='${messageId}'] [data-action='openTable']` }, "the doorway's Open the table, on the Player seat");
  const sheetP = await run(player, P.waitSheet, { potId });
  check("Open the table opened the window on the Player seat (LIMITED is enough to render it)", openP.found && sheetP.rendered, { found: openP.found, real: openP.real, moved: openP.moved ?? false, ...sheetP });
  if (!sheetP.rendered) {
    note("the doorway press opened no window; the press aimed at, and the press's second reading", { aimed: openP.aimed ?? null, now: openP.now ?? null });
    note("the doorway press opened no window; the Player seat", await run(player, P.doorDiag, { potId }));
    throw new Error("the Player seat has no pot window; the steps below read it");
  }
  const p1 = await run(player, P.sheetRead, { potId });
  const tMagic = await t(player, "pool.magic");
  const tItemPool = await t(player, "pool.item");
  const maskedBack = p1.cards.find((c) => c.id === C.item);
  check("every card is face down: five buttons whose accessible name is pool, band and 'face down', and no card is turned", p1.cards.length === 5 && p1.cards.every((c) => c.down && !c.up && c.flip && c.labelOk), { cards: p1.cards.length, labels: p1.cards.filter((c) => c.labelOk).length });
  check("the masked item's card reads 'Item' in its tag, its label and its card record, never 'Magic', and nothing on the window says Magic", maskedBack?.tag === tItemPool && maskedBack.suit === "item" && !maskedBack.label.includes(tMagic) && !p1.text.includes(tMagic), { tag: maskedBack?.tag === tItemPool, suit: maskedBack?.suit });
  check("each card's tooltip is its pool's name and its page reference only", p1.cards.every((c) => c.tipOk), { ok: p1.cards.filter((c) => c.tipOk).length });
  check("the Player's window offers no Judge control: no Close, no Open to the table, no drop zones, no Remove", !p1.controls.close && !p1.controls.open && !p1.controls.addValue && p1.controls.zones === 0 && p1.controls.remove === 0, p1.controls);

  section("Player seat 2. flip");
  const snapA = await run(player, P.cardsSnap, { potId });
  await run(gm, P.watchCards, { potId });
  const flipItem = await press(player, PORTS.player, { scope: "sheet", potId, sel: `li[data-card-id='${C.item}'] [data-action='flip']` });
  const wItem = await run(player, P.waitState, { potId, until: "up", cardId: C.item });
  const obsItem = await run(gm, P.readCards);
  const sItem = await run(gm, P.stage, { potId });
  const snapB = await run(player, P.cardsSnap, { potId });
  const tTurned1 = await t(player, "door.turned", { turned: 1, count: 5 });
  const doorP1 = await run(player, P.waitDoorway, { messageId, turned: tTurned1 });
  let pItem = await run(player, P.sheetRead, { potId });
  for (let n = 0; n < 20 && !pItem.cards.find((c) => c.id === C.item)?.up; n++) { await sleep(200); pItem = await run(player, P.sheetRead, { potId }); }
  const upItem = pItem.cards.find((c) => c.id === C.item);
  const tUnknown = await t(player, "card.worthUnknown");
  const flipped = cardOf(sItem, C.item);
  check("the real press on the masked item's card turned it: face 0, and its face name is the mask", flipItem.found && wItem.met && flipped.face === 0 && flipped.faceName === APPARENT.name, { face: flipped.face, mask: flipped.faceName === APPARENT.name });
  const touched = obsItem.filter((o) => !o.pile).map((o) => o.cardId);
  check("it was one update of that one Card that held both faces and face, and nothing else was written: no other Card, no change to the pile", obsItem.length === 1 && obsItem[0].cardId === C.item && obsItem[0].faces && obsItem[0].face && !obsItem.some((o) => o.pile) && snapA.filter((c) => c.id !== C.item).every((c) => JSON.stringify(c) === JSON.stringify(snapB.find((x) => x.id === c.id))), { updates: obsItem.length, cards: touched.length, keys: obsItem[0]?.keys });
  check("the window shows 'Plain thing', 'Worth unknown', the 'Item' tag and no Aura tag", upItem?.up && upItem.name === APPARENT.name && upItem.notes[0] === tUnknown && upItem.tag === tItemPool && !upItem.aura, { name: upItem?.name === APPARENT.name, worth: upItem?.notes[0] === tUnknown, tag: upItem?.tag === tItemPool, aura: upItem?.aura });
  check("the doorway's count reads 1 of 5 turned", doorP1.turned === tTurned1 && doorP1.pipsUp === 1, { turned: doorP1.turned === tTurned1, pipsUp: doorP1.pipsUp });
  const flipCoin = await press(player, PORTS.player, { scope: "sheet", potId, sel: `li[data-card-id='${C.coin}'] [data-action='flip']` });
  const wCoin = await run(player, P.waitState, { potId, until: "up", cardId: C.coin });
  const obsCoin = await run(gm, P.readCards);
  await run(gm, P.unwatchCards);
  const tHaul = await t(player, "bar.gp", { gp: COIN_GP });
  const tipHaul = await t(player, "tip.haulParts", { parts: await t(player, "tip.haulPart", { pool: await t(player, "pool.coins"), gp: COIN_GP }), cite: await t(player, "cite.haul") });
  let pCoin = await run(player, P.sheetRead, { potId });
  for (let n = 0; n < 20 && pCoin.figure !== tHaul; n++) { await sleep(200); pCoin = await run(player, P.sheetRead, { potId }); }
  check("the coin card turned by a real press, in one update of that Card", flipCoin.found && wCoin.met && obsCoin.length === 1 && obsCoin[0].cardId === C.coin && obsCoin[0].faces && obsCoin[0].face, { updates: obsCoin.length });
  check("the haul so far shows its worth, and its tooltip names the coin part and the page", pCoin.figure === tHaul && pCoin.figureTip === tipHaul, { figure: pCoin.figure === tHaul, tip: pCoin.figureTip === tipHaul });

  section("Refusals: a Take onto an actor the seat does not own, a Take of a face-down card");
  const claimUnowned = await run(player, P.relay, { potId, op: "claim", cardId: C.item, actorUuid: judgeUuid });
  const judgeRowsAfter = await run(gm, P.actorRows, { actorId: ids.judge });
  const sAfterRefuse = await run(gm, P.stage, { potId });
  check("a claim sent from the Player seat with the Judge's character as target is refused notOwner", claimUnowned.ok === false && claimUnowned.reason === "notOwner", claimUnowned);
  check("the actor gained nothing and the card is unmarked", judgeRowsAfter.length === judgeRowsBefore.length && judgeRowsAfter.every((r) => judgeRowsBefore.some((b) => b.id === r.id)) && !cardOf(sAfterRefuse, C.item).claimedBy, { before: judgeRowsBefore.length, after: judgeRowsAfter.length });
  const claimDown = await run(player, P.relay, { potId, op: "claim", cardId: C.value, actorUuid: playerUuid });
  const sDown = await run(gm, P.stage, { potId });
  check("a claim of a face-down card onto the seat's own character is refused faceDown, and the card stays face down and unmarked", claimDown.ok === false && claimDown.reason === "faceDown" && cardOf(sDown, C.value).face === null && !cardOf(sDown, C.value).claimedBy, claimDown);

  section("Refusals: a planted Card");
  const doorBeforePlant = await run(player, P.doorway, { messageId });
  const planted = await run(gm, P.plant, { potId, fromId: C.item });
  if (!planted) throw new Error("the planted Card was not created on the GM seat");
  made.push(gm.track(planted.uuid, "Card"));
  await sleep(500);
  await run(player, P.rerender, { potId });
  await run(gm, P.rerender, { potId });
  const pPlant = await run(player, P.sheetRead, { potId });
  const gPlant = await run(gm, P.sheetRead, { potId });
  const flipPlanted = await run(player, P.relay, { potId, op: "flip", cardId: planted.id });
  const claimPlanted = await run(player, P.relay, { potId, op: "claim", cardId: planted.id, actorUuid: playerUuid });
  const doorAfterPlant = await run(player, P.doorway, { messageId });
  const sPlant = await run(gm, P.stage, { potId });
  check("a Card created in the pile with a turned face and a copied card flag, its id not in order, is not listed on the Player seat's window or the Judge's", sPlant.cards.some((c) => c.id === planted.id) && !sPlant.order.includes(planted.id) && !pPlant.cards.some((c) => c.id === planted.id) && !gPlant.cards.some((c) => c.id === planted.id) && pPlant.cards.length === 5, { inPile: sPlant.cards.length, player: pPlant.cards.length, judge: gPlant.cards.length });
  check("a flip and a Take asked for by its id are each refused notInPot", flipPlanted.ok === false && flipPlanted.reason === "notInPot" && claimPlanted.ok === false && claimPlanted.reason === "notInPot", { flip: flipPlanted, claim: claimPlanted });
  check("the doorway's count did not change", doorAfterPlant.turned === doorBeforePlant.turned && doorAfterPlant.pips === doorBeforePlant.pips, { before: doorBeforePlant.turned, after: doorAfterPlant.turned });
  note("the planted Card is swept by its tracked id", await gm.sweepTracked({ only: [planted.uuid] }));

  section("Refusals: a seat's level on the pile is read when it acts, never the audience copy");
  // The step's start shape, asserted: the Player seat holds LIMITED, the audience copy names it, and the value card is face down and unclaimed.
  const seat0 = await run(gm, P.setSeat, { potId, userId: playerId, level: lim });
  const stSeat0 = await run(gm, P.stage, { potId });
  check("the step starts as the opening left the seat: LIMITED on the pile, named in the audience copy, the value card face down and unclaimed", seat0.limited && seat0.audience.includes(playerId) && cardOf(stSeat0, C.value).face === null && !cardOf(stSeat0, C.value).claimedBy, { limited: seat0.limited, named: seat0.audience.includes(playerId) });
  // A seat set to None after the opening: still named in the audience copy, no longer LIMITED. Each act is refused before its own guards (notAllowed comes before faceDown and notOwner).
  const seatNone = await run(gm, P.setSeat, { potId, userId: playerId, level: 0 });
  const noneFlip = await run(player, P.relay, { potId, op: "flip", cardId: C.value });
  const noneClaim = await run(player, P.relay, { potId, op: "claim", cardId: C.value, actorUuid: playerUuid });
  const noneGrab = await run(player, P.relay, { potId, op: "grab" });
  const sNone = await run(gm, P.stage, { potId });
  check("a seat set to None after the opening, still named in the audience copy, is refused notAllowed on a flip, a Take and a Quick grab", !seatNone.limited && seatNone.audience.includes(playerId) && noneFlip.ok === false && noneFlip.reason === "notAllowed" && noneClaim.ok === false && noneClaim.reason === "notAllowed" && noneGrab.ok === false && noneGrab.reason === "notAllowed", { flip: noneFlip, claim: noneClaim, grab: noneGrab });
  check("nothing was written by those refusals: the value card is still face down and unclaimed", cardOf(sNone, C.value).face === null && !cardOf(sNone, C.value).claimedBy && JSON.stringify(sNone.order) === JSON.stringify(stSeat0.order), { face: cardOf(sNone, C.value).face });
  // A seat the audience copy never named but that holds LIMITED: admitted. The copy is emptied and the seat given LIMITED again; the Take of a face-down card is then refused faceDown, the guard after the seat's own, and writes nothing.
  const seatLate = await run(gm, P.setSeat, { potId, userId: playerId, level: lim, audience: [] });
  const lateClaim = await run(player, P.relay, { potId, op: "claim", cardId: C.value, actorUuid: playerUuid });
  const sLate = await run(gm, P.stage, { potId });
  check("a seat holding LIMITED that the audience copy does not name is admitted: its Take of the face-down card reaches the card's own guard and is refused faceDown, with nothing written", seatLate.limited && seatLate.audience.length === 0 && lateClaim.ok === false && lateClaim.reason === "faceDown" && cardOf(sLate, C.value).face === null && !cardOf(sLate, C.value).claimedBy, { limited: seatLate.limited, audience: seatLate.audience.length, claim: lateClaim });
  // The copy is put back, and the Player's window is asked to render again: a level change may have left it stale.
  const seatBack = await run(gm, P.setSeat, { potId, userId: playerId, level: lim, audience: s5.audience });
  await run(player, P.rerender, { potId });
  const sheetBack = await run(player, P.waitSheet, { potId });
  check("the seat is left as the opening made it: LIMITED, named in the audience copy again, the window renders", seatBack.limited && seatBack.level === lim && s5.audience.every((id) => seatBack.audience.includes(id)) && sheetBack.rendered, { level: seatBack.level, named: seatBack.audience.length, rendered: sheetBack.rendered });

  section("Player seat 3. take the coin");
  const coinBefore = await run(player, P.actorRows, { actorId: ids.player });
  const coinQty0 = coinBefore.filter((r) => r.name === COIN.name).reduce((n, r) => n + r.qty, 0);
  const doorBeforeTake = await run(player, P.doorway, { messageId });
  const takeCoin = await press(player, PORTS.player, { scope: "sheet", potId, sel: `li[data-card-id='${C.coin}'] [data-action='take']` });
  const dlgCoin = await run(player, P.dialogWait, { timeout: 5000 });
  if (dlgCoin.found) {
    note("the actor pick (a dialog offered because the seat owns several characters; the pick is set by value)", { options: dlgCoin.options.length, onlyOwned: dlgCoin.optionsAllOwned, judgeOffered: dlgCoin.options.includes(judgeUuid) });
    await run(player, P.dialogSet, { values: { actor: playerUuid } });
    await press(player, PORTS.player, { scope: "dialog", sel: "button[data-action='ok']" });
  } else {
    note("no actor pick appeared", "the seat owns one character that lists goods, so the Take went straight to it");
  }
  const wClaimCoin = await run(player, P.waitState, { potId, until: "claimed", cardId: C.coin });
  const coinAfter = await run(player, P.actorRows, { actorId: ids.player });
  const coinQty1 = coinAfter.filter((r) => r.name === COIN.name).reduce((n, r) => n + r.qty, 0);
  for (const row of coinAfter.filter((r) => !coinBefore.some((b) => b.id === r.id))) made.push(gm.track(row.uuid, "Item"));
  let pTake = await run(player, P.sheetRead, { potId });
  const tTo = await t(player, "card.to", { name: NAMES.player });
  for (let n = 0; n < 20 && pTake.cards.find((c) => c.id === C.coin)?.by !== tTo; n++) { await sleep(200); pTake = await run(player, P.sheetRead, { potId }); }
  const coinFace = pTake.cards.find((c) => c.id === C.coin);
  const doorAfterTake = await run(player, P.doorway, { messageId });
  check("the actor pick offers only the seat's own characters and not the Judge's", !dlgCoin.found || (dlgCoin.optionsAllOwned === true && !dlgCoin.options.includes(judgeUuid) && dlgCoin.options.includes(playerUuid)), { found: dlgCoin.found, onlyOwned: dlgCoin.optionsAllOwned });
  check("the Take landed: the character holds the coin at the card's count", takeCoin.found && wClaimCoin.met && coinQty1 - coinQty0 === COIN.system.quantity, { gained: coinQty1 - coinQty0, count: COIN.system.quantity });
  check("the card reads 'To <name>' and has no Take button", coinFace?.by === tTo && !coinFace.take, { by: coinFace?.by === tTo, take: coinFace?.take });
  check("the doorway is unchanged: a claim turns nothing and the card still counts in the haul so far", doorAfterTake.turned === doorBeforeTake.turned && doorAfterTake.haul === doorBeforeTake.haul && doorAfterTake.pips === doorBeforeTake.pips, { turned: doorAfterTake.turned === doorBeforeTake.turned, haul: doorAfterTake.haul === doorBeforeTake.haul });

  section("Player seat 4. take the masked item");
  const itemBefore = await run(player, P.actorRows, { actorId: ids.player });
  const itemQty0 = itemBefore.filter((r) => r.name === APPARENT.name).reduce((n, r) => n + r.qty, 0);
  const takeItem = await press(player, PORTS.player, { scope: "sheet", potId, sel: `li[data-card-id='${C.item}'] [data-action='take']` });
  const dlgItem = await run(player, P.dialogWait, { timeout: 5000 });
  if (dlgItem.found) {
    await run(player, P.dialogSet, { values: { actor: playerUuid } });
    await press(player, PORTS.player, { scope: "dialog", sel: "button[data-action='ok']" });
  }
  const wClaimItem = await run(player, P.waitState, { potId, until: "claimed", cardId: C.item });
  let itemAfter = await run(player, P.actorRows, { actorId: ids.player });
  const itemQty1 = () => itemAfter.filter((r) => r.name === APPARENT.name).reduce((n, r) => n + r.qty, 0);
  for (let n = 0; n < 20 && itemQty1() - itemQty0 < 1; n++) { await sleep(250); itemAfter = await run(player, P.actorRows, { actorId: ids.player }); }
  const newItems = itemAfter.filter((r) => !itemBefore.some((b) => b.id === r.id));
  for (const row of newItems) made.push(gm.track(row.uuid, "Item"));
  const landed = newItems.find((r) => r.name === APPARENT.name) ?? itemAfter.find((r) => r.name === APPARENT.name);
  check("the character holds an item named 'Plain thing', one more than before", takeItem.found && wClaimItem.met && itemQty1() - itemQty0 === 1 && !!landed, { gained: itemQty1() - itemQty0, rows: newItems.length });
  check("it is marked undetected (markets.detected is false), is magical, is still disguised, and the true name is not its name", landed?.detected === false && landed.magic && landed.disguised && landed.name === APPARENT.name && landed.trueName === TRUE_ITEM.name && landed.name !== TRUE_ITEM.name, { detected: landed?.detected, magic: landed?.magic, disguised: landed?.disguised });
  const sheetItem = landed ? await run(player, P.itemSheet, { actorId: ids.player, itemId: landed.id }) : { rendered: false };
  check("the Player's item sheet of it shows no magic: no identification panel, no magic mount, no aura mark", sheetItem.rendered && !sheetItem.magicPanel && !sheetItem.magicMount && !sheetItem.aura && !sheetItem.auraClass && !sheetItem.identifyBox, sheetItem);
  const sFinal = await run(gm, P.stage, { potId });
  check("both claims are marked on their Cards with the seat's user and the character", [C.coin, C.item].every((id) => cardOf(sFinal, id).claimedBy?.userId === playerId && cardOf(sFinal, id).claimedBy?.actorUuid === playerUuid && cardOf(sFinal, id).claimedBy?.actorName === NAMES.player), { coin: !!cardOf(sFinal, C.coin).claimedBy, item: !!cardOf(sFinal, C.item).claimedBy });

  section("The window contract (both seats)");
  for (const [key, api] of [["player", player], ["gm", gm]]) {
    await run(api, P.waitSheet, { potId });
    const w0 = await run(api, P.windowRead, { potId });
    check(`${key}: the pot's window has the resize corner, and its part root scrolls (overflow-y auto, retained through a re-render)`, w0.rendered && w0.handle && w0.overflowY === "auto" && w0.scrollable === JSON.stringify([""]), w0);
    await run(api, P.resize, { potId, width: 420, height: 280 });
    const w1 = await run(api, P.windowRead, { potId });
    const at = await run(api, P.scrollToEnd, { potId });
    check(`${key}: shrunk to a small window the content scrolls inside its frame instead of being cut off (scrollHeight beyond clientHeight, the part root inside the content, a scroll that moves)`, w1.scrollHeight > w1.clientHeight && w1.clientHeight > 0 && w1.within && at > 0, { scrollHeight: w1.scrollHeight, clientHeight: w1.clientHeight, within: w1.within, scrolled: at, size: [w1.width, w1.height] });
    await run(api, P.resize, { potId, width: 940, height: 640 });
  }
  await run(player, P.closeAll);

  section("Close (Judge seat): leftovers to a place");
  await run(gm, P.waitSheet, { potId });
  const placeBefore = await run(gm, P.placeRead, { placeId });
  await run(gm, P.watchChat);
  const pressClose = await press(gm, PORTS.gm, { scope: "sheet", potId, sel: "[data-action='closePot']" });
  const dlgClose = await run(gm, P.dialogWait, { timeout: 6000 });
  check("Close the pot opened its dialog offering the place as a storage provider", pressClose.found && dlgClose.found && dlgClose.fields.includes("place") && dlgClose.options.includes(fxPlace.uuid), { found: dlgClose.found, offered: dlgClose.options?.includes(fxPlace.uuid) });
  const setClose = await run(gm, P.dialogSet, { values: { place: fxPlace.uuid } });
  const okClose = await press(gm, PORTS.gm, { scope: "dialog", sel: "button[data-action='ok']" });
  const wGone = await run(gm, P.waitState, { potId, until: "gone" });
  potClosed = wGone.met;
  const chat = await run(gm, P.readChat);
  const placeAfter = await run(gm, P.placeRead, { placeId });
  for (const row of placeAfter.rows.filter((r) => !placeBefore.ids.includes(r.id))) made.push(gm.track(row.uuid, "Item"));
  const tTo2 = await t(gm, "record.to", { name: NAMES.player });
  const tToPlace = await t(gm, "record.to", { name: NAMES.place });
  const tLeft = await t(gm, "record.left");
  const tRecordHaul = await t(gm, "record.haul", { gp: COIN_GP });
  const recG = await run(gm, P.waitDoorway, { messageId, record: true });
  const recP = await run(player, P.waitDoorway, { messageId, record: true });
  const msgAfter = await run(gm, P.messageRead, { messageId, needles });
  const goneP = await run(player, P.waitState, { potId, until: "gone" });
  const dirAfter = await run(gm, P.stage, { potId });
  check("the dialog's confirm closed the pot: the pile is gone from the GM seat and the Player seat", setClose.ok && okClose.found && wGone.met && goneP.met && dirAfter.gone, { gm: wGone.met, player: goneP.met });
  check("the leftover cards' goods are at the place: the two seed items as house goods (summed stack size) and the value card's coin worth, to the copper", placeAfter.provider && placeAfter.houseGoods - placeBefore.houseGoods === 2 && placeAfter.cp - placeBefore.cp === VALUE.gp * 100, { goods: placeAfter.houseGoods - placeBefore.houseGoods, cp: placeAfter.cp - placeBefore.cp, wantCp: VALUE.gp * 100 });
  check("the chat card was rewritten as the record: the record shows, the doorway and its Open the table button are gone from both seats, and the card's flag no longer names a pile", recG.record && !recG.door && !recG.open && recP.record && !recP.door && !recP.open && msgAfter.record && !msgAfter.door && msgAfter.uuid === null, { gm: recG.record, player: recP.record, flagUuid: msgAfter.uuid });
  check("it lists every card, the two taken as 'to' the character and the three the place took as 'to' the place, and states the haul", recG.rows.length === 5 && recG.rows.filter((r) => r.endsWith(tTo2)).length === 2 && recG.rows.filter((r) => r.endsWith(tToPlace)).length === 3 && !recG.rows.some((r) => r.includes(tLeft)) && recG.recordHaul === tRecordHaul, { rows: recG.rows.length, taken: recG.rows.filter((r) => r.endsWith(tTo2)).length, filed: recG.rows.filter((r) => r.endsWith(tToPlace)).length, haul: recG.recordHaul === tRecordHaul });
  check("the record names no card that was never turned: neither the true name of the item nor the value card's name is in it", !recG.rows.some((r) => r.includes(TRUE_ITEM.name)) && !recG.rows.some((r) => r.includes(VALUE.label)), { rows: recG.rows.length });
  check("the delete posted no chat message from this client: no 'pot deleted' or other Cards message", chat.own.length === 0, { own: chat.own, others: chat.others });
  note("messages other clients created during the close (a peer's, not counted)", chat.others);
  const flipGone = await run(player, P.relay, { potId, op: "flip", cardId: C.item });
  check("a request for the pot after its close is refused noPot (a closed pot is deleted, so it never answers phase)", flipGone.ok === false && flipGone.reason === "noPot", flipGone);

  section("console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, P.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3));
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && potId && !potClosed) {
    try { note("the pot survived its close: deleted by its tracked id, no chat notification", await run(gm, P.forceDeletePot, { potId })); } catch (err) { console.error("force delete:", err?.message ?? err); }
  }
  if (player) {
    try { await run(player, P.closeAll); } catch {}
    try { note("restored (player)", await run(player, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { await run(gm, P.closeAll); } catch {}
    try { note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
    // Only the run's own ids: the pot, the doorway card, the planted Card and the rows its claims and close created. The kept fixtures stay.
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) if (marker !== MARKS.pot) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
