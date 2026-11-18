/**
 * Live walk, magic-cast-widen: the cast engine's widened rows (docs/magic/TESTING.md,
 * the cast engine). Range and picks (S3p), a target's defenses (S3d), a thrown
 * row's instances (S3i), the target gates (S3g), how long a record lives (S3l)
 * and the recurring prompts (S3r), walked on the GM and Player seats with the
 * spells imported from the seat's own RR by cookbook id.
 *
 * Every imported figure is read from the world at runtime and compared; the
 * walk prints booleans, counts and relations, never a printed value. The figures
 * it sets on its own copies (a roll, a cap, a size, a factor, a count) are
 * invented. A step brings what it needs to a known shape at its start, and a
 * stage that throws records a failed check and lets the next stage run. The
 * recurring-prompt stage reads its S3r names from one table (`S3R`) and prints
 * SKIP when the prompts are not in the build. Machine values arrive through
 * ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `magic/widen-scene`, `magic/widen-class`,
 * `magic/widen-caster` (a character the Player owns), `magic/widen-spell-<id>`
 * (a copy of each imported spell on the caster, reshaped at each stage),
 * `magic/widen-target-a`/`-b`, `magic/widen-far`, `magic/widen-huge`,
 * `magic/defense-immune`/`-resistant`/`-susceptible`, `magic/cast-monster` with
 * `magic/defense-weapon`. The run's own tokens, cards, records and Combat are
 * tracked by uuid and swept alone; the grid distance and width of the walk's
 * scene are put back after the range step, and the dice are restored.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const KEY = "magic-cast-widen-walk";
/** Marker slugs (lowercase, digits, dashes) to the cookbook ids the walk imports. */
const SPELLS = {
  "blinding-flash": "def.spell.blindingFlash",
  thunderclap: "def.spell.thunderclap",
  "fan-of-flames": "def.spell.fanOfFlames",
  "earths-excrescence": "def.spell.earthsExcrescence",
  "kindle-flame": "def.spell.kindleFlame",
  "choking-grip": "def.spell.chokingGrip",
  "mage-missile": "def.spell.mageMissile",
  "slicing-blow": "def.spell.slicingBlow",
  "sling-stone": "def.spell.slingStone",
  "frighten-beast": "def.spell.frightenBeast",
  desiccate: "def.spell.desiccate",
  "cure-light-injury": "def.spell.cureLightInjury",
};
/** The names the recurring-prompt stage depends on from S3r; one place to adapt when the slice's names differ. */
const S3R = { actions: { save: "magicCastSave", roll: "magicCastRoll", nextRound: "magicCastNextRound" }, messageFlag: "recurOf", modelKey: "recur" };
/** The caster level every cast resolves at (the class level): the walk's own figure. */
const LEVEL = 5;
const startedAt = Date.now();

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const gap = (label, detail) => console.log(`GAP  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
const skip = (label, detail) => console.log(`SKIP  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);

