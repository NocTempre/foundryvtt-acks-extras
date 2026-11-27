/**
 * Live walk, magic-conjure-rows: what the importer's Repair in place leaves on
 * the world's imported spells, and what a cast of it does. Two topics, both
 * landed on main and never walked.
 *
 * Topic conjure-rows (8e6e9407, docs/magic/TESTING.md step 15): the nine
 * conjure entries beside Cacodemon Spawn carry one `summon` row (format
 * conjuration, control obedient, controlEnd hostile, no `ref`, a count and Hit
 * Dice located where the page prints them). The casts, on a tracked copy of one
 * imported conjure spell on a Player-owned caster:
 *   (a) the Player dismisses the creature at will: it goes, the concentration
 *       ends, and no hostile end card is posted;
 *   (b) the concentration is ended by the status's toggle: one funnel card
 *       whose outcome is hostile, the creature stamped `lost`, the Player's
 *       ownership gone, its disposition hostile, the Player's Dismiss refused
 *       `controlLost`;
 *   (c) the world clock passes the cap with nothing dismissed: the end card
 *       names the same outcome as (b).
 * Topic light-rows (9071229b, T-0791, docs/formation/TESTING.md K-c11): after
 * the repair the timed light spell's row has its bright and dim bands, the
 * perpetual spell has light and reversed-light rows with daylight, bright and
 * dim, and its cast from the party sheet's Kit tab writes a light record with no
 * countdown.
 *
 * The repair is the Judge's gesture: `cookbookReimportShelf("Spells")` with no
 * `ask`, the confirm's Yes pressed in its DOM, and the held-edits choice
 * answered with its own Apply where it opens. `SKIP_REPAIR=1` reads the rows as
 * they stand (a rerun after a run that carried the repair). `SHELF_OK` and
 * `REBUILD_OK` are never set: the repair writes over documents this walk did
 * not make and the owner's standing ruling (2026-11-11) lets a walk do that.
 *
 * Stand-ins, said where they are used: the spell is cast by `item.use` (the
 * Magic tab's Cast press opens the same window), the sheet's Dismiss by the cast
 * menu's own entry where it is offered and by the `dismissSummons` API for the
 * refused press of (b). The placement click is a real CDP mouse click.
 *
 * Prints booleans and comparisons, never a spell's name, a figure or a creature's
 * name; entries are `conjure#N` by position. Machine values arrive through
 * ./_env.mjs.
 *
 * Fixtures, kept and found by marker (built when none carries it; copies and
 * tokens are the run's own, tracked and swept): `magic/conjure-scene`,
 * `magic/conjure-caster` (a character the Player owns, spells enabled, caster
 * level 5, no party), `magic/conjure-creature` (a monster the Player observes),
 * `magic/conjure-light-caster` (a character the Player owns) and
 * `magic/conjure-light-party` (a party actor seating it). Writes outside the
 * ledger, each restored: the world's pause, the world clock moves forward and is
 * not moved back.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const skip = (label, detail) => console.log(`SKIP  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);

/** The nine conjure entries beside the tenth, by register id; the first is the smallest conjure the step names for the casts, the third reads no Hit Dice. */
const TENTH = "def.spell.conjureCacodemonSpawn";
const CONJURES = [
  "def.spell.conjureImp", "def.spell.conjureDybbuk", "def.spell.conjureGenie", "def.spell.conjureFiend", "def.spell.conjureHellion",
  "def.spell.conjureIncubus", "def.spell.conjureMajorElemental", "def.spell.conjurePettyElemental", "def.spell.conjureSupremeElemental",
];
const NO_HIT_DICE = "def.spell.conjureGenie";
const CAST_FROM = CONJURES[0];
const TIMED_LIGHT = "def.spell.illumination";
const PERPETUAL_LIGHT = "def.spell.illuminationPerpetual";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_500_000);

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__mcr = globalThis.__mcr ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
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
    const base = "/modules/acks-extras/scripts/";
    H.L = await import(`${base}lib/library.mjs`);
    H.logic = await import(`${base}lib/summons-logic.mjs`);
    H.FM = await import(`${base}formation/formation-model.mjs`);
    H.LO = await import(`${base}magic/light-offers.mjs`);
    return { isGM: game.user.isGM, role: game.user.role, userId: game.user.id, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused };
  },
  census: async () => ({ active: game.users.filter((u) => u.active).map((u) => [u.name, u.isGM]), activeGM: game.users.activeGM?.name ?? null }),
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  drain: async () => {
    const H = globalThis.__mcr;
    const out = { errors: H.errors.slice(), warns: H.warns.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    return out;
  },
  restore: async () => {
    const H = globalThis.__mcr;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
    H.patched = false;
    return "restored";
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    return true;
  },
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  /** Whether the RR is open on this seat, waited for. */
  bookOpen: async () => {
    const H = globalThis.__mcr;
    await H.poll(() => acksExtras.importer?.bookOpen?.("rr"), { tries: 300, every: 200 });
    return { rr: !!acksExtras.importer?.bookOpen?.("rr"), spellsShelf: (acksExtras.importer?.reimportableShelves?.() ?? []).includes("Spells") };
  },
  /** The effect rows of imported spells by register id, as booleans. */
  rowsOf: async ({ ids }) => {
    const H = globalThis.__mcr;
    const has = (v) => v !== undefined && v !== null && v !== "" && !(typeof v === "object" && !Object.keys(v).length);
    const fin = (v) => Number.isFinite(Number(v)) && v !== null && v !== "";
    const out = {};
    for (const id of ids) {
      const found = H.L.byCookbookId("Item", id, { original: true });
      const doc = found ? await fromUuid(found.uuid) : null;
      if (!doc) { out[id] = null; continue; }
      const flag = doc.getFlag("acks-extras", "spell");
      const rows = Array.from(flag?.effects ?? []);
      const summons = rows.filter((r) => r.type === "summon");
      const s = summons[0] ?? null;
      const light = rows.filter((r) => r.type === "light");
      const fwd = light.find((r) => !r.reversed) ?? null;
      const rev = light.find((r) => r.reversed) ?? null;
      const b = fwd?.lightBands ?? {};
      out[id] = {
        uuid: doc.uuid,
        summonRows: summons.length,
        format: s?.summonFormat ?? null,
        control: s?.control ?? null,
        controlEnd: s?.controlEnd ?? null,
        noRef: s ? !String(s.ref ?? "").trim() : null,
        count: s ? has(s.amount) : null,
        hitDice: s ? has(s.value) : null,
        lightRows: light.length,
        reversedRows: light.filter((r) => r.reversed).length,
        hasLightRow: H.LO.hasLightRow(doc),
        bands: { daylight: fin(b.daylight), bright: fin(b.bright), dim: fin(b.dim) },
        order: { brightLeDim: fin(b.bright) && fin(b.dim) ? Number(b.bright) <= Number(b.dim) : null, daylightLeBright: fin(b.daylight) && fin(b.bright) ? Number(b.daylight) <= Number(b.bright) : null },
        revBandsBlank: rev ? !rev.lightBands || !Object.values(rev.lightBands).some((v) => fin(v)) : null,
        durationShape: flag?.duration?.shape ?? null,
      };
    }
    return out;
  },
  /** Begin the Spells shelf's repair as the Judge's menu does, unawaited; the confirm is pressed by `repairPoll`. */
  repairStart: async () => {
    window.__mcrRepair = { state: "running", confirmed: false, held: false, result: null, err: null };
    const R = window.__mcrRepair;
    acksExtras.importer.cookbookReimportShelf("Spells").then((r) => { R.state = "done"; R.result = !!r; }).catch((e) => { R.state = "error"; R.err = String(e?.message ?? e).slice(0, 200); });
    return true;
  },
  /** One look at the repair: press the confirm's Yes once, answer the held-edits choice with its own Apply, answer where it stands. */
  repairPoll: async () => {
    const R = window.__mcrRepair;
    if (!R) return { state: "none" };
    const held = document.querySelector(".acks-extras-held-dialog button[data-action='apply']");
    if (held) { held.click(); R.held = true; }
    else if (!R.confirmed) {
      const yes = [...document.querySelectorAll(".application button[data-action='yes']")][0];
      if (yes) { R.confirmTitled = /repair/i.test(yes.closest(".application")?.querySelector(".window-title")?.textContent ?? ""); yes.click(); R.confirmed = true; }
    }
    return { state: R.state, confirmed: R.confirmed, confirmTitled: !!R.confirmTitled, held: R.held, result: R.result, err: R.err };
  },
  /** The world copy ids of a creature, and the id of any copy: so a copy this run made is the only one tracked. */
  copiesOf: async ({ sourceUuid }) => game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid).map((a) => a.uuid),
  /** The caster's records of casts: caster-role records, by booleans, with the held status id. */
  records: async ({ actorId }) => [...game.actors.get(actorId).effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect).map((e) => {
    const m = e.flags["acks-extras"].spellEffect;
    return { uuid: e.uuid, id: e.id, castId: m.castId, role: m.role ?? null, held: m.held ?? null, status: [...e.statuses][0] ?? null, hasStart: m.startTime != null, hasDuration: !!m.duration, durationValue: m.duration?.value ?? null, durationUnits: m.duration?.units ?? null };
  }),
  statuses: async ({ actorId }) => [...game.actors.get(actorId).statuses],
  /** Put the copy of an imported spell on a caster, tracked by the driver, with its count at 0 and the printed duration untouched. */
  copySpell: async ({ casterId, uuid }) => {
    const src = await fromUuid(uuid);
    const data = src.toObject();
    delete data._id;
    data.system = { ...data.system, cast: 0 };
    const [item] = await game.actors.get(casterId).createEmbeddedDocuments("Item", [data]);
    return { uuid: item.uuid, id: item.id };
  },
  /** The known shape of a caster: spells enabled, level 5, a slot grid with room at the spell's level, no leftover held record. */
  shapeCaster: async ({ casterId, level, lvl }) => {
    const a = game.actors.get(casterId);
    await a.update({ "system.spells.enabled": true, "system.details.level": level, [`system.spells.${lvl}.max`]: 4 });
    return { enabled: !!a.system.spells?.enabled, level: a.system.details.level, max: Number(a.system.spells?.[lvl]?.max) };
  },
  spellLevel: async ({ uuid }) => Number((await fromUuid(uuid))?.system?.lvl ?? 1),
  /** The scene shown on this seat. */
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
  /** The caster's token on the scene, made from the actor where none stands for it. */
  casterToken: async ({ sceneId, actorId }) => {
    const scene = game.scenes.get(sceneId);
    let t = scene.tokens.find((x) => x.actorId === actorId);
    let made = false;
    if (!t) {
      const doc = await game.actors.get(actorId).getTokenDocument({ x: 700, y: 400 });
      [t] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true }]);
      made = true;
    }
    return { id: t.id, uuid: t.uuid, made };
  },
  /** Open the cast window of a spell and read its Summon band. */
  openCast: async ({ casterId, spellId }) => {
    const H = globalThis.__mcr;
    for (const el of document.querySelectorAll(".application.acks-extras-cast")) el.querySelector('button[data-action="cancel"]')?.click();
    await H.sleep(500);
    game.actors.get(casterId).items.get(spellId).use({ skipDialog: true });
    const el = await H.poll(() => document.querySelector(".application.acks-extras-cast"), { tries: 80, every: 150 });
    if (!el) return { dialog: false };
    await H.sleep(600);
    return H.dialogRead();
  },
  /** The dialog as the step reads it. */
  dialogRead: async () => {
    const H = globalThis.__mcr;
    return H.dialogRead();
  },
  /** Drop an Actor on the open Summon band as a real drop; answer the band afterwards. */
  dropCreature: async ({ uuid }) => {
    const H = globalThis.__mcr;
    const zone = document.querySelector('.application.acks-extras-cast [data-bucket-drop="summon"]');
    if (!zone) return { zone: false };
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await H.poll(() => document.querySelector('.application.acks-extras-cast input[name="summonCount"]'), { tries: 40, every: 150 });
    await H.sleep(500);
    return { zone: true, ...H.dialogRead() };
  },
  /** Type a count into the band's box as a user does. */
  setCount: async ({ n }) => {
    const H = globalThis.__mcr;
    const input = document.querySelector('.application.acks-extras-cast input[name="summonCount"]');
    if (!input) return { box: false };
    input.value = String(n);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(600);
    return { box: true, ...H.dialogRead() };
  },
  /** Press Cast in the open window, then clear the framed windows off the map. */
  pressCast: async ({ clear }) => {
    const H = globalThis.__mcr;
    const b = document.querySelector('.application.acks-extras-cast button[data-action="cast"]');
    if (!b || b.disabled) return { pressed: false, disabled: !!b?.disabled };
    b.click();
    if (clear) {
      await H.sleep(500);
      for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
      await H.sleep(500);
    }
    return { pressed: true };
  },
  /** A client point beside the caster's token, on bare canvas, for a placement click. */
  pointBeside: async ({ sceneId, tokenId }) => {
    const scene = game.scenes.get(sceneId);
    const t = scene.tokens.get(tokenId);
    const size = canvas.dimensions.size;
    const cx = t.x + (t.width * size) / 2;
    const cy = t.y + (t.height * size) / 2;
    let last = "";
    for (let n = 0; n < 12; n++) {
      canvas.pan({ x: cx, y: cy, scale: 1 });
      await new Promise((res) => setTimeout(res, 500));
      const now = `${canvas.stage.scale.x.toFixed(3)}:${Math.round(canvas.stage.pivot.x)}:${Math.round(canvas.stage.pivot.y)}`;
      if (now === last) break;
      last = now;
    }
    for (const dx of [size, -size, 2 * size, -2 * size]) {
      const p = canvas.clientCoordinatesFromCanvas({ x: cx + dx, y: cy });
      if (p.x > 60 && p.y > 60 && p.x < window.innerWidth - 60 && p.y < window.innerHeight - 60 && document.elementFromPoint(p.x, p.y) === canvas.app.view) return { onCanvas: true, x: Math.round(p.x), y: Math.round(p.y), cells: Math.abs(dx) / size };
    }
    return { onCanvas: false, x: 0, y: 0 };
  },
  viewport: async () => ({ w: window.innerWidth, h: window.innerHeight }),
  /** The cast cards of one spell made since the ids given, and the creature tokens of the caster on the scene. */
  castCards: async ({ spellUuid, since }) => game.messages.filter((m) => !since.includes(m.id) && m.flags?.["acks-extras"]?.castCard?.spellUuid === spellUuid).map((m) => {
    const c = m.flags["acks-extras"].castCard;
    const d = c.duration ?? {};
    return { id: m.id, uuid: m.uuid, castId: c.castId, settled: !Object.values(c.entries ?? {}).some((e) => e.state === "pending" || e.state === "applying"), held: d.held ?? null, untimed: !!d.none, capFinite: Number.isFinite(Number(d.cap?.value)), capValue: d.cap?.value ?? null, capUnits: d.cap?.units ?? null, noneReason: d.none ?? null, durUnits: d.units ?? null, summoned: Number(c.summoned?.n ?? 0), timedLine: Number.isFinite(Number(d.value)) && !!d.units && !d.none };
  }),
  messageIds: async () => game.messages.map((m) => m.id),
  /** The creature tokens a caster's casts stand on a scene, with their control state. */
  creatures: async ({ sceneId, casterUuid, playerId }) => {
    const H = globalThis.__mcr;
    return game.scenes.get(sceneId).tokens.filter((t) => H.logic.summonOfData(t.toObject()).summonedBy === casterUuid).map((t) => {
      const rec = H.logic.summonRecordOf(t.actor);
      return { uuid: t.uuid, id: t.id, castId: rec?.castId ?? null, lost: rec?.lost ?? null, disposition: t.disposition, playerOwns: t.actor?.testUserPermission?.(game.users.get(playerId), "OWNER") ?? null, actorUuid: t.actor?.uuid ?? null };
    });
  },
  /** Held-end and ended cards of one cast: their outcome words, their creature lists. */
  endCards: async ({ castId, playerId }) => game.messages.filter((m) => m.flags?.["acks-extras"]?.castHeldEnd?.castId === castId || m.flags?.["acks-extras"]?.castEnded?.castId === castId).map((m) => {
    const f = m.flags["acks-extras"].castHeldEnd ?? m.flags["acks-extras"].castEnded;
    return { uuid: m.uuid, kind: m.flags["acks-extras"].castHeldEnd ? "held" : "ended", outcome: f.outcome ?? null, cause: f.cause ?? null, lists: Array.isArray(f.summons) ? f.summons.length : null, toPlayer: m.whisper.includes(playerId) || m.whisper.length === 0, visible: m.visible };
  }),
  /** The cast menu of a character's sheet, as its entry labels. */
  menu: async ({ actorId }) => {
    const H = globalThis.__mcr;
    const sheet = game.actors.get(actorId)?.sheet;
    if (!sheet) return { sheet: false, cell: false, items: [] };
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); await H.sleep(600); }
    document.querySelectorAll(".acks-extras-frame__menu").forEach((m) => m.remove());
    const button = H.root(sheet)?.querySelector('[data-action="castMenu"]');
    if (!button) return { sheet: true, cell: false, items: [] };
    button.click();
    await H.sleep(600);
    return { sheet: true, cell: true, items: [...document.querySelectorAll(".acks-extras-frame__menu-item")].map((b) => b.textContent.trim()) };
  },
  /** Press the cast menu's first Dismiss entry and answer its confirm. */
  dismissViaMenu: async () => {
    const H = globalThis.__mcr;
    const items = [...document.querySelectorAll(".acks-extras-frame__menu-item")];
    const b = items.find((x) => x.textContent.trim().startsWith("Dismiss all")) ?? items.find((x) => x.textContent.trim().startsWith("Dismiss"));
    if (!b) return { offered: false };
    b.click();
    const yes = await H.poll(() => [...document.querySelectorAll(".application.dialog button, dialog button")].find((x) => x.dataset.action === "yes"), { tries: 30 });
    if (!yes) return { offered: true, confirmed: false };
    yes.click();
    await H.sleep(1500);
    return { offered: true, confirmed: true };
  },
  /** The Player's Dismiss of a token by the API the sheet's entry calls, no confirm; answers the refusal reason. */
  dismissApi: async ({ casterId, tokenUuid }) => {
    const H = globalThis.__mcr;
    const caster = game.actors.get(casterId);
    const token = await fromUuid(tokenUuid);
    if (!token) return { token: false };
    const answer = await acksExtras.lib.summons.dismissSummons(caster, { tokens: [token], confirm: false });
    return { token: true, ok: answer?.ok === true, reason: answer?.reason ?? null };
  },
  /** The GM ends a concentration by the status's own toggle. */
  toggleStatus: async ({ actorId, status }) => {
    const a = game.actors.get(actorId);
    await a.toggleStatusEffect(status, { active: false });
    await new Promise((r) => setTimeout(r, 2500));
    return { still: a.statuses.has(status) };
  },
  /** Advance the clock past a cap, answering that it passed (never the figure). */
  pastCap: async ({ value, units }) => {
    const T = await import("/modules/acks-extras/scripts/lib/time-unit.mjs");
    const per = { rounds: T.roundSeconds(), round: T.roundSeconds(), turns: T.turnSeconds(), turn: T.turnSeconds(), minutes: 60, minute: 60, hours: 3600, hour: 3600, days: 86400, day: 86400, seconds: 1, second: 1 }[String(units)] ?? null;
    if (per === null) return { known: false };
    const before = game.time.worldTime;
    await game.time.advance(Number(value) * per + 120);
    await new Promise((r) => setTimeout(r, 3500));
    return { known: true, passed: game.time.worldTime > before + Number(value) * per };
  },
  /** The party sheet's Kit tab, opened; the cast row's offers as booleans. */
  openKit: async ({ partyId }) => {
    const H = globalThis.__mcr;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.poll(() => H.root(app)?.isConnected);
    await H.sleep(700);
    H.root(app)?.querySelector('[data-action="tab"][data-tab="kit"]')?.click();
    await H.sleep(900);
    const sel = H.root(app)?.querySelector('select[data-pick="lightCast"]');
    return { rendered: !!H.root(app), row: !!H.root(app)?.querySelector("[data-light-cast]"), options: [...(sel?.options ?? [])].map((o) => o.value) };
  },
  /** Pick an offer in the Kit row's select and press its Cast. */
  kitCast: async ({ partyId, key, level = null }) => {
    const H = globalThis.__mcr;
    const root = H.root(game.actors.get(partyId).sheet);
    const sel = root?.querySelector('select[data-pick="lightCast"]');
    if (!sel || ![...sel.options].some((o) => o.value === key)) return { picked: false };
    sel.value = key;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(300);
    const btn = root.querySelector('[data-action="castLightSpell"]');
    if (!btn || btn.disabled) return { picked: true, pressed: false, disabled: !!btn?.disabled };
    for (const el of document.querySelectorAll(".application.acks-extras-cast")) el.querySelector('button[data-action="cancel"]')?.click();
    btn.click();
    const dlg = await H.poll(() => document.querySelector(".application.acks-extras-cast"), { tries: 80, every: 150 });
    if (!dlg) return { picked: true, pressed: true, dialog: false };
    await H.sleep(700);
    // A caster with no class the spell stands on has no class level: the window's caster-level field is typed, as a Judge does.
    let typed = null;
    if (level != null) {
      const lv = document.querySelector('.application.acks-extras-cast input[name="casterLevel"]');
      if (lv) { lv.value = String(level); lv.dispatchEvent(new Event("input", { bubbles: true })); lv.dispatchEvent(new Event("change", { bubbles: true })); typed = true; await H.sleep(500); } else typed = false;
    }
    const go = document.querySelector('.application.acks-extras-cast button[data-action="cast"]');
    if (!go || go.disabled) return { picked: true, pressed: true, dialog: true, cast: false, castDisabled: !!go?.disabled };
    go.click();
    await H.sleep(1500);
    return { picked: true, pressed: true, dialog: true, cast: true, ...(level != null ? { levelTyped: typed } : {}) };
  },
  /** The light record(s) one cast wrote anywhere, as booleans against the row's located bands. */
  lightRecord: async ({ castId, casterId, bands }) => {
    const out = [];
    for (const a of game.actors) {
      for (const e of a.effects) {
        const m = e.flags?.["acks-extras"]?.spellEffect;
        if (m?.castId !== castId) continue;
        const val = (b) => e.changes.find((c) => String(c.key).endsWith(`.magicLight.${b}`))?.value;
        const keys = ["daylight", "bright", "dim"].filter((b) => val(b) !== undefined);
        out.push({
          uuid: e.uuid,
          onCaster: a.id === casterId,
          bandKeys: keys,
          blank: Object.fromEntries(["daylight", "bright", "dim"].map((b) => [b, val(b) === "" || val(b) === null])),
          match: Object.fromEntries(["daylight", "bright", "dim"].map((b) => [b, bands[b] == null ? null : String(val(b)) === String(bands[b])])),
          hasStart: m.startTime != null,
          hasDuration: !!m.duration,
          cite: !!e.flags?.["acks-extras"]?.magicLightCite,
        });
      }
    }
    return out;
  },
  /** The kit party seated with the caster by the party sheet's own drop. */
  seat: async ({ partyId, actorId }) => {
    const H = globalThis.__mcr;
    const find = () => Object.values(H.FM.getFormations()).find((f) => f.actorId === partyId);
    let found = await H.poll(find, { tries: 40, every: 200 });
    if (!found) { await H.FM.adoptPartyActor(game.actors.get(partyId)); found = await H.poll(find, { tries: 40, every: 200 }); }
    if (!found) return { formation: false };
    const fid = found.id;
    const ids = () => H.FM.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    let dropped = false;
    if (!ids().includes(actorId)) {
      const sheet = game.actors.get(partyId).sheet;
      await sheet.render(true);
      await H.sleep(900);
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(actorId).uuid }));
      H.root(sheet).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await H.poll(() => ids().includes(actorId), { tries: 40, every: 150 });
      dropped = true;
    }
    return { formation: true, seated: ids().includes(actorId), dropped };
  },
  /** The ids of the caster-role records on an actor that no run of this walk wrote (read, never deleted here). */
  stale: async ({ actorId }) => [...game.actors.get(actorId).effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect).map((e) => e.uuid),
};

