/**
 * Live walk, scene search: lore checks, slice S7a. Walks
 * docs/scene-search/TESTING.md "S7a — lore checks" on both seats at once. The
 * Judge seat opens the scene search through the party's own Search here
 * (`acksExtras.sceneSearch.searchHere`, the party standing in a Region-linked
 * place) and presses Round on the real scene screen; the Player seat reads the
 * same window and assigns through its picker. Every figure is READ from the
 * world and never written here: the proficiencies come from the imported
 * library (found by the capability token the rail's own picker lists, then
 * added to the holder through the sheet's add-proficiency route where the
 * general list offers it, else through the grant function that route ends in),
 * and what the holder's sheet says each throw is comes from the ability's own
 * roll reads (`ability-rolls.mjs` `rollsOf` and `targetOf`), held against what
 * the picker's options and the Judges' card say. Every name typed into a
 * fixture is invented; no figure, cite or proficiency's page text is written
 * in this file.
 *
 * Scripted, not gestured: a click is `element.click()` in the page; the die is
 * held through `CONFIG.Dice.randomUniform` inside one page function around each
 * Round press (0.025 a 20, 0.975 a 1) and restored in `finally`.
 *
 * Five things stand in the place (the recipe names four): the second Sensing
 * Power thing exists because a hasty check that was answered at the first leaves
 * that thing found, and the vague hint is only given where something is still
 * unfound. The place's list is written whole before every step, which clears
 * every thing's state (found, done, hasty lock).
 *
 * Fixtures, found by marker and kept: `scene-search/lore-scene`,
 * `lore-region`, `lore-place`, `lore-party`, `lore-holder` (the Player seat's;
 * holds the library's Theology, Naturalism, Loremastery and Sensing Power, one
 * each, brought back to the library's own throws at every start) and
 * `lore-outsider` (the Player seat's, holding none of them). The run's own
 * documents are the Judges' cards the GM client posts (claimed by the walk's
 * nonce), swept by tracked id at the end.
 *
 * Not reached: a real pointer drag or tab-key traversal, the chooser between a
 * proficiency's two throws (not built), and Magical Engineering (no fixture
 * holds it).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as KIT, section, check, note, finish, watchdog, openSeats, run, idOf, sleep } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "scene-search/lore-scene",
  region: "scene-search/lore-region",
  place: "scene-search/lore-place",
  party: "scene-search/lore-party",
  holder: "scene-search/lore-holder",
  outsider: "scene-search/lore-outsider",
};
const NAMES = {
  scene: "QA Lore Scene",
  region: "QA Lore Region",
  place: "QA Lore Place",
  party: "QA Lore Party",
  holder: "QA Lore Holder",
  outsider: "QA Lore Outsider",
};
/** The five proficiency words the module already uses (common words, no book name), and the thing ids keyed to them. */
const WORDS = { theology: "Theology", naturalism: "Naturalism", loremastery: "Loremastery", sensing: "Sensing Power" };
const THINGS = ["theology", "naturalism", "loremastery", "sensing", "sensing-2"];
const WORD_OF = { theology: "theology", naturalism: "naturalism", loremastery: "loremastery", sensing: "sensing", "sensing-2": "sensing" };
const KEY = Object.fromEntries(THINGS.map((id) => [id, `thing:${id}`]));
const CLUE = { hasty: "QA lore clue hasty", methodical: "QA lore clue methodical" };
const NONCE = "lore" + Math.random().toString(36).slice(2, 7);
const HIT = 0.025;
const MISS = 0.975;

/** One thing of the place's list, written whole: both layers keyed Proficiency to one capability token, each yielding a clue. */
const thing = (id, token) => ({
  id,
  kind: "fixture",
  ref: null,
  hidden: false,
  hint: null,
  point: null,
  params: {},
  state: {},
  layers: {
    hasty: { check: "skill", capability: token, yields: { clue: CLUE.hasty } },
    methodical: { check: "skill", capability: token, yields: { clue: CLUE.methodical } },
  },
});
const baseThings = (tokens) => THINGS.map((id) => thing(id, tokens[WORD_OF[id]]));