/** Half to even, as the module rounds. */
const halfEven = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
};
const entriesOf = (model, rowKey) => Object.entries(model?.entries ?? {}).filter(([id]) => id.endsWith(`_${rowKey}`)).map(([id, e]) => ({ id, ...e }));
const keyOf = (model, uuid) => Object.entries(model?.targets ?? {}).find(([, t]) => t.uuid === uuid)?.[0];
const firstDamageKey = (model) => (model?.order ?? []).find((k) => model.rows?.[k]?.type === "damage") ?? model?.order?.[0];
/** An entry's defense: a priced one is a `defense` step of its band, one the module does not price is the Judge's `entry.defense`. */
const hasDefense = (e, band) => (e?.steps ?? []).some((s) => s.key === "defense" && s.band === band) || (!!e?.defense && (!e.defense.band || e.defense.band === band));
const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page,   */
/*  so it closes over nothing and shares state through `__mcw`.         */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mcw = globalThis.__mcw ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 250 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.loc = (key2, data) => game.i18n.format("ACKS-" + "MAGIC.cast." + key2, data ?? {});
    H.coreDialogs = async (plan) => {
      const done = [];
      for (const act of plan) {
        const dialog = await H.poll(() => document.querySelector(".attack-throw-dialog"), { tries: 80, every: 150 });
        if (!dialog) { done.push("none"); break; }
        const button = act === "roll" ? dialog.querySelector('button[type="submit"]') : dialog.querySelector('button[data-action="close"]');
        await H.poll(() => !button.disabled, { tries: 20, every: 100 });
        button.click();
        await H.poll(() => !document.querySelector(".attack-throw-dialog"), { tries: 80, every: 150 });
        done.push(act);
        await H.sleep(500);
      }
      return done;
    };
    H.attackCards = (before) => [...game.messages].filter((m) => !before.has(m.id) && String(m.content).includes("attack-throw-card")).map((m) => {
      const doc = new DOMParser().parseFromString(String(m.content), "text/html");
      return { id: m.id, target: (doc.querySelector('.attack-throw-card__target [data-acks-visibility="target-ac-shown"]') ?? doc.querySelector(".attack-throw-card__target"))?.textContent?.trim().replace(/\s+/g, " ") ?? "", applyButton: String(m.content).includes('data-action="applyDamage"') };
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
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  drain: async () => {
    const H = globalThis.__mcw;
    const out = { errors: H.errors.slice(), warns: H.warns.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    return out;
  },
  /** GM: wait for the RR, import the spells, hand back each as plain data. */
  library: async ({ ids }) => {
    const H = globalThis.__mcw;
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.poll(() => acksExtras.importer?.bookOpen?.("rr"), { tries: 600, every: 200 });
    const out = { rr: !!acksExtras.importer?.bookOpen?.("rr"), present: {}, payload: {} };
    if (out.rr) await acksExtras.importer.importSpells({ only: new Set(Object.values(ids)), repair: { replaced: 0, refused: 0, keptProse: 0 } });
    for (const [k, id] of Object.entries(ids)) {
      const doc = L.byCookbookId("Item", id, { original: true });
      out.present[k] = !!doc;
      if (doc) {
        const data = doc.toObject();
        for (const f of ["_id", "folder", "sort", "ownership"]) delete data[f];
        out.payload[k] = data;
      }
    }
    return out;
  },
  /**
   * Bring one copy to a known shape from the library original: the flag is deleted first so no stale gate key survives, the lists name the
   * walk's class, and `ops` carries the walk's own figures (all invented): `unlimited`, `target`, `save`, `rows: [{type, first, set}]`, `set`.
   */
  shapeSpell: async ({ casterId, itemId, original, ops }) => {
    const item = game.actors.get(casterId).items.get(itemId);
    const flag = foundry.utils.deepClone(original ?? {});
    flag.lists = [{ source: "arcane", level: 1, classes: [], note: "" }];
    flag.target = { ...(flag.target ?? {}), ...(ops.target ?? {}) };
    if (ops.unlimited) { flag.range = { shape: "unlimited" }; flag.target.count = null; }
    if (!flag.target.model) flag.target.model = "creature";
    flag.save = { ...(flag.save ?? {}), ...(ops.save ?? {}) };
    for (const patch of ops.rows ?? []) {
      for (const r of flag.effects ?? []) {
        if (r.type !== patch.type) continue;
        Object.assign(r, patch.set);
        if (patch.first) break;
      }
    }
    for (const [path, value] of Object.entries(ops.set ?? {})) foundry.utils.setProperty(flag, path, value);
    await item.update({ "flags.acks-extras.-=spell": null });
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": flag });
    const read = item.getFlag("acks-extras", "spell") ?? {};
    const rows = read.effects ?? [];
    return {
      rows: rows.length,
      kinds: rows.map((r) => r.type),
      unread: rows.reduce((n, r) => n + (r.unread?.length ?? 0), 0),
      targetModel: !!read.target?.model,
      exemptBelowHd: !!read.save?.exemptBelowHd,
      range: read.range ?? null,
      exemptRows: rows.filter((r) => r.type && r.exemptSizeFrom).length,
      exemptKey: rows.find((r) => r.exemptSizeFrom)?.exemptSizeFrom ?? "",
      damageTypes: Array.from(rows.find((r) => r.type === "damage")?.damage ?? []).filter((t) => typeof t === "string" && t),
    };
  },
  /** The caster at a class level, bound to the walk's class, nothing spent. */
  shapeCaster: async ({ casterId, classUuid, level }) => {
    await game.actors.get(casterId).update({ "system.details.level": level, "system.spells.enabled": true, "flags.acks-extras.classes.uuid": classUuid, "flags.acks-extras.classes.pools": { arcane: { s1: 0 } } });
    return true;
  },
  setSpent: async ({ casterId }) => {
    await game.actors.get(casterId).update({ "flags.acks-extras.classes.pools": { arcane: { s1: 0 } } });
    return true;
  },
  /** A monster at known hit points, Hit Dice, saves and size, with its defense bands (written whole after a delete). */
  shapeMonster: async ({ actorId, hp, hd, size, defenses }) => {
    const a = game.actors.get(actorId);
    const saves = Object.fromEntries(["paralysis", "death", "blast", "implements", "spell"].map((s) => [`system.saves.${s}.value`, 15]));
    await a.update({ "system.hp.value": hp, "system.hp.max": hp, ...(hd != null ? { "system.hp.hd": String(hd) } : {}), ...saves });
    await a.update({ "flags.acks-extras.extras.-=defenses": null });
    if (defenses) await a.update({ "flags.acks-extras.extras.defenses": defenses });
    if (size === null) await a.update({ "flags.acks-extras.extras.-=size": null });
    else if (size) await a.update({ "flags.acks-extras.extras.size": size });
    return { hp: a.system.hp.value, size: a.getFlag("acks-extras", "extras")?.size ?? null, bands: Object.keys(a.getFlag("acks-extras", "extras")?.defenses ?? {}) };
  },
  sizeKeys: async () => Object.keys(acksExtras.monsters?.config?.SIZES ?? {}),
  /** Start the importer's read of the `defenses` table from the open book (the answer is polled by `importJob`). */
  importDefenses: async () => {
    const H = globalThis.__mcw;
    H.defImport = { done: false };
    acksExtras.importer.cookbookImportTables(["defenses"])
      .then((r) => { H.defImport = { done: true, ok: !!r }; })
      .catch((e) => { H.defImport = { done: true, ok: false, error: String(e?.message ?? e).slice(0, 200) }; });
    return { started: true };
  },
  importJob: async () => globalThis.__mcw.defImport ?? { done: false },
  /** The imported figure of the resistance fraction, as lib reads it from the world's `defenses` document. */
  defenseFigures: async () => {
    const D = await import("/modules/acks-extras/scripts/lib/defenses.mjs");
    const f = D.defenseFigures?.() ?? {};
    return { fraction: Number.isFinite(Number(f.fraction)) && f.fraction !== null && f.fraction !== "" ? Number(f.fraction) : null };
  },
  /** The imported range of a copy in feet at a level, through the module's own reader. */
  rangeLimit: async ({ range, level }) => {
    const R = await import("/modules/acks-extras/scripts/magic/cast-range.mjs");
    return R.rangeFeet(range, level)?.value ?? null;
  },
  roundSeconds: async () => {
    try { return (await import("/modules/acks-extras/scripts/magic/cast-expiry.mjs")).ROUND_SECONDS ?? 60; } catch { return 60; }
  },
  /** Whether the recurring prompts' card actions are in this build. */
  hasActions: async ({ actions }) => {
    const C = await import("/modules/acks-extras/scripts/magic/cast-card.mjs");
    const have = Object.values(C.CARD_ACTIONS ?? {});
    return actions.every((a) => have.includes(a));
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
  /** The walk's scene at this grid distance and width (feet per cell; the cell stays 100 px). */
  sceneShape: async ({ sceneId, distance, width }) => {
    const scene = game.scenes.get(sceneId);
    await scene.update({ "grid.distance": distance, width });
    await new Promise((r) => setTimeout(r, 800));
    return { distance: scene.grid.distance, width: scene.width };
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
  hp: async ({ actorIds }) => actorIds.map((id) => game.actors.get(id)?.system.hp.value ?? null),
  setHp: async ({ actorId, value }) => { await game.actors.get(actorId).update({ "system.hp.value": value }); return true; },
  rig: async ({ seq }) => {
    const H = globalThis.__mcw;
    if (!seq) { if (H.dice) CONFIG.Dice.randomUniform = H.dice; H.dice = null; return "restored"; }
    H.dice ??= CONFIG.Dice.randomUniform;
    let i = 0;
    CONFIG.Dice.randomUniform = () => seq[i++ % seq.length];
    return "rigged";
  },
  /**
   * Cast as a user does: `item.use()`, then the dialog. With `stop` the dialog is read and cancelled. `picks` is read (option texts),
   * `coreDialogs` answers core's attack dialogs in order ("roll" or "cancel") and leaves core's own dialogs open to answer (no skipDialog),
   * `picks` is `{group: optionValue}` chosen in the dialog before it is cast. Answers what the dialog showed and the card it left.
   */
  cast: async ({ casterId, spellId, mode, stop, wait, coreDialogs, picks: chosen }) => {
    const H = globalThis.__mcw;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    const targetsBefore = [...game.user.targets].map((t) => t.id);
    item.use(coreDialogs ? {} : { skipDialog: true });
    const found = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    // The window re-renders on every change, so each read goes back to the live element.
    const live = () => document.querySelector(".application.acks-extras-cast") ?? found;
    const modeRadio = mode ? live().querySelector(`input[name="mode"][value="${mode}"]`) : null;
    if (modeRadio) { modeRadio.checked = true; modeRadio.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(300); }
    // A choice's options are radios, each drawn as effect rows; the pick is the radio of that group with this value.
    for (const [group, value] of Object.entries(chosen ?? {})) {
      const pick = live().querySelector(`input[data-pick="${group}"][value="${value}"]`);
      if (!pick) continue;
      pick.checked = true;
      pick.dispatchEvent(new Event("change", { bubbles: true }));
      await H.sleep(300);
    }
    const lis = [...live().querySelectorAll(".acks-extras-cast-verdicts li")];
    const castButton = live().querySelector('button[data-action="cast"]');
    const shown = {
      dialog: true,
      verdicts: lis.map((li) => ({ severity: li.dataset.severity, text: li.textContent.trim(), tip: li.dataset.tooltipText ?? "" })),
      castDisabled: !!castButton?.disabled,
      picks: [...live().querySelectorAll("fieldset.acks-extras-cast-group")].map((f) => [...f.querySelectorAll(".acks-extras-cast-opt")].map((o) => o.textContent.trim())),
      levelField: !!live().querySelector('[name="casterLevel"]'),
    };
    if (stop) {
      live().querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { ...shown, cancelled: true, cards: [...game.messages].filter((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard).length };
    }
    live().querySelector('button[data-action="cast"]').click();
    const dialogs = coreDialogs ? await H.coreDialogs(coreDialogs) : [];
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 120, every: 250 });
    if (!message) return { ...shown, card: false, dialogs };
    await H.poll(() => !Object.values(game.messages.get(message.id).flags["acks-extras"].castCard.entries).some((e) => e.state === "pending" || e.state === "applying"), { tries: wait ?? 40, every: 250 });
    const model = game.messages.get(message.id).flags["acks-extras"].castCard;
    return { ...shown, card: true, messageId: message.id, model, dialogs, attackCards: H.attackCards(before), targetsBefore, targetsAfter: [...game.user.targets].map((t) => t.id) };
  },
  /** Press a card's button as a user does (the chat tab is opened first), with core's dialogs answered; wait for the entries to leave `applying`. */
  press: async ({ messageId, action, target, row, index, coreDialogs, wait }) => {
    const H = globalThis.__mcw;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(400);
    const before = new Set([...game.messages].map((m) => m.id));
    const sel = `[data-message-id="${messageId}"] [data-action="${action}"]${target ? `[data-target="${target}"]` : ""}${row ? `[data-row="${row}"]` : ""}`;
    const button = await H.poll(() => document.querySelectorAll(sel)[index ?? 0], { tries: 40, every: 200 });
    if (!button) return { button: false };
    const warns = H.warns.length;
    button.click();
    const dialogs = coreDialogs ? await H.coreDialogs(coreDialogs) : [];
    const flag = () => game.messages.get(messageId)?.flags?.["acks-extras"]?.castCard;
    await H.poll(() => !Object.values(flag()?.entries ?? {}).some((e) => e.state === "applying"), { tries: wait ?? 40, every: 250 });
    await H.sleep(600);
    return { button: true, model: flag() ?? null, dialogs, attackCards: H.attackCards(before), warns: H.warns.slice(warns) };
  },
  /** What a card's rendered body offers this seat and shows in its figures. */
  seen: async ({ messageId }) => {
    const H = globalThis.__mcw;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(500);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    const cells = [...(el?.querySelectorAll(".acks-extras-roll-card td.acks-nums") ?? [])].map((td) => ({ text: td.textContent.trim(), tip: td.dataset.tooltipText ?? td.dataset.tooltip ?? "" }));
    const titles = [...(el?.querySelectorAll("h4.acks-extras-roll-section") ?? [])].map((h) => ({ text: h.textContent.trim(), tip: h.dataset.tooltipText ?? h.dataset.tooltip ?? "" }));
    return { found: !!el, titles, actions: [...(el?.querySelectorAll("[data-action^='magicCast'], [data-action^='libAttack']") ?? [])].map((b) => b.dataset.action), cells, text: el?.textContent ?? "" };
  },
  /** The spell records on an actor: the mark, the turn life and the statuses. */
  records: async ({ actorId }) => {
    const a = game.actors.get(actorId);
    return [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect).map((e) => {
      const f = e.flags["acks-extras"];
      return { id: e.id, uuid: e.uuid, castId: f.spellEffect.castId, held: f.spellEffect.held ?? null, statuses: [...e.statuses], turnLife: f.turnLife ?? f.spellEffect.turnLife ?? null, startTime: f.spellEffect.startTime ?? null, hasDuration: f.spellEffect.duration != null };
    });
  },
  waitGone: async ({ actorId, castId, tries }) => {
    const H = globalThis.__mcw;
    const left = () => [...game.actors.get(actorId).effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.castId === castId).length;
    await H.poll(() => left() === 0, { tries: tries ?? 40, every: 250 });
    return left();
  },
  time: async ({ now, advance }) => {
    const H = globalThis.__mcw;
    if (now) return game.time.worldTime;
    await game.time.advance(advance);
    await H.sleep(2500);
    return game.time.worldTime;
  },
  endCards: async ({ since, castId }) => [...game.messages].filter((m) => m.timestamp >= since && m.flags?.["acks-extras"]?.castHeldEnd && (!castId || m.flags["acks-extras"].castHeldEnd.castId === castId)).map((m) => ({ uuid: m.uuid, cause: m.flags["acks-extras"].castHeldEnd.cause })),
  /** A weapon attack from a token at the seat's targets (core's attack, melee, no dialog); answers the card, its buttons and the module's apply stamp. */
  attack: async ({ sceneId, tokenId, itemId }) => {
    const H = globalThis.__mcw;
    const actor = game.scenes.get(sceneId).tokens.get(tokenId)?.actor;
    const item = actor?.items.get(itemId);
    if (!item) return { card: false };
    const before = new Set([...game.messages].map((m) => m.id));
    await actor.makeAttackThrow({ item, attackType: "melee", skipDialog: true });
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.speaker?.actor === actor.id && String(m.content).includes("attack-throw-card")), { tries: 40, every: 200 });
    if (!message) return { card: false };
    const stamped = await H.poll(() => game.messages.get(message.id).flags?.["acks-extras"]?.attackApply, { tries: 40, every: 250 });
    return { card: true, id: message.id, uuid: message.uuid, coreApply: String(message.content).includes('data-action="applyDamage"'), stamp: stamped ?? null };
  },
  /** The stamp of an attack card as it stands, after a press. */
  stamp: async ({ messageId, state }) => {
    const H = globalThis.__mcw;
    await H.poll(() => game.messages.get(messageId)?.flags?.["acks-extras"]?.attackApply?.result?.state === state, { tries: 40, every: 250 });
    return game.messages.get(messageId)?.flags?.["acks-extras"]?.attackApply ?? null;
  },
  /** The prompt cards of a cast (recurring prompts), by the message flag or the card model's key. */
  prompts: async ({ castId, flagName, modelKey, exclude }) => [...game.messages].filter((m) => {
    const f = m.flags?.["acks-extras"];
    const on = f?.[flagName] ?? f?.castCard?.[modelKey];
    return on && (on.castId ?? f?.castCard?.castId) === castId && !exclude.includes(m.id);
  }).map((m) => ({ id: m.id, uuid: m.uuid, round: (m.flags["acks-extras"][flagName] ?? m.flags["acks-extras"].castCard?.[modelKey])?.round ?? null, moment: (m.flags["acks-extras"][flagName] ?? m.flags["acks-extras"].castCard?.[modelKey])?.moment ?? null })),
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
    return combat.turns.map((c) => c.id);
  },
  combatMove: async ({ combatId, update, next }) => {
    const combat = game.combats.get(combatId);
    const before = new Set([...game.messages].map((m) => m.id));
    if (next) await combat.nextTurn();
    else await combat.update(update);
    await new Promise((r) => setTimeout(r, 1200));
    const cards = [...game.messages].filter((m) => !before.has(m.id) && m.author?.id === game.user.id && !m.speaker?.actor).map((m) => m.uuid);
    return { round: combat.round, turn: combat.turn, current: combat.combatant?.id ?? null, cards };
  },
  combatDrop: async ({ combatId }) => { await game.combats.get(combatId)?.delete(); return true; },
  restore: async () => {
    const H = globalThis.__mcw;
    if (!H) return "none";
    if (H.dice) CONFIG.Dice.randomUniform = H.dice;
    H.dice = null;
    if (H.patched) { console.error = H.consoleError; ui.notifications.warn = H.warn; H.patched = false; }
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
/** A one-off page expression, awaited. */
const ev = async (api, expr) => JSON.parse(await api.eval(`(async () => JSON.stringify((await (${expr})) ?? null))()`));

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let player = null;
const own = [];
const castIds = [];
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

/** A stage runs apart: a throw in one is a failed check and the next stage still runs. */
async function stage(name, fn) {
  section(name);
  try { await fn(); } catch (err) {
    console.error(`WALK ERROR (${name}):`, err?.stack ?? err);
    check(`${name} ran to the end`, false, String(err?.message ?? err).slice(0, 200));
  }
}

const W = {};
/** Cast on a seat; spends nothing (the pool is zeroed first), and tracks the card, its cast id and the attack cards the cast made. */
async function castAs(seat, o) {
  await run(gm, P.setSpent, { casterId: W.caster });
  const c = await run(seat, P.cast, { casterId: W.caster, ...o });
  if (c.model?.castId) castIds.push(c.model.castId);
  if (c.messageId) await track(`ChatMessage.${c.messageId}`, "ChatMessage");
  for (const a of c.attackCards ?? []) await track(`ChatMessage.${a.id}`, "ChatMessage");
  return c;
}
const aim = async (seat, tokens) => {
  const got = await run(seat, P.target, { sceneId: W.scene, tokenIds: tokens.map((t) => t.id) });
  if (!Array.isArray(got) || got.length !== tokens.length) throw new Error(`the seat holds ${JSON.stringify(got)} as targets, not ${tokens.length}`);
};
const hpOf = async (...actorIds) => run(gm, P.hp, { actorIds });
const press = async (seat, o) => {
  const r = await run(seat, P.press, o);
  for (const a of r.attackCards ?? []) await track(`ChatMessage.${a.id}`, "ChatMessage");
  return r;
};
/** A copy of an imported spell on the caster, brought to a shape. */
const shape = (slug, ops) => run(gm, P.shapeSpell, { casterId: W.caster, itemId: W.spell[slug], original: W.lib.payload[slug]?.flags?.["acks-extras"]?.spell, ops });
const rigBoth = (seq) => Promise.all([run(gm, P.rig, { seq }), run(player, P.rig, { seq })]);
const NOROLL = { unlimited: true };
const FAIL_SAVE = [0.975];
const PASS_SAVE = [0.025];

/* ---------------------------- A. setup ------------------------------ */
async function stageSetup() {
  W.playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!W.playerId) throw new Error("no Player user on this world");
  W.lib = await run(gm, P.library, { ids: SPELLS });
  const missing = Object.entries(W.lib.present).filter(([, ok]) => !ok).map(([k]) => k);
  check("A: the RR is open and every spell of the walk is imported", W.lib.rr && missing.length === 0, missing);
  if (!W.lib.rr || missing.length) throw new Error("the RR or its spells are not available on the GM seat");
  const scene = await gm.fixture("magic/widen-scene", "Scene", { name: "QA Widen Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#55606b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  const cls = await gm.fixture("magic/widen-class", "Item", { name: "QA Widen Class", type: "acks-extras.class", system: { key: "qawidenclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 9 }] }] } });
  const caster = await gm.fixture("magic/widen-caster", "Actor", { name: "QA Widen Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.playerId]: 3 } });
  W.scene = idOf(scene);
  W.caster = idOf(caster);
  W.spell = {};
  for (const slug of Object.keys(SPELLS)) {
    const doc = await gm.fixture(`magic/widen-spell-${slug}`, "Item", { ...W.lib.payload[slug], name: `QA Widen spell ${Object.keys(SPELLS).indexOf(slug) + 1}` }, { parent: caster.uuid });
    W.spell[slug] = idOf(doc);
  }
  W.actor = {};
  for (const name of ["target-a", "target-b", "far", "huge"]) W.actor[name] = idOf(await gm.fixture(`magic/widen-${name}`, "Actor", { name: `QA Widen ${name}`, type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } }));
  for (const name of ["immune", "resistant", "susceptible"]) W.actor[name] = idOf(await gm.fixture(`magic/defense-${name}`, "Actor", { name: `QA Defense ${name}`, type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } }));
  const monster = await gm.fixture("magic/cast-monster", "Actor", { name: "QA Cast Monster", type: "monster", ownership: { default: 0 } });
  W.monster = idOf(monster);
  W.weapon = idOf(await gm.fixture("magic/defense-weapon", "Item", { name: "QA Defense Blade", type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent: monster.uuid }));
  await run(gm, P.shapeCaster, { casterId: W.caster, classUuid: cls.uuid, level: LEVEL });
  for (const [name, id] of Object.entries(W.actor)) await run(gm, P.shapeMonster, { actorId: id, hp: 40, hd: name === "target-b" ? 6 : 2, size: null, defenses: null });
  await run(gm, P.shapeMonster, { actorId: W.monster, hp: 9, hd: null, size: null, defenses: null });
  // Each copy carries rows with a type, and the import's own read-gaps are counted, never printed as figures.
  const shaped = {};
  for (const slug of Object.keys(SPELLS)) shaped[slug] = await shape(slug, NOROLL);
  const bare = Object.entries(shaped).filter(([, s]) => !s.rows || s.kinds.some((k) => !k)).map(([slug]) => slug);
  check("A: each copy on the caster carries rows, each with a type", bare.length === 0, bare);
  note("A: rows with unread fields per copy (a count, not a figure)", Object.fromEntries(Object.entries(shaped).map(([s, v]) => [s, v.unread])));
  check("A: both seats view the field", (await run(player, P.view, { sceneId: W.scene })) && (await run(gm, P.view, { sceneId: W.scene })));
  const specs = [
    { actorId: W.caster, name: "Widen Caster", x: 100, y: 300, disposition: 1 },
    { actorId: W.actor["target-a"], name: "Widen A", x: 200, y: 300 },
    { actorId: W.actor["target-b"], name: "Widen B", x: 200, y: 500 },
    { actorId: W.actor.huge, name: "Widen Huge", x: 200, y: 700 },
    { actorId: W.actor.immune, name: "Defense Immune", x: 500, y: 300 },
    { actorId: W.actor.resistant, name: "Defense Resistant", x: 500, y: 500 },
    { actorId: W.actor.susceptible, name: "Defense Susceptible", x: 500, y: 700 },
  ];
  const made = await run(gm, P.placeTokens, { sceneId: W.scene, specs });
  for (const t of made) await track(t.uuid, "Token");
  check("A: seven linked tokens stand on the field", made.length === specs.length);
  W.tok = Object.fromEntries(made.map((t) => [t.actorId, t]));
  W.t = { caster: W.tok[W.caster], a: W.tok[W.actor["target-a"]], b: W.tok[W.actor["target-b"]], huge: W.tok[W.actor.huge], immune: W.tok[W.actor.immune], resistant: W.tok[W.actor.resistant], susceptible: W.tok[W.actor.susceptible] };
  const monsterTok = (await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: W.monster, name: "Cast Monster", x: 800, y: 300, link: false }] }))[0];
  await track(monsterTok.uuid, "Token");
  W.t.monster = monsterTok;
  await run(gm, P.drain);
  await run(player, P.drain);
}

