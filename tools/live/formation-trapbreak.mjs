/**
 * Live walk, the Trapbreaking dialog: docs/formation/TESTING.md step 8 ("Trapbreaking
 * dialog (U1t)") and step 11's disarm-or-discharge question on the Player seat. Two
 * seats. Machine values arrive through ./_env.mjs; nothing here names a port, a
 * world, a seat or a book.
 *
 * Covers step 8's Judge seat (warned, then refused, an unfound trap dashed), Player
 * seat (blocked, listing only found traps, no Judge field, enabling when tools
 * arrive with nothing pressed), Two windows, The redraw (Mark spotted and Rebuild
 * written from outside the window) and Throw and question on the Judge seat; and
 * step 11's question on the PLAYER seat: it opens there and not on the Judge's, the
 * trap reads disarmed while it is open, Discharge writes discharged and whispers one
 * line, and a Judge's rebuild while it is open leaves the rebuilt trap armed.
 * Not covered, and walked by hand: step 8's figures and footer bullets, the
 * Character-select switch, deleting the trap thing from its place; step 11's canvas
 * markers drawn only for known placements, the party sheet's Dungeon-tab Trapbreaking
 * button, Leave disarmed or closing the question on the Player seat writing nothing
 * more, and the turn-plan clause. The fighter's tools arrive by a document create
 * from the driver, not through the item sheet.
 *
 * Fixtures, kept and found again by marker (`api.fixture`), each brought to the shape
 * a step needs at that step's start: the scene `formation/trapbreak-scene`; the party
 * `formation/trapbreak-party` holding `formation/trapbreak-thief` (GM-owned, with the
 * hand-made skill `formation/trapbreak-thief-skill` and the tools
 * `formation/trapbreak-thief-tools`) and `formation/trapbreak-fighter` (owned by the
 * Player seat, no skill); the trap Item `formation/trapbreak-trap`; the trapped wall
 * `formation/trapbreak-wall`, moved through the party token's centre at the start so
 * it is touched; the place `formation/trapbreak-place` linked to the Region
 * `formation/trapbreak-region`, holding one hidden trap thing (skipped, with a note,
 * where the location feature's API is absent). The fighter's tools
 * `formation/trapbreak-fighter-tools` are retired in the setup section and built in
 * the Player-seat step, where their arrival is the subject. Each chat card the run
 * claims is marked `formation/trapbreak-card-<n>` in the order claimed, and the next
 * run retires them from 1 upward before its first section, stopping after five
 * markers in a row that nothing carries. Every figure typed into a fixture is
 * invented. The dice are rigged on the GM page only, and restored in the `finally`.
 * Each methodical attempt spends one turn of the walk's own party.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCOPE = "acks-extras";
const NONCE = "tb" + Math.random().toString(36).slice(2, 7);
/** The tag a session's own names carry, so a card claimed by name is this session's. */
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const PARTY = `QA Trapbreak Party${TAG}`;
const THIEF = `QA Trapbreak Thief${TAG}`;
const FIGHTER = `QA Trapbreak Fighter${TAG}`;
/** A name the module's thieves' tools pattern matches. */
const TOOLS = "QA Thieves' Tools";
const INVENTED = { thief: 12, fighter: 14 };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  const d = detail === undefined ? "" : `  ${JSON.stringify(typeof detail === "object" && detail !== null ? detail : { detail })}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${d}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */

const P = {
  /** Helpers every other page function reaches through `globalThis.__tb`. */
  install: async ({ nonce, names }) => {
    const H = (globalThis.__tb = globalThis.__tb ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.nonce = nonce;
    H.names = new Set([...(H.names ?? []), ...names]);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        let v = null;
        try { v = await fn(); } catch { v = null; }
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.tz = await import(`${base}formation/trap-zone.mjs`);
    H.app = await import(`${base}formation/trapbreak-app.mjs`);
    H.requests = await import(`${base}formation/player-requests.mjs`);
    H.ac = await import(`${base}lib/automation-client.mjs`);
    H.t = (key, data) => game.i18n.format(key, data ?? {});
    // Errors from here on; a recorder attached after `ready` sees none of init, setup or ready.
    H.errors ??= [];
    if (!H.errorsOn) {
      H.errorsOn = true;
      const push = (kind, text) => H.errors.push({ kind, text: String(text).slice(0, 200) });
      const error = console.error.bind(console);
      console.error = (...args) => { push("console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
      globalThis.addEventListener("error", (e) => push("error", e.message));
      globalThis.addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
    }
    H.wins = () => [...foundry.applications.instances.values()].filter((a) => typeof a.id === "string" && a.id.startsWith("acks-extras-trapbreak-"));
    H.win = (fid, actorId) => foundry.applications.instances.get(H.app.trapbreakWindowId(fid, actorId)) ?? null;
    H.where = (sceneId, uuid) => H.tz.allPlacements(game.scenes.get(sceneId)).find((p) => p.uuid === uuid) ?? null;
    H.dialog = () => [...document.querySelectorAll("dialog, .application.dialog")]
      .find((d) => ["disarm", "discharge"].every((a) => d.querySelector(`button[data-action="${a}"]`))) ?? null;
    H.dom = (win) => {
      const root = H.root(win);
      const q = (s) => root?.querySelector(s);
      const norm = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        attemptDisabled: q('[data-action="attempt"]')?.disabled ?? null,
        refusal: q(".acks-extras-trapbreak-refusal") ? norm(q(".acks-extras-trapbreak-refusal")) : null,
        warnings: [...(root?.querySelectorAll(".acks-extras-trapbreak-warning") ?? [])].map(norm),
        judgeField: !!q('input[name="extra"]'),
        markFound: !!q('[data-action="markFound"]'),
        resetButton: !!q('[data-action="resetTrap"]'),
        targets: [...(root?.querySelectorAll(".acks-extras-trapbreak-target") ?? [])].map((el) => ({
          uuid: el.querySelector("input")?.value ?? null,
          state: norm(el.querySelector(".state")),
          unfound: el.classList.contains("is-unfound"),
          checked: !!el.querySelector("input")?.checked,
        })),
        actorOptions: [...(root?.querySelectorAll('select[name="actorId"] option') ?? [])].map((o) => o.value),
      };
    };
    // The dice rig reads from the top on core 14: a face sits at (faces - face + 0.5) / faces.
    H.native ??= CONFIG.Dice.randomUniform;
    H.rig = async (face, faces = 20) => {
      if (!H.origUniform) H.origUniform = CONFIG.Dice.randomUniform;
      const u = (faces - face + 0.5) / faces;
      CONFIG.Dice.randomUniform = () => u;
      const got = (await new Roll(`1d${faces}`).evaluate()).total;
      return { ok: got === face };
    };
    H.unrig = () => {
      if (!H.origUniform) return false;
      CONFIG.Dice.randomUniform = H.origUniform;
      H.origUniform = null;
      return true;
    };
    // The run's own chat cards: a message THIS client creates carries the nonce; `cards` claims one only
    // where it speaks as or names one of the run's fixtures.
    if (game.user.isGM && !H.cards) {
      H.cards = [];
      Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => {
        if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": H.nonce });
      });
      Hooks.on("createChatMessage", (m) => {
        if (m.flags?.world?.qaNonce !== H.nonce) return;
        H.cards.push({ id: m.id, uuid: m.uuid, at: Date.now(), alias: m.speaker?.alias ?? null, html: `${m.flavor ?? ""} ${m.content ?? ""}`, whisper: [...(m.whisper ?? [])] });
      });
    }
    return { ok: typeof H.tz.attemptDisarm === "function" && typeof H.app.openTrapbreakApp === "function", isGM: game.user.isGM };
  },

  /** This seat's identity and its window's place in the seat's election. */
  census: async () => {
    const H = globalThis.__tb;
    let election;
    try {
      await Promise.race([H.ac.automationSettled(), new Promise((r) => setTimeout(r, 5000))]);
      election = { isLead: H.ac.isLeadClient(), census: H.ac.automationCensus() ?? null };
    } catch (err) { election = { error: String(err?.message ?? err) }; }
    return {
      userId: game.user.id,
      role: game.user.role,
      isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      election,
    };
  },

  viewScene: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    await scene.view();
    const t0 = performance.now();
    while (!(canvas.ready && canvas.scene?.id === sceneId) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 3000));
    return { viewed: canvas.scene?.id === sceneId };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__tb;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** The start shape: the members in the party on the walk's scene, the party token there, no fight, not paused. */
  startShape: async ({ fid, partyId, sceneId, members }) => {
    const H = globalThis.__tb;
    const scene = game.scenes.get(sceneId);
    for (const c of game.combats.filter((c) => c.combatants.some((x) => x.actorId === partyId))) await c.delete();
    await H.sleep(500);
    await H.model.patchFormation(fid, (rec) => {
      rec.combat = null;
      rec.clock.paused = false;
      rec.clock.movedThisTurn = false;
      rec.clock.roundsPartial = 0;
      rec.clock.carryFeet = 0;
    });
    const f0 = H.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) {
      await H.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    }
    for (const [n, id] of members.entries()) {
      const f = H.model.getFormation(fid);
      if (f.members.some((m) => m?.actorId === id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: 400 + n * 100, y: 400 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), made, { scene });
    }
    await H.sleep(800);
    const f = H.model.getFormation(fid);
    return {
      members: f.members.filter((m) => m?.actorId).map((m) => m.actorId),
      sceneId: f.sceneId,
      partyToken: !!H.model.getPartyToken(f),
      paused: !!f.clock.paused,
      combat: !!f.combat?.active,
    };
  },

  /** The trapped wall moved through the party token's centre, so a reach of nothing still touches it. */
  geometry: async ({ fid, sceneId, wallUuid, trapUuid }) => {
    const H = globalThis.__tb;
    const scene = game.scenes.get(sceneId);
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    if (!token) return { error: "no party token" };
    const gs = scene.grid.size;
    const cx = Math.round(token.x + (token.width * gs) / 2);
    const cy = Math.round(token.y + (token.height * gs) / 2);
    const wall = fromUuidSync(wallUuid);
    const want = [cx - 150, cy, cx + 150, cy];
    if (wall.c.join() !== want.join()) await wall.update({ c: want });
    // A kept wall may name a trap Item that has since been made again.
    if (H.tz.wallPlacement(wall).trapUuid !== trapUuid) await H.tz.wallPlacement(wall).write({ trapUuid });
    return { moved: wall.c.join() === want.join(), bound: H.tz.wallPlacement(wall).trapUuid === trapUuid, reachImported: H.tz.trapbreakReach() > 0 };
  },

  /** What a trap placement reads: the placement is `null` where the party is not within reach of it. */
  reach: async ({ fid, uuids }) => {
    const H = globalThis.__tb;
    const f = H.model.getFormation(fid);
    return Object.fromEntries(uuids.map((u) => [u, !!H.tz.placementNearByUuid(f, u)]));
  },

  /** The fighter's start shape: its own invented Adventuring figure and the Player seat owning it. */
  shapeFighter: async ({ actorId, playerId, figure }) => {
    const a = game.actors.get(actorId);
    if (a.system.adventuring?.trapbreaking !== figure) await a.update({ "system.adventuring.trapbreaking": figure });
    if (a.ownership?.[playerId] !== 3) await a.update({ [`ownership.${playerId}`]: 3 });
    return { figure: a.system.adventuring?.trapbreaking === figure, owned: a.ownership?.[playerId] === 3 };
  },

  /** The thief's skill brought to the walk's invented flat throw. */
  shapeSkill: async ({ uuid, target }) => {
    const item = fromUuidSync(uuid);
    await item.update({
      "flags.acks-extras.checkKey": "trapbreak",
      "flags.acks-extras.extras.rolls": [{ key: "primary", label: "Trapbreaking", rollType: "above", scale: "level", target: { kind: "flat", flat: target } }],
    });
    return { bound: item.getFlag("acks-extras", "checkKey") === "trapbreak" };
  },

  /** The place's one trap thing, hidden or found, armed, with the trap Item it names. */
  shapeThing: async ({ placeId, trapUuid, hidden }) => {
    const place = game.actors.get(placeId);
    const things = [{ id: "thing-1", kind: "trap", ref: trapUuid, hidden, hint: null, point: null, params: {}, layers: {}, state: { state: "armed", repeatLock: {}, searchLock: {} } }];
    await place.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { held: (place.getFlag("acks-extras", "things") ?? []).length };
  },

  linkPlace: async ({ regionUuid, placeId }) => {
    const S = globalThis.acksExtras?.location?.scenes;
    if (!S?.linkRegion || !S?.locationOfRegion || !S?.regionOfLocation) return { error: "no location api" };
    const region = fromUuidSync(regionUuid);
    const place = game.actors.get(placeId);
    if (S.locationOfRegion(region)?.uuid !== place.uuid || S.regionOfLocation(place)?.uuid !== region.uuid) await S.linkRegion(region, place);
    return { linked: S.locationOfRegion(region)?.uuid === place.uuid, mirror: S.regionOfLocation(place)?.uuid === region.uuid };
  },

  /** What the character carries that bears on the dialog: thieves' tools, and a skill bound to Trapbreaking. */
  carried: async ({ actorId }) => {
    const H = globalThis.__tb;
    const items = game.actors.get(actorId).items;
    return {
      tools: items.filter((i) => H.tz.TOOLS_ITEM_PATTERN.test(i.name ?? "")).length,
      skills: items.filter((i) => i.getFlag("acks-extras", "checkKey") === "trapbreak").length,
    };
  },

  /** A trap brought to a state by the module's own writers: unfound, found, armed (found) or disarmed. */
  setTrap: async ({ sceneId, uuid, to }) => {
    const H = globalThis.__tb;
    const p = H.where(sceneId, uuid);
    if (!p) return { error: "no placement" };
    if (to === "unfound") await H.tz.resetTrap(p);
    else if (to === "found") {
      await H.tz.resetTrap(p);
      await H.tz.markTrapFound(H.where(sceneId, uuid));
    } else if (to === "armed") await p.write({ state: "armed", known: true, repeatLock: {}, searchLock: {} });
    else if (to === "disarmed") await p.write({ state: "disarmed", known: true });
    const now = H.where(sceneId, uuid);
    return { state: now?.state ?? null, known: now?.known ?? null };
  },

  /** The module's own writers, called as the window's buttons call them, with no window press. */
  markFound: async ({ sceneId, uuid }) => { const H = globalThis.__tb; await H.tz.markTrapFound(H.where(sceneId, uuid)); return true; },
  rebuild: async ({ sceneId, uuid }) => { const H = globalThis.__tb; await H.tz.resetTrap(H.where(sceneId, uuid)); return true; },

  readTrap: async ({ sceneId, uuid }) => {
    const p = globalThis.__tb.where(sceneId, uuid);
    return p ? { state: p.state, known: p.known } : null;
  },

  waitTrap: async ({ sceneId, uuid, state, tries = 40, every = 100 }) => {
    const H = globalThis.__tb;
    const ok = await H.poll(() => H.where(sceneId, uuid)?.state === state, { tries, every });
    const p = H.where(sceneId, uuid);
    return { ok: !!ok, state: p?.state ?? null, known: p?.known ?? null };
  },

  /** The module's own gate as `attemptDisarm` meets it: it refuses before anything is rolled. */
  gate: async ({ fid, actorId, uuid, judge }) => {
    const H = globalThis.__tb;
    const out = await H.tz.attemptDisarm(H.model.getFormation(fid), game.actors.get(actorId), { targetUuid: uuid, judge, askUserId: null });
    return { ok: out.ok, reason: out.reason ?? null, outcome: out.outcome ?? null };
  },

  /** The localized words this walk compares the window and the cards against. */
  expect: async ({ party, thief, fighter }) => {
    const H = globalThis.__tb;
    const t = H.t;
    return {
      noTools: t("ACKS-FORMATION.traps.refuse.noTools", { name: fighter }),
      advice: t("ACKS-FORMATION.traps.breakWarning"),
      disarmed: t("ACKS-FORMATION.traps.refuse.alreadyDisarmed", { name: fighter }),
      unfound: t("ACKS-FORMATION.traps.breakUnfound"),
      state: {
        armed: t("ACKS-FORMATION.traps.state.armed"),
        found: t("ACKS-FORMATION.traps.state.found"),
        disarmed: t("ACKS-FORMATION.traps.state.disarmed"),
        discharged: t("ACKS-FORMATION.traps.state.discharged"),
      },
      needles: {
        title: t("ACKS-FORMATION.traps.disarmMethodicalTitle"),
        declared: t("ACKS-FORMATION.request.trapbreak", { name: fighter }),
        discharged: t("ACKS-FORMATION.traps.dischargedAfter", { name: fighter }),
        fighter,
        thief,
        party,
      },
      titles: {
        thief: t("ACKS-FORMATION.traps.breakWindowTitle", { title: t("ACKS-FORMATION.traps.breakTitle"), party, name: thief }),
        fighter: t("ACKS-FORMATION.traps.breakWindowTitle", { title: t("ACKS-FORMATION.traps.breakTitle"), party, name: fighter }),
      },
    };
  },

  closeWins: async () => {
    const H = globalThis.__tb;
    const wins = H.wins();
    for (const w of wins) await w.close({ animate: false });
    return wins.length;
  },

  openWin: async ({ fid, actorId, targetUuid = null }) => {
    const H = globalThis.__tb;
    await H.app.openTrapbreakApp(fid, actorId, targetUuid ? { targetUuid } : null);
    const win = H.win(fid, actorId);
    if (!win) return { error: "no window for the pair" };
    await H.poll(() => (win.rendered && H.root(win)?.querySelector('[data-action="attempt"]') ? true : null), { tries: 60, every: 150 });
    await H.sleep(300);
    return { id: win.id, rendered: !!win.rendered, expectId: H.app.trapbreakWindowId(fid, actorId) };
  },

  /** Open a pair again: the same window fronted, never a second one. */
  reopen: async ({ fid, actorId }) => {
    const H = globalThis.__tb;
    const before = H.win(fid, actorId);
    await H.app.openTrapbreakApp(fid, actorId);
    await H.sleep(300);
    return { same: !!before && H.win(fid, actorId) === before, count: H.wins().length, ids: H.wins().map((w) => w.id) };
  },

  /** What the window computes and what it draws, side by side. */
  winState: async ({ fid, actorId }) => {
    const H = globalThis.__tb;
    const win = H.win(fid, actorId);
    if (!win) return { open: false };
    const ctx = await win._prepareContext({});
    return {
      open: true,
      title: win.title,
      ctx: {
        isGM: ctx.isGM,
        canAttempt: ctx.canAttempt,
        canRearm: ctx.canRearm,
        refusal: ctx.refusal?.text ?? null,
        warnings: ctx.warnings.map((w) => ({ text: w.text, advice: w.advice })),
        targets: ctx.targets.map((x) => ({ uuid: x.uuid, known: x.known, state: x.state })),
        chosen: ctx.chosen?.uuid ?? null,
        actors: ctx.actors.map((a) => a.id),
        hasThrow: ctx.hasThrow,
        skilled: !!ctx.check?.skilled,
        needs: ctx.needs != null,
      },
      dom: H.dom(win),
    };
  },

  /** Poll a window's DOM until a predicate holds: the draw a write makes on its own. */
  pollWin: async ({ fid, actorId, until, tries = 50, every = 150 }) => {
    const H = globalThis.__tb;
    const test = (dom) => {
      if (until.refusal) return dom.attemptDisabled === true && !!dom.refusal?.includes(until.refusal);
      if (until.attempt) return dom.attemptDisabled === (until.attempt === "disabled");
      if (until.count != null) return dom.targets.length === until.count;
      if (until.state) { const x = dom.targets.find((t) => t.uuid === until.state.uuid); return !!x && x.state === until.state.text; }
      if (until.markFound != null) return dom.markFound === until.markFound;
      return false;
    };
    let dom = null;
    const ok = await H.poll(() => {
      const win = H.win(fid, actorId);
      if (!win?.rendered) return null;
      dom = H.dom(win);
      return test(dom) ? true : null;
    }, { tries, every });
    return { ok: !!ok, dom };
  },

  /** Press Work on it in this seat's window for the pair, as a hand would. */
  press: async ({ fid, actorId }) => {
    const H = globalThis.__tb;
    const win = H.win(fid, actorId);
    const button = H.root(win)?.querySelector('[data-action="attempt"]');
    if (!button || button.disabled) return { pressed: false, disabled: !!button?.disabled };
    button.click();
    await H.sleep(150);
    return { pressed: true };
  },

  /** The disarm-or-discharge question on this seat: waited for up to `tries` polls, or read at once with one. */
  dialogState: async ({ tries = 1, every = 150, name = null }) => {
    const H = globalThis.__tb;
    await H.poll(() => H.dialog(), { tries, every });
    const d = H.dialog();
    return { open: !!d, nameShown: !!d && !!name && d.textContent.includes(name) };
  },

  answerDialog: async ({ action }) => {
    const H = globalThis.__tb;
    const d = H.dialog();
    const button = d?.querySelector(`button[data-action="${action}"]`);
    if (!button) return { clicked: false, closed: !d };
    button.click();
    const closed = await H.poll(() => (H.dialog() ? null : true), { tries: 40, every: 150 });
    return { clicked: true, closed: !!closed };
  },

  /** The cards this client made since `since` that speak as or name a fixture of the run, each with which needles it holds. */
  cards: async ({ since = 0, needles = {}, wait = null, tries = 1, every = 250 }) => {
    const H = globalThis.__tb;
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    const read = () => H.cards
      .filter((c) => c.at >= since && (H.names.has(c.alias) || [...H.names].some((n) => c.html.includes(n))))
      .map((c) => {
        const box = document.createElement("div");
        box.innerHTML = c.html;
        const text = box.textContent.replace(/\s+/g, " ");
        return {
          id: c.id,
          uuid: c.uuid,
          toJudges: c.whisper.length > 0 && c.whisper.every((u) => gms.includes(u)),
          isPublic: !c.whisper.length,
          has: Object.fromEntries(Object.entries(needles).map(([k, v]) => [k, text.includes(v)])),
        };
      });
    let cards = read();
    for (let n = 1; wait && n < tries && !cards.some((c) => c.has[wait]); n++) {
      await H.sleep(every);
      cards = read();
    }
    return cards;
  },

  /** A player's relay sent straight, for a member the seat does not own: the window offers no control for it. */
  relay: async ({ fid, actorId, targetUuid }) => {
    const H = globalThis.__tb;
    let error = null;
    try { await H.requests.requestPartyAction(fid, "trapbreak", { actorId, targetUuid, mode: "methodical" }); }
    catch (err) { error = String(err?.message ?? err).slice(0, 200); }
    await H.sleep(2000);
    return { sent: true, error };
  },

  /** Every figure in the window hovers its source; counts only, since a tooltip carries the world's imported figures. */
  figures: async ({ fid, actorId }) => {
    const H = globalThis.__tb;
    const root = H.root(H.win(fid, actorId));
    const tipOf = (el) => (el?.dataset?.tooltipText ?? "").trim();
    // A tooltip closes on its reference in brackets: "(RR p. 267)", or whatever the import cites.
    const refOf = (t) => /\(([^()]*)\)[^()]*$/.exec(t)?.[1]?.trim() ?? "";
    const cites = (t) => refOf(t).length > 0;
    const needs = root?.querySelector(".acks-extras-trapbreak-needs-figure");
    const parts = [...(root?.querySelectorAll(".acks-extras-trapbreak-parts li") ?? [])];
    const reach = root?.querySelector(".acks-extras-trapbreak-reach .acks-extras-trapbreak-figure");
    const attempt = root?.querySelector('[data-action="attempt"]');
    return {
      needs: { tipped: !!tipOf(needs), cites: cites(tipOf(needs)), ref: refOf(tipOf(needs)) },
      parts: { count: parts.length, tipped: parts.filter((li) => !!tipOf(li)).length, citing: parts.filter((li) => cites(tipOf(li))).length },
      reach: { tipped: !!tipOf(reach), cites: cites(tipOf(reach)), ref: refOf(tipOf(reach)) },
      attempt: { tipped: !!tipOf(attempt) },
      titles: root ? root.querySelectorAll("[title]").length : null,
    };
  },

  /** The footer is its own part, and stays inside the window when the window is made short. */
  footer: async ({ fid, actorId, height }) => {
    const H = globalThis.__tb;
    const win = H.win(fid, actorId);
    const was = { ...win.position };
    // A redraw can land mid-measure and replace the parts, so every read is taken
    // fresh after the resize, and the resize is repeated until the frame holds it.
    let r = null;
    for (let n = 0; n < 5; n++) {
      win.setPosition({ height });
      await H.sleep(400);
      r = H.root(win)?.getBoundingClientRect();
      if (r && Math.abs(r.height - height) <= 2) break;
    }
    const root = H.root(win);
    const footer = root?.querySelector(".acks-extras-trapbreak-footer");
    const body = root?.querySelector(".acks-extras-trapbreak-body");
    const partOf = (el) => el?.closest("[data-application-part]")?.dataset.applicationPart ?? null;
    const f = footer?.getBoundingClientRect();
    const scroller = body?.closest("[data-application-part]");
    const out = {
      footerPart: partOf(footer), bodyPart: partOf(body),
      footerInside: !!f && f.height > 0 && f.bottom <= r.bottom + 1 && f.top >= r.top,
      attemptVisible: !!footer?.querySelector('[data-action="attempt"]') && !!f && f.height > 0,
      bodyScrolls: !!scroller && scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY !== "hidden",
      height: Math.round(r?.height ?? 0),
      minimized: !!win.minimized,
    };
    win.setPosition({ height: was.height });
    return out;
  },

  /** Pick another character in the window's Character select, as a hand would. */
  switchActor: async ({ fid, fromId, toId }) => {
    const H = globalThis.__tb;
    const select = H.root(H.win(fid, fromId))?.querySelector('select[name="actorId"]');
    if (!select) return { select: false };
    select.value = toId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const opened = await H.poll(() => H.win(fid, toId)?.rendered || null);
    const closed = await H.poll(() => (H.win(fid, fromId)?.rendered ? null : true));
    return { select: true, opened: !!opened, actorShown: H.root(H.win(fid, toId))?.querySelector('select[name="actorId"]')?.value === toId, firstClosed: !!closed };
  },

  /** The party sheet's Dungeon tab opens the dialog from its head pill. */
  dungeonOpener: async ({ fid, partyId }) => {
    const H = globalThis.__tb;
    for (const w of H.wins()) await w.close();
    const sheet = game.actors.get(partyId)?.sheet;
    if (!sheet) return { sheet: false };
    await sheet.render(true);
    await H.poll(() => sheet.rendered || null);
    const root = H.root(sheet);
    const tab = root?.querySelector('nav [data-tab="mode"], [data-action="tab"][data-tab="mode"]');
    tab?.click();
    await H.sleep(300);
    const button = root?.querySelector('[data-action="openTrapbreak"]');
    const visible = !!button && button.getClientRects().length > 0;
    button?.click();
    const opened = await H.poll(() => (H.wins().length ? H.wins() : null));
    const out = { sheet: true, tab: !!tab, button: !!button, visible, opened: !!opened?.length, forParty: !!opened?.every((w) => w.id.startsWith(H.app.trapbreakWindowId(fid))) };
    await sheet.close();
    return out;
  },

  rig: async ({ face }) => globalThis.__tb.rig(face),
  unrig: async () => {
    const H = globalThis.__tb;
    const was = H.unrig();
    return { wasRigged: was, native: CONFIG.Dice.randomUniform === H.native };
  },
  nowMs: async () => Date.now(),
  errors: async () => globalThis.__tb?.errors ?? [],
};

/** Run a page function in a seat and read its result back as JSON. */
async function run(api, fn, args = {}) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
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

const character = (name, extra = {}) => ({
  name, type: "character", prototypeToken: { actorLink: true },
  system: { hp: { value: 8, max: 8 }, details: { level: 3 } },
  ...extra,
});

const open = {};
let cardN = 0;
const marked = new Set();

/** Mark the cards this run's GM client claimed, in the order claimed (a marked card is a kept fixture the next run retires). */
async function claimCards(gm) {
  const cards = await run(gm, P.cards, { since: 0 });
  for (const c of cards) {
    if (marked.has(c.uuid)) continue;
    marked.add(c.uuid);
    cardN += 1;
    try { await gm.mark(c.uuid, `formation/trapbreak-card-${cardN}`); } catch (err) { console.error("mark:", err?.message ?? err); }
  }
  return cards.length;
}

/** Rig the GM page's dice to a natural 20 (the throws roll on the GM's client); true when the probe rolled one. */
async function rigGm() {
  return (await run(open.gm, P.rig, { face: 20 })).ok;
}

/** Give the GM page's dice back; true when its roller is the world's own again. */
async function unrigGm() {
  const back = await run(open.gm, P.unrig);
  return back.native === true;
}

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = [await run(gm, P.install, { nonce: NONCE, names: [PARTY, THIEF, FIGHTER] }), await run(player, P.install, { nonce: NONCE, names: [PARTY, THIEF, FIGHTER] })];
  check("both seats loaded the dialog and the trap module", installed.every((i) => i.ok), installed);
  const census = { gm: await run(gm, P.census), player: await run(player, P.census) };
  check("the GM seat is a GM and its window leads its seat's election", census.gm.isGM && census.gm.election?.isLead === true, { isGM: census.gm.isGM, lead: census.gm.election?.isLead });
  // A Judge's own press rolls on its own client; a player's relay is answered by
  // the active GM, which with another lane seated is that lane's window. The
  // rigged half of section F needs this seat to be the one answering.
  const answersRelays = census.gm.activeGMIsSelf;
  note("the GM seat is the active GM, so it answers the Player's relays", answersRelays);
  check("the Player seat is a player", !census.player.isGM && census.player.role <= 2, { role: census.player.role });
  if (census.gm.election?.isLead !== true) blocked("another window leads the GM seat; the throws would roll there, on dice this walk does not rig");
  if (census.player.isGM) blocked("the player seat is a GM");
  const playerId = census.player.userId;

  section("A. setup: fixtures at their start shape");
  // The setup subject: the previous run's marked cards and the fighter's tools are retired by marker before anything is built.
  let misses = 0;
  for (let n = 1; misses < 5; n++) {
    const r = await gm.retire(`formation/trapbreak-card-${n}`, "ChatMessage");
    misses = r.removed.length || r.missing.length || r.failed.length ? 0 : misses + 1;
  }
  const scene = await gm.fixture("formation/trapbreak-scene", "Scene", { name: `QA Trapbreak Ground${TAG}`, active: false, navigation: false, width: 2000, height: 1000, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  // Both seats view the scene before any wall write: a wall update off-canvas throws in core.
  const viewed = { gm: await run(gm, P.viewScene, { sceneId: scene.id }), player: await run(player, P.viewScene, { sceneId: scene.id }) };
  check("both seats view the walk's scene", viewed.gm.viewed && viewed.player.viewed, { gm: viewed.gm.viewed, player: viewed.player.viewed });
  if (!viewed.gm.viewed) blocked("the GM seat could not view the walk's scene, and a wall write off-canvas throws");
  const party = await gm.fixture("formation/trapbreak-party", "Actor", { name: PARTY, type: `${SCOPE}.party` });
  const thief = await gm.fixture("formation/trapbreak-thief", "Actor", character(THIEF));
  const fighter = await gm.fixture("formation/trapbreak-fighter", "Actor", character(FIGHTER, { ownership: { default: 0, [playerId]: 3 } }));
  note("fighter's tools retired",await gm.retire("formation/trapbreak-fighter-tools", "Item", { parent: fighter.uuid }));
  const trap = await gm.fixture("formation/trapbreak-trap", "Item", { name: "QA Trapbreak Trap", type: `${SCOPE}.trap`, system: { triggerOn: 0 } });
  const skill = await gm.fixture("formation/trapbreak-thief-skill", "Item", {
    name: "QA Trapbreaking", type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 0 },
    flags: { [SCOPE]: { checkKey: "trapbreak", extras: { rolls: [{ key: "primary", label: "Trapbreaking", rollType: "above", scale: "level", target: { kind: "flat", flat: INVENTED.thief } }] } } },
  }, { parent: thief.uuid });
  await gm.fixture("formation/trapbreak-thief-tools", "Item", { name: TOOLS, type: "item" }, { parent: thief.uuid });
  const wall = await gm.fixture("formation/trapbreak-wall", "Wall", {
    c: [300, 450, 700, 450], move: 0, sight: 0, sound: 0, light: 0,
    flags: { [SCOPE]: { trap: { trapUuid: trap.uuid, state: "armed", repeatLock: {} } } },
  }, { parent: scene.uuid });

  let place = null;
  let region = null;
  let thingUuid = null;
  try {
    place = await gm.fixture("formation/trapbreak-place", "Actor", { name: `QA Trapbreak Place${TAG}`, type: `${SCOPE}.location` });
    region = await gm.fixture("formation/trapbreak-region", "Region", {
      name: `QA Trapbreak Region${TAG}`, color: "#3366aa",
      shapes: [{ type: "rectangle", x: 0, y: 0, width: 2000, height: 1000, rotation: 0, hole: false }],
    }, { parent: scene.uuid });
    const linked = await run(gm, P.linkPlace, { regionUuid: region.uuid, placeId: place.id });
    if (linked.error || !linked.linked || !linked.mirror) throw new Error(linked.error ?? "the region and the place did not link both ways");
    await run(gm, P.shapeThing, { placeId: place.id, trapUuid: trap.uuid, hidden: true });
    thingUuid = `${place.uuid}::thing-1`;
  } catch (err) {
    note("note", `the trap thing through its place is skipped: ${err?.message ?? err}`);
    thingUuid = null;
  }

  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  const shape = await run(gm, P.startShape, { fid, partyId: party.id, sceneId: scene.id, members: [thief.id, fighter.id] });
  note("start shape", shape);
  check("the thief and the fighter are in the party on the walk's scene, its token there, no fight, not paused",
    shape.members.length === 2 && shape.members.includes(thief.id) && shape.members.includes(fighter.id) && shape.sceneId === scene.id && shape.partyToken && !shape.combat && !shape.paused, shape);
  if (!shape.partyToken) blocked("the party has no token on the walk's scene");
  const geo = await run(gm, P.geometry, { fid, sceneId: scene.id, wallUuid: wall.uuid, trapUuid: trap.uuid });
  check("the trapped wall lies through the party token's centre and names the trap Item", geo.moved === true && geo.bound === true, geo);
  note("reach imported (a figure the importer wrote; none ships)", geo.reachImported);
  const sf = await run(gm, P.shapeFighter, { actorId: fighter.id, playerId, figure: INVENTED.fighter });
  await run(gm, P.shapeSkill, { uuid: skill.uuid, target: INVENTED.thief });
  const gear = { thief: await run(gm, P.carried, { actorId: thief.id }), fighter: await run(gm, P.carried, { actorId: fighter.id }) };
  check("the fighter is owned by the Player seat, carries no tools and no Trapbreaking skill, and has its own figure", sf.owned && sf.figure && gear.fighter.tools === 0 && gear.fighter.skills === 0, { sf, fighter: gear.fighter });
  check("the thief carries tools and the Trapbreaking skill", gear.thief.tools === 1 && gear.thief.skills === 1, gear.thief);
  const uuids = thingUuid ? [wall.uuid, thingUuid] : [wall.uuid];
  const near = await run(gm, P.reach, { fid, uuids });
  check("the wall, and the thing where one is held, are within the party's reach", Object.values(near).every(Boolean), near);
  if (!near[wall.uuid]) blocked("the wall is not within the party's reach, so no step could be driven");
  if (thingUuid && !near[thingUuid]) { note("note", "the trap thing is out of reach: its rows are not walked"); thingUuid = null; }
  const E = await run(gm, P.expect, { party: PARTY, thief: THIEF, fighter: FIGHTER });
  const S = { sceneId: scene.id };
  const trapOf = (api, uuid) => run(api, P.readTrap, { ...S, uuid });
  const unfoundTexts = { wall: `${E.state.armed} · ${E.unfound}` };

  /* ---------------------------------------------------------------- */
  section("B. the Judge seat, warned");
  await run(gm, P.closeWins);
  await run(player, P.closeWins);
  let st = await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "found" });
  if (thingUuid) await run(gm, P.setTrap, { ...S, uuid: thingUuid, to: "unfound" });
  check("start: the wall is found, the fighter carries no tools", st.state === "found" && st.known === true && (await run(gm, P.carried, { actorId: fighter.id })).tools === 0, st);
  note("window opened", await run(gm, P.openWin, { fid, actorId: fighter.id, targetUuid: wall.uuid }));
  let w = await run(gm, P.winState, { fid, actorId: fighter.id });
  check("the window pins the wall and reads as the Judge's", w.open && w.ctx.isGM && w.ctx.chosen === wall.uuid, { gm: w.ctx?.isGM, chosen: w.ctx?.chosen === wall.uuid });
  check("the fighter is warned of the missing tools, with the Judge's go-ahead, and Work on it is enabled",
    w.ctx.warnings.length === 1 && w.ctx.warnings[0].text === E.noTools && w.ctx.warnings[0].advice === E.advice && w.ctx.canAttempt === true && w.ctx.refusal === null && w.dom.attemptDisabled === false,
    { warnings: w.ctx.warnings.length, canAttempt: w.ctx.canAttempt, enabled: w.dom.attemptDisabled === false });
  check("the chip on the page names the tools and ends with the Judge's go-ahead", w.dom.warnings.length === 1 && w.dom.warnings[0].includes(E.noTools) && w.dom.warnings[0].includes(E.advice), { chips: w.dom.warnings.length });
  check("the Judge's own modifier field and its Mark spotted / Rebuild controls are drawn", w.dom.judgeField && w.dom.resetButton, { field: w.dom.judgeField, rebuild: w.dom.resetButton });
  check("the fighter's throw is read from the character's own figure, not from a skill", w.ctx.hasThrow && w.ctx.needs && w.ctx.skilled === false, { hasThrow: w.ctx.hasThrow, needs: w.ctx.needs, skilled: w.ctx.skilled });

  // The gate answers before anything is rolled, through the function the press calls.
  const gateNoTools = await run(gm, P.gate, { fid, actorId: fighter.id, uuid: wall.uuid, judge: false });
  check("attemptDisarm without the Judge's say refuses for the missing tools and rolls nothing", gateNoTools.ok === false && gateNoTools.reason === "noTools", gateNoTools);

  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "unfound" });
  let polled = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { state: { uuid: wall.uuid, text: unfoundTexts.wall } } });
  const rowUnfound = polled.dom.targets.find((t) => t.uuid === wall.uuid);
  check("an unfound trap is listed dashed, with 'not found', and Work on it is disabled", polled.ok && rowUnfound?.unfound === true && polled.dom.attemptDisabled === true, { listed: !!rowUnfound, dashed: rowUnfound?.unfound, disabled: polled.dom.attemptDisabled });
  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "disarmed" });
  // Work on it is already disabled from the unfound state, so the redraw is told by its refusal.
  polled = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { refusal: E.disarmed } });
  w = await run(gm, P.winState, { fid, actorId: fighter.id });
  check("marked disarmed, the chip becomes a refusal and Work on it is disabled, with no press", polled.ok && w.ctx.canAttempt === false && w.ctx.refusal === E.disarmed && w.dom.refusal?.includes(E.disarmed) && w.ctx.warnings.length === 0,
    { polled: polled.ok, attemptDisabled: polled.dom?.attemptDisabled, canAttempt: w.ctx.canAttempt, refusalIsDisarmed: w.ctx.refusal === E.disarmed, onPage: !!w.dom.refusal, warnings: w.ctx.warnings?.length });
  const gateJudge = await run(gm, P.gate, { fid, actorId: fighter.id, uuid: wall.uuid, judge: true });
  check("even the Judge's attemptDisarm is refused on a trap already disarmed", gateJudge.ok === false && gateJudge.reason === "alreadyDisarmed", gateJudge);

  // The thief, for contrast: a skilled thrower with tools carries nothing to be warned of.
  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "found" });
  await run(gm, P.openWin, { fid, actorId: thief.id, targetUuid: wall.uuid });
  const tw = await run(gm, P.winState, { fid, actorId: thief.id });
  check("the thief, with the skill and tools, has a throw, no warning and Work on it enabled", tw.open && tw.ctx.hasThrow && tw.ctx.skilled === true && tw.ctx.warnings.length === 0 && tw.ctx.canAttempt === true && tw.dom.attemptDisabled === false, { hasThrow: tw.ctx?.hasThrow, skilled: tw.ctx?.skilled, warnings: tw.ctx?.warnings.length, canAttempt: tw.ctx?.canAttempt });
  await run(gm, P.closeWins);

  // The press: one real click on the Judge's seat, a made throw.
  note("window opened", await run(gm, P.openWin, { fid, actorId: fighter.id, targetUuid: wall.uuid }));
  const pressReady = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { attempt: "enabled" } });
  check("start of the press: the wall is found and Work on it is enabled", pressReady.ok, pressReady.dom && { enabled: pressReady.dom.attemptDisabled === false });
  check("the GM page's dice are rigged to a natural 20", await rigGm());
  let since = await run(gm, P.nowMs);
  const pressed = await run(gm, P.press, { fid, actorId: fighter.id });
  check("Work on it was pressed in the window", pressed.pressed, pressed);
  const beaten = await run(gm, P.waitTrap, { ...S, uuid: wall.uuid, state: "disarmed" });
  check("the trap reads disarmed as the card is made, before any answer", beaten.ok, beaten);
  let cards = await run(gm, P.cards, { since, needles: E.needles, wait: "title", tries: 30 });
  check("one card whispered to the Judges, naming the title and the fighter", cards.filter((c) => c.toJudges && c.has.title && c.has.fighter).length === 1, cards.map((c) => ({ judges: c.toJudges, title: c.has.title, fighter: c.has.fighter })));
  check("the dice are the world's own again once the card is made", await unrigGm());
  const dlgGM = await run(gm, P.dialogState, { tries: 40, every: 150, name: FIGHTER });
  check("the question opens on the Judge's own seat, naming the fighter", dlgGM.open && dlgGM.nameShown, dlgGM);
  const left = await run(gm, P.answerDialog, { action: "disarm" });
  check("Leave disarmed closes the question", left.clicked && left.closed, left);
  await sleep(1500);
  st = await trapOf(gm, wall.uuid);
  cards = await run(gm, P.cards, { since, needles: E.needles });
  check("the trap stays disarmed, and no discharge line was whispered", st?.state === "disarmed" && cards.filter((c) => c.has.discharged).length === 0, { state: st?.state, discharged: cards.filter((c) => c.has.discharged).length });
  note("cards claimed", await claimCards(gm));
  await run(gm, P.closeWins);

  /* ---------------------------------------------------------------- */
  section("C. the Player seat, blocked");
  // Non-vacuous: with the wall unfound the Judge lists what the Player does not.
  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "unfound" });
  if (thingUuid) await run(gm, P.setTrap, { ...S, uuid: thingUuid, to: "unfound" });
  check("start: the fighter carries no tools, and the wall and the thing are unfound", (await run(gm, P.carried, { actorId: fighter.id })).tools === 0 && (await trapOf(gm, wall.uuid))?.known === false, {});
  await run(gm, P.openWin, { fid, actorId: fighter.id });
  await run(player, P.openWin, { fid, actorId: fighter.id });
  const gmList = await run(gm, P.winState, { fid, actorId: fighter.id });
  const plList = await run(player, P.winState, { fid, actorId: fighter.id });
  check("unfound, the Judge's window lists the traps (dashed) and the Player's lists none", gmList.dom.targets.length === (thingUuid ? 2 : 1) && gmList.dom.targets.every((t) => t.unfound) && plList.dom.targets.length === 0 && plList.ctx.targets.length === 0,
    { judge: gmList.dom.targets.length, expected: thingUuid ? 2 : 1, player: plList.dom.targets.length });
  await run(gm, P.markFound, { ...S, uuid: wall.uuid });
  polled = await run(player, P.pollWin, { fid, actorId: fighter.id, until: { count: 1 } });
  check("marked found from outside, the Player's window draws the wall with nothing pressed", polled.ok && polled.dom.targets[0]?.uuid === wall.uuid, { listed: polled.dom?.targets.length });
  const pl = await run(player, P.winState, { fid, actorId: fighter.id });
  check("the Player's window lists only found traps, never the unfound thing", pl.ctx.targets.length === 1 && pl.ctx.targets.every((t) => t.known) && !pl.ctx.targets.some((t) => t.uuid === thingUuid) && pl.ctx.chosen === wall.uuid,
    { listed: pl.ctx.targets.length, thingListed: pl.ctx.targets.some((t) => t.uuid === thingUuid) });
  check("the Player's window reads as a player's, with the refusal for the missing tools and Work on it disabled", !pl.ctx.isGM && pl.ctx.refusal === E.noTools && pl.ctx.warnings.length === 0 && pl.ctx.canAttempt === false && pl.dom.attemptDisabled === true && !!pl.dom.refusal?.includes(E.noTools),
    { gm: pl.ctx.isGM, refusal: pl.ctx.refusal === E.noTools, canAttempt: pl.ctx.canAttempt, disabled: pl.dom.attemptDisabled });
  check("the modifier field is drawn for the Player, with no Mark spotted and no Rebuild, and only the Player's own character is offered", !!pl.dom.judgeField && !pl.dom.markFound && !pl.dom.resetButton && pl.dom.warnings.length === 0 && pl.dom.actorOptions.length === 1 && pl.dom.actorOptions[0] === fighter.id,
    { field: pl.dom.judgeField, buttons: pl.dom.markFound || pl.dom.resetButton, options: pl.dom.actorOptions.length });
  // The fighter gets tools while the Player's window is open: it draws again and Work on it enables with no press.
  await gm.fixture("formation/trapbreak-fighter-tools", "Item", { name: TOOLS, type: "item" }, { parent: fighter.uuid });
  polled = await run(player, P.pollWin, { fid, actorId: fighter.id, until: { attempt: "enabled" } });
  const plTools = await run(player, P.winState, { fid, actorId: fighter.id });
  check("tools given while the window is open: it redraws and Work on it enables with nothing pressed", polled.ok && plTools.ctx.canAttempt === true && plTools.ctx.refusal === null, { enabled: polled.ok, canAttempt: plTools.ctx.canAttempt });
  await run(gm, P.closeWins);
  await run(player, P.closeWins);

  /* ---------------------------------------------------------------- */
  section("D. two windows");
  const o1 = await run(gm, P.openWin, { fid, actorId: thief.id });
  const o2 = await run(gm, P.openWin, { fid, actorId: fighter.id });
  check("each character's window takes its own id, the pair's", o1.id === o1.expectId && o2.id === o2.expectId && o1.id !== o2.id, { distinct: o1.id !== o2.id });
  const again = await run(gm, P.reopen, { fid, actorId: thief.id });
  check("opening the thief again fronts the first window and adds no third", again.same && again.count === 2, { same: again.same, count: again.count });
  const t1 = await run(gm, P.winState, { fid, actorId: thief.id });
  const t2 = await run(gm, P.winState, { fid, actorId: fighter.id });
  check("each title bar reads the title, the party and the character", t1.title === E.titles.thief && t2.title === E.titles.fighter, { thief: t1.title === E.titles.thief, fighter: t2.title === E.titles.fighter });
  await run(gm, P.closeWins);

  /* ---------------------------------------------------------------- */
  section("E. the redraw");
  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "found" });
  await run(gm, P.openWin, { fid, actorId: fighter.id, targetUuid: wall.uuid });
  polled = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { state: { uuid: wall.uuid, text: E.state.found } } });
  check("start: the open window lists the wall as found", polled.ok, { listed: !!polled.dom });
  await run(gm, P.rebuild, { ...S, uuid: wall.uuid });
  polled = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { state: { uuid: wall.uuid, text: unfoundTexts.wall } } });
  check("rebuilt from outside, the window's state reads armed and not found with no press", polled.ok, { text: polled.ok });
  polled = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { markFound: true } });
  check("and offers Mark spotted again", polled.ok, { markFound: polled.dom?.markFound });
  await run(gm, P.markFound, { ...S, uuid: wall.uuid });
  polled = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { state: { uuid: wall.uuid, text: E.state.found } } });
  check("marked spotted from outside, the state reads found again with no press", polled.ok, { text: polled.ok });
  polled = await run(gm, P.pollWin, { fid, actorId: fighter.id, until: { markFound: false } });
  check("and Mark spotted is gone", polled.ok, { markFound: polled.dom?.markFound });
  await run(gm, P.closeWins);

  /* ---------------------------------------------------------------- */
  section("F. the question on the Player seat (step 11)");
  await run(gm, P.closeWins);
  await run(player, P.closeWins);
  st = await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "found" });
  const carriedF = await run(gm, P.carried, { actorId: fighter.id });
  check("start: the wall is found, the fighter carries tools, the Player owns the fighter", st.state === "found" && st.known === true && carriedF.tools === 1 && sf.owned, { state: st.state, tools: carriedF.tools });
  note("player window opened", await run(player, P.openWin, { fid, actorId: fighter.id }));
  polled = await run(player, P.pollWin, { fid, actorId: fighter.id, until: { attempt: "enabled" } });
  const pw = await run(player, P.winState, { fid, actorId: fighter.id });
  check("the Player's window pins the found wall with Work on it enabled and no warning", polled.ok && pw.ctx.chosen === wall.uuid && pw.ctx.canAttempt && pw.dom.warnings.length === 0, { enabled: polled.ok, chosen: pw.ctx.chosen === wall.uuid });
  const censusP = await run(player, P.census);
  note("the Player seat's automationCensus", censusP.election);
  check("the Player seat's window leads its own seat's election, so the question can reach it", censusP.election?.isLead === true, { lead: censusP.election?.isLead, error: censusP.election?.error ?? null });

  if (!answersRelays) {
    note("NOT WALKED: the rigged question half of step 11", "another lane's GM is the active GM and answers the Player's relay on dice this walk does not rig; rerun with no other GM seated");
  } else {
  // First attempt, answered Discharge.
  check("the GM page's dice are rigged to a natural 20", await rigGm());
  since = await run(gm, P.nowMs);
  const pp = await run(player, P.press, { fid, actorId: fighter.id });
  check("Work on it was pressed in the Player's own window", pp.pressed, pp);
  const dlgP = await run(player, P.dialogState, { tries: 80, every: 150, name: FIGHTER });
  check("'The trap is beaten' opens on the PLAYER's seat, naming the fighter", dlgP.open && dlgP.nameShown, dlgP);
  const dlgGM2 = await run(gm, P.dialogState, { tries: 1 });
  check("and not on the Judge's seat", dlgGM2.open === false, dlgGM2);
  cards = await run(gm, P.cards, { since, needles: E.needles, wait: "title", tries: 30 });
  check("the Judge's chat holds the card, whispered to the Judges, naming the fighter", cards.filter((c) => c.toJudges && c.has.title && c.has.fighter).length === 1, cards.map((c) => ({ judges: c.toJudges, title: c.has.title, fighter: c.has.fighter })));
  check("and one public line says the fighter works on the trap", cards.filter((c) => c.isPublic && c.has.declared).length === 1, cards.map((c) => ({ isPublic: c.isPublic, declared: c.has.declared })));
  check("the dice are the world's own again once the card is made", await unrigGm());
  const whileOpen = { gm: await trapOf(gm, wall.uuid), player: await trapOf(player, wall.uuid) };
  check("while the question is open the trap reads disarmed on both seats", whileOpen.gm?.state === "disarmed" && whileOpen.player?.state === "disarmed", { gm: whileOpen.gm?.state, player: whileOpen.player?.state });
  const dis = await run(player, P.answerDialog, { action: "discharge" });
  check("Discharge is clicked on the Player's seat and the question closes", dis.clicked && dis.closed, dis);
  const spent = await run(gm, P.waitTrap, { ...S, uuid: wall.uuid, state: "discharged", tries: 60 });
  check("the trap reads discharged on the Judge's seat", spent.ok, spent);
  cards = await run(gm, P.cards, { since, needles: E.needles, wait: "discharged", tries: 30 });
  check("one line is whispered to the Judges for the discharge", cards.filter((c) => c.toJudges && c.has.discharged).length === 1, cards.map((c) => ({ judges: c.toJudges, discharged: c.has.discharged })));
  note("cards claimed", await claimCards(gm));

  // Second attempt: the Judge rebuilds while the question is open.
  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "found" });
  polled = await run(player, P.pollWin, { fid, actorId: fighter.id, until: { attempt: "enabled" } });
  check("start: the wall is found again and the Player's window enables Work on it", polled.ok, { enabled: polled.ok });
  check("the GM page's dice are rigged to a natural 20", await rigGm());
  since = await run(gm, P.nowMs);
  await run(player, P.press, { fid, actorId: fighter.id });
  const dlgP2 = await run(player, P.dialogState, { tries: 80, every: 150 });
  check("the question opens on the Player's seat again", dlgP2.open, dlgP2);
  await run(gm, P.cards, { since, needles: E.needles, wait: "title", tries: 30 });
  await unrigGm();
  const mid = await run(gm, P.waitTrap, { ...S, uuid: wall.uuid, state: "disarmed" });
  check("the trap reads disarmed while it is open", mid.ok, mid);
  await run(gm, P.rebuild, { ...S, uuid: wall.uuid });
  const rebuilt = await trapOf(gm, wall.uuid);
  check("the Judge rebuilds it with the question open: armed and unfound", rebuilt?.state === "armed" && rebuilt?.known === false, rebuilt);
  const dis2 = await run(player, P.answerDialog, { action: "discharge" });
  check("Discharge is clicked afterwards and the question closes", dis2.clicked && dis2.closed, dis2);
  await sleep(2500);
  const after = await trapOf(gm, wall.uuid);
  cards = await run(gm, P.cards, { since, needles: E.needles });
  check("the later Discharge leaves the rebuilt trap armed, and whispers no discharge line", after?.state === "armed" && after?.known === false && cards.filter((c) => c.has.discharged).length === 0, { state: after?.state, discharged: cards.filter((c) => c.has.discharged).length });
  note("cards claimed", await claimCards(gm));
  }

  // A relay for a member the seat does not own writes nothing.
  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "found" });
  await rigGm();
  since = await run(gm, P.nowMs);
  const relaySent = await run(player, P.relay, { fid, actorId: thief.id, targetUuid: wall.uuid });
  await unrigGm();
  if (relaySent.error) note("the relay was refused before any GM ran it (another lane's client answered); the check below then proves nothing about the refusal", relaySent.error);
  const relayed = await trapOf(gm, wall.uuid);
  cards = await run(gm, P.cards, { since, needles: E.needles });
  check("a relayed request for the thief, whom the Player does not own, writes nothing and posts nothing", relayed?.state === "found" && cards.length === 0, { state: relayed?.state, cards: cards.length });
  check("and no question is open on either seat", (await run(player, P.dialogState, { tries: 1 })).open === false && (await run(gm, P.dialogState, { tries: 1 })).open === false);

  section("G. figures, the footer, the Character switch and the Dungeon tab (step 8)");
  await run(gm, P.closeWins);
  await run(gm, P.setTrap, { ...S, uuid: wall.uuid, to: "found" });
  note("thief window opened", await run(gm, P.openWin, { fid, actorId: thief.id }));
  polled = await run(gm, P.pollWin, { fid, actorId: thief.id, until: { attempt: "enabled" } });
  const fig = await run(gm, P.figures, { fid, actorId: thief.id });
  check("the throw needed hovers its source with a page", fig.needs.tipped && fig.needs.cites, fig.needs);
  check("every part of the throw hovers its source", fig.parts.count > 0 && fig.parts.tipped === fig.parts.count, fig.parts);
  check("the reach hovers its source with a page", fig.reach.tipped && fig.reach.cites, fig.reach);
  check("Work on it hovers the throw, and nothing in the window uses a title attribute", fig.attempt.tipped && fig.titles === 0, { attempt: fig.attempt, titles: fig.titles });
  const ft = await run(gm, P.footer, { fid, actorId: thief.id, height: 260 });
  check("the footer is its own part, apart from the body", !!ft.footerPart && ft.footerPart !== ft.bodyPart, { footer: ft.footerPart, body: ft.bodyPart });
  check("made short, the body scrolls and Work on it stays inside the window", ft.footerInside && ft.attemptVisible && ft.bodyScrolls, ft);
  const sw = await run(gm, P.switchActor, { fid, fromId: thief.id, toId: fighter.id });
  check("picking the fighter in the Character select closes the thief's window and opens the fighter's", sw.select && sw.opened && sw.actorShown && sw.firstClosed, sw);
  const dg = await run(gm, P.dungeonOpener, { fid, partyId: party.id });
  check("the party sheet's Dungeon tab shows the Trapbreaking pill, and pressing it opens the party's dialog", dg.sheet && dg.button && dg.visible && dg.opened && dg.forParty, dg);
  await run(gm, P.closeWins);

  section("errors since the walk attached");
  for (const [key, api] of Object.entries(open)) {
    const errs = await run(api, P.errors);
    check(`${key} seat: nothing thrown since the recorder attached after ready`, errs.length === 0, errs.slice(0, 5));
  }
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  tally.fail += 1;
  process.exitCode = 1;
} finally {
  section("teardown");
  for (const [key, api] of Object.entries(open)) {
    try {
      const un = await run(api, P.unrig);
      note(`${key} seat dice restored`, un);
    } catch (err) { console.error(`${key} unrig:`, err?.message ?? err); }
    try {
      // A question a failed step left open is answered with the safe choice, never left to hold the next run.
      for (let n = 0; n < 3; n++) {
        const d = await run(api, P.dialogState, { tries: 1 });
        if (!d.open) break;
        await run(api, P.answerDialog, { action: "disarm" });
      }
      await run(api, P.closeWins);
    } catch (err) { console.error(`${key} close:`, err?.message ?? err); }
  }
  if (open.gm) {
    try { note("cards claimed at teardown", await claimCards(open.gm)); } catch (err) { console.error("claim:", err?.message ?? err); }
    note("ledger (built this run)", open.gm.tracked());
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch { /* closed */ } }
}
