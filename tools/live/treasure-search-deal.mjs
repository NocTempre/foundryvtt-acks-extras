/**
 * Live walk, treasure search deal: the fight-over card's Deal block and the
 * magic a searched hoard rolls. Walks docs/treasure/TESTING.md "The Deal block
 * and the Table button" (the card step), steps 1 to 6, on both seats. A real
 * fight is ended by the tracker's own End Combat button and its confirm, so the
 * real `deleteCombat` hook posts each card on the primary GM's client; nothing
 * here calls the hook. Every observable is a boolean or a count: the walk
 * prints no treasure letter, no table cell and no card's content. Machine
 * values arrive through ./_env.mjs; the shared seat plumbing is
 * ./_treasure-kit.mjs. Every name and figure typed into a fixture is invented.
 *
 * Covers: fixtures (a scene, a Region and a location actor linked to it, a
 * party holding two characters with its token inside the Region, a monster
 * whose treasure type is a letter the imported tables deal magic from, a
 * monster with a linked table and no letter, the table); step 1 (a fight and
 * its card on the Judge seat: Deal above Search the scene with three Table
 * style buttons, the first pressed, an arms select, Special treasure and Met
 * in their lair off, a Treasure tables button; real presses of Heroic, Special
 * treasure and Met in their lair, the arms column changed by the select; each
 * press writes the card's `deal` flag and the control pressed keeps focus; a
 * second copy of the card drawn elsewhere holds ids of its own and a press in
 * it writes the one flag); step 2 (Search the scene pressed with the die held:
 * the scene's pot carries the card's four choices in its pot flag, no lair
 * warning is shown, and the pot holds rolled magic cards where the world
 * imports the magic tables; a fresh fight whose card has its `deal` stripped,
 * Met in their lair off: the block reads from the seed, the press asks for no
 * choices, the pot carries the seed, the Judge is told the lair warning as a
 * notice and the pot still opens); step 3 (the pressed card shows no controls,
 * only its reason line and tooltip); step 4 (the Player seat: the message is
 * not updatable by it and renders no Deal block); step 5 (a card whose bodies
 * carry no treasure type: every control disabled under the visible reason);
 * step 6 (the Table chip is a button that opens the linked RollTable's sheet;
 * a card naming a table that is gone draws it disabled; a body with no letter
 * keeps its sheet button); the console on both seats; teardown.
 *
 * Fixtures, kept and found by marker: `treasure/card-scene`,
 * `treasure/card-region`, `treasure/card-place`, `treasure/card-party` (the
 * Player seat owns it), `treasure/card-owner` (a character the Player seat
 * owns), `treasure/card-mate`, `treasure/card-hostile` (a monster with a goods
 * item and the chosen letter), `treasure/card-hostile-2` (a monster with a
 * linked table and no letter) and `treasure/card-table` (a text result on a
 * one-sided die). The tokens, the combats, the cards, the pots, the
 * declaration and the table step 6 deletes are the run's own, tracked by id and
 * swept by id; kept fixtures stay.
 *
 * Real gestures: End Combat and its confirm, each style, Special treasure and
 * Met in their lair press, the card's Search the scene, the Table chip.
 * Scripted: the knock-down of each body, the arms select's change (a select has
 * no pointer gesture that is not the browser's own popup), the second copy's
 * press, the die (held through `CONFIG.Dice.randomUniform` around each press
 * and restored in `finally`), the strip of one card's `deal`, the card's flag
 * edit that names a table that is gone.
 *
 * Not reached: a second copy as Foundry's popped-out chat draws it (the copy is
 * `ChatMessage#renderHTML` placed in the page, which runs the same render hook,
 * and not a window of its own), a reload of the page with the card in the log
 * (the block is read again on a re-render, not a reload), a second Judge seat
 * reading the card, a card posted by a build before the block (its `deal` is
 * stripped from a card of this build), and a world with no magic tables
 * imported (the rolled-magic check is then skipped).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as KIT, section, check, note, finish, watchdog, openSeats, run, t, idOf, sleep, press, clicks, checks } from "./_treasure-kit.mjs";

const MARKS = {
  scene: "treasure/card-scene",
  region: "treasure/card-region",
  place: "treasure/card-place",
  party: "treasure/card-party",
  owner: "treasure/card-owner",
  mate: "treasure/card-mate",
  hostile: "treasure/card-hostile",
  hostile2: "treasure/card-hostile-2",
  table: "treasure/card-table",
};
const NAMES = {
  scene: "QA Card Scene",
  region: "QA Card Region",
  place: "QA Card Place",
  party: "QA Card Party",
  owner: "QA Card Owner",
  mate: "QA Card Mate",
  hostile: "QA Card Hostile",
  hostile2: "QA Card Hostile Two",
  table: "QA Card Table",
  tableText: "QA Card Table Note",
  gone: "QA Card Vanishing Table",
};
const GOODS = [{ name: "QA Card Trinket", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 30 } }];
const NONCE = "tsd" + Math.random().toString(36).slice(2, 7);
const FLOOR = 0;
const ORIGIN = { x: 400, y: 400 };

const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  ...KIT,

  /** The modules the page functions reach, and, on the GM seat, a hook that records the chat cards its own client makes. */
  setup: async ({ nonce } = {}) => {
    const X = (globalThis.__td = globalThis.__td ?? {});
    const base = "/modules/acks-extras/scripts/";
    X.model = await import(`${base}formation/formation-model.mjs`);
    X.link = await import(`${base}location/scene-link.mjs`);
    X.around = await import(`${base}location/places-around.mjs`);
    X.pot = await import(`${base}treasure/pot.mjs`);
    X.potLogic = await import(`${base}treasure/pot-logic.mjs`);
    X.util = await import(`${base}lib/util.mjs`);
    X.win = (fid) => foundry.applications.instances.get(`acks-extras-scene-search-${fid}`) ?? null;
    if (game.user.isGM && !X.cards) {
      X.cards = [];
      X.hooks = [
        ["preCreateChatMessage", Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); })],
        ["createChatMessage", Hooks.on("createChatMessage", (m) => { if (m.flags?.world?.qaNonce === nonce) X.cards.push({ id: m.id, at: Date.now() }); })],
      ];
    }
    await X.util.primaryGMSettled?.();
    const api = globalThis.acksExtras?.sceneSearch;
    return { api: typeof api?.searchHere === "function", primary: !!X.util.isPrimaryGM?.() };
  },
  unhook: async () => {
    const X = globalThis.__td;
    for (const [name, id] of X?.hooks ?? []) Hooks.off(name, id);
    if (X) { X.hooks = []; X.cards = null; }
    return true;
  },
  nowMs: async () => Date.now(),
  /** The ids of the chat cards this GM client made since `since`. */
  made: async ({ since = 0 } = {}) => (globalThis.__td.cards ?? []).filter((c) => c.at >= since).map((c) => c.id),
  say: async ({ key, data } = {}) => (data && Object.keys(data).length ? game.i18n.format(key, data) : game.i18n.localize(key)),

  /**
   * The letters the imported tables deal, chosen in page under a floor die: one that deals a magic
   * placeholder a magic-item list answers to, per style, and one that deals any card. Counts and
   * the letters come back to the driver, which prints neither.
   */
  pickLetters: async () => {
    const T = await import(`/modules/acks-extras/scripts/lib/tables.mjs`);
    const B = await import(`/modules/acks-extras/scripts/importer/treasure-binding.mjs`);
    const Hd = await import(`/modules/acks-extras/scripts/treasure/hoard.mjs`);
    const Mg = await import(`/modules/acks-extras/scripts/treasure/magic-deal-logic.mjs`);
    const D = await import(`/modules/acks-extras/scripts/treasure/deal.mjs`);
    const starts = globalThis.acksExtras?.magicItems?.starts?.() ?? null;
    const out = { imported: T.hasDoc(B.TREASURE_DOC_ID), starts: !!starts, any: null, magic: { classic: null, heroic: null }, columns: D.armsSource().columns.length };
    if (!out.imported) return out;
    const keys = Object.keys(T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {});
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;
    try {
      for (const letter of keys) {
        for (const style of ["classic", "heroic"]) {
          const open = await Hd.dealHoard({ letter, style, toggles: {} });
          if (style === "classic" && (open.truths ?? []).length) out.any ??= letter;
          if (!starts) continue;
          for (const x of open.truths ?? []) {
            if (x.pool !== "magic" || !("tableRef" in x)) continue;
            if (Mg.startFor(x.tableRef, style, starts, { typeList: x.typeList === true }).ok) out.magic[style] ??= letter;
          }
        }
      }
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return out;
  },
  rig: async ({ die }) => {
    const X = globalThis.__td;
    if (!X.orig) X.orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    return true;
  },
  unrig: async () => {
    const X = globalThis.__td;
    if (X?.orig) { CONFIG.Dice.randomUniform = X.orig; X.orig = null; }
    return true;
  },

  /* ---- Fixtures --------------------------------------------------------- */
  shapeScene: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    const g = scene.grid;
    if (g.size !== 100 || g.distance !== 5 || g.units !== "ft") await scene.update({ grid: { size: 100, distance: 5, units: "ft" } });
    return { size: scene.grid.size };
  },
  formationOf: async ({ partyId }) => {
    const X = globalThis.__td;
    const found = await globalThis.__tk.poll(() => Object.values(X.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  /** The kept actors at the shape the steps start from: ownership, the hostiles' letter and table, token disposition, the goods once. */
  shapeActors: async ({ ids, playerId, letter, tableUuid, goods }) => {
    const wrote = [];
    const own = async (actor, level) => { if ((actor.ownership?.[playerId] ?? 0) !== level) { await actor.update({ [`ownership.${playerId}`]: level, "ownership.default": 0 }); wrote.push(`${actor.name}:ownership`); } };
    await own(game.actors.get(ids.owner), 3);
    await own(game.actors.get(ids.mate), 0);
    await own(game.actors.get(ids.party), 3);
    for (const [key, a] of [["hostile", game.actors.get(ids.hostile)], ["hostile2", game.actors.get(ids.hostile2)]]) {
      const want = key === "hostile" ? { type: letter, table: "" } : { type: "", table: `@UUID[${tableUuid}]` };
      const t0 = a.system?.details?.treasure ?? {};
      if ((t0.type ?? "") !== want.type || (t0.table ?? "") !== want.table) { await a.update({ "system.details.treasure.type": want.type, "system.details.treasure.table": want.table }); wrote.push(`${key}:treasure`); }
      if (a.prototypeToken.disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE || a.prototypeToken.actorLink) { await a.update({ "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.HOSTILE, "prototypeToken.actorLink": false }); wrote.push(`${key}:token`); }
    }
    const h = game.actors.get(ids.hostile);
    const have = new Set(h.items.map((i) => i.name));
    const miss = goods.filter((i) => !have.has(i.name));
    if (miss.length) { await h.createEmbeddedDocuments("Item", miss); wrote.push("hostile:goods"); }
    const names = h.items.map((i) => i.name);
    const tr2 = game.actors.get(ids.hostile2).system.details.treasure;
    return {
      wrote,
      dup: h.items.size !== new Set(names).size,
      goodsHeld: goods.every((g) => names.includes(g.name)),
      letterSet: (h.system.details.treasure.type ?? "") === letter,
      linked: (tr2.table ?? "").includes(tableUuid) && (tr2.type ?? "") === "",
      ownerOwns: game.actors.get(ids.owner).testUserPermission(game.users.get(playerId), "OWNER"),
      mateOwns: game.actors.get(ids.mate).testUserPermission(game.users.get(playerId), "OWNER"),
      partyOwns: game.actors.get(ids.party).testUserPermission(game.users.get(playerId), "OWNER"),
    };
  },
  /** The linked table at its start shape: one text result on a die of one side, replacement on. */
  shapeTable: async ({ tableId, textName }) => {
    const table = game.tables.get(tableId);
    const results = () => table.results.contents.map((r) => ({ type: r.type, name: r.name ?? "", text: r.text ?? "", range: [...(r.range ?? [])] }));
    const ok = () => {
      const r = results();
      return table.formula === "1d1" && table.replacement === true && r.length === 1 && r[0].range.join() === "1,1" && (r[0].name === textName || r[0].text === textName);
    };
    let rewrote = false;
    if (!ok()) {
      if (table.results.size) await table.deleteEmbeddedDocuments("TableResult", table.results.map((r) => r.id));
      await table.update({ formula: "1d1", replacement: true });
      await table.createEmbeddedDocuments("TableResult", [{ type: "text", name: textName, range: [1, 1], weight: 1 }]);
      rewrote = true;
    }
    if (table.results.some((r) => r.drawn)) await table.resetResults();
    return { rewrote, ok: ok() };
  },
  /** The place's list written whole: one floor. */
  shapePlace: async ({ placeId }) => {
    const a = game.actors.get(placeId);
    const things = [{ id: "floor-1", kind: "floor", ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {} }];
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((x) => x.id) };
  },
  /** The party at its start shape: both characters in it, its token on the scene at `at`, no plan, no session, no combat. */
  startShape: async ({ fid, partyId, sceneId, members, at }) => {
    const X = globalThis.__td;
    const H = globalThis.__tk;
    const scene = game.scenes.get(sceneId);
    const party = game.actors.get(partyId);
    if (game.combats.some((c) => c.combatants.some((x) => x.actorId === partyId || members.includes(x.actorId)))) return { fight: true };
    await X.model.patchFormation(fid, (rec) => {
      rec.combat = null;
      rec.clock.paused = false;
      rec.clock.movedThisTurn = false;
      rec.clock.roundsPartial = 0;
      rec.clock.carryFeet = 0;
      if (rec.stance?.pace === "hurried") delete rec.stance.pace;
    });
    const f0 = X.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) await X.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    for (const [n, id] of members.entries()) {
      const f = X.model.getFormation(fid);
      if (f.members.some((m) => m?.actorId === id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: at.x + n * 100, y: at.y });
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
    const token = X.model.getPartyToken(f);
    return { fight: false, members: f.members.filter((m) => m?.actorId).map((m) => m.actorId), sceneId: f.sceneId, token: !!token, tokenId: token?.id ?? null, tokenActorId: token?.actorId ?? null, plan: party.getFlag("acks-extras", "turnPlan") ?? null, session: party.getFlag("acks-extras", "sceneSearch") ?? null };
  },
  /** Where the party token's centre is. */
  centre: async ({ fid }) => {
    const X = globalThis.__td;
    const f = X.model.getFormation(fid);
    const token = X.model.getPartyToken(f);
    const scene = token?.parent ?? null;
    if (!token || !scene) return { token: false };
    const { tokenCentre } = await import(`/modules/acks-extras/scripts/lib/token-centre.mjs`);
    const c = tokenCentre(token, scene, token._source ?? token);
    return { token: true, sceneId: scene.id, cx: c.x, cy: c.y };
  },
  shapeRegion: async ({ uuid, rect }) => {
    const region = await fromUuid(uuid);
    const s = region.shapes[0];
    const same = region.shapes.length === 1 && s?.type === "rectangle" && s.x === rect.x && s.y === rect.y && s.width === rect.width && s.height === rect.height && !s.hole;
    if (!same) await region.update({ shapes: [{ type: "rectangle", x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: 0, hole: false }] });
    return { shapes: region.shapes.length, behaviors: region.behaviors.size };
  },
  linkPlace: async ({ regionUuid, placeId }) => {
    const X = globalThis.__td;
    const region = await fromUuid(regionUuid);
    const place = game.actors.get(placeId);
    const agrees = () => X.link.locationOfRegion(region)?.uuid === place.uuid && X.link.regionOfLocation(place)?.uuid === region.uuid;
    if (!agrees()) await X.link.linkRegion(region, place);
    return { linked: agrees() };
  },
  placesAt: async ({ fid }) => {
    const X = globalThis.__td;
    const token = X.model.getPartyToken(X.model.getFormation(fid));
    return token ? { token: true, places: X.around.placesAround(token, token.parent).length } : { token: false, places: 0 };
  },

  /* ---- The fight -------------------------------------------------------- */
  startFight: async ({ combatId, start = null }) => {
    const c = game.combats.get(combatId);
    if (!c) return { found: false };
    if (start === "update") await c.update({ round: 1, turn: 0 });
    return { found: true, started: !!c.started, sceneId: c.scene?.id ?? null, rows: c.combatants.length };
  },
  defeat: async ({ combatId, combatantId, how }) => {
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    if (!c) return { found: false };
    if (how === "hp") await c.token.actor.update({ "system.hp.value": 0 });
    else {
      await c.update({ defeated: true });
      await c.actor?.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { overlay: true, active: true });
    }
    return { found: true, isDefeated: !!c.isDefeated };
  },
  view: async ({ combatId, viewScene = null }) => {
    const H = globalThis.__tk;
    const combat = game.combats.get(combatId);
    try { ui.sidebar.changeTab("combat", "primary"); } catch { /* already showing */ }
    if (viewScene) { try { await game.scenes.get(viewScene)?.view(); } catch { /* no canvas */ } }
    await ui.combat.render({ combat, force: true });
    for (let n = 0; n < 40 && !ui.combat.element?.querySelector?.("li.combatant"); n++) await H.sleep(150);
    return { viewed: ui.combat.viewed?.id ?? null, endButton: !!ui.combat.element?.querySelector?.("[data-action='endCombat']") };
  },
  showChat: async () => { try { ui.sidebar.changeTab("chat", "primary"); } catch { /* already showing */ } await globalThis.__tk.sleep(300); return true; },
  combatGone: async ({ combatId }) => !!(await globalThis.__tk.poll(() => !game.combats.get(combatId), { tries: 60, every: 250 })),

  /* ---- The card ---------------------------------------------------------- */
  /** The id of a fight's card on this seat's collection, once the real hook has posted it and the log has drawn it. */
  findCard: async ({ combatId }) => {
    const H = globalThis.__tk;
    const m = await H.poll(() => { const x = game.messages.find((y) => y.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId); return x && document.querySelector(`[data-message-id='${x.id}'] [data-field='deal'] .acks-extras-treasure-search__deal`) ? x : null; }, { tries: 60, every: 250 });
    return { id: m?.id ?? null, count: game.messages.filter((y) => y.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId).length };
  },
  /** The card's Deal block and rows as a seat draws them, from the log copy or, with `host`, from the second copy in the page. */
  cardView: async ({ messageId, host = false }) => {
    const H = globalThis.__tk;
    const m = game.messages.get(messageId);
    const li = host ? document.querySelector("#qa-card-copy > *") : document.querySelector(`[data-message-id='${messageId}']`);
    const flag = m?.flags?.["acks-extras"]?.treasureSearch ?? null;
    const slot = li?.querySelector("[data-field='deal']");
    const block = slot?.querySelector(".acks-extras-treasure-search__deal");
    const select = block?.querySelector("[data-deal-arms]");
    const pressedOf = (sel) => block?.querySelector(sel)?.getAttribute("aria-pressed") === "true";
    const offOf = (sel) => !!block?.querySelector(sel)?.disabled;
    const reason = block?.querySelector(".acks-extras-treasure__reason");
    const ids = [...(li?.querySelectorAll("[id]") ?? [])].map((e) => e.id);
    return {
      inCollection: !!m,
      rendered: !!li,
      block: !!block,
      deal: flag?.deal ? { style: flag.deal.style, special: flag.deal.special, metInLair: flag.deal.metInLair, armsSetting: flag.deal.armsSetting } : null,
      opened: flag?.opened === true,
      aboveSearch: !!slot && !!li.querySelector("[data-action='searchScene']") && !!(slot.compareDocumentPosition(li.querySelector("[data-action='searchScene']")) & Node.DOCUMENT_POSITION_FOLLOWING),
      styles: [...(block?.querySelectorAll("[data-action='dealStyle']") ?? [])].map((b) => ({ style: b.dataset.style, pressed: b.getAttribute("aria-pressed") === "true", off: b.disabled })),
      arms: select ? { off: select.disabled, options: select.options.length, labelled: !!block.querySelector(`label[for='${select.id}']`) } : null,
      special: { pressed: pressedOf("[data-action='dealSpecial']"), off: offOf("[data-action='dealSpecial']") },
      lair: { pressed: pressedOf("[data-action='dealLair']"), off: offOf("[data-action='dealLair']") },
      tables: !!block?.querySelector("[data-action='dealTables']"),
      controls: block?.querySelectorAll("button, select").length ?? 0,
      reason: H.text(reason),
      reasonTip: reason?.getAttribute("data-tooltip-text") ?? null,
      ids,
      focused: block?.contains(document.activeElement) ? `${document.activeElement.dataset.action ?? "select"}:${document.activeElement.dataset.style ?? ""}` : null,
      rows: [...(li?.querySelectorAll(".acks-extras-treasure-search__list > li") ?? [])].map((r) => ({
        name: H.text(r.querySelector(".acks-extras-treasure-search__name")),
        letter: !!r.querySelector(".acks-extras-treasure-search__letter"),
        chip: !!r.querySelector("[data-action='openTable']"),
        chipOff: !!r.querySelector("[data-action='openTable']")?.disabled,
        sheet: !!r.querySelector("[data-action='openSheet']"),
      })),
    };
  },
  /** Wait until the card's `deal` holds `value` at `key`, then let the card draw itself again. */
  waitDeal: async ({ messageId, key, value }) => {
    const H = globalThis.__tk;
    const ok = await H.poll(() => (game.messages.get(messageId)?.flags?.["acks-extras"]?.treasureSearch?.deal?.[key] === value ? true : null), { tries: 40, every: 200 });
    await H.sleep(700);
    return { met: !!ok };
  },
  /** Change the arms select to its first option other than the current one that names a column, and answer how many options it has. */
  chooseArms: async ({ messageId }) => {
    const sel = document.querySelector(`[data-message-id='${messageId}'] [data-deal-arms]`);
    if (!sel) return { found: false };
    const pick = [...sel.options].find((o) => o.value && o.value !== sel.value);
    if (!pick) return { found: true, options: sel.options.length, chose: false };
    sel.value = pick.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { found: true, options: sel.options.length, chose: true, key: pick.value };
  },
  /** The seed a new pot starts with on this seat. */
  seed: async () => {
    const X = globalThis.__td;
    return X.potLogic.seedDeal({ armsSetting: game.user.getFlag("acks-extras", "treasureArms") ?? "" });
  },
  /** Write one value into the card's flag, as the walk's own scripted edit. */
  setFlag: async ({ messageId, path, value, strip = false }) => {
    const m = game.messages.get(messageId);
    await m.update(strip ? { [`flags.acks-extras.treasureSearch.-=${path}`]: null } : { [`flags.acks-extras.treasureSearch.${path}`]: value });
    await globalThis.__tk.sleep(900);
    return { deal: m.flags?.["acks-extras"]?.treasureSearch?.deal ?? null };
  },
  /** The card's first fallen entry's table, and the fallen list, so a table that is gone can be named in its place. */
  /** The Ruledata Browser a Treasure tables press opens: how many windows, and whether only the treasure group is open. */
  browserState: async () => {
    const H = globalThis.__tk;
    await H.poll(() => { const a = [...foundry.applications.instances.values()].find((x) => x.constructor.name === "RuledataBrowser"); return a?.rendered && H.root(a)?.querySelector("details[data-group]") ? true : null; }, { tries: 40, every: 250 });
    await H.sleep(500);
    const apps = [...foundry.applications.instances.values()].filter((x) => x.constructor.name === "RuledataBrowser");
    const groups = [...(H.root(apps[0])?.querySelectorAll("details[data-group]") ?? [])];
    const treasure = groups.find((d) => d.dataset.group === "treasure");
    return { windows: apps.length, treasureOpen: !!treasure?.open, othersClosed: groups.filter((d) => !["treasure", "magicItemTables"].includes(d.dataset.group)).every((d) => !d.open) };
  },
  closeBrowser: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.constructor.name === "RuledataBrowser") { try { await app.close({ animate: false }); } catch { /* closed */ } }
    return true;
  },
  /** Point a monster's linked table at a table, as its sheet's field does. */
  linkTable: async ({ actorId, tableUuid }) => {
    await game.actors.get(actorId).update({ "system.details.treasure.table": `@UUID[${tableUuid}]` });
    return true;
  },
  /** A write that changes nothing the card draws, so the log draws the card again. */
  touch: async ({ messageId }) => {
    await game.messages.get(messageId).update({ "flags.world.qaTouch": Date.now() });
    await globalThis.__tk.sleep(900);
    return true;
  },
  /** A second copy of the card, drawn by the message's own render into the page, with the module's render hook run. */
  copyCard: async ({ messageId }) => {
    const H = globalThis.__tk;
    const m = game.messages.get(messageId);
    if (typeof m?.renderHTML !== "function") return { supported: false };
    document.querySelector("#qa-card-copy")?.remove();
    const html = await m.renderHTML();
    const host = document.createElement("div");
    host.id = "qa-card-copy";
    host.style.cssText = "position:fixed;left:-9999px;top:0;width:360px";
    host.append(html);
    document.body.append(host);
    await H.poll(() => host.querySelector("[data-field='deal'] .acks-extras-treasure-search__deal"), { tries: 30, every: 200 });
    return { supported: true };
  },
  /** Press one style button in the second copy, scripted, and wait for the one flag to hold it. */
  pressCopy: async ({ messageId, style }) => {
    const H = globalThis.__tk;
    const btn = document.querySelector(`#qa-card-copy [data-action='dealStyle'][data-style='${style}']`);
    if (!btn) return { found: false };
    btn.click();
    const ok = await H.poll(() => (game.messages.get(messageId)?.flags?.["acks-extras"]?.treasureSearch?.deal?.style === style ? true : null), { tries: 40, every: 200 });
    await H.sleep(900);
    return { found: true, wrote: !!ok };
  },
  dropCopy: async () => { document.querySelector("#qa-card-copy")?.remove(); return true; },
  /** The seat's own answers about the card: whether it may update it, whether the log shows it, and what a render of it draws. */
  seatView: async ({ messageId }) => {
    const m = game.messages.get(messageId);
    let drawn = null;
    let threw = null;
    if (m && typeof m.renderHTML === "function") {
      try {
        const html = await m.renderHTML();
        const host = document.createElement("div");
        host.append(html);
        await globalThis.__tk.sleep(900);
        drawn = !!host.querySelector(".acks-extras-treasure-search__deal");
      } catch (err) {
        threw = String(err?.message ?? err).slice(0, 80);
      }
    }
    return { inCollection: !!m, modify: m ? m.canUserModify(game.user, "update") : null, visible: m ? !!m.visible : null, inLog: !!document.querySelector(`[data-message-id='${messageId}']`), drawn, threw };
  },
  /** Press state of the table chip's window: the RollTable sheet that opened. */
  tableSheet: async ({ tableId }) => {
    const H = globalThis.__tk;
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => a.rendered && a.document?.documentName === "RollTable" && a.document.id === tableId) ?? null, { tries: 40, every: 200 });
    if (app) { H.opened.push(app); }
    return { opened: !!app };
  },
  waitChipOff: async ({ messageId }) => {
    const ok = await globalThis.__tk.poll(() => (document.querySelector(`[data-message-id='${messageId}'] [data-action='openTable']`)?.disabled === true ? true : null), { tries: 40, every: 200 });
    return { met: !!ok };
  },

  /* ---- The session and its pot ------------------------------------------- */
  session: async ({ partyId }) => {
    const f = game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") ?? null;
    return f ? { open: true, potUuid: f.potUuid ?? null, recordMessageId: f.recordMessageId ?? null } : { open: false };
  },
  waitSession: async ({ partyId, open = true, tries = 80 }) => !!(await globalThis.__tk.poll(() => (!!game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") === open ? true : null), { tries, every: 250 })),
  waitPot: async ({ potUuid }) => {
    const ok = await globalThis.__tk.poll(async () => ((await fromUuid(potUuid))?.getFlag("acks-extras", "treasure")?.phase === "open" ? true : null), { tries: 60, every: 250 });
    return { met: !!ok };
  },
  /** The pot's deal flag, and its magic cards counted as rolled (a name apart from the face) and as left placeholders. */
  potDeal: async ({ potUuid }) => {
    const X = globalThis.__td;
    const pile = await fromUuid(potUuid);
    if (!pile) return null;
    const flag = pile.getFlag("acks-extras", "treasure") ?? {};
    const truths = X.pot.viewOf(pile).cards.map((c) => c.truth);
    const magic = truths.filter((x) => x.pool === "magic");
    const rolled = magic.filter((x) => !!x.mask?.name && x.label !== x.mask.name);
    return {
      phase: flag.phase ?? null,
      deal: flag.deal ? { style: flag.deal.style, special: flag.deal.special, metInLair: flag.deal.metInLair, armsSetting: flag.deal.armsSetting } : null,
      cards: truths.length,
      magic: magic.length,
      rolled: rolled.length,
      placeholders: magic.length - rolled.length,
    };
  },
  endSession: async ({ fid }) => { const r = await acksExtras.sceneSearch.end(fid); return { ok: r.ok === true }; },
  closeScreen: async ({ fid }) => { const app = globalThis.__td?.win(fid); if (app) await app.close({ animate: false }); return !globalThis.__td?.win(fid); },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
let gm = null;
let player = null;
const made = [];
let ids = null;
let viewedNeeded = false;
/** What the steps share: fixture ids, the cards, and the reason the walk cannot go on (null while it can). */
const ctx = { dead: null };
watchdog(() => [gm, player], Number(process.env.WALK_WALL_MS ?? 1_200_000));

const skip = (label, why) => console.log(`SKIP  ${label}  ${why}`);
/** One step in its own try: a throw is a failed check and leaves the next step running. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name}: ran to its end without throwing`, false, String(err?.message ?? err).slice(0, 200));
  }
}
const trackMessage = (id) => { if (id) made.push(gm.track(id, "ChatMessage")); };
/** Claim every chat card this GM client made since `since` (all carry the run's nonce); they are tracked for the sweep. */
async function claim(since) {
  for (const id of await run(gm, P.made, { since })) trackMessage(id);
}

/** Make a fight on the walk's scene with these bodies and begin it by the tracker's own button. */
async function fight({ label, bodies, partyToken, sceneId }) {
  const toks = {};
  for (const [key, spec] of Object.entries(bodies)) {
    const tok = await gm.create("Token", { name: spec.name, actorId: spec.actorId, actorLink: false, x: spec.x, y: spec.y, disposition: -1 }, { parent: `Scene.${sceneId}` });
    made.push(tok.uuid);
    toks[key] = tok;
  }
  const combat = await gm.create("Combat", { scene: sceneId, active: false });
  made.push(combat.uuid);
  const combatId = idOf(combat);
  const rows = {};
  const row0 = await gm.create("Combatant", { tokenId: partyToken.tokenId, sceneId, actorId: partyToken.actorId }, { parent: combat.uuid });
  made.push(row0.uuid);
  for (const key of Object.keys(bodies)) {
    const row = await gm.create("Combatant", { tokenId: idOf(toks[key]), sceneId, actorId: bodies[key].actorId }, { parent: combat.uuid });
    made.push(row.uuid);
    rows[key] = idOf(row);
  }
  await run(gm, P.showChat);
  let view = await run(gm, P.view, { combatId });
  if (view.viewed !== combatId) {
    view = await run(gm, P.view, { combatId, viewScene: sceneId });
    viewedNeeded = true;
  }
  if (view.viewed !== combatId) throw new Error(`${label}: the tracker does not show this run's combat`);
  const begin = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='startCombat'], .combat-tracker [data-action='startCombat']" }, "Begin Combat");
  let started = await run(gm, P.startFight, { combatId });
  for (let n = 0; n < 16 && !started.started; n++) { await sleep(250); started = await run(gm, P.startFight, { combatId }); }
  if (!started.started) {
    note(`${label}: Begin Combat did not start the combat (a press was found: ${begin.found}); the round is written instead`, begin);
    started = await run(gm, P.startFight, { combatId, start: "update" });
  }
  return { combatId, rows, started };
}

/** Knock the bodies down, end the combat with the tracker's End Combat and its confirm, and find the card the real hook posts. */
async function endFight({ label, f, how, sceneId }) {
  for (const [key, h] of Object.entries(how)) await run(gm, P.defeat, { combatId: f.combatId, combatantId: f.rows[key], how: h });
  await run(gm, P.showChat);
  const viewed = await run(gm, P.view, { combatId: f.combatId, viewScene: viewedNeeded ? sceneId : null });
  if (viewed.viewed !== f.combatId || !viewed.endButton) throw new Error(`${label}: the tracker does not show this run's combat with an End Combat button`);
  const endPress = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='endCombat'], .combat-tracker [data-action='endCombat']" }, "End Combat");
  let yes = { found: false };
  if (endPress.found) {
    await sleep(600);
    yes = await press(gm, PORTS.gm, { scope: "doc", sel: "dialog [data-action='yes'], .application.dialog [data-action='yes']" }, "End Combat's confirm");
  }
  const gone = await run(gm, P.combatGone, { combatId: f.combatId });
  await run(gm, P.showChat);
  const card = await run(gm, P.findCard, { combatId: f.combatId });
  if (card.id) trackMessage(card.id);
  return { cardId: card.id, cards: card.count, ended: endPress.found && yes.found && gone };
}

/** Press a card's Search the scene with the die held until the session opens, and read the notices and the session. */
async function pressSearch({ cardId, partyId }) {
  await run(gm, KIT.takeNotes);
  const since = await run(gm, P.nowMs);
  await run(gm, P.showChat);
  await run(gm, P.rig, { die: FLOOR });
  let pressed;
  try {
    pressed = await press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${cardId}'] [data-action='searchScene']` }, "the card's Search the scene");
    const opened = await run(gm, P.waitSession, { partyId, open: true });
    if (opened) await sleep(1500);
  } finally {
    await run(gm, P.unrig);
  }
  const notes = await run(gm, KIT.takeNotes);
  const session = await run(gm, P.session, { partyId });
  if (session.potUuid) made.push(gm.track(session.potUuid, "Cards"));
  const pot = session.potUuid ? (await run(gm, P.waitPot, { potUuid: session.potUuid }), await run(gm, P.potDeal, { potUuid: session.potUuid })) : null;
  await claim(since);
  return { pressed, notes, session, pot };
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|session|screen|treasure|search|pot-sheet|ways-in|formation|search-deal/i });
  const setG = await run(gm, P.setup, { nonce: NONCE });
  const setP = await run(player, P.setup, { nonce: NONCE });
  if (!setG.api || !setP.api) blocked("acksExtras.sceneSearch.searchHere is not on both seats: the card's Search the scene is not in the loaded tree");
  if (!setG.primary) blocked("the GM seat's client is not the primary GM (isPrimaryGM is false): its deleteCombat hook would not record the fight");
  check("the ways in are on both seats and the GM seat is the primary GM", setG.api && setP.api && setG.primary, { gm: setG, player: setP });
  const tt = (key, data) => t(gm, key, data);

  /* ================= Fixtures ================= */
  await step("Fixtures", async () => {
    section("fixtures");
    ctx.dead = "the fixtures were not built";
    const playerId = await run(gm, P.userId, { name: MACHINE.player });
    const picked = await run(gm, P.pickLetters);
    if (!picked.imported) { ctx.dead = "the world's treasure registry is not imported, so no letter deals and a press would open no pot"; return skip("every step", ctx.dead); }
    const style = picked.magic.heroic ? "heroic" : "classic";
    const LETTER = picked.magic[style] ?? picked.any;
    if (!LETTER) { ctx.dead = "no treasure type in the imported classic table deals a card under a floor die"; return skip("every step", ctx.dead); }
    ctx.picked = picked;
    ctx.magic = !!picked.magic[style];
    ctx.style = style;
    note("what the world offers (imported tables, a magic letter for the chosen style, arms columns)", { magic: ctx.magic, style, starts: picked.starts, columns: picked.columns });
    const character = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 }, details: { level: 1 } } });
    const monster = (name, items) => ({ name, type: "monster", items, prototypeToken: { actorLink: false, disposition: -1 } });
    const scene = await gm.fixture(MARKS.scene, "Scene", { name: NAMES.scene, active: false, width: 3000, height: 1500, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
    const party = await gm.fixture(MARKS.party, "Actor", { name: NAMES.party, type: "acks-extras.party", ownership: { default: 0, [playerId]: 3 } });
    const owner = await gm.fixture(MARKS.owner, "Actor", { ...character(NAMES.owner), ownership: { default: 0, [playerId]: 3 } });
    const mate = await gm.fixture(MARKS.mate, "Actor", { ...character(NAMES.mate), ownership: { default: 0 } });
    const place = await gm.fixture(MARKS.place, "Actor", { name: NAMES.place, type: "acks-extras.location" });
    const hostile = await gm.fixture(MARKS.hostile, "Actor", monster(NAMES.hostile, GOODS));
    const hostile2 = await gm.fixture(MARKS.hostile2, "Actor", monster(NAMES.hostile2, []));
    const table = await gm.fixture(MARKS.table, "RollTable", { name: NAMES.table, formula: "1d1", replacement: true });
    const sceneId = idOf(scene);
    await run(gm, P.shapeScene, { sceneId });
    const actorIds = { party: idOf(party), owner: idOf(owner), mate: idOf(mate), hostile: idOf(hostile), hostile2: idOf(hostile2) };
    const tableUuid = table.uuid ?? `RollTable.${idOf(table)}`;
    const { fid, error } = await run(gm, P.formationOf, { partyId: actorIds.party });
    if (error) { ctx.dead = error; return skip("every step", ctx.dead); }
    ids = { fid, partyId: actorIds.party };
    await run(gm, P.endSession, { fid }).catch(() => null);
    const shaped = await run(gm, P.shapeActors, { ids: actorIds, playerId, letter: LETTER, tableUuid, goods: GOODS });
    const shapedTable = await run(gm, P.shapeTable, { tableId: idOf(table), textName: NAMES.tableText });
    const placed = await run(gm, P.shapePlace, { placeId: idOf(place) });
    const shape = await run(gm, P.startShape, { fid, partyId: actorIds.party, sceneId, members: [actorIds.owner, actorIds.mate], at: ORIGIN });
    if (shape.fight) { ctx.dead = "a combat holds the walk's party or its members; it is another session's and is not swept here"; return skip("every step", ctx.dead); }
    const where = await run(gm, P.centre, { fid });
    if (!where.token || where.sceneId !== sceneId) { ctx.dead = "the party token is not on the walk's scene"; return skip("every step", ctx.dead); }
    const rect = { x: where.cx - 300, y: where.cy - 200, width: 600, height: 400 };
    const region = await gm.fixture(MARKS.region, "Region", { name: NAMES.region, color: "#336699", shapes: [{ type: "rectangle", ...rect, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
    const regionShape = await run(gm, P.shapeRegion, { uuid: region.uuid, rect });
    const linked = await run(gm, P.linkPlace, { regionUuid: region.uuid, placeId: idOf(place) });
    const at0 = await run(gm, P.placesAt, { fid });
    check(
      "the kept fixtures stand in shape: the hostile's letter and goods, the other's linked table with no letter, the table's one result, the Region linked to the place with its floor, the party holding both characters (the Player seat owns the party and one character) with its token inside the Region and no plan or session",
      !shaped.dup && shaped.goodsHeld && shaped.letterSet && shaped.linked && shaped.ownerOwns && !shaped.mateOwns && shaped.partyOwns && shapedTable.ok && placed.type === "acks-extras.location" && placed.things.join() === "floor-1"
        && regionShape.shapes === 1 && regionShape.behaviors === 0 && linked.linked && shape.members.length === 2 && shape.sceneId === sceneId && shape.token && !shape.plan && !shape.session && at0.token && at0.places === 1,
      { shaped: { dup: shaped.dup, goods: shaped.goodsHeld, letter: shaped.letterSet, linked: shaped.linked }, table: shapedTable.ok, region: regionShape, linked: linked.linked, shape: { members: shape.members.length, token: shape.token }, places: at0.places },
    );
    ctx.sceneId = sceneId;
    ctx.partyToken = { tokenId: shape.tokenId, actorId: shape.tokenActorId };
    ctx.actorIds = actorIds;
    ctx.tableId = idOf(table);
    ctx.tableUuid = tableUuid;
    ctx.dead = null;
  });

  const bodiesOf = (...keys) => Object.fromEntries(keys.map((k, n) => [k, { name: k === "a" ? NAMES.hostile : NAMES.hostile2, actorId: k === "a" ? ctx.actorIds.hostile : ctx.actorIds.hostile2, x: 1000 + n * 200, y: 400 }]));
  const dealOf = (c) => JSON.stringify(c.deal ?? null);

  /* ================= Fight A: a card with a letter and a table ================= */
  await step("Steps 1, 4 and 6 (card A)", async () => {
    if (ctx.dead) return skip("card A", ctx.dead);
    section("Step 1. the card's Deal block (a letter and a table)");
    const fA = await fight({ label: "fight A", bodies: bodiesOf("a", "b"), partyToken: ctx.partyToken, sceneId: ctx.sceneId });
    const eA = await endFight({ label: "fight A", f: fA, how: { a: "toggle", b: "hp" }, sceneId: ctx.sceneId });
    ctx.cardA = eA.cardId;
    check("End Combat and its confirm were pressed, the combat is gone and the real hook posted one card on the Judge seat", eA.ended && !!eA.cardId && eA.cards === 1, { ended: eA.ended, cards: eA.cards });
    if (!eA.cardId) throw new Error("no card was posted");
    const seed = await run(gm, P.seed);
    const v0 = await run(gm, P.cardView, { messageId: eA.cardId });
    const dealIsSeed = dealOf(v0) === JSON.stringify(seed);
    check(
      "the card shows Deal above Search the scene: three Table style buttons with the seed's pressed, an arms select with its label, Special treasure and Met in their lair as the seed has them, and a Treasure tables button; the card's flag holds the seed",
      v0.rendered && v0.block && v0.aboveSearch && v0.styles.length === 3 && v0.styles.filter((s) => s.pressed).length === 1 && v0.styles.find((s) => s.pressed)?.style === seed.style && v0.styles.every((s) => !s.off)
        && !!v0.arms && !v0.arms.off && v0.arms.labelled && v0.special.pressed === seed.special && v0.lair.pressed === seed.metInLair && !v0.special.off && !v0.lair.off && v0.tables && dealIsSeed,
      { block: v0.block, above: v0.aboveSearch, styles: v0.styles.length, arms: v0.arms, tables: v0.tables, seed: dealIsSeed },
    );
    const pressOn = (sel, label) => press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${eA.cardId}'] ${sel}` }, label);
    const tablesPress = await pressOn("[data-action='dealTables']", "Treasure tables");
    const browser = await run(gm, P.browserState);
    check("the card's Treasure tables button opens the Ruledata Browser, one window, on the treasure group with every other group collapsed", tablesPress.found && !tablesPress.disabled && browser.windows === 1 && browser.treasureOpen && browser.othersClosed, browser);
    await run(gm, P.closeBrowser);
    await run(gm, P.showChat);
    const heroic = await pressOn("[data-action='dealStyle'][data-style='heroic']", "Heroic");
    const w1 = await run(gm, P.waitDeal, { messageId: eA.cardId, key: "style", value: "heroic" });
    const v1 = await run(gm, P.cardView, { messageId: eA.cardId });
    check("a real press of Heroic writes style to the card's flag, the card draws it pressed and the control keeps focus", heroic.found && w1.met && v1.deal?.style === "heroic" && v1.styles.find((s) => s.pressed)?.style === "heroic" && v1.focused === "dealStyle:heroic", { found: heroic.found, real: heroic.real, wrote: w1.met, focused: v1.focused });
    const special = await pressOn("[data-action='dealSpecial']", "Special treasure");
    const w2 = await run(gm, P.waitDeal, { messageId: eA.cardId, key: "special", value: !seed.special });
    const lair = await pressOn("[data-action='dealLair']", "Met in their lair");
    const w3 = await run(gm, P.waitDeal, { messageId: eA.cardId, key: "metInLair", value: !seed.metInLair });
    const v2 = await run(gm, P.cardView, { messageId: eA.cardId });
    check("real presses of Special treasure and Met in their lair write each to the flag, and the card draws both toggles as the flag holds them", special.found && lair.found && w2.met && w3.met && v2.deal.special === !seed.special && v2.deal.metInLair === !seed.metInLair && v2.special.pressed === v2.deal.special && v2.lair.pressed === v2.deal.metInLair, { special: w2.met, lair: w3.met });
    if (ctx.style !== "heroic") {
      const back = await pressOn(`[data-action='dealStyle'][data-style='${ctx.style}']`, `the ${ctx.style} style`);
      await run(gm, P.waitDeal, { messageId: eA.cardId, key: "style", value: ctx.style });
      note("the style the search deals on is the one whose imported tables deal a magic letter", { pressed: back.found });
    }
    let armsKey = null;
    if (ctx.picked.columns > 0) {
      const arms = await run(gm, P.chooseArms, { messageId: eA.cardId });
      if (arms.chose) {
        const w4 = await run(gm, P.waitDeal, { messageId: eA.cardId, key: "armsSetting", value: arms.key });
        const v3 = await run(gm, P.cardView, { messageId: eA.cardId });
        armsKey = arms.key;
        check("changing the arms select writes the chosen column to the card's flag, and the select draws it chosen", arms.found && w4.met && v3.deal.armsSetting === arms.key, { options: arms.options, wrote: w4.met });
      } else skip("step 1 arms column", `the select offers no column to change to (${arms.options} options)`);
    } else skip("step 1 arms column", "no arms-and-armor grid is imported, so the select offers no column");
    ctx.armsKey = armsKey;
    // A second copy of the card: its ids are its own, and a press in it writes the one flag.
    const copy = await run(gm, P.copyCard, { messageId: eA.cardId });
    if (!copy.supported) skip("step 1 second copy", "ChatMessage#renderHTML is not on this build");
    else {
      const logView = await run(gm, P.cardView, { messageId: eA.cardId });
      const copyView = await run(gm, P.cardView, { messageId: eA.cardId, host: true });
      check("a second copy of the card draws the block from the same flag with ids of its own, none shared with the log's copy", copyView.block && dealOf(copyView) === dealOf(logView) && copyView.ids.length > 0 && copyView.ids.every((i) => !logView.ids.includes(i)), { block: copyView.block, ids: copyView.ids.length, shared: copyView.ids.filter((i) => logView.ids.includes(i)).length });
      const other = ctx.style === "gritty" ? "classic" : "gritty";
      const pc = await run(gm, P.pressCopy, { messageId: eA.cardId, style: other });
      const afterLog = await run(gm, P.cardView, { messageId: eA.cardId });
      check("a press in the second copy writes the one flag, and the log's copy draws it", pc.found && pc.wrote && afterLog.deal?.style === other && afterLog.styles.find((s) => s.pressed)?.style === other, { found: pc.found, wrote: pc.wrote });
      await run(gm, P.dropCopy);
      const restore = await pressOn(`[data-action='dealStyle'][data-style='${ctx.style}']`, `the ${ctx.style} style again`);
      const w5 = await run(gm, P.waitDeal, { messageId: eA.cardId, key: "style", value: ctx.style });
      check("the chosen style is pressed again from the log's copy", restore.found && w5.met, { wrote: w5.met });
    }
    ctx.chosen = (await run(gm, P.cardView, { messageId: eA.cardId })).deal;

    section("Step 4. the Player seat");
    const seat = await run(player, P.seatView, { messageId: eA.cardId });
    check("the Player seat may not update the card, its log shows none, and a render of it draws no Deal block", seat.modify !== true && !seat.visible && !seat.inLog && seat.drawn !== true, seat);
    const gmSeat = await run(gm, P.seatView, { messageId: eA.cardId });
    check("the Judge seat may update the card", gmSeat.modify === true, { modify: gmSeat.modify });

    section("Step 6. the Table chip");
    const rows = (await run(gm, P.cardView, { messageId: eA.cardId })).rows;
    const rowB = rows.find((r) => r.name === NAMES.hostile2);
    check("the body with a linked table draws a Table chip that is an enabled button, and the body with a letter draws none", !!rowB && rowB.chip && !rowB.chipOff && rows.find((r) => r.name === NAMES.hostile)?.chip === false, { rows: rows.length });
    const chip = await press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${eA.cardId}'] [data-action='openTable']` }, "the Table chip");
    const sheet = await run(gm, P.tableSheet, { tableId: ctx.tableId });
    check("pressing the Table chip opens the linked RollTable's sheet", chip.found && !chip.disabled && sheet.opened, { found: chip.found, real: chip.real, opened: sheet.opened });
    await run(gm, KIT.closeAll);
  });

  /* ================= Fight C: a card with no treasure type ================= */
  await step("Steps 5 and 6 (card C: no treasure type)", async () => {
    if (ctx.dead) return skip("card C", ctx.dead);
    section("Step 5. a card whose bodies carry no treasure type");
    const own = await gm.create("RollTable", { name: NAMES.gone, formula: "1d1", replacement: true });
    made.push(own.uuid);
    ctx.ownTable = own.uuid;
    ctx.relink = true;
    await run(gm, P.linkTable, { actorId: ctx.actorIds.hostile2, tableUuid: own.uuid });
    const fC = await fight({ label: "fight C", bodies: bodiesOf("b"), partyToken: ctx.partyToken, sceneId: ctx.sceneId });
    const eC = await endFight({ label: "fight C", f: fC, how: { b: "toggle" }, sceneId: ctx.sceneId });
    ctx.cardC = eC.cardId;
    if (!eC.cardId) throw new Error("no card was posted for the body with no letter");
    const v = await run(gm, P.cardView, { messageId: eC.cardId });
    const expReason = await tt("search.deal.noType");
    check(
      "every control of the block is disabled (the three style buttons, the arms select, Special treasure, Met in their lair) under the visible reason, whose tooltip is the page reference",
      v.block && v.styles.length === 3 && v.styles.every((s) => s.off) && !!v.arms && v.arms.off && v.special.off && v.lair.off && v.reason === expReason && !!v.reasonTip,
      { styles: v.styles.map((s) => s.off), arms: v.arms?.off, special: v.special.off, lair: v.lair.off, reason: v.reason === expReason },
    );
    const row = v.rows.find((r) => r.name === NAMES.hostile2);
    check("the body with no letter keeps the sheet button after its name", !!row && row.sheet && !row.letter, { sheet: row?.sheet });
    // A table that is gone: the card names it as it stood when the card was posted, so the body links a table this run makes, and the run deletes it by its own id once the card is posted.
    const chipBefore = v.rows.find((r) => r.name === NAMES.hostile2);
    check("while its table stands the body's Table chip is an enabled button", !!chipBefore && chipBefore.chip && !chipBefore.chipOff, { chip: chipBefore?.chip, off: chipBefore?.chipOff });
    const swept = await gm.sweepTracked({ only: [ctx.ownTable] });
    await run(gm, P.touch, { messageId: eC.cardId });
    const off = await run(gm, P.waitChipOff, { messageId: eC.cardId });
    check("once the table is deleted and the card draws itself again, its Table chip is disabled", swept.removed.length === 1 && off.met, { removed: swept.removed.length, disabled: off.met });
    await run(gm, P.linkTable, { actorId: ctx.actorIds.hostile2, tableUuid: ctx.tableUuid });
    ctx.relink = false;
  });

  /* ================= Search A: the card's choices reach the pot and its magic is rolled ================= */
  await step("Steps 2 and 3 (card A pressed)", async () => {
    if (ctx.dead || !ctx.cardA) return skip("Search the scene on card A", ctx.dead ?? "card A was not posted");
    section("Step 2. Search the scene on the card's choices");
    const before = await run(gm, P.cardView, { messageId: ctx.cardA });
    const r = await pressSearch({ cardId: ctx.cardA, partyId: ids.partyId });
    check("the press opened a scene search for the party, naming this card and a pot", r.pressed.found && r.session.open && r.session.recordMessageId === ctx.cardA && !!r.session.potUuid && r.pot?.phase === "open", { found: r.pressed.found, session: r.session.open, pot: !!r.session.potUuid, phase: r.pot?.phase });
    const want = before.deal;
    check("the pot's own flag carries the card's four choices exactly", !!r.pot?.deal && JSON.stringify(r.pot.deal) === JSON.stringify(want), { style: r.pot?.deal?.style === want?.style, special: r.pot?.deal?.special === want?.special, lair: r.pot?.deal?.metInLair === want?.metInLair, arms: r.pot?.deal?.armsSetting === want?.armsSetting });
    const lairWarn = `${await tt("deal.warn.label")}: ${await tt("deal.warn.body", { toggle: await tt("deal.lair") })}`;
    check("with Met in their lair on no lair warning was shown to the Judge", want?.metInLair === true && !r.notes.warns.includes(lairWarn), { metInLair: want?.metInLair, warns: r.notes.warns.length });
    if (!ctx.magic) skip("step 2 rolled magic", "no magic-item list answers to a placeholder of any imported treasure type, so the world imports no magic tables the roll could use");
    else check("the pot holds rolled magic cards, the magic placeholders of the letter's deal rolled on the imported lists (the haul passes the pot's magic roll)", r.pot.magic > 0 && r.pot.rolled > 0, { magic: r.pot.magic, rolled: r.pot.rolled, placeholders: r.pot.placeholders, arms: !!want?.armsSetting });

    section("Step 3. the pressed card");
    await run(gm, P.showChat);
    const after = await run(gm, P.cardView, { messageId: ctx.cardA });
    const openText = await tt("search.deal.open");
    const openTip = await tt("search.deal.openTip");
    check("the pressed card's block is its reason line alone, with the reason's tooltip, and holds no control", after.opened && after.block && after.controls === 0 && after.reason === openText && after.reasonTip === openTip, { opened: after.opened, controls: after.controls, reason: after.reason === openText, tip: after.reasonTip === openTip });
    await run(gm, P.endSession, { fid: ids.fid });
    await run(gm, P.closeScreen, { fid: ids.fid });
  });

  /* ================= Fight B: a card posted without its choices ================= */
  await step("Steps 2 and 5 (card B: no recorded choices, lair off)", async () => {
    if (ctx.dead) return skip("card B", ctx.dead);
    section("Step 2 again. a card with no recorded choices, Met in their lair off");
    const fB = await fight({ label: "fight B", bodies: bodiesOf("a"), partyToken: ctx.partyToken, sceneId: ctx.sceneId });
    const eB = await endFight({ label: "fight B", f: fB, how: { a: "toggle" }, sceneId: ctx.sceneId });
    if (!eB.cardId) throw new Error("no card was posted");
    const seed = await run(gm, P.seed);
    const stripped = await run(gm, P.setFlag, { messageId: eB.cardId, path: "deal", strip: true });
    const v = await run(gm, P.cardView, { messageId: eB.cardId });
    check("a card whose `deal` is stripped (as one posted before the block) draws the block from the seed", stripped.deal === null && v.block && v.styles.find((s) => s.pressed)?.style === seed.style && v.special.pressed === seed.special && v.lair.pressed === seed.metInLair && v.controls > 0 && !v.styles.some((s) => s.off), { stripped: stripped.deal === null, block: v.block });
    const r = await pressSearch({ cardId: eB.cardId, partyId: ids.partyId });
    const seedPot = r.pot?.deal;
    check("the press asked for no choices: the pot carries the seed's style, special treasure and lair, and it opened", r.pressed.found && r.pot?.phase === "open" && !!seedPot && seedPot.style === seed.style && seedPot.special === seed.special && seedPot.metInLair === seed.metInLair, { phase: r.pot?.phase, style: seedPot?.style === seed.style, special: seedPot?.special === seed.special, lair: seedPot?.metInLair === seed.metInLair });
    const lairWarn = `${await tt("deal.warn.label")}: ${await tt("deal.warn.body", { toggle: await tt("deal.lair") })}`;
    check("with Met in their lair off the Judge was told the lair warning as a notice, and the pot still opened", r.notes.warns.includes(lairWarn) && r.pot?.phase === "open", { warned: r.notes.warns.includes(lairWarn), warns: r.notes.warns.length });
    await run(gm, P.endSession, { fid: ids.fid });
    await run(gm, P.closeScreen, { fid: ids.fid });
  });

  section("console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, KIT.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3).map((e) => e.slice(0, 120)));
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm) await run(gm, P.unrig); } catch {}
  for (const [name, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, P.dropCopy); } catch {}
    try { await run(api, KIT.closeAll); } catch {}
    try { if (ids) await run(api, P.closeScreen, { fid: ids.fid }); } catch {}
    try { note(`restored (${name})`, await run(api, KIT.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { if (ids) await run(gm, P.endSession, { fid: ids.fid }); } catch {}
    try { if (ctx.relink) await run(gm, P.linkTable, { actorId: ctx.actorIds.hostile2, tableUuid: ctx.tableUuid }); } catch {}
    try { await claim(0); } catch {}
    try { await run(gm, P.unhook); } catch {}
    // Only the run's own ids: the tokens, the combats, the combatants, the cards, the pots and the declaration. Kept fixtures stay.
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: unique(made).filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