/* ---------------------------- B. range ------------------------------ */
async function stageRange() {
  const s = await shape("desiccate", { target: {} });
  let limit = await run(gm, P.rangeLimit, { range: s.range, level: LEVEL });
  if (!(limit > 0)) {
    gap("B: the imported range is not a measured figure; the walk sets an invented one on its copy");
    await shape("desiccate", { set: { range: { shape: "distance", value: 40, unit: "feet" }, "target.model": "creature" } });
    limit = await run(gm, P.rangeLimit, { range: { shape: "distance", value: 40, unit: "feet" }, level: LEVEL });
  }
  check("B: the copy's range reads as a figure in feet", limit > 0);
  const unit = 5 * Math.ceil(limit / 50);
  const cells = Math.ceil(limit / unit) + 1;
  if (cells > 11) throw new Error("the range does not fit the scene");
  const gapFeet = cells * unit;
  await run(gm, P.sceneShape, { sceneId: W.scene, distance: unit, width: 1400 });
  const far = (await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: W.actor.far, name: "Widen Far", x: 100 + cells * 100, y: 300 }] }))[0];
  await track(far.uuid, "Token");
  try {
    check("B: the far token stands beyond the limit by at least one grid cell", gapFeet >= limit + unit, { cells });
    await aim(player, [far]);
    const p = await castAs(player, { spellId: W.spell.desiccate, stop: true });
    const out = p.verdicts.find((v) => v.severity === "block" || /range/iu.test(v.text));
    check("B: the Player's cast at the far token is refused for range (blocked, cast disabled)", p.dialog && !!out && p.castDisabled && p.verdicts.some((v) => v.severity !== "warn"), p.verdicts.map((v) => v.severity));
    check("B: the refusal's tooltip names the distance", !!out && out.tip.includes(String(gapFeet)), { tip: !!out?.tip });
    await aim(gm, [far]);
    const g = await castAs(gm, { spellId: W.spell.desiccate, stop: true });
    check("B: the GM's dialog warns for the same token, and the cast stays open", g.verdicts.some((v) => v.severity === "warn") && !g.castDisabled, g.verdicts.map((v) => v.severity));
    await aim(player, [W.t.a]);
    const near = await castAs(player, { spellId: W.spell.desiccate, stop: true });
    check("B: a token in range draws no verdict", near.dialog && near.verdicts.length === 0, near.verdicts.map((v) => v.severity));
  } finally {
    await run(gm, P.sceneShape, { sceneId: W.scene, distance: 5, width: 1400 });
  }
}

