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
 * The caster marches inside a party that is in no fight, so the cast makes its
 * creatures members of that party (`joinSummons`) and places no token anywhere.
 *   A. A summoning spell with no range, naming a creature the Player may
 *      observe. Before the press a GM-seat observer starts counting token
 *      creations on the field (a count only; nothing is ever deleted by it).
 *      The dialog's placement line is the joins line naming the party. After
 *      the press the placement previews stay at zero and no click is made; the
 *      cast count rose by exactly one; no pending-declaration record was
 *      written; the creatures are members of the party, stashed (the member
 *      list grew by the count) and the observer's count is zero; the caster's
 *      Magic tab row reads the standing count and the joined count, each with
 *      the party tooltip; the Player's card footnote carries the joined line.
 *      One joined creature is then deployed and recalled through the party's
 *      own deployment and its hit points equal the stash's both ways (the first
 *      token ever made from a stash that was never placed). The Magic tab's
 *      Dismiss control then removes the members.
 *   B. The same with a spell that states a distance range. The caster has no
 *      token to measure a range from, and a join needs none: the dialog's line
 *      reads the joins text and not the range line, no `noCaster` refusal is
 *      raised, the cast count rose by exactly one, one member is stashed and
 *      none stands loose, no pending record exists, and Dismiss removes it.
 *   3. (T-0842) A held end that leaves the creature. The held spell's row says
 *      `stays`; the Player casts from inside the party and the Player's seat ends
 *      the concentration by the status's toggle. The stashed member carries
 *      `summon.lost` `stays` in its stash, still a member with the Player's
 *      ownership and its disposition as they were; the party sheet's Order tab
 *      on both seats draws `i.fa-link-slash` on its name line, labelled with the
 *      stays badge's text; the one funnel card is drawn by the Player's seat with
 *      Dismiss and Restore, and the Player's Dismiss, answered Yes, releases the
 *      member.
 *   4. (T-0842) The same with the row saying `hostile`. The stash carries
 *      `lost` `hostile`, the Player's user at 0 in its ownership delta and the
 *      disposition hostile, and the member stays; the Order tab draws
 *      `i.fa-triangle-exclamation.down-badge` on both seats; the Player's seat
 *      draws the funnel card with Restore and no Dismiss; the Magic tab's row
 *      Dismiss on the Player's sheet is refused `controlLost`, and the member
 *      stands. The Judge's seat deploys the party's member: the token made reads
 *      hostile, the Player's user does not own it, and the Order tab still draws
 *      the hostile badge; the Judge's Magic tab Dismiss removes it, the party
 *      holding the caster alone again.
 * Prints booleans and counts, never a name or an id; the ledger's own sweep
 * report is the one place ids print. Machine values arrive through ./_env.mjs.
 * The recorders on the seats attach after `ready`, so a clean console here says
 * nothing about `init`, `setup` or `ready`.
 *
 * Fixtures, kept and found by marker (the GM seat builds what is missing):
 * `magic/party-scene` (the field both seats view), `magic/party-creature` (a
 * monster whose ownership gives the Player's user Observer; the shape step
 * writes the level and the walk asserts it reads back 2 on both seats before
 * any cast), `magic/party-caster` (a character the Player owns, spells
 * enabled), `magic/party-spell-open` and `magic/party-spell-ranged` (its two
 * summoning spells, each rewritten whole by its step; the ranged one states a
 * distance the fixture sets), `magic/summon-party-held` (a spell on the same
 * caster for steps 3 and 4, rewritten whole by each with one summon row naming
 * the creature by uuid, `amount` 1, a stationary concentration and the row's
 * `controlEnd` that step needs), `magic/party` (an `acks-extras.party` actor whose
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
/** The held spell's duration: a stationary concentration, which the Player's seat ends by the status's toggle. */
const HELD = { shape: "concentration", concentration: "stationary" };
/** The status the held spell's caster record is bound to. */
const HELD_STATUS = "concentrating-and-stationary";
/** The ranged spell's distance, in feet: a figure the fixture sets. */
const RANGE_FEET = 30;
/** How many creatures each spell's row asks for. */
const COUNT_OPEN = 2;
const COUNT_RANGED = 1;
/** The creature's hit points: above 0, since a party member at 0 is carried and never deployed. */
const CREATURE_HP = 6;
/** The party fixture's name: the name the formation's own cards speak under. */
const PARTY_NAME = "QA Party Cast Party";
/** The caster fixture's name, which the range line the dialog would draw without a party names. */
const CASTER_NAME = "QA Party Cast Caster";

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

  /** The creature gives the Player's user Observer and stands at a hit-point figure above 0 (a member at 0 is carried, never deployed); answers the level the world reads back. */
  shapeCreature: async ({ creatureId, playerId, hp }) => {
    const actor = game.actors.get(creatureId);
    await actor.update({ [`ownership.${playerId}`]: 2, "system.hp.value": hp, "system.hp.max": hp });
    await new Promise((r) => setTimeout(r, 400));
    return { level: game.actors.get(creatureId).ownership?.[playerId] ?? null, isMonster: actor.type === "monster", hp: game.actors.get(creatureId).system.hp?.value ?? null };
  },
  /** A localized string as this seat reads it. */
  loc: async ({ key, data }) => game.i18n.format(key, data ?? {}),
  /** Start counting the tokens created on a scene on this seat (a count only; nothing it sees is ever deleted). */
  watchTokens: async ({ sceneId }) => {
    const H = globalThis.__mps;
    H.created = 0;
    if (H.createHook) Hooks.off("createToken", H.createHook);
    H.createHook = Hooks.on("createToken", (token) => { if (token.parent?.id === sceneId) H.created++; });
    return true;
  },
  /** The tokens created on the watched scene since `watchTokens`. */
  watched: async () => globalThis.__mps.created ?? null,
  /** Stop counting. */
  unwatchTokens: async () => {
    const H = globalThis.__mps;
    if (H.createHook) Hooks.off("createToken", H.createHook);
    H.createHook = null;
    return true;
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
  /** One spell's flag replaced whole (the old flag deleted first): its summon row (with its `controlEnd` where given), its duration and, where given, its distance range in feet. The count is 0 again. */
  reshape: async ({ casterId, spellId, ref, amount, duration, rangeFeet, controlEnd }) => {
    const item = game.actors.get(casterId).items.get(spellId);
    await item.update({ "flags.acks-extras.spell": new foundry.data.operators.ForcedDeletion() });
    const flag = { schools: ["summoning"], effects: [{ type: "summon", ref, amount, ...(controlEnd ? { controlEnd } : {}) }], duration };
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
  /**
   * Deploy one stashed summon member through the party's own deployment, then read the token it made: its hit points beside the
   * stash's (the stash's own delta figure, else its actor's). Answers the token's uuid so the run can track it.
   */
  deployOne: async ({ fid, actorId }) => {
    const H = globalThis.__mps;
    const f = H.model.getFormation(fid);
    const member = f.members.find((m) => m?.actorId === actorId);
    if (!member || !H.model.isSummonMember(member)) return { ok: false, reason: "no such summon member" };
    // The stash is lowered by one through the roster's own write first, so the figure the stash holds differs from the copy's and a token that read the copy instead would show it.
    const svc = (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("party-roster");
    const lowered = await svc.adjustStashedHp(fid, actorId, (hp) => (hp.value > 1 ? hp.value - 1 : null));
    // One read of the record, so the member handed to the deployment is one of that record's own.
    const fresh = H.model.getFormation(fid);
    const again = fresh.members.find((m) => m?.actorId === actorId);
    const copyHp = H.model.getMemberActor(again)?.system?.hp?.value ?? null;
    const stashHp = again.tokenData?.delta?.system?.hp?.value ?? null;
    const made = await H.dep.deployMembers(fresh, { members: [again] });
    const token = made[0] ?? null;
    return { ok: !!token, made: made.length, uuid: token?.uuid ?? null, lowered: !!lowered, copyHp, stashHp, hp: token?.actor?.system?.hp?.value ?? null, deployed: H.dep.isMemberDeployed(H.model.getFormation(fid).members.find((m) => m?.actorId === actorId)) };
  },
  /** Recall one deployed summon member through the party's own recall, then read the stash it came back as. */
  recallOne: async ({ fid, actorId }) => {
    const H = globalThis.__mps;
    const f = H.model.getFormation(fid);
    const member = f.members.find((m) => m?.actorId === actorId);
    if (!member) return { ok: false, reason: "no such member" };
    await H.dep.recallMembers(f, { members: [member] });
    const after = H.model.getFormation(fid).members.find((m) => m?.actorId === actorId);
    return { ok: !!after, deployed: !!after && H.dep.isMemberDeployed(after), stashed: !!after?.tokenData, stashHp: after?.tokenData?.delta?.system?.hp?.value ?? H.model.getMemberActor(after)?.system?.hp?.value ?? null };
  },
  /** What a card's rendered body shows on this seat: its footnote. The card is drawn in the Chat tab, so that tab is brought up first. */
  cardFootnote: async ({ messageId }) => {
    const H = globalThis.__mps;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    const el = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"]`), { tries: 40, every: 200 });
    if (!el) return { found: false };
    await H.sleep(500);
    return { found: true, footnote: el.querySelector(".acks-extras-roll-footnote")?.textContent?.trim() ?? null };
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
  /* ---- reads and the Dismiss control ---- */

  /** The Magic tab's rows for these spells: the standing count's face and tooltip, the joined count's, and whether Dismiss is offered. */
  magicRows: async ({ actorId, spellIds }) => {
    const H = globalThis.__mps;
    const sheet = game.actors.get(actorId).sheet;
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); }
    sheet.changeTab("magic", "primary");
    await H.sleep(700);
    return spellIds.map((id) => {
      const row = H.root(sheet)?.querySelector(`[data-item-id='${id}']`);
      const count = row?.querySelector("[data-summon=standing]");
      const joined = row?.querySelector("[data-summon=joined]");
      const dismiss = row?.querySelector("[data-action='spellDismiss']");
      return { row: !!row, face: count?.textContent.trim() ?? null, tipped: !!count?.dataset.tooltipText, tip: count?.dataset.tooltipText ?? null, joinedFace: joined?.textContent.trim() ?? null, joinedTip: joined?.dataset.tooltipText ?? null, dismiss: !!dismiss };
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
  /** End a held cast by the status's own toggle, as the HUD does it, on whichever seat runs this. */
  endHeld: async ({ casterId, status }) => { await game.actors.get(casterId).toggleStatusEffect(status, { active: false }); return true; },
  /** Whether the caster carries the held status. */
  holds: async ({ casterId, status }) => game.actors.get(casterId).statuses.has(status),
  /** The funnel card and the clock's card a cast posted, by uuid. */
  endCards: async ({ castId }) => [...game.messages].filter((m) => m.flags?.["acks-extras"]?.castHeldEnd?.castId === castId || m.flags?.["acks-extras"]?.castEnded?.castId === castId).map((m) => ({ uuid: m.uuid, id: m.id, held: !!m.flags["acks-extras"].castHeldEnd, outcome: m.flags["acks-extras"].castHeldEnd?.outcome ?? m.flags["acks-extras"].castEnded?.outcome ?? null })),
  /** What this seat's rendered funnel card shows: the creatures it lists, its Dismiss buttons (the all-creatures one counted apart) and its Restore. The card is drawn in the Chat tab, so that tab is brought up first. */
  heldCard: async ({ messageId }) => {
    const H = globalThis.__mps;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    const el = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"]`), { tries: 40, every: 200 });
    if (!el) return { found: false };
    await H.sleep(600);
    return {
      found: true,
      creatures: el.querySelectorAll(".acks-extras-cast-held .acks-extras-bucket__row").length,
      dismiss: el.querySelectorAll("[data-acks-extras-held-dismiss]:not([data-all])").length,
      dismissAll: el.querySelectorAll("[data-acks-extras-held-dismiss][data-all]").length,
      restore: el.querySelectorAll("[data-acks-extras-held-restore]").length,
    };
  },
  /** Press the funnel card's Dismiss for its one listed creature on this seat; the confirmation is answered apart. */
  cardPress: async ({ messageId }) => {
    const H = globalThis.__mps;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    const el = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"]`), { tries: 40, every: 200 });
    const button = el?.querySelector("[data-acks-extras-held-dismiss]:not([data-all])");
    if (!button) return { button: false };
    button.click();
    return { button: true };
  },
  /**
   * Press the spell row's Dismiss on the Magic tab of this seat's sheet of the caster and watch for what follows: the warnings raised, and whether a
   * confirmation opened (it is answered No and closed, since the walk wants the answer to the refusal, not a removal).
   */
  pressDismissWatch: async ({ casterId, spellId }) => {
    const H = globalThis.__mps;
    const sheet = game.actors.get(casterId).sheet;
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); }
    sheet.changeTab("magic", "primary");
    await H.sleep(600);
    const button = H.root(sheet)?.querySelector(`[data-item-id='${spellId}'] [data-action='spellDismiss']`);
    if (!button) return { button: false };
    H.warns.length = 0;
    button.click();
    const dialogUp = () => [...document.querySelectorAll(".application.dialog button, dialog button")].find((x) => x.dataset.action === "no");
    const seen = await H.poll(() => H.warns.length > 0 || !!dialogUp(), { tries: 30, every: 200 });
    const no = dialogUp();
    if (no) no.click();
    await H.sleep(400);
    return { button: true, reacted: !!seen, warns: H.warns.slice(), dialog: !!no };
  },
  /**
   * The party member's stash as the record holds it: still a member, still stashed, the control-end stamp, the level the Player's user holds in the
   * stash's ownership delta (null where it holds no entry) and the stash's disposition.
   */
  stashOf: async ({ fid, actorId, playerId }) => {
    const H = globalThis.__mps;
    const member = H.model.getFormation(fid)?.members.find((m) => m?.actorId === actorId);
    if (!member) return { member: false };
    const data = member.tokenData ?? null;
    return {
      member: true,
      summon: H.model.isSummonMember(member),
      stashed: !!data && !member.deployedTokenId,
      deployed: !!member.deployedTokenId,
      lost: H.logic.summonOfData(data).summon?.lost ?? null,
      level: data?.delta?.ownership?.[playerId] ?? null,
      disposition: data?.disposition ?? null,
      hostile: data?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE,
    };
  },
  /**
   * The party sheet opened fresh on its Order tab on this seat, and one member's name line read: the badge glyphs it draws and their `aria-label`s.
   * The hostile glyph is selected with its `down-badge` class, since the skull and the eye share that class.
   */
  orderBadge: async ({ partyId, actorId }) => {
    const H = globalThis.__mps;
    const app = game.actors.get(partyId).sheet;
    try { await app.close({ animate: false }); } catch { /* not open */ }
    await app.render(true);
    const el = await H.poll(() => (H.root(app)?.isConnected ? H.root(app) : null), { tries: 40, every: 200 });
    if (!el) return { rendered: false };
    el.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(900);
    const row = await H.poll(() => H.root(app)?.querySelector(`li.member[data-actor-id="${actorId}"]`), { tries: 20, every: 250 });
    if (!row) return { rendered: true, row: false };
    const name = row.querySelector(".info .name");
    const stays = name?.querySelector("i.fa-link-slash");
    const hostile = name?.querySelector("i.fa-triangle-exclamation.down-badge");
    return { rendered: true, row: true, stays: !!stays, staysLabel: stays?.getAttribute("aria-label") ?? null, hostile: !!hostile, hostileLabel: hostile?.getAttribute("aria-label") ?? null };
  },
  /** A token as the world holds it: its disposition, and whether the Player's user owns it (read on this seat for the user given). */
  tokenRead: async ({ uuid, playerId }) => {
    let token = null;
    try { token = await fromUuid(uuid); } catch { token = null; }
    if (!token) return { resolves: false };
    return { resolves: true, disposition: token.disposition, hostile: token.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE, playerOwns: !!token.testUserPermission(game.users.get(playerId), "OWNER"), lost: token.actor?.getFlag("acks-extras", "summon")?.lost ?? null };
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
/**
 * End a placement that started when none should have, as a user does: a right click in the middle of the Player seat's view.
 * A join starts no placement, so this runs only on the failure path, and the walk makes no click of its own otherwise.
 */
async function cancelPlacement() {
  await frontSeat(PORTS.player);
  const { x, y } = await run(player, P.middle);
  const s = await pageSession(PORTS.player);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(250);
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 });
  await sleep(80);
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 });
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
    name: CASTER_NAME, type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [playerId]: 3 },
  });
  const nameOpen = "QA Party Open Spell";
  const nameRanged = "QA Party Ranged Spell";
  const spellOpen = await gm.fixture("magic/party-spell-open", "Item", { name: nameOpen, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const spellRanged = await gm.fixture("magic/party-spell-ranged", "Item", { name: nameRanged, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const nameHeld = "QA Party Held Spell";
  const spellHeld = await gm.fixture("magic/summon-party-held", "Item", { name: nameHeld, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const party = await gm.fixture("magic/party", "Actor", { name: PARTY_NAME, type: `${SCOPE}.party` });
  sceneId = idOf(scene);
  const creatureId = idOf(creature);
  casterId = idOf(caster);
  const openId = idOf(spellOpen);
  const rangedId = idOf(spellRanged);
  const heldId = idOf(spellHeld);
  partyId = idOf(party);
  casterUuid = `Actor.${casterId}`;
  const creatureUuid = `Actor.${creatureId}`;

  const shapedCreature = await run(gm, P.shapeCreature, { creatureId, playerId, hp: CREATURE_HP });
  check("shape: the creature is a monster standing above 0 hit points and the world reads the Player's user at Observer (level 2)", shapedCreature.isMonster && shapedCreature.level === 2 && shapedCreature.hp === CREATURE_HP, shapedCreature);
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
  async function dismissStanding(spellId, seat = player) {
    await run(seat, P.clearWindows);
    const pressedDismiss = await run(seat, P.pressDismiss, { casterId, spellId });
    if (pressedDismiss.button) await run(seat, P.answerConfirm, { action: "yes" });
    await run(seat, P.clearWindows);
    return pressedDismiss.button;
  }
  let lead = await st();
  if (lead.mine || lead.loose) {
    const left = { members: lead.mine, tokens: lead.loose };
    for (const spellId of [openId, rangedId]) await dismissStanding(spellId);
    // A held spell's member a failed run left may have turned hostile, which only the Judge's seat may dismiss.
    await dismissStanding(heldId, gm);
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
  // The words this walk compares against are the module's own, read from the seat that shows them.
  const joinsLine = await run(player, P.loc, { key: "ACKS-MAGIC.cast.dialog.summonJoins", data: { party: PARTY_NAME } });
  const joinedFace = (n) => run(player, P.loc, { key: "ACKS-CHARACTER.magic.joined", data: { n, party: PARTY_NAME } });
  const partyTip = (n) => run(player, P.loc, { key: "ACKS-CHARACTER.magic.standingTipParty", data: { n, party: PARTY_NAME } });
  await run(gm, P.watchTokens, { sceneId });
  const pressA = await run(player, P.press, { casterId, spellId: openId });
  check("A: the Magic tab's Cast button exists on the spell row", pressA.button && pressA.before === 0, { before: pressA.before });
  if (!pressA.button) throw new Error("no Cast button on the Player's Magic tab");
  const dlgA = await run(player, P.dialog, { spellName: nameOpen });
  check("A: the cast dialog opens, titled for the spell, with a Summon band whose one choice is the spell's row and no Targets band", dlgA.dialog && dlgA.titled && dlgA.summonBand && !dlgA.targetsBand && dlgA.values.length === 1 && dlgA.values[0] === creatureUuid, { choices: dlgA.values?.length, summonBand: dlgA.summonBand });
  check("A: the dialog's placement line is the joins line naming the party, and no range line stands in its place", dlgA.placement === joinsLine && dlgA.placement.length > 0, { isJoins: dlgA.placement === joinsLine });
  check("A: the confirm button is on and carries a label before the press, with no verdict against the cast", dlgA.castLabel.length > 0 && !dlgA.castDisabled && dlgA.verdicts.every((v) => v.severity !== "block"), { label: dlgA.castLabel.length > 0, disabled: dlgA.castDisabled, verdicts: dlgA.verdicts.length, count: dlgA.count });
  const midA = await run(player, P.castState, { casterId, spellId: openId });
  check("A: with the dialog up the cast count is unchanged and no card has posted", midA.cast === 0 && midA.cards.length === 0, { cast: midA.cast, cards: midA.cards.length });
  const answeredA = await run(player, P.confirm, { count: COUNT_OPEN });
  check("A: the confirm button is pressed and the windows are cleared off the map", answeredA.dialog && answeredA.pressed, answeredA);
  // No placement starts: the previews are sampled over the seconds the cast takes to settle, and the highest read is the one kept.
  let previewsA = 0;
  for (let n = 0; n < 8; n++) {
    previewsA = Math.max(previewsA, await run(player, P.previews));
    await sleep(250);
  }
  if (previewsA > 0) {
    // A placement is pending, so the cast took the click path: a right click ends it before the walk stops.
    try { await cancelPlacement(); } catch { /* the failure below is the one to report */ }
    check("A: the placement previews stay at zero: no click is asked of the Player", false, { previews: previewsA });
    throw new Error("the cast started a placement instead of joining the party");
  }
  check("A: the placement previews stay at zero: no click is asked of the Player", previewsA === 0, { previews: previewsA });
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
  const createdA = await run(gm, P.watched);
  check("A: the GM seat's observer saw no token created on the field from the press to the settled cast", createdA === 0, { created: createdA });
  await run(gm, P.unwatchTokens);
  check("A: the caster is still the party's one person with no token of its own on the field", afterA.persons === 1 && afterA.hasCaster && afterA.casterTokens === 0, { persons: afterA.persons, casterTokens: afterA.casterTokens });
  check("A: one cast card exists for the cast", settledA.castCards.length === 1, { castCards: settledA.castCards.length });
  check("A: the cast left one caster record naming the cast", recordsA.length === 1 && recordsA[0].role === "caster", { n: recordsA.length, role: recordsA[0]?.role });
  await run(player, P.clearWindows);
  const standingFace = await run(player, P.loc, { key: "ACKS-CHARACTER.magic.standing", data: { n: COUNT_OPEN } });
  const rowsA = await until(player, P.magicRows, { actorId: casterId, spellIds: [openId] }, (r) => r[0]?.face === standingFace && !!r[0]?.joinedFace, { tries: 20, every: 400 });
  check("A: the Magic tab's row reads the standing count, with the party's tooltip on it and a Dismiss control", rowsA[0].row && rowsA[0].face === standingFace && rowsA[0].tip === (await partyTip(COUNT_OPEN)) && rowsA[0].dismiss, { row: rowsA[0].row, face: rowsA[0].face === standingFace, tip: rowsA[0].tip === (await partyTip(COUNT_OPEN)), dismiss: rowsA[0].dismiss });
  check("A: the Magic tab's row reads the joined count beside it, with the party tooltip on it", rowsA[0].joinedFace === (await joinedFace(COUNT_OPEN)) && rowsA[0].joinedTip === (await partyTip(COUNT_OPEN)), { face: rowsA[0].joinedFace === (await joinedFace(COUNT_OPEN)), tip: rowsA[0].joinedTip === (await partyTip(COUNT_OPEN)) });
  const cardA = await run(player, P.cardFootnote, { messageId: settledA.castCards[0] });
  const joinedLine = await run(player, P.loc, { key: "ACKS-MAGIC.cast.line.summonedJoined", data: { n: COUNT_OPEN, party: PARTY_NAME } });
  check("A: the cast card, as the Player seat draws it, carries the joined line in its footnote", cardA.found && typeof cardA.footnote === "string" && cardA.footnote.includes(joinedLine), { found: cardA.found, carries: !!cardA.footnote?.includes(joinedLine) });
  const memberA = mineA[0];
  const outA = await run(gm, P.deployOne, { fid, actorId: memberA.id });
  if (outA.uuid) await track(outA.uuid, "Token");
  check("A: one joined creature is deployed through the party's own deployment: a token is made and the member stands deployed", outA.ok && outA.made === 1 && outA.deployed, { made: outA.made, deployed: outA.deployed });
  check("A: the deployed token's hit points equal the stash's, which the roster lowered below the copy's, so a token read from the copy would differ (the first token ever made from a stash that was never placed)", outA.lowered && outA.stashHp !== null && outA.stashHp < outA.copyHp && outA.hp === outA.stashHp && outA.hp > 0, { lowered: outA.lowered, belowCopy: outA.stashHp < outA.copyHp, equal: outA.hp === outA.stashHp, positive: outA.hp > 0 });
  const backA = await run(gm, P.recallOne, { fid, actorId: memberA.id });
  check("A: the same creature is recalled into the party, stashed again with the same hit points, and no token of it stands", backA.ok && !backA.deployed && backA.stashed && backA.stashHp === outA.stashHp, { deployed: backA.deployed, stashed: backA.stashed, equal: backA.stashHp === outA.stashHp });
  const dismissedA =await run(player, P.pressDismiss, { casterId, spellId: openId });
  check("A: the Magic tab's Dismiss control is pressed and its confirmation answered Yes", dismissedA.button && (await run(player, P.answerConfirm, { action: "yes" })), dismissedA);
  const goneA = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine === 0 && s.loose === 0, { tries: 40, every: 300 });
  check("A: the dismissed creatures are gone from the party and none stands on the field", goneA.mine === 0 && goneA.loose === 0 && goneA.hasCaster, { mine: goneA.mine, loose: goneA.loose });
  await run(player, P.clearWindows);
  const dA = await run(player, P.drain);
  note("A: the count of warnings the Player seat raised after the press", dA.warns.length);
  check("A: no console error or uncaught error on the Player seat", !dA.errors.length && !dA.uncaught.length, { errors: dA.errors.length, uncaught: dA.uncaught.length });

  /* ---------------------------------------------------------------- */
  section("B. a spell that states a distance range, cast from inside the party");
  const shapedB = await run(gm, P.reshape, { casterId, spellId: rangedId, ref: creatureUuid, amount: COUNT_RANGED, duration: DURATION, rangeFeet: RANGE_FEET });
  check("B: start shape: the spell reads as a summoning spell with one row, the fixture's distance range, the count at 0", shapedB.isSpell && shapedB.summon && shapedB.rows === 1 && shapedB.range === RANGE_FEET && shapedB.cast === 0, shapedB);
  const sB = await st();
  const pendingB0 = await run(gm, P.pending, { casterId });
  check("B: start shape: no summon member of the caster, none loose, no pending declaration, still no token of the caster on the field", sB.mine === 0 && sB.loose === 0 && pendingB0.pending.length === 0 && sB.casterTokens === 0, { mine: sB.mine, loose: sB.loose, pending: pendingB0.pending.length, casterTokens: sB.casterTokens });
  await run(player, P.warnsTake);
  const rangeAtPlayer = await until(player, P.rangeRead, { casterId, spellId: rangedId, level: 5 }, (n) => n === RANGE_FEET, { tries: 20, every: 300 });
  if (rangeAtPlayer !== RANGE_FEET) {
    check("B: start shape: the Player seat's own reading of the spell gives the fixture's range, without which the step proves nothing about a range", false, { read: rangeAtPlayer, expected: RANGE_FEET });
    throw new Error("the module does not read the ranged spell's range on the Player seat; step B proves nothing about a range");
  }
  check("B: start shape: the Player seat's own reading of the spell gives the fixture's range in feet", true, { read: rangeAtPlayer });
  const pressB = await run(player, P.press, { casterId, spellId: rangedId });
  check("B: the Magic tab's Cast button exists on the spell row", pressB.button && pressB.before === 0, { before: pressB.before });
  if (!pressB.button) throw new Error("no Cast button on the Player's Magic tab");
  const dlgB = await run(player, P.dialog, { spellName: nameRanged });
  check("B: the cast dialog opens, titled for the spell, with a Summon band", dlgB.dialog && dlgB.titled && dlgB.summonBand, { summonBand: dlgB.summonBand });
  const withinLine = await run(player, P.loc, { key: "ACKS-MAGIC.cast.dialog.summonWithin", data: { feet: RANGE_FEET, name: CASTER_NAME } });
  check("B: the dialog's placement line is the joins line and not the range line the spell's distance would give", dlgB.placement === joinsLine && dlgB.placement !== withinLine && !dlgB.placement.includes(`${RANGE_FEET}`), { isJoins: dlgB.placement === joinsLine, isRange: dlgB.placement === withinLine });
  check("B: the confirm button is on, so a spell with a distance and a caster with no token is not refused before the press", !dlgB.castDisabled && dlgB.verdicts.every((v) => v.severity !== "block"), { disabled: dlgB.castDisabled, verdicts: dlgB.verdicts.length });
  const answeredB = await run(player, P.confirm, { count: COUNT_RANGED });
  check("B: the confirm button is pressed and the windows are cleared off the map", answeredB.dialog && answeredB.pressed, answeredB);
  const warnsB = await run(player, P.warnsTake);
  const noCaster = await run(player, P.loc, { key: "ACKS-LIB.summons.refused.noCaster" });
  let previewsB = 0;
  for (let n = 0; n < 6; n++) {
    previewsB = Math.max(previewsB, await run(player, P.previews));
    await sleep(250);
  }
  if (previewsB > 0) {
    try { await cancelPlacement(); } catch { /* the failure below is the one to report */ }
    check("B: the placement previews stay at zero", false, { previews: previewsB });
    throw new Error("the ranged cast started a placement instead of joining the party");
  }
  const afterB = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine >= COUNT_RANGED, { tries: 40, every: 300 });
  await sleep(900);
  const settledB = await run(player, P.castState, { casterId, spellId: rangedId });
  const warnsB2 = [...warnsB, ...(await run(player, P.warnsTake))];
  const pendingB = await run(gm, P.pending, { casterId });
  const mineB = afterB.summons.filter((s) => s.by === casterUuid);
  const castIdB = mineB[0]?.cast ?? "";
  for (const uuid of await run(gm, P.copiesOf, { sourceUuid: creatureUuid })) if (!copiesBefore.includes(uuid)) await track(uuid, "Actor");
  await trackCast(rangedId, settledB, castIdB);
  check("B: the placement previews stay at zero: no click is asked of the Player", previewsB === 0, { previews: previewsB });
  check("B: no noCaster refusal was raised on the Player seat", !warnsB2.includes(noCaster), { warnings: warnsB2.length });
  check("B: the cast count rose by exactly one", settledB.cast === pressB.before + 1, { before: pressB.before, after: settledB.cast });
  check("B: no pending-declaration record exists and the caster does not carry the casting status", pendingB.pending.length === 0 && !pendingB.casting, { pending: pendingB.pending.length, casting: pendingB.casting });
  check("B: one member is stashed in the party and none stands loose on the field", mineB.length === COUNT_RANGED && mineB.every((x) => x.stashed && x.by === casterUuid && x.spell === rangedId) && afterB.loose === 0 && afterB.deployedTokens === 0, { members: mineB.length, loose: afterB.loose, deployed: afterB.deployedTokens });
  await run(player, P.clearWindows);
  const dismissedB = await run(player, P.pressDismiss, { casterId, spellId: rangedId });
  if (dismissedB.button) await run(player, P.answerConfirm, { action: "yes" });
  const goneB = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine === 0 && s.loose === 0, { tries: 40, every: 300 });
  check("B: the Magic tab's Dismiss control removes the joined creature from the party", dismissedB.button && goneB.mine === 0 && goneB.loose === 0, { button: dismissedB.button, mine: goneB.mine, loose: goneB.loose });
  await run(player, P.clearWindows);
  const dB = await run(player, P.drain);
  check("B: no console error or uncaught error on the Player seat", !dB.errors.length && !dB.uncaught.length, { errors: dB.errors.length, uncaught: dB.uncaught.length });
  /* ---------------------------------------------------------------- */
  /**
   * One cast of the held spell from inside the party, the Player's seat ending its concentration by the status's toggle, the row's `controlEnd` as given
   * (steps 3 and 4). Answers what the outcome-specific checks read: the cast id, the member's id, the stash before and after the end, the funnel card and the
   * sizes of the party's summon list before the end.
   */
  async function castHeld(controlEnd, label) {
    const shaped = await run(gm, P.reshape, { casterId, spellId: heldId, ref: creatureUuid, amount: 1, duration: HELD, rangeFeet: null, controlEnd });
    check(`${label}: start shape: the held spell reads as a summoning spell with one row and the count at 0`, shaped.isSpell && shaped.summon && shaped.rows === 1 && shaped.cast === 0, shaped);
    await until(player, P.castState, { casterId, spellId: heldId }, (s) => s.cast === 0, { tries: 40, every: 200 });
    const s0 = await st();
    const pending0 = await run(gm, P.pending, { casterId });
    check(`${label}: start shape: no summon member of the caster, none loose, no pending declaration, no token of the caster on the field, no held status on the caster`, s0.mine === 0 && s0.loose === 0 && pending0.pending.length === 0 && s0.casterTokens === 0 && !(await run(gm, P.holds, { casterId, status: HELD_STATUS })), { mine: s0.mine, loose: s0.loose, pending: pending0.pending.length, casterTokens: s0.casterTokens });
    await run(player, P.warnsTake);
    const press = await run(player, P.press, { casterId, spellId: heldId });
    check(`${label}: the Magic tab's Cast button exists on the held spell's row`, press.button && press.before === 0, { before: press.before });
    if (!press.button) throw new Error("no Cast button on the Player's Magic tab for the held spell");
    const dlg = await run(player, P.dialog, { spellName: nameHeld });
    check(`${label}: the dialog's placement line is the joins line and Cast is on`, dlg.dialog && dlg.placement === joinsLine && !dlg.castDisabled && dlg.verdicts.every((v) => v.severity !== "block"), { isJoins: dlg.placement === joinsLine, disabled: dlg.castDisabled });
    const answered = await run(player, P.confirm, { count: 1 });
    check(`${label}: the confirm button is pressed and the windows are cleared off the map`, answered.dialog && answered.pressed, answered);
    let previews = 0;
    for (let n = 0; n < 6; n++) {
      previews = Math.max(previews, await run(player, P.previews));
      await sleep(250);
    }
    if (previews > 0) {
      try { await cancelPlacement(); } catch { /* the failure below is the one to report */ }
      check(`${label}: the placement previews stay at zero`, false, { previews });
      throw new Error("the held cast started a placement instead of joining the party");
    }
    const after = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine >= 1 && s.loose === 0, { tries: 80, every: 300 });
    await until(player, P.castState, { casterId, spellId: heldId }, (s) => s.cast > 0 && s.castCards.length >= 1, { tries: 60, every: 200 });
    await sleep(900);
    const settled = await run(player, P.castState, { casterId, spellId: heldId });
    const mine = after.summons.filter((s) => s.by === casterUuid);
    const castId = mine[0]?.cast ?? "";
    const actorId = mine[0]?.id ?? "";
    for (const uuid of await run(gm, P.copiesOf, { sourceUuid: creatureUuid })) if (!copiesBefore.includes(uuid)) await track(uuid, "Actor");
    const records = await trackCast(heldId, settled, castId);
    check(`${label}: the cast joined one member to the party, stashed, none stands loose, and left a concentration record the Player's seat reads as the held status`, mine.length === 1 && mine[0].stashed && after.loose === 0 && records.length >= 1 && (await run(player, P.holds, { casterId, status: HELD_STATUS })), { members: mine.length, loose: after.loose, records: records.length });
    const pre = await run(gm, P.stashOf, { fid, actorId, playerId });
    check(`${label}: before the end the stash is a summon member's, unstamped, and gives the Player's user ownership`, pre.member && pre.summon && pre.stashed && pre.lost === null && pre.level >= 3, { stashed: pre.stashed, lost: pre.lost, level: pre.level });
    check(`${label}: the party sheet's Order tab draws neither control-end badge for it before the end`, await (async () => {
      const b = await run(gm, P.orderBadge, { partyId, actorId });
      await run(gm, P.clearWindows);
      return b.row && !b.stays && !b.hostile;
    })());
    await run(player, P.endHeld, { casterId, status: HELD_STATUS });
    const cards = await until(gm, P.endCards, { castId }, (l) => l.some((c) => c.held), { tries: 40, every: 250 });
    for (const c of cards) await track(c.uuid, "ChatMessage");
    const card = cards.find((c) => c.held) ?? null;
    check(`${label}: ending the concentration posts the one funnel card, whose flag carries the outcome ${controlEnd}`, cards.filter((c) => c.held).length === 1 && card?.outcome === controlEnd, { cards: cards.length, outcome: card?.outcome ?? null });
    const post = await until(gm, P.stashOf, { fid, actorId, playerId }, (s) => s.lost === controlEnd, { tries: 40, every: 250 });
    return { castId, actorId, pre, post, card, membersBefore: after.summons.length };
  }
  /** The party sheet's Order tab on one seat, read for a member's badges; the sheet is closed after. */
  const orderOn = async (seat, actorId) => {
    const read = await run(seat, P.orderBadge, { partyId, actorId });
    await run(seat, P.clearWindows);
    return read;
  };

  section("3. a held end that leaves the creature (T-0842): the stash is stamped, the member stays, the Player's seat draws Dismiss and Restore");
  const r3 = await castHeld("stays", "3");
  check("3: the stash carries summon.lost stays, is still a stashed member of the party, and keeps the Player's ownership and the disposition it had", r3.post.member && r3.post.stashed && r3.post.summon && r3.post.lost === "stays" && r3.post.level === r3.pre.level && r3.post.disposition === r3.pre.disposition, { lost: r3.post.lost, sameLevel: r3.post.level === r3.pre.level, sameDisposition: r3.post.disposition === r3.pre.disposition });
  const staysText = await run(player, P.loc, { key: "ACKS-FORMATION.app.summonStaysBadge" });
  for (const [label, seat] of [["Judge", gm], ["Player", player]]) {
    const read = await orderOn(seat, r3.actorId);
    check(`3: the party sheet's Order tab on the ${label}'s seat draws the member's name line with an i.fa-link-slash whose aria-label is the stays badge's text, and no hostile badge`, read.row && read.stays && read.staysLabel === staysText && staysText.length > 0 && !read.hostile, { row: read.row, stays: read.stays, label: read.staysLabel === staysText, hostile: read.hostile });
  }
  const cardOn3 = r3.card ? await run(player, P.heldCard, { messageId: r3.card.id }) : { found: false };
  check("3: the Player's seat draws the funnel card listing the creature with Dismiss and Restore", cardOn3.found && cardOn3.creatures === 1 && cardOn3.dismiss >= 1 && cardOn3.restore >= 1, cardOn3);
  const cardOnGm3 = r3.card ? await run(gm, P.heldCard, { messageId: r3.card.id }) : { found: false };
  check("3: the Judge's seat draws the same card with Dismiss and Restore", cardOnGm3.found && cardOnGm3.creatures === 1 && cardOnGm3.dismiss >= 1 && cardOnGm3.restore >= 1, cardOnGm3);
  const dismiss3 = r3.card ? await run(player, P.cardPress, { messageId: r3.card.id }) : { button: false };
  check("3: the Player presses the card's Dismiss and answers Yes", dismiss3.button && (await run(player, P.answerConfirm, { action: "yes" })), dismiss3);
  const gone3 = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine === 0 && s.loose === 0, { tries: 40, every: 300 });
  check("3: the member is released: the party's summon list shrank by one and the caster is still its one person", gone3.mine === 0 && gone3.loose === 0 && gone3.summons.length === r3.membersBefore - 1 && gone3.persons === 1 && gone3.hasCaster, { mine: gone3.mine, loose: gone3.loose, summons: gone3.summons.length, before: r3.membersBefore });
  await run(player, P.clearWindows);
  const d3 = await run(player, P.drain);
  check("3: no console error or uncaught error on the Player seat", !d3.errors.length && !d3.uncaught.length, { errors: d3.errors.length, uncaught: d3.uncaught.length });

  section("4. a held end that turns the creature hostile (T-0842): the stash is stamped and the Player's ownership is gone, the Player's seat draws Restore and no Dismiss");
  const r4 = await castHeld("hostile", "4");
  check("4: the stash carries summon.lost hostile, the Player's user at ownership 0 and the disposition hostile, and the creature is still a stashed member", r4.post.member && r4.post.stashed && r4.post.summon && r4.post.lost === "hostile" && r4.post.level === 0 && r4.post.hostile, { lost: r4.post.lost, level: r4.post.level, hostile: r4.post.hostile });
  const hostileText = await run(player, P.loc, { key: "ACKS-FORMATION.app.summonHostileBadge" });
  for (const [label, seat] of [["Judge", gm], ["Player", player]]) {
    const read = await orderOn(seat, r4.actorId);
    check(`4: the party sheet's Order tab on the ${label}'s seat draws the member's name line with an i.fa-triangle-exclamation.down-badge whose aria-label is the hostile badge's text, and no stays badge`, read.row && read.hostile && read.hostileLabel === hostileText && hostileText.length > 0 && !read.stays, { row: read.row, hostile: read.hostile, label: read.hostileLabel === hostileText, stays: read.stays });
  }
  const cardOn4 = r4.card ? await run(player, P.heldCard, { messageId: r4.card.id }) : { found: false };
  check("4: the Player's seat draws the funnel card listing the creature with Restore and no Dismiss", cardOn4.found && cardOn4.creatures === 1 && cardOn4.dismiss === 0 && cardOn4.dismissAll === 0 && cardOn4.restore >= 1, cardOn4);
  const cardOnGm4 = r4.card ? await run(gm, P.heldCard, { messageId: r4.card.id }) : { found: false };
  check("4: the Judge's seat draws the same card with Dismiss and Restore", cardOnGm4.found && cardOnGm4.creatures === 1 && cardOnGm4.dismiss >= 1 && cardOnGm4.restore >= 1, cardOnGm4);
  const controlLost = await run(player, P.loc, { key: "ACKS-LIB.summons.refused.controlLost" });
  await run(player, P.clearWindows);
  const refused4 = await run(player, P.pressDismissWatch, { casterId, spellId: heldId });
  check("4: the Magic tab's row Dismiss, pressed on the Player's sheet, is refused with the controlLost notice before any confirmation opens", refused4.button && refused4.reacted && refused4.warns.includes(controlLost) && !refused4.dialog, { button: refused4.button, warns: refused4.warns?.length, dialog: refused4.dialog });
  await run(player, P.clearWindows);
  const stands4 = await st();
  check("4: the hostile member stands in the party after the refusal", stands4.mine === 1 && (await run(gm, P.stashOf, { fid, actorId: r4.actorId, playerId })).member, { mine: stands4.mine });
  // The Judge's seat deploys the party's member through the travel API, as step 1 does for its one creature.
  const out4 = await run(gm, P.deployOne, { fid, actorId: r4.actorId });
  if (out4.uuid) await track(out4.uuid, "Token");
  check("4: the member is deployed through the party's own deployment: a token is made from the stash and the member stands deployed", out4.ok && out4.made === 1 && out4.deployed, { made: out4.made, deployed: out4.deployed });
  const placedGm = out4.uuid ? await run(gm, P.tokenRead, { uuid: out4.uuid, playerId }) : { resolves: false };
  check("4: the token made from the stash reads hostile and the Player's user does not own it", placedGm.resolves && placedGm.hostile && !placedGm.playerOwns && placedGm.lost === "hostile", { hostile: placedGm.hostile, playerOwns: placedGm.playerOwns, lost: placedGm.lost });
  const placedPlayer = out4.uuid ? await until(player, P.tokenRead, { uuid: out4.uuid, playerId }, (r) => r.resolves, { tries: 30, every: 300 }) : { resolves: false };
  check("4: the Player's seat reads the same: the token is hostile and testUserPermission(user, OWNER) on it is false", placedPlayer.resolves && placedPlayer.hostile && !placedPlayer.playerOwns, { resolves: placedPlayer.resolves, hostile: placedPlayer.hostile, playerOwns: placedPlayer.playerOwns });
  const readDeployed = await orderOn(gm, r4.actorId);
  check("4: with the party deployed the Order tab's row still draws the hostile badge, read off the placed token's actor", readDeployed.row && readDeployed.hostile && readDeployed.hostileLabel === hostileText && !readDeployed.stays, { row: readDeployed.row, hostile: readDeployed.hostile, label: readDeployed.hostileLabel === hostileText });
  // The Judge's seat dismisses it through the Magic tab's row Dismiss on the caster's sheet.
  await run(gm, P.clearWindows);
  const dismissed4 = await run(gm, P.pressDismiss, { casterId, spellId: heldId });
  check("4: the Judge's seat presses the Magic tab's row Dismiss and answers Yes", dismissed4.button && (await run(gm, P.answerConfirm, { action: "yes" })), dismissed4);
  const gone4 = await until(gm, P.state, { fid, sceneId, casterId }, (s) => s.mine === 0 && s.loose === 0 && s.deployedTokens === 0, { tries: 40, every: 300 });
  const tokenGone4 = out4.uuid ? await until(gm, P.tokenRead, { uuid: out4.uuid, playerId }, (r) => !r.resolves, { tries: 20, every: 300 }) : { resolves: false };
  check("4: the token is gone and the party holds the caster alone again", !tokenGone4.resolves && gone4.mine === 0 && gone4.loose === 0 && gone4.deployedTokens === 0 && gone4.persons === 1 && gone4.hasCaster, { tokenGone: !tokenGone4.resolves, mine: gone4.mine, loose: gone4.loose, persons: gone4.persons });
  await run(gm, P.clearWindows);
  const d4 = await run(player, P.drain);
  check("4: no console error or uncaught error on the Player seat", !d4.errors.length && !d4.uncaught.length, { errors: d4.errors.length, uncaught: d4.uncaught.length });
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
  try { if (gm) await run(gm, P.unwatchTokens); } catch (err) { console.error("unwatch:", err?.message ?? err); }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's own cards, records and copies go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  if (gm && wasPaused) {
    try { note("paused again", await run(gm, P.pause, { paused: true })); } catch (err) { console.error("pause restore:", err?.message ?? err); }
  }
  console.log("fixtures kept: magic/party-scene, magic/party-creature, magic/party-caster, magic/party-spell-open, magic/party-spell-ranged, magic/summon-party-held, magic/party, magic/party-token");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
