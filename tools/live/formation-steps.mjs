/**
 * Live walk: docs/formation/TESTING.md, the dungeon steps, the encounter card,
 * the day's close and the city stay. The GM seat is the active GM; whatever
 * the recipe asks of a player is driven from the player seat.
 *
 * Covers:
 *   "Steps" 13   the door dialog: construction and the axe figure, a door an
 *                axe cannot beat, the two Judge's marks, the botched heave's
 *                rebound line, the batter charged to the basher's formation
 *                and the no-formation case.
 *   "Steps" 11a  Leave behind / Go back for them from the player seat, and the
 *                refusal whispered during a fight.
 *   "Steps" 14   the forced march barred by a marcher's survival rung: the
 *                sheet's confirm (refuse, override, asked again), a plain rung,
 *                the API bar on both seats, the dusk offer's Push on, and the
 *                Day section absent on the player seat.
 *   "End day, the whole tick" 1   End day posts no navigation card.
 *   "The day's end" 5             Call it a day: the closer, no navigation
 *                                 card, the clock at the next dawn.
 *   "The encounters" (with "The day change" 8)   the card's two sight lines
 *                agree with the distance it prints and the sky's visibility,
 *                and the message carries the same facts as flags.
 *   "The city" 9b  a stay draws what found it day by day, by day and after
 *                dark, leaves no marker and no promote button; quiet, unpriced
 *                and no-list stays.
 *
 * Every fixture and figure is invented. The fixtures are kept and found again
 * by marker (`api.fixture`): the scenes `formation/steps-doors`,
 * `formation/steps-march` and `formation/steps-city`; the doors
 * `formation/steps-door-1` and `-2`; the parties `formation/steps-door-party`,
 * `-rearguard`, `-march-party` and `-city-party`, each with its token
 * (`<party>-token`); the characters `formation/steps-basher`, `-stranger`,
 * `-fallen-owned`, `-fallen-judge`, `-hungry` and `-fed`, the basher's and the
 * stranger's tokens (`<name>-token`); and the city list
 * `formation/steps-city-list`. Each step brings what it reads to shape at its
 * start: every party's record as a new one holds it (`P.reset`: no travel, a
 * fresh clock), the doors closed and unmarked, the hit points, the walkers'
 * survival rungs, no member left behind, no fight on the rearguard, the march
 * on Dedicated march. The march party's
 * drag steps toward the scene's middle, so a kept token never walks off it.
 * Every chat card the walk reads is a create path's product: it is marked
 * `formation/steps-card-<n>` in the order posted, and the next run retires the
 * last run's before its first step, as it does a token a member was left
 * behind as (`formation/steps-left-token`). The documents registered at
 * priority 30 (`travel`, `encounters`, `cityTravel`) are unregistered at
 * teardown; the settings `travelEncounters`, `advanceWorldTime` and
 * `transientIncidentTurns` are restored; the dice rig and the notification
 * patches are undone. The world clock moves forward (End day, the stay) and is
 * reported, not set back.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats, PORTS, shotDir } from "./_env.mjs";

const MOD = "acks-extras";
const SHOTS = process.env.SHOTS === "1";

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
  census: async (mod) => {
    const read = (k) => { try { return game.settings.get(mod, k); } catch (_e) { return undefined; } };
    // Core elects a user; every window on it hears each hook, and the seat's own election picks the one that runs the automation.
    let election;
    try {
      const ac = await import(`/modules/${mod}/scripts/lib/automation-client.mjs`);
      await Promise.race([ac.automationSettled(), new Promise((r) => setTimeout(r, 5000))]);
      election = { isLead: ac.isLeadClient(), ...(ac.automationCensus() ?? { joined: false }) };
    } catch (err) { election = { error: err?.message ?? String(err) }; }
    return {
      module: game.modules.get(mod)?.version ?? null,
      role: game.user.role,
      userId: game.user.id,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      election,
      gmIds: game.users.filter((u) => u.isGM).map((u) => u.id).sort(),
      settings: {
        travelEncounters: read("travelEncounters"), advanceWorldTime: read("advanceWorldTime"),
        transientIncidentTurns: read("transientIncidentTurns"), dawnHour: read("dawnHour"), duskHour: read("duskHour"),
      },
      worldTime: game.time.worldTime,
    };
  },

  /** Helpers every other page function reaches through `globalThis.__d`. */
  install: async () => {
    const H = (globalThis.__d = globalThis.__d ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 25, every = 100 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.F = acksExtras.formation;
    H.T = acksExtras.formation.travel;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      model: await import(base + "formation/formation-model.mjs"),
      tables: await import(base + "lib/tables.mjs"),
      wt: await import(base + "lib/world-time.mjs"),
      setup: await import(base + "battlemap/scene-setup.mjs"),
      weather: await import(base + "formation/weather.mjs"),
      fx: await import(base + "formation/weather-effects.mjs"),
      enc: await import(base + "formation/encounters.mjs"),
    };
    H.formation = (id) => H.m.model.getFormation(id) ?? H.F.getFormations()[id] ?? null;
    H.parse = (html) => new DOMParser().parseFromString(html ?? "", "text/html");
    H.mine = (t0) => game.messages.contents.filter((m) => (m.author?.id ?? m.user?.id) === game.user.id && m.timestamp >= t0 - 50);
    H.uuids = (list) => list.map((m) => m.uuid);
    H.findDialog = (actions) => [...document.querySelectorAll("dialog, .application.dialog")]
      .find((d) => actions.every((a) => d.querySelector(`button[data-action="${a}"]`))) ?? null;
    if (!H.notesPatched) {
      H.notes = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.notesPatched = true;
    }
    H.takeNotes = () => H.notes.splice(0);
    // The dice rig reads from the top on core 14: a face sits at (faces - face + 0.5) / faces.
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
    return { ok: true, fresh: typeof acksExtras.formation.doors?.setDoorTraits === "function" && typeof acksExtras.formation.travel?.patchSettlement === "function" };
  },

  viewScene: async (sceneId) => {
    const scene = game.scenes.get(sceneId);
    await scene.view();
    const t0 = performance.now();
    while (!(canvas.ready && canvas.scene?.id === sceneId) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 3000));
    return { viewed: canvas.scene?.id === sceneId };
  },

  setSetting: async ({ mod, key, value }) => {
    await game.settings.set(mod, key, value);
    return { set: game.settings.get(mod, key) === value };
  },

  cellXY: async ({ sceneId, i, j }) => {
    const g = game.scenes.get(sceneId).grid;
    const tl = g.getTopLeftPoint({ i, j });
    return { x: tl.x, y: tl.y };
  },

  /**
   * The party's formation with the token adopted, every member enrolled by a
   * real drop on the sheet, and the mode set. A kept party already holds its
   * members, and core's drop of one already enrolled is not the step: only a
   * missing member is dropped, and a mode already set is not set again.
   */
  buildParty: async ({ partyId, sceneId, tokenId, memberIds, mode }) => {
    const H = globalThis.__d;
    const party = game.actors.get(partyId);
    const found = await H.poll(() => Object.values(H.F.getFormations()).find((f) => f.actorId === partyId), { tries: 50, every: 200 });
    if (!found) return { error: "no formation for the party actor" };
    const adopted = await H.poll(() => H.F.getFormations()[found.id]?.tokenId === tokenId, { tries: 100, every: 200 });
    const enrolled = [];
    const isMember = (id) => !!H.F.getFormations()[found.id]?.members?.some((m) => m?.actorId === id);
    const missing = memberIds.filter((id) => !isMember(id));
    if (missing.length) {
      const app = await party.sheet.render(true);
      await H.sleep(1500);
      const el = H.root(app);
      for (const id of missing) {
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
        el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await H.poll(() => isMember(id), { tries: 40, every: 200 });
      }
      try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    }
    for (const id of memberIds) enrolled.push(isMember(id));
    if (mode && H.T.travelOf(H.formation(found.id)).mode !== mode) { await H.T.setJourneyMode(found.id, mode, { sceneId }); await H.sleep(800); }
    const f = H.formation(found.id);
    return { formationId: found.id, adopted: !!adopted, enrolled, dropped: missing.length, mode: H.T.travelOf(f).mode };
  },

  /** A member the last run left behind is gone back for through the GM seat's own sheet control. */
  goneBackFor: async ({ fid, partyId, actorId }) => {
    const H = globalThis.__d;
    const left = () => !!H.formation(fid)?.members?.find((x) => x?.actorId === actorId)?.left;
    if (!left()) return { wasLeft: false, left: false };
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(1500);
    H.root(app)?.querySelector(`li.member[data-actor-id="${actorId}"] a[data-action="toggleLeftBehind"]`)?.click();
    await H.poll(() => !left(), { tries: 50, every: 200 });
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return { wasLeft: true, left: left() };
  },

  /** The party's formation put in `mode` where it is in another; returns the mode it holds. */
  setMode: async ({ partyId, mode }) => {
    const H = globalThis.__d;
    const f = Object.values(H.F.getFormations()).find((x) => x.actorId === partyId);
    if (!f) return { error: "no formation for the party actor" };
    const was = H.T.travelOf(f).mode;
    if (was !== mode) { await H.T.setJourneyMode(f.id, mode, {}); await H.sleep(800); }
    return { was, mode: H.T.travelOf(H.formation(f.id)).mode };
  },

  /** The token data an actor would place at `xy`, for the driver to build as a fixture. */
  tokenData: async ({ actorId, xy }) => (await game.actors.get(actorId).getTokenDocument({ x: xy.x, y: xy.y })).toObject(),

  /**
   * A kept party's record brought to the shape a new record has: no travel, a
   * fresh clock, no table, lights or spells. The members, the name and the
   * token's linkage stand.
   */
  reset: async ({ partyId }) => {
    const H = globalThis.__d;
    const f = await H.poll(() => Object.values(H.F.getFormations()).find((x) => x.actorId === partyId), { tries: 50, every: 200 });
    if (!f) return { error: "no formation for the party actor" };
    await H.m.model.patchFormation(f.id, (record) => {
      const lastPosition = record.clock?.lastPosition;
      delete record.travel;
      record.clock = { turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false, ...(lastPosition ? { lastPosition } : {}) };
      record.tableId = null;
      record.lights = [];
      record.spells = [];
      record.combat = null;
    });
    await H.sleep(600);
    return { fid: f.id, mode: H.T.travelOf(H.formation(f.id)).mode };
  },

  /** Hit points written onto a kept character, whatever the last run left. */
  setHp: async ({ actorId, hp }) => {
    const actor = game.actors.get(actorId);
    if (actor.system?.hp?.value !== hp) await actor.update({ "system.hp.value": hp });
    return { hp: game.actors.get(actorId).system?.hp?.value };
  },

  /** A kept door closed and carrying no marks of this module, whatever the last run left. */
  resetDoor: async ({ sceneId, wallId }) => {
    const wall = game.scenes.get(sceneId).walls.get(wallId);
    if (wall.ds !== 0) await wall.update({ ds: 0 });
    if (wall.getFlag("acks-extras", "door") !== undefined) await wall.unsetFlag("acks-extras", "door");
    return { ds: wall.ds, flag: wall.getFlag("acks-extras", "door") ?? null };
  },

  /* --- Steps 13: the door dialog ---------------------------------- */

  /** Select the door on the Walls layer, press the tool, then select the basher's token. */
  doorOpen: async ({ wallId, tokenId }) => {
    const H = globalThis.__d;
    const prior = foundry.applications.instances.get("acks-extras-door");
    if (prior) { try { await prior.close({ animate: false }); } catch (_e) { /* closed */ } }
    ui.controls.activate({ control: "walls", tool: "select" });
    await H.sleep(800);
    const wall = canvas.walls.get(wallId);
    const controlled = !!wall?.control({ releaseOthers: true });
    await H.sleep(300);
    const btn = document.querySelector('[data-tool="acksDoor"]');
    btn?.click();
    const app = await H.poll(() => { const a = foundry.applications.instances.get("acks-extras-door"); return a?.rendered ? a : null; }, { tries: 50, every: 100 });
    ui.controls.activate({ control: "tokens", tool: "select" });
    await H.sleep(800);
    const tok = canvas.tokens.get(tokenId);
    const tokenControlled = !!tok?.control({ releaseOthers: true });
    if (app) { await app.render(); await H.sleep(800); }
    const el = H.root(app);
    return {
      controlled, tool: !!btn, open: !!app, wallMatches: app?.wall?.id === wallId, tokenControlled,
      basher: !!app?.basher && app.basher.id === tok?.actor?.id,
      nameShown: el?.querySelector(".acks-extras-door-who strong")?.textContent.trim() === tok?.actor?.name,
    };
  },

  /** The door as stored on the wall and as the open dialog shows it; the axe figure is compared, never returned. */
  doorRead: async ({ sceneId, wallId }) => {
    const H = globalThis.__d;
    const D = acksExtras.formation.doors;
    const wall = game.scenes.get(sceneId).walls.get(wallId);
    const flag = wall.flags?.["acks-extras"]?.door ?? {};
    const state = D.doorState(wall);
    const el = H.root(foundry.applications.instances.get("acks-extras-door"));
    const axe = el ? [...el.querySelectorAll("fieldset")].at(-1) : null;
    const fig = axe?.querySelector("p strong")?.textContent.trim() ?? null;
    const kind = D.DOOR_KINDS[state.kind];
    return {
      flag: { kind: flag.kind ?? null, evil: flag.evil ?? null, jammed: flag.jammed ?? null, spikes: flag.spikes ?? null },
      stateMatchesFlag: state.kind === (flag.kind ?? state.kind) && state.evil === !!flag.evil && state.jammed === !!flag.jammed,
      spikes: state.spikes, ds: wall.ds,
      select: el?.querySelector('select[name="kind"]')?.value ?? null,
      evilBox: el?.querySelector('input[name="evil"]')?.checked ?? null,
      jammedBox: el?.querySelector('input[name="jammed"]')?.checked ?? null,
      axeBeats: kind?.batter != null,
      batterButton: !!axe?.querySelector('[data-action="batter"]'),
      figureFollows: kind?.batter != null && fig === String(kind.batter),
      tooSolidShown: axe?.querySelector(".hint")?.textContent.trim() === game.i18n.localize("ACKS-FORMATION.doors.tooSolid"),
    };
  },

  /** Change one field of the open dialog as a user would; the form submits on change. */
  doorInput: async ({ name, value }) => {
    const H = globalThis.__d;
    const el = H.root(foundry.applications.instances.get("acks-extras-door"));
    const input = el?.querySelector(`[name="${name}"]`);
    if (!input) return { found: false };
    if (input.type === "checkbox") input.checked = !!value; else input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(1500);
    return { found: true };
  },

  doorPlace: async () => {
    const app = foundry.applications.instances.get("acks-extras-door");
    app?.setPosition({ left: 16, top: 16 });
    await new Promise((r) => setTimeout(r, 500));
    return { placed: !!app, dialogs: document.querySelectorAll("dialog[open], .application.dialog").length };
  },

  /** Heave with the d20 rigged to `face`; read the card and the basher's hit points. */
  doorBash: async ({ face, actorId }) => {
    const H = globalThis.__d;
    const app = foundry.applications.instances.get("acks-extras-door");
    const el = H.root(app);
    const ctx = await app._prepareContext({});
    const actor = game.actors.get(actorId);
    const hp0 = actor.system?.hp?.value;
    const rig = await H.rig(face, 20);
    const t0 = Date.now();
    el.querySelector('[data-action="bash"]').click();
    await H.poll(() => H.mine(t0).length, { tries: 40, every: 100 });
    await H.sleep(800);
    H.unrig();
    const flavor = game.i18n.localize("ACKS-FORMATION.doors.bashFlavor");
    const msgs = H.mine(t0);
    const card = msgs.find((m) => m.flavor === flavor) ?? null;
    const doc = H.parse(card?.content);
    const strongs = [...doc.querySelectorAll("strong")].map((s) => s.textContent.trim());
    const ems = [...doc.querySelectorAll("em")].map((s) => s.textContent.trim());
    const damageHead = game.i18n.format("ACKS-FORMATION.doors.damageTo", { name: actor.name, damage: "" }).replace(/[:\s]+$/u, "");
    return {
      rigOk: rig.ok, missPossible: ctx.needs > face, card: !!card, uuids: H.uuids(msgs),
      damageLine: strongs.some((s) => s.startsWith(damageHead)),
      reportedNote: ems.includes(game.i18n.localize("ACKS-FORMATION.doors.damageIsReported")),
      hpUnchanged: actor.system?.hp?.value === hp0,
    };
  },

  /** Press Batter it down; compare the turns charged with the figure the dialog showed. */
  doorBatter: async ({ fid, sceneId, wallId, watch }) => {
    const H = globalThis.__d;
    const app = foundry.applications.instances.get("acks-extras-door");
    const el = H.root(app);
    const axe = [...el.querySelectorAll("fieldset")].at(-1);
    const shown = Number(axe.querySelector("p strong")?.textContent);
    const turns = () => Object.fromEntries(watch.map((id) => [id, H.formation(id)?.clock?.turnsTotal ?? 0]));
    const before = turns();
    const w0 = game.time.worldTime;
    H.takeNotes();
    const t0 = Date.now();
    axe.querySelector('[data-action="batter"]').click();
    await H.sleep(3000);
    // The charge is one formation write among the world's; a world that holds more formations takes longer to land it.
    if (fid) await H.poll(() => turns()[fid] - before[fid] === shown, { tries: 50, every: 200 });
    const notes = H.takeNotes();
    const after = turns();
    const f = fid ? H.formation(fid) : null;
    const expect = fid
      ? game.i18n.format("ACKS-FORMATION.doors.batteredDown", { turns: shown, formation: f?.name })
      : game.i18n.format("ACKS-FORMATION.doors.batteredNoClock", { turns: shown });
    const wall = game.scenes.get(sceneId).walls.get(wallId);
    const msgs = H.mine(t0);
    return {
      roseByShown: fid ? after[fid] - before[fid] === shown : null,
      shown, rose: fid ? after[fid] - before[fid] : null,
      othersStill: watch.filter((id) => id !== fid).every((id) => after[id] === before[id]),
      ds: wall.ds, noteOk: notes.some((n) => n.kind === "info" && n.text === expect),
      cards: msgs.length, uuids: H.uuids(msgs), worldTimeDelta: game.time.worldTime - w0,
    };
  },

  /* --- Steps 11a: leave behind ------------------------------------- */

  /** The Order tab's rows as this seat sees them. */
  orderRows: async ({ partyId, aId, bId }) => {
    const H = globalThis.__d;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(1800);
    const el = H.root(app);
    const label = (a) => {
      const t = a?.textContent.trim() ?? null;
      if (t === game.i18n.localize("ACKS-FORMATION.app.leaveBehind")) return "leave";
      if (t === game.i18n.localize("ACKS-FORMATION.app.goBackFor")) return "goBack";
      return t == null ? null : "other";
    };
    const row = (id) => el?.querySelector(`li.member[data-actor-id="${id}"]`);
    return {
      rowA: !!row(aId), casualtyA: !!row(aId)?.classList.contains("casualty"), linkA: label(row(aId)?.querySelector('a[data-action="toggleLeftBehind"]')),
      rowB: !!row(bId), linkB: !!row(bId)?.querySelector('a[data-action="toggleLeftBehind"]'),
    };
  },

  pressLeft: async ({ partyId, actorId }) => {
    const H = globalThis.__d;
    const el = H.root(game.actors.get(partyId).sheet);
    const a = el?.querySelector(`li.member[data-actor-id="${actorId}"] a[data-action="toggleLeftBehind"]`);
    if (!a) return { clicked: false };
    a.click();
    await H.sleep(3000);
    return { clicked: true };
  },

  /** The member's record once the relay has landed: polls for `left` to read `wait` (when given), then reports. A formation that is gone reports so rather than throwing. */
  memberState: async ({ fid, actorId, sceneId, wait = null }) => {
    const H = globalThis.__d;
    const member = () => H.formation(fid)?.members?.find((x) => x?.actorId === actorId) ?? null;
    if (wait !== null) await H.poll(() => !!member() && !!member().left === wait, { tries: 50, every: 200 });
    const f = H.formation(fid);
    if (!f) return { gone: true };
    const m = member();
    const scene = game.scenes.get(sceneId);
    const tok = m?.deployedTokenId ? scene.tokens.get(m.deployedTokenId) : null;
    const party = H.F.getPartyToken(f);
    const centre = (t) => H.T.tokenCentre(t, scene);
    const near = !!tok && !!party && Math.hypot(centre(tok).x - centre(party).x, centre(tok).y - centre(party).y) <= scene.grid.size * 2.5;
    return { left: !!m?.left, deployed: m?.deployedTokenId ?? null, detached: !!m?.detached, tokenUuid: tok?.uuid ?? null, near, combat: !!f.combat?.active };
  },

  /** Messages this seat authored since t0: the public lines naming `name` under `key`, and the whispers. */
  declarations: async ({ t0, name, keys }) => {
    const H = globalThis.__d;
    const msgs = H.mine(t0);
    const text = (m) => H.parse(m.content).body.textContent.trim();
    const out = {};
    for (const key of keys) {
      const line = game.i18n.format(`ACKS-FORMATION.request.${key}`, { name });
      out[key] = msgs.filter((m) => !(m.whisper?.length) && text(m).includes(line)).length;
    }
    const declined = game.i18n.localize("ACKS-FORMATION.request.leftBehindDeclined");
    const refusals = msgs.filter((m) => m.whisper?.length && text(m).includes(declined));
    return { ...out, publicCount: msgs.filter((m) => !(m.whisper?.length)).length, refusals: refusals.map((m) => ({ id: m.id, whisper: m.whisper })), uuids: H.uuids(msgs) };
  },

  setCombat: async ({ fid, value }) => {
    const H = globalThis.__d;
    let prior;
    await H.m.model.patchFormation(fid, (r) => { prior = r.combat ?? null; if (value) r.combat = value; else delete r.combat; });
    await H.sleep(600);
    return { prior, now: H.formation(fid)?.combat ?? null };
  },

  /** Whether a message is shown to this seat: its `visible` getter and its chat-log row. */
  seen: async ({ ids }) => ids.map((id) => {
    const m = game.messages.get(id);
    return { inCollection: !!m, visible: !!m?.visible, inLog: !!document.querySelector(`li.chat-message[data-message-id="${id}"]`) };
  }),

  /* --- Steps 14: the forced march bar ------------------------------- */

  /** `replace` clears what a kept actor carries first; without it the flag merges, as a write does. */
  setSurvival: async ({ actorId, value, replace = false }) => {
    const actor = game.actors.get(actorId);
    if (replace) await actor.unsetFlag("acks-extras", "survival");
    if (value) await actor.setFlag("acks-extras", "survival", value);
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true };
  },

  daySheet: async ({ partyId }) => {
    const H = globalThis.__d;
    const app = game.actors.get(partyId).sheet;
    if (!app.rendered) { await app.render(true); await H.sleep(1800); }
    const el = H.root(app);
    const sel = el?.querySelector('[data-section="day"] select[name="travel.day.kind"]');
    return { daySection: !!el?.querySelector('[data-section="day"]'), select: sel?.value ?? null };
  },

  /** Pick a day kind in the Day section; report the confirm it raised, if any. */
  pickDay: async ({ partyId, value, names }) => {
    const H = globalThis.__d;
    const el = H.root(game.actors.get(partyId).sheet);
    const sel = el?.querySelector('[data-section="day"] select[name="travel.day.kind"]');
    if (!sel) return { found: false };
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const dlg = await H.poll(() => H.findDialog(["yes", "no"]), { tries: 20, every: 100 });
    if (!dlg) await H.sleep(1500);
    const text = dlg?.textContent ?? "";
    return { found: true, dialog: !!dlg, names: names.map((n) => text.includes(n)) };
  },

  answer: async ({ actions, action }) => {
    const H = globalThis.__d;
    const dlg = H.findDialog(actions);
    if (!dlg) return { found: false };
    dlg.querySelector(`button[data-action="${action}"]`).click();
    await H.sleep(2000);
    return { found: true };
  },

  daySelect: async ({ partyId }) => {
    const H = globalThis.__d;
    await H.sleep(500);
    const el = H.root(game.actors.get(partyId).sheet);
    return el?.querySelector('[data-section="day"] select[name="travel.day.kind"]')?.value ?? null;
  },

  dayState: async ({ fid }) => {
    const H = globalThis.__d;
    const f = H.formation(fid);
    if (!f) return { gone: true };
    const t = H.T.travelOf(f);
    return {
      kind: t.day.kind, allTravel: (t.day.activities ?? []).length === 4 && t.day.activities.every((a) => a === "travel"),
      logLen: (t.log ?? []).length, dayCount: t.dayCount, hexesEntered: t.day.hexesEntered ?? 0, offered: !!t.day.offered,
      ground: t.ground, road: t.road,
    };
  },

  /** The Judge-whispered cards since t0 that name `names[0]`, and whether they name the others. */
  barCards: async ({ t0, names }) => {
    const H = globalThis.__d;
    const gm = game.users.filter((u) => u.isGM).map((u) => u.id).sort();
    const cards = H.mine(t0).filter((m) => m.whisper?.length && H.parse(m.content).body.textContent.includes(names[0]));
    return {
      count: cards.length, ids: cards.map((m) => m.id), uuids: H.uuids(H.mine(t0)),
      gmOnly: cards.every((m) => JSON.stringify([...m.whisper].sort()) === JSON.stringify(gm)),
      othersNamed: cards.some((m) => names.slice(1).some((n) => H.parse(m.content).body.textContent.includes(n))),
    };
  },

  apiDay: async ({ fid, kind, override = undefined, names }) => {
    const H = globalThis.__d;
    if (!H.formation(fid)) return { gone: true };
    H.takeNotes();
    let result;
    try { result = await H.T.setDayKind(fid, kind, override === undefined ? {} : { override }); }
    catch (err) { result = `threw: ${err?.message ?? err}`; }
    await H.sleep(800);
    const notes = H.takeNotes();
    return {
      result: result === false ? false : typeof result === "string" ? result : !!result,
      kind: H.T.travelOf(H.formation(fid)).day.kind,
      warned: notes.some((n) => n.kind === "warn" && n.text === game.i18n.format("ACKS-FORMATION.warn.forcedMarchBarred", { names: names[0] })),
    };
  },

  /** The player's view of the party sheet on the formation's scene. */
  playerDay: async ({ partyId, sceneId }) => {
    const H = globalThis.__d;
    try { await game.scenes.get(sceneId).view(); } catch (_e) { /* viewing is not the check */ }
    await H.sleep(2500);
    const actor = game.actors.get(partyId);
    const app = actor.sheet;
    await app.render(true);
    await H.sleep(2000);
    const el = H.root(app);
    const out = {
      rendered: !!el, daySection: !!el?.querySelector('[data-section="day"]'),
      select: !!el?.querySelector('select[name="travel.day.kind"]'),
      dialog: !!H.findDialog(["yes", "no"]), judgePart: !!el?.querySelector('[data-application-part="judge"]'),
      // A refused render (core warns and returns) is told apart from a bare sheet by these.
      level: actor.getUserLevel(game.user), editable: !!app.isEditable, warnings: H.takeNotes().filter((n) => n.kind === "warn").length,
    };
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return out;
  },

  patchDay: async ({ fid, patch }) => {
    const H = globalThis.__d;
    await H.m.model.patchFormation(fid, (r) => {
      const t = H.T.storedTravelOf(r);
      r.travel = { ...t, day: { ...t.day, ...patch } };
    });
    await H.sleep(500);
    return { ok: true };
  },

  /**
   * Drag the party token one cell toward the scene's middle column; answer the
   * day-end offer it raises. The token is a kept fixture, so a drag that only
   * ever went one way would walk it off the scene over enough runs.
   */
  dragOffer: async ({ fid, answer, rigFace = null, names = [] }) => {
    const H = globalThis.__d;
    const f = H.formation(fid);
    if (!f) return { gone: true };
    const tok = H.F.getPartyToken(f);
    if (!tok) return { error: "no party token" };
    const scene = tok.parent;
    const o = scene.grid.getOffset(H.T.tokenCentre(tok, scene));
    const middle = scene.grid.getOffset({ x: scene.dimensions.sceneX + scene.dimensions.sceneWidth / 2, y: scene.dimensions.sceneY + scene.dimensions.sceneHeight / 2 });
    const tl = scene.grid.getTopLeftPoint({ i: o.i, j: o.j < middle.j ? o.j + 1 : o.j - 1 });
    const rigOk = rigFace ? (await H.rig(rigFace, 20)).ok : null;
    const t0 = Date.now();
    const wDrag = game.time.worldTime;
    H.takeNotes();
    await tok.update({ x: tl.x, y: tl.y }, { animate: false });
    const dlg = await H.poll(() => H.findDialog(["end", "push", "later"]), { tries: 120, every: 100 });
    H.unrig();
    // The step itself runs the clock by the hours walked; the answer's advance is measured apart from it.
    const dragDelta = game.time.worldTime - wDrag;
    const titleOk = !!dlg && (dlg.querySelector(".window-title")?.textContent.trim() ?? "") === game.i18n.localize("ACKS-FORMATION.travel.dayEnd.title");
    const offeredAtDialog = !!H.formation(fid)?.travel?.day?.offered;
    const w0 = game.time.worldTime;
    const dawn = H.m.wt.untilNextDawn();
    const tAnswer = Date.now();
    if (dlg && answer) dlg.querySelector(`button[data-action="${answer}"]`).click();
    await H.sleep(4000);
    const notes = H.takeNotes();
    const nav = (m) => !!H.parse(m.content).querySelector(".acks-extras-nav-card");
    const answered = H.mine(tAnswer);
    return {
      rigOk, dialog: !!dlg, titleOk, offeredAtDialog, dragDelta, worldDelta: game.time.worldTime - w0, dawn,
      warned: notes.some((n) => n.kind === "warn" && names.length && n.text === game.i18n.format("ACKS-FORMATION.warn.forcedMarchBarred", { names: names[0] })),
      navOnAnswer: answered.filter(nav).length, uuids: H.uuids(H.mine(t0)),
    };
  },

  /* --- End day and the encounter card ------------------------------ */

  /** An invented `travel` layer at priority 30, merged over what the world holds; nothing of it is returned. */
  registerTravel: async ({ target }) => {
    const H = globalThis.__d;
    const lost = foundry.utils.mergeObject(H.m.tables.getTable("travel", "gettingLost") ?? {}, { forest: target }, { inplace: false });
    const bonus = { either: 2, both: 4 };
    H.m.tables.registerTable({ id: "travel", tables: { gettingLost: lost, navigationBonus: bonus } }, { priority: 30, source: "formation-steps" });
    return { forest: H.m.tables.getTable("travel", "gettingLost")?.forest === target };
  },

  unregister: async ({ id }) => {
    globalThis.__d.m.tables.unregisterTable(id, { priority: 30 });
    return { id };
  },

  country: async ({ fid, override }) => {
    const H = globalThis.__d;
    await H.T.applyTravelForm(fid, { override });
    await H.sleep(600);
    const t = H.T.travelOf(H.formation(fid));
    return Object.fromEntries(Object.keys(override).map((k) => [k, t[k] === override[k]]));
  },

  endDayApi: async ({ fid }) => {
    const H = globalThis.__d;
    if (!H.formation(fid)) return { gone: true };
    const t = H.T.travelOf(H.formation(fid));
    const before = { dayCount: t.dayCount, logLen: (t.log ?? []).length };
    const w0 = game.time.worldTime;
    const t0 = Date.now();
    await H.T.endDay(fid, { miles: 3, hexes: 1 });
    await H.sleep(2000);
    const a = H.T.travelOf(H.formation(fid));
    const msgs = H.mine(t0);
    return {
      dayUp: a.dayCount === before.dayCount + 1, logUp: (a.log ?? []).length === before.logLen + 1,
      navCards: msgs.filter((m) => !!H.parse(m.content).querySelector(".acks-extras-nav-card")).length,
      uuids: H.uuids(msgs), worldDelta: game.time.worldTime - w0,
    };
  },

  /** An invented `encounters` layer: every column a monster, one creature, one distance row, one sight table. */
  registerEncounters: async () => {
    const H = globalThis.__d;
    const all = (row) => Object.fromEntries(H.m.enc.ENCOUNTER_COLUMNS.map((c) => [c, [row]]));
    const rarity = Object.fromEntries(["civilized", "borderlands", "outlands", "unsettled"].map((k) => [k, [{ min: null, max: null, rarity: "common" }]]));
    H.m.tables.registerTable({
      id: "encounters",
      tables: {
        territory: all({ min: null, max: null, outcome: "monster" }),
        rarity,
        "monsters.grasslandFarm": { common: [{ min: null, max: null, name: "QQ Grass Prowler" }] },
        distance: { grassland: { dice: "2d6", mult: 10, avg: 70 } },
        visibility: { daylight: 100, formationScale: [{ min: null, max: 1, pct: 0 }, { min: 2, max: null, pct: 100 }], headCounts: {} },
      },
    }, { priority: 30, source: "formation-steps" });
    return { ok: H.m.tables.getTable("encounters", "visibility")?.daylight === 100 };
  },

  clearSky: async ({ fid }) => {
    const H = globalThis.__d;
    await H.m.model.patchFormation(fid, (r) => {
      const t = H.T.storedTravelOf(r);
      const w = t.weather ?? {};
      r.travel = { ...t, weather: { ...w, auto: false, temperature: "", precipitation: "", wind: "", footing: { ...(w.footing ?? {}), mud: "none", snow: false } } };
    });
    await H.sleep(500);
    return { ok: true };
  },

  /**
   * Post one encounter throw with a constant rng and hold the card to the
   * distance it prints and the sky's visibility; the flags to the card.
   */
  encounterCard: async ({ fid, r }) => {
    const H = globalThis.__d;
    if (!H.formation(fid)) return { gone: true, expect: {}, lineSays: {}, flagSays: {} };
    const chain = await H.F.encounters.postEncounterThrow(H.formation(fid), { rng: () => r });
    const msg = chain?.message ?? null;
    const flags = msg?.flags?.["acks-extras"]?.encounter ?? null;
    const doc = H.parse(msg?.content);
    const L = (k) => game.i18n.localize(`ACKS-FORMATION.travel.enc.${k}`);
    const ps = [...doc.querySelectorAll("p")];
    const distP = ps.find((p) => p.textContent.trim().startsWith(L("distanceLine")));
    const printed = distP ? parseInt(distP.querySelector("strong")?.textContent ?? "", 10) : null;
    const t = H.T.trueTravelOf(H.formation(fid));
    const fx = H.m.fx.weatherEffects(H.m.weather.conditionsOf(t.weather), { terrain: t.ground });
    const heads = H.m.enc.headEquivalents({ men: H.m.model.realMembers(H.formation(fid)).filter((m) => !m.left).length });
    const partyCap = H.m.enc.visibilityMax({ light: "daylight", heads, weather: fx.visibility });
    const monCap = H.m.enc.visibilityMax({ light: "daylight", heads: 1, weather: fx.visibility });
    const start = Math.min(printed, Math.max(partyCap ?? printed, monCap ?? printed));
    const expect = { partySees: monCap == null || start <= monCap, monstersSee: partyCap == null || start <= partyCap };
    const sightP = ps.find((p) => [L("partySees"), L("partyBlind")].some((s) => p.textContent.includes(s)));
    const sightText = sightP?.textContent ?? "";
    const lineSays = {
      partySees: sightText.includes(L("partySees")) ? true : sightText.includes(L("partyBlind")) ? false : null,
      monstersSee: sightText.includes(L("monstersSee")) ? true : sightText.includes(L("monstersBlind")) ? false : null,
    };
    return {
      uuid: msg?.uuid ?? null, outcome: flags?.outcome ?? null, terrain: flags?.terrain ?? null, skyClear: !fx.visibility || (!fx.visibility.feet && !fx.visibility.factor),
      printed, flagDistance: flags?.distance ?? null, flagStart: flags?.start ?? null, expectStart: start,
      expect, lineSays, flagSays: { partySees: flags?.partySees ?? null, monstersSee: flags?.monstersSee ?? null },
    };
  },

  /* --- The city: the stay ------------------------------------------- */

  setIncidents: async ({ sceneId, patch }) => {
    const H = globalThis.__d;
    const scene = game.scenes.get(sceneId);
    await H.m.setup.writeSceneIncidents(scene, patch);
    await H.sleep(500);
    const rec = H.m.setup.sceneIncidents(scene);
    return { named: !!rec?.tableUuid, afterDark: rec?.afterDark ?? null, band: rec?.band ?? null };
  },

  registerCity: async ({ target = 1, empty = false }) => {
    const H = globalThis.__d;
    const holedUp = empty ? {} : { any: { everyTurns: 1, throw: target } };
    H.m.tables.registerTable({ id: acksExtras.formation.settlement.SETTLEMENT_DOC, tables: { encounters: { holedUp }, encounterAfterDark: 3 } }, { priority: 30, source: "formation-steps" });
    return { doc: acksExtras.formation.settlement.SETTLEMENT_DOC, priced: !!acksExtras.formation.settlement.streetCadence({ where: "holedUp" }) };
  },

  settleBoard: async ({ fid, patch }) => {
    const H = globalThis.__d;
    if (patch) { await H.T.patchSettlement(fid, patch); await H.sleep(600); }
    if (!H.formation(fid)) return { gone: true };
    const t = H.T.travelOf(H.formation(fid));
    const others = Object.values(H.F.getFormations()).filter((f) => {
      if (f.id === fid) return false;
      const o = H.T.travelOf(f);
      return o.mode === "settlement" && o.settlement?.where === "holedUp";
    }).length;
    return { mode: t.mode, where: t.settlement.where, hour: t.settlement.hour, days: t.settlement.days ?? 0, stamped: t.settlement.holeUpSince != null, othersHoledUp: others };
  },

  /**
   * Records every write of the formations setting this seat hears: this
   * window's own carry a sequence number in their update options, so an
   * update without one came from another window. Each entry holds the
   * watched records' travel as that write carried it.
   */
  watchFormations: async ({ mod, fids }) => {
    const H = globalThis.__d;
    if (H.watch) { H.watch.fids = fids; return { installed: false, fids }; }
    const w = (H.watch = { fids, sets: 0, log: [] });
    const set = game.settings.set;
    game.settings.set = function watchedSet(ns, key, value, options = {}) {
      if (ns !== mod || key !== "formations") return set.call(this, ns, key, value, options);
      w.sets += 1;
      return set.call(this, ns, key, value, { ...options, formationWatch: w.sets });
    };
    Hooks.on("updateSetting", (doc, changed, options, userId) => {
      if (doc.key !== `${mod}.formations` || !("value" in changed)) return;
      let all = changed.value;
      if (typeof all === "string") { try { all = JSON.parse(all); } catch (_e) { all = null; } }
      const travel = Object.fromEntries(w.fids.map((fid) => {
        const t = all?.[fid]?.travel;
        return [fid, t ? { mode: t.mode, where: t.settlement?.where ?? null, hour: t.settlement?.hour ?? null, days: t.settlement?.days ?? 0 } : null];
      }));
      w.log.push({ at: Date.now(), worldTime: game.time.worldTime, own: options?.formationWatch ?? null, userId, travel });
    });
    return { installed: true, fids };
  },

  watchRead: async ({ since = 0 } = {}) => {
    const w = globalThis.__d.watch;
    if (!w) return null;
    const log = w.log.filter((e) => e.at >= since);
    return { sets: w.sets, updates: log.length, foreign: log.filter((e) => e.own == null).length, log };
  },

  advance: async ({ seconds }) => {
    const before = game.time.worldTime;
    await game.time.advance(seconds);
    await new Promise((r) => setTimeout(r, 2500));
    return { moved: game.time.worldTime - before };
  },

  noteCount: async ({ sceneId }) => game.scenes.get(sceneId).notes.size,

  /**
   * The stay cards this seat posted since t0, read for the recipe's
   * observables: one row per met day, labelled from `from`, each line the
   * row the throw names on the invented list, shifted after dark.
   */
  stayCards: async ({ t0, listName, rowPrefix, from, night, shift }) => {
    const H = globalThis.__d;
    const isStay = (m) => !!H.parse(m.content).querySelector(".acks-extras-settlement-card");
    await H.poll(() => H.mine(t0).filter(isStay).length, { tries: 80, every: 250 });
    await H.sleep(1000);
    const cards = H.mine(t0).filter(isStay);
    const pick = (listName ? cards.find((m) => H.parse(m.content).body.textContent.includes(listName)) : null) ?? cards.at(-1) ?? null;
    const doc = H.parse(pick?.content);
    const root = doc.querySelector(".acks-extras-settlement-card > ul");
    const items = root ? [...root.children].filter((n) => n.tagName === "LI") : [];
    const rows = items.filter((li) => li.querySelector(":scope > ul"));
    const C = (k, d) => game.i18n.format(`ACKS-FORMATION.settlement.card.${k}`, d);
    const labels = rows.map((li) => li.childNodes[0]?.textContent.trim() ?? "");
    const lines = rows.map((li) => [...li.querySelectorAll(":scope > ul > li")].map((x) => x.textContent.trim()));
    const totals = [];
    const lineOk = (line) => {
      for (let roll = 1; roll <= 10; roll++) {
        const total = night ? roll + shift : roll;
        const want = night
          ? C("incidentBanded", { roll, total, table: listName, text: `${rowPrefix} ${total}` })
          : C("incidentDrawn", { roll, table: listName, text: `${rowPrefix} ${total}` });
        if (line === want) { totals.push(total); return true; }
      }
      return false;
    };
    const text = doc.body.textContent;
    const noTable = game.i18n.localize("ACKS-FORMATION.settlement.card.noIncidentTable");
    return {
      cards: cards.length, uuids: H.uuids(cards), rows: rows.length,
      labelsOk: labels.every((l, k) => l === C("stayDay", { day: from + k + 1 })),
      linesOk: listName ? lines.every((ls) => ls.length === 1 && lineOk(ls[0])) : null,
      shiftOnly: totals.some((t) => t > 10), afterDarkClause: night ? null : lines.flat().some((l) => /\(\d+\s/u.test(l)),
      interrupted: rows.length ? text.includes(C("interrupted", { count: rows.length, days: Array.from({ length: rows.length }, (_, k) => from + k + 1).join(", ") })) : null,
      undisturbed1: text.includes(C("undisturbed", { throws: 1 })),
      unpriced: text.includes(C("unpriced", { what: "encounters" })),
      noTableRows: rows.length > 0 && lines.every((ls) => ls.includes(noTable)),
      anyNoTable: lines.flat().includes(noTable),
      promote: !!doc.querySelector(".acks-extras-poi-promote"),
      messageId: pick?.id ?? null,
    };
  },

  worldIncidentList: async () => {
    const mod = await import("/modules/acks-extras/scripts/formation/settlement-turn.mjs");
    return { held: !!(await mod.findCityIncidentTable()) };
  },

  /** The popout chat log, placed, with the card scrolled into view; returns the clip selector. */
  chatPopout: async ({ messageId }) => {
    const H = globalThis.__d;
    await ui.hotbar.render(true);
    const pop = await ui.chat.renderPopout();
    await H.sleep(1500);
    pop.setPosition({ left: 16, top: 16, width: 420, height: 860 });
    await H.sleep(600);
    const sel = `#${pop.id} li.chat-message[data-message-id="${messageId}"] .message-content`;
    document.querySelector(sel)?.scrollIntoView({ block: "nearest" });
    await H.sleep(600);
    H.popout = pop;
    return { sel, found: !!document.querySelector(sel) };
  },

  closeAll: async () => {
    const H = globalThis.__d;
    let n = 0;
    for (const d of document.querySelectorAll("dialog, .application.dialog")) {
      const b = d.querySelector('button[data-action="no"], button[data-action="later"]');
      if (b) { b.click(); n++; }
    }
    for (const a of [...foundry.applications.instances.values()]) {
      if (a.id === "acks-extras-door" || a === H?.popout || /Party|Formation|Dialog/.test(a.constructor.name)) {
        try { await a.close({ animate: false }); n++; } catch (_e) { /* closed */ }
      }
    }
    return n;
  },

  restoreSeat: async () => {
    const H = globalThis.__d;
    const out = { diceRestored: H?.unrig?.() ?? false };
    try { ui.controls.activate({ control: "tokens", tool: "select" }); } catch (_e) { /* no canvas */ }
    if (H?.notesPatched) { for (const [k, fn] of Object.entries(H.orig)) ui.notifications[k] = fn; H.notesPatched = false; out.notesRestored = true; }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/*  Node side                                                           */
/* ------------------------------------------------------------------ */

/** Run a page function on a seat and parse what it returns. */
const run = async (api, fn, args) =>
  JSON.parse(await api.eval(`(${fn.toString()})(${JSON.stringify(args ?? null)}).then((v) => JSON.stringify(v === undefined ? null : v))`));

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation?.getFormations`); }
    catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const open = {};
async function seat(key, user) {
  const { browser, origin, own } = seats();
  const api = await connect({ browser, origin, user, port: PORTS[key], own });
  open[key] = api;
  note(`${key} seat ready after (s)`, await ready(api, key));
  const inst = await run(api, P.install);
  if (!inst.fresh) throw new Error(`${key} seat: the loaded module lacks this tree's door and settlement API`);
  return api;
}

const sceneData = (name, grid) => ({
  name, active: false, navigation: false, width: 2000, height: 1400, padding: 0, tokenVision: false, backgroundColor: "#8a8a8a",
  grid: { type: grid.type, size: 100, distance: grid.distance, units: grid.units }, ownership: { default: 2 },
});
const character = (name, hp, ownership = { default: 0 }) => ({ name, type: "character", ownership, prototypeToken: { actorLink: true }, system: { hp: { value: hp, max: 6 } } });

const restore = { settings: {}, registered: new Set() };
let worldTime0 = null;
let clockMoves = 0;

try {
  section("seats");
  const s = seats();
  const gm = await seat("gm", s.gm);
  const player = await seat("player", s.player);
  const census = { gm: await run(gm, P.census, MOD), player: await run(player, P.census, MOD) };
  worldTime0 = census.gm.worldTime;
  note("module", census.gm.module);
  note("settings at start", census.gm.settings);
  check("the GM seat is the active GM and the player seat is a player", census.gm.activeGMIsSelf && census.gm.role === 4 && census.player.role <= 2, { gmRole: census.gm.role, playerRole: census.player.role });
  if (!census.gm.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  check("the GM seat's window leads its seat's election, so the world-time automation runs in it", census.gm.election?.isLead === true, census.gm.election);
  if (census.gm.election?.isLead !== true) throw new Error("another window on the GM seat leads its election; the automation would run there");
  note("formations writes watched", await run(gm, P.watchFormations, { mod: MOD, fids: [] }));
  const playerId = census.player.userId;
  const gmIds = census.gm.gmIds;

  // Every card the walk reads is marked in the order posted; the last run's go before the first step posts one.
  const tracked = new Set();
  let cardN = 0;
  const trackAll = async (uuids) => {
    for (const u of uuids ?? []) if (u && !tracked.has(u)) { tracked.add(u); cardN += 1; await gm.mark(u, `formation/steps-card-${cardN}`); }
  };
  const retiredCards = [];
  for (let n = 1, misses = 0; misses < 5; n++) {
    const out = await gm.retire(`formation/steps-card-${n}`, "ChatMessage");
    if (out.removed.length || out.missing.length || out.failed.length) { misses = 0; retiredCards.push(...out.removed.map((e) => e.uuid)); }
    else misses += 1;
  }
  note("the last run's cards retired", retiredCards.length);
  // A kept party's token, built on its scene where none stands; its formation adopts it on create.
  const partyToken = async (marker, actorId, scene, xy) => gm.fixture(marker, "Token", await run(gm, P.tokenData, { actorId, xy }), { parent: scene.uuid });
  const flip = async (key, value) => {
    if (!(key in restore.settings)) restore.settings[key] = census.gm.settings[key];
    note(`setting ${key} for the walk`, await run(gm, P.setSetting, { mod: MOD, key, value }));
  };
  await flip("travelEncounters", false);

  /* ---------------------------------------------------------------- */
  section("Steps 13: the door dialog");
  const s1 = await gm.fixture("formation/steps-doors", "Scene", sceneData("QA Steps", { type: 1, distance: 5, units: "ft" }));
  note("steps scene viewed", await run(gm, P.viewScene, s1.id));
  const door1 = await gm.fixture("formation/steps-door-1", "Wall", { c: [600, 200, 600, 400], door: 1, ds: 0 }, { parent: s1.uuid });
  const door2 = await gm.fixture("formation/steps-door-2", "Wall", { c: [1000, 200, 1000, 400], door: 1, ds: 0 }, { parent: s1.uuid });
  note("doors closed and unmarked", [await run(gm, P.resetDoor, { sceneId: s1.id, wallId: door1.id }), await run(gm, P.resetDoor, { sceneId: s1.id, wallId: door2.id })]);
  const p1 = await gm.fixture("formation/steps-door-party", "Actor", { name: "QA Door Party", type: "acks-extras.party" });
  note("the door party brought to a new record's shape", await run(gm, P.reset, { partyId: p1.id }));
  const basher = await gm.fixture("formation/steps-basher", "Actor", character("QA Basher", 6));
  const stranger = await gm.fixture("formation/steps-stranger", "Actor", character("QA Stranger", 6));
  note("hit points", [await run(gm, P.setHp, { actorId: basher.id, hp: 6 }), await run(gm, P.setHp, { actorId: stranger.id, hp: 6 })]);
  const p1Token = await partyToken("formation/steps-door-party-token", p1.id, s1, { x: 100, y: 1100 });
  const b1 = await run(gm, P.buildParty, { partyId: p1.id, sceneId: s1.id, tokenId: p1Token.id, memberIds: [basher.id], mode: null });
  if (b1.error) throw new Error(b1.error);
  const f1 = b1.formationId;
  check("the door formation holds the basher, its token adopted", b1.adopted && b1.enrolled.every(Boolean), { adopted: b1.adopted, enrolled: b1.enrolled, dropped: b1.dropped });
  const tBasher = await partyToken("formation/steps-basher-token", basher.id, s1, { x: 400, y: 250 });
  const tStranger = await partyToken("formation/steps-stranger-token", stranger.id, s1, { x: 800, y: 250 });

  let r = await run(gm, P.doorOpen, { wallId: door1.id, tokenId: tBasher.id });
  check("the door tool opens the dialog on the selected door, heaving with the selected token", r.controlled && r.tool && r.open && r.wallMatches && r.tokenControlled && r.basher && r.nameShown, r);

  await run(gm, P.doorInput, { name: "kind", value: "wood" });
  r = await run(gm, P.doorRead, { sceneId: s1.id, wallId: door1.id });
  check("Construction: the choice is written to the door and the axe figure follows it", r.flag.kind === "wood" && r.select === "wood" && r.batterButton && r.figureFollows, { flagKind: r.flag.kind, select: r.select, batterButton: r.batterButton, figureFollows: r.figureFollows });
  await run(gm, P.doorInput, { name: "kind", value: "iron" });
  r = await run(gm, P.doorRead, { sceneId: s1.id, wallId: door1.id });
  check("Construction: a door an axe cannot beat shows why in place of the button", r.flag.kind === "iron" && !r.axeBeats && !r.batterButton && r.tooSolidShown, { flagKind: r.flag.kind, batterButton: r.batterButton, tooSolidShown: r.tooSolidShown });
  await run(gm, P.doorInput, { name: "kind", value: "wood" });
  r = await run(gm, P.doorRead, { sceneId: s1.id, wallId: door1.id });
  const spikes0 = r.spikes;

  await run(gm, P.doorInput, { name: "evil", value: true });
  r = await run(gm, P.doorRead, { sceneId: s1.id, wallId: door1.id });
  check("Marks: Evil is written to the door the moment it is ticked", r.flag.evil === true && !r.flag.jammed && r.spikes === spikes0, { flag: r.flag });
  await run(gm, P.doorInput, { name: "jammed", value: true });
  r = await run(gm, P.doorRead, { sceneId: s1.id, wallId: door1.id });
  check("Marks: Lock jammed is written beside it", r.flag.evil === true && r.flag.jammed === true && r.spikes === spikes0 && r.evilBox && r.jammedBox, { flag: r.flag, boxes: [r.evilBox, r.jammedBox] });
  if (SHOTS) {
    note("door dialog placed", await run(gm, P.doorPlace));
    try {
      const shot = await gm.shot(`${shotDir()}/formation-door-marks.png`, "#acks-extras-door");
      note("plate formation-door-marks", { bytes: shot.bytes, width: shot.clip?.width, height: shot.clip?.height });
    } catch (err) { note("plate formation-door-marks failed", err?.message ?? String(err)); }
  }
  await run(gm, P.doorInput, { name: "evil", value: false });
  r = await run(gm, P.doorRead, { sceneId: s1.id, wallId: door1.id });
  check("Marks: untick Evil reads false/true on the wall and in doorState, spikes unchanged", r.flag.evil === false && r.flag.jammed === true && r.stateMatchesFlag && r.spikes === spikes0, { flag: r.flag, stateMatchesFlag: r.stateMatchesFlag });

  r = await run(gm, P.doorBash, { face: 1, actorId: basher.id });
  await trackAll(r.uuids);
  check("Botch: a natural 1 posts the rebound line and the reported-not-applied note; hit points unchanged", r.rigOk && r.card && r.damageLine && r.reportedNote && r.hpUnchanged, r);
  const miss = await run(gm, P.doorBash, { face: 2, actorId: basher.id });
  await trackAll(miss.uuids);
  if (miss.missPossible) check("Botch: an ordinary miss carries neither line", miss.rigOk && miss.card && !miss.damageLine && !miss.reportedNote, miss);
  else note("ordinary miss not walked", "the basher's throw makes a 2; no miss is possible");
  r = await run(gm, P.doorRead, { sceneId: s1.id, wallId: door1.id });
  check("the heaves left the door closed", r.ds === 0, { ds: r.ds });

  r = await run(gm, P.doorBatter, { fid: f1, sceneId: s1.id, wallId: door1.id, watch: [f1] });
  await trackAll(r.uuids);
  clockMoves += r.worldTimeDelta;
  check("Batter: the turns shown are charged to the basher's formation, a card posts, the door opens, the notice names turns and formation", r.roseByShown && r.cards >= 1 && r.ds === 1 && r.noteOk, r);

  r = await run(gm, P.doorOpen, { wallId: door2.id, tokenId: tStranger.id });
  check("the dialog reopens on the second door with the unformed character heaving", r.open && r.wallMatches && r.basher, r);
  r = await run(gm, P.doorBatter, { fid: null, sceneId: s1.id, wallId: door2.id, watch: [f1] });
  await trackAll(r.uuids);
  clockMoves += r.worldTimeDelta;
  check("Batter, no formation: the door opens, no clock moved, the notice says no formation holds the basher", r.ds === 1 && r.othersStill && r.noteOk && r.worldTimeDelta === 0, r);
  await run(gm, P.closeAll);

  /* ---------------------------------------------------------------- */
  section("Steps 11a: leave behind, from the player seat");
  // A token a member was left behind as is the press's product; one a run stranded goes first.
  note("a stranded left-behind token retired", await gm.retire("formation/steps-left-token", "Token", { parent: s1.uuid }));
  const p2 = await gm.fixture("formation/steps-rearguard", "Actor", { name: "QA Rearguard", type: "acks-extras.party", ownership: { default: 0, [playerId]: 2 } });
  note("the rearguard brought to a new record's shape", await run(gm, P.reset, { partyId: p2.id }));
  const fallenA = await gm.fixture("formation/steps-fallen-owned", "Actor", character("QA Fallen Owned", 0, { default: 0, [playerId]: 3 }));
  const fallenB = await gm.fixture("formation/steps-fallen-judge", "Actor", character("QA Fallen Judge", 0));
  note("hit points", [await run(gm, P.setHp, { actorId: fallenA.id, hp: 0 }), await run(gm, P.setHp, { actorId: fallenB.id, hp: 0 })]);
  const p2Token = await partyToken("formation/steps-rearguard-token", p2.id, s1, { x: 300, y: 800 });
  const b2 = await run(gm, P.buildParty, { partyId: p2.id, sceneId: s1.id, tokenId: p2Token.id, memberIds: [fallenA.id, fallenB.id], mode: null });
  if (b2.error) throw new Error(b2.error);
  const f2 = b2.formationId;
  check("the rearguard holds both casualties, its token adopted", b2.adopted && b2.enrolled.every(Boolean), { adopted: b2.adopted, enrolled: b2.enrolled, dropped: b2.dropped });
  note("the rearguard out of any fight", await run(gm, P.setCombat, { fid: f2, value: null }));
  note("the owned casualty not left behind", await run(gm, P.goneBackFor, { fid: f2, partyId: p2.id, actorId: fallenA.id }));

  r = await run(player, P.orderRows, { partyId: p2.id, aId: fallenA.id, bId: fallenB.id });
  check("the player's own casualty offers Leave behind; the Judge's casualty offers this seat nothing", r.rowA && r.casualtyA && r.linkA === "leave" && r.rowB && !r.linkB, r);
  let t0 = Date.now();
  note("player presses Leave behind", await run(player, P.pressLeft, { partyId: p2.id, actorId: fallenA.id }));
  let m = await run(gm, P.memberState, { fid: f2, actorId: fallenA.id, sceneId: s1.id, wait: true });
  if (m.tokenUuid) await gm.mark(m.tokenUuid, "formation/steps-left-token");
  let d = await run(gm, P.declarations, { t0, name: fallenA.name, keys: ["leftBehind", "wentBackFor"] });
  await trackAll(d.uuids);
  check("the declaration reaches the Judge: left, a token where the party stands, not detached, the public line", m.left && !!m.deployed && !!m.tokenUuid && m.near && !m.detached && d.leftBehind === 1, { left: m.left, deployed: !!m.deployed, near: m.near, detached: m.detached, publicLine: d.leftBehind });
  const leftToken = m.tokenUuid;

  r = await run(player, P.orderRows, { partyId: p2.id, aId: fallenA.id, bId: fallenB.id });
  check("the control now reads Go back for them", r.linkA === "goBack", { linkA: r.linkA });
  t0 = Date.now();
  note("player presses Go back for them", await run(player, P.pressLeft, { partyId: p2.id, actorId: fallenA.id }));
  m = await run(gm, P.memberState, { fid: f2, actorId: fallenA.id, sceneId: s1.id, wait: false });
  d = await run(gm, P.declarations, { t0, name: fallenA.name, keys: ["leftBehind", "wentBackFor"] });
  await trackAll(d.uuids);
  check("going back recalls the token and posts the public line", !m.left && !m.deployed && d.wentBackFor === 1, { left: m.left, deployed: !!m.deployed, publicLine: d.wentBackFor, leftTokenWas: !!leftToken });

  const combat = await run(gm, P.setCombat, { fid: f2, value: { combatId: "qasteps", active: true, roundsCounted: 0 } });
  note("rearguard set in combat", { prior: combat.prior, active: !!combat.now?.active });
  r = await run(player, P.orderRows, { partyId: p2.id, aId: fallenA.id, bId: fallenB.id });
  t0 = Date.now();
  note("player presses during the fight", await run(player, P.pressLeft, { partyId: p2.id, actorId: fallenA.id }));
  m = await run(gm, P.memberState, { fid: f2, actorId: fallenA.id, sceneId: s1.id });
  d = await run(gm, P.declarations, { t0, name: fallenA.name, keys: ["leftBehind", "wentBackFor"] });
  await trackAll(d.uuids);
  const refusal = d.refusals[0] ?? null;
  const seenR = refusal ? (await run(player, P.seen, { ids: [refusal.id] }))[0] : null;
  check("during a fight the press posts nothing public and whispers this seat a refusal", m.combat && !m.left && d.publicCount === 0 && d.refusals.length === 1 && JSON.stringify(refusal.whisper) === JSON.stringify([playerId]) && seenR?.visible, { combat: m.combat, left: m.left, publicCount: d.publicCount, refusals: d.refusals.length, whisperedToSeat: refusal ? JSON.stringify(refusal.whisper) === JSON.stringify([playerId]) : null, seenOnSeat: seenR });
  note("rearguard combat restored", await run(gm, P.setCombat, { fid: f2, value: combat.prior }));
  await run(player, P.closeAll);

  /* ---------------------------------------------------------------- */
  section("Steps 14: a marcher's survival state bars the forced march");
  const s2 = await gm.fixture("formation/steps-march", "Scene", sceneData("QA March", { type: 2, distance: 6, units: "mi" }));
  note("march scene viewed", await run(gm, P.viewScene, s2.id));
  const p3 = await gm.fixture("formation/steps-march-party", "Actor", { name: "QA March Party", type: "acks-extras.party", ownership: { default: 0, [playerId]: 2 } });
  const hungry = await gm.fixture("formation/steps-hungry", "Actor", character("QA Hungry Walker", 6));
  // The party actor's ownership is re-derived from its members at enrolment
  // (scene-sync.mjs syncPartyActorOwnership): a grant written on the party
  // actor alone is wiped, so the player seat reaches this sheet through a
  // member it owns.
  const fed = await gm.fixture("formation/steps-fed", "Actor", character("QA Fed Walker", 6, { default: 0, [playerId]: 3 }));
  note("hit points", [await run(gm, P.setHp, { actorId: hungry.id, hp: 6 }), await run(gm, P.setHp, { actorId: fed.id, hp: 6 })]);
  // The last run's End day left survival rungs on both walkers; only the hungry one is to bar the march.
  note("survival rungs", [await run(gm, P.setSurvival, { actorId: hungry.id, value: { nourishment: "underfed" }, replace: true }), await run(gm, P.setSurvival, { actorId: fed.id, value: null, replace: true })]);
  note("the march party brought to a new record's shape", await run(gm, P.reset, { partyId: p3.id }));
  const xy3 = await run(gm, P.cellXY, { sceneId: s2.id, i: 4, j: 3 });
  const p3Token = await partyToken("formation/steps-march-party-token", p3.id, s2, xy3);
  const b3 = await run(gm, P.buildParty, { partyId: p3.id, sceneId: s2.id, tokenId: p3Token.id, memberIds: [hungry.id, fed.id], mode: "journey" });
  if (b3.error) throw new Error(b3.error);
  const f3 = b3.formationId;
  const names = [hungry.name, fed.name];
  check("the march party journeys with both walkers enrolled", b3.adopted && b3.enrolled.every(Boolean) && b3.mode === "journey", { adopted: b3.adopted, enrolled: b3.enrolled, dropped: b3.dropped, mode: b3.mode });
  note("the march back on Dedicated march", await run(gm, P.apiDay, { fid: f3, kind: "march", names }));
  await run(gm, P.setSurvival, { actorId: hungry.id, value: { nourishment: "underfed" } });
  r = await run(gm, P.daySheet, { partyId: p3.id });
  check("the Day section's select is on the GM seat, on Dedicated march", r.daySection && r.select === "march", r);

  t0 = Date.now();
  r = await run(gm, P.pickDay, { partyId: p3.id, value: "forced", names });
  check("Refusal: picking Forced march raises a confirm naming the underfed walker only", r.dialog && r.names[0] && !r.names[1], r);
  await run(gm, P.answer, { actions: ["yes", "no"], action: "no" });
  let ds = await run(gm, P.dayState, { fid: f3 });
  let sel = await run(gm, P.daySelect, { partyId: p3.id });
  let bc = await run(gm, P.barCards, { t0, names });
  await trackAll(bc.uuids);
  check("Refusal: Leave the day as it is keeps march, the select redraws on it, no note posts", ds.kind === "march" && sel === "march" && bc.count === 0, { kind: ds.kind, select: sel, notes: bc.count });

  t0 = Date.now();
  r = await run(gm, P.pickDay, { partyId: p3.id, value: "forced", names });
  await run(gm, P.answer, { actions: ["yes", "no"], action: "yes" });
  ds = await run(gm, P.dayState, { fid: f3 });
  bc = await run(gm, P.barCards, { t0, names });
  await trackAll(bc.uuids);
  const seenBar = await run(player, P.seen, { ids: bc.ids });
  check("Override: Set it anyway writes forced, all four slots travel, one Judge-whispered card naming the walker", r.dialog && ds.kind === "forced" && ds.allTravel && bc.count === 1 && bc.gmOnly && !bc.othersNamed, { dialog: r.dialog, kind: ds.kind, allTravel: ds.allTravel, cards: bc.count, gmOnly: bc.gmOnly });
  check("Override: the player seat is not shown the whispered card", seenBar.every((x) => !x.visible && !x.inLog), { seen: seenBar });

  r = await run(gm, P.pickDay, { partyId: p3.id, value: "march", names });
  check("stepping back to Dedicated march asks nothing", !r.dialog, { dialog: r.dialog });
  r = await run(gm, P.pickDay, { partyId: p3.id, value: "forced", names });
  await run(gm, P.answer, { actions: ["yes", "no"], action: "no" });
  ds = await run(gm, P.dayState, { fid: f3 });
  check("the confirm returns on the next pick: the override is per change", r.dialog && ds.kind === "march", { dialog: r.dialog, kind: ds.kind });

  await run(gm, P.setSurvival, { actorId: hungry.id, value: { nourishment: "hungry" } });
  r = await run(gm, P.pickDay, { partyId: p3.id, value: "forced", names });
  ds = await run(gm, P.dayState, { fid: f3 });
  check("A plain rung: Forced march from March asks nothing and is set", !r.dialog && ds.kind === "forced", { dialog: r.dialog, kind: ds.kind });
  await run(gm, P.pickDay, { partyId: p3.id, value: "march", names });

  await run(gm, P.setSurvival, { actorId: hungry.id, value: { nourishment: "underfed" } });
  r = await run(gm, P.apiDay, { fid: f3, kind: "forced", names });
  check("The API obeys the bar: setDayKind resolves false, warns naming the walker, the kind stays", r.result === false && r.warned && r.kind === "march", r);
  r = await run(player, P.apiDay, { fid: f3, kind: "forced", override: true, names });
  ds = await run(gm, P.dayState, { fid: f3 });
  check("The player's override is not heard: false, and the kind stays march", r.result === false && ds.kind === "march", { result: r.result, kind: ds.kind });
  t0 = Date.now();
  r = await run(gm, P.apiDay, { fid: f3, kind: "forced", override: true, names });
  bc = await run(gm, P.barCards, { t0, names });
  await trackAll(bc.uuids);
  check("The Judge's override: the record resolves, forced is set, one more whispered card", r.result === true && r.kind === "forced" && bc.count === 1 && bc.gmOnly, { result: r.result, kind: r.kind, cards: bc.count });
  r = await run(gm, P.apiDay, { fid: f3, kind: "march", names });
  note("day back on march", { kind: r.kind });

  r = await run(player, P.playerDay, { partyId: p3.id, sceneId: s2.id });
  check("A player seat: no Day section, no select, no override dialog", r.rendered && !r.daySection && !r.select && !r.dialog, r);

  note("travel layer", await run(gm, P.registerTravel, { target: 11 }));
  restore.registered.add("travel");
  r = await run(gm, P.country, { fid: f3, override: { ground: "forest", road: "none" } });
  check("the journey is set on forest off the road in the Judge's hand", r.ground && r.road, r);

  await run(gm, P.patchDay, { fid: f3, patch: { hours: 99, offered: false } });
  ds = await run(gm, P.dayState, { fid: f3 });
  r = await run(gm, P.dragOffer, { fid: f3, answer: "push", rigFace: 20, names });
  await trackAll(r.uuids);
  clockMoves += (r.dragDelta ?? 0) + (r.worldDelta ?? 0);
  let ds2 = await run(gm, P.dayState, { fid: f3 });
  check("The dusk offer: a step past the spent day raises the question", r.dialog && r.titleOk && r.offeredAtDialog, { dialog: r.dialog, titleOk: r.titleOk, offered: r.offeredAtDialog, rigOk: r.rigOk });
  check("The dusk offer: Push on warns naming the walker; the kind stays march and the log is unchanged", r.warned && ds2.kind === "march" && ds2.logLen === ds.logLen, { warned: r.warned, kind: ds2.kind, logUnchanged: ds2.logLen === ds.logLen });

  /* ---------------------------------------------------------------- */
  section("The day's end: Call it a day");
  if (census.gm.settings.advanceWorldTime !== true) await flip("advanceWorldTime", true);
  await run(gm, P.patchDay, { fid: f3, patch: { hours: 99, offered: false } });
  ds = await run(gm, P.dayState, { fid: f3 });
  r = await run(gm, P.dragOffer, { fid: f3, answer: "end", names });
  await trackAll(r.uuids);
  clockMoves += (r.dragDelta ?? 0) + (r.worldDelta ?? 0);
  ds2 = await run(gm, P.dayState, { fid: f3 });
  check("Call it a day: a log entry, dayCount up one, hexesEntered back to 0", r.dialog && ds2.logLen === ds.logLen + 1 && ds2.dayCount === ds.dayCount + 1 && ds2.hexesEntered === 0, { dialog: r.dialog, logUp: ds2.logLen - ds.logLen, dayUp: ds2.dayCount - ds.dayCount, hexesEntered: ds2.hexesEntered });
  check("Call it a day: no navigation card, and the clock stands at the next dawn", r.navOnAnswer === 0 && r.dawn != null && r.worldDelta === r.dawn, { navCards: r.navOnAnswer, worldDelta: r.worldDelta, untilDawn: r.dawn });

  /* ---------------------------------------------------------------- */
  section("End day, the whole tick");
  r = await run(gm, P.endDayApi, { fid: f3 });
  await trackAll(r.uuids);
  clockMoves += r.worldDelta;
  check("endDay on forest off the road: the day count advances, the log grows, no navigation card", r.dayUp && r.logUp && r.navCards === 0, { dayUp: r.dayUp, logUp: r.logUp, navCards: r.navCards, worldDelta: r.worldDelta });
  note("travel layer unregistered", await run(gm, P.unregister, { id: "travel" }));
  restore.registered.delete("travel");

  /* ---------------------------------------------------------------- */
  section("The encounters: who saw whom");
  r = await run(gm, P.country, { fid: f3, override: { ground: "grassland", encounterTerrain: "grassland" } });
  check("a terrain is picked in the Judge's hand", r.ground && r.encounterTerrain, r);
  note("sky cleared by hand", await run(gm, P.clearSky, { fid: f3 }));
  note("encounters layer", await run(gm, P.registerEncounters));
  restore.registered.add("encounters");
  const far = await run(gm, P.encounterCard, { fid: f3, r: 11 / 12 });
  if (far.uuid) await trackAll([far.uuid]);
  const near = await run(gm, P.encounterCard, { fid: f3, r: 1 / 12 });
  if (near.uuid) await trackAll([near.uuid]);
  for (const [label, c] of [["far", far], ["near", near]]) {
    check(`the ${label} throw: the card's sight lines follow its printed distance and the sky's visibility`, c.outcome === "monster" && c.terrain === "grassland" && Number.isFinite(c.printed) && c.lineSays.partySees === c.expect.partySees && c.lineSays.monstersSee === c.expect.monstersSee, { printed: c.printed, expect: c.expect, line: c.lineSays, skyClear: c.skyClear });
    check(`the ${label} throw: the message carries the same facts as flags`, c.flagDistance === c.printed && c.flagStart === c.expectStart && c.flagSays.partySees === c.lineSays.partySees && c.flagSays.monstersSee === c.lineSays.monstersSee, { flagDistance: c.flagDistance, flagStart: c.flagStart, flags: c.flagSays });
  }
  check("the sight lines differ with the distance: the far throw is unseen by the party, the near one seen by both", far.lineSays.partySees === false && far.lineSays.monstersSee === true && near.lineSays.partySees === true && near.lineSays.monstersSee === true, { far: far.lineSays, near: near.lineSays });
  note("encounters layer unregistered", await run(gm, P.unregister, { id: "encounters" }));
  restore.registered.delete("encounters");
  await run(gm, P.closeAll);

  /* ---------------------------------------------------------------- */
  section("The city: the stay draws what found it, day by day");
  const s3 = await gm.fixture("formation/steps-city", "Scene", sceneData("QA City", { type: 1, distance: 50, units: "ft" }));
  note("city scene viewed", await run(gm, P.viewScene, s3.id));
  const p4 = await gm.fixture("formation/steps-city-party", "Actor", { name: "QA City Party", type: "acks-extras.party" });
  const p4Token = await partyToken("formation/steps-city-party-token", p4.id, s3, { x: 500, y: 500 });
  // The board a run left (its tally, its stay's stamp and day count) goes with the record's travel.
  note("the city party brought to a new record's shape", await run(gm, P.reset, { partyId: p4.id }));
  const b4 = await run(gm, P.buildParty, { partyId: p4.id, sceneId: s3.id, tokenId: p4Token.id, memberIds: [], mode: "settlement" });
  if (b4.error) throw new Error(b4.error);
  const f4 = b4.formationId;
  await run(gm, P.watchFormations, { mod: MOD, fids: [f4] });
  const cityWatch0 = Date.now();
  check("the city party stands in settlement mode", b4.adopted && b4.mode === "settlement", { adopted: b4.adopted, mode: b4.mode });
  const rowPrefix = "QQ incident";
  const list = await gm.fixture("formation/steps-city-list", "RollTable", {
    name: "QQ City List", formula: "1d10",
    results: Array.from({ length: 13 }, (_, k) => ({ type: "text", name: `${rowPrefix} ${k + 1}`, description: `${rowPrefix} ${k + 1}`, range: [k + 1, k + 1], weight: 1 })),
  });
  const listName = list.name;
  note("city list named on the map", await run(gm, P.setIncidents, { sceneId: s3.id, patch: { tableUuid: list.uuid, afterDark: 3, bandFrom: 8, bandTo: 9 } }));
  note("cityTravel layer", await run(gm, P.registerCity, { target: 1 }));
  restore.registered.add("cityTravel");
  if (!Number(census.gm.settings.transientIncidentTurns)) await flip("transientIncidentTurns", 6);

  let b = await run(gm, P.settleBoard, { fid: f4, patch: { where: "holedUp", hour: "day" } });
  const othersHoledUp = b.othersHoledUp;
  note("other formations holed up in the world", othersHoledUp);
  const notes0 = await run(gm, P.noteCount, { sceneId: s3.id });
  const adv = async (seconds) => { const a = await run(gm, P.advance, { seconds }); clockMoves += a.moved; return a; };
  await adv(3600);
  b = await run(gm, P.settleBoard, { fid: f4 });
  note("formations writes heard since the city party was built", await run(gm, P.watchRead, { since: cityWatch0 }));
  check("the stay is stamped by an hour's advance and charged nothing", b.where === "holedUp" && b.hour === "day" && b.stamped && b.days === 0, b);

  const stayTrack = async (c) => { if (othersHoledUp === 0) await trackAll(c.uuids); };
  let from = b.days;
  t0 = Date.now();
  await adv(86400 * 3);
  let c = await run(gm, P.stayCards, { t0, listName, rowPrefix, from, night: false, shift: 3 });
  await stayTrack(c);
  b = await run(gm, P.settleBoard, { fid: f4 });
  const notes1 = await run(gm, P.noteCount, { sceneId: s3.id });
  check("By day: one stay card, a Day row for each of the three days, numbered on from the board", c.cards === 1 && c.rows === 3 && c.labelsOk && c.interrupted && b.days === from + 3, { cards: c.cards, rows: c.rows, labelsOk: c.labelsOk, interrupted: c.interrupted, days: b.days });
  check("By day: each row is the list's own roll and row, with no after-dark clause", c.linesOk && c.afterDarkClause === false, { linesOk: c.linesOk, afterDark: c.afterDarkClause });
  check("By day: no marker on the map and no Make it a place button", notes1 === notes0 && !c.promote, { notesUnchanged: notes1 === notes0, promote: c.promote });
  if (SHOTS && c.messageId) {
    try {
      const pop = await run(gm, P.chatPopout, { messageId: c.messageId });
      if (pop.found) {
        const shot = await gm.shot(`${shotDir()}/formation-stay-days.png`, pop.sel);
        note("plate formation-stay-days", { bytes: shot.bytes, width: shot.clip?.width, height: shot.clip?.height });
      } else note("plate formation-stay-days not taken", "the card is not in the popout log");
    } catch (err) { note("plate formation-stay-days failed", err?.message ?? String(err)); }
    await run(gm, P.closeAll);
  }

  b = await run(gm, P.settleBoard, { fid: f4, patch: { hour: "night" } });
  from = b.days;
  t0 = Date.now();
  await adv(86400 * 3);
  c = await run(gm, P.stayCards, { t0, listName, rowPrefix, from, night: true, shift: 3 });
  await stayTrack(c);
  check("After dark: three Day rows numbered on from the first stay, each the shifted total's row", c.cards === 1 && c.rows === 3 && c.labelsOk && c.linesOk, { rows: c.rows, labelsOk: c.labelsOk, linesOk: c.linesOk });
  let shiftSeen = c.shiftOnly;
  if (!shiftSeen) {
    // A total past the die appears one day in three; the top face makes it certain.
    b = await run(gm, P.settleBoard, { fid: f4 });
    from = b.days;
    note("dice rigged to the top face", await gm.eval(`globalThis.__d.rig(10, 10).then((v) => v.ok)`));
    t0 = Date.now();
    await adv(86400);
    note("dice restored", await gm.eval(`globalThis.__d.unrig()`));
    c = await run(gm, P.stayCards, { t0, listName, rowPrefix, from, night: true, shift: 3 });
    await stayTrack(c);
    shiftSeen = c.shiftOnly && c.linesOk;
  }
  check("After dark: a total only the shift reaches appears, with its own row", shiftSeen, { shiftOnly: shiftSeen });

  note("cityTravel target 7", await run(gm, P.registerCity, { target: 7 }));
  b = await run(gm, P.settleBoard, { fid: f4 });
  t0 = Date.now();
  await adv(86400);
  c = await run(gm, P.stayCards, { t0, listName: null, rowPrefix, from: b.days, night: true, shift: 3 });
  await stayTrack(c);
  check("Quiet: a target the die cannot meet says nothing found them over one day, with no Day row", c.cards >= 1 && c.undisturbed1 && c.rows === 0, { undisturbed: c.undisturbed1, rows: c.rows });

  note("cityTravel holed-up row emptied", await run(gm, P.registerCity, { empty: true }));
  b = await run(gm, P.settleBoard, { fid: f4 });
  t0 = Date.now();
  await adv(86400);
  c = await run(gm, P.stayCards, { t0, listName: null, rowPrefix, from: b.days, night: true, shift: 3 });
  await stayTrack(c);
  check("Gap: an empty holed-up row reads Not imported: encounters, with no Day row", c.cards >= 1 && c.unpriced && c.rows === 0, { unpriced: c.unpriced, rows: c.rows });

  note("cityTravel target 1", await run(gm, P.registerCity, { target: 1 }));
  note("city list cleared from the map", await run(gm, P.setIncidents, { sceneId: s3.id, patch: { tableUuid: null } }));
  const world = await run(gm, P.worldIncidentList);
  b = await run(gm, P.settleBoard, { fid: f4 });
  t0 = Date.now();
  await adv(86400 * 2);
  c = await run(gm, P.stayCards, { t0, listName: null, rowPrefix, from: b.days, night: true, shift: 3 });
  await stayTrack(c);
  if (world.held) check("No map list, a world list held: two Day rows read from the world's own list", c.rows === 2 && c.labelsOk && !c.anyNoTable, { rows: c.rows, labelsOk: c.labelsOk, noTableLine: c.anyNoTable });
  else check("No map list and none imported: each of the two Day rows says No incident table yet", c.rows === 2 && c.labelsOk && c.noTableRows, { rows: c.rows, labelsOk: c.labelsOk, noTableRows: c.noTableRows });
  if (othersHoledUp) note("stay cards not tracked", "another formation is holed up, so a stay card cannot be told for this run's");
  // The stay ends with its check: every clock advance in the world, any
  // session's, credits a party holed up in settlement mode a stay, so a kept
  // one left in the city would post cards between runs.
  note("the city party out of the city", await run(gm, P.setMode, { partyId: p4.id, mode: "delve" }));
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = open.gm;
  try { if (gm) note("closed windows", { gm: await run(gm, P.closeAll), player: open.player ? await run(open.player, P.closeAll) : 0 }); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  for (const id of restore.registered) {
    try { note(`${id} layer unregistered`, await run(gm, P.unregister, { id })); } catch (err) { console.error(`unregister ${id}:`, err?.message ?? err); }
  }
  for (const [key, value] of Object.entries(restore.settings)) {
    try { note(`setting ${key} restored`, await run(gm, P.setSetting, { mod: MOD, key, value })); } catch (err) { console.error(`restore ${key}:`, err?.message ?? err); }
  }
  try { if (gm) note("GM seat restored", await run(gm, P.restoreSeat)); } catch (err) { console.error("restoreSeat:", err?.message ?? err); }
  try { if (open.player) note("player seat restored", await run(open.player, P.restoreSeat)); } catch (err) { console.error("restoreSeat player:", err?.message ?? err); }
  try {
    const w = gm ? await run(gm, P.watchRead, {}) : null;
    if (w) note("formations writes heard over the walk", { sets: w.sets, updates: w.updates, foreign: w.foreign, foreignAt: w.log.filter((e) => e.own == null).map((e) => ({ at: new Date(e.at).toISOString(), worldTime: e.worldTime, userId: e.userId })) });
  } catch (err) { console.error("watchRead:", err?.message ?? err); }
  try { if (gm && worldTime0 != null) note("world clock moved (s)", { total: (await run(gm, P.census, MOD)).worldTime - worldTime0, byThisWalk: clockMoves }); } catch (err) { console.error("worldTime:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
