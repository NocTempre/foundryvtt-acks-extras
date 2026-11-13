/**
 * Live walk: docs/formation/TESTING.md "The party check resolves through the
 * abilities". The GM seat drives the party check, the Rolls tab, the skill
 * sheet and the disarm dialog against five characters, and proves that the
 * four read one figure for the same throw.
 *
 * Every figure typed into a fixture is invented. An imported figure is compared
 * in the page and only the boolean (or the equality of two reads) is printed.
 *
 * Fixtures, kept and found again by marker (`api.fixture`):
 *   formation/skills-party     an acks-extras.party actor holding the five
 *   formation/skills-thief     a level-6 character with the library's
 *                              Searching, Trapbreaking and Eavesdropping
 *   formation/skills-alert     the library's Alertness proficiency and an
 *                              invented stored Adventuring figure
 *   formation/skills-elf       the library's Attunement to Nature power and the
 *                              same stored figure
 *   formation/skills-handmade  hand-made abilities: one named like a printed
 *                              proficiency with no import behind it, one bound
 *                              to Search with a flat throw, one naming a ladder
 *                              no import holds
 *   formation/skills-borrowed  a hand-made skill still carrying the legacy
 *                              party-check scaling flags
 * Each section brings what it reads to shape at its start. The chat card the
 * party check posts and the conditions' effect are tracked by id and swept.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const SCOPE = "acks-extras";
const NONCE = "psk" + Math.random().toString(36).slice(2, 7);
const BOOKS = books(["rr", "jj"]);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

const RECORDER = `(() => {
  const R = (globalThis.__pskBoot = { phase: "load", phases: [], errors: [] });
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

/** Page-context probes. Each is stringified and run on the GM seat. */
const P = {
  install: async ({ nonce }) => {
    const BASE = "/modules/acks-extras/scripts/";
    const H = (globalThis.__psk = globalThis.__psk ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        let v = null;
        try { v = await fn(); } catch { v = null; }
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.model = await import(`${BASE}formation/formation-model.mjs`);
    H.party = await import(`${BASE}formation/party-rolls.mjs`);
    H.rolls = await import(`${BASE}character-sheet/rolls.mjs`);
    H.adv = await import(`${BASE}abilities/adventuring-throw.mjs`);
    H.ar = await import(`${BASE}abilities/ability-rolls.mjs`);
    H.mig = await import(`${BASE}abilities/skill-flag-migration.mjs`);
    H.lad = await import(`${BASE}abilities/skill-ladders.mjs`);
    H.zone = await import(`${BASE}formation/trap-zone.mjs`);
    H.LIB = await import(`${BASE}lib/library.mjs`);
    H.cond = await import(`${BASE}lib/conditions.mjs`);
    H.Trap = (await import(`${BASE}formation/trapbreak-app.mjs`)).default;
    if (!H.cards) {
      H.cards = [];
      Hooks.on("preCreateChatMessage", (doc, _d, _o, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); });
      Hooks.on("createChatMessage", (m) => {
        if (m.flags?.world?.qaNonce !== nonce) return;
        H.cards.push({ id: m.id, uuid: m.uuid, at: Date.now(), html: `${m.flavor ?? ""} ${m.content ?? ""}`, whisper: [...(m.whisper ?? [])] });
      });
    }
    return { ok: !!H.party.resolveCheck && !!H.lad.skillLadderRungs };
  },

  census: async () => ({ isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, boot: globalThis.__pskBoot ?? null }),

  connectBook: async ({ id, path }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    if (CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__pskBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__pskBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__pskBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    return { ...globalThis.__pskBook, open: !!CB.cookbookSessionDoc(id) };
  },
  updateAbilities: async ({ ids }) => {
    const H = globalThis.__psk;
    globalThis.__pskUpd = { done: false };
    const before = new Set([...foundry.applications.instances.values()].map((a) => a.id));
    acksExtras.importer.cookbookUpdateAbilities({ only: new Set(ids) })
      .then(() => { globalThis.__pskUpd = { done: true, ok: true }; })
      .catch((e) => { globalThis.__pskUpd = { done: true, ok: false, error: String(e?.message ?? e) }; });
    const done = await H.poll(() => (globalThis.__pskUpd.done ? true : null), { tries: 600, every: 250 });
    const dialogs = [...foundry.applications.instances.values()].filter((a) => !before.has(a.id) && a.rendered && /dialog/i.test(a.constructor.name)).map((a) => a.title);
    return { done: !!done, ...globalThis.__pskUpd, dialogs };
  },
  library: async ({ ids }) => {
    const H = globalThis.__psk;
    await H.LIB.whenReady();
    return Object.fromEntries(ids.map((id) => [id, !!H.LIB.byCookbookId("Item", id)]));
  },
  /** The library's copy of each id onto the actor, where it holds none. */
  give: async ({ actorId, ids }) => {
    const H = globalThis.__psk;
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
    if (add.length) await actor.createEmbeddedDocuments("Item", add);
    return Object.fromEntries(ids.map((id) => [id, !!held(id)]));
  },
  /** Hand-made ability items by name, built where none carries the name. */
  ensureItems: async ({ actorId, items }) => {
    const actor = game.actors.get(actorId);
    for (const data of items) {
      const have = actor.items.find((i) => i.name === data.name);
      if (have) await have.delete();
    }
    await actor.createEmbeddedDocuments("Item", items);
    return actor.items.filter((i) => items.some((d) => d.name === i.name)).length;
  },
  setStored: async ({ actorId, figures }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.adventuring": figures, "system.details.level": 6 });
    return { ...actor.system.adventuring };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__psk;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  seat: async ({ partyId, fid, actorIds }) => {
    const H = globalThis.__psk;
    const ids = () => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    const now = ids();
    const ok = now.length === actorIds.length && actorIds.every((id, i) => now[i] === id);
    if (!ok) {
      for (const id of now) await H.model.removeMember(H.model.getFormation(fid), id);
      const sheet = game.actors.get(partyId).sheet;
      await sheet.render(true);
      await H.sleep(900);
      for (const id of actorIds) {
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
        H.root(sheet).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await H.poll(() => ids().includes(id), { tries: 40, every: 150 });
      }
      await sheet.close({ animate: false });
    }
    return { members: ids(), reseated: !ok };
  },

  /**
   * One throw as each surface reads it: the party check's resolved target and
   * parts, the Rolls tab's row, and the skill sheet's row for the item. A figure
   * is the leading integer of what the surface prints, or null.
   */
  surfaces: async ({ actorId, itemName, cookbookId, checkKey, rollKey, advKey }) => {
    const H = globalThis.__psk;
    const actor = game.actors.get(actorId);
    const int = (s) => { const m = /-?\d+/.exec(String(s ?? "")); return m ? Number(m[0]) : null; };
    const out = { checkKey, advKey: advKey ?? null };
    const cfg = H.party.PARTY_CHECKS[checkKey];
    const resolved = cfg ? H.party.resolveCheck(actor, cfg) : null;
    out.party = resolved ? { target: resolved.target, skilled: resolved.skilled, parts: resolved.parts.map((p) => ({ label: p.label, value: p.value, cite: !!p.cite })), source: resolved.source } : null;
    const groups = H.rolls.rollInventory(actor).groups;
    const rows = groups.flatMap((g) => g.rows);
    const item = cookbookId
      ? actor.items.find((i) => i.getFlag("acks-extras", "cookbook")?.id === cookbookId)
      : itemName ? actor.items.find((i) => i.name === itemName) : null;
    out.itemName = item?.name ?? null;
    if (advKey) {
      const row = rows.find((r) => r.id === `adv:${advKey}`);
      out.advRow = row ? { value: row.value, figure: int(row.value), tip: !!row.tip } : null;
      out.rolls = out.advRow;
      const adv = H.adv.adventuringThrow(actor, advKey, { allow: H.party.skillGateAllows });
      out.adventuring = { source: adv.source, target: adv.target, parts: adv.parts.length };
    }
    if (item) {
      const key = rollKey ?? H.ar.defaultKeyOf(item);
      const row = rows.find((r) => r.id === `abl:${item.id}:${key}`);
      // A skill the Adventuring row stands behind is listed once, there.
      out.rolls = row ? { value: row.value, figure: int(row.value) } : advKey ? out.advRow : null;
      const ctx = await item.sheet._prepareContext({});
      const sheetRow = (ctx.rollRows ?? []).find((r) => r.key === key);
      out.sheet = sheetRow ? { display: sheetRow.display, figure: int(sheetRow.display) } : null;
      const roll = H.ar.rollsOf(item).find((r, i) => H.ar.keyOf(r, i) === key);
      out.throw = roll ? { target: H.ar.throwOutcome(roll, actor, item, { conditions: false }).target, text: H.ar.throwText(roll, actor, item) } : null;
    }
    return out;
  },

  /** The party check as the card posts it: press the real function, read the card's rows. */
  postCard: async ({ fid, checkKey }) => {
    const H = globalThis.__psk;
    const since = Date.now();
    const rolled = await H.party.rollPartyCheck(H.model.getFormation(fid), checkKey);
    await H.poll(() => H.cards.some((c) => c.at >= since), { tries: 40, every: 200 });
    await H.sleep(500);
    const cards = H.cards.filter((c) => c.at >= since);
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    return cards.map((c) => {
      const box = document.createElement("div");
      box.innerHTML = c.html;
      const rows = [...box.querySelectorAll("table.acks-table tbody tr")].map((tr) => ({
        text: tr.textContent.replace(/\s+/g, " ").trim(),
        tip: tr.querySelector("td[data-tooltip-text]")?.dataset.tooltipText ?? "",
      }));
      return { id: c.id, uuid: c.uuid, rolled, rows, whisperedToJudges: c.whisper.length > 0 && c.whisper.every((u) => gms.includes(u)) };
    });
  },

  /** The disarm dialog's resolved check beside the audit's, for one member and mode. */
  disarm: async ({ fid, actorId, mode }) => {
    const H = globalThis.__psk;
    const app = new H.Trap({ formationId: fid, actorId });
    app.choice.mode = mode;
    const ctx = await app._prepareContext();
    const key = mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical";
    const audit = H.party.resolveCheck(game.actors.get(actorId), H.party.PARTY_CHECKS[key]);
    return {
      hasCheck: !!ctx.check,
      dialogTarget: ctx.check?.target ?? null,
      auditTarget: audit?.target ?? null,
      parts: ctx.parts.length,
      needs: ctx.needs,
      skilled: ctx.check?.skilled ?? null,
    };
  },

  /** One status effect on the actor that moves a proficiency throw, found by trying each. */
  condition: async ({ actorId }) => {
    const H = globalThis.__psk;
    const actor = game.actors.get(actorId);
    const move = () => H.cond.rollMath("throw", H.cond.subjectOf(actor)).total;
    const base = move();
    for (const s of CONFIG.statusEffects ?? []) {
      let made = null;
      try {
        await actor.toggleStatusEffect(s.id, { active: true });
        await H.sleep(300);
        if (move() !== base) { made = s.id; return { applied: made, base, moved: move() }; }
      } catch { /* try the next */ }
      try { await actor.toggleStatusEffect(s.id, { active: false }); } catch { /* off */ }
    }
    return { applied: null, base, moved: base };
  },
  clearConditions: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    for (const s of CONFIG.statusEffects ?? []) if (actor.statuses?.has(s.id)) { try { await actor.toggleStatusEffect(s.id, { active: false }); } catch { /* off */ } }
    return [...(actor.statuses ?? [])].length;
  },

  /** The legacy-flag item before and after the migration. */
  migrate: async ({ actorId, name }) => {
    const H = globalThis.__psk;
    const actor = game.actors.get(actorId);
    const item = actor.items.find((i) => i.name === name);
    await H.lad.refreshLadders();
    const flags = () => ({ thiefSkill: item.getFlag("acks-extras", "thiefSkill") ?? null, levelFactor: item.getFlag("acks-extras", "levelFactor") ?? null });
    const target = () => foundry.utils.deepClone(H.ar.rollsOf(item)[0]?.target ?? null);
    const before = { flags: flags(), kind: target()?.kind ?? null };
    const plan = H.mig.planSkillFlagMigration(item, actor);
    const done = await H.mig.migrateItem(item, actor);
    const t = target();
    return { before, plan: { action: plan.action, reason: plan.reason ?? null }, done, after: { flags: flags(), kind: t?.kind ?? null, as: t?.as ?? null, hasFraction: t?.atLevelNum != null, hasRound: t?.round != null } };
  },

  /** The skill sheet rendered, and the Skill audit opened from the party's Order tab. */
  openWindows: async ({ actorId, name, partyId }) => {
    const H = globalThis.__psk;
    const item = game.actors.get(actorId).items.find((i) => i.name === name);
    const app = item.sheet;
    await app.render(true);
    await H.sleep(900);
    const text = (H.root(app)?.textContent ?? "").replace(/\s+/g, " ");
    const sheet = { rendered: !!app.rendered, hasName: text.includes(name) };
    await app.close({ animate: false });

    for (const w of foundry.applications.instances.values()) if (w.constructor.name === "SkillAuditApp") await w.close({ animate: false });
    const party = game.actors.get(partyId).sheet;
    await party.render(true);
    await H.sleep(900);
    H.root(party)?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(300);
    H.root(party)?.querySelector('[data-action="openSkillAudit"]')?.click();
    const audit = await H.poll(() => [...foundry.applications.instances.values()].find((w) => w.constructor.name === "SkillAuditApp" && w.rendered), { tries: 80, every: 200 });
    await H.sleep(500);
    const root = H.root(audit);
    const out = {
      sheet,
      audit: !!audit,
      rows: root?.querySelectorAll("[data-ability-name]").length ?? 0,
      noProgressionControl: !!root && !root.querySelector('[data-field="thiefSkill"], [data-field="levelFactor"]'),
    };
    if (audit) await audit.close({ animate: false });
    await party.close({ animate: false });
    return out;
  },

  boot: async () => globalThis.__pskBoot ?? null,
};

async function run(api, fn, args = {}, timeout = undefined) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`, timeout);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 300) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation && !!globalThis.acksExtras?.importer?.cookbookUpdateAbilities`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A second DevTools client on the GM seat, to reload the page under the boot recorder. */
async function rawSeat(port) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(webSocketDebuggerUrl);
    w.addEventListener("open", () => resolve(w));
    w.addEventListener("error", () => reject(new Error("raw seat: socket error")));
  });
  let next = 0;
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = ++next;
    const on = (event) => { const reply = JSON.parse(event.data); if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && /\/game$/.test(new URL(t.url).pathname));
  if (pages.length !== 1) { ws.close(); throw new Error(`raw seat: ${pages.length} game pages`); }
  const { sessionId } = await send("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
  return { send: (m, p) => send(m, p, sessionId), close() { try { ws.close(); } catch { /* closed */ } } };
}

