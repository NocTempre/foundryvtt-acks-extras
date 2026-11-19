/**
 * Live walk, magic-cast-tracked: the tracked spell rows (illusion, detect, light,
 * dispel, createObject, wall; tracked-row slice T), the five summon rows
 * (slice R) and a concentration summoning's held record (slice H), walked on
 * the GM and Player seats (docs/magic/TESTING.md, "Tracked rows and the built
 * summons"). The spells are the seat's own import from the RR by cookbook id; the
 * summoning spells the walk casts are built by hand on invented figures.
 *
 * Every imported figure is read from the world at runtime and compared; the
 * walk prints booleans, counts and relations, never a printed value, a card
 * line or a spell name. Each copy of an imported spell is reshaped at its step
 * from the library original's flag, with a duration of the walk's own (a fixed
 * two hours) so a record's absence is the row's doing and never an untimed
 * import's. A stage that throws records a failed check and lets the next one run.
 * A creature the Monster Manual prints is imported as setup on the GM seat when
 * the book is open; with it closed the one check that needs it prints SKIP.
 * Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `magic/tracked-scene`,
 * `magic/tracked-class`, `magic/tracked-caster` (a character the Player owns),
 * `magic/tracked-spell-<slug>` (a copy of each imported spell on the caster),
 * `magic/tracked-held-a`, `magic/tracked-held-b`, `magic/tracked-timed` (the
 * hand-built summoning spells), `magic/tracked-creature` (the creature they
 * name, a monster only the GM may observe) and `magic/tracked-target`. The run's
 * own tokens, cards, records, world copies and Combat are tracked by uuid and
 * swept alone. A paused world is unpaused for the run and paused again.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const KEY = "magic-cast-tracked-walk";
/** The walk's own duration for every imported copy: a fixed two hours, invented. */
const DURATION = { shape: "fixed", value: 2, unit: "hours" };
/** The caster level every cast resolves at (the class level): the walk's own figure. */
const LEVEL = 5;
const startedAt = Date.now();

/**
 * The tracked spells, by cookbook id: the kind of row each carries, whether the row lasts the duration, and, for a twin, the reversed row.
 * The kinds and the `lasts` words are the register's vocabulary; the walk checks the import carries them before it casts.
 */
