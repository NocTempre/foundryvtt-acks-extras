/**
 * Live walk, magic-conjure-rows: a conjure entry the importer rowed is held by
 * concentration and its creature turns on its caster when control is lost.
 * Walks docs/magic/TESTING.md "Casting a summoning spell" step 15 on the GM and
 * Player seats. The Judge's own RR spells are imported before the walk runs (the
 * walk imports nothing and reads the shelf as it stands): a conjure spell the
 * shelf does not hold prints SKIP with the reason and is never invented, and a
 * spell the shelf holds without its summon row is a FAIL, since the changelog
 * tells Judges that repairing the Spells shelf brings the row.
 *   1. The shelf's Imp, Genie, Petty Elemental and Dybbuk each carry one `summon`
 *      row, format `conjuration`, control `obedient`, `controlEnd` `hostile`, no
 *      `ref` and a located count; the Genie's Hit Dice stay blank and the others'
 *      are located; a copy of the Imp on the caster keeps the shelf's duration.
 *   2. (a) The Player casts the Imp (the open Summon band: a `character`-free
 *      drop of the fixture creature, one click on the map), the card reads held
 *      with the printed duration as its cap and the caster concentrates; the
 *      Player's seat dismisses the creature at will and no card turns it hostile.
 *      (b) A second cast, the concentration ended by the status's toggle: the
 *      creature stands stamped `lost`, hostile and the Player's ownership gone,
 *      and the Player's Dismiss is refused `controlLost`. (c) A third, the world
 *      clock advanced past the cap with nobody dismissing: the end card names
 *      the same outcome. Then (b) again for the Petty Elemental and the Dybbuk.
 * Prints booleans and counts, never a printed name or figure. Machine values
 * arrive through ./_env.mjs. The selectors and clicks are derived from the
 * dialog's code and the sibling walk magic-cast-summon.mjs and have not been run.
 *
 * Fixtures, kept and found by marker (the GM seat builds what is missing; every
 * name is invented): `magic/conjure-scene`, `magic/conjure-class`,
 * `magic/conjure-caster` (the Player owns it), `magic/conjure-creature` (a monster
 * the Player observes) and `magic/conjure-spell-imp|petty|dybbuk` (copies of the
 * shelf's spells on the caster, whose lists are rewritten to the walk's class so
 * the slot gate passes and whose rows and duration stay as imported). The run's
 * own tokens, cards, records and the creature's world copy are tracked by uuid and
 * swept alone; the world clock and the world's pause are put back.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P as K, note, section, check, skip, idOf, run, ledgerFor, finish, summarize, stage,
} from "./_magic-cast-kit.mjs";

const { browser, origin } = MACHINE;
const KEY = "magic-conjure-rows-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_800_000);
/** The shelf spells the walk reads, by the cookbook ids the register names them. */
const IDS = { imp: "def.spell.conjureImp", genie: "def.spell.conjureGenie", petty: "def.spell.conjurePettyElemental", dybbuk: "def.spell.conjureDybbuk" };
const CASTS = ["imp", "petty", "dybbuk"];
const CASTING = [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 9 }] }];
const LEVEL = 5;
const CELLS = { a: [450, 350] };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/*  Shared state lives under `__mck` (installed by `K.install`).        */
/* ------------------------------------------------------------------ */
const P = {
  /** Whether the world is paused here (a paused world refuses a player's summons), and set it where `paused` is given. */
  pause: async ({ paused }) => {
    if (paused != null && game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  /** The shelf's spells by cookbook id, read and never imported: each spell's rows as booleans, its duration and cite, and its data for a copy. A spell the shelf lacks is null. */
  library: async ({ ids }) => {
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    const figure = (v) => v != null && /[1-9]/.test(JSON.stringify(v));
    const out = { rr: !!acksExtras.importer?.bookOpen?.("rr"), spells: {} };
    for (const [slug, id] of Object.entries(ids)) {
      const doc = L.byCookbookId("Item", id, { original: true });
      if (!doc) { out.spells[slug] = null; continue; }
      const data = doc.toObject();
      for (const f of ["_id", "folder", "sort", "ownership"]) delete data[f];
      const flag = data.flags?.["acks-extras"]?.spell ?? {};
      const rows = Array.isArray(flag.effects) ? flag.effects : Object.values(flag.effects ?? {});
      out.spells[slug] = {
        payload: data,
        duration: flag.duration ?? null,
        rows: rows.map((r) => ({ type: r.type ?? "", format: r.summonFormat ?? "", control: r.control ?? "", controlEnd: r.controlEnd ?? "", hasRef: !!r.ref, count: figure(r.amount), hd: figure(r.value) })),
      };
    }
    return out;
  },
  /** One copy brought to the library's shape: the flag deleted and rewritten from `payload`, the lists naming the walk's class, the cast count 0. Answers the rows as booleans and the duration as stored. */
  shapeCopy: async ({ casterId, itemId, payload }) => {
    const item = game.actors.get(casterId).items.get(itemId);
    const flag = foundry.utils.deepClone(payload.flags?.["acks-extras"]?.spell ?? {});
    flag.lists = [{ source: "arcane", level: 1, classes: [], note: "" }];
    await item.update({ "flags.acks-extras.-=spell": null });
    await item.update({ "system.cast": 0, "system.lvl": 1, "flags.acks-extras.spell": flag });
    const read = item.getFlag("acks-extras", "spell") ?? {};
    const figure = (v) => v != null && /[1-9]/.test(JSON.stringify(v));
    const rows = Array.isArray(read.effects) ? read.effects : Object.values(read.effects ?? {});
    return { uuid: item.uuid, duration: read.duration ?? null, rows: rows.map((r) => ({ type: r.type ?? "", format: r.summonFormat ?? "", control: r.control ?? "", controlEnd: r.controlEnd ?? "", hasRef: !!r.ref, count: figure(r.amount), hd: figure(r.value) })) };
  },
  /** On the Judge's seat: a user's level on a world document, or the entry taken off (`level` null, the ownership map replaced whole); answers what the document stores. */
  setLevel: async ({ uuid, userId, level }) => {
    const doc = await fromUuid(uuid);
    const rest = { ...doc._source.ownership };
    delete rest[userId];
    await doc.update(level === null ? { ownership: new foundry.data.operators.ForcedReplacement(rest) } : { [`ownership.${userId}`]: level });
    const source = doc._source.ownership ?? {};
    return { stored: source[userId] ?? null, def: source.default ?? null };
  },
  observes: async ({ uuid }) => {
    let doc = null;
    try { doc = await fromUuid(uuid); } catch { doc = null; }
    return !!doc?.testUserPermission(game.user, "OBSERVER");
  },
  /** The caster's pool and count put back to nothing spent, and no held status left from an earlier run. */
  fresh: async ({ casterId }) => {
    const a = game.actors.get(casterId);
    await a.update({ "flags.acks-extras.classes.pools": { arcane: { s1: 0 } } });
    for (const it of a.items) if (it.type === "spell" && it.system.cast) await it.update({ "system.cast": 0 });
    return { concentrating: a.statuses.has("concentrating") || a.statuses.has("concentrating-and-stationary") };
  },
  statuses: async ({ casterId }) => [...game.actors.get(casterId).statuses],
  /** Close every framed window and every cast dialog, then press nothing. */
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    return true;
  },
  /** Open the cast dialog for a spell (the call is not awaited, as the sheet's press is not) and read the Summon band: the drop zone, the absence of a creature select, the footer's verdicts and the Cast button. */
  openCast: async ({ casterId, spellId }) => {
    const H = globalThis.__mck;
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const item = game.actors.get(casterId).items.get(spellId);
    H.castBefore = new Set([...game.messages].map((m) => m.id));
    item.use({ skipDialog: true });
    const el = await H.poll(() => document.querySelector(".application.acks-extras-cast"), { tries: 80, every: 150 });
    if (!el) return { dialog: false };
    await H.sleep(500);
    const live = document.querySelector(".application.acks-extras-cast") ?? el;
    const cast = live.querySelector('button[data-action="cast"]');
    return {
      dialog: true,
      summonBand: !!live.querySelector(".acks-extras-cast-summon"),
      dropZone: !!live.querySelector('[data-bucket-drop="summon"]'),
      noSelect: !live.querySelector('select[name="summonRef"]'),
      verdicts: [...live.querySelectorAll(".acks-extras-cast-verdicts li")].map((li) => li.dataset.severity),
      castDisabled: !!cast?.disabled,
    };
  },
  /** Drop an Actor on the open band's zone with a real `drop` event, wait for the band to take it (the count box appears), type the count, and read the band again. */
  dropCreature: async ({ uuid, count }) => {
    const H = globalThis.__mck;
    const live = () => document.querySelector(".application.acks-extras-cast");
    const zone = live()?.querySelector('[data-bucket-drop="summon"]');
    if (!zone) return { zone: false };
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    const box = await H.poll(() => live()?.querySelector('input[name="summonCount"]'), { tries: 40, every: 150 });
    if (!box) return { zone: true, taken: false };
    const opened = box.value;
    box.value = String(count);
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(700);
    const cast = live()?.querySelector('button[data-action="cast"]');
    return { zone: true, taken: true, opensOnAFigure: /[1-9]/.test(opened), castDisabled: !!cast?.disabled, verdicts: [...(live()?.querySelectorAll(".acks-extras-cast-verdicts li") ?? [])].map((li) => li.dataset.severity) };
  },
  /** Press Cast in the open dialog and clear the windows off the map, so the placement can be clicked. */
  pressCast: async () => {
    const H = globalThis.__mck;
    const ok = document.querySelector('.application.acks-extras-cast button[data-action="cast"]');
    if (!ok || ok.disabled) return { pressed: false };
    ok.click();
    await H.sleep(500);
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    await H.sleep(500);
    return { pressed: true };
  },
  /** The cast card the press made (found by its flag naming the spell, among the messages made since `openCast`), read as booleans: held and not timed, and the cap it carries. */
  castCard: async ({ spellUuid }) => {
    const H = globalThis.__mck;
    const message = await H.poll(() => [...game.messages].find((m) => !H.castBefore.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === spellUuid), { tries: 120, every: 250 });
    if (!message) return { card: false };
    await H.sleep(900);
    const model = game.messages.get(message.id).flags["acks-extras"].castCard;
    const d = model.duration ?? {};
    return { card: true, messageId: message.id, castId: model.castId, held: !!d.held, untimed: !!d.none && !d.value, cap: d.cap ? { value: d.cap.value ?? null, units: d.cap.units ?? null } : null };
  },
  /** The caster's creatures on the scene (tokens whose actor names the caster as summoner), with what the Player's level on each actor and its stamp say. */
  summonTokens: async ({ sceneId, summonerUuid, playerId }) =>
    [...game.scenes.get(sceneId).tokens].filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === summonerUuid).map((t) => ({
      uuid: t.uuid,
      castId: t.actor.getFlag("acks-extras", "summon")?.castId ?? null,
      owner: t.isOwner && !!t.actor?.isOwner,
      disposition: t.disposition,
      playerLevel: playerId ? (t.actor?.ownership?.[playerId] ?? 0) : null,
      lost: !!t.actor?.getFlag("acks-extras", "summon")?.lost,
    })),
  /** The world copies of a source creature: uuid and whether any player holds a level. */
  copiesOf: async ({ sourceUuid }) => game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid).map((a) => ({ uuid: a.uuid })),
  /** The end cards of a cast: the concentration's funnel card, with its cause, its outcome and how many creatures it lists. */
  endCards: async ({ castId }) => [...game.messages].filter((m) => m.flags?.["acks-extras"]?.castHeldEnd?.castId === castId).map((m) => {
    const f = m.flags["acks-extras"].castHeldEnd;
    return { uuid: m.uuid, id: m.id, cause: f.cause ?? null, outcome: f.outcome ?? null, listed: Array.isArray(f.summons) ? f.summons.length : 0 };
  }),
  /** End a held cast by the status's own toggle, as the HUD does it. */
  endHeld: async ({ casterId, status }) => { await game.actors.get(casterId).toggleStatusEffect(status, { active: false }); return true; },
  /** The seconds a cap lasts, by the module's own time units, plus a margin; null for a unit this does not know. */
  capSeconds: async ({ value, units, margin }) => {
    const T = await import("/modules/acks-extras/scripts/lib/time-unit.mjs");
    const per = { seconds: 1, rounds: T.roundSeconds(), turns: T.turnSeconds(), minutes: 60, hours: T.SECONDS_PER_HOUR, days: T.SECONDS_PER_HOUR * T.HOURS_PER_DAY }[units];
    return per ? Math.round(Number(value) * per + margin) : null;
  },
  clock: async ({ set }) => { if (set != null) await game.time.set(set); return game.time.worldTime; },
  /** A Player's dismissal of ONE named token through lib's prompt, answered Yes where a confirmation opens; a refusal comes before any confirmation. Answers the reason, the warnings raised and whether a confirmation opened. */
  dismiss: async ({ casterId, tokenUuid, answer }) => {
    const H = globalThis.__mck;
    const token = fromUuidSync(tokenUuid);
    if (!token) return { token: false };
    const from = H.warns.length;
    const { promptDismiss } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    const call = promptDismiss(game.actors.get(casterId), { tokens: [token] });
    const button = (action) => [...document.querySelectorAll(".application.dialog button, dialog button")].find((x) => x.dataset.action === action);
    const first = await Promise.race([call, H.poll(() => !!button("yes"), { tries: 30, every: 200 }).then((up) => (up ? { opened: true } : { timeout: true }))]);
    const opened = !!button("yes");
    if (opened) { button(answer)?.click(); await H.sleep(1500); }
    const result = first?.opened || first?.timeout ? await Promise.race([call, H.sleep(4000).then(() => null)]) : first;
    return { token: true, opened, ok: result?.ok === true, reason: result?.reason ?? first?.reason ?? null, warns: H.warns.slice(from) };
  },
  /** The viewport's middle in client points, where the driver parks the pointer before the view is panned. */
  middle: async () => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }),
  /** One client point found by scanning the viewport at least 60 px from every edge for bare canvas well inside the scene, at least a cell and a half from every `avoid` point. */
  pointsFor: async ({ avoid = [] }) => {
    const r = canvas.dimensions.sceneRect;
    const snap = () => `${canvas.stage.scale.x.toFixed(3)}:${Math.round(canvas.stage.pivot.x)}:${Math.round(canvas.stage.pivot.y)}`;
    let last = "";
    for (let n = 0; n < 12; n++) {
      canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: 0.5 });
      await new Promise((res) => setTimeout(res, 500));
      const now = snap();
      if (now === last) break;
      last = now;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const found = [];
    for (let y = 60; y <= H - 60; y += 30) {
      for (let x = 60; x <= W - 60; x += 30) {
        if (document.elementFromPoint(x, y) !== canvas.app.view) continue;
        const back = canvas.canvasCoordinatesFromClient({ x, y });
        if (back.x >= r.x + 100 && back.y >= r.y + 100 && back.x <= r.x + r.width - 100 && back.y <= r.y + r.height - 100) found.push({ x, y });
      }
    }
    if (!found.length) return { onCanvas: false, x: 0, y: 0 };
    const cx = found.reduce((a, p) => a + p.x, 0) / found.length;
    const cy = found.reduce((a, p) => a + p.y, 0) / found.length;
    found.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const apart = Math.max(120, canvas.dimensions.size * canvas.stage.scale.x * 1.5);
    const pick = found.find((p) => avoid.every((o) => Math.hypot(p.x - o.x, p.y - o.y) >= apart));
    return pick ? { onCanvas: true, x: pick.x, y: pick.y } : { onCanvas: false, x: 0, y: 0 };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side: real mouse input on a seat's page                      */