const character = (name, extra = {}) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 }, details: { level: 6 } }, ...extra });
const flat = (key, target, label = "") => ({ key, label, rollType: "above", scale: "level", target: { kind: "flat", flat: target } });
const handmade = (name, rolls, flags = {}) => ({
  name, type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 0 },
  flags: { [SCOPE]: { extras: { rolls }, ...flags } },
});
const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);
const STORED = { listening: 19, searching: 19, trapbreaking: 19, climbing: 19, dungeonbashing: 19 };
const LIBRARY = {
  searching: "def.skill.searching",
  trapbreaking: "def.skill.trapbreaking",
  eavesdropping: "def.prof.eavesdropping",
  alertnessProf: "def.prof.alertness",
  alertnessPower: "def.power.alertness",
  attunement: "def.power.attunementToNature",
  trapfinding: "def.prof.trapfinding",
};

const open = {};
const tracked = [];
let gm = null;

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  open.gm = gm;
  note("ready after (s)", await ready(gm, "gm"));
  const raw = await rawSeat(PORTS.gm);
  await raw.send("Page.enable");
  await raw.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await raw.send("Page.reload");
  await sleep(1500);
  raw.close();
  note("reloaded under the recorder, ready after (s)", await ready(gm, "gm"));
  note("installed", await run(gm, P.install, { nonce: NONCE }));
  const census = await run(gm, P.census);
  check("the GM seat is the active GM and its boot recorded no error through init, setup and ready", census.isGM && census.activeGMIsSelf && census.boot?.phases.length === 3 && !census.boot.errors.length, census.boot?.errors);
  if (!census.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");

  section("books and Update Abilities");
  for (const b of BOOKS) {
    const s = await run(gm, P.bookState, { id: b.id });
    if (s.open) continue;
    note(`connect ${b.id}`, await run(gm, P.connectBook, b));
    for (let n = 0; n < 150; n++) {
      const st = await run(gm, P.bookState, { id: b.id });
      if (st.done || st.open) { note(`book ${b.id}`, { done: !!st.done, ok: st.ok ?? null, open: !!st.open }); break; }
      await sleep(1000);
    }
  }
  const lib0 = await run(gm, P.library, { ids: Object.values(LIBRARY) });
  note("library holds", lib0);
  const upd = await run(gm, P.updateAbilities, { ids: Object.values(LIBRARY) }, 240000);
  check("Update Abilities for the party-check abilities finishes with no dialog left open", upd.done && upd.ok && upd.dialogs.length === 0, upd);
  const lib = await run(gm, P.library, { ids: Object.values(LIBRARY) });
  check("the library holds every ability the walk names", Object.values(lib).every(Boolean), lib);

  section("fixtures");
  const party = await gm.fixture("formation/skills-party", "Actor", { name: "QA Skills Party", type: `${SCOPE}.party` });
  const thief = await gm.fixture("formation/skills-thief", "Actor", character("QA Skills Thief"));
  const alert = await gm.fixture("formation/skills-alert", "Actor", character("QA Skills Alert"));
  const elf = await gm.fixture("formation/skills-elf", "Actor", character("QA Skills Elf"));
  const hand = await gm.fixture("formation/skills-handmade", "Actor", character("QA Skills Handmade"));
  const borrowed = await gm.fixture("formation/skills-borrowed", "Actor", character("QA Skills Borrowed"));
  const members = [thief, alert, elf, hand, borrowed];
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  const seated = await run(gm, P.seat, { partyId: party.id, fid, actorIds: members.map((m) => m.id) });
  check("the party holds its five members", seated.members.length === 5, seated);
  for (const m of members) await run(gm, P.setStored, { actorId: m.id, figures: STORED });
  note("thief holds", await run(gm, P.give, { actorId: thief.id, ids: [LIBRARY.searching, LIBRARY.trapbreaking, LIBRARY.eavesdropping] }));
  note("alert holds", await run(gm, P.give, { actorId: alert.id, ids: [LIBRARY.alertnessProf] }));
  note("elf holds", await run(gm, P.give, { actorId: elf.id, ids: [LIBRARY.attunement, LIBRARY.alertnessPower] }));

  const same = (label, s, pick) => {
    const figures = pick(s).filter((f) => f !== undefined);
    check(label, figures.length >= 2 && figures.every((f) => f !== null && f === figures[0]), { figures, checkKey: s.checkKey });
  };

  section("the thief: one figure on four surfaces");
  for (const [item, cookbookId, checkKey, rollKey, advKey] of [
    ["Searching", LIBRARY.searching, "searchMethodical", "methodical", "searching"], ["Searching", LIBRARY.searching, "searchHasty", "hasty", undefined],
    ["Trapbreaking", LIBRARY.trapbreaking, "trapbreakMethodical", "methodical", "trapbreaking"], ["Trapbreaking", LIBRARY.trapbreaking, "trapbreakHasty", "hasty", undefined],
  ]) {
    const s = await run(gm, P.surfaces, { actorId: thief.id, cookbookId, checkKey, rollKey, advKey });
    if (!s.itemName) { check(`${item}: the thief holds it`, false, s); continue; }
    same(`${item} ${rollKey}: the party check, the Rolls tab and the skill sheet read one figure`, s, (x) => [x.party?.target, x.rolls?.figure, x.sheet?.figure]);
    check(`${item} ${rollKey}: the party check's figure is the throw's own, before conditions`, s.party?.target === s.throw?.target, { party: s.party?.target, throw: s.throw?.target });
    check(`${item} ${rollKey}: the party check counts the thief as skilled`, s.party?.skilled === true, s.party);
  }
  const listen = await run(gm, P.surfaces, { actorId: thief.id, cookbookId: LIBRARY.eavesdropping, checkKey: "listen", advKey: "listening" });
  same("Eavesdropping: the party check, the Rolls tab row and the skill sheet read one figure", listen, (x) => [x.party?.target, x.rolls?.figure, x.sheet?.figure]);

  section("Alertness stands in for the stored figure");
  for (const [who, label] of [[alert, "the proficiency"], [elf, "the power"]]) {
    for (const advKey of ["listening", "searching"]) {
      const s = await run(gm, P.surfaces, { actorId: who.id, checkKey: advKey === "listening" ? "listen" : "searchMethodical", advKey });
      same(`${label}, ${advKey}: the party check and the Rolls tab's Adventuring row read one figure`, s, (x) => [x.party?.target, x.rolls?.figure, x.adventuring?.target]);
      check(`${label}, ${advKey}: the figure comes from a stand-in or the stored field, never a skill`, ["standIn", "stored"].includes(s.adventuring?.source), s.adventuring);
    }
  }
  const standIn = await run(gm, P.surfaces, { actorId: alert.id, checkKey: "listen", advKey: "listening" });
  check("Alertness lowers the Adventuring listening figure under the stored one", standIn.adventuring?.source === "standIn" && standIn.adventuring.target < STORED.listening, standIn.adventuring);
  check("the party card names the bonus parts and each carries the page its import cites", (standIn.party?.parts ?? []).length === 0 || standIn.party.parts.every((p) => p.cite), standIn.party?.parts);

  section("hand-made abilities give nothing a printed one would");
  const items = [
    handmade("Alertness", [flat("searchListen", 10, "Search and listen")]),
    handmade("QA Hand Search", [flat("primary", 15, "Search")], { checkKey: "search" }),
    handmade("QA Hand Ladder", [{ key: "primary", label: "Search", rollType: "above", scale: "level", target: { kind: "progression", as: "thief", table: "qaunimported" } }], { checkKey: "listen" }),
  ];
  note("hand-made built", await run(gm, P.ensureItems, { actorId: hand.id, items }));
  const stored = await run(gm, P.surfaces, { actorId: hand.id, checkKey: "listen", advKey: "listening" });
  check("a hand-made item named Alertness is not the printed proficiency: the figure stays the stored one", stored.adventuring?.source === "stored" && stored.adventuring.target === STORED.listening, stored.adventuring);
  const flatSearch = await run(gm, P.surfaces, { actorId: hand.id, itemName: "QA Hand Search", checkKey: "searchMethodical", rollKey: "primary" });
  check("a hand-made flat throw bound to Search is the party check's figure, with no part", flatSearch.party?.target === 15 && flatSearch.party.parts.length === 0, flatSearch.party);
  same("the hand-made flat throw reads one figure on the card, the Rolls tab and the sheet", flatSearch, (x) => [x.party?.target, x.rolls?.figure, x.sheet?.figure]);
  const ladder = await run(gm, P.surfaces, { actorId: hand.id, itemName: "QA Hand Ladder", checkKey: "listen", rollKey: "primary" });
  check("a throw naming a ladder nothing imported shows no figure on the sheet and the Rolls tab, and the party check passes over it for the Adventuring figure", ladder.party?.skilled === false && ladder.party.target === STORED.listening && ladder.rolls?.figure === null && ladder.sheet?.figure === null, { party: ladder.party, rolls: ladder.rolls?.value, sheet: ladder.sheet?.display });

  section("a condition moves the card once");
  const cond = await run(gm, P.condition, { actorId: thief.id });
  if (!cond.applied) note("conditions", "no status effect in this world moves a proficiency throw: not reached");
  else {
    // The hasty throw has its own row on the Rolls tab, which folds the condition in like the card; the methodical throw's row is the Adventuring one, which does not.
    const withCond = await run(gm, P.surfaces, { actorId: thief.id, cookbookId: LIBRARY.searching, checkKey: "searchHasty", rollKey: "hasty" });
    const conditionParts = (withCond.party?.parts ?? []).filter((p) => p.value === cond.moved);
    check("with a condition on, the party check's target is the throw's own moved by exactly the condition, named once", !!withCond.party && !!withCond.throw && withCond.party.target === withCond.throw.target - cond.moved && conditionParts.length === 1, { moved: cond.moved, parts: withCond.party?.parts.length });
    check("the Rolls tab and the skill sheet carry the same condition once", withCond.rolls?.figure === withCond.party?.target && withCond.sheet?.figure === withCond.party?.target, { rolls: withCond.rolls?.figure, sheet: withCond.sheet?.figure, party: withCond.party?.target });
    const methodical = await run(gm, P.surfaces, { actorId: thief.id, cookbookId: LIBRARY.searching, checkKey: "searchMethodical", rollKey: "methodical", advKey: "searching" });
    check("the Adventuring row is the figure before conditions, and the card is that figure moved once", methodical.advRow?.figure === methodical.throw?.target && methodical.party?.target === methodical.throw?.target - cond.moved, { row: methodical.advRow?.figure, throw: methodical.throw?.target, party: methodical.party?.target });
    note("conditions cleared (statuses left)", await run(gm, P.clearConditions, { actorId: thief.id }));
  }

  section("the disarm dialog and the audit read one figure");
  for (const mode of ["hasty", "methodical"]) {
    const d = await run(gm, P.disarm, { fid, actorId: thief.id, mode });
    check(`${mode}: the dialog's resolved check is the audit's`, d.hasCheck && d.dialogTarget === d.auditTarget && d.dialogTarget !== null, d);
  }
  const dAlert = await run(gm, P.disarm, { fid, actorId: alert.id, mode: "methodical" });
  check("a character with no Trapbreaking skill is offered the methodical attempt on the Adventuring figure", dAlert.hasCheck && dAlert.dialogTarget === dAlert.auditTarget, dAlert);
  const dHasty = await run(gm, P.disarm, { fid, actorId: alert.id, mode: "hasty" });
  check("and no hasty attempt at all", !dHasty.hasCheck, dHasty);

  section("the legacy party-check flags");
  const legacy = handmade("QA Borrowed Pick", [flat("primary", 17, "Pick")], { checkKey: "search", thiefSkill: "searching", levelFactor: 0.5 });
  note("legacy item built", await run(gm, P.ensureItems, { actorId: borrowed.id, items: [legacy] }));
  const before = await run(gm, P.surfaces, { actorId: borrowed.id, itemName: "QA Borrowed Pick", checkKey: "searchMethodical", rollKey: "primary" });
  check("before: the legacy flags are inert, the party check reads the item's own throw", before.party?.target === 17 && before.sheet?.figure === 17 && before.rolls?.figure === 17, { party: before.party?.target, sheet: before.sheet?.figure, rolls: before.rolls?.figure });
  const mig = await run(gm, P.migrate, { actorId: borrowed.id, name: "QA Borrowed Pick" });
  note("migration", mig);
  if (mig.plan.action === "move") {
    check("migration: the throw now borrows the ladder, at the stored fraction and the rounding, and the flags are gone", mig.done === "moved" && mig.after.kind === "progression" && mig.after.as === "thief" && mig.after.hasFraction && mig.after.hasRound && mig.after.flags.thiefSkill === null && mig.after.flags.levelFactor === null, mig.after);
    const after = await run(gm, P.surfaces, { actorId: borrowed.id, itemName: "QA Borrowed Pick", checkKey: "searchMethodical", rollKey: "primary" });
    same("after: the party check, the Rolls tab and the skill sheet read one figure", after, (x) => [x.party?.target, x.rolls?.figure, x.sheet?.figure]);
    const rerun = await run(gm, P.migrate, { actorId: borrowed.id, name: "QA Borrowed Pick" });
    check("a second run changes nothing", rerun.done === "none" && rerun.plan.action === "none", rerun);
  } else {
    check("migration: no imported ladder, so the flags are kept and counted", mig.plan.action === "keep" && mig.plan.reason === "notImported" && mig.done === "keep" && mig.after.flags.thiefSkill !== null, mig);
    note("migration move", "the library holds no Searching ladder in this world: the move itself was not reached");
  }

  section("the real surfaces");
  const cards = await run(gm, P.postCard, { fid, checkKey: "listen" });
  for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
  check("rolling the party's listen posts exactly one card, whispered to the Judges", cards.length === 1 && cards[0].whisperedToJudges, cards.length);
  const rows = cards[0]?.rows ?? [];
  check("the card has one row per member who can listen, each with a target tooltip", rows.length >= 1 && rows.every((r) => r.tip.length > 0), { rows: rows.length });
  const sheetName = (await run(gm, P.surfaces, { actorId: thief.id, cookbookId: LIBRARY.searching, checkKey: "searchHasty", rollKey: "hasty" })).itemName;
  const win = await run(gm, P.openWindows, { actorId: thief.id, name: sheetName, partyId: party.id });
  check("the thief's Searching sheet renders", win.sheet.rendered && win.sheet.hasName, win.sheet);
  check("the Skill audit opens from the Order tab, lists abilities, and its roster has no Progression or Factor control", win.audit && win.rows > 0 && win.noProgressionControl, { audit: win.audit, rows: win.rows });

  section("errors after ready");
  const boot = await run(gm, P.boot);
  check("nothing thrown over the walk", !boot?.errors.length, boot?.errors?.slice(0, 5));
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try {
    if (open.gm) note("swept", await open.gm.sweepTracked({ only: unique(tracked) }));
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch { /* closed */ } }
}
