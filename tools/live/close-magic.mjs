/**
 * Live walk, close-magic: closes three magic topics on the GM and Player seats, one PASS or FAIL per
 * control the topic changed (the owner: "Yes, walk them"; "only what changed is checked").
 *
 *   T-0816 (f0dd913a, docs/magic/TESTING.md step "Apply follows the caster's ownership")
 *     The Judge casts at a target and the card's entry is put back to the pending shape the cast posted
 *     it in (the entry the cast made, captured at creation and written back, since the cast applies its
 *     own entries before anyone could press). A Player who owns the caster, and is not the card's
 *     writer, presses Apply on the card in the chat log and the apply lands. Throw, Undo and Apply to
 *     one's own targets stay with the card's writer: the Judge's seat is drawn them, the Player's is not.
 *     Revert needs a procedure step no invented spell carries: not reached.
 *   T-0798 (f94bedf5, docs/magic/TESTING.md declare step 19)
 *     A begun fight holds the caster off their turn. The Judge's cast window warns which fight holds
 *     the caster and offers Cast now between Cancel and Declare; pressing it casts at the free moment
 *     with no declaration. The Player's window has no Cast now and no warning.
 *   summon-control (55d0ad8e, c524f1b7, docs/magic/TESTING.md "One cast's control end set by hand")
 *     The Outcome select on the held-end card and the time-end card: drawn for a seat that owns every
 *     listed creature and for no other; Under control puts back the owners `summonOwnership` grants and
 *     the disposition the world copy's prototype token gives, and clears the lost stamp, for a token, a
 *     deployed party member and a stash; a Player's pick reaches the GM client through the relay, and
 *     the relay refuses a Player who owns none of the creatures.
 *
 * Stand-ins, said where they are used: the cards are posted by the module's own end paths, not by a
 * lost concentration or a visible clock run-out of an earlier cast. The held-end card by
 * `endCasterHeld` (the caster casting again deletes the held record) and the time-end card by the world
 * clock passing a timed caster record; the creatures by `placeSummons` and `joinSummons` with the
 * positions given (core's click-to-place cannot be scripted). Each pick on a card is the select's DOM
 * change event on the seat's own chat log.
 *
 * Fixtures: kept, by marker, `magic/close-class`, `-caster` (a character the Player owns), `-foe`,
 * `-scene`, `-dmg`, `-throw`, `-sum` (the summoning spell, control ends hostile) and `-creature` (a
 * monster whose prototype token is friendly). The party stage builds a party, its own caster and spells
 * with `api.create`, so the run's ledger sweeps them. The world clock moves forward by the seconds
 * printed and is not moved back. Prints booleans and counts, never a book's word.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P, note, section, check, idOf, run, ev, ready, ledgerFor, finish, summarize, stage,
  SAVE_TARGET, LEVEL, rowOf, spellFlag,
} from "./_magic-cast-kit.mjs";
import { CONTROL_KINDS } from "../../scripts/lib/magic-vocab.mjs";

const { browser, origin } = MACHINE;
const KEY = "close-magic-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_500_000);
const [CONTROL_A] = Object.keys(CONTROL_KINDS);
const MOD = "/modules/acks-extras/scripts/";
/** The Outcome select's options, in order, and its flag keys. */
const PICKS = ["control", "stays", "gone", "hostile"];

let gm = null;
let player = null;
const ledger = ledgerFor(() => gm);
const W = {};
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Runs a page function on a seat until `ok(result)` holds, up to `tries` times; answers the last result. */
async function until(seat, fn, args, ok, { tries = 20, every = 500 } = {}) {
  let r = await run(seat, fn, args);
  for (let n = 0; n < tries && !ok(r); n++) { await sleep(every); r = await run(seat, fn, args); }
  return r;
}

