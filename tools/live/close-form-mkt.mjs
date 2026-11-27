/**
 * Live closing walk, FORM-MKT: one PASS or FAIL for each control the topic
 * `fix-form-mkt` changed (commits fc76a4f0 and c771ad33), on the GM seat, plus
 * the Player seat for the shop's catalog. Walks docs/formation/TESTING.md ("The
 * turn plan", "Squeeze rows", the party sheet's Order tab, the Trapbreaking
 * dialog) and docs/markets/TESTING.md ("Shop sources"). Every figure typed into
 * a fixture is invented, and nothing printed is a book's word or figure: names
 * and tooltips are compared in the page and come back as booleans.
 *
 * Controls, by the check key CHECKS takes (comma list; absent runs all):
 *   plan     T-0686 a Judge's Trapbreaking lock stays refused where disarmGate
 *            refuses the throw (a disarmed trap; a hasty lock of a member with no
 *            skill) and is written, warned, past a soft refusal (no tools); T-0687
 *            a Trapbreaking choice aimed at a trap thing is labelled by its place.
 *            Pressed on the party sheet's Dungeon tab, Turn plan column.
 *   squeeze  T-0671 a monster with a stated load crosses a squeeze at its own
 *            speeds, not the character calculation run on that load.
 *   carrier  T-0644 a monster Carrier's base load on the Order tab is lib's loadStone.
 *   bash     T-0678 a container bash adds Strength's part to the throw (the
 *            sheet's Bash control, the confirm answered), and adds nothing where
 *            the factor is not imported (a layer staged in the GM page's memory).
 *   hint     the Shop sources window's hint says a Judge's own shelf is unticked
 *            until ticked.
 *   history  T-0571 the trade history's net and row figures print to the copper.
 *   ref      T-0574 a ledger row keeps its resolution id in `ref`; a repeat is
 *            refused on it; no note prints it.
 *   shop     T-0575 a Judge's own library shelf stays out of the shop until
 *            ticked in (a new world setting), and a paid order whose document is
 *            gone is not delivered by name from a shelf left out. The engine's
 *            `orderedSource` stands in for the delivery, which the recipe says a
 *            month's clock keeps out of a live walk.
 *
 * Fixtures, kept and found again by marker (`api.fixture`), each brought to its
 * start shape where its section begins: `formation/close-fm-*` (a scene, a
 * party, a fighter with an invented Trapbreaking figure and no tools, a fallen
 * character, an ox monster with a stated load, a trap, a trapped wall, a place
 * with one hidden trap thing in a Region), `equipment/close-fm-*` (a basher with
 * Dungeonbashing and a locked container), `markets/close-fm-*` (a town with a
 * market, a buyer holding coin, a priced world lamp). The Judge's Item shelf is a
 * compendium: built when none stands, filled with one invented item, and deleted
 * at teardown only when this run built it. Deletes: the run's own chat cards and
 * the one shelf item it deletes to prove a gone document, by tracked uuid.
 *
 * Writes outside the fixture ledger, each put back in the `finally` and
 * reported: the two Shop sources world settings (read first), the die rig, the
 * staged `formation` table layer and the wrapped `rollAbility` of the GM page.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCOPE = "acks-extras";
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const ONLY = (process.env.CHECKS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wants = (key) => !ONLY.length || ONLY.includes(key);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0, unreachable: 0 };
const failed = [];
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else { tally.fail += 1; failed.push(label); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const unreachable = (label, reason) => {
  tally.unreachable += 1;
  console.log(`UNREACHABLE  ${label}  ${reason}`);
};

const NAMES = {
  party: `QA Close Party${TAG}`,
  fighter: `QA Close Fighter${TAG}`,
  fallen: `QA Close Fallen${TAG}`,
  ox: `QA Close Ox${TAG}`,
  basher: `QA Close Basher${TAG}`,
  town: `QA Close Town${TAG}`,
  buyer: `QA Close Buyer${TAG}`,
  lamp: `QA Close Lamp${TAG}`,
  judgeLamp: `QA Close Judge Lamp${TAG}`,
};
/** Invented figures: the fighter's Trapbreaking throw, the ox's speeds, stated capacity and pack weight (sixths of a stone). */
const INVENTED = { trapbreaking: 12, oxBase: 87, oxEncounter: 29, oxCapacity: 14, oxPack6: 36, bashTarget: 40, factor: 3 };

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__cfmBoot = { phase: "load", phases: [], errors: [] });
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
/*  A function closes over nothing but its argument and __cfm.         */
/* ------------------------------------------------------------------ */
const P = {
  census: async () => ({
    userId: game.user.id,
    role: game.user.role,
    users: game.users.filter((u) => u.active).map((u) => [u.name, u.isGM]),
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    boot: globalThis.__cfmBoot ?? null,
  }),

  install: async () => {
    const H = (globalThis.__cfm = globalThis.__cfm ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.base = base;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        let v = null;
        try { v = await fn(); } catch { v = null; }
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.tz = await import(`${base}formation/trap-zone.mjs`);
    H.cap = await import(`${base}lib/capacity.mjs`);
    H.ms = await import(`${base}lib/movement-scales.mjs`);
    H.tables = await import(`${base}lib/tables.mjs`);
    H.fc = await import(`${base}formation/constants.mjs`);
    H.doors = await import(`${base}formation/doors.mjs`);
    H.notes ??= [];
    if (!H.wrapped) {
      H.wrapped = true;
      for (const level of ["info", "warn"]) {
        const fn = ui.notifications[level];
        ui.notifications[level] = function (msg, ...rest) { H.notes.push(String(msg)); return fn.call(this, msg, ...rest); };
      }
    }
    // Every card this seat's own client makes while the walk drives it, so the run can sweep them by id.
    if (!H.chatWrapped) {
      H.chat = [];
      H.chatCreate = ChatMessage.create;
      ChatMessage.create = async function (...args) {
        const made = await H.chatCreate.apply(this, args);
        for (const m of Array.isArray(made) ? made : [made]) if (m?.uuid) H.chat.push(m.uuid);
        return made;
      };
      H.chatWrapped = true;
    }
    // The dice rig reads from the top on core 14: a face sits at (faces - face + 0.5) / faces.
    H.rig = async (face, faces = 20) => {
      if (!H.origUniform) H.origUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => (faces - face + 0.5) / faces;
      const got = (await new Roll(`1d${faces}`).evaluate()).total;
      return got === face;
    };
    H.unrig = () => {
      if (!H.origUniform) return false;
      CONFIG.Dice.randomUniform = H.origUniform;
      H.origUniform = null;
      return true;
    };
    return { ok: typeof H.tz.attemptDisarm === "function" && typeof H.model.carriedLoad === "function" };
  },

  takeChat: async () => {
    const H = globalThis.__cfm;
    const out = [...(H?.chat ?? [])];
    if (H) H.chat = [];
    return out;
  },

  rig: async ({ face }) => ({ ok: await globalThis.__cfm.rig(face) }),
  unrig: async () => ({ wasRigged: globalThis.__cfm.unrig() }),
  boot: async () => globalThis.__cfmBoot ?? null,

  viewScene: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    await scene.view();
    const t0 = performance.now();
    while (!(canvas.ready && canvas.scene?.id === sceneId) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 2500));
    return { viewed: canvas.scene?.id === sceneId };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__cfm;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** Bring the ox to its start shape: its own speeds, stated capacity, one pack of a stated weight, and no other item. */
  shapeOx: async ({ oxId, base, encounter, capacity, packId, pack6 }) => {
    const ox = game.actors.get(oxId);
    await ox.update({ "system.movement.base": base, "system.movement.encounter": encounter, "flags.acks-extras.extras.load.capacity": capacity });
    const extra = ox.items.filter((i) => i.id !== packId).map((i) => i.id);
    if (extra.length) await ox.deleteEmbeddedDocuments("Item", extra);
    await ox.items.get(packId).update({ "system.weight6": pack6 });
    return { items: ox.items.size, hasPack: !!ox.items.get(packId) };
  },

  /** The start shape: the members in the party on the walk's scene, its token there, no plan, crossing, role or fight, the fallen one at 0 hp. */
  shape: async ({ fid, partyId, sceneId, members, fallenId }) => {
    const H = globalThis.__cfm;
    const scene = game.scenes.get(sceneId);
    const party = game.actors.get(partyId);
    for (const c of game.combats.filter((c) => c.combatants.some((x) => x.actorId === partyId))) await c.delete();
    await H.sleep(400);
    for (const key of ["crossing", "turnPlan"]) if (party.getFlag("acks-extras", key)) await party.unsetFlag("acks-extras", key);
    await H.model.patchFormation(fid, (rec) => {
      rec.combat = null;
      rec.clock.paused = false;
      rec.clock.movedThisTurn = false;
      rec.clock.roundsPartial = 0;
      rec.clock.carryFeet = 0;
    });
    const f0 = H.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) await H.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    for (const [n, id] of members.entries()) {
      const f = H.model.getFormation(fid);
      if (f.members.some((m) => m?.actorId === id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: 400 + n * 100, y: 400 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), made, { scene });
    }
    await H.model.patchFormation(fid, (rec) => { for (const m of rec.members) if (m?.roles?.length) m.roles = []; });
    for (const id of members) {
      const a = game.actors.get(id);
      const want = id === fallenId ? 0 : (a.system.hp?.max ?? 8);
      if (a.system.hp?.value !== want) await a.update({ "system.hp.value": want });
    }
    await H.sleep(700);
    const f = H.model.getFormation(fid);
    return {
      members: f.members.filter((m) => m?.actorId).map((m) => m.actorId),
      sceneId: f.sceneId,
      partyToken: !!H.model.getPartyToken(f),
      roles: f.members.filter((m) => m?.roles?.length).length,
      combat: !!f.combat?.active,
    };
  },

  /** The trapped wall moved through the party token's centre, and bound to the trap Item. */
  geometry: async ({ fid, sceneId, wallUuid, trapUuid }) => {
    const H = globalThis.__cfm;
    const scene = game.scenes.get(sceneId);
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    if (!token) return { error: "no party token" };
    const gs = scene.grid.size;
    const cx = Math.round(token.x + (token.width * gs) / 2);
    const cy = Math.round(token.y + (token.height * gs) / 2);
    const wall = fromUuidSync(wallUuid);
    const want = [cx - 150, cy, cx + 150, cy];
    if (wall.c.join() !== want.join()) await wall.update({ c: want });
    if (H.tz.wallPlacement(wall).trapUuid !== trapUuid) await H.tz.wallPlacement(wall).write({ trapUuid });
    return { moved: wall.c.join() === want.join(), bound: H.tz.wallPlacement(wall).trapUuid === trapUuid };
  },

  linkPlace: async ({ regionUuid, placeId }) => {
    const S = globalThis.acksExtras?.location?.scenes;
    if (!S?.linkRegion || !S?.locationOfRegion || !S?.regionOfLocation) return { error: "no location api" };
    const region = fromUuidSync(regionUuid);
    const place = game.actors.get(placeId);
    if (S.locationOfRegion(region)?.uuid !== place.uuid || S.regionOfLocation(place)?.uuid !== region.uuid) await S.linkRegion(region, place);
    return { linked: S.locationOfRegion(region)?.uuid === place.uuid, mirror: S.regionOfLocation(place)?.uuid === region.uuid };
  },

  shapeThing: async ({ placeId, trapUuid }) => {
    const place = game.actors.get(placeId);
    const things = [{ id: "thing-1", kind: "trap", ref: trapUuid, hidden: true, hint: null, point: null, params: {}, layers: {}, state: { state: "armed", repeatLock: {}, searchLock: {} } }];
    await place.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { held: (place.getFlag("acks-extras", "things") ?? []).length };
  },

  /** What is within the party's reach, by uuid. */
  reach: async ({ fid, uuids }) => {
    const H = globalThis.__cfm;
    const f = H.model.getFormation(fid);
    return Object.fromEntries(uuids.map((u) => [u, !!H.tz.placementNearByUuid(f, u)]));
  },

  /** The fighter shaped: its own figure, no tools. */
  shapeFighter: async ({ actorId, figure }) => {
    const H = globalThis.__cfm;
    const a = game.actors.get(actorId);
    if (a.system.adventuring?.trapbreaking !== figure) await a.update({ "system.adventuring.trapbreaking": figure });
    const tools = a.items.filter((i) => H.tz.TOOLS_ITEM_PATTERN.test(i.name ?? ""));
    if (tools.length) await a.deleteEmbeddedDocuments("Item", tools.map((i) => i.id));
    return { figure: a.system.adventuring?.trapbreaking === figure, tools: a.items.filter((i) => H.tz.TOOLS_ITEM_PATTERN.test(i.name ?? "")).length };
  },

  /** A trap brought to a state by the module's own writers. */
  setTrap: async ({ sceneId, uuid, to }) => {
    const H = globalThis.__cfm;
    const where = () => H.tz.allPlacements(game.scenes.get(sceneId)).find((p) => p.uuid === uuid) ?? null;
    const p = where();
    if (!p) return { error: "no placement" };
    if (to === "unfound") await H.tz.resetTrap(p);
    else if (to === "found") { await H.tz.resetTrap(p); await H.tz.markTrapFound(where()); }
    else if (to === "disarmed") await p.write({ state: "disarmed", known: true });
    const now = where();
    return { state: now?.state ?? null, known: now?.known ?? null };
  },

  /** Open the party sheet on a tab and wait for the Turn plan rows when asked. */
  openParty: async ({ partyId, tab, rows = 0 }) => {
    const H = globalThis.__cfm;
    const sheet = game.actors.get(partyId).sheet;
    if (!sheet.rendered) await sheet.render(true);
    await H.sleep(400);
    H.root(sheet)?.querySelector(`[data-action="tab"][data-tab="${tab}"]`)?.click();
    await H.sleep(300);
    if (rows) await H.poll(() => (H.root(sheet)?.querySelectorAll("[data-plan-actor]").length ?? 0) >= rows, { tries: 60, every: 200 });
    return { rendered: !!sheet.rendered, rows: H.root(sheet)?.querySelectorAll("[data-plan-actor]").length ?? 0 };
  },

  /** A member's Turn plan row: its choices, and the stored entry. */
  planRead: async ({ partyId, actorId }) => {
    const H = globalThis.__cfm;
    const sheet = game.actors.get(partyId).sheet;
    const row = H.root(sheet)?.querySelector(`[data-plan-actor="${actorId}"]`);
    const entry = game.actors.get(partyId).getFlag("acks-extras", "turnPlan")?.[actorId] ?? null;
    return {
      hasRow: !!row,
      options: [...(row?.querySelectorAll("select[data-pick] option") ?? [])].map((o) => ({ value: o.value, text: H.text(o), disabled: o.disabled })),
      entry: entry ? { key: entry.key, option: entry.option ?? null } : null,
      noteKind: sheet.planNotes?.get(actorId)?.kind ?? null,
      rowNote: H.text(row?.querySelector(".acks-extras-turn-plan-block, .acks-extras-turn-plan-note")),
    };
  },

  /** Pick a choice in a member's row and press Lock, as a hand does. */
  planLock: async ({ partyId, actorId, value }) => {
    const H = globalThis.__cfm;
    const sheet = game.actors.get(partyId).sheet;
    const row = H.root(sheet)?.querySelector(`[data-plan-actor="${actorId}"]`);
    const select = row?.querySelector("select[data-pick]");
    if (!select || ![...select.options].some((o) => o.value === value)) return { pressed: false, hasOption: false };
    select.value = value;
    row.querySelector('[data-action="planLock"]').click();
    await H.sleep(1400);
    const entry = game.actors.get(partyId).getFlag("acks-extras", "turnPlan")?.[actorId] ?? null;
    return { pressed: true, hasOption: true, entry: entry ? { key: entry.key, option: entry.option ?? null } : null, noteKind: sheet.planNotes?.get(actorId)?.kind ?? null };
  },

  /** Keep watch: the row's own press clears the entry. */
  planUnlock: async ({ partyId, actorId }) => {
    const H = globalThis.__cfm;
    const sheet = game.actors.get(partyId).sheet;
    H.root(sheet)?.querySelector(`[data-plan-actor="${actorId}"] [data-action="planUnlock"]`)?.click();
    await H.sleep(1200);
    const party = game.actors.get(partyId);
    if (party.getFlag("acks-extras", "turnPlan")?.[actorId]) await party.unsetFlag("acks-extras", "turnPlan");
    return { cleared: !party.getFlag("acks-extras", "turnPlan")?.[actorId] };
  },

  /** The labels T-0687 compares an option against, built from the lang keys with the place's own name. */
  labels: async ({ place, wallValue, thingValue, partyId, actorId }) => {
    const H = globalThis.__cfm;
    const row = H.root(game.actors.get(partyId).sheet)?.querySelector(`[data-plan-actor="${actorId}"]`);
    const text = (v) => H.text([...(row?.querySelectorAll("select[data-pick] option") ?? [])].find((o) => o.value === v));
    const thing = text(thingValue);
    const wall = text(wallValue);
    const asThing = game.i18n.format("ACKS-FORMATION.traps.targetThing", { place });
    const asZone = game.i18n.localize("ACKS-FORMATION.traps.targetZone");
    const asWall = game.i18n.localize("ACKS-FORMATION.traps.targetWall");
    return {
      thingListed: !!thing,
      thingByPlace: !!thing && thing.includes(`(${asThing})`),
      thingNotZone: !!thing && !thing.includes(`(${asZone})`),
      wallListed: !!wall,
      wallByKind: !!wall && wall.includes(`(${asWall})`),
    };
  },

  /** The ox's figures: what the row carries against what the character calculation would give on its load. */
  oxFigures: async ({ oxId }) => {
    const H = globalThis.__cfm;
    const ox = game.actors.get(oxId);
    const own = ox.system.movementacks ?? {};
    const moves = H.ms.ownSpeeds(ox);
    const stone = H.cap.loadStone(ox);
    const max = H.cap.capacityStone(ox);
    const bearing = stone == null || max == null ? null : H.cap.movementBearing({ stone, max, mod: ox.system.movement?.mod });
    const expected = Number.isFinite(own.combat) ? own.combat : moves.combat;
    return { expected, bearing: bearing?.combat ?? null, differs: bearing?.combat != null && bearing.combat !== expected, stone, max, ownFinite: Number.isFinite(own.combat), expectedFinite: Number.isFinite(expected) && expected > 0 };
  },

  /** Begin a squeeze through the begin row's pick and button; set its shape and length like a user. */
  squeezeBegin: async ({ partyId, length }) => {
    const H = globalThis.__cfm;
    const party = game.actors.get(partyId);
    const sheet = party.sheet;
    const root = () => H.root(sheet);
    const pick = root()?.querySelector('[data-pick="crossing-kind"]');
    if (!pick) return { began: false, why: "no begin row" };
    pick.value = "squeeze";
    root().querySelector('[data-action="crossingBegin"]').click();
    const began = await H.poll(() => party.getFlag("acks-extras", "crossing")?.kind === "squeeze", { tries: 50, every: 200 });
    if (!began) return { began: false, why: "kind never stored" };
    await H.poll(() => root()?.querySelector('input[name="crossing.shape"]'), { tries: 50, every: 200 });
    const fire = (el) => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    const radio = root().querySelector('input[name="crossing.shape"][value="squeeze"]');
    if (radio) { radio.checked = true; fire(radio); }
    await H.poll(() => party.getFlag("acks-extras", "crossing")?.shape === "squeeze", { tries: 40, every: 200 });
    await H.sleep(600);
    const len = root().querySelector('input[name="crossing.length"]');
    if (len) { len.value = String(length); fire(len); }
    await H.poll(() => Number(party.getFlag("acks-extras", "crossing")?.length) === length, { tries: 40, every: 200 });
    await H.sleep(800);
    const c = party.getFlag("acks-extras", "crossing") ?? {};
    return { began: true, shape: c.shape ?? null, length: Number(c.length) };
  },

  /** Press the member's Throw with a rigged pass and read the record it leaves. */
  squeezeThrow: async ({ partyId, actorId }) => {
    const H = globalThis.__cfm;
    const party = game.actors.get(partyId);
    const root = () => H.root(party.sheet);
    const li = await H.poll(() => root()?.querySelector(`li.acks-extras-crossing-row[data-press-home="${actorId}"]`), { tries: 50, every: 200 });
    if (!li) return { row: false };
    const target = H.text(li.querySelector(".acks-extras-crossing-figure"));
    const button = li.querySelector('[data-action="crossingThrow"]');
    if (!button) return { row: true, button: false, targetShown: !!target };
    const rigged = await H.rig(20);
    button.click();
    const done = await H.poll(() => Number(party.getFlag("acks-extras", "crossing")?.members?.[actorId]?.covered) > 0 || party.getFlag("acks-extras", "crossing")?.members?.[actorId]?.last, { tries: 60, every: 200 });
    await H.sleep(700);
    H.unrig();
    const rec = party.getFlag("acks-extras", "crossing")?.members?.[actorId] ?? null;
    const now = root()?.querySelector(`li.acks-extras-crossing-row[data-press-home="${actorId}"]`);
    return { row: true, button: true, targetShown: !!target, rigged, done: !!done, covered: Number(rec?.covered ?? NaN), state: rec?.state ?? null, coveredShown: !!H.text(now?.querySelector(".acks-extras-crossing-covered")) };
  },

  squeezeEnd: async ({ partyId }) => {
    const H = globalThis.__cfm;
    const party = game.actors.get(partyId);
    H.root(party.sheet)?.querySelector('[data-action="crossingEnd"]')?.click();
    await H.poll(() => !party.getFlag("acks-extras", "crossing"), { tries: 40, every: 200 });
    if (party.getFlag("acks-extras", "crossing")) await party.unsetFlag("acks-extras", "crossing");
    return { ended: !party.getFlag("acks-extras", "crossing") };
  },

  /** Make the ox the Carrier through its row's chip on the Order tab and read the row's load as the sheet prints it. */
  carrier: async ({ partyId, fid, oxId }) => {
    const H = globalThis.__cfm;
    const sheet = game.actors.get(partyId).sheet;
    const li = () => H.root(sheet)?.querySelector(`li.member[data-actor-id="${oxId}"]`);
    await H.poll(() => li(), { tries: 50, every: 200 });
    const chip = li()?.querySelector('[data-action="toggleRole"][data-role="carrier"]');
    if (!chip) return { chip: false };
    const isCarrier = () => H.model.getFormation(fid).members.find((m) => m?.actorId === oxId)?.roles?.includes("carrier");
    if (!isCarrier()) chip.click();
    const set = await H.poll(() => isCarrier(), { tries: 40, every: 200 });
    await H.sleep(900);
    const details = H.text(li()?.querySelector(".details"));
    const m = /([\d.]+|—)\s*→\s*([\d.]+|—)\s*\//.exec(details);
    const ox = game.actors.get(oxId);
    const load = H.model.carriedLoad(H.model.getFormation(fid));
    const carrier = load.carriers.find((c) => c.actor?.id === oxId) ?? null;
    const stone = H.cap.loadStone(ox);
    const read = Math.round(stone * 10) / 10;
    return {
      chip: true,
      carrierSet: !!set,
      casualties: load.down.length,
      shown: !!m,
      shownBase: m?.[1] ?? null,
      shownEff: m?.[2] ?? null,
      libBase: read,
      libPositive: stone > 0,
      baseIsLoadStone: !!m && Number(m[1]) === read,
      modelBase: carrier?.baseEnc ?? null,
      modelMatches: carrier?.baseEnc === read,
      effShown: !!carrier && Number(m?.[2]) === carrier.effEnc,
      coreFigureDiffers: !(Number(ox.system.encumbrance?.value) === read),
    };
  },

  /** Take the Carrier role off again so a later section's start shape holds. */
  carrierOff: async ({ fid }) => {
    const H = globalThis.__cfm;
    await H.model.patchFormation(fid, (rec) => { for (const m of rec.members) if (m?.roles?.length) m.roles = []; });
    return true;
  },

  /** Bring the basher to its start shape: Strength, one Dungeonbashing throw, one locked container, and nothing else. */
  shapeBasher: async ({ actorId, target, str }) => {
    const H = globalThis.__cfm;
    const a = game.actors.get(actorId);
    if (a.system.scores?.str?.value !== str) await a.update({ "system.scores.str.value": str });
    const keep = a.items.filter((i) => ["Dungeonbashing", "QA Strongbox"].includes(i.name)).map((i) => i.id);
    const extra = a.items.filter((i) => !keep.includes(i.id)).map((i) => i.id);
    if (extra.length) await a.deleteEmbeddedDocuments("Item", extra);
    if (!a.items.some((i) => i.name === "Dungeonbashing")) {
      await a.createEmbeddedDocuments("Item", [{
        name: "Dungeonbashing", type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 0 },
        flags: { "acks-extras": { extras: { rolls: [{ key: "primary", label: "Bash", rollType: "above", scale: "level", target: { kind: "flat", flat: target } }] } } },
      }]);
    }
    const box = a.items.find((i) => i.name === "QA Strongbox");
    if (!box) await a.createEmbeddedDocuments("Item", [{ name: "QA Strongbox", type: "item", system: { cost: 1, weight6: 1 }, flags: { "acks-extras": { container: { locked: true, opened: false } } } }]);
    else await box.update({ "flags.acks-extras.container": { locked: true, opened: false } });
    return { mod: Number(a.system.scores?.str?.mod ?? 0), items: a.items.size, locked: a.items.find((i) => i.name === "QA Strongbox")?.getFlag("acks-extras", "container")?.locked === true };
  },

  /** Stage the formation table's factor in this page's memory, above every layer the world holds; `null` hides the import. */
  stageFactor: async ({ value, priority }) => {
    const H = globalThis.__cfm;
    H.tables.registerTable({ id: H.fc.FORMATION_DOC, tables: { bashStrengthFactor: value } }, { priority, source: "close-fm" });
    return { reads: H.fc.formationValue("bashStrengthFactor") };
  },
  unstageFactor: async ({ priority }) => {
    const H = globalThis.__cfm;
    return { removed: H.tables.unregisterTable(H.fc.FORMATION_DOC, { priority }), reads: H.fc.formationValue("bashStrengthFactor") };
  },
  setClass: async ({ townId }) => {
    await game.actors.get(townId).update({ "system.market.marketClassOverride": 3 });
    return { class: game.actors.get(townId).system.marketClass, grid: !!globalThis.__cfm.m.TR.bandGridFor(false) };
  },
  /** Stage an invented availability grid (one band, ten of everything in every class) and rules figure in this page's memory, and the town's class. */
  stageGrid: async ({ priority, townId }) => {
    const H = globalThis.__cfm;
    const before = { grid: !!H.m.TR.bandGridFor(false), class: game.actors.get(townId).system.marketClass };
    H.tables.registerTable({ id: "availability", tables: {
      equipmentAvailability: { rows: [{ band: "all", minCost: 0, maxCost: null, byMarketClass: ["10", "10", "10", "10", "10", "10"] }] },
      marketRulesProse: { marketTotalMultiplier: 6 },
    } }, { priority, source: "close-fm" });
    await game.actors.get(townId).update({ "system.market.marketClassOverride": 3 });
    return { before, after: { grid: !!H.m.TR.bandGridFor(false), class: game.actors.get(townId).system.marketClass } };
  },
  unstageGrid: async ({ priority }) => {
    const H = globalThis.__cfm;
    return { removed: H.tables.unregisterTable("availability", { priority }), grid: !!H.m.TR.bandGridFor(false) };
  },

  /** The imported factor as the world holds it, before any layer is staged. */
  factorNow: async () => ({ reads: globalThis.__cfm.fc.formationValue("bashStrengthFactor") }),

  /** Strength's part as the module itself reads it for this actor. */
  strPart: async ({ actorId }) => {
    const part = globalThis.__cfm.doors.bashStrPart(game.actors.get(actorId));
    return { value: part?.value ?? null, missing: part?.missing ?? null };
  },

  /** Press the sheet's Bash on the locked container, answer the confirm, and read what the throw was given. */
  bash: async ({ actorId, apiMode }) => {
    const H = globalThis.__cfm;
    const actor = game.actors.get(actorId);
    const abilities = globalThis.acksExtras?.abilities;
    if (!abilities?.rollAbility) return { wrapped: false };
    H.rollLog = [];
    H.origRoll ??= abilities.rollAbility;
    try {
      abilities.rollAbility = async function (item, key, opts) {
        const r = await H.origRoll.call(this, item, key, opts);
        H.rollLog.push({ name: item.name, bonus: opts?.bonus ?? null, skip: !!opts?.skipDialog, total: r?.total ?? null, success: r?.success ?? null });
        return r;
      };
    } catch (err) { return { wrapped: false, why: String(err?.message ?? err) }; }
    await H.rig(10);
    let gesture = false;
    let diag = null;
    try {
      const sheet = actor.sheet;
      if (!sheet.rendered) await sheet.render(true);
      await H.sleep(500);
      for (const sel of ['[data-action="tab"][data-tab="equipment"]', '[data-tab="equipment"]']) {
        const tab = H.root(sheet)?.querySelector(sel);
        if (tab) { tab.click(); break; }
      }
      await H.sleep(500);
      const button = await H.poll(() => H.root(sheet)?.querySelector('[data-action="containerBash"]'), { tries: 20, every: 200 });
      if (!button) diag = { sheet: sheet.constructor.name, tabs: [...(H.root(sheet)?.querySelectorAll("[data-tab]") ?? [])].map((e) => e.dataset.tab).slice(0, 12), actions: [...new Set([...(H.root(sheet)?.querySelectorAll('[data-action^="container"]') ?? [])].map((e) => e.dataset.action))] };
      if (button) {
        gesture = true;
        button.click();
        const yes = await H.poll(() => [...document.querySelectorAll(".application")].map((d) => d.querySelector('button[data-action="yes"]')).find(Boolean), { tries: 40, every: 150 });
        if (yes) yes.click();
        else gesture = false;
        await H.poll(() => H.rollLog.length > 0, { tries: 60, every: 200 });
      }
      if (!H.rollLog.length && apiMode) {
        const eq = await import(`${H.base}equipment/locks.mjs`);
        await eq.bashOpen(actor, actor.items.find((i) => i.name === "QA Strongbox"));
      }
      await H.sleep(500);
    } finally {
      H.unrig();
      abilities.rollAbility = H.origRoll;
    }
    const log = [...H.rollLog];
    return { wrapped: true, gesture, diag, rolls: log.length, roll: log[0] ?? null, boxStands: !!actor.items.find((i) => i.name === "QA Strongbox") };
  },

  closeSheet: async ({ id, kind }) => {
    const doc = kind === "Item" ? game.items.get(id) : game.actors.get(id);
    if (doc?.sheet?.rendered) await doc.sheet.close({ animate: false });
    return true;
  },

  /* ------------------------------ markets ------------------------------ */

  marketImports: async () => {
    const H = globalThis.__cfm;
    const base = H.base;
    H.m = {
      TR: await import(`${base}markets/engine/trade.mjs`),
      CS: await import(`${base}markets/engine/catalog-sources.mjs`),
      RS: await import(`${base}markets/rules/sources.mjs`),
      LD: await import(`${base}location/data/location-data.mjs`),
      MO: await import(`${base}lib/money.mjs`),
      LB: await import(`${base}lib/library.mjs`),
      LT: await import(`${base}lib/library-target.mjs`),
    };
    return { ok: true };
  },

  /** The town given a fresh market, the buyer cleared and funded, the lamp priced; the log emptied. */
  marketShape: async ({ townId, buyerId, mint }) => {
    const H = globalThis.__cfm;
    const town = game.actors.get(townId);
    await town.update({ "system.market": H.m.LD.emptyMarket() });
    await town.update({ "system.market.marketLog": [] });
    const buyer = game.actors.get(buyerId);
    const gone = buyer.items.map((i) => i.id);
    if (gone.length) await buyer.deleteEmbeddedDocuments("Item", gone);
    await H.m.MO.mintCoin(buyer, mint);
    return { hasMarket: !!town.system.hasMarket, gp: H.m.MO.spendableGp(buyer) };
  },

  /** Write the town's ledger as these rows (invented, with figures a float sum drifts on). */
  writeLog: async ({ townId, rows }) => {
    const town = game.actors.get(townId);
    await town.update({ "system.market.marketLog": rows });
    return { rows: town.system.market.marketLog.length };
  },

  /** Open the town's sheet on its Trade tab and read the history as the sheet prints it. */
  historyRead: async ({ townId }) => {
    const H = globalThis.__cfm;
    const sheet = game.actors.get(townId).sheet;
    if (!sheet.rendered) await sheet.render(true);
    else await sheet.render(true);
    await H.sleep(700);
    H.root(sheet)?.querySelector('nav.tabs a[data-tab="trade"]')?.click();
    const details = await H.poll(() => H.root(sheet)?.querySelector("details.acks-extras-markets-history"), { tries: 50, every: 200 });
    if (!details) return { found: false };
    const rows = [...details.querySelectorAll("tbody tr")].map((tr) => H.text([...tr.querySelectorAll("td")].at(-1)));
    const full = H.text(details);
    return { found: true, net: H.text(details.querySelector("summary .acks-nums")), rows, text: full.length };
  },

  /** The history text carries none of these ids. */
  historyHas: async ({ townId, ids }) => {
    const H = globalThis.__cfm;
    const details = H.root(game.actors.get(townId).sheet)?.querySelector("details.acks-extras-markets-history");
    const text = H.text(details);
    return ids.map((id) => text.includes(id));
  },

  /** A purchase through the engine, naming the world lamp by its uuid, with this resolution id. */
  buy: async ({ townId, buyerId, sourceUuid, name, rid }) => {
    const H = globalThis.__cfm;
    const town = game.actors.get(townId);
    const buyer = game.actors.get(buyerId);
    const before = { gp: H.m.MO.spendableGp(buyer), items: buyer.items.size, log: town.system.market.marketLog.length };
    const r = await H.m.TR.performPurchase(town, { buyerUuid: buyer.uuid, itemName: name, sourceUuid, qty: 1, resolutionId: rid });
    return { ok: !!r?.ok, error: r?.error ?? null, spent: before.gp !== H.m.MO.spendableGp(buyer), itemGained: buyer.items.size > before.items, logGrew: town.system.market.marketLog.length > before.log };
  },

  /** The ledger's rows carrying a resolution id: where it sits, and whether any note prints it. */
  refs: async ({ townId, ids }) => {
    const rows = game.actors.get(townId).system.market.marketLog.map((r) => ({ type: r.type, ref: r.ref ?? null, note: String(r.note ?? "") }));
    return Object.fromEntries(ids.map((id) => [id, {
      inRef: rows.filter((r) => r.ref === id).length,
      inNote: rows.filter((r) => r.note.includes(id)).length,
      types: rows.filter((r) => r.ref === id).map((r) => r.type),
    }]));
  },

  /** A row shaped to carry the id in its note alone, as the rows of an earlier shape did. */
  noteOnlyRow: async ({ townId, rid, buyerUuid }) => {
    const town = game.actors.get(townId);
    const rows = town.system.market.marketLog.map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));
    rows.push({ time: Date.now(), type: "purchase", note: `QA shaped row [${rid}]`, ref: "", actorUuid: buyerUuid, gp: 0 });
    await town.update({ "system.market.marketLog": rows });
    return { rows: rows.length };
  },

  worldLamp: async ({ itemId }) => {
    const item = game.items.get(itemId);
    await item.update({ "system.cost": 3, "system.weight6": 1, ownership: { default: 2 } });
    return { uuid: item.uuid, cost: item.system.cost };
  },

  /** The Shop sources settings, read first and kept for the restore. */
  settingsBefore: async () => {
    const H = globalThis.__cfm;
    H.shopBefore ??= {
      excluded: foundry.utils.deepClone(game.settings.get("acks-extras", "marketsCatalogExcluded")),
      judge: foundry.utils.deepClone(game.settings.get("acks-extras", "marketsCatalogJudgeIncluded")),
    };
    const reg = game.settings.settings.get("acks-extras.marketsCatalogJudgeIncluded");
    return { excluded: H.shopBefore.excluded.length, judge: H.shopBefore.judge.length, registered: !!reg, world: reg?.scope === "world", hidden: reg?.config === false, defaultEmpty: Array.isArray(reg?.default) && reg.default.length === 0 };
  },
  settingsRestore: async () => {
    const H = globalThis.__cfm;
    if (!H?.shopBefore) return { restored: false };
    await game.settings.set("acks-extras", "marketsCatalogExcluded", H.shopBefore.excluded);
    await game.settings.set("acks-extras", "marketsCatalogJudgeIncluded", H.shopBefore.judge);
    const now = { excluded: game.settings.get("acks-extras", "marketsCatalogExcluded"), judge: game.settings.get("acks-extras", "marketsCatalogJudgeIncluded") };
    return { restored: JSON.stringify(now.excluded) === JSON.stringify(H.shopBefore.excluded) && JSON.stringify(now.judge) === JSON.stringify(H.shopBefore.judge) };
  },
  /** The Judge list written empty: where each shelf starts. */
  judgeEmpty: async () => {
    await game.settings.set("acks-extras", "marketsCatalogJudgeIncluded", []);
    return { judge: game.settings.get("acks-extras", "marketsCatalogJudgeIncluded").length, excluded: game.settings.get("acks-extras", "marketsCatalogExcluded").length };
  },

  /** The Judge's Item shelf under this run's line: found, or built, with its one invented item. */
  shelf: async ({ line, name, cost }) => {
    const H = globalThis.__cfm;
    const { LB, LT } = H.m;
    const judge = LB.judgeLine(line);
    let pack = LB.findLibraryPack("Item", judge);
    let builtPack = false;
    if (!pack) { pack = await LT.ensureLibraryPack("Item", judge); builtPack = true; }
    if (!pack) return { error: "the shelf could not be made" };
    const index = await pack.getIndex({ fields: ["name"] });
    let entry = [...index].find((e) => e.name === name) ?? null;
    let builtItem = false;
    if (!entry) {
      entry = await Item.create({ name, type: "item", system: { cost, weight6: 1 } }, { pack: pack.collection });
      builtItem = true;
    }
    return { collection: pack.collection, builtPack, builtItem, isJudge: LB.isJudgeLine(LB.lineOfPack(pack.collection)), itemUuid: entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id ?? entry.id}` };
  },
  /** A second copy of the shelf's item, for the check of a document that is gone. */
  shelfCopy: async ({ collection, name, cost }) => {
    const pack = game.packs.get(collection);
    const doc = await Item.create({ name, type: "item", system: { cost, weight6: 1 } }, { pack: collection });
    return { uuid: doc.uuid, inPack: !!pack };
  },
  shelfDelete: async ({ collection }) => {
    const pack = game.packs.get(collection);
    if (!pack) return { deleted: false, why: "not found" };
    await pack.deleteCompendium();
    return { deleted: !game.packs.get(collection) };
  },

  /** The town's catalog as this seat builds it, with the rows each source lists and the named rows. */
  catalog: async ({ townId, collection, names }) => {
    const H = globalThis.__cfm;
    const rows = await H.m.TR.buildCatalog(game.actors.get(townId));
    const bySource = (r) => H.m.RS.sourceOfUuid(r.sourceUuid);
    return {
      total: rows.length,
      fromShelf: rows.filter((r) => !r.held && bySource(r) === collection).length,
      named: Object.fromEntries(names.map((n) => [n, rows.some((r) => r.name === n)])),
      namedFromShelf: Object.fromEntries(names.map((n) => [n, rows.some((r) => r.name === n && bySource(r) === collection)])),
      excludedHasShelf: H.m.CS.excludedSources().includes(collection),
    };
  },

  /** `orderedSource` for a paid order whose document is gone: delivered by name, or not. */
  ordered: async ({ uuid, name, collection }) => {
    const H = globalThis.__cfm;
    const r = await H.m.CS.orderedSource({ sourceUuid: uuid, itemName: name });
    return { found: !!r, fromShelf: !!r && H.m.RS.sourceOfUuid(r.uuid) === collection, gone: !(await fromUuid(uuid).catch(() => null)) };
  },

  /** Open Shop sources as the settings screen does; read the hint and the shelf's row; tick or untick it and Save. */
  sources: async ({ collection, set = null }) => {
    const H = globalThis.__cfm;
    const menu = game.settings.menus.get("acks-extras.marketCatalogMenu");
    if (!menu) return { opened: false, why: "no menu" };
    if (H.srcApp) { try { await H.srcApp.close({ animate: false }); } catch { /* closed */ } }
    const app = (H.srcApp = new menu.type());
    app.render(true);
    const root = await H.poll(() => { const r = H.root(app); return r?.querySelector("input[data-source]") ? r : null; }, { tries: 60, every: 200 });
    if (!root) return { opened: false };
    const hint = H.text(root.querySelector("p.hint"));
    const localized = H.text({ textContent: game.i18n.localize("ACKS-MARKETS.catalog.hint") });
    const input = [...root.querySelectorAll("input[data-source]")].find((el) => el.dataset.source === collection) ?? null;
    const out = {
      opened: true,
      scroll: root.classList.contains("acks-extras-scroll"),
      hintIsLocalized: hint === localized,
      hintSaysJudgeShelf: hint.includes("unticked until you tick it"),
      rowListed: !!input,
      checkedBefore: input ? input.checked : null,
      saved: null,
      closed: null,
    };
    if (set !== null && input) {
      input.checked = !!set;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      root.querySelector('button[type="submit"]').click();
      out.saved = !!(await H.poll(() => game.settings.get("acks-extras", "marketsCatalogJudgeIncluded").includes(collection) === !!set, { tries: 60, every: 200 }));
      out.closed = !!(await H.poll(() => !app.rendered, { tries: 40, every: 150 }));
      await H.sleep(500);
    }
    out.judgeHolds = game.settings.get("acks-extras", "marketsCatalogJudgeIncluded").includes(collection);
    return out;
  },
  sourcesClose: async () => {
    const H = globalThis.__cfm;
    if (H?.srcApp) { try { await H.srcApp.close({ animate: false }); } catch { /* closed */ } H.srcApp = null; }
    return true;
  },
  excludedHolds: async ({ collection }) => game.settings.get("acks-extras", "marketsCatalogExcluded").includes(collection),
};

async function run(api, fn, args = {}, timeout = undefined) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`, timeout);
  return JSON.parse(text);
}

