/**
 * Live walk, typed modifiers and their provenance. Covers:
 *
 *   docs/abilities/TESTING.md, "Typed modifiers apply", steps 1-12
 *     (quick effects, the "{roll} only" chip, conditions read from the page or
 *     labelled);
 *   docs/character-sheet/TESTING.md, "The roll modifiers on Stats", and the
 *     Stats tab's light rows;
 *   docs/equipment/TESTING.md, steps 3c (an imported Specialization's pick
 *     made after the kit is drawn) and 3e (style and helmet figures read from
 *     the imported tables, a Ruledata Browser override), and "Armour Training's
 *     step", steps 1-7, with abilities "Editing an imported row" (the
 *     Mechanics tab's Edit, Delete and Add a row controls);
 *   the repertoire change under docs/magic/TESTING.md (a family's caster takes
 *     its class's slots), as one page-context call on an invented payload.
 *
 * Stages: STAGE=1 is the hand-built typed fixtures (abilities steps 1-9, the
 * roll modifiers on Stats, the light rows, the repertoire call); STAGE=2 is
 * what needs the rulebook open and imported (abilities steps 10-12, equipment
 * 3c and 3e, and the three plates), and first maps the RR and JJ, runs Import
 * Tables for the equipment document when its tables are missing, and runs
 * Update Abilities for the Specialization and Armor Training where the
 * library's copies predate their recipes; STAGE=3 is Armour Training's step and the
 * Mechanics row editor. Unset runs all three.
 *
 * Fixtures, kept and found again by marker (`api.fixture`):
 *   abilities/typed-character     a level-3 character the Player seat owns,
 *                                 carrying a heavy armour item, unequipped;
 *   abilities/typed-standing, -gated, -ladder, -pair-a, -pair-b, -hand-ae,
 *   -situational, -scan           ability items embedded on it, each marked
 *                                 (the recipe's pair and handAE, spelled as
 *                                 the driver's markers allow);
 *   character-sheet/surprise-mod  a character with Avoid Surprise stored at 0
 *                                 and an actor effect adding 2 to it;
 *   abilities/clause-character    a level-3 character the Player owns, holding
 *                                 the library's copies (unmarked) of the skills
 *                                 and proficiencies step 11 names and a power
 *                                 whose recipe reads a page condition;
 *   equipment/style-pick          a character trained in the weapon-and-shield
 *                                 style, with a sword, a shield and the
 *                                 library's Fighting Style Specialization;
 *   equipment/style-figures       a character trained in the dual style, with
 *                                 two daggers and a heavy helmet;
 *   equipment/armour-step         the recipe's character, with its two items
 *                                 marked equipment/armour-step-hand (the
 *                                 hand-made one) and equipment/armour-step-row
 *                                 (the copy, which takes the library item's
 *                                 cite when the library records one).
 * Each step brings what it drives to its shape first. Disposable, tracked and
 * swept by this run's own ids: the combat and the chat card the surprise roll
 * makes, the quick effects step 8 starts, and the standing ability step 7
 * deletes and rebuilds, the quick effect the row-editor step starts, the two
 * extra Armour Training copies armour-step 5 adds for rank 3; the
 * rows that step edits on typed-standing are put back in the `finally`, with
 * the armour-step fixture's shape. Settings flipped (overlayEnclosingHelm) and Ruledata
 * overrides this run sets are restored in the `finally`.
 *
 * Machine values arrive through ./_env.mjs; nothing here names a port, a
 * world, a seat or a book path. Every figure typed into a fixture is invented;
 * an imported figure is compared in the page and only the boolean printed.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books, shotDir } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const STAGE = process.env.STAGE ?? "";
const SHOTS = process.env.SHOTS === "1";
const BOOK = "rr";
const BOOKS = books([BOOK, "jj"]);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/** In the page before it loads, so `init`, `setup` and `ready` are all recorded. */
const RECORDER = `(() => {
  const R = (globalThis.__tmBoot = { phase: "load", phases: [], errors: [] });
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
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async ({ player }) => ({
    foundry: game.version,
    module: game.modules.get("acks-extras")?.version ?? null,
    role: game.user.role,
    isGM: game.user.isGM,
    playerId: game.users.getName(player)?.id ?? null,
    boot: globalThis.__tmBoot ?? null,
  }),

  install: async () => {
    const H = (globalThis.__tm = globalThis.__tm ?? {});
    H.MOD = "acks-extras";
    H.TM = await import("/modules/acks-extras/scripts/lib/typed-modifiers.mjs");
    H.EFF = await import("/modules/acks-extras/scripts/equipment/effects.mjs");
    H.ENF = await import("/modules/acks-extras/scripts/equipment/enforce.mjs");
    H.HELM = await import("/modules/acks-extras/scripts/equipment/overlays/enclosing-helm.mjs");
    H.LIGHT = await import("/modules/acks-extras/scripts/lib/light.mjs");
    H.TABLES = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    H.FM = await import("/modules/acks-extras/scripts/lib/frame-model.mjs");
    H.REP = await import("/modules/acks-extras/scripts/magic/repertoire.mjs");
    H.STORE = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        let v = null;
        try { v = await fn(); } catch { v = null; }
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.apps = () => [...foundry.applications.instances.values()];
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.opened = H.opened ?? [];
    H.loc = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
    H.signed = H.FM.signed;
    return "installed";
  },

  /* ---------------- documents and shape ---------------- */

  /** Bring a kept character to a shape: level, stored fields, ownership, armour off. */
  shapeCharacter: async ({ actorId, level = null, stored = {}, ownerId = null, ownerLevel = 3 }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const update = {};
    if (level != null && actor._source.system.details.level !== level) update["system.details.level"] = level;
    for (const [path, value] of Object.entries(stored)) {
      if (foundry.utils.getProperty(actor._source, path) !== value) update[path] = value;
    }
    if (ownerId && actor.ownership?.[ownerId] !== ownerLevel) update[`ownership.${ownerId}`] = ownerLevel;
    if (Object.keys(update).length) await actor.update(update);
    await H.sleep(300);
    return { updated: Object.keys(update) };
  },

  /** Every quick effect on the actor's abilities, by uuid: what a past run left. */
  quickEffects: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    return actor.items.filter((i) => i.type === "ability").flatMap((i) => [...i.effects].filter((e) => e.getFlag("acks-extras", "quickEffect")).map((e) => e.uuid));
  },

  /** An embedded item's effect toggled, by uuid. */
  setDisabled: async ({ uuid, disabled }) => {
    const doc = fromUuidSync(uuid);
    if (!doc) return { found: false };
    if (doc.disabled !== disabled) await doc.update({ disabled });
    await globalThis.__tm.sleep(300);
    return { found: true, disabled: doc.disabled };
  },

  itemIds: async ({ actorId }) => Object.fromEntries(game.actors.get(actorId).items.map((i) => [i.name, i.id])),

  /** Rebuild the loadout now and wait for its changes to stop moving. */
  settle: async ({ actorId }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    try { await H.ENF.refreshLoadout(actor); } catch { /* the hook path still runs */ }
    let last = "";
    let same = 0;
    for (let n = 0; n < 40 && same < 3; n++) {
      await H.sleep(200);
      const now = JSON.stringify(H.EFF.findLoadoutEffect(actor)?.changes ?? []);
      same = now === last ? same + 1 : 0;
      last = now;
    }
    return same >= 3;
  },

  /** The loadout effect's changes, each beside the ledger part that wrote it. */
  parts: async ({ actorId }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const eff = H.EFF.findLoadoutEffect(actor);
    const ledger = eff?.flags?.["acks-extras"]?.loadoutParts ?? [];
    return (eff?.changes ?? []).map((c, i) => ({ key: c.key, type: c.type, value: Number(c.value), ...(ledger[i] ?? {}) }));
  },

  /** What lib resolves for the actor, now: the parts and the listed rows. */
  typed: async ({ actorId }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const loadout = acksExtras.equipment.getLoadout(actor);
    const r = H.TM.standingModifiers(actor, { ctx: { loadout } });
    const name = (id) => actor.items.get(id)?.name ?? null;
    return {
      parts: r.parts.map((p) => ({ name: name(p.itemId), path: p.path, value: p.value })),
      listed: r.listed.map((l) => ({ name: name(l.itemId), target: l.target, reason: l.reason })),
    };
  },

  actorFigures: async ({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      level: a.system.details.level,
      acMod: a.system.ac?.mod ?? null, acValue: a.system.ac?.value ?? null,
      saveMod: a.system.save?.mod ?? null, init: a.system.initiative?.value ?? null,
      avoid: a.system.surprise?.avoidsurprise ?? null, avoidStored: a._source.system.surprise?.avoidsurprise ?? null,
      enc: a.system.encumbrance?.value ?? null,
    };
  },

  /* ---------------- the character sheet ---------------- */

  /** Open the module's character sheet on the actor, on `tab`. */
  openChar: async ({ actorId, tab }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const find = () => H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId) ?? null;
    let app = find();
    if (!app) {
      app = new acksExtras.characterSheet.Sheet({ document: actor });
      H.opened.push(app);
      app.tabGroups.primary = tab;
      await app.render(true);
    }
    await H.poll(() => H.root(find())?.querySelector(".acks-extras-frame__fact, .acks-extras-frame__row"));
    if (app.tabGroups.primary !== tab) app.changeTab(tab, "primary");
    await H.sleep(300);
    return { rendered: !!H.root(find()), id: app.id };
  },

  closeChar: async ({ actorId }) => {
    const H = globalThis.__tm;
    for (const app of H.apps().filter((a) => a.actor?.id === actorId || a.document?.parent?.id === actorId)) {
      try { await app.close({ animate: false }); } catch { /* closed */ }
    }
    return true;
  },

  /** Re-render the sheet and read the Stats tab's throw group and vision rows. */
  stats: async ({ actorId, render = true }) => {
    const H = globalThis.__tm;
    const app = H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId);
    if (!app) return { rendered: false };
    if (app.tabGroups.primary !== "stats") app.changeTab("stats", "primary");
    if (render) { await app.render(); await H.sleep(400); }
    const root = H.root(app);
    const fact = (name) => {
      const input = root.querySelector(`input[name="${name}"]`);
      const f = input?.closest(".acks-extras-frame__fact");
      const n = f?.querySelector(".acks-extras-frame__fact-note");
      return input ? { value: input.value, overridden: input.classList.contains("is-overridden"), inputTip: input.dataset.tooltip ?? "", note: H.text(n).replace(/^·\s*/, ""), tip: n?.dataset.tooltipText ?? "" } : null;
    };
    const subhead = [...root.querySelectorAll(".acks-extras-frame__subhead")].map((s) => H.text(s));
    const order = [...root.querySelectorAll(".acks-extras-frame__subhead ~ .acks-extras-frame__fact input")].map((i) => i.name);
    const vision = [...root.querySelectorAll(".acks-extras-frame__fact")].filter((f) => f.querySelector(".acks-extras-frame__fact-value")).map((f) => {
      const v = f.querySelector(".acks-extras-frame__fact-value");
      return { label: H.text(f.querySelector(".acks-extras-frame__fact-label")), value: H.text(v), tip: v.dataset.tooltipText ?? "" };
    });
    return {
      rendered: true,
      save: fact("system.save.mod"), initiative: fact("system.initiative.mod"),
      others: fact("system.surprise.surpriseothers"), avoid: fact("system.surprise.avoidsurprise"),
      subhead, order, vision,
    };
  },

  /** The Rolls tab's Avoid Surprise row value. */
  rollsAvoid: async ({ actorId }) => {
    const H = globalThis.__tm;
    const app = H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId);
    if (!app) return null;
    app.changeTab("rolls", "primary");
    await app.render();
    await H.sleep(400);
    const row = H.root(app).querySelector('[data-roll="surprise:avoid"] .acks-extras-frame__row-value');
    return row ? H.text(row) : null;
  },

  /** Press a row control on the sheet's Equipment tab and wait for the write. */
  press: async ({ actorId, itemId, action }) => {
    const H = globalThis.__tm;
    const app = H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId);
    if (!app) return { found: false, why: "no sheet" };
    if (app.tabGroups.primary !== "equipment") { app.changeTab("equipment", "primary"); await H.sleep(300); }
    const item = game.actors.get(actorId).items.get(itemId);
    const before = !!item?.system?.equipped;
    const btn = H.root(app).querySelector(`[data-item-id="${itemId}"] button[data-action="${action}"]`);
    if (!btn) return { found: false, why: "no control", equipped: before };
    btn.click();
    const flipped = await H.poll(() => (!!game.actors.get(actorId).items.get(itemId)?.system?.equipped !== before ? true : null), { tries: 30, every: 150 });
    await H.sleep(500);
    return { found: true, flipped: !!flipped, equipped: !!game.actors.get(actorId).items.get(itemId)?.system?.equipped };
  },

  /** Type a level into the Class tab's input and let the sheet submit it. */
  setLevelBySheet: async ({ actorId, level }) => {
    const H = globalThis.__tm;
    const app = H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId);
    if (!app) return { found: false };
    app.changeTab("class", "primary");
    await app.render();
    await H.sleep(400);
    const input = H.root(app).querySelector('input[name="system.details.level"]');
    if (!input) return { found: false, why: "no level input" };
    input.value = String(level);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const ok = await H.poll(() => (game.actors.get(actorId).system.details.level === level ? true : null), { tries: 40, every: 150 });
    return { found: true, level: game.actors.get(actorId).system.details.level, ok: !!ok };
  },

  /** A tooltip held open on the Avoid Surprise note, for the plate. */
  holdTooltip: async ({ actorId, name }) => {
    const H = globalThis.__tm;
    const app = H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId);
    const note = H.root(app)?.querySelector(`input[name="${name}"]`)?.closest(".acks-extras-frame__fact")?.querySelector(".acks-extras-frame__fact-note");
    if (!note) return null;
    note.scrollIntoView({ block: "center" });
    await H.sleep(200);
    game.tooltip.activate(note, { text: note.dataset.tooltipText, direction: "UP" });
    await H.sleep(400);
    return "#" + app.id;
  },

  /* ---------------- the ability sheet ---------------- */

  /** Open an item's sheet on its Mechanics tab and read its effect rows. */
  mech: async ({ uuid, render = true }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    if (!item) return { found: false };
    const app = item.sheet;
    if (!app.rendered) { H.opened.push(app); await app.render(true); }
    await H.poll(() => H.root(app)?.querySelector(".acks-abilities-mechanics"));
    if (app.tabGroups?.primary !== "mechanics") app.changeTab("mechanics", "primary");
    if (render) { await app.render(); await H.sleep(400); }
    const root = H.root(app);
    const rows = [...(root?.querySelectorAll(".acks-abilities-mechanics li") ?? [])].filter((li) => li.querySelector(".acks-abilities-effect-kind")).map((li) => ({
      kind: H.text(li.querySelector(".acks-abilities-effect-kind")),
      text: H.text(li.querySelector(".acks-abilities-effect-text")),
      chips: [...li.querySelectorAll(".acks-abilities-effect-chip")].map((c) => ({ label: H.text(c), tip: c.dataset.tooltipText ?? "" })),
      start: !!li.querySelector('[data-action="quickEffectStart"]'),
      refresh: !!li.querySelector('[data-action="quickEffectRefresh"]'),
    }));
    return { found: true, id: app.id, editable: app.isEditable, rows };
  },

  /** The Mechanics tab body's and the window content's scroll width against their client width. */
  mechWidth: async ({ uuid }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    if (!item) return { found: false };
    const app = item.sheet;
    if (!app.rendered) { H.opened.push(app); await app.render(true); }
    await H.poll(() => H.root(app)?.querySelector(".acks-abilities-mechanics"));
    if (app.tabGroups?.primary !== "mechanics") app.changeTab("mechanics", "primary");
    await H.sleep(400);
    const root = H.root(app);
    const tab = root.querySelector(".acks-abilities-mechanics")?.closest(".tab");
    const content = root.querySelector(".window-content");
    const m = (el) => (el ? { scroll: el.scrollWidth, client: el.clientWidth } : null);
    const fieldsets = [...root.querySelectorAll(".acks-abilities-mechanics")].map(m);
    return { found: true, tab: m(tab), content: m(content), fieldsets, width: Math.round(root.getBoundingClientRect().width) };
  },

  /** Click a Mechanics-tab control on row `index` and wait for the sheet to re-render. */
  mechClick: async ({ uuid, action, index }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    const app = item?.sheet;
    const btn = H.root(app)?.querySelector(`[data-action="${action}"][data-effect-index="${index}"]`);
    if (!btn) return { found: false };
    const effectsBefore = item.effects.size;
    const hook = new Promise((resolve) => {
      const id = Hooks.on("renderApplicationV2", (a) => { if (a === app) { Hooks.off("renderApplicationV2", id); resolve(true); } });
      setTimeout(() => { Hooks.off("renderApplicationV2", id); resolve(false); }, 5000);
    });
    btn.click();
    const rendered = await hook;
    await H.sleep(300);
    return { found: true, rendered, effectsBefore, effectsAfter: fromUuidSync(uuid).effects.size };
  },

  /** The quick effect on an item for a row: its name, disabled, value, flag. */
  quickOf: async ({ uuid }) => {
    const item = fromUuidSync(uuid);
    const e = [...(item?.effects ?? [])].find((x) => x.getFlag("acks-extras", "quickEffect"));
    return e ? { uuid: e.uuid, name: e.name, disabled: e.disabled, transfer: e.transfer, values: e.changes.map((c) => c.value), flag: e.getFlag("acks-extras", "quickEffect") } : null;
  },

  /** Tick or untick a selection pick on the Mechanics tab, by its label. */
  pick: async ({ uuid, labelRe, on }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    const app = item?.sheet;
    const re = new RegExp(labelRe, "i");
    const box = [...(H.root(app)?.querySelectorAll("input[data-selection-pick]") ?? [])].find((b) => re.test(H.text(b.closest("label"))));
    if (!box) return { found: false, picks: [...(H.root(app)?.querySelectorAll("input[data-selection-pick]") ?? [])].map((b) => b.dataset.selectionPick) };
    if (box.checked === on) return { found: true, already: true, key: box.dataset.selectionPick };
    box.click();
    const ok = await H.poll(() => {
      const sel = fromUuidSync(uuid).getFlag("acks-extras", "extras")?.selections ?? [];
      return (sel.includes(box.dataset.selectionPick) === on) ? true : null;
    }, { tries: 40, every: 150 });
    await H.sleep(500);
    return { found: true, ok: !!ok, key: box.dataset.selectionPick };
  },

  closeAll: async () => {
    const H = globalThis.__tm;
    let n = 0;
    for (const app of H?.opened ?? []) { try { await app.close({ animate: false }); n++; } catch { /* closed */ } }
    if (H) H.opened = [];
    try { game.tooltip.deactivate(); } catch { /* none */ }
    return n;
  },

  /* ---------------- core's surprise matrix ---------------- */

  /**
   * Roll surprise from core's Surprise Matrix for the actor. Core opens the
   * matrix from a combat's startCombat; this run's own empty combat opens it
   * once so the matrix class is read off core's window, then a matrix holding
   * the actor alone is rendered and its "fore / forelos" cell clicked, which
   * rolls the adventurers only. The dice read from the top, so the roll is not
   * a surprise and no status lands on the fixture.
   */
  surprise: async ({ actorId }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const made = [];
    const combat = await Combat.create({ scene: null, active: false });
    made.push(combat.uuid);
    await combat.startCombat();
    const first = await H.poll(() => H.apps().find((a) => H.root(a)?.classList?.contains("surprise-matrix-app")));
    if (!first) return { made, opened: false };
    const Matrix = first.constructor;
    await first.close({ animate: false });
    const opponent = { actor: { uuid: "none", system: { surprise: { surpriseothers: 0 } } }, token: null, hidden: false };
    const app = new Matrix({ pools: { secret: [], hostile: [opponent], neutral: [], friendly: [{ actor, token: null, hidden: false }] }, combat: { internalStartCombat: () => null } });
    await app.render(true);
    const btn = await H.poll(() => H.root(app)?.querySelector('[data-action="rollSurprise"][data-adventurer-status="fore"][data-monster-status="forelos"]'));
    if (!btn) return { made, opened: false };
    // The module gathers core's per-combatant messages onto one card and blocks
    // them in a preCreateChatMessage hook it adds at click time; this hook is
    // registered first, so it reads core's own message (and its formula) before
    // the block, and the card that posts after is this user's next message.
    let core = null;
    const seen = (_m, data) => { if (data?.speaker?.actor === actorId && !core) core = String(data.content ?? ""); return true; };
    Hooks.on("preCreateChatMessage", seen);
    const card = new Promise((resolve) => {
      const id = Hooks.on("createChatMessage", (m) => {
        if (m.author?.id === game.user.id) { Hooks.off("createChatMessage", id); resolve(m); }
      });
      setTimeout(() => { Hooks.off("createChatMessage", id); resolve(null); }, 8000);
    });
    const rig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.025;
    let msg = null;
    try {
      btn.click();
      msg = await card;
    } finally {
      CONFIG.Dice.randomUniform = rig;
      Hooks.off("preCreateChatMessage", seen);
    }
    if (msg) made.push(msg.uuid);
    const text = (core ?? "").replace(/<[^>]+>/g, " ");
    const terms = (text.match(/1d6((?:\s*[+-]\s*-?\d+)+)/)?.[1] ?? "").match(/[+-]\s*-?\d+/g) ?? [];
    const nums = terms.map((t) => Number(t.replace(/\s+/g, "").replace(/^\+/, "").replace(/^--/, "")));
    const named = !!msg && H.text(new DOMParser().parseFromString(msg.content ?? "", "text/html").body).includes(actor.name);
    return { made, opened: true, card: !!msg, named, coreSeen: core != null, avoidTerm: nums.length >= 2 ? nums[1] : null, surprised: actor.statuses?.has?.("surprised") ?? null };
  },

  /* ---------------- the core sheet, an unrelated field ---------------- */

  /** On this seat, edit XP on core's own sheet and read the stored Avoid Surprise back. */
  coreSheetEdit: async ({ actorId }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const entry = Object.entries(CONFIG.Actor.sheetClasses.character ?? {}).find(([id]) => id.startsWith("acks."));
    if (!entry) return { found: false, why: "no core sheet" };
    const app = new entry[1].cls({ document: actor });
    H.opened.push(app);
    await app.render(true);
    const input = await H.poll(() => H.root(app)?.querySelector('input[name="system.details.xp.value"]'));
    if (!input) return { found: false, why: "no xp input" };
    const before = { xp: actor._source.system.details.xp?.value ?? null, avoid: actor._source.system.surprise.avoidsurprise };
    input.value = String(Number(before.xp ?? 0) + 1);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const wrote = await H.poll(() => (game.actors.get(actorId)._source.system.details.xp?.value !== before.xp ? true : null), { tries: 40, every: 150 });
    await H.sleep(500);
    try { await app.close({ animate: false }); } catch { /* closed */ }
    const after = { xp: actor._source.system.details.xp?.value ?? null, avoid: actor._source.system.surprise.avoidsurprise };
    return { found: true, wrote: !!wrote, before, after };
  },

  setXp: async ({ actorId, xp }) => {
    const actor = game.actors.get(actorId);
    if (actor._source.system.details.xp?.value !== xp) await actor.update({ "system.details.xp.value": xp });
    return actor._source.system.details.xp?.value;
  },

  /* ---------------- imports, the library, the book ---------------- */

  importCensus: async ({ ids }) => {
    const H = globalThis.__tm;
    await H.LIB.whenReady();
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const eq = H.TABLES.hasDoc("equipment") ? H.TABLES.getDoc("equipment") : null;
    const helm = H.HELM.helmFigures();
    return {
      bookOpen: !!CB.cookbookSessionDoc?.("rr"),
      equipmentDoc: !!eq,
      heavyHelm: helm.surprise != null && helm.listening != null && helm.mortalWounds != null,
      heavyHelmCite: !!H.TABLES.citeOf("equipment", "heavyHelm"),
      dualStyle: H.EFF.dualStyleFigure() != null,
      dualStyleCite: !!H.TABLES.citeOf("equipment", "dualWeaponStyle"),
      overrides: { heavyHelm: H.STORE.hasOverride("equipment", "heavyHelm"), dualWeaponStyle: H.STORE.hasOverride("equipment", "dualWeaponStyle") },
      library: Object.fromEntries(ids.map((id) => [id, !!H.LIB.byCookbookId("Item", id)])),
      overlay: game.settings.get("acks-extras", "overlayEnclosingHelm"),
      lightImported: H.LIGHT.lightFigures("torch").dim != null,
      lightCite: !!H.LIGHT.lightCite(),
    };
  },

  connectBook: async ({ id, path }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    if (CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__tmBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__tmBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__tmBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  /** Who is seated: the active users' roles, and whether each is this seat. */
  seated: async () => game.users.filter((u) => u.active).map((u) => ({ role: u.role, me: u.id === game.user.id })),

  /**
   * Import Tables for the given ruledata documents, the action Manage Imports
   * runs, with what it tells the Judge recorded: its notifications name the
   * documents and tables read or missed, never a figure.
   */
  importTables: async ({ only }) => {
    const said = [];
    const N = ui.notifications;
    const keep = { info: N.info, warn: N.warn, error: N.error };
    for (const level of Object.keys(keep)) N[level] = function (msg, ...rest) { said.push({ level, msg: String(msg) }); return keep[level].call(this, msg, ...rest); };
    let ok = true;
    let error = null;
    try {
      const fn = acksExtras.importer.cookbookImportTables;
      if (typeof fn !== "function") return { found: false };
      await fn(only);
    } catch (e) {
      ok = false;
      error = String(e?.message ?? e);
    } finally {
      Object.assign(N, keep);
    }
    return { found: true, ok, error, said };
  },

  bookState: async ({ id }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    return { ...globalThis.__tmBook, open: !!CB.cookbookSessionDoc(id) };
  },

  /** Give the actor the library's copy of each id it does not hold yet. Returns the uuid of each, by id. */
  ensureLibrary: async ({ actorId, ids }) => {
    const H = globalThis.__tm;
    await H.LIB.whenReady();
    const actor = game.actors.get(actorId);
    const held = (id) => actor.items.find((i) => i.getFlag("acks-extras", "cookbook")?.id === id);
    const add = [];
    for (const id of ids) {
      if (held(id)) continue;
      const src = H.LIB.byCookbookId("Item", id);
      if (!src) continue;
      const data = src.toObject();
      delete data._id;
      delete data.folder;
      add.push(data);
    }
    const made = add.length ? await actor.createEmbeddedDocuments("Item", add) : [];
    await H.sleep(500);
    return { added: made.map((m) => m.uuid), uuids: Object.fromEntries(ids.map((id) => [id, held(id)?.uuid ?? null])) };
  },

  /** Run Update Abilities for these ids, fired and polled: a dialog it opens is reported, never answered. */
  updateAbilities: async ({ ids }) => {
    const H = globalThis.__tm;
    globalThis.__tmUpd = { done: false };
    const before = new Set(H.apps().map((a) => a.id));
    acksExtras.importer.cookbookUpdateAbilities({ only: new Set(ids) })
      .then(() => { globalThis.__tmUpd = { done: true, ok: true }; })
      .catch((e) => { globalThis.__tmUpd = { done: true, ok: false, error: String(e?.message ?? e) }; });
    const done = await H.poll(() => (globalThis.__tmUpd.done ? true : null), { tries: 600, every: 250 });
    const dialogs = H.apps().filter((a) => !before.has(a.id) && a.rendered && /dialog/i.test(a.constructor.name)).map((a) => a.title);
    return { done: !!done, ...globalThis.__tmUpd, dialogs };
  },

  /**
   * The Mechanics rows of each ability against what its copy holds: whether a
   * conditioned row shows a condition, whether a limitation, outcome or
   * capability row reads text, and the scoped chips. Booleans and counts, no
   * row's words.
   */
  clauseAudit: async ({ uuids }) => {
    const H = globalThis.__tm;
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const out = {};
    for (const [id, uuid] of Object.entries(uuids)) {
      const item = fromUuidSync(uuid);
      if (!item) { out[id] = { found: false }; continue; }
      const app = item.sheet;
      H.opened.push(app);
      await app.render(true);
      await H.poll(() => H.root(app)?.querySelector(".acks-abilities-mechanics"));
      app.changeTab("mechanics", "primary");
      await H.sleep(300);
      const effects = item.getFlag("acks-extras", "extras")?.effects ?? [];
      const lis = [...H.root(app).querySelectorAll(".acks-abilities-mechanics li")].filter((li) => li.querySelector(".acks-abilities-effect-kind"));
      const entrySpecs = CB.cookbookEntry?.(id)?.entry?.fields?.effects?.specs ?? [];
      const rows = effects.map((e, i) => {
        const li = lis[i];
        const text = H.text(li?.querySelector(".acks-abilities-effect-text"));
        const chips = [...(li?.querySelectorAll(".acks-abilities-effect-chip") ?? [])].map((c) => ({ label: H.text(c), tip: c.dataset.tooltipText ?? "" }));
        return {
          type: e.type,
          hasCondition: "condition" in e && e.condition !== undefined && e.condition !== null,
          conditionEmpty: typeof e.condition === "string" && !e.condition.trim(),
          conditionShown: !e.condition || text.includes(e.condition),
          scoped: !!e.appliesToRoll,
          scopeChip: !!e.appliesToRoll && chips.some((c) => / only$/.test(c.label) && c.tip.includes(c.label.replace(/ only$/, ""))),
          disposition: chips.find((c) => !/ only$/.test(c.label) && c.label !== H.loc("ACKS-ABILITIES.mech.unverified"))?.label ?? null,
          text: text.length > 0 && text !== "—",
          outcomeNatural: e.type !== "outcome" || /^(natural|on failure|result below)/i.test(text),
          capabilityText: !["capability", "limitation"].includes(e.type) || (text && text !== "—" && text !== "see description"),
        };
      });
      out[id] = {
        found: true,
        rows: rows.length,
        domRows: lis.length,
        recipeConditions: entrySpecs.filter((s) => s?.conditionFrom).length,
        shownConditions: rows.filter((r) => r.hasCondition && !r.conditionEmpty).length,
        emptyConditions: rows.filter((r) => r.conditionEmpty).length,
        hidden: rows.filter((r) => !r.conditionShown).length,
        emptyRows: rows.filter((r) => !r.text).length,
        badOutcomes: rows.filter((r) => !r.outcomeNatural).length,
        badLimits: rows.filter((r) => !r.capabilityText).length,
        scoped: rows.filter((r) => r.scoped).length,
        scopeChips: rows.filter((r) => r.scopeChip).length,
        scopedDispositions: rows.filter((r) => r.scoped).map((r) => r.disposition),
        // The shape of each row the audit flags, never its words: the page's
        // clauses are imported, so they stay in the page.
        hiddenShapes: effects.map((e, i) => [e, rows[i]]).filter(([, r]) => !r.conditionShown).map(([e]) => ({ type: e.type, hasNote: !!e.note, hasRestriction: !!e.restriction, hasFrequency: !!e.frequency })),
        outcomeShapes: effects.map((e, i) => [e, rows[i]]).filter(([, r]) => !r.outcomeNatural).map(([e]) => ({ trigger: e.trigger ?? null, naturalMax: Number.isFinite(e.naturalMax), belowFraction: Number.isFinite(e.belowFraction) })),
      };
      try { await app.close({ animate: false }); } catch { /* closed */ }
    }
    return out;
  },

  /** The loadout parts that name a table, with the figures they should carry. */
  tableParts: async ({ actorId }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const eff = H.EFF.findLoadoutEffect(actor);
    const ledger = eff?.flags?.["acks-extras"]?.loadoutParts ?? [];
    const parts = (eff?.changes ?? []).map((c, i) => ({ key: c.key, value: Number(c.value), ...(ledger[i] ?? {}) }));
    const helm = parts.find((p) => p.table === "heavyHelm");
    const dual = parts.find((p) => p.table === "dualWeaponStyle");
    const figures = H.HELM.helmFigures();
    const api = acksExtras.equipment.HELM_MODIFIERS;
    const src = (p) => (p ? H.EFF.partSource(p) : null);
    return {
      helm: !!helm, helmKey: helm?.key ?? null, helmMatches: !!helm && helm.value === figures.surprise, helmLabel: helm?.labelKey ?? null,
      dual: !!dual, dualKey: dual?.key ?? null, dualMatches: !!dual && dual.value === H.EFF.dualStyleFigure(),
      apiMatches: api.surprise === figures.surprise && api.listening === figures.listening && api.mortalWounds === figures.mortalWounds && api.surprise != null,
      helmSource: src(helm) ? Object.keys(src(helm)) : null, dualSource: src(dual) ? Object.keys(src(dual)) : null,
      helmValue: helm?.value ?? null, dualValue: dual?.value ?? null,
      cite: H.TABLES.citeOf("equipment", "heavyHelm") ?? null,
    };
  },

  /** The expected Stats lines for a cited table part, built from the lang and the import. */
  citedLine: async ({ labelKey, table, value }) => {
    const H = globalThis.__tm;
    const cite = H.TABLES.citeOf("equipment", table);
    return {
      cited: cite ? H.loc("ACKS-CHARACTER.stats.partCited", { label: H.loc(labelKey), value: H.signed(value), cite }) : null,
      judge: H.loc("ACKS-CHARACTER.stats.partJudge", { label: H.loc(labelKey), value: H.signed(value) }),
    };
  },

  /** In the Ruledata Browser, Edit a table's JSON, set one field, and Save. */
  ruledataEdit: async ({ key, field, choose }) => {
    const H = globalThis.__tm;
    acksExtras.location.openRuledataBrowser();
    const app = await H.poll(() => H.apps().find((a) => a.rendered && H.root(a)?.classList?.contains("ruledata-browser") && H.root(a).querySelector("tr[data-entry-key]")), { tries: 80, every: 200 });
    if (!app) return { browser: false };
    H.opened.push(app);
    const row = H.root(app).querySelector(`tr[data-entry-key="${key}"]`);
    if (!row) return { browser: true, row: false };
    row.querySelector('[data-action="editEntry"]').click();
    const dlg = await H.poll(() => H.apps().find((a) => a.rendered && H.root(a)?.classList?.contains("acks-location-ruledata-edit") && H.root(a).querySelector("textarea[name=json]")), { tries: 40, every: 150 });
    if (!dlg) return { browser: true, row: true, dialog: false };
    const ta = H.root(dlg).querySelector("textarea[name=json]");
    const data = JSON.parse(ta.value);
    const had = field in data;
    const value = Number(data[field]) === choose[0] ? choose[1] : choose[0];
    data[field] = value;
    ta.value = JSON.stringify(data, null, 2);
    const ok = H.root(dlg).querySelector('button[data-action="ok"]');
    if (!ok) return { browser: true, row: true, dialog: true, okButton: false };
    ok.click();
    const [docId, tableId] = key.split(".");
    const set = await H.poll(() => (H.STORE.hasOverride(docId, tableId) ? true : null), { tries: 40, every: 150 });
    await H.sleep(500);
    return { browser: true, row: true, dialog: true, had, set: !!set, value };
  },

  /** The browser row's Revert, which clears this run's override. */
  ruledataRevert: async ({ key }) => {
    const H = globalThis.__tm;
    const [docId, tableId] = key.split(".");
    let app = H.apps().find((a) => a.rendered && H.root(a)?.classList?.contains("ruledata-browser"));
    if (!app) {
      acksExtras.location.openRuledataBrowser();
      app = await H.poll(() => H.apps().find((a) => a.rendered && H.root(a)?.classList?.contains("ruledata-browser") && H.root(a).querySelector("tr[data-entry-key]")), { tries: 80, every: 200 });
      if (app) H.opened.push(app);
    }
    await app?.render();
    await H.sleep(300);
    const btn = H.root(app)?.querySelector(`tr[data-entry-key="${key}"] [data-action="revertEntry"]`);
    if (btn) btn.click();
    const cleared = await H.poll(() => (!H.STORE.hasOverride(docId, tableId) ? true : null), { tries: 40, every: 150 });
    return { button: !!btn, cleared: !!cleared };
  },

  clearOverride: async ({ docId, tableId }) => {
    const H = globalThis.__tm;
    if (H.STORE.hasOverride(docId, tableId)) await H.STORE.clearOverride(docId, tableId);
    return !H.STORE.hasOverride(docId, tableId);
  },

  setSetting: async ({ key, value }) => {
    if (game.settings.get("acks-extras", key) !== value) await game.settings.set("acks-extras", key, value);
    return game.settings.get("acks-extras", key);
  },

  /* ---------------- Armour Training's step ---------------- */

  /**
   * Bring the armour-step fixture to a shape: the actor's ceiling very light,
   * each item's rank, the copy's one armour row with `rowValue`, the hand-made
   * one's rows `handRows`, and (where given) the cite the copy records.
   */
  armourShape: async ({ actorId, handId, rowId, ownerId, handQty = 1, rowQty = 1, rowValue = { kind: "flat", flat: 2 }, handRows = [], cite = null }) => {
    const H = globalThis.__tm;
    const actor = game.actors.get(actorId);
    const up = {};
    if (actor.getFlag("acks-extras", "armorMax") !== "veryLight") up["flags.acks-extras.armorMax"] = "veryLight";
    if (ownerId && actor.ownership?.[ownerId] !== 3) up[`ownership.${ownerId}`] = 3;
    if (Object.keys(up).length) await actor.update(up);
    const row = { type: "modifies", refs: ["kw:armorproficiency"], domain: "armor", value: rowValue, mode: "add" };
    await actor.items.get(handId).update({ "flags.acks-extras.extras.qty": handQty, "flags.acks-extras.extras.effects": handRows });
    const upd = { "flags.acks-extras.extras.qty": rowQty, "flags.acks-extras.extras.effects": [row] };
    if (cite !== null) upd["flags.acks-extras.cookbook.cite"] = cite;
    await actor.items.get(rowId).update(upd);
    await H.sleep(600);
    return { updated: Object.keys(up) };
  },

  /** The library's imported Armor Training: its sheet's armour row index and whether it records a cite. */
  armourLibrary: async () => {
    const H = globalThis.__tm;
    try { await H.LIB.whenReady?.(); } catch { /* not ready */ }
    const item = H.LIB.byCookbookId?.("Item", "def.prof.armorTraining") ?? null;
    if (!item) return { found: false };
    const rows = item.getFlag("acks-extras", "extras")?.effects ?? [];
    const index = rows.findIndex((r) => r?.type === "modifies" && r.domain === "armor");
    return { found: true, uuid: item.uuid, index, hasCite: !!item.flags?.["acks-extras"]?.cookbook?.cite, cite: item.flags?.["acks-extras"]?.cookbook?.cite ?? "" };
  },

  /**
   * The Stats tab's armour-step lines and lit armour rungs, with each line
   * held to what `expect` (by label) says it should read: `null` for a step not
   * imported, or `{step, rank, cite}`. Figures are compared here, not printed.
   */
  armourStats: async ({ actorId, expect = {}, render = true }) => {
    const H = globalThis.__tm;
    H.PROF = H.PROF ?? (await import("/modules/acks-extras/scripts/equipment/proficiency.mjs"));
    const actor = game.actors.get(actorId);
    let app = H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-character-sheet") && a.actor?.id === actorId);
    if (!app) {
      app = new acksExtras.characterSheet.Sheet({ document: actor });
      H.opened.push(app);
      app.tabGroups.primary = "stats";
      await app.render(true);
      await H.poll(() => H.root(app)?.querySelector(".acks-extras-frame__fact"));
    }
    if (app.tabGroups.primary !== "stats") app.changeTab("stats", "primary");
    if (render) { await app.render(); await H.sleep(400); }
    const root = H.root(app);
    const rows = [...root.querySelectorAll(".acks-extras-frame__fact")].filter((f) => f.querySelector(".fa-arrow-up-wide-short")).map((f) => {
      const v = f.querySelector(".acks-extras-frame__fact-value");
      const n = v?.querySelector(".acks-extras-frame__fact-note");
      const value = n ? H.text(v).replace(H.text(n), "").trim() : H.text(v);
      return { label: H.text(f.querySelector(".acks-extras-frame__fact-label")), value, note: H.text(n).replace(/^·\s*/, ""), tip: v?.dataset.tooltipText ?? "" };
    });
    // An expectation per label, or a list of them when several copies share the label: a row is ok when it meets one.
    const meets = (r, e) => {
      if (e === null) return r.value === "" && r.note === H.loc("ACKS-CHARACTER.stats.armourStepNotImported") && r.tip === H.loc("ACKS-CHARACTER.stats.armourStepNotImportedTip");
      const parts = { step: String(e.step), rank: String(e.rank), steps: H.signed(e.step * e.rank) };
      const tip = e.cite ? H.loc("ACKS-CHARACTER.stats.armourStepTip", { ...parts, cite: e.cite }) : H.loc("ACKS-CHARACTER.stats.armourStepTipRow", parts);
      return r.value === parts.steps && r.note === "" && r.tip === tip;
    };
    for (const r of rows) {
      if (!(r.label in expect)) continue;
      const es = Array.isArray(expect[r.label]) ? expect[r.label] : [expect[r.label]];
      r.ok = es.some((e) => meets(r, e));
      const e = es.find((x) => x && meets(r, x));
      r.cited = !!e?.cite && r.tip.includes(e.cite);
    }
    const sub = [...root.querySelectorAll(".acks-extras-frame__subhead")].find((s) => H.text(s).startsWith(H.loc("ACKS-CHARACTER.stats.armour")));
    const lit = [...(sub?.nextElementSibling?.querySelectorAll(".acks-extras-frame__pill.is-on") ?? [])].map((p) => H.text(p));
    // The tips are compared above; the cite is the import's, so a row's tip leaves the page as a length.
    return { rendered: true, max: H.PROF.armorMax(actor), lit, rows: rows.map((r) => ({ ...r, tip: r.tip.length })) };
  },

  /** The Mechanics tab's row controls on an item's sheet, on this seat. */
  mechControls: async ({ uuid }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    const app = item.sheet;
    if (!app.rendered) { H.opened.push(app); await app.render(true); }
    await H.poll(() => H.root(app)?.querySelector(".acks-abilities-mechanics"));
    if (app.tabGroups?.primary !== "mechanics") app.changeTab("mechanics", "primary");
    await app.render();
    await H.sleep(400);
    const root = H.root(app);
    const n = (a) => root.querySelectorAll(`[data-action="${a}"]`).length;
    return { editable: app.isEditable, isGM: game.user.isGM, edit: n("effectEdit"), del: n("effectDelete"), add: n("effectAdd"), rows: (item.getFlag("acks-extras", "extras")?.effects ?? []).length };
  },

  /** The open effect-row editor on an item's row, if any. */
  editorOf: async ({ uuid, index }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    const app = H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-effect-editor") && String(a.store?.key ?? "").startsWith(item.uuid + ":") && a.index === index);
    if (!app) return { open: false };
    const root = H.root(app);
    const val = (name) => root.querySelector(`[name="${name}"]`)?.value ?? null;
    const flat = root.querySelector('input[name="value.flat"]');
    const row = (item.getFlag("acks-extras", "extras")?.effects ?? [])[index] ?? null;
    return {
      open: true, id: app.id, titled: String(app.title).startsWith(item.name), type: val("type"), domain: val("domain"), kind: val("value.kind"),
      flatNumeric: flat?.type === "number", flatMatchesRow: !!flat && flat.value !== "" && Number(flat.value) === Number(typeof row?.value === "number" ? row.value : row?.value?.flat),
      // The stored value's shape, never its figure: a bare number, or a LevelValue's kind and its flat's type.
      flatEmpty: !flat || flat.value === "",
      rowValueShape: row?.value && typeof row.value === "object" ? `levelValue:${row.value.kind ?? "?"}:${typeof row.value.flat}` : typeof row?.value,
    };
  },

  /** Press Edit on a Mechanics row, or Add a row, and wait for its editor. */
  editorOpen: async ({ uuid, index = null }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    const root = H.root(item.sheet);
    const before = (item.getFlag("acks-extras", "extras")?.effects ?? []).length;
    const btn = index === null ? root?.querySelector('[data-action="effectAdd"]') : root?.querySelector(`[data-action="effectEdit"][data-index="${index}"]`);
    if (!btn) return { found: false };
    btn.click();
    const at = index ?? before;
    const app = await H.poll(() => H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-effect-editor") && String(a.store?.key ?? "").startsWith(item.uuid + ":") && a.index === at && a.rendered), { tries: 50, every: 150 });
    await H.sleep(300);
    return { found: true, open: !!app, index: at, rows: (fromUuidSync(uuid).getFlag("acks-extras", "extras")?.effects ?? []).length };
  },

  /** Type into the open editor's fields one by one, each a change event, and wait for each write and re-render. */
  editorSet: async ({ uuid, index, sets }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    const find = () => H.apps().find((a) => H.root(a)?.classList?.contains("acks-extras-effect-editor") && String(a.store?.key ?? "").startsWith(item.uuid + ":") && a.index === index);
    const done = [];
    for (const [name, value] of sets) {
      const app = find();
      const el = H.root(app)?.querySelector(`[name="${name}"]`);
      if (!el) { done.push({ name, found: false }); continue; }
      const rendered = new Promise((resolve) => {
        const id = Hooks.on("renderApplicationV2", (a) => { if (a === app) { Hooks.off("renderApplicationV2", id); resolve(true); } });
        setTimeout(() => { Hooks.off("renderApplicationV2", id); resolve(false); }, 5000);
      });
      el.value = String(value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      done.push({ name, found: true, rendered: await rendered });
      await H.sleep(300);
    }
    const row = (fromUuidSync(uuid).getFlag("acks-extras", "extras")?.effects ?? [])[index] ?? null;
    return { done, row };
  },

  /** Press Delete on a Mechanics row and answer the confirmation yes. */
  effectDelete: async ({ uuid, index }) => {
    const H = globalThis.__tm;
    const item = fromUuidSync(uuid);
    const before = (item.getFlag("acks-extras", "extras")?.effects ?? []).length;
    const btn = H.root(item.sheet)?.querySelector(`[data-action="effectDelete"][data-index="${index}"]`);
    if (!btn) return { found: false };
    btn.click();
    const title = H.loc("ACKS-LIB.effectEditor.deleteTitle");
    const dlg = await H.poll(() => H.apps().find((a) => a instanceof foundry.applications.api.DialogV2 && a.title === title && H.root(a)?.querySelector('button[data-action="yes"]')));
    if (!dlg) return { found: true, asked: false };
    H.root(dlg).querySelector('button[data-action="yes"]').click();
    const ok = await H.poll(() => ((fromUuidSync(uuid).getFlag("acks-extras", "extras")?.effects ?? []).length === before - 1 ? true : null), { tries: 40, every: 150 });
    await H.sleep(400);
    return { found: true, asked: true, removed: !!ok };
  },

  /** `n` more hand-made ability copies named `name` on the actor: rank is the count of same-named copies. */
  addCopies: async ({ actorId, name, n }) => {
    const made = await game.actors.get(actorId).createEmbeddedDocuments("Item", Array.from({ length: n }, () => ({ name, type: "ability", flags: { "acks-extras": { extras: { qty: 1 } } } })));
    await globalThis.__tm.sleep(400);
    return made.map((i) => i.uuid);
  },

  /** An item's typed rows, as stored. */
  rowsOf: async ({ uuid }) => foundry.utils.deepClone(fromUuidSync(uuid)?.getFlag("acks-extras", "extras")?.effects ?? null),

  /** Put an item's typed rows back as they were. */
  setRows: async ({ uuid, rows }) => {
    const item = fromUuidSync(uuid);
    if (JSON.stringify(item.getFlag("acks-extras", "extras")?.effects ?? null) !== JSON.stringify(rows)) await item.update({ "flags.acks-extras.extras.effects": rows });
    await globalThis.__tm.sleep(300);
    return JSON.stringify(fromUuidSync(uuid).getFlag("acks-extras", "extras")?.effects ?? null) === JSON.stringify(rows);
  },

  closeEditors: async () => {
    const H = globalThis.__tm;
    let n = 0;
    for (const a of H.apps().filter((x) => H.root(x)?.classList?.contains("acks-extras-effect-editor"))) { try { await a.close({ animate: false }); n++; } catch { /* closed */ } }
    return n;
  },

  menuRestricted: async () => !!game.settings.menus.get("acks-extras.ruledataBrowser")?.restricted,

  /** A family caster's payload: a class name and a level, no slot block. */
  repertoire: async () => {
    const H = globalThis.__tm;
    await H.LIB.whenReady();
    const cls = H.LIB.libraryItems().find((i) => i.type === "acks-extras.class" && (i.system?.casting ?? []).length && H.REP.slotsOfClass(i, 3));
    if (!cls) return { classFound: false };
    const payload = { system: {}, items: [], flags: { "acks-extras": { extras: { spellcasting: { class: cls.name, level: 3 } } } } };
    const drawn = H.REP.fillGeneratedRepertoire(payload);
    const slots = H.REP.slotsOfClass(cls, 3);
    const want = Object.values(slots).reduce((a, b) => a + b, 0);
    return { classFound: true, enabled: payload.system?.spells?.enabled === true, drawn, slotsMatch: Object.entries(slots).every(([n, m]) => payload.system.spells[n]?.max === m), want, spellItems: payload.items.filter((i) => i.type === "spell").length };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */

async function run(api, fn, args = {}) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 300) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment?.getLoadout && !!globalThis.acksExtras?.characterSheet?.Sheet && !!globalThis.acksExtras?.lib?.tables && !!globalThis.acksExtras?.location?.openRuledataBrowser && !!globalThis.acksExtras?.importer?.cookbookUpdateAbilities`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A second DevTools client on the GM seat, for the boot recorder. */
async function rawSeat(port) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(webSocketDebuggerUrl);
    w.addEventListener("open", () => resolve(w));
    w.addEventListener("error", () => reject(new Error("raw seat: socket error")));
  });
  const cdp = new Cdp(ws);
  const isGame = (u) => { try { return new URL(u).pathname.endsWith("/game"); } catch { return false; } };
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && isGame(t.url));
  if (pages.length !== 1) { ws.close(); throw new Error(`raw seat: ${pages.length} game pages`); }
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
  return { send: (method, params = {}) => cdp.send(method, params, sessionId), close() { try { ws.close(); } catch { /* closed */ } } };
}