/** An invented summoning spell flag: one summon row naming the creature, two of them, its control end as given. */
const summonFlag = (ref, controlEnd) => spellFlag({
  rows: [{ key: "sum", type: "summon", ref, amount: 2, summonFormat: "conjuration", control: CONTROL_A, controlEnd, origin: "", name: "" }],
  target: { model: "none" },
});
const damageFlag = (delivery) => spellFlag({ rows: [rowOf("bolt", "damage", { roll: "2d4+1", damage: ["fire"], ...(delivery ? { delivery } : {}) })] });

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */
const C = {
  install: async () => {
    const H = globalThis.__mck;
    H.pend = H.pend ?? {};
    if (!H.pendHook) {
      H.pendHook = Hooks.on("createChatMessage", (m) => {
        const card = m.flags?.["acks-extras"]?.castCard;
        if (card?.entries) H.pend[m.id] = JSON.parse(JSON.stringify(card.entries));
      });
    }
    H.flagOf = (id) => { const f = game.messages.get(id)?.flags?.["acks-extras"]; return f?.castHeldEnd ?? f?.castEnded ?? null; };
    return true;
  },
  restore: async () => {
    const H = globalThis.__mck;
    if (H?.pendHook) { Hooks.off("createChatMessage", H.pendHook); H.pendHook = null; }
    return true;
  },
  /** The card as a seat draws it. */
  card: async ({ messageId, wait }) => {
    const H = globalThis.__mck;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch {}
    const find = () => document.querySelector(`[data-message-id="${messageId}"]`);
    const el = await H.poll(find, { tries: wait ?? 30, every: 250 });
    if (!el) return { drawn: false };
    await H.sleep(300);
    const live = find() ?? el;
    const sel = live.querySelector(".acks-extras-cast-held__control select");
    const line = live.querySelector("[data-acks-extras-control-line]");
    const m = game.messages.get(messageId);
    return {
      drawn: true,
      select: !!sel,
      value: sel?.value ?? null,
      options: sel ? [...sel.options].map((o) => o.value) : [],
      disabledOptions: sel ? [...sel.options].filter((o) => o.disabled).map((o) => o.value) : [],
      tip: sel?.dataset.tooltip ?? null,
      aria: !!sel?.getAttribute("aria-label"),
      hasTitle: sel?.hasAttribute("title") ?? false,
      hint: (live.querySelector(".acks-extras-cast-held__hint")?.textContent.trim().length ?? 0) > 0,
      line: !!line,
      dismiss: !!live.querySelector("[data-acks-extras-held-dismiss], [data-acks-extras-cast-dismiss]"),
      actions: [...live.querySelectorAll("[data-action^='magicCast']")].map((b) => b.dataset.action),
      isAuthor: !!m?.isAuthor,
      canEdit: !!m?.isOwner,
    };
  },
  /** Pick a value in the card's select by the DOM change event, and wait for the card's flag to hold it. */
  pick: async ({ messageId, value }) => {
    const H = globalThis.__mck;
    const find = () => document.querySelector(`[data-message-id="${messageId}"] .acks-extras-cast-held__control select`);
    const sel = find();
    if (!sel) return { found: false };
    const warnFrom = H.warns?.length ?? 0;
    let renders = 0;
    const hook = Hooks.on("renderChatMessageHTML", (m) => { if (m.id === messageId) renders++; });
    const seen = new Set();
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 30; i++) { await H.sleep(100); const a = document.activeElement; seen.add(a?.closest?.(".acks-extras-cast-held__control") ? "select" : a?.tagName ?? "none"); }
    Hooks.off("renderChatMessageHTML", hook);
    const landed = await H.poll(() => (H.flagOf(messageId)?.outcome === value ? true : null), { tries: 60, every: 250 });
    await H.sleep(900);
    const flag = H.flagOf(messageId);
    const now = find();
    return { found: true, landed: !!landed, outcome: flag?.outcome ?? null, setBy: flag?.setBy ?? null, warns: (H.warns ?? []).slice(warnFrom), selectNow: !!now, selectValue: now?.value ?? null, focusBack: !!now && document.activeElement === now, visible: document.visibilityState, renders, activeSeen: [...seen], hasFocus: document.hasFocus(), byMe: flag?.setBy === game.user.name };
  },
  /** The relay op from this seat, as the select sends it, outside the DOM so a seat without the select can be refused. */
  relayPick: async ({ messageId, outcome }) => {
    const hand = await import("/modules/acks-extras/scripts/magic/cast-control-hand.mjs");
    const H = globalThis.__mck;
    const warnFrom = H.warns?.length ?? 0;
    const answer = await hand.pressControl(game.messages.get(messageId), outcome);
    return { answer, warns: (H.warns ?? []).slice(warnFrom).length };
  },
  /** A thing the Player's user id and name are. */
  who: async () => ({ id: game.user.id, name: game.user.name }),
  /** Shape the friendly creature: its prototype token's disposition is the one every restore must give back. */
  shapeCreature: async ({ actorId }) => {
    const a = game.actors.get(actorId);
    await a.update({ "prototypeToken.disposition": 1, "prototypeToken.actorLink": false });
    return { look: a.prototypeToken.disposition };
  },
  /** The module's world copies of a creature (they carry the source's marker, which makes a twin of it): by source uuid, or by this walk's marker. */
  copies: async ({ sourceUuid }) => game.actors.filter((a) => { const c = a.getFlag("acks-extras", "summonCopy"); return !!c && (sourceUuid ? c.sourceUuid === sourceUuid : String(a.flags?.world?.fixture ?? "").startsWith("magic/close-creature")); }).map((a) => a.uuid),
  /** Set the look the world copy's prototype token gives, the figure Under control must give back (a monster copy is made hostile, which would make the check say nothing). */
  shapeCopy: async ({ sourceUuid }) => {
    const copies = game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid);
    for (const a of copies) await a.update({ "prototypeToken.disposition": 1 });
    return { n: copies.length, look: copies[0]?.prototypeToken?.disposition ?? null };
  },
  /** Summon through the module's placement path with positions given; answers the tokens made. */
  place: async ({ casterId, spellId, sourceUuid, castId, positions }) => {
    const S = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    const caster = game.actors.get(casterId);
    const r = await S.placeSummons(caster, { sourceUuid, count: positions.length, spellId, positions, castId });
    return { ok: !!r?.ok, reason: r?.reason ?? null, tokenUuids: r?.tokenUuids ?? [] };
  },
  /** End a cast's concentration by the caster casting again: write the held record and delete it by `endCasterHeld`. */
  endHeld: async ({ casterId, spellId, castId }) => {
    const H = globalThis.__mck;
    const caster = game.actors.get(casterId);
    const spell = caster.items.get(spellId);
    const { heldRecordData, endCasterHeld } = await import("/modules/acks-extras/scripts/magic/cast-held.mjs");
    const data = heldRecordData({ spell, caster, castId, role: "caster" }, { held: "mobile", now: game.time.worldTime, tail: { none: "none" } });
    const [rec] = await caster.createEmbeddedDocuments("ActiveEffect", [data]);
    const ids = await endCasterHeld(caster);
    const msg = await H.poll(() => [...game.messages].find((m) => m.flags?.["acks-extras"]?.castHeldEnd?.castId === castId), { tries: 80, every: 250 });
    return { recorded: !!rec, ended: ids.length, messageId: msg?.id ?? null, uuid: msg?.uuid ?? null, outcome: msg?.flags?.["acks-extras"]?.castHeldEnd?.outcome ?? null, listed: msg?.flags?.["acks-extras"]?.castHeldEnd?.summons?.length ?? 0 };
  },
  /** End a cast by the clock: a timed caster record, the world clock passed it, and the card the module posts. */
  timeEnd: async ({ casterId, spellId, castId, seconds }) => {
    const H = globalThis.__mck;
    const caster = game.actors.get(casterId);
    const spell = caster.items.get(spellId);
    const { spellEffectData } = await import("/modules/acks-extras/scripts/magic/spell-effect.mjs");
    const data = spellEffectData({ spell, caster, castId, role: "caster", duration: { value: 1, units: "minutes" } });
    const [rec] = await caster.createEmbeddedDocuments("ActiveEffect", [data]);
    const from = game.time.worldTime;
    await game.time.advance(seconds);
    const msg = await H.poll(() => [...game.messages].find((m) => m.flags?.["acks-extras"]?.castEnded?.castId === castId), { tries: 100, every: 250 });
    return { recUuid: rec?.uuid ?? null, advanced: game.time.worldTime - from, messageId: msg?.id ?? null, uuid: msg?.uuid ?? null, outcome: msg?.flags?.["acks-extras"]?.castEnded?.outcome ?? null, named: msg?.flags?.["acks-extras"]?.castEnded?.spellName !== undefined, n: msg?.flags?.["acks-extras"]?.castEnded?.n ?? null };
  },
  /** What the creature tokens stand as, against what a restore must give: owners, disposition, lost stamp. */
  tokens: async ({ uuids, casterId, creatureId }) => {
    const L = await import("/modules/acks-extras/scripts/lib/summons-logic.mjs");
    const caster = game.actors.get(casterId);
    const want = L.summonOwnership(caster.ownership, [], (id) => !!game.users.get(id)?.isGM);
    const look = game.actors.get(creatureId)?.prototypeToken?.disposition;
    const out = [];
    for (const uuid of uuids) {
      const t = await fromUuid(uuid);
      if (!t) { out.push({ gone: true }); continue; }
      const copy = game.actors.get(t.actorId);
      const copyLook = copy?.prototypeToken?.disposition;
      const own = Object.entries(t.actor?.ownership ?? {}).filter(([id]) => id !== "default" && !game.users.get(id)?.isGM);
      const wantKeys = Object.keys(want);
      out.push({
        gone: false,
        disposition: t.disposition,
        hostile: t.disposition === L.HOSTILE_DISPOSITION,
        isPrototype: t.disposition === copyLook,
        copyIsCreature: t.actorId === creatureId,
        copyLook,
        ownersGranted: wantKeys.length > 0 && wantKeys.every((id) => (t.actor?.ownership?.[id] ?? 0) >= want[id]),
        ownersNone: own.every(([, level]) => level === 0),
        lost: t.actor?.getFlag("acks-extras", "summon")?.lost ?? null,
      });
    }
    return { rows: out, wantCount: Object.keys(want).length, look };
  },
  /** The party member rows' stashed token data, read from the formation record, against the same expectation. */
  stash: async ({ fid, actorIds, casterId, creatureId }) => {
    const L = await import("/modules/acks-extras/scripts/lib/summons-logic.mjs");
    const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    const caster = game.actors.get(casterId);
    const want = L.summonOwnership(caster.ownership, [], (id) => !!game.users.get(id)?.isGM);
    const rows = model.getFormation(fid).members;
    return actorIds.map((id) => {
      const m = rows.find((r) => r?.actorId === id);
      const td = m?.tokenData ?? null;
      if (!td) return { present: !!m, stashed: false, deployed: !!m?.deployedTokenId };
      const copyLook = game.actors.get(td.actorId)?.prototypeToken?.disposition;
      const own = Object.entries(td.delta?.ownership ?? {}).filter(([k]) => k !== "default" && !game.users.get(k)?.isGM);
      const record = td.delta?.flags?.["acks-extras"]?.summon ?? {};
      return {
        present: true,
        stashed: !m.deployedTokenId,
        deployed: !!m.deployedTokenId,
        disposition: td.disposition,
        hostile: td.disposition === L.HOSTILE_DISPOSITION,
        isPrototype: td.disposition === copyLook,
        copyIsCreature: td.actorId === creatureId,
        copyLook,
        ownersGranted: Object.keys(want).length > 0 && Object.keys(want).every((k) => (td.delta?.ownership?.[k] ?? 0) >= want[k]),
        ownersNone: own.every(([, level]) => level === 0),
        lost: record.lost ?? null,
      };
    });
  },
  /** A caster's reading of its cast's creatures, as `castSummons` answers: counts and the uuids of the tokens. */
  standing: async ({ casterId, castId }) => {
    const S = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    const r = S.castSummons(game.actors.get(casterId), castId, { scenes: game.scenes });
    return { tokens: r.tokens.map((t) => t.uuid), held: r.held.map((h) => h.actorId) };
  },
  /** The dialog's footer as a seat reads it: its buttons in order, Cast now's attributes, the verdict lines. */
  footer: async ({ casterName }) => {
    const root = document.querySelector(".application.acks-extras-cast");
    if (!root) return { open: false };
    const buttons = [...root.querySelectorAll(".acks-extras-cast-foot button, button[data-action='cancel'], button[data-action='castNow'], button[data-action='cast']")];
    const seen = [...new Set(buttons)].map((b) => ({ action: b.dataset.action, disabled: b.disabled }));
    const now = root.querySelector('button[data-action="castNow"]');
    const warns = [...root.querySelectorAll(".acks-extras-cast-verdicts li[data-severity='warn']")].map((li) => li.textContent);
    return {
      open: true,
      order: seen.map((b) => b.action),
      declareEnabled: seen.find((b) => b.action === "cast")?.disabled === false,
      castNow: now ? { tip: now.dataset.tooltip ?? null, aria: now.getAttribute("aria-label") ?? "", hasTitle: now.hasAttribute("title") } : null,
      warnCount: warns.length,
      warnNamesCaster: warns.some((t) => t.includes(casterName)),
    };
  },
  /** Open the dialog as `item.use` does, press Cast now, and answer what the press left. */
  castNow: async ({ casterId, spellId }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    const spent0 = actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0;
    item.use({ skipDialog: true });
    const found = await H.poll(() => document.querySelector(".application.acks-extras-cast"), { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    const press = found.querySelector('button[data-action="castNow"]');
    if (!press) return { dialog: true, pressed: false };
    press.click();
    const msg = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 120, every: 250 });
    await H.sleep(800);
    const cards = [...game.messages].filter((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid).length;
    const combat = game.combats.find((c) => c.combatants.some((x) => x.actorId === casterId));
    const combatant = combat?.combatants.find((x) => x.actorId === casterId);
    return {
      dialog: true,
      pressed: true,
      closed: !document.querySelector(".application.acks-extras-cast"),
      cards,
      messageId: msg?.id ?? null,
      castId: msg?.flags?.["acks-extras"]?.castCard?.castId ?? null,
      spentBy: (actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0) - spent0,
      pending: [...actor.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.pending).length,
      casting: actor.statuses.has("casting"),
      prepare: !!combatant?.getFlag("acks", "prepareSpell"),
    };
  },
  /** The caster's pending record count and `casting` status, the start shape a declare step needs. */
  quiet: async ({ casterId }) => {
    const actor = game.actors.get(casterId);
    return { pending: [...actor.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.pending).length, casting: actor.statuses.has("casting") };
  },
  /** Put a cast's entries back to what the cast posted them as and the target's hit points back, so Apply is pressable. */
  reshape: async ({ messageId, foeId, hp }) => {
    const H = globalThis.__mck;
    const pend = H.pend?.[messageId];
    if (!pend) return { ok: false };
    const m = game.messages.get(messageId);
    await game.actors.get(foeId).update({ "system.hp.value": hp });
    await m.update({ "flags.acks-extras.castCard.-=entries": null });
    await m.update({ "flags.acks-extras.castCard.entries": pend });
    await H.sleep(600);
    return { ok: true, states: Object.values(game.messages.get(messageId).flags["acks-extras"].castCard.entries).map((e) => e.state) };
  },
  states: async ({ messageId }) => Object.values(game.messages.get(messageId)?.flags?.["acks-extras"]?.castCard?.entries ?? {}).map((e) => e.state),
  /** Click the first control of an action in the seat's own copy of the card. */
  press: async ({ messageId, action }) => {
    const H = globalThis.__mck;
    const button = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"] [data-action="${action}"]`), { tries: 40, every: 200 });
    if (!button) return { pressed: false };
    button.click();
    return { pressed: true };
  },
  /** The party stage's formation: the party actor's record, the caster a member riding its token. */
  partyForm: async ({ sceneId, partyId, casterId, casterTokenId }) => {
    const H = globalThis.__mck;
    const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    let found = await H.poll(() => Object.values(model.getFormations()).find((f) => f.actorId === partyId), { tries: 40, every: 200 });
    if (!found) found = await model.adoptPartyActor(game.actors.get(partyId));
    const fid = found.id;
    const get = () => model.getFormation(fid);
    const scene = game.scenes.get(sceneId);
    await model.addMember(get(), game.actors.get(casterId), scene.tokens.get(casterTokenId), { scene });
    if (!model.getPartyToken(get())) await model.ensurePartyToken(get(), scene, 300, 300);
    if ((get().travel?.mode ?? "delve") !== "delve") await globalThis.acksExtras.formation.travel.setJourneyMode(fid, "delve");
    await H.sleep(500);
    const token = model.getPartyToken(get());
    return { fid, partyTokenUuid: token?.uuid ?? null, partyTokenId: token?.id ?? null, member: get().members.some((m) => m?.actorId === casterId) };
  },
  /** Join a cast's creatures into the party as members; answers their ids. */
  join: async ({ casterId, spellId, sourceUuid, castId, count }) => {
    const S = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    const r = await S.joinSummons(game.actors.get(casterId), { sourceUuid, count, spellId, castId });
    return { ok: !!r?.ok, reason: r?.reason ?? null, joined: r?.joined ?? [] };
  },
  /** Deploy one member the party's own way. */
  detach: async ({ fid, actorId }) => {
    const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    const dep = await import("/modules/acks-extras/scripts/formation/deployment.mjs");
    await dep.toggleDetachMember(model.getFormation(fid), actorId);
    await new Promise((r) => setTimeout(r, 800));
    const m = model.getFormation(fid).members.find((x) => x?.actorId === actorId);
    return { deployed: !!m?.deployedTokenId };
  },
  /** Take a token off its scene by its id (the party token, so a stashed creature cannot be stood on a scene). */
  removeToken: async ({ sceneId, tokenId }) => {
    await game.scenes.get(sceneId).tokens.get(tokenId)?.delete();
    await new Promise((r) => setTimeout(r, 600));
    return !game.scenes.get(sceneId).tokens.get(tokenId);
  },
  /** Release members the run made, through the roster service, whatever shape they stand in. */
  release: async ({ partyId, actorIds }) => {
    const svc = (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("party-roster");
    return (await svc?.release?.(partyId, actorIds)) ?? null;
  },
};

/* ------------------------------------------------------------------ */
/*  Shared steps                                                        */
/* ------------------------------------------------------------------ */
const card = (seat, messageId, wait) => run(seat, C.card, { messageId, wait });
const track = async (uuid, kind) => { if (uuid) await ledger.track(uuid, kind); };

/** The creature-token start shape, checked: placed, friendly like the prototype, the Player an owner. */
async function placeCast(label, { spellId, castId, positions }) {
  const placed = await run(gm, C.place, { casterId: W.caster, spellId, sourceUuid: W.creatureUuid, castId, positions });
  for (const uuid of placed.tokenUuids) await track(uuid, "Token");
  check(`${label}: the cast's creatures are placed through the module's path`, placed.ok && placed.tokenUuids.length === positions.length, { ok: placed.ok, reason: placed.reason, n: placed.tokenUuids.length });
  const look = await run(gm, C.shapeCopy, { sourceUuid: W.creatureUuid });
  check(`${label}: the module's world copy of the creature has the friendly prototype look the restore must give back`, look.n === 1 && look.look === 1, look);
  return placed.tokenUuids;
}
const readTokens = (uuids) => run(gm, C.tokens, { uuids, casterId: W.caster, creatureId: W.creature });

/* ------------------------------------------------------------------ */
/*  Setup                                                               */
/* ------------------------------------------------------------------ */
async function stageSetup() {
  const strays = await run(gm, C.copies, {});
  for (const u of strays) await gm.track(u, "Actor");
  if (strays.length) note("an earlier run's world copies of the creature, swept by uuid", await gm.sweepTracked({ only: strays }));
  W.player = await run(player, C.who);
  if (!W.player.id) throw new Error("the Player seat reads no user id");
  const cls = await gm.fixture("magic/close-class", "Item", { name: "QA Close Class", type: "acks-extras.class", system: { key: "qacloseclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 9 }] }] } });
  const caster = await gm.fixture("magic/close-caster", "Actor", { name: "QA Close Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.player.id]: 3 } });
  const foe = await gm.fixture("magic/close-foe", "Actor", { name: "QA Close Foe", type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
  const creature = await gm.fixture("magic/close-creature", "Actor", { name: "QA Close Creature", type: "monster", ownership: { default: 0 } });
  const scene = await gm.fixture("magic/close-scene", "Scene", { name: "QA Close Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#55606b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  const dmg = await gm.fixture("magic/close-dmg", "Item", { name: "QA Close Bolt", type: "spell", system: { lvl: 1 } }, { parent: caster.uuid });
  const thr = await gm.fixture("magic/close-throw", "Item", { name: "QA Close Thrown", type: "spell", system: { lvl: 1 } }, { parent: caster.uuid });
  const sum = await gm.fixture("magic/close-sum", "Item", { name: "QA Close Summons", type: "spell", system: { lvl: 1 } }, { parent: caster.uuid });
  Object.assign(W, { caster: idOf(caster), casterUuid: caster.uuid, foe: idOf(foe), creature: idOf(creature), creatureUuid: creature.uuid, scene: idOf(scene), dmg: idOf(dmg), thr: idOf(thr), sum: idOf(sum), cls: cls.uuid });
  await run(gm, P.shapeCaster, { casterId: W.caster, classUuid: cls.uuid, level: LEVEL, alignment: "Lawful" });
  await run(gm, P.shapeMonster, { actorId: W.foe, hp: 40, hd: 2, kinds: [], saveTarget: SAVE_TARGET });
  const look = await run(gm, C.shapeCreature, { actorId: W.creature });
  W.look = look.look;
  await run(gm, P.writeSpell, { casterId: W.caster, itemId: W.dmg, flag: damageFlag() });
  await run(gm, P.writeSpell, { casterId: W.caster, itemId: W.thr, flag: damageFlag("missile") });
  await run(gm, P.writeSpell, { casterId: W.caster, itemId: W.sum, flag: summonFlag(W.creatureUuid, "hostile") });
  await run(gm, C.install);
  await run(player, C.install);
  const seat = await ev(player, `(() => ({ owns: !!game.actors.get(${JSON.stringify(W.caster)})?.isOwner, isGM: game.user.isGM }))()`);
  check("setup: the Player seat owns the caster by Foundry's own isOwner, and is no Judge", seat.owns && !seat.isGM, { owns: seat.owns });
  check("setup: the creature's prototype token is friendly, a disposition the hostile end must take away", W.look === 1, { look: W.look });
  const viewed = [await run(gm, P.view, { sceneId: W.scene }), await run(player, P.view, { sceneId: W.scene })];
  check("setup: both seats view the field", viewed.every(Boolean), viewed);
  const made = await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: W.caster, name: "Close Caster", x: 100, y: 200, disposition: 1 }, { actorId: W.foe, name: "Close Foe", x: 400, y: 200 }] });
  for (const t of made) await track(t.uuid, "Token");
  W.casterTok = made.find((t) => t.actorId === W.caster);
  W.foeTok = made.find((t) => t.actorId === W.foe);
  check("setup: the caster's and the foe's tokens stand on the field", !!W.casterTok && !!W.foeTok, { n: made.length });
}

/* ------------------------------------------------------------------ */
/*  T-0816                                                              */
/* ------------------------------------------------------------------ */
async function stageApply() {
  await run(gm, P.setSpent, { casterId: W.caster });
  await run(gm, P.setHp, { actorId: W.foe, value: 40 });
  const aimed = await run(gm, P.target, { sceneId: W.scene, tokenIds: [W.foeTok.id] });
  check("T-0816: the Judge's seat targets the foe", Array.isArray(aimed) && aimed.length === 1, aimed);
  const c = await run(gm, P.cast, { casterId: W.caster, spellId: W.dmg });
  if (c.messageId) await track(`ChatMessage.${c.messageId}`, "ChatMessage");
  const [hpCast] = await run(gm, P.hp, { actorIds: [W.foe] });
  check("T-0816: the Judge's cast posts a card and the cast's own apply lands on the foe", !!c.card && hpCast < 40, { card: !!c.card, dropped: hpCast < 40 });
  const re = await run(gm, C.reshape, { messageId: c.messageId, foeId: W.foe, hp: 40 });
  check("T-0816: the card's entry is put back to the pending shape the cast posted, the foe's hit points back", re.ok && re.states.length >= 1 && re.states.every((s) => s === "pending"), re.states);
  const g1 = await card(gm, c.messageId);
  const p1 = await until(player, C.card, { messageId: c.messageId }, (v) => v.drawn && v.actions.includes("magicCastApply"), { tries: 16 });
  note("player card actions before Apply", p1.actions);
  check("T-0816: the Player seat is neither the card's author nor able to edit it", p1.drawn && !p1.isAuthor && !p1.canEdit, { author: p1.isAuthor, edit: p1.canEdit });
  check("T-0816: the Judge's seat is drawn the entry's Apply", g1.actions.includes("magicCastApply"), g1.actions);
  check("T-0816: the Player who owns the caster is drawn the entry's Apply, and no Throw", p1.actions.includes("magicCastApply") && !p1.actions.includes("magicCastThrow"), p1.actions);
  const press = await run(player, C.press, { messageId: c.messageId, action: "magicCastApply" });
  const done = await until(gm, C.states, { messageId: c.messageId }, (s) => s.length > 0 && !s.some((x) => x === "pending" || x === "applying"), { tries: 30 });
  const [hpApplied] = await run(gm, P.hp, { actorIds: [W.foe] });
  check("T-0816: the Player's Apply press lands: the entry is applied and the foe loses the figure the card rolled", press.pressed && done.length > 0 && done.every((s) => s === "applied") && hpApplied === hpCast, { pressed: press.pressed, states: done, sameHp: hpApplied === hpCast });
  const g2 = await card(gm, c.messageId);
  const p2 = await until(player, C.card, { messageId: c.messageId }, (v) => v.drawn && !v.actions.includes("magicCastApply"), { tries: 16 });
  note("actions after Apply: gm / player", [g2.actions, p2.actions]);
  // Main's 30212b6e (T-0888) moved Throw, Undo and Revert to the caster's owner as well, so what the Player's seat is drawn there is recorded and not asserted.
  check("T-0816: the Judge's seat is drawn Undo on the applied entry", g2.actions.includes("magicCastUndo"), { gm: g2.actions });
  note("player's card actions after the apply (informational)", p2.actions);
  // A thrown row with no target: the card carries the row's Throw press for its writer.
  await run(gm, P.setSpent, { casterId: W.caster });
  const none = await run(gm, P.target, { sceneId: W.scene, tokenIds: [] });
  const t = await run(gm, P.cast, { casterId: W.caster, spellId: W.thr, wait: 6 });
  if (t.messageId) await track(`ChatMessage.${t.messageId}`, "ChatMessage");
  const tg = await card(gm, t.messageId);
  const tp = await until(player, C.card, { messageId: t.messageId }, (v) => v.drawn, { tries: 10 });
  check("T-0816: a thrown row's card gives the Judge's seat a Throw press", Array.isArray(none) && none.length === 0 && tg.actions.includes("magicCastThrow"), { gm: tg.actions });
  note("player's thrown-card actions (informational)", tp.actions);
  await run(gm, P.setHp, { actorId: W.foe, value: 40 });
}

/* ------------------------------------------------------------------ */
/*  T-0798                                                              */
/* ------------------------------------------------------------------ */
async function stageCastNow() {
  const casterName = await ev(gm, `game.actors.get(${JSON.stringify(W.caster)}).name`);
  const combat = await run(gm, P.combatNew, { sceneId: W.scene, tokenIds: [W.casterTok.id, W.foeTok.id] });
  await track(combat.uuid, "Combat");
  W.combatId = combat.id;
  try {
    const cc = combat.combatants.find((c) => c.tokenId === W.casterTok.id);
    const fc = combat.combatants.find((c) => c.tokenId === W.foeTok.id);
    await run(gm, P.combatSet, { combatId: combat.id, initiatives: { [cc.id]: 5, [fc.id]: 12 } });
    const at = await run(gm, P.combatMove, { combatId: combat.id, update: { round: 1, turn: 0 } });
    const who = await ev(gm, `(() => { const c = game.combats.get(${JSON.stringify(combat.id)}); return { round: c.round, foeTurn: c.combatant?.actorId === ${JSON.stringify(W.foe)}, started: c.started }; })()`);
    for (const id of at.cards) await track(id, "ChatMessage");
    const quiet = await run(gm, C.quiet, { casterId: W.caster });
    check("T-0798: start shape: a begun fight holds the caster, the tracker is on the foe, and no declaration or casting status stands", who.round === 1 && who.foeTurn && quiet.pending === 0 && !quiet.casting, { ...who, ...quiet });
    await run(gm, P.setSpent, { casterId: W.caster });
    // The Judge's window.
    const open = await run(gm, P.cast, { casterId: W.caster, spellId: W.dmg, hold: true });
    const gf = await run(gm, C.footer, { casterName });
    await run(gm, P.closeDialog);
    check("T-0798: the Judge's window warns which fight holds the caster", open.dialog && gf.open && gf.warnCount >= 1 && gf.warnNamesCaster, { warns: gf.warnCount, namesCaster: gf.warnNamesCaster });
    check("T-0798: the footer reads Cancel, Cast now, Declare in that order, with Declare enabled", gf.order?.join(",") === "cancel,castNow,cast" && gf.declareEnabled, gf.order);
    check("T-0798: Cast now carries a tooltip key and an aria-label, never a title", !!gf.castNow?.tip && gf.castNow.aria.length > 0 && !gf.castNow.hasTitle, { tip: !!gf.castNow?.tip, aria: gf.castNow?.aria?.length > 0, title: gf.castNow?.hasTitle });
    const spentAfterCancel = (await run(gm, C.quiet, { casterId: W.caster })).pending;
    check("T-0798: cancelling the Judge's window leaves no declaration", spentAfterCancel === 0, { pending: spentAfterCancel });
    // The Player's window.
    const popen = await run(player, P.cast, { casterId: W.caster, spellId: W.dmg, hold: true });
    const pf = await run(player, C.footer, { casterName });
    await run(player, P.closeDialog);
    check("T-0798: a Player is held as before: Cancel and Declare only, no Cast now and no held-by-fight warning", popen.dialog && pf.open && pf.order?.join(",") === "cancel,cast" && !pf.castNow && pf.warnCount === 0, { order: pf.order, warns: pf.warnCount });
    // Cast now.
    const r = await run(gm, C.castNow, { casterId: W.caster, spellId: W.dmg });
    if (r.messageId) await track(`ChatMessage.${r.messageId}`, "ChatMessage");
    check("T-0798: pressing Cast now closes the window, posts one cast card and spends the slot once", r.pressed && r.closed && r.cards === 1 && r.spentBy === 1, { closed: r.closed, cards: r.cards, spentBy: r.spentBy });
    check("T-0798: the cast left no declaration, no casting status and no prepare flag on the combatant", r.pending === 0 && !r.casting && !r.prepare, { pending: r.pending, casting: r.casting, prepare: r.prepare });
  } finally {
    try { await run(gm, P.combatDrop, { combatId: W.combatId }); } catch (err) { console.error("combat drop:", err?.message ?? err); }
    await run(gm, P.setHp, { actorId: W.foe, value: 40 });
    await run(gm, P.setSpent, { casterId: W.caster });
  }
}

/* ------------------------------------------------------------------ */
/*  summon-control: the two cards, creatures as tokens                  */
/* ------------------------------------------------------------------ */
/** Checks one hostile token cast's card on both seats, then walks the picks. `kind` is "held" or "timed". */
async function stageControlCards() {
  const tokenPositions = (y) => [{ x: 600, y }, { x: 700, y }];
  /* ---- the held-end card ---- */
  const castId = `h${Math.random().toString(36).slice(2, 10)}`;
  const uuids = await placeCast("held-end", { spellId: W.sum, castId, positions: tokenPositions(500) });
  const start = await readTokens(uuids);
  check("held-end: start shape: the creatures are owned by the caster's owner and carry no lost stamp", start.rows.length === 2 && start.rows.every((t) => !t.gone && t.ownersGranted && t.lost === null), start.rows.map((t) => ({ disp: t.disposition, copyLook: t.copyLook, copyIsCreature: t.copyIsCreature, owners: t.ownersGranted, lost: t.lost })));
  const end = await run(gm, C.endHeld, { casterId: W.caster, spellId: W.sum, castId });
  if (end.messageId) await track(`ChatMessage.${end.messageId}`, "ChatMessage");
  check("held-end: the end posts the held-end card, listing both creatures, with the spell row's outcome hostile", end.recorded && !!end.messageId && end.listed === 2 && end.outcome === "hostile", { ended: end.ended, listed: end.listed, outcome: end.outcome });
  const hostile = await readTokens(uuids);
  check("held-end: both creatures are hostile, own no owner and carry the lost stamp", hostile.rows.every((t) => t.hostile && t.ownersNone && t.lost === "hostile"), hostile.rows.map((t) => ({ hostile: t.hostile, none: t.ownersNone, lost: t.lost })));
  const mid = end.messageId;
  const g = await card(gm, mid);
  check("held-end: the Judge's seat draws the Outcome select, set to hostile, with its options in order, its hint, one tooltip key and an aria-label, and no outcome line beside it", g.select && g.value === "hostile" && g.options.join(",") === PICKS.join(",") && g.hint && !!g.tip && g.aria && !g.hasTitle && !g.line, { value: g.value, options: g.options, hint: g.hint, line: g.line });
  const p = await until(player, C.card, { messageId: mid }, (v) => v.drawn, { tries: 12 });
  check("held-end: the Player who owns the caster but none of the creatures reads the outcome line and is drawn no select (the card is drawn)", p.drawn && p.line && !p.select, { drawn: p.drawn, line: p.line, select: p.select });
  const refused = await run(player, C.relayPick, { messageId: mid, outcome: "control" });
  const still = await readTokens(uuids);
  check("held-end: the Player's relay op for a card whose creatures it owns none of is refused by the GM client (notOwner) and changes nothing", refused.answer?.ok === false && refused.answer.reason === "notOwner" && refused.warns >= 1 && still.rows.every((t) => t.hostile && t.lost === "hostile"), { answer: refused.answer, warns: refused.warns });
  // Under control by the select's own change event.
  const pick = await run(gm, C.pick, { messageId: mid, value: "control" });
  check("held-end: picking Under control lands on the card, by the GM, and the select keeps keyboard focus", pick.found && pick.landed && pick.outcome === "control" && pick.byMe && pick.selectNow && pick.selectValue === "control" && pick.focusBack, { landed: pick.landed, byMe: pick.byMe, value: pick.selectValue, focus: pick.focusBack, page: pick.visible, renders: pick.renders, seen: pick.activeSeen, windowFocus: pick.hasFocus });
  const back = await readTokens(uuids);
  check("held-end: Under control on tokens gives back the owners summonOwnership grants, the prototype's disposition, and clears the lost stamp", back.wantCount > 0 && back.rows.every((t) => !t.gone && t.isPrototype && !t.hostile && t.ownersGranted && t.lost === null), back.rows.map((t) => ({ proto: t.isPrototype, disp: t.disposition, copyLook: t.copyLook, copyIsCreature: t.copyIsCreature, owners: t.ownersGranted, lost: t.lost })));
  // The Player now owns every creature: drawn the select, and its pick travels the relay.
  const pg = await until(player, C.card, { messageId: mid }, (v) => v.select, { tries: 16, every: 700 });
  check("held-end: the Player who now owns every creature is drawn the select", pg.drawn && pg.select && pg.value === "control" && !pg.line, { select: pg.select, value: pg.value });
  if (pg.select) {
    const pp = await run(player, C.pick, { messageId: mid, value: "stays" });
    const onGm = await until(gm, flagNowFn, { messageId: mid }, (f) => f?.outcome === "stays", { tries: 20 });
    const names = await ev(gm, `game.users.get(${JSON.stringify(W.player.id)})?.name`);
    const stay = await readTokens(uuids);
    check("held-end: the Player's pick reaches the GM client through the relay: the GM's copy of the card holds the outcome and the Player's name, and the creatures are stamped stays", pp.found && onGm?.outcome === "stays" && onGm.setBy === names && stay.rows.every((t) => t.lost === "stays"), { found: pp.found, outcome: onGm?.outcome, setByPlayer: onGm?.setBy === names, lost: stay.rows.map((t) => t.lost) });
  } else console.log("FAIL  held-end: no select to pick from on the Player seat, the relay pick was not driven");
  // They go last.
  const go = await run(gm, C.pick, { messageId: mid, value: "gone" });
  const gone = await readTokens(uuids);
  const gg = await card(gm, mid);
  const pgg = await card(player, mid);
  check("held-end: They go deletes both tokens, the card keeps its outcome line and draws no select on either seat", go.landed && gone.rows.every((t) => t.gone) && gg.line && !gg.select && pgg.line && !pgg.select, { landed: go.landed, gone: gone.rows.map((t) => t.gone), gm: [gg.line, gg.select], player: [pgg.line, pgg.select] });

  /* ---- the time-end card ---- */
  section("summon-control: the time-end card");
  const tcast = `t${Math.random().toString(36).slice(2, 10)}`;
  const tu = await placeCast("time-end", { spellId: W.sum, castId: tcast, positions: tokenPositions(600) });
  const te = await run(gm, C.timeEnd, { casterId: W.caster, spellId: W.sum, castId: tcast, seconds: 120 });
  note("world clock advanced by (s)", te.advanced);
  if (te.recUuid) await track(te.recUuid, "ActiveEffect");
  if (te.messageId) await track(`ChatMessage.${te.messageId}`, "ChatMessage");
  check("time-end: the clock passing the record posts the time-end card for both creatures, its flag carrying the spell and caster names and the outcome hostile", !!te.messageId && te.named && te.n === 2 && te.outcome === "hostile", { n: te.n, named: te.named, outcome: te.outcome });
  const tmid = te.messageId;
  const tg = await card(gm, tmid);
  check("time-end: the Judge's seat draws the select set to hostile, no outcome line beside it, and Dismiss", tg.select && tg.value === "hostile" && tg.options.join(",") === PICKS.join(",") && tg.hint && !tg.line && tg.dismiss, { value: tg.value, line: tg.line, dismiss: tg.dismiss });
  const tp = await until(player, C.card, { messageId: tmid }, (v) => v.drawn, { tries: 12 });
  check("time-end: the Player who owns none of the creatures reads the outcome line and is drawn no select", tp.drawn && tp.line && !tp.select, { drawn: tp.drawn, line: tp.line, select: tp.select });
  const tpick = await run(gm, C.pick, { messageId: tmid, value: "control" });
  const tback = await readTokens(tu);
  check("time-end: Under control gives back the owners, the prototype's disposition and clears the lost stamp", tpick.landed && tpick.byMe && tback.rows.every((t) => !t.gone && t.isPrototype && t.ownersGranted && t.lost === null), tback.rows.map((t) => ({ proto: t.isPrototype, disp: t.disposition, copyLook: t.copyLook, copyIsCreature: t.copyIsCreature, owners: t.ownersGranted, lost: t.lost })));
  const tpg = await until(player, C.card, { messageId: tmid }, (v) => v.select, { tries: 16, every: 700 });
  check("time-end: the Player who now owns every creature is drawn the select", tpg.select && tpg.value === "control", { select: tpg.select, value: tpg.value });
  if (tpg.select) {
    const pp = await run(player, C.pick, { messageId: tmid, value: "stays" });
    const onGm = await until(gm, flagNowFn, { messageId: tmid }, (f) => f?.outcome === "stays", { tries: 20 });
    check("time-end: the Player's pick reaches the GM client: the card holds stays and the creatures are stamped stays", pp.found && onGm?.outcome === "stays" && (await readTokens(tu)).rows.every((t) => t.lost === "stays"), { found: pp.found, outcome: onGm?.outcome });
  }
  const tgo = await run(gm, C.pick, { messageId: tmid, value: "gone" });
  const tgg = await card(gm, tmid);
  const tpgg = await card(player, tmid);
  const tgone = await readTokens(tu);
  check("time-end: They go deletes the creatures, the card keeps its outcome line, draws no select on either seat and no Dismiss", tgo.landed && tgone.rows.every((t) => t.gone) && tgg.line && !tgg.select && !tgg.dismiss && tpgg.line && !tpgg.select, { landed: tgo.landed, gm: [tgg.line, tgg.select, tgg.dismiss], player: [tpgg.line, tpgg.select] });
}
const flagNowFn = async ({ messageId }) => globalThis.__mck.flagOf(messageId) ? { outcome: globalThis.__mck.flagOf(messageId).outcome ?? null, setBy: globalThis.__mck.flagOf(messageId).setBy ?? null } : null;

/* ------------------------------------------------------------------ */
/*  summon-control: a deployed party member and a stash                 */
/* ------------------------------------------------------------------ */
async function stageParty() {
  const party = await gm.create("Actor", { name: "QA Close Party", type: "acks-extras.party" });
  const pcaster = await gm.create("Actor", { name: "QA Close Party Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.player.id]: 3 } });
  const stays = await gm.create("Item", { name: "QA Close Stays", type: "spell", system: { lvl: 1 } }, { parent: pcaster.uuid });
  const hostile = await gm.create("Item", { name: "QA Close Hostile", type: "spell", system: { lvl: 1 } }, { parent: pcaster.uuid });
  const pid = idOf(pcaster);
  const sid = idOf(stays);
  const hid = idOf(hostile);
  await run(gm, P.shapeCaster, { casterId: pid, classUuid: W.cls, level: LEVEL, alignment: "Lawful" });
  await run(gm, P.writeSpell, { casterId: pid, itemId: sid, flag: summonFlag(W.creatureUuid, "stays") });
  await run(gm, P.writeSpell, { casterId: pid, itemId: hid, flag: summonFlag(W.creatureUuid, "hostile") });
  const [tok] = await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: pid, name: "Party Caster", x: 300, y: 700, disposition: 1 }] });
  await track(tok.uuid, "Token");
  const form = await run(gm, C.partyForm, { sceneId: W.scene, partyId: idOf(party), casterId: pid, casterTokenId: tok.id });
  if (form.partyTokenUuid) await track(form.partyTokenUuid, "Token");
  check("party: start shape: the caster is a member riding the party token, which stands on the field", form.member && !!form.partyTokenUuid, { member: form.member, token: !!form.partyTokenUuid });
  const ids = { all: [] };
  try {
    const a = `pa${Math.random().toString(36).slice(2, 9)}`;
    const b = `pb${Math.random().toString(36).slice(2, 9)}`;
    const ja = await run(gm, C.join, { casterId: pid, spellId: sid, sourceUuid: W.creatureUuid, castId: a, count: 2 });
    const jb = await run(gm, C.join, { casterId: pid, spellId: hid, sourceUuid: W.creatureUuid, castId: b, count: 1 });
    ids.all = [...ja.joined, ...jb.joined];
    check("party: two casts join as party members, two on the stays spell and one on the hostile spell", ja.ok && ja.joined.length === 2 && jb.ok && jb.joined.length === 1, { a: ja.joined.length, b: jb.joined.length, reasonA: ja.reason, reasonB: jb.reason });
    if (!(ja.ok && jb.ok)) return;
    const lookP = await run(gm, C.shapeCopy, { sourceUuid: W.creatureUuid });
    check("party: the module's world copy of the creature has the friendly prototype look", lookP.n === 1 && lookP.look === 1, lookP);
    const [m1, m2] = ja.joined;
    const [m3] = jb.joined;
    const det = await run(gm, C.detach, { fid: form.fid, actorId: m1 });
    const standing = await run(gm, C.standing, { casterId: pid, castId: a });
    for (const u of standing.tokens) await track(u, "Token");
    check("party: one member of the first cast stands deployed as a token and the other stashed in the party token", det.deployed && standing.tokens.length === 1 && standing.held.length === 1, { deployed: det.deployed, tokens: standing.tokens.length, held: standing.held.length });
    // Part A: a stays end, then Under control, for a deployed member and a stash.
    const endA = await run(gm, C.endHeld, { casterId: pid, spellId: sid, castId: a });
    if (endA.messageId) await track(`ChatMessage.${endA.messageId}`, "ChatMessage");
    const stA = await run(gm, C.stash, { fid: form.fid, actorIds: [m2], casterId: pid, creatureId: W.creature });
    const tkA = await run(gm, C.tokens, { uuids: standing.tokens, casterId: pid, creatureId: W.creature });
    check("party: the stays end posts the card listing both, and stamps the deployed member and the stash stays", endA.outcome === "stays" && endA.listed === 2 && tkA.rows[0]?.lost === "stays" && stA[0]?.lost === "stays", { outcome: endA.outcome, listed: endA.listed, deployed: tkA.rows[0]?.lost, stash: stA[0]?.lost });
    const gA = await card(gm, endA.messageId);
    check("party: the Judge's seat draws the select on the card of a deployed member and a stash", gA.select && gA.value === "stays", { select: gA.select, value: gA.value });
    const pA = await card(player, endA.messageId);
    check("party: the Player is drawn no select on a card that lists a stash (a stash is asked through its world copy, which only a Judge owns)", pA.drawn && !pA.select && pA.line, { drawn: pA.drawn, select: pA.select, line: pA.line });
    const pickA = await run(gm, C.pick, { messageId: endA.messageId, value: "control" });
    const stA2 = await run(gm, C.stash, { fid: form.fid, actorIds: [m2], casterId: pid, creatureId: W.creature });
    const tkA2 = await run(gm, C.tokens, { uuids: standing.tokens, casterId: pid, creatureId: W.creature });
    check("party: Under control clears the lost stamp of the deployed member and of the stash", pickA.landed && tkA2.rows[0] && !tkA2.rows[0].gone && tkA2.rows[0].lost === null && stA2[0]?.stashed && stA2[0].lost === null, { landed: pickA.landed, deployed: tkA2.rows[0]?.lost, stash: stA2[0]?.lost });
    // Part B: a hostile end on a stash, the party token off every scene so it stays on the roster.
    const off = await run(gm, C.removeToken, { sceneId: W.scene, tokenId: form.partyTokenId });
    check("party: the party's token is off the field, so a stashed creature cannot be stood on a scene", off, off);
    const endB = await run(gm, C.endHeld, { casterId: pid, spellId: hid, castId: b });
    if (endB.messageId) await track(`ChatMessage.${endB.messageId}`, "ChatMessage");
    const stB = await run(gm, C.stash, { fid: form.fid, actorIds: [m3], casterId: pid, creatureId: W.creature });
    check("party: the hostile end leaves the stash on the roster, stamped hostile, owners removed, disposition hostile", endB.outcome === "hostile" && stB[0]?.stashed && stB[0].hostile && stB[0].ownersNone && stB[0].lost === "hostile", { outcome: endB.outcome, row: stB[0] });
    const pickB = await run(gm, C.pick, { messageId: endB.messageId, value: "control" });
    const stB2 = await run(gm, C.stash, { fid: form.fid, actorIds: [m3], casterId: pid, creatureId: W.creature });
    check("party: Under control on the stash gives back the owners summonOwnership grants and the prototype's disposition, and clears the lost stamp", pickB.landed && stB2[0]?.stashed && stB2[0].ownersGranted && stB2[0].isPrototype && !stB2[0].hostile && stB2[0].lost === null, { landed: pickB.landed, row: stB2[0] });
    console.log("NOT REACHED  deployed member's owners and disposition restore: a deployed temporary ally turned hostile leaves the party as a token, so a deployed member is never hostile and still a member; its restore is the token's (held-end checks above)");
  } finally {
    if (ids.all.length) {
      try { note("members released", await run(gm, C.release, { partyId: idOf(party), actorIds: ids.all })); } catch (err) { console.error("release:", err?.message ?? err); }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Run                                                                 */
/* ------------------------------------------------------------------ */
try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  note("census: active users [name, isGM]", await ev(gm, `game.users.filter((u) => u.active).map((u) => [u.name, u.isGM])`));
  note("census: active GM", await ev(gm, `game.users.activeGM?.name ?? null`));
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  if (!installed.isGM || !installed.activeGMIsSelf || seated.isGM) blocked("a seat did not join as the walk's own role");

  await stage("A. setup", stageSetup);
  if (W.foeTok) {
    await stage("B. T-0816: a Player who owns the caster presses Apply on the Judge's card", stageApply);
    await stage("C. T-0798: a begun fight holds the caster; the Judge's Cast now", stageCastNow);
    await stage("D. summon-control: the held-end card, tokens", stageControlCards);
    await stage("E. summon-control: a deployed member and a stash", stageParty);
  }
  section("console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, P.drain);
    check(`${label}: no console error was recorded since the seat was installed`, d.errors.length === 0, d.errors.slice(0, 3));
  }
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    check("walk ran to the end", false);
  }
} finally {
  for (const seat of [gm, player]) { try { if (seat) await run(seat, C.restore); } catch {} }
  try { if (gm && W.creatureUuid) for (const u of await run(gm, C.copies, { sourceUuid: W.creatureUuid })) await ledger.track(u, "Actor"); } catch (err) { console.error("copies:", err?.message ?? err); }
  await finish({ gm, player, ledger, fixtureRe: "^magic/close-", restore: P.restore });
  console.log("fixtures kept: magic/close-class, -caster, -foe, -creature, -scene, -dmg, -throw, -sum");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