const TRACKED = [
  { slug: "illusion", id: "def.spell.illusoryFigment", kind: "illusion", lasts: "duration" },
  { slug: "detect", id: "def.spell.discernMagic", kind: "detect", lasts: "duration" },
  { slug: "detect-instant", id: "def.spell.predictWeather", kind: "detect", lasts: "instant" },
  { slug: "light", id: "def.spell.illumination", kind: "light", lasts: "duration", twin: true },
  { slug: "dispel", id: "def.spell.counterspell", kind: "dispel", lasts: "instant" },
  { slug: "object", id: "def.spell.iceFloe", kind: "createObject", lasts: "duration" },
  { slug: "wall", id: "def.spell.wallOfSmoke", kind: "wall", lasts: "duration" },
  { slug: "detect-twin", id: "def.spell.discernEvil", kind: "detect", lasts: "duration", twin: true },
];
/** The five summoning and animation spells: which carry a ref, a format and a located count (the register's reading, checked as relations). */
const SUMMONS = [
  { slug: "calling", id: "def.spell.callOfTheWolf", ref: true, format: true, counted: true },
  { slug: "summoning", id: "def.spell.summonManes", ref: true, format: true, counted: false },
  { slug: "conjuration", id: "def.spell.conjureCacodemonSpawn", ref: false, format: true, counted: true },
  { slug: "companion", id: "def.spell.faithfulCompanion", ref: false, format: false, counted: false },
  { slug: "puppet", id: "def.spell.unlivingPuppet", ref: false, format: false, counted: false },
];
const IMPORTS = Object.fromEntries([...TRACKED, ...SUMMONS].map((s) => [s.slug, s.id]));

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const gap = (label, detail) => console.log(`GAP  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
const skip = (label, detail) => console.log(`SKIP  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page,   */
/*  so it closes over nothing and shares state through `__mct`.         */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mct = globalThis.__mct ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.cards = (actorId) => [...game.messages].filter((m) => m.speaker?.actor === actorId).map((m) => ({ id: m.id, kind: m.flags?.["acks-extras"]?.castHeldEnd ? "end" : m.flags?.["acks-extras"]?.castCard ? "cast" : "other" }));
    H.seen = new Set();
    H.watch = null;
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.infos = [];
      H.warnLog = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn;
      // Each warning is logged with what stood the instant it fired: the held casts' ids and the end cards' ids, so the order of a warning and an end is read from the world and never from clocks.
      ui.notifications.warn = function (msg, ...rest) {
        H.warns.push(String(msg));
        const actor = H.watch ? game.actors.get(H.watch) : null;
        H.warnLog.push({
          text: String(msg),
          held: [...(actor?.effects ?? [])].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.held).map((e) => e.flags["acks-extras"].spellEffect.castId),
          ended: [...game.messages].filter((m) => m.flags?.["acks-extras"]?.castHeldEnd).map((m) => m.flags["acks-extras"].castHeldEnd.castId),
        });
        return H.warn.call(this, msg, ...rest);
      };
      H.info = ui.notifications.info;
      ui.notifications.info = function (msg, ...rest) { H.infos.push(String(msg)); return H.info.call(this, msg, ...rest); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      H.onRejection = (e) => H.uncaught.push("rejection: " + String(e.reason?.message ?? e.reason ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, claimant: typeof globalThis.acksExtras?.lib?.spellUse?.addClaimant === "function" };
  },
  names: async ({ casterId, itemIds }) => {
    const actor = game.actors.get(casterId);
    return { caster: actor.name, items: Object.fromEntries(itemIds.map((id) => [id, actor.items.get(id)?.name ?? ""])) };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  /** Mark a point in the seat's logs, naming the caster whose held records a warning reads. */
  mark: async ({ casterId }) => {
    const H = globalThis.__mct;
    H.warns.length = 0;
    H.infos.length = 0;
    H.warnLog.length = 0;
    H.watch = casterId ?? null;
    return true;
  },
  /** What the seat's recorders hold since the last mark. */
  logs: async () => {
    const H = globalThis.__mct;
    return { warns: H.warns.slice(), infos: H.infos.slice(), warnLog: JSON.parse(JSON.stringify(H.warnLog)) };
  },
  /** The localized text of a cast notice, built from this seat's own strings (the key is split so the key scan reads a root, not a whole key). */
  notice: async ({ key, data }) => game.i18n.format("ACKS-" + "MAGIC.cast.notice." + key, data),
  /** This seat's localized card note for the reverse mode (the key is split, as in `notice`). */
  reversedNote: async () => game.i18n.localize("ACKS-" + "MAGIC.cast.note.reversed"),
  drain: async () => {
    const H = globalThis.__mct;
    const out = { errors: H.errors.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  /** GM: wait for the RR, import the spells, hand back each as plain data with the rows' shapes. */
  library: async ({ ids }) => {
    const H = globalThis.__mct;
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.poll(() => acksExtras.importer?.bookOpen?.("rr"), { tries: 600, every: 200 });
    const out = { rr: !!acksExtras.importer?.bookOpen?.("rr"), present: {}, payload: {}, rows: {} };
    if (out.rr) await acksExtras.importer.importSpells({ only: new Set(Object.values(ids)), repair: { replaced: 0, refused: 0, keptProse: 0 } });
    for (const [k, id] of Object.entries(ids)) {
      const doc = L.byCookbookId("Item", id, { original: true });
      out.present[k] = !!doc;
      if (doc) {
        const data = doc.toObject();
        for (const f of ["_id", "folder", "sort", "ownership"]) delete data[f];
        out.payload[k] = data;
        const effects = data.flags?.["acks-extras"]?.spell?.effects;
        const rows = Array.isArray(effects) ? effects : Object.values(effects ?? {});
        out.rows[k] = rows.map((r) => ({ type: r.type ?? "", lasts: r.lasts ?? "", reversed: !!r.reversed }));
      }
    }
    return out;
  },
  /** Bring one copy to a known shape from the library original: the flag deleted first, the lists naming the walk's class, the walk's own duration, no range. */
  shapeSpell: async ({ casterId, itemId, original, duration, unlimited }) => {
    const item = game.actors.get(casterId).items.get(itemId);
    const flag = foundry.utils.deepClone(original ?? {});
    flag.lists = [{ source: "arcane", level: 1, classes: [], note: "" }];
    flag.target = { ...(flag.target ?? {}) };
    if (unlimited) { flag.range = { shape: "unlimited" }; flag.target.count = null; }
    if (!flag.target.model) flag.target.model = "creature";
    if (duration) flag.duration = duration;
    await item.update({ "flags.acks-extras.-=spell": null });
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": flag });
    const read = item.getFlag("acks-extras", "spell") ?? {};
    const rows = Array.isArray(read.effects) ? read.effects : Object.values(read.effects ?? {});
    return { rows: rows.length, types: rows.map((r) => r.type), reversed: rows.filter((r) => r.reversed).length };
  },
  /** A hand-built summoning spell: one summon row naming the creature, and the given duration; the flag is deleted first. */
  shapeSummon: async ({ casterId, itemId, ref, amount, duration }) => {
    const item = game.actors.get(casterId).items.get(itemId);
    await item.update({ "flags.acks-extras.-=spell": null });
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": { schools: ["summoning"], effects: [{ type: "summon", ref, amount }], duration } });
    return { cast: item.system.cast, rows: item.getFlag("acks-extras", "spell")?.effects?.length ?? 0, summoning: acksExtras.magic?.isSummonSpell?.(item) ?? null };
  },
  shapeCaster: async ({ casterId, classUuid, level }) => {
    await game.actors.get(casterId).update({ "system.details.level": level, "system.spells.enabled": true, "flags.acks-extras.classes.uuid": classUuid, "flags.acks-extras.classes.pools": { arcane: { s1: 0 } } });
    return true;
  },
  setSpent: async ({ casterId }) => {
    await game.actors.get(casterId).update({ "flags.acks-extras.classes.pools": { arcane: { s1: 0 } } });
    return true;
  },
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
  /** Tokens from specs, answered by actor: a create's answer is not in the order of its data. */
  placeTokens: async ({ sceneId, specs }) => {
    const scene = game.scenes.get(sceneId);
    const made = await scene.createEmbeddedDocuments("Token", specs.map((s) => ({ actorId: s.actorId, x: s.x, y: s.y, name: s.name, actorLink: s.link !== false, disposition: s.disposition ?? -1 })));
    return specs.map((s) => made.find((t) => t.actorId === s.actorId)).filter(Boolean).map((t) => ({ id: t.id, uuid: t.uuid, actorId: t.actorId, name: t.name }));
  },
  target: async ({ sceneId, tokenIds }) => {
    if (canvas.scene?.id !== sceneId) return -1;
    canvas.tokens.setTargets(tokenIds, { mode: "replace" });
    await new Promise((r) => setTimeout(r, 300));
    return [...game.user.targets].map((t) => t.id);
  },
  worldTime: async () => game.time.worldTime,
  /**
   * Cast as a user does: `item.use()`, then the dialog (its modes and Cast button read), then Cast. Answers what the dialog showed, the card and its model, and what this seat's own user
   * made in the settle after it: how many messages, and how many of them carry a roll.
   */
  cast: async ({ casterId, spellId, mode }) => {
    const H = globalThis.__mct;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    item.use({ skipDialog: true });
    const found = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    // The window re-renders on every change, so each read goes back to the live element.
    const live = () => document.querySelector(".application.acks-extras-cast") ?? found;
    // The form is a segmented radio group in the header, drawn only where the spell has more than one.
    const modes = [...live().querySelectorAll('input[name="mode"]')].map((r) => r.value);
    const modeRadio = mode ? live().querySelector(`input[name="mode"][value="${mode}"]`) : null;
    if (modeRadio) { modeRadio.checked = true; modeRadio.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(300); }
    const castButton = live().querySelector('button[data-action="cast"]');
    const shown = { dialog: true, modes, castDisabled: !!castButton?.disabled, severities: [...live().querySelectorAll(".acks-extras-cast-verdicts li")].map((li) => li.dataset.severity) };
    if (castButton.disabled) {
      live().querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { ...shown, card: false };
    }
    live().querySelector('button[data-action="cast"]').click();
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 120, every: 250 });
    if (!message) return { ...shown, card: false };
    await H.sleep(1500);
    const fresh = [...game.messages].filter((m) => !before.has(m.id) && m.author?.id === game.user.id);
    // A cast posts two cards: core's spell card (the spend's own showChatCard, speaking as the caster) and the module's cast card, which carries the flag.
    const castCards = fresh.filter((m) => !!m.flags?.["acks-extras"]?.castCard).length;
    const spellCards = fresh.filter((m) => !m.flags?.["acks-extras"]?.castCard && m.speaker?.actor === casterId).length;
    return { ...shown, card: true, messageId: message.id, model: game.messages.get(message.id).flags["acks-extras"].castCard, fresh: fresh.length, castCards, spellCards, rolled: fresh.filter((m) => (m.rolls?.length ?? 0) > 0).length, freshIds: fresh.map((m) => m.id) };
  },
  /** What a card's rendered body shows: its sections, its note, its footnote, its buttons. */
  seen: async ({ messageId }) => {
    const H = globalThis.__mct;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(500);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    const card = el?.querySelector(".acks-extras-roll-card") ?? null;
    return {
      found: !!el,
      sections: el?.querySelectorAll("h4.acks-extras-roll-section").length ?? 0,
      note: el?.querySelector(".acks-extras-roll-note")?.textContent?.trim() ?? null,
      footnote: el?.querySelector(".acks-extras-roll-footnote")?.textContent?.trim() ?? null,
      buttons: card ? card.querySelectorAll("button").length : 0,
      actions: [...(el?.querySelectorAll("[data-action^='magicCast'], [data-action^='libAttack']") ?? [])].map((b) => b.dataset.action),
    };
  },
  /** The spell records on an actor: the mark, the kind held, the tail and the status; the duration is the flag's where the engine timed the record itself, else core's. */
  records: async ({ actorId }) => {
    const a = game.actors.get(actorId);
    return [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect).map((e) => {
      const f = e.flags["acks-extras"].spellEffect;
      return { id: e.id, uuid: e.uuid, name: e.name ?? "", castId: f.castId, role: f.role ?? null, held: f.held ?? null, tail: f.tail ?? null, startTime: f.startTime ?? null, hasDuration: f.duration != null, duration: f.duration ? { value: f.duration.value ?? null, units: f.duration.units ?? null } : e.duration?.value != null ? { value: e.duration.value, units: e.duration.units ?? null } : null, statuses: [...e.statuses], pending: !!f.pending };
    });
  },
  /** The funnel's end cards since a time, with what each offers. */
  endCards: async ({ since }) => [...game.messages].filter((m) => m.timestamp >= since && m.flags?.["acks-extras"]?.castHeldEnd).map((m) => ({
    uuid: m.uuid,
    castId: m.flags["acks-extras"].castHeldEnd.castId,
    cause: m.flags["acks-extras"].castHeldEnd.cause,
    dismiss: String(m.content).includes("data-acks-extras-cast-dismiss"),
    restore: String(m.content).includes("data-acks-extras-held-restore"),
  })),
  /** The status's own toggle off, as the HUD does it: the real trigger of a concentration's end that needs no cause of its own. */
  endHeld: async ({ casterId, status }) => { await game.actors.get(casterId).toggleStatusEffect(status, { active: false }); return true; },
  /** The summon rows of a copy as the module reads them, as booleans and the row's own words, and what the policy says to counts (a refusal word or null). */
  summonRead: async ({ casterId, itemId, counts, importMissing }) => {
    const S = await import("/modules/acks-extras/scripts/magic/cast-summon.mjs");
    const M = await import("/modules/acks-extras/scripts/magic/summon-spell.mjs");
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    const item = game.actors.get(casterId).items.get(itemId);
    const rows = S.summonRowsOf(item);
    const row = rows[0] ?? null;
    const refusal = {};
    for (const n of counts) refusal[n] = row ? S.summonRefusal({ spell: item, count: n, user: game.user, source: null, sourceRef: row.ref || "any-creature" }) : "norow";
    let resolves = null;
    let imported = false;
    const mmOpen = !!acksExtras.importer?.bookOpen?.("mm");
    const resolve = async () => !!(await M.resolveSummonRef(row.ref, { fromUuid: (u) => fromUuid(u), byCookbookId: L.byCookbookId }));
    if (row?.ref) {
      resolves = await resolve();
      // On the GM seat a missing creature is imported here, page-side, so the ref id never reaches the walk's log: a creature the Monster Manual prints is setup, not a gap.
      if (!resolves && importMissing && mmOpen) {
        await acksExtras.importer.cookbookImportIds([row.ref]);
        imported = true;
        resolves = await resolve();
      }
    }
    return {
      mmOpen,
      imported,
      rows: rows.length,
      hasRef: !!row?.ref,
      format: !!row?.summonFormat,
      control: !!row?.control,
      amount: row?.amount ?? null,
      hasValue: row?.value != null,
      hasMax: row?.max != null,
      maxKeys: row?.max && typeof row.max === "object" ? Object.keys(row.max).length : 0,
      isSummonSpell: M.isSummonSpell(item),
      resolves,
      refusal,
    };
  },
  /** Press Cast on a copy as the claimant sees it (the call is not awaited), then read the creature prompt without answering it. */
  openPrompt: async ({ casterId, itemId }) => {
    const H = globalThis.__mct;
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const item = game.actors.get(casterId).items.get(itemId);
    item.use({ skipDialog: true });
    const form = await H.poll(() => [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count), { tries: 60, every: 200 });
    if (!form) return { prompt: false };
    const options = [...form.elements.source.options];
    return { prompt: true, choices: options.length, labelled: options.every((o) => o.textContent.trim().length > 0), count: form.elements.count.value, countMax: Number(form.elements.count.max) };
  },
  /** Close every framed window, open the caster's sheet on its Magic tab and press the spell row's Cast button as a user does. Nothing is awaited: the prompt is the answer. */
  press: async ({ casterId, spellId }) => {
    const H = globalThis.__mct;
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    await actor.sheet.render(true);
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("magic", "primary");
    await H.sleep(500);
    const button = H.root(actor.sheet)?.querySelector(`[data-item-id='${spellId}'] [data-action='spellCast']`);
    if (!button) return { button: false };
    H.seen = new Set(H.cards(casterId).map((c) => c.id));
    const before = item.system.cast;
    button.click();
    return { button: true, before };
  },
  /** The creature prompt, once it is up: its choices, its count, its title. */
  prompt: async ({ spellName }) => {
    const H = globalThis.__mct;
    const form = await H.poll(() => [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count), { tries: 60, every: 200 });
    if (!form) return { prompt: false };
    return { prompt: true, choices: form.elements.source.options.length, count: form.elements.count.value, titled: form.closest(".application")?.querySelector(".window-title")?.textContent.trim() === spellName };
  },
  /** Answer the prompt (the count, then Place on the map), then clear every framed window off the map. */
  answer: async ({ count }) => {
    const H = globalThis.__mct;
    const form = [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count);
    if (!form) return { prompt: false };
    if (count) form.elements.count.value = String(count);
    const ok = form.querySelector('button[data-action="ok"]') ?? form.closest(".application")?.querySelector('button[data-action="ok"]');
    ok?.click();
    await H.sleep(500);
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    await H.sleep(500);
    return { prompt: true, pressed: !!ok };
  },
  /** Close the prompt window itself, as a user dismisses it. */
  dismissPrompt: async () => {
    const H = globalThis.__mct;
    const form = [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count);
    const app = form ? foundry.applications.instances.get(form.closest(".application")?.id) : null;
    if (!app) return false;
    await app.close({ animate: false });
    await H.sleep(800);
    return true;
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* a notice left standing is only chrome over the map */ }
    return true;
  },
  /** The viewport's middle in client points, where the driver parks the pointer before the view is panned. */
  middle: async () => ({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) }),
  /**
   * One client point, found by scanning the viewport for bare canvas well inside the scene, at least 60 px from every viewport edge (core's placement pans the view while the pointer is in
   * the edge band) and at least a grid cell and a half from every point in `avoid`. Always answers the view it scanned, so a miss is read from the log.
   */
  pointFor: async ({ avoid = [] }) => {
    const r = canvas.dimensions.sceneRect;
    const snap = () => `${canvas.stage.scale.x.toFixed(3)}:${Math.round(canvas.stage.pivot.x)}:${Math.round(canvas.stage.pivot.y)}`;
    let last = "";
    for (let n = 0; n < 12; n++) {
      canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: 0.5 });
      await new Promise((res) => setTimeout(res, 500));
      const now = snap();
      if (now === last) break;
      last = now;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const found = [];
    for (let y = 60; y <= H - 60; y += 30) {
      for (let x = 60; x <= W - 60; x += 30) {
        if (document.elementFromPoint(x, y) !== canvas.app.view) continue;
        const back = canvas.canvasCoordinatesFromClient({ x, y });
        if (back.x >= r.x + 100 && back.y >= r.y + 100 && back.x <= r.x + r.width - 100 && back.y <= r.y + r.height - 100) found.push({ x, y });
      }
    }
    const pointer = canvas.app?.renderer?.events?.rootPointerEvent;
    const view = { pivot: [Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y)], scale: Number(canvas.stage.scale.x.toFixed(3)), pointer: pointer ? [Math.round(pointer.clientX), Math.round(pointer.clientY)] : null, hidden: document.hidden, viewport: [W, H], found: found.length };
    if (!found.length) return { x: 0, y: 0, onCanvas: false, view };
    const cx = found.reduce((a, p) => a + p.x, 0) / found.length;
    const cy = found.reduce((a, p) => a + p.y, 0) / found.length;
    found.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const apart = Math.max(120, canvas.dimensions.size * canvas.stage.scale.x * 1.5);
    const pick = found.find((p) => avoid.every((o) => Math.hypot(p.x - o.x, p.y - o.y) >= apart));
    return pick ? { x: pick.x, y: pick.y, onCanvas: true, view } : { x: 0, y: 0, onCanvas: false, view };
  },
  /** The cast count and the cards made since the last press, each as its kind. */
  state: async ({ casterId, spellId }) => {
    const H = globalThis.__mct;
    const item = game.actors.get(casterId).items.get(spellId);
    return { cast: item.system.cast, cards: H.cards(casterId).filter((c) => !H.seen.has(c.id)) };
  },
  summonTokens: async ({ sceneId, summonerUuid }) =>
    [...game.scenes.get(sceneId).tokens]
      .filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === summonerUuid)
      .map((t) => ({ uuid: t.uuid, castId: t.actor.getFlag("acks-extras", "summon")?.castId ?? null, owner: t.isOwner && !!t.actor?.isOwner })),
  /** The world copies of a source: their uuid. */
  copiesOf: async ({ sourceUuid }) => game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid).map((a) => ({ uuid: a.uuid })),
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
    return { round: combat.round, started: combat.round > 0, turns: combat.turns.length, onTurn: combat.combatant?.tokenId ?? null };
  },
  /** Whether any combatant of the fight carries a declared-spell flag of this module (the flag names are read, not guessed). */
  declared: async ({ combatId }) => game.combats.get(combatId)?.combatants.filter((c) => Object.keys(c.flags?.["acks-extras"] ?? {}).some((k) => /declar/iu.test(k))).length ?? null,
  /** Delete the Combat; true once the world no longer holds it. */
  combatDrop: async ({ combatId }) => { await game.combats.get(combatId)?.delete(); return !game.combats.get(combatId); },
  restore: async () => {
    const H = globalThis.__mct;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
    ui.notifications.info = H.info;
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

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic && !!globalThis.acksExtras?.lib?.summons`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A CDP session on a seat's page, for real mouse input and bringing it to the front. */
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
/**
 * Park the seat's pointer in the viewport's middle. Core's placement pans the canvas while the pointer stands in the 50 px edge band (where the Place button left it),
 * which would move the view under the scan; this runs before every pan.
 */
async function centerPointer(seat, port) {
  const { x, y } = await run(seat, P.middle);
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  s.close();
  await sleep(400);
  return { x, y };
}

let gm = null;
let player = null;
let wasPaused = false;
/** The uuids of what this run made: the only documents teardown deletes. */
const own = [];
/** The cast ids this run made, and the fixture actors it got back from the ledger (the teardown's lists are keyed on these, never on a marker pattern). */
const castIds = [];
const fixtureActors = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_800_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** A stage runs apart: a throw in one is a failed check and the next stage still runs; a blocked walk stays blocked. */
async function stage(name, fn) {
  section(name);
  try { await fn(); } catch (err) {
    if (err instanceof WalkBlocked) throw err;
    console.error(`WALK ERROR (${name}):`, err?.stack ?? err);
    check(`${name} ran to the end`, false, String(err?.message ?? err).slice(0, 200));
  }
}

/** Poll a driver read until `test(result)` holds or the tries run out; the last read is returned. */
async function until(read, test, { tries = 40, every = 300 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await read();
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}

const W = { names: {} };
const used = { gm: [], player: [] };
const recordsOf = () => run(gm, P.records, { actorId: W.caster });
const tokensOf = () => run(gm, P.summonTokens, { sceneId: W.scene, summonerUuid: W.casterUuid });
const aim = async (seat, tokens) => {
  const got = await run(seat, P.target, { sceneId: W.scene, tokenIds: tokens.map((t) => t.id) });
  if (!Array.isArray(got) || got.length !== tokens.length) throw new Error(`the seat holds ${JSON.stringify(got)} as targets, not ${tokens.length}`);
};
/** A copy of an imported spell on the caster, brought to a shape from the library original's flag. */
const shape = (slug, duration = DURATION) => run(gm, P.shapeSpell, { casterId: W.caster, itemId: W.spell[slug], original: W.lib.payload[slug]?.flags?.["acks-extras"]?.spell, duration, unlimited: true });
/** A cast on a seat; spends nothing (the pool is zeroed first), and tracks the card, its cast id and the messages the cast made. */
async function castAs(seat, o) {
  await run(gm, P.setSpent, { casterId: W.caster });
  const c = await run(seat, P.cast, { casterId: W.caster, ...o });
  if (c.model?.castId) castIds.push(c.model.castId);
  for (const id of c.freshIds ?? []) await track(`ChatMessage.${id}`, "ChatMessage");
  return c;
}
/** The caster's records of one cast, each tracked by its uuid. */
async function castRecords(castId, want) {
  const read = () => recordsOf().then((all) => all.filter((r) => r.castId === castId));
  const list = want > 0 ? await until(read, (l) => l.length >= want, { tries: 20, every: 250 }) : (await sleep(1500), await read());
  for (const r of list) await track(r.uuid, "ActiveEffect");
  return list;
}

/**
 * Cast a summoning spell as a user does: press its Cast on the Magic tab, read the prompt, place by one real click per creature, and report what changed.
 * The pointer is parked mid-viewport before each pan and a failure after the prompt is answered right-clicks the pending placement away (docs/magic/TESTING.md, "Casting a summoning spell").
 * @returns {Promise<{pressed: boolean, prompt: object, fresh: object[], castId: string|null, cast: number, cards: object[]}>}
 */
async function place(label, who, spellId, count = 1) {
  const seat = who === "gm" ? gm : player;
  const port = who === "gm" ? PORTS.gm : PORTS.player;
  const before = await tokensOf();
  const standing = new Set(before.map((t) => t.uuid));
  const pressed = await run(seat, P.press, { casterId: W.caster, spellId });
  if (!pressed.button) throw new Error(`${label}: no Cast button on the Magic tab`);
  const prompt = await run(seat, P.prompt, { spellName: W.names[spellId] });
  if (!prompt.prompt) throw new Error(`${label}: the creature prompt did not open`);
  await run(seat, P.answer, { count });
  try {
    await frontSeat(port);
    for (let n = 0; n < count; n++) {
      await centerPointer(seat, port);
      const p = await run(seat, P.pointFor, { avoid: used[who] });
      if (!p.onCanvas) throw new Error(`${label}: no bare canvas point for a click: ${JSON.stringify(p.view)}`);
      used[who].push({ x: p.x, y: p.y });
      await clickAt(port, p);
    }
  } catch (err) {
    // The placement is still pending: a right click cancels it, so the next stage does not inherit a live preview.
    try { await clickAt(port, await run(seat, P.middle), "right"); } catch { /* the original failure is the one to report */ }
    throw err;
  }
  const after = await until(tokensOf, (l) => l.filter((t) => !standing.has(t.uuid)).length >= count, { tries: 40, every: 300 });
  await sleep(1500);
  const fresh = after.filter((t) => !standing.has(t.uuid));
  for (const t of fresh) await track(t.uuid, "Token");
  const settled = await run(seat, P.state, { casterId: W.caster, spellId });
  for (const c of settled.cards) await track(`ChatMessage.${c.id}`, "ChatMessage");
  const castId = fresh[0]?.castId ?? null;
  if (castId) castIds.push(castId);
  return { pressed: pressed.button, before: pressed.before, prompt, fresh, castId, cast: settled.cast, cards: settled.cards };
}

/* ---------------------------- A. setup ------------------------------ */
async function stageSetup() {
  W.playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!W.playerId) throw new Error("no Player user on this world");
  W.lib = await run(gm, P.library, { ids: IMPORTS });
  if (!W.lib.rr) blocked("the RR is not open on the GM seat: connect it through the Your ACKS Books macro, then run again");
  const missing = Object.entries(W.lib.present).filter(([, ok]) => !ok).map(([k]) => k);
  check("A: every spell of the walk is imported from the seat's RR", missing.length === 0, missing);
  if (missing.length) throw new Error("the import is missing spells; re-import them");
  // The import carries the register's rows: each tracked spell its kind, its `lasts` and, for a twin, a reversed row; each summoning spell one summon row.
  for (const t of TRACKED) {
    const rows = W.lib.rows[t.slug];
    const mine = rows.filter((r) => r.type === t.kind);
    check(`A ${t.slug}: the import carries a ${t.kind} row that lasts ${t.lasts}${t.twin ? ", and a reversed twin" : ""}`, mine.some((r) => r.lasts === t.lasts && !r.reversed) && (!t.twin || mine.some((r) => r.reversed)), rows);
  }
  for (const s of SUMMONS) check(`A ${s.slug}: the import carries one summon row`, W.lib.rows[s.slug].filter((r) => r.type === "summon").length === 1, W.lib.rows[s.slug]);
  const scene = await gm.fixture("magic/tracked-scene", "Scene", { name: "QA Tracked Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a5f6b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  const cls = await gm.fixture("magic/tracked-class", "Item", { name: "QA Tracked Class", type: "acks-extras.class", system: { key: "qatrackedclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 9 }] }] } });
  const caster = await gm.fixture("magic/tracked-caster", "Actor", { name: "QA Tracked Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.playerId]: 3 } });
  const creature = await gm.fixture("magic/tracked-creature", "Actor", { name: "QA Tracked Creature", type: "monster", ownership: { default: 0 } });
  const target = await gm.fixture("magic/tracked-target", "Actor", { name: "QA Tracked Target", type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
  W.scene = idOf(scene);
  W.caster = idOf(caster);
  W.casterUuid = `Actor.${W.caster}`;
  W.creatureUuid = `Actor.${idOf(creature)}`;
  W.target = idOf(target);
  fixtureActors.push(W.caster, idOf(creature), W.target);
  W.spell = {};
  let n = 0;
  for (const slug of Object.keys(IMPORTS)) {
    const doc = await gm.fixture(`magic/tracked-spell-${slug}`, "Item", { ...W.lib.payload[slug], name: `QA Tracked spell ${++n}` }, { parent: caster.uuid });
    W.spell[slug] = idOf(doc);
  }
  for (const [slug, name] of [["held-a", "QA Tracked Held A"], ["held-b", "QA Tracked Held B"], ["timed", "QA Tracked Timed"]]) {
    const doc = await gm.fixture(`magic/tracked-${slug}`, "Item", { name, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
    W.spell[slug] = idOf(doc);
  }
  // Names are read back from the world: a kept fixture may carry another spelling than the one it was built with, and a notice names what is there.
  const named = await run(gm, P.names, { casterId: W.caster, itemIds: Object.values(W.spell) });
  W.names.caster = named.caster;
  Object.assign(W.names, named.items);
  await run(gm, P.shapeCaster, { casterId: W.caster, classUuid: cls.uuid, level: LEVEL });
  // The shapes a step needs, asserted at the start: the caster carries no spell record and no summon of a run that did not sweep.
  const stale = await recordsOf();
  const standing = await tokensOf();
  if (stale.length || standing.length) blocked(`the kept caster carries ${stale.length} spell records and ${standing.length} summons of a run that did not sweep; remove them by id and run again`);
  const placed = await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: W.caster, name: "Tracked Caster", x: 100, y: 300, disposition: 1 }, { actorId: W.target, name: "Tracked Target", x: 300, y: 300 }] });
  for (const t of placed) await track(t.uuid, "Token");
  check("A: two linked tokens stand on the field", placed.length === 2);
  W.t = { caster: placed.find((t) => t.actorId === W.caster), target: placed.find((t) => t.actorId === W.target) };
  check("A: both seats view the field", (await run(player, P.view, { sceneId: W.scene })) && (await run(gm, P.view, { sceneId: W.scene })));
  W.creatureCopiesBefore = (await run(gm, P.copiesOf, { sourceUuid: W.creatureUuid })).length;
  await run(gm, P.mark, { casterId: W.caster });
  await run(player, P.mark, { casterId: W.caster });
  await run(gm, P.drain);
  await run(player, P.drain);
}

/* ------------------------ B. tracked kinds ---------------------------- */
/** One tracked cast from the Player seat with no target held; where the dialog is blocked the Judge's seat casts, with no target either, and a GAP says so. */
async function castTracked(slug, mode) {
  await shape(slug);
  await aim(player, []);
  let c = await castAs(player, { spellId: W.spell[slug], mode });
  let seat = player;
  if (!c.card && c.castDisabled) {
    gap(`${slug}: the Player's dialog is blocked with no target held; cast from the Judge's seat, which a verdict warns and never blocks`, c.severities);
    await aim(gm, []);
    c = await castAs(gm, { spellId: W.spell[slug], mode });
    seat = gm;
  }
  return { c, seat };
}

async function stageTracked() {
  for (const t of TRACKED.filter((x) => !x.twin)) {
    const { c, seat } = await castTracked(t.slug);
    const model = c.model;
    check(`B ${t.slug}: the cast posts a card`, c.card, { dialog: c.dialog, disabled: c.castDisabled });
    if (!c.card) continue;
    const lines = model.lines ?? [];
    check(`B ${t.slug}: the card carries one line for the row and it says something`, lines.length === 1 && lines[0].length > 0, { lines: lines.length });
    const view = await run(seat, P.seen, { messageId: c.messageId });
    check(`B ${t.slug}: the card's footnote shows the line`, view.found && view.footnote === lines.join(" · "), { found: view.found });
    check(`B ${t.slug}: nothing is rolled: no row, no target, no entry, and the cast made one cast card beside the system's spell card the spend posts, and no roll`, (model.order ?? []).length === 0 && Object.keys(model.rows ?? {}).length === 0 && Object.keys(model.targets ?? {}).length === 0 && Object.keys(model.entries ?? {}).length === 0 && c.castCards === 1 && c.spellCards === 1 && c.fresh === 2 && c.rolled === 0, { fresh: c.fresh, castCards: c.castCards, spellCards: c.spellCards, rolled: c.rolled });
    const records = await castRecords(model.castId, t.lasts === "duration" ? 1 : 0);
    const casters = records.filter((r) => r.role === "caster");
    if (t.lasts === "duration") check(`B ${t.slug}: a row that lasts the duration writes exactly one caster record, timed by the walk's duration`, records.length === 1 && casters.length === 1 && casters[0].duration?.value === DURATION.value && casters[0].duration?.units === DURATION.unit && !casters[0].pending, records.map((r) => ({ role: r.role, duration: r.duration })));
    else check(`B ${t.slug}: an instant row writes no record, though the spell is timed`, records.length === 0, { records: records.length });
  }
}