const seats = {};
async function seat(key, { recorder = false } = {}) {
  const api = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`ready (${key}) after (s)`, await ready(api, key));
  if (recorder) {
    const raw = await rawSeat(PORTS[key]);
    await raw.send("Page.enable");
    await raw.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
    await raw.send("Page.reload");
    await sleep(1500);
    raw.close();
    note(`${key} reloaded under the recorder, ready after (s)`, await ready(api, key));
  }
  return api;
}

/* ---------------- fixtures ---------------- */

const mod = (over) => ({ type: "modifier", appliesTo: "self", ...over });
const ability = (name, effects, extras = {}, more = {}) => ({
  name, type: "ability",
  flags: { "acks-extras": { extras: { effects, effectsFrom: "recipe", ...extras } } },
  ...more,
});
const TYPED = {
  standing: ability("QA Typed Standing", [mod({ target: "ac", value: 1 }), mod({ target: "surprise", value: 1 })]),
  gated: ability("QA Typed Gated", [mod({ target: "initiative", value: 3, gate: { kind: "lightlyEquipped", armourMax: "light", loadMax: 6 } })]),
  ladder: ability("QA Typed Ladder", [mod({ target: "ac", value: { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 4, value: 2 }] } })]),
  pairA: ability("QA Typed Pair A", [mod({ target: "initiative", value: 1, notStacksWith: ["kw:qatypedpairb"] })]),
  pairB: ability("QA Typed Pair B", [mod({ target: "initiative", value: 2 })], { provides: ["kw:qatypedpairb"] }),
  handAE: ability("QA Typed Hand", [mod({ target: "ac", value: 1 })], {}, {
    effects: [{ name: "QA Typed Hand AC", transfer: true, disabled: false, changes: [{ key: "system.ac.mod", type: "add", value: "3", priority: 20 }] }],
  }),
  situational: ability("QA Typed Situational", [mod({ target: "save", value: 2, condition: "situational" })]),
  scan: ability("QA Typed Scan", [mod({ target: "save", value: 1 })], { effectsFrom: "scan" }),
};
/** The marker tail of each typed fixture: the driver takes lowercase letters, digits and dashes. */
const MARK = { standing: "standing", gated: "gated", ladder: "ladder", pairA: "pair-a", pairB: "pair-b", handAE: "hand-ae", situational: "situational", scan: "scan" };
const owned = (playerId) => ({ default: 0, [playerId]: 3 });