/* ----------------------------- C. picks ----------------------------- */
async function stageValuePicks() {
  await shape("cure-light-injury", NOROLL);
  await aim(player, [W.t.a]);
  const c = await castAs(player, { spellId: W.spell["cure-light-injury"], stop: true });
  if (!c.picks?.length) { gap("C: the dialog offers no pick for this copy"); return; }
  const options = c.picks.flat();
  check("C: every option label of the dialog is a row description, never an object", options.length > 0 && options.every((t) => t && !/object Object/iu.test(t)), { options: options.length });
}

/* --------------------------- D. defenses ---------------------------- */
async function stageDefenses() {
  const damage = await shape("desiccate", { unlimited: true, rows: [{ type: "damage", first: true, set: { roll: "8", delivery: "none", saveEffect: "half" } }], save: { category: "spell", kind: "", effect: "half" } });
  const types = damage.damageTypes;
  if (!types.length) { gap("D: the imported damage row lists no type; no band can cover it"); return; }
  const band = (extra) => ({ damage: types, effects: [], conditions: [], mundane: false, extraordinary: false, silverFlaw: false, note: "", ...extra });
  // The defenses table is imported from the seat's own book, so the resistant path is the priced one; the import is world registry state, not a fixture.
  await run(gm, P.importDefenses);
  let job = { done: false };
  for (let n = 0; n < 240 && !job.done; n++) { await sleep(500); job = await run(gm, P.importJob); }
  note("D: the defenses import finished", { done: job.done, ok: job.ok ?? false, error: job.error ?? null });
  const figures = await run(gm, P.defenseFigures);
  check("D: the defenses table is present after the import (the resistance fraction reads as a number)", job.ok === true && figures.fraction !== null, { ok: job.ok ?? false, fraction: figures.fraction !== null });
  const key0 = async (seat, tok) => { await aim(seat, [tok]); const c = await castAs(seat, { spellId: W.spell.desiccate }); return c; };
  const setBands = (actor, defenses) => run(gm, P.shapeMonster, { actorId: W.actor[actor], hp: 20, hd: 2, size: null, defenses });

  // Immune: the amount is 0 with a defense step and the save passes with no roll.
  await setBands("immune", { immunities: band({}) });
  await run(gm, P.rig, { seq: FAIL_SAVE });
  let c = await key0(gm, W.t.immune);
  await run(gm, P.rig, {});
  let key = firstDamageKey(c.model);
  let e = entriesOf(c.model, key)[0];
  const seen = await run(gm, P.seen, { messageId: c.messageId });
  check("D immune: the damage applies 0 with a defense step on the entry", c.card && e?.state === "applied" && e.applied === 0 && hasDefense(e, "immunities"), { state: e?.state, applied: e?.applied, steps: (e?.steps ?? []).map((s) => s.key) });
  check("D immune: the save passes with no roll (the card reads Auto)", e?.saved === true && seen.text.includes(await ev(gm, `globalThis.__mcw.loc("save.auto")`)), { saved: e?.saved });
  check("D immune: the hit points are untouched", (await hpOf(W.actor.immune))[0] === 20);

  // Resistant: the imported fraction, when the world holds one, of the rolled amount.
  await setBands("resistant", { resistances: band({}) });
  await run(gm, P.rig, { seq: FAIL_SAVE });
  c = await key0(gm, W.t.resistant);
  await run(gm, P.rig, {});
  key = firstDamageKey(c.model);
  e = entriesOf(c.model, key)[0];
  if (figures.fraction === null) check("D resistant: the import read a fraction, so the entry is priced (the fallback, the Judge's entry, is a FAIL)", false, { state: e?.state, judge: !!e?.defense });
  else {
    check("D resistant: the entry is applied with a defense step of the resistance band", e?.state === "applied" && (e.steps ?? []).some((s) => s.key === "defense" && s.band === "resistances"), { state: e?.state, steps: (e?.steps ?? []).map((s) => `${s.key}:${s.band ?? ""}`) });
    check("D resistant: applied is the rolled amount through the imported fraction, rounded half to even, and below the rolled one", e?.state === "applied" && e.applied === halfEven(e.rolled * figures.fraction) && e.applied < e.rolled, { rolled: e?.rolled, applied: e?.applied });
  }

  // Susceptible: the walk's own factor multiplies the amount.
  const factor = 2;
  await setBands("susceptible", { susceptibilities: band({ factor, save: 0 }) });
  await run(gm, P.rig, { seq: FAIL_SAVE });
  c = await key0(gm, W.t.susceptible);
  await run(gm, P.rig, {});
  key = firstDamageKey(c.model);
  e = entriesOf(c.model, key)[0];
  check("D susceptible: the walk's factor multiplies the rolled amount", e?.state === "applied" && e.applied === halfEven(e.rolled * factor), { rolled: e?.rolled, applied: e?.applied });

  // Weapon side: the walk's blade on the cast monster, typed from the imported row, at each fixture.
  await ev(gm, `game.actors.get(${JSON.stringify(W.monster)}).items.get(${JSON.stringify(W.weapon)}).update({ "system.damage.base.types": ${JSON.stringify(types)} })`);
  // The field is a SetField, which a JSON answer reads as {}; it is listed in the page.
  const kept = await ev(gm, `Array.from(game.actors.get(${JSON.stringify(W.monster)}).items.get(${JSON.stringify(W.weapon)}).system.damage?.base?.types ?? [])`);
  if (types.some((t) => !kept.includes(t))) gap("D weapon: the blade did not keep the imported type", { kept: kept.length });
  for (const [name, defenses] of [["immune", { immunities: band({}) }], ["resistant", { resistances: band({}) }], ["susceptible", { susceptibilities: band({ factor, save: 0 }) }]]) {
    await setBands(name, defenses);
    const hpBefore = (await hpOf(W.actor[name]))[0];
    await aim(gm, [W.t[name]]);
    await run(gm, P.rig, { seq: [0.025] });
    const a = await run(gm, P.attack, { sceneId: W.scene, tokenId: W.t.monster.id, itemId: W.weapon });
    await run(gm, P.rig, {});
    if (a.uuid) await track(a.uuid, "ChatMessage");
    check(`D weapon ${name}: the card posts with no core apply button and the module's stamp`, a.card && a.coreApply === false && !!a.stamp, { card: a.card });
    if (!a.card) continue;
    const view = await run(gm, P.seen, { messageId: a.id });
    if (name === "resistant" && figures.fraction === null) {
      // The fallback: with no fraction the defense is the Judge's, and the card offers no Apply (lib/attack-apply.mjs).
      check("D weapon resistant: no fraction was imported, so the card offers no Apply (a FAIL on the import above)", !view.actions.includes("libAttackApply"), view.actions);
      continue;
    }
    check(`D weapon ${name}: the GM's card offers the module's Apply`, view.actions.includes("libAttackApply"), view.actions);
    const pressed = await press(gm, { messageId: a.id, action: "libAttackApply" });
    const stamp = await run(gm, P.stamp, { messageId: a.id, state: "applied" });
    const hpAfter = (await hpOf(W.actor[name]))[0];
    const applied = stamp?.result?.applied;
    check(`D weapon ${name}: Apply writes the defended amount`, pressed.button && stamp?.result?.state === "applied" && hpBefore - hpAfter === applied, { applied });
    if (name === "immune") check("D weapon immune: the defended amount is 0", applied === 0);
    await press(gm, { messageId: a.id, action: "libAttackUndo" });
    await run(gm, P.stamp, { messageId: a.id, state: "undone" });
    check(`D weapon ${name}: Undo restores the hit points`, (await hpOf(W.actor[name]))[0] === hpBefore);
  }
}

