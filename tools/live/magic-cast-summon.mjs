/**
 * Live walk, magic-cast-summon: casting a summoning spell places its creatures
 * (the spell cast, `scripts/magic/cast-spell.mjs`, with the rows' reading in
 * `cast-summon.mjs`). Walks docs/magic/TESTING.md "Casting a summoning spell"
 * on the GM and Player seats:
 * a boot recorder attached before the reload that sees `init`, `setup` and
 * `ready`; the Player's Magic tab Cast button opening the cast dialog and its
 * Summon band for a spell whose row names a creature the Player observes; the
 * cast count standing while the dialog and the placement are pending; two real
 * clicks placing two tokens that carry the spell's id and name and one cast id,
 * with the count up by exactly one, one card, and a caster record carrying that
 * cast id and the spell's imported duration; a right click at the clicks and a
 * cancelled dialog each leaving the count where it was; a spell-less Summon…
 * refused to the Player and still working from the GM seat; a forged request (a
 * creature the spell does not name, with and without the shelf open) refused by
 * the GM's client with nothing made. Then the band's ceiling at two caster
 * levels, blocked for a Player and warned for a Judge; a Player with no GM
 * refused before the spend (the seat reads no active GM, which is synthetic); a
 * placement range refused to a Player and warned to a Judge, with a calling
 * exempt; a declared summons placed at its turn; a held end that lists the
 * creatures, Dismiss on the Judge's seat only, and `controlEnd` `stays` and
 * `hostile` applied; the delete path (a `gone` summons removed at its timed end
 * while a hand-placed decoy of the same creature and every other token stand).
 * Then a spell whose row names a creature the Player cannot observe: the row
 * saves from the Player's own seat (by uuid, then by name), a forged request and
 * the seat's own placement are refused `unreadable` for each, the real Cast press
 * is refused with the cast count, the field, the creature's world copies and
 * the cards unchanged, and once the Judge's seat grants Observer the same press
 * places the creature; the grant is taken off again and the Player's level on
 * an imported Monster Manual creature's pack is read. Last, a claimant's `spend` called after its cast has returned (read, and left
 * bare), which libWrapper's invalidated chain would throw on and the seam
 * answers false and logs once. Prints booleans and counts, never a name or an
 * id. The selectors and clicks of the dialog steps are derived from the
 * dialog's templates and the placement's code and have not been run.
 * Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `magic/summon-caster` (a character the Player owns, spells enabled),
 * `magic/summon-spell-gone` (a second spell whose row says `gone`, for the delete path alone: the clock ends every earlier cast of the caster too, and those must keep their creatures),
 * `magic/summon-spell` (its summoning spell, one summon row naming
 * `magic/summon-creature` by uuid), `magic/summon-creature` (a monster the
 * Player holds Observer on: a cast summons what the casting seat may observe,
 * so the shape step writes that level from the GM seat), `magic/summon-other`
 * (a monster at default None with no entry for the Player, brought to that shape
 * each run; the first spell does not name it, `magic/summon-spell-closed` does),
 * `magic/summon-spell-closed` (a spell on the same caster whose one summon row
 * names `magic/summon-other`), `magic/summon-open` (a monster
 * the Player may observe, which the spell does not name) and `magic/summon-scene`
 * (the field, which both seats view). The run's own documents (summoned tokens,
 * the creature's world copy where none stood, the cast cards and the caster
 * records) are tracked by uuid and swept alone. A paused world is unpaused for
 * the run and paused again in the finally. The last section clears the spell's
 * summon rows; every run's shape step writes them back.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const KEY = "magic-cast-summon-walk";

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

/** Where each placement is clicked, in scene pixels from the scene's corner (the field is 1400 by 900). */
const CELLS = { cast: [[450, 350], [650, 350]], cancel: [650, 550], bare: [700, 450] };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mc = globalThis.__mc ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.cards = (actorId) => [...game.messages].filter((m) => m.speaker?.actor === actorId || String(m.flags?.["acks-extras"]?.castCard?.spellUuid ?? "").startsWith(`Actor.${actorId}.`)).map((m) => m.id);
    H.seen = new Set();
    H.live = () => document.querySelector(".application.acks-extras-cast");
    /** The Summon band as the open dialog shows it: the creature choices, the count and its ceiling, the placement line, the footer's verdicts and the Cast button. */
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
        labelled: options.every((o) => o.textContent.trim().length > 0),
        count: el.querySelector('input[name="summonCount"]')?.value ?? null,
        of: el.querySelector(".acks-extras-cast-invlevel .acks-extras-cast-cap")?.textContent.trim() ?? "",
        ofWarns: !!el.querySelector(".acks-extras-cast-invlevel .acks-extras-cast-cap.is-warn"),
        placement: el.querySelector(".acks-extras-cast-split .acks-extras-cast-cap")?.textContent.trim() ?? "",
        verdicts: [...el.querySelectorAll(".acks-extras-cast-verdicts li")].map((li) => ({ severity: li.dataset.severity, text: li.textContent.trim() })),
        castDisabled: !!cast?.disabled,
        castLabel: cast?.textContent.trim() ?? "",
      };
    };
    /** Type a caster level and a count into the open dialog, as a user does (each change re-renders the window), then read the band again. */
    H.setBand = async ({ count, level }) => {
      for (const [name, value] of [["casterLevel", level], ["summonCount", count]]) {
        if (value === undefined || value === null) continue;
        const input = H.live()?.querySelector(`input[name="${name}"]`);
        if (!input) return { ...H.band(), missing: name };
        input.value = String(value);
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
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, claimant: typeof globalThis.acksExtras?.lib?.spellUse?.addClaimant === "function", castApi: typeof globalThis.acksExtras?.magic?.castSummon === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** The id of the user this seat is, as the page itself holds it. */
  selfId: async () => game.user.id,
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  /** What the recorder saw from `init` on. */
  boot: async () => {
    const b = window.__boot ?? null;
    return {
      recorded: !!b,
      preFoundry: !!b?.preFoundry,
      noRegisterError: b ? !b.error.some((e) => /summoning cast could not register|spell-use|summon policy/u.test(e)) : null,
      noWrapWarning: b ? !b.warn.some((w) => /no Item#_useSpell to wrap/u.test(w)) : null,
      errors: b?.error.length ?? null,
    };
  },
  drain: async () => {
    const H = globalThis.__mc;
    const out = { errors: H.errors.slice(), warns: H.warns.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  /** View the field (no activation), the Tokens layer up, the scene's middle at the viewport's. */
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
  /** The caster's known shape: spells enabled, the count at 0, the spell's row naming the creature, no summons on the scene. */
  shape: async ({ casterId, spellId, ref, amount, sceneId }) => {
    const actor = game.actors.get(casterId);
    if (!actor.system.spells?.enabled) await actor.update({ "system.spells.enabled": true });
    const item = actor.items.get(spellId);
    await item.update({
      "system.cast": 0,
      "flags.acks-extras.spell": { schools: ["summoning"], effects: [{ type: "summon", ref, amount }], duration: { shape: "fixed", value: 2, unit: "hours" } },
    });
    const standing = [...game.scenes.get(sceneId).tokens].filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === actor.uuid).length;
    return { cast: item.system.cast, isSpell: item.type === "spell", enabled: !!actor.system.spells?.enabled, rows: item.getFlag("acks-extras", "spell")?.effects?.length ?? 0, standing };
  },
  /** On the seat that must not open the creature: whether it can resolve each ref, and whether it may observe the document. */
  probe: async ({ refs }) => {
    const out = [];
    for (const ref of refs) {
      let doc = null;
      try { doc = await fromUuid(ref); } catch { doc = null; }
      out.push({ resolves: !!doc, observes: !!doc?.testUserPermission(game.user, "OBSERVER") });
    }
    return out;
  },
  /** A world document's stored ownership as this seat reads it: the user's own entry (null where there is none), the default, and the name. */
  levelOf: async ({ uuid, userId }) => {
    const doc = await fromUuid(uuid);
    const source = doc?._source?.ownership ?? {};
    return { resolves: !!doc, name: doc?.name ?? "", stored: source[userId] ?? null, keyed: Object.hasOwn(source, userId), def: source.default ?? null };
  },
  /** On the Judge's seat: write a user's level on a world document, or take the entry off (`level` null), and read what the document stores. */
  setLevel: async ({ uuid, userId, level }) => {
    const doc = await fromUuid(uuid);
    await doc.update(level === null ? { [`ownership.-=${userId}`]: null } : { [`ownership.${userId}`]: level });
    const source = doc._source.ownership ?? {};
    return { stored: source[userId] ?? null, keyed: Object.hasOwn(source, userId), def: source.default ?? null };
  },
  /** On the Player's seat: the spell's one summon row written as the owner of the caster writes it, one document update, then read back. */
  saveRow: async ({ casterId, spellId, ref }) => {
    const item = game.actors.get(casterId).items.get(spellId);
    await item.update({ "flags.acks-extras.spell": { schools: ["summoning"], effects: [{ type: "summon", ref, amount: 1 }], duration: { shape: "fixed", value: 2, unit: "hours" } } });
    const rows = item.getFlag("acks-extras", "spell")?.effects ?? [];
    return { rows: rows.length, ref: rows[0]?.ref ?? null };
  },
  /** The row a spell holds as this seat reads it. */
  rowOf: async ({ casterId, spellId }) => {
    const rows = game.actors.get(casterId).items.get(spellId)?.getFlag("acks-extras", "spell")?.effects ?? [];
    return { rows: rows.length, ref: rows[0]?.ref ?? null };
  },
  /** What this seat's user holds on a creature's compendium: the shelf's visibility, the numeric level and the Observer test, beside the document's own. */
  shelfLevel: async ({ uuid }) => {
    // The pack is found from the uuid's collection, so its level prints even where the document itself will not open.
    const pack = foundry.utils.parseUuid(uuid)?.collection ?? null;
    let doc = null;
    try { doc = await fromUuid(uuid); } catch { doc = null; }
    const inPack = typeof pack?.getUserLevel === "function";
    return {
      resolves: !!doc,
      inPack,
      visible: inPack ? !!pack.visible : null,
      level: inPack ? pack.getUserLevel(game.user) : null,
      observer: inPack ? !!pack.testUserPermission?.(game.user, "OBSERVER") : null,
    };
  },
  /** On the Judge's seat: whether a creature carries the importer's mark, which is what makes it an imported one. */
  importMark: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    return { resolves: !!doc, imported: !!doc?.getFlag?.("acks-extras", "cookbook") };
  },
  /** The placement's live state on this seat, after a click that should have placed. */
  diag: async () => {
    const H = globalThis.__mc;
    return { mouse: canvas.mousePosition ? { x: Math.round(canvas.mousePosition.x), y: Math.round(canvas.mousePosition.y) } : null, view: canvas.stage ? { x: Math.round(canvas.stage.pivot.x), y: Math.round(canvas.stage.pivot.y), s: canvas.stage.scale.x } : null, canvasReady: !!canvas.ready, paused: game.paused, previews: canvas.tokens?.preview?.children?.length ?? null, layerActive: !!canvas.tokens?.active, warns: H.warns.slice(), errors: H.errors.length, framed: [...foundry.applications.instances.values()].filter((a) => a.hasFrame && a.rendered).length };
  },
  /** Close every framed window, open the caster's sheet on its Magic tab and press the spell row's Cast button as a user does. Nothing is awaited: the prompt is the answer. */
  press: async ({ casterId, spellId }) => {
    const H = globalThis.__mc;
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
  /** The cast dialog, once it is up, and the Summon band as it reads now: the creature choices, the count and its ceiling, the placement line, the footer's verdicts and the Cast button. */
  dialog: async ({ spellName }) => {
    const H = globalThis.__mc;
    const found = await H.poll(() => H.live(), { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    return { ...H.band(), titled: (H.live()?.querySelector(".window-title")?.textContent ?? "").includes(spellName) };
  },
  /** The band as it reads now, without waiting. */
  band: async () => globalThis.__mc.band(),
  /** Type a caster level and a count into the open dialog, as a user does (each change re-renders the window), and read the band again. */
  setBand: async ({ count, level }) => globalThis.__mc.setBand({ count, level }),
  /** Press Cast in the open dialog, then clear every framed window off the map. */
  confirm: async ({ count, level }) => {
    const H = globalThis.__mc;
    if (!H.live()) return { dialog: false };
    if (count || level) await H.setBand({ count, level });
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
  /** Press Cancel in the open dialog, as a user dismisses it. */
  dismissPrompt: async () => {
    const H = globalThis.__mc;
    const cancel = H.live()?.querySelector('button[data-action="cancel"]');
    if (!cancel) return false;
    cancel.click();
    await H.sleep(800);
    return !H.live();
  },
  /** Answer the bare Summon… prompt (lib's `promptSummon`, which a spell-less placement still uses): the creature and count, then Place on the map, then every framed window cleared off the map. */
  answer: async ({ count, source }) => {
    const H = globalThis.__mc;
    const form = await H.poll(() => [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count), { tries: 60, every: 200 });
    if (!form) return { prompt: false };
    if (source && [...form.elements.source.options].some((o) => o.value === source)) form.elements.source.value = source;
    if (count) form.elements.count.value = String(count);
    const ok = form.querySelector('button[data-action="ok"]') ?? form.closest(".application")?.querySelector('button[data-action="ok"]');
    ok?.click();
    await H.sleep(500);
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    await H.sleep(500);
    return { prompt: true, pressed: !!ok };
  },
  /** Open the cast dialog for a spell without the sheet; the call is not awaited. */
  useSpell: async ({ casterId, spellId }) => {
    const H = globalThis.__mc;
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const item = game.actors.get(casterId).items.get(spellId);
    H.seen = new Set(H.cards(casterId));
    const before = item.system.cast;
    item.use({ skipDialog: true });
    return { before };
  },
  /** One spell's flag replaced whole: its summon rows (each a plain row), its duration and, where given, its range in feet. The count is 0 again. */
  reshape: async ({ casterId, spellId, rows, duration, rangeFeet }) => {
    const item = game.actors.get(casterId).items.get(spellId);
    await item.update({ "flags.acks-extras.-=spell": null });
    const flag = { schools: ["summoning"], effects: rows, duration };
    if (rangeFeet != null) flag.range = { shape: "distance", value: rangeFeet, unit: "feet" };
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": flag });
    return { rows: item.getFlag("acks-extras", "spell")?.effects?.length ?? 0, cast: item.system.cast };
  },
  /** The warnings this seat's notifications raised since the last read; reading clears them. */
  warnsTake: async () => {
    const H = globalThis.__mc;
    const out = H.warns.slice();
    H.warns.length = 0;
    return out;
  },
  /** A localized string as this seat reads it (the caller splits the key so the key scan reads no bare prefix). */
  loc: async ({ key, data }) => game.i18n.format(key, data ?? {}),
  /** Make the seat see no active GM, or give it back. Only the seat's own reading of `game.users.activeGM` changes; the GM seat stays connected. */
  noGm: async ({ on }) => {
    if (on) Object.defineProperty(game.users, "activeGM", { configurable: true, get: () => null });
    else delete game.users.activeGM;
    return { seenAs: game.users.activeGM?.id ?? null };
  },
  /** Tokens from specs, answered by actor: a create's answer is not in the order of its data. */
  placeTokens: async ({ sceneId, specs }) => {
    const scene = game.scenes.get(sceneId);
    const made = await scene.createEmbeddedDocuments("Token", specs.map((s) => ({ actorId: s.actorId, x: s.x, y: s.y, name: s.name, actorLink: s.link !== false, disposition: s.disposition ?? -1 })));
    return specs.map((s) => made.find((t) => t.actorId === s.actorId)).filter(Boolean).map((t) => ({ id: t.id, uuid: t.uuid, actorId: t.actorId }));
  },
  /** Every token on the field, by uuid, with whether it carries a summons' record. */
  sceneTokens: async ({ sceneId }) => [...game.scenes.get(sceneId).tokens].map((t) => ({ uuid: t.uuid, summoned: !!t.actor?.getFlag("acks-extras", "summonedBy") })),
  combatNew: async ({ sceneId, tokenIds }) => {
    const scene = game.scenes.get(sceneId);
    const combat = await Combat.create({ scene: sceneId, active: true });
    await combat.createEmbeddedDocuments("Combatant", tokenIds.map((id) => ({ tokenId: id, sceneId, actorId: scene.tokens.get(id).actorId })));
    await combat.update({ round: 1, turn: 0, "flags.acks.initDone": true });
    return { id: combat.id, uuid: combat.uuid, combatants: combat.combatants.map((c) => ({ id: c.id, tokenId: c.tokenId })) };
  },
  combatSet: async ({ combatId, initiatives }) => {
    const combat = game.combats.get(combatId);
    for (const [id, initiative] of Object.entries(initiatives)) await combat.combatants.get(id).update({ initiative });
    await new Promise((r) => setTimeout(r, 600));
    return { turns: combat.turns.length, onTurn: combat.combatant?.tokenId ?? null };
  },
  /** Move the tracker, then read whose turn it is. */
  combatMove: async ({ combatId, update }) => {
    const combat = game.combats.get(combatId);
    await combat.update(update);
    await new Promise((r) => setTimeout(r, 1200));
    return { round: combat.round, onTurn: combat.combatant?.tokenId ?? null };
  },
  combatDrop: async ({ combatId }) => { await game.combats.get(combatId)?.delete(); return !game.combats.get(combatId); },
  /** Declared spells waiting on the caster: the pending records and the casting status. */
  pending: async ({ casterId }) => {
    const a = game.actors.get(casterId);
    return { pending: [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.pending).map((e) => e.uuid), casting: a.statuses.has("casting") };
  },
  /** Advance the world clock as the Judge's seat does, then give the expiry sweep its time. */
  advance: async ({ seconds }) => {
    const H = globalThis.__mc;
    await game.time.advance(seconds);
    await H.sleep(2500);
    return game.time.worldTime;
  },
  /** Cards of the two end kinds for a cast: the concentration's funnel card and the clock's expiry card. */
  endCards: async ({ castId }) => [...game.messages].filter((m) => m.flags?.["acks-extras"]?.castHeldEnd?.castId === castId || m.flags?.["acks-extras"]?.castEnded?.castId === castId).map((m) => ({ uuid: m.uuid, id: m.id, held: !!m.flags["acks-extras"].castHeldEnd, timed: !!m.flags["acks-extras"].castEnded })),
  /** What this seat's rendered chat card of a message shows: the creatures it lists, its Dismiss buttons and its Restore. The card is rendered in the Chat tab, so that tab is brought up first. */
  heldCard: async ({ messageId }) => {
    const H = globalThis.__mc;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    const el = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"]`), { tries: 40, every: 200 });
    if (!el) return { found: false };
    await H.sleep(600);
    return {
      found: true,
      creatures: el.querySelectorAll(".acks-extras-cast-held .acks-extras-bucket__row").length,
      dismiss: el.querySelectorAll("[data-acks-extras-held-dismiss]").length,
      restore: el.querySelectorAll("[data-acks-extras-held-restore]").length,
    };
  },
  /** The clock's expiry cards a caster's casts posted since a time, by uuid. */
  expiryCards: async ({ casterUuid, since }) => [...game.messages].filter((m) => m.timestamp >= since && m.flags?.["acks-extras"]?.castEnded?.casterUuid === casterUuid).map((m) => m.uuid),
  /** End a held cast by the status's own toggle, as the HUD does it. */
  endHeld: async ({ casterId, status }) => { await game.actors.get(casterId).toggleStatusEffect(status, { active: false }); return true; },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* a notice left standing is only chrome over the map */ }
    return true;
  },
  /** The viewport's middle in client points, where the driver parks the pointer before the view is panned. */
  middle: async () => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }),
  /** One client point per entry of `cells`, found by scanning the viewport at least 60 px from every edge; each says whether the bare canvas lies under it and well inside the scene. */
  pointsFor: async ({ cells, avoid = [] }) => {
    const r = canvas.dimensions.sceneRect;
    // Core clamps the zoom, and an animation can still be moving the view, so the pan is repeated until two reads half a second apart agree on the view.
    const snap = () => `${canvas.stage.scale.x.toFixed(3)}:${Math.round(canvas.stage.pivot.x)}:${Math.round(canvas.stage.pivot.y)}`;
    let last = "";
    for (let n = 0; n < 12; n++) {
      canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: 0.5 });
      await new Promise((res) => setTimeout(res, 500));
      const now = snap();
      if (now === last) break;
      last = now;
    }
    // The view core settles on is not the one asked for, so the points are not computed from scene cells: the viewport is scanned for spots where the bare canvas lies under the pointer and the spot maps well inside the scene, and one point is chosen per cell asked for, each at least a grid cell and a half from the others and from `avoid`.
    const W = window.innerWidth;
    const H = window.innerHeight;
    const found = [];
    // Core's placement edge-pans the view while the pointer stands within 50 px of an edge, so no point is taken from that band.
    for (let y = 60; y <= H - 60; y += 30) {
      for (let x = 60; x <= W - 60; x += 30) {
        if (document.elementFromPoint(x, y) !== canvas.app.view) continue;
        const back = canvas.canvasCoordinatesFromClient({ x, y });
        if (back.x >= r.x + 100 && back.y >= r.y + 100 && back.x <= r.x + r.width - 100 && back.y <= r.y + r.height - 100) found.push({ x, y, back });
      }
    }
    const pointer = canvas.app?.renderer?.events?.rootPointerEvent;
    const view = [W, H, window.devicePixelRatio, Number(canvas.stage.scale.x.toFixed(3)), found.length, [Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y)], pointer ? [Math.round(pointer.clientX), Math.round(pointer.clientY)] : null, document.hidden];
    if (!found.length) return cells.map(() => ({ x: 0, y: 0, onCanvas: false, cover: "no bare spot inside the scene", view, scene: null }));
    const cx = found.reduce((a, p) => a + p.x, 0) / found.length;
    const cy = found.reduce((a, p) => a + p.y, 0) / found.length;
    found.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const apart = Math.max(120, canvas.dimensions.size * canvas.stage.scale.x * 1.5);
    const out = [];
    for (const _cell of cells) {
      const pick = found.find((p) => [...out, ...avoid].every((o) => Math.hypot(p.x - o.x, p.y - o.y) >= apart));
      out.push(pick ? { x: pick.x, y: pick.y, onCanvas: true, cover: "", view, scene: [Math.round(pick.back.x - r.x), Math.round(pick.back.y - r.y)] } : { x: 0, y: 0, onCanvas: false, cover: "no second spot", view, scene: null });
    }
    return out;
  },
  worldTime: async () => game.time.worldTime,
  /** The cast count and the cards made since the last press. */
  state: async ({ casterId, spellId }) => {
    const H = globalThis.__mc;
    const item = game.actors.get(casterId).items.get(spellId);
    const cards = H.cards(casterId).filter((id) => !H.seen.has(id));
    return { cast: item.system.cast, cards, castCards: cards.filter((id) => !!game.messages.get(id)?.flags?.["acks-extras"]?.castCard) };
  },
  summonTokens: async ({ sceneId, summonerUuid, playerId }) =>
    [...game.scenes.get(sceneId).tokens]
      .filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === summonerUuid)
      .map((t) => ({
        uuid: t.uuid,
        record: t.actor.getFlag("acks-extras", "summon") ?? null,
        owner: t.isOwner && !!t.actor?.isOwner,
        unlinked: t.actorLink === false,
        disposition: t.disposition,
        // The level the Player holds on the creature's actor, as the world holds it (the token's delta reads through to the actor).
        playerLevel: playerId ? (t.actor?.ownership?.[playerId] ?? 0) : null,
        lost: !!t.actor?.getFlag("acks-extras", "summon")?.lost,
      })),
  /** The world copies of a source: their uuid, and whether any player holds a level on them. */
  copiesOf: async ({ sourceUuid }) =>
    game.actors
      .filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid)
      .map((a) => ({ uuid: a.uuid, noDefault: (a.ownership?.default ?? 0) === 0, playerLevels: Object.entries(a.ownership ?? {}).filter(([id, level]) => id !== "default" && level > 0 && !game.users.get(id)?.isGM).length })),
  /** The caster records one cast left on the actor. */
  recordOf: async ({ casterId, castId, spellUuid }) => {
    const actor = game.actors.get(casterId);
    return actor.effects
      .filter((e) => e.getFlag("acks-extras", "spellEffect")?.castId === castId)
      .map((e) => {
        const flag = e.getFlag("acks-extras", "spellEffect");
        return { uuid: e.uuid, role: flag.role, casterOk: flag.casterUuid === actor.uuid, spellOk: flag.spellUuid === spellUuid && e.origin === spellUuid, value: e.duration?.value ?? null, units: e.duration?.units ?? null };
      });
  },
  /** Every caster record on the actor, as cast ids. */
  recordIds: async ({ casterId }) => game.actors.get(casterId).effects.map((e) => e.getFlag("acks-extras", "spellEffect")?.castId).filter(Boolean),
  /**
   * A claimant on the cast seam whose `spend` is called after its `cast` has returned, as a careless feature would: from a timer, its answer read (`caught`) or not (`bare`). The spell's summon rows are cleared so no summoning claimant takes the cast first. Reads what libWrapper's invalidated chain did on this seat: the late answer, the count, the cards, the seam's logged lines, Foundry's module-error notices and uncaught errors.
   */
  lateSpend: async ({ casterId, spellId, mode }) => {
    const H = globalThis.__mc;
    const seam = acksExtras.lib.spellUse;
    const item = game.actors.get(casterId).items.get(spellId);
    await item.unsetFlag("acks-extras", "spell");
    await item.update({ "system.cast": 0 });
    const key = `${H.key}-late`;
    const late = { fired: false, answer: null, threw: false, rejected: false };
    const cardsBefore = H.cards(casterId).length;
    const errorsBefore = H.errors.length;
    const uncaughtBefore = H.uncaught.length;
    const notices = [];
    const notify = ui.notifications.error;
    ui.notifications.error = function (msg, ...rest) { notices.push(String(msg)); return notify.call(this, msg, ...rest); };
    seam.addClaimant({
      key,
      claims: (it) => it.id === spellId,
      cast: async (it, o, spend) => {
        setTimeout(() => {
          late.fired = true;
          try {
            const answer = spend();
            if (mode === "caught") Promise.resolve(answer).then((v) => { late.answer = v; }, () => { late.rejected = true; });
          } catch { late.threw = true; }
        }, 300);
      },
    });
    try {
      await item._useSpell({});
      await H.poll(() => late.fired, { tries: 20, every: 100 });
      await H.sleep(700);
    } finally {
      seam.removeClaimant(key);
      ui.notifications.error = notify;
    }
    return {
      ...late,
      cast: item.system.cast,
      cards: H.cards(casterId).length - cardsBefore,
      logged: H.errors.slice(errorsBefore).filter((e) => /called spend after its cast returned; the cast was not counted/u.test(e)).length,
      notices: notices.length,
      uncaught: H.uncaught.length - uncaughtBefore,
      libWrapper: !!game.modules.get("lib-wrapper")?.active && typeof globalThis.libWrapper?.register === "function",
    };
  },
  /** The API's own answer to a spell-less placement on a creature this seat can read. */
  bareApi: async ({ casterId, sourceUuid }) => {
    const r = await acksExtras.lib.summons.placeSummons(game.actors.get(casterId), { sourceUuid, count: 1 });
    return { ok: r?.ok === true, reason: r?.reason ?? null };
  },
  /** Summon… through its prompt: refused outright for a seat that may not summon bare. */
  bareRefused: async ({ casterId }) => {
    const H = globalThis.__mc;
    H.warns.length = 0;
    const { promptSummon } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    const r = await promptSummon(game.actors.get(casterId));
    return { ok: r?.ok === true, reason: r?.reason ?? null, warned: H.warns.length };
  },
  /** Start Summon… on this seat; its result lands on the page when the click places. */
  startBare: async ({ casterId }) => {
    const H = globalThis.__mc;
    H.bare = null;
    const { promptSummon } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    promptSummon(game.actors.get(casterId)).then((r) => { H.bare = r ?? { ok: false, reason: "closed" }; });
    return true;
  },
  bareResult: async () => {
    const H = globalThis.__mc;
    return (await H.poll(() => H.bare, { tries: 50, every: 200 })) ?? null;
  },
  firstCreature: async () => {
    const { summonShelves } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    return summonShelves()[0]?.entries?.[0]?.uuid ?? null;
  },
  /** A request on the relay as a client that skipped the seat's own check would send it. */
  forge: async ({ summonerUuid, sourceUuid, sceneId, spellId, count }) => {
    const { executeAsGM } = await import("/modules/acks-extras/scripts/lib/sockets.mjs");
    const positions = Array.from({ length: count }, (_, i) => ({ x: 300 + 100 * i, y: 300 }));
    const r = await executeAsGM("summonRelay", { op: "place", summonerUuid, sourceUuid, sceneId, positions, count, spellId, castId: "forge001" });
    return { ok: r?.ok === true, reason: r?.reason ?? null, made: r?.tokenUuids?.length ?? 0 };
  },
  /** The same request through the seat's API, which checks first. */
  placeApi: async ({ casterId, sourceUuid, spellId, count }) => {
    const r = await acksExtras.lib.summons.placeSummons(game.actors.get(casterId), { sourceUuid, count, spellId });
    return { ok: r?.ok === true, reason: r?.reason ?? null };
  },
  restore: async () => {
    const H = globalThis.__mc;
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

async function ready(api, label, { seconds = 240, fresh = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.summons && !!globalThis.acksExtras?.magic && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * Attach a second DevTools session to a seat's page, register the boot
 * recorder for the next document, and reload: the driver's own session attaches
 * after `ready`, so a recorder it injects would miss `init`, `setup` and `ready`.
 */
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
 * Click points for a seat, with its pointer parked in the viewport's middle first: core's placement pans the canvas while the pointer stands in the 50 px edge band
 * (where the Place button left it), and the scan reads a view that is still moving.
 */
async function pointsFor(seat, port, args) {
  const { x, y } = await run(seat, P.middle);
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  s.close();
  await sleep(400);
  return run(seat, P.pointsFor, args);
}
/** A real click on a seat's page: the pointer moves there first, so core's preview follows it. */
async function clickAt(port, { x, y }, button = "left") {
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(250);
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
  await sleep(80);
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
  s.close();
  await sleep(700);
}

let gm = null;
let player = null;
let wasPaused = false;
/** The uuids of what this run made: the only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_200_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Poll a page read until `fn(result)` is true or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 60, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
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
  check("the cast seam and the summoning cast are on both seats' apis", installed.claimant && installed.castApi && seated.claimant && seated.castApi);
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const boot = await run(seat, P.boot);
    check(`${label}: the recorder ran before Foundry's scripts and saw the load, with no cast-summon or seam error and no wrap warning`, boot.recorded && boot.preFoundry && boot.noRegisterError === true && boot.noWrapWarning === true, { errors: boot.errors });
  }
  // A paused world refuses a player's summons; the run unpauses it and the finally pauses it again.
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const scene = await gm.fixture("magic/summon-scene", "Scene", {
    name: "QA Cast Summon Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 },
  });
  const creature = await gm.fixture("magic/summon-creature", "Actor", { name: "QA Cast Summon Creature", type: "monster", ownership: { default: 0, [playerId]: 2 } });
  const other = await gm.fixture("magic/summon-other", "Actor", { name: "QA Cast Summon Other", type: "monster", ownership: { default: 0 } });
  const open = await gm.fixture("magic/summon-open", "Actor", { name: "QA Cast Summon Open", type: "monster", ownership: { default: 2 } });
  const caster = await gm.fixture("magic/summon-caster", "Actor", {
    name: "QA Cast Summon Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [playerId]: 3 },
  });
  const spellName = "QA Cast Summon Spell";
  const spell = await gm.fixture("magic/summon-spell", "Item", { name: spellName, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const casterId = idOf(caster);
  const spellId = idOf(spell);
  const sceneId = idOf(scene);
  const casterUuid = `Actor.${casterId}`;
  const spellUuid = `${casterUuid}.Item.${spellId}`;
  const creatureUuid = `Actor.${idOf(creature)}`;
  const otherUuid = `Actor.${idOf(other)}`;
  const openUuid = `Actor.${idOf(open)}`;
  const shaped = await run(gm, P.shape, { casterId, spellId, ref: creatureUuid, amount: 2, sceneId });
  check("shape: the caster has spells enabled and the spell's count at 0, with one summon row and no summons standing", shaped.enabled && shaped.isSpell && shaped.cast === 0 && shaped.rows === 1 && shaped.standing === 0, shaped);
  if (shaped.standing) throw new Error("leftover summons on the field from a run that did not sweep");
  const recordsBefore = new Set(await run(gm, P.recordIds, { casterId }));
  const creatureCopiesBefore = await run(gm, P.copiesOf, { sourceUuid: creatureUuid });
  note("world copies of the named creature before the run", creatureCopiesBefore.length);
  await sleep(1500);
  check("the Player seat views the field without activating it", await run(player, P.view, { sceneId }));
  check("the GM seat views the field", await run(gm, P.view, { sceneId }));
  // A cast summons what the casting seat may observe, so the named creature carries the Player's Observer level, written here from the GM seat; the unnamed closed creature is taken back to default None with no entry for the Player, whatever a run that died mid-grant left on it.
  const seatId = await run(player, P.selfId);
  const grant = await run(gm, P.setLevel, { uuid: creatureUuid, userId: playerId, level: 2 });
  const strip = await run(gm, P.setLevel, { uuid: otherUuid, userId: playerId, level: null });
  check("shape: the Player seat's own user is the one granted, the named creature holds Observer for it at default None, and the unnamed closed creature holds no entry for it at default None", seatId === playerId && grant.stored === 2 && grant.def === 0 && !strip.keyed && strip.stored === null && strip.def === 0, { granted: grant.stored, grantDefault: grant.def, keyed: strip.keyed, stripDefault: strip.def });
  // A world actor reaches the Player's client whatever its ownership, so the seat resolves it; whether it may observe it is read once the write has reached the seat.
  const probe = await until(player, P.probe, { refs: [creatureUuid, otherUuid, openUuid] }, (p) => p[0].observes && !p[1].observes && p[2].observes);
  check("the Player seat may observe the named creature and the open one, and may not observe the unnamed closed one", probe[0].observes && !probe[1].observes && probe[2].observes, probe.map((p) => ({ resolves: p.resolves, observes: p.observes })));
  const tokens = (api) => run(api, P.summonTokens, { sceneId, summonerUuid: casterUuid });
  await run(player, P.drain);
  await run(gm, P.drain);

  section("1. the Cast button opens the cast dialog; nothing is spent while it and the placement are pending");
  const pressed = await run(player, P.press, { casterId, spellId });
  check("the Magic tab's Cast button exists on the spell row", pressed.button, { before: pressed.before });
  if (!pressed.button) throw new Error("no Cast button on the Player's Magic tab");
  const prompt = await run(player, P.dialog, { spellName });
  check("the cast dialog opens, titled for the spell, with a Summon band whose one choice is the spell's one row, and no Targets band", prompt.dialog && prompt.titled && prompt.summonBand && !prompt.targetsBand && prompt.values.length === 1 && prompt.values[0] === creatureUuid, { choices: prompt.values?.length, summonBand: prompt.summonBand, targetsBand: prompt.targetsBand });
  check("the choice is labelled, and the count opens on the row's amount", prompt.labelled && prompt.count === "2", { count: prompt.count });
  const mid = await run(player, P.state, { casterId, spellId });
  check("1: with the dialog up the cast count is unchanged and no card has posted", mid.cast === pressed.before && mid.cards.length === 0, { cast: mid.cast, cards: mid.cards.length });
  const answered = await run(player, P.confirm, { count: 2 });
  check("Cast is pressed in the dialog and the windows are cleared off the map", answered.dialog && answered.pressed, answered);
  const points = await pointsFor(player, PORTS.player, { cells: CELLS.cast });
  check("every click point lies on the bare canvas", points.every((p) => p.onCanvas), points.map((p) => ({ onCanvas: p.onCanvas, nudged: p.nudged, cover: p.cover, view: p.view, scene: p.scene })));
  const worldTime = await run(player, P.worldTime);
  const pending = await run(player, P.state, { casterId, spellId });
  check("1: with the previews up and nothing clicked the count is still unchanged", pending.cast === pressed.before && pending.cards.length === 0);
  note("2: the Player seat's placement state before the clicks", await run(player, P.diag));
  // Each point is read again just before its own click, the view panned back first, so a view that moved since the first read cannot send a click off the scene.
  const clicked = [];
  for (const cell of CELLS.cast) {
    const [p] = await pointsFor(player, PORTS.player, { cells: [cell], avoid: clicked });
    if (!p.onCanvas) {
      // The placement is still pending: a right click cancels it before the walk stops.
      try { await clickAt(PORTS.player, await run(player, P.middle), "right"); } catch { /* the failure below is the one to report */ }
      throw new Error(`a click point left the bare canvas before its click: ${JSON.stringify(p.view)}`);
    }
    await clickAt(PORTS.player, p);
    clicked.push(p);
  }
  note("2: the Player seat's placement state after the clicks", await run(player, P.diag));

  section("2. two clicks place two tokens, and the cast is spent once");
  let placed = [];
  for (let n = 0; n < 40 && placed.length < 2; n++) { placed = await tokens(gm); if (placed.length < 2) await sleep(300); }
  for (const t of placed) await track(t.uuid, "Token");
  check("2: two left clicks place two tokens", placed.length === 2, { n: placed.length });
  if (placed.length !== 2) {
    note("2: the Player seat's recorder after the clicks", await run(player, P.drain));
    note("2: the GM seat's recorder after the clicks", await run(gm, P.drain));
  }
  if (placed.length !== 2) throw new Error("the cast placed no creatures; every later step reads its tokens");
  const casts = new Set(placed.map((t) => t.record?.castId));
  check("2: one cast id across the two, naming the spell by id and by name, with the world time", casts.size === 1 && !casts.has(undefined) && placed.every((t) => t.record?.spellId === spellId && t.record?.spellName === spellName && t.record?.at >= worldTime), { casts: casts.size });
  check("2: each token is unlinked and the Player owns it and its actor", placed.every((t) => t.owner && t.unlinked));
  const castId = [...casts][0];
  const after = await until(player, P.state, { casterId, spellId }, (s) => s.cast > pressed.before && s.castCards.length >= 1, { tries: 60, every: 200 });
  await sleep(900);
  const settled = await run(player, P.state, { casterId, spellId });
  for (const id of settled.cards) await track(`ChatMessage.${id}`, "ChatMessage");
  check("2: the cast count rose by exactly 1 and one cast card posted", settled.cast === pressed.before + 1 && settled.castCards.length === 1 && after.cast === pressed.before + 1, { before: pressed.before, after: settled.cast, castCards: settled.castCards.length });
  const record = await until(gm, P.recordOf, { casterId, castId, spellUuid }, (r) => r.length >= 1, { tries: 30, every: 250 });
  for (const r of record) await track(r.uuid, "ActiveEffect");
  check("2: one caster record carries the summons' cast id, the spell and the caster, with the spell's imported duration", record.length === 1 && record[0].role === "caster" && record[0].casterOk && record[0].spellOk && record[0].value === 2 && record[0].units === "hours", { n: record.length, role: record[0]?.role, value: record[0]?.value, units: record[0]?.units });
  const copies = await run(gm, P.copiesOf, { sourceUuid: creatureUuid });
  if (!creatureCopiesBefore.length) for (const c of copies) await track(c.uuid, "Actor");
  check("2: the GM's client made the one world copy of the creature, owned by no player", copies.length === 1 && copies[0].noDefault && copies[0].playerLevels === 0, { copies: copies.length });
  const d1 = await run(player, P.drain);
  check("2: no console error, uncaught error or warning on the Player seat", !d1.errors.length && !d1.uncaught.length && !d1.warns.length, { errors: d1.errors.length, uncaught: d1.uncaught.length, warns: d1.warns });
  await run(player, P.clearWindows);

  section("3. a right click at the clicks and a cancelled dialog each leave the count where it was");
  const baseCast = settled.cast;
  const press3 = await run(player, P.press, { casterId, spellId });
  check("3: the Cast button is pressed again", press3.button && press3.before === baseCast);
  check("3: the dialog opens", (await run(player, P.dialog, { spellName })).dialog);
  await run(player, P.confirm, { count: 1 });
  const [cancelAt] = await pointsFor(player, PORTS.player, { cells: [CELLS.cancel] });
  await clickAt(PORTS.player, cancelAt, "right");
  await sleep(2500);
  const cancelled = await run(player, P.state, { casterId, spellId });
  const afterCancel = await tokens(gm);
  const dc = await run(player, P.drain);
  check("3: a right click makes no token, leaves the count, posts no card and shows no warning", cancelled.cast === baseCast && cancelled.cards.length === 0 && afterCancel.length === 2 && !dc.warns.length && !dc.errors.length, { cast: cancelled.cast, cards: cancelled.cards.length, tokens: afterCancel.length, warns: dc.warns, errors: dc.errors.length });
  await run(player, P.clearWindows);
  const press3b = await run(player, P.press, { casterId, spellId });
  check("3: the Cast button is pressed a third time", press3b.button);
  check("3: the dialog opens again", (await run(player, P.dialog, { spellName })).dialog);
  check("3: the dialog is cancelled before any click", await run(player, P.dismissPrompt));
  await sleep(2500);
  const closed = await run(player, P.state, { casterId, spellId });
  check("3: a cancelled dialog makes no token, leaves the count and posts no card", closed.cast === baseCast && closed.cards.length === 0 && (await tokens(gm)).length === 2, { cast: closed.cast, cards: closed.cards.length });
  const idsNow = await run(gm, P.recordIds, { casterId });
  check("3: neither wrote a caster record", idsNow.filter((id) => !recordsBefore.has(id)).length === 1);

  section("4. what the spell does not name, and a spell-less Summon…");
  const forgedOther = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: otherUuid, sceneId, spellId, count: 1 });
  check("4: a forged relay request for an unnamed creature on a shelf the Player cannot open is refused unreadable and makes nothing", !forgedOther.ok && forgedOther.reason === "unreadable" && forgedOther.made === 0, forgedOther);
  const forgedOpen = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: openUuid, sceneId, spellId, count: 1 });
  check("4: a forged relay request for an unnamed creature the Player may read is refused notNamed and makes nothing", !forgedOpen.ok && forgedOpen.reason === "notNamed" && forgedOpen.made === 0, forgedOpen);
  const forgedCount = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: creatureUuid, sceneId, spellId, count: 3 });
  check("4: a forged relay request for the named creature over the row's amount is refused badCount", !forgedCount.ok && forgedCount.reason === "badCount" && forgedCount.made === 0, forgedCount);
  const forgedBare = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: openUuid, sceneId, spellId: "", count: 1 });
  check("4: a forged spell-less relay request from the Player is refused spellRequired", !forgedBare.ok && forgedBare.reason === "spellRequired" && forgedBare.made === 0, forgedBare);
  const apiOther = await run(player, P.placeApi, { casterId, sourceUuid: otherUuid, spellId, count: 1 });
  check("4: the seat's own placement of a creature the spell does not name stops before any click, unreadable", !apiOther.ok && apiOther.reason === "unreadable", apiOther);
  const apiBare = await run(player, P.bareApi, { casterId, sourceUuid: openUuid });
  check("4: the Player's spell-less placement is refused spellRequired by the seat", !apiBare.ok && apiBare.reason === "spellRequired", apiBare);
  const promptBare = await run(player, P.bareRefused, { casterId });
  check("4: the Player's Summon… is refused spellRequired with a warning and no prompt", !promptBare.ok && promptBare.reason === "spellRequired" && promptBare.warned === 1, { warned: promptBare.warned });
  check("4: nothing beyond the two tokens of step 2 stands", (await tokens(gm)).length === 2);

  section("5. the GM seat's Summon… still places a creature with no spell");
  const shelfCreature = await run(gm, P.firstCreature);
  check("5: the GM seat can open a monster compendium", !!shelfCreature);
  if (shelfCreature) {
    const shelfCopiesBefore = await run(gm, P.copiesOf, { sourceUuid: shelfCreature });
    await run(gm, P.clearWindows);
    await run(gm, P.startBare, { casterId });
    const gmPrompt = await run(gm, P.answer, { count: 1, source: shelfCreature });
    check("5: the prompt opens for the GM seat and Place on the map is pressed", gmPrompt.prompt && gmPrompt.pressed);
    await frontSeat(PORTS.gm);
    const [bareAt] = await pointsFor(gm, PORTS.gm, { cells: [CELLS.bare] });
    check("5: the click point lies on the bare canvas", bareAt.onCanvas, { onCanvas: bareAt.onCanvas, cover: bareAt.cover, view: bareAt.view, scene: bareAt.scene });
    note("5: the GM seat's placement state before the click", await run(gm, P.diag));
    await clickAt(PORTS.gm, bareAt);
    const bare = await run(gm, P.bareResult);
    note("5: the GM seat's placement state after the click", await run(gm, P.diag));
    for (const uuid of bare?.tokenUuids ?? []) await track(uuid, "Token");
    check("5: the click places one creature, accepted by the relay with no spell", bare?.ok === true && bare.tokenUuids?.length === 1, { ok: bare?.ok ?? null, n: bare?.tokenUuids?.length ?? 0 });
    const gmTokens = (await tokens(gm)).filter((t) => !placed.some((p) => p.uuid === t.uuid));
    check("5: its record names the summoner and carries no spell", gmTokens.length === 1 && !gmTokens[0].record?.spellId && !gmTokens[0].record?.spellName, { n: gmTokens.length });
    const shelfCopies = await run(gm, P.copiesOf, { sourceUuid: shelfCreature });
    if (!shelfCopiesBefore.length) for (const c of shelfCopies) await track(c.uuid, "Actor");
    check("5: the GM's bare summoning cast nothing: the spell's count is unchanged", (await run(gm, P.state, { casterId, spellId })).cast === settled.cast);
  }

  /* ------------------------------------------------------------------ */
  /*  The dialog-driven steps: the band, the verdicts, the range, the    */
  /*  declaration, the held end and the timed end.                       */
  /* ------------------------------------------------------------------ */
  const seatOf = (who) => (who === "gm" ? gm : player);
  const portOf = (who) => (who === "gm" ? PORTS.gm : PORTS.player);
  const usedAt = { gm: [], player: [...clicked] };
  /** The spell the steps cast: the standing fixture, and for the delete path a second one, so the rows the other casts end by are never the delete path's. */
  let act = { id: spellId, uuid: spellUuid, name: spellName };
  const perLevel = (base, per) => ({ kind: "perLevel", base, per });
  const TWO_HOURS = { shape: "fixed", value: 2, unit: "hours" };
  const HELD = { shape: "concentration", concentration: "stationary" };
  const summonRow = (over = {}) => ({ type: "summon", ref: creatureUuid, amount: 2, ...over });
  /** Reshape on the GM seat, then wait until the Player seat reads the zeroed count: a Player read made before the update reaches it sees the last cast's count. */
  const reshape = async (rows, { duration = TWO_HOURS, rangeFeet = null } = {}) => {
    const out = await run(gm, P.reshape, { casterId, spellId: act.id, rows, duration, rangeFeet });
    await until(player, P.state, { casterId, spellId: act.id }, (s) => s.cast === 0, { tries: 40, every: 150 });
    return out;
  };
  /** A localized string as the seat reads it; the caller passes the key without its root, which is joined here so no bare prefix is spelled. */
  const loc = (who, key, data) => run(seatOf(who), P.loc, { key: "ACKS-" + key, data });
  const openDialog = async (who) => {
    await run(seatOf(who), P.useSpell, { casterId, spellId: act.id });
    return run(seatOf(who), P.dialog, { spellName: act.name });
  };
  const castState = (who) => run(seatOf(who), P.state, { casterId, spellId: act.id });
  const standing = async () => new Set((await tokens(gm)).map((t) => t.uuid));
  /** The summons' tokens that were not standing before, once `n` of them have appeared; each is tracked by its uuid. */
  const awaitFresh = async (before, n) => {
    let list = [];
    for (let i = 0; i < 40; i++) {
      list = (await tokens(gm)).filter((t) => !before.has(t.uuid));
      if (list.length >= n) break;
      await sleep(300);
    }
    for (const t of list) await track(t.uuid, "Token");
    return list;
  };
  /** One real click per creature on a seat's board, each point chosen apart from every earlier one; a point off the bare canvas cancels the pending placement and throws. */
  const clickPlaces = async (who, n) => {
    const seat = seatOf(who);
    const port = portOf(who);
    await frontSeat(port);
    for (let i = 0; i < n; i++) {
      const [p] = await pointsFor(seat, port, { cells: [[0, 0]], avoid: usedAt[who] });
      if (!p.onCanvas) {
        try { await clickAt(port, await run(seat, P.middle), "right"); } catch { /* the failure below is the one to report */ }
        throw new Error(`a click point left the bare canvas before its click: ${JSON.stringify(p.view)}`);
      }
      await clickAt(port, p);
      usedAt[who].push({ x: p.x, y: p.y });
    }
  };
  /** The cast's own leavings, tracked by id once the cast has settled: its caster records and the cards the seat saw. */
  const settle = async (who, fresh) => {
    const id = fresh[0]?.record?.castId ?? null;
    const records = id ? await until(gm, P.recordOf, { casterId, castId: id, spellUuid: act.uuid }, (r) => r.length >= 1, { tries: 30, every: 250 }) : [];
    for (const r of records) await track(r.uuid, "ActiveEffect");
    await sleep(900);
    const state = await castState(who);
    for (const c of state.cards) await track(`ChatMessage.${c}`, "ChatMessage");
    return { castId: id, records, state };
  };
  const cancelPlacement = async (who) => {
    try { await clickAt(portOf(who), await run(seatOf(who), P.middle), "right"); } catch { /* nothing pending */ }
    await sleep(1500);
  };

  section("7. the ceiling reads the caster level, and a count over it blocks a Player and warns a Judge");
  // A ceiling of the walk's own: one creature at the first level, one more per level after, so two caster levels state two.
  await reshape([summonRow({ amount: undefined, max: perLevel(1, 1) })]);
  const castBefore7 = (await castState("player")).cast;
  const d7 = await openDialog("player");
  check("7: the Player's cast dialog opens with the Summon band", d7.dialog && d7.summonBand, { summonBand: d7.summonBand });
  const lvl2 = await run(player, P.setBand, { level: 2, count: 2 });
  check("7: at caster level 2 the count's ceiling reads 2, and a count of 2 raises no verdict and leaves Cast on", /\b2\b/.test(lvl2.of) && !lvl2.ofWarns && lvl2.verdicts.length === 0 && !lvl2.castDisabled, { of: lvl2.of, verdicts: lvl2.verdicts.length, disabled: lvl2.castDisabled });
  const over2 = await run(player, P.setBand, { count: 3 });
  check("7: a count of 3 at level 2 is a block verdict naming the ceiling, the ceiling is drawn as a warning and Cast is off", over2.verdicts.some((v) => v.severity === "block") && over2.ofWarns && over2.castDisabled, { verdicts: over2.verdicts.map((v) => v.severity), disabled: over2.castDisabled });
  check("7: the block's words are the cast's own, with the ceiling and the excess", over2.verdicts[0]?.text === (await loc("player", "MAGIC.cast.notice.blocked.summonCount", { over: 1, max: 2 })), { text: over2.verdicts[0]?.text?.length ?? 0 });
  const lvl5 = await run(player, P.setBand, { level: 5, count: 3 });
  check("7: the ceiling moves with the level: at level 5 it reads 5 and the same count of 3 raises no verdict", /\b5\b/.test(lvl5.of) && lvl5.verdicts.length === 0 && !lvl5.castDisabled, { of: lvl5.of, verdicts: lvl5.verdicts.length });
  await run(player, P.setBand, { level: 2, count: 3 });
  check("7: closing the dialog while it blocks spends nothing and posts no card", await run(player, P.dismissPrompt) && (await castState("player")).cast === castBefore7 && (await castState("player")).cards.length === 0);
  await openDialog("gm");
  await run(gm, P.setBand, { level: 2, count: 3 });
  const gmOver = await run(gm, P.band);
  check("7: the same count from the Judge's seat is a warning, never a block, and Cast stays on", gmOver.verdicts.some((v) => v.severity === "warn") && !gmOver.verdicts.some((v) => v.severity === "block") && !gmOver.castDisabled, { verdicts: gmOver.verdicts.map((v) => v.severity), disabled: gmOver.castDisabled });
  check("7: the Judge's dialog is closed with no spend", await run(gm, P.dismissPrompt) && (await castState("gm")).cast === castBefore7);

  section("8. no GM connected: a Player is refused before the spend, with the count unchanged");
  // The GM seat stays connected; the Player seat is made to read no active GM, which is the one reading the cast's refusal takes (`deps.gmOnline`). The refusal is therefore synthetic: a world with no Judge seated cannot be driven from here.
  await reshape([summonRow()]);
  note("8: the Player seat reads no active GM (synthetic)", await run(player, P.noGm, { on: true }));
  try {
    const d8 = await openDialog("player");
    const noGmText = await loc("player", "MAGIC.cast.notice.summonNoGm");
    check("8: the dialog shows the refusal as a block in the cast's own words, and Cast is off", d8.dialog && d8.verdicts.some((v) => v.severity === "block" && v.text === noGmText) && d8.castDisabled, { verdicts: d8.verdicts.map((v) => v.severity), disabled: d8.castDisabled });
    await run(player, P.dismissPrompt);
    const s8 = await castState("player");
    check("8: nothing was spent and no card posted", s8.cast === castBefore7 && s8.cards.length === 0, { cast: s8.cast, cards: s8.cards.length });
  } finally {
    note("8: the Player seat reads the active GM again", await run(player, P.noGm, { on: false }));
  }

  section("9. placement range: a Player's click beyond it is refused, a Judge's is warned, a calling is exempt");
  // The caster's token stands in a corner of the field and the range is short, so a click near the middle of the field lies beyond it (the grid is 100 px to 5 ft).
  const casterToken = await run(gm, P.placeTokens, { sceneId, specs: [{ actorId: casterId, x: 100, y: 100, name: "Summon Caster", disposition: 1 }] });
  for (const t of casterToken) await track(t.uuid, "Token");
  check("9: the caster's token stands on the field", casterToken.length === 1);
  const outOfRange = await loc("player", "LIB.summons.refused.outOfRange");
  await reshape([summonRow()], { rangeFeet: 10 });
  const before9 = await standing();
  const cast9 = (await castState("player")).cast;
  const d9 = await openDialog("player");
  check("9: the band states the placement range", d9.dialog && /10/.test(d9.placement), { placement: d9.placement });
  await run(player, P.warnsTake);
  check("9: Cast is pressed in the Player's dialog", (await run(player, P.confirm, { count: 1 })).pressed);
  await clickPlaces("player", 1);
  const warns9 = await run(player, P.warnsTake);
  check("9: the Player's click beyond the range is refused with the range notice, and no creature appears", warns9.includes(outOfRange) && (await tokens(gm)).every((t) => before9.has(t.uuid)), { warns: warns9.length });
  await cancelPlacement("player");
  const gone9 = await castState("player");
  check("9: cancelling the pending clicks spends nothing and posts no card", gone9.cast === cast9 && gone9.cards.length === 0 && (await tokens(gm)).every((t) => before9.has(t.uuid)), { cast: gone9.cast, cards: gone9.cards.length });
  await openDialog("gm");
  await run(gm, P.warnsTake);
  await run(gm, P.confirm, { count: 1 });
  await clickPlaces("gm", 1);
  const fresh9 = await awaitFresh(before9, 1);
  const warns9g = await run(gm, P.warnsTake);
  check("9: the Judge's click beyond the range is warned in the same words and the creature is placed", warns9g.includes(outOfRange) && fresh9.length === 1, { warns: warns9g.length, placed: fresh9.length });
  const fin9 = await settle("gm", fresh9);
  check("9: the Judge's cast spent once and posted one cast card", fin9.state.cast === cast9 + 1 && fin9.state.castCards.length === 1, { cast: fin9.state.cast - cast9, castCards: fin9.state.castCards.length });
  await run(gm, P.clearWindows);
  // A calling arrives where its creature stands, so no range bounds the place.
  await reshape([summonRow({ summonFormat: "calling" })], { rangeFeet: 10 });
  const before9c = await standing();
  const d9c = await openDialog("player");
  check("9: a calling's band says it is called from where it stands, with no range", d9c.dialog && d9c.placement === (await loc("player", "MAGIC.cast.dialog.summonCalled")), { placement: d9c.placement });
  await run(player, P.warnsTake);
  await run(player, P.confirm, { count: 1 });
  await clickPlaces("player", 1);
  const fresh9c = await awaitFresh(before9c, 1);
  const warns9c = await run(player, P.warnsTake);
  check("9: a calling's click beyond the range is placed with no range notice", fresh9c.length === 1 && !warns9c.includes(outOfRange), { placed: fresh9c.length, warns: warns9c.length });
  await settle("player", fresh9c);
  await run(player, P.clearWindows);

  section("10. a declared summons is placed at its turn, with no second spend");
  const other10 = await run(gm, P.placeTokens, { sceneId, specs: [{ actorId: idOf(open), x: 1100, y: 700, name: "Summon Bystander", link: false, disposition: -1 }] });
  for (const t of other10) await track(t.uuid, "Token");
  const fight = await run(gm, P.combatNew, { sceneId, tokenIds: [casterToken[0].id, other10[0].id] });
  await track(fight.uuid, "Combat");
  try {
    const byToken = Object.fromEntries(fight.combatants.map((c) => [c.tokenId, c.id]));
    const set = await run(gm, P.combatSet, { combatId: fight.id, initiatives: { [byToken[other10[0].id]]: 30, [byToken[casterToken[0].id]]: 20 } });
    check("10: a fight is begun with the bystander first, so the caster is not on turn", set.turns === 2 && set.onTurn === other10[0].id, set);
    await reshape([summonRow()]);
    const before10 = await standing();
    const cast10 = (await castState("player")).cast;
    const d10 = await openDialog("player");
    check("10: the dialog's button reads Declare", d10.dialog && d10.castLabel === (await loc("player", "MAGIC.cast.dialog.declare")), { label: d10.castLabel });
    check("10: Declare is pressed in the Player's dialog", (await run(player, P.confirm, { count: 1 })).pressed);
    const pend = await until(player, P.pending, { casterId }, (r) => r.pending.length >= 1, { tries: 40, every: 250 });
    for (const u of pend.pending) await track(u, "ActiveEffect");
    const declared = await castState("player");
    for (const c of declared.cards) await track(`ChatMessage.${c}`, "ChatMessage");
    check("10: the declaration is one pending record and the casting status, the slot is spent once, no creature is placed and no cast card posts", pend.pending.length === 1 && pend.casting && declared.cast === cast10 + 1 && declared.castCards.length === 0 && (await tokens(gm)).every((t) => before10.has(t.uuid)), { pending: pend.pending.length, cast: declared.cast - cast10, castCards: declared.castCards.length });
    const turn = await run(gm, P.combatMove, { combatId: fight.id, update: { turn: 1 } });
    check("10: the tracker stands on the caster's turn", turn.onTurn === casterToken[0].id, turn);
    // The turn's cast asks no dialog: the pending record stands for it, and the click is the one thing asked.
    await run(player, P.useSpell, { casterId, spellId: act.id });
    await sleep(1500);
    check("10: no dialog opens at the turn", !(await run(player, P.band)).dialog);
    await clickPlaces("player", 1);
    const fresh10 = await awaitFresh(before10, 1);
    const fin10 = await settle("player", fresh10);
    check("10: the click at the turn places the declared creature, with no second spend, one cast card and the pending record gone", fresh10.length === 1 && fin10.state.cast === cast10 + 1 && fin10.state.castCards.length === 1 && (await run(player, P.pending, { casterId })).pending.length === 0, { placed: fresh10.length, cast: fin10.state.cast - cast10, castCards: fin10.state.castCards.length });
  } finally {
    if (await run(gm, P.combatDrop, { combatId: fight.id })) own.splice(own.indexOf(fight.uuid), 1);
    await run(player, P.clearWindows);
  }

  section("11. a held summons' end lists its creatures, with Dismiss on the Judge's seat only, and its control ends as its row says");
  for (const outcome of ["stays", "hostile"]) {
    await reshape([summonRow({ amount: 1, controlEnd: outcome })], { duration: HELD });
    const before11 = await standing();
    const d11 = await openDialog("player");
    note(`11 ${outcome}: the dialog and its Cast press`, { verdicts: d11.verdicts?.map((v) => v.text), pressed: await run(player, P.confirm, { count: 1 }) });
    await clickPlaces("player", 1);
    const fresh11 = await awaitFresh(before11, 1);
    const fin11 = await settle("player", fresh11);
    check(`11 ${outcome}: the held cast placed one creature and wrote a concentration record`, fresh11.length === 1 && fin11.records.length >= 1, { placed: fresh11.length, records: fin11.records.length });
    const pre = (await run(gm, P.summonTokens, { sceneId, summonerUuid: casterUuid, playerId })).find((t) => t.uuid === fresh11[0]?.uuid);
    check(`11 ${outcome}: before the end the Player holds ownership and the creature's control is not lost`, pre && pre.playerLevel >= 3 && !pre.lost, { level: pre?.playerLevel });
    await run(gm, P.endHeld, { casterId, status: "concentrating-and-stationary" });
    const cards = await until(gm, P.endCards, { castId: fin11.castId }, (l) => l.some((c) => c.held), { tries: 40, every: 250 });
    for (const c of cards) await track(c.uuid, "ChatMessage");
    check(`11 ${outcome}: ending the concentration posts the one funnel card`, cards.filter((c) => c.held).length === 1, { cards: cards.length });
    if (cards[0]) {
      const onGm = await run(gm, P.heldCard, { messageId: cards[0].id });
      const onPlayer = await run(player, P.heldCard, { messageId: cards[0].id });
      check(`11 ${outcome}: the card lists the standing creature on both seats, with Dismiss and Restore on the Judge's seat`, onGm.found && onGm.creatures === 1 && onGm.dismiss >= 1 && onGm.restore >= 1, onGm);
      check(`11 ${outcome}: the Player's seat lists the creature, with no Dismiss`, onPlayer.found && onPlayer.creatures === 1 && onPlayer.dismiss === 0, onPlayer);
    }
    const post = await until(gm, P.summonTokens, { sceneId, summonerUuid: casterUuid, playerId }, (l) => l.find((t) => t.uuid === fresh11[0]?.uuid)?.lost, { tries: 40, every: 250 });
    const mine = post.find((t) => t.uuid === fresh11[0]?.uuid);
    const onPlayerSeat = (await run(player, P.summonTokens, { sceneId, summonerUuid: casterUuid })).find((t) => t.uuid === fresh11[0]?.uuid);
    if (outcome === "stays") check("11 stays: the creature stands, is stamped lost, keeps the Player's ownership and its disposition", mine && mine.lost && mine.playerLevel >= 3 && mine.disposition === pre.disposition && onPlayerSeat?.owner === true, { lost: mine?.lost, level: mine?.playerLevel, same: mine?.disposition === pre?.disposition });
    else check("11 hostile: the creature stands, is stamped lost, the Player's ownership is gone and its disposition is hostile", mine && mine.lost && mine.playerLevel < 3 && mine.disposition === -1 && onPlayerSeat?.owner === false, { lost: mine?.lost, level: mine?.playerLevel, disposition: mine?.disposition });
    await run(gm, P.clearWindows);
    await run(player, P.clearWindows);
  }

  section("12. the delete path: a `gone` summons is removed at its timed end, by its own recorded tokens, and nothing else is touched");
  // The standing spell goes back to the shape its earlier casts were made under, which the clock also ends: they keep their creatures. The delete path is cast from a spell of its own, whose row is the only one that says `gone`.
  await reshape([summonRow()]);
  const goneSpell = await gm.fixture("magic/summon-spell-gone", "Item", { name: "QA Cast Summon Spell Gone", type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  act = { id: idOf(goneSpell), uuid: `${casterUuid}.Item.${idOf(goneSpell)}`, name: "QA Cast Summon Spell Gone" };
  await reshape([summonRow({ controlEnd: "gone" })]);
  const before12 = await standing();
  await openDialog("player");
  await run(player, P.confirm, { count: 2 });
  await clickPlaces("player", 2);
  const fresh12 = await awaitFresh(before12, 2);
  const fin12 = await settle("player", fresh12);
  check("12: the cast placed two creatures and wrote one timed caster record", fresh12.length === 2 && fin12.records.length === 1, { placed: fresh12.length, records: fin12.records.length });
  // A token of the same creature put there by hand: it carries no cast's record, so no cast's end may reach it.
  const decoyActor = String((copies[0]?.uuid ?? creatureUuid)).split(".").pop();
  const decoy = await run(gm, P.placeTokens, { sceneId, specs: [{ actorId: decoyActor, x: 1200, y: 100, name: "Decoy", link: false, disposition: -1 }] });
  for (const t of decoy) await track(t.uuid, "Token");
  const roster12 = await run(gm, P.sceneTokens, { sceneId });
  const goneUuids = new Set(fresh12.map((t) => t.uuid));
  const untouched = roster12.filter((t) => !goneUuids.has(t.uuid)).map((t) => t.uuid);
  check("12: the decoy stands among the field's tokens with no summons record", decoy.length === 1 && roster12.some((t) => t.uuid === decoy[0].uuid && !t.summoned), { decoy: decoy.length });
  const since12 = Date.now() - 1000;
  const t1 = await run(gm, P.worldTime);
  const t2 = await run(gm, P.advance, { seconds: 2 * 3600 + 60 });
  check("12: the world clock moved past the spell's two hours", t2 >= t1 + 2 * 3600, { moved: t2 - t1 });
  const left12 = await until(gm, P.summonTokens, { sceneId, summonerUuid: casterUuid }, (l) => l.filter((t) => goneUuids.has(t.uuid)).length === 0, { tries: 60, every: 300 });
  check("12: both of the cast's tokens are gone at the timed end", left12.filter((t) => goneUuids.has(t.uuid)).length === 0, { left: left12.filter((t) => goneUuids.has(t.uuid)).length });
  const after12 = await run(gm, P.sceneTokens, { sceneId });
  check("12: the decoy, the creatures of the other casts (which keep theirs) and every other token of the field still stand, and nothing was added", untouched.every((u) => after12.some((t) => t.uuid === u)) && after12.length === untouched.length, { untouched: untouched.length, now: after12.length });
  const cards12 = await run(gm, P.endCards, { castId: fin12.castId });
  check("12: no end card was posted for the removed cast: no Dismiss to press", cards12.length === 0, { cards: cards12.length });
  // The clock also ended the earlier casts of this caster (their rows keep their creatures), whose cards are the run's own: they are listed by the fixture they speak as and the cast ids it made.
  const stale12 = await run(gm, P.expiryCards, { casterUuid, since: since12 });
  for (const uuid of stale12) await track(uuid, "ChatMessage");
  act = { id: spellId, uuid: spellUuid, name: spellName };
  note("12: the creatures the module removed show as could-not-find in the sweep below", fresh12.length);
  await run(gm, P.clearWindows);

  section("14. a spell naming a creature the Player cannot observe: the row saves, the cast is refused, and an Observer grant lets the same press through");
  // The closed creature is brought to its shape at the step's start; the grant is taken off again in the finally.
  const closedSpell = await gm.fixture("magic/summon-spell-closed", "Item", { name: "QA Cast Summon Spell Closed", type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const start13 = await run(gm, P.setLevel, { uuid: otherUuid, userId: playerId, level: null });
  const readStart13 = await until(player, P.probe, { refs: [otherUuid] }, (p) => !p[0].observes);
  check("14: start shape: the closed creature holds no entry for the Player at default None, and the Player seat does not observe it", !start13.keyed && start13.stored === null && start13.def === 0 && !readStart13[0].observes, { keyed: start13.keyed, def: start13.def, observes: readStart13[0].observes });
  act = { id: idOf(closedSpell), uuid: `${casterUuid}.Item.${idOf(closedSpell)}`, name: closedSpell.name };
  const refusedText = await loc("player", "LIB.summons.refused.unreadable");
  const copies13Before = (await run(gm, P.copiesOf, { sourceUuid: otherUuid })).length;
  const before13 = await standing();
  /** The row written from the Player's seat, one document update; a refusal of the write is a failed save, not a thrown walk. */
  const saveAs = async (ref) => {
    try { return await run(player, P.saveRow, { casterId, spellId: act.id, ref }); } catch (err) { return { rows: 0, ref: null, error: String(err?.message ?? err).slice(0, 120) }; }
  };
  const refusals13 = async (how) => {
    const forged = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: otherUuid, sceneId, spellId: act.id, count: 1 });
    const api = await run(player, P.placeApi, { casterId, sourceUuid: otherUuid, spellId: act.id, count: 1 });
    check(`14: with the row naming the creature by ${how}, a forged relay request is refused unreadable and makes nothing`, !forged.ok && forged.reason === "unreadable" && forged.made === 0, forged);
    check(`14: with the row naming the creature by ${how}, the seat's own placement is refused unreadable`, !api.ok && api.reason === "unreadable", api);
  };
  try {
    // An open row first, so the Player's save below is a change the Judge's seat sees arrive.
    await reshape([{ type: "summon", amount: 1 }]);
    const byUuid = await saveAs(otherUuid);
    const readUuid = await until(gm, P.rowOf, { casterId, spellId: act.id }, (r) => r.ref === otherUuid);
    check("14: the Player, who owns the caster, saves a row naming the closed creature by uuid, and the Judge's seat reads the row back", byUuid.rows === 1 && byUuid.ref === otherUuid && readUuid.ref === otherUuid, { rows: byUuid.rows, error: byUuid.error ?? null });
    await refusals13("its uuid");
    const closedName = (await run(gm, P.levelOf, { uuid: otherUuid, userId: playerId })).name;
    const byName = await saveAs(closedName);
    const readName = await until(gm, P.rowOf, { casterId, spellId: act.id }, (r) => r.ref === closedName);
    check("14: the Player saves the row naming the closed creature by its name, and the Judge's seat reads the row back", closedName.length > 0 && byName.rows === 1 && byName.ref === closedName && readName.ref === closedName, { rows: byName.rows, error: byName.error ?? null });
    await refusals13("its name");
    // The real press runs on the uuid row, the one a creature resolves from.
    await saveAs(otherUuid);
    await until(gm, P.rowOf, { casterId, spellId: act.id }, (r) => r.ref === otherUuid);
    const cast13 = (await castState("player")).cast;
    await run(player, P.warnsTake);
    const press13 = await run(player, P.press, { casterId, spellId: act.id });
    check("14: the Cast button is pressed on the closed spell's row", press13.button);
    const band13 = await run(player, P.dialog, { spellName: act.name });
    let shown = !!band13.verdicts?.some((v) => v.text === refusedText);
    const confirm13 = band13.dialog && !band13.castDisabled ? await run(player, P.confirm, { count: 1 }) : null;
    await sleep(1500);
    const warns13 = await run(player, P.warnsTake);
    shown = shown || warns13.includes(refusedText);
    if (confirm13?.pressed) await cancelPlacement("player");
    check("14: the Cast press is refused in the seat's own words: the window shows the refusal as a verdict, or a warning names it", shown, { dialog: band13.dialog, verdicts: band13.verdicts?.map((v) => v.severity), castDisabled: band13.castDisabled, pressed: confirm13?.pressed ?? null, warns: warns13.length });
    const refused13 = await castState("player");
    const copiesNow13 = (await run(gm, P.copiesOf, { sourceUuid: otherUuid })).length;
    check("14: the refused press and the four requests before it made nothing and spent nothing: the cast count stands, no card posted, no token stands beyond the earlier ones, and the creature has no more world copies than before", refused13.cast === cast13 && refused13.cards.length === 0 && (await tokens(gm)).every((t) => before13.has(t.uuid)) && copiesNow13 === copies13Before, { cast: refused13.cast - cast13, cards: refused13.cards.length, copies: copiesNow13 - copies13Before });
    await run(player, P.clearWindows);

    const on = await run(gm, P.setLevel, { uuid: otherUuid, userId: playerId, level: 2 });
    const readOn = await until(player, P.probe, { refs: [otherUuid] }, (p) => p[0].observes);
    check("14: the Judge's seat grants the Player Observer on the closed creature and the Player seat reads it", on.stored === 2 && readOn[0].observes, { stored: on.stored, observes: readOn[0].observes });
    const press13b = await run(player, P.press, { casterId, spellId: act.id });
    check("14: the Cast button is pressed again", press13b.button && press13b.before === cast13);
    const band13b = await run(player, P.dialog, { spellName: act.name });
    check("14: with Observer granted the dialog offers the row's creature, shows no refusal and leaves Cast on", band13b.dialog && band13b.values?.[0] === otherUuid && !band13b.verdicts.some((v) => v.text === refusedText) && !band13b.castDisabled, { values: band13b.values?.length, verdicts: band13b.verdicts?.length, castDisabled: band13b.castDisabled });
    await run(player, P.confirm, { count: 1 });
    await clickPlaces("player", 1);
    const fresh13 = await awaitFresh(before13, 1);
    const fin13 = await settle("player", fresh13);
    const copies13 = await run(gm, P.copiesOf, { sourceUuid: otherUuid });
    if (!copies13Before) for (const c of copies13) await track(c.uuid, "Actor");
    check("14: the same press with Observer places the creature: one token, the cast count up by exactly one, one cast card", fresh13.length === 1 && fin13.state.cast === cast13 + 1 && fin13.state.castCards.length === 1, { placed: fresh13.length, cast: fin13.state.cast - cast13, castCards: fin13.state.castCards.length });
    check("14: the creature's world copy is owned by no player", copies13.length === 1 && copies13[0].noDefault && copies13[0].playerLevels === 0, { copies: copies13.length });
  } finally {
    const off = await run(gm, P.setLevel, { uuid: otherUuid, userId: playerId, level: null });
    const readOff = await until(player, P.probe, { refs: [otherUuid] }, (p) => !p[0].observes);
    check("14: the grant is taken off again: the closed creature holds no entry for the Player at default None, and the Player seat no longer observes it", !off.keyed && off.stored === null && off.def === 0 && !readOff[0].observes, { keyed: off.keyed, def: off.def, observes: readOff[0].observes });
    act = { id: spellId, uuid: spellUuid, name: spellName };
    await run(player, P.clearWindows);
  }

  // Read only: the level the Player seat holds on a creature of an imported shelf.
  const mark14 = shelfCreature ? await run(gm, P.importMark, { uuid: shelfCreature }) : null;
  if (!shelfCreature || !mark14?.imported) console.log(`SKIP  14: ${shelfCreature ? "the Judge seat's first shelf creature carries no importer mark" : "the Judge seat opens no monster compendium"}, so there is no imported creature to read the Player's level on`);
  else {
    const shelf = await run(player, P.shelfLevel, { uuid: shelfCreature });
    note("14: the Player seat's level on the imported creature's shelf", { visible: shelf.visible, level: shelf.level, observer: shelf.observer, inPack: shelf.inPack, resolves: shelf.resolves });
    check("14: the Player seat reads an imported creature's shelf as visible at Observer or better", shelf.inPack && shelf.visible === true && shelf.observer === true && typeof shelf.level === "number" && shelf.level >= 2, { visible: shelf.visible, level: shelf.level, observer: shelf.observer, resolves: shelf.resolves });
  }

  const pEnd = await run(player, P.drain);
  const gEnd = await run(gm, P.drain);
  check("no console error or uncaught error on the Player seat over the rest of the walk", !pEnd.errors.length && !pEnd.uncaught.length, { errors: pEnd.errors.length, uncaught: pEnd.uncaught.length });
  check("no console error or uncaught error on the GM seat over the walk", !gEnd.errors.length && !gEnd.uncaught.length, { errors: gEnd.errors.length, uncaught: gEnd.uncaught.length });

  // Last, because the seam logs a late spend on purpose and the drain above has already judged the console.
  section("6. a spend after the claimant's cast has returned, under libWrapper's invalid chain");
  const lateCaught = await run(gm, P.lateSpend, { casterId, spellId, mode: "caught" });
  note("libWrapper is the wrapper on the GM seat", lateCaught.libWrapper);
  check("6: a late spend the claimant reads resolves false, throws nothing, counts nothing and posts nothing, the seam logs it once, and Foundry raises no module-error notice", lateCaught.fired && lateCaught.answer === false && !lateCaught.threw && !lateCaught.rejected && lateCaught.cast === 0 && lateCaught.cards === 0 && lateCaught.logged === 1 && lateCaught.notices === 0 && lateCaught.uncaught === 0, lateCaught);
  const lateBare = await run(gm, P.lateSpend, { casterId, spellId, mode: "bare" });
  check("6: a late spend nobody reads or catches counts nothing and posts nothing, the seam logs it once, and Foundry raises no module-error notice and no uncaught error", lateBare.fired && !lateBare.threw && lateBare.cast === 0 && lateBare.cards === 0 && lateBare.logged === 1 && lateBare.notices === 0 && lateBare.uncaught === 0, lateBare);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (player) await run(player, P.noGm, { on: false }); } catch (err) { console.error("noGm restore:", err?.message ?? err); }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's own tokens, cards, records and copies go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  if (gm && wasPaused) {
    try { note("paused again", await run(gm, P.pause, { paused: true })); } catch (err) { console.error("pause restore:", err?.message ?? err); }
  }
  console.log("fixtures kept: magic/summon-caster, magic/summon-spell, magic/summon-spell-gone, magic/summon-spell-closed, magic/summon-creature, magic/summon-other, magic/summon-open, magic/summon-scene");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