/* ------------------------------------------------------------------ */
/** A CDP session on a seat's page. */
async function pageSession(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
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
/** Bring a seat's page to the front, so its canvas lays out and renders. */
async function frontSeat(port) {
  const s = await pageSession(port);
  await s.send("Page.bringToFront");
  s.close();
  await sleep(1200);
}
/** A real click on a seat's page: the pointer moves there first, so core's preview follows it. */
async function clickAt(port, { x, y }, button = "left") {
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(250);
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
  await sleep(80);
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
  s.close();
  await sleep(700);
}

let gm = null;
let player = null;
let wasPaused = false;
let worldTime0 = null;
const W = {};
const ledger = ledgerFor(() => gm);
const used = [];
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Poll a read until `test` holds or the tries run out; the last read is returned. */
async function until(read, test, { tries = 40, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await read();
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}
const tokensOf = () => run(gm, P.summonTokens, { sceneId: W.scene, summonerUuid: W.casterUuid, playerId: W.playerId });
const sameShape = (rows, format = "conjuration") => rows.length === 1 && rows[0].type === "summon" && rows[0].format === format && rows[0].control === "obedient" && rows[0].controlEnd === "hostile" && !rows[0].hasRef;
const rowFacts = (rows) => rows.map((r) => ({ format: r.format, control: r.control, controlEnd: r.controlEnd, hasRef: r.hasRef, count: r.count, hd: r.hd }));

/**
 * One Player cast of a copy: the open band, the creature dropped, Cast, one real click, and the creature and card it made, each tracked at once.
 * Answers what the steps read; `ok` is false where any link of the chain failed (each failure is its own FAIL).
 */
async function castOnce(slug) {
  const spellId = W.copy[slug];
  const label = `${slug} cast`;
  await run(gm, P.fresh, { casterId: W.caster });
  const before = new Set((await tokensOf()).map((t) => t.uuid));
  const open = await run(player, P.openCast, { casterId: W.caster, spellId });
  check(`${label}: the Player's dialog opens on the open Summon band: the drop zone, no creature select`, open.dialog && open.summonBand && open.dropZone && open.noSelect, open);
  if (!open.dialog) return { ok: false };
  const dropped = await run(player, P.dropCreature, { uuid: W.creatureUuid, count: 1 });
  check(`${label}: dropping the observed creature fills the band and leaves Cast on`, dropped.taken && dropped.castDisabled === false, dropped);
  const pressed = await run(player, P.pressCast);
  check(`${label}: Cast is pressed and the windows are cleared off the map`, pressed.pressed, pressed);
  if (!pressed.pressed) { await run(player, K.closeDialog); return { ok: false }; }
  await frontSeat(PORTS.player);
  const p = await run(player, P.pointsFor, { avoid: used });
  if (!p.onCanvas) {
    try { await clickAt(PORTS.player, await run(player, P.middle), "right"); } catch { /* the failure below is the one to report */ }
    check(`${label}: a click point lies on the bare canvas`, false, p);
    return { ok: false };
  }
  await clickAt(PORTS.player, p);
  used.push({ x: p.x, y: p.y });
  let fresh = [];
  for (let n = 0; n < 40 && fresh.length < 1; n++) {
    fresh = (await tokensOf()).filter((t) => !before.has(t.uuid));
    if (!fresh.length) await sleep(300);
  }
  for (const t of fresh) await ledger.track(t.uuid, "Token");
  check(`${label}: the click places one creature, owned by the Player`, fresh.length === 1 && fresh[0].owner === true, { placed: fresh.length });
  const card = await run(player, P.castCard, { spellUuid: W.spellUuid[slug] });
  if (card.castId) ledger.castIds.push(card.castId);
  if (card.messageId) await ledger.track(`ChatMessage.${card.messageId}`, "ChatMessage");
  const records = card.castId ? (await run(gm, K.records, { actorId: W.caster })).filter((r) => r.castId === card.castId) : [];
  for (const r of records) await ledger.track(r.uuid, "ActiveEffect");
  const copies = await run(gm, P.copiesOf, { sourceUuid: W.creatureUuid });
  if (!W.creatureCopiesBefore) for (const c of copies) await ledger.track(c.uuid, "Actor");
  return { ok: fresh.length === 1 && !!card.card, token: fresh[0] ?? null, card, records, castId: card.castId };
}

/** A cast's held end read after the concentration is ended by the status's toggle (b) or the clock (c): the funnel card, the creature stamped lost and hostile with the Player's ownership gone, and the Player's Dismiss refused. */
async function readLost(slug, c, how, expectCause) {
  const label = `${slug} (${how})`;
  const cards = await until(() => run(gm, P.endCards, { castId: c.castId }), (l) => l.length >= 1);
  for (const card of cards) await ledger.track(card.uuid, "ChatMessage");
  check(`${label}: ending the hold posts one funnel card whose outcome is hostile${expectCause ? ` and whose cause is ${expectCause}` : ""}`, cards.length === 1 && cards[0].outcome === "hostile" && (!expectCause || cards[0].cause === expectCause), cards.map((x) => ({ cause: x.cause, outcome: x.outcome, listed: x.listed })));
  const post = await until(() => tokensOf(), (l) => l.find((t) => t.uuid === c.token.uuid)?.lost);
  const mine = post.find((t) => t.uuid === c.token.uuid);
  const onPlayer = (await run(player, P.summonTokens, { sceneId: W.scene, summonerUuid: W.casterUuid, playerId: W.playerId })).find((t) => t.uuid === c.token.uuid);
  check(`${label}: the creature stands stamped lost, hostile, and the Player's ownership is gone`, !!mine && mine.lost && mine.disposition === -1 && mine.playerLevel < 3 && onPlayer?.owner === false, { lost: mine?.lost, disposition: mine?.disposition, level: mine?.playerLevel, playerOwner: onPlayer?.owner });
  const lost = await run(player, P.dismiss, { casterId: W.caster, tokenUuid: c.token.uuid, answer: "no" });
  check(`${label}: the Player's Dismiss is refused controlLost, with the notice and before any confirmation opens`, lost.token && lost.ok === false && lost.reason === "controlLost" && lost.warns.includes(W.controlLostText) && !lost.opened, { reason: lost.reason, warns: lost.warns?.length, opened: lost.opened });
}

/** The held status of a cast's caster record, read from the record itself. */
const heldStatusOf = (records) => records.find((r) => r.statuses?.length)?.statuses?.[0] ?? null;

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const t0 = Date.now();
    for (;;) {
      let ok = false;
      try { ok = await seat.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic && !!globalThis.acksExtras?.lib?.summons`); } catch { ok = false; }
      if (ok) break;
      if (Date.now() - t0 > 240_000) throw new Error(`${label}: not ready after 240s`);
      await sleep(1000);
    }
  }
  const kg = await run(gm, K.install, { key: KEY });
  const kp = await run(player, K.install, { key: KEY });
  if (!kg.isGM || !kg.activeGMIsSelf) blocked("the first seat is not the active GM");
  if (kp.isGM) blocked("the second seat is a GM, so a Player's own seat cannot be walked");
  check("the GM seat is the active GM and the other seat a Player", kg.isGM && kg.activeGMIsSelf && !kp.isGM && kp.role <= 2, { gm: kg.role, player: kp.role });
  W.playerId = await run(gm, K.userId, { name: MACHINE.player });
  if (!W.playerId) blocked("no Player user on this world");
  worldTime0 = await run(gm, P.clock, {});
  wasPaused = await run(gm, P.pause, {});
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));
  W.controlLostText = await run(player, K.loc, { key: "ACKS-" + "LIB.summons.refused.controlLost" });

  section("the shelf");
  const lib = await run(gm, P.library, { ids: IDS });
  W.lib = lib.spells;
  const present = Object.fromEntries(Object.entries(lib.spells).map(([k, v]) => [k, !!v]));
  note("the Judge's Spells shelf holds (by slug)", present);
  const any = Object.values(present).some(Boolean);
  if (!any) {
    skip("the conjure spells", lib.rr ? "RR is open but the Spells shelf holds none of the four conjure entries: import them (Settings tab → Game Settings → ACKS II — Extras → Manage imports) and run again" : "this seat holds no copy of RR, so there is no imported conjure spell to read");
  }

  async function steps() {
  section("fixtures");
  const idsOf = (doc) => idOf(doc);
  const scene = await gm.fixture("magic/conjure-scene", "Scene", { name: "QA Conjure Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#55605a", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  const cls = await gm.fixture("magic/conjure-class", "Item", { name: "QA Conjure Class", type: "acks-extras.class", system: { key: "qaconjureclass", casting: CASTING } });
  const caster = await gm.fixture("magic/conjure-caster", "Actor", { name: "QA Conjure Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.playerId]: 3 } });
  const creature = await gm.fixture("magic/conjure-creature", "Actor", { name: "QA Conjure Creature", type: "monster", ownership: { default: 0, [W.playerId]: 2 } });
  Object.assign(W, { scene: idsOf(scene), caster: idsOf(caster), casterUuid: `Actor.${idsOf(caster)}`, creatureUuid: `Actor.${idsOf(creature)}`, copy: {}, spellUuid: {}, copies: {} });
  W.creatureCopiesBefore = (await run(gm, P.copiesOf, { sourceUuid: W.creatureUuid })).length;
  const grant = await run(gm, P.setLevel, { uuid: W.creatureUuid, userId: W.playerId, level: 2 });
  const sees = await until(() => run(player, P.observes, { uuid: W.creatureUuid }), (v) => v === true);
  check("shape: the creature holds Observer for the Player at default None, which the Player seat reads", grant.stored === 2 && grant.def === 0 && sees === true, { stored: grant.stored, def: grant.def, sees });
  await run(gm, K.shapeCaster, { casterId: W.caster, classUuid: cls.uuid, level: LEVEL });
  for (const slug of CASTS) {
    if (!W.lib[slug]) { skip(`${slug}: the shelf holds no such spell, so no copy is made`, "re-import the conjure spells and run again"); continue; }
    const doc = await gm.fixture(`magic/conjure-spell-${slug}`, "Item", { ...W.lib[slug].payload, name: `QA Conjure Copy ${slug}` }, { parent: W.casterUuid });
    W.copy[slug] = idsOf(doc);
    W.spellUuid[slug] = `${W.casterUuid}.Item.${W.copy[slug]}`;
    W.copies[slug] = await run(gm, P.shapeCopy, { casterId: W.caster, itemId: W.copy[slug], payload: W.lib[slug].payload });
  }
  check("both seats view the field", (await run(player, K.view, { sceneId: W.scene })) && (await run(gm, K.view, { sceneId: W.scene })));
  const stale = (await run(gm, K.records, { actorId: W.caster })).map((r) => r.uuid);
  for (const uuid of stale) await ledger.track(uuid, "ActiveEffect");
  if (stale.length) note("records a dead run left on the kept caster, swept by uuid", await gm.sweepTracked({ only: stale }));
  for (const t of await tokensOf()) await ledger.track(t.uuid, "Token");
  await run(gm, K.drain);
  await run(player, K.drain);

  await stage("1. the shelf's rows: one conjuration row, hostile at control's end, no creature named", async () => {
    for (const slug of ["imp", "genie", "petty", "dybbuk"]) {
      const s = W.lib[slug];
      if (!s) { skip(`${slug}: the Judge's Spells shelf holds no such spell`, "no copy of the entry has been imported; the walk invents none"); continue; }
      const rows = s.rows;
      check(`${slug}: the shelf's spell carries one summon row: format conjuration, control obedient, controlEnd hostile, no ref (a shelf where Repair in place has not brought the row fails here)`, sameShape(rows), rowFacts(rows));
      if (slug === "genie") check("genie: the row's count is located and its Hit Dice stay blank", rows[0]?.count === true && rows[0]?.hd === false, rowFacts(rows));
      else check(`${slug}: the row's count and Hit Dice are both located`, rows[0]?.count === true && rows[0]?.hd === true, rowFacts(rows));
    }
    const copy = W.copies.imp;
    if (copy) {
      check("imp: the copy on the caster keeps the row and the printed duration as imported, none rewritten", sameShape(copy.rows) && JSON.stringify(copy.duration) === JSON.stringify(W.lib.imp.duration), { rows: rowFacts(copy.rows), sameDuration: JSON.stringify(copy.duration) === JSON.stringify(W.lib.imp.duration) });
    }
  });

  const castable = CASTS.filter((s) => W.copy[s] && sameShape(W.copies[s]?.rows ?? []));
  if (!W.copy.imp || !sameShape(W.copies.imp?.rows ?? [])) skip("2. the Imp's casts (a, b, c)", "the walk has no Imp copy carrying the conjuration row, so the casts are not made");
  else {
    await stage("2a. a cast is held by the printed duration, and the Player dismisses the creature at will", async () => {
      const c = await castOnce("imp");
      if (!c.ok) return;
      const dur = W.copies.imp.duration;
      const capOk = !!c.card.cap && c.card.held && c.card.untimed && (dur?.shape !== "fixed" || (Number(c.card.cap.value) === Number(dur.value)));
      check("imp (a): the cast card reads held and not timed, its cap the printed duration", capOk, { held: c.card.held, untimed: c.card.untimed, cap: !!c.card.cap, sameValue: Number(c.card.cap?.value) === Number(dur?.value), shape: dur?.shape ?? null });
      const status = heldStatusOf(c.records);
      const onPlayer = await run(player, P.statuses, { casterId: W.caster });
      check("imp (a): the caster's record carries the held status and the Player's seat reads the caster concentrating", !!status && onPlayer.includes(status), { status: status ?? null, onPlayerSeat: onPlayer });
      const gone = await run(player, P.dismiss, { casterId: W.caster, tokenUuid: c.token.uuid, answer: "yes" });
      check("imp (a): the Player's Dismiss opens a confirmation and Yes is answered", gone.token && gone.opened, gone);
      const left = await until(() => tokensOf(), (l) => !l.some((t) => t.uuid === c.token.uuid), { tries: 40, every: 300 });
      check("imp (a): the dismissed creature is removed (its token is in the sweep's could-not-find)", !left.some((t) => t.uuid === c.token.uuid), { standing: left.length });
      await sleep(2000);
      const early = await run(gm, P.endCards, { castId: c.castId });
      check("imp (a): the dismissal posts no card turning the creature hostile", !early.some((x) => x.outcome === "hostile"), early.map((x) => ({ cause: x.cause, outcome: x.outcome })));
      const stillHeld = (await run(gm, P.statuses, { casterId: W.caster })).includes(status);
      note("imp (a): the caster still concentrates after the dismissal (read, not asserted: the recipe says the concentration ends)", stillHeld);
      if (stillHeld && status) {
        await run(gm, P.endHeld, { casterId: W.caster, status });
        const cards = await until(() => run(gm, P.endCards, { castId: c.castId }), (l) => l.length >= 1);
        for (const card of cards) await ledger.track(card.uuid, "ChatMessage");
        check("imp (a): ending the hold after the dismissal turns nothing hostile and lists no creature", cards.every((x) => x.outcome !== "hostile" && x.listed === 0), cards.map((x) => ({ outcome: x.outcome, listed: x.listed })));
      }
    });

    await stage("2b. the concentration is ended by the status's toggle", async () => {
      const c = await castOnce("imp");
      if (!c.ok) return;
      const status = heldStatusOf(c.records);
      check("imp (b): the cast's record carries a held status to toggle", !!status, { status: status ?? null });
      if (!status) return;
      await run(gm, P.endHeld, { casterId: W.caster, status });
      await readLost("imp", c, "ended by the toggle", null);
    });

    await stage("2c. the clock runs past the printed duration with the creature not dismissed", async () => {
      const c = await castOnce("imp");
      if (!c.ok) return;
      const cap = c.card.cap;
      const secs = cap ? await run(gm, P.capSeconds, { value: cap.value, units: cap.units, margin: 120 }) : null;
      check("imp (c): the cap's seconds are read by the module's own units", Number.isFinite(secs) && secs > 0, { units: cap?.units ?? null });
      if (!Number.isFinite(secs)) return;
      await run(gm, K.time, { advance: secs });
      await readLost("imp", c, "the clock past the cap", "time");
    });
  }

  for (const slug of ["petty", "dybbuk"]) {
    if (!W.lib[slug]) { skip(`${slug} (b): the Judge's Spells shelf holds no such spell`, "no copy of the entry has been imported; the walk invents none"); continue; }
    await stage(`3. ${slug}: the concentration ended by the toggle`, async () => {
      if (!sameShape(W.copies[slug]?.rows ?? [])) { check(`${slug}: the copy carries the conjuration row before it is cast`, false, rowFacts(W.copies[slug]?.rows ?? [])); return; }
      const c = await castOnce(slug);
      if (!c.ok) return;
      const status = heldStatusOf(c.records);
      check(`${slug} (b): the cast's record carries a held status to toggle`, !!status, { status: status ?? null });
      if (!status) return;
      await run(gm, P.endHeld, { casterId: W.caster, status });
      await readLost(slug, c, "ended by the toggle", null);
    });
  }
  if (castable.length < CASTS.length) note("copies the walk could not cast", CASTS.filter((s) => !castable.includes(s)));

  }
  if (any) await steps();

  section("console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, K.drain);
    check(`${label}: no console error was recorded since the seat was installed (after ready: the load itself is not covered)`, d.errors.length === 0, d.errors.slice(0, 3));
  }
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    check("walk ran to the end", false);
  }
} finally {
  const tidy = async (label, fn) => { try { note(label, await fn()); } catch (e) { console.error(`${label}:`, e?.message ?? e); } };
  if (gm) {
    for (const seat of [gm, player]) if (seat) await tidy("windows closed", () => run(seat, P.clearWindows));
    if (worldTime0 != null) await tidy("world clock put back", () => run(gm, P.clock, { set: worldTime0 }));
  }
  await finish({ gm, player, ledger, fixtureRe: "^magic/conjure-", restore: K.restore });
  if (gm && wasPaused) await tidy("paused again", () => run(gm, P.pause, { paused: true }));
  console.log("fixtures kept: magic/conjure-scene, -class, -caster, -creature, -spell-imp, -spell-petty, -spell-dybbuk");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