/* ---------------------------- E. instances --------------------------- */
async function stageInstances() {
  await shape("sling-stone", { unlimited: true, rows: [{ type: "damage", first: true, set: { delivery: "missile", roll: "1d6", value: { kind: "perLevel", base: 1, per: 1 }, max: { kind: "flat", flat: 3 }, unread: [] } }], save: { category: "none" } });
  await run(gm, P.shapeMonster, { actorId: W.actor["target-a"], hp: 40, hd: 2, size: null, defenses: null });
  await run(gm, P.shapeMonster, { actorId: W.actor["target-b"], hp: 40, hd: 6, size: null, defenses: null });
  await aim(player, [W.t.a, W.t.b]);
  await rigBoth([0.025]);
  let c;
  try {
    c = await castAs(player, { spellId: W.spell["sling-stone"], coreDialogs: ["roll", "cancel", "roll"] });
  } finally {
    await rigBoth(null);
  }
  const key = firstDamageKey(c.model);
  const keyA = keyOf(c.model, W.t.a.uuid);
  const keyB = keyOf(c.model, W.t.b.uuid);
  const a = c.model?.entries?.[`${keyA}_${key}`];
  const b = c.model?.entries?.[`${keyB}_${key}`];
  check("E: the Player's cast split the count round-robin, A two instances and B one", c.card && a?.instances?.length === 2 && b?.instances?.length === 1, { a: a?.instances?.length, b: b?.instances?.length });
  check("E: one core attack card per thrown instance, each naming its own target", c.attackCards.length === 2 && c.attackCards.some((x) => x.target.includes(W.t.a.name)) && c.attackCards.some((x) => x.target.includes(W.t.b.name)) && c.attackCards.every((x) => !x.applyButton), c.attackCards.map((x) => x.target));
  note("E: core's dialogs answered, in order", c.dialogs);
  // Core keeps already-targeted tokens in place and appends the others, so the order is not the seat's: the ids are compared sorted.
  check("E: the seat's own targets are back as they were", JSON.stringify([...(c.targetsAfter ?? [])].sort()) === JSON.stringify([...(c.targetsBefore ?? [])].sort()), { before: c.targetsBefore?.length, after: c.targetsAfter?.length });
  check("E: the cancelled instance waits at Throw", a?.instances?.some((i) => i.state === "throw") && a?.state === "throw", { state: a?.state });
  // The Throw press aims at its own card target even when the seat holds another.
  await aim(player, [W.t.b]);
  await rigBoth([0.025]);
  let t;
  try {
    t = await press(player, { messageId: c.messageId, action: "magicCastThrow", target: keyA, row: key, coreDialogs: ["roll"] });
  } finally {
    await rigBoth(null);
  }
  check("E: the Throw press threw at the card's target (A), not the seat's (B)", t.button && t.attackCards.length === 1 && t.attackCards[0].target.includes(W.t.a.name), t.attackCards?.map((x) => x.target));
  let model = t.model ?? c.model;
  const pending = Object.entries(model?.entries ?? {}).filter(([, e]) => e.state === "pending").map(([id]) => id);
  if (pending.length) {
    const g = await press(gm, { messageId: c.messageId, action: "magicCastApplyTargets" });
    model = g.model ?? model;
    note("E: entries the GM applied by hand", pending.length);
  }
  check("E: every entry ends applied, the GM or the relay having applied it", Object.values(model?.entries ?? {}).every((e) => e.state === "applied"), Object.values(model?.entries ?? {}).map((e) => e.state));
  // The scaled count in a no-delivery formula.
  await shape("earths-excrescence", { unlimited: true, rows: [{ type: "damage", first: true, set: { delivery: "none", roll: "1d4", value: { kind: "perLevel", base: 1, per: 1 }, max: { kind: "flat", flat: 4 }, unread: [] } }] });
  await aim(gm, [W.t.a]);
  await run(gm, P.rig, { seq: PASS_SAVE });
  const f = await castAs(gm, { spellId: W.spell["earths-excrescence"] });
  await run(gm, P.rig, {});
  const view = await run(gm, P.seen, { messageId: f.messageId });
  // The formula lives in the section heading's tooltip and on the card's row, never in a td.acks-nums cell (those hold applied amounts).
  const fKey = firstDamageKey(f.model);
  const fRow = f.model?.rows?.[fKey];
  const count = fRow?.count?.value ?? null;
  const expected = count != null ? `${count}d4` : null;
  const heading = view.titles.find((x) => expected && x.tip.includes(expected));
  check("E: the row's formula carries the scaled count (the count rolled with the level, a die of the walk's own)", f.card && count > 1 && fRow?.formula === expected, { count, formula: fRow?.formula });
  check("E: the count's parts are kept on the row", Array.isArray(fRow?.count?.parts) && fRow.count.parts.length > 0, { parts: fRow?.count?.parts?.length });
  check("E: the section heading's tooltip is non-empty and carries the formula", view.titles.some((x) => x.tip.length > 0) && !!heading, { titles: view.titles.map((x) => x.tip.length), expected });
}

