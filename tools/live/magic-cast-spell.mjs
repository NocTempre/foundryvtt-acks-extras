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
 * fails its step as an import finding.
 *
 * Then the held-cast steps (docs/magic/TESTING.md, "The held-cast steps"): the
 * circle's caster record is a status-only held record, and its end is one
 * funnel. The status toggled off (the HUD's path) ends step 1's cast with the
 * cause removed; the GM hurting the caster ends a recast with one card whose
 * cause is damage and which lists both recipients, both seats' views of it
 * offering Restore (the Player owns the caster), and the Player's Restore, relayed
 * to the GM's client, putting the same records back under the same ids; the Player
 * hurting its own caster has the Player's client end what it can write and the GM's
 * the ally's, and the Player's Restore on that card puts back only what the Player
 * owns, tells the partial and leaves the card open for the Judge's; a time after concentration
 * re-times the recipients' records from now and the clock then removes them; a
 * longest hold ends everything with the cause time; and a recast warns in the
 * dialog and ends what is held with the cause cast. Durations are the walk's own
 * invented ones. Then the ownership steps ("The ownership presses (Undo and Revert)"):
 * Undo and Revert are offered where Foundry's ownership puts them. The Player who
 * cast at a monster takes the entry back through the GM's client (U1) and is told
 * when the target moved since (U2); the Player who owns the target of a card the GM
 * cast takes it back (U3), and a Player who owns neither caster nor target is
 * offered nothing and refused by the relay (U4); a registered procedure's Revert is
 * offered to the Player who cast it and owns the caster (R1), and not on a card the
 * GM cast for that character (R2). The two notices a seat with no button cannot
 * reach (`undoRefused`, `revert.notOwner`) are named in the output, not asserted.
 * Then the declaration steps ("The declaration steps"): in the
 * run's own begun fight the Player's Declare spends once and leaves a casting
 * status, a pending record and the combatant's flag, no card; damage loses it and
 * the turn reports it lost; a resolved declaration casts at the turn with no
 * dialog and no second spend; and an unresolved one lapses with the caster's
 * turn. Then the lost-item steps: an item deleted, or left with an empty stack,
 * leaves the pending answers that name it, a record a Player cannot write by the
 * GM's client, and the cast dialog's band is headed by the tradition. Then the
 * Invocation band steps: the class fixture reads an invented cap ladder, an invented
 * procedure on its kind asks for the implement-set bucket, and the walk checks the
 * level select (a Player's levels above the cap disabled, a Judge's chosen in the
 * warn tone), the bucket (carried sets, the lowest reaching set picked, a set too
 * low dimmed with its reason, a drop, X, a radio), the no-set-reaches verdict on
 * both seats, the level on the card, and a declared cast keeping the level and the
 * pick; declare 18 walks a declaration resolving on its declared targets. All assert relations between records, cards and counters and print
 * booleans and counts. Last, the ritual steps (`walkRitual`): a ritual spell's dialog shows the Ritual band with the caster's linked location and
 * an enabled Open ritual project, pressing it opens one `ritual` project on that location (the spell its subject, the caster its researcher) with
 * nothing spent and the location's sheet on its Research tab, and a caster linked to no location is blocked with the reason shown; the project
 * is closed through the research API at the end. Fixtures: `magic/cast-ritual-place`, `-caster`, `-loner`, `-spell` and `-spell-loner`.
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
 * cards and records are tracked by uuid and swept alone; the declaration steps
 * add no fixture but the run's own Combat, deleted by its uuid at teardown. The
 * walk moves the world clock forward by a few minutes and restores the dice it
 * rigged.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS, logDir } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const KEY = "magic-cast-spell-walk";
const IDS = { damage: "def.spell.desiccate", cure: "def.spell.cureLightInjury", fright: "def.spell.frightenHumanoid" };
/** The two spells the buff steps copy, imported apart from `IDS` so the first section's three-spell check stands as it was. */
const BUFF_IDS = { circle: "def.spell.holyCircle", edge: "def.spell.sharpness" };
/**
 * The durations the buff and held steps set on their own copies, so a record is timed and the clock can end it. The figures are the walk's
 * own, not the book's: the circle is held by stationary concentration, with a time after it for one step and a longest hold for another.
 */