/**
 * The page-side dialog reader, installed once as a helper (it is not a P
 * entry the driver calls by name, so `run` never stringifies it alone).
 */
const DIALOG_READ = `(() => {
  const H = globalThis.__mcr;
  H.dialogRead = () => {
    const el = document.querySelector(".application.acks-extras-cast");
    if (!el) return { dialog: false };
    return {
      dialog: true,
      summonBand: !!el.querySelector(".acks-extras-cast-summon"),
      dropZone: !!el.querySelector('[data-bucket-drop="summon"]'),
      refSelect: !!el.querySelector('select[name="summonRef"]'),
      countBox: !!el.querySelector('input[name="summonCount"]'),
      countHas: (el.querySelector('input[name="summonCount"]')?.value ?? "") !== "",
      blocks: [...el.querySelectorAll(".acks-extras-cast-verdicts li")].filter((li) => li.dataset.severity === "block").length,
      castDisabled: !!el.querySelector('button[data-action="cast"]')?.disabled,
    };
  };
  return true;
})()`;

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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer && !!globalThis.acksExtras?.magic && !!globalThis.acksExtras?.lib?.summons`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
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
async function frontSeat(port) {
  const s = await pageSession(port);
  await s.send("Page.bringToFront");
  s.close();
  await sleep(400);
}
async function clickAt(port, { x, y }) {
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(250);
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(80);
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  s.close();
  await sleep(700);
}
async function pointerToMiddle(api, port) {
  const { w, h } = await run(api, P.viewport);
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(w / 2), y: Math.round(h / 2) });
  s.close();
  await sleep(300);
}
async function until(api, fn, args, test, { tries = 60, every = 300 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}
/** A stage runs apart: a throw in one is a failed check and the next stage still runs. */
async function stage(name, fn) {
  section(name);
  try { await fn(); } catch (err) {
    console.error(`WALK ERROR (${name}):`, err?.stack ?? err);
    check(`${name} ran to the end`, false, String(err?.message ?? err).slice(0, 200));
  }
}

let gm = null;
let player = null;
let wasPaused = false;
const own = [];
const castIds = [];
const startedAt = Date.now();
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const bool = (v) => v === true;
try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  await gm.eval(DIALOG_READ);
  await player.eval(DIALOG_READ);
  const census = await run(gm, P.census);
  note("census (active users: name, isGM)", census.active);
  note("active GM", census.activeGM);
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gmRole: installed.role, playerRole: seated.role });
  if (!installed.activeGMIsSelf) blocked("another GM client is the active GM");
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();

  /* ---------------------------------------------------------------- */
  const book = await run(gm, P.bookOpen);
  note("the RR is open on the GM seat, the Spells shelf is repairable", book);
  const ALL = [...CONJURES, TENTH, TIMED_LIGHT, PERPETUAL_LIGHT];
  const before = await run(gm, P.rowsOf, { ids: ALL });
  const imported = Object.values(before).filter(Boolean).length;
  note("entries the world has imported (of the twelve read)", imported);
  const had = (id) => !!before[id] && (before[id].summonRows > 0 || before[id].lightRows > 0);
  note("entries that carried a row before the repair", ALL.filter(had).length);

  await stage("repair: the importer's Repair in place of the Spells shelf", async () => {
    if (process.env.SKIP_REPAIR === "1") { skip("repair", "SKIP_REPAIR=1: rows are read as they stand"); return; }
    if (!book.rr || !book.spellsShelf) { skip("repair", "UNREACHABLE: the RR is not open on this seat or the Spells shelf is not repairable here"); return; }
    if (!imported) { skip("repair", "the world has imported none of these spells; nothing to repair"); return; }
    await run(gm, P.repairStart);
    let last = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 420_000) {
      await sleep(2500);
      last = await run(gm, P.repairPoll);
      if (last.state === "done" || last.state === "error") break;
    }
    note("repair ended after (s)", Math.round((Date.now() - t0) / 1000));
    check("the repair ran: its confirm was pressed and the call settled with an answer", last?.state === "done" && last.confirmed && last.result, { state: last?.state, confirmed: last?.confirmed, confirmTitled: last?.confirmTitled, heldEditsChoiceOpened: last?.held, err: last?.err });
  });

  const after = await run(gm, P.rowsOf, { ids: ALL });

  await stage("conjure rows (8e6e9407): the nine entries beside the tenth", async () => {
    const entries = [[TENTH, "conjure#10 (the tenth)"], ...CONJURES.map((id, i) => [id, `conjure#${i + 1}`])];
    for (const [id, tag] of entries) {
      const r = after[id];
      if (!r) { skip(`${tag}: not imported in this world`); continue; }
      const shape = r.summonRows === 1 && r.format === "conjuration" && r.control === "obedient" && r.controlEnd === "hostile" && r.noRef === true;
      check(`${tag}: one summon row, format conjuration, control obedient, controlEnd hostile, no ref${had(id) ? "" : " (the row was absent before the repair)"}`, shape, { rows: r.summonRows, format: r.format === "conjuration", control: r.control === "obedient", controlEnd: r.controlEnd === "hostile", noRef: r.noRef, existedBefore: !!before[id] && before[id].summonRows > 0 });
      check(`${tag}: a count located${id === NO_HIT_DICE ? ", and no Hit Dice (the entry prints none)" : " and Hit Dice located"}`, bool(r.count) && (id === NO_HIT_DICE ? r.hitDice === false : bool(r.hitDice)), { count: r.count, hitDice: r.hitDice });
    }
  });

  await stage("light rows (9071229b): the two illumination spells' rows after the repair", async () => {
    const t = after[TIMED_LIGHT];
    const p = after[PERPETUAL_LIGHT];
    if (!t) skip("timed light spell: not imported in this world");
    else {
      check("timed light spell: a light row whose bright and dim bands are located, bright not past dim", t.lightRows >= 1 && t.bands.bright && t.bands.dim && t.order.brightLeDim === true, { lightRows: t.lightRows, bright: t.bands.bright, dim: t.bands.dim, brightLeDim: t.order.brightLeDim });
      check("timed light spell: no daylight band is located (the page prints none), and the reversed row locates no band", t.bands.daylight === false && t.revBandsBlank !== false, { daylight: t.bands.daylight, reversedBlank: t.revBandsBlank });
    }
    if (!p) skip("perpetual light spell: not imported in this world");
    else {
      check("perpetual light spell: a light row and a reversed-light row", p.lightRows === 2 && p.reversedRows === 1 && p.hasLightRow === true, { lightRows: p.lightRows, reversedRows: p.reversedRows, offered: p.hasLightRow });
      check("perpetual light spell: daylight, bright and dim located, daylight <= bright <= dim", p.bands.daylight && p.bands.bright && p.bands.dim && p.order.daylightLeBright === true && p.order.brightLeDim === true, { bands: p.bands, order: p.order });
      check("perpetual light spell: the reversed row carries no band of its own", p.revBandsBlank !== false, { reversedBlank: p.revBandsBlank });
    }
  });

  /* ---------------------------------------------------------------- */
  await stage("light cast (K-c11): the perpetual spell cast from the party sheet's Kit row writes a record with no countdown", async () => {
    const t = after[TIMED_LIGHT];
    const p = after[PERPETUAL_LIGHT];
    if (!p) { skip("light cast", "the perpetual spell is not imported"); return; }
    const caster = await gm.fixture("magic/conjure-light-caster", "Actor", { name: "QA Conjure Light Caster", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0, [playerId]: 3 } });
    const party = await gm.fixture("magic/conjure-light-party", "Actor", { name: "QA Conjure Light Party", type: "acks-extras.party", ownership: { default: 0, [playerId]: 2 } });
    const casterId = idOf(caster);
    const partyId = idOf(party);
    const seat = await run(gm, P.seat, { partyId, actorId: casterId });
    check("fixtures: the light caster is seated in the party by the party sheet's drop", seat.formation && seat.seated, seat);
    const lvlP = await run(gm, P.spellLevel, { uuid: p.uuid });
    await run(gm, P.shapeCaster, { casterId, level: 5, lvl: lvlP });
    const copyP = await run(gm, P.copySpell, { casterId, uuid: p.uuid });
    await track(copyP.uuid, "Item");
    let copyT = null;
    if (t) {
      await run(gm, P.shapeCaster, { casterId, level: 5, lvl: await run(gm, P.spellLevel, { uuid: t.uuid }) });
      copyT = await run(gm, P.copySpell, { casterId, uuid: t.uuid });
      await track(copyT.uuid, "Item");
    }
    const kit = await run(gm, P.openKit, { partyId });
    check("the Kit row's select offers the perpetual spell's copy (and the timed one's where imported)", kit.row && kit.options.some((o) => o.includes(copyP.id)) && (!copyT || kit.options.some((o) => o.includes(copyT.id))), { row: kit.row, options: kit.options.length });
    const doCast = async (copy, label, bands, level = null) => {
      const keyOf = kit.options.find((o) => o.includes(copy.id));
      const idsBefore = await run(gm, P.messageIds);
      const key = (await run(gm, P.openKit, { partyId })).options.find((o) => o.includes(copy.id)) ?? keyOf;
      const out = await run(gm, P.kitCast, { partyId, key, level });
      check(`${label}: the Kit row's Cast opens the cast window and the window's Cast is pressed`, out.picked && out.pressed && out.dialog && out.cast, out);
      const cards = await until(gm, P.castCards, { spellUuid: copy.uuid, since: idsBefore }, (c) => c.length > 0 && c[0].settled);
      const card = cards[0];
      if (!card) { check(`${label}: a cast card posted`, false); return null; }
      castIds.push(card.castId);
      await track(`ChatMessage.${card.id}`, "ChatMessage");
      const recs = await run(gm, P.lightRecord, { castId: card.castId, casterId, bands });
      for (const r of recs) await track(r.uuid, "ActiveEffect");
      return { card, recs };
    };
    const bandsOf = async (id) => { const row = await run(gm, async ({ uuid }) => { const d = await fromUuid(uuid); const r = Array.from(d.getFlag("acks-extras", "spell").effects).find((x) => x.type === "light" && !x.reversed); return r?.lightBands ?? {}; }, { uuid: id }); return row; };
    const pBands = await bandsOf(copyP.uuid);
    const pr = await doCast(copyP, "perpetual light", pBands);
    if (pr) {
      const rec = pr.recs.find((r) => r.bandKeys.length) ?? null;
      check("perpetual light: the cast wrote a light record carrying all three bands, each as the row's located figure", !!rec && rec.bandKeys.length === 3 && rec.match.daylight === true && rec.match.bright === true && rec.match.dim === true && !rec.blank.daylight && !rec.blank.bright && !rec.blank.dim, rec ? { keys: rec.bandKeys.length, match: rec.match, blank: rec.blank, onCaster: rec.onCaster } : { records: pr.recs.length });
      check("perpetual light: the record carries no start time and no duration (no countdown), and the cite flag", !!rec && rec.hasStart === false && rec.hasDuration === false && rec.cite === true, rec ? { hasStart: rec.hasStart, hasDuration: rec.hasDuration, cite: rec.cite } : null);
    }
    if (copyT) {
      const tBands = await bandsOf(copyT.uuid);
      const tr = await doCast(copyT, "timed light", tBands, 5);
      if (tr) {
        const rec = tr.recs.find((r) => r.bandKeys.length) ?? null;
        check("timed light: the record's daylight band is blank and its bright and dim bands are the row's located figures", !!rec && rec.blank.daylight === true && rec.match.bright === true && rec.match.dim === true, rec ? { blank: rec.blank, match: rec.match } : { records: tr.recs.length });
        check("timed light: the record has a start time and a duration (a countdown), against the perpetual form's none", !!rec && rec.hasStart === true && rec.hasDuration === true, rec ? { hasStart: rec.hasStart, hasDuration: rec.hasDuration, cardNone: tr.card.noneReason, cardUnits: tr.card.durUnits, timedLine: tr.card.timedLine, shape: await run(gm, async ({ uuid }) => { const d = await fromUuid(uuid); const sp = d.getFlag("acks-extras", "spell") ?? {}; const du = sp.duration ?? null; return { keys: du ? Object.keys(du) : null, shape: du?.shape ?? null, unit: du?.unit ?? null, perLevel: du?.perLevel ?? null, casterLevel: d.parent?.system?.details?.level ?? null }; }, { uuid: copyT.uuid }) } : null);
      }
    }
    await run(gm, P.clearWindows);
  });

  /* ---------------------------------------------------------------- */
  const src = after[CAST_FROM];
  if (!src) { skip("conjure casts", "the first conjure entry is not imported in this world"); } else {
    let caster; let creature; let sceneDoc;
    let casterId; let casterUuid; let sceneId; let creatureUuid; let tokenId; let copy;
    const setup = async () => {
      sceneDoc = await gm.fixture("magic/conjure-scene", "Scene", {
        name: "QA Conjure Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
        grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 },
      });
      caster = await gm.fixture("magic/conjure-caster", "Actor", { name: "QA Conjure Caster", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0, [playerId]: 3 } });
      creature = await gm.fixture("magic/conjure-creature", "Actor", { name: "QA Conjure Creature", type: "monster", system: { hp: { value: 4, max: 4, hd: "1" } }, ownership: { default: 0, [playerId]: 2 } });
      casterId = idOf(caster);
      casterUuid = `Actor.${casterId}`;
      sceneId = idOf(sceneDoc);
      creatureUuid = `Actor.${idOf(creature)}`;
    };
    await stage("conjure casts: fixtures and the copy of one imported conjure spell", async () => {
      await setup();
      const lvl = await run(gm, P.spellLevel, { uuid: src.uuid });
      await run(gm, P.shapeCaster, { casterId, level: 5, lvl });
      const stale = await run(gm, P.stale, { actorId: casterId });
      check("start shape: no spell record stands on the conjure caster", stale.length === 0, { records: stale.length });
      for (const uuid of stale) await track(uuid, "ActiveEffect");
      copy = await run(gm, P.copySpell, { casterId, uuid: src.uuid });
      await track(copy.uuid, "Item");
      const tk = await run(gm, P.casterToken, { sceneId, actorId: casterId });
      tokenId = tk.id;
      if (tk.made) await track(tk.uuid, "Token");
      const cr = await run(gm, async ({ uuid, srcUuid }) => { const c = await fromUuid(uuid); const s = await fromUuid(srcUuid); const f = c.getFlag("acks-extras", "spell"); return { summonRows: Array.from(f?.effects ?? []).filter((r) => r.type === "summon").length, sameDuration: JSON.stringify(f?.duration ?? null) === JSON.stringify(s.getFlag("acks-extras", "spell")?.duration ?? null) }; }, { uuid: copy.uuid, srcUuid: src.uuid });
      check("the copy carries the imported summon row and the printed duration, not a rewritten one", cr.summonRows === 1 && cr.sameDuration, cr);
      check("the Player seat observes the creature fixture", (await run(player, async ({ uuid }) => !!(await fromUuid(uuid))?.testUserPermission(game.user, "OBSERVER"), { uuid: creatureUuid })) === true);
      check("the Player seat views the field", await run(player, P.view, { sceneId }));
    });

    /** One cast as the Player makes it: window, drop, count 1, Cast, one real click beside the caster's token; answers the card and the record. */
    const castOnce = async (tag) => {
      await run(player, P.clearWindows);
      const idsBefore = await run(gm, P.messageIds);
      const copiesBefore = await run(gm, P.copiesOf, { sourceUuid: creatureUuid });
      const open = await run(player, P.openCast, { casterId, spellId: copy.id });
      check(`${tag}: the cast window opens with a Summon band that takes a dropped creature (the row names none)`, open.dialog && open.summonBand && open.dropZone && !open.refSelect, open);
      const dropped = await run(player, P.dropCreature, { uuid: creatureUuid });
      check(`${tag}: the dropped creature fills the band: the count box appears with the row's located count, and Cast is on`, dropped.countBox && dropped.countHas && !dropped.castDisabled, dropped);
      const typed = await run(player, P.setCount, { n: 1 });
      check(`${tag}: the count typed as one leaves Cast on with no block`, typed.countBox && !typed.castDisabled && typed.blocks === 0, typed);
      if (typed.castDisabled) return null;
      const pressed = await run(player, P.pressCast, { clear: true });
      check(`${tag}: Cast is pressed in the window`, pressed.pressed, pressed);
      await frontSeat(PORTS.player);
      await run(player, P.view, { sceneId });
      await pointerToMiddle(player, PORTS.player);
      const p = await run(player, P.pointBeside, { sceneId, tokenId });
      if (!p.onCanvas) throw new Error("no bare canvas beside the caster's token to click");
      await clickAt(PORTS.player, p);
      const cards = await until(gm, P.castCards, { spellUuid: copy.uuid, since: idsBefore }, (c) => c.length > 0 && c[0].settled, { tries: 80 });
      const card = cards[0];
      if (!card) { check(`${tag}: a cast card posted`, false); return null; }
      castIds.push(card.castId);
      await track(`ChatMessage.${card.id}`, "ChatMessage");
      const creatures = await until(gm, P.creatures, { sceneId, casterUuid, playerId }, (c) => c.some((x) => x.castId === card.castId), { tries: 40 });
      for (const c of creatures) await track(c.uuid, "Token");
      const copiesAfter = await run(gm, P.copiesOf, { sourceUuid: creatureUuid });
      for (const u of copiesAfter.filter((x) => !copiesBefore.includes(x))) await track(u, "Actor");
      const recs = await run(gm, P.records, { actorId: casterId });
      const mine = recs.filter((r) => r.castId === card.castId);
      for (const r of mine) await track(r.uuid, "ActiveEffect");
      return { card, creatures: creatures.filter((c) => c.castId === card.castId), record: mine.find((r) => r.role === "caster") ?? null, mine };
    };
    const cardsOf = async (castId) => run(gm, P.endCards, { castId, playerId });
    const trackCards = async (cards) => { for (const c of cards) await track(c.uuid, "ChatMessage"); };

    await stage("(a) the Player dismisses the creature at will", async () => {
      if (!copy) { skip("(a)", "no copy was made"); return; }
      const c = await castOnce("(a)");
      if (!c) return;
      check("(a): the card reads held and not timed, the printed duration as its cap, one creature stands", c.card.held === "mobile" && c.card.untimed && c.card.capFinite && c.card.summoned === 1 && c.creatures.length === 1, { held: c.card.held, untimed: c.card.untimed, capFinite: c.card.capFinite, summoned: c.card.summoned, creatures: c.creatures.length });
      const statuses = await run(player, P.statuses, { actorId: casterId });
      check("(a): the Player's seat reads the caster concentrating, the record held", !!c.record && c.record.held != null && statuses.includes(c.record.status), { held: c.record?.held, status: !!c.record?.status });
      const menu = await run(player, P.menu, { actorId: casterId });
      let used = "menu";
      let dismissed = menu.cell ? await run(player, P.dismissViaMenu) : { offered: false };
      if (!dismissed.offered || !dismissed.confirmed) {
        used = "api (the cast menu offered no Dismiss entry)";
        await run(player, P.clearWindows);
        const via = await run(player, P.dismissApi, { casterId, tokenUuid: c.creatures[0].uuid });
        dismissed = { ...dismissed, api: via };
      }
      note("(a) the dismissal was pressed through", used);
      await run(player, P.clearWindows);
      await sleep(2500);
      const left = await run(gm, P.creatures, { sceneId, casterUuid, playerId });
      const recs = await run(gm, P.records, { actorId: casterId });
      const ends = await cardsOf(c.card.castId);
      await trackCards(ends);
      check("(a): the creature is removed", left.filter((x) => x.castId === c.card.castId).length === 0, { left: left.filter((x) => x.castId === c.card.castId).length });
      check("(a): the concentration ends at the dismissal (step 15 (a); step 11 instead reads the record standing to the cap)", recs.filter((r) => r.castId === c.card.castId).length === 0, { records: recs.filter((r) => r.castId === c.card.castId).length });
      check("(a): no hostile card was posted for the cast", !ends.some((e) => e.outcome === "hostile"), { cards: ends.length, outcomes: ends.map((e) => e.outcome === "hostile") });
      const adv = await run(gm, P.pastCap, { value: c.card.capValue, units: c.card.capUnits });
      const recsAfter = await run(gm, P.records, { actorId: casterId });
      const endsAfter = await until(gm, P.endCards, { castId: c.card.castId, playerId }, (e) => e.length > 0, { tries: 20 });
      await trackCards(endsAfter);
      check("(a): the clock passed the cap: the record is gone, and the end card lists no creature and names no hostile outcome", adv.known && adv.passed && recsAfter.filter((r) => r.castId === c.card.castId).length === 0 && !endsAfter.some((e) => e.outcome === "hostile") && endsAfter.every((e) => !e.lists), { passed: adv.passed, records: recsAfter.filter((r) => r.castId === c.card.castId).length, cards: endsAfter.length, lists: endsAfter.map((e) => e.lists ?? 0) });
    });

    await stage("(b) the concentration is ended by the status's toggle", async () => {
      if (!copy) { skip("(b)", "no copy was made"); return; }
      const stale = await run(gm, P.records, { actorId: casterId });
      check("(b): start shape: no held record stands on the caster", stale.filter((r) => r.held).length === 0, { held: stale.filter((r) => r.held).length });
      const c = await castOnce("(b)");
      if (!c || !c.record || !c.creatures.length) { check("(b): the cast stood a creature under a held record", false, { record: !!c?.record, creatures: c?.creatures.length }); return; }
      const t = await run(gm, P.toggleStatus, { actorId: casterId, status: c.record.status });
      check("(b): the GM toggles the held record's status off and it is gone", t.still === false, t);
      await sleep(2000);
      const ends = await until(gm, P.endCards, { castId: c.card.castId, playerId }, (e) => e.some((x) => x.kind === "held"), { tries: 30 });
      await trackCards(ends);
      const funnel = ends.filter((e) => e.kind === "held");
      check("(b): one funnel card, its outcome hostile, listing the one standing creature", funnel.length === 1 && funnel[0].outcome === "hostile" && funnel[0].lists === 1, { funnel: funnel.length, hostile: funnel[0]?.outcome === "hostile", lists: funnel[0]?.lists });
      const now = (await run(gm, P.creatures, { sceneId, casterUuid, playerId })).filter((x) => x.castId === c.card.castId);
      check("(b): the creature stands, stamped lost hostile, the Player's ownership gone, its disposition hostile", now.length === 1 && now[0].lost === "hostile" && now[0].playerOwns === false && now[0].disposition === -1, { stands: now.length, lostHostile: now[0]?.lost === "hostile", playerOwns: now[0]?.playerOwns, hostileDisposition: now[0]?.disposition === -1 });
      if (now[0]) {
        const refused = await run(player, P.dismissApi, { casterId, tokenUuid: now[0].uuid });
        check("(b): the Player's Dismiss is refused controlLost (the sheet's Dismiss is called as the API the entry runs, no confirm)", refused.token && refused.ok === false && refused.reason === "controlLost", refused);
      }
    });

    await stage("(c) the clock passes the cap with the creature not dismissed", async () => {
      if (!copy) { skip("(c)", "no copy was made"); return; }
      const stale = await run(gm, P.records, { actorId: casterId });
      check("(c): start shape: no held record stands on the caster", stale.filter((r) => r.held).length === 0, { held: stale.filter((r) => r.held).length });
      const c = await castOnce("(c)");
      if (!c || !c.record || !c.creatures.length || !c.card.capFinite) { check("(c): the cast stood a creature under a held record with a cap", false, { record: !!c?.record, creatures: c?.creatures.length, cap: c?.card.capFinite }); return; }
      const adv = await run(gm, P.pastCap, { value: c.card.capValue, units: c.card.capUnits });
      check("(c): the world clock advanced past the cap", adv.known && adv.passed, adv);
      const ends = await until(gm, P.endCards, { castId: c.card.castId, playerId }, (e) => e.length > 0, { tries: 40 });
      await trackCards(ends);
      check("(c): the end card names the hostile outcome", ends.some((e) => e.outcome === "hostile"), { cards: ends.length, kinds: ends.map((e) => e.kind), cause: ends.map((e) => e.cause) });
      const now = (await run(gm, P.creatures, { sceneId, casterUuid, playerId })).filter((x) => x.castId === c.card.castId);
      check("(c): the creature stands, stamped lost hostile, hostile in disposition", now.length === 1 && now[0].lost === "hostile" && now[0].disposition === -1, { stands: now.length, lostHostile: now[0]?.lost === "hostile", hostileDisposition: now[0]?.disposition === -1 });
    });
  }

  const dg = await run(gm, P.drain);
  const dp = await run(player, P.drain);
  check("no console error on either seat (recorders attached after ready: init, setup and ready are not covered)", dg.errors.length === 0 && dp.errors.length === 0, { gm: dg.errors.length, player: dp.errors.length });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`recorders restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
    try { if (seat) await run(seat, P.clearWindows); } catch {}
  }
  try {
    if (gm && wasPaused) await run(gm, P.pause, { paused: true });
  } catch {}
  try {
    if (gm) {
      // The run's own leavings by id: cards speaking as its casters since it began, or carrying one of its cast ids, and the records on its casters.
      const leavings = JSON.parse(await gm.eval(`(async () => {
        const mine = game.actors.filter((a) => /^magic\\/conjure-/.test(String(a.flags?.world?.fixture ?? "")) && ${JSON.stringify(MACHINE.own ?? "")} && String(a.flags.world.fixture).endsWith("@${MACHINE.own ?? ""}"));
        const ids = ${JSON.stringify(castIds)};
        const ownIds = mine.map((a) => a.id);
        const uuids = mine.map((a) => a.uuid);
        const cards = [...game.messages].filter((m) => m.timestamp >= ${startedAt} && (ownIds.includes(m.speaker?.actor) || ids.includes(m.flags?.["acks-extras"]?.castCard?.castId) || ids.includes(m.flags?.["acks-extras"]?.castHeldEnd?.castId) || ids.includes(m.flags?.["acks-extras"]?.castEnded?.castId) || uuids.includes(m.flags?.["acks-extras"]?.castHeldEnd?.casterUuid) || uuids.includes(m.flags?.["acks-extras"]?.castEnded?.casterUuid))).map((m) => m.uuid);
        const records = mine.flatMap((a) => [...a.effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect && ids.includes(e.flags["acks-extras"].spellEffect.castId)).map((e) => e.uuid));
        return JSON.stringify({ cards, records });
      })()`));
      for (const u of leavings.cards) await track(u, "ChatMessage");
      for (const u of leavings.records) await track(u, "ActiveEffect");
      if (own.length) note("swept", await gm.sweepTracked({ only: own }));
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  for (const seat of [player, gm]) { try { await seat?.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