/* ------------------------------ F. gates ----------------------------- */
async function stageGates() {
  const sizes = await run(gm, P.sizeKeys);
  if (sizes.length < 2) { gap("F: the monsters config lists fewer than two sizes"); return; }
  const base = { unlimited: true, rows: [{ type: "damage", first: true, set: { delivery: "none", roll: "6", unread: [] } }], save: { category: "none" } };
  let shaped = await shape("earths-excrescence", base);
  let exemptKey = shaped.exemptKey;
  if (!exemptKey) {
    gap("F: the import left no exemptSizeFrom on a row; the walk sets one on its copy");
    exemptKey = sizes[sizes.length - 1];
    shaped = await shape("earths-excrescence", { ...base, rows: [...base.rows, { type: "damage", first: true, set: { exemptSizeFrom: exemptKey } }] });
  }
  check("F: the exempting size is a key of the monsters config", sizes.includes(exemptKey));
  await run(gm, P.shapeMonster, { actorId: W.actor.huge, hp: 40, hd: 2, size: exemptKey, defenses: null });
  await run(gm, P.shapeMonster, { actorId: W.actor["target-a"], hp: 40, hd: 2, size: sizes[0], defenses: null });
  const hp0 = await hpOf(W.actor.huge, W.actor["target-a"]);
  await aim(gm, [W.t.huge, W.t.a]);
  await run(gm, P.rig, { seq: PASS_SAVE });
  const c = await castAs(gm, { spellId: W.spell["earths-excrescence"] });
  await run(gm, P.rig, {});
  const keyH = keyOf(c.model, W.t.huge.uuid);
  const keyA = keyOf(c.model, W.t.a.uuid);
  const entriesAt = (k) => Object.entries(c.model?.entries ?? {}).filter(([id]) => id.startsWith(`${k}_`)).map(([, e]) => e);
  const exemptAtHuge = entriesAt(keyH).filter((e) => e.state === "exempt").length;
  check("F: the size-exempt rows read exempt at the target of the exempting size", c.card && exemptAtHuge === shaped.exemptRows, { exempt: exemptAtHuge, rows: shaped.exemptRows });
  check("F: no row reads exempt at the smallest size", entriesAt(keyA).every((e) => e.state !== "exempt"));
  const hp1 = await hpOf(W.actor.huge, W.actor["target-a"]);
  if (entriesAt(keyH).some((e) => e.state === "applied")) check("F: the rows that are not exempt still apply at the exempting size", hp1[0] < hp0[0]);
  else gap("F: every row is size-exempt at the exempting size, so no damage applies there to compare");
  check("F: the smaller target took its damage", hp1[1] < hp0[1]);

  // Hit Dice caps: the targets' Hit Dice are the walk's (2 and 6); the cap sits between them.
  const hd = { kind: "flat", flat: 4 };
  await run(gm, P.shapeMonster, { actorId: W.actor["target-a"], hp: 40, hd: 2, size: null, defenses: null });
  await run(gm, P.shapeMonster, { actorId: W.actor["target-b"], hp: 40, hd: 6, size: null, defenses: null });
  const rows = [{ type: "damage", first: true, set: { delivery: "none", roll: "5", saveEffect: "half", unread: [] } }];
  const s1 = await shape("slicing-blow", { unlimited: true, rows, target: { hdCap: hd }, save: { category: "spell", effect: "half" } });
  check("F: the copy's target model is set so the gate reads the copy's own cap", s1.targetModel);
  let hp = await hpOf(W.actor["target-a"], W.actor["target-b"]);
  await aim(gm, [W.t.a, W.t.b]);
  await run(gm, P.rig, { seq: FAIL_SAVE });
  let g = await castAs(gm, { spellId: W.spell["slicing-blow"] });
  await run(gm, P.rig, {});
  let after = await hpOf(W.actor["target-a"], W.actor["target-b"]);
  check("F cap: a target under the cap is hit and one over it is left alone", g.card && after[0] < hp[0] && after[1] === hp[1], { a: after[0] < hp[0], b: after[1] === hp[1] });
  const gatedB = entriesOf(g.model, firstDamageKey(g.model)).find((x) => x.id.startsWith(`${keyOf(g.model, W.t.b.uuid)}_`));
  check("F cap: the gated entry is marked and its state is not applied", !!gatedB && gatedB.state !== "applied" && !!gatedB.gate, { state: gatedB?.state });
  const s2 = await shape("slicing-blow", { unlimited: true, rows, target: { hdCap: null }, save: { category: "spell", effect: "half", exemptBelowHd: hd } });
  check("F below: the copy carries the walk's exemptBelowHd", s2.exemptBelowHd);
  hp = await hpOf(W.actor["target-a"], W.actor["target-b"]);
  await run(gm, P.rig, { seq: FAIL_SAVE });
  g = await castAs(gm, { spellId: W.spell["slicing-blow"] });
  await run(gm, P.rig, {});
  const ea = entriesOf(g.model, firstDamageKey(g.model)).find((x) => x.id.startsWith(`${keyOf(g.model, W.t.a.uuid)}_`));
  const eb = entriesOf(g.model, firstDamageKey(g.model)).find((x) => x.id.startsWith(`${keyOf(g.model, W.t.b.uuid)}_`));
  const noSaveOf = (key) => g.model?.targets?.[key]?.resist?.noSave ?? null;
  const keyA2 = keyOf(g.model, W.t.a.uuid);
  const keyB2 = keyOf(g.model, W.t.b.uuid);
  check("F below: a target under the threshold makes no save and the other does", !!ea && !!eb && !!noSaveOf(keyA2) && !noSaveOf(keyB2), { a: !!noSaveOf(keyA2), b: !!noSaveOf(keyB2) });
  // The no-save target takes the whole amount: the half the save would have given is not taken.
  const wholeOf = (e) => (Array.isArray(e?.instances) && e.instances.length ? e.instances.reduce((n, i) => n + (i.rolled ?? 0), 0) : e?.rolled);
  check("F below: the no-save target's entry applied the whole rolled amount", ea?.state === "applied" && ea.applied === wholeOf(ea), { state: ea?.state, applied: ea?.applied, rolled: wholeOf(ea) });
}

