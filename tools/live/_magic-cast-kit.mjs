/**
 * The shared half of the spell-effects walks `magic-cast-saves.mjs` and
 * `magic-cast-buffs.mjs`: the check printer, the driver-side plumbing (`run`,
 * `ev`, `ready`, the walk's ledger and teardown) and the page-side functions
 * both walks run on a seat (`P`, installed under `globalThis.__mck`). A walk
 * spreads `P` into its own page functions and adds the ones only it needs. The
 * underscore keeps the runner and the walk-end gate from taking this file for a
 * walk. Nothing here names a path, a port, a world, a user or a book: the
 * machine's values arrive through ./_env.mjs, and every spell a walk casts is
 * built by it from invented rows on invented names (`spellFlag`, `rowOf`).
 *
 * The cast dialog is the ApplicationV2 window found by
 * `.application.acks-extras-cast`; it re-renders on every change, so `P.cast`
 * reads the live element again after each step.
 */
import { sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, logDir } from "./_env.mjs";

export { PORTS, sleep, logDir };
export const MACHINE = machineSeats();

export const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
export const section = (title) => console.log(`\n== ${title} ==`);
export const checks = [];
export const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
export const gap = (label, detail) => console.log(`GAP  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
export const skip = (label, detail) => console.log(`SKIP  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
export const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();

/** The first Hit Dice figure of a monster in a step, the saving throw target the walk gives every monster, and the dice that pass or fail it (the rig reads from the top: 0.025 throws a 20, 0.975 a 1). */
export const SAVE_TARGET = 15;
export const PASS_SAVE = [0.025];
export const FAIL_SAVE = [0.975];
/** The caster level every cast resolves at (the class level): the walk's own figure. */
export const LEVEL = 5;
/** The duration every invented spell carries unless a step names another: the walk's own, a fixed two hours. */
export const DURATION = { shape: "fixed", value: 2, unit: "hours" };

/** A flat level value, the shape the spell flag stores a figure in. */
export const flat = (n) => ({ kind: "flat", flat: n });

/**
 * An invented effect row: `key` and `type` and whatever fields the step names. It is aimed at the target and no save governs it unless a step
 * says so; it has no lasting of its own unless a step names one, since a slay, a destroy and a lifting row carry none.
 */
export const rowOf = (key, type, fields = {}) => ({ key, type, appliesTo: "target", saveEffect: "none", ...fields });

/**
 * An invented spell flag (the module's spell primitive): one first-level arcane list, an unlimited range, no target cap, the row list,
 * and the target and save blocks a step overrides. Written onto a spell item whole, after the old flag is deleted, so no stale key survives.
 */
export const spellFlag = ({ rows, target = {}, save = {}, duration = DURATION, range = { shape: "unlimited" }, level = 1 }) => ({
  lists: [{ source: "arcane", level, classes: [], note: "" }],
  range,
  duration,
  target: { model: "creature", count: null, filters: [], hdBelow: null, ...target },
  save: { category: "spell", effect: "negates", kind: "", modifier: null, ...save },
  effects: rows,
  cite: "",
});

/** The entries of a cast card's model that belong to one row key. */
export const entriesOf = (model, rowKey) => Object.entries(model?.entries ?? {}).filter(([id]) => id.endsWith(`_${rowKey}`)).map(([id, e]) => ({ id, ...e }));
/** The card's target key for a token uuid. */
export const keyOf = (model, uuid) => Object.entries(model?.targets ?? {}).find(([, t]) => t.uuid === uuid)?.[0];
/** The one entry of a row on a target token, by uuid. */
export const entryAt = (model, uuid, rowKey) => entriesOf(model, rowKey).find((e) => e.id.startsWith(`${keyOf(model, uuid)}_`)) ?? null;

/** A stage runs apart: a throw in one is a failed check and the next stage still runs. */
export async function stage(name, fn) {
  section(name);
  try { await fn(); } catch (err) {
    console.error(`WALK ERROR (${name}):`, err?.stack ?? err);
    check(`${name} ran to the end`, false, String(err?.message ?? err).slice(0, 200));
  }
}

/** Runs `fn` in a seat's page with JSON arguments and answers its JSON result. */
export async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
/** A one-off page expression, awaited. */
export const ev = async (api, expr) => JSON.parse(await api.eval(`(async () => JSON.stringify((await (${expr})) ?? null))()`));

/** Waits until a seat has loaded the world and the module's magic api; answers the seconds it took. */
export async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * The run's ledger: the uuids it tracked on the GM seat (`track`), the cast ids it made (`castIds`), and the time it began. Teardown deletes
 * exactly what these name, by id, through the driver's `sweepTracked({only})`.
 */
export function ledgerFor(getGm) {
  const own = [];
  const castIds = [];
  return {
    own,
    castIds,
    startedAt: Date.now(),
    async track(uuid, kind) {
      if (!uuid || own.includes(uuid)) return;
      own.push(uuid);
      await getGm().track(uuid, kind);
    },
  };
}

/**
 * The end of a walk, in a `finally`: restores each seat's rig and recorders, clears the seats' targets, then lists the run's own leavings by id
 * (the records its casts wrote on its fixtures, by cast id or by a caster of its own, and the cards speaking as its fixtures since it began or carrying its cast ids) and
 * sweeps the ledger. `fixtureRe` is the marker pattern of the walk's own fixtures; it only finds the run's leavings to LIST, and what is listed is
 * the key.
 */
export async function finish({ gm, player, ledger, fixtureRe, restore }) {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`rig and recorders restored (${label})`, await run(seat, restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
    try { if (seat) await seat.eval(`document.getElementById("acks-walk-frame")?.remove(); canvas.tokens?.setTargets([]); 0`); } catch {}
  }
  try {
    if (gm) {
      const leavings = JSON.parse(await gm.eval(`(async () => {
        const re = new RegExp(${JSON.stringify(fixtureRe)});
        const ids = ${JSON.stringify(ledger.castIds)};
        const own = game.actors.filter((a) => re.test(String(a.flags?.world?.fixture ?? "")));
        const ownIds = own.map((a) => a.id);
        const castBy = (e) => { const u = e.flags?.["acks-extras"]?.spellEffect?.casterUuid; const c = u ? fromUuidSync(u) : null; return !!c && re.test(String(c.flags?.world?.fixture ?? "")); };
        const records = own.flatMap((a) => [...a.effects].filter((e) => ids.includes(e.flags?.["acks-extras"]?.spellEffect?.castId) || (e.flags?.["acks-extras"]?.spellEffect && castBy(e))).map((e) => e.uuid));
        const cards = [...game.messages].filter((m) => m.timestamp >= ${ledger.startedAt} && (ownIds.includes(m.speaker?.actor) || ids.includes(m.flags?.["acks-extras"]?.castCard?.castId) || ids.includes(m.flags?.["acks-extras"]?.castHeldEnd?.castId))).map((m) => m.uuid);
        return JSON.stringify({ records, cards });
      })()`));
      for (const uuid of leavings.records) await ledger.track(uuid, "ActiveEffect");
      for (const uuid of leavings.cards) await ledger.track(uuid, "ChatMessage");
    }
  } catch (err) { console.error("ledger:", err?.message ?? err); }
  try { if (gm && ledger.own.length) note("swept", await gm.sweepTracked({ only: ledger.own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
}

/** The summary every walk ends with; sets the exit code. */
export function summarize() {
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page,   */
/*  so it closes over nothing and shares state through `__mck`.         */
/* ------------------------------------------------------------------ */
export const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mck = globalThis.__mck ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 250 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    // What the cast dialog's bucket shows: one entry per target row, the count, the drop strip, the Add my token button, and each effect cell's tone.
    H.bucketOf = (root) => ({
      rows: [...root.querySelectorAll(".acks-extras-cast-trow")].map((r) => ({ uuid: r.dataset.uuid, x: !!r.querySelector('[data-action="untarget"][aria-label]'), off: r.classList.contains("is-off"), pills: [...r.querySelectorAll(".acks-extras-cast-pill")].map((p) => ({ id: p.dataset.weapon, on: p.classList.contains("is-on") })), chips: r.querySelectorAll(".acks-extras-cast-chip").length })),
      count: root.querySelector(".acks-extras-cast-count")?.textContent.trim() ?? "",
      over: !!root.querySelector(".acks-extras-cast-count.is-over"),
      drop: !!root.querySelector(".acks-extras-cast-drop"),
      addMine: !!root.querySelector('button[data-action="addMine"]'),
      tones: [...root.querySelectorAll(".acks-extras-cast-cell .acks-extras-frame__cell")].map((c) => ["neg", "pos", "ts"].find((t) => c.classList.contains(`is-${t}`)) ?? ""),
    });
    // The whole dialog as one step reads it: the bucket, the verdicts the footer lists, the Cast button, the save band's toggle and parts, and the kind pick.
    H.dialogOf = (root) => ({
      dialog: true,
      bucket: H.bucketOf(root),
      verdicts: [...root.querySelectorAll(".acks-extras-cast-verdicts li")].map((li) => li.dataset.severity),
      castDisabled: !!root.querySelector('button[data-action="cast"]')?.disabled,
      toggle: (() => { const c = root.querySelector('input[name="saveMod"]'); return c ? { disabled: c.disabled, checked: c.checked } : null; })(),
      saveParts: [...root.querySelectorAll(".acks-extras-cast-parts li")].map((li) => ({ label: li.children[0]?.textContent.trim() ?? "", value: li.children[1]?.textContent.trim() ?? "" })),
      kind: (() => { const s = root.querySelector('select[name="pickKind"]'); return s ? { options: [...s.options].map((o) => o.value), value: s.value } : null; })(),
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
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  drain: async () => {
    const H = globalThis.__mck;
    const out = { errors: H.errors.slice(), warns: H.warns.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    return out;
  },
  /** The number of warnings this seat has recorded, so a step reads only what came after it. */
  warnMark: async () => globalThis.__mck.warns.length,
  warnsSince: async ({ from }) => globalThis.__mck.warns.slice(from),
  /** GM: wait for the RR, import the named spells through the importer, and read the rows each carries as kinds, never as figures. */
  registerShape: async ({ ids }) => {
    const H = globalThis.__mck;
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await H.poll(() => acksExtras.importer?.bookOpen?.("rr"), { tries: 600, every: 200 });
    if (!acksExtras.importer?.bookOpen?.("rr")) return { rr: false, spells: {} };
    await acksExtras.importer.importSpells({ only: new Set(ids), repair: { replaced: 0, refused: 0, keptProse: 0 } });
    const spells = {};
    for (const id of ids) {
      const doc = L.byCookbookId("Item", id, { original: true });
      const flag = doc?.getFlag("acks-extras", "spell");
      const rows = Array.from(flag?.effects ?? []);
      spells[id] = !doc ? null : {
        kinds: rows.map((r) => r.type),
        saveEffects: rows.map((r) => r.saveEffect || ""),
        lasts: rows.map((r) => r.lasts || ""),
        endsOn: rows.flatMap((r) => Array.from(r.endsOn ?? [])),
        untimed: rows.flatMap((r) => Array.from(r.untimed ?? [])),
        picked: rows.filter((r) => r.pickKind === true).length,
        attackKinds: rows.flatMap((r) => Array.from(r.attackKinds ?? [])),
        modes: rows.map((r) => r.mode || ""),
        hdBelow: Number.isFinite(Number(flag?.target?.hdBelow?.flat)),
        filters: Array.from(flag?.target?.filters ?? []),
        reversedDuration: !!flag?.reversedDuration?.shape,
      };
    }
    return { rr: true, spells };
  },
  /** The caster at a class level, bound to the walk's class, nothing spent. */
  shapeCaster: async ({ casterId, classUuid, level, alignment }) => {
    await game.actors.get(casterId).update({ "system.details.level": level, "system.spells.enabled": true, "flags.acks-extras.classes.uuid": classUuid, "flags.acks-extras.classes.pools": { arcane: { s1: 0 } }, ...(alignment ? { "system.details.alignment": alignment } : {}) });
    return true;
  },
  setSpent: async ({ casterId }) => {
    await game.actors.get(casterId).update({ "flags.acks-extras.classes.pools": { arcane: { s1: 0 } } });
    return true;
  },
  /**
   * A monster at known hit points, Hit Dice and saves, with the creature kinds a step names (none when `kinds` is empty). Answers what
   * the world reads back: the Hit Dice, the kinds and the armour class.
   */
  shapeMonster: async ({ actorId, hp, hd, kinds, saveTarget }) => {
    const a = game.actors.get(actorId);
    const saves = Object.fromEntries(["paralysis", "death", "blast", "implements", "spell"].map((s) => [`system.saves.${s}.value`, saveTarget]));
    await a.update({ "system.hp.value": hp, "system.hp.max": hp, "system.hp.hd": String(hd), ...saves });
    await a.update({ "flags.acks-extras.extras.-=types": null });
    if (kinds?.length) await a.update({ "flags.acks-extras.extras.types": kinds });
    return { hd: String(a.system.hp.hd), kinds: Array.from(a.getFlag("acks-extras", "extras")?.types ?? []), ac: Number(a.system.ac?.value ?? NaN) };
  },
  /** Write an invented spell flag onto a spell item whole, after deleting the old flag and cookbook stamp. `cookbook` is the id a record's immunity names. */
  writeSpell: async ({ casterId, itemId, flag, cookbook }) => {
    const item = game.actors.get(casterId).items.get(itemId);
    await item.update({ "flags.acks-extras.-=spell": null, "flags.acks-extras.-=cookbook": null });
    // Core's own level follows the flag's first list, so the two never disagree about what the spell is.
    await item.update({ "system.cast": 0, "system.lvl": flag.lists?.[0]?.level ?? 1, "flags.acks-extras.spell": flag, ...(cookbook ? { "flags.acks-extras.cookbook": { id: cookbook } } : {}) });
    const read = item.getFlag("acks-extras", "spell") ?? {};
    return { rows: Array.from(read.effects ?? []).length, kinds: Array.from(read.effects ?? []).map((r) => r.type), keys: Array.from(read.effects ?? []).map((r) => r.key), name: item.name };
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
    const made = await scene.createEmbeddedDocuments("Token", specs.map((s) => ({ actorId: s.actorId, x: s.x, y: s.y, name: s.name, actorLink: true, disposition: s.disposition ?? -1 })));
    return specs.map((s) => made.find((t) => t.actorId === s.actorId)).filter(Boolean).map((t) => ({ id: t.id, uuid: t.uuid, actorId: t.actorId, name: t.name }));
  },
  /** Make exactly these tokens this seat's targets, as a user does with T; answers the ids the seat holds. */
  target: async ({ sceneId, tokenIds }) => {
    if (canvas.scene?.id !== sceneId) return -1;
    canvas.tokens.setTargets(tokenIds, { mode: "replace" });
    await new Promise((r) => setTimeout(r, 400));
    return [...game.user.targets].map((t) => t.id);
  },
  hp: async ({ actorIds }) => actorIds.map((id) => game.actors.get(id)?.system.hp.value ?? null),
  setHp: async ({ actorId, value }) => { await game.actors.get(actorId).update({ "system.hp.value": value }); return true; },
  rig: async ({ seq }) => {
    const H = globalThis.__mck;
    if (!seq) { if (H.dice) CONFIG.Dice.randomUniform = H.dice; H.dice = null; return "restored"; }
    H.dice ??= CONFIG.Dice.randomUniform;
    let i = 0;
    CONFIG.Dice.randomUniform = () => seq[i++ % seq.length];
    return "rigged";
  },
  /**
   * Cast as a user does: `item.use()`, then the dialog, driven by its own controls (the mode radio, a choice's radio, the kind select, the
   * save toggle, a weapon pill of a holder row keyed by token uuid), then Cast. With `stop` the dialog is read and cancelled; with `hold` it is read
   * and left open for a shot (`closeDialog` cancels it). Answers what the dialog showed, the card, its model and whether its entries settled.
   */
  cast: async ({ casterId, spellId, mode, picks, kind, saveMod, weapons, hold, stop, wait }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    const before = new Set([...game.messages].map((m) => m.id));
    item.use({ skipDialog: true });
    const found = await H.poll(() => document.querySelector(".application.acks-extras-cast") ?? null, { tries: 80, every: 150 });
    if (!found) return { dialog: false };
    const live = () => document.querySelector(".application.acks-extras-cast") ?? found;
    const changed = async (el) => { el.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(350); };
    if (mode) { const r = live().querySelector(`input[name="mode"][value="${mode}"]`); if (r) { r.checked = true; await changed(r); } }
    for (const [group, value] of Object.entries(picks ?? {})) {
      const r = live().querySelector(`input[data-pick="${group}"][value="${value}"]`);
      if (r) { r.checked = true; await changed(r); }
    }
    if (kind) { const s = live().querySelector('select[name="pickKind"]'); if (s) { s.value = kind; await changed(s); } }
    if (saveMod != null) { const c = live().querySelector('input[name="saveMod"]'); if (c && !c.disabled) { c.checked = !!saveMod; await changed(c); } }
    for (const [uuid, id] of Object.entries(weapons ?? {})) {
      const pill = live().querySelector(`.acks-extras-cast-trow[data-uuid="${uuid}"] .acks-extras-cast-pill[data-weapon="${id}"]`);
      if (pill) { pill.click(); await H.sleep(350); }
    }
    const shown = H.dialogOf(live());
    if (hold) return { ...shown, held: true };
    if (stop) {
      live().querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { ...shown, cancelled: true, cards: [...game.messages].filter((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard).length };
    }
    const button = live().querySelector('button[data-action="cast"]');
    if (button.disabled) {
      live().querySelector('button[data-action="cancel"]')?.click();
      await H.sleep(600);
      return { ...shown, card: false, blocked: true };
    }
    button.click();
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === item.uuid), { tries: 120, every: 250 });
    if (!message) return { ...shown, card: false };
    const settled = await H.poll(() => !Object.values(game.messages.get(message.id).flags["acks-extras"].castCard.entries).some((e) => e.state === "pending" || e.state === "applying"), { tries: wait ?? 40, every: 250 });
    await H.sleep(400);
    return { ...shown, card: true, messageId: message.id, settled: !!settled, model: game.messages.get(message.id).flags["acks-extras"].castCard };
  },
  /** Cancel the open cast dialog; answers whether a dialog was left standing. */
  closeDialog: async () => {
    const H = globalThis.__mck;
    document.querySelector(".application.acks-extras-cast button[data-action='cancel']")?.click();
    await H.sleep(600);
    return !!document.querySelector(".application.acks-extras-cast");
  },
  /** The spell records on an actor: the mark, the statuses, what each ends on, the turn life, and the parts lib reads from it, reduced to what a step compares. */
  records: async ({ actorId }) => [...game.actors.get(actorId).effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect).map((e) => {
    const f = e.flags["acks-extras"];
    const mark = f.spellEffect;
    return {
      id: e.id,
      uuid: e.uuid,
      castId: mark.castId,
      role: mark.role ?? null,
      casterUuid: mark.casterUuid ?? null,
      spell: f.rollMods?.label ?? "",
      statuses: [...e.statuses],
      endsOn: Array.from(f.endsOn ?? []),
      turnLife: f.turnLife ?? mark.turnLife ?? null,
      startTime: mark.startTime ?? null,
      duration: mark.duration ?? null,
      parts: Array.from(f.rollMods?.parts ?? []).map((p) => ({ key: p.key, on: p.on, mode: p.mode ?? null, value: p.value ?? null, attackKinds: Array.from(p.attackKinds ?? []), vsKinds: Array.from(p.vsKinds ?? []), ref: p.ref ?? null, spells: Array.from(p.spells ?? []) })),
    };
  }),
  statuses: async ({ actorId }) => [...game.actors.get(actorId).statuses],
  /**
   * Delete the records of the run's own casts on these actors: those whose cast id the run made, and those an earlier run of this walk left, which are
   * the ones cast by a caster whose fixture marker matches `casterRe` (the walk's own casters).
   */
  clearRecords: async ({ actorIds, castIds, casterRe }) => {
    const re = new RegExp(casterRe);
    const own = (e) => {
      const mark = e.flags?.["acks-extras"]?.spellEffect;
      if (!mark) return false;
      if (castIds.includes(mark.castId)) return true;
      const caster = mark.casterUuid ? fromUuidSync(mark.casterUuid) : null;
      return !!caster && re.test(String(caster.flags?.world?.fixture ?? ""));
    };
    let n = 0;
    for (const id of actorIds) {
      const a = game.actors.get(id);
      const ids = [...a.effects].filter(own).map((e) => e.id);
      if (ids.length) { await a.deleteEmbeddedDocuments("ActiveEffect", ids); n += ids.length; }
    }
    await new Promise((r) => setTimeout(r, 500));
    return n;
  },
  waitGone: async ({ actorId, castId, tries }) => {
    const H = globalThis.__mck;
    const left = () => [...game.actors.get(actorId).effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect?.castId === castId).length;
    await H.poll(() => left() === 0, { tries: tries ?? 40, every: 250 });
    return left();
  },
  /**
   * An attack as a user makes it: `makeAttackThrow` on a token's actor with one of its items, of the named attack type, against the seat's targets.
   * Answers the stored card's two modifier lists (attack, then damage on a hit) as label and value text, and every notice told while it rolled.
   */
  attack: async ({ sceneId, tokenId, itemId, attackType }) => {
    const H = globalThis.__mck;
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
      await actor.makeAttackThrow({ item, attackType, skipDialog: true });
      message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.speaker?.actor === actor.id && String(m.content).includes("attack-throw-card")), { tries: 40, every: 200 });
    } finally {
      ui.notifications.warn = warn;
      ui.notifications.info = info;
    }
    const doc = new DOMParser().parseFromString(String(message?.content ?? ""), "text/html");
    const blocks = [...doc.querySelectorAll(".attack-throw-card__roll")];
    const listOf = (block) => [...(block?.querySelectorAll(".attack-throw-card__modifiers li") ?? [])].map((li) => ({ label: li.children[0]?.textContent ?? "", value: li.children[1]?.textContent ?? "" }));
    return { card: !!message, id: message?.id ?? null, attack: listOf(blocks[0]), damage: listOf(blocks[1]), notices: told };
  },
  /** The weapons of an actor: which are marked destroyed (equipment's flag) and which is the equipped one. */
  weapons: async ({ actorId }) => [...game.actors.get(actorId).items].filter((i) => i.type === "weapon").map((i) => ({ id: i.id, destroyed: !!i.getFlag("acks-extras", "destroyed"), equipped: !!i.system.equipped })),
  /** Bring an actor's weapons to a known shape: no destroyed mark, only `equippedId` equipped. */
  resetWeapons: async ({ actorId, equippedId }) => {
    const a = game.actors.get(actorId);
    for (const i of [...a.items].filter((x) => x.type === "weapon")) await i.update({ "flags.acks-extras.-=destroyed": null, "system.equipped": i.id === equippedId });
    return [...a.items].filter((i) => i.type === "weapon").map((i) => ({ id: i.id, destroyed: !!i.getFlag("acks-extras", "destroyed"), equipped: !!i.system.equipped }));
  },
  /** A hand-made effect carrying a status, on an actor: a hand's condition for a lifting row to take. Answers its uuid, which the walk tracks. */
  makeEffect: async ({ actorId, name, status }) => {
    const a = game.actors.get(actorId);
    const [fx] = await a.createEmbeddedDocuments("ActiveEffect", [{ name, statuses: [status], disabled: false }]);
    return { uuid: fx.uuid, id: fx.id, statuses: [...fx.statuses] };
  },
  /** An actor's effect by id: whether it stands, and the statuses of the actor. */
  effectStands: async ({ actorId, effectId }) => ({ stands: game.actors.get(actorId).effects.has(effectId), statuses: [...game.actors.get(actorId).statuses] }),
  roundSeconds: async () => {
    try { return (await import("/modules/acks-extras/scripts/magic/cast-expiry.mjs")).ROUND_SECONDS ?? 60; } catch { return 60; }
  },
  time: async ({ advance }) => {
    const H = globalThis.__mck;
    await game.time.advance(advance);
    await H.sleep(2500);
    return game.time.worldTime;
  },
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
  combatMove: async ({ combatId, update }) => {
    const combat = game.combats.get(combatId);
    const before = new Set([...game.messages].map((m) => m.id));
    await combat.update(update);
    await new Promise((r) => setTimeout(r, 1200));
    return { round: combat.round, turn: combat.turn, cards: [...game.messages].filter((m) => !before.has(m.id) && m.author?.id === game.user.id && !m.speaker?.actor).map((m) => m.uuid) };
  },
  combatDrop: async ({ combatId }) => { await game.combats.get(combatId)?.delete(); return true; },
  /**
   * Open an actor's character sheet on its Rolls tab and read every granted-throw row: its id, whether it is pale (`is-latent`) or gold (`is-granted`),
   * whether it carries the roll class and action, whether its pin is disabled, and its figure's text and tooltip; with `adv` (an Adventuring key) the figure and tooltip of
   * that row too. Answers the sheet's own selector for a shot.
   */
  rollsTab: async ({ actorId, adv }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(actorId);
    await actor.sheet.render(true);
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("rolls", "primary");
    await H.sleep(800);
    const root = H.root(actor.sheet)?.querySelector("section[data-tab='rolls']");
    const rows = [...(root?.querySelectorAll(".acks-extras-frame__row[data-roll^='grant:']") ?? [])].map((r) => {
      const pin = r.querySelector(".acks-extras-frame__pin");
      const cell = r.querySelector(".acks-extras-frame__row-value");
      return { id: r.dataset.roll, latent: r.classList.contains("is-latent"), granted: r.classList.contains("is-granted"), roll: r.classList.contains("is-roll"), action: r.dataset.action ?? null, pinDisabled: !!pin?.disabled, text: cell?.textContent.trim() ?? "", tip: cell?.dataset.tooltipText ?? "" };
    });
    const advCell = adv ? root?.querySelector(`[data-roll="adv:${adv}"] .acks-extras-frame__row-value`) : null;
    return { rendered: !!root, rows, adv: advCell ? { text: advCell.textContent.trim(), tip: advCell.dataset.tooltipText ?? "" } : null, selector: `#${CSS.escape(actor.sheet.id)}` };
  },
  /** Hover a roll row's figure as a user does (a pointerenter on it, then the manager's delay) and answer the tooltip core's manager shows; leaves it showing for a shot. */
  hoverRow: async ({ actorId, rollId }) => {
    const H = globalThis.__mck;
    const root = H.root(game.actors.get(actorId).sheet)?.querySelector("section[data-tab='rolls']");
    const cell = root?.querySelector(`[data-roll="${rollId}"] .acks-extras-frame__row-value`);
    if (!cell) return { cell: false };
    cell.scrollIntoView({ block: "center" });
    await H.sleep(250);
    cell.dispatchEvent(new PointerEvent("pointerenter"));
    await H.sleep(foundry.helpers.interaction.TooltipManager.TOOLTIP_ACTIVATION_MS + 500);
    return { cell: true, attr: cell.dataset.tooltipText ?? "", shown: game.tooltip.tooltip?.textContent ?? "", active: game.tooltip.element === cell };
  },
  /** Let go of a hover. */
  unhover: async ({ actorId, rollId }) => {
    const H = globalThis.__mck;
    const cell = H.root(game.actors.get(actorId).sheet)?.querySelector(`[data-roll="${rollId}"] .acks-extras-frame__row-value`);
    cell?.dispatchEvent(new PointerEvent("pointerleave"));
    return true;
  },
  /**
   * An invisible box over the sheet and the tooltip showing beside it, so one clipped shot holds both: core's tooltip is a node of the page outside the
   * sheet's own box. Answers the box's selector; `unframe` removes it.
   */
  frame: async ({ sheetSelector }) => {
    document.getElementById("acks-walk-frame")?.remove();
    const boxes = [document.querySelector(sheetSelector), game.tooltip.tooltip].filter(Boolean).map((el) => el.getBoundingClientRect());
    if (!boxes.length) return { frame: false };
    const left = Math.max(0, Math.min(...boxes.map((b) => b.left)));
    const top = Math.max(0, Math.min(...boxes.map((b) => b.top)));
    const right = Math.min(window.innerWidth, Math.max(...boxes.map((b) => b.right)));
    const bottom = Math.min(window.innerHeight, Math.max(...boxes.map((b) => b.bottom)));
    const div = document.createElement("div");
    div.id = "acks-walk-frame";
    div.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;pointer-events:none;visibility:hidden;`;
    document.body.append(div);
    return { frame: true, selector: "#acks-walk-frame", tooltip: !!game.tooltip.tooltip?.classList?.contains("active") || !!game.tooltip.tooltip?.textContent };
  },
  unframe: async () => { document.getElementById("acks-walk-frame")?.remove(); return true; },
  closeSheet: async ({ actorId }) => { await game.actors.get(actorId)?.sheet?.close(); return true; },
  /**
   * Press one roll row of the Rolls tab as a user does (the skip-dialog key held) and answer the cards it posted speaking as the actor: how many, the first
   * one's id, whether it is the party card's own format, how many rows its table holds and its text.
   */
  pressRow: async ({ actorId, rollId, expectNone }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(actorId);
    const before = new Set([...game.messages].map((m) => m.id));
    const skipKey = game.settings.get("acks", "skip-dialog-key");
    const row = H.root(actor.sheet)?.querySelector(`section[data-tab='rolls'] [data-roll="${rollId}"]`);
    if (!row) return { row: false };
    // One press on the row is one roll (a click on a child bubbles to the row's handler); a row expected to do nothing is pressed on every part of it, its pin included.
    const targets = expectNone ? [row, row.querySelector(".acks-extras-frame__row-value"), row.querySelector(".acks-extras-frame__pin")].filter(Boolean) : [row];
    for (const target of targets) target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [skipKey]: true }));
    if (expectNone) await H.sleep(1800);
    else await H.poll(() => [...game.messages].some((m) => !before.has(m.id) && m.speaker?.actor === actorId), { tries: 60, every: 200 });
    await H.sleep(500);
    const mine = [...game.messages].filter((m) => !before.has(m.id) && m.speaker?.actor === actorId);
    const first = mine[0];
    const doc = new DOMParser().parseFromString(String(first?.content ?? ""), "text/html");
    return { row: true, posted: mine.length, id: first?.id ?? null, uuid: first?.uuid ?? null, card: !!doc.querySelector(".acks-extras-roll-card"), tableRows: doc.querySelectorAll(".acks-extras-roll-card tbody tr").length, text: doc.body.textContent.replace(/\s+/g, " ").trim() };
  },
  /** A lang key as the seat localizes it (a key with a slot comes back with its `{slot}` text, which a step splits on). */
  loc: async ({ key }) => game.i18n.localize(key),
  /** Bring a chat card into view in the chat tab and answer the selector to clip a shot to. */
  showCard: async ({ messageId }) => {
    const H = globalThis.__mck;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(500);
    const el = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"]`), { tries: 20, every: 150 });
    el?.scrollIntoView({ block: "center" });
    await H.sleep(400);
    return { found: !!el, selector: `[data-message-id="${messageId}"]` };
  },
  /** The castable-spell register's answer for an actor: each spell item it lists as castable now, with whether a cast lands on the caster and the capacity word. */
  castable: async ({ actorId }) => {
    const S = await import("/modules/acks-extras/scripts/lib/spell-sources.mjs");
    return S.castableSpells(game.actors.get(actorId), { viewer: game.user }).map((e) => ({ itemId: e.itemId, onSelf: e.onSelf, capacity: e.capacity }));
  },
  /** Restore what the run changed on this seat: the dice, the console, the warn wrap. */
  restore: async () => {
    const H = globalThis.__mck;
    if (!H) return "none";
    if (H.dice) CONFIG.Dice.randomUniform = H.dice;
    H.dice = null;
    if (H.patched) { console.error = H.consoleError; ui.notifications.warn = H.warn; H.patched = false; }
    return "restored";
  },
};