/* ------------------------ C. reversed twins --------------------------- */
async function stageReversed() {
  for (const t of TRACKED.filter((x) => x.twin)) {
    const normal = await castTracked(t.slug, "normal");
    const reversed = await castTracked(t.slug, "reversed");
    check(`C ${t.slug}: the dialog offers the reverse mode and both casts post a card`, normal.c.card && reversed.c.card && reversed.c.modes.includes("reversed"), { modes: reversed.c.modes?.length });
    if (!(normal.c.card && reversed.c.card)) continue;
    const a = normal.c.model;
    const b = reversed.c.model;
    check(`C ${t.slug}: each form posts only its own line, and the reverse mode's card is in the reverse mode`, a.mode !== "reversed" && b.mode === "reversed" && (a.lines ?? []).length === 1 && (b.lines ?? []).length === 1, { normal: a.mode, reversed: b.mode });
    // The register's twins differ in key and the reversed flag alone, so the two lines read alike; the reverse card is told apart by its note.
    const viewA = await run(normal.seat, P.seen, { messageId: normal.c.messageId });
    const viewB = await run(reversed.seat, P.seen, { messageId: reversed.c.messageId });
    const word = await run(reversed.seat, P.reversedNote);
    const wordA = await run(normal.seat, P.reversedNote);
    check(`C ${t.slug}: the reverse card's note says reversed and the normal card's does not`, !!word && !!wordA && (viewB.note ?? "").includes(word) && !(viewA.note ?? "").includes(wordA), { normalNote: viewA.note !== null, reversedNote: viewB.note !== null });
    check(`C ${t.slug}: each footnote is its own card's line`, viewA.footnote === a.lines.join(" · ") && viewB.footnote === b.lines.join(" · "), { normal: viewA.footnote !== null, reversed: viewB.footnote !== null });
    const ra = await castRecords(a.castId, 1);
    const rb = await castRecords(b.castId, 1);
    check(`C ${t.slug}: each form's cast writes its own one caster record`, ra.length === 1 && rb.length === 1 && ra[0].role === "caster" && rb[0].role === "caster" && a.castId !== b.castId, { normal: ra.length, reversed: rb.length });
  }
}