/* ---------------------------- G. record lives ------------------------- */
async function stageLives() {
  await run(gm, P.shapeMonster, { actorId: W.actor["target-a"], hp: 40, hd: 2, size: null, defenses: null });
  await run(gm, P.shapeMonster, { actorId: W.actor["target-b"], hp: 40, hd: 2, size: null, defenses: null });
  await run(gm, P.shapeMonster, { actorId: W.actor.huge, hp: 40, hd: 2, size: null, defenses: null });
  await shape("blinding-flash", { unlimited: true, save: { category: "none" } });
  const cm = await run(gm, P.combatNew, { sceneId: W.scene, tokenIds: [W.t.a.id, W.t.b.id] });
  await track(cm.uuid, "Combat");
  const byToken = Object.fromEntries(cm.combatants.map((x) => [x.tokenId, x.id]));
  await run(gm, P.combatSet, { combatId: cm.id, initiatives: { [byToken[W.t.b.id]]: 20, [byToken[W.t.a.id]]: 10 } });
  const mv0 = await run(gm, P.combatMove, { combatId: cm.id, update: { round: 1, turn: 0 } });
  for (const u of mv0.cards) await track(u, "ChatMessage");
  try {
    await aim(gm, [W.t.a]);
    await run(gm, P.rig, { seq: FAIL_SAVE });
    const c = await castAs(gm, { spellId: W.spell["blinding-flash"] });
    await run(gm, P.rig, {});
    const rec = (await run(gm, P.records, { actorId: W.actor["target-a"] })).filter((r) => r.castId === c.model?.castId);
    check("G fight: the record is held by the bearer's turn (turnLife edge end) and not by the clock", c.card && rec.length > 0 && rec.every((r) => r.turnLife?.edge === "end"), rec.map((r) => r.turnLife?.edge ?? null));
    const mv1 = await run(gm, P.combatMove, { combatId: cm.id, update: { turn: 1 } });
    const still = await run(gm, P.waitGone, { actorId: W.actor["target-a"], castId: c.model?.castId, tries: 4 });
    check("G fight: the record stands through the bearer's own turn", still > 0 && mv1.current === byToken[W.t.a.id], { left: still });
    const mv2 = await run(gm, P.combatMove, { combatId: cm.id, next: true });
    for (const u of [...mv1.cards, ...mv2.cards]) await track(u, "ChatMessage");
    const gone = await run(gm, P.waitGone, { actorId: W.actor["target-a"], castId: c.model?.castId });
    check("G fight: the record is gone once the bearer's turn has ended", gone === 0, { left: gone });
  } finally {
    await run(gm, P.rig, {});
    await run(gm, P.combatDrop, { combatId: cm.id });
  }
  // Outside a fight the record keeps a clock and goes when the world time passes its round.
  const round = await run(gm, P.roundSeconds);
  await aim(gm, [W.t.huge]);
  await run(gm, P.rig, { seq: FAIL_SAVE });
  const c2 = await castAs(gm, { spellId: W.spell["blinding-flash"] });
  await run(gm, P.rig, {});
  const rec2 = (await run(gm, P.records, { actorId: W.actor.huge })).filter((r) => r.castId === c2.model?.castId);
  check("G clock: no fight holds the bearer, so the record has no turn life and keeps a clock", rec2.length > 0 && rec2.every((r) => !r.turnLife && (r.hasDuration || r.startTime !== null)), { records: rec2.length });
  const view = await run(gm, P.seen, { messageId: c2.messageId });
  // The lang string carries a {count} slot; format() with no data prints it as "undefined", so the fixed lead before the slot is read raw.
  const endsClock = (await ev(gm, `game.i18n.localize("ACKS-MAGIC.cast.tip.endsClock")`)).split("{")[0].trim();
  check("G clock: the entry's tooltip says the clock ends it", endsClock.length > 3 && view.cells.some((x) => x.tip.includes(endsClock)));
  await run(gm, P.time, { advance: round - 1 });
  check("G clock: a second short of the round, the record stands", (await run(gm, P.waitGone, { actorId: W.actor.huge, castId: c2.model?.castId, tries: 2 })) > 0);
  await run(gm, P.time, { advance: 2 });
  check("G clock: the round passed, the record is gone", (await run(gm, P.waitGone, { actorId: W.actor.huge, castId: c2.model?.castId })) === 0);
}

/* ------------------------ H. recurring prompts ------------------------ */
/** The prompts a cast has posted that this walk has not yet taken, polled for a while. */
async function promptFor(castId, exclude, { seconds = 10 } = {}) {
  for (let n = 0; n < seconds * 2; n++) {
    const list = await run(gm, P.prompts, { castId, flagName: S3R.messageFlag, modelKey: S3R.modelKey, exclude });
    if (list.length) return list;
    await sleep(500);
  }
  return [];
}
/** Move the tracker turn by turn until a new prompt of the cast appears (at most `max` moves). */
async function untilPrompt(combatId, castId, exclude, max = 5) {
  let list = await promptFor(castId, exclude, { seconds: 2 });
  for (let n = 0; n < max && !list.length; n++) {
    const mv = await run(gm, P.combatMove, { combatId, next: true });
    for (const u of mv.cards) await track(u, "ChatMessage");
    list = await promptFor(castId, exclude, { seconds: 4 });
  }
  for (const p of list) await track(p.uuid, "ChatMessage");
  return list;
}
/** A fight of the caster and these tokens, begun with the caster first; the cast must already have been made while no fight held the caster. */
async function fightOf(tokens) {
  const all = [W.t.caster, ...tokens];
  const cm = await run(gm, P.combatNew, { sceneId: W.scene, tokenIds: all.map((t) => t.id) });
  await track(cm.uuid, "Combat");
  const byToken = Object.fromEntries(cm.combatants.map((x) => [x.tokenId, x.id]));
  await run(gm, P.combatSet, { combatId: cm.id, initiatives: Object.fromEntries(all.map((t, i) => [byToken[t.id], 30 - i * 10])) });
  const mv = await run(gm, P.combatMove, { combatId: cm.id, update: { round: 1, turn: 0 } });
  for (const u of mv.cards) await track(u, "ChatMessage");
  return cm;
}

