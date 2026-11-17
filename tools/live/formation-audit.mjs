/**
 * Live walk: docs/formation/TESTING.md "The audit roll" and "A party in a
 * combat". The GM seat is the active GM and drives the Skill audit and the
 * token HUD; the Player seat proves the audit card is whispered past it.
 *
 * Covers:
 *   "The audit roll" 1, 2, 4, 5, 6, 7 (the window: ids, redraw, scroll and
 *       focus, columns, type size). Not walked: 3 (a stored proficiency-throw
 *       bonus) and 3a (a row bound to a party check), whose stored shapes this
 *       walk does not build.
 *   "A party in a combat" 1-7. Step 6 creates the second token through the
 *       same create a sidebar drop ends in, not a pointer drop.
 *
 * Every fixture and figure is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): `formation/audit-party` with `formation/audit-member-1`..`-3`
 * (members 1 and 2 hold an ability named `Audit Search` with a flat throw);
 * `formation/combat-scene`, `formation/combat-party` with
 * `formation/combat-member-1`..`-3` and its token `formation/combat-party-token`.
 * Each section brings what it reads to shape at its start. The combats, the
 * pasted copy and the cards the run's own actions posted are tracked by id and
 * swept; the audit items step 5 deletes are the fixture's and are rebuilt.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const SCOPE = "acks-extras";
const SHOTS = process.env.SHOTS === "1";
const NONCE = "aud" + Math.random().toString(36).slice(2, 7);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

const RECORDER = `(() => {
  const R = (globalThis.__audBoot = { phase: "load", phases: [], errors: [] });
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

const P = {
  census: async () => ({
    user: game.user.name, userId: game.user.id, role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    active: game.users.filter((u) => u.active).map((u) => u.name),
    boot: globalThis.__audBoot ?? null,
  }),

  install: async ({ nonce }) => {
    const H = (globalThis.__aud = globalThis.__aud ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.audit = await import(`${base}formation/skill-audit.mjs`);
    H.F = acksExtras.formation;
    // Every audit render, counted, so a step waits for the redraw it causes instead of a fixed sleep.
    if (!H.renderWatch) {
      H.renderWatch = true;
      H.renders = 0;
      H.lastRender = 0;
      // With `H.watchId` set, only that audit's renders count: another party's open audit draws for its own members.
      H.renderLog = [];
      Hooks.on("renderSkillAuditApp", (app) => {
        H.renderLog.push({ at: Date.now(), id: app.id });
        if (H.watchId && app.id !== H.watchId) return;
        H.renders += 1;
        H.lastRender = Date.now();
      });
    }
    /** Wait for a render after `n0`, then for the renders to stop. */
    H.settle = async (n0, quiet = 1200) => {
      const drew = await H.poll(() => H.renders > n0, { tries: 100, every: 200 });
      if (drew) await H.poll(() => Date.now() - H.lastRender > quiet, { tries: 100, every: 200 });
      return !!drew;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    if (!H.notes) {
      H.notes = [];
      for (const level of ["info", "warn"]) {
        const fn = ui.notifications[level];
        ui.notifications[level] = function (msg, ...rest) { H.notes.push(String(msg)); return fn.call(this, msg, ...rest); };
      }
    }
    if (!H.armed && game.user.isGM) {
      H.armed = true;
      H.cards = [];
      Hooks.on("preCreateChatMessage", (doc, _d, _o, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); });
      Hooks.on("createChatMessage", (m) => {
        if (m.flags?.world?.qaNonce !== nonce) return;
        H.cards.push({ id: m.id, uuid: m.uuid, at: Date.now(), alias: m.speaker?.alias ?? null, html: `${m.flavor ?? ""} ${m.content ?? ""}`, whisper: [...(m.whisper ?? [])], rolls: (m.rolls ?? []).length });
      });
    }
    return { ok: typeof H.F?.getFormations === "function" };
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    return { scene: canvas.scene?.id === sceneId };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__aud;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** Seat the members through the party sheet's drop, in order. */
  seat: async ({ partyId, fid, actorIds }) => {
    const H = globalThis.__aud;
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

  /** The party's linked token on the scene, made where none stands there, and adopted. */
  partyToken: async ({ fid, partyId, sceneId, x, y }) => {
    const H = globalThis.__aud;
    const scene = game.scenes.get(sceneId);
    const f = H.model.getFormation(fid);
    let token = f.tokenId ? scene.tokens.get(f.tokenId) : null;
    let made = null;
    if (!token) {
      const doc = await game.actors.get(partyId).getTokenDocument({ x, y });
      [token] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true, hidden: false }]);
      made = token.uuid;
      await H.poll(() => H.model.getFormation(fid).tokenId === token.id, { tries: 60, every: 200 });
    }
    return { tokenId: H.model.getFormation(fid).tokenId, sceneId: H.model.getFormation(fid).sceneId, made };
  },

  /** Items on an actor named `name`, made from `data` where none is. */
  ensureItem: async ({ actorId, name, data }) => {
    const actor = game.actors.get(actorId);
    let item = actor.items.find((i) => i.name === name);
    if (!item) [item] = await actor.createEmbeddedDocuments("Item", [data]);
    return { id: item.id };
  },
  dropItem: async ({ actorId, name }) => {
    const actor = game.actors.get(actorId);
    const ids = actor.items.filter((i) => i.name === name).map((i) => i.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
    return { dropped: ids.length };
  },
  setHp: async ({ actorId, value }) => {
    await game.actors.get(actorId).update({ "system.hp.value": value });
    return game.actors.get(actorId).system.hp.value;
  },

  clock: async ({ fid }) => JSON.stringify(globalThis.__aud.model.getFormation(fid).clock),

  /** The Skill audit opened from the Order tab, and the row's roll control. */
  openAudit: async ({ partyId, name }) => {
    const H = globalThis.__aud;
    for (const app of foundry.applications.instances.values()) if (app.constructor.name === "SkillAuditApp") await app.close({ animate: false });
    const sheet = game.actors.get(partyId).sheet;
    await sheet.render(true);
    await H.sleep(900);
    H.root(sheet)?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(300);
    const opener = H.root(sheet)?.querySelector('[data-action="openSkillAudit"]');
    opener?.click();
    // The window is found by the id its party gives it.
    const fid = Object.values(H.model.getFormations()).find((f) => f.actorId === partyId)?.id;
    const wantId = H.audit.auditWindowId(fid);
    const app = await H.poll(() => foundry.applications.instances.get(wantId)?.rendered ? foundry.applications.instances.get(wantId) : null, { tries: 80, every: 200 });
    await H.sleep(500);
    if (!app) return { opener: !!opener, app: false, appId: null, wantId, row: false, button: null, open: [...foundry.applications.instances.values()].map((a) => `${a.constructor.name}#${a.id}:${a.rendered}`).slice(0, 12) };
    const row = H.root(app)?.querySelector(`[data-ability-name="${name}"]`);
    const button = row?.querySelector('[data-action="rollAbilityForParty"]');
    return { opener: !!opener, app: !!app, appId: app?.id ?? null, wantId, row: !!row, button: button ? { tag: button.tagName, aria: button.getAttribute("aria-label") ?? "", tip: button.dataset.tooltip ?? "", tabbable: button.tabIndex >= 0 && !button.disabled } : null };
  },
  pressRoll: async ({ name }) => {
    const H = globalThis.__aud;
    const app = [...foundry.applications.instances.values()].find((a) => a.constructor.name === "SkillAuditApp" && a.rendered);
    const button = H.root(app)?.querySelector(`[data-ability-name="${name}"] [data-action="rollAbilityForParty"]`);
    if (!button) return { pressed: false };
    const since = Date.now();
    button.click();
    await H.poll(() => H.cards.some((c) => c.at >= since), { tries: 40, every: 200 });
    await H.sleep(800);
    return { pressed: true, since };
  },
  closeAudit: async () => {
    for (const app of foundry.applications.instances.values()) if (app.constructor.name === "SkillAuditApp") await app.close({ animate: false });
    return true;
  },

  /** A roll card's parts, read off its HTML. */
  readCard: async ({ id }) => {
    const H = globalThis.__aud;
    const c = H.cards.find((x) => x.id === id);
    if (!c) return null;
    const box = document.createElement("div");
    box.innerHTML = c.html;
    const rows = [...box.querySelectorAll("table.acks-table tbody tr")].map((tr) => {
      const cells = [...tr.querySelectorAll("td")];
      return { text: tr.textContent.replace(/\s+/g, " ").trim(), totalTip: !!tr.querySelector("td[data-tooltip]"), targetTip: tr.querySelector("td[data-tooltip-text]")?.dataset.tooltipText ?? null, cells: cells.length };
    });
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    return {
      title: box.querySelector(".acks-chat-title")?.textContent.trim() ?? null,
      subtitle: box.querySelector(".acks-chat-subtitle")?.textContent.trim() ?? null,
      rows,
      footnote: box.querySelector(".acks-extras-roll-footnote")?.textContent.trim() ?? "",
      notes: [...box.querySelectorAll(".acks-extras-roll-note")].map((n) => n.textContent.trim()),
      whisperedToJudges: c.whisper.length > 0 && c.whisper.every((u) => gms.includes(u)),
      // A card posted to the Judges carries its dice rendered, not as rolls.
      rolls: c.rolls + box.querySelectorAll(".dice-roll").length,
    };
  },
  cardsSince: async ({ since, names }) => (globalThis.__aud.cards ?? []).filter((c) => c.at >= since && names.some((n) => c.alias === n || c.html.includes(n))).map((c) => ({ id: c.id, uuid: c.uuid, at: c.at, text: c.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") })),
  // Every client holds every message; a whisper is one this seat cannot see.
  seesMessage: async ({ id }) => !!game.messages.get(id)?.visible,
  /** The popout chat log, placed on screen, with the card scrolled into view; returns the clip selector (the driver's chat-card recipe). */
  chatPopout: async ({ messageId }) => {
    const H = globalThis.__aud;
    await ui.hotbar.render(true);
    const pop = await ui.chat.renderPopout();
    await H.sleep(1500);
    pop.setPosition({ left: 16, top: 16, width: 420, height: 860 });
    await H.sleep(600);
    // The whole card, flavour and dice; the header's whisper line names the world's users and is hidden, with the timestamp.
    const sel = `#${pop.id} li.chat-message[data-message-id="${messageId}"]`;
    for (const n of document.querySelectorAll(`${sel} .whisper-to, ${sel} .message-metadata`)) n.style.setProperty("display", "none");
    document.querySelector(sel)?.scrollIntoView({ block: "nearest" });
    await H.sleep(600);
    return { sel, found: !!document.querySelector(sel) };
  },
  strings: async ({ keys }) => Object.fromEntries(keys.map((k) => [k, game.i18n.localize(k).split("{")[0].trim()])),

  /** The combat section's start shape: no fight in the record, nobody deployed, the party token shown. */
  combatStart: async ({ fid, sceneId }) => {
    const H = globalThis.__aud;
    await H.model.patchFormation(fid, (r) => {
      r.combat = null;
      for (const m of r.members) { delete m.deployedTokenId; delete m.deployedSceneId; delete m.deployedStack; }
    });
    const f = H.model.getFormation(fid);
    const token = H.model.getPartyToken(f);
    if (token?.hidden) await token.update({ hidden: false });
    await H.sleep(500);
    return { combats: game.combats.size, onScene: game.combats.filter((c) => c.scene?.id === sceneId).length, combat: f.combat ?? null, deployed: f.members.some((m) => m.deployedTokenId), visible: !H.model.getPartyToken(f)?.hidden };
  },

  /** Press the combat toggle on the party token's HUD, and say which combats are new. */
  hudCombat: async ({ tokenId, combatId }) => {
    const H = globalThis.__aud;
    const before = new Set(game.combats.map((c) => c.id));
    // The toggle adds to the tracker's viewed combat, which can be another session's; this seat views the run's own.
    const own = game.combats.get(combatId);
    if (!own) return { toggle: false, made: [], viewed: false };
    ui.combat.viewed = own;
    if (game.combats.viewed?.id !== own.id) return { toggle: false, made: [], viewed: false };
    try { ui.controls.activate({ control: "tokens", tool: "select" }); } catch (_e) { /* active */ }
    const placeable = canvas.tokens.get(tokenId);
    placeable.control({ releaseOthers: true });
    await H.sleep(300);
    await canvas.hud.token.bind(placeable);
    await H.sleep(400);
    const toggle = document.querySelector('#token-hud [data-action="combat"]');
    toggle?.click();
    await H.sleep(4000);
    try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
    const made = game.combats.filter((c) => !before.has(c.id)).map((c) => c.uuid);
    return { toggle: !!toggle, made, viewed: true };
  },

  combatRead: async ({ fid, sceneId, combatId }) => {
    const H = globalThis.__aud;
    const f = H.model.getFormation(fid);
    const scene = game.scenes.get(sceneId);
    const combat = combatId ? game.combats.get(combatId) : null;
    const memberTokens = f.members.map((m) => (m.deployedTokenId ? scene.tokens.get(m.deployedTokenId) : null));
    return {
      active: !!f.combat?.active,
      combatId: f.combat?.combatId ?? null,
      partyVisible: !H.model.getPartyToken(f)?.hidden,
      deployed: f.members.map((m) => m.deployedTokenId ?? null),
      tokensStand: memberTokens.map((t) => !!t),
      tokenActors: memberTokens.map((t) => t?.actorId ?? null),
      memberIds: f.members.map((m) => m.actorId),
      combat: combat ? { exists: true, combatants: combat.combatants.map((c) => ({ tokenId: c.tokenId, actorId: c.actorId })) } : { exists: !!(combatId && game.combats.get(combatId)) },
      clock: JSON.stringify(f.clock),
    };
  },

  addCombatant: async ({ combatId, tokenId, sceneId }) => {
    const H = globalThis.__aud;
    const combat = game.combats.get(combatId);
    const t = game.scenes.get(sceneId).tokens.get(tokenId);
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId, actorId: t.actorId }]);
    await H.sleep(3500);
    return { combatants: combat.combatants.map((c) => c.tokenId) };
  },
  /**
   * Combatants standing for tokens on the run's own fixture scene inside a
   * combat on no scene of the run's: an earlier run's leavings, left there when
   * the toggle added to another session's viewed encounter. Listed by id, and
   * removed only when `remove` is set; the combats themselves are not touched.
   */
  leavings: async ({ sceneId, remove }) => {
    const out = [];
    for (const c of game.combats) {
      if (c.scene?.id === sceneId) continue;
      const ours = c.combatants.filter((x) => x.sceneId === sceneId);
      if (ours.length) out.push({ combat: c.id, combatants: ours.map((x) => x.id) });
      if (remove && ours.length) await c.deleteEmbeddedDocuments("Combatant", ours.map((x) => x.id));
    }
    return out;
  },
  newCombat: async ({ sceneId }) => {
    const c = await Combat.create({ scene: sceneId, active: false });
    await globalThis.__aud.sleep(500);
    return { id: c.id, uuid: c.uuid };
  },
  endCombat: async ({ combatId }) => {
    const c = game.combats.get(combatId);
    if (c) await c.delete();
    await globalThis.__aud.sleep(3500);
    return { gone: !game.combats.get(combatId) };
  },

  pasteCopy: async ({ tokenId, sceneId, dx }) => {
    const scene = game.scenes.get(sceneId);
    const t = scene.tokens.get(tokenId);
    const [copy] = await scene.createEmbeddedDocuments("Token", [{ ...t.toObject(), _id: undefined, x: t.x + dx }]);
    await globalThis.__aud.sleep(1500);
    return { id: copy?.id ?? null, uuid: copy?.uuid ?? null };
  },
  moveToken: async ({ tokenId, sceneId, dx }) => {
    const t = game.scenes.get(sceneId).tokens.get(tokenId);
    await t.move({ x: t.x + dx, y: t.y });
    await globalThis.__aud.sleep(2500);
    return { x: t.x };
  },
  /** The create a sidebar drop of the party actor ends in. */
  placeAgain: async ({ partyId, sceneId, x, y }) => {
    const H = globalThis.__aud;
    const scene = game.scenes.get(sceneId);
    const before = scene.tokens.filter((t) => t.actorId === partyId).length;
    const doc = await game.actors.get(partyId).getTokenDocument({ x, y });
    let made = null;
    try { [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]); } catch (_e) { /* refused */ }
    await H.sleep(1200);
    return { before, after: scene.tokens.filter((t) => t.actorId === partyId).length, made: made?.uuid ?? null };
  },
  staleMarker: async ({ fid, actorId, sceneId }) => {
    const H = globalThis.__aud;
    await H.model.patchFormation(fid, (r) => {
      const m = r.members.find((x) => x.actorId === actorId);
      m.deployedTokenId = "gone";
      m.deployedSceneId = sceneId;
    });
    return true;
  },
  takeNotes: async () => globalThis.__aud.notes.splice(0),

  /* ---- "The audit roll" step 7: the window ---- */

  /** Press the Order tab's Skill audit on a party's sheet, leaving any audit already open. */
  pressAudit: async ({ partyId, fid }) => {
    const H = globalThis.__aud;
    const sheet = game.actors.get(partyId).sheet;
    await sheet.render(true);
    await H.sleep(900);
    H.root(sheet)?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(300);
    const before = foundry.applications.instances.get(H.audit.auditWindowId(fid)) ?? null;
    H.root(sheet)?.querySelector('[data-action="openSkillAudit"]')?.click();
    const app = await H.poll(() => { const a = foundry.applications.instances.get(H.audit.auditWindowId(fid)); return a?.rendered ? a : null; }, { tries: 200, every: 200 });
    await H.sleep(400);
    await sheet.close({ animate: false });
    return { id: app?.id ?? null, same: !!before && before === app, audits: [...foundry.applications.instances.values()].filter((a) => a.constructor.name === "SkillAuditApp").map((a) => a.id) };
  },
  /** One open audit's rows, read off its DOM. */
  auditRows: async ({ fid }) => {
    const H = globalThis.__aud;
    const app = foundry.applications.instances.get(H.audit.auditWindowId(fid));
    const root = H.root(app);
    if (!root) return null;
    return {
      abilities: [...root.querySelectorAll("[data-ability-name]")].map((r) => r.dataset.abilityName),
      members: [...root.querySelectorAll(".audit-resolution tbody tr")].map((r) => r.querySelector("td")?.textContent.replace(/\s+/g, " ").trim()),
    };
  },
  /** Press a row's roll button in a given party's audit. */
  pressRollIn: async ({ fid, name }) => {
    const H = globalThis.__aud;
    const root = H.root(foundry.applications.instances.get(H.audit.auditWindowId(fid)));
    const button = root?.querySelector(`[data-ability-name="${name}"] [data-action="rollAbilityForParty"]`);
    if (!button) return { pressed: false };
    const since = Date.now();
    button.click();
    await H.poll(() => H.cards.some((c) => c.at >= since), { tries: 40, every: 200 });
    await H.sleep(800);
    return { pressed: true, since };
  },
  /* Each write below waits for the audit's redraw (or for none, `drew: false`) before it returns. */
  itemCreate: async ({ actorId, data }) => {
    const H = globalThis.__aud;
    const n0 = H.renders;
    const since = Date.now();
    const [item] = await game.actors.get(actorId).createEmbeddedDocuments("Item", [data]);
    const drew = await H.settle(n0);
    return { id: item.id, uuid: item.uuid, drew, drawn: H.renderLog.filter((r) => r.at >= since).map((r) => (r.id === H.watchId ? "watched" : "other")), watching: !!H.watchId };
  },
  itemRename: async ({ uuid, name }) => {
    const H = globalThis.__aud;
    const n0 = H.renders;
    await fromUuidSync(uuid).update({ name });
    return { drew: await H.settle(n0) };
  },
  itemDelete: async ({ uuid }) => {
    const H = globalThis.__aud;
    const n0 = H.renders;
    await fromUuidSync(uuid)?.delete();
    return { drew: await H.settle(n0) };
  },
  dropMember: async ({ fid, actorId }) => {
    const H = globalThis.__aud;
    const n0 = H.renders;
    await H.model.removeMember(H.model.getFormation(fid), actorId);
    return { members: H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId), drew: await H.settle(n0) };
  },
  renderCount: async () => globalThis.__aud.renders,
  /** Wait until the watched audit has drawn nothing for `ms`: a write's last redraw can trail its first. */
  quiet: async ({ ms }) => { const H = globalThis.__aud; return !!(await H.poll(() => Date.now() - H.lastRender > ms, { tries: 150, every: 200 })); },
  watchAudit: async ({ fid }) => { const H = globalThis.__aud; H.watchId = fid ? H.audit.auditWindowId(fid) : null; return H.watchId; },
  settleAfter: async ({ n0 }) => globalThis.__aud.settle(n0),
  /** Scroll the body down, press a ruling with a real click on a focused button, and read scroll and focus back. */
  scrollFocus: async ({ fid, name }) => {
    const H = globalThis.__aud;
    const app = foundry.applications.instances.get(H.audit.auditWindowId(fid));
    app.setPosition({ height: 320 });
    await H.sleep(400);
    const root = H.root(app);
    const body = root.querySelector(".acks-formation-body");
    const scrolls = body.scrollHeight > body.clientHeight;
    body.scrollTop = Math.min(80, body.scrollHeight - body.clientHeight);
    const top0 = body.scrollTop;
    const press = async () => {
      const button = H.root(app).querySelector(`[data-ability-name="${name}"] [data-action="toggleAbility"]`);
      const n0 = H.renders;
      button.focus();
      button.click();
      return { drew: await H.settle(n0, 600), replaced: !button.isConnected };
    };
    const first = await press();
    const body1 = H.root(app).querySelector(".acks-formation-body");
    const active = document.activeElement;
    const out = {
      scrolls, top0, top1: body1.scrollTop, sameBody: body1 === body, drew: first.drew, replaced: first.replaced,
      focus: { action: active?.dataset?.action ?? null, row: active?.closest?.("[data-ability-name]")?.dataset.abilityName ?? null, inWindow: root.contains(active) },
    };
    // Two more presses bring the ruling round to automatic.
    await press();
    await press();
    return out;
  },
  /** Change one Used-for select and read focus back; then put the value back. */
  selectFocus: async ({ fid, itemUuid }) => {
    const H = globalThis.__aud;
    const app = foundry.applications.instances.get(H.audit.auditWindowId(fid));
    const pick = () => [...H.root(app).querySelectorAll('select[data-field="checkKey"]')].find((s) => s.dataset.itemUuid === itemUuid);
    itemUuid ??= H.root(app).querySelector('select[data-field="checkKey"]')?.dataset.itemUuid ?? null;
    const select = pick();
    if (!select) return { found: false };
    const was = select.value;
    // A binding also turns the item's Skill flag on; the step puts both back.
    const item = fromUuidSync(itemUuid);
    const wasSkill = item.getFlag("acks-extras", "isSkill");
    const other = [...select.options].map((o) => o.value).find((v) => v && v !== was);
    let n0 = H.renders;
    select.focus();
    select.value = other;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const drew = await H.settle(n0, 600);
    const focused = document.activeElement === pick() && !select.isConnected;
    const back = pick();
    n0 = H.renders;
    back.focus();
    back.value = was;
    back.dispatchEvent(new Event("change", { bubbles: true }));
    await H.settle(n0, 600);
    if (wasSkill === undefined) await item.unsetFlag("acks-extras", "isSkill");
    else await item.setFlag("acks-extras", "isSkill", wasSkill);
    return { found: true, drew, focused, restored: pick()?.value === was, changedTo: !!other };
  },
  /** Narrow the window and read the resolution table's sideways scroll. */
  columns: async ({ fid }) => {
    const H = globalThis.__aud;
    const app = foundry.applications.instances.get(H.audit.auditWindowId(fid));
    app.setPosition({ width: 340, height: 520 });
    await H.sleep(500);
    const box = H.root(app).querySelector(".audit-resolution")?.closest(".audit-scroll");
    if (!box) return { box: false };
    const wide = box.scrollWidth > box.clientWidth;
    box.scrollLeft = box.scrollWidth;
    await H.sleep(200);
    const last = [...box.querySelectorAll("thead th")].at(-1).getBoundingClientRect();
    const rect = box.getBoundingClientRect();
    return { box: true, wide, scrolled: box.scrollLeft > 0, lastInside: last.right <= rect.right + 1 && last.left >= rect.left - 1, overflowX: getComputedStyle(box).overflowX };
  },
  /** The type knob, read on a window opened fresh at each size. */
  knob: async ({ partyId, fid, px }) => {
    const H = globalThis.__aud;
    await game.settings.set("acks-extras", "fontScale", px);
    await H.sleep(400);
    const old = foundry.applications.instances.get(H.audit.auditWindowId(fid));
    if (old) await old.close({ animate: false });
    const app = new H.audit.default({ formationId: fid });
    await app.render(true);
    await H.poll(() => app.rendered, { tries: 40, every: 150 });
    await H.sleep(500);
    const select = H.root(app).querySelector(".audit-table select");
    const cs = select ? getComputedStyle(select) : null;
    const out = { width: app.position.width, font: cs ? parseFloat(cs.fontSize) : null, height: select ? select.getBoundingClientRect().height : null };
    await app.close({ animate: false });
    void partyId;
    return out;
  },
  getKnob: async () => game.settings.get("acks-extras", "fontScale"),

  /* ---- "The audit roll" step 7, names and sources ---- */

  /** A world item carrying `data`, made where none carries the name; the uuid it has. */
  worldItem: async ({ name, data }) => {
    let item = game.items.find((i) => i.name === name && !i.parent);
    let made = false;
    if (!item) { item = await Item.create(data); made = true; }
    return { uuid: item.uuid, made };
  },
  /** An item on an actor carrying `data` whole (flags and target), replaced where one of the name differs. */
  freshItem: async ({ actorId, data }) => {
    const actor = game.actors.get(actorId);
    const old = actor.items.filter((i) => i.name === data.name).map((i) => i.id);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    return { uuid: item.uuid, id: item.id };
  },
  setOwner: async ({ actorId, userName, level }) => {
    const user = game.users.getName(userName);
    await game.actors.get(actorId).update({ [`ownership.${user.id}`]: level });
    return game.actors.get(actorId).ownership[user.id];
  },
  /** The resolution the audit would show for one member's check, read from the module, for comparison. */
  resolved: async ({ actorId, checkKey }) => {
    const rolls = await import("/modules/acks-extras/scripts/formation/party-rolls.mjs");
    const check = rolls.resolveCheck(game.actors.get(actorId), rolls.PARTY_CHECKS[checkKey]);
    return check ? { target: check.target, source: check.source, parts: check.parts, tip: rolls.checkTip(check) } : null;
  },
  /** Names, figures and sources in one open audit, read off its DOM, with one tooltip activated through core. */
  auditSources: async ({ fid, actorName, itemNames, ladderName, checkColumn }) => {
    const H = globalThis.__aud;
    const app = foundry.applications.instances.get(H.audit.auditWindowId(fid));
    const root = H.root(app);
    if (!root) return null;
    const checkHeads = [...root.querySelectorAll(".audit-resolution thead th")].map((th) => th.textContent.trim());
    const col = checkHeads.indexOf(checkColumn);
    const memberRow = [...root.querySelectorAll(".audit-resolution tbody tr")].find((tr) => tr.querySelector("td")?.textContent.includes(actorName));
    const cell = col > 0 ? memberRow?.querySelectorAll("td")[col] : null;
    let shown = null;
    if (cell) {
      game.tooltip.activate(cell);
      await H.sleep(300);
      shown = document.getElementById("tooltip")?.textContent.trim() ?? null;
      game.tooltip.deactivate();
    }
    const heading = [...root.querySelectorAll("h4")].find((h) => h.textContent.trim() === actorName);
    const table = heading?.nextElementSibling?.querySelector("table") ?? null;
    const items = Object.fromEntries(itemNames.map((n) => {
      const tr = [...(table?.querySelectorAll("tbody tr") ?? [])].find((r) => r.querySelector("td")?.textContent.trim() === n);
      const cells = tr ? [...tr.querySelectorAll("td")] : [];
      const select = tr?.querySelector("select");
      return [n, tr ? { target: cells[1]?.textContent.trim(), targetTip: cells[1]?.dataset.tooltipText ?? null, aria: select?.getAttribute("aria-label") ?? null, options: select ? [...select.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null, keptData: !!(select?.dataset.itemUuid && select?.dataset.field) } : null];
    }));
    const ladder = [...root.querySelectorAll(".audit-table tr")].find((tr) => tr.querySelector("td")?.textContent.trim() === ladderName);
    return {
      cell: cell ? { label: cell.querySelector("strong")?.textContent.trim(), tipAttr: cell.dataset.tooltipText ?? null, shown } : null,
      level: memberRow?.querySelector(".lvl")?.textContent.trim() ?? null,
      items,
      ladder: ladder ? { tip: ladder.dataset.tooltipText ?? null, values: ladder.querySelectorAll("td")[1]?.textContent.trim() } : null,
      titles: root.querySelectorAll("[title]").length,
    };
  },
  /** The check names each Used-for option should read, in order. */
  usedForLabels: async () => {
    const rolls = await import("/modules/acks-extras/scripts/formation/party-rolls.mjs");
    return rolls.usedForOptions();
  },
  /** An ability item's sheet opened on this seat, its Skill tab shown, and what it carries. */
  skillTab: async ({ uuid }) => {
    const H = globalThis.__aud;
    const item = await fromUuid(uuid);
    const sheet = item.sheet;
    await sheet.render(true);
    await H.sleep(1200);
    let root = H.root(sheet);
    root?.querySelector('.acks-formation-skill-anchor')?.click();
    await H.sleep(600);
    root = H.root(sheet);
    const tab = root?.querySelector(".acks-formation-skill-tab");
    const select = tab?.querySelector('select[data-field="checkKey"]');
    const input = tab?.querySelector('input[data-field="targetMod"]');
    const li = tab?.querySelector(".acks-formation-resolution li[data-tooltip-text]");
    let shown = null;
    if (li) {
      game.tooltip.activate(li);
      await H.sleep(300);
      shown = document.getElementById("tooltip")?.textContent.trim() ?? null;
      game.tooltip.deactivate();
    }
    const out = {
      tab: !!tab, active: !!tab?.classList.contains("active"),
      aria: select?.getAttribute("aria-label") ?? null, disabled: !!select?.disabled,
      selected: select?.value ?? null,
      options: select ? [...select.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null,
      inputAria: input?.getAttribute("aria-label") ?? null, inputTip: input?.dataset.tooltip ?? null,
      liTip: li?.dataset.tooltipText ?? null, shown,
      titles: tab ? tab.querySelectorAll("[title]").length : null,
    };
    await sheet.close({ animate: false });
    return out;
  },
  fmt: async ({ key, data }) => game.i18n.format(key, data ?? {}),

  boot: async () => globalThis.__audBoot ?? null,
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

const ready = async (api, label) => {
  for (let n = 0; n < 240; n++) {
    const ok = await api.eval(`!!(globalThis.game?.ready && globalThis.acksExtras?.formation)`).catch(() => false);
    if (ok) return n / 2;
    await sleep(500);
  }
  throw new Error(`${label} never reached ready`);
};

async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 500000;
    const on = (event) => { const reply = JSON.parse(event.data); if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  ws.close();
  return seconds;
}

const open = {};
const tracked = [];
let plateCard = null;
const character = (name, extra = {}) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 } }, ...extra });
const ABILITY = "Audit Search";
const abilityData = { name: ABILITY, type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 13 } };
const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);
/** Sweep some of the run's own documents now, and drop them from the teardown's list. */
const sweepNow = async (api, uuids) => {
  const out = await api.sweepTracked({ only: unique(uuids) });
  for (const u of uuids) for (let i = tracked.indexOf(u); i !== -1; i = tracked.indexOf(u)) tracked.splice(i, 1);
  return out;
};
/** Run a section; a throw inside one is a FAIL of that section, and the next still runs. */
const guarded = async (title, body) => {
  section(title);
  try { await body(); } catch (err) {
    check(`${title}: ran to its end`, false, String(err?.message ?? err));
    console.error(err?.stack ?? err);
  }
};

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  note("installed", [await run(gm, P.install, { nonce: NONCE }), await run(player, P.install, { nonce: NONCE })]);
  const census = { gm: await run(gm, P.census), player: await run(player, P.census) };
  note("active", census.gm.active);
  check("the GM seat is the active GM, and the player seat is a player", census.gm.activeGMIsSelf && census.player.role <= 2, { gm: census.gm.role, player: census.player.role });
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  for (const [k, c] of Object.entries(census)) check(`${k} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot?.errors);

  await guarded("the audit roll", async () => {
    const party = await gm.fixture("formation/audit-party", "Actor", { name: "QA Audit Party", type: `${SCOPE}.party` });
    const members = [];
    for (const n of [1, 2, 3]) members.push(await gm.fixture(`formation/audit-member-${n}`, "Actor", character(`QA Auditor ${n}`, n < 3 ? { items: [abilityData] } : {})));
    const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
    if (error) throw new Error(error);
    const seated = await run(gm, P.seat, { partyId: party.id, fid, actorIds: members.map((m) => m.id) });
    check("the audit party holds its three members", seated.members.length === 3, seated);
    for (const m of members.slice(0, 2)) await run(gm, P.ensureItem, { actorId: m.id, name: ABILITY, data: abilityData });
    await run(gm, P.dropItem, { actorId: members[2].id, name: ABILITY });
    for (const m of members) await run(gm, P.setHp, { actorId: m.id, value: 8 });

    // 1.
    const opened = await run(gm, P.openAudit, { partyId: party.id, name: ABILITY });
    note("audit", opened);
    check("1: the Order tab opens the Skill audit, and the ability's row has a roll button", opened.opener && opened.app && opened.row && opened.button?.tag === "BUTTON", opened);
    check("1: the audit's window id is its party's", !!opened.appId && opened.appId === opened.wantId && !opened.appId.endsWith("undefined"), { appId: opened.appId, wantId: opened.wantId });
    check("1: the button is named for the ability, carries a tooltip, and Tab reaches it", !!opened.button && opened.button.aria.includes(ABILITY) && !!opened.button.tip && opened.button.tabbable, opened.button);

    // 2 and 6.
    const clock0 = await run(gm, P.clock, { fid });
    const pr = await run(gm, P.pressRoll, { name: ABILITY });
    const clock1 = await run(gm, P.clock, { fid });
    const names = ["QA Audit Party", ABILITY];
    const posted = await run(gm, P.cardsSince, { since: pr.since, names });
    for (const c of posted) tracked.push(gm.track(c.uuid, "ChatMessage"));
    check("2: the press posts exactly one card", pr.pressed && posted.length === 1, posted.length);
    const card = posted[0] ? await run(gm, P.readCard, { id: posted[0].id }) : null;
    note("card shape", card && { title: card.title === ABILITY, subtitle: card.subtitle === "QA Audit Party", rows: card.rows.length });
    check("2: whispered to the Judges, titled the ability, subtitled the party", !!card && card.whisperedToJudges && card.title === ABILITY && card.subtitle === "QA Audit Party", card && { whisper: card.whisperedToJudges, title: card.title, subtitle: card.subtitle });
    const verdicts = await run(gm, P.strings, { keys: ["ACKS-FORMATION.rolls.success", "ACKS-FORMATION.rolls.failure", "ACKS-FORMATION.audit.rollLacking"] });
    check("2: two rows, one per holder, each with a total, a target and a verdict", !!card && card.rows.length === 2 && card.rows.every((r) => r.targetTip && r.totalTip && (r.text.includes(verdicts["ACKS-FORMATION.rolls.success"]) || r.text.includes(verdicts["ACKS-FORMATION.rolls.failure"]))) && card.rows[0].text.includes("QA Auditor 1") && card.rows[1].text.includes("QA Auditor 2"), card?.rows);
    check("2: the member without the ability is named in the footnote", !!card && card.footnote.includes("QA Auditor 3") && card.footnote.includes(verdicts["ACKS-FORMATION.audit.rollLacking"]), card?.footnote);
    check("2: the target's tooltip names the throw and its base", !!card && card.rows.every((r) => r.targetTip.includes(ABILITY)), card?.rows.map((r) => r.targetTip));
    check("2: the Player seat does not receive the card", !!posted[0] && !(await run(player, P.seesMessage, { id: posted[0].id })));
    check("6: the roll advanced nothing: the party's clock is identical", clock0 === clock1);
    // The plate is shot at the walk's end: compose closes core's HUD container, which the combat section presses.
    plateCard = posted[0]?.id ?? null;

    // 4.
    await run(gm, P.setHp, { actorId: members[1].id, value: 0 });
    const pr4 = await run(gm, P.pressRoll, { name: ABILITY });
    const c4 = await run(gm, P.cardsSince, { since: pr4.since, names });
    for (const c of c4) tracked.push(gm.track(c.uuid, "ChatMessage"));
    const card4 = c4[0] ? await run(gm, P.readCard, { id: c4[0].id }) : null;
    const downText = (await run(gm, P.strings, { keys: ["ACKS-FORMATION.audit.rollDown"] }))["ACKS-FORMATION.audit.rollDown"];
    check("4: a member at 0 hit points has no row and is named in the footnote as down", !!card4 && card4.rows.length === 1 && !card4.rows[0].text.includes("QA Auditor 2") && card4.footnote.includes(downText) && card4.footnote.includes("QA Auditor 2"), card4 && { rows: card4.rows.length, footnote: card4.footnote });
    await run(gm, P.setHp, { actorId: members[1].id, value: 8 });

    // 5: the window stays open on the old roster while the items go.
    for (const m of members.slice(0, 2)) await run(gm, P.dropItem, { actorId: m.id, name: ABILITY });
    const pr5 = await run(gm, P.pressRoll, { name: ABILITY });
    const c5 = await run(gm, P.cardsSince, { since: pr5.since, names });
    for (const c of c5) tracked.push(gm.track(c.uuid, "ChatMessage"));
    const card5 = c5[0] ? await run(gm, P.readCard, { id: c5[0].id }) : null;
    const nobody = await gm.eval(`game.i18n.format("ACKS-FORMATION.audit.rollNobody", { name: ${JSON.stringify(ABILITY)} })`);
    check("5: with nobody holding it, one card says nobody rolled, names all three, and shows no dice", pr5.pressed && c5.length === 1 && !!card5 && card5.rows.length === 0 && card5.notes.includes(nobody) && [1, 2, 3].every((n) => card5.footnote.includes(`QA Auditor ${n}`)) && card5.rolls === 0, card5 && { rows: card5.rows.length, rolls: card5.rolls, pressed: pr5.pressed });
    for (const m of members.slice(0, 2)) await run(gm, P.ensureItem, { actorId: m.id, name: ABILITY, data: abilityData });
    await run(gm, P.closeAudit);
  });

  /* ---------------- a party in a combat ---------------- */
  await guarded("a party in a combat", async () => {
    const scene = await gm.fixture("formation/combat-scene", "Scene", { name: "QA Combat Ground", active: false, navigation: false, width: 1600, height: 1000, padding: 0, grid: { type: 1, size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
    const party = await gm.fixture("formation/combat-party", "Actor", { name: "QA Combat Party", type: `${SCOPE}.party` });
    const members = [];
    for (const n of [1, 2, 3]) members.push(await gm.fixture(`formation/combat-member-${n}`, "Actor", character(`QA Fighter ${n}`)));
    check("the GM seat views the combat scene", (await run(gm, P.view, { sceneId: scene.id })).scene);
    const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
    if (error) throw new Error(error);
    await run(gm, P.seat, { partyId: party.id, fid, actorIds: members.map((m) => m.id) });
    const pt = await run(gm, P.partyToken, { fid, partyId: party.id, sceneId: scene.id, x: 500, y: 400 });
    if (pt.made) await gm.mark(pt.made, "formation/combat-party-token");
    note("leavings: this scene's combatants in other encounters, removed", await run(gm, P.leavings, { sceneId: scene.id, remove: true }));
    const start = await run(gm, P.combatStart, { fid, sceneId: scene.id });
    note("start", start);
    check("start: no fight in the record, nobody deployed, the party token shown, no combat on the scene", !start.combat && !start.deployed && start.visible && start.onScene === 0, start);
    const words = await run(gm, P.strings, { keys: ["ACKS-FORMATION.chat.combatDeployed", "ACKS-FORMATION.chat.combatReformed", "ACKS-FORMATION.chat.combatTwinToken", "ACKS-FORMATION.chat.combatAlreadyFighting", "ACKS-FORMATION.warn.duplicatePartyToken"] });
    const W = { deployed: words["ACKS-FORMATION.chat.combatDeployed"], reformed: words["ACKS-FORMATION.chat.combatReformed"], twin: words["ACKS-FORMATION.chat.combatTwinToken"], already: words["ACKS-FORMATION.chat.combatAlreadyFighting"], dup: words["ACKS-FORMATION.warn.duplicatePartyToken"] };
    const names = ["QA Combat Party"];
    const memberIds = members.map((m) => m.id);
    // Each part of the deployed shape, so a FAIL names the one that broke.
    const deployedParts = (r) => ({ active: r.active, hidden: !r.partyVisible, stand: r.tokensStand.every(Boolean), asMembers: r.tokenActors.every((a, i) => a === r.memberIds[i]), three: r.combat.combatants?.length === 3, noParty: !(r.combat.combatants ?? []).some((c) => c.tokenId === pt.tokenId), membersOnly: (r.combat.combatants ?? []).every((c) => memberIds.includes(c.actorId)), recordCombat: r.combatId === null ? null : r.combatId });
    const deployedOk = (r) => r.active && !r.partyVisible && r.tokensStand.every(Boolean) && r.tokenActors.every((a, i) => a === r.memberIds[i]) && r.combat.combatants?.length === 3 && !r.combat.combatants.some((c) => c.tokenId === pt.tokenId) && r.combat.combatants.every((c) => memberIds.includes(c.actorId));

    // 1.
    // The encounter is the run's own, made as the tracker's Create Encounter makes one, and viewed on this seat.
    const first = await run(gm, P.newCombat, { sceneId: scene.id });
    tracked.push(gm.track(first.uuid, "Combat"));
    const combatId = first.id;
    let since = Date.now() - 2000;
    let hud = await run(gm, P.hudCombat, { tokenId: pt.tokenId, combatId });
    for (const u of hud.made) tracked.push(gm.track(u, "Combat"));
    let r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId });
    let cards = await run(gm, P.cardsSince, { since, names });
    for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
    check("1: the HUD's combat toggle deploys one combatant per body, each a member's token, none for the party token, which hides", hud.toggle && hud.viewed && hud.made.length === 0 && deployedOk(r), { toggle: hud.toggle, viewed: hud.viewed, made: hud.made.length, ...deployedParts(r) });
    check("1: one card, the formation breaks for battle", cards.filter((c) => c.text.includes(W.deployed)).length === 1, cards.length);

    // 2.
    since = Date.now();
    hud = await run(gm, P.hudCombat, { tokenId: pt.tokenId, combatId });
    for (const u of hud.made) tracked.push(gm.track(u, "Combat"));
    r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId });
    cards = await run(gm, P.cardsSince, { since, names });
    for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
    check("2: the toggle on the hidden party token gathers: token shown, no member token, no fight, the combat empty but standing", !r.active && r.partyVisible && r.deployed.every((d) => !d) && r.combat.exists && r.combat.combatants?.length === 0 && hud.made.length === 0, { active: r.active, visible: r.partyVisible, exists: r.combat.exists, combatants: r.combat.combatants?.length });
    check("2: the card says combat is over, and no Already fighting card", cards.some((c) => c.text.includes(W.reformed)) && !cards.some((c) => c.text.includes(W.already)), cards.length);
    hud = await run(gm, P.hudCombat, { tokenId: pt.tokenId, combatId });
    for (const u of hud.made) tracked.push(gm.track(u, "Combat"));
    r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId });
    check("2: pressed once more, the party deploys afresh", deployedOk(r), deployedParts(r));

    // 4, while fighting.
    const second = await run(gm, P.newCombat, { sceneId: scene.id });
    tracked.push(gm.track(second.uuid, "Combat"));
    since = Date.now();
    await run(gm, P.addCombatant, { combatId: second.id, tokenId: pt.tokenId, sceneId: scene.id });
    const r2 = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: second.id });
    r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId });
    cards = await run(gm, P.cardsSince, { since, names });
    for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
    check("4: a second combat takes the party token back out, the first keeps the bodies, and the card names the first encounter", r2.combat.combatants?.length === 0 && r.combat.combatants?.length === 3 && cards.some((c) => c.text.includes(W.already)), { second: r2.combat.combatants?.length, first: r.combat.combatants?.length });
    await run(gm, P.endCombat, { combatId: second.id });

    // 3.
    since = Date.now();
    const ended = await run(gm, P.endCombat, { combatId });
    r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId });
    cards = await run(gm, P.cardsSince, { since, names });
    for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
    check("3: ending the encounter gathers the party and the combat is gone", ended.gone && !r.active && r.partyVisible && r.deployed.every((d) => !d), { gone: ended.gone, active: r.active, visible: r.partyVisible });

    // 5.
    const copy = await run(gm, P.pasteCopy, { tokenId: pt.tokenId, sceneId: scene.id, dx: 500 });
    if (copy.uuid) tracked.push(gm.track(copy.uuid, "Token"));
    const third = await run(gm, P.newCombat, { sceneId: scene.id });
    tracked.push(gm.track(third.uuid, "Combat"));
    const rec5 = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: third.id });
    since = Date.now();
    await run(gm, P.addCombatant, { combatId: third.id, tokenId: copy.id, sceneId: scene.id });
    r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: third.id });
    cards = await run(gm, P.cardsSince, { since, names });
    for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
    check("5: a pasted copy added to a combat deploys nobody, keeps its combatant, and says it is not the party's own token", !r.active && r.partyVisible && r.deployed.every((d) => !d) && r.combat.combatants?.length === 1 && r.combat.combatants[0].tokenId === copy.id && cards.some((c) => c.text.includes(W.twin)) && r.clock === rec5.clock, { active: r.active, combatants: r.combat.combatants?.length, card: cards.some((c) => c.text.includes(W.twin)) });
    await run(gm, P.moveToken, { tokenId: copy.id, sceneId: scene.id, dx: 100 });
    const afterCopy = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: null });
    check("5: moving the copy leaves the clock alone", afterCopy.clock === rec5.clock);
    await run(gm, P.endCombat, { combatId: third.id });
    await run(gm, P.moveToken, { tokenId: pt.tokenId, sceneId: scene.id, dx: 200 });
    const afterParty = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: null });
    check("5: moving the party token advances the clock", afterParty.clock !== rec5.clock);
    await run(gm, P.moveToken, { tokenId: pt.tokenId, sceneId: scene.id, dx: -200 });
    if (copy.uuid) note("copy swept", await sweepNow(gm, [copy.uuid]));

    // 6.
    await run(gm, P.takeNotes);
    const again = await run(gm, P.placeAgain, { partyId: party.id, sceneId: scene.id, x: 1200, y: 700 });
    if (again.made) tracked.push(gm.track(again.made, "Token"));
    const notes6 = await run(gm, P.takeNotes);
    const r6 = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: null });
    check("6: a second token of the party actor is refused with a warning, and the link is unchanged", again.after === again.before && !again.made && notes6.some((n) => n.startsWith(W.dup)) && (await gm.eval(`acksExtras.formation.getFormations()[${JSON.stringify(fid)}].tokenId`)) === pt.tokenId, { before: again.before, after: again.after, warned: notes6.some((n) => n.startsWith(W.dup)) });
    void r6;

    // 7.
    await run(gm, P.staleMarker, { fid, actorId: members[1].id, sceneId: scene.id });
    const own7 = await run(gm, P.newCombat, { sceneId: scene.id });
    tracked.push(gm.track(own7.uuid, "Combat"));
    hud = await run(gm, P.hudCombat, { tokenId: pt.tokenId, combatId: own7.id });
    for (const u of hud.made) tracked.push(gm.track(u, "Combat"));
    const c7 = own7.id;
    r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: c7 });
    check("7: with a stale deploy marker, the party deploys as in step 1 and that member stands under a token of their own", deployedOk(r) && r.deployed[1] !== "gone", { ...deployedParts(r), marker: r.deployed[1] === "gone" ? "gone" : "fresh" });
    if (c7) await run(gm, P.endCombat, { combatId: c7 });
    r = await run(gm, P.combatRead, { fid, sceneId: scene.id, combatId: null });
    check("teardown: the party is gathered", !r.active && r.partyVisible && r.deployed.every((d) => !d), { active: r.active, visible: r.partyVisible });
    const tail = await run(gm, P.cardsSince, { since: 0, names });
    for (const c of tail) tracked.push(gm.track(c.uuid, "ChatMessage"));
  });

  /* ---------------- the audit window ("The audit roll" step 7) ---------------- */
  await guarded("the audit window", async () => {
    const { gm } = open;
    const party = await gm.fixture("formation/audit-party", "Actor", { name: "QA Audit Party", type: `${SCOPE}.party` });
    const members = [];
    for (const n of [1, 2, 3]) members.push(await gm.fixture(`formation/audit-member-${n}`, "Actor", character(`QA Auditor ${n}`, n < 3 ? { items: [abilityData] } : {})));
    const other = await gm.fixture("formation/combat-party", "Actor", { name: "QA Combat Party", type: `${SCOPE}.party` });
    const outsider = await gm.fixture("formation/combat-member-1", "Actor", character("QA Fighter 1"));
    const { fid } = await run(gm, P.formationOf, { partyId: party.id });
    const { fid: otherFid } = await run(gm, P.formationOf, { partyId: other.id });
    await run(gm, P.seat, { partyId: party.id, fid, actorIds: members.map((m) => m.id) });
    for (const m of members.slice(0, 2)) await run(gm, P.ensureItem, { actorId: m.id, name: ABILITY, data: abilityData });
    for (const m of members) await run(gm, P.setHp, { actorId: m.id, value: 8 });
    await run(gm, P.closeAudit);
    const knob0 = await run(gm, P.getKnob);

    // Id: two parties' audits side by side, the first still live; a second press brings the open one forward.
    const a = await run(gm, P.pressAudit, { partyId: party.id, fid });
    const b = await run(gm, P.pressAudit, { partyId: other.id, fid: otherFid });
    check("7 id: two parties' audits stand open together, each under its party's id", !!a.id && !!b.id && a.id !== b.id && b.audits.includes(a.id) && b.audits.includes(b.id), { a: a.id, b: b.id, open: b.audits.length });
    const pr = await run(gm, P.pressRollIn, { fid, name: ABILITY });
    const posted = await run(gm, P.cardsSince, { since: pr.since, names: ["QA Audit Party", ABILITY] });
    for (const c of posted) tracked.push(gm.track(c.uuid, "ChatMessage"));
    check("7 id: the first audit's roll still posts its card once the second is open", pr.pressed && posted.length === 1, posted.length);
    const again = await run(gm, P.pressAudit, { partyId: party.id, fid });
    check("7 id: a second press for the same party brings the open window forward, no second one", again.same && again.audits.filter((id) => id === a.id).length === 1 && again.audits.length === b.audits.length, again);

    // Redraw: an ability item created, renamed and deleted on a member; one on an outsider; a member leaving and rejoining.
    const probe = { name: "QA Audit Probe", type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 11 } };
    await run(gm, P.watchAudit, { fid });
    const made = await run(gm, P.itemCreate, { actorId: members[0].id, data: probe });
    tracked.push(gm.track(made.uuid, "Item"));
    let rows = await run(gm, P.auditRows, { fid });
    const had3 = !!rows?.members.some((t) => t?.includes("QA Auditor 3"));
    check("7 redraw: an ability created on a member shows with no reopen", made.drew && rows?.abilities.includes("QA Audit Probe"), { drew: made.drew, rows: rows?.abilities });
    const renamed = await run(gm, P.itemRename, { uuid: made.uuid, name: "QA Audit Probe Renamed" });
    rows = await run(gm, P.auditRows, { fid });
    check("7 redraw: renaming it redraws the row", renamed.drew && rows?.abilities.includes("QA Audit Probe Renamed") && !rows.abilities.includes("QA Audit Probe"), { drew: renamed.drew, rows: rows?.abilities });
    const deleted = await run(gm, P.itemDelete, { uuid: made.uuid });
    rows = await run(gm, P.auditRows, { fid });
    check("7 redraw: deleting it takes the row away", deleted.drew && !!rows && !rows.abilities.some((n) => n.startsWith("QA Audit Probe")), { drew: deleted.drew, rows: rows?.abilities });
    await run(gm, P.quiet, { ms: 5000 });
    const foreign = await run(gm, P.itemCreate,{ actorId: outsider.id, data: { ...probe, name: "QA Outsider Probe" } });
    tracked.push(gm.track(foreign.uuid, "Item"));
    rows = await run(gm, P.auditRows, { fid });
    check("7 redraw: an ability on an actor outside the party draws nothing and adds no row", !foreign.drew && !!rows && !rows.abilities.includes("QA Outsider Probe"), { drew: foreign.drew, drawn: foreign.drawn, watching: foreign.watching, rows: rows?.abilities });
    note("outsider probe swept", await sweepNow(gm, [foreign.uuid]));
    const left = await run(gm, P.dropMember, { fid, actorId: members[2].id });
    rows = await run(gm, P.auditRows, { fid });
    check("7 redraw: a member leaving is gone from the open window", had3 && left.drew && !!rows && !rows.members.some((t) => t?.includes("QA Auditor 3")) && rows.members.some((t) => t?.includes("QA Auditor 1")), { had3, drew: left.drew, rows: rows?.members });
    const n0 = await run(gm, P.renderCount);
    await run(gm, P.seat, { partyId: party.id, fid, actorIds: members.map((m) => m.id) });
    const rejoinDrew = await run(gm, P.settleAfter, { n0 });
    rows = await run(gm, P.auditRows, { fid });
    check("7 redraw: the member rejoining shows again", rejoinDrew && !!rows && rows.members.some((t) => t?.includes("QA Auditor 3")), { drew: rejoinDrew, rows: rows?.members });

    // Scroll and focus.
    const sf = await run(gm, P.scrollFocus, { fid, name: ABILITY });
    check("7 scroll: the body part is the scroller and keeps its position across a ruling's render", sf.drew && sf.replaced && sf.scrolls && sf.top0 > 0 && Math.abs(sf.top1 - sf.top0) <= 2, sf);
    check("7 focus: after the ruling, focus is on that row's ruling button", sf.focus.action === "toggleAbility" && sf.focus.row === ABILITY && sf.focus.inWindow, sf.focus);
    const sel = await run(gm, P.selectFocus, { fid, itemUuid: null });
    check("7 focus: after a Used-for change, focus is on that select, and the value went back", sel.found && sel.changedTo && sel.drew && sel.focused && sel.restored, sel);

    // Columns and type.
    const col = await run(gm, P.columns, { fid });
    check("7 columns: narrowed, the Resolution table scrolls sideways to its last column", col.box && col.wide && col.scrolled && col.lastInside && col.overflowX === "auto", col);
    try {
      const small = await run(gm, P.knob, { partyId: party.id, fid, px: 14 });
      const large = await run(gm, P.knob, { partyId: party.id, fid, px: 18 });
      note("type knob", { small, large });
      check("7 type: at the largest type size the window opens wider and its select grows with the type", large.width > small.width && large.font > small.font && large.height > small.height && large.height >= large.font * 1.6, { small, large });
    } finally {
      await run(gm, P.knob, { partyId: party.id, fid, px: knob0 });
    }
    await run(gm, P.closeAudit);
  });

  /* ---------------- names and sources ("The audit roll" step 7, U15) ---------------- */
  await guarded("names and sources", async () => {
    const { gm, player } = open;
    const party = await gm.fixture("formation/audit-party", "Actor", { name: "QA Audit Party", type: `${SCOPE}.party` });
    const members = [];
    for (const n of [1, 2, 3]) members.push(await gm.fixture(`formation/audit-member-${n}`, "Actor", character(`QA Auditor ${n}`, n < 3 ? { items: [abilityData] } : {})));
    const { fid } = await run(gm, P.formationOf, { partyId: party.id });
    await run(gm, P.seat, { partyId: party.id, fid, actorIds: members.map((m) => m.id) });
    for (const m of members.slice(0, 2)) await run(gm, P.ensureItem, { actorId: m.id, name: ABILITY, data: abilityData });
    await run(gm, P.closeAudit);
    // Invented abilities shaped as the importer writes them: a cookbook page, a capability, a throw modifier, a level ladder.
    const X = "acks-extras";
    const cited = { name: "QA Cited Search", type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 14 }, flags: { [X]: { extras: { provides: ["kw:searching"] }, checkKey: "search", isSkill: true } } };
    const keen = { name: "QA Keen Eye", type: "ability", system: { roll: "", rollType: "above", rollTarget: 0 }, flags: { [X]: { cookbook: { cite: "QA p. 9" }, extras: { effects: [{ type: "modifies", target: "proficiencyThrow", refs: ["kw:searching"], value: { flat: 2 } }] } } } };
    const blank = { name: "QA Blank Target", type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 0 }, flags: { [X]: { cookbook: { cite: "QA p. 13" } } } };
    const ladderItem = { name: "QA Audit Ladder", type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 0 }, flags: { [X]: { cookbook: { id: "def.skill.qaauditladder", cite: "QA p. 11" }, extras: { rolls: [{ target: { kind: "level", breakpoints: [{ atLevel: 1, value: 17 }, { atLevel: 4, value: null }, { atLevel: 7, value: 12 }] } }] } } } };
    const m1 = members[0];
    const probes = [];
    for (const data of [cited, keen, blank]) { const r = await run(gm, P.freshItem, { actorId: m1.id, data }); probes.push(r); }
    const citedUuid = probes[0].uuid;
    const lad = await gm.fixture("formation/audit-skill-ladder", "Item", ladderItem);
    note("fixtures", { ladder: lad.uuid ?? lad.id, probes: probes.map((p) => p.uuid) });

    const methodical = (await run(gm, P.strings, { keys: ["ACKS-FORMATION.rolls.searchMethodical"] }))["ACKS-FORMATION.rolls.searchMethodical"];
    const want = await run(gm, P.resolved, { actorId: m1.id, checkKey: "searchMethodical" });
    note("resolved", want);
    check("sources: the fixture's resolution carries a part with an imported page", !!want && want.parts.some((p) => p.cite === "QA p. 9"), want?.parts);

    await run(gm, P.pressAudit, { partyId: party.id, fid });
    const opts = await run(gm, P.usedForLabels);
    const src = await run(gm, P.auditSources, { fid, actorName: "QA Auditor 1", itemNames: [ABILITY, "QA Cited Search", "QA Blank Target"], ladderName: "QA Audit Ladder", checkColumn: methodical.split("{")[0].trim() });
    note("audit", src);
    check("6: the Resolution cell's tooltip is the target with each part and its page, and core shows it", !!src?.cell && src.cell.tipAttr === want?.tip && src.cell.tipAttr.includes("QA p. 9") && src.cell.shown === want?.tip, src?.cell);
    const auditItem = src?.items?.[ABILITY];
    const blankItem = src?.items?.["QA Blank Target"];
    const sheetTip = (await run(gm, P.strings, { keys: ["ACKS-FORMATION.audit.sheetTargetTip"] }))["ACKS-FORMATION.audit.sheetTargetTip"];
    check("8: a stored target shows as a target, its tooltip saying it is the sheet's", auditItem?.target === "13+" && auditItem.targetTip === sheetTip, auditItem);
    check("8: an imported item with no stored target shows an empty cell, its tooltip the page alone", blankItem?.target === "" && blankItem.targetTip === "QA p. 13", blankItem);
    const aria = await run(gm, P.fmt, { key: "ACKS-FORMATION.audit.usedForLabel", data: { name: "QA Cited Search" } });
    const citedRow = src?.items?.["QA Cited Search"];
    check("5: the Used-for select is named for its item and keeps its item and field", citedRow?.aria === aria && citedRow.keptData, citedRow && { aria: citedRow.aria, kept: citedRow.keptData });
    check("5: its options read the check names, in order", !!citedRow?.options && JSON.stringify(citedRow.options.map((o) => [o.value, o.text])) === JSON.stringify(opts.map((o) => [o.value, o.label])), citedRow?.options);
    check("9: the progression row is named for the imported skill, carries its page, and a rung with no value is blank", src?.ladder?.tip === "QA p. 11" && src.ladder.values === "17 /  / 12", src?.ladder);
    const lvl = await run(gm, P.fmt, { key: "ACKS-FORMATION.audit.levelTag", data: { level: 1 } });
    check("10: the level column reads the lang tag", src?.level === lvl, { level: src?.level, lvl });
    check("1 (Skill tab) and 10: no title attribute anywhere in the audit", src?.titles === 0, src?.titles);
    await run(gm, P.closeAudit);

    // The Skill tab, on the Judge's seat and on a Player who owns the member.
    const tabGm = await run(gm, P.skillTab, { uuid: citedUuid });
    note("skill tab (GM)", tabGm);
    const tabAria = aria;
    check("Skill tab 2: the GM's select is named, editable, bound, and reads check names", tabGm.tab && tabGm.aria === tabAria && !tabGm.disabled && tabGm.selected === "search" && JSON.stringify(tabGm.options?.map((o) => [o.value, o.text])) === JSON.stringify(opts.map((o) => [o.value, o.label])), tabGm);
    check("Skill tab 1: the Throw bonus is named and carries core's tooltip, and the tab has no title attribute", !!tabGm.inputAria && tabGm.inputTip === "ACKS-FORMATION.audit.throwBonusHint" && tabGm.titles === 0, { aria: tabGm.inputAria, tip: tabGm.inputTip, titles: tabGm.titles });
    check("Skill tab 3: the resolution's tooltip cites each part's page, and core shows it", tabGm.liTip === want?.tip && tabGm.shown === want?.tip, { li: tabGm.liTip, shown: tabGm.shown });
    const was = await gm.eval(`game.actors.get(${JSON.stringify(m1.id)}).ownership[game.users.getName(${JSON.stringify(SEATS.player)}).id] ?? null`);
    await run(gm, P.setOwner, { actorId: m1.id, userName: SEATS.player, level: 3 });
    try {
      await sleep(800);
      const tabPl = await run(player, P.skillTab, { uuid: citedUuid });
      note("skill tab (Player)", tabPl);
      check("Skill tab, Player owner: the tab shows read-only, named, with check names and the cited tooltip", tabPl.tab && tabPl.disabled && tabPl.aria === tabAria && tabPl.options?.find((o) => o.value === "search")?.text === opts.find((o) => o.value === "search")?.label && tabPl.liTip === want?.tip && tabPl.titles === 0, tabPl);
    } finally {
      await run(gm, P.setOwner, { actorId: m1.id, userName: SEATS.player, level: was ?? 0 });
    }
    // The probes are rebuilt by the next walk from their data; the ladder is a kept fixture.
    for (const p of probes) tracked.push(gm.track(p.uuid, "Item"));
  });

  if (SHOTS && plateCard) {
    const { gm } = open;
    try {
      await gm.compose();
      const pop = await run(gm, P.chatPopout, { messageId: plateCard });
      const shot = await gm.shot(path.join(shotDir(), "formation-audit-roll.png"), pop.sel);
      note("plate formation-audit-roll", { bytes: shot.bytes });
    } catch (err) { console.log(`plate formation-audit-roll not taken: ${err?.message ?? err}`); }
  }

  section("errors after ready");
  for (const [k, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${k} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors?.slice(0, 5));
  }
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (open.gm && tracked.length) note("swept", await open.gm.sweepTracked({ only: unique(tracked) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