/* ------------------------ D. no throw row ----------------------------- */
async function stageDispel() {
  const slug = "dispel";
  // Once with nothing targeted, once with the Judge's seat aiming at a token: a measured target never makes a dispel row a throw row.
  const free = await castTracked(slug);
  await shape(slug);
  await aim(gm, [W.t.target]);
  const aimed = await castAs(gm, { spellId: W.spell[slug] });
  await aim(gm, []);
  for (const [label, c, seat] of [["untargeted", free.c, free.seat], ["aimed at a token", aimed, gm]]) {
    check(`D ${label}: the dispel cast posts a card`, c.card);
    if (!c.card) continue;
    const view = await run(seat, P.seen, { messageId: c.messageId });
    check(`D ${label}: a dispel row with no delivery is a line and not a throw row: no section, no buttons, no entry`, view.sections === 0 && view.buttons === 0 && view.actions.length === 0 && Object.keys(c.model.entries ?? {}).length === 0 && (c.model.order ?? []).length === 0, { sections: view.sections, buttons: view.buttons, actions: view.actions });
    await castRecords(c.model.castId, 0);
  }
}

/* ------------------------ E. the summon rows (R) ---------------------- */
async function stageSummonRows() {
  for (const s of SUMMONS) {
    await run(gm, P.shapeSpell, { casterId: W.caster, itemId: W.spell[s.slug], original: W.lib.payload[s.slug]?.flags?.["acks-extras"]?.spell, duration: null, unlimited: false });
    const read = await run(player, P.summonRead, { casterId: W.caster, itemId: W.spell[s.slug], counts: [2, 5] });
    // The GM's client resolves a row's creature, so whether a ref resolves is read on that seat.
    const onGm = await run(gm, P.summonRead, { casterId: W.caster, itemId: W.spell[s.slug], counts: [], importMissing: true });
    read.resolves = onGm.resolves;
    check(`E ${s.slug}: the module reads one summon row from the copy, and the copy is a summoning spell`, read.rows === 1 && read.isSummonSpell, { rows: read.rows });
    check(`E ${s.slug}: the row carries a control${s.format ? " and a summon format" : ""}${s.ref ? " and a creature ref" : ", and no creature ref"}`, read.control && read.format === s.format && read.hasRef === s.ref, { control: read.control, format: read.format, hasRef: read.hasRef });
    if (s.ref) {
      if (read.resolves) check(`E ${s.slug}: the ref resolves to a creature in this world${onGm.imported ? " (imported by the walk as setup)" : ""}`, true);
      else if (!onGm.mmOpen) skip(`E ${s.slug}: the ref does not resolve and the Monster Manual is not open on the GM seat (connect it through the Your ACKS Books macro to import the creature)`);
      else check(`E ${s.slug}: the ref resolves to a creature in this world`, false, { imported: onGm.imported });
    }
    if (s.counted) {
      if (!(read.amount > 0)) gap(`E ${s.slug}: the page's count did not locate, so the row carries no amount and the cast is not capped`);
      else {
        const cap = await run(player, P.summonRead, { casterId: W.caster, itemId: W.spell[s.slug], counts: [read.amount, read.amount + 1] });
        check(`E ${s.slug}: a count over the row's located amount is refused, the amount itself is not`, cap.refusal[read.amount] !== "badCount" && cap.refusal[read.amount + 1] === "badCount", { refused: cap.refusal[read.amount + 1] });
      }
    } else check(`E ${s.slug}: the row states no amount, so no count is refused as too many`, read.amount === 0 && read.refusal[2] !== "badCount" && read.refusal[5] !== "badCount", { amount: read.amount, refusal: read.refusal });
    if (s.slug === "summoning") check("E summoning: the count's ceiling at the caster level is carried on the row, unresolved, and the cast count is not capped at one", read.hasMax && read.maxKeys > 0 && read.refusal[5] !== "badCount", { hasMax: read.hasMax, maxKeys: read.maxKeys });
  }
  // The creature prompt as the seat opens it, for the two spells whose row names a creature; each is closed unanswered, so nothing is spent.
  for (const slug of ["calling", "summoning"]) {
    const before = await run(gm, P.records, { actorId: W.caster });
    const prompt = await run(gm, P.openPrompt, { casterId: W.caster, itemId: W.spell[slug] });
    check(`E ${slug}: the creature prompt offers the row's one choice, labelled, with the count open above one`, prompt.prompt && prompt.choices === 1 && prompt.labelled && prompt.countMax > 1, { choices: prompt.choices, countMax: prompt.countMax });
    if (slug === "summoning") check("E summoning: the count opens on one", prompt.count === "1", { count: prompt.count });
    check(`E ${slug}: closing the prompt writes no record`, (await run(gm, P.dismissPrompt)) && (await run(gm, P.records, { actorId: W.caster })).length === before.length);
    await run(gm, P.clearWindows);
  }
}