const LIBRARY = {
  lockpicking: "def.skill.lockpicking",
  trapbreaking: "def.skill.trapbreaking",
  searching: "def.skill.searching",
  shadowySenses: "def.skill.shadowySenses",
  sneaking: "def.skill.sneaking",
  climbing: "def.skill.climbing",
  berserkergang: "def.prof.berserkergang",
  power: "def.power.auraOfProtection",
  fss: "def.prof.fightingStyleSpecialization",
};

const disposable = [];
const restore = { settings: {}, overrides: [] };
let gm = null;
let player = null;
const ids = {};

const tooltipHas = (tip, s) => typeof tip === "string" && typeof s === "string" && tip.includes(s);

try {
  section("seats");
  gm = await seat("gm", { recorder: true });
  const census = await run(gm, P.census, { player: SEATS.player });
  note("census (gm)", { foundry: census.foundry, module: census.module, isGM: census.isGM, player: !!census.playerId });
  check("the GM seat ran init, setup and ready under the recorder with no error", census.boot?.phases?.length === 3 && census.boot.errors.length === 0, census.boot);
  note("install (gm)", await run(gm, P.install));
  player = await seat("player");
  note("install (player)", await run(player, P.install));
  const playerId = census.playerId;
  if (!playerId) throw new Error("the player seat's user is not in the world");

  if (STAGE === "" || STAGE === "1") {
    /* ============ STAGE 1: the hand-built typed fixtures ============ */
    section("fixtures: abilities/typed-*");
    const ch = await gm.fixture("abilities/typed-character", "Actor", {
      name: "QA Typed Character", type: "character", ownership: owned(playerId),
      system: { details: { level: 3 }, save: { mod: 0 }, initiative: { mod: 0 }, surprise: { avoidsurprise: 0, surpriseothers: 0 }, ac: { mod: 0 } },
      items: [{ name: "Plate Armor", type: "armor", system: { type: "heavy", ac: { value: 6 }, weight6: 6, equipped: false } }],
    });
    ids.typed = ch.id;
    const fx = {};
    for (const [k, data] of Object.entries(TYPED)) fx[k] = await gm.fixture(`abilities/typed-${MARK[k]}`, "Item", data, { parent: ch.uuid });
    const items = await run(gm, P.itemIds, { actorId: ch.id });
    const armourId = items["Plate Armor"];
    if (!armourId) throw new Error("abilities/typed-character carries no Plate Armor: rebuild the fixture");
    // Shape: level 3, stored fields zero, the player owns it, armour off, no quick effect a past run left, the hand-made effect on.
    note("shape", await run(gm, P.shapeCharacter, { actorId: ch.id, level: 3, stored: { "system.save.mod": 0, "system.initiative.mod": 0, "system.surprise.avoidsurprise": 0, "system.ac.mod": 0 }, ownerId: playerId }));
    const leftover = await run(gm, P.quickEffects, { actorId: ch.id });
    for (const uuid of leftover) { gm.track(uuid, "ActiveEffect"); disposable.push(uuid); }
    if (leftover.length) note("quick effects a past run left, swept", await gm.sweepTracked({ only: leftover }));
    const handEff = await gm.eval(`(() => { const i = fromUuidSync(${JSON.stringify(fx.handAE.uuid)}); return [...i.effects].find((e) => !e.getFlag("acks-extras", "quickEffect"))?.uuid ?? null; })()`);
    if (!handEff) throw new Error("abilities/typed-handAE carries no hand-made effect: rebuild the fixture");
    note("hand effect on", await run(gm, P.setDisabled, { uuid: handEff, disabled: false }));
    note("open sheet", await run(gm, P.openChar, { actorId: ch.id, tab: "equipment" }));
    const armourState = await run(gm, P.press, { actorId: ch.id, itemId: armourId, action: "toggleEquip" });
    if (armourState.found && armourState.equipped) note("armour back off", await run(gm, P.press, { actorId: ch.id, itemId: armourId, action: "toggleEquip" }));
    note("settled", await run(gm, P.settle, { actorId: ch.id }));
    note("figures", await run(gm, P.actorFigures, { actorId: ch.id }));

    section("abilities 1. the Stats tooltips name each applied ability");
    const s1 = await run(gm, P.stats, { actorId: ch.id });
    check("Initiative's tooltip names the gated ability and the larger of the pair with their figures", tooltipHas(s1.initiative?.tip, "QA Typed Gated +3") && tooltipHas(s1.initiative?.tip, "QA Typed Pair B +2"), s1.initiative);
    check("Avoid Surprise's tooltip names the standing ability with its figure", tooltipHas(s1.avoid?.tip, "QA Typed Standing +1"), s1.avoid);
    check("the save tooltip marks the scan's part (unverified)", tooltipHas(s1.save?.tip, "QA Typed Scan +1 (unverified)"), s1.save);
    check("the save tooltip lists the situational one under not applied, with its reason", tooltipHas(s1.save?.tip, "not applied: ") && tooltipHas(s1.save?.tip, "QA Typed Situational (situational)"), s1.save);
    check("the save row shows the figure in force beside its input (stored 0, the scan's +1)", s1.save?.value === "0" && s1.save?.note === "+1", s1.save);

    section("abilities 2. core's Surprise Matrix rolls with the standing part");
    const fig2 = await run(gm, P.actorFigures, { actorId: ch.id });
    const sr = await run(gm, P.surprise, { actorId: ch.id });
    for (const uuid of sr.made) { gm.track(uuid, uuid.startsWith("ChatMessage") ? "ChatMessage" : "Combat"); disposable.push(uuid); }
    check("the matrix rolls a card naming the fixture, and core's avoid-surprise term carries the standing part", sr.opened && sr.card && sr.named && sr.avoidTerm === fig2.avoid && fig2.avoid === fig2.avoidStored + 1, { ...sr, figures: fig2 });
    check("the rigged roll left the fixture unsurprised", sr.surprised === false, sr.surprised);
    note("matrix sweep", await gm.sweepTracked({ only: sr.made }));

    section("abilities 3. a gated part follows the loadout, changed through the sheet");
    const on3 = await run(gm, P.press, { actorId: ch.id, itemId: armourId, action: "toggleEquip" });
    await run(gm, P.settle, { actorId: ch.id });
    const s3on = await run(gm, P.stats, { actorId: ch.id });
    check("wearing the heavy armour by its row drops the gated part from Initiative and lists it as its gate not met", on3.found && on3.equipped && !tooltipHas(s3on.initiative?.tip, "QA Typed Gated +3") && tooltipHas(s3on.initiative?.tip, "QA Typed Gated (its gate is not met)"), { on3, tip: s3on.initiative?.tip });
    const off3 = await run(gm, P.press, { actorId: ch.id, itemId: armourId, action: "toggleEquip" });
    await run(gm, P.settle, { actorId: ch.id });
    const s3off = await run(gm, P.stats, { actorId: ch.id });
    check("taking it off by its row brings the gated part back", off3.found && !off3.equipped && tooltipHas(s3off.initiative?.tip, "QA Typed Gated +3"), { off3, tip: s3off.initiative?.tip });

    section("abilities 4. a level change moves the ladder's rung");
    const ladderAt = (parts) => parts.filter((p) => p.key === "system.ac.mod" && p.label === "QA Typed Ladder").map((p) => p.value);
    const p3 = await run(gm, P.parts, { actorId: ch.id });
    const lv4 = await run(gm, P.setLevelBySheet, { actorId: ch.id, level: 4 });
    await run(gm, P.settle, { actorId: ch.id });
    const p4 = await run(gm, P.parts, { actorId: ch.id });
    check("at level 3 the ladder writes its first rung, and set to 4 on the Class tab it writes the second", JSON.stringify(ladderAt(p3)) === "[1]" && lv4.ok && JSON.stringify(ladderAt(p4)) === "[2]", { at3: ladderAt(p3), lv4, at4: ladderAt(p4) });
    note("level back to 3", await run(gm, P.setLevelBySheet, { actorId: ch.id, level: 3 }));
    await run(gm, P.settle, { actorId: ch.id });

    section("abilities 5. a pair that does not stack");
    const t5 = await run(gm, P.typed, { actorId: ch.id });
    const s5 = await run(gm, P.stats, { actorId: ch.id });
    check("only the larger of the pair applies; the smaller is listed as a larger one of its kind applies", t5.parts.some((p) => p.name === "QA Typed Pair B" && p.value === 2) && !t5.parts.some((p) => p.name === "QA Typed Pair A") && t5.listed.some((l) => l.name === "QA Typed Pair A" && l.reason === "notStacking") && tooltipHas(s5.initiative?.tip, "QA Typed Pair A (a larger one of its kind applies)"), { t5, tip: s5.initiative?.tip });

    section("abilities 6. an ability's own effect stands its typed part aside");
    const acParts = (parts) => parts.filter((p) => p.key === "system.ac.mod").reduce((a, p) => a + p.value, 0);
    const f6 = await run(gm, P.actorFigures, { actorId: ch.id });
    const p6 = await run(gm, P.parts, { actorId: ch.id });
    const t6 = await run(gm, P.typed, { actorId: ch.id });
    check("with the hand-made effect on, AC rises by the effect alone and the typed part is listed standing aside", f6.acMod - acParts(p6) === 3 && !p6.some((p) => p.label === "QA Typed Hand") && t6.listed.some((l) => l.name === "QA Typed Hand" && l.reason === "standAside"), { f6, ac: acParts(p6), listed: t6.listed.filter((l) => l.name === "QA Typed Hand") });
    note("effect off", await run(gm, P.setDisabled, { uuid: handEff, disabled: true }));
    await run(gm, P.settle, { actorId: ch.id });
    const f6b = await run(gm, P.actorFigures, { actorId: ch.id });
    const p6b = await run(gm, P.parts, { actorId: ch.id });
    check("disabled, the typed part applies and the effect adds nothing", p6b.some((p) => p.label === "QA Typed Hand" && p.value === 1) && f6b.acMod - acParts(p6b) === 0, { f6b, ac: acParts(p6b) });
    note("effect on again", await run(gm, P.setDisabled, { uuid: handEff, disabled: false }));
    await run(gm, P.settle, { actorId: ch.id });

    section("abilities 7. deleting an ability takes its parts (the DELETE path)");
    const del = await gm.retire("abilities/typed-standing", "Item", { parent: ch.uuid });
    note("retired", del);
    await run(gm, P.settle, { actorId: ch.id });
    const s7 = await run(gm, P.stats, { actorId: ch.id });
    const p7 = await run(gm, P.parts, { actorId: ch.id });
    check("its parts leave the Avoid Surprise tooltip and the loadout's AC", del.removed?.length === 1 && !tooltipHas(s7.avoid?.tip, "QA Typed Standing") && !p7.some((p) => p.label === "QA Typed Standing"), { tip: s7.avoid?.tip, standing: p7.filter((p) => p.label === "QA Typed Standing") });
    fx.standing = await gm.fixture("abilities/typed-standing", "Item", TYPED.standing, { parent: ch.uuid });
    await run(gm, P.settle, { actorId: ch.id });
    const s7b = await run(gm, P.stats, { actorId: ch.id });
    check("rebuilt by its marker, its parts return", fx.standing.built && tooltipHas(s7b.avoid?.tip, "QA Typed Standing +1"), { built: fx.standing.built, tip: s7b.avoid?.tip });

    section("abilities 8. the Mechanics tab: chips, Start, Refresh");
    const expect = { standing: "applied", gated: "applied when met", ladder: "applied", pairA: "applied", pairB: "applied", handAE: "applied", situational: "situational", scan: "applied" };
    const chipRows = {};
    for (const k of Object.keys(TYPED)) {
      const m = await run(gm, P.mech, { uuid: fx[k].uuid });
      chipRows[k] = m.rows.map((r) => r.chips.map((c) => c.label));
    }
    check("every modifier row carries its disposition chip", Object.entries(expect).every(([k, want]) => chipRows[k]?.length && chipRows[k].every((c) => c.includes(want))), chipRows);
    check("the scan's row also carries unverified", chipRows.scan?.[0]?.includes("unverified") && !chipRows.standing?.[0]?.includes("unverified"), { scan: chipRows.scan, standing: chipRows.standing });
    const sit0 = await run(gm, P.mech, { uuid: fx.situational.uuid });
    const startSit = sit0.rows[0]?.start ? await run(gm, P.mechClick, { uuid: fx.situational.uuid, action: "quickEffectStart", index: 0 }) : { found: false };
    const qSit = await run(gm, P.quickOf, { uuid: fx.situational.uuid });
    if (qSit) { gm.track(qSit.uuid, "ActiveEffect"); disposable.push(qSit.uuid); }
    const sit1 = await run(gm, P.mech, { uuid: fx.situational.uuid });
    check("Start on the situational row makes an Active Effect on the copy, disabled, named as situational, and the row reads effect off", startSit.found && !!qSit && qSit.disabled && qSit.transfer && / \(situational\)$/.test(qSit.name) && sit1.rows[0]?.chips.some((c) => c.label === "effect off"), { startSit, qSit, chips: sit1.rows[0]?.chips.map((c) => c.label) });
    const sBefore = await run(gm, P.stats, { actorId: ch.id });
    note("quick effect on", await run(gm, P.setDisabled, { uuid: qSit?.uuid, disabled: false }));
    await run(gm, P.settle, { actorId: ch.id });
    const sOn = await run(gm, P.stats, { actorId: ch.id });
    const tOn = await run(gm, P.typed, { actorId: ch.id });
    check("enabled, the save figure carries it (+2 over the scan's +1)", sBefore.save?.note === "+1" && sOn.save?.note === "+3" && tooltipHas(sOn.save?.tip, "effects +3"), { before: sBefore.save, on: sOn.save });
    check("enabled, the situational row is listed as standing aside", tOn.listed.some((l) => l.name === "QA Typed Situational" && l.reason === "standAside"), tOn.listed.filter((l) => l.name === "QA Typed Situational"));
    const asideReason = await gm.eval(`game.i18n.localize("ACKS-CHARACTER.stats.reason." + "standAside")`);
    check("the save tooltip names the started row as stood aside by its own effect, not as situational", tooltipHas(sOn.save?.tip, `QA Typed Situational (${asideReason})`) && !tooltipHas(sOn.save?.tip, "QA Typed Situational (situational)"), sOn.save?.tip);
    const lad0 = await run(gm, P.mech, { uuid: fx.ladder.uuid });
    const startLad = lad0.rows[0]?.start ? await run(gm, P.mechClick, { uuid: fx.ladder.uuid, action: "quickEffectStart", index: 0 }) : { found: false };
    const qLad = await run(gm, P.quickOf, { uuid: fx.ladder.uuid });
    if (qLad) { gm.track(qLad.uuid, "ActiveEffect"); disposable.push(qLad.uuid); }
    check("Start on the standing ladder row makes an effect that starts on, at the first rung", startLad.found && !!qLad && !qLad.disabled && JSON.stringify(qLad.values.map(String)) === '["1"]', { startLad, qLad });
    const lv = await run(gm, P.setLevelBySheet, { actorId: ch.id, level: 4 });
    const lad1 = await run(gm, P.mech, { uuid: fx.ladder.uuid });
    check("after a level change on the Class tab the row reads effect stale and offers Refresh", lv.ok && lad1.rows[0]?.chips.some((c) => c.label === "effect stale") && lad1.rows[0]?.refresh, { lv, chips: lad1.rows[0]?.chips.map((c) => c.label), refresh: lad1.rows[0]?.refresh });
    const ref = lad1.rows[0]?.refresh ? await run(gm, P.mechClick, { uuid: fx.ladder.uuid, action: "quickEffectRefresh", index: 0 }) : { found: false };
    const qLad2 = await run(gm, P.quickOf, { uuid: fx.ladder.uuid });
    const lad2 = await run(gm, P.mech, { uuid: fx.ladder.uuid });
    check("Refresh writes the new rung, keeps it on, and the row reads effect on", ref.found && JSON.stringify((qLad2?.values ?? []).map(String)) === '["2"]' && qLad2?.disabled === false && qLad2?.flag?.level === 4 && lad2.rows[0]?.chips.some((c) => c.label === "effect on"), { ref, qLad2, chips: lad2.rows[0]?.chips.map((c) => c.label) });
    // The not-owning player: the ladder's sheet on an Observer's seat offers no Start.
    note("player to observer", await run(gm, P.shapeCharacter, { actorId: ch.id, ownerId: playerId, ownerLevel: 2 }));
    const obs = await run(player, P.mech, { uuid: fx.situational.uuid });
    check("a Player seat that does not own the character sees the rows and no Start", obs.found && obs.editable === false && obs.rows.length > 0 && obs.rows.every((r) => !r.start && !r.refresh), { editable: obs.editable, rows: obs.rows?.map((r) => ({ start: r.start, chips: r.chips.map((c) => c.label) })) });
    await run(player, P.closeAll);
    note("player owner again", await run(gm, P.shapeCharacter, { actorId: ch.id, ownerId: playerId, ownerLevel: 3 }));
    // Back to shape: level 3, and the two quick effects swept by their own ids.
    note("level back to 3", await run(gm, P.setLevelBySheet, { actorId: ch.id, level: 3 }));
    const quick = [qSit?.uuid, qLad?.uuid].filter(Boolean);
    note("quick effects swept", await gm.sweepTracked({ only: quick }));
    await run(gm, P.settle, { actorId: ch.id });

    section("abilities 9. the Player seat on its own character");
    const gmStats = await run(gm, P.stats, { actorId: ch.id });
    note("player open", await run(player, P.openChar, { actorId: ch.id, tab: "stats" }));
    const plStats = await run(player, P.stats, { actorId: ch.id });
    const tipsOf = (s) => ({ save: s.save?.tip, init: s.initiative?.tip, avoid: s.avoid?.tip, others: s.others?.tip, notes: [s.save?.note, s.initiative?.note, s.avoid?.note] });
    check("the owning Player sees the same figures and tooltips as the GM", plStats.rendered && JSON.stringify(tipsOf(plStats)) === JSON.stringify(tipsOf(gmStats)), { gm: tipsOf(gmStats), player: tipsOf(plStats) });
    const edit = await run(player, P.coreSheetEdit, { actorId: ch.id });
    check("an unrelated field edited on core's sheet by the Player leaves the stored Avoid Surprise as it was", edit.found && edit.wrote && edit.after.avoid === edit.before.avoid && edit.before.avoid === 0, edit);
    if (edit.found) note("xp restored", await run(gm, P.setXp, { actorId: ch.id, xp: edit.before.xp }));
    await run(player, P.closeAll);
    await run(gm, P.closeChar, { actorId: ch.id });

    section("character-sheet: the roll modifiers on Stats");
    const sm = await gm.fixture("character-sheet/surprise-mod", "Actor", {
      name: "QA Surprise Mod", type: "character", system: { surprise: { avoidsurprise: 0, surpriseothers: 0 } },
      effects: [{ name: "QA Avoid Surprise +2", transfer: false, disabled: false, changes: [{ key: "system.surprise.avoidsurprise", type: "add", value: "2", priority: 20 }] }],
    });
    ids.surprise = sm.id;
    note("shape", await run(gm, P.shapeCharacter, { actorId: sm.id, stored: { "system.surprise.avoidsurprise": 0 } }));
    const smFx = await gm.eval(`(() => { const a = game.actors.get(${JSON.stringify(sm.id)}); const e = a.effects.find((x) => x.changes.some((c) => c.key === "system.surprise.avoidsurprise" && c.type === "add" && String(c.value) === "2")); return e ? { id: e.id, disabled: e.disabled } : null; })()`);
    check("the kept fixture holds its stored 0 and its ADD 2 effect", !!smFx && smFx.disabled === false, smFx);
    note("open", await run(gm, P.openChar, { actorId: sm.id, tab: "stats" }));
    const st = await run(gm, P.stats, { actorId: sm.id });
    const roll = await run(gm, P.rollsAvoid, { actorId: sm.id });
    const head = await gm.eval(`game.i18n.localize("ACKS-CHARACTER.stats.modifiers")`);
    check("the throw group carries the Roll modifiers subhead over the save modifier, initiative, Surprise Others and Avoid Surprise", st.subhead.some((s) => s.startsWith(head)) && JSON.stringify(st.order.slice(0, 4)) === JSON.stringify(["system.save.mod", "system.initiative.mod", "system.surprise.surpriseothers", "system.surprise.avoidsurprise"]), { subhead: st.subhead, order: st.order });
    check("Avoid Surprise's input reads 0, wears is-overridden and its tooltip names 2", st.avoid?.value === "0" && st.avoid.overridden && /\b2\b/.test(st.avoid.inputTip), st.avoid);
    check("the note beside it reads +2 and its tooltip gives the stored value, the effects' share and the total", st.avoid?.note === "+2" && tooltipHas(st.avoid.tip, "Stored +0") && tooltipHas(st.avoid.tip, "effects +2") && tooltipHas(st.avoid.tip, "+2"), st.avoid);
    check("Rolls shows +2 on the same row", roll === "+2", roll);
    check("Surprise Others reads +0 with the tooltip that names no effect, and Initiative's note is its Rolls figure", st.others?.note === "+0" && tooltipHas(st.others.tip, "No effect changes") && /^[+−]\d+$/.test(st.initiative?.note ?? ""), { others: st.others, init: st.initiative?.note });

    section("character-sheet: the light rows on Stats");
    const imp = await run(gm, P.importCensus, { ids: [] });
    note("light table", { imported: imp.lightImported, cite: imp.lightCite });
    const lights = await gm.eval(`(async () => {
      const H = globalThis.__tm;
      return Object.keys(H.LIGHT.LIGHT_SOURCES).map((k) => ({ key: k, label: game.i18n.localize("ACKS-CHARACTER.vision." + k), dim: H.LIGHT.lightFigures(k).dim, tipCited: H.LIGHT.lightCite() ? game.i18n.format("ACKS-CHARACTER.vision.lightTip", { cite: H.LIGHT.lightCite() }) : null, tipJudge: game.i18n.localize("ACKS-CHARACTER.vision.lightTipJudge"), notImported: game.i18n.localize("ACKS-CHARACTER.vision.notImported") }));
    })()`);
    const rowsOk = lights.map((l) => {
      const row = st.vision.find((v) => v.label === l.label);
      if (!row) return { key: l.key, ok: false, why: "no row" };
      if (l.dim == null) return { key: l.key, ok: row.value.includes(l.notImported) && !/\d/.test(row.value.replace(l.notImported, "")) };
      return { key: l.key, ok: row.value.startsWith(`${l.dim}′`) && (row.tip === l.tipCited || row.tip === l.tipJudge) };
    });
    check("each light row shows the imported reach with the page it was read from, or says it is not imported", rowsOk.length > 0 && rowsOk.every((r) => r.ok), rowsOk);
    await run(gm, P.closeChar, { actorId: sm.id });

    section("magic: a family caster takes its class's slots");
    const rep = await run(gm, P.repertoire);
    if (!rep.classFound) note("repertoire", "no imported class with a slot grid at level 3: not reached");
    else check("a payload naming a class and a level, with no slot block, takes the class's slots and draws that many spells", rep.enabled && rep.slotsMatch && rep.drawn === rep.spellItems && rep.drawn > 0, rep);
  }

  if (STAGE === "" || STAGE === "2") {
    /* ============ STAGE 2: what needs the rulebook ============ */
    section("imports");
    let imp = await run(gm, P.importCensus, { ids: Object.values(LIBRARY) });
    // The equipment document reads both books, so both are mapped before a table import.
    for (const b of BOOKS) {
      const open = await run(gm, P.bookState, { id: b.id });
      if (open.open) continue;
      note(`connect ${b.id}`, await run(gm, P.connectBook, b));
      for (let n = 0; n < 150; n++) {
        const s = await run(gm, P.bookState, { id: b.id });
        if (s?.done || s?.open) { note(`book ${b.id}`, { done: !!s.done, ok: s.ok ?? null, open: !!s.open }); break; }
        await sleep(1000);
      }
    }
    imp = await run(gm, P.importCensus, { ids: Object.values(LIBRARY) });
    // World setup this check needs: tables a release added are read by Import
    // Tables, and library abilities whose recipes changed by Update Abilities.
    if (!(imp.heavyHelm && imp.dualStyle)) {
      note("seated before the import", await run(gm, P.seated));
      const it = await run(gm, P.importTables, { only: ["equipment"] });
      note("Import Tables (equipment) reported", it);
      imp = await run(gm, P.importCensus, { ids: Object.values(LIBRARY) });
    }
    const stale = await gm.eval(`(async () => {
      const LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
      await LIB.whenReady();
      const rows = (id) => LIB.byCookbookId("Item", id)?.getFlag("acks-extras", "extras")?.effects ?? [];
      const fss = rows("def.prof.fightingStyleSpecialization").filter((e) => e.gate?.kind === "specializedStyle").length;
      const at = rows("def.prof.armorTraining").find((e) => e.type === "modifies" && e.domain === "armor");
      return JSON.stringify({ fss, armourBare: typeof at?.value === "number" });
    })()`).then(JSON.parse);
    note("library shapes", stale);
    if (stale.fss !== 5 || stale.armourBare) {
      const ua = await run(gm, P.updateAbilities, { ids: [LIBRARY.fss, "def.prof.armorTraining"] });
      note("Update Abilities (FSS, Armor Training)", ua);
    }
    note("imports", imp);
    check("the rulebook is open on the GM seat and its equipment tables are imported with their pages", imp.bookOpen && imp.equipmentDoc && imp.heavyHelm && imp.heavyHelmCite && imp.dualStyle && imp.dualStyleCite, imp);
    const libOk = Object.values(imp.library).every(Boolean);
    check("the library holds every ability the steps name", libOk, imp.library);

    section("abilities 11-12. conditions and clauses read off the page");
    const cc = await gm.fixture("abilities/clause-character", "Actor", { name: "QA Clause Character", type: "character", ownership: owned(playerId), system: { details: { level: 3 } }, items: [] });
    ids.clause = cc.id;
    note("shape", await run(gm, P.shapeCharacter, { actorId: cc.id, level: 3, ownerId: playerId }));
    const clauseIds = [LIBRARY.lockpicking, LIBRARY.trapbreaking, LIBRARY.searching, LIBRARY.shadowySenses, LIBRARY.sneaking, LIBRARY.climbing, LIBRARY.berserkergang, LIBRARY.power];
    const lib = await run(gm, P.ensureLibrary, { actorId: cc.id, ids: clauseIds });
    note("library copies on the fixture (kept, part of it)", lib);
    note("open", await run(gm, P.openChar, { actorId: cc.id, tab: "stats" }));
    const statsBefore = await run(gm, P.stats, { actorId: cc.id });
    const upd = await run(gm, P.updateAbilities, { ids: clauseIds });
    note("update abilities", upd);
    check("Update Abilities for these ids finishes with no dialog left open", upd.done && upd.ok && upd.dialogs.length === 0, upd);
    const statsAfter = await run(gm, P.stats, { actorId: cc.id });
    const figs = (s) => [s.save, s.initiative, s.others, s.avoid].map((f) => [f?.value, f?.note, f?.tip]);
    check("the Stats tab's figures are the same before and after the update", JSON.stringify(figs(statsBefore)) === JSON.stringify(figs(statsAfter)), { before: figs(statsBefore), after: figs(statsAfter) });
    await run(gm, P.closeChar, { actorId: cc.id });
    const audit = await run(gm, P.clauseAudit, { uuids: lib.uuids });
    const brief = Object.fromEntries(Object.entries(audit).map(([id, a]) => [id, { ...a, rowTexts: undefined }]));
    note("audit", brief);
    const A = (id) => audit[id] ?? {};
    check("every conditioned row shows a condition, none empty, on every ability", Object.values(audit).every((a) => a.found && a.emptyConditions === 0 && a.hidden === 0), brief);
    check("the power whose recipe reads a page condition shows one", A(LIBRARY.power).recipeConditions > 0 && A(LIBRARY.power).shownConditions >= A(LIBRARY.power).recipeConditions, A(LIBRARY.power));
    check("Lockpicking's scoped rows read at the roll or elsewhere, never situational", A(LIBRARY.lockpicking).scoped > 0 && A(LIBRARY.lockpicking).scopedDispositions.every((d) => d === null || d !== "situational"), A(LIBRARY.lockpicking).scopedDispositions);
    check("no row reads empty, and each limitation or capability row reads a clause or a cited label", Object.values(audit).every((a) => a.emptyRows === 0 && a.badLimits === 0), brief);
    check("each outcome row opens with its trigger phrase (natural, on failure, result below)", Object.values(audit).every((a) => a.badOutcomes === 0), brief);
    check("Lockpicking's, Trapbreaking's and Searching's scoped rows carry the chip naming their throw", [LIBRARY.lockpicking, LIBRARY.trapbreaking, LIBRARY.searching].every((id) => A(id).scoped > 0 && A(id).scopeChips === A(id).scoped), [LIBRARY.lockpicking, LIBRARY.trapbreaking, LIBRARY.searching].map((id) => [A(id).scoped, A(id).scopeChips]));
    check("Berserkergang's immunity row shows its note, then its condition", A(LIBRARY.berserkergang).found && A(LIBRARY.berserkergang).hidden === 0 && A(LIBRARY.berserkergang).emptyRows === 0, { hidden: A(LIBRARY.berserkergang).hiddenShapes });
    const wide = await run(gm, P.mechWidth, { uuid: lib.uuids[LIBRARY.lockpicking] });
    check("Lockpicking's Mechanics tab body is no wider than its window (scrollWidth <= clientWidth)", wide.found && wide.tab && wide.tab.scroll <= wide.tab.client && wide.content.scroll <= wide.content.client, wide);
    if (SHOTS && lib.uuids[LIBRARY.lockpicking]) {
      await gm.compose();
      const m = await run(gm, P.mech, { uuid: lib.uuids[LIBRARY.lockpicking] });
      await gm.eval(`(() => { const r = document.querySelector("#${m.id} .acks-abilities-mechanics ol"); r?.closest("fieldset")?.scrollIntoView({ block: "start" }); return true; })()`);
      await sleep(400);
      note("plate", await gm.shot(`${shotDir()}/abilities-conditions.png`, `#${m.id}`));
      await run(gm, P.closeAll);
    }
    const plMech = await run(player, P.mech, { uuid: lib.uuids[LIBRARY.lockpicking] });
    check("the owning Player sees the same Lockpicking rows", plMech.found && JSON.stringify(plMech.rows.map((r) => r.text)) === JSON.stringify((await run(gm, P.mech, { uuid: lib.uuids[LIBRARY.lockpicking] })).rows.map((r) => r.text)), { rows: plMech.rows?.length });
    await run(player, P.closeAll);
    await run(gm, P.closeAll);

    section("equipment 3c. an imported Specialization's pick made after the kit is drawn");
    const sp = await gm.fixture("equipment/style-pick", "Actor", {
      name: "QA Style Pick", type: "character", ownership: owned(playerId), system: { details: { level: 3 } },
      items: [
        { name: "Sword", type: "weapon", system: { melee: true, missile: false, damage: { base: { formula: "1d6" } } } },
        { name: "Shield", type: "armor", system: { type: "shield", ac: { value: 1 } } },
      ],
      effects: [{ name: "QA Style Training", transfer: false, disabled: false, changes: [{ key: "flags.acks-extras.styleProficient", type: "add", value: "weaponShield", priority: 20 }] }],
    });
    ids.pick = sp.id;
    let spLib = await run(gm, P.ensureLibrary, { actorId: sp.id, ids: [LIBRARY.fss] });
    // A copy an earlier run of this walk gave the fixture before the library was
    // updated is stale: it is retired by its id and a fresh copy given.
    const fssStale = await gm.eval(`(() => fromUuidSync(${JSON.stringify(spLib.uuids[LIBRARY.fss])})?.getFlag("acks-extras", "extras")?.effects?.filter((e) => e.gate?.kind === "specializedStyle").length !== 5)()`);
    if (fssStale && spLib.uuids[LIBRARY.fss] && !spLib.added.length) {
      const old = spLib.uuids[LIBRARY.fss];
      gm.track(old, "Item");
      note("stale Specialization copy swept", await gm.sweepTracked({ only: [old] }));
      spLib = await run(gm, P.ensureLibrary, { actorId: sp.id, ids: [LIBRARY.fss] });
      note("fresh Specialization copy", spLib.added);
    }
    const fssUuid = spLib.uuids[LIBRARY.fss];
    const spItems = await run(gm, P.itemIds, { actorId: sp.id });
    const fssRows = await gm.eval(`(() => (fromUuidSync(${JSON.stringify(fssUuid)})?.getFlag("acks-extras", "extras")?.effects ?? []).filter((e) => e.gate?.kind === "specializedStyle").length)()`);
    check("the imported Specialization carries its specializedStyle rows", fssRows === 5, fssRows);
    note("open", await run(gm, P.openChar, { actorId: sp.id, tab: "equipment" }));
    // Shape: the pick unticked, the sword and the shield drawn.
    await run(gm, P.mech, { uuid: fssUuid });
    note("pick off", await run(gm, P.pick, { uuid: fssUuid, labelRe: "shield", on: false }));
    for (const name of ["Sword", "Shield"]) {
      const r = await run(gm, P.press, { actorId: sp.id, itemId: spItems[name], action: "toggleEquip" });
      if (r.found && !r.equipped) await run(gm, P.press, { actorId: sp.id, itemId: spItems[name], action: "toggleEquip" });
    }
    await run(gm, P.settle, { actorId: sp.id });
    const base = await run(gm, P.actorFigures, { actorId: sp.id });
    const ticked = await run(gm, P.pick, { uuid: fssUuid, labelRe: "shield", on: true });
    await run(gm, P.settle, { actorId: sp.id });
    const pPick = await run(gm, P.parts, { actorId: sp.id });
    // The pick renames the copy (its selection joins the name), so the name is read after it.
    const fssName = await gm.eval(`fromUuidSync(${JSON.stringify(fssUuid)})?.name ?? null`);
    const fPick = await run(gm, P.actorFigures, { actorId: sp.id });
    const fssAc = pPick.filter((p) => p.key === "system.ac.mod" && p.label === fssName);
    check("ticking Weapon & Shield on the Mechanics tab adds one AC part named for the proficiency, and AC climbs", ticked.found && ticked.ok && fssAc.length === 1 && fssAc[0].value > 0 && fPick.acValue !== base.acValue, { ticked, fssAc: fssAc.length, acLabels: pPick.filter((p) => p.key === "system.ac.mod").map((p) => p.label ?? p.labelKey), fssName, base: base.acValue, now: fPick.acValue });
    if (SHOTS && !(fssRows === 5 && fssAc.length === 1)) note("plate abilities-typed-modifiers", "not shot: the imported Specialization or its part is missing, so the plate would not show the feature");
    if (SHOTS && fssRows === 5 && fssAc.length === 1) {
      await gm.compose();
      const m = await run(gm, P.mech, { uuid: fssUuid });
      await gm.eval(`(() => { const r = document.querySelector("#${m.id} .acks-abilities-mechanics ol"); r?.closest("fieldset")?.scrollIntoView({ block: "start" }); return true; })()`);
      await sleep(400);
      note("plate", await gm.shot(`${shotDir()}/abilities-typed-modifiers.png`, `#${m.id}`));
      await run(gm, P.closeAll);
      note("reopen", await run(gm, P.openChar, { actorId: sp.id, tab: "equipment" }));
    }
    const sheathe = await run(gm, P.press, { actorId: sp.id, itemId: spItems.Shield, action: "toggleEquip" });
    await run(gm, P.settle, { actorId: sp.id });
    const pSingle = await run(gm, P.parts, { actorId: sp.id });
    check("sheathing the shield takes the part away and brings no initiative part", sheathe.found && !sheathe.equipped && !pSingle.some((p) => p.label === fssName), pSingle.filter((p) => p.label === fssName));
    await run(gm, P.press, { actorId: sp.id, itemId: spItems.Shield, action: "toggleEquip" });
    await run(gm, P.mech, { uuid: fssUuid });
    const unticked = await run(gm, P.pick, { uuid: fssUuid, labelRe: "shield", on: false });
    await run(gm, P.settle, { actorId: sp.id });
    const fBack = await run(gm, P.actorFigures, { actorId: sp.id });
    check("unticking the pick brings AC back", unticked.ok && fBack.acValue === base.acValue, { base: base.acValue, back: fBack.acValue });
    await run(gm, P.closeAll);
    await run(gm, P.closeChar, { actorId: sp.id });

    section("equipment 3e and abilities 13. style and helmet figures from the imported tables");
    if (!imp.overlay) { restore.settings.overlayEnclosingHelm = false; note("overlay on", await run(gm, P.setSetting, { key: "overlayEnclosingHelm", value: true })); }
    const sf = await gm.fixture("equipment/style-figures", "Actor", {
      name: "QA Style Figures", type: "character", ownership: owned(playerId), system: { details: { level: 3 } },
      items: [
        { name: "Dagger", type: "weapon", system: { melee: true, missile: true, damage: { base: { formula: "1d4" } } } },
        { name: "Dagger", type: "weapon", system: { melee: true, missile: true, damage: { base: { formula: "1d4" } } } },
        { name: "Heavy Helmet", type: "armor", system: { type: "light", ac: { value: 0 } } },
      ],
      effects: [{ name: "QA Dual Training", transfer: false, disabled: false, changes: [{ key: "flags.acks-extras.styleProficient", type: "add", value: "dual", priority: 20 }] }],
    });
    ids.figures = sf.id;
    note("shape", await run(gm, P.shapeCharacter, { actorId: sf.id, ownerId: playerId }));
    const sfItems = await gm.eval(`(() => game.actors.get(${JSON.stringify(sf.id)}).items.map((i) => ({ id: i.id, name: i.name, eq: !!i.system.equipped })))()`);
    note("open", await run(gm, P.openChar, { actorId: sf.id, tab: "equipment" }));
    for (const it of sfItems) if (!it.eq) await run(gm, P.press, { actorId: sf.id, itemId: it.id, action: "toggleEquip" });
    await run(gm, P.settle, { actorId: sf.id });
    const worn = await gm.eval(`(() => game.actors.get(${JSON.stringify(sf.id)}).items.every((i) => !!i.system.equipped))()`);
    check("both daggers are drawn and the helmet worn, through the sheet", worn, sfItems);
    const tp = await run(gm, P.tableParts, { actorId: sf.id });
    note("table parts", { helm: tp.helm, helmKey: tp.helmKey, dual: tp.dual, dualKey: tp.dualKey, helmSource: tp.helmSource, dualSource: tp.dualSource });
    check("the loadout carries the two-weapon part on the melee attack at the imported figure, cited to its table", tp.dual && tp.dualKey === "system.attack.mod.melee" && tp.dualMatches && JSON.stringify(tp.dualSource) === '["cite"]', { dual: tp.dual, key: tp.dualKey, matches: tp.dualMatches, source: tp.dualSource });
    check("the loadout carries the enclosing helmet's part on Avoid Surprise at the imported figure, cited to its table", tp.helm && tp.helmKey === "system.surprise.avoidsurprise" && tp.helmMatches && JSON.stringify(tp.helmSource) === '["cite"]', { helm: tp.helm, key: tp.helmKey, matches: tp.helmMatches, source: tp.helmSource });
    check("api.equipment.HELM_MODIFIERS returns the three imported heavyHelm figures", tp.apiMatches, tp.apiMatches);
    const line = await run(gm, P.citedLine, { labelKey: "ACKS-EQUIPMENT.part.helm", table: "heavyHelm", value: tp.helmValue });
    note("open stats", await run(gm, P.openChar, { actorId: sf.id, tab: "stats" }));
    const sfStats = await run(gm, P.stats, { actorId: sf.id });
    check("the Avoid Surprise tooltip names an enclosing helmet with the page the import read", !!line.cited && tooltipHas(sfStats.avoid?.tip, line.cited), { cited: !!line.cited, has: tooltipHas(sfStats.avoid?.tip, line.cited) });
    if (SHOTS && !(tp.helm && line.cited)) note("plate character-sheet-stats-parts", "not shot: no imported helmet part to show");
    if (SHOTS && tp.helm && line.cited) {
      await gm.compose(`#${(await run(gm, P.openChar, { actorId: sf.id, tab: "stats" })).id}`);
      await run(gm, P.stats, { actorId: sf.id });
      const sel = await run(gm, P.holdTooltip, { actorId: sf.id, name: "system.surprise.avoidsurprise" });
      if (sel) note("plate", await gm.shot(`${shotDir()}/character-sheet-stats-parts.png`, sel));
      await gm.eval(`(() => { game.tooltip.deactivate(); return true; })()`);
    }

    // The player's seat, owning the fixture: the same parts, and no override offered.
    note("player open", await run(player, P.openChar, { actorId: sf.id, tab: "stats" }));
    const plSf = await run(player, P.stats, { actorId: sf.id });
    const plTp = await run(player, P.tableParts, { actorId: sf.id });
    const restricted = await run(player, P.menuRestricted);
    check("the owning Player sees the same two parts and tooltip, and the Ruledata Browser is a GM-only menu", plTp.helm && plTp.dual && tooltipHas(plSf.avoid?.tip, line.cited) && restricted, { helm: plTp.helm, dual: plTp.dual, restricted });
    await run(player, P.closeAll);

    // A Ruledata Browser override, set and reverted through the browser.
    if (imp.overrides.heavyHelm || imp.overrides.dualWeaponStyle) {
      note("override", "a Judge's override already stands on one of the tables: the override half is left alone");
    } else {
      const eh = await run(gm, P.ruledataEdit, { key: "equipment.heavyHelm", field: "surprise", choose: [-7, -6] });
      if (eh.set) restore.overrides.push(["equipment", "heavyHelm"]);
      const ed = await run(gm, P.ruledataEdit, { key: "equipment.dualWeaponStyle", field: "attack", choose: [5, 4] });
      if (ed.set) restore.overrides.push(["equipment", "dualWeaponStyle"]);
      note("edits", { eh, ed });
      // The next loadout sync, through the sheet: the helmet off and on, a dagger sheathed and drawn.
      note("open", await run(gm, P.openChar, { actorId: sf.id, tab: "equipment" }));
      const helmId = sfItems.find((i) => i.name === "Heavy Helmet").id;
      const daggerId = sfItems.find((i) => i.name === "Dagger").id;
      for (const id of [helmId, helmId, daggerId, daggerId]) await run(gm, P.press, { actorId: sf.id, itemId: id, action: "toggleEquip" });
      await run(gm, P.settle, { actorId: sf.id });
      const ov = await run(gm, P.tableParts, { actorId: sf.id });
      const judge = await run(gm, P.citedLine, { labelKey: "ACKS-EQUIPMENT.part.helm", table: "heavyHelm", value: eh.value });
      const ovStats = await run(gm, P.stats, { actorId: sf.id });
      check("after the browser's override and the next sync, both parts carry the Judge's figures and say the Judge set them", eh.set && ed.set && ov.helmValue === eh.value && ov.dualValue === ed.value && JSON.stringify(ov.helmSource) === '["judge"]' && JSON.stringify(ov.dualSource) === '["judge"]' && tooltipHas(ovStats.avoid?.tip, judge.judge), { eh: { ...eh, value: undefined }, ed: { ...ed, value: undefined }, helmJudge: ov.helmValue === eh.value, dualJudge: ov.dualValue === ed.value, helmSource: ov.helmSource, dualSource: ov.dualSource });
      const r1 = await run(gm, P.ruledataRevert, { key: "equipment.heavyHelm" });
      const r2 = await run(gm, P.ruledataRevert, { key: "equipment.dualWeaponStyle" });
      note("open", await run(gm, P.openChar, { actorId: sf.id, tab: "equipment" }));
      for (const id of [helmId, helmId, daggerId, daggerId]) await run(gm, P.press, { actorId: sf.id, itemId: id, action: "toggleEquip" });
      await run(gm, P.settle, { actorId: sf.id });
      const back = await run(gm, P.tableParts, { actorId: sf.id });
      check("Revert in the browser clears the override and the parts return to the import, cited", r1.cleared && r2.cleared && back.helmMatches && back.dualMatches && JSON.stringify(back.helmSource) === '["cite"]', { r1, r2, helm: back.helmMatches, dual: back.dualMatches, source: back.helmSource });
    }
    note("removed equipment import", "not checked: the import is the owner's document and this walk never removes it");
    await run(gm, P.closeAll);
    await run(gm, P.closeChar, { actorId: sf.id });
  }

  if (STAGE === "" || STAGE === "3") {
    /* ============ STAGE 3: Armour Training's step and the row editor ============ */
    section("fixtures: equipment/armour-step");
    const HAND = "Armour Training";
    const COPY = "QA Armour Training Copy";
    const as = await gm.fixture("equipment/armour-step", "Actor", {
      name: "QA Armour Step", type: "character", ownership: owned(playerId), flags: { "acks-extras": { armorMax: "veryLight" } },
    });
    ids.armour = as.id;
    const hand = await gm.fixture("equipment/armour-step-hand", "Item", { name: HAND, type: "ability", flags: { "acks-extras": { extras: { qty: 1 } } } }, { parent: as.uuid });
    const copy = await gm.fixture("equipment/armour-step-row", "Item", {
      name: COPY, type: "ability",
      flags: { "acks-extras": { cookbook: { id: "def.prof.armorTraining" }, extras: { qty: 1, effectsFrom: "recipe", effects: [{ type: "modifies", refs: ["kw:armorproficiency"], domain: "armor", value: { kind: "flat", flat: 2 }, mode: "add" }] } } },
    }, { parent: as.uuid });
    const lib = await run(gm, P.armourLibrary);
    const cite = lib.found && lib.hasCite ? lib.cite : "";
    note("library Armor Training", { found: lib.found, row: lib.found ? lib.index : null, cite: lib.found ? lib.hasCite : null });
    ids.armourShape = { actorId: as.id, handId: hand.id, rowId: copy.id, ownerId: playerId, cite };
    const shape = (over = {}) => run(gm, P.armourShape, { ...ids.armourShape, ...over });
    const exp = (handE, copyE) => ({ [HAND]: handE, [COPY]: copyE });
    const line = (s, label) => s.rows.find((r) => r.label === label) ?? null;
    note("shape", await shape());

    section("equipment armour-step 1. the library row and its editor");
    if (!lib.found || lib.index < 0) {
      console.log(`GAP  the library's imported Armor Training row: ${lib.found ? "the item carries no armour row" : "no def.prof.armorTraining in the world library (import Proficiencies with the RR mapped)"}`);
    } else {
      const lc = await run(gm, P.mechControls, { uuid: lib.uuid });
      check("GM seat: the library item's Mechanics rows carry Edit and Delete, with Add a row", lc.edit === lc.rows && lc.del === lc.rows && lc.add === 1 && lc.rows > 0, lc);
      const op = await run(gm, P.editorOpen, { uuid: lib.uuid, index: lib.index });
      const ed = await run(gm, P.editorOf, { uuid: lib.uuid, index: lib.index });
      check("Edit opens an editor titled with the item's name: kind Modifies, Domain Armor, Value kind Flat, the flat box numeric and holding the row's step", op.open && ed.titled && ed.type === "modifies" && ed.domain === "armor" && ed.kind === "flat" && ed.flatNumeric && ed.flatMatchesRow, { op, ed });
      note("editors closed unchanged", await run(gm, P.closeEditors));
      await run(gm, P.closeAll);
    }

    section("equipment armour-step 2. the Stats lines under the rungs");
    const s2 = await run(gm, P.armourStats, { actorId: as.id, expect: exp(null, { step: 2, rank: 1, cite }) });
    check("the hand-made line shows no figure and \"step not imported\" with its tooltip", line(s2, HAND)?.ok === true, line(s2, HAND));
    check(`the copy's line reads +2 with the tooltip naming a step of 2 times rank 1${cite ? " and the import's cite" : " (the copy records no cite: the library has none)"}`, line(s2, COPY)?.ok === true && (!cite || line(s2, COPY)?.cited === true), line(s2, COPY));
    check("the armour ceiling ends at medium (very light plus 2)", s2.max === "medium", { max: s2.max, lit: s2.lit });

    section("equipment armour-step 3. a hand-made copy's quantity adds nothing");
    note("shape", await shape({ handQty: 3 }));
    const s3 = await run(gm, P.armourStats, { actorId: as.id, expect: exp(null, { step: 2, rank: 1, cite }) });
    check("at quantity 3 the hand-made line still shows no figure, and the rungs do not move", line(s3, HAND)?.ok === true && s3.max === "medium" && JSON.stringify(s3.lit) === JSON.stringify(s2.lit), { hand: line(s3, HAND), max: s3.max, lit: s3.lit });

    section("equipment armour-step 4. the Judge edits the copy's row");
    note("shape", await shape());
    note("open copy", (await run(gm, P.mechControls, { uuid: copy.uuid })));
    const o4 = await run(gm, P.editorOpen, { uuid: copy.uuid, index: 0 });
    const set4 = await run(gm, P.editorSet, { uuid: copy.uuid, index: 0, sets: [["value.flat", 3]] });
    const s4 = await run(gm, P.armourStats, { actorId: as.id, expect: exp(null, { step: 3, rank: 1, cite }) });
    const r4 = set4.row ?? {};
    check("typing 3 into Flat writes {kind: flat, flat: 3}, keeps the row's refs and domain, and the line reads +3 with the ceiling at heavy", o4.open && r4.value?.kind === "flat" && r4.value?.flat === 3 && JSON.stringify(r4.refs) === '["kw:armorproficiency"]' && r4.domain === "armor" && line(s4, COPY)?.ok === true && s4.max === "heavy", { o4, set4, line: line(s4, COPY), max: s4.max });
    const back4 = await run(gm, P.editorSet, { uuid: copy.uuid, index: 0, sets: [["value.flat", 2]] });
    note("flat restored to 2", { flat: back4.row?.value?.flat });
    await run(gm, P.closeEditors);

    section("equipment armour-step 5. rank 3 by three copies: Add a row on one, then Delete it");
    note("shape", await shape());
    // Rank is the count of same-named copies: two more hand-made copies make rank 3. They are this run's, tracked and swept.
    const extra = await run(gm, P.addCopies, { actorId: as.id, name: HAND, n: 2 });
    for (const u of extra) { gm.track(u, "Item"); disposable.push(u); }
    note("open hand", await run(gm, P.mechControls, { uuid: hand.uuid }));
    const o5 = await run(gm, P.editorOpen, { uuid: hand.uuid, index: null });
    const set5 = await run(gm, P.editorSet, { uuid: hand.uuid, index: o5.index ?? 0, sets: [["type", "modifies"], ["domain", "armor"], ["value.kind", "flat"], ["value.flat", 2]] });
    const s5 = await run(gm, P.armourStats, { actorId: as.id, expect: exp([{ step: 2, rank: 3, cite: "" }, null], { step: 2, rank: 1, cite }) });
    const r5 = set5.row ?? {};
    const hands5 = s5.rows.filter((r) => r.label === HAND);
    check("with three copies, Add a row, kind Modifies, Domain Armor, Flat 2: that copy's line reads +6 (step 2 times rank 3), the other two say step not imported, and the ceiling is heavy", extra.length === 2 && o5.open && r5.type === "modifies" && r5.domain === "armor" && r5.value?.flat === 2 && hands5.length === 3 && hands5.every((r) => r.ok) && hands5.filter((r) => r.value === "+6").length === 1 && s5.max === "heavy", { o5, set5, hands: hands5, max: s5.max });
    await run(gm, P.closeEditors);
    const del5 = await run(gm, P.effectDelete, { uuid: hand.uuid, index: o5.index ?? 0 });
    const s5b = await run(gm, P.armourStats, { actorId: as.id, expect: exp(null, { step: 2, rank: 1, cite }) });
    const hands5b = s5b.rows.filter((r) => r.label === HAND);
    check("Delete asks, and answered yes takes the row: \"step not imported\" is back on every copy", del5.asked && del5.removed && hands5b.length === 3 && hands5b.every((r) => r.ok), { del5, hands: hands5b });
    note("extra copies swept", await gm.sweepTracked({ only: extra }));
    note("shape", await shape());
    await run(gm, P.closeAll);

    section("equipment armour-step 6. the Player seat owning the fixture");
    const gm6 = await run(gm, P.armourStats, { actorId: as.id, expect: exp(null, { step: 2, rank: 1, cite }) });
    await run(gm, P.closeAll);
    const pc = [await run(player, P.mechControls, { uuid: hand.uuid }), await run(player, P.mechControls, { uuid: copy.uuid })];
    check("the Player's sheets are editable and show no Edit, Delete or Add a row", pc.every((c) => c.editable && !c.isGM && c.edit === 0 && c.del === 0 && c.add === 0), pc);
    const pl6 = await run(player, P.armourStats, { actorId: as.id, expect: exp(null, { step: 2, rank: 1, cite }) });
    const face = (s) => s.rows.map((r) => [r.label, r.value, r.note, r.tip, r.ok]);
    check("the Player's Stats lines and tooltips read as on the GM seat", pl6.rendered && JSON.stringify(face(pl6)) === JSON.stringify(face(gm6)) && pl6.max === gm6.max, { gm: face(gm6), player: face(pl6) });
    await run(player, P.closeAll);

    section("equipment armour-step 7. a pre-change copy's bare step");
    note("shape", await shape({ rowValue: 2 }));
    const s7 = await run(gm, P.armourStats, { actorId: as.id, expect: exp(null, { step: 2, rank: 1, cite }) });
    check("a bare value of 2 reads +2 and the ceiling ends at medium", line(s7, COPY)?.ok === true && s7.max === "medium", { line: line(s7, COPY), max: s7.max });
    note("open copy", (await run(gm, P.mechControls, { uuid: copy.uuid })).rows);
    const o7 = await run(gm, P.editorOpen, { uuid: copy.uuid, index: 0 });
    const ed7 = await run(gm, P.editorOf, { uuid: copy.uuid, index: 0 });
    check("the editor over the bare step shows Value kind Flat with the flat box holding it", o7.open && ed7.kind === "flat" && ed7.flatNumeric && ed7.flatMatchesRow && ed7.rowValueShape === "number", { o7, ed7 });
    note("editors closed unchanged", await run(gm, P.closeEditors));
    note("LevelValue restored", await shape());
    await run(gm, P.closeAll);

    section("abilities: editing an imported row on another ability");
    const tc = await gm.fixture("abilities/typed-character", "Actor", {
      name: "QA Typed Character", type: "character", ownership: owned(playerId),
      system: { details: { level: 3 }, save: { mod: 0 }, initiative: { mod: 0 }, surprise: { avoidsurprise: 0, surpriseothers: 0 }, ac: { mod: 0 } },
      items: [{ name: "Plate Armor", type: "armor", system: { type: "heavy", ac: { value: 6 }, weight6: 6, equipped: false } }],
    });
    const stand = await gm.fixture(`abilities/typed-${MARK.standing}`, "Item", TYPED.standing, { parent: tc.uuid });
    const leftover = await run(gm, P.quickEffects, { actorId: tc.id });
    for (const uuid of leftover) { gm.track(uuid, "ActiveEffect"); disposable.push(uuid); }
    if (leftover.length) note("quick effects a past run left, swept", await gm.sweepTracked({ only: leftover }));
    const rows0 = await run(gm, P.rowsOf, { uuid: stand.uuid });
    if (!Array.isArray(rows0) || rows0.length !== 2) throw new Error("abilities/typed-standing does not hold its two rows: rebuild the fixture");
    ids.standingRows = { uuid: stand.uuid, rows: rows0 };
    const others = (rows, skip) => JSON.stringify(rows.filter((_, i) => i !== skip));
    note("open", (await run(gm, P.mech, { uuid: stand.uuid })).found);
    const o8 = await run(gm, P.editorOpen, { uuid: stand.uuid, index: 1 });
    const set8 = await run(gm, P.editorSet, { uuid: stand.uuid, index: 1, sets: [["value.flat", 4]] });
    const rows8 = await run(gm, P.rowsOf, { uuid: stand.uuid });
    check("editing row 2 writes its value and leaves the other row byte for byte as it was", o8.open && rows8?.[1]?.value?.flat === 4 && others(rows8, 1) === others(rows0, 1), { o8, set8: set8.done, other: others(rows8, 1) === others(rows0, 1) });
    await run(gm, P.closeEditors);
    note("rows restored", await run(gm, P.setRows, ids.standingRows));
    const m8 = await run(gm, P.mech, { uuid: stand.uuid });
    const start8 = await run(gm, P.mechClick, { uuid: stand.uuid, action: "quickEffectStart", index: 1 });
    const q8 = await run(gm, P.quickOf, { uuid: stand.uuid });
    if (q8) { gm.track(q8.uuid, "ActiveEffect"); disposable.push(q8.uuid); }
    const del8 = await run(gm, P.effectDelete, { uuid: stand.uuid, index: 0 });
    const m8b = await run(gm, P.mech, { uuid: stand.uuid });
    const chips8 = m8b.rows[0]?.chips.map((c) => c.label) ?? [];
    check("with a quick effect started on row 2, deleting row 1 above it leaves the row reporting effect on", m8.found && start8.found && !!q8 && del8.removed && m8b.rows.length === 1 && chips8.includes("effect on"), { start8, q8: q8 ? { disabled: q8.disabled } : null, del8, chips: chips8 });
    note("rows restored", await run(gm, P.setRows, ids.standingRows));
    if (q8) note("quick effect swept", await gm.sweepTracked({ only: [q8.uuid] }));
    await run(gm, P.closeAll);
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
} finally {
  section("teardown");
  if (gm) {
    for (const [docId, tableId] of restore.overrides) {
      try { note(`override ${tableId} cleared`, await run(gm, P.clearOverride, { docId, tableId })); } catch (err) { console.error("clearOverride:", err?.message ?? err); }
    }
    for (const [key, value] of Object.entries(restore.settings)) {
      try { note(`setting ${key} restored`, await run(gm, P.setSetting, { key, value })); } catch (err) { console.error("setSetting:", err?.message ?? err); }
    }
    if (ids.typed) {
      try { note("typed character level 3", await run(gm, P.shapeCharacter, { actorId: ids.typed, level: 3 })); } catch (err) { console.error("shape:", err?.message ?? err); }
    }
    if (ids.standingRows) {
      try { await run(gm, P.closeEditors); note("typed-standing rows as they were", await run(gm, P.setRows, ids.standingRows)); } catch (err) { console.error("setRows:", err?.message ?? err); }
    }
    if (ids.armourShape) {
      try { await run(gm, P.closeEditors); note("armour-step fixture to its shape", await run(gm, P.armourShape, ids.armourShape)); } catch (err) { console.error("armour shape:", err?.message ?? err); }
    }
    for (const api of [player, gm]) { if (api) { try { await run(api, P.closeAll); } catch { /* closed */ } } }
    const left = disposable.filter((u) => gm.tracked().some((e) => e.uuid === u));
    if (left.length) { try { note("sweep (this run's disposables)", await gm.sweepTracked({ only: left })); } catch (err) { console.error("sweep:", err?.message ?? err); } }
  }
  for (const api of Object.values(seats)) { try { api.close(); } catch { /* closed */ } }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
