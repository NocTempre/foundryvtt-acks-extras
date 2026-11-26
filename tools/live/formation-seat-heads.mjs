/**
 * Live walk: docs/formation/TESTING.md "The heads, the Place row and the Kit on a
 * Player seat" (T-0792 B3). A real Player seat that owns a party member presses
 * the mode head's own controls (Turn and Round ask the Judge; Rest, Hurried, Hop,
 * Next hex, Work the country and End day take effect on the Judge's client), the
 * Kit tab's light and spell controls, and drops onto the Place row of a Region it
 * owns; the Judge's seat reads every write back. A seat that owns no member is
 * shown no pill and is refused a crafted press.
 *
 * Steps report under the recipe's ids: H1 to H5 (the heads), PR1 to PR5 (the
 * Place row), PM1 to PM3 (the map drop) and K1 to K7 (the Kit). A step the world
 * cannot give is printed as `NOT WALKED  <id>  <reason>`, which is neither a PASS
 * nor a FAIL. The one world permission the walk changes is Create New Actors for
 * the Player role: its starting value is read and printed at the start, PR2's
 * no-create half is read before the grant, the grant is written for PR2's create
 * half and PR3 alone, and a `finally` puts the starting value back and reads it
 * on both seats.
 *
 * Scripted, not gestured: the Region of PR1 is created from the Player's page
 * (the write a drawing ends in; the pointer's draw is not driven); the map drop
 * is `Hooks.call("dropCanvasData", canvas, data)` on the viewed scene and the
 * Region window's drop a `drop` event on the row's zone, as docs/scene-search/
 * TESTING.md "S2" has it; H5 raises the Judge's day's-end question by calling the
 * offer the token's move calls. Every other press is a real click on the seat's
 * own open sheet, and a crafted press calls `requestPartyPress` on the seat's page.
 *
 * Every name is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): the delve party's `formation/seat-frame-*` (the frame walk's);
 * `formation/heads-observed-*`; `formation/heads-city-*` (a scene, a party, its
 * member and token, two places and their tokens); `formation/heads-journey-*`;
 * `formation/place-row-player-*` (a scene, the seat's Region, an observed Region
 * carrying a District behaviour, a wall, four places, a trap Item) with the
 * hazard Item `formation/hazard-sample`; `formation/kit-seat-*` (a party, two
 * members and a known spell each). Deletes by the run's own ledger only: the
 * place PR3's drop makes and the cards the presses post.
 *
 * Seats: the primary GM and a Player user (SEAT_PLAYER). The Judge's seat runs
 * every relay. With SHOTS=1 the walk ends by taking the release plates from the
 * Player seat into docs/releases/v<version>/, each clipped to its element.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const SCOPE = "acks-extras";
const SHOTS = process.env.SHOTS === "1";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0, skipped: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};
const notWalked = (id, reason) => {
  tally.skipped += 1;
  console.log(`NOT WALKED  ${id}  ${reason}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__shBoot = { phase: "load", phases: [], errors: [] });
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
  /**
   * The world's `permissions` setting entry for Create New Actors (the roles that hold it) as stored, and what
   * this seat's own user can do.
   */
  roleRead: async () => ({
    roles: [...(game.settings.get("core", "permissions")?.ACTOR_CREATE ?? [])],
    can: !!game.user.can("ACTOR_CREATE"),
  }),

  /** On the Judge's seat: write the Create New Actors entry of the `permissions` setting to `roles`, leaving every other entry as it stands. */
  roleWrite: async ({ roles }) => {
    const current = foundry.utils.deepClone(game.settings.get("core", "permissions") ?? {});
    current.ACTOR_CREATE = roles;
    await game.settings.set("core", "permissions", current);
    return { roles: [...(game.settings.get("core", "permissions")?.ACTOR_CREATE ?? [])] };
  },

  census: async () => ({
    user: game.user.name,
    userId: game.user.id,
    role: game.user.role,
    canCreate: !!game.user.can("ACTOR_CREATE"),
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    boot: globalThis.__shBoot ?? null,
  }),

  /** Import the modules the walk reads, add helpers, and record every notification the seat is shown. */
  install: async () => {
    const H = (globalThis.__sh = globalThis.__sh ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.requests = await import(`${base}formation/player-requests.mjs`);
    H.travel = await import(`${base}formation/travel.mjs`);
    H.engine = await import(`${base}formation/turn-engine.mjs`);
    H.day = await import(`${base}formation/day-close.mjs`);
    H.consts = await import(`${base}formation/constants.mjs`);
    H.district = await import(`${base}formation/district-zone.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.set = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (!H.notes) {
      H.notes = [];
      for (const level of ["info", "warn", "error"]) {
        const original = ui.notifications[level].bind(ui.notifications);
        ui.notifications[level] = (message, options) => { H.notes.push({ level, text: String(message) }); return original(message, options); };
      }
    }
    return { ok: typeof H.requests.requestPartyPress === "function" && typeof H.engine.totalRounds === "function" };
  },

  /** The notifications recorded so far, cleared. */
  notes: async () => {
    const H = globalThis.__sh;
    return H.notes.splice(0, H.notes.length);
  },

  nowMs: async () => Date.now(),
  boot: async () => globalThis.__shBoot ?? null,
  loc: async ({ key, data = null }) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),

  formationOf: async ({ partyId }) => {
    const H = globalThis.__sh;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  tokenData: async ({ actorId, xy, hidden = false }) => ({ ...(await game.actors.get(actorId).getTokenDocument({ x: xy.x, y: xy.y })).toObject(), hidden }),

  /**
   * A party brought to its start shape: members in order (added with no token),
   * the seat owning `owned` and none of the others, careful pace, the mode, a
   * journey's shown kind, record label and fresh day board, and where `kit` is
   * given its lights and spells whole.
   */
  shape: async ({ fid, members, owned = [], seatId, mode = "delve", sceneId = null, hexLabel = null, shown = "believed", kit = null, tokenAt = null }) => {
    const H = globalThis.__sh;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const order = () => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    for (const id of members) {
      if (!H.model.getFormation(fid).members.some((m) => m?.actorId === id)) await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), null, { scene: null });
    }
    if (!same(order(), members)) {
      await H.model.patchFormation(fid, (rec) => { rec.members = members.map((id) => rec.members.find((m) => m?.actorId === id)).filter(Boolean); });
    }
    for (const id of members) {
      await game.actors.get(id).update({ ownership: owned.includes(id) ? { default: 0, [seatId]: 3 } : { default: 0 } }, { diff: false, recursive: false });
    }
    await H.model.setHurried(fid, false);
    if (tokenAt) {
      const tok = H.model.getPartyToken(H.model.getFormation(fid));
      if (tok && (tok._source.x !== tokenAt.x || tok._source.y !== tokenAt.y)) await tok.update({ x: tokenAt.x, y: tokenAt.y }, { animate: false, "acks-extras.poiTravel": true });
    }
    if (H.travel.travelOf(H.model.getFormation(fid)).mode !== mode || mode === "settlement") await H.travel.setJourneyMode(fid, mode, { sceneId });
    if (mode === "journey") {
      await H.travel.applyTravelForm(fid, { shown });
      await H.model.patchFormation(fid, (rec) => {
        const t = H.travel.storedTravelOf(rec);
        rec.travel = { ...t, day: H.travel.freshDay("march"), ...(hexLabel !== null ? { hex: { ...t.hex, label: hexLabel } } : {}) };
      });
    }
    if (kit) {
      await H.model.patchFormation(fid, (rec) => { rec.lights = kit.lights; rec.spells = kit.spells; });
    }
    await H.sleep(700);
    return { order: order(), mode: H.travel.travelOf(H.model.getFormation(fid)).mode };
  },

  setMode: async ({ fid, mode, sceneId = null }) => {
    const H = globalThis.__sh;
    await H.travel.setJourneyMode(fid, mode, { sceneId });
    await H.sleep(700);
    return { mode: H.travel.travelOf(H.model.getFormation(fid)).mode };
  },

  setShown: async ({ fid, shown }) => {
    await globalThis.__sh.travel.applyTravelForm(fid, { shown });
    await globalThis.__sh.sleep(600);
    return { shown };
  },

  /** What the record holds, as the Judge's client reads it. */
  record: async ({ fid }) => {
    const H = globalThis.__sh;
    const f = H.model.getFormation(fid);
    const t = H.travel.travelOf(f);
    const tok = H.model.getPartyToken(f);
    return {
      name: f.name,
      mode: t.mode,
      hurried: f.stance?.pace === "hurried",
      dayCount: t.dayCount,
      hex: t.hex?.label ?? null,
      hexes: t.day?.hexesEntered ?? 0,
      dayKind: t.day?.kind ?? null,
      activities: t.day?.activities ?? [],
      done: t.day?.done ?? [],
      logLen: (t.log ?? []).length,
      rounds: H.engine.totalRounds(f.clock),
      token: tok ? { x: tok._source.x, y: tok._source.y } : null,
      lights: f.lights.map((l) => ({ id: l.id, bearerId: l.bearerId })),
      spells: (f.spells ?? []).map((s) => ({ id: s.id, name: s.name, casterId: s.casterId, remaining: s.remaining })),
    };
  },

  /** Put the journey day to a shape: hours set aside for the country, or the day's hours spent. */
  dayShape: async ({ fid, forage = false, spent = false }) => {
    const H = globalThis.__sh;
    await H.model.patchFormation(fid, (rec) => {
      const t = H.travel.storedTravelOf(rec);
      const slots = Math.max(1, t.day.activities.length);
      const activities = Array.from({ length: slots }, (_v, n) => (forage && n === 0 ? "forage" : null));
      rec.travel = { ...t, day: { ...t.day, activities, done: Array.from({ length: slots }, () => false), offered: false, ...(spent ? { hours: 999, miles: 5 } : {}) } };
    });
    await H.sleep(500);
    return { ok: true };
  },

  /** Raise the Judge's day's-end question without awaiting it; its answer is read with `offerAnswer`. */
  offerStart: async ({ fid }) => {
    const H = globalThis.__sh;
    const state = (H.offer = { done: false, value: null });
    H.day.offerDayEnd(fid).then((v) => { state.done = true; state.value = v; }, (e) => { state.done = true; state.value = `error: ${e?.message}`; });
    await H.sleep(1500);
    return { done: state.done, value: state.value, dialog: !!document.querySelector('.acks-extras-scroll button[data-action="end"]') };
  },

  /** Answer the standing dialog with the button named, then read what the offer answered. */
  offerAnswer: async ({ action }) => {
    const H = globalThis.__sh;
    document.querySelector(`.acks-extras-scroll button[data-action="${action}"]`)?.click();
    await H.poll(() => H.offer?.done, { tries: 40, every: 200 });
    return { done: H.offer?.done ?? false, value: H.offer?.value ?? null };
  },

  cards: async ({ since }) => game.messages.contents
    .filter((m) => m.timestamp >= since)
    .map((m) => ({
      id: m.id,
      alias: m.speaker?.alias ?? "",
      html: m.content ?? "",
      text: (m.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      whispered: (m.whisper ?? []).length > 0,
    })),

  /** Open a party sheet on this seat at a tab, at a size that shows it. */
  open: async ({ partyId, tab = null, width = 920, height = 820 }) => {
    const H = globalThis.__sh;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(1000);
    app.setPosition({ left: 16, top: 16, width, height });
    if (tab) {
      H.root(app)?.querySelector(`.tabs [data-group="primary"][data-tab="${tab}"]`)?.click();
      await H.sleep(700);
    }
    return { id: app.id, tab: app.tabGroups?.primary ?? null };
  },

  close: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** What the mode tab's head draws on this seat, and the figures the sheet's own context gives it. */
  head: async ({ partyId }) => {
    const H = globalThis.__sh;
    const app = game.actors.get(partyId).sheet;
    await app.render();
    await H.sleep(700);
    const el = H.root(app);
    const panel = el?.querySelector('.acks-extras-party-sheet__panel[data-tab="mode"]');
    const head = panel?.querySelector(".acks-extras-party-sheet__head");
    const actions = head?.querySelector(".acks-extras-party-sheet__head-actions");
    const title = head?.querySelector(".acks-extras-party-sheet__head-title");
    const asks = head?.querySelector(".acks-extras-party-sheet__head-asks");
    const pace = head?.querySelector('[data-action="togglePace"]');
    const ctx = await app._prepareContext({});
    return {
      head: !!head,
      actions: !!actions,
      pills: [...(actions?.querySelectorAll("[data-action]") ?? [])].map((b) => b.dataset.action),
      asks: asks?.textContent.trim() ?? "",
      asksLast: !!asks && actions.lastElementChild === asks,
      tip: title?.dataset.tooltipText ?? "",
      title: title?.textContent.trim() ?? "",
      field: actions?.querySelector('input[name="travel.hexLabel"]')?.value ?? null,
      hunted: !!actions?.querySelector('input[name="travel.settlement.wanted"]'),
      pacePressed: pace?.getAttribute("aria-pressed") ?? null,
      figuresPace: !!el?.querySelector('.acks-extras-party-sheet__rail--figures [data-action="togglePace"]'),
      poiTargets: ctx.strip?.settlement?.poiTargets ?? null,
      believed: ctx.travel?.hexField ?? null,
    };
  },

  /** A real click on a control of the open sheet. */
  click: async ({ partyId, selector, settle = 1500 }) => {
    const H = globalThis.__sh;
    const control = H.root(game.actors.get(partyId).sheet)?.querySelector(selector);
    if (!control) return { found: false, selector };
    const disabled = !!control.disabled;
    control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },

  /** The head's hex field typed into as a person does (input, then a change as it loses focus), then Next hex pressed. */
  nextHex: async ({ partyId, value }) => {
    const H = globalThis.__sh;
    const el = H.root(game.actors.get(partyId).sheet);
    const field = el?.querySelector('input[name="travel.hexLabel"]');
    if (!field) return { found: false };
    // The change that a click's blur fires rides the form to the Judge and redraws the sheet, which restores the field; the click that follows a blur reads the field before that, so no pause stands between them.
    H.set(field, value);
    el.querySelector('[data-action="travelEnterHex"]')?.click();
    await H.sleep(2200);
    return { found: true };
  },

  /** A crafted press on the seat's own page; the answer, and what the seat was told. */
  ask: async ({ fid, press, args }) => {
    const H = globalThis.__sh;
    H.notes.length = 0;
    const answer = await H.requests.requestPartyPress(H.model.getFormation(fid), press, args);
    await H.sleep(1200);
    return { answer, notes: H.notes.splice(0, H.notes.length) };
  },

  /** The hop picker the seat's Hop opened: its options, then the pick made and answered. */
  hopPick: async ({ match }) => {
    const H = globalThis.__sh;
    const select = await H.poll(() => document.querySelector('.acks-extras-scroll select[name="tokenId"]'), { tries: 40, every: 100 });
    if (!select) return { dialog: false };
    const options = [...select.options].map((o) => ({ id: o.value, text: o.textContent }));
    const pick = options.find((o) => o.text.includes(match));
    if (pick) select.value = pick.id;
    select.closest("dialog, .application")?.querySelector('button[data-action="ok"]')?.click();
    await H.sleep(3500);
    return { dialog: true, options, picked: pick?.id ?? null };
  },

  tokenIds: async ({ sceneId, names }) => Object.fromEntries(names.map((n) => [n, game.scenes.get(sceneId).tokens.find((t) => t.name.includes(n))?.id ?? null])),

  /* ---- the Kit tab ---- */

  kitRead: async ({ partyId }) => {
    const H = globalThis.__sh;
    const app = game.actors.get(partyId).sheet;
    await app.render();
    await H.sleep(700);
    const kit = H.root(app)?.querySelector('.acks-extras-party-sheet__panel[data-tab="kit"]');
    const act = (row) => [...(row?.querySelectorAll("button[data-action]") ?? [])].map((b) => b.dataset.action);
    const row = kit?.querySelector(".add-spell");
    return {
      kit: !!kit,
      lights: Object.fromEntries([...(kit?.querySelectorAll(".lights [data-light-id]") ?? [])].map((r) => [r.dataset.lightId, act(r)])),
      spells: Object.fromEntries([...(kit?.querySelectorAll(".spells [data-spell-id]") ?? [])].map((r) => [r.dataset.spellId, act(r)])),
      addRow: !!row,
      casters: [...(row?.querySelectorAll('select[data-pick="spellCaster"] option') ?? [])].map((o) => ({ id: o.value, text: o.textContent.trim() })),
      picks: [...(row?.querySelectorAll('select[data-pick="spellPick"] option') ?? [])].map((o) => o.textContent.trim()),
      maps: act(kit?.querySelector(".maps")).filter((a) => ["newMap", "archiveMap", "closeMap", "saveFogMap"].includes(a)),
    };
  },

  /** The add-spell row filled in as a person fills it (the manual entry), then Track pressed. */
  kitAdd: async ({ partyId, name, turns, casterId }) => {
    const H = globalThis.__sh;
    const row = H.root(game.actors.get(partyId).sheet)?.querySelector('.acks-extras-party-sheet__panel[data-tab="kit"] .add-spell');
    if (!row) return { found: false };
    H.set(row.querySelector('[data-pick="spellPick"]'), "");
    H.set(row.querySelector('[data-pick="spellName"]'), name);
    H.set(row.querySelector('[data-pick="spellTurns"]'), String(turns));
    H.set(row.querySelector('[data-pick="spellCaster"]'), casterId);
    await H.sleep(300);
    row.querySelector('[data-action="addSpell"]')?.click();
    await H.sleep(2200);
    return { found: true };
  },

  /* ---- the Region window and the map ---- */

  /** Open a Region's window afresh on its Appearance tab and read the Place row. */
  regionRow: async ({ regionUuid }) => {
    const H = globalThis.__sh;
    const region = await fromUuid(regionUuid);
    const app = region.sheet;
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    await app.render({ force: true });
    await H.sleep(1200);
    H.root(app)?.querySelector('.tabs [data-tab="appearance"], nav [data-tab="appearance"]')?.click();
    await H.sleep(700);
    const el = H.root(app);
    const row = el?.querySelector(".acks-extras-region-place");
    const text = (sel) => row?.querySelector(sel)?.textContent.trim() ?? null;
    return {
      id: app.id,
      owner: !!region.isOwner,
      row: !!row,
      captionTag: row?.querySelector(".acks-extras-region-place-caption")?.tagName ?? null,
      name: text(".acks-extras-region-place-name"),
      picker: !!row?.querySelector("select"),
      make: !!row?.querySelector("button"),
      counts: text(".acks-extras-region-place-counts"),
      zone: text(".acks-extras-region-place-drop"),
      hint: text("p.hint"),
    };
  },

  closeRegion: async ({ regionUuid }) => {
    try { await (await fromUuid(regionUuid)).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** A drag of an Item dropped on the Place row's zone of a Region's open window. */
  dropRegion: async ({ regionUuid, uuid }) => {
    const H = globalThis.__sh;
    const zone = H.root((await fromUuid(regionUuid)).sheet)?.querySelector(".acks-extras-region-place-drop");
    if (!zone) return { zone: false };
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await H.sleep(3000);
    return { zone: true };
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 20000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    return { scene: canvas.scene?.id === sceneId };
  },

  /** A drag of an Item dropped on the viewed scene's map: the hook a real drop reaches. */
  dropMap: async ({ uuid, x, y }) => {
    const H = globalThis.__sh;
    H.notes.length = 0;
    Hooks.call("dropCanvasData", canvas, { type: "Item", uuid, x, y });
    await H.sleep(3000);
    return { notes: H.notes.splice(0, H.notes.length) };
  },

  /** Judge side: link (or unlink) the Region and read the place made for it. */
  link: async ({ regionUuid, placeUuid = null }) => {
    const scenes = acksExtras.location.scenes;
    const region = await fromUuid(regionUuid);
    if (placeUuid) await scenes.linkRegion(region, await fromUuid(placeUuid));
    else await scenes.unlinkRegion(region);
    await globalThis.__sh.sleep(500);
    return { linked: scenes.locationOfRegion(region)?.uuid ?? null };
  },

  placeOf: async ({ regionUuid }) => {
    const place = acksExtras.location.scenes.locationOfRegion(await fromUuid(regionUuid));
    return place ? { uuid: place.uuid, name: place.name, ownerDefault: place.ownership?.default ?? null, sheetOpen: !!place.sheet?.rendered } : null;
  },

  /** A place's things as stored: kind, hidden, point. */
  things: async ({ placeUuid }) => ((await fromUuid(placeUuid)).getFlag("acks-extras", "things") ?? []).map((t) => ({ kind: t.kind, hidden: !!t.hidden, point: t.point ?? null, ref: t.ref ?? null })),

  /** A place's things written whole, empty: the start shape of a step that counts them. */
  clearThings: async ({ placeUuids }) => {
    for (const uuid of placeUuids) await (await fromUuid(uuid)).update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create([]) });
    return { cleared: placeUuids.length };
  },

  /** Write one place's ownership whole, and the Items the drops carry readable to the seat. */
  own: async ({ uuid, ownership }) => {
    await (await fromUuid(uuid)).update({ ownership }, { diff: false, recursive: false });
    return { ok: true };
  },

  flagsOf: async ({ uuid }) => fromUuidSync(uuid)?.flags?.["acks-extras"] ?? null,
  districtType: async () => globalThis.__sh.district.DISTRICT_TYPE ?? null,

  /** A behaviour's window on this seat: whether it is editable and whether it carries either place row. */
  behaviorWindow: async ({ uuid }) => {
    const H = globalThis.__sh;
    const behavior = await fromUuid(uuid);
    const app = behavior.sheet;
    await app.render({ force: true });
    await H.sleep(1200);
    const el = H.root(app);
    const out = { editable: !!app.isEditable, placeRow: !!el?.querySelector(".acks-extras-region-place, .acks-extras-district-place"), controls: [...(el?.querySelectorAll("input, select, textarea") ?? [])].filter((c) => !c.disabled).length };
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return out;
  },

  /** Scroll an element into view and clip a shot to it: the page's own selector. */
  settle: async ({ selector }) => {
    const el = document.querySelector(selector);
    el?.scrollIntoView({ block: "nearest" });
    await globalThis.__sh.sleep(500);
    return { found: !!el };
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Run a page function on a seat until its answer passes `test`, or give back the last answer. */
const until = async (api, fn, arg, test, { tries = 40, every = 250 } = {}) => {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, arg);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
};

const ready = async (api, label) => {
  for (let n = 0; n < 240; n++) {
    const ok = await api.eval(`!!(globalThis.game?.ready && globalThis.acksExtras?.formation)`).catch(() => false);
    if (ok) return n / 2;
    await sleep(500);
  }
  throw new Error(`${label} never reached ready`);
};

/** The recorder has to be in the page before the page loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 600000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  ws.close();
  return seconds;
}

const open = {};
const cardIds = [];
const held = { places: [], partyIds: [], modeParties: [] };
const character = (name, ownership) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } }, ...(ownership ? { ownership } : {}) });
const SWEEPABLE = /QA (Seat|Heads|Kit|Place)/;
/** The roles holding Create New Actors as the run found them; null until read, and again once put back. */
let grantStart = null;
/**
 * Put the Create New Actors entry back to the roles the run found, whether or not the grant was written, and
 * read it on both seats. Safe to call twice: once put back, `grantStart` is null.
 * @returns {Promise<{ok: boolean, start: number[], gm: number[], seat: number[]}|null>} null when nothing is to put back
 */
async function putGrantBack() {
  if (!grantStart || !open.gm) return null;
  const start = grantStart;
  await run(open.gm, P.roleWrite, { roles: start });
  const match = (r) => same(r.roles, start);
  const onGm = await until(open.gm, P.roleRead, null, match);
  const onSeat = open.player ? await until(open.player, P.roleRead, null, match) : null;
  grantStart = null;
  return { ok: match(onGm) && (!onSeat || match(onSeat)), start, gm: onGm.roles, seat: onSeat?.roles ?? null };
}

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("seat ready after (s)", await record(PORTS.player, "seat", player));
  note("installed", [await run(gm, P.install), await run(player, P.install)]);
  const census = { gm: await run(gm, P.census), seat: await run(player, P.census) };
  note("seat", { role: census.seat.role, canCreate: census.seat.canCreate });
  if (census.seat.role !== 1) blocked(`the seat's role is ${census.seat.role}; the walk is for a Player (1) seat`);
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the relay would run there");
  check("the Judge's seat is a GM, the active one, and the other seat a Player", census.gm.role >= 3, { gm: census.gm.role, seat: census.seat.role });
  for (const [key, c] of Object.entries(census)) check(`${key}: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  const seatId = census.seat.userId;
  const canCreate = census.seat.canCreate;
  const startRead = await run(gm, P.roleRead);
  grantStart = startRead.roles;
  note("Create New Actors in the world's permissions setting at the start (roles; the Player role is 1)", grantStart);
  const yours = { default: 0, [seatId]: 3 };
  const L = async (key, data) => run(gm, P.loc, { key, data });

  /* ------------------------------ fixtures ------------------------------ */
  section("fixtures");
  const delve = {
    scene: await gm.fixture("formation/seat-frame-scene", "Scene", { name: "QA Seat Frame Scene", width: 1200, height: 800, grid: { size: 100 }, ownership: { default: 2 } }),
    party: await gm.fixture("formation/seat-frame-party", "Actor", { name: "QA Seat Frame Party", type: `${SCOPE}.party` }),
    ranger: await gm.fixture("formation/seat-frame-ranger", "Actor", character("QA Seat Frame Ranger", yours)),
    smith: await gm.fixture("formation/seat-frame-smith", "Actor", character("QA Seat Frame Smith")),
  };
  const observed = {
    party: await gm.fixture("formation/heads-observed-party", "Actor", { name: "QA Heads Observed Party", type: `${SCOPE}.party` }),
    member: await gm.fixture("formation/heads-observed-member", "Actor", character("QA Heads Observed Member")),
  };
  const city = {
    scene: await gm.fixture("formation/heads-city-scene", "Scene", { name: "QA Heads City Scene", width: 1600, height: 1000, grid: { size: 100 }, ownership: { default: 2 } }),
    party: await gm.fixture("formation/heads-city-party", "Actor", { name: "QA Heads City Party", type: `${SCOPE}.party` }),
    member: await gm.fixture("formation/heads-city-member", "Actor", character("QA Heads City Member", yours)),
    shown: await gm.fixture("formation/heads-city-shown", "Actor", { name: "QA Place 1 <u>x</u>", type: `${SCOPE}.location` }),
    hidden: await gm.fixture("formation/heads-city-hidden", "Actor", { name: "QA Place 2", type: `${SCOPE}.location` }),
  };
  const journey = {
    scene: await gm.fixture("formation/heads-journey-scene", "Scene", { name: "QA Heads Journey Scene", width: 2000, height: 1500, grid: { type: 2, size: 100 }, ownership: { default: 2 } }),
    party: await gm.fixture("formation/heads-journey-party", "Actor", { name: "QA Heads Journey Party", type: `${SCOPE}.party` }),
    member: await gm.fixture("formation/heads-journey-member", "Actor", character("QA Heads Journey Member", yours)),
  };
  const kit = {
    party: await gm.fixture("formation/kit-seat-party", "Actor", { name: "QA Kit Seat Party", type: `${SCOPE}.party` }),
    a: await gm.fixture("formation/kit-seat-a", "Actor", character("QA Kit Seat A", yours)),
    b: await gm.fixture("formation/kit-seat-b", "Actor", character("QA Kit Seat B")),
  };
  await gm.fixture("formation/kit-seat-a-spell", "Item", { name: "QA Kit Known A", type: "spell", system: { duration: "1 turn" } }, { parent: `Actor.${kit.a.id}` });
  await gm.fixture("formation/kit-seat-b-spell", "Item", { name: "QA Kit Known B", type: "spell", system: { duration: "1 turn" } }, { parent: `Actor.${kit.b.id}` });
  const tokens = {
    delve: await gm.fixture("formation/seat-frame-token", "Token", await run(gm, P.tokenData, { actorId: delve.party.id, xy: { x: 400, y: 400 } }), { parent: delve.scene.uuid }),
    city: await gm.fixture("formation/heads-city-token", "Token", await run(gm, P.tokenData, { actorId: city.party.id, xy: { x: 200, y: 200 } }), { parent: city.scene.uuid }),
    shown: await gm.fixture("formation/heads-city-shown-token", "Token", await run(gm, P.tokenData, { actorId: city.shown.id, xy: { x: 700, y: 200 } }), { parent: city.scene.uuid }),
    hidden: await gm.fixture("formation/heads-city-hidden-token", "Token", await run(gm, P.tokenData, { actorId: city.hidden.id, xy: { x: 900, y: 200 }, hidden: true }), { parent: city.scene.uuid }),
    journey: await gm.fixture("formation/heads-journey-token", "Token", await run(gm, P.tokenData, { actorId: journey.party.id, xy: { x: 500, y: 500 } }), { parent: journey.scene.uuid }),
  };
  held.partyIds = [delve.party.id, observed.party.id, city.party.id, journey.party.id, kit.party.id];
  const formations = {};
  for (const [key, party] of Object.entries({ delve: delve.party, observed: observed.party, city: city.party, journey: journey.party, kit: kit.party })) {
    formations[key] = await run(gm, P.formationOf, { partyId: party.id });
    if (formations[key].error) throw new Error(`${key}: ${formations[key].error}`);
  }
  held.modeParties = [formations.city.fid, formations.journey.fid];

  // The Place row's own fixtures: the Items the seat drops must be readable to it.
  const row = {
    scene: await gm.fixture("formation/place-row-player-scene", "Scene", { name: "QA Place Row Scene", width: 2000, height: 1500, grid: { size: 100 }, ownership: { default: 2 } }),
    owned: await gm.fixture("formation/place-row-player-place-owned", "Actor", { name: "QA Place Owned", type: `${SCOPE}.location`, ownership: { default: 0, [seatId]: 3 } }),
    seen: await gm.fixture("formation/place-row-player-place-seen", "Actor", { name: "QA Place Seen", type: `${SCOPE}.location`, ownership: { default: 0, [seatId]: 2 } }),
    closed: await gm.fixture("formation/place-row-player-place-closed", "Actor", { name: "QA Place Closed", type: `${SCOPE}.location`, ownership: { default: 0 } }),
    stamped: await gm.fixture("formation/place-row-player-place-stamped", "Actor", { name: "QA Place Stamped", type: `${SCOPE}.location`, ownership: { default: 0 }, flags: { [SCOPE]: { cookbook: { id: "qa-place-row-stamp" } } } }),
    hazard: await gm.fixture("formation/hazard-sample", "Item", { name: "QA Hazard Sample", type: `${SCOPE}.hazard`, system: { key: "jump" }, ownership: { default: 2 } }),
    trap: await gm.fixture("formation/place-row-player-trap", "Item", { name: "QA Place Row Trap", type: `${SCOPE}.trap`, ownership: { default: 2 } }),
  };
  const rect = (x, y, width, height) => [{ type: "rectangle", x, y, width, height, rotation: 0, hole: false }];
  const observedRegion = await gm.fixture("formation/place-row-player-observed-region", "Region", { name: "QA Place Observed Region", color: "#996633", shapes: rect(1000, 200, 300, 300), behaviors: [], ownership: { default: 0, [seatId]: 2 } }, { parent: row.scene.uuid });
  const wall = await gm.fixture("formation/place-row-player-wall", "Wall", { c: [400, 300, 400, 700] }, { parent: row.scene.uuid });
  const districtType = await run(gm, P.districtType);
  note("fixtures", { delve: delve.party.uuid, city: city.party.uuid, journey: journey.party.uuid, kit: kit.party.uuid, row: row.scene.uuid, districtType });
  for (const item of [row.hazard, row.trap]) await run(gm, P.own, { uuid: item.uuid, ownership: { default: 2 } });

  const since = await run(gm, P.nowMs);
  const cardsSince = async (t, filter = () => true) => (await run(gm, P.cards, { since: t })).filter(filter);
  const spoken = (cards, alias, said) => cards.filter((c) => c.alias === alias && c.text.includes(said));

  /* ------------------------------- H1 ------------------------------- */
  section("H1. Delve head");
  const shapeDelve = () => run(gm, P.shape, { fid: formations.delve.fid, members: [delve.ranger.id, delve.smith.id], owned: [delve.ranger.id], seatId, mode: "delve" });
  const shape1 = await shapeDelve();
  check("H1 start shape: the two members in order, the party in the delve", shape1.mode === "delve" && same(shape1.order, [delve.ranger.id, delve.smith.id]), shape1);
  await run(player, P.open, { partyId: delve.party.id, tab: "mode" });
  let h = await run(player, P.head, { partyId: delve.party.id });
  note("delve head", h);
  check("H1 the head holds Turn, Round, Rest and Hurried and no Undo", ["advanceTurn", "advanceRound", "restTurn", "togglePace"].every((a) => h.pills.includes(a)) && !h.pills.includes("undoTurn"), h.pills);
  check("H1 an asks line sits under the pills", h.asks.length > 0 && h.asksLast, h.asks);
  check("H1 the title's tooltip carries the turn count and the elapsed time", /\d/.test(h.tip) && h.tip.length > h.title.length, { tip: h.tip, title: h.title });
  const frameName = (await run(gm, P.record, { fid: formations.delve.fid })).name;
  const paceHurried = await L("ACKS-FORMATION.request.paceHurried");
  const paceCareful = await L("ACKS-FORMATION.request.paceCareful");
  const pill = '.acks-extras-party-sheet__head-actions [data-action="togglePace"]';
  let t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: delve.party.id, selector: pill });
  let rec = await run(gm, P.record, { fid: formations.delve.fid });
  let lines = spoken(await cardsSince(t), frameName, paceHurried);
  check("H1 Hurried: the record reads hurried and one public line, spoken as the party, says it", rec.hurried && lines.length === 1, { hurried: rec.hurried, lines: lines.length });
  t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: delve.party.id, selector: pill });
  rec = await run(gm, P.record, { fid: formations.delve.fid });
  lines = spoken(await cardsSince(t), frameName, paceCareful);
  check("H1 Hurried again: careful and one line", !rec.hurried && lines.length === 1, { hurried: rec.hurried, lines: lines.length });
  await run(player, P.click, { partyId: delve.party.id, selector: pill });
  t = await run(gm, P.nowMs);
  const repeat = await run(player, P.ask, { fid: formations.delve.fid, press: "pace", args: { hurried: true } });
  rec = await run(gm, P.record, { fid: formations.delve.fid });
  check("H1 the same hurried press with the record already hurried: ok, unchanged, no line", repeat.answer?.ok === true && rec.hurried && (await cardsSince(t, (c) => c.alias === frameName)).length === 0, { answer: repeat.answer, hurried: rec.hurried });
  await run(gm, P.open, { partyId: delve.party.id, tab: "mode" });
  t = await run(gm, P.nowMs);
  await run(gm, P.click, { partyId: delve.party.id, selector: pill });
  rec = await run(gm, P.record, { fid: formations.delve.fid });
  check("H1 the Judge's own Hurried press changes the pace and posts no line", !rec.hurried && (await cardsSince(t, (c) => c.alias === frameName)).length === 0, { hurried: rec.hurried });
  await run(gm, P.close, { partyId: delve.party.id });
  t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: delve.party.id, selector: '.acks-extras-party-sheet__rail--figures [data-action="togglePace"]' });
  rec = await run(gm, P.record, { fid: formations.delve.fid });
  check("H1 the figures rail's pace cell makes the same press", rec.hurried && spoken(await cardsSince(t), frameName, paceHurried).length === 1, { hurried: rec.hurried });
  await run(player, P.click, { partyId: delve.party.id, selector: '.acks-extras-party-sheet__rail--figures [data-action="togglePace"]' });
  const clock0 = await run(gm, P.record, { fid: formations.delve.fid });
  for (const [press, said] of [["advanceTurn", "ACKS-FORMATION.request.askTurn"], ["advanceRound", "ACKS-FORMATION.request.askRound"]]) {
    t = await run(gm, P.nowMs);
    await run(player, P.click, { partyId: delve.party.id, selector: `.acks-extras-party-sheet__head-actions [data-action="${press}"]` });
    const after = await run(gm, P.record, { fid: formations.delve.fid });
    check(`H1 ${press === "advanceTurn" ? "Turn" : "Round"} is an ask: one public line and the clock unchanged`, spoken(await cardsSince(t), frameName, await L(said)).length === 1 && after.rounds === clock0.rounds, { rounds: [clock0.rounds, after.rounds] });
  }
  t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: delve.party.id, selector: '.acks-extras-party-sheet__head-actions [data-action="restTurn"]', settle: 2500 });
  const rested = await run(gm, P.record, { fid: formations.delve.fid });
  check("H1 Rest a turn: the Judge's client takes the rest, a line says it and the clock moves", spoken(await cardsSince(t), frameName, await L("ACKS-FORMATION.request.rest")).length === 1 && rested.rounds > clock0.rounds, { rounds: [clock0.rounds, rested.rounds] });
  await run(player, P.close, { partyId: delve.party.id });

  /* ------------------------------- H2 ------------------------------- */
  section("H2. A seat that owns no member");
  await run(gm, P.shape, { fid: formations.observed.fid, members: [observed.member.id], owned: [], seatId, mode: "delve" });
  await run(gm, P.own, { uuid: observed.party.uuid, ownership: { default: 0, [seatId]: 2 } });
  await run(player, P.open, { partyId: observed.party.id, tab: "mode" });
  h = await run(player, P.head, { partyId: observed.party.id });
  check("H2 no pill on the head and the pace cell is a reading", !h.actions && !h.pills.length && !h.figuresPace, h);
  t = await run(gm, P.nowMs);
  await run(player, P.ask, { fid: formations.observed.fid, press: "pace", args: { hurried: true } }).then(async (r) => {
    rec = await run(gm, P.record, { fid: formations.observed.fid });
    const refusedText = await L("ACKS-FORMATION.request.refused");
    check("H2 a crafted pace press answers notOwner, warns the generic refusal, changes nothing and posts nothing", r.answer?.refused === "notOwner" && r.notes.some((n) => n.level === "warn" && n.text === refusedText) && !rec.hurried && (await cardsSince(t, (c) => c.alias === rec.name)).length === 0, { answer: r.answer, notes: r.notes });
  });
  await run(player, P.close, { partyId: observed.party.id });

  /* ------------------------------- H3 ------------------------------- */
  section("H3. City");
  await run(gm, P.shape, { fid: formations.city.fid, members: [city.member.id], owned: [city.member.id], seatId, mode: "settlement", sceneId: city.scene.id, tokenAt: { x: 200, y: 200 } });
  const cityTokens = await run(gm, P.tokenIds, { sceneId: city.scene.id, names: ["QA Place 1", "QA Place 2"] });
  await run(player, P.open, { partyId: city.party.id, tab: "mode" });
  h = await run(player, P.head, { partyId: city.party.id });
  note("city head", h);
  check("H3 the head holds Hop, Turn, Round and Rest, and no Hunted here and no Undo", ["settlementTravelTo", "advanceTurn", "advanceRound", "restTurn"].every((a) => h.pills.includes(a)) && !h.hunted && !h.pills.includes("undoTurn"), { pills: h.pills, hunted: h.hunted });
  check("H3 the strip counts one place in reach (the hidden one is left out)", h.poiTargets === 1, { poiTargets: h.poiTargets });
  const cityRec0 = await run(gm, P.record, { fid: formations.city.fid });
  t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: city.party.id, selector: '[data-action="settlementTravelTo"]', settle: 600 });
  const picked = await run(player, P.hopPick, { match: "QA Place 1" });
  const cityRec1 = await run(gm, P.record, { fid: formations.city.fid });
  check("H3 the hop picker lists the shown place and not the hidden one", picked.dialog && picked.options.some((o) => o.text.includes("QA Place 1")) && !picked.options.some((o) => o.text.includes("QA Place 2")), picked.options);
  const moved = cityRec1.token && !same(cityRec1.token, cityRec0.token);
  if (!moved) {
    notWalked("H3 hop", "the party did not move: the hop's price is not imported (the press answers quiet), so the move, the clock spend and the lines were not walked");
  } else {
    const cards = await cardsSince(t);
    const line = cards.find((c) => c.alias === cityRec1.name && !c.whispered && c.text.includes("QA Place 1"));
    check("H3 picking the shown place moves the party token and spends the clock", cityRec1.rounds > cityRec0.rounds, { token: [cityRec0.token, cityRec1.token], rounds: [cityRec0.rounds, cityRec1.rounds] });
    check("H3 one public line names the place as text, its tag escaped", !!line && /&lt;u&gt;/.test(line.html) && !/<u>/.test(line.html), line?.html);
    check("H3 the Judges get the whispered hop line", cards.some((c) => c.whispered && c.text.includes("QA Place 1")), cards.filter((c) => c.whispered).map((c) => c.text));
  }
  await run(gm, P.shape, { fid: formations.city.fid, members: [city.member.id], owned: [city.member.id], seatId, mode: "settlement", sceneId: city.scene.id, tokenAt: { x: 200, y: 200 } });
  const before = await run(gm, P.record, { fid: formations.city.fid });
  t = await run(gm, P.nowMs);
  const noTargetText = await L("ACKS-FORMATION.settlement.poi.refused.noTarget");
  const hop = await run(player, P.ask, { fid: formations.city.fid, press: "hop", args: { tokenId: cityTokens["QA Place 2"] } });
  const afterHop = await run(gm, P.record, { fid: formations.city.fid });
  check("H3 a crafted hop naming the hidden token answers noTarget, warns, and moves nothing", hop.answer?.refused === "noTarget" && hop.notes.some((n) => n.level === "warn" && n.text === noTargetText) && same(afterHop.token, before.token) && afterHop.rounds === before.rounds, { answer: hop.answer, notes: hop.notes });
  await run(player, P.close, { partyId: city.party.id });

  /* ------------------------------- H4 ------------------------------- */
  section("H4. Journey");
  const jshape = (shown = "believed", hexLabel = "Z9") => run(gm, P.shape, { fid: formations.journey.fid, members: [journey.member.id], owned: [journey.member.id], seatId, mode: "journey", sceneId: journey.scene.id, hexLabel, shown });
  // The record holds no label here, so the hex the party believes is the cell its token stands in (`standingLabel`): the seat's field must read that cell, which the record's own (blank) label does not give.
  await jshape("believed", "");
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  h = await run(player, P.head, { partyId: journey.party.id });
  note("journey head", h);
  check("H4 the head holds the hex field, Next hex, Work the country and End day", h.field !== null && ["travelEnterHex", "forageDay", "travelEndDay"].every((a) => h.pills.includes(a)), { field: h.field, pills: h.pills });
  check("H4 the hex field reads the hex the party believes it stands in, not the record's label", h.field === h.believed && h.field !== "", { field: h.field, believed: h.believed });
  await run(gm, P.setShown, { fid: formations.journey.fid, shown: "unknown" });
  h = await run(player, P.head, { partyId: journey.party.id });
  check("H4 the field is blank while the party is shown unknown country", h.field === "", { field: h.field });
  await run(gm, P.setShown, { fid: formations.journey.fid, shown: "believed" });
  t = await run(gm, P.nowMs);
  const hexed = await run(player, P.nextHex, { partyId: journey.party.id, value: "D3" });
  rec = await run(gm, P.record, { fid: formations.journey.fid });
  check("H4 Next hex with D3 typed: the record's hex label is D3 and one public line names it", hexed.found && rec.hex === "D3" && spoken(await cardsSince(t), rec.name, await L("ACKS-FORMATION.request.enterHex", { hex: "D3" })).length === 1, { hex: rec.hex });
  t = await run(gm, P.nowMs);
  await run(player, P.nextHex, { partyId: journey.party.id, value: "" });
  rec = await run(gm, P.record, { fid: formations.journey.fid });
  check("H4 Next hex with the field blank: one line without a hex", spoken(await cardsSince(t), rec.name, await L("ACKS-FORMATION.request.enterHexBlank")).length === 1, { hex: rec.hex });
  const long = await run(player, P.ask, { fid: formations.journey.fid, press: "enterHex", args: { label: "x".repeat(65) } });
  const afterLong = await run(gm, P.record, { fid: formations.journey.fid });
  check("H4 a 65 character label answers badPress and changes nothing", long.answer?.refused === "badPress" && afterLong.hex === rec.hex, { answer: long.answer });
  const noHours = await L("ACKS-FORMATION.forageRun.noHours");
  const worked = await L("ACKS-FORMATION.forageRun.worked");
  await run(gm, P.dayShape, { fid: formations.journey.fid, forage: false });
  t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: journey.party.id, selector: '[data-action="forageDay"]', settle: 1800 });
  let notes = await run(player, P.notes);
  check("H4 Work the country with no hours set aside: an information line and no card", notes.some((n) => n.level === "info" && n.text === noHours) && (await cardsSince(t, (c) => c.alias === rec.name)).length === 0, notes);
  await run(gm, P.dayShape, { fid: formations.journey.fid, forage: true });
  t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: journey.party.id, selector: '[data-action="forageDay"]', settle: 3500 });
  rec = await run(gm, P.record, { fid: formations.journey.fid });
  if (!rec.done[0]) {
    notWalked("H4 forage with hours", "the hours were not marked done: nobody in the party could work the country (the press answers quiet)");
  } else {
    check("H4 Work the country with hours set aside: the hours are marked done and a card is posted", (await cardsSince(t)).length > 0, { done: rec.done });
    await run(player, P.notes);
    await run(player, P.click, { partyId: journey.party.id, selector: '[data-action="forageDay"]', settle: 1800 });
    notes = await run(player, P.notes);
    check("H4 again: the already-worked line", notes.some((n) => n.level === "info" && n.text === worked), notes);
  }
  rec = await run(gm, P.record, { fid: formations.journey.fid });
  t = await run(gm, P.nowMs);
  await run(player, P.click, { partyId: journey.party.id, selector: '[data-action="travelEndDay"]', settle: 4500 });
  const ended = await run(gm, P.record, { fid: formations.journey.fid });
  check("H4 End day: dayCount rises by one and one public line says the day ended", ended.dayCount === rec.dayCount + 1 && spoken(await cardsSince(t), ended.name, await L("ACKS-FORMATION.request.endDay")).length === 1, { dayCount: [rec.dayCount, ended.dayCount] });
  await run(gm, P.setMode, { fid: formations.journey.fid, mode: "delve" });
  const stale = await run(player, P.ask, { fid: formations.journey.fid, press: "enterHex", args: { label: "D4" } });
  const afterStale = await run(gm, P.record, { fid: formations.journey.fid });
  check("H4 an enterHex sent while the party is in the delve answers stale and writes nothing", stale.answer?.refused === "stale" && afterStale.hex === ended.hex, { answer: stale.answer });
  await run(player, P.close, { partyId: journey.party.id });

  /* ------------------------------- H5 ------------------------------- */
  section("H5. The day's end, answered once");
  for (const answer of ["end", "push"]) {
    await jshape("believed");
    await run(gm, P.dayShape, { fid: formations.journey.fid, spent: true });
    await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
    const start = await run(gm, P.record, { fid: formations.journey.fid });
    const offer = await run(gm, P.offerStart, { fid: formations.journey.fid });
    if (!offer.dialog) {
      notWalked(`H5 ${answer}`, `the Judge's question did not open (the offer answered ${JSON.stringify(offer.value)}): the day cannot be spent while the pace's hours are not imported`);
      continue;
    }
    await run(player, P.click, { partyId: journey.party.id, selector: '[data-action="travelEndDay"]', settle: 4500 });
    const mid = await run(gm, P.record, { fid: formations.journey.fid });
    check(`H5 End day from the seat while the Judge's dialog stands: dayCount rose by one and the log holds one row`, mid.dayCount === start.dayCount + 1 && mid.logLen === start.logLen + 1, { dayCount: [start.dayCount, mid.dayCount], log: [start.logLen, mid.logLen] });
    const answered = await run(gm, P.offerAnswer, { action: answer });
    const fin = await run(gm, P.record, { fid: formations.journey.fid });
    check(`H5 answering ${answer === "end" ? "Call it a day" : "Push on"} changes nothing, forces no day kind and the offer answers "answered"`, answered.value === "answered" && fin.dayCount === mid.dayCount && fin.logLen === mid.logLen && fin.dayKind !== "forced", { answered, dayKind: fin.dayKind });
    await run(player, P.close, { partyId: journey.party.id });
  }
  await run(gm, P.setMode, { fid: formations.journey.fid, mode: "delve" });

  /* ----------------------------- Place row ----------------------------- */
  section("PR1. The seat's own Region");
  const regionData = { name: "QA Place Region", color: "#336699", shapes: rect(200, 200, 600, 500), behaviors: [] };
  await gm.retire("formation/place-row-player-region", "Region", { parent: row.scene.uuid });
  let region = null;
  try {
    region = await player.fixture("formation/place-row-player-region", "Region", regionData, { parent: row.scene.uuid });
  } catch (err) {
    note("the seat could not create a Region", err?.message ?? String(err));
  }
  if (region) {
    const own = await player.eval(`fromUuid(${JSON.stringify(region.uuid)}).then((r) => ({ owner: !!r?.isOwner, author: r?.author?.id ?? null }))`);
    check("PR1 the seat created a Region in the scene and owns it", own.owner, own);
  } else {
    notWalked("PR1", "the seat cannot create Regions in this world; the Judge builds the Region with the seat at OWNER for the rest");
    region = await gm.fixture("formation/place-row-player-region", "Region", { ...regionData, ownership: yours }, { parent: row.scene.uuid });
  }
  const regionUuid = region.uuid;
  const places = { owned: row.owned.uuid, seen: row.seen.uuid, closed: row.closed.uuid, stamped: row.stamped.uuid };
  await run(gm, P.clearThings, { placeUuids: Object.values(places) });
  await run(gm, P.own, { uuid: places.owned, ownership: yours });
  await run(gm, P.own, { uuid: places.seen, ownership: { default: 0, [seatId]: 2 } });
  await run(gm, P.link, { regionUuid, placeUuid: null });

  section("PR2. No place yet");
  let r = await run(player, P.regionRow, { regionUuid });
  note("row, no place", r);
  const noneText = await L("ACKS-FORMATION.REGION_PLACE.none");
  check("PR2 a Place row: a caption that is a span, the none stand-in, no picker and no make-a-place button", r.row && r.captionTag === "SPAN" && r.name === noneText && !r.picker && !r.make, r);
  const dropText = await L("ACKS-FORMATION.REGION_PLACE.drop");
  const dropHiddenText = await L("ACKS-FORMATION.REGION_PLACE.dropHidden");
  if (!canCreate) {
    check("PR2 with Create New Actors not held: no drop zone and no hint", r.zone === null && r.hint === null, r);
  } else {
    notWalked("PR2 no-create half", "the seat already holds Create New Actors at the start, so the row without a zone cannot be read; the walk grants and never revokes");
  }

  // The grant is the one thing the walk changes outside its ledger: written for the create half of PR2 and PR3 alone,
  // and put back in the finally whether they pass, fail or throw.
  section("PR3 setup. Create New Actors granted to the Player role");
  try {
    const roles = grantStart.includes(1) ? grantStart : [...grantStart, 1];
    const wrote = await run(gm, P.roleWrite, { roles });
    const seen = await until(player, P.roleRead, null, (v) => v.can === true && v.roles.includes(1));
    check("PR3 setup: the Player role holds Create New Actors in the setting and game.user.can(\"ACTOR_CREATE\") reads true on the Player seat", wrote.roles.includes(1) && seen.can === true && seen.roles.includes(1), { gm: wrote.roles, seat: seen });

    if (seen.can !== true) {
      notWalked("PR2 create half and PR3", "the grant did not reach the Player seat");
    } else {
      section("PR2. No place yet, the create half");
      r = await run(player, P.regionRow, { regionUuid });
      note("row, no place, Create New Actors granted", r);
      check("PR2 with Create New Actors held: the drop zone and the hidden-trap hint are drawn", r.zone === dropText && r.hint === dropHiddenText, r);

      section("PR3. A drop makes the place");
      check("PR3 the zone's words end \"With no place yet, one is made.\"", /one is made\.$/.test(r.zone ?? "") && r.zone === dropText, r.zone);
      await run(player, P.dropRegion, { regionUuid, uuid: row.hazard.uuid });
      const made = await run(gm, P.placeOf, { regionUuid });
      if (made) {
        gm.track(made.uuid);
        held.places.push(made.uuid);
      }
      const madeThings = made ? await run(gm, P.things, { placeUuid: made.uuid }) : [];
      check("PR3 a place exists for the Region, its sheet did not open, and it opens to the table", !!made && !made.sheetOpen && made.ownerDefault === 3, made);
      check("PR3 the Judge's seat reads one obstacle on it", madeThings.length === 1 && madeThings[0].kind === "obstacle", madeThings);
    }
  } finally {
    section("PR3 teardown. Create New Actors put back");
    const back = await putGrantBack();
    if (back) {
      note("Create New Actors put back (start, gm seat, player seat; roles)", back);
      check("PR3 teardown: Create New Actors is back to its starting value, read on both seats", back.ok, back);
    }
  }

  section("PR4. The row in each state");
  const counts = async (key, data) => L(`ACKS-FORMATION.REGION_PLACE.${key}`, data);
  await run(gm, P.link, { regionUuid, placeUuid: places.owned });
  r = await run(player, P.regionRow, { regionUuid });
  check("PR4 owned: the place's name as text, a counts line of nothing yet, a zone reading dropOwned and the hidden-trap line", r.name === "QA Place Owned" && !r.picker && r.counts === (await counts("holdsNone")) && r.zone === (await counts("dropOwned")) && r.hint === (await counts("dropHidden")), r);
  await run(player, P.dropRegion, { regionUuid, uuid: row.hazard.uuid });
  r = await run(player, P.regionRow, { regionUuid });
  const oneObstacle = await counts("obstacle.one", { count: 1 });
  check("PR4 owned, an obstacle dropped: the counts line gains one obstacle", (r.counts ?? "").includes(oneObstacle), r.counts);
  await run(player, P.dropRegion, { regionUuid, uuid: row.trap.uuid });
  r = await run(player, P.regionRow, { regionUuid });
  const ownedThings = await run(gm, P.things, { placeUuid: places.owned });
  check("PR4 owned, a trap dropped: the counts line is unchanged and the Judge reads a hidden trap thing", (r.counts ?? "").includes(oneObstacle) && !/trap/i.test(r.counts ?? "") && ownedThings.some((x) => x.kind === "trap" && x.hidden), { counts: r.counts, things: ownedThings });
  await run(gm, P.link, { regionUuid, placeUuid: places.seen });
  r = await run(player, P.regionRow, { regionUuid });
  check("PR4 seen: the name alone, no counts and no zone", r.name === "QA Place Seen" && r.counts === null && r.zone === null && r.hint === null, r);
  await run(gm, P.link, { regionUuid, placeUuid: places.closed });
  r = await run(player, P.regionRow, { regionUuid });
  check("PR4 closed: only the closed stand-in", r.name === (await counts("closed")) && r.counts === null && r.zone === null && r.hint === null, r);
  await run(player, P.closeRegion, { regionUuid });

  section("PR5. A behaviour window of a Region the seat only observes");
  let districtUuid = null;
  const observedDoc = observedRegion.uuid;
  const existing = await gm.eval(`(fromUuidSync(${JSON.stringify(observedDoc)})?.behaviors.find((b) => b.type === ${JSON.stringify(districtType)}))?.uuid ?? null`);
  districtUuid = existing ?? (await gm.eval(`fromUuid(${JSON.stringify(observedDoc)}).then(async (r) => (await r.createEmbeddedDocuments("RegionBehavior", [{ type: ${JSON.stringify(districtType)}, name: "QA District", flags: { world: { fixture: "formation/place-row-player-observed-district" } } }]))[0].uuid)`));
  if (!existing) gm.track(districtUuid, "RegionBehavior", "formation/place-row-player-observed-district");
  const bw = await run(player, P.behaviorWindow, { uuid: districtUuid }).catch((err) => ({ error: err?.message ?? String(err) }));
  check("PR5 the window is read-only and carries no place row", bw.editable === false && bw.placeRow === false, bw);

  /* ------------------------------ map drops ------------------------------ */
  section("PM1 to PM3. Map drops");
  await run(gm, P.clearThings, { placeUuids: Object.values(places) });
  await run(gm, P.link, { regionUuid, placeUuid: places.owned });
  await run(player, P.view, { sceneId: row.scene.id });
  const warnRegion = await L("ACKS-FORMATION.REGION_PLACE.refused.noRegion");
  const warnWall = await L("ACKS-FORMATION.traps.dropNoWall");
  const wallBefore = await run(gm, P.flagsOf, { uuid: wall.uuid });
  await run(player, P.dropMap, { uuid: row.trap.uuid, x: 700, y: 600 });
  let owned = await run(gm, P.things, { placeUuid: places.owned });
  r = await run(player, P.regionRow, { regionUuid });
  check("PM1 a trap dropped on bare ground over the owned place's Region lands there, hidden, with its point; the counts line leaves it out", owned.length === 1 && owned[0].kind === "trap" && owned[0].hidden && owned[0].point?.x === 700 && r.counts === (await counts("holdsNone")), { owned, counts: r.counts });
  await run(player, P.closeRegion, { regionUuid });

  const refusedAt = async (label, x, y, watch) => {
    const out = {};
    for (const [kind, item, said] of [["hazard", row.hazard, warnRegion], ["trap", row.trap, warnWall]]) {
      const dropped = await run(player, P.dropMap, { uuid: item.uuid, x, y });
      out[kind] = dropped.notes.some((n) => n.level === "warn" && n.text === said);
    }
    const unchanged = [];
    for (const uuid of watch) unchanged.push((await run(gm, P.things, { placeUuid: uuid })).length);
    check(`PM2 ${label}: the hazard warns the no-region line, the trap the no-wall line, and no place gains a thing`, out.hazard && out.trap && unchanged.every((n, i) => n === (watch[i] === places.owned ? 1 : 0)), { out, unchanged });
  };
  await run(gm, P.link, { regionUuid, placeUuid: null });
  await refusedAt("where no place holds the point", 1500, 1200, Object.values(places));
  for (const key of ["seen", "closed", "stamped"]) {
    await run(gm, P.link, { regionUuid, placeUuid: places[key] });
    await refusedAt(`over the ${key} place's ground${key === "stamped" ? " (a hand-stamped stand-in, not an importer's place)" : ""}`, 700, 600, Object.values(places));
  }
  await run(gm, P.link, { regionUuid, placeUuid: places.owned });
  const flagsBefore = await run(gm, P.flagsOf, { uuid: wall.uuid });
  await run(player, P.dropMap, { uuid: row.trap.uuid, x: 450, y: 500 });
  owned = await run(gm, P.things, { placeUuid: places.owned });
  const flagsAfter = await run(gm, P.flagsOf, { uuid: wall.uuid });
  check("PM3 a trap dropped within a grid square of the wall lands on the owned place, hidden, and the wall's flags are unchanged", owned.filter((x) => x.kind === "trap").length === 2 && owned.every((x) => x.hidden) && same(flagsBefore, flagsAfter) && same(wallBefore, flagsBefore), { owned: owned.length, flags: [flagsBefore, flagsAfter] });

  /* -------------------------------- Kit -------------------------------- */
  section("K1 to K7. The Kit tab");
  const lightType = await gm.eval(`Object.keys(globalThis.__sh.consts.LIGHT_SOURCES)[0]`);
  const kitState = {
    lights: [{ id: "kitlightA", type: lightType, bearerId: kit.a.id, remaining: 6, lit: true }, { id: "kitlightB", type: lightType, bearerId: kit.b.id, remaining: 6, lit: true }],
    spells: [{ id: "kitspellA", name: "QA Kit Spell A", casterId: kit.a.id, remaining: 5 }, { id: "kitspellB", name: "QA Kit Spell B", casterId: kit.b.id, remaining: 5 }],
  };
  const shapeKit = () => run(gm, P.shape, { fid: formations.kit.fid, members: [kit.a.id, kit.b.id], owned: [kit.a.id], seatId, mode: "delve", kit: kitState });
  const kshape = await shapeKit();
  check("K start shape: both members in order, the delve, and a light and a spell on each", same(kshape.order, [kit.a.id, kit.b.id]) && kshape.mode === "delve", kshape);
  rec = await run(gm, P.record, { fid: formations.kit.fid });
  if (rec.lights.length !== 2 || rec.spells.length !== 2) blocked(`the Kit's start shape did not land: ${JSON.stringify(rec)}`);
  await run(player, P.open, { partyId: kit.party.id, tab: "kit" });
  let k = await run(player, P.kitRead, { partyId: kit.party.id });
  note("kit", k);
  check("K1 A's light draws Remove and B's does not", k.lights.kitlightA?.includes("removeLight") && !k.lights.kitlightB?.includes("removeLight"), k.lights);
  check("K2 A's spell draws minus, plus and Remove and B's draws none", ["spellMinus", "spellPlus", "removeSpell"].every((a) => k.spells.kitspellA?.includes(a)) && !k.spells.kitspellB?.some((a) => ["spellMinus", "spellPlus", "removeSpell"].includes(a)), k.spells);
  check("K3 the add-spell row is drawn, its casters offer A and not B, its picker A's known spell and not B's", k.addRow && k.casters.some((c) => c.id === kit.a.id) && !k.casters.some((c) => c.id === kit.b.id) && k.picks.some((p) => p.includes("QA Kit Known A")) && !k.picks.some((p) => p.includes("QA Kit Known B")), { casters: k.casters, picks: k.picks });
  check("K4 the maps section draws no New map, Archive, Close or Save fog control", k.kit && k.maps.length === 0, k.maps);

  const kitName = (await run(gm, P.record, { fid: formations.kit.fid })).name;
  const kitLine = async (since, said, named) => spoken(await cardsSince(since), kitName, said).filter((c) => c.text.includes(named)).length;
  const press = async (selector) => run(player, P.click, { partyId: kit.party.id, selector, settle: 2200 });
  const adjust = await L("ACKS-FORMATION.request.spellAdjust", { spell: "QA Kit Spell A" });
  t = await run(gm, P.nowMs);
  await press('[data-spell-id="kitspellA"] [data-action="spellMinus"]');
  rec = await run(gm, P.record, { fid: formations.kit.fid });
  const minus = rec.spells.find((s) => s.id === "kitspellA")?.remaining;
  await press('[data-spell-id="kitspellA"] [data-action="spellPlus"]');
  rec = await run(gm, P.record, { fid: formations.kit.fid });
  const plus = rec.spells.find((s) => s.id === "kitspellA")?.remaining;
  check("K5 the spell's minus then plus land on the record (one turn fewer, then back) with one public line each", minus === 4 && plus === 5 && (await cardsSince(t)).filter((c) => c.alias === kitName && c.text.includes(adjust)).length === 2, { minus, plus });
  t = await run(gm, P.nowMs);
  await press('[data-spell-id="kitspellA"] [data-action="removeSpell"]');
  rec = await run(gm, P.record, { fid: formations.kit.fid });
  check("K5 the spell's Remove stops tracking it, with one line", !rec.spells.some((s) => s.id === "kitspellA") && rec.spells.some((s) => s.id === "kitspellB") && (await kitLine(t, await L("ACKS-FORMATION.request.spellRemove", { spell: "QA Kit Spell A" }), "QA Kit Spell A")) === 1, rec.spells);
  t = await run(gm, P.nowMs);
  await press('[data-light-id="kitlightA"] [data-action="removeLight"]');
  rec = await run(gm, P.record, { fid: formations.kit.fid });
  check("K5 the light's Remove puts it out, with one line naming its bearer", !rec.lights.some((l) => l.id === "kitlightA") && rec.lights.some((l) => l.id === "kitlightB") && (await cardsSince(t)).filter((c) => c.alias === kitName && c.text.includes("QA Kit Seat A")).length === 1, rec.lights);
  t = await run(gm, P.nowMs);
  await run(player, P.kitAdd, { partyId: kit.party.id, name: "QA Kit Typed", turns: 3, casterId: kit.a.id });
  rec = await run(gm, P.record, { fid: formations.kit.fid });
  const typed = rec.spells.find((s) => s.name === "QA Kit Typed");
  check("K6 a typed name with turns is tracked under A", typed?.casterId === kit.a.id && typed?.remaining === 3 && (await cardsSince(t)).filter((c) => c.alias === kitName && c.text.includes("QA Kit Typed")).length === 1, typed);
  const refusedText = await L("ACKS-FORMATION.request.refused");
  const beforeK7 = await run(gm, P.record, { fid: formations.kit.fid });
  t = await run(gm, P.nowMs);
  for (const [name, args] of [["spellAdjust", { spellId: "kitspellB", delta: 1 }], ["spellRemove", { spellId: "kitspellB" }], ["lightRemove", { lightId: "kitlightB" }]]) {
    const crafted = await run(player, P.ask, { fid: formations.kit.fid, press: name, args });
    check(`K7 a crafted ${name} on B's own is refused notOwner and the seat is warned in the refusal's words`, crafted.answer?.refused === "notOwner" && crafted.notes.some((n) => n.level === "warn" && n.text === refusedText), { answer: crafted.answer, notes: crafted.notes });
  }
  const afterK7 = await run(gm, P.record, { fid: formations.kit.fid });
  check("K7 the record is unchanged and nothing is posted", same(beforeK7.spells, afterK7.spells) && same(beforeK7.lights, afterK7.lights) && (await cardsSince(t, (c) => c.alias === kitName)).length === 0, { spells: afterK7.spells.length, lights: afterK7.lights.length });
  await run(player, P.close, { partyId: kit.party.id });

  /* ------------------------------- shots ------------------------------- */
  if (SHOTS) {
    section("plates, from the Player seat");
    const dir = shotDir();
    const plate = async (slug, id, selector) => {
      try {
        await player.compose(id);
        const sel = `[id="${id}"] ${selector}`.trim();
        await run(player, P.settle, { selector: sel });
        const out = await player.shot(`${dir}/${slug}.png`, sel);
        note(`shot ${slug}`, { bytes: out.bytes, clip: out.clip });
      } catch (err) {
        note(`shot ${slug} FAILED`, err?.message ?? String(err));
      }
    };
    const sheetShot = async (slug, party, tab, selector) => {
      const o = await run(player, P.open, { partyId: party, tab });
      await plate(slug, o.id, selector);
      await run(player, P.close, { partyId: party });
    };
    await shapeDelve();
    await sheetShot("formation-seat-head-dungeon", delve.party.id, "mode", '.acks-extras-party-sheet__panel[data-tab="mode"] .acks-extras-party-sheet__head');
    await run(gm, P.shape, { fid: formations.city.fid, members: [city.member.id], owned: [city.member.id], seatId, mode: "settlement", sceneId: city.scene.id, tokenAt: { x: 200, y: 200 } });
    await sheetShot("formation-seat-head-city", city.party.id, "mode", '.acks-extras-party-sheet__panel[data-tab="mode"] .acks-extras-party-sheet__head');
    for (const shown of ["believed", "unknown"]) {
      await jshape(shown);
      await sheetShot(`formation-seat-head-wilderness-${shown === "believed" ? "hex" : "unknown"}`, journey.party.id, "mode", '.acks-extras-party-sheet__panel[data-tab="mode"] .acks-extras-party-sheet__head');
    }
    // The board's states: A owned, B closed, C none; "seen" is the name-only state between.
    for (const [slug, key] of [["owned", "owned"], ["seen", "seen"], ["closed", "closed"], ["none", null]]) {
      await run(gm, P.link, { regionUuid, placeUuid: key ? places[key] : null });
      const rr = await run(player, P.regionRow, { regionUuid });
      await plate(`formation-seat-place-row-${slug}`, rr.id, ".acks-extras-region-place");
    }
    await run(player, P.closeRegion, { regionUuid });
    await shapeKit();
    await sheetShot("formation-seat-kit", kit.party.id, "kit", '.acks-extras-party-sheet__panel[data-tab="kit"]');
  } else {
    note("plates", "not taken: set SHOTS=1");
  }

  section("what the table saw");
  await sleep(600);
  for (const card of await run(gm, P.cards, { since })) {
    if (SWEEPABLE.test(card.text) || SWEEPABLE.test(card.alias)) cardIds.push(gm.track(card.id, "ChatMessage"));
  }
  note("cards tracked", cardIds.length);

  section("errors after ready");
  for (const [key, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${key}: nothing thrown over the walk`, !boot?.errors.length, boot?.errors);
  }
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  // Normally put back already after PR3; this is the second chance where a step threw before that finally ran or the restore itself failed.
  try {
    const back = await putGrantBack();
    if (back) {
      note("Create New Actors put back (start, gm seat, player seat; roles)", back);
      check("teardown: Create New Actors is back to its starting value, read on both seats", back.ok, back);
    }
  } catch (err) { console.error("grant restore:", err?.message ?? err); check("teardown: Create New Actors is back to its starting value, read on both seats", false); }
  for (const partyId of held.partyIds) {
    try { if (open.player) await run(open.player, P.close, { partyId }); } catch (_e) { /* closed */ }
    try { if (open.gm) await run(open.gm, P.close, { partyId }); } catch (_e) { /* closed */ }
  }
  // A kept party is left in the delve: a journeying or settled record is billed on every clock advance.
  for (const fid of held.modeParties) {
    try { if (open.gm) await run(open.gm, P.setMode, { fid, mode: "delve" }); } catch (err) { console.error("mode:", err?.message ?? err); }
  }
  try {
    if (open.gm) {
      const only = [...held.places, ...cardIds].filter((u) => open.gm.tracked().some((e) => e.uuid === u));
      if (only.length) note("swept", await open.gm.sweepTracked({ only }));
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed, ${tally.skipped} not walked`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