/* ------------------------ F. concentration summons (H) ---------------- */
const HELD_A = { shape: "concentrationPlus", concentration: "mobile", plus: { value: 2, unit: "hours" } };
const HELD_B = { shape: "concentration", concentration: "stationary" };

/** The flow of H on one seat: hold A, cancel a pick of B, cast B (warned, A ended, B held). */
async function holdFlow(who, { endIt }) {
  const seat = who === "gm" ? gm : player;
  const L = `F ${who}`;
  const A = W.spell["held-a"];
  const B = W.spell["held-b"];
  await run(gm, P.shapeSummon, { casterId: W.caster, itemId: A, ref: W.creatureUuid, amount: 1, duration: HELD_A });
  await run(gm, P.shapeSummon, { casterId: W.caster, itemId: B, ref: W.creatureUuid, amount: 1, duration: HELD_B });
  await run(seat, P.mark, { casterId: W.caster });
  const heldNow = (await recordsOf()).filter((r) => r.held);
  check(`${L}: no concentration is held at the start`, heldNow.length === 0, { held: heldNow.length });
  const worldTime = await run(gm, P.worldTime);

  // Hold A.
  const a = await place(`${L} A`, who, A);
  check(`${L}: the prompt for a concentration summoning opens, titled for the spell, with its one choice`, a.prompt.prompt && a.prompt.titled && a.prompt.choices === 1, a.prompt);
  check(`${L}: one creature stands, the cast count rose by one and one card posted`, a.fresh.length === 1 && a.cast === a.before + 1 && a.cards.length === 1, { tokens: a.fresh.length, cast: a.cast, before: a.before, cards: a.cards.length });
  const recA = await castRecords(a.castId, 1);
  const ra = recA[0];
  check(`${L}: the summoning writes the held record a held cast writes: the status, the kind, the tail, a start time, no clock`, recA.length === 1 && ra.role === "caster" && ra.held === "mobile" && ra.statuses.includes("concentrating") && ra.tail?.value === 2 && ra.tail?.units === "hours" && ra.startTime >= worldTime && !ra.hasDuration, { n: recA.length, held: ra?.held, statuses: ra?.statuses, tail: ra?.tail, hasDuration: ra?.hasDuration });
  const standingA = await tokensOf();

  // Cancel the pick of B while A is held.
  await run(seat, P.mark, { casterId: W.caster });
  const pressed = await run(seat, P.press, { casterId: W.caster, spellId: B });
  check(`${L}: the Cast button of the second summoning is pressed`, pressed.button);
  check(`${L}: its prompt opens`, (await run(seat, P.prompt, { spellName: W.names[B] })).prompt);
  check(`${L}: the prompt is closed without placing`, await run(seat, P.dismissPrompt));
  await sleep(2000);
  const kept = await recordsOf();
  const idle = await run(seat, P.state, { casterId: W.caster, spellId: B });
  const logs = await run(seat, P.logs);
  check(`${L}: cancelling the pick keeps the concentration: the same record stands, no warning, no card, no creature, no spend`, kept.some((r) => r.id === ra.id && r.held === "mobile") && kept.filter((r) => r.held).length === 1 && logs.warns.length === 0 && idle.cards.length === 0 && idle.cast === 0 && (await tokensOf()).length === standingA.length, { warns: logs.warns.length, cards: idle.cards.length, cast: idle.cast });
  await run(seat, P.clearWindows);

  // Cast B while A is held.
  await run(seat, P.mark, { casterId: W.caster });
  const since = Date.now() - 1000;
  const b = await place(`${L} B`, who, B);
  const recB = await castRecords(b.castId, 1);
  const rb = recB[0];
  const warned = await run(seat, P.logs);
  const expected = await run(seat, P.notice, { key: "verdict.concentrating", data: { name: W.names.caster } });
  const warn = warned.warnLog.find((w) => w.text === expected);
  check(`${L}: casting while a concentration is held gives the general concentrating warning once, naming the caster`, warned.warnLog.filter((w) => w.text === expected).length === 1, { warns: warned.warns.length });
  check(`${L}: at the warning the old concentration still stood and no end card for it had posted`, !!warn && warn.held.includes(a.castId) && !warn.ended.includes(a.castId), { held: warn?.held?.length, ended: warn?.ended?.length });
  const ends = (await run(seat, P.endCards, { since })).filter((e) => e.castId === a.castId);
  for (const e of ends) await track(e.uuid, "ChatMessage");
  check(`${L}: the old concentration's end posted one card, caused by the new cast`, ends.length === 1 && ends[0].cause === "cast", ends.map((e) => e.cause));
  const nowRecords = await recordsOf();
  check(`${L}: the old record is gone and the new one is the one concentration held, of its own kind`, !nowRecords.some((r) => r.castId === a.castId) && nowRecords.filter((r) => r.held).length === 1 && recB.length === 1 && rb.held === "stationary" && rb.statuses.includes("concentratingStationary"), { held: nowRecords.filter((r) => r.held).length, kind: rb?.held });
  check(`${L}: the second summoning placed its creature and spent its own count`, b.fresh.length === 1 && b.cast === 1, { tokens: b.fresh.length, cast: b.cast });
  const standingB = await tokensOf();
  check(`${L}: the first summoning's creature still stands beside the second's`, standingB.length === standingA.length + 1 && standingA.every((t) => standingB.some((s) => s.uuid === t.uuid)), { before: standingA.length, after: standingB.length });

  if (endIt) {
    // The end of a held summons by its real trigger (the status's toggle): the funnel's card, no Dismiss, and nothing removed from the map.
    await run(seat, P.mark, { casterId: W.caster });
    const since2 = Date.now() - 1000;
    await run(seat, P.endHeld, { casterId: W.caster, status: "concentratingStationary" });
    const cards = await until(() => run(seat, P.endCards, { since: since2 }), (l) => l.some((e) => e.castId === b.castId), { tries: 40, every: 250 });
    const end = cards.filter((e) => e.castId === b.castId);
    for (const e of end) await track(e.uuid, "ChatMessage");
    check(`${L}: ending the held summons posts the funnel's one card, with Restore and no Dismiss`, end.length === 1 && end[0].cause === "removed" && end[0].restore && !end[0].dismiss, end.map((e) => ({ cause: e.cause, restore: e.restore, dismiss: e.dismiss })));
    const after = await tokensOf();
    check(`${L}: the creatures are left standing: the end removes no token and writes no prompt`, after.length === standingB.length && standingB.every((t) => after.some((s) => s.uuid === t.uuid)), { before: standingB.length, after: after.length });
    check(`${L}: the held record is gone`, !(await recordsOf()).some((r) => r.castId === b.castId));
  }
  const d = await run(seat, P.drain);
  check(`${L}: no console error or uncaught error on the seat over the flow`, !d.errors.length && !d.uncaught.length, { errors: d.errors.length, uncaught: d.uncaught.length });
}