const CIRCLE_HELD = { shape: "concentration", concentration: "stationary" };
const CIRCLE_TAIL = { shape: "concentrationPlus", concentration: "stationary", plus: { value: 3, unit: "minutes" } };
const CIRCLE_CAP = { shape: "concentrationMax", concentration: "stationary", value: 4, unit: "minutes", maxPerLevel: false };
const EDGE_DURATION = { shape: "fixed", value: 2, unit: "minutes" };
/** The Combat the declaration steps begin, by uuid, so teardown deletes it by id. */
let runCombatUuid = null;

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
    // What the cast dialog's bucket and effect rows show: one entry per target row, the count, the drop strip, the Add my token button, and each effect cell's tone.
    H.bucketOf = (root) => ({
      rows: [...root.querySelectorAll(".acks-extras-cast-trow")].map((r) => ({ uuid: r.dataset.uuid, x: !!r.querySelector('[data-action="untarget"][aria-label]'), off: r.classList.contains("is-off"), pills: r.querySelectorAll(".acks-extras-cast-pill").length, chips: r.querySelectorAll(".acks-extras-cast-chip").length, lineTip: !!r.querySelector(".acks-extras-cast-trow__line")?.dataset.tooltipText })),
      count: root.querySelector(".acks-extras-cast-count")?.textContent.trim() ?? "",
      drop: !!root.querySelector(".acks-extras-cast-drop"),
      addMine: !!root.querySelector('button[data-action="addMine"]'),
      tones: [...root.querySelectorAll(".acks-extras-cast-cell .acks-extras-frame__cell")].map((c) => ["neg", "pos", "ts"].find((t) => c.classList.contains(`is-${t}`)) ?? ""),
      footerPinned: !!root.querySelector(".acks-extras-cast-foot") && !root.querySelector(".acks-extras-cast-body")?.contains(root.querySelector(".acks-extras-cast-foot")),
    });
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
    // Answered in the order asked, paired by actor: a create's answer is not in the order of its data.
    return actorIds.map((actorId) => made.find((t) => t.actorId === actorId)).filter(Boolean).map((t) => ({ id: t.id, uuid: t.uuid, actorId: t.actorId }));
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
    const found = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    // The window re-renders on every change, so each read goes back to the live element.
    const live = () => document.querySelector(".application.acks-extras-cast") ?? found;
    const modeRadio = mode ? live().querySelector(`input[name="mode"][value="${mode}"]`) : null;
    if (modeRadio) { modeRadio.checked = true; modeRadio.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(300); }
    // The weapon pick: a pill per weapon of the holder, the picked one marked `is-on`.
    const pillOf = (id) => live().querySelector(`.acks-extras-cast-pill[data-weapon="${id}"]`);
    const weaponOptions = live().querySelectorAll(".acks-extras-cast-pill").length;
    if (weaponId && pillOf(weaponId)) { pillOf(weaponId).click(); await H.sleep(300); }
    const verdictLis = () => [...live().querySelectorAll(".acks-extras-cast-verdicts li")];
    const verdicts = verdictLis().map((li) => li.dataset.severity);
    const verdictTexts = verdictLis().map((li) => li.textContent.trim());
    const root = live();
    const castButton = root.querySelector('button[data-action="cast"]');
    const shown = { weaponOptions, weaponPicked: weaponId && pillOf(weaponId) ? pillOf(weaponId).classList.contains("is-on") : null, verdictTexts, dialog: true, scroll: root.classList.contains("acks-extras-scroll"), modeSelect: root.querySelectorAll('input[name="mode"]').length > 0, verdicts, castDisabled: !!castButton?.disabled, levelField: !!root.querySelector('[name="casterLevel"]'), literalIds: [...root.querySelectorAll("[id]")].filter((e) => !e.closest(".window-header") && !/^[A-Za-z]+-[A-Za-z0-9]+$/.test(e.id)).length, bucket: H.bucketOf(root) };
    if (stop) {
      live().querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { ...shown, cancelled: true, cast: item.system.cast - cast0, pool: (actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0) - pool0, cards: [...game.messages].filter((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard).length };
    }
    live().querySelector('button[data-action="cast"]').click();
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 120, every: 250 });
    if (!message) return { ...shown, card: false };
    const settled = await H.poll(() => !Object.values(game.messages.get(message.id).flags["acks-extras"].castCard.entries).some((e) => e.state === "pending" || e.state === "applying"), { tries: wait ?? 40, every: 250 });
    const card = game.messages.get(message.id).flags["acks-extras"].castCard;
    return { ...shown, card: true, messageId: message.id, settled: !!settled, model: card, cast: item.system.cast - cast0, pool: (actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0) - pool0, newMessages: [...game.messages].filter((m) => !before.has(m.id)).map((m) => ({ id: m.id, attack: String(m.content).includes("attack-throw-card"), applyButton: String(m.content).includes('data-action="applyDamage"'), magicAttack: !!m.flags?.["acks-extras"]?.magicAttack, cast: !!m.flags?.["acks-extras"]?.castCard })) };
  },
  /**
   * Drive the cast dialog's bucket as a user does, one step at a time so a shot can be taken between. `op`: `open` (item.use, then the dialog),
   * `x` (the first row's X), `t` (T on a canvas token: the seat's own target, as the key does it), `drop` (a real drop event on the bucket carrying
   * `{type: dropType, uuid: dropUuid}`), `add` (the Add my token button), `close` (Cancel). Answers the bucket the dialog shows afterwards, the seat's
   * targeted token ids and the warnings the step raised.
   */
  bucketStep: async ({ op, casterId, spellId, tokenId, dropType, dropUuid }) => {
    const H = globalThis.__mcs;
    const live = () => document.querySelector(".application.acks-extras-cast");
    const warns0 = H.warns.length;
    if (op === "open") {
      game.actors.get(casterId).items.get(spellId).use({ skipDialog: true });
      await H.poll(live, { tries: 80, every: 150 });
    } else if (op === "x") live()?.querySelector('.acks-extras-cast-trow [data-action="untarget"]')?.click();
    else if (op === "t") canvas.tokens.get(tokenId)?.setTarget(true, { releaseOthers: false });
    else if (op === "drop") {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: dropType, uuid: dropUuid }));
      live()?.querySelector(".acks-extras-cast-targets")?.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    } else if (op === "add") live()?.querySelector('[data-action="addMine"]')?.click();
    else if (op === "close") {
      live()?.querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { dialog: !!live(), targets: [...game.user.targets].map((t) => t.document.id), warns: H.warns.slice(warns0) };
    }
    // The window reads the bucket again after a short debounce.
    await H.sleep(600);
    const root = live();
    return { dialog: !!root, bucket: root ? H.bucketOf(root) : null, targets: [...game.user.targets].map((t) => t.document.id), warns: H.warns.slice(warns0) };
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
    const keys = [...(el?.querySelectorAll("[data-action='magicCastUndo']") ?? [])].map((b) => [b.dataset.target, b.dataset.row, b.closest("tr")?.querySelector("td")?.textContent.trim().slice(0, 40) ?? ""]);
    const tips = [...(el?.querySelectorAll(".acks-extras-roll-card td.acks-nums") ?? [])].filter((td) => td.textContent.trim() && td.textContent.trim() !== "—");
    return { found: !!el, actions, keys, figures: tips.length, untipped: tips.filter((td) => !td.dataset.tooltipText && !td.dataset.tooltip).length, cardButtons: !!el?.querySelector(".card-buttons"), title: el?.querySelector(".acks-chat-title")?.textContent ?? "", text: el?.textContent ?? "" };
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
    return { card: !!msg, core: String(msg?.content ?? "").includes("attack-throw-card"), castCard: !!msg?.flags?.["acks-extras"]?.castCard, ours: !!msg?.flags?.["acks-extras"]?.magicAttack, dialog: !!document.querySelector(".application.acks-extras-cast"), id: msg?.id ?? null };
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
    // The created tokens are paired with their specs by actor, never by position: the order a create answers in is not the order asked.
    const out = [];
    for (const spec of specs) {
      const t = made.find((m) => m.actorId === spec.actorId);
      if (!t) { out.push({ id: null, uuid: null, actorId: spec.actorId, name: "", actorName: "", disposition: null, linked: false }); continue; }
      if (t.disposition !== spec.disposition) await t.update({ disposition: spec.disposition });
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

  /* ---------------------------------------------------------------- */
  /*  The held-cast and declaration steps                              */
  /* ---------------------------------------------------------------- */

  /** The caster's held records (those whose mark carries `held`) and the statuses it stands under. */
  heldRecords: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const records = [...actor.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.held).map((e) => {
      const m = e.flags["acks-extras"].spellEffect;
      return { id: e.id, castId: m.castId, held: m.held, statuses: [...e.statuses], changes: e.changes.length, startTime: m.startTime ?? null, duration: m.duration ?? null, tail: m.tail ?? null, coreDuration: e._source.duration?.value ?? null, rollMods: !!e.flags["acks-extras"].rollMods };
    });
    return { records, statuses: [...actor.statuses] };
  },
  /** A pending record naming items in its `kit` bucket, written on an actor with the fields a declaration's answer holds (no fight, so no turn ever reaches it); answers its uuid. */
  lostRecord: async ({ actorId, tag, uuids }) => {
    const actor = game.actors.get(actorId);
    const mark = { spellUuid: "", castId: `qa-lost-${tag}`, casterUuid: actor.uuid, role: "caster", pending: { spellUuid: "", procedure: { buckets: { kit: uuids.map((uuid) => ({ uuid, qty: 1, fit: "" })) } }, combatId: "qa-lost", round: 99, at: 0 } };
    const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: `QA lost ${tag}`, img: "icons/svg/aura.svg", flags: { "acks-extras": { spellEffect: mark } } }]);
    return made.uuid;
  },
  /** The uuids a record's kit bucket names now; with `gone`, wait for that uuid to leave it first. */
  lostKit: async ({ effectUuid, gone }) => {
    const H = globalThis.__mcs;
    const read = async () => (await fromUuid(effectUuid))?.flags?.["acks-extras"]?.spellEffect?.pending?.procedure?.buckets?.kit ?? null;
    if (gone) await H.poll(async () => !((await read()) ?? []).some((e) => e.uuid === gone), { tries: 40, every: 250 });
    return { kit: (await read())?.map((e) => e.uuid) ?? null };
  },
  /** Whether each uuid still resolves. */
  lostHeld: async ({ uuids }) => Promise.all(uuids.map(async (uuid) => !!(await fromUuid(uuid)))),
  /** Whether this seat's user may update each document. */
  lostCanWrite: async ({ uuids }) => Promise.all(uuids.map(async (uuid) => (await fromUuid(uuid)).canUserModify(game.user, "update"))),
  /** Delete one document by uuid, or empty an item's stack, as this seat's user does. */
  lostLeave: async ({ uuid, empty }) => {
    const doc = await fromUuid(uuid);
    if (empty) await doc.update({ "system.quantity": 0 });
    else await doc.delete();
    return true;
  },
  /** Open the cast dialog with a procedure registered for a tradition kind (with `label`, a lang key it supplies), read its band's heading, cancel, and take the procedure off. */
  bandHeading: async ({ casterId, spellId, kind, label }) => {
    const H = globalThis.__mcs;
    const off = acksExtras.magic.registerCastProcedure(kind, { fields: () => [{ key: "qa", kind: "number", label: "QA", initial: 0 }], ...(label ? { label } : {}) });
    try {
      game.actors.get(casterId).items.get(spellId).use({ skipDialog: true });
      const dialog = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
      if (!dialog) return { dialog: false };
      // The band the procedure's own field sits in; the Targets band has a heading of its own.
      const heading = dialog.querySelector('[name="procedure.qa"]')?.closest(".acks-extras-cast-band")?.querySelector("h3")?.textContent.trim() ?? null;
      dialog.querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { dialog: true, heading, supplied: label ? game.i18n.localize(label) : null, generic: game.i18n.localize("ACKS-MAGIC.cast.dialog.invocation") };
    } finally {
      off();
    }
  },
  /** The caster's pending declarations and whether it stands under `casting`; with `until`, wait for that many, with `lost`, wait for one stamped lost. */
  pendingOf: async ({ casterId, until, lost }) => {
    const H = globalThis.__mcs;
    const actor = game.actors.get(casterId);
    const read = () => [...actor.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.pending).map((e) => {
      const p = e.flags["acks-extras"].spellEffect.pending;
      return { castId: e.flags["acks-extras"].spellEffect.castId, lost: p.lost?.cause ?? null, round: p.round, combatId: p.combatId };
    });
    if (until != null) await H.poll(() => read().length === until, { tries: 40, every: 250 });
    if (lost) await H.poll(() => read().some((p) => p.lost), { tries: 40, every: 250 });
    return { pending: read(), casting: actor.statuses.has("casting") };
  },
  /** The cards of concentration's end made since `since`, with what each lists. */
  endCards: async ({ since, castId }) => [...game.messages]
    .filter((m) => m.timestamp >= since && m.flags?.["acks-extras"]?.castHeldEnd && (!castId || m.flags["acks-extras"].castHeldEnd.castId === castId))
    .map((m) => {
      const f = m.flags["acks-extras"].castHeldEnd;
      return { id: m.id, uuid: m.uuid, author: m.author?.id ?? null, cause: f.cause, castId: f.castId, ended: f.ended.map((e) => e.actorUuid), retimed: f.retimed.map((r) => ({ actorUuid: r.actorUuid, startTime: r.startTime, duration: r.duration })), open: f.open.length, restored: !!f.restored };
    }),
  /** Wait for a card of this cast's end made since `since`. */
  waitEnd: async ({ castId, since }) => {
    const H = globalThis.__mcs;
    return !!(await H.poll(() => [...game.messages].some((m) => m.timestamp >= since && m.flags?.["acks-extras"]?.castHeldEnd?.castId === castId), { tries: 80, every: 250 }));
  },
  /** What a seat's render of a concentration card offers. */
  heldCard: async ({ messageId }) => {
    const H = globalThis.__mcs;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(500);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    return { found: !!el, restore: !!el?.querySelector("[data-acks-extras-held-restore]"), end: el?.querySelectorAll("[data-acks-extras-held-end]").length ?? 0 };
  },
  /**
   * Press Restore on this seat's rendering of a concentration card. By default wait for the card to carry its `restored` stamp; with `partial`
   * wait instead for a notice to be told here (a restore that left records unwritten is never stamped). Answers the stamp, whether it names this
   * seat's user, and the notices told since the press.
   */
  pressRestore: async ({ messageId, partial }) => {
    const H = globalThis.__mcs;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(400);
    const button = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"] [data-acks-extras-held-restore]:not([disabled])`), { tries: 40, every: 200 });
    if (!button) return { button: false };
    const warns0 = H.warns.length;
    button.click();
    const stamp = () => game.messages.get(messageId)?.flags?.["acks-extras"]?.castHeldEnd?.restored;
    const done = await H.poll(() => (partial ? H.warns.length > warns0 : stamp()), { tries: 60, every: 250 });
    await H.sleep(500);
    return { button: true, restored: !!stamp(), came: !!done, byMe: stamp()?.by === game.user.name, warns: H.warns.slice(warns0) };
  },
  /* ---------------------------------------------------------------- */
  /*  The ownership steps                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Press a button of a cast card in the chat log, as a user does, and wait on the signal the press ends in: a press the GM's client carries out
   * is written after this client's own handler returns, so the card as stored is read only once `until` holds. `until`: `off` (the entry of
   * `target` and `row` leaves `applied`), `warn` (a notice is told on this seat), `reverted` (the card's procedure is stamped reverted).
   * Answers the card as stored, whether the signal came, and the notices told since the press.
   */
  pressUntil: async ({ messageId, action, target, row, until }) => {
    const H = globalThis.__mcs;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(400);
    const sel = `[data-message-id="${messageId}"] [data-action="${action}"]${target ? `[data-target="${target}"]` : ""}${row ? `[data-row="${row}"]` : ""}`;
    const button = await H.poll(() => document.querySelector(sel), { tries: 40, every: 200 });
    if (!button) return { button: false };
    const warns0 = H.warns.length;
    const card = () => game.messages.get(messageId)?.flags?.["acks-extras"]?.castCard;
    const signal = until === "warn" ? () => H.warns.length > warns0 : until === "reverted" ? () => card()?.procedure?.reverted === true : () => card()?.entries?.[`${target}_${row}`]?.state !== "applied";
    button.click();
    const came = await H.poll(signal, { tries: 60, every: 250 });
    await H.sleep(500);
    return { button: true, came: !!came, model: card(), warns: H.warns.slice(warns0) };
  },
  /** Send a request to the GM's client through lib's socket transport as this seat's user; answers whether anything came back and what. */
  relay: async ({ action, payload }) => {
    const { executeAsGM } = await import("/modules/acks-extras/scripts/lib/sockets.mjs");
    const answer = await Promise.race([executeAsGM(action, payload), new Promise((r) => setTimeout(() => r("timeout"), 20000))]);
    return { answered: answer !== undefined && answer !== null && answer !== "timeout", timeout: answer === "timeout", answer: answer === "timeout" ? null : (answer ?? null) };
  },
  /** One entry of a stored card: its state and the figures a step compares. */
  entryOf: async ({ messageId, id }) => {
    const e = game.messages.get(messageId)?.flags?.["acks-extras"]?.castCard?.entries?.[id];
    return e ? { state: e.state, applied: e.applied ?? 0, before: e.before ?? null, after: e.after ?? null } : null;
  },
  /**
   * Register a procedure on a tradition kind on this seat whose `perform` answers undo data and whose `revert` records the keys of the `ctx` it
   * was handed with the undo data and the cast id; `revProcOff` takes it off. The client that presses Revert runs `revert`, the one that casts runs `perform`.
   */
  revProc: async ({ kind }) => {
    const H = globalThis.__mcs;
    H.revOff?.();
    H.reverts = [];
    H.revOff = acksExtras.magic.registerCastProcedure(kind, {
      perform: async () => ({ proceed: true, undo: { qa: 1 } }),
      revert: async (ctx, undo) => { H.reverts.push({ keys: Object.keys(ctx).sort(), undo, castId: ctx.castId ?? null }); },
    });
    return true;
  },
  revProcOff: async () => {
    const H = globalThis.__mcs;
    H.revOff?.();
    H.revOff = null;
    return true;
  },
  /** The calls the registered `revert` recorded on this seat. */
  revCalls: async () => (globalThis.__mcs.reverts ?? []).map((r) => ({ keys: r.keys, undo: r.undo, castId: r.castId })),

  /** A Combat of these tokens, begun by writing its round, turn and core's initDone flag (never `startCombat`, which opens the surprise matrix). */
  combatNew: async ({ sceneId, tokenIds }) => {
    const scene = game.scenes.get(sceneId);
    const combat = await Combat.create({ scene: sceneId, active: true });
    await combat.createEmbeddedDocuments("Combatant", tokenIds.map((id) => ({ tokenId: id, sceneId, actorId: scene.tokens.get(id).actorId })));
    await combat.update({ round: 1, turn: 0, "flags.acks.initDone": true });
    return { id: combat.id, uuid: combat.uuid, combatants: combat.combatants.map((c) => ({ id: c.id, tokenId: c.tokenId })) };
  },
  /** Set initiatives by combatant id. */
  combatSet: async ({ combatId, initiatives }) => {
    const combat = game.combats.get(combatId);
    for (const [id, initiative] of Object.entries(initiatives)) await combat.combatants.get(id).update({ initiative });
    await new Promise((r) => setTimeout(r, 600));
    return combat.turns.map((c) => c.id);
  },
  /**
   * Move the tracker by `combat.update` or `nextTurn`, and answer where it stands, with `cards`: the uuids of the speakerless cards this
   * client authored during the move (core's round card, posted when `nextTurn` opens a round), the run's own leavings to sweep.
   */
  combatMove: async ({ combatId, update, next }) => {
    const combat = game.combats.get(combatId);
    const before = new Set([...game.messages].map((m) => m.id));
    if (next) await combat.nextTurn();
    else await combat.update(update);
    await new Promise((r) => setTimeout(r, 1200));
    const cards = [...game.messages].filter((m) => !before.has(m.id) && m.author?.id === game.user.id && !m.speaker?.actor).map((m) => m.uuid);
    return { round: combat.round, turn: combat.turn, current: combat.combatant?.id ?? null, cards };
  },
  /** A combatant's `prepareSpell`; with `until`, wait for it to read that. */
  combatInfo: async ({ combatId, combatantId, until }) => {
    const H = globalThis.__mcs;
    const read = () => game.combats.get(combatId)?.combatants.get(combatantId)?.flags?.acks?.prepareSpell === true;
    if (until != null) await H.poll(() => read() === until, { tries: 40, every: 250 });
    return { prepareSpell: read() };
  },
  /** Declare a spell as a user does: open the dialog, read its button, confirm, and wait for the declaration. No cast card is expected. */
  declare: async ({ casterId, spellId }) => {
    const H = globalThis.__mcs;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    const cast0 = item.system.cast;
    const pool0 = actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0;
    item.use({ skipDialog: true });
    const dialog = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
    if (!dialog) return { dialog: false };
    const button = dialog.querySelector('button[data-action="cast"]');
    const label = button?.textContent.trim() ?? "";
    button.click();
    await H.poll(() => [...actor.effects].some((e) => e.flags?.["acks-extras"]?.spellEffect?.pending), { tries: 60, every: 250 });
    await H.sleep(800);
    return { dialog: true, label, casting: actor.statuses.has("casting"), pending: [...actor.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.pending).length, cast: item.system.cast - cast0, pool: (actor.getFlag("acks-extras", "classes")?.pools?.arcane?.s1 ?? 0) - pool0, cards: [...game.messages].filter((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard).length };
  },
  /** Cast a declared spell on the caster's turn as a user does: no dialog should open and the card should post. */
  castResolve: async ({ casterId, spellId }) => {
    const H = globalThis.__mcs;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    item.use({ skipDialog: true });
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 80, every: 250 });
    await H.sleep(500);
    const open = document.querySelector(".application.acks-extras-cast");
    const seen = {
      card: !!message,
      messageId: message?.id ?? null,
      dialog: !!open,
      button: open?.querySelector('button[data-action="cast"]')?.textContent.trim() ?? null,
      verdicts: [...(open?.querySelectorAll(".acks-extras-cast-verdicts li") ?? [])].map((li) => li.textContent.trim()),
    };
    // A dialog that opened is answered by Cancel, so it cannot stand open under the next step's reads.
    open?.querySelector('button[data-action="cancel"]')?.click();
    if (open) await H.sleep(600);
    return seen;
  },
  /**
   * The invention the Invocation-band steps use: the class fixture's casting row names an invented cap ladder (`levelCap`) and the caster
   * stands at a class level the ladder reads a cap at; `off` puts the row, the ladder and the level back as they were.
   */
  invWorld: async ({ classUuid, casterId, level, off, was }) => {
    const cls = await fromUuid(classUuid);
    const actor = game.actors.get(casterId);
    if (off) {
      await cls.update({ "system.casting": was.casting, "system.ladders": was.ladders });
      await actor.update({ "system.details.level": was.level });
      return true;
    }
    const prior = { casting: foundry.utils.deepClone(cls.system.casting), ladders: foundry.utils.deepClone(cls.system.ladders), level: actor.system.details.level };
    const row = { ...foundry.utils.deepClone(cls.system.casting[0]), levelCap: "qacap" };
    await cls.update({ "system.casting": [row], "system.ladders": [{ key: "qacap", label: "QA cap ladder", values: [{ atLevel: 1, value: 1 }, { atLevel: 3, value: 3 }, { atLevel: 5, value: 5 }] }] });
    await actor.update({ "system.details.level": level });
    return prior;
  },
  /** Register the invented procedure (an implement-set bucket) for a tradition kind on this seat; `invProcOff` takes it off. */
  invProc: async ({ kind, cite }) => {
    const H = globalThis.__mcs;
    H.invOff?.();
    H.invOff = acksExtras.magic.registerCastProcedure(kind, { buckets: (ctx) => [acksExtras.magic.implementsBucket(ctx, { cite })] });
    return true;
  },
  invProcOff: async () => {
    const H = globalThis.__mcs;
    H.invOff?.();
    H.invOff = null;
    return true;
  },
  /** An item the walk makes carries an implement level and damage, the flag the bucket reads. */
  invSet: async ({ uuid, level, damage }) => {
    await (await fromUuid(uuid)).update({ "flags.acks-extras.ceremony": { implementLevel: level, damage } });
    return true;
  },
  /**
   * Open the cast dialog and read its Invocation band, after each control the call names: `level` chosen in the select, `pick` a bucket row's radio
   * clicked, `remove` a row's X clicked, `drop` an item dropped on the bucket's zone as a real drop event. `cast` presses Cast (or Declare) where it is
   * enabled. Answers the band as it stands.
   */
  invBand: async ({ casterId, spellId, level, pick, remove, drop, cast }) => {
    const H = globalThis.__mcs;
    const item = game.actors.get(casterId).items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    // The dialog this call opens is the one not already on the page; one left open by an earlier call is counted as `stale` and never read.
    const standing = new Set(document.querySelectorAll(".application.acks-extras-cast"));
    item.use({ skipDialog: true });
    const first = await H.poll(() => [...document.querySelectorAll(".application.acks-extras-cast")].find((d) => !standing.has(d)) ?? null, { tries: 80, every: 150 });
    if (!first) return { dialog: false, stale: standing.size };
    const live = () => first;
    const closeIt = async () => { first.querySelector('button[data-action="cancel"]')?.click(); await H.sleep(500); };
    const rowOf = (name) => [...live().querySelectorAll(".acks-extras-bucket__row")].find((r) => r.querySelector(".acks-extras-bucket__name")?.textContent.trim().startsWith(name));
    if (level != null) {
      const sel = live().querySelector('select[name="invocationLevel"]');
      const opt = sel?.querySelector(`option[value="${level}"]`);
      if (!sel || !opt || opt.disabled) {
        await closeIt();
        return { dialog: true, refused: true, hasSelect: !!sel, hasOption: !!opt, stale: standing.size };
      }
      sel.value = String(level);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      await H.sleep(500);
    }
    let rowsBeforeDrop = null;
    if (drop) {
      rowsBeforeDrop = live().querySelectorAll(".acks-extras-bucket__row").length;
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: drop }));
      live().querySelector("[data-bucket-drop]")?.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      await H.sleep(700);
    }
    if (pick) { rowOf(pick)?.querySelector('input[type="radio"]')?.click(); await H.sleep(500); }
    if (remove) { rowOf(remove)?.querySelector('button[data-action="bucketRemove"]')?.click(); await H.sleep(500); }
    const el = live();
    const sel = el.querySelector('select[name="invocationLevel"]');
    const shown = {
      dialog: true,
      heading: sel?.closest(".acks-extras-cast-band")?.querySelector("h3")?.textContent.trim() ?? null,
      options: [...(sel?.options ?? [])].map((o) => ({ value: o.value, disabled: o.disabled, selected: o.selected, text: o.textContent.trim() })),
      selectTone: sel?.className ?? "",
      cap: el.querySelector(".acks-extras-cast-cap")?.textContent.trim() ?? null,
      capTip: el.querySelector(".acks-extras-cast-invlevel label")?.dataset.tooltipText ?? null,
      rows: [...el.querySelectorAll(".acks-extras-bucket__row")].map((r) => ({
        name: r.querySelector(".acks-extras-bucket__name")?.textContent.trim() ?? "",
        used: r.classList.contains("is-used") && !!r.querySelector(".acks-extras-bucket__tag"),
        disabled: !!r.querySelector('input[type="radio"]')?.disabled,
        caption: r.querySelector(".acks-extras-bucket__line")?.textContent.replace(/\s+/g, " ").trim() ?? "",
        reason: r.querySelector(".acks-extras-bucket__reason")?.textContent.trim() ?? "",
        hollow: (r.querySelector(".acks-extras-bucket__diamonds")?.textContent.match(/\u25C7/g) ?? []).length,
      })),
      verdicts: [...el.querySelectorAll(".acks-extras-cast-verdicts li")].map((li) => ({ tone: li.classList.contains("is-warn") ? "warn" : "block", text: li.textContent.trim() })),
      castDisabled: !!el.querySelector('button[data-action="cast"]')?.disabled,
      button: el.querySelector('button[data-action="cast"]')?.textContent.trim() ?? "",
      stale: standing.size,
      rowsBeforeDrop,
    };
    if (!cast) {
      el.querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(500);
      return shown;
    }
    if (shown.castDisabled) { el.querySelector('button[data-action="cancel"]')?.click(); await H.sleep(500); return { ...shown, card: false }; }
    el.querySelector('button[data-action="cast"]').click();
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 60, every: 250 });
    await H.sleep(500);
    return { ...shown, card: !!message, messageId: message?.id ?? null, model: message?.flags?.["acks-extras"]?.castCard ?? null };
  },
  /** What a caster's pending declaration stores of the band: the level and the procedure's answer. */
  invPending: async ({ casterId }) => {
    const rec = [...game.actors.get(casterId).effects].map((e) => e.flags?.["acks-extras"]?.spellEffect?.pending).find(Boolean);
    return rec ? { invocationLevel: rec.invocationLevel ?? null, picked: rec.procedure?.picked ?? null, kept: (rec.procedure?.buckets?.implements ?? []).map((e) => e.uuid), targets: rec.targets ?? null } : null;
  },
  /**
   * The ritual steps' kept fixtures brought to a known shape: the place's open projects closed through the research API (nothing deleted), its roster
   * holding the linked caster alone, and each spell a level-3 ritual. Answers the places each caster is linked to, read as the dialog reads them.
   */
  ritualShape: async ({ placeUuid, casterUuid, loneUuid }) => {
    const H = globalThis.__mcs;
    const place = fromUuidSync(placeUuid);
    const PL = await import("/modules/acks-extras/scripts/lib/place.mjs");
    const live = await import("/modules/acks-extras/scripts/magic/research-project-live.mjs");
    let closed = 0;
    for (const p of place.flags?.["acks-extras"]?.magic?.projects ?? []) {
      if (p.status !== "open") continue;
      if ((await acksExtras.magic.research.close(place, p.id))?.ok) closed++;
    }
    await place.update({ "system.roster": [] });
    await H.sleep(300);
    await PL.addOccupant(place, fromUuidSync(casterUuid));
    await H.sleep(500);
    for (const uuid of [casterUuid, loneUuid]) {
      const item = fromUuidSync(uuid).items.find((i) => i.type === "spell");
      await item.update({ "system.lvl": 3, "flags.acks-extras.spell.ritual": true });
    }
    await H.sleep(300);
    return { closed, roster: place.system.roster.map((r) => r.uuid), casterLinks: live.locationsOf(fromUuidSync(casterUuid)).map((l) => l.uuid), loneLinks: live.locationsOf(fromUuidSync(loneUuid)).map((l) => l.uuid) };
  },
  /**
   * Cast a ritual spell as a user does: `item.use()`, then read the dialog it opens (the Ritual band, its location select or its reason, the bands
   * and controls of the ordinary cast, the footer's primary button). Without `press` the dialog is cancelled; with it the button is pressed, and the
   * answer carries the projects the place gained, what the caster spent, the cast cards posted, and whether the place's sheet rendered on its Research
   * tab with the new project's card.
   */
  ritualCast: async ({ casterId, spellId, placeUuid, press }) => {
    const H = globalThis.__mcs;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const place = fromUuidSync(placeUuid);
    const projectsOf = () => place?.flags?.["acks-extras"]?.magic?.projects ?? [];
    const spendOf = () => JSON.stringify({ cast: actor.items.filter((i) => i.type === "spell").map((i) => [i.id, i.system.cast]), classes: actor.getFlag("acks-extras", "classes") ?? null });
    const before = { ids: projectsOf().map((p) => p.id), spend: spendOf(), msgs: [...game.messages].map((m) => m.id) };
    item.use({ skipDialog: true });
    const found = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    await H.sleep(500);
    const live = () => document.querySelector(".application.acks-extras-cast") ?? found;
    const root = live();
    const band = root.querySelector(".acks-extras-cast-ritual");
    const button = root.querySelector('button[data-action="cast"]');
    const shown = {
      dialog: true,
      bands: root.querySelectorAll(".acks-extras-cast-band").length,
      ritualBand: !!band,
      legend: band?.querySelector("h3")?.textContent.trim() ?? "",
      options: [...root.querySelectorAll('select[name="ritualLocation"] option')].map((o) => ({ value: o.value, name: o.textContent.trim(), selected: o.selected })),
      reason: band?.querySelector(".acks-extras-cast-verdicts li")?.textContent.trim() ?? "",
      ordinary: ["mode", "pickKind", "casterLevel", "invocationLevel", "situational", "visibility"].filter((n) => root.querySelector(`[name="${n}"]`)).concat(root.querySelector("[data-pick], .acks-extras-cast-targets, .acks-extras-cast-trow") ? ["picks or targets"] : []),
      button: { text: button?.textContent.trim() ?? "", disabled: !!button?.disabled, primary: !!button?.classList.contains("acks-extras-cast-go") },
      expected: { open: game.i18n.localize("ACKS-MAGIC.cast.dialog.openRitual"), legend: game.i18n.localize("ACKS-MAGIC.cast.dialog.ritualLegend"), none: game.i18n.format("ACKS-MAGIC.cast.dialog.ritualNone", { name: actor.name }) },
    };
    const gained = () => projectsOf().filter((p) => !before.ids.includes(p.id));
    const cards = () => [...game.messages].filter((m) => !before.msgs.includes(m.id) && m.flags?.["acks-extras"]?.castCard).length;
    if (!press) {
      live().querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { ...shown, cancelled: !document.querySelector(".application.acks-extras-cast"), gained: gained().length, spendSame: spendOf() === before.spend, cards: cards() };
    }
    button.click();
    await H.poll(() => gained().length > 0, { tries: 60, every: 250 });
    await H.sleep(500);
    const made = gained();
    const first = made[0] ?? null;
    const sheetUp = await H.poll(() => {
      const el = H.root(place.sheet);
      return !!el?.isConnected && !!el.querySelector('section[data-tab="research"]')?.classList.contains("active");
    }, { tries: 40, every: 250 });
    const sheetEl = H.root(place.sheet);
    return {
      ...shown,
      closed: !document.querySelector(".application.acks-extras-cast"),
      gained: made.length,
      project: first && { id: first.id, kind: first.kind, status: first.status, subject: first.subject?.uuid ?? null, researcher: first.researcher },
      spendSame: spendOf() === before.spend,
      cards: cards(),
      sheet: { up: !!sheetUp, card: !!(first && sheetEl?.querySelector(`section[data-tab="research"] [data-project-id="${first.id}"]`)) },
      spellUuid: item.uuid,
      casterUuid: actor.uuid,
    };
  },
  /** Close a ritual project through the research API (it stays on the record) and put the place's sheet away. */
  ritualClose: async ({ placeUuid, ids }) => {
    const place = fromUuidSync(placeUuid);
    const out = [];
    for (const id of ids) out.push((await acksExtras.magic.research.close(place, id))?.ok === true);
    await place.sheet?.close({ animate: false });
    return out;
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
// A mid-walk sweep of a step's own documents. What it swept leaves `own` too, so the
// closing sweep never names a uuid the ledger no longer holds (which refuses the whole sweep).
const sweepStep = async (uuids) => {
  const out = await gm.sweepTracked({ only: uuids });
  for (const uuid of uuids) {
    const at = own.indexOf(uuid);
    if (at >= 0) own.splice(at, 1);
  }
  return out;
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
async function walkBuffs({ sceneId, caster, casterId, idOf, playerId, damagePayload, damageId, classUuid, targetTokenId }) {
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
  const shapedCircle = await run(gm, P.buffShape, { casterId, spellId: ids.circle, fresh: freshOf("circle"), duration: CIRCLE_HELD, values: {} });
  const shapedEdge = await run(gm, P.buffShape, { casterId, spellId: ids.edge, fresh: freshOf("edge"), duration: EDGE_DURATION, values: {} });
  const shapedFoeSpell = await run(gm, P.shapeDamage, { actorId: ids.foe, spellId: ids.foeSpell });
  check("buff: each copy carries its rows, and the foe's copy a damage row", shapedCircle.rows > 0 && shapedEdge.rows > 0 && shapedFoeSpell.damageRow, { circle: shapedCircle.rows, edge: shapedEdge.rows });
  const placed = await run(gm, P.tokensFor, { sceneId, specs: [
    { actorId: casterId, disposition: 1, x: 300, y: 600 },
    { actorId: ids.ally, disposition: 1, x: 500, y: 600 },
    { actorId: ids.foe, disposition: -1, x: 700, y: 600 },
    { actorId: ids.stranger, disposition: -1, x: 900, y: 600 },
  ] });
  for (const t of placed) if (t.uuid) await track(t.uuid, "Token");
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
  const held1 = await run(gm, P.heldRecords, { actorId: casterId });
  check("buff 1: the caster holds one status-only concentrating-and-stationary record of the cast, with the kind held in its flag", held1.records.filter((h) => h.castId === c1.model?.castId).length === 1 && held1.records.every((h) => h.statuses.length === 1 && h.statuses[0] === "concentrating-and-stationary" && h.changes === 0 && h.held === "stationary" && !h.rollMods) && held1.statuses.includes("concentrating-and-stationary"), { records: held1.records.length });

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

  await walkHeld({ sceneId, caster, casterId, ids, tCaster, tAlly, c1castId: c1.model?.castId, freshOf, fmt, modsOf, trackCard, spent, recipients, allyOwned, playerId, damageId });

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

  await walkOwnership({ sceneId, casterId, damageId, ids, tCaster, tAlly, targetTokenId, fmt, spent, trackCard });
  await walkDeclare({ sceneId, casterId, tCaster, tFoe, ids, damageId, fmt, spent, trackCard });
  await walkLostItem({ casterId, casterUuid: caster.uuid, damageId });
  await walkInvocation({ casterId, casterUuid: caster.uuid, damageId, classUuid, sceneId, tCaster, tFoe, spent, trackCard, fmt });
}

/** Cards of concentration's end the run made since `since`, tracked for the sweep. */
async function endCardsSince(since, castId) {
  const cards = await run(gm, P.endCards, { since, castId });
  for (const c of cards) await track(c.uuid, "ChatMessage");
  return cards;
}

/**
 * The held-cast steps (docs/magic/TESTING.md, "The held-cast steps"): how a cast held by concentration ends and what its card says. The
 * circle copy is reshaped per step to a duration of the walk's own (a plain concentration, a time after, a longest hold), and the caster's
 * hit points are written on the client whose loss path the step asserts.
 */
async function walkHeld(K) {
  const { sceneId, caster, casterId, tCaster, tAlly, c1castId, freshOf, fmt, modsOf, trackCard, spent, recipients, allyOwned, playerId, damageId, ids } = K;
  const heldOf = () => run(gm, P.heldRecords, { actorId: casterId });
  const standingOf = async (castId) => ({ caster: recipients(await modsOf(tCaster.id), castId), ally: recipients(await modsOf(tAlly.id), castId), held: (await heldOf()).records.filter((h) => h.castId === castId) });
  const hp = (seat, value) => run(seat, P.setHp, { sceneId, tokenId: tCaster.id, value });
  const castCircle = async (duration) => {
    await run(gm, P.buffShape, { casterId, spellId: ids.circle, fresh: freshOf("circle"), duration, values: {} });
    await spent();
    await run(player, P.target, { sceneId, tokenIds: [tCaster.id, tAlly.id] });
    const c = await run(player, P.cast, { casterId, spellId: ids.circle, wait: 80 });
    await run(player, P.target, { sceneId, tokenIds: [] });
    await trackCard(c.messageId);
    if (c.model?.castId) castIds.push(c.model.castId);
    return c;
  };
  const only = (cards, castId) => cards.filter((c) => c.castId === castId);
  const full = (s) => s.caster.length === 1 && s.ally.length === 1 && s.held.length === 1;
  const empty = (s) => s.caster.length === 0 && s.ally.length === 0 && s.held.length === 0;

  section("held 6. the caster is hurt (GM client): the cast ends with one card, and Restore puts it back");
  // Step 1's own record still stands: deleting it through the status toggle, as the HUD does, ends a cast whose recipients were undone earlier.
  const sinceToggle = Date.now();
  await run(gm, async ({ casterId: id }) => { await game.actors.get(id).toggleStatusEffect("concentrating-and-stationary", { active: false }); return true; }, { casterId });
  check("held 6: the status toggle's end posted one card of its cast, with no cause but removed", (await run(gm, P.waitEnd, { castId: c1castId, since: sinceToggle })) && only(await endCardsSince(sinceToggle, c1castId), c1castId).length === 1);
  const toggled = only(await run(gm, P.endCards, { since: sinceToggle, castId: c1castId }), c1castId);
  check("held 6: that card's cause is removed and the caster holds nothing", toggled[0]?.cause === "removed" && (await heldOf()).records.length === 0, { cause: toggled[0]?.cause });
  await hp(gm, 9);
  const c6 = await castCircle(CIRCLE_HELD);
  const id6 = c6.model?.castId;
  const before6 = await standingOf(id6);
  check("held 6: the recast left the caster's record and each recipient's", c6.card && c6.settled && full(before6), { caster: before6.caster.length, ally: before6.ally.length, held: before6.held.length });
  const since6 = Date.now();
  await hp(gm, 8);
  const ended6 = await run(gm, P.waitEnd, { castId: id6, since: since6 });
  const after6 = await standingOf(id6);
  const status6 = await heldOf();
  check("held 6: the concentration status is gone and the caster's record and every recipient's record of the cast are gone", ended6 && empty(after6) && !status6.statuses.includes("concentrating-and-stationary"), { caster: after6.caster.length, ally: after6.ally.length, held: after6.held.length });
  const cards6 = only(await endCardsSince(since6, id6), id6);
  check("held 6: exactly one card of the cast's end, its cause damage, listing both recipients", cards6.length === 1 && cards6[0].cause === "damage" && cards6[0].ended.length === 2, { cards: cards6.length, cause: cards6[0]?.cause });
  const seenGm = cards6[0] ? await run(gm, P.heldCard, { messageId: cards6[0].id }) : null;
  const seenPlayer = cards6[0] ? await run(player, P.heldCard, { messageId: cards6[0].id }) : null;
  check("held 6: the card offers Restore on the GM's view and on the Player's, since the Player owns the caster", !!seenGm?.found && seenGm.restore && !!seenPlayer?.found && seenPlayer.restore, { gm: seenGm?.restore, player: seenPlayer?.restore });
  // The Player owns neither the GM-authored card nor the ally, so the press is relayed to the GM's client, which writes every record of a GM's card.
  const restored = cards6[0] ? await run(player, P.pressRestore, { messageId: cards6[0].id }) : { button: false };
  check("held 6: the Player's Restore stamped the card restored with the Player's user name and told no partial restore", restored.button && restored.restored && restored.byMe === true && restored.warns.length === 0, { restored: restored.restored, byMe: restored.byMe, warns: restored.warns?.length });
  const back6 = await standingOf(id6);
  const idsBack = [...back6.caster, ...back6.ally, ...back6.held].map((r) => r.id).sort();
  const idsWere = [...before6.caster, ...before6.ally, ...before6.held].map((r) => r.id).sort();
  check("held 6: Restore put back the same records under the same ids and the status is on again", restored.button && full(back6) && JSON.stringify(idsBack) === JSON.stringify(idsWere) && (await heldOf()).statuses.includes("concentrating-and-stationary"), { ids: idsBack.length });

  section("held 7. the Player hurts its own caster (Player client): the Player's client ends what it can write and the GM's the rest");
  await hp(gm, 9);
  const since7 = Date.now();
  await hp(player, 8);
  const ended7 = await run(gm, P.waitEnd, { castId: id6, since: since7 });
  const cards7 = only(await endCardsSince(since7, id6), id6);
  const after7 = await standingOf(id6);
  check("held 7: the cast ended, every record gone, with one card listing both recipients", ended7 && empty(after7) && cards7.length === 1 && cards7[0].ended.length === 2, { cards: cards7.length });
  check("held 7: the Player's client posted the card, and the ally's record is gone though the Player owns neither its token nor its actor, so the GM's client ended it", cards7[0]?.author === playerId && allyOwned === false && cards7[0].open === 0, { author: cards7[0]?.author === playerId });
  await hp(gm, 9);

  section("held 7a. the Player's Restore on its own card puts back what the Player owns; the Judge's finishes it");
  const card7 = cards7[0];
  const idsOf = (list) => list.map((r) => r.id).sort();
  const casterIds = idsOf([...before6.caster, ...before6.held]);
  const seen7 = card7 ? await run(player, P.heldCard, { messageId: card7.id }) : null;
  check("held 7a: the Player's own card draws Restore", !!seen7?.found && seen7.restore, { found: seen7?.found, restore: seen7?.restore });
  // The card is the Player's word, so the GM's client writes only the actors the Player owns: the caster's records, not the ally's.
  const part = card7 ? await run(player, P.pressRestore, { messageId: card7.id, partial: true }) : { button: false };
  const back7 = await standingOf(id6);
  check("held 7a: the caster's records are back under their own ids and the ally's is not", part.button && JSON.stringify(idsOf([...back7.caster, ...back7.held])) === JSON.stringify(casterIds) && casterIds.length === 2 && back7.ally.length === 0, { caster: back7.caster.length, held: back7.held.length, ally: back7.ally.length });
  const partialText = await fmt("ACKS-MAGIC.castHeld.notice.restorePartial", { done: back7.caster.length + back7.held.length, left: before6.ally.length - back7.ally.length });
  check("held 7a: the Player's seat told the partial restore, with the count put back and the count left", part.came === true && part.warns.includes(partialText), { warns: part.warns?.length });
  const open7 = (await run(gm, P.endCards, { since: since7, castId: id6 })).find((c) => c.id === card7?.id);
  const seen7b = card7 ? await run(player, P.heldCard, { messageId: card7.id }) : null;
  check("held 7a: the card is not stamped restored and still draws Restore on the Player's seat", !!open7 && open7.restored === false && part.restored === false && !!seen7b?.found && seen7b.restore, { restored: open7?.restored, restore: seen7b?.restore });
  const finished = card7 ? await run(gm, P.pressRestore, { messageId: card7.id }) : { button: false };
  const back7b = await standingOf(id6);
  check("held 7a: the Judge's Restore put the ally's record back under its id and wrote none of the caster's twice", finished.button && full(back7b) && JSON.stringify(idsOf(back7b.ally)) === JSON.stringify(idsOf(before6.ally)) && JSON.stringify(idsOf([...back7b.caster, ...back7b.held])) === JSON.stringify(casterIds), { caster: back7b.caster.length, held: back7b.held.length, ally: back7b.ally.length });
  check("held 7a: the card reads restored with the Judge's user name", finished.restored === true && finished.byMe === true, { restored: finished.restored, byMe: finished.byMe });
  // The restored cast stands again: the real trigger ends it, so the next step begins from a caster holding nothing.
  const since7b = Date.now();
  await hp(gm, 8);
  const ended7b = await run(gm, P.waitEnd, { castId: id6, since: since7b });
  await endCardsSince(since7b, id6);
  check("held 7a: the restored cast ended again, every record gone", ended7b && empty(await standingOf(id6)), { ended: ended7b });
  await hp(gm, 9);

  section("held 8. a time after concentration: the recipients' records run it out");
  const c8 = await castCircle(CIRCLE_TAIL);
  const id8 = c8.model?.castId;
  check("held 8: the caster's record carries the tail in its flag", full(await standingOf(id8)) && (await standingOf(id8)).held[0].tail?.value === 3 && (await standingOf(id8)).held[0].tail?.units === "minutes");
  const since8 = Date.now();
  await hp(gm, 8);
  const ended8 = await run(gm, P.waitEnd, { castId: id8, since: since8 });
  const now8 = await run(gm, P.time, { now: true });
  const after8 = await standingOf(id8);
  const retimed = [...after8.caster, ...after8.ally];
  check("held 8: the caster's record is gone and each recipient's is re-timed from now to the tail", ended8 && after8.held.length === 0 && retimed.length === 2 && retimed.every((r) => r.startTime === now8 && r.duration?.value === 3 && r.duration?.units === "minutes"), { records: retimed.length });
  const cards8 = only(await endCardsSince(since8, id8), id8);
  check("held 8: the card lists both as running on and none as ended", cards8.length === 1 && cards8[0].retimed.length === 2 && cards8[0].ended.length === 0 && cards8[0].retimed.every((r) => r.duration?.value === 3), { retimed: cards8[0]?.retimed.length });
  await run(gm, P.time, { to: now8 + 3 * 60 + 1 });
  const gone8 = await standingOf(id8);
  check("held 8: past the tail the clock removed both", empty(gone8), { caster: gone8.caster.length, ally: gone8.ally.length });
  await hp(gm, 9);

  section("held 9. a longest hold: the clock ends the cast with the cause time");
  const c9 = await castCircle(CIRCLE_CAP);
  const id9 = c9.model?.castId;
  const s9 = await standingOf(id9);
  check("held 9: the caster's record is flag-timed by the cap", full(s9) && s9.held[0].duration?.value === 4 && s9.held[0].duration?.units === "minutes" && Number.isFinite(s9.held[0].startTime) && s9.held[0].coreDuration == null, { held: s9.held.length });
  const since9 = Date.now();
  if (s9.held[0]) await run(gm, P.time, { to: s9.held[0].startTime + 4 * 60 + 1 });
  const ended9 = await run(gm, P.waitEnd, { castId: id9, since: since9 });
  const cards9 = only(await endCardsSince(since9, id9), id9);
  check("held 9: past the cap everything of the cast is gone, with one card whose cause is time", ended9 && empty(await standingOf(id9)) && cards9.length === 1 && cards9[0].cause === "time", { cards: cards9.length, cause: cards9[0]?.cause });

  section("held 10. a recast: the dialog warns, and confirming ends what is held with the cause cast");
  const c10 = await castCircle(CIRCLE_HELD);
  const id10 = c10.model?.castId;
  await spent();
  const asked = await run(player, P.cast, { casterId, spellId: damageId, stop: true });
  const concentrating = await fmt("ACKS-MAGIC.cast.notice.verdict.concentrating", { name: tCaster.actorName });
  check("held 10: the dialog shows concentrating as a warning and leaves Cast on", asked.dialog && asked.verdicts.includes("warn") && !asked.verdicts.includes("block") && asked.verdictTexts.includes(concentrating) && !asked.castDisabled, asked.verdicts);
  const since10 = Date.now();
  const c10b = await run(player, P.cast, { casterId, spellId: damageId, wait: 40 });
  await trackCard(c10b.messageId);
  const cards10 = only(await endCardsSince(since10, id10), id10);
  check("held 10: the cast went through, the held records ended with one card of the cause cast, and the caster holds nothing", c10b.card && cards10.length === 1 && cards10[0].cause === "cast" && empty(await standingOf(id10)), { cards: cards10.length, cause: cards10[0]?.cause });
  await spent();
}

/**
 * The ownership steps (docs/magic/TESTING.md, "The ownership presses (Undo and Revert)"): Undo and Revert are offered where Foundry's ownership
 * puts them, never where the server role does. Every press is made on the seat the step names, in the chat tab, and waits on the signal the press
 * ends in (`P.pressUntil`), since a press the GM's client carries out is written after the presser's handler returns. The Player owns the caster
 * and neither target-a nor the ally; the Judge's seat casts the foe's copy of the damage spell. A seat with no button cannot press one, so the
 * `undoRefused` and `revert.notOwner` notices are named in the output and not asserted; the relay's answer and the revert's call count stand for them.
 */
async function walkOwnership(K) {
  const { sceneId, casterId, damageId, ids, tCaster, tAlly, targetTokenId, fmt, spent, trackCard } = K;
  const hpOf = async (tokenId) => (await run(gm, P.hp, { sceneId, tokenIds: [tokenId] }))[0];
  const setHp = (tokenId, value) => run(gm, P.setHp, { sceneId, tokenId, value });
  const keyOf = (model) => Object.keys(model?.targets ?? {})[0];
  const rowOf = (model) => model?.order?.[0];
  const entryOf = (model) => model?.entries?.[`${keyOf(model)}_${rowOf(model)}`];
  const undoCount = (seen) => (seen?.actions ?? []).filter((a) => a === "magicCastUndo").length;
  const pressUndo = (c, until) => run(player, P.pressUntil, { messageId: c.messageId, action: "magicCastUndo", target: keyOf(c.model), row: rowOf(c.model), until });
  /** The Player's cast of the damage spell at one token (or none), with the save rigged to fail so the entry applies a figure. */
  const playerCast = async (tokenId) => {
    await spent();
    await run(player, P.target, { sceneId, tokenIds: tokenId ? [tokenId] : [] });
    await run(player, P.rig, { seq: [0.975] });
    const c = await run(player, P.cast, { casterId, spellId: damageId, wait: 80 });
    await run(player, P.rig, {});
    await run(player, P.target, { sceneId, tokenIds: [] });
    await trackCard(c.messageId);
    if (c.model?.castId) castIds.push(c.model.castId);
    return c;
  };
  /** The Judge's cast of the foe's copy of the damage spell at one token. */
  const foeCast = async (tokenId) => {
    await run(gm, P.target, { sceneId, tokenIds: [tokenId] });
    const c = await run(gm, P.cast, { casterId: ids.foe, spellId: ids.foeSpell, wait: 60 });
    await run(gm, P.target, { sceneId, tokenIds: [] });
    await trackCard(c.messageId);
    if (c.model?.castId) castIds.push(c.model.castId);
    return c;
  };
  const stateOf = (c) => run(gm, P.entryOf, { messageId: c.messageId, id: `${keyOf(c.model)}_${rowOf(c.model)}` });

  section("U1. the apply seat undoes a hit point entry on a monster it does not own (Player seat, relayed)");
  const ownsTarget = await run(player, P.ownsToken, { sceneId, tokenId: targetTokenId });
  await setHp(targetTokenId, 20);
  const hpU1 = await hpOf(targetTokenId);
  const u1 = await playerCast(targetTokenId);
  const e1 = entryOf(u1.model);
  check("U1: the Player owns neither target-a's token nor its actor, and its cast applied one entry that moved the hit points", ownsTarget === false && u1.card && u1.settled && e1?.state === "applied" && e1.applied > 0 && (await hpOf(targetTokenId)) === hpU1 - e1.applied, { owns: ownsTarget, state: e1?.state });
  const seenU1 = await run(player, P.seen, { messageId: u1.messageId });
  check("U1: the Player's rendering of the card draws Undo on the entry", seenU1.found && undoCount(seenU1) === 1, { found: seenU1.found, undo: undoCount(seenU1), keys: seenU1.keys });
  const pressU1 = await pressUndo(u1, "off");
  check("U1: the press restored the target's hit points to what they were before the cast, the entry reads undone and no notice was told", pressU1.button && pressU1.came && entryOf(pressU1.model)?.state === "undone" && (await hpOf(targetTokenId)) === hpU1 && pressU1.warns.length === 0, { came: pressU1.came, state: entryOf(pressU1.model)?.state, warns: pressU1.warns?.length });

  section("U2. the relay keeps what the card's figures do not bound (Player seat, the Judge having moved the target)");
  await setHp(targetTokenId, 20);
  const u2 = await playerCast(targetTokenId);
  const e2 = entryOf(u2.model);
  const hpMoved = (await hpOf(targetTokenId)) - 1;
  await setHp(targetTokenId, hpMoved);
  const pressU2 = await pressUndo(u2, "warn");
  const keptText = await fmt("ACKS-MAGIC.cast.notice.undoKept", { name: u2.model?.targets?.[keyOf(u2.model)]?.name ?? "" });
  check("U2: the cast applied an entry and the Player's press was kept: the undoKept notice shows", u2.card && e2?.state === "applied" && e2.applied > 0 && pressU2.button && pressU2.came && pressU2.warns.includes(keptText), { button: pressU2.button, warns: pressU2.warns?.length });
  check("U2: the target's hit points stand where the Judge left them and the entry stays applied", (await hpOf(targetTokenId)) === hpMoved && (await stateOf(u2))?.state === "applied", { hp: await hpOf(targetTokenId), moved: hpMoved });
  await setHp(targetTokenId, 20);

  section("U3. the target's owner undoes an entry on a card the Judge cast (Player seat, relayed)");
  await setHp(tCaster.id, 9);
  const hpU3 = await hpOf(tCaster.id);
  const u3 = await foeCast(tCaster.id);
  const e3 = entryOf(u3.model);
  check("U3: the Judge's cast at the character's token applied an entry that moved its hit points", u3.card && u3.settled && e3?.state === "applied" && e3.applied > 0 && (await hpOf(tCaster.id)) === hpU3 - e3.applied, { state: e3?.state });
  const seenU3 = await run(player, P.seen, { messageId: u3.messageId });
  check("U3: the Player, owning the target and neither the caster nor the card, draws Undo on the entry", seenU3.found && undoCount(seenU3) === 1, { found: seenU3.found, undo: undoCount(seenU3), keys: seenU3.keys });
  const pressU3 = await pressUndo(u3, "off");
  check("U3: the relayed press returned the character's hit points and the entry reads undone", pressU3.button && pressU3.came && entryOf(pressU3.model)?.state === "undone" && (await hpOf(tCaster.id)) === hpU3 && pressU3.warns.length === 0, { came: pressU3.came, state: entryOf(pressU3.model)?.state, warns: pressU3.warns?.length });
  await setHp(tCaster.id, 9);

  section("U4. owning neither draws nothing, and the relay refuses (Player seat)");
  const ownsAlly = await run(player, P.ownsToken, { sceneId, tokenId: tAlly.id });
  await setHp(tAlly.id, 20);
  const u4 = await foeCast(tAlly.id);
  const e4 = entryOf(u4.model);
  const hpU4 = await hpOf(tAlly.id);
  check("U4: the Judge's cast at the ally applied an entry, and the Player owns neither the ally's token nor its actor", ownsAlly === false && u4.card && u4.settled && e4?.state === "applied" && e4.applied > 0 && hpU4 === 20 - e4.applied, { owns: ownsAlly, state: e4?.state });
  const seenU4 = await run(player, P.seen, { messageId: u4.messageId });
  check("U4: the Player's rendering of the card is found and draws no Undo on the entry", seenU4.found === true && undoCount(seenU4) === 0, { found: seenU4.found, undo: undoCount(seenU4) });
  const sent = await run(player, P.relay, { action: "magicCastUndo", payload: { messageId: u4.messageId, targetKey: keyOf(u4.model), rowKey: rowOf(u4.model) } });
  check("U4: a request sent straight to the relay from the Player's seat is answered notOwner", sent.answered && sent.answer?.ok === false && sent.answer?.reason === "notOwner", { answered: sent.answered, timeout: sent.timeout, answer: sent.answer });
  check("U4: it wrote nothing: the entry stays applied and the ally's hit points stand where the cast left them", (await stateOf(u4))?.state === "applied" && (await hpOf(tAlly.id)) === hpU4, { hp: await hpOf(tAlly.id) });
  note("U4 not asserted", "the undoRefused notice: it is told by the card's own Undo press, and the Player's rendering draws no button to press");
  await setHp(tAlly.id, 20);

  const kind = "vancian";
  try {
    await run(player, P.revProc, { kind });
    await run(gm, P.revProc, { kind });

    section("R1. a registered procedure's Revert, for the author who owns the caster (Player seat)");
    const r1 = await playerCast(null);
    check("R1: the Player's cast carries the procedure's undo data, not yet reverted", r1.card && r1.model?.procedure?.undo != null && r1.model.procedure.reverted !== true, { procedure: !!r1.model?.procedure });
    const seenR1 = await run(player, P.seen, { messageId: r1.messageId });
    check("R1: the Player's rendering draws Revert", seenR1.found && seenR1.actions.includes("magicCastRevert"), seenR1.actions);
    const pressR1 = await run(player, P.pressUntil, { messageId: r1.messageId, action: "magicCastRevert", until: "reverted" });
    const calls1 = await run(player, P.revCalls);
    check("R1: the press called the procedure's revert once with the card's undo data and the cast id, its ctx holding no isGM, ownsCaster or ownsCard", pressR1.button && pressR1.came && calls1.length === 1 && JSON.stringify(calls1[0].undo) === JSON.stringify(r1.model.procedure.undo) && calls1[0].castId === r1.model.castId && !calls1[0].keys.some((k) => ["isGM", "ownsCaster", "ownsCard"].includes(k)), { calls: calls1.length, keys: calls1[0]?.keys });
    const afterR1 = await run(player, P.seen, { messageId: r1.messageId });
    check("R1: the card reads reverted and Revert is no longer drawn", pressR1.model?.procedure?.reverted === true && afterR1.found && !afterR1.actions.includes("magicCastRevert"), afterR1.actions);

    section("R2. a Judge-cast card for the Player's character offers the Player no Revert");
    await spent();
    await run(gm, P.target, { sceneId, tokenIds: [] });
    const r2 = await run(gm, P.cast, { casterId, spellId: damageId, wait: 40 });
    await trackCard(r2.messageId);
    if (r2.model?.castId) castIds.push(r2.model.castId);
    const seenR2gm = await run(gm, P.seen, { messageId: r2.messageId });
    const seenR2 = await run(player, P.seen, { messageId: r2.messageId });
    check("R2: the Judge's cast carries the undo data and the Judge's rendering draws Revert", r2.card && r2.model?.procedure?.undo != null && seenR2gm.found && seenR2gm.actions.includes("magicCastRevert"), seenR2gm.actions);
    check("R2: the Player's rendering of the card is found and draws no Revert", seenR2.found === true && !seenR2.actions.includes("magicCastRevert"), { found: seenR2.found, actions: seenR2.actions });
    const callsAfter = { player: await run(player, P.revCalls), gm: await run(gm, P.revCalls) };
    check("R2: no revert was called on either seat beyond R1's one", callsAfter.player.length === 1 && callsAfter.gm.length === 0, { player: callsAfter.player.length, gm: callsAfter.gm.length });
    note("R2 not asserted", "the revert.notOwner notice: it is told by the card's own Revert press, and the Player's rendering draws no button to press");
  } finally {
    await run(player, P.revProcOff);
    await run(gm, P.revProcOff);
    await spent();
  }
}

/**
 * The declaration steps (docs/magic/TESTING.md, "The declaration steps"): a spell declared in a begun fight, lost, resolved and let lapse.
 * The fight is the run's own Combat, begun by writing its round, turn and core's initDone flag, never `startCombat`, and moved by
 * `combat.update` and `nextTurn`; teardown deletes it by id.
 */
async function walkDeclare(K) {
  const { sceneId, casterId, tCaster, tFoe, damageId, fmt, spent, trackCard } = K;
  const hp = (value) => run(gm, P.setHp, { sceneId, tokenId: tCaster.id, value });
  const counters = () => run(gm, P.counters, { casterId, spellId: damageId });
  await hp(9);
  await spent();
  const fight = await run(gm, P.combatNew, { sceneId, tokenIds: [tCaster.id, tFoe.id] });
  runCombatUuid = fight.uuid;
  await track(fight.uuid, "Combat");
  const cbOf = (tokenId) => fight.combatants.find((c) => c.tokenId === tokenId)?.id;
  const [cbCaster, cbFoe] = [cbOf(tCaster.id), cbOf(tFoe.id)];
  const prepared = (value) => run(gm, P.combatInfo, { combatId: fight.id, combatantId: cbCaster, until: value });
  const moveTracked = async (opts) => {
    const at = await run(gm, P.combatMove, { combatId: fight.id, ...opts });
    for (const uuid of at.cards ?? []) await trackCard(uuid.split(".").pop());
    return at;
  };
  const move = (update) => moveTracked({ update });

  section("declare 15. a declaration is made, lost to damage and reported lost at the turn");
  const label = await fmt("ACKS-MAGIC.cast.dialog.declare", {});
  const d15 = await run(player, P.declare, { casterId, spellId: damageId });
  const flag15 = await prepared(true);
  check("declare 15: the Player's button reads Declare, and confirming left a casting status, one pending record and the combatant's flag, spent the slot once and posted no cast card", d15.dialog && d15.label === label && d15.casting && d15.pending === 1 && flag15.prepareSpell === true && d15.cast === 1 && d15.pool === 1 && d15.cards === 0, { casting: d15.casting, pending: d15.pending, cast: d15.cast, pool: d15.pool, cards: d15.cards });
  await hp(8);
  const lost15 = await run(gm, P.pendingOf, { casterId, lost: true });
  const flagOff15 = await prepared(false);
  check("declare 15: the GM hurts the caster: casting is gone, the pending record carries lost with the cause damage and the flag is clear", !lost15.casting && lost15.pending.length === 1 && lost15.pending[0].lost === "damage" && flagOff15.prepareSpell === false, { casting: lost15.casting, lost: lost15.pending[0]?.lost });
  await run(gm, P.combatSet, { combatId: fight.id, initiatives: { [cbFoe]: 15, [cbCaster]: 10 } });
  const moved = await move({ turn: 1 });
  check("declare 15: with the initiatives set the tracker stands on the caster's turn and the lost declaration is still there", moved.current === cbCaster && (await run(gm, P.pendingOf, { casterId })).pending.length === 1, { current: moved.current === cbCaster });
  const before15 = await counters();
  const refused = await run(player, P.cast, { casterId, spellId: damageId, stop: true });
  const lostText = await fmt("ACKS-MAGIC.cast.notice.blocked.declarationLost", {});
  check("declare 15: the Player's dialog shows declarationLost as a block with Cast off, and cancelling spends nothing and posts no card", refused.dialog && refused.verdicts.includes("block") && refused.verdictTexts.includes(lostText) && refused.castDisabled && refused.cancelled && refused.cast === 0 && refused.pool === 0 && refused.cards === 0, refused.verdicts);
  const warned = await run(gm, P.cast, { casterId, spellId: damageId, wait: 40 });
  await trackCard(warned.messageId);
  const after15 = await counters();
  check("declare 15: the GM's dialog warns and its cast spends once", warned.dialog && warned.verdicts.includes("warn") && !warned.verdicts.includes("block") && warned.card && after15.cast - before15.cast === 1 && after15.spent - before15.spent === 1, { cast: after15.cast - before15.cast, spent: after15.spent - before15.spent });
  check("declare 15: the lost declaration ended with that cast", (await run(gm, P.pendingOf, { casterId })).pending.length === 0);
  await spent();
  await hp(9);

  section("declare 16. a declaration is resolved on the caster's turn with no dialog and no second spend");
  await move({ round: 2, turn: 0 });
  const d16 = await run(player, P.declare, { casterId, spellId: damageId });
  check("declare 16: the next round's declaration is made: one pending record, the flag set, the slot spent once", d16.dialog && d16.pending === 1 && (await prepared(true)).prepareSpell === true && d16.cast === 1, { pending: d16.pending, cast: d16.cast });
  await hp(9);
  const turn16 = await move({ turn: 1 });
  const before16 = await counters();
  const r16 = await run(player, P.castResolve, { casterId, spellId: damageId });
  await trackCard(r16.messageId);
  const after16 = await counters();
  check("declare 16: on the caster's turn the cast resolved with no dialog and the card posted", turn16.current === cbCaster && r16.card && r16.dialog === false, { dialog: r16.dialog, card: r16.card });
  check("declare 16: no second spend, the pending record is gone and the flag is clear", after16.cast === before16.cast && after16.spent === before16.spent && (await run(gm, P.pendingOf, { casterId })).pending.length === 0 && (await prepared(false)).prepareSpell === false, { cast: after16.cast - before16.cast, spent: after16.spent - before16.spent });
  await spent();

  section("declare 17. a declaration the caster's turn passes unresolved lapses; the spend stands");
  await move({ round: 3, turn: 0 });
  const before17 = await counters();
  const d17 = await run(player, P.declare, { casterId, spellId: damageId });
  const declared17 = await counters();
  check("declare 17: the declaration is made and spent once", d17.dialog && d17.pending === 1 && declared17.cast - before17.cast === 1, { cast: declared17.cast - before17.cast });
  const turn17 = await move({ turn: 1 });
  check("declare 17: the tracker reaches the caster's turn and the declaration still stands", turn17.current === cbCaster && (await run(gm, P.pendingOf, { casterId })).pending.length === 1);
  await moveTracked({ next: true });
  const lapsed = await run(gm, P.pendingOf, { casterId, until: 0 });
  const stale = await counters();
  check("declare 17: the caster's turn ended with no cast: the pending record is deleted and the flag is clear", lapsed.pending.length === 0 && (await prepared(false)).prepareSpell === false, { pending: lapsed.pending.length });
  check("declare 17: the spend stands", stale.cast === declared17.cast && stale.spent === declared17.spent, { cast: stale.cast - before17.cast });
  await spent();

  section("declare 18. a declaration resolves on its declared targets, and the band's level and pick");
  await move({ round: 4, turn: 0 });
  // Core's `nextRound` (step 17's last move) cleared every initiative, and a caster whose initiative is not rolled is never at its turn.
  await run(gm, P.combatSet, { combatId: fight.id, initiatives: { [cbFoe]: 15, [cbCaster]: 10 } });
  await run(player, P.target, { sceneId, tokenIds: [tFoe.id] });
  const d18 = await run(player, P.declare, { casterId, spellId: damageId });
  check("declare 18: the declaration is made at the Foe", d18.dialog && d18.pending === 1, { pending: d18.pending });
  const stored18 = await run(gm, P.invPending, { casterId });
  check("declare 18: the pending record stores the declared target and no band answer where the tradition has no procedure", stored18 && stored18.targets?.length === 1 && stored18.picked === null, stored18);
  await run(player, P.target, { sceneId, tokenIds: [tCaster.id] });
  await hp(9);
  const turn18 = await move({ turn: 1 });
  const r18 = await run(player, P.castResolve, { casterId, spellId: damageId });
  await trackCard(r18.messageId);
  check("declare 18: on the caster's turn the cast resolved with no dialog and the card posted", turn18.current === cbCaster && r18.card && r18.dialog === false, { dialog: r18.dialog, card: r18.card, button: r18.button, verdicts: r18.verdicts, current: turn18.current === cbCaster });
  await spent();
  // The fight ends here: a caster held by two begun fights answers to the first of them, and the next steps begin their own.
  note("declare fight sweep", await sweepStep([fight.uuid]));
  runCombatUuid = null;
}

/**
 * The Invocation band steps (docs/magic/TESTING.md, "The Invocation band"): the class fixture reads an invented cap ladder and the caster stands at
 * a class level that reads a cap of three; an invented procedure on the tradition's kind asks for the implement-set bucket. Four invented
 * sets are made on the caster, tracked and swept by id; the class row, the ladder and the level are put back.
 */
async function walkInvocation(K) {
  const { casterId, casterUuid, damageId, classUuid, sceneId, tCaster, tFoe, spent, trackCard, fmt } = K;
  const kind = "vancian";
  const prior = await run(gm, P.invWorld, { classUuid, casterId, level: 4 });
  const mine = [];
  const made = async (name, level, damage) => {
    const doc = await gm.create("Item", { name, type: "item", system: { quantity: 1 } }, { parent: casterUuid });
    await track(doc.uuid, "Item");
    mine.push(doc.uuid);
    await run(gm, P.invSet, { uuid: doc.uuid, level, damage });
    return doc.uuid;
  };
  try {
    await run(player, P.invProc, { kind, cite: "QA p. 1" });
    await run(gm, P.invProc, { kind, cite: "QA p. 1" });
    const low = await made("QA Set low", 2, 0);
    const worn = await made("QA Set worn", 4, 3);
    const high = await made("QA Set high", 4, 0);
    const spare = await made("QA Set spare", 3, 0);
    await spent();

    section("band 1. a Player's menu: the cap preselected, levels above it disabled");
    const p1 = await run(player, P.invBand, { casterId, spellId: damageId });
    check("band 1: one select over the ladder's levels, the cap preselected", p1.dialog && p1.stale === 0 && p1.options.length === 5 && p1.options.find((o) => o.selected)?.value === "3", { stale: p1.stale, options: p1.options });
    check("band 1: the levels above the cap are disabled and say so, the cap is shown with its tooltip", p1.options.filter((o) => o.disabled).map((o) => o.value).join() === "4,5" && /3/.test(p1.cap ?? "") && /QA cap ladder/.test(p1.capTip ?? ""), { cap: p1.cap, tip: p1.capTip });
    check("band 1: the band is headed by the tradition", p1.heading === "Arcane", p1.heading);
    const refused = await run(player, P.invBand, { casterId, spellId: damageId, level: 5 });
    // Refused means the select is there and the option is disabled; a dialog with no select refuses nothing.
    check("band 1: a Player cannot choose a level above the cap", refused.refused === true && refused.hasSelect === true && refused.hasOption === true, { select: refused.hasSelect, option: refused.hasOption });

    section("band 2. a Judge's menu: a level above the cap is chosen in the warn tone and warns in the footer");
    const j2 = await run(gm, P.invBand, { casterId, spellId: damageId, level: 5 });
    check("band 2: the Judge's levels above the cap are enabled and the select takes the warn tone", j2.options.every((o) => !o.disabled) && /is-warn/.test(j2.selectTone), { tone: j2.selectTone });
    check("band 2: the footer warns of the level over the cap and Cast stays enabled", j2.verdicts.some((v) => v.tone === "warn") && !j2.castDisabled, j2.verdicts);

    section("band 3. the implements bucket: carried sets, the pick, a set too low, a drop and X");
    const b3 = await run(player, P.invBand, { casterId, spellId: damageId });
    const names = b3.rows.map((r) => r.name);
    check("band 3: the bucket opens holding the carried sets with their own pictures' rows", ["QA Set low", "QA Set worn", "QA Set high", "QA Set spare"].every((n) => names.some((x) => x.startsWith(n))), names);
    check("band 3: at the cap the pick is the lowest set that reaches it, tagged Used", b3.rows.filter((r) => r.used).map((r) => r.name).join() === "QA Set spare", b3.rows.map((r) => [r.name, r.used]));
    const lowRow = b3.rows.find((r) => r.name.startsWith("QA Set low"));
    check("band 3: a set too low is disabled and its reason is shown", lowRow?.disabled === true && lowRow.reason.length > 0, lowRow);
    check("band 3: the caption reads level and effective, and a worn set shows hollow diamonds", /\d/.test(lowRow?.caption ?? "") && b3.rows.find((r) => r.name.startsWith("QA Set worn"))?.hollow === 3, b3.rows.map((r) => [r.name, r.caption, r.hollow]));
    const picked = await run(player, P.invBand, { casterId, spellId: damageId, pick: "QA Set high" });
    check("band 3: a radio picks the set used", picked.rows.filter((r) => r.used).map((r) => r.name).join() === "QA Set high");
    const removed = await run(player, P.invBand, { casterId, spellId: damageId, remove: "QA Set spare" });
    check("band 3: X removes a set and the pick opens on the lowest that still reaches", !removed.rows.some((r) => r.name.startsWith("QA Set spare")) && removed.rows.filter((r) => r.used).map((r) => r.name).join() === "QA Set high");
    const extra = await gm.create("Item", { name: "QA Set dropped", type: "item", system: { quantity: 1 } }, { parent: casterUuid });
    await track(extra.uuid, "Item");
    mine.push(extra.uuid);
    await run(gm, P.invSet, { uuid: extra.uuid, level: 3, damage: 0 });
    const dropped = await run(player, P.invBand, { casterId, spellId: damageId, remove: "QA Set spare", drop: extra.uuid });
    check("band 3: a set dragged from the inventory becomes a row", dropped.rows.some((r) => r.name.startsWith("QA Set dropped")), { rows: dropped.rows.map((r) => r.name), rowsBeforeDrop: dropped.rowsBeforeDrop });

    section("band 4. no set reaches the level: a Player is blocked, a Judge is warned");
    await run(gm, P.invSet, { uuid: high, level: 2, damage: 0 });
    await run(gm, P.invSet, { uuid: worn, level: 2, damage: 0 });
    await run(gm, P.invSet, { uuid: spare, level: 2, damage: 0 });
    await run(gm, P.invSet, { uuid: extra.uuid, level: 2, damage: 0 });
    const b4 = await run(player, P.invBand, { casterId, spellId: damageId });
    check("band 4: the Player's footer carries the finding as a block and Cast is off", b4.verdicts.some((v) => v.tone === "block") && b4.castDisabled && b4.stale === 0, { verdicts: b4.verdicts, disabled: b4.castDisabled, stale: b4.stale });
    const j4 = await run(gm, P.invBand, { casterId, spellId: damageId });
    check("band 4: the Judge's footer warns and Cast is on", j4.verdicts.some((v) => v.tone === "warn") && !j4.castDisabled, j4.verdicts);
    await run(gm, P.invSet, { uuid: high, level: 4, damage: 0 });

    section("band 5. the level reaches the card");
    const c5 = await run(gm, P.invBand, { casterId, spellId: damageId, level: 3, cast: true });
    await trackCard(c5.messageId);
    check("band 5: the card carries the chosen level and its source", c5.card && c5.model?.invocationLevel === 3 && c5.model?.invocation?.source === "chosen", { level: c5.model?.invocationLevel });

    section("band 6. a declared cast keeps the level and the pick and resolves with no dialog");
    const fight = await run(gm, P.combatNew, { sceneId, tokenIds: [tCaster.id, tFoe.id] });
    runCombatUuid = fight.uuid;
    await track(fight.uuid, "Combat");
    const cb = fight.combatants.find((c) => c.tokenId === tCaster.id)?.id;
    const at = (opts) => run(gm, P.combatMove, { combatId: fight.id, ...opts });
    await at({ update: { round: 2, turn: 0 } });
    // The caster is at its turn only with its initiative rolled, so the fight's initiatives are set.
    await run(gm, P.combatSet, { combatId: fight.id, initiatives: { [fight.combatants.find((c) => c.tokenId === tFoe.id)?.id]: 15, [cb]: 10 } });
    const d6 =await run(player, P.invBand, { casterId, spellId: damageId, pick: "QA Set high", cast: true });
    check("band 6: the Player's button declares", d6.dialog && d6.stale === 0 && /declare/i.test(d6.button ?? ""), { button: d6.button, stale: d6.stale, verdicts: d6.verdicts });
    const stored = await run(gm, P.invPending, { casterId });
    check("band 6: the declaration stores the level and the pick", stored?.invocationLevel === 3 && stored.picked?.implements === high, stored);
    const turn = await at({ update: { turn: 1 } });
    const r6 = await run(player, P.castResolve, { casterId, spellId: damageId });
    await trackCard(r6.messageId);
    check("band 6: at the turn the cast resolved with no dialog and the card carries the declared level", turn.current === cb && r6.card && r6.dialog === false, { dialog: r6.dialog });
    await spent();
  } finally {
    await run(player, P.invProcOff);
    await run(gm, P.invProcOff);
    await run(gm, P.invWorld, { classUuid, casterId, off: true, was: prior });
    note("band sweep", await sweepStep(mine));
  }
}

/**
 * The lost-item steps (docs/magic/TESTING.md, "The lost-item steps"): pending
 * records written by hand on the caster and on an actor the Player does not own
 * name items in a `kit` bucket, and each item is left by the seat's own hand.
 * Every item and the second actor come from `gm.create` and are tracked for the
 * run's sweep; the records are tracked too.
 */
async function walkLostItem(K) {
  const { casterId, casterUuid, damageId } = K;
  section("lost 1. an item that leaves its holder leaves the declared answers that name it");
  // What this step builds, swept at its end so no later step reads a pending record or an item of it on the kept caster.
  const mine = [];
  const made = async (kind, data, parent) => {
    const doc = await gm.create(kind, data, parent ? { parent } : {});
    await track(doc.uuid, kind);
    mine.push(doc.uuid);
    return doc.uuid;
  };
  const item = (name) => made("Item", { name, type: "item", system: { quantity: 2 } }, casterUuid);
  const [a, b, c, d, z] = [await item("QA Lost a"), await item("QA Lost b"), await item("QA Lost c"), await item("QA Lost d"), await item("QA Lost z")];
  const stranger = await made("Actor", { name: "QA Lost Holder", type: "monster", ownership: { default: 0 } });
  const strangerId = String(stranger).split(".").pop();
  const record = async (actorId, tag, uuids) => {
    const uuid = await run(gm, P.lostRecord, { actorId, tag, uuids });
    await track(uuid, "ActiveEffect");
    mine.push(uuid);
    return uuid;
  };
  const kitOf = async (seat, effectUuid, gone) => (await run(seat, P.lostKit, { effectUuid, gone })).kit;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  const r1 = await record(casterId, "gm", [a, b, d]);
  check("lost 1: the record names the three items before anything leaves", same(await kitOf(gm, r1), [a, b, d]));
  await run(gm, P.lostLeave, { uuid: a });
  check("lost 1: the GM deletes an item: it leaves the answer that named it and the others stay", same(await kitOf(gm, r1, a), [b, d]));
  await run(gm, P.lostLeave, { uuid: z });
  check("lost 1: an item no answer names, deleted, changes no answer", same(await kitOf(gm, r1), [b, d]));
  await run(gm, P.lostLeave, { uuid: d, empty: true });
  check("lost 1: an item whose stack is emptied leaves the answer, and the item itself stays", same(await kitOf(gm, r1, d), [b]) && (await run(gm, P.lostHeld, { uuids: [d] })).every(Boolean));
  await run(gm, P.lostLeave, { uuid: b });
  const emptied = await kitOf(gm, r1, b);
  check("lost 1: the last entry leaves and the bucket stays a list", Array.isArray(emptied) && emptied.length === 0, emptied);

  const rOwn = await record(casterId, "own", [c]);
  const rOther = await record(strangerId, "other", [c]);
  check("lost 1: the Player's seat can write the first record and not the second", same(await run(player, P.lostCanWrite, { uuids: [rOwn, rOther] }), [true, false]));
  await run(player, P.lostLeave, { uuid: c });
  check("lost 1: the Player deletes an item: it leaves the record the Player writes, and the one only the GM's client writes", same(await kitOf(gm, rOwn, c), []) && same(await kitOf(gm, rOther, c), []));

  section("lost 2. the band's heading names the tradition");
  const kind = "vancian";
  const supplied = await run(player, P.bandHeading, { casterId, spellId: damageId, kind, label: "ACKS-MAGIC.cast.dialog.targets" });
  check("lost 2: a procedure that supplies a label heads its band with it", supplied.dialog && Boolean(supplied.supplied) && supplied.heading === supplied.supplied && supplied.heading !== supplied.generic, supplied.heading);
  const fallback = await run(player, P.bandHeading, { casterId, spellId: damageId, kind });
  // "Arcane" is the label the class fixture gives its tradition (the fixtures section).
  check("lost 2: with none supplied the band is headed by the tradition's own label, not Invocation", fallback.dialog && fallback.heading === "Arcane" && fallback.heading !== fallback.generic, fallback.heading);
  note("lost-item sweep", await sweepStep(mine));
}

/**
 * The ritual steps: a ritual spell (`ritual === true`) is claimed by the cast seam, and its dialog offers the locations the caster is linked to
 * (the roster rows `locationsOf` reads) instead of the ordinary bands. Pressing "Open ritual project" opens a `ritual` project on the chosen
 * location through the research API and puts that location's sheet on its Research tab; a caster linked to no location is blocked with the reason
 * shown. The GM seat drives it. Fixtures, kept and found by marker: `magic/cast-ritual-place` (a location whose roster the step sets to the linked
 * caster alone), `magic/cast-ritual-caster` (on that roster) and `magic/cast-ritual-loner` (on no roster), each with one invented level-3 ritual
 * spell (`magic/cast-ritual-spell`, `magic/cast-ritual-spell-loner`). The project the press makes is closed through the research API (it stays on
 * the record); nothing is deleted, so the run adds nothing to the sweep.
 */
async function walkRitual() {
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const base = { prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0 } };
  const place = await gm.fixture("magic/cast-ritual-place", "Actor", { name: "QA Ritual Place", type: "acks-extras.location", ownership: { default: 2 } });
  const caster = await gm.fixture("magic/cast-ritual-caster", "Actor", { name: "QA Ritual Caster", type: "character", ...base });
  const loner = await gm.fixture("magic/cast-ritual-loner", "Actor", { name: "QA Ritual Loner", type: "character", ...base });
  const spellData = (name) => ({ name, type: "spell", system: { lvl: 3 }, flags: { "acks-extras": { spell: { ritual: true } } } });
  const spell = await gm.fixture("magic/cast-ritual-spell", "Item", spellData("QA Ritual Spell"), { parent: caster.uuid });
  const lonerSpell = await gm.fixture("magic/cast-ritual-spell-loner", "Item", spellData("QA Ritual Spell Alone"), { parent: loner.uuid });
  const made = [];
  try {
    section("ritual 0. the kept fixtures are brought to a known shape");
    const shape = await run(gm, P.ritualShape, { placeUuid: place.uuid, casterUuid: caster.uuid, loneUuid: loner.uuid });
    check("ritual 0: the place's roster holds the caster alone, the caster is linked to the place and the loner to no location", shape.roster.length === 1 && shape.roster[0] === caster.uuid && shape.casterLinks.includes(place.uuid) && shape.loneLinks.length === 0, shape);

    section("ritual 1. a ritual spell's dialog: the Ritual band, the linked location, none of the ordinary bands, an enabled Open ritual project");
    const d = await run(gm, P.ritualCast, { casterId: idOf(caster), spellId: idOf(spell), placeUuid: place.uuid, press: false });
    check("ritual 1: the cast opens a dialog (a ritual is claimed by the cast seam)", d.dialog === true, d);
    check("ritual 1: the dialog shows the Ritual band, headed by its legend, with a Location select and no reason", d.ritualBand && d.legend === d.expected?.legend && d.options?.length > 0 && d.reason === "", { legend: d.legend, options: d.options?.length, reason: d.reason });
    check("ritual 1: the select lists the caster's linked location and nothing else, and it is the one standing", d.options?.length === 1 && d.options[0].value === place.uuid && d.options[0].name.length > 0 && d.options[0].selected === true, d.options);
    check("ritual 1: the ordinary bands are hidden (the Ritual band is the only band; no mode, level, picks, targets or visibility control)", d.bands === 1 && d.ordinary?.length === 0, { bands: d.bands, ordinary: d.ordinary });
    check("ritual 1: the footer's primary button reads Open ritual project and is enabled", d.button?.text === d.expected?.open && d.button.primary && d.button.disabled === false, d.button);
    check("ritual 1: cancelling creates no project, spends nothing and posts no cast card", d.cancelled === true && d.gained === 0 && d.spendSame === true && d.cards === 0, { cancelled: d.cancelled, gained: d.gained, spendSame: d.spendSame, cards: d.cards });

    section("ritual 2. pressing it opens one ritual project on the location, spends nothing and shows the Research tab");
    const p = await run(gm, P.ritualCast, { casterId: idOf(caster), spellId: idOf(spell), placeUuid: place.uuid, press: true });
    if (p.project?.id) made.push(p.project.id);
    check("ritual 2: exactly one project was added to the location", p.gained === 1, { gained: p.gained });
    check("ritual 2: it is a ritual project, open, with the spell as its subject and the caster as its researcher", p.project?.kind === "ritual" && p.project.status === "open" && p.project.subject === spell.uuid && p.project.researcher === caster.uuid, p.project);
    check("ritual 2: the dialog closed, nothing was spent (no slot, pool or counter changed) and no cast card was posted", p.closed === true && p.spendSame === true && p.cards === 0, { closed: p.closed, spendSame: p.spendSame, cards: p.cards });
    check("ritual 2: the location's sheet rendered on its Research tab, holding the new project's card", p.sheet?.up === true && p.sheet.card === true, p.sheet);

    section("ritual 3. a caster linked to no location: the button is disabled and the band says why");
    const n = await run(gm, P.ritualCast, { casterId: idOf(loner), spellId: idOf(lonerSpell), placeUuid: place.uuid, press: false });
    check("ritual 3: the dialog shows the Ritual band with no Location select", n.dialog === true && n.ritualBand && n.options?.length === 0, { band: n.ritualBand, options: n.options?.length });
    check("ritual 3: the band shows the reason as text, naming the caster", n.reason?.length > 0 && n.reason === n.expected?.none, n.reason);
    check("ritual 3: the primary button is disabled and the ordinary bands are hidden", n.button?.disabled === true && n.bands === 1 && n.ordinary?.length === 0, { button: n.button, bands: n.bands, ordinary: n.ordinary });
    check("ritual 3: cancelling creates no project, spends nothing and posts no cast card", n.cancelled === true && n.gained === 0 && n.spendSame === true && n.cards === 0, { cancelled: n.cancelled, gained: n.gained, spendSame: n.spendSame, cards: n.cards });
  } finally {
    // Closed through the research API: a project lives on the location's flags and stays there as a closed record.
    try { note("ritual projects closed", await run(gm, P.ritualClose, { placeUuid: place.uuid, ids: made })); } catch (err) { console.error("ritual close:", err?.message ?? err); }
  }
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

  section("1b. the targets bucket and the effect rows (GM seat)");
  {
    const shots = process.env.ACKS_WALK_SHOTS === "0" ? null : logDir();
    const shoot = async (slug) => {
      if (!shots) return;
      try { note(`shot ${slug}`, await gm.shot(`${shots}/magic-cast-bucket-${slug}.png`, ".application.acks-extras-cast")); } catch (err) { note(`shot ${slug} FAILED`, err?.message ?? String(err)); }
    };
    const casterTokens = await run(gm, P.tokens, { sceneId, actorIds: [casterId] });
    for (const tk of casterTokens) await track(tk.uuid, "Token");
    const sceneTokenUuid = (id) => made.find((m) => m.id === id)?.uuid ?? "";
    const missingFrom = (seen) => tokenIds.find((id) => !seen.includes(id));
    const stepOf = (op, extra = {}) => run(gm, P.bucketStep, { op, casterId, spellId: spellId.damage, ...extra });
    await run(gm, P.target, { sceneId, tokenIds });
    const opened = await stepOf("open");
    check("1b: the bucket lists the three targeted tokens, each with an X, the count, the drop strip and Add my token", opened.dialog && opened.bucket.rows.length === 3 && opened.bucket.rows.every((r) => r.x) && opened.bucket.count !== "" && opened.bucket.drop && opened.bucket.addMine, opened.bucket);
    // A damage spell has no row a seat picks among, so it renders no effect
    // cell; the tone cells are checked on the kind pick (magic-cast-buffs D).
    check("1b: the footer sits outside the scrolling body", opened.bucket.footerPinned, { tones: opened.bucket.tones });
    check("1b: each row's distance carries a tooltip", opened.bucket.rows.every((r) => r.lineTip));
    await shoot("1-three");
    const afterX = await stepOf("x");
    check("1b: X untargets that token only: the bucket and the seat's targets both lose one", afterX.bucket.rows.length === 2 && afterX.targets.length === 2, { rows: afterX.bucket.rows.length, targets: afterX.targets.length });
    await shoot("2-after-x");
    const gone = missingFrom(afterX.targets);
    const afterT = await stepOf("t", { tokenId: gone });
    check("1b: T on the canvas token puts it back in the open window", afterT.bucket.rows.length === 3 && afterT.targets.length === 3, { rows: afterT.bucket.rows.length, targets: afterT.targets.length });
    await stepOf("x");
    const left1 = await stepOf("x");
    const away1 = missingFrom(left1.targets);
    const dropOne = await stepOf("drop", { dropType: "Actor", dropUuid: "Actor." + made.find((m) => m.id === away1).actorId });
    check("1b: an Actor dropped on the bucket targets its one token on the scene", left1.bucket.rows.length === 1 && dropOne.bucket.rows.length === 2 && dropOne.warns.length === 0, { rows: dropOne.bucket.rows.length, warns: dropOne.warns.length });
    const dropToken = await stepOf("drop", { dropType: "Token", dropUuid: sceneTokenUuid(missingFrom(dropOne.targets)) });
    check("1b: a Token dropped on the bucket targets that token", dropToken.bucket.rows.length === 3, { rows: dropToken.bucket.rows.length });
    await shoot("3-after-drops");
    const addMine = await stepOf("add");
    check("1b: Add my token targets the caster's own token", addMine.bucket.rows.length === 4, { rows: addMine.bucket.rows.length });
    const closed = await stepOf("close");
    check("1b: Cancel closes the window and spends nothing; the seat keeps its targets", closed.dialog === false);
    await run(gm, P.target, { sceneId, tokenIds });
    // The caster token only served this section; later sections cast with none on the field, as they were written.
    for (const tk of casterTokens) await gm.eval(`(async () => { await (await fromUuid(${JSON.stringify(tk.uuid)}))?.delete(); return true; })()`);
  }

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
  // A thrown entry keeps each throw on `instances[]`, its roll and hit there; one throw is one instance.
  const hits3 = (thrown[0]?.instances ?? []).filter((i) => i.throw?.hit === true);
  const rolled3 = hits3.reduce((sum, i) => sum + (i.rolled ?? 0), 0);
  check("3: the throw's entry applied the amount the system's damage roll made, through the amount path", thrown.length === 1 && thrown[0].state === "applied" && hits3.length === 1 && thrown[0].applied === rolled3, thrown.map((e) => ({ state: e.state, applied: e.applied, instances: (e.instances ?? []).map((i) => i.state) })));
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
    await walkBuffs({ sceneId, caster, casterId, idOf, playerId, damagePayload: lib.payload.damage, damageId: spellId.damage, classUuid: cls.uuid, targetTokenId: tokenIds[0] });
  } catch (err) {
    console.error("WALK ERROR (buff steps):", err?.stack ?? err);
    checks.push(["the buff steps ran to the end", false]);
  }

  // The ritual steps run apart, so a throw in one still reaches the console check below.
  try {
    await walkRitual();
  } catch (err) {
    console.error("WALK ERROR (ritual steps):", err?.stack ?? err);
    checks.push(["the ritual steps ran to the end", false]);
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
      // A held record deleted ends its cast through the funnel, which posts a card and writes the recipients: the held records of this run's casts
      // go first, and the funnel's cards are given time to land before they are listed.
      await gm.eval(`(async () => { const c = game.actors.find((a) => a.flags?.world?.fixture === "magic/cast-caster"); const ids = ${JSON.stringify(castIds)}; const held = c ? [...c.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.held && ids.includes(e.flags["acks-extras"].spellEffect.castId)).map((e) => e.id) : []; if (held.length) await c.deleteEmbeddedDocuments("ActiveEffect", held); await new Promise((r) => setTimeout(r, 2500)); return held.length; })()`);
      const endCards = JSON.parse(await gm.eval(`JSON.stringify([...game.messages].filter((m) => m.timestamp >= ${startedAt} && m.flags?.["acks-extras"]?.castHeldEnd && ${JSON.stringify(castIds)}.includes(m.flags["acks-extras"].castHeldEnd.castId)).map((m) => m.uuid))`));
      for (const uuid of endCards) await track(uuid, "ChatMessage");
      // The buff steps' records are listed by the cast ids they made, on the fixtures that carry a marker of this walk's.
      const ledger = await gm.eval(`(async () => JSON.stringify({ cards: [...game.messages].filter((m) => m.timestamp >= ${startedAt} && game.actors.some((a) => a.flags?.world?.fixture?.startsWith?.("magic/cast-") && a.id === m.speaker?.actor)).map((m) => m.uuid), records: [...game.actors.filter((a) => a.flags?.world?.fixture === "magic/cast-caster").flatMap((a) => [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect && e.flags["acks-extras"].spellEffect.casterUuid === a.uuid).map((e) => e.uuid)), ...game.actors.filter((a) => a.flags?.world?.fixture?.startsWith?.("magic/cast-")).flatMap((a) => [...a.effects].filter((e) => ${JSON.stringify(castIds)}.includes(e.flags?.["acks-extras"]?.spellEffect?.castId)).map((e) => e.uuid))] }))()`);
      const { cards, records } = JSON.parse(ledger);
      for (const uuid of cards) await track(uuid, "ChatMessage");
      for (const uuid of records) await track(uuid, "ActiveEffect");
    }
  } catch (err) { console.error("ledger:", err?.message ?? err); }
  try { if (gm && runCombatUuid) { await track(runCombatUuid, "Combat"); } } catch (err) { console.error("combat:", err?.message ?? err); }
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: magic/cast-scene, magic/cast-class, magic/cast-caster, magic/cast-spell-damage, magic/cast-spell-cure, magic/cast-spell-fright, magic/cast-target-a, magic/cast-target-b, magic/cast-target-c, magic/cast-monster, magic/cast-monster-weapon, magic/cast-spell-circle, magic/cast-spell-edge, magic/cast-ally, magic/cast-ally-blade, magic/cast-ally-fine, magic/cast-foe, magic/cast-foe-claw, magic/cast-foe-spell, magic/cast-stranger, magic/cast-stranger-claw, magic/cast-ritual-place, magic/cast-ritual-caster, magic/cast-ritual-loner, magic/cast-ritual-spell, magic/cast-ritual-spell-loner");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
