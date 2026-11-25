/**
 * Live walk, magic-summon-in-party: a summoning cast by a caster who is stashed
 * as a member inside a formation party token (no token of its own on the field)
 * and is held by no combat. Walks docs/magic/TESTING.md "Casting a summoning
 * spell from inside a party" on the GM and Player seats. The Player seat presses
 * the Magic tab's Cast, reads the cast dialog, presses its confirm button and
 * clicks the placement with real pointer input; the GM seat reads the party's
 * record, the scene and the world, and starts nothing.
 *
 * The walk opens by asserting its premise: no combat in `game.combats` holds the
 * caster (or the party's actor) and no token of the caster stands on the viewed
 * field. A combat that holds either is another session's and is never touched:
 * the walk prints `WALK BLOCKED` with that reason and checks nothing.
 *   A. A summoning spell with no range, naming a creature the Player may
 *      observe. The confirm button's label is recorded before the press. After
 *      the press: the cast count rose by exactly one; no pending-declaration
 *      record was written; the creatures joined the party as members (the
 *      member list grew by the count) and no creature token stands on the
 *      field; the caster's Magic tab row reads the standing count; one cast
 *      card exists. The Magic tab's Dismiss control then removes the members.
 *   B. The same with a spell that states a distance range. An OBSERVATION step:
 *      a Player's request here names no caster token to measure from, and what
 *      the cast should do instead is not settled, so the step prints what it
 *      saw (the button's label, the dialog's verdicts, the refusal text, the
 *      placement result, the count before and after, whether a pending record
 *      exists) and fails only on a broken invariant: nothing placed means
 *      nothing spent, no pending record, and a refusal the user can read;
 *      something placed means the count rose by exactly one.
 * Prints booleans, counts and the module's own strings, never a book's. Machine
 * values arrive through ./_env.mjs. The recorders on the seats attach after
 * `ready`, so a clean console here says nothing about `init`, `setup` or `ready`.
 *
 * Fixtures, kept and found by marker (the GM seat builds what is missing):
 * `magic/party-scene` (the field both seats view), `magic/party-creature` (a
 * monster whose ownership gives the Player's user Observer; the shape step
 * writes the level and the walk asserts it reads back 2 on both seats before
 * any cast), `magic/party-caster` (a character the Player owns, spells
 * enabled), `magic/party-spell-open` and `magic/party-spell-ranged` (its two
 * summoning spells, each rewritten whole by its step; the ranged one states a
 * distance the fixture sets), `magic/party` (an `acks-extras.party` actor whose
 * formation holds the caster alone, delving) and `magic/party-token` (its token
 * on the field, the caster stashed inside). The run's own documents (the cast
 * cards, the caster records, the creature's world copy where none stood and
 * any creature token the party did not gather) are tracked by id and swept
 * alone; a member a failed step leaves in the party is released by the run's
 * own cast id. A paused world is unpaused for the run and paused again in the
 * finally.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCOPE = "acks-extras";
const KEY = "magic-summon-in-party-walk";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** The duration both spells carry: the walk's own, a fixed two hours. */
const DURATION = { shape: "fixed", value: 2, unit: "hours" };
/** The ranged spell's distance, in feet: a figure the fixture sets. */
const RANGE_FEET = 30;
/** How many creatures each spell's row asks for. */
const COUNT_OPEN = 2;
const COUNT_RANGED = 1;
/** The party fixture's name: the name the formation's own cards speak under. */
const PARTY_NAME = "QA Party Cast Party";

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mps = globalThis.__mps ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.cards = (actorId) => [...game.messages].filter((m) => m.speaker?.actor === actorId || String(m.flags?.["acks-extras"]?.castCard?.spellUuid ?? "").startsWith(`Actor.${actorId}.`)).map((m) => m.id);
    H.seen = new Set();
    H.live = () => document.querySelector(".application.acks-extras-cast");
    /** The cast dialog as it reads now: the Summon band, the count, the placement line, the footer's verdicts and the confirm button. */
    H.band = () => {
      const el = H.live();
      if (!el) return { dialog: false };
      const options = [...(el.querySelector('select[name="summonRef"]')?.options ?? [])];
      const cast = el.querySelector('button[data-action="cast"]');
      return {
        dialog: true,
        summonBand: !!el.querySelector(".acks-extras-cast-summon"),
        targetsBand: !!el.querySelector(".acks-extras-cast-targets"),
        values: options.map((o) => o.value),
        count: el.querySelector('input[name="summonCount"]')?.value ?? null,
        placement: el.querySelector(".acks-extras-cast-split .acks-extras-cast-cap")?.textContent.trim() ?? "",
        verdicts: [...el.querySelectorAll(".acks-extras-cast-verdicts li")].map((li) => ({ severity: li.dataset.severity, text: li.textContent.trim() })),
        castDisabled: !!cast?.disabled,
        castLabel: cast?.textContent.trim() ?? "",
      };
    };
    /** Type a count into the open dialog as a user does (a change re-renders the window), then read the dialog again. */
    H.setCount = async (count) => {
      const input = H.live()?.querySelector('input[name="summonCount"]');
      if (!input) return { ...H.band(), missing: "summonCount" };
      if (input.value !== String(count)) {
        input.value = String(count);
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await H.sleep(600);
      }
      return H.band();
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn;
      ui.notifications.warn = function (msg, ...rest) { H.warns.push(String(msg)); return H.warn.call(this, msg, ...rest); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      H.onRejection = (e) => H.uncaught.push("rejection: " + String(e.reason?.message ?? e.reason ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    // The weapon rows' first publication redraws every open actor sheet, which would close a window the walk has opened.
    const rows = await import("/modules/acks-extras/scripts/equipment/weapon-rows.mjs");
    await Promise.race([rows.rowsReady(), H.sleep(60000)]);
    const base = "/modules/acks-extras/scripts/";
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.dep = await import(`${base}formation/deployment.mjs`);
    H.consts = await import(`${base}formation/constants.mjs`);
    H.logic = await import(`${base}lib/summons-logic.mjs`);
    await H.sleep(300);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, castApi: typeof globalThis.acksExtras?.magic?.castSummon === "function", formationApi: typeof globalThis.acksExtras?.formation?.travel?.setJourneyMode === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  /** Everything the seat's recorders caught since the last read; reading clears it. */
  drain: async () => {
    const H = globalThis.__mps;
    const out = { errors: H.errors.slice(), warns: H.warns.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  /** View the field (no activation), the Tokens layer up. */
  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (!scene) return false;
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1200));
    canvas.tokens.activate();
    return canvas.scene?.id === sceneId;
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    return true;
  },
  middle: async () => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }),
  messageIds: async () => game.messages.map((m) => m.id),

  /* ---- shapes ---- */

  /** The creature gives the Player's user Observer; answers the level the world reads back. */
  shapeCreature: async ({ creatureId, playerId }) => {
    const actor = game.actors.get(creatureId);
    await actor.update({ [`ownership.${playerId}`]: 2 });
    await new Promise((r) => setTimeout(r, 400));
    return { level: game.actors.get(creatureId).ownership?.[playerId] ?? null, isMonster: actor.type === "monster" };
  },
  /** On the seat: whether it resolves the creature and may observe it. */
  observes: async ({ uuid }) => {
    let doc = null;
    try { doc = await fromUuid(uuid); } catch { doc = null; }
    return { resolves: !!doc, observes: !!doc?.testUserPermission(game.user, "OBSERVER") };
  },
  /** The caster's known shape: spells enabled. */
  shapeCaster: async ({ casterId }) => {
    const actor = game.actors.get(casterId);
    if (!actor.system.spells?.enabled) await actor.update({ "system.spells.enabled": true });
    return { enabled: !!actor.system.spells?.enabled, type: actor.type };
  },
  /** One spell's flag replaced whole (the old flag deleted first): its summon row, its duration and, where given, its distance range in feet. The count is 0 again. */
  reshape: async ({ casterId, spellId, ref, amount, duration, rangeFeet }) => {
    const item = game.actors.get(casterId).items.get(spellId);
    await item.update({ "flags.acks-extras.-=spell": null });
    const flag = { schools: ["summoning"], effects: [{ type: "summon", ref, amount }], duration };
    if (rangeFeet != null) flag.range = { shape: "distance", value: rangeFeet, unit: "feet" };
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": flag });
    const { isSummonSpell } = await import("/modules/acks-extras/scripts/magic/summon-spell.mjs");
    const read = item.getFlag("acks-extras", "spell") ?? {};
    return { isSpell: item.type === "spell", summon: isSummonSpell(item), rows: Array.from(read.effects ?? []).length, cast: item.system.cast, range: read.range?.value ?? null };
  },

  /* ---- the party ---- */

  /** The record behind a party actor, once its create hook has made one; a hand-made actor no record names is adopted. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__mps;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 40, every: 200 });
    if (found) return { fid: found.id, adopted: false };
    const made = await H.model.adoptPartyActor(game.actors.get(partyId));
    return { fid: made.id, adopted: true };
  },
  /**
   * Bring the party to the walk's start shape: no stale combat flag on the record; the caster a member
   * stashed inside the party token (a token of it is taken from the field when one stands that carries
   * no fixture marker and is no party's, else made from the actor, then stashed); the party delving.
   * Reports what it found, never a name.
   */
  formParty: async ({ fid, sceneId, casterId, tokenMarker }) => {
    const H = globalThis.__mps;
    const scene = game.scenes.get(sceneId);
    const caster = game.actors.get(casterId);
    const get = () => H.model.getFormation(fid);
    const out = { staleCombat: !!get().combat };
    if (out.staleCombat) await H.model.patchFormation(fid, (rec) => void (rec.combat = null));
    // A run stopped mid-combat or mid-detach leaves members out on the map: the recall is the party's own.
    const stranded = get().members.filter((m) => m?.actorId && H.dep.isMemberDeployed(m));
    out.recalled = stranded.length;
    if (stranded.length) await H.dep.recallMembers(get(), { members: stranded });
    const isMember = (id) => get().members.some((m) => m?.actorId === id);
    const lone = (actor) => scene.tokens.find((t) => t.actorId === actor.id && !t.flags?.world?.fixture && !t.getFlag(H.consts.MODULE_ID, H.consts.FLAG_FORMATION_ID) && !H.logic.summonOfData(t.toObject()).summonedBy) ?? null;
    if (!isMember(casterId)) {
      let token = lone(caster);
      if (!token) {
        const doc = await caster.getTokenDocument({ x: 300, y: 300 });
        const data = doc.toObject();
        delete data._id;
        [token] = await scene.createEmbeddedDocuments("Token", [data]);
      }
      await H.model.addMember(get(), caster, token, { scene });
    }
    if (!H.model.getPartyToken(get())) await H.model.ensurePartyToken(get(), scene, 300, 300);
    const mode = get().travel?.mode;
    if (mode && mode !== "delve") await globalThis.acksExtras.formation.travel.setJourneyMode(fid, "delve");
    await H.sleep(500);
    const f = get();
    const token = H.model.getPartyToken(f);
    const rows = f.members.filter((m) => m?.actorId && !m.blank);
    return {
      partyTokenUuid: token?.uuid ?? null,
      markedToken: !!token && token.flags?.world?.fixture === tokenMarker,
      onScene: f.sceneId === sceneId,
      hasCaster: isMember(casterId),
      summonMembers: rows.filter(H.model.isSummonMember).length,
      deployed: rows.filter((m) => H.dep.isMemberDeployed(m)).length,
      delving: (f.travel?.mode ?? "delve") === "delve",
      staleCombat: out.staleCombat,
      recalled: out.recalled,
    };
  },
  /** The world's combats that hold the caster or the party's actor, by count; the walk's premise is that none does. */
  holdings: async ({ casterId, partyId }) => {
    const names = (c) => [...c.combatants].map((k) => k.actorId ?? k.actor?.id);
    return {
      combats: game.combats.size,
      holdingCaster: [...game.combats].filter((c) => names(c).includes(casterId)).length,
      holdingParty: [...game.combats].filter((c) => names(c).includes(partyId)).length,
    };
  },
  /**
   * The party as the record and the field hold it: whether the caster is a member, each summon member
   * read off its own stashed or live token (id, summoner, cast, spell, where it stands), the scene's
   * summon tokens no member holds, and the caster's own tokens on the field.
   */
  state: async ({ fid, sceneId, casterId }) => {
    const H = globalThis.__mps;
    const f = H.model.getFormation(fid);
    if (!f) return { gone: true };
    const scene = game.scenes.get(sceneId);
    const casterUuid = `Actor.${casterId}`;
    const rows = f.members.filter((m) => m?.actorId && !m.blank);
    const summons = rows.filter(H.model.isSummonMember).map((m) => {
      const own = H.model.memberOwnToken(m);
      const raw = own?.toObject?.() ?? own ?? null;
      const { summonedBy, summon } = H.logic.summonOfData(raw);
      return { id: m.actorId, by: summonedBy, cast: summon?.castId ?? null, spell: summon?.spellId ?? null, deployed: !!m.deployedTokenId, stashed: !!m.tokenData && !m.deployedTokenId };
    });
    const heldIds = new Set(rows.filter((m) => m.deployedTokenId).map((m) => m.deployedTokenId));
    const flagged = scene ? scene.tokens.filter((t) => H.logic.summonOfData(t.toObject()).summon) : [];
    const loose = flagged.filter((t) => !heldIds.has(t.id));
    return {
      gone: false,
      combat: !!f.combat?.active,
      onScene: f.sceneId === sceneId,
      partyToken: !!H.model.getPartyToken(f),
      hasCaster: rows.some((m) => m.actorId === casterId),
      persons: rows.filter((m) => !H.model.isSummonMember(m)).length,
      summons,
      mine: summons.filter((s) => s.by === casterUuid).length,
      loose: loose.length,
      looseMine: loose.filter((t) => H.logic.summonOfData(t.toObject()).summonedBy === casterUuid).map((t) => t.uuid),
      deployedTokens: summons.filter((s) => s.deployed).length,
      casterTokens: scene ? scene.tokens.filter((t) => t.actorId === casterId).length : null,
    };
  },
  /** The range in feet the cast's own reading gives a spell at a caster level, as this seat's module computes it (null where it reads none). */
  rangeRead: async ({ casterId, spellId, level }) => {
    const { castFiguresOf } = await import("/modules/acks-extras/scripts/magic/cast-spell.mjs");
    const { rangeFeet } = await import("/modules/acks-extras/scripts/magic/cast-range.mjs");
    const spell = game.actors.get(casterId).items.get(spellId);
    return rangeFeet(castFiguresOf(spell, {}, null).range, level)?.value ?? null;
  },
  /** The world copies of a creature source, by uuid. */
  copiesOf: async ({ sourceUuid }) => game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid).map((a) => a.uuid),
  /** The caster records one cast left on the actor. */
  recordsOf: async ({ actorId, castId }) =>
    game.actors.get(actorId).effects
      .filter((e) => e.getFlag("acks-extras", "spellEffect")?.castId === castId)
      .map((e) => ({ uuid: e.uuid, role: e.getFlag("acks-extras", "spellEffect").role })),
  /** Every spell record on the actor, by uuid. */
  recordUuids: async ({ casterId }) => [...game.actors.get(casterId).effects].filter((e) => e.getFlag("acks-extras", "spellEffect")).map((e) => e.uuid),
  /** The pending-declaration records on the caster, and whether it carries the casting status. */
  pending: async ({ casterId }) => {
    const a = game.actors.get(casterId);
    return { pending: [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.pending).map((e) => e.uuid), casting: a.statuses.has("casting") };
  },
  /** The messages made since the ids given that this run's fixtures made: speaking as the caster or the party, a cast card of the caster's spells, a cast-ended card, or the party's own card from this client. */
  leavings: async ({ since, casterId, partyId, casterUuid, partyName }) =>
    game.messages
      .filter((m) => !since.includes(m.id) && (m.speaker?.actor === casterId || m.speaker?.actor === partyId || String(m.flags?.["acks-extras"]?.castCard?.spellUuid ?? "").startsWith(`Actor.${casterId}.`) || m.getFlag("acks-extras", "castEnded")?.casterUuid === casterUuid || ((m.author?.id ?? m.user?.id) === game.user.id && m.speaker?.alias === partyName)))
      .map((m) => m.uuid),

  /* ---- the cast, as the Player seat presses it ---- */

  /** Close every framed window, open the caster's sheet on its Magic tab and press the spell row's Cast as a user does. Nothing is awaited: the dialog is the answer. */
  press: async ({ casterId, spellId }) => {
    const H = globalThis.__mps;
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    await actor.sheet.render(true);
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("magic", "primary");
    await H.sleep(500);
    const button = H.root(actor.sheet)?.querySelector(`[data-item-id='${spellId}'] [data-action='spellCast']`);
    if (!button) return { button: false };
    H.seen = new Set(H.cards(casterId));
    const before = item.system.cast;
    button.click();
    return { button: true, before };
  },
  /** The cast dialog, once it is up, as it reads now. */
  dialog: async ({ spellName }) => {
    const H = globalThis.__mps;
    const found = await H.poll(() => H.live(), { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    return { ...H.band(), titled: (H.live()?.querySelector(".window-title")?.textContent ?? "").includes(spellName) };
  },
  /** Cancel the open dialog, as a user dismisses it. */
  cancelDialog: async () => {
    const H = globalThis.__mps;
    H.live()?.querySelector('button[data-action="cancel"]')?.click();
    await H.sleep(800);
    return !H.live();
  },
  /** Type the count into the open dialog, press its confirm button, then clear every framed window off the map. */
  confirm: async ({ count }) => {
    const H = globalThis.__mps;
    if (!H.live()) return { dialog: false };
    if (count) await H.setCount(count);
    const ok = H.live()?.querySelector('button[data-action="cast"]');
    const disabled = !!ok?.disabled;
    if (!ok || disabled) return { dialog: true, pressed: false, disabled };
    ok.click();
    await H.sleep(500);
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    await H.sleep(500);
    return { dialog: true, pressed: true, disabled: false };
  },
  /** The warnings this seat's notifications raised since the last read; reading clears them. */
  warnsTake: async () => {
    const H = globalThis.__mps;
    const out = H.warns.slice();
    H.warns.length = 0;
    return out;
  },
  /** Whether core's placement has its previews up on this seat. */
  previews: async () => canvas.tokens?.preview?.children?.length ?? 0,
  /** The cast count and the cards made since the last press. */
  castState: async ({ casterId, spellId }) => {
    const H = globalThis.__mps;
    const item = game.actors.get(casterId).items.get(spellId);
    const cards = H.cards(casterId).filter((id) => !H.seen.has(id));
    return { cast: item.system.cast, cards, castCards: cards.filter((id) => !!game.messages.get(id)?.flags?.["acks-extras"]?.castCard) };
  },
  /**
   * One client point per entry of `cells`, found by scanning the viewport at least 60 px from every edge
   * for bare canvas that maps well inside the scene, each apart from the others and from `avoid`.
   */
  pointsFor: async ({ cells, avoid = [] }) => {
    const r = canvas.dimensions.sceneRect;
    // Core clamps the zoom and an animation can still be moving the view, so the pan repeats until two reads half a second apart agree.
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
    // Core's placement edge-pans the view while the pointer stands within 50 px of an edge, so no point is taken from that band.
    for (let y = 60; y <= H - 60; y += 30) {
      for (let x = 60; x <= W - 60; x += 30) {
        if (document.elementFromPoint(x, y) !== canvas.app.view) continue;
        const back = canvas.canvasCoordinatesFromClient({ x, y });
        if (back.x >= r.x + 100 && back.y >= r.y + 100 && back.x <= r.x + r.width - 100 && back.y <= r.y + r.height - 100) found.push({ x, y });
      }
    }
    if (!found.length) return cells.map(() => ({ x: 0, y: 0, onCanvas: false, hidden: document.hidden }));
    const cx = found.reduce((a, p) => a + p.x, 0) / found.length;
    const cy = found.reduce((a, p) => a + p.y, 0) / found.length;
    found.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const apart = Math.max(120, canvas.dimensions.size * canvas.stage.scale.x * 1.5);
    const out = [];
    for (const _cell of cells) {
      const pick = found.find((p) => [...out, ...avoid].every((o) => Math.hypot(p.x - o.x, p.y - o.y) >= apart));
      out.push(pick ? { x: pick.x, y: pick.y, onCanvas: true } : { x: 0, y: 0, onCanvas: false });
    }
    return out;
  },

  /* ---- reads and the Dismiss control ---- */

  /** The Magic tab's rows for these spells: the standing count's face and tooltip, and whether Dismiss is offered. */
  magicRows: async ({ actorId, spellIds }) => {
    const H = globalThis.__mps;
    const sheet = game.actors.get(actorId).sheet;
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); }
    sheet.changeTab("magic", "primary");
    await H.sleep(700);
    return spellIds.map((id) => {
      const row = H.root(sheet)?.querySelector(`[data-item-id='${id}']`);
      const count = row?.querySelector("[data-tooltip-text]");
      const dismiss = row?.querySelector("[data-action='spellDismiss']");
      return { row: !!row, face: count?.textContent.trim() ?? null, tipped: !!count?.dataset.tooltipText, dismiss: !!dismiss };
    });
  },
  /** Press the spell row's Dismiss on the Magic tab; the confirmation is answered apart. */
  pressDismiss: async ({ casterId, spellId }) => {
    const H = globalThis.__mps;
    const sheet = game.actors.get(casterId).sheet;
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); }
    sheet.changeTab("magic", "primary");
    await H.sleep(600);
    const button = H.root(sheet)?.querySelector(`[data-item-id='${spellId}'] [data-action='spellDismiss']`);
    if (!button) return { button: false };
    button.click();
    return { button: true };
  },
  /** Answer the open confirmation dialog. */
  answerConfirm: async ({ action }) => {
    const H = globalThis.__mps;
    const b = await H.poll(() => [...document.querySelectorAll(".application.dialog button, dialog button")].find((x) => x.dataset.action === action), { tries: 30 });
    if (!b) return false;
    b.click();
    await H.sleep(1500);
    return true;
  },
  /** Release the members of casts this run made, and delete the scene tokens of those casts: the run's own, by its cast ids. */
  clearCasts: async ({ fid, sceneId, castIds }) => {
    const H = globalThis.__mps;
    const svc = globalThis.acksExtras?.lib?.services?.get?.("party-roster") ?? (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("party-roster");
    const f = H.model.getFormation(fid);
    const ids = (f?.members ?? []).filter((m) => m?.actorId && H.model.isSummonMember(m) && castIds.includes(H.logic.summonOfData(H.model.memberOwnToken(m)?.toObject?.() ?? H.model.memberOwnToken(m)).summon?.castId)).map((m) => m.actorId);
    const released = ids.length ? (await svc.release(fid, ids)).released : 0;
    const scene = game.scenes.get(sceneId);
    const left = scene.tokens.filter((t) => castIds.includes(H.logic.summonOfData(t.toObject()).summon?.castId)).map((t) => t.id);
    if (left.length) await scene.deleteEmbeddedDocuments("Token", left);
    return { released, deleted: left.length };
  },
  restore: async () => {
    const H = globalThis.__mps;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
    window.removeEventListener("error", H.onError);
    window.removeEventListener("unhandledrejection", H.onRejection);
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

async function ready(api, label, { seconds = 240 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.summons && !!globalThis.acksExtras?.magic && !!globalThis.acksExtras?.formation`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A CDP session on a seat's page, for real mouse input. */
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
/** Bring a seat's page to the front, so its canvas lays out and renders (a hidden page does neither). */
async function frontSeat(port) {
  const s = await pageSession(port);
  await s.send("Page.bringToFront");
  s.close();
  await sleep(1200);
}
/** Click points for the Player seat, with its pointer parked in the viewport's middle first: core's placement pans the canvas while the pointer stands in the 50 px edge band. */
async function pointsFor(args) {
  const { x, y } = await run(player, P.middle);
  const s = await pageSession(PORTS.player);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  s.close();
  await sleep(400);
  return run(player, P.pointsFor, args);
}
/** A real click on the Player seat's page: the pointer moves there first, so core's preview follows it. */
async function clickAt({ x, y }, button = "left") {
  const s = await pageSession(PORTS.player);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(250);
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
  await sleep(80);
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
  s.close();
  await sleep(700);
}

/** Poll a page read until `test(result)` holds or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 60, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}

let gm = null;
let player = null;
let wasPaused = false;
let fid = null;
let partyId = null;
/** The uuids of what this run made: the only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
/** The run's own cast ids: teardown clears the members of these alone. */
const castIds = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 900_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

let messagesBefore = [];
let recordsBefore = [];
let casterUuid = "";
let casterId = "";
let sceneId = "";

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  check("the GM seat is the active GM and the player seat is a player, both with the summoning cast and the party's travel API", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2 && installed.castApi && seated.castApi && installed.formationApi, { gm: installed.role, player: seated.role });
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const marker = (m) => (MACHINE.own ? `${m}@${MACHINE.own}` : m);
  const scene = await gm.fixture("magic/party-scene", "Scene", {
    name: "QA Party Cast Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 },
  });
  const creature = await gm.fixture("magic/party-creature", "Actor", { name: "QA Party Cast Creature", type: "monster", ownership: { default: 0 } });
  const caster = await gm.fixture("magic/party-caster", "Actor", {
    name: "QA Party Cast Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [playerId]: 3 },
  });
  const nameOpen = "QA Party Open Spell";
  const nameRanged = "QA Party Ranged Spell";
  const spellOpen = await gm.fixture("magic/party-spell-open", "Item", { name: nameOpen, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const spellRanged = await gm.fixture("magic/party-spell-ranged", "Item", { name: nameRanged, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const party = await gm.fixture("magic/party", "Actor", { name: PARTY_NAME, type: `${SCOPE}.party` });
  sceneId = idOf(scene);
  const creatureId = idOf(creature);
  casterId = idOf(caster);
  const openId = idOf(spellOpen);
  const rangedId = idOf(spellRanged);
  partyId = idOf(party);
  casterUuid = `Actor.${casterId}`;
  const creatureUuid = `Actor.${creatureId}`;

  const shapedCreature = await run(gm, P.shapeCreature, { creatureId, playerId });
  check("shape: the creature is a monster and the world reads the Player's user at Observer (level 2)", shapedCreature.isMonster && shapedCreature.level === 2, shapedCreature);
  const seatRead = await until(player, P.observes, { uuid: creatureUuid }, (r) => r.observes, { tries: 20, every: 300 });
  check("the Player seat resolves the creature and may observe it", seatRead.resolves && seatRead.observes, seatRead);
  const shapedCaster = await run(gm, P.shapeCaster, { casterId });
  check("shape: the caster is a character with spells enabled", shapedCaster.enabled && shapedCaster.type === "character", shapedCaster);

  const formed = await run(gm, P.formationOf, { partyId });
  fid = formed.fid;
  note("the party's record was adopted for its actor", formed.adopted);
  const hold = await run(gm, P.holdings, { casterId, partyId });
  if (hold.holdingCaster) blocked(`a combat in the world holds the caster (${hold.holdingCaster} of ${hold.combats}); it is not this walk's and is left standing`);
  if (hold.holdingParty) blocked(`a combat in the world holds the party's actor (${hold.holdingParty} of ${hold.combats}); it is not this walk's and is left standing`);
  check("premise: no combat in the world holds the caster or the party's actor", hold.holdingCaster === 0 && hold.holdingParty === 0, hold);

  const shape = await run(gm, P.formParty, { fid, sceneId, casterId, tokenMarker: marker("magic/party-token") });
  if (shape.partyTokenUuid && !shape.markedToken) await gm.mark(shape.partyTokenUuid, "magic/party-token");
  note("party start shape", { summonMembers: shape.summonMembers, deployed: shape.deployed, staleCombatFlag: shape.staleCombat, recalled: shape.recalled });
  check("fixtures: the caster is a member of the party, its token on the field, the party delving", shape.hasCaster && !!shape.partyTokenUuid && shape.onScene && shape.delving, { delving: shape.delving, onScene: shape.onScene });
  check("the Player seat views the field without activating it", await run(player, P.view, { sceneId }));
  check("the GM seat views the field", await run(gm, P.view, { sceneId }));

  const st = () => run(gm, P.state, { fid, sceneId, casterId });
  /** Dismiss through the Magic tab's own control what a past run left, as a user does. */
  async function dismissStanding(spellId) {
    await run(player, P.clearWindows);
    const pressedDismiss = await run(player, P.pressDismiss, { casterId, spellId });
    if (pressedDismiss.button) await run(player, P.answerConfirm, { action: "yes" });
    await run(player, P.clearWindows);
    return pressedDismiss.button;
  }
  let lead = await st();
  if (lead.mine || lead.loose) {
    const left = { members: lead.mine, tokens: lead.loose };
    for (const spellId of [openId, rangedId]) await dismissStanding(spellId);
    lead = await until(gm, P.state, { fid, sceneId, casterId }, (s) => !s.mine && !s.loose, { tries: 30, every: 300 });
    note("leftover creatures dismissed through the Magic tab", left);
  }
  check("start: the caster is the party's one person, no summon member of it, none loose on the field", lead.hasCaster && lead.persons === 1 && lead.mine === 0 && lead.loose === 0, { persons: lead.persons, mine: lead.mine, loose: lead.loose });
  if (!lead.hasCaster || lead.mine || lead.loose) throw new Error("the party's start shape could not be reached");
  if (lead.casterTokens) blocked(`a token of the caster stands on the field (${lead.casterTokens}); the caster must be stashed, and the token is not this walk's`);
  check("premise: the caster has no token on the viewed field", lead.casterTokens === 0, { casterTokens: lead.casterTokens });
  const copiesBefore = await run(gm, P.copiesOf, { sourceUuid: creatureUuid });
  messagesBefore = await run(gm, P.messageIds);
  recordsBefore = await run(gm, P.recordUuids, { casterId });
  await run(player, P.drain);
  await run(gm, P.drain);

  /** Track what a cast left that the run owns: its cards, its caster records and any creature token the party did not gather, by id. */
  async function trackCast(spellId, settled, castId) {
    for (const id of settled.cards) await track(`ChatMessage.${id}`, "ChatMessage");
    for (const uuid of (await st()).looseMine ?? []) await track(uuid, "Token");
    if (castId) {
      if (!castIds.includes(castId)) castIds.push(castId);
      const records = await until(gm, P.recordsOf, { actorId: casterId, castId }, (r) => r.length >= 1, { tries: 20, every: 250 });
      for (const r of records) await track(r.uuid, "ActiveEffect");
      return records;
    }
    return [];
  }

  /* ---------------------------------------------------------------- */
  section("A. a spell with no range, cast from inside the party with no combat");
  const shapedA = await run(gm, P.reshape, { casterId, spellId: openId, ref: creatureUuid, amount: COUNT_OPEN, duration: DURATION, rangeFeet: null });
  check("A: start shape: the spell reads as a summoning spell with one row, no range, the count at 0", shapedA.isSpell && shapedA.summon && shapedA.rows === 1 && shapedA.range === null && shapedA.cast === 0, shapedA);
  const sA = await st();
  const pendingA0 = await run(gm, P.pending, { casterId });
  check("A: start shape: no summon member of the caster, none loose, no pending declaration on the caster", sA.mine === 0 && sA.loose === 0 && pendingA0.pending.length === 0, { mine: sA.mine, loose: sA.loose, pending: pendingA0.pending.length });
  const pressA = await run(player, P.press, { casterId, spellId: openId });
  check("A: the Magic tab's Cast button exists on the spell row", pressA.button && pressA.before === 0, { before: pressA.before });
  if (!pressA.button) throw new Error("no Cast button on the Player's Magic tab");
  const dlgA = await run(player, P.dialog, { spellName: nameOpen });
  check("A: the cast dialog opens, titled for the spell, with a Summon band whose one choice is the spell's row and no Targets band", dlgA.dialog && dlgA.titled && dlgA.summonBand && !dlgA.targetsBand && dlgA.values.length === 1 && dlgA.values[0] === creatureUuid, { choices: dlgA.values?.length, summonBand: dlgA.summonBand });
  check(`A: the confirm button's label before the press: "${dlgA.castLabel}"`, dlgA.castLabel.length > 0 && !dlgA.castDisabled, { label: dlgA.castLabel, disabled: dlgA.castDisabled, verdicts: dlgA.verdicts, count: dlgA.count });
  const midA = await run(player, P.castState, { casterId, spellId: openId });
  check("A: with the dialog up the cast count is unchanged and no card has posted", midA.cast === 0 && midA.cards.length === 0, { cast: midA.cast, cards: midA.cards.length });
  const answeredA = await run(player, P.confirm, { count: COUNT_OPEN });
  check("A: the confirm button is pressed and the windows are cleared off the map", answeredA.dialog && answeredA.pressed, answeredA);
  await frontSeat(PORTS.player);
  const previewsA = (await until(player, P.previews, {}, (n) => n > 0, { tries: 20, every: 250 })) ?? 0;
  note("A: placement previews up on the Player seat after the press, and the warnings the press raised", { previews: previewsA, warns: await run(player, P.warnsTake) });
  const clickedA = [];
  for (let i = 0; i < COUNT_OPEN; i++) {
    const [p] = await pointsFor({ cells: [i], avoid: clickedA });
    if (!p.onCanvas) {
      // The placement is still pending: a right click cancels it before the walk stops.
      try { await clickAt(await run(player, P.middle), "right"); } catch { /* the failure below is the one to report */ }
      throw new Error(`a click point left the bare canvas before its click: ${JSON.stringify(p)}`);
    }
    await clickAt(p);
    clickedA.push(p);
  }
  const afterA = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine >= COUNT_OPEN && s.loose === 0, { tries: 80, every: 300 });
  const castA = await until(player, P.castState, { casterId, spellId: openId }, (s) => s.cast > 0 && s.castCards.length >= 1, { tries: 60, every: 200 });
  await sleep(900);
  const settledA = await run(player, P.castState, { casterId, spellId: openId });
  const mineA = afterA.summons.filter((s) => s.by === casterUuid);
  const castIdA = mineA[0]?.cast ?? "";
  for (const uuid of await run(gm, P.copiesOf, { sourceUuid: creatureUuid })) if (!copiesBefore.includes(uuid)) await track(uuid, "Actor");
  const recordsA = await trackCast(openId, settledA, castIdA);
  check("A: the cast count rose by exactly one", settledA.cast === 1 && castA.cast === 1, { before: 0, after: settledA.cast });
  const pendingA = await run(gm, P.pending, { casterId });
  check("A: no pending-declaration record was written for the caster, and it does not carry the casting status", pendingA.pending.length === 0 && !pendingA.casting, { pending: pendingA.pending.length, casting: pendingA.casting });
  check("A: the creatures are members of the party: the member list grew by the count, under distinct ids, each naming the caster and one cast", mineA.length === sA.mine + COUNT_OPEN && new Set(mineA.map((x) => x.id)).size === COUNT_OPEN && !!castIdA && mineA.every((x) => x.by === casterUuid && x.cast === castIdA && x.spell === openId && x.stashed), { members: mineA.length });
  check("A: no creature token stands on the field", afterA.loose === 0 && afterA.deployedTokens === 0, { loose: afterA.loose, deployed: afterA.deployedTokens });
  check("A: the caster is still the party's one person with no token of its own on the field", afterA.persons === 1 && afterA.hasCaster && afterA.casterTokens === 0, { persons: afterA.persons, casterTokens: afterA.casterTokens });
  check("A: one cast card exists for the cast", settledA.castCards.length === 1, { castCards: settledA.castCards.length });
  check("A: the cast left one caster record naming the cast", recordsA.length === 1 && recordsA[0].role === "caster", { n: recordsA.length, role: recordsA[0]?.role });
  await run(player, P.clearWindows);
  const rowsA = await until(player, P.magicRows, { actorId: casterId, spellIds: [openId] }, (r) => r[0]?.face === `${COUNT_OPEN} standing`, { tries: 20, every: 400 });
  check(`A: the Magic tab's row for the spell reads "${COUNT_OPEN} standing", with a tooltip and a Dismiss control`, rowsA[0].row && rowsA[0].face === `${COUNT_OPEN} standing` && rowsA[0].tipped && rowsA[0].dismiss, rowsA[0]);
  const dismissedA = await run(player, P.pressDismiss, { casterId, spellId: openId });
  check("A: the Magic tab's Dismiss control is pressed and its confirmation answered Yes", dismissedA.button && (await run(player, P.answerConfirm, { action: "yes" })), dismissedA);
  const goneA = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine === 0 && s.loose === 0, { tries: 40, every: 300 });
  check("A: the dismissed creatures are gone from the party and none stands on the field", goneA.mine === 0 && goneA.loose === 0 && goneA.hasCaster, { mine: goneA.mine, loose: goneA.loose });
  await run(player, P.clearWindows);
  const dA = await run(player, P.drain);
  note("A: the warnings the Player seat raised after the press", dA.warns);
  check("A: no console error or uncaught error on the Player seat", !dA.errors.length && !dA.uncaught.length, { errors: dA.errors.length, uncaught: dA.uncaught.length });

  /* ---------------------------------------------------------------- */
  section("B. a spell that states a distance range, cast from inside the party (observation)");
  const shapedB = await run(gm, P.reshape, { casterId, spellId: rangedId, ref: creatureUuid, amount: COUNT_RANGED, duration: DURATION, rangeFeet: RANGE_FEET });
  check("B: start shape: the spell reads as a summoning spell with one row, the fixture's distance range, the count at 0", shapedB.isSpell && shapedB.summon && shapedB.rows === 1 && shapedB.range === RANGE_FEET && shapedB.cast === 0, shapedB);
  const sB = await st();
  const pendingB0 = await run(gm, P.pending, { casterId });
  check("B: start shape: no summon member of the caster, none loose, no pending declaration, still no token of the caster on the field", sB.mine === 0 && sB.loose === 0 && pendingB0.pending.length === 0 && sB.casterTokens === 0, { mine: sB.mine, loose: sB.loose, pending: pendingB0.pending.length, casterTokens: sB.casterTokens });
  await run(player, P.warnsTake);
  const rangeAtPlayer = await until(player, P.rangeRead, { casterId, spellId: rangedId, level: 5 }, (n) => n === RANGE_FEET, { tries: 20, every: 300 });
  if (rangeAtPlayer !== RANGE_FEET) {
    check("B: start shape: the Player seat's own reading of the spell gives the fixture's range, so the observation is void without it", false, { read: rangeAtPlayer, expected: RANGE_FEET });
    throw new Error("the module does not read the ranged spell's range on the Player seat; step B's observation is void");
  }
  check("B: start shape: the Player seat's own reading of the spell gives the fixture's range in feet", true, { read: rangeAtPlayer });
  const pressB = await run(player, P.press, { casterId, spellId: rangedId });
  check("B: the Magic tab's Cast button exists on the spell row", pressB.button && pressB.before === 0, { before: pressB.before });
  if (!pressB.button) throw new Error("no Cast button on the Player's Magic tab");
  const dlgB = await run(player, P.dialog, { spellName: nameRanged });
  check("B: the cast dialog opens, titled for the spell, with a Summon band", dlgB.dialog && dlgB.titled && dlgB.summonBand, { summonBand: dlgB.summonBand });
  const obs = { label: dlgB.castLabel, disabled: dlgB.castDisabled, verdicts: dlgB.verdicts, placementLine: dlgB.placement, count: dlgB.count, pressed: false, previews: 0, clicked: false, warnsAfterClick: [], castBefore: pressB.before, castAfter: null, pendingAfter: null, membersAfter: null, looseAfter: null, cards: null, outcome: "" };
  let spentB = null;
  if (dlgB.castDisabled) {
    obs.outcome = "the confirm button was off; nothing pressed";
    await run(player, P.cancelDialog);
  } else {
    const answeredB = await run(player, P.confirm, { count: COUNT_RANGED });
    obs.pressed = !!answeredB.pressed;
    obs.warnsAtPress = await run(player, P.warnsTake);
    await frontSeat(PORTS.player);
    obs.previews = (await until(player, P.previews, {}, (n) => n > 0, { tries: 20, every: 250 })) ?? 0;
    const [p] = await pointsFor({ cells: [0], avoid: [] });
    if (obs.previews > 0 && p.onCanvas) {
      await clickAt(p);
      obs.clicked = true;
      // Either the cast is spent (the click was taken) or the click is refused and the placement stays pending; a spend with nothing placed is read below.
      for (let n = 0; n < 40; n++) {
        const s = await run(player, P.castState, { casterId, spellId: rangedId });
        obs.warnsAfterClick.push(...(await run(player, P.warnsTake)));
        if (s.cast > 0) { spentB = s; break; }
        if (obs.warnsAfterClick.length && n >= 8) break;
        await sleep(300);
      }
      if (!spentB) {
        // The placement is pending after a refused click: a right click cancels it, as a user does.
        const [q] = await pointsFor({ cells: [0], avoid: [] });
        await clickAt(q.onCanvas ? q : await run(player, P.middle), "right");
        await sleep(2500);
        obs.warnsAfterClick.push(...(await run(player, P.warnsTake)));
      }
    } else {
      obs.outcome = obs.previews > 0 ? "no bare canvas to click" : "no placement started after the press";
      if (obs.previews > 0) { try { await clickAt(await run(player, P.middle), "right"); } catch { /* reported above */ } }
    }
  }
  const afterB = await until(gm, P.state, { fid, sceneId, casterId }, (s) => spentB ? s.mine >= COUNT_RANGED || s.loose > 0 : true, { tries: spentB ? 40 : 3, every: 300 });
  await sleep(spentB ? 900 : 0);
  const settledB = await run(player, P.castState, { casterId, spellId: rangedId });
  const pendingB = await run(gm, P.pending, { casterId });
  const mineB = afterB.summons.filter((s) => s.by === casterUuid);
  const castIdB = mineB[0]?.cast ?? "";
  for (const uuid of await run(gm, P.copiesOf, { sourceUuid: creatureUuid })) if (!copiesBefore.includes(uuid)) await track(uuid, "Actor");
  await trackCast(rangedId, settledB, castIdB);
  const placedB = afterB.mine > 0 || afterB.loose > 0;
  Object.assign(obs, { castAfter: settledB.cast, pendingAfter: pendingB.pending.length, membersAfter: afterB.mine, looseAfter: afterB.loose, cards: settledB.cards.length });
  obs.outcome ||= placedB ? "creatures placed" : (settledB.cast > pressB.before ? "spent with nothing placed" : "nothing placed, nothing spent");
  const refusalText = [...(obs.warnsAtPress ?? []), ...obs.warnsAfterClick, ...(dlgB.castDisabled ? dlgB.verdicts.map((v) => v.text) : [])].filter(Boolean);
  note("B observation", { ...obs, refusalText });
  check(`B observation: confirm label "${obs.label}", outcome "${obs.outcome}", cast ${obs.castBefore} to ${obs.castAfter}, pending record ${obs.pendingAfter ? "present" : "absent"}, refusal text ${refusalText.length ? JSON.stringify(refusalText) : "none"}`, true);
  if (!placedB) {
    check("B invariant: nothing placed, so nothing was spent: the cast count is unchanged and no cast card posted", settledB.cast === pressB.before && settledB.castCards.length === 0, { before: pressB.before, after: settledB.cast, castCards: settledB.castCards.length });
    check("B invariant: nothing placed, so no pending-declaration record exists and the caster does not carry the casting status", pendingB.pending.length === 0 && !pendingB.casting, { pending: pendingB.pending.length, casting: pendingB.casting });
    check("B invariant: nothing placed, so the user was shown a refusal they can read (a notice or a footer verdict)", refusalText.length > 0 && refusalText.every((t) => t.trim().length > 0), { refusalText });
  } else {
    check("B invariant: creatures placed, so the cast count rose by exactly one", settledB.cast === pressB.before + 1, { before: pressB.before, after: settledB.cast });
    check("B invariant: creatures placed, so no pending-declaration record exists", pendingB.pending.length === 0, { pending: pendingB.pending.length });
    check("B invariant: creatures placed, so they joined the party as members and none stands on the field", mineB.length === COUNT_RANGED && afterB.loose === 0 && afterB.deployedTokens === 0, { members: mineB.length, loose: afterB.loose });
    await run(player, P.clearWindows);
    const dismissedB = await run(player, P.pressDismiss, { casterId, spellId: rangedId });
    if (dismissedB.button) await run(player, P.answerConfirm, { action: "yes" });
    const goneB = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine === 0 && s.loose === 0, { tries: 40, every: 300 });
    check("B: the placed creatures were dismissed through the Magic tab's Dismiss control", dismissedB.button && goneB.mine === 0 && goneB.loose === 0, { button: dismissedB.button, mine: goneB.mine });
  }
  await run(player, P.clearWindows);
  const dB = await run(player, P.drain);
  check("B: no console error or uncaught error on the Player seat", !dB.errors.length && !dB.uncaught.length, { errors: dB.errors.length, uncaught: dB.uncaught.length });
  const gEnd = await run(gm, P.drain);
  check("no console error or uncaught error on the GM seat over the walk", !gEnd.errors.length && !gEnd.uncaught.length, { errors: gEnd.errors.length, uncaught: gEnd.uncaught.length });
  walkDone();
} catch (err) {
  if (err instanceof WalkBlocked) note("walk blocked", err.message);
  else {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  try {
    if (player) await run(player, P.clearWindows);
    // The start shape held no summon member of the caster, so any that stands now is the run's own: its cast id joins the list.
    if (gm && fid && sceneId && casterId) {
      const left = await run(gm, P.state, { fid, sceneId, casterId });
      for (const s of left.summons ?? []) if (s.by === casterUuid && s.cast && !castIds.includes(s.cast)) castIds.push(s.cast);
      for (const uuid of left.looseMine ?? []) await track(uuid, "Token");
      if (castIds.length) note("members and tokens of the run's casts cleared", await run(gm, P.clearCasts, { fid, sceneId, castIds }));
    }
  } catch (err) { console.error("clear casts:", err?.message ?? err); }
  try {
    // The caster's records that appeared during the run, and the cards its fixtures spoke: the run's own leavings, listed by id.
    if (gm && casterId && recordsBefore) {
      const now = await run(gm, P.recordUuids, { casterId });
      for (const uuid of now) if (!recordsBefore.includes(uuid)) await track(uuid, "ActiveEffect");
    }
    if (gm && partyId && casterId && messagesBefore.length) {
      const cards = await run(gm, P.leavings, { since: messagesBefore, casterId, partyId, casterUuid, partyName: PARTY_NAME });
      for (const uuid of cards) await track(uuid, "ChatMessage");
    }
  } catch (err) { console.error("leavings:", err?.message ?? err); }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's own cards, records and copies go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  if (gm && wasPaused) {
    try { note("paused again", await run(gm, P.pause, { paused: true })); } catch (err) { console.error("pause restore:", err?.message ?? err); }
  }
  console.log("fixtures kept: magic/party-scene, magic/party-creature, magic/party-caster, magic/party-spell-open, magic/party-spell-ranged, magic/party, magic/party-token");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
