/**
 * Live walk, magic-items: the Judge's roller window, the Judges-only card it
 * posts and the entry point both go through. Walks docs/magic-items/TESTING.md
 * steps 1 to 10 on the GM seat and step 8 on the Player seat, from the
 * recipe's invented `magicItemTables` layer registered client-side at priority
 * 25. A last section rolls once from the world's own import, where one stands,
 * and prints booleans and counts only. Machine values arrive through
 * ./_env.mjs.
 *
 * Fixtures: the invented layer (no document; unregistered at teardown) and the
 * cards the run posts, each tracked by the id `rollAndPost` answers and swept
 * by that id. Every name and page in the layer is invented.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

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
    const H = (globalThis.__mi = globalThis.__mi ?? {});
    H.T = acksExtras.lib.tables;
    H.api = acksExtras.magicItems;
    H.layer = {
      id: "magicItemTables",
      tables: {
        classicType: { bands: [{ min: 1, max: 6, item: "Zq Kk", hop: "classic.kk" }] },
        classic: {
          kk: [{ min: 1, max: 10, item: "Xx ten" }],
          tt: [{ min: 1, max: 3, item: "Xx low" }, { min: 4, max: 6, sub: [{ min: 1, max: 2, item: "Xx tail a" }, { min: 3, max: 3, item: "Xx tail b" }] }],
        },
        heroic: { rr: [{ min: 1, max: 100, item: "Hh one" }], ss: [{ min: 1, max: 100, item: "Hh two" }] },
        captions: { "classicType.bands": "Qq Type", "classic.kk": "Kk List", "classic.tt": "Tt List", "heroic.rr": "Rr Rank", "heroic.ss": "Ss Rank" },
        listCites: { "classicType.bands": "ZZ p.1", "classic.kk": "ZZ p.2", "classic.tt": "ZZ p.3", "heroic.rr": "ZZ p.4", "heroic.ss": "ZZ p.5" },
      },
    };
    H.gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id).sort();
    H.cardOf = (id) => {
      const msg = game.messages.get(id);
      if (!msg) return null;
      const box = document.createElement("div");
      box.innerHTML = msg.content;
      const rows = [...box.querySelectorAll("tbody tr")].map((tr) => ({
        name: tr.querySelector("td")?.childNodes?.[0]?.textContent?.trim() ?? "",
        detail: tr.querySelector(".acks-extras-roll-detail")?.textContent?.trim() ?? "",
        total: tr.querySelector("td.acks-nums")?.textContent?.trim() ?? "",
        tip: tr.querySelector("td.acks-nums")?.getAttribute("data-tooltip-text") ?? "",
      }));
      return {
        title: box.querySelector(".acks-chat-title")?.textContent?.trim() ?? "",
        subtitle: box.querySelector(".acks-chat-subtitle")?.textContent?.trim() ?? "",
        sections: [...box.querySelectorAll(".acks-extras-roll-section")].map((h) => h.textContent.trim()),
        rows,
        whisper: [...msg.whisper].sort(),
        gmIds: H.gmIds(),
        rolls: msg.rolls?.length ?? 0,
      };
    };
    H.warnings = [];
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn.bind(ui.notifications);
      ui.notifications.warn = (msg, ...rest) => { H.warnings.push(String(msg)); return H.warn(msg, ...rest); };
    }
    const active = game.users.filter((u) => u.active).map((u) => u.name);
    return { isGM: game.user.isGM, role: game.user.role, name: game.user.name, active, hasApi: typeof H.api?.rollAndPost === "function" && typeof H.api?.openRoller === "function", apiVersion: H.api?.apiVersion ?? null };
  },
  register: async () => {
    const H = globalThis.__mi;
    H.T.registerTable(H.layer, { priority: 25, source: "magic-items/tables" });
    const s = H.api.starts();
    return { starts: s };
  },
  open: async ({ tables } = {}) => {
    const H = globalThis.__mi;
    H.warnings.length = 0;
    H.opened = { done: false };
    H.api.openRoller(tables === undefined ? {} : { tables })
      .then((r) => { H.opened = { done: true, value: r === false ? false : { ok: r?.ok, reason: r?.reason ?? null, messageId: r?.message?.id ?? null } }; })
      .catch((e) => { H.opened = { done: true, error: String(e?.message ?? e) }; });
    await new Promise((r) => setTimeout(r, 800));
    const win = [...document.querySelectorAll(".application.acks-extras-magicitems-roller")].pop();
    if (!win) return { window: false, warnings: H.warnings.slice() };
    const sel = (n) => win.querySelector(`select[name="${n}"]`);
    const opts = (n) => [...(sel(n)?.options ?? [])].map((o) => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled }));
    const labelAbove = (n) => {
      const s = sel(n); const l = s?.closest("label"); const cap = l?.querySelector("span");
      if (!s || !cap) return false;
      return cap.getBoundingClientRect().bottom <= s.getBoundingClientRect().top + 1;
    };
    return {
      window: true,
      title: win.querySelector(".window-title")?.textContent?.trim() ?? "",
      scroll: win.classList.contains("acks-extras-scroll"),
      resizable: !!win.querySelector(".window-resize-handle"),
      style: opts("style"), category: opts("category"), rarity: opts("rarity"),
      above: ["style", "category", "rarity"].map(labelAbove),
      rarityOff: !!sel("rarity")?.disabled, categoryOff: !!sel("category")?.disabled,
      hint: !!win.querySelector("p.hint"),
    };
  },
  setStyle: async ({ value }) => {
    const win = [...document.querySelectorAll(".application.acks-extras-magicitems-roller")].pop();
    const s = win.querySelector('select[name="style"]');
    s.value = value; s.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    return { categoryOff: !!win.querySelector('select[name="category"]').disabled, rarityOff: !!win.querySelector('select[name="rarity"]').disabled };
  },
  setPick: async ({ name, value }) => {
    const win = [...document.querySelectorAll(".application.acks-extras-magicitems-roller")].pop();
    const s = win.querySelector(`select[name="${name}"]`);
    s.value = value; s.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: s.value };
  },
  press: async ({ action }) => {
    const win = [...document.querySelectorAll(".application.acks-extras-magicitems-roller")].pop();
    win.querySelector(`button[data-action="${action}"]`).click();
    for (let i = 0; i < 50 && !globalThis.__mi.opened.done; i++) await new Promise((r) => setTimeout(r, 100));
    return globalThis.__mi.opened;
  },
  card: async ({ id }) => globalThis.__mi.cardOf(id),
  rigged: async () => {
    const H = globalThis.__mi;
    const calls = [];
    const faces = { "1d6": 5, "1d3": 2 };
    const roller = (expr) => { calls.push(expr); const sides = Number(String(expr).split("d")[1]); return { total: faces[expr], sides }; };
    const r = await H.api.rollAndPost({ style: "classic", category: "tt", roller });
    return { ok: r.ok, messageId: r.message?.id ?? null, calls };
  },
  override: async ({ on }) => {
    const H = globalThis.__mi;
    if (on) H.T.registerTable({ id: "magicItemTables", tables: { heroic: structuredClone(H.layer.tables.heroic) } }, { priority: 30, source: "magic-items/override" });
    else H.T.unregisterTable("magicItemTables", { priority: 30 });
    return { on };
  },
  direct: async (args) => {
    const H = globalThis.__mi;
    H.warnings.length = 0;
    const before = game.messages.size;
    const r = await H.api.rollAndPost(args);
    return { ok: r.ok, reason: r.reason ?? null, messageId: r.message?.id ?? null, warnings: H.warnings.slice(), created: game.messages.size - before };
  },
  contract: async () => {
    const before = game.messages.size;
    const r = await acksExtras.lib.services.get("magic-item-roll").roll({ style: "heroic", rarity: "rr" });
    return { ok: r.ok, steps: r.steps?.length ?? 0, uuidNull: r.item?.uuid === null, created: game.messages.size - before };
  },
  real: async () => {
    const H = globalThis.__mi;
    H.T.unregisterTable("magicItemTables", { priority: 25 });
    if (!H.T.hasDoc("magicItemTables")) return { imported: false };
    const r = await H.api.rollAndPost({ style: "classic" });
    const card = r.message ? H.cardOf(r.message.id) : null;
    return {
      imported: true, ok: r.ok, messageId: r.message?.id ?? null, steps: r.result?.steps?.length ?? 0,
      rowsHaveCaption: !!card && card.rows.length > 1 && card.rows.slice(0, -1).every((x) => x.name.length > 0),
      rowsHaveText: !!card && card.rows.slice(0, -1).every((x) => x.detail.length > 0),
      tipsCite: !!card && card.rows.slice(0, -1).every((x) => /Die /.test(x.tip) && /Band /.test(x.tip) && x.tip.split(" · ").length >= 3),
      whisperGM: !!card && JSON.stringify(card.whisper) === JSON.stringify(card.gmIds),
    };
  },
  drain: async () => ({ errors: globalThis.__mi.errors.slice() }),
  restore: async () => {
    const H = globalThis.__mi;
    if (!H?.patched) return "never installed";
    try { H.T.unregisterTable("magicItemTables", { priority: 25 }); } catch {}
    try { H.T.unregisterTable("magicItemTables", { priority: 30 }); } catch {}
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magicItems && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let player = null;
const own = [];
const track = async (id) => { if (!id) return; const uuid = `ChatMessage.${id}`; own.push(uuid); await gm.track(uuid, "ChatMessage"); };
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 420_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  if (!installed.isGM) blocked("the GM seat joined is not a GM");
  note("active users", installed.active);
  check("the GM seat is a GM and the api carries rollAndPost and openRoller", installed.isGM && installed.hasApi, { apiVersion: installed.apiVersion });

  section("1. the invented layer");
  const reg = await run(gm, P.register);
  const s = reg.starts ?? {};
  note("starts", s);
  const flat = JSON.stringify(s);
  check("1. starts() offers the type list, both classic lists and both heroic lists by their captions", ["Qq Type", "Kk List", "Tt List", "Rr Rank", "Ss Rank"].every((c) => flat.includes(c)));

  section("2. the window");
  const w = await run(gm, P.open);
  note("window", w);
  check("2. a window titled Roll a Magic Item, in the scroll contract, resizable", w.window && w.title === "Roll a Magic Item" && w.scroll && w.resizable, { title: w.title, scroll: w.scroll, resizable: w.resizable });
  check("2. each label sits above its control, with the whisper hint", w.above?.every(Boolean) && w.hint, { above: w.above });
  check("2. Style offers Classic, Heroic, Gritty", JSON.stringify((w.style ?? []).map((o) => o.label)) === JSON.stringify(["Classic", "Heroic", "Gritty"]));
  check("2. Category opens on Roll the type, then the classic captions", w.category?.[0]?.label === "Roll the type" && ["Kk List", "Tt List"].every((c) => w.category.some((o) => o.label === c)));
  check("2. Rarity lists the heroic captions and is off under Classic", ["Rr Rank", "Ss Rank"].every((c) => (w.rarity ?? []).some((o) => o.label === c)) && w.rarityOff && !w.categoryOff);
  const heroic = await run(gm, P.setStyle, { value: "heroic" });
  const back = await run(gm, P.setStyle, { value: "classic" });
  check("2. Heroic switches Category off and Rarity on; Classic reverses it", heroic.categoryOff && !heroic.rarityOff && !back.categoryOff && back.rarityOff, { heroic, back });

  section("3. Roll on Classic, Roll the type");
  const pressed = await run(gm, P.press, { action: "roll" });
  await track(pressed.value?.messageId);
  const c3 = pressed.value?.messageId ? await run(gm, P.card, { id: pressed.value.messageId }) : null;
  note("card", c3);
  check("3. one card titled Magic Item, subtitle Classic", c3?.title === "Magic Item" && c3?.subtitle === "Classic");
  check("3. a row for the type list and one for the hopped list, then the Item strip", c3?.rows?.length === 3 && c3.rows[0].name === "Qq Type" && c3.rows[0].detail === "Zq Kk" && /^1d6 = \d$/.test(c3.rows[0].total) && c3.rows[1].name === "Kk List" && c3.rows[1].detail === "Xx ten" && /^1d10 = \d+$/.test(c3.rows[1].total) && c3.rows[2].name === "Xx ten" && c3.sections.includes("Item"), c3?.rows);
  check("3. the type row's tooltip is die · band · its page", c3?.rows?.[0]?.tip === "Die 1d6 · Band 1–6 · ZZ p.1", c3?.rows?.[0]?.tip);
  check("3. whispered to exactly the GMs, with no rolls on the message", c3 && JSON.stringify(c3.whisper) === JSON.stringify(c3.gmIds) && c3.rolls === 0, { whisper: c3?.whisper?.length, gms: c3?.gmIds?.length, rolls: c3?.rolls });

  section("4. the nested tail, rigged");
  const r4 = await run(gm, P.rigged);
  await track(r4.messageId);
  const c4 = r4.messageId ? await run(gm, P.card, { id: r4.messageId }) : null;
  note("rigged", { calls: r4.calls, rows: c4?.rows });
  check("4. the roller received 1d6 then 1d3", JSON.stringify(r4.calls) === JSON.stringify(["1d6", "1d3"]), r4.calls);
  check("4. one row reading 5 › 2 with the tail's text and a two-part tooltip", c4?.rows?.[0]?.total === "5 › 2" && c4.rows[0].detail === "Xx tail a" && c4.rows[0].tip === "Die 1d6 › 1d3 · Band 4–6 › 1–2 · ZZ p.3", c4?.rows?.[0]);

  section("5. Heroic and Gritty");
  for (const [style, rarity, caption, text, sub] of [["heroic", "rr", "Rr Rank", "Hh one", "Heroic"], ["heroic", "ss", "Ss Rank", "Hh two", "Heroic"], ["gritty", "rr", "Rr Rank", "Hh one", "Gritty"]]) {
    await run(gm, P.open);
    await run(gm, P.setStyle, { value: style });
    await run(gm, P.setPick, { name: "rarity", value: rarity });
    const p = await run(gm, P.press, { action: "roll" });
    await track(p.value?.messageId);
    const c = p.value?.messageId ? await run(gm, P.card, { id: p.value.messageId }) : null;
    check(`5. ${style} ${rarity}: one row headed by its caption, subtitle ${sub}`, c?.subtitle === sub && c?.rows?.[0]?.name === caption && c?.rows?.[0]?.detail === text && c?.rows?.length === 2, c?.rows);
  }

  section("6. an override reads Set by hand");
  await run(gm, P.override, { on: true });
  const r6 = await run(gm, P.direct, { style: "heroic", rarity: "rr" });
  await track(r6.messageId);
  const c6 = r6.messageId ? await run(gm, P.card, { id: r6.messageId }) : null;
  const r6c = await run(gm, P.direct, { style: "classic", category: "kk" });
  await track(r6c.messageId);
  const c6c = r6c.messageId ? await run(gm, P.card, { id: r6c.messageId }) : null;
  await run(gm, P.override, { on: false });
  check("6. the overridden heroic row's tooltip ends Set by hand and names no page", /· Set by hand$/.test(c6?.rows?.[0]?.tip ?? "") && !/ZZ/.test(c6?.rows?.[0]?.tip ?? ""), c6?.rows?.[0]?.tip);
  check("6. a classic row keeps its page", /ZZ p\.2$/.test(c6c?.rows?.[0]?.tip ?? ""), c6c?.rows?.[0]?.tip);

  section("7. nothing imported");
  const w7 = await run(gm, P.open, { tables: {} });
  check("7. openRoller({tables: {}}) warns and opens no window", !w7.window && w7.warnings.some((x) => /No magic-item tables are imported/.test(x)), w7.warnings);
  const r7 = await run(gm, P.direct, { tables: null });
  check("7. rollAndPost({tables: null}) warns, posts nothing", !r7.ok && r7.messageId === null && r7.created === 0 && r7.warnings.length === 1, r7);

  section("9. Cancel");
  await run(gm, P.open);
  const cancelled = await run(gm, P.press, { action: "cancel" });
  check("9. Cancel resolves false and posts nothing", cancelled.done && cancelled.value === false, cancelled);

  section("10. the contract");
  const k = await run(gm, P.contract);
  check("10. magic-item-roll answers ok, one step, uuid null, and posts no card", k.ok && k.steps === 1 && k.uuidNull && k.created === 0, k);

  section("8. the Player seat");
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const seated = await run(player, P.install);
  await run(player, P.register);
  const pw = await run(player, P.open);
  const pr = await run(player, P.direct, { style: "heroic", rarity: "rr" });
  check("8. the Player seat is a player; openRoller warns GM-only and opens no window", !seated.isGM && !pw.window && pw.warnings.some((x) => /Only a GM/.test(x)), { role: seated.role, warnings: pw.warnings });
  check("8. rollAndPost on the Player seat warns, creates no message", pr.reason === "gm-only" && pr.messageId === null && pr.created === 0, pr);

  section("the world's own import");
  const real = await run(gm, P.real);
  await track(real.messageId);
  note("real", real);
  if (real.imported) {
    check("a Classic roll from the world's import posts a card: every step captioned, with row text, its tooltip die · band · cite, whispered to the GMs", real.ok && real.steps >= 1 && real.rowsHaveCaption && real.rowsHaveText && real.tipsCite && real.whisperGM, real);
  } else {
    note("not checked", "the world holds no magicItemTables import");
  }

  const drained = await run(gm, P.drain);
  check("no console error on the GM seat over the walk (recorder attached after ready)", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const api of [gm, player]) { try { if (api) note("restored", await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); } }
  if (gm && own.length) {
    try { note("cards swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
