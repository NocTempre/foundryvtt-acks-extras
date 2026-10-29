/**
 * Live walk, equipment hands: docs/equipment/TESTING.md steps 2b to 2e on the
 * character sheet's Equipment tab. A two-handed weapon drawn by its row control
 * takes both hand places and sheathed by it gives both back; a torch readied
 * and lit from its row burns in the hand that holds it, and sheathed keeps the
 * hand under "held for light"; a lone character's torch lights from the same
 * control onto their own flag; the mapper's quill and parchment are listed at
 * the hand places while the role is held, the role is refused with a hand
 * short, and a light is refused with the hands held. Every reading is taken off
 * the rendered tab (the badge, the places, the rows' lines) beside the loadout.
 * Machine values arrive through ./_env.mjs; nothing here names a port, a world
 * or a seat. Every figure typed into a fixture is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the character
 * `equipment/hands-probe`. Each section brings it to shape first (reset:
 * nothing drawn, no hand flags, no readied torch, the stack at six, no own
 * lights, out of every formation). The party the walk creates is a formation
 * record (a setting, not a document) and is deleted at the end; each torch the
 * walk readies is tracked and swept. Writes outside the ledger: the formation
 * record, deleted by the walk's own id.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const MARKER = "equipment/hands-probe";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    foundry: game.version,
    module: game.modules.get("acks-extras")?.version ?? null,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    users: game.users.filter((u) => u.active).length,
  }),

  install: async () => {
    const H = (globalThis.__eqh = globalThis.__eqh ?? {});
    H.MOD = "acks-extras";
    H.wear = await import("/modules/acks-extras/scripts/equipment/wear.mjs");
    H.fm = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    H.te = await import("/modules/acks-extras/scripts/formation/turn-engine.mjs");
    H.light = await import("/modules/acks-extras/scripts/lib/light.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.apps = () => [...foundry.applications.instances.values()];
    H.sheet = (actorId) => H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.opened = [];
    H.closeAll = async () => {
      let n = 0;
      for (const app of H.opened) { try { await app.close({ force: true }); n++; } catch {} }
      H.opened = [];
      if (H.warnOrig) { ui.notifications.warn = H.warnOrig; H.warnOrig = null; }
      return n;
    };
    // Every warning the module raises, so a refusal's notice can be read back.
    H.notices = [];
    if (!H.warnOrig) {
      H.warnOrig = ui.notifications.warn;
      ui.notifications.warn = function (message, ...rest) { H.notices.push(String(message)); return H.warnOrig.call(this, message, ...rest); };
    }
    H.byName = (actor, re) => actor.items.find((i) => re.test(i.name)) ?? null;
    H.torch = (actor) => actor.items.find((i) => i.getFlag(H.MOD, "readied")) ?? null;
    // The tab as the walk reads it: the badge, each hand place and its rows, the loose rows.
    H.tab = (actorId) => {
      const root = H.root(H.sheet(actorId));
      const badge = root?.querySelector(".acks-extras-frame__badge");
      if (!badge) return { rendered: false };
      const ks = [...badge.querySelectorAll(".acks-extras-frame__badge-k")].map((k) => H.text(k));
      const rowsOf = (el) => [...el.querySelectorAll(".acks-extras-frame__gear")].map((g) => ({ name: H.text(g.querySelector(".acks-extras-frame__gear-name")), line: H.text(g.querySelector(".acks-extras-frame__gear-line")) }));
      const places = {};
      for (const slot of root.querySelectorAll("[data-drop^='slot:']")) {
        places[slot.dataset.drop.slice(5)] = { rows: rowsOf(slot), cap: H.text(slot.querySelector(".acks-extras-frame__slot-cap")) || null, full: slot.classList.contains("is-full"), span: slot.classList.contains("is-span") };
      }
      return {
        rendered: true,
        badge: H.text(badge.querySelector(".acks-extras-frame__badge-v")),
        style: ks[1] ?? null,
        clause: ks[2] ?? "",
        places,
        loose: rowsOf(root.querySelector("[data-drop='loose']") ?? root).map((r) => r.name),
      };
    };
    H.model = (actor) => {
      const lo = acksExtras.equipment.getLoadout(actor);
      return {
        used: lo.handsUsed, budget: lo.handBudget, spare: lo.handsSpare, heldLights: lo.heldLights, mapping: lo.mappingHands, legal: lo.legal,
        lightsInHand: lo.lightsInHand.map((l) => ({ type: l.type, lit: l.lit })),
        kit: lo.mappingKit.map((k) => k.name),
        violations: lo.violations.filter((v) => !v.advisory).map((v) => v.type),
        hands: Object.fromEntries(actor.items.filter((i) => i.type === "weapon").map((i) => [i.getFlag(H.MOD, "readied") ? "Torch" : i.name, { eq: !!i.system?.equipped, hand: i.getFlag(H.MOD, "hand") ?? null, where: H.wear.wearLocation(actor, i, lo) }])),
        lights: (acksExtras.lib?.light?.bearerLights?.(actor) ?? []).map((l) => ({ type: l.type, lit: l.lit, mine: l.bearerId === actor.id })),
        ownLights: actor.getFlag(H.MOD, "lights") ?? null,
        stack: H.byName(actor, /torches/i)?.system?.quantity?.value ?? null,
      };
    };
    H.read = (actorId) => ({ tab: H.tab(actorId), model: H.model(game.actors.get(actorId)) });
    // Press one row control and wait for the sheet to re-render behind the write.
    H.press = async (actorId, re, action, filter = {}) => {
      const actor = game.actors.get(actorId);
      const item = typeof re === "string" ? actor.items.get(re) : H.byName(actor, re);
      const root = H.root(H.sheet(actorId));
      const btn = item && [...(root?.querySelectorAll(`[data-item-id='${item.id}'] button[data-action='${action}']`) ?? [])].find((b) => Object.entries(filter).every(([k, v]) => b.dataset[k] === v));
      if (!btn) return { found: false, item: item?.name ?? null, action };
      const before = H.tab(actorId);
      btn.click();
      await H.poll(() => { const t = H.tab(actorId); return t.rendered && JSON.stringify(t) !== JSON.stringify(before) ? true : null; }, { tries: 20, every: 150 });
      await H.sleep(600);
      return { found: true, item: item.name, action, ...H.read(actorId) };
    };
    // Re-render after a write the sheet does not watch (a formation record), then read.
    H.rerender = async (actorId) => {
      const app = H.sheet(actorId);
      if (app) { await app.render(); await H.sleep(600); }
      return H.read(actorId);
    };
    return "installed";
  },

  /** Bring the fixture to its start shape: nothing equipped, no hand flags, no readied torch, the stack at six, no own lights, out of every formation. */
  reset: async ({ actorId }) => {
    const H = globalThis.__eqh;
    const actor = game.actors.get(actorId);
    const readied = actor.items.filter((i) => i.getFlag(H.MOD, "readied"));
    if (readied.length) await actor.deleteEmbeddedDocuments("Item", readied.map((i) => i.id));
    const updates = actor.items.filter((i) => i.system?.equipped || i.getFlag(H.MOD, "hand") || i.getFlag(H.MOD, "gear")?.wornAt).map((i) => ({ _id: i.id, "system.equipped": false, [`flags.${H.MOD}.-=hand`]: null, [`flags.${H.MOD}.gear.wornAt`]: "" }));
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    const stack = H.byName(actor, /torches/i);
    if (stack && stack.system.quantity.value !== 6) await stack.update({ "system.quantity.value": 6 });
    if (actor.getFlag(H.MOD, "lights")) await actor.unsetFlag(H.MOD, "lights");
    for (const f of Object.values(H.fm.readFormations())) {
      if (f.members?.some((m) => m?.actorId === actorId)) await H.fm.removeMember(f, actorId, { restore: false });
    }
    H.notices.length = 0;
    await H.sleep(800);
    return H.model(actor);
  },

  /** Open the module's character sheet on the fixture, on its Equipment tab. */
  openSheet: async ({ actorId }) => {
    const H = globalThis.__eqh;
    const actor = game.actors.get(actorId);
    const app = new acksExtras.characterSheet.Sheet({ document: actor });
    H.opened.push(app);
    app.tabGroups.primary = "equipment";
    await app.render(true);
    const root = await H.poll(() => { const r = H.root(H.sheet(actorId)); return r?.querySelector(".acks-extras-frame__badge") ? r : null; });
    if (!root) return { rendered: false };
    if (!root.querySelector("[data-drop='slot:mainHand']")) {
      app.changeTab("equipment", "primary");
      await H.poll(() => (H.root(H.sheet(actorId))?.querySelector("[data-drop='slot:mainHand']") ? true : null));
    }
    return H.read(actorId);
  },

  press: async ({ actorId, re, action, filter }) => globalThis.__eqh.press(actorId, re ? new RegExp(re, "i") : undefined, action, filter),
  pressId: async ({ actorId, itemId, action, filter }) => globalThis.__eqh.press(actorId, itemId, action, filter),
  read: async ({ actorId }) => globalThis.__eqh.read(actorId),
  rerender: async ({ actorId }) => globalThis.__eqh.rerender(actorId),
  torchId: async ({ actorId }) => globalThis.__eqh.torch(game.actors.get(actorId))?.id ?? null,
  notices: async ({ clear = false } = {}) => { const H = globalThis.__eqh; const out = H.notices.slice(); if (clear) H.notices.length = 0; return out; },

  /** A party of one for the fixture, by the formation model. */
  joinParty: async ({ actorId }) => {
    const H = globalThis.__eqh;
    let formation = await H.fm.createFormation("QA Hands Probe Party");
    formation = await H.fm.addMember(formation, game.actors.get(actorId), null);
    await H.sleep(600);
    return formation.id;
  },
  leaveParty: async ({ actorId, formationId }) => {
    const H = globalThis.__eqh;
    const f = H.fm.readFormations()[formationId];
    if (f?.members?.some((m) => m?.actorId === actorId)) await H.fm.removeMember(foundry.utils.deepClone(f), actorId, { restore: false });
    await H.sleep(600);
    return !H.fm.readFormations()[formationId]?.members?.some((m) => m?.actorId === actorId);
  },
  deleteParty: async ({ formationId }) => {
    const H = globalThis.__eqh;
    if (H.fm.readFormations()[formationId]) await H.fm.deleteFormationRecord(formationId);
    return !H.fm.readFormations()[formationId];
  },
  /** The role, by the formation model (the party sheet's control), with or without the override. */
  toggleRole: async ({ actorId, formationId, role, override = false }) => {
    const H = globalThis.__eqh;
    H.notices.length = 0;
    const f = foundry.utils.deepClone(H.fm.readFormations()[formationId]);
    await H.fm.toggleRole(f, actorId, role, override ? { override: true } : {});
    await H.sleep(600);
    return { roles: H.fm.readFormations()[formationId]?.members?.find((m) => m.actorId === actorId)?.roles ?? [], notices: H.notices.slice(), kit: H.fm.kitInHand(actorId).length };
  },
  /** Strike a light by the party's light record without the GM override, which is the refusal path. */
  lightNoOverride: async ({ actorId, formationId, type }) => {
    const H = globalThis.__eqh;
    H.notices.length = 0;
    const f = foundry.utils.deepClone(H.fm.readFormations()[formationId]);
    await H.te.addLight(f, type, actorId);
    await H.sleep(400);
    const lights = (H.fm.readFormations()[formationId]?.lights ?? []).filter((l) => l.bearerId === actorId);
    return { lit: lights.filter((l) => l.lit).length, notices: H.notices.slice() };
  },
  removeLights: async ({ actorId, formationId }) => {
    const H = globalThis.__eqh;
    const f = foundry.utils.deepClone(H.fm.readFormations()[formationId]);
    for (const l of (f?.lights ?? []).filter((x) => x.bearerId === actorId)) await H.te.removeLight(f, l.id);
    await H.sleep(400);
    return (H.fm.readFormations()[formationId]?.lights ?? []).filter((l) => l.bearerId === actorId).length;
  },
  /** A lone character's torch from the stack, with no torch readied: a hand of its own. */
  lightAlone: async ({ actorId, type }) => {
    const H = globalThis.__eqh;
    const actor = game.actors.get(actorId);
    H.notices.length = 0;
    const rec = await H.light.addActorLight(actor, type);
    await H.sleep(600);
    const read = await H.rerender(actorId);
    return { lit: !!rec?.lit, notices: H.notices.slice(), ...read };
  },
  unlightAlone: async ({ actorId }) => {
    const H = globalThis.__eqh;
    const actor = game.actors.get(actorId);
    for (const l of H.light.actorFlagLights(actor)) await H.light.removeActorLight(actor, l.id);
    await H.sleep(600);
    return H.rerender(actorId);
  },

  closeAll: async () => globalThis.__eqh?.closeAll?.() ?? 0,
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment?.getLoadout && !!globalThis.acksExtras?.formation?.kitInHand && !!globalThis.acksExtras?.characterSheet?.Sheet`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`ready (${key}) after (s)`, await ready(api, key));
  return api;
}

const FIXTURE = {
  name: "QA Hands Probe",
  type: "character",
  items: [
    { name: "Long Bow", type: "weapon", system: { melee: false, missile: true, damage: { base: { formula: "1d6" } } } },
    { name: "Sword, Two-Handed", type: "weapon", system: { melee: true, missile: false, damage: { base: { formula: "1d10" } } } },
    { name: "Dagger", type: "weapon", system: { melee: true, missile: true, damage: { base: { formula: "1d4" } } } },
    { name: "Torches (6)", type: "item", system: { quantity: { value: 6, max: 0 }, cost: 1, weight6: 6 } },
    { name: "Quill, writing", type: "item", system: { quantity: { value: 1, max: 0 }, cost: 1 } },
    { name: "Parchment", type: "item", system: { quantity: { value: 1, max: 0 }, cost: 1 } },
  ],
};

const hands = (r) => ({ badge: r.tab?.badge, clause: r.tab?.clause, main: r.tab?.places?.mainHand?.rows?.map((x) => x.name), off: r.tab?.places?.offHand?.rows?.map((x) => x.name), used: r.model?.used, legal: r.model?.legal });
const noHandFlags = (r) => Object.values(r.model?.hands ?? {}).every((h) => !h.eq && h.hand === null && h.where !== "mainHand" && h.where !== "offHand" && h.where !== "bothHands");
const rowLines = (r, key) => (r.tab?.places?.[key]?.rows ?? []).map((x) => x.line);

let formationId = null;
let actorId = null;
try {
  const gm = await seat("gm");
  note("census (gm)", await run(gm, P.census));
  note("install (gm)", await run(gm, P.install));
  const fixture = await gm.fixture(MARKER, "Actor", FIXTURE);
  actorId = fixture.id;
  note("fixture", { marker: MARKER, id: actorId });

  section("2b. a two-handed weapon takes both hands and gives both back");
  note("reset", await run(gm, P.reset, { actorId }));
  const opened = await run(gm, P.openSheet, { actorId });
  check("the sheet opens on the Equipment tab with the hands badge and both hand places", opened.tab?.rendered && "mainHand" in (opened.tab.places ?? {}) && "offHand" in (opened.tab.places ?? {}), hands(opened));
  check("at rest the badge reads 0 / 2 with no clause and empty places", opened.tab?.badge === "0 / 2" && opened.tab.clause === "" && !opened.tab.places.mainHand.rows.length && !opened.tab.places.offHand.rows.length, hands(opened));
  const gsOn = await run(gm, P.press, { actorId, re: "two-handed", action: "toggleEquip" });
  check("drawing the two-handed sword by its row fills both places, badge 2 / 2", gsOn.found && gsOn.tab.badge === "2 / 2" && gsOn.tab.places.mainHand.span && gsOn.tab.places.mainHand.rows.some((r) => /two-handed/i.test(r.name)) && gsOn.model.hands["Sword, Two-Handed"].where === "bothHands", hands(gsOn));
  const gsOff = await run(gm, P.press, { actorId, re: "two-handed", action: "toggleEquip" });
  check("sheathing it by its row releases both: badge 0 / 2, no hand flag, empty places, no violation", gsOff.found && gsOff.tab.badge === "0 / 2" && gsOff.tab.clause === "" && !gsOff.tab.places.mainHand.rows.length && !gsOff.tab.places.offHand.rows.length && noHandFlags(gsOff) && gsOff.model.violations.length === 0, { ...hands(gsOff), hands: gsOff.model.hands });
  const dOn = await run(gm, P.press, { actorId, re: "^dagger", action: "toggleEquip" });
  const gsOver = await run(gm, P.press, { actorId, re: "two-handed", action: "toggleEquip" });
  check("with a dagger drawn, drawing the two-handed sword is resolved: the loadout stays legal within two hands", dOn.tab.badge === "1 / 2" && gsOver.found && gsOver.model.legal && gsOver.model.used <= 2 && gsOver.model.violations.length === 0, { dagger: hands(dOn), sword: hands(gsOver), hands: gsOver.model.hands });
  note("reset after 2b", await run(gm, P.reset, { actorId }));
  const clean = await run(gm, P.rerender, { actorId });
  check("after the sweep of 2b every weapon is sheathed with no hand flag and the badge reads 0 / 2", noHandFlags(clean) && clean.tab.badge === "0 / 2", hands(clean));

  section("2c. a light burns in the hand that holds it (party member)");
  formationId = await run(gm, P.joinParty, { actorId });
  note("party", formationId);
  const readied = await run(gm, P.press, { actorId, re: "^torches", action: "readyTorch" });
  let torchId = await run(gm, P.torchId, { actorId });
  if (torchId) gm.track(`Actor.${actorId}.Item.${torchId}`, "Item");
  check("Ready on the torch stack readies one torch (a weapon of its own)", readied.found && !!torchId, { torchId });
  let torchOn = await run(gm, P.read, { actorId });
  if (torchId && !torchOn.model.hands.Torch?.eq) torchOn = await run(gm, P.pressId, { actorId, itemId: torchId, action: "toggleEquip" });
  check("the torch in hand is one hand: badge 1 / 2, the torch at a hand place, no clause", torchOn.tab?.badge === "1 / 2" && torchOn.tab.clause === "" && [...torchOn.tab.places.mainHand.rows, ...torchOn.tab.places.offHand.rows].some((r) => /torch/i.test(r.name)) && torchOn.model.lightsInHand.length === 1 && !torchOn.model.lightsInHand[0].lit, hands(torchOn));
  const dagger2 = await run(gm, P.press, { actorId, re: "^dagger", action: "toggleEquip" });
  check("a dagger beside the torch makes 2 / 2 with no clause", dagger2.tab.badge === "2 / 2" && dagger2.tab.clause === "", hands(dagger2));
  const lit = await run(gm, P.pressId, { actorId, itemId: torchId, action: "lightAction", filter: { light: "light" } });
  check("Light on the torch row lights the held torch where it is: the party record burns for this bearer, the torch stays in hand, the stack is not spent, the badge stays 2 / 2 with no clause", lit.found && lit.model?.lights.some((l) => l.type === "torch" && l.lit && l.mine) && lit.tab.badge === "2 / 2" && lit.tab.clause === "" && lit.model.hands.Torch?.eq === true && lit.model.lightsInHand[0]?.lit === true && lit.model.heldLights === 0 && lit.model.stack === dagger2.model.stack, { ...hands(lit), lights: lit.model?.lights, inHand: lit.model?.lightsInHand, stack: [dagger2.model.stack, lit.model?.stack], torch: lit.model?.hands.Torch });
  const sheathedLit = await run(gm, P.pressId, { actorId, itemId: torchId, action: "toggleEquip" });
  check("sheathing the burning torch keeps the hand: badge 2 / 2 with the held-for-light clause, the torch under Carried, still burning", sheathedLit.found && sheathedLit.tab.badge === "2 / 2" && /1 .*light/i.test(sheathedLit.tab.clause) && sheathedLit.model.heldLights === 1 && sheathedLit.model.lights.some((l) => l.lit && l.mine) && sheathedLit.tab.loose.some((n) => /^torch(?!es)/i.test(n)), { ...hands(sheathedLit), loose: sheathedLit.tab?.loose });
  const doused = await run(gm, P.pressId, { actorId, itemId: torchId, action: "lightAction", filter: { light: "lightToggle" } });
  check("Douse on the carried torch row gives the hand back: badge 1 / 2, no clause", doused.found && doused.tab.badge === "1 / 2" && doused.tab.clause === "" && doused.model.heldLights === 0, hands(doused));
  // A doused record is relit from the party sheet; the torch row offers Light,
  // which strikes a new flame. Drawn again, the torch is the source it goes on.
  note("lights removed", await run(gm, P.removeLights, { actorId, formationId }));
  const redrawn = await run(gm, P.pressId, { actorId, itemId: torchId, action: "toggleEquip" });
  const relit = await run(gm, P.pressId, { actorId, itemId: torchId, action: "lightAction", filter: { light: "light" } });
  check("drawn again and lit again, the flame is absorbed by the hand that holds it: badge 2 / 2, no clause, the stack untouched", redrawn.found && relit.found && relit.model.lights.some((l) => l.lit && l.mine) && relit.tab.badge === "2 / 2" && relit.tab.clause === "" && relit.model.lightsInHand[0]?.lit === true && relit.model.stack === redrawn.model.stack, { redrawn: hands(redrawn), relit: hands(relit), stack: [redrawn.model?.stack, relit.model?.stack] });
  note("lights removed", await run(gm, P.removeLights, { actorId, formationId }));
  // Both hands full with no unlit torch in them: the sword alone.
  note("sheathe torch", hands(await run(gm, P.pressId, { actorId, itemId: torchId, action: "toggleEquip" })));
  note("sheathe dagger", hands(await run(gm, P.press, { actorId, re: "^dagger", action: "toggleEquip" })));
  const swordUp = await run(gm, P.press, { actorId, re: "two-handed", action: "toggleEquip" });
  const stackLit = await run(gm, P.lightNoOverride, { actorId, formationId, type: "torch" });
  check("with both hands on the sword a torch from the stack is refused, and the refusal is a notice", swordUp.tab.badge === "2 / 2" && stackLit.lit === 0 && stackLit.notices.length >= 1, { ...hands(swordUp), lit: stackLit });
  note("sheathe sword", hands(await run(gm, P.press, { actorId, re: "two-handed", action: "toggleEquip" })));
  const daggerUp = await run(gm, P.press, { actorId, re: "^dagger", action: "toggleEquip" });
  const stackLit2 = await run(gm, P.lightNoOverride, { actorId, formationId, type: "torch" });
  const stackRead = await run(gm, P.rerender, { actorId });
  check("with a hand free and the readied torch sheathed, a torch from the stack lights, holds a hand of its own and spends one off the stack: badge 2 / 2 with the clause", daggerUp.tab.badge === "1 / 2" && stackLit2.lit === 1 && stackRead.tab.badge === "2 / 2" && /1 .*light/i.test(stackRead.tab.clause) && stackRead.model.heldLights === 1 && stackRead.model.stack === daggerUp.model.stack - 1, { ...hands(stackRead), lit: stackLit2, stack: [daggerUp.model?.stack, stackRead.model?.stack] });
  note("lights removed", await run(gm, P.removeLights, { actorId, formationId }));
  note("sheathe dagger", hands(await run(gm, P.press, { actorId, re: "^dagger", action: "toggleEquip" })));
  note("draw torch", hands(await run(gm, P.pressId, { actorId, itemId: torchId, action: "toggleEquip" })));
  note("left party", await run(gm, P.leaveParty, { actorId, formationId }));

  section("2c. a lone character lights the torch in hand onto their own flag");
  const loneLit = await run(gm, P.pressId, { actorId, itemId: torchId, action: "lightAction", filter: { light: "light" } });
  check("Light on the lone character's torch row writes their own lights flag, and the badge stays 1 / 2 with no clause", loneLit.found && loneLit.model.ownLights?.length === 1 && loneLit.model.lights.some((l) => l.lit && l.mine) && loneLit.tab.badge === "1 / 2" && loneLit.tab.clause === "" && loneLit.model.lightsInHand[0]?.lit === true, { ...hands(loneLit), own: loneLit.model.ownLights });
  const loneSheathed = await run(gm, P.pressId, { actorId, itemId: torchId, action: "toggleEquip" });
  check("sheathed, the lone burning torch keeps its hand: badge 1 / 2 with the clause", loneSheathed.tab.badge === "1 / 2" && /1 .*light/i.test(loneSheathed.tab.clause) && loneSheathed.model.heldLights === 1, hands(loneSheathed));
  const loneDoused = await run(gm, P.pressId, { actorId, itemId: torchId, action: "lightAction", filter: { light: "lightToggle" } });
  check("Douse gives it back: badge 0 / 2", loneDoused.found && loneDoused.tab.badge === "0 / 2" && loneDoused.tab.clause === "", hands(loneDoused));
  note("reset after 2c", await run(gm, P.reset, { actorId }));
  const loneStack = await run(gm, P.lightAlone, { actorId, type: "torch" });
  check("a lone torch from the stack with none readied is one hand: badge 1 / 2 with the clause", loneStack.lit && loneStack.tab.badge === "1 / 2" && /1 .*light/i.test(loneStack.tab.clause), hands(loneStack));
  note("unlit", hands(await run(gm, P.unlightAlone, { actorId })));

  section("2d/2e. the mapper's kit is listed at the hands, and the role needs them");
  note("reset", await run(gm, P.reset, { actorId }));
  const joined = await run(gm, P.joinParty, { actorId });
  if (joined !== formationId) { await run(gm, P.deleteParty, { formationId }); formationId = joined; }
  const roleOn = await run(gm, P.toggleRole, { actorId, formationId, role: "mapper", override: true });
  const kit = await run(gm, P.rerender, { actorId });
  check("the role is taken and the kit is in hand quill first", roleOn.roles.includes("mapper") && roleOn.kit === 2 && kit.model.kit[0] && /quill/i.test(kit.model.kit[0]) && /parchment/i.test(kit.model.kit[1] ?? ""), { roles: roleOn.roles, kit: kit.model.kit });
  check("the Main hand place lists the quill and the Off hand the parchment, each at 1 / 1, each row held for mapping", kit.tab.places.mainHand.rows.length === 1 && /quill/i.test(kit.tab.places.mainHand.rows[0].name) && kit.tab.places.offHand.rows.length === 1 && /parchment/i.test(kit.tab.places.offHand.rows[0].name) && kit.tab.places.mainHand.cap === "1 / 1" && kit.tab.places.offHand.cap === "1 / 1" && [...rowLines(kit, "mainHand"), ...rowLines(kit, "offHand")].every((l) => /mapping/i.test(l)), { main: kit.tab.places.mainHand, off: kit.tab.places.offHand });
  check("the badge reads 2 / 2 with no clause: the hands are explained by their rows", kit.tab.badge === "2 / 2" && kit.tab.clause === "" && kit.model.mapping === 2, hands(kit));
  const bowOver = await run(gm, P.press, { actorId, re: "long bow", action: "toggleEquip" });
  check("drawing the bow over the kit is resolved without a violation and the kit rows stay", bowOver.found && bowOver.model.legal && bowOver.model.violations.length === 0 && bowOver.tab.places.mainHand.rows.some((r) => /quill/i.test(r.name)) && bowOver.tab.places.offHand.rows.some((r) => /parchment/i.test(r.name)), { ...hands(bowOver), bow: bowOver.model.hands["Long Bow"] });
  if (bowOver.model.hands["Long Bow"]?.eq) note("sheathe bow", hands(await run(gm, P.press, { actorId, re: "long bow", action: "toggleEquip" })));
  const mapLit = await run(gm, P.lightNoOverride, { actorId, formationId, type: "torch" });
  check("with the hands held for mapping a torch is refused with a notice", mapLit.lit === 0 && mapLit.notices.length >= 1, mapLit);
  const roleOff = await run(gm, P.toggleRole, { actorId, formationId, role: "mapper" });
  const kitOff = await run(gm, P.rerender, { actorId });
  check("setting the role down empties the places and the badge reads 0 / 2", !roleOff.roles.includes("mapper") && roleOff.kit === 0 && !kitOff.tab.places.mainHand.rows.length && !kitOff.tab.places.offHand.rows.length && kitOff.tab.badge === "0 / 2", hands(kitOff));
  note("draw sword", hands(await run(gm, P.press, { actorId, re: "two-handed", action: "toggleEquip" })));
  const refused = await run(gm, P.toggleRole, { actorId, formationId, role: "mapper" });
  check("taking the role with the sword drawn and no override is refused, with a notice naming the hands", !refused.roles.includes("mapper") && refused.kit === 0 && refused.notices.length >= 1, refused);
  note("sheathe sword", hands(await run(gm, P.press, { actorId, re: "two-handed", action: "toggleEquip" })));
  const taken = await run(gm, P.toggleRole, { actorId, formationId, role: "mapper" });
  check("with the hands free the role is taken without an override", taken.roles.includes("mapper") && taken.kit === 2, taken);
  note("role off", await run(gm, P.toggleRole, { actorId, formationId, role: "mapper" }));
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
} finally {
  section("teardown");
  const gm = seats.gm;
  if (gm && actorId) {
    try { note("reset", await run(gm, P.reset, { actorId })); } catch (err) { console.error("reset:", err?.message ?? err); }
    if (formationId) { try { note("party deleted", await run(gm, P.deleteParty, { formationId })); } catch (err) { console.error("deleteParty:", err?.message ?? err); } }
    try { note("closed (gm)", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
    // The reset deleted the readied torch; the sweep reports it as not found, which is the record.
    try { note("sweep", await gm.sweepTracked()); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
