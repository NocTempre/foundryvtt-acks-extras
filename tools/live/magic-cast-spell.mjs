/**
 * Live walk, magic-cast-spell: the cast engine for a spell with effect rows
 * (`scripts/magic/cast-spell.mjs`, `cast-card.mjs`, `cast-apply.mjs`,
 * `cast-expiry.mjs`). Walks docs/magic/TESTING.md "Casting a spell (the cast
 * engine)" on the GM and Player seats, with the spells imported from the seat's
 * own RR by cookbook id: a boot recorder attached before the reload sees `init`,
 * `setup` and `ready`; a damage row with a save cast at three targeted tokens
 * rolls once and each target applies the amount its save leaves, rounded as the
 * module rounds, with its type on the card, and Undo puts the hit points back;
 * the same cast with nothing targeted posts the roll and an Apply that takes the
 * presser's targets; the reversed form throws through the system's card as the
 * magic attack type with no apply button there and the amount applied by the
 * cast; the plain heal heals; a condition cast twice on one target leaves two
 * status-only records and one condition, which the clock takes off record by
 * record; a monster's attack item still posts the system's own card; a Player
 * casting at a token it does not own is applied by the GM's client; and with
 * every slot spent the Player is refused and the Judge warned. Prints booleans
 * and counts, never a figure, a name or an id. The walk asserts relations
 * (applied against rolled and the save's fraction), never a printed value; the
 * figures it uses on its own copies are invented. Machine values arrive through
 * ./_env.mjs.
 *
 * Then the buff steps (docs/magic/TESTING.md, "The buff steps"), which walk what
 * a cast's modifier and ward rows become and how lib reads them at the roll. A
 * circle cast by the Player at the caster's token and the ally's leaves one
 * status-free record per recipient carrying lib's `rollMods` (scoped `ac`,
 * `save` and `ward` parts with the scope copied and the caster's alignment key),
 * the ally's written by the GM's client, and the card's entries carry tooltips
 * naming the spell. A hostile undead creature's attack on the ally stores an
 * attack card whose modifier list holds one row for the circle on the ally, of
 * minus the ally's AC part, and the ward is warned; a hostile creature of no
 * kind and no alignment draws the undetermined notice and no row; the ally's own
 * attack on the caster draws neither; the undead creature's spell at the ally
 * rolls a save whose target is the base less the circle's save part. Sharpness
 * cast on the ally's blade (the Player's cast, the weapon picked in the dialog)
 * leaves one record whose parts name the blade, and the blade's attack card
 * carries a row for the spell on the attack and on the damage while the ally's
 * other weapon carries none; cast twice, one row is the larger of the two
 * records' figures, then the smaller once the first ends by the clock, then none;
 * beside the other weapon's masterwork (read live from the imported figure) the
 * larger of the two stands and the other is taken back out or never added, the
 * net always equal to the larger; and with two tokens targeted the Player is
 * blocked and the Judge warned. The buff steps assert relations between what a
 * record, a stored attack card, a notice and a stored save hold, never a printed
 * value, and print booleans and counts only; a figure the import left blank
 * fails its step as an import finding. The steps the held casts and the
 * declaration add (concentration's end, the tail and the cap, a recast, a
 * declaration lost, resolved and stale) are not written here; `walkBuffs`
 * leaves their place marked.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `magic/cast-scene` (the field), `magic/cast-class` (a class with one vancian
 * tradition and two first-level slots), `magic/cast-caster` (a character the
 * Player owns, bound to it), `magic/cast-spell-damage`, `magic/cast-spell-cure`
 * and `magic/cast-spell-fright` (copies of the three imported spells on the
 * caster, each brought to a known shape at the start), `magic/cast-target-a`,
 * `-b` and `-c` (three monsters nobody but the GM owns) and `magic/cast-monster`
 * (a monster with one weapon). For the buff steps: `magic/cast-spell-circle`
 * and `magic/cast-spell-edge` (copies of two more imported spells on the
 * caster), `magic/cast-ally` (a character only the GM owns) with
 * `magic/cast-ally-blade` (a mundane weapon) and `magic/cast-ally-fine` (a
 * weapon stamped with the both-ways masterwork tier), `magic/cast-foe` (an
 * undead, Chaotic monster) with `magic/cast-foe-claw` and `magic/cast-foe-spell`
 * (a copy of the damage spell), and `magic/cast-stranger` (a monster of no kind
 * and no alignment) with `magic/cast-stranger-claw`. The run's own tokens,
 * cards and records are tracked by uuid and swept alone. The walk moves the world clock forward by a
 * few minutes and restores the dice it rigged.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const KEY = "magic-cast-spell-walk";
const IDS = { damage: "def.spell.desiccate", cure: "def.spell.cureLightInjury", fright: "def.spell.frightenHumanoid" };
/** The two spells the buff steps copy, imported apart from `IDS` so the first section's three-spell check stands as it was. */
const BUFF_IDS = { circle: "def.spell.holyCircle", edge: "def.spell.sharpness" };
/** The durations the buff steps set on their own copies, so a record is timed and the clock can end it. The figures are the walk's own, not the book's. */
const CIRCLE_DURATION = { shape: "fixed", value: 60, unit: "minutes" };
const EDGE_DURATION = { shape: "fixed", value: 2, unit: "minutes" };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Runs before any of Foundry's scripts on the next document load: records warnings and errors from `init` on. */
const BOOT_RECORDER = `(() => {
  if (window.top !== window) return;
  const B = (window.__boot = { preFoundry: typeof globalThis.Hooks === "undefined" && typeof globalThis.game === "undefined", warn: [], error: [] });
  const text = (args) => args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300);
  for (const level of ["warn", "error"]) {
    const original = console[level];
    console[level] = (...args) => { B[level].push(text(args)); return original.apply(console, args); };
  }
  window.addEventListener("error", (e) => B.error.push("uncaught: " + String(e.message ?? "").slice(0, 200)));
})();`;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mcs = globalThis.__mcs ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 250 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn;
      ui.notifications.warn = function (msg, ...rest) { H.warns.push(String(msg)); return H.warn.call(this, msg, ...rest); };
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, claimant: typeof globalThis.acksExtras?.lib?.spellUse?.addClaimant === "function", carrier: typeof globalThis.acksExtras?.lib?.attack?.spellCarrier === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  boot: async () => {
    const b = window.__boot ?? null;
    return { recorded: !!b, preFoundry: !!b?.preFoundry, noRegisterError: b ? !b.error.some((e) => /spell cast could not register|cast-spell|cast card/u.test(e)) : null, errors: b?.error.length ?? null };
  },
  drain: async () => {
    const H = globalThis.__mcs;
    const out = { errors: H.errors.slice(), warns: H.warns.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    return out;
  },
  /** GM: wait for the RR, find the three imported spells, repair them so their rows stand, and hand back each as plain data. */
  library: async ({ ids }) => {
    const H = globalThis.__mcs;
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.poll(() => acksExtras.importer?.bookOpen?.("rr"), { tries: 600, every: 200 });
    const out = { rr: !!acksExtras.importer?.bookOpen?.("rr"), present: [], payload: {} };
    const only = new Set(Object.values(ids));
    if (out.rr) await acksExtras.importer.importSpells({ only, repair: { replaced: 0, refused: 0, keptProse: 0 } });
    for (const [k, id] of Object.entries(ids)) {
      const doc = L.byCookbookId("Item", id, { original: true });
      out.present.push(!!doc);
      if (doc) {
        const data = doc.toObject();
        for (const f of ["_id", "folder", "sort", "ownership"]) delete data[f];
        out.payload[k] = data;
      }
    }
    return out;
  },
  /** A known shape: the caster bound to the class at level 1 with nothing spent, each copy's lists, rows and counts as the walk needs them, the monsters' hit points and saves. */
  shape: async ({ casterId, classUuid, spells, targetIds, monsterId }) => {
    const actor = game.actors.get(casterId);
    await actor.update({ "system.details.level": 1, "system.spells.enabled": true, "flags.acks-extras.classes.uuid": classUuid, "flags.acks-extras.classes.pools": { arcane: { s1: 0 } } });
    const list = [{ source: "arcane", level: 1, classes: [], note: "" }];
    const out = {};
    for (const [k, itemId] of Object.entries(spells)) {
      const item = actor.items.get(itemId);
      const flag = foundry.utils.deepClone(item.getFlag("acks-extras", "spell") ?? {});
      flag.lists = list;
      if (k === "damage") {
        const row = (flag.effects ?? []).find((r) => r.type === "damage");
        if (row) { row.roll = "5"; row.saveEffect = "half"; row.delivery = "none"; }
        flag.save = { ...(flag.save ?? {}), category: flag.save?.category && flag.save.category !== "none" ? flag.save.category : "spell", kind: "", effect: "half" };
      }
      if (k === "fright") {
        flag.duration = { shape: "fixed", value: 2, unit: "minutes" };
        for (const r of flag.effects ?? []) if (r.type === "conditionGrant") r.lasts = "duration";
        flag.save = { ...(flag.save ?? {}), category: flag.save?.category && flag.save.category !== "none" ? flag.save.category : "spell", kind: "", effect: "negates" };
      }
      await item.update({ "system.cast": 0, "flags.acks-extras.spell": flag });
      const rows = item.getFlag("acks-extras", "spell")?.effects ?? [];
      out[k] = { rows: rows.length, kinds: rows.map((r) => r.type), reversed: rows.filter((r) => r.reversed).length, saveCategory: item.getFlag("acks-extras", "spell")?.save?.category ?? "" };
    }
    for (const id of targetIds) {
      const a = game.actors.get(id);
      const saves = Object.fromEntries(["paralysis", "death", "blast", "implements", "spell"].map((s) => [`system.saves.${s}.value`, 15]));
      await a.update({ "system.hp.value": 20, "system.hp.max": 20, ...saves });
    }
    if (monsterId) await game.actors.get(monsterId).update({ "system.hp.value": 9, "system.hp.max": 9 });
    return out;
  },
  /** View the field with the Tokens layer up. */
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
  /** Make one token per actor on the scene, in a row; answer their ids. */
  tokens: async ({ sceneId, actorIds }) => {
    const scene = game.scenes.get(sceneId);
    const data = actorIds.map((actorId, i) => ({ actorId, x: 300 + i * 200, y: 300, actorLink: false, disposition: -1 }));
    const made = await scene.createEmbeddedDocuments("Token", data);
    return made.map((t) => ({ id: t.id, uuid: t.uuid, actorId: t.actorId }));
  },
  /** Target exactly these tokens, in this order, as the seat's user. */
  target: async ({ sceneId, tokenIds }) => {
    // Core 14 targets through the token layer; the scene must be the one in view.
    if (canvas.scene?.id !== sceneId) return -1;
    canvas.tokens.setTargets(tokenIds, { mode: "replace" });
    await new Promise((r) => setTimeout(r, 300));
    return [...game.user.targets].length;
  },
  hp: async ({ sceneId, tokenIds }) => tokenIds.map((id) => game.scenes.get(sceneId).tokens.get(id)?.actor?.system.hp.value ?? null),
  /** Rig the dice to this sequence of uniform draws, or restore them. */
  rig: async ({ seq }) => {
    const H = globalThis.__mcs;
    if (!seq) {
      if (H.dice) CONFIG.Dice.randomUniform = H.dice;
      H.dice = null;
      return "restored";
    }
    H.dice ??= CONFIG.Dice.randomUniform;
    let i = 0;
    CONFIG.Dice.randomUniform = () => seq[i++ % seq.length];
    return "rigged";
  },
  /**
   * Cast a spell as a user does: `item.use()`, then the dialog. `mode` picks the form; with `stop` the dialog is read and cancelled instead of confirmed.
   * Answers what the dialog showed, then (confirmed) waits for the cast card and for its entries to leave pending.
   */
  cast: async ({ casterId, spellId, mode, stop, wait, weaponId }) => {
    const H = globalThis.__mcs;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    const cast0 = item.system.cast;
    const pool0 = actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0;
    item.use({ skipDialog: true });
    const dialog = await H.poll(() => document.querySelector(".acks-extras-cast-dialog")?.closest("form") ?? null, { tries: 80, every: 150 });
    if (!dialog) return { dialog: false };
    const root = dialog.closest(".application");
    const select = dialog.querySelector("[data-cast-mode]");
    if (mode && select) { select.value = mode; select.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(200); }
    const verdicts = [...dialog.querySelectorAll(".acks-extras-cast-verdicts:not([hidden]) li")].map((li) => li.dataset.severity);
    const verdictTexts = [...dialog.querySelectorAll(".acks-extras-cast-verdicts:not([hidden]) li")].map((li) => li.textContent.trim());
    // The weapon the buff is cast on: the dialog lists the one targeted creature's weapons, and the pick is the select's value.
    const weaponSelect = dialog.querySelector("[data-cast-for]:not([hidden]) select[data-weapon]");
    if (weaponId && weaponSelect) { weaponSelect.value = weaponId; weaponSelect.dispatchEvent(new Event("change", { bubbles: true })); }
    const castButton = root.querySelector('button[data-action="cast"]');
    const shown = { weaponOptions: weaponSelect ? weaponSelect.options.length : 0, weaponPicked: weaponSelect && weaponId ? weaponSelect.value === weaponId : null, verdictTexts, dialog: true, scroll: root.classList.contains("acks-extras-scroll"), modeSelect: !!select, verdicts, castDisabled: !!castButton?.disabled, levelField: !!dialog.querySelector('[name="casterLevel"]'), literalIds: [...root.querySelectorAll("[id]")].filter((e) => !e.closest(".window-header") && !/^[A-Za-z]+-[A-Za-z0-9]+$/.test(e.id)).length };
    if (stop) {
      root.querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { ...shown, cancelled: true, cast: item.system.cast - cast0, pool: (actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0) - pool0, cards: [...game.messages].filter((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard).length };
    }
    castButton.click();
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 120, every: 250 });
    if (!message) return { ...shown, card: false };
    const settled = await H.poll(() => !Object.values(game.messages.get(message.id).flags["acks-extras"].castCard.entries).some((e) => e.state === "pending" || e.state === "applying"), { tries: wait ?? 40, every: 250 });
    const card = game.messages.get(message.id).flags["acks-extras"].castCard;
    return { ...shown, card: true, messageId: message.id, settled: !!settled, model: card, cast: item.system.cast - cast0, pool: (actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0) - pool0, newMessages: [...game.messages].filter((m) => !before.has(m.id)).map((m) => ({ id: m.id, attack: String(m.content).includes("attack-throw-card"), applyButton: String(m.content).includes('data-action="applyDamage"'), magicAttack: !!m.flags?.["acks-extras"]?.magicAttack, cast: !!m.flags?.["acks-extras"]?.castCard })) };
  },
  /** Press a button of a cast card in the chat log, as a user does; wait for the entries to settle. */
  press: async ({ messageId, action, target, row }) => {
    const H = globalThis.__mcs;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(400);
    const sel = `[data-message-id="${messageId}"] [data-action="${action}"]${target ? `[data-target="${target}"]` : ""}${row ? `[data-row="${row}"]` : ""}`;
    const button = await H.poll(() => document.querySelector(sel), { tries: 40, every: 200 });
    if (!button) return { button: false };
    button.click();
    const settled = await H.poll(() => !Object.values(game.messages.get(messageId).flags["acks-extras"].castCard.entries).some((e) => e.state === "applying"), { tries: 40, every: 250 });
    await H.sleep(500);
    return { button: true, settled: !!settled, model: game.messages.get(messageId).flags["acks-extras"].castCard };
  },
  /** What a cast card's rendered body offers this seat. */
  seen: async ({ messageId }) => {
    const H = globalThis.__mcs;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(500);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    const actions = [...(el?.querySelectorAll("[data-action^='magicCast']") ?? [])].map((b) => b.dataset.action);
    const tips = [...(el?.querySelectorAll(".acks-extras-roll-card td.acks-nums") ?? [])].filter((td) => td.textContent.trim() && td.textContent.trim() !== "—");
    return { found: !!el, actions, figures: tips.length, untipped: tips.filter((td) => !td.dataset.tooltipText && !td.dataset.tooltip).length, cardButtons: !!el?.querySelector(".card-buttons"), title: el?.querySelector(".acks-chat-title")?.textContent ?? "", text: el?.textContent ?? "" };
  },
  /** Records of one cast on a token's actor. */
  records: async ({ sceneId, tokenId }) => {
    const actor = game.scenes.get(sceneId).tokens.get(tokenId)?.actor;
    const rows = [...(actor?.effects ?? [])].filter((e) => e.flags?.["acks-extras"]?.spellEffect).map((e) => ({ id: e.id, uuid: e.uuid, statuses: [...e.statuses], changes: e.changes.length, mark: e.flags["acks-extras"].spellEffect, coreDuration: e._source.duration?.value ?? null }));
    return { records: rows, statuses: [...(actor?.statuses ?? [])] };
  },
  /** The world clock: advance, and wait for the GM window's sweep. */
  time: async ({ now, advance, to }) => {
    const H = globalThis.__mcs;
    if (now) return game.time.worldTime;
    const step = to != null ? to - game.time.worldTime : advance;
    await game.time.advance(step);
    await H.sleep(2500);
    return game.time.worldTime;
  },
  /** The caster's spell counters and spent pool. */
  counters: async ({ casterId, spellId }) => {
    const actor = game.actors.get(casterId);
    return { cast: actor.items.get(spellId).system.cast, spent: actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0 };
  },
  setSpent: async ({ casterId, spent }) => {
    await game.actors.get(casterId).update({ "flags.acks-extras.classes.pools": { arcane: { s1: spent } } });
    return true;
  },
  setHp: async ({ sceneId, tokenId, value }) => {
    await game.scenes.get(sceneId).tokens.get(tokenId).actor.update({ "system.hp.value": value });
    return true;
  },
  /** A monster's weapon, used: the card it posts and whether a cast dialog opened. */
  monsterUse: async ({ monsterId, itemId }) => {
    const H = globalThis.__mcs;
    const before = new Set([...game.messages].map((m) => m.id));
    const item = game.actors.get(monsterId).items.get(itemId);
    item.use({ skipDialog: true });
    const msg = await H.poll(() => [...game.messages].find((m) => !before.has(m.id)), { tries: 60, every: 200 });
    await H.sleep(500);
    return { card: !!msg, core: String(msg?.content ?? "").includes("attack-throw-card"), castCard: !!msg?.flags?.["acks-extras"]?.castCard, ours: !!msg?.flags?.["acks-extras"]?.magicAttack, dialog: !!document.querySelector(".acks-extras-cast-dialog"), id: msg?.id ?? null };
  },
  /** Messages the run made speaking as its own fixtures since `since`. */
  cards: async ({ actorIds, since }) => [...game.messages].filter((m) => m.timestamp >= since && actorIds.includes(m.speaker?.actor)).map((m) => m.uuid),

  /* ---------------------------------------------------------------- */
  /*  The buff steps                                                   */
  /* ---------------------------------------------------------------- */

  /** A string of the lang as the page's own `format` makes it, so a notice or a label is compared to what the module would say. */
  format: async ({ key, data }) => game.i18n.format(key, data ?? {}),
  /**
   * Bring the four creatures of the buff steps to a known shape: the caster Lawful, the ally a character with no condition, the foe an undead
   * Chaotic monster, the stranger a monster of no kind and no alignment, each with equal hit points and saves (figures the walk invents).
   * Answers what each reads as, through lib's own readers.
   */
  buffActors: async ({ casterId, allyId, foeId, strangerId }) => {
    const R = await import("/modules/acks-extras/scripts/lib/actor-read.mjs");
    const [caster, ally, foe, stranger] = [casterId, allyId, foeId, strangerId].map((id) => game.actors.get(id));
    const hp = { "system.hp.value": 20, "system.hp.max": 20 };
    const saves = Object.fromEntries(["paralysis", "death", "blast", "implements", "spell"].map((s) => [`system.saves.${s}.value`, 15]));
    await caster.update({ "system.details.alignment": "Lawful" });
    await ally.update({ ...hp, ...saves });
    await foe.update({ ...hp, ...saves, "system.details.alignment": "Chaotic", "flags.acks-extras.extras.types": ["undead"] });
    await stranger.update({ ...hp, ...saves, "system.details.alignment": "" });
    const kinds = (a) => [...R.creatureKinds(a)];
    return {
      casterKey: R.actorAlignment(caster),
      foeKey: R.actorAlignment(foe),
      foeEnchanted: kinds(foe).includes("enchanted"),
      strangerKey: R.actorAlignment(stranger),
      strangerKinds: kinds(stranger).length,
      allyCharacter: kinds(ally).includes("character"),
      allyStatuses: [...ally.statuses].length,
      stale: [ally, foe, stranger].flatMap((a) => [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect)).length,
    };
  },
  /** One linked token per spec on the scene, each read back for its disposition; answers their ids and names. */
  tokensFor: async ({ sceneId, specs }) => {
    const scene = game.scenes.get(sceneId);
    const made = await scene.createEmbeddedDocuments("Token", specs.map((s) => ({ actorId: s.actorId, x: s.x, y: s.y, actorLink: true, disposition: s.disposition })));
    const out = [];
    for (const [i, t] of made.entries()) {
      if (t.disposition !== specs[i].disposition) await t.update({ disposition: specs[i].disposition });
      out.push({ id: t.id, uuid: t.uuid, actorId: t.actorId, name: t.name, actorName: t.actor?.name ?? "", disposition: t.disposition, linked: t.actorLink === true && t.actor === game.actors.get(t.actorId) });
    }
    await new Promise((r) => setTimeout(r, 600));
    return out;
  },
  /**
   * A copy of an imported spell reshaped onto the first-level list, with a fixed duration of the walk's own and, per row key, a flat figure of the
   * walk's own; the rest of its rows are the import's, taken afresh from `fresh` (the library original's flag) each time.
   */
  buffShape: async ({ casterId, spellId, fresh, duration, values }) => {
    const item = game.actors.get(casterId).items.get(spellId);
    const flag = foundry.utils.deepClone(fresh);
    flag.lists = [{ source: "arcane", level: 1, classes: [], note: "" }];
    flag.duration = duration;
    for (const [key, n] of Object.entries(values ?? {})) {
      const row = (flag.effects ?? []).find((r) => r.key === key);
      if (row) row.value = n;
    }
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": flag });
    const rows = item.getFlag("acks-extras", "spell")?.effects ?? [];
    return { rows: rows.length, kinds: rows.map((r) => r.type) };
  },
  /** The damage copy on an actor with no class: a flat roll and a "half" save, as the first section shapes its own. The figure is the walk's. */
  shapeDamage: async ({ actorId, spellId }) => {
    const item = game.actors.get(actorId).items.get(spellId);
    const flag = foundry.utils.deepClone(item.getFlag("acks-extras", "spell") ?? {});
    const row = (flag.effects ?? []).find((r) => r.type === "damage");
    if (row) { row.roll = "5"; row.saveEffect = "half"; row.delivery = "none"; }
    flag.save = { ...(flag.save ?? {}), category: flag.save?.category && flag.save.category !== "none" ? flag.save.category : "spell", kind: "", effect: "half" };
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": flag });
    return { damageRow: !!row };
  },
  /** The flat figure a row of a spell's flag reads as at a level, through the cast's own reader; null where the import read none. */
  figureOf: async ({ flag, key, level }) => {
    const M = await import("/modules/acks-extras/scripts/magic/cast-mods.mjs");
    const row = (flag?.effects ?? []).find((r) => r.key === key);
    return row ? M.modifierFigure(row, level ?? 1) : null;
  },
  /** What each row of a copy's flag declares of its scope: how many `anyOf` branches and which kinds, to compare with what a record copied. */
  rowShape: async ({ casterId, spellId }) => {
    const rows = game.actors.get(casterId).items.get(spellId).getFlag("acks-extras", "spell")?.effects ?? [];
    return Object.fromEntries(Array.from(rows).map((r) => [r.key, { anyOf: Array.from(r.anyOf ?? []).length, vsKinds: Array.from(r.vsKinds ?? []) }]));
  },
  /** The buff records (those carrying lib's `rollMods`) on a token's actor, each with its parts reduced to what a step compares. */
  mods: async ({ sceneId, tokenId }) => {
    const actor = game.scenes.get(sceneId).tokens.get(tokenId)?.actor;
    return [...(actor?.effects ?? [])]
      .filter((e) => e.flags?.["acks-extras"]?.spellEffect && e.flags["acks-extras"].rollMods)
      .map((e) => {
        const m = e.flags["acks-extras"].rollMods;
        const mark = e.flags["acks-extras"].spellEffect;
        return {
          id: e.id,
          castId: mark.castId,
          role: mark.role,
          statuses: [...e.statuses].length,
          changes: e.changes.length,
          startTime: mark.startTime ?? null,
          duration: mark.duration ?? null,
          writer: e._stats?.lastModifiedBy ?? null,
          label: String(m.label ?? ""),
          cite: String(m.cite ?? ""),
          sourceAlignment: m.sourceAlignment ?? null,
          item: mark.item?.id ?? null,
          parts: Array.from(m.parts ?? []).map((p) => ({ key: p.key, on: p.on, value: p.value ?? null, itemId: p.itemId ?? null, gate: p.gate?.kind ?? null, anyOf: Array.from(p.anyOf ?? []).length, vsKinds: Array.from(p.vsKinds ?? []) })),
        };
      });
  },
  /** Whether a seat's own actor is owned by it: the Player's answer for a token it should not own. */
  ownsToken: async ({ sceneId, tokenId }) => game.scenes.get(sceneId).tokens.get(tokenId)?.actor?.isOwner === true,
  /** The cells of a rendered cast card that carry a figure or a dash, and how many carry a tooltip naming the spell. */
  seenMods: async ({ messageId, spellName }) => {
    const H = globalThis.__mcs;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(500);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    const cells = [...(el?.querySelectorAll(".acks-extras-roll-card td.acks-nums") ?? [])];
    return { found: !!el, cells: cells.length, named: cells.filter((td) => (td.dataset.tooltipText ?? "").includes(spellName)).length };
  },
  /**
   * An attack as a user makes it: `makeAttackThrow` on a token's actor with one of its items, against the seat's targets, the dice as they stand.
   * Answers the stored card's two modifier lists (the attack's and, on a hit, the damage's) and every notice told while it rolled; the notices
   * are recorded by wrapping `warn` and `info` for this call alone.
   */
  attack: async ({ sceneId, tokenId, itemId }) => {
    const H = globalThis.__mcs;
    const actor = game.scenes.get(sceneId).tokens.get(tokenId)?.actor;
    const item = actor?.items.get(itemId);
    if (!actor || !item) return { card: false, missing: true };
    const before = new Set([...game.messages].map((m) => m.id));
    const told = [];
    const warn = ui.notifications.warn;
    const info = ui.notifications.info;
    ui.notifications.warn = function (msg, ...rest) { told.push({ level: "warn", text: String(msg) }); return warn.call(this, msg, ...rest); };
    ui.notifications.info = function (msg, ...rest) { told.push({ level: "info", text: String(msg) }); return info.call(this, msg, ...rest); };
    let message = null;
    try {
      await actor.makeAttackThrow({ item, attackType: "melee", skipDialog: true });
      message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.speaker?.actor === actor.id && String(m.content).includes("attack-throw-card")), { tries: 40, every: 200 });
    } finally {
      ui.notifications.warn = warn;
      ui.notifications.info = info;
    }
    const doc = new DOMParser().parseFromString(String(message?.content ?? ""), "text/html");
    const blocks = [...doc.querySelectorAll(".attack-throw-card__roll")];
    const listOf = (block) => [...(block?.querySelectorAll(".attack-throw-card__modifiers li") ?? [])].map((li) => ({ label: li.children[0]?.textContent ?? "", value: li.children[1]?.textContent ?? "" }));
    return { card: !!message, id: message?.id ?? null, hit: blocks.length > 1, attack: listOf(blocks[0]), damage: listOf(blocks[1]), notices: told };
  },
  /** The imported figure of a masterwork tier; where the document is not imported, import the variations first. Answers the attack bonus or null. */
  masterwork: async ({ tier }) => {
    const H = globalThis.__mcs;
    const L = await import("/modules/acks-extras/scripts/equipment/printed-layers.mjs");
    let figure = L.masterworkFigure(tier);
    let imported = false;
    if (!figure && typeof acksExtras.importer?.importVariations === "function") {
      await H.poll(() => acksExtras.importer?.bookOpen?.("rr"), { tries: 600, every: 200 });
      await acksExtras.importer.importVariations();
      imported = true;
      figure = await H.poll(() => L.masterworkFigure(tier), { tries: 40, every: 250 });
    }
    return { have: !!figure, imported, bonus: figure ? Number(figure.bonus) : null };
  },
  /** Put a tier on a weapon through the module's own action, clearing it first so the stamp always starts from the weapon's own figures. */
  stamp: async ({ actorId, itemId, tier }) => {
    const A = await import("/modules/acks-extras/scripts/equipment/actions.mjs");
    const L = await import("/modules/acks-extras/scripts/equipment/printed-layers.mjs");
    const item = game.actors.get(actorId).items.get(itemId);
    await A.setMasterwork(item, null);
    await A.setMasterwork(item, tier);
    const part = L.masterworkBonusParts(item, "attack")[0] ?? null;
    return { tier: item.getFlag("acks-extras", "masterwork")?.tier ?? null, attackBonus: Number(item.system.bonus.attack), mwLabel: part?.label ?? "", itemName: item.name, weaponLabel: game.i18n.localize("ACKS.throw.modifier.weapon") };
  },
  restore: async () => {
    const H = globalThis.__mcs;
    if (!H?.patched) return "never installed";
    if (H.dice) CONFIG.Dice.randomUniform = H.dice;
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
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

async function ready(api, label, { seconds = 240, fresh = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Reload a seat with the boot recorder registered before the document loads, so it sees `init`, `setup` and `ready`. */
async function reloadWithRecorder(api, port, label) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const cdp = new Cdp(ws);
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page" && t.url.includes("/game"));
    if (!page) throw new Error("no /game page to reload");
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT_RECORDER }, sessionId);
    await api.eval("window.__preReload = true; 0");
    await cdp.send("Page.reload", {}, sessionId);
    const seconds = await ready(api, `${label} after reload`, { fresh: true });
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId).catch(() => {});
    return seconds;
  } finally {
    try { ws.close(); } catch {}
  }
}