async function stageRecurring() {
  const here = await run(gm, P.hasActions, { actions: Object.values(S3R.actions) });
  if (!here) { skip("H: the recurring prompts' card actions are not in this build"); return; }
  const bearer = W.t.a;
  const bearerId = W.actor["target-a"];
  const reset = async () => {
    await run(gm, P.shapeMonster, { actorId: bearerId, hp: 40, hd: 2, size: null, defenses: null });
    await run(gm, P.shapeMonster, { actorId: W.actor.far, hp: 40, hd: 2, size: null, defenses: null });
  };

  // thunderclap: the bearer's prompt at the moment; a Player who does not own the bearer cannot press Save; a Save pass removes the record.
  await reset();
  await shape("thunderclap", { unlimited: true, save: { category: "spell", effect: "negates" } });
  await aim(gm, [bearer]);
  await run(gm, P.rig, { seq: FAIL_SAVE });
  let c = await castAs(gm, { spellId: W.spell.thunderclap });
  await run(gm, P.rig, {});
  let fight = await fightOf([bearer]);
  try {
    const rec = (await run(gm, P.records, { actorId: bearerId })).filter((r) => r.castId === c.model?.castId);
    let prompts = await untilPrompt(fight.id, c.model?.castId, []);
    check("H thunderclap: the bearer's prompt is posted at the moment", c.card && rec.length > 0 && prompts.length > 0, { records: rec.length, prompts: prompts.length });
    if (prompts.length) {
      const viaPlayer = await press(player, { messageId: prompts[0].id, action: S3R.actions.save });
      await sleep(1500);
      const afterPlayer = await run(gm, P.waitGone, { actorId: bearerId, castId: c.model?.castId, tries: 1 });
      check("H thunderclap: a Player cannot press Save for a bearer it does not own", afterPlayer > 0, { pressed: viaPlayer.button, left: afterPlayer });
      await run(gm, P.rig, { seq: PASS_SAVE });
      const saved = await press(gm, { messageId: prompts[0].id, action: S3R.actions.save });
      await run(gm, P.rig, {});
      const left = await run(gm, P.waitGone, { actorId: bearerId, castId: c.model?.castId });
      check("H thunderclap: a Save pass removes the record", saved.button && left === 0, { left });
    }
  } finally { await run(gm, P.rig, {}); await run(gm, P.combatDrop, { combatId: fight.id }); }

  // chokingGrip: a failed save applies damage; a passed one ends the cast.
  await reset();
  await shape("choking-grip", { unlimited: true, save: { category: "spell", effect: "negates" } });
  await aim(gm, [bearer]);
  await run(gm, P.rig, { seq: FAIL_SAVE });
  c = await castAs(gm, { spellId: W.spell["choking-grip"] });
  await run(gm, P.rig, {});
  fight = await fightOf([bearer]);
  try {
    const seen = [];
    const hp0 = (await hpOf(bearerId))[0];
    let prompts = await untilPrompt(fight.id, c.model?.castId, seen);
    seen.push(...prompts.map((p) => p.id));
    const casterRecords = (await run(gm, P.records, { actorId: W.caster })).filter((r) => r.castId === c.model?.castId);
    note("H chokingGrip: diagnostics (presence only)", { held: Boolean(c.model?.duration?.held), none: c.model?.duration?.none ?? null, casterRecord: casterRecords.length > 0, casterRecordHeld: casterRecords.some((r) => r.held != null) });
    if (!prompts.length) check("H chokingGrip: a prompt is posted", false, { held: Boolean(c.model?.duration?.held), none: c.model?.duration?.none ?? null, casterRecord: casterRecords.length > 0 });
    else {
      await run(gm, P.rig, { seq: FAIL_SAVE });
      await press(gm, { messageId: prompts[0].id, action: S3R.actions.save });
      await run(gm, P.rig, {});
      await sleep(1000);
      check("H chokingGrip: a failed Save applies the damage", (await hpOf(bearerId))[0] < hp0);
      prompts = await untilPrompt(fight.id, c.model?.castId, seen);
      if (!prompts.length) check("H chokingGrip: a second prompt is posted", false);
      else {
        await run(gm, P.rig, { seq: PASS_SAVE });
        await press(gm, { messageId: prompts[0].id, action: S3R.actions.save });
        await run(gm, P.rig, {});
        await sleep(2500);
        const ends = await run(gm, P.endCards, { since: startedAt, castId: c.model?.castId });
        for (const e of ends) await track(e.uuid, "ChatMessage");
        // A held cast ends with a `saved` end card (ruling 97); an untimed one (ruling 96a) has its caster record removed by endCast.
        const heldCast = casterRecords.some((r) => r.held != null);
        const casterLeft = (await run(gm, P.records, { actorId: W.caster })).filter((r) => r.castId === c.model?.castId).length;
        if (heldCast) check("H chokingGrip: a passed Save ends the held record with an end card", ends.length === 1 && ends[0].cause === "saved", ends.map((e) => e.cause));
        else check("H chokingGrip: a passed Save ends the untimed cast, its caster record gone", casterLeft === 0, { casterLeft, ends: ends.map((e) => e.cause) });
      }
    }
  } finally { await run(gm, P.rig, {}); await run(gm, P.combatDrop, { combatId: fight.id }); }

  // mageMissile: the Roll prompt fires at the Player's one target and refuses the far token.
  await reset();
  // The copy carries a measured range of the walk's own (20 feet, invented): the bearer stands one cell off the caster, the far token eight.
  await shape("mage-missile", { rows: [{ type: "damage", first: true, set: { roll: "6", delivery: "none" } }], set: { range: { shape: "distance", value: 20, unit: "feet" }, "target.count": null, "target.model": "creature" } });
  await aim(player, [bearer]);
  c = await castAs(player, { spellId: W.spell["mage-missile"] });
  fight = await fightOf([bearer]);
  try {
    const prompts = await untilPrompt(fight.id, c.model?.castId, []);
    check("H mageMissile: a prompt is posted for the Player's cast", c.card && prompts.length > 0, { prompts: prompts.length });
    if (prompts.length) {
      const far = (await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: W.actor.far, name: "Widen Far prompt", x: 900, y: 300 }] }))[0];
      await track(far.uuid, "Token");
      const hp0 = await hpOf(bearerId, W.actor.far);
      await aim(player, [far]);
      const refused = await press(player, { messageId: prompts[0].id, action: S3R.actions.roll });
      await sleep(1000);
      const hp1 = await hpOf(bearerId, W.actor.far);
      check("H mageMissile: the Roll at a token out of the cast's reach is refused, nothing is hurt", refused.button && hp1[0] === hp0[0] && hp1[1] === hp0[1], { pressed: refused.button });
      await aim(player, [bearer]);
      await press(player, { messageId: prompts[0].id, action: S3R.actions.roll });
      await sleep(1500);
      check("H mageMissile: the Roll at the Player's one target hurts it", (await hpOf(bearerId))[0] < hp0[0]);
    }
  } finally { await run(gm, P.combatDrop, { combatId: fight.id }); }

  // kindleFlame: the burning prompts Roll at the bearer's turn start.
  await reset();
  await shape("kindle-flame", { unlimited: true, save: { category: "spell", effect: "negates" } });
  await aim(gm, [bearer]);
  await run(gm, P.rig, { seq: FAIL_SAVE });
  // The burn row sits in pick group `use`, option `creature`; nothing picked means the first option, so the pick is set.
  c = await castAs(gm, { spellId: W.spell["kindle-flame"], picks: { use: "creature" } });
  await run(gm, P.rig, {});
  fight = await fightOf([bearer]);
  try {
    const hp0 = (await hpOf(bearerId))[0];
    const prompts = await untilPrompt(fight.id, c.model?.castId, []);
    check("H kindleFlame: the burning posts a Roll prompt at the bearer's turn", prompts.length > 0, { moments: prompts.map((p) => p.moment) });
    if (prompts.length) {
      await run(gm, P.rig, { seq: [0.5] });
      await press(gm, { messageId: prompts[0].id, action: S3R.actions.roll });
      await run(gm, P.rig, {});
      await sleep(1000);
      check("H kindleFlame: pressing Roll hurts the bearer", (await hpOf(bearerId))[0] < hp0);
    }
  } finally { await run(gm, P.rig, {}); await run(gm, P.combatDrop, { combatId: fight.id }); }

  // Next round outside a fight: a recurring cast no fight holds offers it and posts the next round's prompt.
  await reset();
  await shape("choking-grip", { unlimited: true, save: { category: "spell", effect: "negates" } });
  await aim(gm, [W.t.huge]);
  await run(gm, P.rig, { seq: FAIL_SAVE });
  c = await castAs(gm, { spellId: W.spell["choking-grip"] });
  await run(gm, P.rig, {});
  const view = await run(gm, P.seen, { messageId: c.messageId });
  check("H next round: the cast's card offers Next round while no fight holds it", view.actions.includes(S3R.actions.nextRound), view.actions);
  if (view.actions.includes(S3R.actions.nextRound)) {
    const next = await press(gm, { messageId: c.messageId, action: S3R.actions.nextRound });
    const prompts = await promptFor(c.model?.castId, [], { seconds: 8 });
    for (const p of prompts) await track(p.uuid, "ChatMessage");
    const casterRecords = (await run(gm, P.records, { actorId: W.caster })).filter((r) => r.castId === c.model?.castId);
    check("H next round: pressing it posts the prompt of the next round", prompts.length > 0, { prompts: prompts.length, warns: next.warns, held: Boolean(c.model?.duration?.held), none: c.model?.duration?.none ?? null, casterRecord: casterRecords.length > 0 });
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

  await stage("A. setup", stageSetup);
  if (W.t) {
    await stage("B. range (S3p)", stageRange);
    await stage("C. picks (S3p)", stageValuePicks);
    await stage("D. defenses (S3d)", stageDefenses);
    await stage("E. instances (S3i)", stageInstances);
    await stage("F. gates (S3g)", stageGates);
    await stage("G. record lives (S3l)", stageLives);
    await stage("H. recurring prompts (S3r)", stageRecurring);
  }
  section("console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, P.drain);
    check(`${label}: no console error was recorded since the seat was installed`, d.errors.length === 0, d.errors.slice(0, 3));
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
  try { if (gm && W.scene) await run(gm, P.sceneShape, { sceneId: W.scene, distance: 5, width: 1400 }); } catch {}
  // The run's own leavings, listed by id: this run's casts' records on its fixtures (a held record's deletion ends its cast through the
  // funnel, which posts a card, so those go first and the cards are given time to land), the cards speaking as its fixtures since it began.
  try {
    if (gm && W.caster) {
      await gm.eval(`(async () => { const ids = ${JSON.stringify(castIds)}; for (const a of game.actors.filter((x) => String(x.flags?.world?.fixture ?? "").match(/^magic\\/(widen|defense|cast-monster)/))) { const held = [...a.effects].filter((e) => ids.includes(e.flags?.["acks-extras"]?.spellEffect?.castId) && e.flags["acks-extras"].spellEffect.held).map((e) => e.id); if (held.length) await a.deleteEmbeddedDocuments("ActiveEffect", held); } await new Promise((r) => setTimeout(r, 2500)); return true; })()`);
      const ledger = JSON.parse(await gm.eval(`(async () => JSON.stringify({ cards: [...game.messages].filter((m) => m.timestamp >= ${startedAt} && (game.actors.some((a) => String(a.flags?.world?.fixture ?? "").match(/^magic\\/(widen|defense|cast-monster)/) && a.id === m.speaker?.actor) || ${JSON.stringify(castIds)}.includes(m.flags?.["acks-extras"]?.castHeldEnd?.castId))).map((m) => m.uuid), records: game.actors.filter((a) => String(a.flags?.world?.fixture ?? "").match(/^magic\\/(widen|defense|cast-monster)/)).flatMap((a) => [...a.effects].filter((e) => ${JSON.stringify(castIds)}.includes(e.flags?.["acks-extras"]?.spellEffect?.castId)).map((e) => e.uuid)) }))()`));
      for (const uuid of ledger.cards) await track(uuid, "ChatMessage");
      for (const uuid of ledger.records) await track(uuid, "ActiveEffect");
    }
  } catch (err) { console.error("ledger:", err?.message ?? err); }
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: magic/widen-scene, magic/widen-class, magic/widen-caster, magic/widen-spell-<id> x12, magic/widen-target-a, -b, magic/widen-far, magic/widen-huge, magic/defense-immune, -resistant, -susceptible, magic/cast-monster, magic/defense-weapon");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
