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
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `magic/cast-scene` (the field), `magic/cast-class` (a class with one vancian
 * tradition and two first-level slots), `magic/cast-caster` (a character the
 * Player owns, bound to it), `magic/cast-spell-damage`, `magic/cast-spell-cure`
 * and `magic/cast-spell-fright` (copies of the three imported spells on the
 * caster, each brought to a known shape at the start), `magic/cast-target-a`,
 * `-b` and `-c` (three monsters nobody but the GM owns) and `magic/cast-monster`
 * (a monster with one weapon). The run's own tokens, cards and records are
 * tracked by uuid and swept alone. The walk moves the world clock forward by a
 * few minutes and restores the dice it rigged.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const KEY = "magic-cast-spell-walk";
const IDS = { damage: "def.spell.desiccate", cure: "def.spell.cureLightInjury", fright: "def.spell.frightenHumanoid" };

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
    const scene = game.scenes.get(sceneId);
    game.user.updateTokenTargets([]);
    for (const id of tokenIds) scene.tokens.get(id)?.object?.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
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
  cast: async ({ casterId, spellId, mode, stop, wait }) => {
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
    const castButton = root.querySelector('button[data-action="cast"]');
    const shown = { dialog: true, scroll: root.classList.contains("acks-extras-scroll"), modeSelect: !!select, verdicts, castDisabled: !!castButton?.disabled, levelField: !!dialog.querySelector('[name="casterLevel"]'), literalIds: [...root.querySelectorAll("[id]")].filter((e) => !e.closest(".window-header") && !/^[A-Za-z]+-[A-Za-z0-9]+$/.test(e.id)).length };
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
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 900_000);
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
  check("1: the odd halved amount went to the even whole, not up", dmgEntries.filter((e) => e.saved === true).every((e) => e.rolled % 2 === 1 && e.applied === halfEven(e.rolled / 2) && e.applied !== Math.round(e.rolled / 2 + 0.0001) || e.rolled % 2 === 0));
  const hp1 = await run(gm, P.hp, { sceneId, tokenIds });
  const byTarget = Object.keys(c1.model?.targets ?? {}).map((tk, i) => ({ drop: hp0[i] - hp1[i], applied: c1.model.entries[`${tk}_${damageKey}`]?.applied }));
  check("1: each target's hit points fell by the amount applied", byTarget.length === 3 && byTarget.every((b) => b.drop === b.applied), byTarget);
  check("1: the card shows the damage type and the spell's name", !!c1.model?.rows?.[damageKey]?.types?.length);
  check("1: the cast spent once: the cast count and the tradition's slot each rose by one", c1.cast === 1 && c1.pool === 1, { cast: c1.cast, pool: c1.pool });
  await track(`ChatMessage.${c1.messageId}`, "ChatMessage");
  const seen1 = await run(gm, P.seen, { messageId: c1.messageId });
  check("1: every figure on the card carries a tooltip, and no button is the system's own", seen1.found && seen1.figures > 0 && seen1.untipped === 0 && !seen1.cardButtons, { figures: seen1.figures, untipped: seen1.untipped });
  check("1: the Judge's card offers Undo on each applied entry", seen1.actions.filter((a) => a === "magicCastUndo").length === dmgEntries.filter((e) => e.applied > 0).length, seen1.actions);
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
  try { if (gm) await gm.eval(`game.user.updateTokenTargets([]); 0`); } catch {}
  try { if (player) await player.eval(`game.user.updateTokenTargets([]); 0`); } catch {}
  // The run's own leavings: cards speaking as its fixtures since it began, and its caster record, listed by id and then swept.
  try {
    if (gm) {
      const ledger = await gm.eval(`(async () => JSON.stringify({ cards: [...game.messages].filter((m) => m.timestamp >= ${startedAt} && game.actors.some((a) => a.flags?.world?.fixture?.startsWith?.("magic/cast-") && a.id === m.speaker?.actor)).map((m) => m.uuid), records: game.actors.filter((a) => a.flags?.world?.fixture === "magic/cast-caster").flatMap((a) => [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect && e.flags["acks-extras"].spellEffect.casterUuid === a.uuid).map((e) => e.uuid)) }))()`);
      const { cards, records } = JSON.parse(ledger);
      for (const uuid of cards) await track(uuid, "ChatMessage");
      for (const uuid of records) await track(uuid, "ActiveEffect");
    }
  } catch (err) { console.error("ledger:", err?.message ?? err); }
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: magic/cast-scene, magic/cast-class, magic/cast-caster, magic/cast-spell-damage, magic/cast-spell-cure, magic/cast-spell-fright, magic/cast-target-a, magic/cast-target-b, magic/cast-target-c, magic/cast-monster, magic/cast-monster-weapon");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