async function stageHeld() {
  await holdFlow("player", { endIt: true });
  await holdFlow("gm", { endIt: false });
}

/* ------------------------ G. a begun fight (1d.5) --------------------- */
async function stageFight() {
  const T = W.spell.timed;
  await run(gm, P.shapeSummon, { casterId: W.caster, itemId: T, ref: W.creatureUuid, amount: 1, duration: DURATION });
  // The GM's flow left B held; the fight starts with no concentration so the cast's record is the only thing to read.
  const held = (await recordsOf()).filter((r) => r.held);
  if (held.length) {
    for (const r of held) await run(gm, P.endHeld, { casterId: W.caster, status: r.statuses[0] });
    await sleep(2500);
  }
  const cm = await run(gm, P.combatNew, { sceneId: W.scene, tokenIds: [W.t.caster.id, W.t.target.id] });
  await track(cm.uuid, "Combat");
  try {
    const byToken = Object.fromEntries(cm.combatants.map((x) => [x.tokenId, x.id]));
    const set = await run(gm, P.combatSet, { combatId: cm.id, initiatives: { [byToken[W.t.target.id]]: 30, [byToken[W.t.caster.id]]: 20 } });
    check("G: a fight is begun with the target's turn first, so the caster is not on turn", set.started && set.turns === 2 && set.onTurn === W.t.target.id, { started: set.started, turns: set.turns, targetOnTurn: set.onTurn === W.t.target.id });
    await run(player, P.mark, { casterId: W.caster });
    const c = await place("G", "player", T);
    check("G: a summons cast in a begun fight resolves at once: its creature stands, the count rose by one and one card posted", c.fresh.length === 1 && c.cast === c.before + 1 && c.cards.length === 1, { tokens: c.fresh.length, cast: c.cast, before: c.before, cards: c.cards.length });
    const recs = await castRecords(c.castId, 1);
    const all = await recordsOf();
    check("G: it leaves its one caster record and no declaration: no casting status, no pending record, no declared flag, no declared notice", recs.length === 1 && recs[0].role === "caster" && !all.some((r) => r.statuses.includes("casting") || r.pending) && (await run(gm, P.declared, { combatId: cm.id })) === 0 && !(await run(player, P.logs)).infos.some((i) => /declare/iu.test(i)), { records: recs.length, declared: await run(gm, P.declared, { combatId: cm.id }) });
  } finally {
    // The Combat is the run's own delete here, so the sweep has nothing of it to find.
    if (await run(gm, P.combatDrop, { combatId: cm.id })) own.splice(own.indexOf(cm.uuid), 1);
  }
}