const ready = async (api, label) => {
  for (let n = 0; n < 600; n++) {
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
    const id = ++next + 700000;
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

const character = (name, extra = {}) => ({
  name, type: "character", prototypeToken: { actorLink: true },
  system: { hp: { value: 8, max: 8 }, details: { level: 3 } },
  ...extra,
});

const open = {};
const tracked = [];
const state = { shelf: null, shelfBuiltHere: false, staged: false, gridStaged: false, settingsRead: false, formation: null, markets: null, equipment: null };

/** A section that turns a throw into a FAIL line, so later sections still run. */
async function part(key, title, fn) {
  if (!wants(key)) return;
  section(title);
  try {
    await fn();
  } catch (err) {
    check(`${key}: the section ran to its end`, false, String(err?.message ?? err).slice(0, 300));
    console.error(err?.stack ?? err);
  }
}

async function takeChat(gm) {
  for (const uuid of await run(gm, P.takeChat)) tracked.push(gm.track(uuid, "ChatMessage"));
}

/** Build (or find) the formation fixtures once, and bring the party to a shape. */
async function formationWorld(gm) {
  if (state.formation) return state.formation;
  const FM = "formation/close-fm-";
  const scene = await gm.fixture(`${FM}scene`, "Scene", { name: `QA Close Ground${TAG}`, active: false, navigation: false, width: 2000, height: 1000, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  const viewed = await run(gm, P.viewScene, { sceneId: scene.id });
  check("setup: the GM seat views the walk's scene", viewed.viewed, viewed);
  const party = await gm.fixture(`${FM}party`, "Actor", { name: NAMES.party, type: `${SCOPE}.party` });
  const fighter = await gm.fixture(`${FM}fighter`, "Actor", character(NAMES.fighter, { system: { hp: { value: 8, max: 8 }, details: { level: 3 }, adventuring: { trapbreaking: INVENTED.trapbreaking } } }));
  const fallen = await gm.fixture(`${FM}fallen`, "Actor", character(NAMES.fallen));
  const ox = await gm.fixture(`${FM}ox`, "Actor", {
    name: NAMES.ox, type: "monster", prototypeToken: { actorLink: true },
    system: { hp: { value: 5, max: 5 }, movement: { base: INVENTED.oxBase, encounter: INVENTED.oxEncounter } },
    flags: { [SCOPE]: { extras: { load: { capacity: INVENTED.oxCapacity } } } },
  });
  const pack = await gm.fixture(`${FM}ox-pack`, "Item", { name: "QA Close Ox Pack", type: "item", system: { cost: 1, weight6: INVENTED.oxPack6 } }, { parent: ox.uuid });
  const trap = await gm.fixture(`${FM}trap`, "Item", { name: "QA Close Trap", type: `${SCOPE}.trap`, system: { triggerOn: 0 } });
  const wall = await gm.fixture(`${FM}wall`, "Wall", { c: [300, 450, 700, 450], move: 0, sight: 0, sound: 0, light: 0, flags: { [SCOPE]: { trap: { trapUuid: trap.uuid, state: "armed", repeatLock: {} } } } }, { parent: scene.uuid });
  let thingUuid = null;
  let placeName = null;
  try {
    const place = await gm.fixture(`${FM}place`, "Actor", { name: `QA Close Place${TAG}`, type: `${SCOPE}.location` });
    const region = await gm.fixture(`${FM}region`, "Region", { name: `QA Close Region${TAG}`, color: "#3366aa", shapes: [{ type: "rectangle", x: 0, y: 0, width: 2000, height: 1000, rotation: 0, hole: false }] }, { parent: scene.uuid });
    const linked = await run(gm, P.linkPlace, { regionUuid: region.uuid, placeId: place.id });
    if (linked.error || !linked.linked || !linked.mirror) throw new Error(linked.error ?? "region and place did not link both ways");
    await run(gm, P.shapeThing, { placeId: place.id, trapUuid: trap.uuid });
    thingUuid = `${place.uuid}::thing-1`;
    placeName = place.name;
  } catch (err) {
    note("note", `the trap thing is skipped: ${err?.message ?? err}`);
  }
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  state.formation = { scene, party, fighter, fallen, ox, pack, trap, wall, thingUuid, placeName, fid };
  return state.formation;
}

async function shapeParty(gm, W) {
  const shape = await run(gm, P.shape, { fid: W.fid, partyId: W.party.id, sceneId: W.scene.id, members: [W.fighter.id, W.ox.id, W.fallen.id], fallenId: W.fallen.id });
  const ox = await run(gm, P.shapeOx, { oxId: W.ox.id, base: INVENTED.oxBase, encounter: INVENTED.oxEncounter, capacity: INVENTED.oxCapacity, packId: W.pack.id, pack6: INVENTED.oxPack6 });
  const geo = await run(gm, P.geometry, { fid: W.fid, sceneId: W.scene.id, wallUuid: W.wall.uuid, trapUuid: W.trap.uuid });
  const fighter = await run(gm, P.shapeFighter, { actorId: W.fighter.id, figure: INVENTED.trapbreaking });
  return { shape, ox, geo, fighter };
}

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const { gm } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("installed", await run(gm, P.install));
  const census = await run(gm, P.census);
  note("census: active users [name, isGM]", census.users);
  note("census: active GM", census.activeGM);
  note("census: the GM seat is the active GM", census.activeGMIsSelf);
  check("the GM seat is a gamemaster and loaded without an error", census.role === 4 && census.boot?.phases?.length === 3 && !census.boot.errors.length, { role: census.role, phases: census.boot?.phases, errors: census.boot?.errors });

  /* ---------------------------------------------------------------- */
  await part("plan", "T-0686 / T-0687: a Judge's Trapbreaking lock on the Turn plan column", async () => {
    const W = await formationWorld(gm);
    const S = await shapeParty(gm, W);
    check("start: the three are in the party on the scene, no role, the fighter has its figure and no tools, the wall lies through the token", S.shape.members.length === 3 && S.shape.partyToken && S.shape.roles === 0 && S.fighter.figure && S.fighter.tools === 0 && S.geo.moved && S.geo.bound, { shape: S.shape, geo: S.geo, fighter: S.fighter });
    const ids = [W.wall.uuid, ...(W.thingUuid ? [W.thingUuid] : [])];
    const near = await run(gm, P.reach, { fid: W.fid, uuids: ids });
    note("within the party's reach", near);
    let thingOk = !!W.thingUuid && !!near[W.thingUuid];
    await run(gm, P.setTrap, { sceneId: W.scene.id, uuid: W.wall.uuid, to: "found" });
    if (thingOk) await run(gm, P.setTrap, { sceneId: W.scene.id, uuid: W.thingUuid, to: "found" });
    const opened = await run(gm, P.openParty, { partyId: W.party.id, tab: "mode", rows: 2 });
    check("the Judge's party sheet shows the Turn plan rows on its Dungeon tab", opened.rendered && opened.rows >= 2, opened);
    const wallPick = `trapbreakMethodical|${W.wall.uuid}`;
    const hastyPick = `trapbreakHasty|${W.wall.uuid}`;
    const thingPick = thingOk ? `trapbreakMethodical|${W.thingUuid}` : "";

    // T-0687: how the option for each target is labelled.
    const read = await run(gm, P.planRead, { partyId: W.party.id, actorId: W.fighter.id });
    check("the fighter's row offers the Trapbreaking choices on the Judge's seat", read.hasRow && read.options.some((o) => o.value === wallPick), { options: read.options.length });
    if (thingOk) {
      if (!read.options.some((o) => o.value === thingPick)) thingOk = false;
    }
    if (thingOk) {
      const labels = await run(gm, P.labels, { place: W.placeName, wallValue: wallPick, thingValue: thingPick, partyId: W.party.id, actorId: W.fighter.id });
      check("T-0687: a choice aimed at a trap thing is labelled by its place (the dialog's wording, the place's name), not as a trap area", labels.thingListed && labels.thingByPlace && labels.thingNotZone, labels);
      check("T-0687: a choice aimed at a trapped wall is still labelled by its kind", labels.wallListed && labels.wallByKind, labels);
    } else unreachable("T-0687: the label of a trap thing", `the thing is not offered on the row (reach ${JSON.stringify(near)}), so its choice cannot be read`);

    // T-0686, the refusal that holds: a trap already disarmed.
    await run(gm, P.setTrap, { sceneId: W.scene.id, uuid: W.wall.uuid, to: "disarmed" });
    await run(gm, P.openParty, { partyId: W.party.id, tab: "mode", rows: 2 });
    const a = await run(gm, P.planLock, { partyId: W.party.id, actorId: W.fighter.id, value: wallPick });
    check("T-0686: a Judge's lock aimed at a trap already disarmed writes no entry and is refused on the row", a.pressed && a.entry === null && a.noteKind === "refused", a);

    // The contrast: no tools is the character's, and is warned past.
    await run(gm, P.setTrap, { sceneId: W.scene.id, uuid: W.wall.uuid, to: "found" });
    await run(gm, P.openParty, { partyId: W.party.id, tab: "mode", rows: 2 });
    const b = await run(gm, P.planLock, { partyId: W.party.id, actorId: W.fighter.id, value: wallPick });
    check("T-0686 contrast: a Judge's lock of a methodical try with no tools is written and warned past, so the refusal above is the gate and not a dead button", b.pressed && b.entry?.key === "trapbreakMethodical" && b.entry?.option === W.wall.uuid && b.noteKind === "warned", b);

    // The refusal behind a soft one: a hasty try needs a skill, and the throw would meet it.
    await run(gm, P.planUnlock, { partyId: W.party.id, actorId: W.fighter.id });
    await run(gm, P.openParty, { partyId: W.party.id, tab: "mode", rows: 2 });
    const c = await run(gm, P.planLock, { partyId: W.party.id, actorId: W.fighter.id, value: hastyPick });
    check("T-0686: a Judge's lock of a hasty try for a member with no skill (and no tools) is refused, not written past the soft refusal in front of it", c.pressed && c.entry === null && c.noteKind === "refused", c);
    await run(gm, P.planUnlock, { partyId: W.party.id, actorId: W.fighter.id });
    await run(gm, P.setTrap, { sceneId: W.scene.id, uuid: W.wall.uuid, to: "found" });
    await takeChat(gm);
  });

  /* ---------------------------------------------------------------- */
  await part("squeeze", "T-0671: a monster crosses a squeeze at its own speeds", async () => {
    const W = await formationWorld(gm);
    const S = await shapeParty(gm, W);
    check("start: the party is shaped with the ox standing and no role", S.shape.members.length === 3 && S.shape.roles === 0 && S.ox.hasPack, { shape: S.shape, ox: S.ox });
    const fig = await run(gm, P.oxFigures, { oxId: W.ox.id });
    note("ox figures (invented)", fig);
    check("precondition: the ox has a stated load and capacity, and the character calculation on that load would give another combat speed than its own", fig.stone > 0 && fig.max > 0 && fig.expectedFinite && fig.differs, fig);
    await run(gm, P.openParty, { partyId: W.party.id, tab: "mode" });
    await run(gm, P.squeezeEnd, { partyId: W.party.id });
    await run(gm, P.openParty, { partyId: W.party.id, tab: "mode" });
    const begun = await run(gm, P.squeezeBegin, { partyId: W.party.id, length: 100 });
    check("a squeeze is begun on the Dungeon tab with the Squeeze shape and a length of 100", begun.began && begun.shape === "squeeze" && begun.length === 100, begun);
    let thrown = null;
    try {
      thrown = await run(gm, P.squeezeThrow, { partyId: W.party.id, actorId: W.ox.id });
    } finally {
      await run(gm, P.unrig);
    }
    note("the ox's throw", thrown);
    check("T-0671: the ox's row offers a throw (its speed is read, so it has a target)", !!thrown?.row && !!thrown?.button && thrown?.targetShown, thrown);
    check("T-0671: a rigged pass covers the ox's own combat speed in feet, not the speed the character calculation gives on its load", thrown?.done === true && thrown.covered === fig.expected && thrown.covered !== fig.bearing, { covered: thrown?.covered, expectedIsOwn: thrown?.covered === fig.expected, isBearing: thrown?.covered === fig.bearing });
    await run(gm, P.squeezeEnd, { partyId: W.party.id });
    await takeChat(gm);
  });

  /* ---------------------------------------------------------------- */
  await part("carrier", "T-0644: a monster Carrier's base load on the Order tab", async () => {
    const W = await formationWorld(gm);
    const S = await shapeParty(gm, W);
    check("start: the party is shaped with a fallen member and no role", S.shape.members.length === 3 && S.shape.roles === 0, S.shape);
    await run(gm, P.openParty, { partyId: W.party.id, tab: "order" });
    const r = await run(gm, P.carrier, { partyId: W.party.id, fid: W.fid, oxId: W.ox.id });
    note("carrier read", r);
    check("the ox's row on the Order tab has a Carrier chip, and pressing it makes the ox the Carrier of the fallen member", r.chip && r.carrierSet && r.casualties >= 1, { chip: r.chip, set: r.carrierSet, casualties: r.casualties });
    check("T-0644: the row prints the ox's base load as the stone lib reads off its items (a figure above nothing), then the share", r.shown && r.libPositive && r.baseIsLoadStone && r.effShown, { shownBase: r.shownBase, libBase: r.libBase, effShown: r.effShown });
    check("T-0644: the party's own reading holds the same base, and it is not core's character-only figure", r.modelMatches && r.coreFigureDiffers, { model: r.modelBase, lib: r.libBase, differsFromCore: r.coreFigureDiffers });
    await run(gm, P.carrierOff, { fid: W.fid });
  });

  /* ---------------------------------------------------------------- */
  await part("bash", "T-0678: a container bash adds Strength's part to the throw", async () => {
    const basher = await gm.fixture("equipment/close-fm-basher", "Actor", character(NAMES.basher));
    const shaped = await run(gm, P.shapeBasher, { actorId: basher.id, target: INVENTED.bashTarget, str: 16 });
    note("basher shaped", shaped);
    check("start: the basher has a Strength modifier, one Dungeonbashing throw, and one locked container", shaped.mod !== 0 && shaped.locked && shaped.items === 2, shaped);
    const now = await run(gm, P.factorNow);
    note("the world's imported factor reads (a figure; boolean only)", now.reads !== null);
    state.staged = true;
    const PRI = 35;
    const staged = await run(gm, P.stageFactor, { value: INVENTED.factor, priority: PRI });
    const part1 = await run(gm, P.strPart, { actorId: basher.id });
    if (staged.reads !== INVENTED.factor || part1.value === null) {
      unreachable("T-0678: the bash with a factor", `the layer did not stage (reads ${staged.reads}); part ${JSON.stringify(part1)}`);
    } else {
      const withFactor = await run(gm, P.bash, { actorId: basher.id, apiMode: false });
      note("bash with the factor", withFactor);
      if (!withFactor.wrapped) unreachable("T-0678: the bash with a factor", `rollAbility could not be wrapped: ${withFactor.why ?? "absent"}`);
      else {
        check("T-0678: the sheet's Bash is pressed and its confirm answered, and one throw is rolled", withFactor.gesture && withFactor.rolls === 1 && withFactor.boxStands, withFactor);
        check("T-0678: the throw carries Strength's part (modifier times the factor) as its bonus", withFactor.roll?.bonus === part1.value && part1.value === shaped.mod * INVENTED.factor, { bonus: withFactor.roll?.bonus, part: part1.value, mod: shaped.mod });
        state.withTotal = withFactor.roll?.total;
      }
    }
    await run(gm, P.stageFactor, { value: null, priority: PRI });
    const hidden = await run(gm, P.strPart, { actorId: basher.id });
    const reads = (await run(gm, P.factorNow)).reads;
    if (reads !== null || !hidden.missing) {
      unreachable("T-0678: the bash with the factor not imported", `the import could not be hidden (reads ${reads === null ? "null" : "a figure"}, part ${JSON.stringify(hidden)})`);
    } else {
      const without = await run(gm, P.bash, { actorId: basher.id, apiMode: false });
      note("bash without the factor", without);
      check("T-0678: with the factor not imported the throw is still rolled, with no Strength term (bonus 0)", without.wrapped && without.gesture && without.rolls === 1 && without.roll?.bonus === 0 && without.boxStands, without);
      if (state.withTotal != null && without.roll?.total != null && shaped.mod) {
        check("T-0678: the two throws, rigged to the same die, differ in total by Strength's part", state.withTotal - without.roll.total === shaped.mod * INVENTED.factor, { difference: state.withTotal - without.roll.total, part: shaped.mod * INVENTED.factor });
      }
    }
    const back = await run(gm, P.unstageFactor, { priority: PRI });
    state.staged = false;
    check("the staged layer is removed again and the page reads the world's own factor", back.removed === true && (back.reads === null) === (now.reads === null), { removed: back.removed });
    await run(gm, P.closeSheet, { id: basher.id, kind: "Actor" });
    await takeChat(gm);
  });

  /* ---------------------------------------------------------------- */
  const marketWorld = async () => {
    if (state.markets) return state.markets;
    await run(gm, P.marketImports);
    const MK = "markets/close-fm-";
    const town = await gm.fixture(`${MK}town`, "Actor", { name: NAMES.town, type: `${SCOPE}.location`, ownership: { default: 2 } });
    const buyer = await gm.fixture(`${MK}buyer`, "Actor", character(NAMES.buyer));
    const lampItem = await gm.fixture(`${MK}lamp`, "Item", { name: NAMES.lamp, type: "item", system: { cost: 3, weight6: 1 }, ownership: { default: 2 } });
    const lamp = await run(gm, P.worldLamp, { itemId: lampItem.id });
    const shaped = await run(gm, P.marketShape, { townId: town.id, buyerId: buyer.id, mint: 500 });
    check("start: the town has a market, the buyer holds coin and the lamp is priced", shaped.hasMarket && shaped.gp > 0 && lamp.cost > 0, { hasMarket: shaped.hasMarket, funded: shaped.gp > 0 });
    state.markets = { town, buyer, lampItem, lamp };
    return state.markets;
  };

  await part("hint", "The Shop sources hint", async () => {
    await marketWorld();
    if (!state.settingsRead) { note("shop settings read first", await run(gm, P.settingsBefore)); state.settingsRead = true; }
    const w = await run(gm, P.sources, { collection: "world" });
    check("the Shop sources window opens inside the scroll contract", w.opened && w.scroll, w);
    check("its hint is the localized line and says a Judge's own shelf is unticked until ticked", w.hintIsLocalized && w.hintSaysJudgeShelf, { localized: w.hintIsLocalized, says: w.hintSaysJudgeShelf });
    await run(gm, P.sourcesClose);
  });

  await part("history", "T-0571: the trade history's net and rows are printed to the copper", async () => {
    const M = await marketWorld();
    const buyerUuid = M.buyer.uuid;
    const t0 = Date.now();
    // Figures a float sum drifts on: 1.1; 0.1+0.2; 0.35; 0.1+0.2 again. In copper: -110, -30, +35, +30.
    const rows = [
      { time: t0 - 4000, type: "purchase", note: "QA history row one", ref: "", actorUuid: buyerUuid, gp: -1.1 },
      { time: t0 - 3000, type: "purchase", note: "QA history row two", ref: "", actorUuid: buyerUuid, gp: -(0.1 + 0.2) },
      { time: t0 - 2000, type: "sale", note: "QA history row three", ref: "", actorUuid: buyerUuid, gp: 0.35 },
      { time: t0 - 1000, type: "sale", note: "QA history row four", ref: "", actorUuid: buyerUuid, gp: 0.1 + 0.2 },
    ];
    note("float sum of the stored figures is not the printed net", rows.reduce((s, r) => s + r.gp, 0) !== -0.75);
    await run(gm, P.writeLog, { townId: M.town.id, rows });
    const h = await run(gm, P.historyRead, { townId: M.town.id });
    note("history read", { found: h.found, rows: h.rows?.length });
    check("the Trade tab's history is drawn with its four rows", h.found && h.rows?.length === 4, { found: h.found, rows: h.rows?.length });
    check("T-0571: each row's figure prints to the copper (newest first: +0.3, +0.35, -0.3, -1.1)", JSON.stringify(h.rows) === JSON.stringify(["+0.3", "+0.35", "-0.3", "-1.1"]), h.rows);
    check("T-0571: the net is summed in copper and printed to the copper (-0.75)", h.net === "-0.75", { net: h.net });
    await takeChat(gm);
  });

  await part("ref", "T-0574: a resolution id lives in `ref`", async () => {
    const M = await marketWorld();
    await run(gm, P.marketShape, { townId: M.town.id, buyerId: M.buyer.id, mint: 500 });
    const rid = `closefm${Math.random().toString(36).slice(2, 8)}`;
    const rid2 = `closefm${Math.random().toString(36).slice(2, 8)}`;
    const args = { townId: M.town.id, buyerId: M.buyer.id, sourceUuid: M.lamp.uuid, name: NAMES.lamp };
    const classSet = await run(gm, P.setClass, { townId: M.town.id });
    note("the town's class set by the Judge's override (an invented index), read back", classSet);
    let first = await run(gm, P.buy, { ...args, rid });
    note("first purchase", first);
    if (!first.ok && first.error === "tablesMissing") {
      // The world imported no availability grid, and a grid is a book's figures: stage an invented one in this page's memory.
      state.gridStaged = true;
      const staged = await run(gm, P.stageGrid, { priority: 36, townId: M.town.id });
      note("an invented availability grid staged in the page (the world imports none)", staged);
      first = await run(gm, P.buy, { ...args, rid });
      note("first purchase, with the staged grid", first);
    }
    if (!first.ok) {
      unreachable("T-0574: a purchase writes `ref`", `the engine refused the purchase with ${first.error}, so no row was written to inspect`);
    } else {
      const refs = await run(gm, P.refs, { townId: M.town.id, ids: [rid] });
      check("T-0574: the purchase's ledger row holds the resolution id in `ref`, and no note prints it", refs[rid].inRef === 1 && refs[rid].inNote === 0 && refs[rid].types.includes("purchase"), refs[rid]);
      const again = await run(gm, P.buy, { ...args, rid });
      check("T-0574: the same resolution id again is refused as a duplicate, with no coin spent, no item gained and no row written", again.ok === false && again.error === "duplicate" && !again.spent && !again.itemGained && !again.logGrew, again);
      await run(gm, P.noteOnlyRow, { townId: M.town.id, rid: rid2, buyerUuid: M.buyer.uuid });
      const control = await run(gm, P.buy, { ...args, rid: rid2 });
      check("T-0574 control: an id that sits only in an older row's note is not read as a duplicate (the check reads `ref`)", control.error !== "duplicate", control);
      await run(gm, P.historyRead, { townId: M.town.id });
      const printed = await run(gm, P.historyHas, { townId: M.town.id, ids: [rid, rid2] });
      check("T-0574: the history the sheet prints does not carry the id a purchase wrote into `ref` (the second id sits in the note of a row this walk shaped by hand, so it prints by that row's own note)", printed[0] === false && printed[1] === true, printed);
    }
    await takeChat(gm);
  });

  await part("shop", "T-0575: a Judge's own shelf is out of the shop until ticked in", async () => {
    const M = await marketWorld();
    if (!state.settingsRead) { note("shop settings read first", await run(gm, P.settingsBefore)); state.settingsRead = true; }
    const reg = await run(gm, P.settingsBefore);
    check("T-0575: the world registers the ticked-Judge-shelves setting (world scope, off the settings screen, empty by default)", reg.registered && reg.world && reg.hidden && reg.defaultEmpty, reg);
    const line = (MACHINE.own ?? "close").replace(/[^A-Za-z0-9]/g, "") || "close";
    const shelf = await run(gm, P.shelf, { line: `QA ${line}`, name: NAMES.judgeLamp, cost: 5 });
    if (shelf.error) throw new Error(shelf.error);
    state.shelf = shelf;
    state.shelfBuiltHere = shelf.builtPack;
    note("Judge shelf", { builtPack: shelf.builtPack, builtItem: shelf.builtItem, isJudge: shelf.isJudge });
    check("setup: the shelf is a Judge's own Item shelf and holds the invented item", shelf.isJudge && !!shelf.itemUuid, { isJudge: shelf.isJudge });
    await run(gm, P.judgeEmpty);
    const names = [NAMES.judgeLamp, NAMES.lamp];
    const off = await run(gm, P.catalog, { townId: M.town.id, collection: shelf.collection, names });
    check("T-0575: with the shelf not ticked in, the shop lists nothing from it (and still lists the world's lamp)", off.fromShelf === 0 && !off.named[NAMES.judgeLamp] && off.named[NAMES.lamp] && off.excludedHasShelf, off);
    const win0 = await run(gm, P.sources, { collection: shelf.collection });
    check("T-0575: Shop sources lists the shelf, unticked", win0.opened && win0.rowListed && win0.checkedBefore === false, { rowListed: win0.rowListed, checked: win0.checkedBefore });

    // A paid order whose document is gone, with the shelf left out.
    const copy = await run(gm, P.shelfCopy, { collection: shelf.collection, name: NAMES.judgeLamp, cost: 5 });
    gm.track(copy.uuid, "Item");
    const swept = await gm.sweepTracked({ only: [copy.uuid] });
    note("the order's document, deleted by tracked uuid", swept);
    const gone = await run(gm, P.ordered, { uuid: copy.uuid, name: NAMES.judgeLamp, collection: shelf.collection });
    check("T-0575: a paid order whose document is gone is not delivered by name from the shelf that was left out", gone.gone && gone.found === false, gone);

    // Tick it in through the window.
    const ticked = await run(gm, P.sources, { collection: shelf.collection, set: true });
    const heldExcluded = await run(gm, P.excludedHolds, { collection: shelf.collection });
    check("T-0575: ticking the shelf and pressing Save writes it into the Judge list, closes the window, and leaves the unticked list alone", ticked.saved && ticked.judgeHolds && ticked.closed && heldExcluded === false, { saved: ticked.saved, closed: ticked.closed, inExcluded: heldExcluded });
    const on = await run(gm, P.catalog, { townId: M.town.id, collection: shelf.collection, names });
    check("T-0575: with the shelf ticked in, the shop lists its item", on.fromShelf >= 1 && on.namedFromShelf[NAMES.judgeLamp] && !on.excludedHasShelf, on);
    const back = await run(gm, P.ordered, { uuid: copy.uuid, name: NAMES.judgeLamp, collection: shelf.collection });
    check("T-0575: the same order, with the shelf ticked in, is delivered by name from it", back.found && back.fromShelf, back);

    // Player seat: the shop as a player's page builds it.
    try {
      open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
      await ready(open.player, "player");
      await run(open.player, P.install);
      await run(open.player, P.marketImports);
      const pTicked = await run(open.player, P.catalog, { townId: M.town.id, collection: shelf.collection, names });
      note("the Player seat's catalog with the shelf ticked in: lists the Judge item (boolean)", pTicked.named[NAMES.judgeLamp]);
      check("the Player seat's shop lists the world's lamp (the catalog builds on that seat)", pTicked.named[NAMES.lamp] === true, { lamp: pTicked.named[NAMES.lamp] });
    } catch (err) {
      check("the Player seat's shop was read", false, String(err?.message ?? err).slice(0, 200));
    }
    const unticked = await run(gm, P.sources, { collection: shelf.collection, set: false });
    check("T-0575: unticking the shelf and pressing Save takes it out of the Judge list again", unticked.saved && !unticked.judgeHolds, { saved: unticked.saved });
    const off2 = await run(gm, P.catalog, { townId: M.town.id, collection: shelf.collection, names });
    check("T-0575: unticked again, the shop lists nothing from the shelf", off2.fromShelf === 0 && !off2.named[NAMES.judgeLamp], off2);
    const gone2 = await run(gm, P.ordered, { uuid: copy.uuid, name: NAMES.judgeLamp, collection: shelf.collection });
    check("T-0575: and the order whose document is gone is again not delivered by name from it", gone2.found === false, gone2);
    if (open.player) {
      const pOff = await run(open.player, P.catalog, { townId: M.town.id, collection: shelf.collection, names });
      check("T-0575: the Player seat's shop lists nothing from the shelf (this seat cannot tell the setting from the shelf's own ownership, which hides it from players)", pOff.fromShelf === 0 && !pOff.named[NAMES.judgeLamp], { fromShelf: pOff.fromShelf });
    }
  });

  section("errors after ready");
  const boot = await run(gm, P.boot);
  check("the GM seat: nothing thrown from load to the walk's end", boot?.phases?.length === 3 && !boot.errors.length, boot?.errors?.slice(0, 5));
  if (open.player) {
    const pboot = await run(open.player, P.boot).catch(() => null);
    note("the Player seat's recorder (attached after ready, so it saw no load)", { errors: pboot?.errors?.length ?? null });
  }
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  tally.fail += 1;
  failed.push("the walk ran to its end");
} finally {
  section("teardown");
  const gm = open.gm;
  if (gm) {
    try { if (state.staged) note("unstaged factor", await run(gm, P.unstageFactor, { priority: 35 })); } catch (err) { console.error("unstage:", err?.message ?? err); }
    try { if (state.gridStaged) note("unstaged grid", await run(gm, P.unstageGrid, { priority: 36 })); } catch (err) { console.error("unstage grid:", err?.message ?? err); }
    try { note("die rig given back", await run(gm, P.unrig)); } catch (err) { console.error("unrig:", err?.message ?? err); }
    try { await takeChat(gm); } catch (err) { console.error("takeChat:", err?.message ?? err); }
    try { await run(gm, P.sourcesClose); } catch { /* closed */ }
    try { if (state.settingsRead) note("Shop sources settings put back", await run(gm, P.settingsRestore)); } catch (err) { console.error("restore:", err?.message ?? err); }
    try {
      if (state.shelf && state.shelfBuiltHere) note("the Judge shelf this run built, deleted", await run(gm, P.shelfDelete, { collection: state.shelf.collection }));
      else if (state.shelf) note("the Judge shelf was standing already and is kept", state.shelf.collection ? true : null);
    } catch (err) { console.error("shelf delete:", err?.message ?? err); }
    try { note("swept", await gm.sweepTracked({ only: [...new Set(tracked)].filter(Boolean) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  console.log(`\nclose-form-mkt: ${tally.fail ? "failed" : "passed"} (${tally.pass} pass, ${tally.fail} fail, ${tally.unreachable} unreachable)`);
  if (failed.length) for (const label of failed) console.log(`FAILED  ${label}`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch { /* closed */ } }
}