let gm = null;
let player = null;
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_500_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Half to even, as the module rounds a halved amount. */
const halfEven = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
};
const entriesOf = (model, rowKey) => Object.entries(model.entries).filter(([id]) => id.endsWith(`_${rowKey}`)).map(([, e]) => e);
const startedAt = Date.now();
/** The casts the buff steps made, by cast id: the teardown lists the records they left on the fixtures by these. */
const castIds = [];

/** The label a spell's rows carry on an attack card: its name, and its page reference where it has one. */
const labelWithCite = (rec) => (rec.cite ? `${rec.label} (${rec.cite})` : rec.label);

/**
 * The buff steps: what a cast's modifier and ward rows become on each recipient
 * and how lib reads them at the roll (docs/magic/TESTING.md, "The buff steps").
 * Each step brings what it needs to a known shape at its start; a record a cast
 * leaves is taken off by the Judge's Undo or by the clock before the next step
 * counts records. A figure the import left blank fails its step as an import
 * finding, and nothing here fills one in.
 */
async function walkBuffs({ sceneId, caster, casterId, idOf, playerId, damagePayload }) {
  const fmt = (key, data) => run(gm, P.format, { key, data });
  const modsOf = (tokenId) => run(gm, P.mods, { sceneId, tokenId });
  const gmId = await run(gm, async () => game.user.id);
  const trackCard = async (id) => { if (id) await track(`ChatMessage.${id}`, "ChatMessage"); };
  const spent = () => run(gm, P.setSpent, { casterId, spent: 0 });
  const undo = (c, tokenKey) => run(gm, P.press, { messageId: c.messageId, action: "magicCastUndo", target: tokenKey, row: c.model.order[0] });
  const keyOf = (c, tokenUuid) => Object.entries(c.model?.targets ?? {}).find(([, t]) => t.uuid === tokenUuid)?.[0];
  const recipients = (list, castId) => list.filter((r) => r.castId === castId && r.role === "recipient");
  const blank = (c) => (c.model?.order ?? []).filter((k) => c.model.rows[k]?.blank);

  section("buff fixtures");
  const lib2 = await run(gm, P.library, { ids: BUFF_IDS });
  check("the GM seat has the two spells of the buff steps imported", lib2.rr && lib2.present.every(Boolean), lib2.present);
  if (!lib2.rr || !lib2.present.every(Boolean)) throw new Error("the circle or the edge spell is not available on the GM seat");
  const freshOf = (k) => lib2.payload[k]?.flags?.["acks-extras"]?.spell ?? {};
  const copy = (k, marker, name) => gm.fixture(marker, "Item", { ...lib2.payload[k], name }, { parent: caster.uuid });
  const circle = await copy("circle", "magic/cast-spell-circle", "QA Cast circle");
  const edge = await copy("edge", "magic/cast-spell-edge", "QA Cast edge");
  const ally = await gm.fixture("magic/cast-ally", "Actor", { name: "QA Cast Ally", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
  const blade = await gm.fixture("magic/cast-ally-blade", "Item", { name: "QA Cast Blade", type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent: ally.uuid });
  const fine = await gm.fixture("magic/cast-ally-fine", "Item", { name: "QA Cast Fine Blade", type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent: ally.uuid });
  const foe = await gm.fixture("magic/cast-foe", "Actor", { name: "QA Cast Foe", type: "monster", ownership: { default: 0 } });
  const foeClaw = await gm.fixture("magic/cast-foe-claw", "Item", { name: "QA Cast Foe Claw", type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent: foe.uuid });
  const foeSpell = await gm.fixture("magic/cast-foe-spell", "Item", { ...damagePayload, name: "QA Cast foe spell" }, { parent: foe.uuid });
  const stranger = await gm.fixture("magic/cast-stranger", "Actor", { name: "QA Cast Stranger", type: "monster", ownership: { default: 0 } });
  const strangerClaw = await gm.fixture("magic/cast-stranger-claw", "Item", { name: "QA Cast Stranger Claw", type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent: stranger.uuid });
  const ids = { circle: idOf(circle), edge: idOf(edge), ally: idOf(ally), blade: idOf(blade), fine: idOf(fine), foe: idOf(foe), foeClaw: idOf(foeClaw), foeSpell: idOf(foeSpell), stranger: idOf(stranger), strangerClaw: idOf(strangerClaw) };

  const shapeActors = await run(gm, P.buffActors, { casterId, allyId: ids.ally, foeId: ids.foe, strangerId: ids.stranger });
  check("buff: the caster reads an alignment, the foe an undead of another, the stranger neither a kind nor an alignment, the ally a character with no condition", !!shapeActors.casterKey && !!shapeActors.foeKey && shapeActors.foeEnchanted && shapeActors.strangerKey === null && shapeActors.strangerKinds === 0 && shapeActors.allyCharacter && shapeActors.allyStatuses === 0, { foeEnchanted: shapeActors.foeEnchanted, strangerKinds: shapeActors.strangerKinds });
  check("buff: no spell record stands on the ally, the foe or the stranger before the steps begin", shapeActors.stale === 0, { stale: shapeActors.stale });
  const shapedCircle = await run(gm, P.buffShape, { casterId, spellId: ids.circle, fresh: freshOf("circle"), duration: CIRCLE_DURATION, values: {} });
  const shapedEdge = await run(gm, P.buffShape, { casterId, spellId: ids.edge, fresh: freshOf("edge"), duration: EDGE_DURATION, values: {} });
  const shapedFoeSpell = await run(gm, P.shapeDamage, { actorId: ids.foe, spellId: ids.foeSpell });
  check("buff: each copy carries its rows, and the foe's copy a damage row", shapedCircle.rows > 0 && shapedEdge.rows > 0 && shapedFoeSpell.damageRow, { circle: shapedCircle.rows, edge: shapedEdge.rows });
  const placed = await run(gm, P.tokensFor, { sceneId, specs: [
    { actorId: casterId, disposition: 1, x: 300, y: 600 },
    { actorId: ids.ally, disposition: 1, x: 500, y: 600 },
    { actorId: ids.foe, disposition: -1, x: 700, y: 600 },
    { actorId: ids.stranger, disposition: -1, x: 900, y: 600 },
  ] });
  for (const t of placed) await track(t.uuid, "Token");
  const [tCaster, tAlly, tFoe, tStranger] = placed;
  check("buff: four linked tokens stand on the field, the caster's and the ally's friendly, the foe's and the stranger's hostile", placed.length === 4 && placed.every((t) => t.linked) && placed[0].disposition === 1 && placed[1].disposition === 1 && placed[2].disposition === -1 && placed[3].disposition === -1);
  const rowShape = await run(gm, P.rowShape, { casterId, spellId: ids.circle });
  await run(gm, P.drain);
  await run(player, P.drain);
  const allyOwned = await run(player, P.ownsToken, { sceneId, tokenId: tAlly.id });
  const targetBoth = async (seat) => run(seat, P.target, { sceneId, tokenIds: [tCaster.id, tAlly.id] });

  section("buff 1. the circle cast at the caster's token and the ally's (Player seat)");
  await spent();
  await targetBoth(player);
  const c1 = await run(player, P.cast, { casterId, spellId: ids.circle, wait: 80 });
  await run(player, P.target, { sceneId, tokenIds: [] });
  await trackCard(c1.messageId);
  if (c1.model?.castId) castIds.push(c1.model.castId);
  check("buff 1: the dialog opened and the cast settled with one card, no entry left pending", c1.dialog && c1.card && c1.settled && Object.values(c1.model?.entries ?? {}).every((e) => e.state === "applied"), { entries: Object.keys(c1.model?.entries ?? {}).length });
  const blank1 = blank(c1);
  check("buff 1: the circle's modifier rows all read a figure from the import", c1.card && blank1.length === 0, blank1.length ? "imported figure blank" : undefined);
  const rec1 = { caster: recipients(await modsOf(tCaster.id), c1.model?.castId), ally: recipients(await modsOf(tAlly.id), c1.model?.castId) };
  check("buff 1: each recipient holds exactly one record of the cast, with no status and no change", rec1.caster.length === 1 && rec1.ally.length === 1 && [...rec1.caster, ...rec1.ally].every((r) => r.statuses === 0 && r.changes === 0), { caster: rec1.caster.length, ally: rec1.ally.length });
  const partsOf = (r, on) => (r?.parts ?? []).filter((p) => p.on === on);
  const scoped = (r) => ["ac", "save"].every((on) => partsOf(r, on).length === 1 && partsOf(r, on)[0].anyOf > 0 && partsOf(r, on)[0].anyOf === rowShape[partsOf(r, on)[0].key]?.anyOf) && partsOf(r, "ward").length === 1 && partsOf(r, "ward")[0].vsKinds.length > 0 && JSON.stringify(partsOf(r, "ward")[0].vsKinds) === JSON.stringify(rowShape[partsOf(r, "ward")[0].key]?.vsKinds);
  check("buff 1: each record's ac, save and ward parts carry the scope their rows declare, with the branches copied", scoped(rec1.caster[0]) && scoped(rec1.ally[0]), { caster: scoped(rec1.caster[0]), ally: scoped(rec1.ally[0]) });
  check("buff 1: each record names the caster's alignment key as the source", !!shapeActors.casterKey && rec1.caster[0]?.sourceAlignment === shapeActors.casterKey && rec1.ally[0]?.sourceAlignment === shapeActors.casterKey);
  check("buff 1: the ally's record was written by the GM's client, the Player owning neither the token nor its actor", rec1.ally[0]?.writer === gmId && rec1.ally[0]?.writer !== playerId && allyOwned === false, { gmWrote: rec1.ally[0]?.writer === gmId, playerOwns: allyOwned });
  const seen1 = await run(gm, P.seenMods, { messageId: c1.messageId, spellName: c1.model?.spellName ?? "" });
  check("buff 1: every modifier entry on the card carries a tooltip naming the spell", seen1.found && seen1.cells > 0 && seen1.named === seen1.cells, { cells: seen1.cells, named: seen1.named });
  // Concentration's record on the caster is the next slice's, and nothing here asserts it.

  const circleRec = rec1.ally[0];
  const acPart = partsOf(circleRec, "ac")[0];
  const savePart = partsOf(circleRec, "save")[0];
  const circleReady = c1.card && blank1.length === 0 && !!circleRec && !!acPart && !!savePart;

  section("buff 2. the foe attacks the ally with its claw (GM seat)");
  await run(gm, P.target, { sceneId, tokenIds: [tAlly.id] });
  await run(gm, P.rig, { seq: [0.025] });
  const a2 = await run(gm, P.attack, { sceneId, tokenId: tFoe.id, itemId: ids.foeClaw });
  await run(gm, P.rig, {});
  await trackCard(a2.id);
  const onTarget = circleReady ? await fmt("ACKS-LIB.rollMods.onTarget", { name: labelWithCite(circleRec), target: tAlly.name }) : "";
  const rows2 = (a2.attack ?? []).filter((r) => r.label === onTarget);
  check("buff 2: the stored attack card holds one row for the circle on the ally, of minus the ally's AC part", circleReady && a2.card && rows2.length === 1 && Number(rows2[0].value) === -acPart.value, { rows: rows2.length });
  const ward2 = circleReady ? await fmt("ACKS-LIB.rollMods.notice.ward", { target: tAlly.name, spell: circleRec.label, attacker: tFoe.actorName }) : "";
  check("buff 2: a warning names the ward on the ally and the attacker", circleReady && (a2.notices ?? []).some((n) => n.level === "warn" && n.text === ward2), { notices: (a2.notices ?? []).length });

  section("buff 3. the stranger attacks the ally");
  await run(gm, P.rig, { seq: [0.025] });
  const a3 = await run(gm, P.attack, { sceneId, tokenId: tStranger.id, itemId: ids.strangerClaw });
  await run(gm, P.rig, {});
  await trackCard(a3.id);
  const undetermined3 = circleReady ? await fmt("ACKS-LIB.rollMods.notice.undetermined", { spell: circleRec.label, target: tAlly.name, attacker: tStranger.actorName }) : "";
  check("buff 3: the attack card holds no row for the circle", circleReady && a3.card && !(a3.attack ?? []).some((r) => r.label.includes(circleRec.label)));
  check("buff 3: a notice says the circle's scope cannot be told against the stranger", circleReady && (a3.notices ?? []).some((n) => n.level === "warn" && n.text === undetermined3), { notices: (a3.notices ?? []).length });

  section("buff 4. the ally attacks the caster with the blade");
  await run(gm, P.target, { sceneId, tokenIds: [tCaster.id] });
  await run(gm, P.rig, { seq: [0.025] });
  const a4 = await run(gm, P.attack, { sceneId, tokenId: tAlly.id, itemId: ids.blade });
  await run(gm, P.rig, {});
  await trackCard(a4.id);
  check("buff 4: the attack card holds no row for the circle and no notice names it, the scope failing on the same side", circleReady && a4.card && !(a4.attack ?? []).some((r) => r.label.includes(circleRec.label)) && !(a4.notices ?? []).some((n) => n.text.includes(circleRec.label)), { notices: (a4.notices ?? []).length });

  section("buff 5. the foe casts its spell at the ally");
  await run(gm, P.target, { sceneId, tokenIds: [tAlly.id] });
  const c5 = await run(gm, P.cast, { casterId: ids.foe, spellId: ids.foeSpell, wait: 60 });
  await trackCard(c5.messageId);
  if (c5.model?.castId) castIds.push(c5.model.castId);
  const resist5 = Object.values(c5.model?.targets ?? {})[0]?.resist ?? null;
  const circleSave = (resist5?.parts ?? []).filter((p) => circleReady && p.label === circleRec.label);
  check("buff 5: the ally rolled a save, and its parts hold one part named for the circle, equal to the circle's save part", circleReady && c5.card && !!resist5 && circleSave.length === 1 && Number(circleSave[0].value) === savePart.value, { parts: (resist5?.parts ?? []).length });
  check("buff 5: the save's target is the base target less that figure, the ally having no condition", circleReady && !!resist5 && Number.isFinite(resist5.baseTarget) && resist5.baseTarget - resist5.target === savePart.value);
  await run(gm, P.setHp, { sceneId, tokenId: tAlly.id, value: 20 });

  // The Judge's Undo takes the circle's group off each recipient and clears the way for the weapon steps.
  for (const tk of Object.keys(c1.model?.targets ?? {})) await undo(c1, tk);
  const after1 = { caster: recipients(await modsOf(tCaster.id), c1.model?.castId), ally: recipients(await modsOf(tAlly.id), c1.model?.castId) };
  check("buff 5: the Judge's Undo on one modifier entry took the cast's record off each recipient", c1.card && after1.caster.length === 0 && after1.ally.length === 0, { caster: after1.caster.length, ally: after1.ally.length });
  await run(gm, P.target, { sceneId, tokenIds: [] });

  /* ---------------------------------------------------------------- */
  /*  Reserved: the held-cast steps (6 to 10 of the design) go here,   */
  /*  after step 5 and before step 11, and the declaration steps (15   */
  /*  to 17) after step 14. Neither is written in this slice.          */
  /* ---------------------------------------------------------------- */

  section("buff 11. sharpness on the blade (the Player's cast; the GM's client writes the record)");
  await spent();
  await run(player, P.target, { sceneId, tokenIds: [tAlly.id] });
  const c11 = await run(player, P.cast, { casterId, spellId: ids.edge, weaponId: ids.blade, wait: 80 });
  await run(player, P.target, { sceneId, tokenIds: [] });
  await trackCard(c11.messageId);
  if (c11.model?.castId) castIds.push(c11.model.castId);
  const blank11 = blank(c11);
  check("buff 11: the dialog listed the ally's two weapons and took the pick", c11.dialog && c11.weaponOptions === 2 && c11.weaponPicked === true, { options: c11.weaponOptions });
  check("buff 11: the cast settled and the card names the blade for the ally's entry", c11.card && c11.settled && c11.model?.item?.id === ids.blade && c11.model?.item?.targetKey === keyOf(c11, tAlly.uuid), { settled: c11.settled });
  check("buff 11: the sharpness rows all read a figure from the import", c11.card && blank11.length === 0, blank11.length ? "imported figure blank" : undefined);
  const rec11 = recipients(await modsOf(tAlly.id), c11.model?.castId);
  check("buff 11: one record stands on the ally, its parts all naming the blade", rec11.length === 1 && rec11[0].statuses === 0 && rec11[0].changes === 0 && rec11[0].parts.length > 0 && rec11[0].parts.every((p) => p.itemId === ids.blade) && rec11[0].item === ids.blade, { parts: rec11[0]?.parts.length });
  const attackPart = partsOf(rec11[0], "attack")[0];
  const damagePart = (rec11[0]?.parts ?? []).find((p) => p.on === "damage" && p.gate === "weaponMundane");
  const edgeReady = c11.card && blank11.length === 0 && rec11.length === 1 && !!attackPart && !!damagePart;
  const edgeLabel = edgeReady ? labelWithCite(rec11[0]) : "";
  await run(gm, P.target, { sceneId, tokenIds: [] });
  await run(gm, P.rig, { seq: [0.025] });
  const a11 = await run(gm, P.attack, { sceneId, tokenId: tAlly.id, itemId: ids.blade });
  const a11fine = await run(gm, P.attack, { sceneId, tokenId: tAlly.id, itemId: ids.fine });
  await run(gm, P.rig, {});
  await trackCard(a11.id);
  await trackCard(a11fine.id);
  const atk11 = (a11.attack ?? []).filter((r) => r.label === edgeLabel);
  const dmg11 = (a11.damage ?? []).filter((r) => r.label === edgeLabel);
  check("buff 11: the blade's attack card carries one row for the spell, equal to the attack part", edgeReady && a11.card && atk11.length === 1 && Number(atk11[0].value) === attackPart.value, { rows: atk11.length });
  check("buff 11: the blade's damage carries one row for the spell, equal to the damage part that fits a mundane weapon", edgeReady && a11.hit && dmg11.length === 1 && Number(dmg11[0].value) === damagePart.value, { hit: a11.hit, rows: dmg11.length });
  check("buff 11: the ally's other weapon carries no row for the spell, on its attack or its damage", edgeReady && a11fine.card && !(a11fine.attack ?? []).some((r) => r.label === edgeLabel) && !(a11fine.damage ?? []).some((r) => r.label === edgeLabel));
  if (c11.card) await undo(c11, keyOf(c11, tAlly.uuid));
  check("buff 11: the Judge's Undo took the record off", c11.card && recipients(await modsOf(tAlly.id), c11.model?.castId).length === 0);

  section("buff 12. the spell cast twice on the blade");
  // The two figures are the import's and the import's plus one, set on the copy as flat figures: the walk's own, read relative to the import.
  const f0 = await run(gm, P.figureOf, { flag: freshOf("edge"), key: "attack", level: 1 });
  check("buff 12: the attack row's figure reads from the import", Number.isFinite(f0), Number.isFinite(f0) ? undefined : "imported figure blank");
  if (Number.isFinite(f0)) {
    const castEdge = async (figure) => {
      await run(gm, P.buffShape, { casterId, spellId: ids.edge, fresh: freshOf("edge"), duration: EDGE_DURATION, values: { attack: figure } });
      await spent();
      await run(gm, P.target, { sceneId, tokenIds: [tAlly.id] });
      const c = await run(gm, P.cast, { casterId, spellId: ids.edge, weaponId: ids.blade, wait: 60 });
      await run(gm, P.target, { sceneId, tokenIds: [] });
      await trackCard(c.messageId);
      if (c.model?.castId) castIds.push(c.model.castId);
      return c;
    };
    const attackBlade = async () => {
      await run(gm, P.rig, { seq: [0.025] });
      const a = await run(gm, P.attack, { sceneId, tokenId: tAlly.id, itemId: ids.blade });
      await run(gm, P.rig, {});
      await trackCard(a.id);
      return a;
    };
    const first = await castEdge(f0 + 1);
    await run(gm, P.time, { advance: 30 });
    const second = await castEdge(f0);
    const standing = await modsOf(tAlly.id);
    const recs12 = [recipients(standing, first.model?.castId)[0], recipients(standing, second.model?.castId)[0]];
    const figures = recs12.map((r) => partsOf(r, "attack")[0]?.value);
    check("buff 12: two casts left two records on the ally, one figure the larger", recs12.every(Boolean) && figures.every(Number.isFinite) && Math.max(...figures) > Math.min(...figures), { records: recs12.filter(Boolean).length });
    const label12 = recs12[0] ? labelWithCite(recs12[0]) : "";
    const rowsAt = (a) => (a.attack ?? []).filter((r) => r.label === label12);
    const both = await attackBlade();
    check("buff 12: with both standing the attack card holds one row for the spell, equal to the larger figure", recs12.every(Boolean) && both.card && rowsAt(both).length === 1 && Number(rowsAt(both)[0].value) === Math.max(...figures), { rows: rowsAt(both).length });
    const timed12 = recs12.every((r) => r?.duration && Number.isFinite(r.startTime));
    check("buff 12: both records are timed by the flag, each with its start and its duration", timed12);
    if (timed12) {
      await run(gm, P.time, { to: recs12[0].startTime + recs12[0].duration.value * 60 + 1 });
      const mid = await modsOf(tAlly.id);
      const midMine = [first, second].flatMap((c) => recipients(mid, c.model?.castId));
      const aMid = await attackBlade();
      check("buff 12: past the first record's end one record stands and the row is the second's figure, the smaller", midMine.length === 1 && midMine[0].castId === second.model?.castId && aMid.card && rowsAt(aMid).length === 1 && Number(rowsAt(aMid)[0].value) === figures[1], { records: midMine.length });
      await run(gm, P.time, { to: recs12[1].startTime + recs12[1].duration.value * 60 + 1 });
      const end = await modsOf(tAlly.id);
      const endMine = [first, second].flatMap((c) => recipients(end, c.model?.castId));
      const aEnd = await attackBlade();
      check("buff 12: past the second record's end none stands and the attack card holds no row for the spell", endMine.length === 0 && aEnd.card && rowsAt(aEnd).length === 0, { records: endMine.length });
    }
  }

  section("buff 13. sharpness beside masterwork on the other weapon");
  const mw = await run(gm, P.masterwork, { tier: "weaponBoth" });
  check("buff 13: the both-ways masterwork tier's attack figure is imported", mw.have && Number.isFinite(mw.bonus) && mw.bonus >= 1, mw.have && Number.isFinite(mw.bonus) && mw.bonus >= 1 ? undefined : "imported figure blank; not reachable on this import");
  if (mw.have && Number.isFinite(mw.bonus) && mw.bonus >= 1) {
    const m = mw.bonus;
    // The spell's own attack figure is set against masterwork's: above it, level with it, and below it where it can be.
    const cases = [m + 1, m, ...(m >= 2 ? [m - 1] : [])];
    if (m < 2) note("buff 13: the case below masterwork's figure", "not reachable on this import");
    for (const [i, s] of cases.entries()) {
      const tag = `buff 13.${i + 1}`;
      const stamped = await run(gm, P.stamp, { actorId: ids.ally, itemId: ids.fine, tier: "weaponBoth" });
      check(`${tag}: the weapon carries the tier and its own attack figure is the tier's`, stamped.tier === "weaponBoth" && stamped.attackBonus === m && !!stamped.mwLabel, { tier: stamped.tier === "weaponBoth" });
      await run(gm, P.buffShape, { casterId, spellId: ids.edge, fresh: freshOf("edge"), duration: EDGE_DURATION, values: { attack: s } });
      await spent();
      await run(gm, P.target, { sceneId, tokenIds: [tAlly.id] });
      const c = await run(gm, P.cast, { casterId, spellId: ids.edge, weaponId: ids.fine, wait: 60 });
      await run(gm, P.target, { sceneId, tokenIds: [] });
      await trackCard(c.messageId);
      if (c.model?.castId) castIds.push(c.model.castId);
      const rec = recipients(await modsOf(tAlly.id), c.model?.castId)[0];
      const part = partsOf(rec, "attack")[0];
      check(`${tag}: the record on the ally carries the spell's attack part for the weapon`, c.card && !!rec && !!part && part.itemId === ids.fine, { record: !!rec });
      await run(gm, P.rig, { seq: [0.025] });
      const a = await run(gm, P.attack, { sceneId, tokenId: tAlly.id, itemId: ids.fine });
      await run(gm, P.rig, {});
      await trackCard(a.id);
      if (rec && part) {
        const spellLabel = labelWithCite(rec);
        const yieldLabel = await fmt("ACKS-LIB.rollMods.yields", { name: stamped.mwLabel, to: rec.label });
        const sum = (label) => (a.attack ?? []).filter((r) => r.label === label).map((r) => Number(r.value)).reduce((t, v) => t + v, 0);
        const count = (label) => (a.attack ?? []).filter((r) => r.label === label).length;
        const net = sum(stamped.weaponLabel) + sum(spellLabel) + sum(yieldLabel);
        check(`${tag}: the net of the weapon's own figure and the spell's rows is the larger of the two`, a.card && count(stamped.weaponLabel) === 1 && net === Math.max(m, s), { rows: (a.attack ?? []).length });
        if (s > m) {
          check(`${tag}: the spell stands as a row and the masterwork share is taken back out by a row naming the spell`, count(spellLabel) === 1 && sum(spellLabel) === s && count(yieldLabel) === 1 && sum(yieldLabel) === -m);
        } else {
          const yielded = await fmt("ACKS-LIB.rollMods.notice.yielded", { spell: rec.label, item: stamped.itemName, to: stamped.mwLabel });
          check(`${tag}: no row is added for the spell, and a notice says it yielded to the masterwork`, count(spellLabel) === 0 && count(yieldLabel) === 0 && (a.notices ?? []).some((n) => n.text === yielded), { notices: (a.notices ?? []).length });
          check(`${tag}: the card said at the cast that the entry would yield`, Object.keys(c.model?.yields ?? {}).length > 0, { yields: Object.keys(c.model?.yields ?? {}).length });
        }
      }
      if (c.card) await undo(c, keyOf(c, tAlly.uuid));
      check(`${tag}: the Judge's Undo took the record off before the next case`, c.card && recipients(await modsOf(tAlly.id), c.model?.castId).length === 0);
    }
  }

  section("buff 14. the weapon's buff with two creatures targeted");
  await spent();
  await run(player, P.target, { sceneId, tokenIds: [tAlly.id, tStranger.id] });
  const blocked14 = await run(player, P.cast, { casterId, spellId: ids.edge, stop: true });
  await run(player, P.target, { sceneId, tokenIds: [] });
  const blockedText = await fmt("ACKS-MAGIC.cast.notice.blocked.oneBearer", {});
  check("buff 14: the Player's dialog states the one-bearer verdict as a block and its Cast button is off", blocked14.dialog && blocked14.verdicts.includes("block") && blocked14.verdictTexts.includes(blockedText) && blocked14.castDisabled, blocked14.verdicts);
  check("buff 14: cancelling it spent nothing and posted no card", blocked14.cancelled && blocked14.cast === 0 && blocked14.pool === 0 && blocked14.cards === 0, { cast: blocked14.cast, pool: blocked14.pool });
  await run(gm, P.target, { sceneId, tokenIds: [tAlly.id, tStranger.id] });
  const warned14 = await run(gm, P.cast, { casterId, spellId: ids.edge, stop: true });
  await run(gm, P.target, { sceneId, tokenIds: [] });
  const warnText = await fmt("ACKS-MAGIC.cast.notice.verdict.oneBearer", {});
  check("buff 14: the Judge's dialog states the same verdict as a warning and leaves Cast on", warned14.dialog && warned14.verdicts.includes("warn") && !warned14.verdicts.includes("block") && warned14.verdictTexts.includes(warnText) && !warned14.castDisabled, warned14.verdicts);
  await spent();
}

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm, PORTS.gm, "gm"));
  note("player reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(player, PORTS.player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  check("the cast seam and the spell carrier are on both seats' apis", installed.claimant && installed.carrier && seated.claimant && seated.carrier);
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const boot = await run(seat, P.boot);
    check(`${label}: the recorder ran before Foundry's scripts and saw the load, with no cast registration error`, boot.recorded && boot.preFoundry && boot.noRegisterError === true, { errors: boot.errors });
  }

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const lib = await run(gm, P.library, { ids: IDS });
  check("the GM seat has the RR open and the three spells imported", lib.rr && lib.present.every(Boolean), lib.present);
  if (!lib.rr || !lib.present.every(Boolean)) throw new Error("the RR or its spells are not available on the GM seat");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const scene = await gm.fixture("magic/cast-scene", "Scene", { name: "QA Cast Spell Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#55606b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  const cls = await gm.fixture("magic/cast-class", "Item", { name: "QA Cast Class", type: "acks-extras.class", system: { key: "qacastclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 2 }] }] } });
  const caster = await gm.fixture("magic/cast-caster", "Actor", { name: "QA Cast Spell Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [playerId]: 3 } });
  const spellOf = (k, marker) => gm.fixture(marker, "Item", { ...lib.payload[k], name: `QA Cast ${k}` }, { parent: caster.uuid });
  const spells = { damage: await spellOf("damage", "magic/cast-spell-damage"), cure: await spellOf("cure", "magic/cast-spell-cure"), fright: await spellOf("fright", "magic/cast-spell-fright") };
  const targets = {};
  for (const k of ["a", "b", "c"]) targets[k] = await gm.fixture(`magic/cast-target-${k}`, "Actor", { name: `QA Cast Target ${k}`, type: "monster", ownership: { default: 0 } });
  const monster = await gm.fixture("magic/cast-monster", "Actor", { name: "QA Cast Monster", type: "monster", ownership: { default: 0 } });
  const weapon = await gm.fixture("magic/cast-monster-weapon", "Item", { name: "QA Cast Claw", type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent: monster.uuid });
  const casterId = idOf(caster);
  const sceneId = idOf(scene);
  const spellId = Object.fromEntries(Object.entries(spells).map(([k, v]) => [k, idOf(v)]));
  const targetIds = Object.values(targets).map(idOf);
  const shaped = await run(gm, P.shape, { casterId, classUuid: cls.uuid, spells: spellId, targetIds, monsterId: idOf(monster) });
  check("shape: each copy carries its rows, the cure spell a reversed form, and the copies read their level from the class", shaped.damage.rows > 0 && shaped.cure.reversed > 0 && shaped.fright.rows > 0, { damage: shaped.damage.kinds, cure: shaped.cure.kinds, fright: shaped.fright.kinds });
  check("the Player seat and the GM seat view the field", (await run(player, P.view, { sceneId })) && (await run(gm, P.view, { sceneId })));
  const made = await run(gm, P.tokens, { sceneId, actorIds: targetIds });
  for (const t of made) await track(t.uuid, "Token");
  const tokenIds = made.map((t) => t.id);
  await run(gm, P.drain);
  await run(player, P.drain);

  section("1. a damage row with a save, cast at three targets (GM seat)");
  const hp0 = await run(gm, P.hp, { sceneId, tokenIds });
  await run(gm, P.target, { sceneId, tokenIds });
  await run(gm, P.rig, { seq: [0.025, 0.975, 0.025] });
  const c1 = await run(gm, P.cast, { casterId, spellId: spellId.damage });
  await run(gm, P.rig, {});
  check("1: the dialog opened with the scroll class, the targets listed and no literal id", c1.dialog && c1.scroll && c1.literalIds === 0, { scroll: c1.scroll, ids: c1.literalIds });
  check("1: the cast settled and posted one card", c1.card && c1.settled, { messageId: !!c1.messageId });
  const damageKey = c1.model?.order?.[0];
  const dmgEntries = c1.model ? entriesOf(c1.model, damageKey) : [];
  const targetsOf = c1.model ? Object.keys(c1.model.targets) : [];
  check("1: three targets each took one entry, applied", targetsOf.length === 3 && dmgEntries.length === 3 && dmgEntries.every((e) => e.state === "applied"), dmgEntries.map((e) => e.state));
  check("1: the damage was rolled once, every entry carries the same rolled amount", new Set(dmgEntries.map((e) => e.rolled)).size === 1);
  check("1: each applied amount is the rolled amount through its save's fraction and one half-to-even rounding", dmgEntries.every((e) => e.applied === halfEven(e.rolled * e.fraction)), dmgEntries.map((e) => [e.saved, e.fraction]));
  check("1: a passed save took half and a failed save the whole; both happened", dmgEntries.some((e) => e.saved === true && e.fraction === 0.5) && dmgEntries.some((e) => e.saved === false && e.fraction === 1), dmgEntries.map((e) => e.saved));
  // Half to even and half up part only where the halved amount ends in .5 on an
  // even whole: a roll one more than a multiple of four. Say whether this cast was one.
  const savedEntries = dmgEntries.filter((e) => e.saved === true);
  const decisive = savedEntries.filter((e) => e.rolled % 4 === 1);
  console.log(`rounding decisive: ${decisive.length > 0} (rolled mod 4: ${[...new Set(dmgEntries.map((e) => e.rolled % 4))].join(",")})`);
  check("1: a halved amount ending in .5 went to the even whole, not up", savedEntries.every((e) => e.applied === halfEven(e.rolled / 2)) && decisive.every((e) => e.applied === (e.rolled - 1) / 2), { decisive: decisive.length });
  const hp1 = await run(gm, P.hp, { sceneId, tokenIds });
  const byTarget = Object.keys(c1.model?.targets ?? {}).map((tk, i) => ({ drop: hp0[i] - hp1[i], applied: c1.model.entries[`${tk}_${damageKey}`]?.applied }));
  check("1: each target's hit points fell by the amount applied", byTarget.length === 3 && byTarget.every((b) => b.drop === b.applied), byTarget);
  check("1: the card shows the damage type and the spell's name", !!c1.model?.rows?.[damageKey]?.types?.length);
  check("1: the cast spent once: the cast count and the tradition's slot each rose by one", c1.cast === 1 && c1.pool === 1, { cast: c1.cast, pool: c1.pool });
  await track(`ChatMessage.${c1.messageId}`, "ChatMessage");
  const seen1 = await run(gm, P.seen, { messageId: c1.messageId });
  check("1: every figure on the card carries a tooltip, and no button is the system's own", seen1.found && seen1.figures > 0 && seen1.untipped === 0 && !seen1.cardButtons, { figures: seen1.figures, untipped: seen1.untipped });
  // Every applied entry that wrote something offers Undo: hit points moved, or a
  // record made (a condition row's). One a passed save negated wrote nothing.
  const appliedEntries = Object.values(c1.model?.entries ?? {}).filter((e) => e?.state === "applied" && (e.applied > 0 || e.recordIds?.length)).length;
  check("1: the Judge's card offers Undo on each applied entry", appliedEntries > 0 && seen1.actions.filter((a) => a === "magicCastUndo").length === appliedEntries, { undo: seen1.actions.filter((a) => a === "magicCastUndo").length, applied: appliedEntries });
  let model = c1.model;
  const undone = [];
  for (const [tk, e] of Object.entries(model.entries)) if (e.applied > 0) undone.push(await run(gm, P.press, { messageId: c1.messageId, action: "magicCastUndo", target: tk.split("_")[0], row: damageKey }));
  const hp2 = await run(gm, P.hp, { sceneId, tokenIds });
  check("1: Undo restored every target's hit points and marked each entry undone", undone.every((u) => u.button) && JSON.stringify(hp2) === JSON.stringify(hp0) && undone.at(-1)?.model && entriesOf(undone.at(-1).model, damageKey).every((e) => e.state === "undone" || e.applied === 0), { hp: hp2.length });
  await run(gm, P.setSpent, { casterId, spent: 0 });

  section("2. the same cast with nothing targeted, then Apply");
  await run(gm, P.target, { sceneId, tokenIds: [] });
  await run(gm, P.rig, { seq: [0.025, 0.975] });
  const c2 = await run(gm, P.cast, { casterId, spellId: spellId.damage });
  await run(gm, P.rig, {});
  await track(`ChatMessage.${c2.messageId}`, "ChatMessage");
  check("2: with nothing targeted the card posts the roll, no target and nothing applied", c2.card && Object.keys(c2.model.targets).length === 0 && c2.model.rows[c2.model.order[0]].total != null);
  const hp3 = await run(gm, P.hp, { sceneId, tokenIds });
  check("2: no hit points moved", JSON.stringify(hp3) === JSON.stringify(hp0));
  const seen2 = await run(gm, P.seen, { messageId: c2.messageId });
  check("2: the card offers Apply for the presser's targets", seen2.actions.includes("magicCastApplyTargets"), seen2.actions);
  await run(gm, P.target, { sceneId, tokenIds: tokenIds.slice(0, 2) });
  await run(gm, P.rig, { seq: [0.025, 0.975] });
  const applied2 = await run(gm, P.press, { messageId: c2.messageId, action: "magicCastApplyTargets" });
  await run(gm, P.rig, {});
  const k2 = c2.model.order[0];
  const e2 = applied2.model ? entriesOf(applied2.model, k2) : [];
  check("2: the press took the two targeted tokens, each saved and applied", e2.length === 2 && e2.every((e) => e.state === "applied" && e.applied === halfEven(e.rolled * e.fraction)), e2.map((e) => e.saved));
  const hp4 = await run(gm, P.hp, { sceneId, tokenIds });
  check("2: the third, untargeted token was left alone", hp4[2] === hp0[2]);
  for (const [tk, e] of Object.entries(applied2.model?.entries ?? {})) if (e.applied > 0) await run(gm, P.press, { messageId: c2.messageId, action: "magicCastUndo", target: tk.split("_")[0], row: k2 });
  await run(gm, P.setSpent, { casterId, spent: 0 });

  section("3. the reversed form throws through the system's card as magic");
  await run(gm, P.target, { sceneId, tokenIds: [tokenIds[0]] });
  const hp5 = await run(gm, P.hp, { sceneId, tokenIds: [tokenIds[0]] });
  await run(gm, P.rig, { seq: [0.025, 0.5] });
  const c3 = await run(gm, P.cast, { casterId, spellId: spellId.cure, mode: "reversed" });
  await run(gm, P.rig, {});
  check("3: the dialog offered the form", c3.modeSelect);
  const attackCard = (c3.newMessages ?? []).find((m) => m.attack);
  check("3: the system's attack card was posted for the cast with no apply button and our mark on it", !!attackCard && !attackCard.applyButton && attackCard.magicAttack, attackCard ?? null);
  if (c3.messageId) await track(`ChatMessage.${c3.messageId}`, "ChatMessage");
  for (const m of c3.newMessages ?? []) await track(`ChatMessage.${m.id}`, "ChatMessage");
  const thrown = c3.model ? entriesOf(c3.model, c3.model.order[0]) : [];
  check("3: the throw's entry applied the amount the system's damage roll made, through the amount path", thrown.length === 1 && thrown[0].state === "applied" && thrown[0].applied === thrown[0].rolled && thrown[0].throw?.hit === true, thrown.map((e) => e.state));
  const hp6 = await run(gm, P.hp, { sceneId, tokenIds: [tokenIds[0]] });
  check("3: the hit points fell by that amount", thrown[0] && hp5[0] - hp6[0] === thrown[0].applied, { drop: hp5[0] - hp6[0] });
  await run(gm, P.setHp, { sceneId, tokenId: tokenIds[0], value: 20 });
  await run(gm, P.setSpent, { casterId, spent: 0 });
  await run(gm, P.target, { sceneId, tokenIds: [] });
  const c3b = await run(gm, P.cast, { casterId, spellId: spellId.cure, mode: "reversed" });
  if (c3b.messageId) {
    await track(`ChatMessage.${c3b.messageId}`, "ChatMessage");
    const seen3 = await run(gm, P.seen, { messageId: c3b.messageId });
    check("3: thrown at nothing, the card carries a Throw press", seen3.actions.includes("magicCastThrow"), seen3.actions);
  } else check("3: thrown at nothing, the card carries a Throw press", false, c3b);
  await run(gm, P.setSpent, { casterId, spent: 0 });

  section("4. the plain heal heals through adjustHp");
  await run(gm, P.setHp, { sceneId, tokenId: tokenIds[1], value: 3 });
  await run(gm, P.target, { sceneId, tokenIds: [tokenIds[1]] });
  const c4 = await run(gm, P.cast, { casterId, spellId: spellId.cure });
  if (c4.messageId) await track(`ChatMessage.${c4.messageId}`, "ChatMessage");
  const healed = c4.model ? entriesOf(c4.model, c4.model.order.find((k) => c4.model.rows[k].type === "heal")) : [];
  const hp7 = await run(gm, P.hp, { sceneId, tokenIds: [tokenIds[1]] });
  check("4: the heal applied and raised the hit points by the amount, to the maximum at most", healed.length === 1 && healed[0].state === "applied" && hp7[0] === Math.min(20, 3 + healed[0].applied), { raised: hp7[0] - 3 });
  await run(gm, P.setSpent, { casterId, spent: 0 });

  section("5. a condition cast twice on one target");
  await run(gm, P.target, { sceneId, tokenIds: [tokenIds[2]] });
  await run(gm, P.rig, { seq: [0.975] });
  const t0 = await run(gm, P.time, { now: true });
  const f1 = await run(gm, P.cast, { casterId, spellId: spellId.fright });
  await run(gm, P.time, { advance: 30 });
  const f2 = await run(gm, P.cast, { casterId, spellId: spellId.fright });
  await run(gm, P.rig, {});
  for (const f of [f1, f2]) if (f.messageId) await track(`ChatMessage.${f.messageId}`, "ChatMessage");
  const recs = await run(gm, P.records, { sceneId, tokenId: tokenIds[2] });
  const mine = recs.records.filter((r) => r.mark.castId === f1.model?.castId || r.mark.castId === f2.model?.castId);
  check("5: two casts left two records, each holding one status and no changes, and one condition stands", mine.length === 2 && mine.every((r) => r.statuses.length === 1 && r.changes === 0) && new Set(mine.flatMap((r) => r.statuses)).size === 1 && recs.statuses.includes(mine[0]?.statuses[0]), { records: mine.length, statuses: recs.statuses.length });
  check("5: the records are timed by the flag, with core's duration unset", mine.every((r) => r.coreDuration == null && r.mark.duration?.value > 0 && Number.isFinite(r.mark.startTime)));
  const end1 = mine[0].mark.startTime + mine[0].mark.duration.value * 60;
  await run(gm, P.time, { to: end1 + 1 });
  const afterFirst = await run(gm, P.records, { sceneId, tokenId: tokenIds[2] });
  check("5: the first record ended by the clock and the condition stays on the second", afterFirst.records.filter((r) => mine.some((m) => m.id === r.id)).length === 1 && afterFirst.statuses.includes(mine[0].statuses[0]));
  await run(gm, P.time, { to: mine[1].mark.startTime + mine[1].mark.duration.value * 60 + 1 });
  const afterSecond = await run(gm, P.records, { sceneId, tokenId: tokenIds[2] });
  check("5: the second record's end took the condition off", afterSecond.records.filter((r) => mine.some((m) => m.id === r.id)).length === 0 && !afterSecond.statuses.includes(mine[0].statuses[0]));
  note("world clock moved by (s)", (await run(gm, P.time, { now: true })) - t0);
  await run(gm, P.setSpent, { casterId, spent: 0 });

  section("6. a monster's attack item still posts the system's own card");
  const mu = await run(gm, P.monsterUse, { monsterId: idOf(monster), itemId: idOf(weapon) });
  if (mu.id) await track(`ChatMessage.${mu.id}`, "ChatMessage");
  check("6: the system's attack card, no cast dialog, no cast card, no magic mark", mu.card && mu.core && !mu.castCard && !mu.ours && !mu.dialog, mu);

  section("7. a Player casts at a token it does not own: the GM's client applies");
  await run(gm, P.target, { sceneId, tokenIds: [] });
  const playerTargeted = await run(player, P.target, { sceneId, tokenIds: [tokenIds[0]] });
  note("player targets", playerTargeted);
  const hp8 = await run(gm, P.hp, { sceneId, tokenIds: [tokenIds[0]] });
  await run(player, P.rig, { seq: [0.975] });
  const c7 = await run(player, P.cast, { casterId, spellId: spellId.damage, wait: 80 });
  await run(player, P.rig, {});
  if (c7.messageId) await track(`ChatMessage.${c7.messageId}`, "ChatMessage");
  const e7 = c7.model ? entriesOf(c7.model, c7.model.order[0]) : [];
  check("7: the Player seat cast through the dialog and the entry was applied", c7.card && c7.settled && e7.length === 1 && e7[0].state === "applied", e7.map((e) => e.state));
  const hp9 = await run(gm, P.hp, { sceneId, tokenIds: [tokenIds[0]] });
  check("7: the hit points moved on the GM's view by the amount applied, the Player owning neither the token nor its actor", e7[0] && hp8[0] - hp9[0] === e7[0].applied);
  const own7 = await run(player, async ({ sceneId: s, tokenId }) => game.scenes.get(s).tokens.get(tokenId)?.actor?.isOwner === true, { sceneId, tokenId: tokenIds[0] });
  check("7: the Player seat does not own the target", own7 === false);
  if (e7[0]?.applied > 0) await run(gm, P.press, { messageId: c7.messageId, action: "magicCastUndo", target: Object.keys(c7.model.targets)[0], row: c7.model.order[0] });
  await run(gm, P.setSpent, { casterId, spent: 0 });

  section("8. with no slot left the Player is refused and the Judge warned");
  await run(gm, P.setSpent, { casterId, spent: 2 });
  const before8 = await run(gm, P.counters, { casterId, spellId: spellId.cure });
  const refused = await run(player, P.cast, { casterId, spellId: spellId.cure, stop: true });
  check("8: the Player's dialog states the verdict and its Cast button is off", refused.dialog && refused.verdicts.includes("block") && refused.castDisabled, refused.verdicts);
  const after8 = await run(gm, P.counters, { casterId, spellId: spellId.cure });
  check("8: cancelling it spent nothing and posted no card", refused.cancelled && JSON.stringify(after8) === JSON.stringify(before8) && refused.cards === 0, { cast: refused.cast, pool: refused.pool });
  const warned = await run(gm, P.cast, { casterId, spellId: spellId.cure, stop: true });
  check("8: the Judge's dialog states the same verdict as a warning and leaves Cast on", warned.dialog && warned.verdicts.includes("warn") && !warned.verdicts.includes("block") && !warned.castDisabled, warned.verdicts);
  await run(gm, P.setSpent, { casterId, spent: 0 });

  // The buff steps run apart, so a throw in one still reaches the console check below.
  try {
    await walkBuffs({ sceneId, caster, casterId, idOf, playerId, damagePayload: lib.payload.damage });
  } catch (err) {
    console.error("WALK ERROR (buff steps):", err?.stack ?? err);
    checks.push(["the buff steps ran to the end", false]);
  }

  section("9. the console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, P.drain);
    check(`${label}: no console error was recorded after the load`, d.errors.length === 0, d.errors.slice(0, 3));
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`rig and recorders restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  try { if (gm) await gm.eval(`canvas.tokens?.setTargets([]); 0`); } catch {}
  try { if (player) await player.eval(`canvas.tokens?.setTargets([]); 0`); } catch {}
  // The run's own leavings: cards speaking as its fixtures since it began, and its caster record, listed by id and then swept.
  try {
    if (gm) {
      // The buff steps' records are listed by the cast ids they made, on the fixtures that carry a marker of this walk's.
      const ledger = await gm.eval(`(async () => JSON.stringify({ cards: [...game.messages].filter((m) => m.timestamp >= ${startedAt} && game.actors.some((a) => a.flags?.world?.fixture?.startsWith?.("magic/cast-") && a.id === m.speaker?.actor)).map((m) => m.uuid), records: [...game.actors.filter((a) => a.flags?.world?.fixture === "magic/cast-caster").flatMap((a) => [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect && e.flags["acks-extras"].spellEffect.casterUuid === a.uuid).map((e) => e.uuid)), ...game.actors.filter((a) => a.flags?.world?.fixture?.startsWith?.("magic/cast-")).flatMap((a) => [...a.effects].filter((e) => ${JSON.stringify(castIds)}.includes(e.flags?.["acks-extras"]?.spellEffect?.castId)).map((e) => e.uuid))] }))()`);
      const { cards, records } = JSON.parse(ledger);
      for (const uuid of cards) await track(uuid, "ChatMessage");
      for (const uuid of records) await track(uuid, "ActiveEffect");
    }
  } catch (err) { console.error("ledger:", err?.message ?? err); }
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: magic/cast-scene, magic/cast-class, magic/cast-caster, magic/cast-spell-damage, magic/cast-spell-cure, magic/cast-spell-fright, magic/cast-target-a, magic/cast-target-b, magic/cast-target-c, magic/cast-monster, magic/cast-monster-weapon, magic/cast-spell-circle, magic/cast-spell-edge, magic/cast-ally, magic/cast-ally-blade, magic/cast-ally-fine, magic/cast-foe, magic/cast-foe-claw, magic/cast-foe-spell, magic/cast-stranger, magic/cast-stranger-claw");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