/* ------------------------------ run ----------------------------------- */
try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  check("the cast seam is on both seats", installed.claimant && seated.claimant);
  // A paused world refuses a player's summons; the run unpauses it and the finally pauses it again.
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));

  await stage("A. setup", stageSetup);
  if (W.t) {
    await stage("B. the tracked kinds (T)", stageTracked);
    await stage("C. the reversed twins (T)", stageReversed);
    await stage("D. a dispel row is no throw row (T)", stageDispel);
    await stage("E. the summon rows (R)", stageSummonRows);
    await stage("F. a concentration summoning holds its caster (H)", stageHeld);
    await stage("G. a summons in a begun fight resolves at once (1d.5)", stageFight);
  }
  section("console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, P.drain);
    check(`${label}: no console error or uncaught error was recorded since the seat was installed`, d.errors.length === 0 && d.uncaught.length === 0, { errors: d.errors.slice(0, 3), uncaught: d.uncaught.length });
  }
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) { await seat.eval(`canvas.tokens?.setTargets([]); 0`); note(`restored (${label})`, await run(seat, P.restore)); } } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The run's own leavings, listed by id: the held records of its casts go first (a held record's deletion ends its cast through the funnel, which posts a card, so the cards are given time to land), then the cards speaking as the fixtures this run got back from the ledger, since it began, and the records of its cast ids.
  try {
    if (gm && W.caster) {
      await gm.eval(`(async () => { const ids = ${JSON.stringify(castIds)}; for (const a of game.actors.filter((x) => ${JSON.stringify(fixtureActors)}.includes(x.id))) { const held = [...a.effects].filter((e) => ids.includes(e.flags?.["acks-extras"]?.spellEffect?.castId) && e.flags["acks-extras"].spellEffect.held).map((e) => e.id); if (held.length) await a.deleteEmbeddedDocuments("ActiveEffect", held); } await new Promise((r) => setTimeout(r, 2500)); return true; })()`);
      const ledger = JSON.parse(await gm.eval(`(async () => JSON.stringify({ cards: [...game.messages].filter((m) => m.timestamp >= ${startedAt} && (${JSON.stringify(fixtureActors)}.includes(m.speaker?.actor) || ${JSON.stringify(castIds)}.includes(m.flags?.["acks-extras"]?.castHeldEnd?.castId))).map((m) => m.uuid), records: game.actors.filter((a) => ${JSON.stringify(fixtureActors)}.includes(a.id)).flatMap((a) => [...a.effects].filter((e) => ${JSON.stringify(castIds)}.includes(e.flags?.["acks-extras"]?.spellEffect?.castId)).map((e) => e.uuid)), copies: game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === ${JSON.stringify(W.creatureUuid ?? "")}).map((a) => a.uuid) }))()`));
      for (const uuid of ledger.cards) await track(uuid, "ChatMessage");
      for (const uuid of ledger.records) await track(uuid, "ActiveEffect");
      // A world copy of the named creature is the run's only where none stood before it.
      if (W.creatureCopiesBefore === 0) for (const uuid of ledger.copies) await track(uuid, "Actor");
    }
  } catch (err) { console.error("ledger:", err?.message ?? err); }
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  if (gm && wasPaused) {
    try { note("paused again", await run(gm, P.pause, { paused: true })); } catch (err) { console.error("pause restore:", err?.message ?? err); }
  }
  console.log("fixtures kept: magic/tracked-scene, magic/tracked-class, magic/tracked-caster, magic/tracked-spell-<slug> x13, magic/tracked-held-a, -held-b, -timed, magic/tracked-creature, magic/tracked-target");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
