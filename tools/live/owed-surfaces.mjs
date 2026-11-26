/**
 * Live walk, owed surfaces: four small checks the release closeout owed, each in
 * its own stage so a throw in one leaves the rest running (the kit's `stage`).
 * GM seat only. Machine values arrive through ./_env.mjs; every fixture is
 * invented, every figure a step types is invented, and nothing here prints a
 * page figure or a book word (a card's save modifier is read as present or
 * absent, never quoted). The walk rides `_magic-cast-kit.mjs` for its seat,
 * ledger, rig, scene and token plumbing and adds its own page functions
 * under `globalThis.__ow`.
 *
 * Where an entry of the closeout list was ambiguous this file follows the
 * recipe it names and says so below; a step the world cannot build prints SKIP
 * with its reason, and none passes silently.
 *
 *  C. The template sheet's Default select (T-0826, docs/lib/API.md,
 *     "templateLogic"). Ambiguity: no TESTING.md recipe names it, so the steps
 *     are read off `scripts/lib/apps/template-sheet.mjs` and
 *     `scripts/lib/template-logic.mjs`. Fixture `owed/template`: a single-pick
 *     axis of three options and a multi axis of two, shaped at every start.
 *     Edit mode draws a Default select on the single axis only, its options are
 *     None and the axis's own, its label and tooltip are lang strings; picking
 *     an option writes it to the stored axis, None clears it, deleting the
 *     default's option clears it and deleting another keeps it, and the sheet's
 *     own pick select then reads the default as its blank line.
 *  B. The Follower Card's armour class and morale tooltips (T-0715). Fixture
 *     `owed/follower-beast`: a monster given an invented kit record whose figures
 *     are the ones the actor then holds. The frame card's two cells carry the
 *     parts as `data-tooltip-text` (the full sheet's `derivationTips`); with the
 *     record removed they fall back to the plain `data-tooltip` hints and carry no
 *     text tooltip. The ticket's own subject, a figure an organisation trait
 *     moved, is B2: an invented `derived.organisation` record moves both figures
 *     by one and the tooltips name its invented trait and page. The compact
 *     card on an employer's Followers tab reads the same context and is not
 *     opened here.
 *  E. The T-0798 spot check (docs/magic/DECISIONS.md, 2026-11-25). Ambiguity:
 *     "spot check" has no recipe, so it follows that entry's own example: a begun
 *     fight on one scene and the caster's linked token on another holds the caster
 *     nowhere (`heldFight` null, the cast's moment free); a token on the fight's
 *     scene holds it (declare); a begun fight on no scene holds it wherever the
 *     token stands. The readers are the module's own (`heldFight`,
 *     `casterSceneIds`, `castMoment`) called on real Combat, Scene and Token
 *     documents; the cast dialog's declared reading and the "Cast now" press are
 *     not driven (the press is not built; a dialog needs a class and a spell, and
 *     every cast site asks `heldFight`). Fixtures: the two kept scenes, and
 *     `owed/fighter`; the walk's combats and tokens are its own and tracked.
 *  A. The maneuver save card (docs/equipment/TESTING.md, "The maneuver's save
 *     card"), reduced to what a GM seat alone and no imported table can show:
 *     steps 1 (the card posts after a hit, titled for the maneuver, naming the
 *     target), 3 (a miss posts none), 4 (a monster target posts the Judge's
 *     card with no save named), 6 (a maneuver that calls no save posts none) and
 *     7 (the overlay off posts none). Left out, said here and in the report: the
 *     Player seat's Save press and the observer's view (steps 1 and 2's second
 *     half), disarm's grip figure (step 5), and every figure and tooltip of the
 *     save, which need the imported equipment tables (the card's save is printed
 *     as named or not, never asserted). The attack goes out as the weapon sheet's
 *     manoeuvre row sends it, `makeAttackThrow` with `acksLib.maneuver`, the die
 *     rigged (0.025 throws a 20, 0.975 a 1); the overlay setting is restored.
 *
 * Fixtures are kept and found by marker (`api.fixture`): the scenes
 * `owed/scene-a` (the field and the standing scene) and `owed/scene-b` (the
 * fight's scene), the template, the beast, the fighter, and the maneuver actors
 * `owed/man-attacker`, `owed/man-sword`, `owed/man-target` and
 * `owed/man-target-monster`. The run's own tokens, combats and cards are tracked
 * by id and swept by that list; the sweep object is printed.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P as KIT, note, section, check, skip, idOf, run, ready, ledgerFor, finish, summarize, stage,
} from "./_magic-cast-kit.mjs";

const { browser, origin } = MACHINE;
const KEY = "owed-surfaces-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_200_000);
const HIT = [0.025];
const MISS = [0.975];

let gm = null;
const ledger = ledgerFor(() => gm);
const W = {};
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the GM's page.  */
/* ------------------------------------------------------------------ */
const P = {
  ...KIT,

  ownInstall: async () => {
    const H = (globalThis.__ow = globalThis.__ow ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.opened = H.opened ?? [];
    return true;
  },
  ownRestore: async () => {
    const H = globalThis.__ow;
    if (!H) return { closed: 0, overlay: null };
    let closed = 0;
    for (const app of H.opened ?? []) { try { await app.close({ force: true }); closed++; } catch {} }
    H.opened = [];
    let overlay = null;
    if (H.overlayWas !== undefined) { await game.settings.set("acks-extras", "overlayManeuvers", H.overlayWas); overlay = game.settings.get("acks-extras", "overlayManeuvers"); H.overlayWas = undefined; }
    return { closed, overlay };
  },
  closeWindows: async () => {
    const H = globalThis.__ow;
    let n = 0;
    for (const app of H.opened ?? []) { try { await app.close({ force: true }); n++; } catch {} }
    H.opened = [];
    return n;
  },

  /* ---- C: the template sheet's Default select ---- */
  shapeTemplate: async ({ actorId, axes }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.output": { actorType: "monster", nameFormat: "{kind}" }, "system.axes": axes, "system.cells": [] });
    return actor.system.axes.map((a) => ({ key: a.key, multi: !!a.multi, default: a.default ?? "", options: a.options.map((o) => o.key) }));
  },
  templateOpen: async ({ actorId, editing }) => {
    const H = globalThis.__ow;
    const actor = game.actors.get(actorId);
    const app = actor.sheet;
    if (!H.opened.includes(app)) H.opened.push(app);
    H.tsheet = app;
    await app.render(true);
    const root = await H.poll(() => { const r = H.root(app); return r?.querySelector(".acks-lib-template-body") ? r : null; });
    if (!root) return { rendered: false };
    const inEdit = () => !!H.root(app)?.querySelector(".acks-lib-template-editor");
    if (inEdit() !== !!editing) {
      H.root(app).querySelector('[data-action="editToggle"]')?.click();
      await H.poll(() => inEdit() === !!editing);
    }
    return { rendered: true, editing: inEdit() };
  },
  templateDefaults: async () => {
    const H = globalThis.__ow;
    const root = H.root(H.tsheet);
    return {
      axes: [...root.querySelectorAll(".acks-lib-template-editor .editor-axis")].map((ax) => {
        const sel = ax.querySelector("select.acks-lib-template-default");
        return {
          key: ax.dataset.axisKey,
          select: !!sel,
          values: sel ? [...sel.options].map((o) => o.value) : [],
          value: sel?.value ?? null,
          aria: sel?.getAttribute("aria-label") ?? null,
          tip: sel?.getAttribute("data-tooltip") ?? null,
          rows: [...ax.querySelectorAll("li[data-option-key]")].map((li) => li.dataset.optionKey),
        };
      }),
      stored: Object.fromEntries(H.tsheet.actor.system.axes.map((a) => [a.key, { default: a.default ?? "", options: a.options.map((o) => o.key) }])),
    };
  },
  templatePick: async ({ axis, value }) => {
    const H = globalThis.__ow;
    const sel = H.root(H.tsheet)?.querySelector(`select.acks-lib-template-default[data-axis="${axis}"]`);
    if (!sel) return { found: false };
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const stored = () => H.tsheet.actor.system.axes.find((a) => a.key === axis)?.default ?? "";
    const landed = await H.poll(() => stored() === value);
    await H.sleep(600);
    const after = H.root(H.tsheet)?.querySelector(`select.acks-lib-template-default[data-axis="${axis}"]`);
    return { found: true, landed: !!landed, stored: stored(), shown: after?.value ?? null };
  },
  templateDelete: async ({ axis, option }) => {
    const H = globalThis.__ow;
    const link = H.root(H.tsheet)?.querySelector(`li[data-axis-key="${axis}"][data-option-key="${option}"] a[data-action="deleteOption"]`);
    if (!link) return { found: false };
    link.click();
    const gone = await H.poll(() => !H.tsheet.actor.system.axes.find((a) => a.key === axis)?.options.some((o) => o.key === option));
    await H.sleep(600);
    const a = H.tsheet.actor.system.axes.find((x) => x.key === axis);
    return { found: true, gone: !!gone, default: a?.default ?? "", options: a?.options.map((o) => o.key) ?? [] };
  },
  templatePinFirst: async ({ axis }) => {
    const H = globalThis.__ow;
    const sel = H.root(H.tsheet)?.querySelector(`select.acks-lib-template-pin[data-axis="${axis}"]`);
    return sel ? { found: true, first: sel.options[0]?.textContent.trim() ?? "", value: sel.value } : { found: false };
  },
  fmt: async ({ key, data }) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),

  /* ---- B: the Follower Card's tooltips ---- */
  shapeBeast: async ({ actorId, kit, morale }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.details.morale": morale, "flags.acks-extras.extras.-=derived": null, "flags.acks-extras.extras.-=kit": null });
    const ac = Number(actor.system.ac?.value);
    const held = Number(actor.system.details?.morale);
    const record = { ...kit, ac, morale: held };
    await actor.update({ "flags.acks-extras.extras.kit": record });
    const stored = actor.getFlag("acks-extras", "extras")?.kit ?? null;
    return {
      ac, morale: held, survived: !!stored?.troop && Number(stored.ac) === ac && Number(stored.morale) === held,
      expectAc: game.i18n.format("ACKS-MONSTERS.statblock.tip.acKit", { ac, label: kit.label, cite: kit.cite }),
      expectMorale: game.i18n.format("ACKS-MONSTERS.statblock.tip.kitFigure", { label: kit.label, cite: kit.cite }),
    };
  },
  /**
   * T-0715's subject: an organisation trait moved the armour class and the morale the actor holds by one each. The kit record then
   * carries the figures before the move (the tip unwinds the move before it compares), and `derived.organisation` names the trait.
   */
  shapeOrg: async ({ actorId, kit, trait }) => {
    const actor = game.actors.get(actorId);
    const ac = Number(actor.system.ac?.value);
    const morale = Number(actor.system.details?.morale);
    await actor.update({
      "flags.acks-extras.extras.kit": { ...kit, ac: ac - 1, morale: morale - 1 },
      "flags.acks-extras.extras.derived.organisation": { ac: { value: ac, base: ac - 1, trait: 1 }, morale: { value: morale, base: morale - 1, trait: 1 }, trait },
    });
    const stored = actor.getFlag("acks-extras", "extras")?.derived?.organisation ?? null;
    return { ac, morale, survived: Number(stored?.ac?.value) === ac && stored?.trait?.label === trait.label };
  },
  dropKit: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "flags.acks-extras.extras.-=kit": null, "flags.acks-extras.extras.-=derived": null });
    const extras = actor.getFlag("acks-extras", "extras") ?? {};
    return { kit: extras.kit ?? null, derived: extras.derived ?? null };
  },
  beastCard: async ({ actorId }) => {
    const H = globalThis.__ow;
    const actor = game.actors.get(actorId);
    const app = new acksExtras.lib.followerCard.Sheet({ document: actor });
    H.opened.push(app);
    app.render(true);
    const root = await H.poll(() => { const r = H.root(app); return r?.querySelector(".acks-lib-follower-card") ? r : null; });
    if (!root) return { rendered: false };
    const cell = (el) => { const label = el?.closest("label"); return label ? { text: label.getAttribute("data-tooltip-text"), tip: label.getAttribute("data-tooltip") } : null; };
    return { rendered: true, ac: cell(root.querySelector("[data-fc-ac]")), morale: cell(root.querySelector('input[name="system.details.morale"]')), acValue: Number(root.querySelector("[data-fc-ac]")?.value) };
  },

  /* ---- E: the T-0798 spot check ---- */
  fightRead: async ({ actorId }) => {
    const F = await import("/modules/acks-extras/scripts/magic/cast-fight.mjs");
    const M = await import("/modules/acks-extras/scripts/magic/cast-moment.mjs");
    const actor = game.actors.get(actorId);
    const held = F.heldFight(actor);
    return {
      scenes: F.casterSceneIds(actor).sort(),
      held: !!held,
      combatId: held?.combat?.id ?? null,
      fightScene: held ? M.combatSceneId(held.combat) : null,
      moment: M.castMoment({ combat: held?.combat ?? null, combatant: held?.combatant ?? null }),
    };
  },
  fightStanding: async ({ actorId }) => ({
    combats: game.combats.filter((c) => c.combatants.some((x) => x.actorId === actorId)).map((c) => c.id),
    tokens: [...game.scenes].flatMap((s) => [...s.tokens].filter((t) => t.actorId === actorId).map((t) => t.uuid)),
  }),
  fightBuild: async ({ sceneId, actorId }) => {
    let combat = null;
    try {
      combat = await Combat.create({ scene: sceneId ?? null });
      await combat.createEmbeddedDocuments("Combatant", [{ actorId }]);
      await combat.update({ round: 1, turn: 0, "flags.acks.initDone": true });
      return { id: combat.id, uuid: combat.uuid, scene: combat._source.scene ?? null, combatants: combat.combatants.size };
    } catch (err) {
      return { error: String(err?.message ?? err).slice(0, 200), uuid: combat?.uuid ?? null, id: combat?.id ?? null };
    }
  },
  fightDrop: async ({ combatId }) => { await game.combats.get(combatId)?.delete(); return !game.combats.has(combatId); },
  tokenAdd: async ({ sceneId, actorId, x, y, name }) => {
    const [t] = await game.scenes.get(sceneId).createEmbeddedDocuments("Token", [{ actorId, x, y, name, actorLink: true }]);
    return { id: t.id, uuid: t.uuid };
  },
  tokenDrop: async ({ sceneId, tokenId }) => {
    await game.scenes.get(sceneId)?.deleteEmbeddedDocuments("Token", [tokenId]);
    return !game.scenes.get(sceneId)?.tokens.has(tokenId);
  },

  /* ---- A: the maneuver save card ---- */
  setting: async ({ key }) => game.settings.get("acks-extras", key),
  overlay: async ({ on }) => {
    const H = globalThis.__ow;
    if (H.overlayWas === undefined) H.overlayWas = game.settings.get("acks-extras", "overlayManeuvers");
    await game.settings.set("acks-extras", "overlayManeuvers", !!on);
    return game.settings.get("acks-extras", "overlayManeuvers");
  },
  /**
   * One attack as the weapon sheet's manoeuvre row sends it, the die rigged for the throw and the wait after it, against the seat's targets.
   * Answers whether the attack card posted and each new card of the attacker whose stored model is a maneuver save: its title seen, its
   * save name and its subject names. The attacker's messages since the call began are listed by uuid for the ledger.
   */
  maneuverAttack: async ({ sceneId, tokenId, itemId, key, rig, targetName, expectCard }) => {
    const H = globalThis.__ow;
    const actor = game.scenes.get(sceneId).tokens.get(tokenId)?.actor;
    const item = actor?.items.get(itemId);
    if (!actor || !item) return { missing: true };
    const { MANEUVERS } = await import("/modules/acks-extras/scripts/equipment/overlays/maneuvers.mjs");
    const title = game.i18n.format("ACKS-EQUIPMENT.maneuverSave.title", { maneuver: MANEUVERS[key].label, attacker: actor.name, target: targetName });
    const before = new Set([...game.messages].map((m) => m.id));
    const mine = () => [...game.messages].filter((m) => !before.has(m.id) && m.speaker?.actor === actor.id);
    const isMan = (m) => JSON.stringify(m.flags?.["acks-extras"] ?? {}).includes('"maneuverSave"');
    const prior = CONFIG.Dice.randomUniform;
    let i = 0;
    CONFIG.Dice.randomUniform = () => rig[i++ % rig.length];
    let attackCard = false;
    try {
      await actor.makeAttackThrow({ item, attackType: "melee", skipDialog: true, acksLib: { maneuver: key } });
      attackCard = !!(await H.poll(() => mine().some((m) => String(m.content).includes("attack-throw-card")), { tries: 40, every: 200 }));
      if (expectCard) await H.poll(() => mine().some(isMan), { tries: 40, every: 200 });
      else await H.sleep(3000);
      await H.sleep(500);
    } finally {
      CONFIG.Dice.randomUniform = prior;
    }
    const find = (o, d = 0) => {
      if (!o || typeof o !== "object" || d > 6) return null;
      if (o.kind === "maneuverSave") return o;
      for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; }
      return null;
    };
    return {
      attackCard,
      uuids: mine().map((m) => m.uuid),
      cards: mine().filter(isMan).map((m) => {
        const model = find(m.flags?.["acks-extras"]);
        return { titled: model?.title === title, maneuver: model?.maneuver ?? null, saveNamed: !!model?.saveName, saveName: model?.saveName ?? null, subjects: Object.values(model?.subjects ?? {}).map((s) => s.name) };
      }),
    };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
