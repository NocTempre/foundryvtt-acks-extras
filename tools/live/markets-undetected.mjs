/**
 * Live walk, markets-undetected: a magic item a player is not told is magic.
 * Walks docs/markets/TESTING.md "The undetected item walk", steps 1 to 7, on
 * both seats: the Player seat's own client reads what it is shown, the GM seat
 * writes what a Judge writes, and every observable is a boolean or a count.
 * Machine values arrive through ./_env.mjs.
 *
 * Covers: 1. the Player seat's item sheet (no identification panel, no hidden
 * effects note and no effect listed, no aura mark, the value badge's ordinary
 * tooltip); 2. the Equipment tab's place badge counting known magic only, while
 * the place reading full for the Judge on the truth and for the player only on
 * the count the badge shows; 3. the GM seat's sheet, nothing hidden;
 * 4. a recognizing identification from the Player seat after a disguise (the
 * name lifts, cost and description stay apparent, the disguise stays); 5. a
 * full identification (the disguise goes, every field is true); 6. the Judge's
 * Detected mark, armed through the pencil and ticked by a real click, with the
 * Player seat's open sheet following it, and the control absent on a mundane
 * item and on the Player seat; 7. raising identification to Partly identified
 * through the magic panel's select and through the Appearance tab's step
 * button, each of which also sets detected.
 *
 * Fixtures, kept and found by marker, all on one character the Player seat
 * owns (`treasure/undetected-holder`): `treasure/undetected-item` (a weapon
 * with one active effect, magic, arcane aura, identified none, detected false),
 * `treasure/known-magic-item` (a non-equippable magic item, `detected`
 * absent), `treasure/mundane-item` (no magic), and one ability item each for
 * Loremastery, Magical Engineering and Magic Research (`treasure/identifier-*`,
 * a throw target of 1, so the throw is the identifier's qualification and not
 * a printed figure). Each step brings the shape it needs before its first
 * check; nothing is restored at the end. Step 7 makes one fresh copy of the
 * magic item through `api.create`; the copy and the identification cards the
 * Player seat's attempts post are the run's own and are swept by tracked id.
 *
 * Steps 4 and 5 drive `identifyAttempt` from the Player seat, whose client is
 * the one the reveal listener runs on. A world whose identification values the
 * Recognize step `needs` were never imported, or whose identifier cannot
 * qualify, takes the other path, printed as a note: the markets flag is
 * written with `markIdentified` and the `IDENTIFIED` hook payload is fired as
 * `identifyAttempt` fires it after a success. That proves the listener and
 * the masks, not the throw.
 *
 * Not reached: the ring place's imported capacity (the place the walk fills is
 * the neck, whose capacity is the module's own); Arcane Dabbling, trial by use
 * and the other methods that leave the name; a real player drag of a disguise
 * onto the Appearance tab; the sell dialog's market-value basis line.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const MARKS = {
  holder: "treasure/undetected-holder",
  weapon: "treasure/undetected-item",
  known: "treasure/known-magic-item",
  mundane: "treasure/mundane-item",
  lore: "treasure/identifier-lore",
  engineering: "treasure/identifier-engineering",
  research: "treasure/identifier-research",
};
const TRUTH = { name: "QA Undetected Blade", cost: 250, description: "<p>QA true description.</p>" };
const APPARENT = { name: "Plain Blade", cost: 1, description: "<p>QA apparent description.</p>" };
/** An apparent worth set apart from the truth's cost, so a ledger that leaked the truth would read the other figure. Invented. */
const APPARENT_GP = 40;
const NAMES = { holder: "QA Undetected Holder", known: "QA Known Magic Charm", mundane: "QA Plain Rope", copy: "QA Undetected Blade Copy" };
const PLACE = "neck";
const MARKETS_DETECTED_FALSE = { magic: true, aura: "arcane", identified: "none", detected: false };
const EFFECT = { name: "QA Undetected Probe", transfer: true, changes: [{ key: "flags.world.qaProbe", type: "override", mode: 5, value: "1" }] };
const ABILITY = (name) => ({ name, type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 1 } });

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__muBoot = { phase: "load", phases: [], errors: [] });
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
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__mu = globalThis.__mu ?? {});
    const base = "/modules/acks-extras/scripts";
    H.IM = await import(`${base}/lib/item-model.mjs`);
    H.V = await import(`${base}/lib/vocab.mjs`);
    H.ACT = await import(`${base}/equipment/actions.mjs`);
    H.ID = await import(`${base}/markets/engine/identify.mjs`);
    H.PR = await import(`${base}/markets/engine/printed.mjs`);
    H.MC = await import(`${base}/markets/constants.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.L = (k) => game.i18n.localize(k);
    H.item = (actorId, itemId) => game.actors.get(actorId)?.items.get(itemId) ?? null;
    H.opened = H.opened ?? [];
    H.closeAll = async () => {
      let n = 0;
      for (const app of H.opened) { try { await app.close({ force: true, animate: false }); n++; } catch { /* already closed */ } }
      H.opened = [];
      return n;
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    // Every card this seat's own client makes while the walk drives it, so the run can sweep them by id.
    if (!H.chatWrapped) {
      H.chat = [];
      H.chatCreate = ChatMessage.create;
      ChatMessage.create = async function (...args) {
        const made = await H.chatCreate.apply(this, args);
        for (const m of Array.isArray(made) ? made : [made]) if (m?.id) H.chat.push(m.id);
        return made;
      };
      H.chatWrapped = true;
    }
    H.markets = (item) => item?.getFlag("acks-extras", "markets") ?? {};
    /** The item's masks and marks as the walk compares them; an absent `detected` reads "absent". */
    H.state = (item) => {
      const f = H.markets(item);
      return {
        name: item.name,
        cost: Number(item.system?.cost ?? 0),
        description: item.system?.description ?? "",
        detected: f.detected === false ? false : f.detected === true ? true : "absent",
        identified: f.identified ?? "none",
        disguise: !!item.getFlag("acks-extras", "disguise"),
        magic: !!f.magic,
      };
    };
    /** A rendered item sheet read as booleans and counts. Queried from the window's root, since the band is moved into the header. */
    H.readOf = (item) => {
      const root = H.root(item?.sheet);
      if (!root) return { rendered: false };
      const effects = root.querySelector("section.tab[data-tab='effects']");
      const ownGroup = effects?.querySelector(".acks-extras-item-sheet__group") ?? null;
      const badge = [...root.querySelectorAll(".acks-extras-item-sheet__badge")].find((b) => H.text(b.querySelector(".acks-extras-item-sheet__badge-label")) === H.L("ACKS-EQUIPMENT.itemSheet.band.value"));
      const det = root.querySelector("input[data-action='toggleDetected']");
      const pencil = root.querySelector(".acks-extras-item-sheet__rail--editor [data-action='edit']");
      const stepButtons = [...root.querySelectorAll("button[data-action='knowStep']")];
      // The Details tab's price ledger: the lines above its final row, which sit in the same block.
      const finalRow = root.querySelector("section.tab[data-tab='details'] .acks-extras-item-sheet__fact.is-final");
      const ledgerRows = finalRow ? [...finalRow.parentElement.children].filter((n) => n.matches(".acks-extras-item-sheet__fact:not(.is-final)")).length : null;
      const num = (s) => { const m = String(s ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
      return {
        ledgerRows,
        ledgerFinal: num(H.text(finalRow?.querySelector(".acks-extras-item-sheet__fact-value"))),
        badgeFigure: num(H.text(badge?.querySelector(".acks-extras-item-sheet__badge-value"))),
        rendered: true,
        band: !!root.querySelector(".acks-extras-item-sheet__band"),
        tabs: [...root.querySelectorAll("nav [data-action='tab']")].map((t) => t.dataset.tab),
        effectsPanel: !!effects,
        detailsPanel: !!root.querySelector("section.tab[data-tab='details']"),
        effectRows: ownGroup ? ownGroup.querySelectorAll(".acks-extras-item-sheet__row").length : null,
        effectsUnidentified: H.text(effects).includes(H.L("ACKS-EQUIPMENT.itemSheet.effects.unidentified")),
        aura: !!root.querySelector(".acks-extras-item-sheet__aura-label"),
        auraClass: !!root.querySelector(".acks-extras-item-sheet__art.has-aura"),
        magicMount: !!root.querySelector("[data-mount='magic']"),
        magicPanel: !!root.querySelector(".acks-extras-markets-magic h3"),
        identifyBox: !!root.querySelector(".acks-extras-markets-identify"),
        badge: !!badge,
        valueTip: badge?.dataset.tooltip ?? badge?.dataset.tooltipText ?? null,
        detectedControl: det ? { disabled: !!det.disabled, checked: !!det.checked } : null,
        pencil: pencil ? pencil.getAttribute("aria-pressed") : null,
        steps: stepButtons.length,
        stepsDisabled: stepButtons.length ? stepButtons.every((b) => b.disabled) : null,
      };
    };
    H.tips = () => ({ value: H.L("ACKS-EQUIPMENT.itemSheet.value.value"), apparent: H.L("ACKS-EQUIPMENT.itemSheet.value.apparent") });
    /** Open a fresh item sheet, locked as a reopened sheet is, and wait for its band and panels. */
    H.open = async (actorId, itemId) => {
      const item = H.item(actorId, itemId);
      if (!item) return null;
      try { await item.sheet.close({ animate: false }); } catch { /* not open */ }
      await item.sheet.render(true);
      H.opened.push(item.sheet);
      await H.poll(() => H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__badge"));
      await H.sleep(500);
      return item;
    };
    const events = globalThis.Hooks?.events?.[H.MC.HOOKS.IDENTIFIED];
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      boot: globalThis.__muBoot ?? null,
      listener: events ? events.length > 0 : null,
    };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /**
   * Bring the kept fixtures to the shape every step starts from (the magic
   * item undetected, unidentified, undisguised, true name, cost and
   * description, carrying its effect, off any place; the known item with
   * `detected` absent; the Player seat owning the holder), and say what had
   * to be written.
   */
  shape: async ({ actorId, ids, playerId, truth, effect }) => {
    const H = globalThis.__mu;
    const actor = game.actors.get(actorId);
    const wrote = [];
    if ((actor.ownership?.[playerId] ?? 0) < 3) { await actor.update({ [`ownership.${playerId}`]: 3 }); wrote.push("ownership"); }
    const weapon = H.item(actorId, ids.weapon);
    const known = H.item(actorId, ids.known);
    const mundane = H.item(actorId, ids.mundane);
    if (!weapon || !known || !mundane) return { ok: false, found: { weapon: !!weapon, known: !!known, mundane: !!mundane } };
    if (weapon.getFlag("acks-extras", "disguise")) { await H.ACT.revealItem(weapon); wrote.push("reveal"); }
    const patch = {};
    if (weapon.name !== truth.name) patch.name = truth.name;
    if (Number(weapon.system.cost) !== truth.cost) patch["system.cost"] = truth.cost;
    if (weapon.system.description !== truth.description) patch["system.description"] = truth.description;
    if (weapon.system.equipped) patch["system.equipped"] = false;
    const f = H.markets(weapon);
    for (const [k, v] of Object.entries({ magic: true, aura: "arcane", identified: "none", detected: false })) if (f[k] !== v) patch[`flags.acks-extras.markets.${k}`] = v;
    if (Object.keys(patch).length) { await weapon.update(patch); wrote.push("weapon"); }
    if (f.triedAt) { await weapon.unsetFlag("acks-extras", "markets.triedAt"); wrote.push("triedAt"); }
    if ("apparentValueGp" in f) { await weapon.unsetFlag("acks-extras", "markets.apparentValueGp"); wrote.push("apparentValueGp"); }
    if (weapon.getFlag("acks-extras", "gear")) { await weapon.unsetFlag("acks-extras", "gear"); wrote.push("weaponGear"); }
    if (!weapon.effects.size) { await weapon.createEmbeddedDocuments("ActiveEffect", [effect]); wrote.push("effect"); }
    const kp = {};
    const kf = H.markets(known);
    for (const [k, v] of Object.entries({ magic: true, aura: "arcane", identified: "none" })) if (kf[k] !== v) kp[`flags.acks-extras.markets.${k}`] = v;
    if (Object.keys(kp).length) { await known.update(kp); wrote.push("known"); }
    if ("detected" in H.markets(known)) { await known.unsetFlag("acks-extras", "markets.detected"); wrote.push("knownDetected"); }
    if (known.getFlag("acks-extras", "gear")) { await known.unsetFlag("acks-extras", "gear"); wrote.push("knownGear"); }
    return {
      ok: true,
      wrote,
      effects: weapon.effects.size,
      weapon: H.state(weapon),
      knownMagic: H.IM.isMagical(known),
      knownDetectedAbsent: !("detected" in H.markets(known)),
      mundaneMagic: H.IM.isMagical(mundane),
      weaponType: weapon.type,
    };
  },
  /** The holder's ability items the identification path reads: each present once, with a throw target. */
  abilities: async ({ actorId, names }) => {
    const H = globalThis.__mu;
    const actor = game.actors.get(actorId);
    return names.map((n) => ({ ranks: actor.items.filter((i) => i.type === "ability" && i.name === n).length, target: Number(actor.items.find((i) => i.type === "ability" && i.name === n)?.system?.rollTarget ?? 0) }));
  },
  sees: async ({ actorId, count }) => !!(await globalThis.__mu.poll(() => (game.actors.get(actorId)?.items.size ?? 0) >= count)),
  /** Poll until the item matches `expect` (a subset of `state`); answers the last state either way. */
  waitState: async ({ actorId, itemId, expect }) => {
    const H = globalThis.__mu;
    const match = () => { const item = H.item(actorId, itemId); if (!item) return false; const s = H.state(item); return Object.entries(expect).every(([k, v]) => s[k] === v); };
    const met = !!(await H.poll(match));
    const item = H.item(actorId, itemId);
    return { met, state: item ? H.state(item) : null };
  },
  state: async ({ actorId, itemId }) => { const H = globalThis.__mu; const item = H.item(actorId, itemId); return item ? H.state(item) : null; },
  open: async ({ actorId, itemId }) => {
    const H = globalThis.__mu;
    const item = await H.open(actorId, itemId);
    return item ? { ...H.readOf(item), tips: H.tips() } : { rendered: false };
  },
  read: async ({ actorId, itemId }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    return item ? { ...H.readOf(item), tips: H.tips() } : { rendered: false };
  },
  /** Re-read the open sheet until `until` holds (`magicPanel`, `noMagicPanel`, `tipApparent`, `tipValue`, `unidentified`). */
  waitRead: async ({ actorId, itemId, until }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    const tips = H.tips();
    const preds = {
      magicPanel: (r) => r.magicPanel,
      noMagicPanel: (r) => !r.magicPanel && !r.magicMount,
      tipApparent: (r) => r.valueTip === tips.apparent,
      tipValue: (r) => r.valueTip === tips.value,
      unidentified: (r) => r.effectsUnidentified,
      noUnidentified: (r) => !r.effectsUnidentified,
    };
    const met = !!(await H.poll(() => { const r = H.readOf(item); return r.rendered && preds[until](r); }));
    return { met, ...H.readOf(item), tips };
  },
  /** Click the pencil the way a user does and wait for it to read pressed. */
  arm: async ({ actorId, itemId }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    const root = H.root(item.sheet);
    const pencil = root?.querySelector(".acks-extras-item-sheet__rail--editor [data-action='edit']");
    if (!pencil) return { found: false };
    const before = pencil.getAttribute("aria-pressed");
    if (before !== "true") pencil.click();
    const pressed = !!(await H.poll(() => H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__rail--editor [data-action='edit'][aria-pressed='true']")));
    await H.sleep(300);
    return { found: true, before, pressed };
  },
  /** Click a tab button of the open sheet, and wait for its panel to light. */
  tab: async ({ actorId, itemId, key }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    const button = H.root(item.sheet)?.querySelector(`nav [data-action='tab'][data-tab='${key}']`);
    if (!button) return { found: false };
    button.click();
    const lit = !!(await H.poll(() => H.root(item.sheet)?.querySelector(`section.tab[data-tab='${key}'].active`)));
    return { found: true, lit };
  },
  /** Click the Detected checkbox and wait for the flag to change. */
  clickDetected: async ({ actorId, itemId }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    const before = H.state(item).detected;
    const box = H.root(item.sheet)?.querySelector("input[data-action='toggleDetected']");
    if (!box) return { found: false };
    const disabled = !!box.disabled;
    box.click();
    const changed = !!(await H.poll(() => H.state(item).detected !== before));
    await H.sleep(500);
    return { found: true, disabled, before, after: H.state(item).detected, changed };
  },
  /** Click a know-step button of the open, armed sheet and wait for `identified` to change. */
  clickStep: async ({ actorId, itemId, step }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    const before = H.state(item).identified;
    const button = H.root(item.sheet)?.querySelector(`button[data-action='knowStep'][data-step='${step}']`);
    if (!button) return { found: false };
    const disabled = !!button.disabled;
    button.click();
    const changed = !!(await H.poll(() => H.state(item).identified !== before));
    return { found: true, disabled, before, state: H.state(item), changed };
  },
  /** Set the magic panel's Identification select (the one offering none, partial and full) and fire its change, as a Judge's pick does. */
  pickIdentified: async ({ actorId, itemId, value }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    const root = H.root(item.sheet);
    const select = [...(root?.querySelectorAll(".acks-extras-markets-magic select") ?? [])].find((s) => [...s.options].map((o) => o.value).join(",") === "none,partial,full");
    if (!select) return { found: false };
    const before = H.state(item).identified;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const changed = !!(await H.poll(() => H.state(item).identified !== before));
    return { found: true, before, state: H.state(item), changed };
  },
  /** The disguise a Judge makes: the equipment API's `disguiseItem`, with an apparent name, cost and description. */
  disguise: async ({ actorId, itemId, apparent }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    await H.ACT.disguiseItem(item, apparent);
    return H.state(item);
  },
  /** Put an item at the state step 5 starts from: disguised, recognized (true name back), partly identified and detected. */
  shapeRecognized: async ({ actorId, itemId, apparent, truth }) => {
    const H = globalThis.__mu;
    const item = H.item(actorId, itemId);
    if (!item.getFlag("acks-extras", "disguise")) await H.ACT.disguiseItem(item, apparent);
    await item.setFlag("acks-extras", "markets", H.IM.markIdentified(H.markets(item), "partial"));
    if (item.name !== truth.name) await item.update({ name: truth.name });
    return H.state(item);
  },
  /**
   * One identification from this seat. The real path runs `identifyAttempt`
   * with the method the item and the identifier's own abilities make available
   * (a recognizing one, or magic research), the die rigged to a natural 20 for
   * the call only. Without such a method the other path writes the flag as
   * `markIdentified` does and fires the `IDENTIFIED` payload as the attempt
   * does after a success. The cards the call posted are answered by id.
   */
  identify: async ({ actorId, itemId, kind }) => {
    const H = globalThis.__mu;
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    const printed = H.PR.identification();
    const avail = H.ID.availableMethods(item, actor);
    const pool = kind === "recognize" ? avail.filter((k) => H.ID.METHODS[k]?.recognizes) : avail.filter((k) => k === "magicResearch");
    const facts = { tiers: printed.engineeringTiers != null, available: avail.length, picked: pool.length > 0 };
    const seen = H.chat.length;
    let out;
    if (pool.length) {
      const method = pool[0];
      const rig = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.025;
      try {
        const r = await H.ID.identifyAttempt(item, { identifier: actor, method });
        out = { path: "real", method, result: { ok: !!r?.ok, success: !!r?.success, depth: r?.depth ?? null, error: r?.error ?? null } };
      } finally {
        CONFIG.Dice.randomUniform = rig;
      }
    } else {
      const method = kind === "recognize" ? "loremastery" : "magicResearch";
      const depth = H.ID.METHODS[method].depth;
      await item.setFlag("acks-extras", "markets", H.IM.markIdentified(H.markets(item), depth));
      Hooks.callAll(H.MC.HOOKS.IDENTIFIED, { item, identifier: actor, method, depth });
      out = { path: "hook", method, result: { depth } };
    }
    // Only the cards this client made during the call that speak as the holder.
    return { ...out, facts, chat: H.chat.splice(seen).filter((id) => game.messages.get(id)?.speaker?.actor === actorId) };
  },
  /** Make the neck place's declaration and wear: `weapon` wears the magic item, `both` also the known item, `none` takes both off and clears the declaration. */
  wear: async ({ actorId, ids, place, which }) => {
    const H = globalThis.__mu;
    const weapon = H.item(actorId, ids.weapon);
    const known = H.item(actorId, ids.known);
    if (which === "none") {
      for (const item of [weapon, known]) {
        await H.IM.setWorn(item, null);
        if (item.getFlag("acks-extras", "gear")) await item.unsetFlag("acks-extras", "gear");
      }
      if (weapon.system.equipped) await weapon.update({ "system.equipped": false });
      return { ok: true };
    }
    await weapon.update({ "flags.acks-extras.gear": { slots: [place] } });
    await known.update({ "flags.acks-extras.gear": { slots: [place] } });
    await H.IM.setWorn(weapon, place);
    await H.IM.setWorn(known, which === "both" ? place : null);
    return { ok: true, weaponAt: H.IM.wornSlotOf(weapon), knownAt: H.IM.wornSlotOf(known) };
  },
  waitWorn: async ({ actorId, ids, place, which }) => {
    const H = globalThis.__mu;
    const at = () => ({ weapon: H.IM.wornSlotOf(H.item(actorId, ids.weapon)) ?? null, known: H.IM.wornSlotOf(H.item(actorId, ids.known)) ?? null });
    const want = { weapon: place, known: which === "both" ? place : null };
    const met = !!(await H.poll(() => { const a = at(); return a.weapon === want.weapon && a.known === want.known; }));
    return { met };
  },
  /** A fresh character sheet on the Equipment tab, its place read against the counts `expect` says a viewer is shown. */
  place: async ({ actorId, ids, place, expect }) => {
    const H = globalThis.__mu;
    const actor = game.actors.get(actorId);
    const app = new acksExtras.characterSheet.Sheet({ document: actor });
    H.opened.push(app);
    app.tabGroups.primary = "equipment";
    await app.render(true);
    const slotOf = () => H.root(app)?.querySelector(`.acks-extras-frame__slot[data-drop='slot:${place}']`) ?? null;
    let slot = await H.poll(slotOf);
    if (!slot) {
      app.changeTab?.("equipment", "primary");
      slot = await H.poll(slotOf);
    }
    await H.sleep(400);
    slot = slotOf();
    if (!slot) return { rendered: !!H.root(app), slot: false };
    const at = actor.items.filter((i) => H.IM.isWorn(i) && H.IM.wornSlotOf(i) === place);
    const truth = H.IM.slotUse(place, at);
    const cap = slot.querySelector(".acks-extras-frame__slot-cap");
    const used = Math.max(truth.equip, expect.magic);
    const hint = cap?.dataset.tooltipText ?? "";
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    return {
      rendered: true,
      slot: true,
      capKnown: truth.cap !== null,
      capFinite: Number.isFinite(truth.cap),
      placed: { weapon: !!slot.querySelector(`[data-item-id='${ids.weapon}']`), known: !!slot.querySelector(`[data-item-id='${ids.known}']`) },
      textOk: cap ? norm(H.text(cap)) === `${used} / ${truth.cap}` : false,
      hintOk: hint === game.i18n.format("ACKS-CHARACTER.equipment.slotUse", { magic: expect.magic, cap: truth.cap, equip: truth.equip }),
      full: slot.classList.contains("is-full"),
      truthFull: truth.full,
    };
  },
  closeAll: async () => globalThis.__mu.closeAll(),
  /** Set the apparent worth a masked cost reads, on the GM seat. */
  setApparent: async ({ actorId, itemId, gp }) => { await globalThis.__mu.item(actorId, itemId).setFlag("acks-extras", "markets.apparentValueGp", gp); return true; },
  takeChat: async ({ actorId }) => (globalThis.__mu?.chat?.splice(0) ?? []).filter((id) => game.messages.get(id)?.speaker?.actor === actorId),
  drain: async () => ({ errors: globalThis.__mu.errors.slice() }),
  restore: async () => {
    const H = globalThis.__mu;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    H.patched = false;
    if (H.chatWrapped) { ChatMessage.create = H.chatCreate; H.chatWrapped = false; }
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
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment && !!globalThis.acksExtras?.characterSheet`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** A CDP session on the seat's page, for the boot recorder. */
async function cdp(port) {
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
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const s = await cdp(port);
  await s.send("Page.enable");
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await s.send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  s.close();
  return seconds;
}
const idOf = (fx) => fx.id ?? String(fx.uuid).split(".").pop();

let gm = null;
let player = null;
let holderId = null;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 600_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Track the cards an attempt posted on the Player seat, on the GM seat's ledger, so the sweep names them. */
async function trackCards(ids) {
  for (const id of ids ?? []) made.push(gm.track(id, "ChatMessage"));
}

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    const phases = c.boot?.phases ?? [];
    const errors = c.boot?.errors ?? [];
    const naming = errors.filter((e) => /item-model|identify|markets|equipment|item-sheet|disguise|magicKnowledge|detected/i.test(e.text));
    note(`${key}: errors recorded from load through ready (any text)`, errors.length);
    check(`${key}: init, setup and ready ran and no error names the files this walk touches`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && naming.length === 0, { phases, naming: naming.length });
    check(`${key}: the identification reveal listener is registered on the markets hook`, c.listener !== false, { listener: c.listener });
  }

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const holder = await gm.fixture(MARKS.holder, "Actor", { name: NAMES.holder, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 } });
  const actorId = idOf(holder);
  holderId = actorId;
  const weaponFx = await gm.fixture(MARKS.weapon, "Item", {
    name: TRUTH.name, type: "weapon",
    system: { melee: true, missile: false, cost: TRUTH.cost, description: TRUTH.description },
    flags: { "acks-extras": { markets: MARKETS_DETECTED_FALSE } },
    effects: [EFFECT],
  }, { parent: holder.uuid });
  const knownFx = await gm.fixture(MARKS.known, "Item", { name: NAMES.known, type: "item", flags: { "acks-extras": { markets: { magic: true, aura: "arcane", identified: "none" } } } }, { parent: holder.uuid });
  const mundaneFx = await gm.fixture(MARKS.mundane, "Item", { name: NAMES.mundane, type: "item" }, { parent: holder.uuid });
  const ABILITY_NAMES = { lore: "Loremastery", engineering: "Magical Engineering", research: "Magic Research" };
  for (const [key, name] of Object.entries(ABILITY_NAMES)) await gm.fixture(MARKS[key], "Item", ABILITY(name), { parent: holder.uuid });
  const ids = { weapon: idOf(weaponFx), known: idOf(knownFx), mundane: idOf(mundaneFx) };
  await sleep(800);
  check("the player seat sees the holder's six items", await run(player, P.sees, { actorId, count: 6 }));
  const abilities = await run(gm, P.abilities, { actorId, names: Object.values(ABILITY_NAMES) });
  check("the holder carries each identifier ability once, with a throw target", abilities.every((a) => a.ranks === 1 && a.target > 0), abilities.map((a) => [a.ranks, a.target > 0]));

  /** Bring the kept fixtures to the shape a step starts from, then wait for the Player seat's copy to show it. */
  const reshape = async (label) => {
    const s = await run(gm, P.shape, { actorId, ids, playerId, truth: TRUTH, effect: EFFECT });
    const sync = await run(player, P.waitState, { actorId, itemId: ids.weapon, expect: { detected: false, identified: "none", disguise: false, name: TRUTH.name } });
    check(`${label}: the magic item is undetected, unidentified, undisguised, with its effect and its true name, on both seats`, s.ok && s.weaponType === "weapon" && s.effects >= 1 && s.weapon.detected === false && s.weapon.identified === "none" && !s.weapon.disguise && s.weapon.magic && sync.met, { wrote: s.wrote, effects: s.effects, state: s.weapon, synced: sync.met });
    check(`${label}: the known magic item is magic with no detected mark, and the mundane item is not magic`, s.knownMagic && s.knownDetectedAbsent && !s.mundaneMagic, { knownMagic: s.knownMagic, absent: s.knownDetectedAbsent, mundaneMagic: s.mundaneMagic });
    return s;
  };

  section("1. the Player seat's sheet of an undetected item");
  await reshape("1");
  await run(gm, P.setApparent, { actorId, itemId: ids.weapon, gp: APPARENT_GP });
  await run(player, P.waitState, { actorId, itemId: ids.weapon, expect: { detected: false } });
  const p1 = await run(player, P.open, { actorId, itemId: ids.weapon });
  check("the module's item sheet rendered on the player seat, with its value badge, Details panel and Effects panel", p1.rendered && p1.band && p1.badge && p1.detailsPanel && p1.effectsPanel, { rendered: p1.rendered, band: p1.band, badge: p1.badge, details: p1.detailsPanel, effects: p1.effectsPanel });
  check("the Details tab has no identification panel and no magic mount", !p1.magicMount && !p1.magicPanel && !p1.identifyBox, { mount: p1.magicMount, panel: p1.magicPanel, box: p1.identifyBox });
  check("the Effects tab names no hidden effects and lists none", p1.effectRows === 0 && !p1.effectsUnidentified, { rows: p1.effectRows, unidentified: p1.effectsUnidentified });
  check("the art carries no aura mark", !p1.aura && !p1.auraClass, { label: p1.aura, cls: p1.auraClass });
  check("no Appearance tab and no Detected control are offered to the player", !p1.tabs?.includes("appearance") && p1.detectedControl === null, { tabs: p1.tabs });
  check("the value badge's tooltip is the ordinary value one and not the apparent-worth one", p1.valueTip === p1.tips.value && p1.valueTip !== p1.tips.apparent, { ordinary: p1.valueTip === p1.tips.value, apparent: p1.valueTip === p1.tips.apparent });
  check("the Details tab's price ledger is one line for the player, at the apparent worth the badge reads", p1.ledgerRows === 1 && p1.ledgerFinal === APPARENT_GP && p1.ledgerFinal === p1.badgeFigure, { rows: p1.ledgerRows, final: p1.ledgerFinal, badge: p1.badgeFigure });
  await run(player, P.closeAll);

  section("2. the Player seat's Equipment tab, the place the item is worn at");
  await reshape("2");
  const wornWeapon = await run(gm, P.wear, { actorId, ids, place: PLACE, which: "weapon" });
  const syncA = await run(player, P.waitWorn, { actorId, ids, place: PLACE, which: "weapon" });
  check("the magic item is worn at the walk's place on both seats, the known item carried", wornWeapon.ok && wornWeapon.weaponAt === PLACE && wornWeapon.knownAt === null && syncA.met, { weaponAt: wornWeapon.weaponAt, knownAt: wornWeapon.knownAt, synced: syncA.met });
  const placeP1 = await run(player, P.place, { actorId, ids, place: PLACE, expect: { magic: 0 } });
  const placeG1 = await run(gm, P.place, { actorId, ids, place: PLACE, expect: { magic: 1 } });
  check("the place's capacity is a figure the walk can count against", placeP1.capKnown && placeP1.capFinite, { capKnown: placeP1.capKnown, finite: placeP1.capFinite });
  if (placeP1.capKnown && placeP1.capFinite) {
    check("the player's badge counts none of the undetected magic: its figure and its hover read zero magic here", placeP1.slot && placeP1.placed?.weapon && placeP1.textOk && placeP1.hintOk, { slot: placeP1.slot, placed: placeP1.placed, text: placeP1.textOk, hint: placeP1.hintOk });
    check("the GM's badge counts it: its hover reads one magic here", placeG1.slot && placeG1.placed?.weapon && placeG1.textOk && placeG1.hintOk, { slot: placeG1.slot, placed: placeG1.placed, text: placeG1.textOk, hint: placeG1.hintOk });
    check("one magic item at a place that takes one reads full on neither seat", !placeP1.full && !placeG1.full, { player: placeP1.full, gm: placeG1.full });
    await run(player, P.closeAll);
    await run(gm, P.closeAll);
    const wornBoth = await run(gm, P.wear, { actorId, ids, place: PLACE, which: "both" });
    const syncB = await run(player, P.waitWorn, { actorId, ids, place: PLACE, which: "both" });
    check("the known magic item is worn at the same place on both seats", wornBoth.ok && wornBoth.knownAt === PLACE && syncB.met, { knownAt: wornBoth.knownAt, synced: syncB.met });
    const placeP2 = await run(player, P.place, { actorId, ids, place: PLACE, expect: { magic: 1 } });
    const placeG2 = await run(gm, P.place, { actorId, ids, place: PLACE, expect: { magic: 2 } });
    check("the player's badge counts the known item and not the undetected one", placeP2.placed?.weapon && placeP2.placed?.known && placeP2.textOk && placeP2.hintOk, { placed: placeP2.placed, text: placeP2.textOk, hint: placeP2.hintOk });
    check("the GM's badge counts both", placeG2.placed?.weapon && placeG2.placed?.known && placeG2.textOk && placeG2.hintOk, { placed: placeG2.placed, text: placeG2.textOk, hint: placeG2.hintOk });
    check("a second magic item past the place's capacity marks it full for the GM and not for the player, whose badge counts one", placeP2.truthFull && placeG2.full && !placeP2.full, { truth: placeP2.truthFull, player: placeP2.full, gm: placeG2.full });
  } else {
    note("step 2 counting skipped", "the place's capacity did not read as a finite figure on this world; no capacity is invented here");
  }
  await run(player, P.closeAll);
  await run(gm, P.closeAll);
  await run(gm, P.wear, { actorId, ids, place: PLACE, which: "none" });
  note("step 2 place", "the ring place's imported capacity is not driven; the walk fills the neck place");

  section("3. the GM seat's sheet of the same item");
  await reshape("3");
  await run(gm, P.setApparent, { actorId, itemId: ids.weapon, gp: APPARENT_GP });
  const g3 = await run(gm, P.open, { actorId, itemId: ids.weapon });
  check("the module's item sheet rendered on the GM seat with its Appearance tab", g3.rendered && g3.band && g3.tabs?.includes("appearance"), { rendered: g3.rendered, band: g3.band, tabs: g3.tabs?.length });
  check("the aura shows on the art", g3.aura && g3.auraClass, { label: g3.aura, cls: g3.auraClass });
  check("the magic panel is mounted and the effect is listed, nothing hidden", g3.magicMount && g3.magicPanel && g3.effectRows >= 1 && !g3.effectsUnidentified, { mount: g3.magicMount, panel: g3.magicPanel, rows: g3.effectRows, unidentified: g3.effectsUnidentified });
  check("the Judge's Detected control is offered, reads unticked and is locked until the pencil is armed", g3.detectedControl?.checked === false && g3.detectedControl?.disabled === true, g3.detectedControl);
  check("the value badge reads the ordinary tooltip for a Judge", g3.valueTip === g3.tips.value, { ordinary: g3.valueTip === g3.tips.value });
  check("the Judge's price ledger shows its working at the true cost, whatever the apparent worth", g3.ledgerRows >= 1 && g3.ledgerFinal === TRUTH.cost, { rows: g3.ledgerRows, final: g3.ledgerFinal, badge: g3.badgeFigure });
  await run(gm, P.closeAll);

  section("4. recognize: a disguised item, a recognizing identification from the Player seat");
  await reshape("4");
  const disguised = await run(gm, P.disguise, { actorId, itemId: ids.weapon, apparent: APPARENT });
  const seenDisguised = await run(player, P.waitState, { actorId, itemId: ids.weapon, expect: { name: APPARENT.name, disguise: true, cost: APPARENT.cost } });
  check("the Judge's disguise took: the apparent name, cost and description, the disguise flag on, still undetected, on both seats", disguised.name === APPARENT.name && disguised.cost === APPARENT.cost && disguised.description === APPARENT.description && disguised.disguise && disguised.detected === false && seenDisguised.met, { name: disguised.name === APPARENT.name, cost: disguised.cost === APPARENT.cost, description: disguised.description === APPARENT.description, flag: disguised.disguise, detected: disguised.detected, synced: seenDisguised.met });
  const rec = await run(player, P.identify, { actorId, itemId: ids.weapon, kind: "recognize" });
  await trackCards(rec.chat);
  note("step 4 path", { path: rec.path, method: rec.method, facts: rec.facts, result: rec.result });
  if (rec.path === "hook") note("step 4 fallback", "the identification values the recognizing methods need are not imported, or no identifier qualified; the IDENTIFIED payload was fired as identifyAttempt fires it after a success, which proves the listener and not the throw");
  if (rec.path === "real") check("the attempt ran through identifyAttempt and succeeded to a partial identification", rec.result.ok && rec.result.success && rec.result.depth === "partial", rec.result);
  const recognized = await run(player, P.waitState, { actorId, itemId: ids.weapon, expect: { name: TRUTH.name, detected: true } });
  const rs = recognized.state;
  check("the item is detected", rs?.detected === true, { detected: rs?.detected });
  check("the name is the true one", rs?.name === TRUTH.name, { name: rs?.name === TRUTH.name });
  check("the cost and the description are still the apparent ones", rs?.cost === APPARENT.cost && rs?.description === APPARENT.description, { cost: rs?.cost === APPARENT.cost, description: rs?.description === APPARENT.description });
  check("the disguise flag is still on the item and it reads partly identified", rs?.disguise === true && rs?.identified === "partial", { disguise: rs?.disguise, identified: rs?.identified });

  section("5. full: an identification that grants full");
  const need = { disguise: true, identified: "partial", detected: true, name: TRUTH.name };
  const at5 = await run(player, P.waitState, { actorId, itemId: ids.weapon, expect: need });
  if (!at5.met) {
    await reshape("5");
    await run(gm, P.shapeRecognized, { actorId, itemId: ids.weapon, apparent: APPARENT, truth: TRUTH });
  }
  const atStart = await run(player, P.waitState, { actorId, itemId: ids.weapon, expect: need });
  check("the item starts as step 4 left it: disguised, recognized, partly identified and detected", atStart.met, { reshaped: !at5.met, state: atStart.state && { disguise: atStart.state.disguise, identified: atStart.state.identified, detected: atStart.state.detected } });
  const full = await run(player, P.identify, { actorId, itemId: ids.weapon, kind: "full" });
  await trackCards(full.chat);
  note("step 5 path", { path: full.path, method: full.method, facts: full.facts, result: full.result });
  if (full.path === "hook") note("step 5 fallback", "no full method was available to the holder; the IDENTIFIED payload was fired as identifyAttempt fires it after a success");
  if (full.path === "real") check("the attempt ran through identifyAttempt and succeeded to a full identification", full.result.ok && full.result.success && full.result.depth === "full", full.result);
  const fullState = await run(player, P.waitState, { actorId, itemId: ids.weapon, expect: { disguise: false, identified: "full" } });
  const fs5 = fullState.state;
  check("the disguise flag is gone", fs5?.disguise === false, { disguise: fs5?.disguise });
  check("every masked field is true again: name, cost and description", fs5?.name === TRUTH.name && fs5?.cost === TRUTH.cost && fs5?.description === TRUTH.description, { name: fs5?.name === TRUTH.name, cost: fs5?.cost === TRUTH.cost, description: fs5?.description === TRUTH.description });

  section("6. the Judge's mark: Detected on the Appearance tab, armed and clicked");
  await reshape("6");
  const mundaneG = await run(gm, P.open, { actorId, itemId: ids.mundane });
  check("the Detected control is absent on a mundane item, which has no Appearance tab either", mundaneG.rendered && mundaneG.band && mundaneG.detectedControl === null && mundaneG.tabs && !mundaneG.tabs.includes("appearance"), { rendered: mundaneG.rendered, band: mundaneG.band, tabs: mundaneG.tabs?.length });
  await run(gm, P.closeAll);
  // The player's sheet is opened first and stays open across the GM's clicks, so what it shows afterwards is its own re-render.
  const before6 = await run(player, P.open, { actorId, itemId: ids.weapon });
  check("before the tick the player's sheet shows no identification panel and the ordinary value tooltip", !before6.magicPanel && !before6.magicMount && before6.valueTip === before6.tips.value, { panel: before6.magicPanel, ordinary: before6.valueTip === before6.tips.value });
  const g6 = await run(gm, P.open, { actorId, itemId: ids.weapon });
  check("on the GM's sheet the Detected control is offered and locked before the pencil is armed", g6.detectedControl?.disabled === true && g6.detectedControl?.checked === false, g6.detectedControl);
  const armed = await run(gm, P.arm, { actorId, itemId: ids.weapon });
  check("the pencil, clicked, reads pressed", armed.found && armed.pressed, armed);
  const tab6 = await run(gm, P.tab, { actorId, itemId: ids.weapon, key: "appearance" });
  check("the Appearance tab lights when its tab button is clicked", tab6.found && tab6.lit, tab6);
  const ticked = await run(gm, P.clickDetected, { actorId, itemId: ids.weapon });
  check("the Detected checkbox is enabled once armed and its click makes markets.detected true", ticked.found && ticked.disabled === false && ticked.changed && ticked.before === false && ticked.after === true, ticked);
  const afterTick = await run(player, P.waitRead, { actorId, itemId: ids.weapon, until: "magicPanel" });
  check("the player's open sheet now shows the identification panel", afterTick.met && afterTick.magicPanel, { met: afterTick.met });
  const tipNow = await run(player, P.waitRead, { actorId, itemId: ids.weapon, until: "tipApparent" });
  check("the value badge's tooltip changed from the ordinary one to the apparent-worth one", tipNow.met && tipNow.valueTip === tipNow.tips.apparent && tipNow.valueTip !== tipNow.tips.value, { apparent: tipNow.valueTip === tipNow.tips.apparent });
  check("the aura waits for a partial identification, so the player's art still carries none", !tipNow.aura && !tipNow.auraClass, { label: tipNow.aura, cls: tipNow.auraClass });
  const hiddenNow = await run(player, P.waitRead, { actorId, itemId: ids.weapon, until: "unidentified" });
  check("the Effects tab now says the effects are hidden until identified, and still lists none", hiddenNow.met && hiddenNow.effectRows === 0, { met: hiddenNow.met, rows: hiddenNow.effectRows });
  check("the player's sheet still offers no Appearance tab and no Detected control", !hiddenNow.tabs?.includes("appearance") && hiddenNow.detectedControl === null, { tabs: hiddenNow.tabs });
  const unticked = await run(gm, P.clickDetected, { actorId, itemId: ids.weapon });
  check("the click on the ticked control makes markets.detected false", unticked.found && unticked.changed && unticked.before === true && unticked.after === false, unticked);
  const hidden = await run(player, P.waitRead, { actorId, itemId: ids.weapon, until: "noMagicPanel" });
  const tipBack = await run(player, P.waitRead, { actorId, itemId: ids.weapon, until: "tipValue" });
  check("the player's sheet hides the magic again: no identification panel and the ordinary value tooltip", hidden.met && tipBack.met, { panelGone: hidden.met, tipBack: tipBack.met });
  const effectsBack = await run(player, P.waitRead, { actorId, itemId: ids.weapon, until: "noUnidentified" });
  check("the Effects tab no longer names hidden effects", effectsBack.met && effectsBack.effectRows === 0, { met: effectsBack.met });
  await run(player, P.closeAll);
  await run(gm, P.closeAll);

  section("7. the Judge's panel and the Appearance tab raise identification and set detected");
  await reshape("7a");
  const g7 = await run(gm, P.open, { actorId, itemId: ids.weapon });
  const tab7 = await run(gm, P.tab, { actorId, itemId: ids.weapon, key: "appearance" });
  check("the magic panel is mounted on the GM's Appearance tab", g7.rendered && tab7.found && tab7.lit && g7.magicPanel, { panel: g7.magicPanel, lit: tab7.lit });
  const picked = await run(gm, P.pickIdentified, { actorId, itemId: ids.weapon, value: "partial" });
  check("raising Identification to Partly identified in the magic panel also sets detected true", picked.found && picked.changed && picked.state?.identified === "partial" && picked.state?.detected === true, { found: picked.found, before: picked.before, identified: picked.state?.identified, detected: picked.state?.detected });
  await run(gm, P.closeAll);
  await reshape("7b");
  const copy = await gm.create("Item", {
    name: NAMES.copy, type: "weapon",
    system: { melee: true, missile: false, cost: TRUTH.cost, description: TRUTH.description },
    flags: { "acks-extras": { markets: MARKETS_DETECTED_FALSE } },
  }, { parent: holder.uuid });
  made.push(copy.uuid);
  const copyId = idOf(copy);
  await sleep(500);
  const copyStart = await run(gm, P.state, { actorId, itemId: copyId });
  check("the fresh copy starts undetected and unidentified", copyStart?.detected === false && copyStart?.identified === "none", { detected: copyStart?.detected, identified: copyStart?.identified });
  const gc = await run(gm, P.open, { actorId, itemId: copyId });
  const armedCopy = await run(gm, P.arm, { actorId, itemId: copyId });
  const tabCopy = await run(gm, P.tab, { actorId, itemId: copyId, key: "appearance" });
  check("the copy's sheet is open on its Appearance tab with the pencil armed", gc.rendered && armedCopy.pressed && tabCopy.lit, { rendered: gc.rendered, pressed: armedCopy.pressed, lit: tabCopy.lit });
  const stepped = await run(gm, P.clickStep, { actorId, itemId: copyId, step: 2 });
  check("the Appearance tab's Partly identified step also sets detected true", stepped.found && stepped.disabled === false && stepped.changed && stepped.state?.identified === "partial" && stepped.state?.detected === true, { found: stepped.found, identified: stepped.state?.identified, detected: stepped.state?.detected });
  await run(gm, P.closeAll);

  section("8. console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, P.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3));
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && player) {
    try { await trackCards(await run(player, P.takeChat, { actorId: holderId })); } catch (err) { console.error("cards:", err?.message ?? err); }
  }
  if (player) {
    try { await run(player, P.closeAll); } catch {}
    try { note("restored (player)", await run(player, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { await run(gm, P.closeAll); } catch {}
    try { note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
    // Only the run's own ids: the copy and the identification cards. The kept fixtures stay.
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