const P = {
  ...KIT,

  /** The modules every page function reaches, the window finder, and (GM seat) a hook that records the chat cards its own client makes. */
  setup: async ({ nonce } = {}) => {
    const X = (globalThis.__ss = globalThis.__ss ?? {});
    const base = "/modules/acks-extras/scripts/";
    let lore = null;
    try { lore = await import(`${base}scene-search/lore-logic.mjs`); } catch { lore = null; }
    X.lore = lore;
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.things = await import(`${base}lib/place-things.mjs`);
    X.link = await import(`${base}location/scene-link.mjs`);
    X.tokenCentre = (await import(`${base}lib/token-centre.mjs`)).tokenCentre;
    X.rolls = await import(`${base}abilities/ability-rolls.mjs`);
    X.caps = await import(`${base}lib/capabilities.mjs`);
    X.vocab = await import(`${base}lib/vocab.mjs`);
    X.lib = await import(`${base}lib/library.mjs`);
    X.reg = await import(`${base}classes/registry.mjs`);
    X.grants = await import(`${base}classes/grants.mjs`);
    X.addp = await import(`${base}abilities/add-proficiency.mjs`);
    X.keying = await import(`${base}scene-search/keying.mjs`);
    X.consts = await import(`${base}scene-search/constants.mjs`);
    X.restoreRaw = async (item, source) => {
      const upd = { "flags.acks-extras.extras.rolls": foundry.utils.deepClone(source.flags?.["acks-extras"]?.extras?.rolls ?? []) };
      for (const k of ["roll", "rollType", "rollTarget"]) if (source.system?.[k] !== undefined) upd[`system.${k}`] = source.system[k];
      await item.update(upd);
    };
    X.win = (fid) => foundry.applications.instances.get(`acks-extras-scene-search-${fid}`) ?? null;
    if (game.user.isGM && !X.cards) {
      X.cards = [];
      X.hooks = [
        ["preCreateChatMessage", Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); })],
        ["createChatMessage", Hooks.on("createChatMessage", (m) => {
          if (m.flags?.world?.qaNonce !== nonce) return;
          X.cards.push({ id: m.id, uuid: m.uuid, at: Date.now() });
        })],
      ];
    }
    const api = globalThis.acksExtras?.sceneSearch;
    return {
      api: typeof api?.open === "function" && typeof api?.assign === "function" && typeof api?.options === "function",
      screen: typeof api?.openScreen === "function" && typeof api?.show === "function" && typeof api?.searchHere === "function",
      lore: !!lore && typeof lore.skillFigures === "function",
      automatic: X.consts.AUTOMATIC_SKILLS ?? null,
    };
  },
  unhook: async () => {
    const X = globalThis.__ss;
    for (const [name, id] of X?.hooks ?? []) Hooks.off(name, id);
    if (X) { X.hooks = []; X.cards = null; }
    return true;
  },
  nowMs: async () => Date.now(),
  /** A word of the screen ("screen") or of scene search ("scene"), formatted where it carries data; the roots are joined here so no whole key sits in the walk. */
  say: async ({ ns, key, data } = {}) => {
    const loc = "ACKS-" + "LOCATION";
    const roots = { screen: `${loc}.sceneSearch.screen.`, scene: `${loc}.sceneSearch.` };
    const full = `${roots[ns]}${key}`;
    return data && Object.keys(data).length ? game.i18n.format(full, data) : game.i18n.localize(full);
  },
  reasonText: async ({ reason, name } = {}) => acksExtras.sceneSearch.reasonText(reason, name),
  boot: async () => (globalThis.__tkBoot?.errors ?? []).map((e) => `${e.kind}: ${e.text}`),

  /** The capability token the rail's own picker lists for each word, by its label. */
  tokens: async ({ words } = {}) => {
    const X = globalThis.__ss;
    await X.lib.whenReady();
    const choices = X.keying.proficiencyChoices();
    return Object.fromEntries(Object.entries(words).map(([id, word]) => {
      const c = choices.find((x) => String(x.label).trim().toLowerCase() === word.toLowerCase());
      return [id, c ? c.token : null];
    }));
  },
  /** The holder holds exactly the library's copy of the proficiency; one is added where none is held, by the sheet's own route where the general list offers it. */
  ensureHeld: async ({ actorId, token } = {}) => {
    const X = globalThis.__ss;
    await X.lib.whenReady();
    const actor = game.actors.get(actorId);
    const abil = X.vocab.ITEM_TYPE.ability;
    const heldOf = () => actor.items.filter((i) => i.type === abil && X.caps.itemHasCapability(i, token));
    const before = heldOf().length;
    let route = "already held";
    if (!before) {
      const sources = X.lib.libraryItems().filter((i) => i.type === abil && X.vocab.capabilityForId(X.caps.definitionId(i)) === token && !X.reg.templatePartOf(i));
      if (!sources.length) return { ok: false, why: "no library item stands for the token", sources: 0 };
      const general = X.addp.proficiencyOptions(actor, "general", null);
      const viaSheet = sources.find((s) => general.some((o) => o.ref === X.lib.cookbookId(s)));
      if (viaSheet) {
        const ref = X.lib.cookbookId(viaSheet);
        const made = await X.addp.addProficiency(actor, "general", { ask: async () => ({ ref }) });
        route = made?.via === "library" ? "sheet add-proficiency (general list)" : "sheet add-proficiency (made nothing)";
      } else {
        const ref = X.lib.cookbookId(sources[0]);
        await X.grants.grantAbility(actor, ref, [], { upTo: 1, proficiencyType: "general" });
        route = "grantAbility (not on the general list)";
      }
    }
    const items = heldOf();
    const item = items[0] ?? null;
    if (!item) return { ok: false, why: "nothing held after the add", route };
    const ref = X.lib.cookbookId(item) || item.getFlag("acks-extras", "grantedFrom") || null;
    const source = ref ? X.reg.findByRef(ref) : null;
    const same = () => (source ? JSON.stringify(X.rolls.rollsOf(item)) === JSON.stringify(X.rolls.rollsOf(source)) : null);
    let restored = false;
    if (source && same() === false) { await X.restoreRaw(item, source); restored = true; }
    return { ok: true, route, copies: items.length, stamped: !!X.lib.cookbookId(item), restored, sameAsLibrary: same(), itemId: item.id };
  },
  /** What the holder's sheet says each of the ability's throws is, at the actor's level, from the ability's own roll reads. */
  figures: async ({ actorId, token } = {}) => {
    const X = globalThis.__ss;
    const actor = game.actors.get(actorId);
    const item = actor.items.find((i) => i.type === X.vocab.ITEM_TYPE.ability && X.caps.itemHasCapability(i, token));
    if (!item) return null;
    const rolls = X.rolls.rollsOf(item).map((r, i) => {
      let target = null;
      try { target = X.rolls.targetOf(r, actor, item); } catch { target = null; }
      return { key: X.rolls.keyOf(r, i), measure: !!X.rolls.measures(r), above: (r.rollType || "above") === "above", target: Number.isFinite(target) ? target : null };
    });
    const throws = rolls.filter((r) => !r.measure);
    const first = throws[0] ?? null;
    const figured = throws.filter((r) => r.above && r.target !== null && r.target > 0);
    return {
      itemId: item.id,
      name: item.name,
      cite: String(X.rolls.citeOf(item) ?? ""),
      level: Number(actor.system.details.level),
      throws: throws.length,
      first: first && first.above && first.target !== null && first.target > 0 ? first.target : null,
      lowest: figured.length ? Math.min(...figured.map((r) => r.target)) : null,
      all: throws.map((r) => r.target),
      shape: X.rolls.rollsOf(item).filter((r) => !X.rolls.measures(r)).map((r) => [r.target?.kind ?? null, r.scale ?? null, r.rollType ?? null]),
    };
  },
  setLevel: async ({ actorId, level } = {}) => {
    const actor = game.actors.get(actorId);
    if (Number(actor.system.details.level) !== level) await actor.update({ "system.details.level": level });
    return Number(actor.system.details.level);
  },
  /** The holder's ability for a token with its throws emptied through the roll writer (the Rolls tab's own), or put back to the library's. */
  throwsTo: async ({ actorId, token, blank, lowerSecond = null } = {}) => {
    const X = globalThis.__ss;
    const actor = game.actors.get(actorId);
    const item = actor.items.find((i) => i.type === X.vocab.ITEM_TYPE.ability && X.caps.itemHasCapability(i, token));
    if (!item) return { ok: false };
    if (lowerSecond !== null) {
      // A second throw, an invented flat figure lower than the first, so 'first' and 'lowest' differ; the walk puts the library's back.
      const rolls = X.rolls.readRolls(item);
      const second = { ...foundry.utils.deepClone(rolls[0]), key: "qa-second", label: "QA second throw", target: { kind: "flat", flat: lowerSecond } };
      await X.rolls.writeRolls(item, [...rolls, second]);
    } else if (blank) {
      const rolls = X.rolls.readRolls(item).map((r) => ({ ...r, target: { kind: "flat", flat: null } }));
      await X.rolls.writeRolls(item, rolls);
    } else {
      const ref = X.lib.cookbookId(item) || item.getFlag("acks-extras", "grantedFrom");
      const source = ref ? X.reg.findByRef(ref) : null;
      if (!source) return { ok: false, why: "no library source" };
      await X.restoreRaw(item, source);
    }
    const source = (() => { const ref = X.lib.cookbookId(item) || item.getFlag("acks-extras", "grantedFrom"); return ref ? X.reg.findByRef(ref) : null; })();
    const mine = X.rolls.rollsOf(item);
    const lib = source ? X.rolls.rollsOf(source) : [];
    const differing = [];
    for (let i = 0; i < Math.max(mine.length, lib.length); i++) {
      for (const k of new Set([...Object.keys(mine[i] ?? {}), ...Object.keys(lib[i] ?? {})])) if (JSON.stringify(mine[i]?.[k]) !== JSON.stringify(lib[i]?.[k])) differing.push(`${i}.${k}`);
    }
    return { ok: true, sameAsLibrary: source ? differing.length === 0 : null, differing, counts: [mine.length, lib.length] };
  },
  /** How many of the library-stamped proficiencies of a token the actor holds. */
  heldCount: async ({ actorId, token } = {}) => {
    const X = globalThis.__ss;
    return game.actors.get(actorId).items.filter((i) => i.type === X.vocab.ITEM_TYPE.ability && X.caps.itemHasCapability(i, token)).length;
  },

  shapeScene: async ({ sceneId } = {}) => {
    const scene = game.scenes.get(sceneId);
    const g = scene.grid;
    if (g.size !== 100 || g.distance !== 5 || g.units !== "ft") await scene.update({ grid: { size: 100, distance: 5, units: "ft" } });
    return { size: scene.grid.size };
  },
  formationOf: async ({ partyId } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const found = await H.poll(() => Object.values(X.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  /** Both characters at level one, owned by the Player seat alone, and the place open to Observer. */
  shapeActors: async ({ holderId, outsiderId, playerId, placeId } = {}) => {
    const user = game.users.get(playerId);
    for (const id of [holderId, outsiderId]) {
      const a = game.actors.get(id);
      await a.update({ "system.details.level": 1, ownership: { default: 0, [playerId]: 3 } });
    }
    const place = game.actors.get(placeId);
    if (place.ownership?.default !== 2) await place.update({ ownership: { default: 2 } });
    return { holderOwned: game.actors.get(holderId).testUserPermission(user, "OWNER"), outsiderOwned: game.actors.get(outsiderId).testUserPermission(user, "OWNER"), level: Number(game.actors.get(holderId).system.details.level) };
  },
  /** The party's start shape: both characters in it, its token on the scene, no plan, no session. Answers `fight: true` and changes nothing when a combat holds the party. */
  startShape: async ({ fid, partyId, sceneId, members } = {}) => {
    const X = globalThis.__ss;
    const H = globalThis.__tk;
    const scene = game.scenes.get(sceneId);
    const party = game.actors.get(partyId);
    if (game.combats.some((c) => c.combatants.some((x) => x.actorId === partyId))) return { fight: true };
    await X.model.patchFormation(fid, (rec) => {
      rec.combat = null;
      rec.clock.paused = false;
      rec.clock.movedThisTurn = false;
      rec.clock.roundsPartial = 0;
      rec.clock.carryFeet = 0;
    });
    const f0 = X.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) await X.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    for (const [n, id] of members.entries()) {
      if (X.model.getFormation(fid).members.some((m) => m?.actorId === id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: 400 + n * 100, y: 400 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await X.model.addMember(X.model.getFormation(fid), game.actors.get(id), made, { scene });
    }
    for (const id of members) {
      const actor = game.actors.get(id);
      await actor.update({ "system.hp.value": actor.system.hp?.max ?? 8 });
    }
    if (party.getFlag("acks-extras", "turnPlan")) await party.unsetFlag("acks-extras", "turnPlan");
    if (party.getFlag("acks-extras", "sceneSearch")) await party.unsetFlag("acks-extras", "sceneSearch");
    await H.sleep(800);
    const f = X.model.getFormation(fid);
    return { fight: false, members: f.members.filter((m) => m?.actorId).map((m) => m.actorId), sceneId: f.sceneId, partyToken: !!X.model.getPartyToken(f), session: party.getFlag("acks-extras", "sceneSearch") ?? null, plan: party.getFlag("acks-extras", "turnPlan") ?? null };
  },
  /** Where the party token's centre is. */
  centre: async ({ fid } = {}) => {
    const X = globalThis.__ss;
    const f = X.model.getFormation(fid);
    const token = X.model.getPartyToken(f);
    const scene = token?.parent ?? null;
    if (!token || !scene) return { token: false };
    const c = X.tokenCentre(token, scene, token._source ?? token);
    return { token: true, sceneId: scene.id, cx: c.x, cy: c.y };
  },
  shapeRegion: async ({ uuid, rect } = {}) => {
    const region = await fromUuid(uuid);
    const s = region.shapes[0];
    const same = region.shapes.length === 1 && s?.type === "rectangle" && s.x === rect.x && s.y === rect.y && s.width === rect.width && s.height === rect.height && !s.hole;
    if (!same) await region.update({ shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }] });
    return { shapes: region.shapes.length, behaviors: region.behaviors.size };
  },
  linkPlace: async ({ regionUuid, placeId } = {}) => {
    const X = globalThis.__ss;
    const region = await fromUuid(regionUuid);
    const place = game.actors.get(placeId);
    const agrees = () => X.link.locationOfRegion(region)?.uuid === place.uuid && X.link.regionOfLocation(place)?.uuid === region.uuid;
    if (!agrees()) await X.link.linkRegion(region, place);
    return { linked: agrees() };
  },
  /** The place's list written whole: every thing's state is cleared. */
  shapePlace: async ({ placeId, things } = {}) => {
    const a = game.actors.get(placeId);
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((t) => t.id) };
  },
  /** The party's session flag and plan, each thing's layer state, and the Judge's log. */
  state: async ({ fid, partyId, placeId } = {}) => {
    const X = globalThis.__ss;
    const party = game.actors.get(partyId);
    return {
      flag: party.getFlag("acks-extras", "sceneSearch") ?? null,
      plan: party.getFlag("acks-extras", "turnPlan") ?? null,
      things: Object.fromEntries(X.things.thingsOf(game.actors.get(placeId)).map((t) => [t.id, t.state?.layers ?? {}])),
      log: acksExtras.sceneSearch.read(fid)?.log ?? null,
    };
  },
  /** What `read` answers on this seat: the log rows' codes and each entry's key. */
  readAs: async ({ fid } = {}) => {
    const r = acksExtras.sceneSearch.read(fid);
    if (!r) return null;
    return { entries: r.entries.map((e) => e.key), shown: r.session.shown === true, log: r.log.map((l) => ({ key: l.key, layer: l.layer, code: l.code ?? null, card: l.card ?? null })) };
  },
  /** Open the scene search through the party's Search here. */
  searchHere: async ({ fid, placeUuid } = {}) => {
    const r = await acksExtras.sceneSearch.searchHere({ partyId: fid });
    const read = acksExtras.sceneSearch.read(fid);
    return { ok: r?.ok === true, reason: r?.reason ?? null, opened: r?.opened ?? null, pot: r?.potUuid ?? null, entries: read?.entries.map((e) => e.key) ?? null, placeOk: read?.session?.placeUuid === placeUuid };
  },
  openPlain: async ({ fid, placeUuid, sceneId } = {}) => {
    const r = await acksExtras.sceneSearch.open({ partyId: fid, placeUuid, sceneId, sources: [], metInLair: true });
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  endSession: async ({ fid } = {}) => {
    const r = await acksExtras.sceneSearch.end(fid);
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  unassign: async ({ fid, actorId } = {}) => {
    const r = await acksExtras.sceneSearch.unassign({ partyId: fid, actorId });
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  showSession: async ({ fid } = {}) => {
    const r = await acksExtras.sceneSearch.show(fid);
    return { ok: r.ok === true, reason: r.reason ?? null };
  },
  /** What one member may attempt at one entry, `layerOptions`' own rows, read on this seat. */
  optionAt: async ({ fid, actorId, key } = {}) => {
    const row = acksExtras.sceneSearch.options({ partyId: fid, actorId }).find((r) => r.key === key);
    return (row?.layers ?? []).map((l) => ({ layer: l.layer, mode: l.mode ?? null, target: l.target ?? null, automatic: l.automatic === true, refusal: l.refusal ?? null, cite: l.data?.cite ?? null }));
  },
  /** The Judges' card on the newest log row: its figures, its whisper, and what its HTML names. `needles` are searched for in its HTML. */
  newestCard: async ({ fid, needles = [] } = {}) => {
    const log = acksExtras.sceneSearch.read(fid)?.log ?? [];
    const row = log[log.length - 1];
    const msg = row?.card ? game.messages.get(row.card) : null;
    if (!row) return { row: null };
    if (!msg) return { row: { key: row.key, layer: row.layer, code: row.code }, card: null };
    const f = msg.getFlag("acks-extras", "sceneRoll") ?? null;
    const html = `${msg.flavor ?? ""} ${msg.content ?? ""}`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tips = [...doc.querySelectorAll("[data-tooltip], [data-tooltip-text]")].map((n) => String(n.getAttribute("data-tooltip") ?? n.getAttribute("data-tooltip-text") ?? "").replace(/\s+/g, " ").trim());
    const text = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      row: { key: row.key, layer: row.layer, code: row.code },
      card: { id: msg.id, uuid: msg.uuid, total: f?.total ?? null, target: f?.target ?? null, success: f?.success ?? null, whisper: [...(msg.whisper ?? [])].map((id) => ({ gm: !!game.users.get(id)?.isGM })), has: Object.fromEntries(needles.map((n) => [n, html.includes(n) || text.includes(n) || tips.some((t) => t.includes(n))])), tips, text },
    };
  },
  /** Whether a message is visible on this seat, and whether the chat DOM holds it. */
  seen: async ({ id } = {}) => {
    const m = game.messages.get(id);
    return { has: !!m, visible: m ? m.visible === true : false, dom: !!document.querySelector(`[data-message-id="${id}"]`) };
  },
  cards: async ({ since = 0 } = {}) => (globalThis.__ss.cards ?? []).filter((c) => c.at >= since).map((c) => ({ id: c.id, uuid: c.uuid })),

  openScreen: async ({ fid } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = acksExtras.sceneSearch.openScreen(fid);
    if (!H.opened.includes(app)) H.opened.push(app);
    const ok = await H.poll(() => (app.rendered && H.root(app) ? true : null), { tries: 60, every: 150 });
    await H.sleep(400);
    return { rendered: !!ok, found: !!X.win(fid) };
  },
  winOpen: async ({ fid } = {}) => {
    const H = globalThis.__tk;
    const app = globalThis.__ss.win(fid);
    if (app && !H.opened.includes(app)) H.opened.push(app);
    return !!app?.rendered && !!H.root(app);
  },
  /** The window's DOM read into data: each card's rails (chips, picker with each button's tooltip), notes, throw nodes, and the log. */
  snap: async ({ fid } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const app = X.win(fid);
    const root = app ? H.root(app) : null;
    if (!root) return null;
    const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const q = (sel, from = root) => from.querySelector(sel);
    const qa = (sel, from = root) => [...from.querySelectorAll(sel)];
    return {
      text: txt(root),
      empty: q(".acks-extras-ss-empty") ? txt(q(".acks-extras-ss-empty")) : null,
      showBtn: q('[data-action="show"]') ? txt(q('[data-action="show"]')) : null,
      seat: txt(q(".acks-extras-ss-seat")),
      noteCount: qa(".acks-extras-ss-note").length,
      throwCount: qa(".acks-extras-ss-throw").length,
      cards: qa(".acks-extras-ss-card").map((c) => ({
        key: c.dataset.dropEntry,
        plate: txt(q(".acks-extras-ss-plate", c)),
        rows: qa(".acks-extras-ss-row", c).map((r) => ({
          layer: r.dataset.dropLayer,
          chips: qa(".acks-extras-ss-chip", r).map((ch) => ({ name: txt(ch), struck: ch.classList.contains("is-struck") })),
          hasAssign: !!q('[data-action="pick"]', r),
          picker: q(".acks-extras-ss-picker", r)
            ? qa(".acks-extras-ss-pick", r).map((p) => ({ name: txt(q("button", p)), actorId: q("button", p).dataset.actorId, blocked: q("button", p).dataset.blocked === "true", refusal: txt(q(".acks-extras-ss-refuse", p)), tip: q("button", p).getAttribute("data-tooltip-text") }))
            : null,
        })),
      })),
      log: qa(".acks-extras-ss-log li").map((li) => {
        const head = li.firstElementChild;
        const thr = li.querySelector(".acks-extras-ss-throw");
        const clone = li.cloneNode(true);
        clone.firstElementChild?.remove();
        clone.querySelector(".acks-extras-ss-throw")?.remove();
        return { head: txt(head), text: txt(clone), throw: thr ? txt(thr) : null };
      }),
    };
  },
  click: async ({ fid, sel, nth = 0 } = {}) => {
    const H = globalThis.__tk;
    const root = H.root(globalThis.__ss.win(fid));
    if (!root) return { found: false, why: "no window" };
    const list = [...root.querySelectorAll(sel)];
    const el = list[nth];
    if (!el) return { found: false, count: list.length };
    el.click();
    return { found: true, count: list.length, disabled: !!el.disabled };
  },
  /** A press in the screen with the die held until its effect has landed (every hasty assignment resolved). */
  pressRound: async ({ fid, die, settle = 2500 } = {}) => {
    const H = globalThis.__tk;
    const X = globalThis.__ss;
    const btn = H.root(X.win(fid))?.querySelector('[data-action="round"]');
    if (!btn) return { pressed: false };
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    let done = null;
    try {
      btn.click();
      done = await H.poll(async () => ((await acksExtras.sceneSearch.assignments(fid)).filter((a) => a.layer === "hasty" && !a.resolved).length === 0 ? true : null), { tries: 100, every: 250 });
      await H.sleep(settle);
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { pressed: true, done: !!done };
  },
  /** The coordinator's probe: every stylesheet href, nested @import sheets included, with whether the scene-search and treasure sheets are among them. */
  sheetProbe: async () => {
    const seen = [];
    const walk = (sh) => { try { if (sh.href) seen.push(sh.href); for (const r of sh.cssRules ?? []) if (r.styleSheet) walk(r.styleSheet); } catch { /* cross-origin */ } };
    for (const s of document.styleSheets) walk(s);
    const has = (f) => seen.some((h) => h.includes(f));
    return { sceneSearch: has("styles/scene-search.css"), treasure: has("styles/treasure.css"), sheets: seen.length, k: getComputedStyle(document.body).getPropertyValue("--acks-extras-k") };
  },
  /** Does a rule whose selector names an .acks-extras-ss- class, from a sheet whose href names scene-search.css, match an element of the open screen? Walks grouping and layer rules and nested imports. */
  ruleProbe: async ({ fid } = {}) => {
    const root = globalThis.__tk.root(globalThis.__ss.win(fid));
    if (!root) return null;
    const matched = [];
    let total = 0;
    const rules = (list, href) => {
      for (const r of list ?? []) {
        if (r.styleSheet) { walk(r.styleSheet); continue; }
        if (r.cssRules && !r.selectorText) { rules(r.cssRules, href); continue; }
        if (r.selectorText?.includes(".acks-extras-ss-")) { total++; try { if (root.querySelector(r.selectorText)) matched.push(href); } catch { /* unmatchable selector */ } }
      }
    };
    const walk = (sh) => { try { rules(sh.cssRules, sh.href ?? ""); } catch { /* cross-origin */ } };
    for (const sh of document.styleSheets) walk(sh);
    return { ssRules: total, matchingRules: matched.length, fromSceneSearchSheet: matched.filter((h) => h.includes("styles/scene-search.css")).length, hrefs: [...new Set(matched)].map((h) => h.slice(Math.max(0, h.indexOf("modules/")))) };
  },
  /** Is the scene-search stylesheet among the page's sheets? With `inject`, add it with a cache-buster when absent and re-render the window. */
  styleSheet: async ({ fid, inject = false } = {}) => {
    const href = (h) => (h ?? "").includes("styles/scene-search.css");
    const loaded = [...document.styleSheets].some((sh) => href(sh.href));
    if (loaded || !inject) return { loaded, injected: false };
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `modules/acks-extras/styles/scene-search.css?walk=${Date.now()}`;
    await new Promise((res) => { link.onload = res; link.onerror = res; document.head.append(link); });
    await globalThis.__ss.win(fid)?.render?.();
    await new Promise((r) => setTimeout(r, 400));
    return { loaded: false, injected: [...document.styleSheets].some((sh) => href(sh.href)) };
  },
};

/** Poll an async condition from this side; the first truthy answer, else null. */
async function until(fn, { tries = 40, every = 250 } = {}) {
  for (let n = 0; n < tries; n++) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}
const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);
const cardOf = (s, key) => s?.cards.find((c) => c.key === key) ?? null;
const rowOf = (s, key, layer) => cardOf(s, key)?.rows.find((r) => r.layer === layer) ?? null;
const hasChip = (s, key, layer, name) => (rowOf(s, key, layer)?.chips ?? []).some((c) => c.name === name);
const pickSel = (key, layer) => `[data-action="pick"][data-entry="${key}"][data-layer="${layer}"]`;
const assignSel = (actorId, key, layer) => `[data-action="assign"][data-actor-id="${actorId}"][data-entry="${key}"][data-layer="${layer}"]`;

let gm = null;
let player = null;
watchdog(() => [gm, player], 1_500_000);
const own = { cards: [] };
let ids = null;
let tornDown = false;

/** Claim every card this GM client made since `since` (all carry the run's nonce); the claimed ones are tracked for the sweep. */
async function claimCards(since) {
  const made = await run(gm, P.cards, { since });
  for (const c of made) own.cards.push(gm.track(c.uuid, "ChatMessage"));
  return made;
}

/** Close the windows, take the members off the plan, put the holder's throws and level back, end any session, put the place's list back, and sweep what the run made by tracked id. */
async function teardown() {
  tornDown = true;
  await run(gm, P.closeAll).catch(() => null);
  await run(player, P.closeAll).catch(() => null);
  if (ids) {
    for (const actorId of [ids.holderId, ids.outsiderId]) await run(gm, P.unassign, { fid: ids.fid, actorId }).catch(() => null);
    await run(gm, P.endSession, { fid: ids.fid }).catch(() => null);
    for (const token of Object.values(ids.tokens ?? {})) if (token) await run(gm, P.throwsTo, { actorId: ids.holderId, token, blank: false }).catch(() => null);
    await run(gm, P.setLevel, { actorId: ids.holderId, level: 1 }).catch(() => null);
    if (ids.things) await run(gm, P.shapePlace, { placeId: ids.placeId, things: ids.things }).catch(() => null);
    await claimCards(0).catch(() => null);
  }
  const only = unique([...own.cards]);
  const swept = await gm.sweepTracked({ only });
  note("swept", swept);
  return { swept, wanted: only.length };
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|session|screen|round|lore/i });
  const setG = await run(gm, P.setup, { nonce: NONCE });
  const setP = await run(player, P.setup, { nonce: NONCE });
  if (!setG.lore || !setP.lore) blocked("scene-search/lore-logic.mjs does not import on both seats: slice S7a is not in the loaded tree");
  if (!setG.api || !setP.api) blocked("acksExtras.sceneSearch (open, assign, options) is not on both seats");
  if (!setG.screen || !setP.screen) blocked("acksExtras.sceneSearch.searchHere, show and openScreen are not on both seats");
  const bootBase = { gm: (await run(gm, P.boot)).length, player: (await run(player, P.boot)).length };
  const say = (api, key, data) => run(api, P.say, { ns: "screen", key, data });
  const sayScene = (key, data) => run(gm, P.say, { ns: "scene", key, data });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const tokens = await run(gm, P.tokens, { words: WORDS });
  const missingWords = Object.entries(tokens).filter(([, t]) => !t).map(([id]) => id);
  if (missingWords.length) blocked(`the rail's proficiency picker lists no capability for: ${missingWords.join(", ")} (those proficiencies are not imported)`);
  note("AUTOMATIC_SKILLS (the tokens whose page prints no throw)", setG.automatic);

  const scene = await gm.fixture(MARKS.scene, "Scene", { name: NAMES.scene, active: false, width: 3000, height: 1500, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  const sceneId = idOf(scene);
  await run(gm, P.shapeScene, { sceneId });
  const party = await gm.fixture(MARKS.party, "Actor", { name: NAMES.party, type: "acks-extras.party" });
  const character = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 }, details: { level: 1 } }, ownership: { default: 0, [playerId]: 3 } });
  const holder = await gm.fixture(MARKS.holder, "Actor", character(NAMES.holder));
  const outsider = await gm.fixture(MARKS.outsider, "Actor", character(NAMES.outsider));
  const place = await gm.fixture(MARKS.place, "Actor", { name: NAMES.place, type: "acks-extras.location", ownership: { default: 2 } });
  const partyId = idOf(party);
  const holderId = idOf(holder);
  const outsiderId = idOf(outsider);
  const placeId = idOf(place);
  const placeUuid = place.uuid ?? `Actor.${placeId}`;

  const { fid, error } = await run(gm, P.formationOf, { partyId });
  if (error) blocked(error);
  const BASE = baseThings(tokens);
  ids = { fid, placeId, sceneId, holderId, outsiderId, tokens, things: BASE };

  note("an earlier session ended", (await run(gm, P.endSession, { fid })).ok);
  const chars = await run(gm, P.shapeActors, { holderId, outsiderId, playerId, placeId });
  const shape = await run(gm, P.startShape, { fid, partyId, sceneId, members: [holderId, outsiderId] });
  if (shape.fight) blocked("a combat holds the walk's party; it is another session's and is not swept here");
  const where = await run(gm, P.centre, { fid });
  if (!where.token || where.sceneId !== sceneId) blocked("the party token is not on the walk's scene, so Search here cannot find the place");
  const rectA = { x: where.cx - 300, y: where.cy - 200, width: 600, height: 400 };
  const region = await gm.fixture(MARKS.region, "Region", { name: NAMES.region, color: "#336699", shapes: [{ type: "rectangle", ...rectA, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
  const regionShape = await run(gm, P.shapeRegion, { uuid: region.uuid, rect: rectA });
  const linked = await run(gm, P.linkPlace, { regionUuid: region.uuid, placeId });
  const placed = await run(gm, P.shapePlace, { placeId, things: BASE });

  // The holder's four proficiencies: found by token in the imported library, added from it where absent, and brought back to the library's own throws.
  const held = {};
  for (const [id, token] of Object.entries(tokens)) held[id] = await run(gm, P.ensureHeld, { actorId: holderId, token });
  note("how each proficiency came to the holder (route, copies, stamped, throws put back to the library's, equal to the library's)", Object.fromEntries(Object.entries(held).map(([id, h]) => [id, h.ok ? [h.route, h.copies, h.stamped, h.restored, h.sameAsLibrary] : h])));
  const outsiderHolds = {};
  for (const [id, token] of Object.entries(tokens)) outsiderHolds[id] = await run(gm, P.heldCount, { actorId: outsiderId, token });

  check(
    "the kept fixtures stand in shape: the Region with no behavior linked to the place, its list written whole at the five things, the Player seat owns both characters at level one, the party holds both with its token on the scene and no plan or session",
    regionShape.shapes === 1 && regionShape.behaviors === 0 && linked.linked && placed.type === "acks-extras.location" && placed.things.join() === THINGS.join()
      && chars.holderOwned && chars.outsiderOwned && chars.level === 1 && shape.members.length === 2 && shape.sceneId === sceneId && shape.partyToken && !shape.plan && !shape.session,
    { regionShape, linked, placed: placed.things, chars, shape },
  );
  check(
    "the holder holds exactly one stamped library copy of each of the four proficiencies (added from the imported library, never typed), the outsider holds none",
    Object.values(held).every((h) => h.ok && h.copies === 1 && h.stamped && h.sameAsLibrary !== false) && Object.values(outsiderHolds).every((n) => n === 0),
    { held: Object.fromEntries(Object.entries(held).map(([id, h]) => [id, h.ok ? { copies: h.copies, stamped: h.stamped, route: h.route, same: h.sameAsLibrary } : h])), outsider: outsiderHolds },
  );

  const fig = {};
  const readFig = async (id) => (fig[id] = await run(gm, P.figures, { actorId: holderId, token: tokens[id] }));
  for (const id of Object.keys(WORDS)) await readFig(id);
  note("the sheet's own reading of each throw at level one (the Rolls tab: how many throws, the first's figure, the lowest's)", Object.fromEntries(Object.entries(fig).map(([id, f]) => [id, f && { throws: f.throws, first: f.first, lowest: f.lowest, cite: !!f.cite }])));
  const AUTO = setG.automatic ?? [];
  const sensingListed = AUTO.includes(tokens.sensing);
  const sensingThrown = fig.sensing?.first !== null && fig.sensing?.first !== undefined;
  check("Sensing Power's token is the one AUTOMATIC_SKILLS lists (the page prints no throw)", sensingListed, { listed: sensingListed, sensingThrowRead: sensingThrown });
  const imported = { theology: fig.theology?.first != null, naturalism: fig.naturalism?.first != null, loremastery: fig.loremastery?.first != null };
  for (const [id, ok] of Object.entries(imported)) check(`FINDING if it fails: the imported ${WORDS[id]} carries a throw on the holder's Rolls tab at level one`, ok, { throws: fig[id]?.throws, first: fig[id]?.first });

  const st = () => run(gm, P.state, { fid, partyId, placeId });
  const snapG = () => run(gm, P.snap, { fid });
  const snapP = () => run(player, P.snap, { fid });
  const untilSnap = (api, pred, opts) => until(async () => { const s = await run(api, P.snap, { fid }); return s && pred(s) ? s : null; }, opts);
  const click = (api, sel, nth = 0) => run(api, P.click, { fid, sel, nth });
  const reset = async () => {
    await run(gm, P.unassign, { fid, actorId: holderId });
    await run(gm, P.unassign, { fid, actorId: outsiderId });
    await run(gm, P.shapePlace, { placeId, things: BASE });
    await sleep(900);
  };
  const openPicker = async (api, key, layer) => {
    await click(api, pickSel(key, layer));
    const s = await untilSnap(api, (x) => rowOf(x, key, layer)?.picker);
    return rowOf(s, key, layer)?.picker ?? [];
  };
  const cancelPicker = async (api) => { await click(api, '[data-action="cancelPick"]'); await sleep(400); };
  /** The picker pressed through, as a user does: open the rail's picker, press a member's button, wait for the chip. */
  const assignUI = async (api, actorId, name, key, layer) => {
    const rows = await openPicker(api, key, layer);
    await click(api, assignSel(actorId, key, layer));
    const s = await untilSnap(gm, (x) => hasChip(x, key, layer, name));
    return { rows, chip: !!s };
  };
  const nameH = NAMES.holder;
  const nameO = NAMES.outsider;
  const found = (state, id, layer) => state.things[id]?.[layer]?.found === true;

  const probeG = await run(gm, P.sheetProbe);
  const probeP = await run(player, P.sheetProbe);
  note("stylesheet probe before any injection, nested @import sheets included (gm, player)", { gm: probeG, player: probeP });

  // ----------------------------------------------------------------------------------------------
  section("1: open through Search here");
  const here = await run(gm, P.searchHere, { fid, placeUuid });
  if (!here.ok) {
    note("Search here refused; the walk opens the session through the api instead (the press itself was NOT driven)", here.reason);
    await run(gm, P.openPlain, { fid, placeUuid, sceneId });
  }
  const winG = await until(async () => ((await run(gm, P.winOpen, { fid })) ? true : null), { tries: 40, every: 250 });
  if (!winG) await run(gm, P.openScreen, { fid });
  const s1 = await untilSnap(gm, (s) => s.cards.length > 0);
  check(
    "pressing Search here (the party standing in the place) opened the scene search at the place with its screen, and the Judge's screen draws a card per thing (five), each with two rails and + Assign",
    here.ok === true && here.placeOk === true && !!s1 && s1.cards.length === THINGS.length && THINGS.every((id) => !!cardOf(s1, KEY[id])) && s1.cards.every((c) => c.rows.map((r) => r.layer).join() === "hasty,methodical" && c.rows.every((r) => r.hasAssign)),
    { here, cards: s1?.cards.length },
  );
  const ruleG = await run(gm, P.ruleProbe, { fid });
  const shown = await run(gm, P.showSession, { fid });
  const playerWin = await until(async () => ((await run(player, P.winOpen, { fid })) ? true : null), { tries: 40, every: 250 });
  if (!playerWin) await run(player, P.openScreen, { fid });
  note("the scene was shown to the table; the Player seat's window opened by itself", { shown: shown.ok, byItself: !!playerWin });
  await sleep(600);
  const ruleP = await run(player, P.ruleProbe, { fid });
  note("a scene-search.css rule applies to an element of the open screen, before any injection (gm, player)", { gm: ruleG, player: ruleP });
  const cssG = await run(gm, P.styleSheet, { fid, inject: true });
  const cssP = await run(player, P.styleSheet, { fid, inject: true });
  note("scene-search.css already among the top-level sheets (gm, player)", [cssG.loaded, cssP.loaded]);
  note("scene-search.css added by this walk with a cache-buster (gm, player); the world was not relaunched", [cssG.injected, cssP.injected]);

  // ----------------------------------------------------------------------------------------------
  section("2: assignable by the holder");
  await reset();
  const reasonCap = await run(gm, P.reasonText, { reason: "scene:capabilityMissing", name: nameO });
  const hastyRows = await openPicker(gm, KEY.theology, "hasty");
  await cancelPicker(gm);
  const optO = await run(gm, P.optionAt, { fid, actorId: outsiderId, key: KEY.theology });
  check(
    "at Theology checked hastily the picker lists the holder and the outsider with no refusal on either (a missing skill is the vague hint at the hasty check, never a block), and the outsider's own option is the vague mode",
    hastyRows.length === 2 && hastyRows.every((r) => !r.blocked && r.refusal === "") && optO.find((l) => l.layer === "hasty")?.mode === "vague" && optO.find((l) => l.layer === "hasty")?.refusal === null,
    { rows: hastyRows.map((r) => [r.name, r.blocked, r.refusal]), outsiderHasty: optO.find((l) => l.layer === "hasty") },
  );
  const methRows = await openPicker(gm, KEY.theology, "methodical");
  await cancelPicker(gm);
  const mH = methRows.find((r) => r.name === nameH);
  const mO = methRows.find((r) => r.name === nameO);
  check(
    "at Theology checked methodically the outsider is listed with 'lacks the capability this check names', and the holder is not blocked on the capability",
    !!mO && mO.blocked && mO.refusal === reasonCap && reasonCap.length > 0 && !!mH && (!mH.blocked || imported.theology === false),
    { holder: mH && [mH.blocked, mH.refusal], outsider: mO && [mO.blocked, mO.refusal === reasonCap] },
  );

  // ----------------------------------------------------------------------------------------------
  section("3: a thrown check");
  await reset();
  const clueHasty = await say(gm, "finds.clue", { clue: CLUE.hasty });
  const nothing = await say(gm, "finds.nothing");
  const vagueWord = await say(gm, "tell.vague");
  if (!imported.theology) {
    note("SKIP: the imported Theology carries no throw on the holder's sheet, so there is nothing to round", true);
  } else {
    const a3 = await assignUI(gm, holderId, nameH, KEY.theology, "hasty");
    const since3 = await run(gm, P.nowMs);
    const r3 = await run(gm, P.pressRound, { fid, die: HIT });
    const c3 = await run(gm, P.newestCard, { fid, needles: [fig.theology.name, fig.theology.cite].filter(Boolean) });
    const made3 = await claimCards(since3);
    const s3 = await untilSnap(gm, (s) => s.log.length > 0 && s.log[0].head.includes(nameH), { tries: 30 });
    const seenP = c3.card ? await run(player, P.seen, { id: c3.card.id }) : null;
    const snapP3 = await snapP();
    const row = s3?.log[0];
    const wantText = c3.card?.success ? clueHasty : nothing;
    check(
      "assigning the holder to Theology hasty and pressing Round posts one whispered Judges' card from the party: its figures are in the Judges' card flag (a total and a target), the target equals the first throw on the holder's sheet, its HTML names the ability, and every recipient is a Judge",
      a3.chip && r3.pressed && r3.done && made3.length === 1 && !!c3.card && c3.card.whisper.length > 0 && c3.card.whisper.every((w) => w.gm)
        && Number.isFinite(c3.card.total) && c3.card.target === fig.theology.first && c3.card.has[fig.theology.name] === true,
      { made: made3.length, whisper: c3.card?.whisper, target: c3.card?.target === fig.theology.first, name: c3.card?.has[fig.theology.name] },
    );
    check(
      "hovering the card's target gives the page the item cites (the tooltip on the target names it)",
      !!fig.theology.cite && c3.card?.has[fig.theology.cite] === true,
      { cite: !!fig.theology.cite, found: c3.card?.has[fig.theology.cite] },
    );
    note("the card's tooltips and text (what the target's tooltip actually carries)", { tips: c3.card?.tips, text: c3.card?.text });
    check(
      "the Judge's log row names the holder and the entry and reads what the card says (the clue line on a pass, 'Found nothing' on a miss), with the Judge-only throw figure beside it",
      !!row && row.head.includes(nameH) && row.text.startsWith(wantText) && row.throw !== null && c3.row?.code === (c3.card?.success ? "scene:found" : "scene:foundNothing"),
      { text: row?.text, success: c3.card?.success, code: c3.row?.code },
    );
    check(
      "no card reaches the Player seat: the whispered message is not visible there, the chat DOM holds none, the player's screen draws no throw node and no Judge note",
      !!seenP && seenP.visible === false && seenP.dom === false && !!snapP3 && snapP3.throwCount === 0 && snapP3.noteCount === 0,
      { seen: seenP, throws: snapP3?.throwCount, notes: snapP3?.noteCount },
    );
    note("game.messages.has(card) on the Player seat (a note: a whisper is delivered to every client and hidden by visibility)", seenP?.has);
  }

  // ----------------------------------------------------------------------------------------------
  section("4: the vague hint");
  await reset();
  const a4 = await assignUI(gm, outsiderId, nameO, KEY.naturalism, "hasty");
  const since4 = await run(gm, P.nowMs);
  const r4 = await run(gm, P.pressRound, { fid, die: HIT });
  const made4 = await claimCards(since4);
  const st4 = await st();
  const s4g = await untilSnap(gm, (s) => s.log.length > 0 && s.log[0].head.includes(nameO), { tries: 30 });
  const s4p = await untilSnap(player, (s) => s.log.some((l) => l.head.includes(nameO)), { tries: 30 });
  const rP4 = await run(player, P.readAs, { fid });
  check(
    "the outsider at Naturalism hasty and Round: the log row reads 'There might be something more here' on the Judge's seat and the Player's, no card is posted, and the entry is not found",
    a4.chip && r4.pressed && r4.done && made4.length === 0 && s4g?.log[0].text.startsWith(vagueWord) && s4p?.log.find((l) => l.head.includes(nameO))?.text.startsWith(vagueWord) && !found(st4, "naturalism", "hasty"),
    { made: made4.length, judge: s4g?.log[0].text, player: s4p?.log.find((l) => l.head.includes(nameO))?.text, found: found(st4, "naturalism", "hasty") },
  );
  check(
    "the Player's log keeps the code: its read of the row carries scene:vague (the Judge's own read does too)",
    rP4?.log.some((l) => l.key === KEY.naturalism && l.layer === "hasty" && l.code === "scene:vague"),
    { rows: rP4?.log.map((l) => [l.layer, l.code]) },
  );

  // ----------------------------------------------------------------------------------------------
  section("5: the first throw");
  await reset();
  const fN = fig.naturalism;
  note("Naturalism on the sheet: how many throws, whether the first differs from the lowest", { throws: fN?.throws, firstDiffersFromLowest: fN ? fN.first !== fN.lowest : null });
  if (!imported.naturalism) {
    note("SKIP: no throw on the holder's Naturalism", true);
  } else {
    const optN = (await run(gm, P.optionAt, { fid, actorId: holderId, key: KEY.naturalism })).find((l) => l.layer === "hasty");
    const a5 = await assignUI(gm, holderId, nameH, KEY.naturalism, "hasty");
    const since5 = await run(gm, P.nowMs);
    const r5 = await run(gm, P.pressRound, { fid, die: HIT });
    const c5 = await run(gm, P.newestCard, { fid });
    await claimCards(since5);
    check(
      "the Judges' card's target and the picker's option both equal the FIRST throw's figure on the holder's Rolls tab",
      a5.chip && r5.done && !!c5.card && c5.card.target === fN.first && optN?.target === fN.first,
      { card: c5.card?.target === fN.first, option: optN?.target === fN.first },
    );
    note("the imported Naturalism's throw count; with one throw the first IS the lowest, so 'first, not lowest' is proved below on an invented second throw", fN.throws);
    // 5b: a second throw with an invented flat figure below the first, written through the roll writer; the library's throws are put back after.
    await reset();
    const lowerTo = Math.max(1, fN.first - 3);
    // The sheet's figure is the flat figure less the standing bonus on the throw, so the bonus is read off a probe first and the invented flat figure is written with it added.
    await run(gm, P.throwsTo, { actorId: holderId, token: tokens.naturalism, blank: false, lowerSecond: 20 });
    const probe = await run(gm, P.figures, { actorId: holderId, token: tokens.naturalism });
    const standing = 20 - (probe?.all?.[1] ?? 20);
    await run(gm, P.throwsTo, { actorId: holderId, token: tokens.naturalism, blank: false });
    note("the standing bonus the sheet applies to a flat throw on this ability (flat figure less the sheet's figure)", standing);
    const added = await run(gm, P.throwsTo, { actorId: holderId, token: tokens.naturalism, blank: false, lowerSecond: lowerTo + standing });
    const fN2 = await run(gm, P.figures, { actorId: holderId, token: tokens.naturalism });
    const optN2 = (await run(gm, P.optionAt, { fid, actorId: holderId, key: KEY.naturalism })).find((l) => l.layer === "hasty");
    const a5b = await assignUI(gm, holderId, nameH, KEY.naturalism, "hasty");
    const since5b = await run(gm, P.nowMs);
    const r5b = await run(gm, P.pressRound, { fid, die: HIT });
    const c5b = await run(gm, P.newestCard, { fid });
    await claimCards(since5b);
    const backN = await run(gm, P.throwsTo, { actorId: holderId, token: tokens.naturalism, blank: false });
    note("the holder's Naturalism put back to the library's (differing fields, counts)", { same: backN.sameAsLibrary, differing: backN.differing, counts: backN.counts });
    check(
      "with a second, lower throw on the item (two throws, the first not the lowest) the Judges' card's target and the picker's option are still the FIRST throw's figure, not the lowest",
      added.ok && fN2?.throws === 2 && fN2.first === fN.first && fN2.lowest < fN2.first && a5b.chip && r5b.done && !!c5b.card && c5b.card.target === fN2.first && c5b.card.target !== fN2.lowest && optN2?.target === fN2.first,
      { throws: fN2?.throws, shape: fN2?.shape, all: fN2?.all, wroteSecond: lowerTo + standing, firstKept: fN2?.first === fN.first, lower: fN2 ? fN2.lowest < fN2.first : null, card: c5b.card ? [c5b.card.target === fN2?.first, c5b.card.target === fN2?.lowest] : null, option: optN2?.target === fN2?.first },
    );
  }

  // ----------------------------------------------------------------------------------------------
  section("6: Loremastery at two levels");
  await reset();
  if (!imported.loremastery) {
    note("SKIP: the imported Loremastery yields no throw at level one (see the FINDING check above)", true);
  } else {
    const byLevel = {};
    for (let lv = 1; lv <= 14; lv++) {
      await run(gm, P.setLevel, { actorId: holderId, level: lv });
      byLevel[lv] = (await run(gm, P.figures, { actorId: holderId, token: tokens.loremastery }))?.first ?? null;
    }
    await run(gm, P.setLevel, { actorId: holderId, level: 1 });
    note("the sheet's Loremastery figure at levels 1 to 14", byLevel);
    const movesAt = Object.keys(byLevel).map(Number).find((lv) => byLevel[lv] !== byLevel[1]) ?? null;
    check("the sheet's Loremastery figure moves with level somewhere in 1 to 14 (the lift is level-scaled)", movesAt !== null, { byLevel });
    const L2 = movesAt ?? 2;
    const read = async (lv) => {
      await run(gm, P.setLevel, { actorId: holderId, level: lv });
      await sleep(400);
      return (await run(gm, P.optionAt, { fid, actorId: holderId, key: KEY.loremastery })).find((l) => l.layer === "hasty");
    };
    const o1 = await read(1);
    const o2 = await read(L2);
    const o3 = await read(2);
    await run(gm, P.setLevel, { actorId: holderId, level: 1 });
    check(
      "the picker's option for Loremastery carries the sheet's figure at level one and at the first level where the sheet's figure changes (both read from the options the screen uses, not the Judges' card)",
      o1?.target === byLevel[1] && o2?.target === byLevel[L2] && o1?.refusal === null && o2?.refusal === null,
      { level1: o1?.target === byLevel[1], levelMoved: [L2, o2?.target === byLevel[L2]] },
    );
    note("the figure at the recipe's 'one level up' (level 2) on the picker equals the sheet's", o3?.target === byLevel[2]);
  }

  // ----------------------------------------------------------------------------------------------
  section("7: a blank figure");
  await reset();
  const cite7 = fig.theology?.cite ?? "";
  const tipWant = cite7 ? await say(gm, "assign.notImportedSkillTip", { cite: cite7 }) : "";
  const blanked = await run(gm, P.throwsTo, { actorId: holderId, token: tokens.theology, blank: true });
  const f7 = await run(gm, P.figures, { actorId: holderId, token: tokens.theology });
  const o7 = (await run(gm, P.optionAt, { fid, actorId: holderId, key: KEY.theology })).find((l) => l.layer === "hasty");
  const rows7 = await openPicker(gm, KEY.theology, "hasty");
  const h7 = rows7.find((r) => r.name === nameH);
  await click(gm, assignSel(holderId, KEY.theology, "hasty"));
  await sleep(1200);
  const st7 = await st();
  await cancelPicker(gm);
  const back = await run(gm, P.throwsTo, { actorId: holderId, token: tokens.theology, blank: false });
  const f7b = await run(gm, P.figures, { actorId: holderId, token: tokens.theology });
  check(
    "with the holder's Theology throw cleared on its Rolls tab the sheet reads no figure, the option is refused scene:notImported carrying the item's cited page",
    blanked.ok && f7?.first === null && o7?.refusal === "scene:notImported" && o7?.cite === (cite7 || null),
    { sheetFirst: f7?.first, refusal: o7?.refusal, citeMatches: o7?.cite === (cite7 || null), hasCite: !!cite7 },
  );
  check(
    "the picker lists the holder blocked with no words under the button, its tooltip is the page the item cites and nothing else, and pressing the button assigns nothing",
    !!h7 && h7.blocked && h7.refusal === "" && (h7.tip ?? "") === tipWant && !st7.plan?.[holderId],
    { blocked: h7?.blocked, refusal: h7?.refusal, tipIsTheCite: (h7?.tip ?? "") === tipWant, tipEmpty: !(h7?.tip), plan: !!st7.plan?.[holderId] },
  );
  note("the holder's Theology put back to the library's through the roll writer (differing fields, counts)", { same: back.sameAsLibrary, differing: back.differing, counts: back.counts });
  check("the holder's Theology throws are put back through the roll writer and the sheet reads the same throws and first figure again", back.ok && f7b?.first === fig.theology?.first && f7b?.throws === fig.theology?.throws, { first: f7b?.first === fig.theology?.first, throws: f7b?.throws });

  // ----------------------------------------------------------------------------------------------
  section("8: no throw printed (Sensing Power)");
  await reset();
  const optS = (await run(gm, P.optionAt, { fid, actorId: holderId, key: KEY.sensing })).find((l) => l.layer === "hasty");
  if (sensingThrown) {
    note("the imported Sensing Power carries a throw on the holder's sheet, so it is thrown like any other (the automatic expectation does not apply)", { first: true });
    check("a Sensing Power that carries a throw is offered with a target", optS?.refusal === null && optS?.target === fig.sensing.first && optS?.automatic === false, { target: optS?.target === fig.sensing.first, automatic: optS?.automatic });
  } else {
    check("the holder's Sensing Power with no throw is offered automatic: no target and no refusal", optS?.automatic === true && optS?.target === null && optS?.refusal === null, { automatic: optS?.automatic, target: optS?.target, refusal: optS?.refusal });
    const a8 = await assignUI(gm, holderId, nameH, KEY.sensing, "hasty");
    const since8 = await run(gm, P.nowMs);
    const r8 = await run(gm, P.pressRound, { fid, die: MISS });
    const made8 = await claimCards(since8);
    const st8 = await st();
    const s8 = await untilSnap(gm, (s) => s.log.length > 0 && s.log[0].head.includes(nameH), { tries: 30 });
    const after = (await run(gm, P.optionAt, { fid, actorId: holderId, key: KEY.sensing })).find((l) => l.layer === "hasty");
    check(
      "Round at a held 1: no card is posted (nothing is rolled), the log row reads the clue line (found), the layer is found, and the holder is not locked at that spot",
      a8.chip && r8.done && made8.length === 0 && s8?.log[0].text.startsWith(clueHasty) && found(st8, "sensing", "hasty") && Object.keys(st8.things.sensing?.hasty?.failed ?? {}).length === 0 && after?.refusal !== "scene:hastyLocked",
      { made: made8.length, text: s8?.log[0].text, found: found(st8, "sensing", "hasty"), failed: st8.things.sensing?.hasty?.failed ?? null, after: after?.refusal },
    );
  }
  await reset();
  const a8b = await assignUI(gm, outsiderId, nameO, KEY["sensing-2"], "hasty");
  const since8b = await run(gm, P.nowMs);
  const r8b = await run(gm, P.pressRound, { fid, die: HIT });
  const made8b = await claimCards(since8b);
  const st8b = await st();
  const s8b = await untilSnap(gm, (s) => s.log.length > 0 && s.log[0].head.includes(nameO), { tries: 30 });
  check(
    "the outsider at the second Sensing Power thing hasty: the log row reads 'There might be something more here', no card is posted, the entry is not found",
    a8b.chip && r8b.done && made8b.length === 0 && s8b?.log[0].text.startsWith(vagueWord) && !found(st8b, "sensing-2", "hasty"),
    { made: made8b.length, text: s8b?.log[0].text },
  );

  // ----------------------------------------------------------------------------------------------
  section("9: the Player seat");
  await reset();
  const g9 = await snapG();
  const p9 = await untilSnap(player, (s) => s.cards.length > 0);
  check(
    "the Player's screen lists each entry the Judge shows (the same five), each with a rail and + Assign",
    !!p9 && p9.cards.map((c) => c.key).sort().join() === g9.cards.map((c) => c.key).sort().join() && p9.cards.length === THINGS.length && p9.cards.every((c) => c.rows.every((r) => r.hasAssign)),
    { player: p9?.cards.length, judge: g9.cards.length },
  );
  const pHasty = await openPicker(player, KEY.theology, "hasty");
  await cancelPicker(player);
  const pMeth = await openPicker(player, KEY.theology, "methodical");
  await cancelPicker(player);
  const sameRows = (a, b) => JSON.stringify(a.map((r) => [r.name, r.blocked, r.refusal]).sort()) === JSON.stringify(b.map((r) => [r.name, r.blocked, r.refusal]).sort());
  check(
    "the Player's pickers follow the Judge's refusals: Theology hasty and methodical list both owned characters with the same blocked marks and refusal words as the Judge's",
    pHasty.length === 2 && pMeth.length === 2 && sameRows(pHasty, hastyRows) && sameRows(pMeth, methRows),
    { hasty: sameRows(pHasty, hastyRows), methodical: sameRows(pMeth, methRows), outsiderRefusal: pMeth.find((r) => r.name === nameO)?.refusal === reasonCap },
  );
  if (imported.theology) {
    const a9 = await assignUI(player, holderId, nameH, KEY.theology, "hasty");
    const gmChip = await untilSnap(gm, (s) => hasChip(s, KEY.theology, "hasty", nameH));
    const since9 = await run(gm, P.nowMs);
    const r9 = await run(gm, P.pressRound, { fid, die: HIT });
    const made9 = await claimCards(since9);
    const p9b = await untilSnap(player, (s) => s.log.some((l) => l.head.includes(nameH)), { tries: 30 });
    const c9 = await run(gm, P.newestCard, { fid });
    const seen9 = c9.card ? await run(player, P.seen, { id: c9.card.id }) : null;
    const row9 = p9b?.log.find((l) => l.head.includes(nameH));
    check(
      "the Player assigns the owned holder (the Judge's seat shows the chip), the Judge's Round posts one card, and the Player's screen shows the row with no throw figure, no Judge note and no card visible",
      a9.chip && !!gmChip && r9.done && made9.length === 1 && !!p9b && row9?.throw === null && p9b.throwCount === 0 && p9b.noteCount === 0 && seen9?.visible === false && seen9?.dom === false,
      { chipOnJudge: !!gmChip, made: made9.length, throw: row9?.throw ?? null, seen: seen9 },
    );
  } else {
    note("SKIP: the Player's thrown assignment (no Theology throw on the holder)", true);
  }

  // ----------------------------------------------------------------------------------------------
  section("console");
  for (const [key, api] of Object.entries({ gm, player })) {
    const drained = await run(api, P.drain);
    const boot = (await run(api, P.boot)).slice(bootBase[key]);
    const named = [...drained.errors, ...boot].filter((e) => /scene-search|SceneSearch|screen-logic|lore/i.test(e));
    note(`${key}: console errors and page errors since the walk began (any text)`, drained.errors.length + boot.length);
    check(`${key}: no console error, page error or unhandled rejection names a scene-search file (the recorder was attached from load)`, named.length === 0, named.slice(0, 3).map((e) => e.slice(0, 140)));
  }

  section("teardown");
  const { swept, wanted } = await teardown();
  check(
    "the run's own documents were swept by tracked id (the Judges' cards this GM client posted), and the kept fixtures stand",
    (swept?.failed ?? []).length === 0 && (swept?.removed ?? []).length === wanted,
    { removed: (swept?.removed ?? []).length, missing: (swept?.missing ?? []).length, failed: (swept?.failed ?? []).length, wanted },
  );
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.log(`WALK ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  try { if (gm && !tornDown) { section("teardown after a stop"); await teardown(); } } catch (err) { console.error("teardown:", err?.message ?? err); }
  try { if (gm) { await run(gm, P.unhook); await run(gm, P.restore); } } catch {}
  try { if (player) await run(player, P.restore); } catch {}
  finish();
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
}