const option = (key, label) => ({ key, label, nameLabel: "", merge: {}, items: [], flags: {}, token: {} });

/** The two kept scenes both A and E stand on. */
async function setup() {
  W.sceneA = idOf(await gm.fixture("owed/scene-a", "Scene", { name: "Owed Field A", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#55606b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } }));
  W.sceneB = idOf(await gm.fixture("owed/scene-b", "Scene", { name: "Owed Field B", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#56625a", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } }));
  check("setup: both scenes stand", !!W.sceneA && !!W.sceneB && W.sceneA !== W.sceneB);
}

/* ---------------------------- C. template Default select ---------------------------- */
async function stageTemplate() {
  const tpl = await gm.fixture("owed/template", "Actor", { name: "Owed Template", type: "acks-extras.template" });
  const axes = [
    { key: "kind", label: "Kind", roll: "", default: "", options: [option("a", "Option A"), option("b", "Option B"), option("c", "Option C")] },
    { key: "extras", label: "Extras", roll: "", multi: true, options: [option("x", "Add-on X"), option("y", "Add-on Y")] },
  ];
  const shaped = await run(gm, P.shapeTemplate, { actorId: tpl.id, axes });
  check("C: the template starts in its shape: two axes, the multi one flagged, no default", shaped.length === 2 && shaped[0].default === "" && shaped[1].multi === true, shaped);
  try {
    const opened = await run(gm, P.templateOpen, { actorId: tpl.id, editing: true });
    if (!opened.rendered || !opened.editing) { skip("C: the template sheet did not open in edit mode, so no step ran", opened); return; }
    const first = await run(gm, P.templateDefaults);
    const kind = first.axes.find((a) => a.key === "kind");
    const extras = first.axes.find((a) => a.key === "extras");
    check("C1: edit mode draws a Default select on the single axis and none on the multi axis", !!kind?.select && !!extras && !extras.select, { kind: !!kind?.select, extras: extras?.select });
    check("C1: the select offers None and the axis's own options, and reads None", !!kind && JSON.stringify(kind.values) === JSON.stringify(["", "a", "b", "c"]) && kind.value === "", { values: kind?.values, value: kind?.value });
    const want = {
      aria: await run(gm, P.fmt, { key: "ACKS-LIB.template.defaultFor", data: { axis: "Kind" } }),
      tip: await run(gm, P.fmt, { key: "ACKS-LIB.template.defaultHint" }),
    };
    check("C1: the select is named for its axis and carries the hint tooltip (both lang strings)", kind?.aria === want.aria && kind?.tip === want.tip, { aria: kind?.aria === want.aria, tip: kind?.tip === want.tip });

    const set = await run(gm, P.templatePick, { axis: "kind", value: "b" });
    check("C2: picking an option writes it to the stored axis and the select keeps it", set.found && set.landed && set.stored === "b" && set.shown === "b", set);
    const cleared = await run(gm, P.templatePick, { axis: "kind", value: "" });
    check("C3: picking None clears the stored default", cleared.found && cleared.landed && cleared.stored === "" && cleared.shown === "", cleared);

    // With three options the axis is drawn on the sheet's pick select, whose blank line names the default.
    await run(gm, P.templatePick, { axis: "kind", value: "a" });
    const closed = await run(gm, P.templateOpen, { actorId: tpl.id, editing: false });
    const pin = await run(gm, P.templatePinFirst, { axis: "kind" });
    const wantFirst = await run(gm, P.fmt, { key: "ACKS-LIB.template.defaultTo", data: { option: "Option A" } });
    if (!closed.rendered || !pin.found) skip("C5: the sheet's pick select for the axis is not drawn, so its blank line is not read", { closed, pin });
    else check("C5: with the default standing, the sheet's pick select reads it as its blank line", pin.first === wantFirst, { first: pin.first === wantFirst });
    const again = await run(gm, P.templateOpen, { actorId: tpl.id, editing: true });
    if (!again.editing) { skip("C4: the sheet did not return to edit mode, so the option deletes were not run", again); return; }

    await run(gm, P.templatePick, { axis: "kind", value: "c" });
    const dropC = await run(gm, P.templateDelete, { axis: "kind", option: "c" });
    check("C4: deleting the default's option removes it and clears the default", dropC.found && dropC.gone && dropC.default === "" && JSON.stringify(dropC.options) === JSON.stringify(["a", "b"]), dropC);
    await run(gm, P.templatePick, { axis: "kind", value: "a" });
    const dropB = await run(gm, P.templateDelete, { axis: "kind", option: "b" });
    check("C4: deleting another option keeps the default", dropB.found && dropB.gone && dropB.default === "a" && JSON.stringify(dropB.options) === JSON.stringify(["a"]), dropB);
  } finally {
    await run(gm, P.shapeTemplate, { actorId: tpl.id, axes });
    note("C: windows closed", await run(gm, P.closeWindows));
  }
}

/* ---------------------------- B. follower card tooltips ---------------------------- */
async function stageBeast() {
  const beast = await gm.fixture("owed/follower-beast", "Actor", { name: "Owed Beast", type: "monster", prototypeToken: { actorLink: true } });
  const kit = { troop: "owed-troop", label: "Owed troop", cite: "INV 1" };
  const shaped = await run(gm, P.shapeBeast, { actorId: beast.id, kit, morale: 3 });
  if (!shaped.survived) { skip("B: the kit record did not survive its write on the monster, so the card's parts cannot be built", shaped); return; }
  try {
    const card = await run(gm, P.beastCard, { actorId: beast.id });
    if (!card.rendered) { skip("B: the follower card did not render", card); return; }
    check("B1: the armour class cell's tooltip is the parts text (a text tooltip naming the troop row and its page)", card.ac?.text === shaped.expectAc, { match: card.ac?.text === shaped.expectAc, hasText: !!card.ac?.text });
    check("B1: the morale cell's tooltip is the parts text", card.morale?.text === shaped.expectMorale, { match: card.morale?.text === shaped.expectMorale, hasText: !!card.morale?.text });
    note("B1: closed", await run(gm, P.closeWindows));

    // T-0715's own subject: a figure an organisation trait moved names the trait and its page beside the troop row's.
    const trait = { label: "Owed trait", cite: "INV 2" };
    const org = await run(gm, P.shapeOrg, { actorId: beast.id, kit, trait });
    if (!org.survived) skip("B2: the organisation record did not survive its write, so the moved-figure tooltips were not read", org);
    else {
      const moved = await run(gm, P.beastCard, { actorId: beast.id });
      const names = (text) => typeof text === "string" && text.includes(trait.label) && text.includes(trait.cite);
      check("B2: the armour class cell's tooltip names the organisation trait and its page", !!moved.rendered && names(moved.ac?.text), { hasText: !!moved.ac?.text, names: names(moved.ac?.text) });
      check("B2: the morale cell's tooltip names the organisation trait and its page", !!moved.rendered && names(moved.morale?.text), { hasText: !!moved.morale?.text, names: names(moved.morale?.text) });
      note("B2: closed", await run(gm, P.closeWindows));
    }

    await run(gm, P.dropKit, { actorId: beast.id });
    const bare = await run(gm, P.beastCard, { actorId: beast.id });
    const hint = await run(gm, P.fmt, { key: "ACKS-LIB.followerCard.acHint", data: { n: shaped.ac } });
    const moraleLabel = await run(gm, P.fmt, { key: "ACKS.details.morale" });
    check("B3: with no record the armour class cell has no text tooltip and falls back to its hint",!!bare.rendered && !bare.ac?.text && bare.ac?.tip === hint, { text: bare.ac?.text ?? null, hint: bare.ac?.tip === hint });
    check("B3: with no record the morale cell has no text tooltip and falls back to its label",!!bare.rendered && !bare.morale?.text && bare.morale?.tip === moraleLabel, { text: bare.morale?.text ?? null, label: bare.morale?.tip === moraleLabel });
  } finally {
    note("B: windows closed", await run(gm, P.closeWindows));
  }
}

/* ---------------------------- E. T-0798 spot check ---------------------------- */
async function stageFight() {
  const fighter = await gm.fixture("owed/fighter", "Actor", { name: "Owed Fighter", type: "character", prototypeToken: { actorLink: true } });
  const standing = await run(gm, P.fightStanding, { actorId: fighter.id });
  if (standing.combats.length || standing.tokens.length) {
    skip("E: the fighter already stands in a fight or on a scene (a leftover); nothing of the run's own ids names it, so it is not driven", { combats: standing.combats, tokens: standing.tokens });
    return;
  }
  const combats = [];
  const tokens = [];
  const build = async (sceneId) => {
    const made = await run(gm, P.fightBuild, { sceneId, actorId: fighter.id });
    if (made.uuid) { await ledger.track(made.uuid, "Combat"); combats.push(made); }
    return made;
  };
  try {
    const home = await run(gm, P.tokenAdd, { sceneId: W.sceneA, actorId: fighter.id, x: 300, y: 300, name: "Owed Fighter" });
    await ledger.track(home.uuid, "Token");
    tokens.push({ ...home, scene: W.sceneA });
    const stale = await build(W.sceneB);
    if (stale.error) { skip("E: a begun fight with a tokenless combatant could not be made on this world", stale); return; }
    const r1 = await run(gm, P.fightRead, { actorId: fighter.id });
    check("E1: the token stands on the one scene only", JSON.stringify(r1.scenes) === JSON.stringify([W.sceneA]), r1.scenes);
    check("E1: a begun fight on the other scene holds the caster nowhere: no fight, a free cast", !r1.held && r1.moment === "free", { held: r1.held, moment: r1.moment });

    const there = await run(gm, P.tokenAdd, { sceneId: W.sceneB, actorId: fighter.id, x: 300, y: 300, name: "Owed Fighter" });
    await ledger.track(there.uuid, "Token");
    tokens.push({ ...there, scene: W.sceneB });
    const r2 = await run(gm, P.fightRead, { actorId: fighter.id });
    check("E2: a token on the fight's scene holds the caster in that fight, and a cast is declared", r2.held && r2.combatId === stale.id && r2.fightScene === W.sceneB && r2.moment === "declare", { held: r2.held, same: r2.combatId === stale.id, moment: r2.moment });

    const gone = await run(gm, P.tokenDrop, { sceneId: W.sceneB, tokenId: there.id });
    tokens.pop();
    const r3 = await run(gm, P.fightRead, { actorId: fighter.id });
    check("E3: with that token deleted the fight holds the caster no more", gone && !r3.held && r3.moment === "free", { gone, held: r3.held, moment: r3.moment });

    const sceneless = await build(null);
    if (sceneless.error || sceneless.scene) skip("E4: a begun fight on no scene could not be made on this world (the Combat kept a scene)", { error: sceneless.error ?? null, scene: !!sceneless.scene });
    else {
      const r4 = await run(gm, P.fightRead, { actorId: fighter.id });
      check("E4: a begun fight on no scene holds the caster wherever its token stands", r4.held && r4.combatId === sceneless.id && r4.fightScene === null && r4.moment === "declare", { held: r4.held, same: r4.combatId === sceneless.id, moment: r4.moment });
    }
    skip("E: the cast dialog's declared reading and the Cast now press are not driven (the press is unbuilt; heldFight is the one reader every cast site asks)");
  } finally {
    for (const c of combats) note(`E: fight ${c.id} dropped`, await run(gm, P.fightDrop, { combatId: c.id }));
    for (const t of tokens) note(`E: token ${t.id} dropped`, await run(gm, P.tokenDrop, { sceneId: t.scene, tokenId: t.id }));
  }
}

/* ---------------------------- A. maneuver save card ---------------------------- */
async function stageManeuver() {
  // The attack seam is installed at ready only with the setting on; turning it on afterwards installs nothing.
  if ((await run(gm, P.setting, { key: "rollAutomation" })) !== true) {
    skip("A: the world's roll automation setting is off, so the attack seam the maneuver card hangs on is not installed and no step ran (turn it on, reload the seat and walk again)");
    return;
  }
  const own = (ownerLink = true) => ({ prototypeToken: { actorLink: ownerLink }, system: { hp: { value: 60, max: 60 } } });
  const attacker = await gm.fixture("owed/man-attacker", "Actor", { name: "Owed Attacker", type: "character", ...own() });
  const sword = await gm.fixture("owed/man-sword", "Item", { name: "Owed Blade", type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent: attacker.uuid });
  const target = await gm.fixture("owed/man-target", "Actor", { name: "Owed Target", type: "character", ...own() });
  const monster = await gm.fixture("owed/man-target-monster", "Actor", { name: "Owed Monster", type: "monster", ...own() });
  check("A: the field is viewed", await run(gm, P.view, { sceneId: W.sceneA }));
  const placed = [];
  try {
    const made = await run(gm, P.placeTokens, { sceneId: W.sceneA, specs: [
      { actorId: idOf(attacker), name: attacker.name, x: 300, y: 300, disposition: 1 },
      { actorId: idOf(target), name: target.name, x: 500, y: 300 },
      { actorId: idOf(monster), name: monster.name, x: 500, y: 500 },
    ] });
    for (const t of made) { await ledger.track(t.uuid, "Token"); placed.push(t); }
    const tok = (id) => made.find((t) => t.actorId === idOf(id));
    check("A: three linked tokens stand on the field", made.length === 3);
    if (made.length !== 3) return;
    await run(gm, P.drain);
    const on = await run(gm, P.overlay, { on: true });
    check("A: the maneuver overlay setting is on", on === true);

    const swing = async ({ at, key, rig, expectCard }) => {
      for (const who of [target, monster]) await run(gm, P.setHp, { actorId: idOf(who), value: 60 });
      const aimed = await run(gm, P.target, { sceneId: W.sceneA, tokenIds: [tok(at).id] });
      if (!Array.isArray(aimed) || aimed.length !== 1) throw new Error(`the seat holds ${JSON.stringify(aimed)} as targets, not one`);
      const got = await run(gm, P.maneuverAttack, { sceneId: W.sceneA, tokenId: tok(attacker).id, itemId: idOf(sword), key, rig, targetName: at.name, expectCard });
      for (const uuid of got.uuids ?? []) await ledger.track(uuid, "ChatMessage");
      return got;
    };
    const noCard = async (label, got) => {
      if (!got.attackCard) { skip(`${label}: the attack posted no attack card (roll automation off, or the throw did not go out), so the absence of a save card proves nothing`, got); return; }
      check(label, got.cards.length === 0, { cards: got.cards.length });
    };

    const hit = await swing({ at: target, key: "knockDown", rig: HIT, expectCard: true });
    if (!hit.attackCard) skip("A1: the attack posted no attack card (roll automation off, or the throw did not go out), so no maneuver step can run", hit);
    else if (hit.cards.length !== 1) {
      // The detector saw no card on the one case that must show one, so its silence on the no-card cases would prove nothing.
      check("A1: a Knock Down that hits posts one save card", false, { cards: hit.cards.length });
      skip("A3/A4/A6/A7: not run, since the card detector did not see the one card A1 must show");
    } else {
      check("A1: a Knock Down that hits posts one save card, titled for the maneuver, the attacker and the target", hit.cards.length === 1 && hit.cards[0].titled && hit.cards[0].maneuver === "knockDown", hit.cards.map((c) => ({ titled: c.titled, maneuver: c.maneuver })));
      check("A1: the card's one subject is the struck target", hit.cards.length === 1 && JSON.stringify(hit.cards[0].subjects) === JSON.stringify([target.name]), hit.cards[0]?.subjects);
      note("A1: save named on the card (read from the imported tables, never quoted)", hit.cards[0]?.saveNamed ?? null);
      await noCard("A3: a Knock Down that misses posts no save card", await swing({ at: target, key: "knockDown", rig: MISS, expectCard: false }));
      const beast = await swing({ at: monster, key: "knockDown", rig: HIT, expectCard: true });
      check("A4: a hit on a monster with no stated size posts the Judge's card: one card, no save named", beast.attackCard && beast.cards.length === 1 && beast.cards[0].saveNamed === false, beast.cards.map((c) => ({ saveNamed: c.saveNamed })));
      await noCard("A6: Incapacitate, which calls no save, posts no card on a hit", await swing({ at: target, key: "incapacitate", rig: HIT, expectCard: false }));
      await run(gm, P.overlay, { on: false });
      await noCard("A7: with the maneuver overlay off a Knock Down hit posts no card", await swing({ at: target, key: "knockDown", rig: HIT, expectCard: false }));
      await run(gm, P.overlay, { on: true });
    }
    skip("A2/A5: the Player seat's Save press, the observer's view and disarm's grip figure are not driven (a second seat and the imported tables are needed)");
  } finally {
    const back = await run(gm, P.ownRestore);
    note("A: overlay setting restored", back.overlay);
    await run(gm, P.rig, {});
    // The tokens are the run's own, tracked above; they leave with the sweep.
    note("A: tokens placed this run", placed.length);
  }
}

/* ---------------------------- run ------------------------------------ */
try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install, { key: KEY });
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, { role: installed.role });
  if (!installed.isGM) blocked("the GM seat did not join as a GM");
  if (!installed.activeGMIsSelf) blocked("another client is the active GM; the cards and tokens would be written there");
  await run(gm, P.ownInstall);
  await stage("setup", setup);
  if (W.sceneA && W.sceneB) {
    await stage("C. the template sheet's Default select (T-0826)", stageTemplate);
    await stage("B. the Follower Card's armour class and morale tooltips (T-0715)", stageBeast);
    await stage("E. a begun fight holds a caster only on its own scene (T-0798)", stageFight);
    await stage("A. the maneuver save card", stageManeuver);
  }
  section("console");
  const d = await run(gm, P.drain);
  check("gm: no console error was recorded since the seat was installed", d.errors.length === 0, d.errors.slice(0, 3));
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    check("walk ran to the end", false);
  }
} finally {
  try { if (gm) note("windows and overlay restored", await run(gm, P.ownRestore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  await finish({ gm, player: null, ledger, fixtureRe: "^owed/", restore: P.restore });
  console.log("fixtures kept: owed/scene-a, owed/scene-b, owed/template, owed/follower-beast, owed/fighter, owed/man-attacker, owed/man-sword, owed/man-target, owed/man-target-monster");
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
