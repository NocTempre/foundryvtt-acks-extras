/**
 * Live walk, formation-summons: a summoning cast's creatures march in their
 * summoner's party. Walks docs/formation/TESTING.md "Summons in the party" on
 * the GM and Player seats, under a boot recorder attached before the reload
 * that sees `init`, `setup` and `ready`. The Player seat casts by the cast
 * cell's Cast with real placement clicks and dismisses through the cast menu
 * and the cast-ended card in its own chat log; it also takes its own summoner
 * out of the party and back in on the party sheet's Order tab. The GM seat
 * starts and ends the combat, detaches and recalls members, moves the clock,
 * hand-deletes a token, works the hit-point window from the party sheet, drops
 * actors on the sheet, disbands, and reads the formation record. Steps 1 to 10
 * of the recipe, each opening with its own start-shape check:
 *   1. a cast of two joins as two members under distinct ids, base the world
 *      copy, each stash carrying the summoner flag, one cast record and the
 *      Player's ownership, with no creature token on the field and the Magic
 *      tab reading "2 standing";
 *   2. a combat on the party token deploys them with the same flags,
 *      ownership and hit points;
 *   3. the combat's end recalls them, and the hit-point window ticked on one
 *      stashed creature changes that creature's stash alone;
 *   4. the second summoner's cast beside them, and the first summoner's cast
 *      menu Dismiss (counting its own two) removing only its own;
 *   5. a detach, a hand-deleted token and a recall leave the deleted
 *      creature's record gone and nothing restoring it;
 *   6. a creature at 0 hit points, stashed and deployed, ends as a dismissal
 *      ends it: no record, no token, no casualty card;
 *   7. the clock past the named spell's duration: the end card counts the
 *      held creatures and its Dismiss, answered Yes, empties them;
 *   8. the second summoner leaves the party (creatures restored with their
 *      flags) and rejoins (creatures gathered back in);
 *   9. a disband restores every member, the creatures with their flags;
 *  10. the creature's world copy dropped on the party sheet, and a creature
 *      token of a caster outside the party, are refused with the warning.
 * Each step needs creatures the step before it removed; where the recipe does
 * not say how they arrive, a labelled cast in that step's own start shape
 * supplies them (6: a cast of three; 8: a cast of two). Prints booleans and
 * counts, never a name or an id. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds what is missing): the
 * character-sheet recipe's `summons/scene`; this walk's own `summons/summoner-a` (a character the
 * Player owns), `summons/spell-named-a` (one row naming `summons/spike-source`
 * by uuid, a short invented duration), `summons/spike-source` (a monster the
 * Player holds Observer on: a cast summons what the casting seat may observe,
 * so the fixtures section writes that level from the GM seat) and `summons/stranger` (a character the Player only
 * observes), and this section's own: `summons/party` (a party actor whose
 * formation holds both summoners), `summons/party-token` (its token on the
 * scene, the summoner stashed inside), `summons/summoner-b` (a second
 * character the Player owns) and `summons/spell-named-b` (its summoning spell,
 * naming the same creature). A step 9 disband removes `summons/party` and its
 * token; the walk re-forms the party and puts both markers back. The run's own
 * documents (the combat, the hand-deleted token, the restored creature tokens,
 * the outsider's token, the creature's world copy where none stood, the cast
 * and card messages, the caster records) are tracked by uuid and swept alone.
 * The world clock moves forward by the seconds printed and is not moved back.
 * A paused world is unpaused for the run and paused again in the finally.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCOPE = "acks-extras";

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

/** Each summoning spell's duration: an invented minute, so one short step of the clock runs it out. */
const NAMED_DURATION = { shape: "fixed", value: 1, unit: "minutes" };

/** The party fixture's name: the name the formation's own cards speak under. */
const PARTY_NAME = "QA Summons Party";

/** The hit points every creature's stash is brought to before a step that deploys or damages it. */
const SHAPED_HP = 8;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ff = globalThis.__ff ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
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
    // The weapon rows' first publication redraws every open actor sheet, which
    // closes an open cell menu: the walk opens none before it has landed.
    const rows = await import("/modules/acks-extras/scripts/equipment/weapon-rows.mjs");
    await Promise.race([rows.rowsReady(), H.sleep(60000)]);
    const base = "/modules/acks-extras/scripts/";
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.dep = await import(`${base}formation/deployment.mjs`);
    H.consts = await import(`${base}formation/constants.mjs`);
    H.hp = await import(`${base}lib/hp.mjs`);
    H.logic = await import(`${base}lib/summons-logic.mjs`);
    await H.sleep(300);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, castApi: typeof globalThis.acksExtras?.magic?.castSummon === "function", formationApi: typeof globalThis.acksExtras?.formation?.travel?.setJourneyMode === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** The id of the user this seat is, as the page itself holds it. */
  selfId: async () => game.user.id,
  /** On the Judge's seat: write a user's level on a world document, then read what the document stores. */
  setLevel: async ({ uuid, userId, level }) => {
    const doc = await fromUuid(uuid);
    await doc.update({ [`ownership.${userId}`]: level });
    const source = doc._source.ownership ?? {};
    return { stored: source[userId] ?? null, def: source.default ?? null };
  },
  /** Whether this seat's user may observe a document. */
  observes: async ({ uuid }) => !!(await fromUuid(uuid))?.testUserPermission(game.user, "OBSERVER"),
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  boot: async () => {
    const b = window.__boot ?? null;
    return { recorded: !!b, preFoundry: !!b?.preFoundry, castExpiryError: b ? b.error.some((e) => /cast-end watch could not register|cast-end sweep failed/u.test(e)) : null, errors: b?.error.length ?? null };
  },
  drain: async () => {
    const H = globalThis.__ff;
    const out = { errors: H.errors.slice(), warns: H.warns.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  /** The warnings this seat has shown since the last read, then forgotten. */
  takeWarns: async () => globalThis.__ff.warns.splice(0),
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
  /** The known shape of one summoning spell: its actor's spells enabled, the spell reading as a summoning with its row and its short duration, the count at 0. */
  shapeSpell: async ({ actorId, spellId, ref, duration }) => {
    const actor = game.actors.get(actorId);
    if (!actor.system.spells?.enabled) await actor.update({ "system.spells.enabled": true });
    await actor.items.get(spellId).update({ "system.cast": 0, "flags.acks-extras.spell": { schools: ["summoning"], effects: [{ type: "summon", ref, amount: 3 }], duration } });
    const { isSummonSpell } = await import("/modules/acks-extras/scripts/magic/summon-spell.mjs");
    return { enabled: !!actor.system.spells?.enabled, summon: isSummonSpell(actor.items.get(spellId)) };
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    return true;
  },
  /** Open the actor's sheet and its cast cell; the menu's entries, as their labels. */
  menu: async ({ actorId }) => {
    const H = globalThis.__ff;
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
  closeMenu: async () => { document.querySelectorAll(".acks-extras-frame__menu").forEach((m) => m.remove()); return true; },
  pick: async ({ label }) => {
    const H = globalThis.__ff;
    const b = [...document.querySelectorAll(".acks-extras-frame__menu-item")].find((x) => x.textContent.trim() === label);
    if (!b) return false;
    b.click();
    await H.sleep(900);
    return true;
  },
  /** The cast dialog's Summon band, once the dialog is up: its creature choices and its count. */
  prompt: async () => {
    const H = globalThis.__ff;
    const el = await H.poll(() => document.querySelector(".application.acks-extras-cast"), { tries: 80, every: 150 });
    if (!el) return { prompt: false };
    return {
      prompt: true,
      summonBand: !!el.querySelector(".acks-extras-cast-summon"),
      values: [...(el.querySelector('select[name="summonRef"]')?.options ?? [])].map((o) => o.value),
      count: el.querySelector('input[name="summonCount"]')?.value ?? null,
    };
  },
  /** Answer the cast dialog (the count typed as a user does, each change re-rendering the window, then Cast), then clear every framed window off the map. */
  answer: async ({ count }) => {
    const H = globalThis.__ff;
    const live = () => document.querySelector(".application.acks-extras-cast");
    if (!live()) return { prompt: false };
    const input = live().querySelector('input[name="summonCount"]');
    if (count && input && input.value !== String(count)) {
      input.value = String(count);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await H.sleep(600);
    }
    const ok = live()?.querySelector('button[data-action="cast"]');
    if (!ok || ok.disabled) return { prompt: true, pressed: false, disabled: !!ok?.disabled };
    ok.click();
    await H.sleep(500);
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    await H.sleep(500);
    return { prompt: true, pressed: !!ok };
  },
  /** One client point per cell asked for, found by scanning the viewport for bare canvas well inside the scene. */
  pointsFor: async ({ cells, avoid = [] }) => {
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
    for (let y = 20; y < H - 20; y += 30) {
      for (let x = 20; x < W - 20; x += 30) {
        if (document.elementFromPoint(x, y) !== canvas.app.view) continue;
        const back = canvas.canvasCoordinatesFromClient({ x, y });
        if (back.x >= r.x + 100 && back.y >= r.y + 100 && back.x <= r.x + r.width - 100 && back.y <= r.y + r.height - 100) found.push({ x, y });
      }
    }
    if (!found.length) {
      // The scan maps no spot inside the scene: fall back to the scene's own cells mapped to the client, kept where the bare canvas lies under them.
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.3], [0.7, 0.7]]) {
        const p = canvas.clientCoordinatesFromCanvas({ x: r.x + r.width * fx, y: r.y + r.height * fy });
        if (p.x > 0 && p.y > 0 && p.x < W && p.y < H && document.elementFromPoint(p.x, p.y) === canvas.app.view) found.push({ x: Math.round(p.x), y: Math.round(p.y) });
      }
    }
    if (!found.length) {
      const top = document.elementFromPoint(W / 2, H / 2);
      const at = top ? `${top.tagName.toLowerCase()}.${[...top.classList].join(".")}#${top.id}` : "nothing";
      const mid = canvas.canvasCoordinatesFromClient({ x: W / 2, y: H / 2 });
      return cells.map(() => ({
        x: 0, y: 0, onCanvas: false, at, W, H, scene: canvas.scene?.id ?? null, isView: top === canvas.app.view,
        view: [Number(canvas.stage.scale.x.toFixed(3)), Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y)],
        rect: [r.x, r.y, r.width, r.height], mid: [Math.round(mid.x), Math.round(mid.y)], hidden: document.hidden,
      }));
    }
    const cx = found.reduce((a, p) => a + p.x, 0) / found.length;
    const cy = found.reduce((a, p) => a + p.y, 0) / found.length;
    found.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const apart = Math.max(120, canvas.dimensions.size * canvas.stage.scale.x * 1.5);
    const out = [];
    for (const _cell of cells) {
      const pick = found.find((p) => [...out, ...avoid].every((o) => Math.hypot(p.x - o.x, p.y - o.y) >= apart));
      out.push(pick ? { x: pick.x, y: pick.y, onCanvas: true } : { x: 0, y: 0, onCanvas: false });
    }
    return out;
  },
  viewport: async () => ({ w: window.innerWidth, h: window.innerHeight }),
  copiesOf: async ({ sourceUuid }) => game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid).map((a) => a.uuid),
  castCount: async ({ actorId, spellId }) => game.actors.get(actorId).items.get(spellId)?.system?.cast ?? null,
  /** The caster records one cast left on the actor. */
  recordsOf: async ({ actorId, castId }) =>
    game.actors.get(actorId).effects
      .filter((e) => e.getFlag("acks-extras", "spellEffect")?.castId === castId)
      .map((e) => ({ uuid: e.uuid, role: e.getFlag("acks-extras", "spellEffect").role, ended: e.getFlag("acks-extras", "spellEffect").ended ?? null })),
  messageIds: async () => game.messages.map((m) => m.id),
  /**
   * The messages made since the ids given that this run's fixtures made: speaking as a caster, carrying a
   * cast-ended card for one, or spoken by the party's current name from the GM seat's own client (the
   * formation's cards). Never by author and time window alone.
   */
  newMessages: async ({ since, speakers, casterUuids, partyName }) =>
    game.messages
      .filter((m) => !since.includes(m.id) && (speakers.includes(m.speaker?.actor) || casterUuids.includes(m.getFlag("acks-extras", "castEnded")?.casterUuid) || ((m.author?.id ?? m.user?.id) === game.user.id && m.speaker?.alias === partyName)))
      .map((m) => m.uuid),
  /** The cast-ended cards for one cast, as this seat sees them. */
  endedCards: async ({ castId, playerId }) =>
    game.messages
      .filter((m) => m.getFlag("acks-extras", "castEnded")?.castId === castId)
      .map((m) => ({ id: m.id, uuid: m.uuid, toPlayer: m.whisper.includes(playerId), toGM: m.whisper.some((id) => game.users.get(id)?.isGM), whispered: m.whisper.length > 0, visible: m.visible })),
  /** The whole numbers a message's paragraph carries. */
  cardNumbers: async ({ messageId }) => {
    const html = game.messages.get(messageId)?.content ?? "";
    const text = new DOMParser().parseFromString(html, "text/html").querySelector("p")?.textContent ?? "";
    return (text.match(/\d+/g) ?? []).map(Number);
  },
  /** Move the world clock forward; answers the new time. */
  advance: async ({ seconds }) => {
    await game.time.advance(seconds);
    await new Promise((r) => setTimeout(r, 2500));
    return game.time.worldTime;
  },
  /** Press the Dismiss button of a rendered cast-ended card on this seat. */
  pressCardDismiss: async ({ messageId }) => {
    const H = globalThis.__ff;
    try { ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* the log renders either way */ }
    const button = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"] [data-acks-extras-cast-dismiss]`), { tries: 30, every: 200 });
    if (!button) return { button: false };
    button.click();
    return { button: true };
  },
  /** Answer the open confirmation dialog. */
  confirm: async ({ action }) => {
    const H = globalThis.__ff;
    const b = await H.poll(() => [...document.querySelectorAll(".application.dialog button, dialog button")].find((x) => x.dataset.action === action), { tries: 30 });
    if (!b) return false;
    b.click();
    await H.sleep(1500);
    return true;
  },
  /** The Magic tab's summoning rows: the standing count's face and tooltip, and whether Dismiss is offered. */
  magicRows: async ({ actorId, spellIds }) => {
    const H = globalThis.__ff;
    const sheet = game.actors.get(actorId).sheet;
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); }
    sheet.changeTab("magic", "primary");
    await H.sleep(700);
    return spellIds.map((id) => {
      const row = H.root(sheet)?.querySelector(`[data-item-id='${id}']`);
      const count = row?.querySelector("[data-summon='standing']");
      const dismiss = row?.querySelector("[data-action='spellDismiss']");
      return { row: !!row, face: count?.textContent.trim() ?? null, tipped: !!count?.dataset.tooltipText, dismiss: !!dismiss };
    });
  },

  /* ---- the party ---- */

  /** The record behind a party actor, once its create hook has made one; a hand-made actor no record names is adopted. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__ff;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 40, every: 200 });
    if (found) return { fid: found.id, adopted: false };
    const made = await H.model.adoptPartyActor(game.actors.get(partyId));
    return { fid: made.id, adopted: true };
  },
  /**
   * Bring the party to the recipe's start shape: no stale combat flag; both summoners members, A with
   * a token stashed inside the party token on the scene, B with its own token where one stands; the
   * party delving. A token of a summoner is taken from the scene when one stands that carries no
   * fixture marker and is no party's, else made from the actor. Reports what it found, never a name.
   */
  formParty: async ({ fid, sceneId, aId, bId, tokenMarker }) => {
    const H = globalThis.__ff;
    const scene = game.scenes.get(sceneId);
    const A = game.actors.get(aId);
    const B = game.actors.get(bId);
    const get = () => H.model.getFormation(fid);
    const out = { staleCombat: !!get().combat };
    if (out.staleCombat) await H.model.patchFormation(fid, (rec) => void (rec.combat = null));
    // A run stopped mid-combat or mid-detach leaves members out on the map: the recall is the party's own.
    const stranded = get().members.filter((m) => m?.actorId && H.dep.isMemberDeployed(m));
    out.recalled = stranded.length;
    if (stranded.length) await H.dep.recallMembers(get(), { members: stranded });
    const isMember = (id) => get().members.some((m) => m?.actorId === id);
    const lone = (actor) => scene.tokens.find((t) => t.actorId === actor.id && !t.flags?.world?.fixture && !t.getFlag(H.consts.MODULE_ID, H.consts.FLAG_FORMATION_ID) && !H.logic.summonOfData(t.toObject()).summonedBy) ?? null;
    if (!isMember(aId)) {
      let token = lone(A);
      if (!token) {
        const doc = await A.getTokenDocument({ x: 300, y: 300 });
        const data = doc.toObject();
        delete data._id;
        [token] = await scene.createEmbeddedDocuments("Token", [data]);
      }
      await H.model.addMember(get(), A, token, { scene });
    }
    if (!H.model.getPartyToken(get())) await H.model.ensurePartyToken(get(), scene, 300, 300);
    if (!isMember(bId)) await H.model.addMember(get(), B, lone(B), { scene: null });
    const mode = get().travel?.mode;
    if (mode && mode !== "delve") await globalThis.acksExtras.formation.travel.setJourneyMode(fid, "delve");
    await H.sleep(500);
    const f = get();
    const token = H.model.getPartyToken(f);
    const rows = f.members.filter((m) => m?.actorId && !m.blank);
    return {
      partyTokenUuid: token?.uuid ?? null,
      markedToken: !!token && token.flags?.world?.fixture === tokenMarker,
      onScene: f.sceneId === sceneId,
      hasA: isMember(aId),
      hasB: isMember(bId),
      summonMembers: rows.filter(H.model.isSummonMember).length,
      deployed: rows.filter((m) => H.dep.isMemberDeployed(m)).length,
      delving: (f.travel?.mode ?? "delve") === "delve",
      staleCombat: out.staleCombat,
    };
  },
  /**
   * The party as the record and the scene hold it: who is a member, each summon member read off its
   * own live or stashed token (id, base actor, summoner, cast, spell, the seat's ownership level, hit
   * points, where it stands), the person members' hit points, and the scene's summon tokens no
   * member holds. Ids stay in the page's answer for the walk to compare; the walk prints counts.
   */
  state: async ({ fid, sceneId, playerId, aId, bId }) => {
    const H = globalThis.__ff;
    const f = H.model.getFormation(fid);
    if (!f) return { gone: true };
    const scene = game.scenes.get(sceneId);
    const rows = f.members.filter((m) => m?.actorId && !m.blank);
    const summons = rows.filter(H.model.isSummonMember).map((m) => {
      const own = H.model.memberOwnToken(m);
      const raw = own?.toObject?.() ?? own ?? null;
      const { summonedBy, summon } = H.logic.summonOfData(raw);
      const hp = H.model.memberHp(m);
      const level = raw?.delta?.ownership?.[playerId] ?? own?.actor?.ownership?.[playerId] ?? null;
      return { id: m.actorId, base: m.baseActorId ?? null, by: summonedBy, cast: summon?.castId ?? null, spell: summon?.spellId ?? null, own: level, hp: hp?.value ?? null, max: hp?.max ?? null, deployed: !!m.deployedTokenId, stashed: !!m.tokenData && !m.deployedTokenId, detached: !!m.detached };
    });
    const heldIds = new Set(rows.filter((m) => m.deployedTokenId).map((m) => m.deployedTokenId));
    const flagged = scene ? scene.tokens.filter((t) => H.logic.summonOfData(t.toObject()).summon) : [];
    const loose = flagged.filter((t) => !heldIds.has(t.id));
    const hpOf = (id) => game.actors.get(id)?.system?.hp?.value ?? null;
    return {
      gone: false,
      combat: !!f.combat?.active,
      onScene: f.sceneId === sceneId,
      partyToken: !!H.model.getPartyToken(f),
      delving: (f.travel?.mode ?? "delve") === "delve",
      hasA: rows.some((m) => m.actorId === aId),
      hasB: rows.some((m) => m.actorId === bId),
      persons: rows.filter((m) => !H.model.isSummonMember(m)).length,
      personDeployed: rows.filter((m) => !H.model.isSummonMember(m) && H.dep.isMemberDeployed(m)).length,
      personHp: { a: hpOf(aId), b: hpOf(bId) },
      summons,
      loose: loose.length,
      looseCasts: [...new Set(loose.map((t) => H.logic.summonOfData(t.toObject()).summon?.castId).filter(Boolean))],
      deployedTokens: summons.filter((s) => s.deployed).length,
      summonerTokens: scene ? scene.tokens.filter((t) => t.actorId === aId || t.actorId === bId).length : null,
    };
  },
  /** Bring every stashed summon's hit points (value and max) to a known figure: a start-shape write, as a stash is the one place a bare creature's rolled figure sits. */
  setStashHp: async ({ fid, value }) => {
    const H = globalThis.__ff;
    let n = 0;
    await H.model.patchFormation(fid, (rec) => {
      for (const m of rec.members ?? []) {
        if (!m?.actorId || !H.model.isSummonMember(m) || !m.tokenData || m.deployedTokenId) continue;
        m.tokenData.delta ??= {};
        foundry.utils.setProperty(m.tokenData.delta, "system.hp.value", value);
        foundry.utils.setProperty(m.tokenData.delta, "system.hp.max", value);
        n++;
      }
      return n ? undefined : false;
    });
    return n;
  },
  /** The party token's and the party actor's ids, for the combat. */
  partyIds: async ({ fid }) => {
    const H = globalThis.__ff;
    const f = H.model.getFormation(fid);
    const t = H.model.getPartyToken(f);
    return { tokenId: t?.id ?? null, actorId: f.actorId };
  },
  /** Start a combat on the scene and add the party token, as a Judge does; answers the combat's uuid. */
  startCombat: async ({ sceneId, tokenId, actorId }) => {
    const combat = await Combat.create({ scene: sceneId, active: true });
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId, actorId }]);
    return combat.uuid;
  },
  /** Detach one member, or recall one that is detached: the party sheet's own entry point. */
  toggleDetach: async ({ fid, actorId }) => {
    const H = globalThis.__ff;
    return H.dep.toggleDetachMember(H.model.getFormation(fid), actorId);
  },
  /** The uuid of a member's deployed token. */
  deployedUuid: async ({ fid, actorId }) => {
    const H = globalThis.__ff;
    const m = H.model.getFormation(fid).members.find((x) => x?.actorId === actorId);
    return m?.deployedTokenId ? game.scenes.get(m.deployedSceneId)?.tokens.get(m.deployedTokenId)?.uuid ?? null : null;
  },
  /**
   * The hit-point window as a Judge works it: opened from the party sheet's hit-point cell (or, for a
   * live token, on that token), one row ticked, the mode and the amount set, Apply pressed. Answers
   * how many rows were ticked and whether Apply was live.
   */
  hpWindow: async ({ partyId, fid, key, tokenUuid, mode, amount }) => {
    const H = globalThis.__ff;
    const before = new Set(game.messages.map((m) => m.id));
    let viaSheet = false;
    if (tokenUuid) {
      globalThis.acksExtras.lib.hp.open({ tokens: [await fromUuid(tokenUuid)] });
    } else {
      const sheet = game.actors.get(partyId).sheet;
      if (!sheet.rendered) { await sheet.render(true); await H.sleep(900); }
      const button = H.root(sheet)?.querySelector('[data-action="adjustHp"]');
      viaSheet = !!button;
      if (button) button.click();
      else globalThis.acksExtras.lib.hp.open({ parties: [fid] });
    }
    const win = () => document.querySelector("#acks-extras-hp");
    const ready = await H.poll(() => (win()?.querySelector("tr[data-row]") ? true : null), { tries: 60, every: 150 });
    if (!ready) return { opened: false, viaSheet };
    const fire = async (el) => { el.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(450); };
    if (key) {
      const keys = [...win().querySelectorAll('tr[data-row] input[data-field="include"]')].map((b) => b.closest("[data-row]").dataset.row);
      for (const k of keys) {
        const box = [...win().querySelectorAll('tr[data-row] input[data-field="include"]')].find((b) => b.closest("[data-row]").dataset.row === k);
        if (box && box.checked !== (k === key)) { box.checked = k === key; await fire(box); }
      }
    }
    const radio = win().querySelector(`input[name="mode"][value="${mode}"]`);
    if (radio && !radio.checked) { radio.checked = true; await fire(radio); }
    const field = win().querySelector('input[name="amount"]');
    field.value = String(amount);
    await fire(field);
    const picked = win().querySelectorAll('tr[data-row] input[data-field="include"]:checked').length;
    const apply = win().querySelector('[data-action="apply"]');
    const live = !!apply && !apply.disabled;
    if (live) apply.click();
    await H.sleep(2000);
    const rows = win()?.querySelectorAll("tr[data-row]").length ?? null;
    await foundry.applications.instances.get("acks-extras-hp")?.close({ animate: false });
    // The report the window posts is its own product: the cards this seat's client made while the window was open.
    const cards = game.messages.filter((m) => !before.has(m.id) && (m.author?.id ?? m.user?.id) === game.user.id).map((m) => m.uuid);
    return { opened: true, viaSheet, picked, live, rows, cards };
  },
  /** The party sheet open on a tab, and a press on one of its controls (a Player's own take-out and bring-in, the Judge's disband). */
  openParty: async ({ partyId, tab = "order" }) => {
    const H = globalThis.__ff;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    H.root(app)?.querySelector(`[data-action="tab"][data-tab="${tab}"]`)?.click();
    await H.sleep(300);
    return { rendered: !!H.root(app) };
  },
  press: async ({ partyId, selector, settle = 1500 }) => {
    const H = globalThis.__ff;
    const control = H.root(game.actors.get(partyId).sheet)?.querySelector(selector);
    if (!control) return { found: false };
    const disabled = !!control.disabled;
    if (!disabled) control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },
  access: async ({ partyId }) => {
    const party = game.actors.get(partyId);
    return { sees: !!party?.testUserPermission(game.user, "OBSERVER"), owns: !!party?.testUserPermission(game.user, "OWNER") };
  },
  /** A drop on the open party sheet's root, read by the event a browser sends; answers the warnings the seat showed. */
  drop: async ({ partyId, data }) => {
    const H = globalThis.__ff;
    H.warns.length = 0;
    const el = H.root(game.actors.get(partyId).sheet);
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify(data));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await H.sleep(1800);
    return H.warns.splice(0);
  },
  /** The refusal text a drop of this creature copy, and of a creature token of an absent summoner, should show. */
  expectedWarns: async ({ copyId }) => {
    const name = game.actors.get(copyId)?.name ?? "";
    return { copy: game.i18n.format("ACKS-FORMATION.warn.summonCopy", { name }), absent: game.i18n.format("ACKS-FORMATION.warn.summonerAbsent", { name }) };
  },
  /** A creature token of a caster outside the party: the flags a placement stamps, built by the module's own builder. */
  outsiderToken: async ({ sceneId, copyId, outsiderId }) => {
    const H = globalThis.__ff;
    const scene = game.scenes.get(sceneId);
    const copy = game.actors.get(copyId);
    const flags = H.logic.summonFlags(`Actor.${outsiderId}`, { sourceUuid: copy.getFlag("acks-extras", "summonCopy")?.sourceUuid, name: copy.name, castId: "qaOutsider", at: game.time.worldTime });
    const doc = await copy.getTokenDocument({ x: 900, y: 500, actorLink: false, hidden: false, delta: { flags } }, { parent: scene });
    const data = doc.toObject();
    delete data._id;
    const [made] = await scene.createEmbeddedDocuments("Token", [data]);
    return made.uuid;
  },
  tokenThere: async ({ uuid }) => !!(await fromUuid(uuid)),
  /** The scene's tokens of these actors that carry no fixture marker and belong to no party, as uuids. */
  tokensOf: async ({ sceneId, actorIds }) => {
    const H = globalThis.__ff;
    return game.scenes.get(sceneId).tokens
      .filter((t) => actorIds.includes(t.actorId) && !t.flags?.world?.fixture && !t.getFlag(H.consts.MODULE_ID, H.consts.FLAG_FORMATION_ID))
      .map((t) => t.uuid);
  },
  /** The scene's summon tokens no member holds, as uuids and with their casts. */
  looseTokens: async ({ fid, sceneId }) => {
    const H = globalThis.__ff;
    const f = H.model.getFormation(fid);
    const held = new Set((f?.members ?? []).map((m) => m?.deployedTokenId).filter(Boolean));
    return game.scenes.get(sceneId).tokens.filter((t) => H.logic.summonOfData(t.toObject()).summon && !held.has(t.id)).map((t) => ({ uuid: t.uuid, cast: H.logic.summonOfData(t.toObject()).summon.castId }));
  },
  /** Release the members of casts this run made, and delete the scene tokens of those casts: the run's own, by its cast ids. */
  clearCasts: async ({ fid, sceneId, castIds }) => {
    const H = globalThis.__ff;
    const svc = globalThis.acksExtras?.lib?.services?.get?.("party-roster") ?? (await import("/modules/acks-extras/scripts/lib/services.mjs")).get("party-roster");
    const f = H.model.getFormation(fid);
    const ids = (f?.members ?? []).filter((m) => m?.actorId && H.model.isSummonMember(m) && castIds.includes(H.logic.summonOfData(H.model.memberOwnToken(m)?.toObject?.() ?? H.model.memberOwnToken(m)).summon?.castId)).map((m) => m.actorId);
    const released = ids.length ? (await svc.release(fid, ids)).released : 0;
    const scene = game.scenes.get(sceneId);
    const left = scene.tokens.filter((t) => castIds.includes(H.logic.summonOfData(t.toObject()).summon?.castId)).map((t) => t.id);
    if (left.length) await scene.deleteEmbeddedDocuments("Token", left);
    return { released, deleted: left.length };
  },
  restore: async () => {
    const H = globalThis.__ff;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.summons && !!globalThis.acksExtras?.magic && !!globalThis.acksExtras?.formation && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Attach a second DevTools session, register the boot recorder for the next document, and reload. */
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
/** Bring a seat's page to the front, so its canvas lays out and renders. */
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
 * Rest the seat's real pointer in the middle of its viewport. While previews are
 * placed, core pans the view toward any edge the pointer sits within 50 px of,
 * and every pan replays the last pointer position, so a pointer left at the
 * page's corner runs the view off the scene before a point can be read.
 */
async function pointerToMiddle(api, port) {
  const { w, h } = await run(api, P.viewport);
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(w / 2), y: Math.round(h / 2) });
  s.close();
  await sleep(400);
}

/** Poll a page read until `test(result)` holds or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 60, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}

let gm = null;
let player = null;
let wasPaused = false;
let fid = null;
let partyId = null;
/** The uuids of what this run made: the only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
/**
 * Sweep some of the run's own tracked documents mid-run. What the sweep removed or found gone leaves
 * the run's list, so the final sweep never names a uuid the ledger no longer holds.
 */
const sweepNow = async (uuids) => {
  // The tracker shows no combat while one goes, so the delete activates no kept combat (docs/lib/TESTING.md, the round-combat fixture).
  await gm.eval("(() => { ui.combat.viewed = null; return true; })()");
  const out = await gm.sweepTracked({ only: uuids });
  for (const e of [...out.removed, ...out.missing]) {
    const at = own.indexOf(e.uuid);
    if (at >= 0) own.splice(at, 1);
  }
  return out;
};
/** The run's own cast ids, each by the label of the cast that made it: teardown clears by these alone. */
const casts = new Map();
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_800_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm, PORTS.gm, "gm"));
  note("player reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(player, PORTS.player, "player"));
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  check("the GM seat is the active GM and the player seat is a player, both with the summoning cast and the party's travel API", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2 && installed.castApi && seated.castApi && installed.formationApi, { gm: installed.role, player: seated.role });
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const boot = await run(seat, P.boot);
    check(`${label}: the recorder ran before Foundry's scripts and saw no error from init on`, boot.recorded && boot.preFoundry && boot.errors === 0 && boot.castExpiryError === false, { errors: boot.errors });
  }
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const gmUserId = await run(gm, P.userId, { name: MACHINE.gm });
  if (!playerId || !gmUserId) throw new Error("no GM or Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const marker = (m) => (MACHINE.own ? `${m}@${MACHINE.own}` : m);
  const scene = await gm.fixture("summons/scene", "Scene", {
    name: "QA Summoning Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 },
  });
  const summonerA = await gm.fixture("summons/summoner-a", "Actor", {
    name: "QA Summoner", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0, [playerId]: 3 },
  });
  const summonerB = await gm.fixture("summons/summoner-b", "Actor", {
    name: "QA Summoner B", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0, [playerId]: 3 },
  });
  const stranger = await gm.fixture("summons/stranger", "Actor", { name: "QA Stranger", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 2 } });
  const spike = await gm.fixture("summons/spike-source", "Actor", { name: "QA Spike Source", type: "monster", ownership: { default: 0, [playerId]: 2 } });
  const spellA = await gm.fixture("summons/spell-named-a", "Item", { name: "QA Named Calling", type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: summonerA.uuid });
  const spellB = await gm.fixture("summons/spell-named-b", "Item", { name: "QA Named Calling B", type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: summonerB.uuid });
  const aId = idOf(summonerA);
  const bId = idOf(summonerB);
  const sceneId = idOf(scene);
  const spellAId = idOf(spellA);
  const spellBId = idOf(spellB);
  const aUuid = `Actor.${aId}`;
  const bUuid = `Actor.${bId}`;
  const spikeUuid = `Actor.${idOf(spike)}`;
  const nameA = spellA.name;
  const nameB = spellB.name;
  // A cast summons what the casting seat may observe: the kept creature carries the Player's Observer level, written from the GM seat and read back on the Player seat.
  const seatId = await run(player, P.selfId);
  const granted = await run(gm, P.setLevel, { uuid: spikeUuid, userId: playerId, level: 2 });
  const seenGranted = await until(player, P.observes, { uuid: spikeUuid }, (v) => v === true);
  check("shape: the Player seat's own user is the one granted, and the creature holds Observer for it at default None, which the Player seat reads", seatId === playerId && granted.stored === 2 && granted.def === 0 && seenGranted === true, { granted: granted.stored, def: granted.def, observes: seenGranted });
  for (const [id, spellId, ref] of [[aId, spellAId, spikeUuid], [bId, spellBId, spikeUuid]]) {
    const shaped = await run(gm, P.shapeSpell, { actorId: id, spellId, ref, duration: NAMED_DURATION });
    check("shape: spells enabled and the spell reads as a summoning spell", shaped.enabled && shaped.summon, shaped);
  }
  const party = await gm.fixture("summons/party", "Actor", { name: PARTY_NAME, type: `${SCOPE}.party` });
  partyId = idOf(party);
  const formed = await run(gm, P.formationOf, { partyId });
  fid = formed.fid;
  note("the party's record was adopted for its actor", formed.adopted);

  const st = () => run(gm, P.state, { fid, sceneId, playerId, aId, bId });
  /** Form the party to its start shape, and put the party token's marker on it. */
  async function formParty() {
    const shape = await run(gm, P.formParty, { fid, sceneId, aId, bId, tokenMarker: marker("summons/party-token") });
    if (shape.partyTokenUuid && !shape.markedToken) await gm.mark(shape.partyTokenUuid, "summons/party-token");
    return shape;
  }
  /** Dismiss what a past run left, through the cast menu of each summoner, as the recipe says. */
  async function dismissThroughMenu(actorId) {
    await run(player, P.clearWindows);
    const m = await run(player, P.menu, { actorId });
    const label = m.items.find((l) => l.startsWith("Dismiss all")) ?? m.items.find((l) => l.startsWith("Dismiss "));
    if (label) {
      await run(player, P.pick, { label });
      await run(player, P.confirm, { action: "yes" });
      await sleep(1500);
    } else await run(player, P.closeMenu);
    await run(player, P.clearWindows);
  }
  /** One cast from the cast cell: Cast, the cast dialog answered, a real click per creature, and the creatures joined as members. */
  async function placeCast({ tag, actorId, label, count, joined }) {
    await run(player, P.clearWindows);
    const m = await run(player, P.menu, { actorId });
    check(`${tag}: Cast is offered in the cast cell`, m.cell && m.items.includes(label));
    check(`${tag}: Cast is picked`, await run(player, P.pick, { label }));
    const prompt = await run(player, P.prompt);
    check(`${tag}: the cast dialog's Summon band offers the spell's one creature`, prompt.prompt && prompt.summonBand && prompt.values.length === 1 && prompt.values[0] === spikeUuid, { choices: prompt.values?.length });
    check(`${tag}: Cast is pressed in the dialog for ${count}`, (await run(player, P.answer, { count })).pressed);
    await frontSeat(PORTS.player);
    await pointerToMiddle(player, PORTS.player);
    const clicked = [];
    for (let i = 0; i < count; i++) {
      const [p] = await run(player, P.pointsFor, { cells: [i], avoid: clicked });
      if (!p.onCanvas) throw new Error(`no bare canvas to click: ${JSON.stringify(p)}`);
      await clickAt(PORTS.player, p);
      clicked.push(p);
    }
    const after = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => joined(s) && s.loose === 0, { tries: 80, every: 300 });
    for (const t of await run(gm, P.looseTokens, { fid, sceneId })) await track(t.uuid, "Token");
    await run(player, P.clearWindows);
    return after;
  }
  /** Register a cast's id by its label, and track its caster record. */
  async function registerCast(label, actorId, castId) {
    casts.set(label, castId);
    const records = await until(gm, P.recordsOf, { actorId, castId }, (r) => r.length >= 1, { tries: 30, every: 250 });
    for (const r of records) await track(r.uuid, "ActiveEffect");
    return records;
  }
  const ofCast = (s, by) => s.summons.filter((x) => x.by === by);
  const sameSet = (xs, ys) => xs.length === ys.length && xs.every((x) => ys.includes(x));

  let shape = await formParty();
  note("party start shape", { persons: (shape.hasA ? 1 : 0) + (shape.hasB ? 1 : 0), summonMembers: shape.summonMembers, deployed: shape.deployed, staleCombatFlag: shape.staleCombat });
  check("fixtures: both summoners are members of the party, its token on the field, the party delving", shape.hasA && shape.hasB && shape.partyTokenUuid && shape.onScene && shape.delving, { delving: shape.delving, onScene: shape.onScene });
  if (shape.deployed) throw new Error("members of the party stand deployed from a run that did not recall them");
  check("the Player seat views the field without activating it", await run(player, P.view, { sceneId }));
  check("the GM seat views the field", await run(gm, P.view, { sceneId }));
  // A past run's creatures are dismissed through the cast menu, as the recipe says, never swept.
  let lead = await st();
  if (lead.summons.length || lead.loose) {
    note("leftover creatures dismissed through the cast menu", { members: lead.summons.length, tokens: lead.loose });
    await dismissThroughMenu(aId);
    await dismissThroughMenu(bId);
    lead = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => !s.summons.length && !s.loose, { tries: 30, every: 300 });
  }
  check("start: the party holds the two summoners and no summon members, none loose on the field", lead.persons === 2 && lead.summons.length === 0 && lead.loose === 0, { persons: lead.persons, summons: lead.summons.length, loose: lead.loose });
  if (lead.summons.length || lead.loose) throw new Error("leftover creatures survived the cast-menu dismissal");
  const copiesBefore = await run(gm, P.copiesOf, { sourceUuid: spikeUuid });
  const messagesBefore = await run(gm, P.messageIds);
  await run(player, P.drain);
  await run(gm, P.drain);

  /* ---------------------------------------------------------------- */
  section("1. a cast of two joins as two members, and no creature token stands on the field");
  const s1pre = await st();
  check("1: start shape: no creature stands, both summoners in the party, delving", s1pre.summons.length === 0 && s1pre.loose === 0 && s1pre.hasA && s1pre.hasB && s1pre.delving && s1pre.partyToken);
  const s1 = await placeCast({ tag: "1", actorId: aId, label: `Cast ${nameA}`, count: 2, joined: (s) => ofCast(s, aUuid).length >= 2 });
  const copies = await run(gm, P.copiesOf, { sourceUuid: spikeUuid });
  if (!copiesBefore.length) for (const uuid of copies) await track(uuid, "Actor");
  const copyId = String(copies[0] ?? "").split(".").pop();
  const mine1 = ofCast(s1, aUuid);
  check("1: no creature token stands on the scene", s1.loose === 0 && s1.deployedTokens === 0, { loose: s1.loose });
  check("1: the party record holds two summon members under distinct ids, the world copy named as the base", mine1.length === 2 && new Set(mine1.map((x) => x.id)).size === 2 && copies.length === 1 && mine1.every((x) => x.base === copyId && x.id !== copyId), { members: mine1.length });
  const castA1 = mine1[0]?.cast ?? "";
  check("1: each stash carries the summoner flag and one cast record naming the spell", mine1.every((x) => x.by === aUuid && x.cast === castA1 && x.spell === spellAId) && !!castA1);
  check("1: each stash carries the Player's ownership", mine1.every((x) => x.own >= 3), { levels: mine1.map((x) => x.own) });
  check("1: the summoners stay the party's two persons, and the creatures are no persons", s1.persons === 2 && s1.hasA && s1.hasB);
  const rec1 = await registerCast("A1", aId, castA1);
  check("1: the cast left one caster record", rec1.length === 1 && rec1[0].role === "caster");
  await run(player, P.view, { sceneId });
  const rows1 = await until(player, P.magicRows, { actorId: aId, spellIds: [spellAId] }, (r) => r[0]?.face === "2 standing", { tries: 20, every: 400 });
  check("1: the Magic tab reads 2 standing, with a tooltip and a Dismiss", rows1[0].row && rows1[0].face === "2 standing" && rows1[0].tipped && rows1[0].dismiss, rows1[0]);
  await run(player, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("2. a combat with the party token deploys them with their flags, ownership and hit points");
  const shapedHp = await run(gm, P.setStashHp, { fid, value: SHAPED_HP });
  const s2pre = await st();
  check("2: start shape: two summons stashed inside the party token at a known, living hit-point figure, no combat", shapedHp === 2 && s2pre.summons.length === 2 && s2pre.summons.every((x) => x.stashed && x.hp === SHAPED_HP) && !s2pre.combat && s2pre.deployedTokens === 0);
  const ids2 = s2pre.summons.map((x) => x.id);
  const pids = await run(gm, P.partyIds, { fid });
  const combatUuid = await run(gm, P.startCombat, { sceneId, tokenId: pids.tokenId, actorId: pids.actorId });
  await track(combatUuid, "Combat");
  const s2 = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => s.combat && s.deployedTokens >= 2 && ofCast(s, aUuid).every((x) => x.deployed), { tries: 60, every: 300 });
  const mine2 = ofCast(s2, aUuid);
  check("2: the party record holds the combat, and both creatures stand deployed as members", s2.combat && mine2.length === 2 && mine2.every((x) => x.deployed) && sameSet(mine2.map((x) => x.id), ids2), { deployed: s2.deployedTokens });
  check("2: the deployed tokens carry the summoner flag and the one cast record", mine2.every((x) => x.by === aUuid && x.cast === castA1 && x.spell === spellAId));
  check("2: the deployed tokens carry the Player's ownership", mine2.every((x) => x.own >= 3), { levels: mine2.map((x) => x.own) });
  check("2: the deployed tokens carry the hit points their stashes held", mine2.every((x) => x.hp === SHAPED_HP), { hp: mine2.map((x) => x.hp) });
  check("2: every creature token on the field is a member's: none loose", s2.loose === 0);

  /* ---------------------------------------------------------------- */
  section("3. the combat's end recalls them, and the hit-point window on one stashed creature changes that creature alone");
  const ended = await sweepNow([combatUuid]);
  note("combat ended (removed, missing, failed)", [ended.removed.length, ended.missing.length, ended.failed.length]);
  const s3pre = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => !s.combat && s.deployedTokens === 0 && s.personDeployed === 0, { tries: 80, every: 300 });
  const mine3 = ofCast(s3pre, aUuid);
  check("3: start shape: the combat is over, both creatures are back inside the party token with their flags, none on the field", !s3pre.combat && mine3.length === 2 && mine3.every((x) => x.stashed && x.by === aUuid && x.cast === castA1 && x.own >= 3) && sameSet(mine3.map((x) => x.id), ids2) && s3pre.loose === 0, { stashed: mine3.filter((x) => x.stashed).length });
  check("3: neither creature was carried or counted down: both still members at their hit points", mine3.every((x) => x.hp === SHAPED_HP));
  const target3 = mine3[0].id;
  const hp3 = await run(gm, P.hpWindow, { partyId, fid, key: `party.${fid}.${target3}`, mode: "damage", amount: 1 });
  for (const uuid of hp3.cards ?? []) await track(uuid, "ChatMessage");
  check("3: the party sheet's hit-point cell opens the window", hp3.opened && hp3.viaSheet, { viaSheet: hp3.viaSheet });
  check("3: one row is ticked and Apply is live", hp3.picked === 1 && hp3.live, { picked: hp3.picked, rows: hp3.rows });
  const s3 = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => ofCast(s, aUuid).some((x) => x.hp !== SHAPED_HP), { tries: 30, every: 300 });
  const after3 = ofCast(s3, aUuid);
  check("3: only the ticked creature's stash changed, by the amount", after3.length === 2 && after3.find((x) => x.id === target3)?.hp === SHAPED_HP - 1 && after3.filter((x) => x.id !== target3).every((x) => x.hp === SHAPED_HP), { hp: after3.map((x) => x.hp) });
  check("3: the two persons' own hit points did not change", s3.personHp.a === s3pre.personHp.a && s3.personHp.b === s3pre.personHp.b);

  /* ---------------------------------------------------------------- */
  section("4. the second summoner casts for the same creature; the first summoner's Dismiss removes its own two and leaves the second's");
  const s4pre = await st();
  check("4: start shape: the first summoner's two stand, the second summoner's none, no combat", ofCast(s4pre, aUuid).length === 2 && ofCast(s4pre, bUuid).length === 0 && !s4pre.combat);
  const s4 = await placeCast({ tag: "4", actorId: bId, label: `Cast ${nameB}`, count: 2, joined: (s) => ofCast(s, bUuid).length >= 2 });
  const mineB = ofCast(s4, bUuid);
  const castB1 = mineB[0]?.cast ?? "";
  check("4: the second summoner's two join as members under their own distinct ids, flagged to it, of a cast of their own", mineB.length === 2 && new Set(mineB.map((x) => x.id)).size === 2 && mineB.every((x) => x.by === bUuid && x.cast === castB1 && x.own >= 3 && x.base === copyId) && !!castB1 && castB1 !== castA1);
  check("4: the two summoners' creatures are four distinct members", new Set(s4.summons.map((x) => x.id)).size === 4);
  await registerCast("B1", bId, castB1);
  const idsB1 = mineB.map((x) => x.id);
  await run(player, P.clearWindows);
  const m4 = await run(player, P.menu, { actorId: aId });
  check("4: the first summoner's cast menu counts its own two for the named spell, not four", m4.items.includes(`Dismiss ${nameA} (2)`) && !m4.items.some((l) => l.includes("(4)")));
  check("4: Dismiss is picked and the confirmation answered Yes", (await run(player, P.pick, { label: `Dismiss ${nameA} (2)` })) && (await run(player, P.confirm, { action: "yes" })));
  const s4b = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => ofCast(s, aUuid).length === 0, { tries: 40, every: 300 });
  check("4: the first summoner's two are gone and the second summoner's two stand, the same members", ofCast(s4b, aUuid).length === 0 && sameSet(ofCast(s4b, bUuid).map((x) => x.id), idsB1) && s4b.loose === 0, { a: ofCast(s4b, aUuid).length, b: ofCast(s4b, bUuid).length });

  /* ---------------------------------------------------------------- */
  section("5. a hand-deleted deployed creature is not restored by the recall");
  await run(gm, P.setStashHp, { fid, value: SHAPED_HP });
  const s5pre = await st();
  check("5: start shape: the second summoner's two stashed inside the party token at a living hit-point figure, none deployed, no combat", ofCast(s5pre, bUuid).length === 2 && ofCast(s5pre, bUuid).every((x) => x.stashed && x.hp === SHAPED_HP) && s5pre.deployedTokens === 0 && !s5pre.combat);
  const results5 = [];
  for (const id of idsB1) results5.push(await run(gm, P.toggleDetach, { fid, actorId: id }));
  const s5a = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => s.deployedTokens === 2, { tries: 40, every: 300 });
  check("5: both are deployed as detached members, each its own token", results5.every((r) => r === "detached") && s5a.deployedTokens === 2 && s5a.loose === 0, { results: results5.length });
  const victim = idsB1[0];
  const survivor = idsB1[1];
  const victimToken = await run(gm, P.deployedUuid, { fid, actorId: victim });
  await track(victimToken, "Token");
  const deleted = await sweepNow([victimToken]);
  check("5: the token is deleted by hand", deleted.removed.length === 1, { removed: deleted.removed.length });
  const s5b = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => ofCast(s, bUuid).length === 1, { tries: 40, every: 300 });
  check("5: the deleted creature's member record is gone with it, the other still deployed", ofCast(s5b, bUuid).length === 1 && ofCast(s5b, bUuid)[0].id === survivor && ofCast(s5b, bUuid)[0].deployed, { members: ofCast(s5b, bUuid).length });
  const recalled = await run(gm, P.toggleDetach, { fid, actorId: survivor });
  await sleep(2000);
  const s5c = await st();
  check("5: the recall brings the other back inside the party token", recalled === "recalled" && ofCast(s5c, bUuid).length === 1 && ofCast(s5c, bUuid)[0].stashed && s5c.deployedTokens === 0);
  check("5: nothing restores the deleted creature: no record under its id, no token on the field", !s5c.summons.some((x) => x.id === victim) && s5c.loose === 0, { members: s5c.summons.length, loose: s5c.loose });

  /* ---------------------------------------------------------------- */
  section("6. a creature at 0 hit points, stashed and deployed, ends as a dismissal ends it");
  const s6pre = await st();
  check("6: start shape: one of the second summoner's creatures, stashed at a living hit-point figure", ofCast(s6pre, bUuid).length === 1 && ofCast(s6pre, bUuid)[0].stashed && ofCast(s6pre, bUuid)[0].hp > 0 && !s6pre.combat);
  const hpStashed = await run(gm, P.hpWindow, { partyId, fid, key: `party.${fid}.${survivor}`, mode: "damage", amount: 99 });
  for (const uuid of hpStashed.cards ?? []) await track(uuid, "ChatMessage");
  check("6: the hit-point window ticks that one creature and Apply is live", hpStashed.opened && hpStashed.picked === 1 && hpStashed.live, { picked: hpStashed.picked });
  const s6a = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => ofCast(s, bUuid).length === 0, { tries: 40, every: 300 });
  check("6: stashed, at 0: no member record, no token, the creature is no person to carry", ofCast(s6a, bUuid).length === 0 && s6a.loose === 0 && s6a.persons === 2 && s6a.personDeployed === 0, { members: ofCast(s6a, bUuid).length });
  // The recipe leaves one creature after step 5, so the deployed half needs more: B casts again (labelled setup).
  const s6b = await placeCast({ tag: "6 (setup cast of three)", actorId: bId, label: `Cast ${nameB}`, count: 3, joined: (s) => ofCast(s, bUuid).length >= 3 });
  const mineB2 = ofCast(s6b, bUuid);
  const castB2 = mineB2[0]?.cast ?? "";
  const ok6b = mineB2.length === 3 && mineB2.every((x) => x.cast === castB2 && x.by === bUuid) && !!castB2 && castB2 !== castB1;
  check("6: the setup cast stands as three members of a cast of its own", ok6b, { members: mineB2.length, loose: s6b.loose, all: s6b.summons.length, sameCast: castB2 === castB1, warns: await run(player, P.takeWarns) });
  if (!ok6b) throw new Error("step 6's setup cast did not join; the steps after it need its three members");
  await registerCast("B2", bId, castB2);
  await run(gm, P.setStashHp, { fid, value: SHAPED_HP });
  const idsB2 = mineB2.map((x) => x.id);
  const rows6 = await until(player, P.magicRows, { actorId: bId, spellIds: [spellBId] }, (r) => r[0]?.face === "3 standing", { tries: 20, every: 400 });
  check("6: the Magic tab reads 3 standing for the second summoner", rows6[0].face === "3 standing", { face: rows6[0].face });
  await run(player, P.clearWindows);
  const departed = await run(gm, P.toggleDetach, { fid, actorId: idsB2[0] });
  const s6c = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => s.deployedTokens === 1, { tries: 40, every: 300 });
  check("6: start shape: one is deployed as a token with hit points above 0, two stashed", departed === "detached" && s6c.deployedTokens === 1 && ofCast(s6c, bUuid).find((x) => x.id === idsB2[0])?.hp === SHAPED_HP && ofCast(s6c, bUuid).filter((x) => x.stashed).length === 2);
  const liveToken = await run(gm, P.deployedUuid, { fid, actorId: idsB2[0] });
  const hpDeployed = await run(gm, P.hpWindow, { tokenUuid: liveToken, mode: "damage", amount: 99 });
  for (const uuid of hpDeployed.cards ?? []) await track(uuid, "ChatMessage");
  check("6: the hit-point window opened on the live token has one row ticked and Apply live", hpDeployed.opened && hpDeployed.picked === 1 && hpDeployed.live, { picked: hpDeployed.picked });
  const s6d = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => ofCast(s, bUuid).length === 2, { tries: 40, every: 300 });
  check("6: deployed, at 0: no member record, no token on the field, the other two still held", ofCast(s6d, bUuid).length === 2 && !ofCast(s6d, bUuid).some((x) => x.id === idsB2[0]) && s6d.loose === 0 && s6d.deployedTokens === 0 && ofCast(s6d, bUuid).every((x) => x.stashed), { held: ofCast(s6d, bUuid).length });
  check("6: the persons' counts are unchanged: no creature was carried or counted down as a casualty", s6d.persons === 2 && s6d.personDeployed === 0);

  /* ---------------------------------------------------------------- */
  section("7. the clock passes the named spell's duration: the end card counts the held creatures and its Dismiss empties them");
  const s7pre = await st();
  check("7: start shape: two held creatures of the second summoner's latest cast, none standing for the earlier casts", ofCast(s7pre, bUuid).length === 2 && ofCast(s7pre, bUuid).every((x) => x.cast === castB2 && x.stashed) && ofCast(s7pre, aUuid).length === 0);
  const t0 = await run(gm, P.advance, { seconds: 0 });
  check("7: no end card stands for the latest cast before the clock moves", (await run(gm, P.endedCards, { castId: castB2, playerId })).length === 0);
  const t1 = await run(gm, P.advance, { seconds: 61 });
  note("7: world clock moved forward (s)", t1 - t0);
  const cards7 = await until(gm, P.endedCards, { castId: castB2, playerId }, (c) => c.length >= 1, { tries: 40, every: 250 });
  for (const c of cards7) await track(c.uuid, "ChatMessage");
  check("7: one end card for the latest cast, whispered to the Player and the GM", cards7.length === 1 && cards7[0].whispered && cards7[0].toPlayer && cards7[0].toGM, { n: cards7.length });
  const numbers7 = cards7[0] ? await run(gm, P.cardNumbers, { messageId: cards7[0].id }) : [];
  check("7: the card counts the two held creatures", numbers7.includes(2) && !numbers7.includes(3), { numbers: numbers7 });
  const earlier7 = [];
  for (const label of ["A1", "B1"]) earlier7.push((await run(gm, P.endedCards, { castId: casts.get(label), playerId })).length);
  check("7: the earlier casts, whose creatures no longer stand, post no card", earlier7.every((n) => n === 0), { cards: earlier7 });
  check("7: the creatures still stand: the card tells, it does not remove", ofCast(await st(), bUuid).length === 2);
  const seen7 = await run(player, P.endedCards, { castId: castB2, playerId });
  check("7: the Player seat sees the card", seen7.length === 1 && seen7[0].visible);
  // The card's Dismiss follows ownership of the caster: the Player owns it, so the Player seat draws it as the GM seat does (only a creature whose control ended hostile is the Judge's alone, and this spell's end is not).
  const press7p = await run(player, P.pressCardDismiss, { messageId: cards7[0]?.id ?? "" });
  check("7: the card's Dismiss is drawn on the Player seat, which owns the caster, and pressed", press7p.button);
  check("7: the Player's confirmation is answered No", await run(player, P.confirm, { action: "no" }));
  check("7: the Player's No removes nothing", ofCast(await st(), bUuid).length === 2);
  const press7 = await run(gm, P.pressCardDismiss, { messageId: cards7[0]?.id ?? "" });
  check("7: the card's Dismiss is also rendered on the GM seat and pressed", press7.button);
  check("7: the GM's confirmation is answered No", await run(gm, P.confirm, { action: "no" }));
  check("7: No removes nothing", ofCast(await st(), bUuid).length === 2);
  const press7b = await run(player, P.pressCardDismiss, { messageId: cards7[0]?.id ?? "" });
  check("7: the Player presses the card's Dismiss again", press7b.button);
  check("7: the Player's confirmation is answered Yes", await run(player, P.confirm, { action: "yes" }));
  const s7 = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => s.summons.length === 0, { tries: 40, every: 300 });
  check("7: the held creatures are gone: no member, no token", s7.summons.length === 0 && s7.loose === 0, { members: s7.summons.length });

  /* ---------------------------------------------------------------- */
  section("8. the second summoner leaves the party (creatures restored with their flags) and rejoins (creatures gathered back in)");
  const s8pre = await st();
  check("8: start shape: both summoners in the party, no creature held, no combat", s8pre.hasA && s8pre.hasB && s8pre.summons.length === 0 && !s8pre.combat);
  const s8cast = await placeCast({ tag: "8 (setup cast of two)", actorId: bId, label: `Cast ${nameB}`, count: 2, joined: (s) => ofCast(s, bUuid).length >= 2 });
  const castB3 = ofCast(s8cast, bUuid)[0]?.cast ?? "";
  await registerCast("B3", bId, castB3);
  check("8: the setup cast stands as two held members of a cast of its own", ofCast(s8cast, bUuid).length === 2 && !!castB3 && ![castA1, castB1, castB2].includes(castB3));
  const access = await until(player, P.access, { partyId }, (a) => a.owns, { tries: 20, every: 300 });
  check("8: the Player seat owns the party, so its sheet opens", access.owns, access);
  await run(player, P.clearWindows);
  const opened = await run(player, P.openParty, { partyId, tab: "order" });
  const leaveSelector = `li.member[data-actor-id="${bId}"] [data-action="removeMember"]`;
  const left = await run(player, P.press, { partyId, selector: leaveSelector });
  check("8: the Order tab's take-out control for the second summoner is on the sheet and live", opened.rendered && left.found && !left.disabled, left);
  if (!left.found || left.disabled) {
    // The sheet did not offer the control: the same take-out as the sheet's own handler writes, so the later steps still run.
    await run(gm, async ({ fid: id, bId: b }) => { const H = globalThis.__ff; await H.model.removeMember(H.model.getFormation(id), b); }, { fid, bId });
  }
  const s8a = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => !s.hasB && s.summons.length === 0, { tries: 50, every: 300 });
  check("8: the second summoner and its creatures are out of the party's record", !s8a.hasB && s8a.summons.length === 0 && s8a.hasA, { persons: s8a.persons });
  const restored = await run(gm, P.looseTokens, { fid, sceneId });
  for (const t of restored) await track(t.uuid, "Token");
  for (const uuid of await run(gm, P.tokensOf, { sceneId, actorIds: [bId] })) await track(uuid, "Token");
  check("8: both creatures stand on the field again, as tokens of the one cast", restored.length === 2 && restored.every((t) => t.cast === castB3), { n: restored.length });
  check("8: the restored tokens carry the summoner flag and the Player's ownership", await run(gm, async ({ uuids, by, playerId: pid }) => {
    const docs = await Promise.all(uuids.map((u) => fromUuid(u)));
    return docs.length > 0 && docs.every((d) => d?.actor?.getFlag("acks-extras", "summonedBy") === by && (d.toObject().delta?.ownership?.[pid] ?? 0) >= 3);
  }, { uuids: restored.map((t) => t.uuid), by: bUuid, playerId }));
  // Rejoin by the Order tab's list, where the second summoner appears once it stands in no party.
  await sleep(800);
  const joinSelector = `[data-action="bringIn"][data-actor-id="${bId}"]`;
  let joined = { found: false };
  for (let n = 0; n < 20 && !joined.found; n++) {
    joined = await run(player, P.press, { partyId, selector: joinSelector, settle: 100 });
    if (!joined.found) await sleep(400);
  }
  check("8: the Order tab's list offers the second summoner and the press is live", joined.found && !joined.disabled, joined);
  if (!joined.found || joined.disabled) {
    await run(gm, async ({ fid: id, bId: b }) => { const H = globalThis.__ff; await H.model.addMember(H.model.getFormation(id), game.actors.get(b), null, { scene: game.scenes.viewed }); }, { fid, bId });
  }
  const s8b = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => s.hasB && ofCast(s, bUuid).length >= 2 && s.loose === 0, { tries: 60, every: 300 });
  check("8: the second summoner is back and its two creatures are gathered back in as members of the same cast, none on the field", s8b.hasB && ofCast(s8b, bUuid).length === 2 && ofCast(s8b, bUuid).every((x) => x.cast === castB3 && x.stashed && x.own >= 3) && s8b.loose === 0, { members: ofCast(s8b, bUuid).length, loose: s8b.loose });
  await run(player, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("9. a disband restores every member, the creatures with their flags");
  const s9pre = await st();
  check("9: start shape: both summoners and the second summoner's two held creatures, no combat", s9pre.hasA && s9pre.hasB && ofCast(s9pre, bUuid).length === 2 && !s9pre.combat && s9pre.loose === 0);
  await run(gm, P.clearWindows);
  const open9 = await run(gm, P.openParty, { partyId, tab: "order" });
  const press9 = await run(gm, P.press, { partyId, selector: '[data-action="disband"]', settle: 400 });
  check("9: the party sheet's Disband is pressed", open9.rendered && press9.found && !press9.disabled);
  check("9: the confirmation is answered Yes", await run(gm, P.confirm, { action: "yes" }));
  const gone9 = await until(gm, P.state, { fid, sceneId, playerId, aId, bId }, (s) => s.gone, { tries: 50, every: 300 });
  check("9: the party's record is gone", gone9.gone === true);
  await sleep(1500);
  const afterDisband = await run(gm, P.looseTokens, { fid, sceneId });
  for (const t of afterDisband) await track(t.uuid, "Token");
  check("9: both creatures stand on the field with the summoner flag, of the one cast", afterDisband.length === 2 && afterDisband.every((t) => t.cast === castB3), { n: afterDisband.length });
  check("9: the creatures' tokens carry the summoner flag and the Player's ownership", await run(gm, async ({ uuids, by, playerId: pid }) => {
    const docs = await Promise.all(uuids.map((u) => fromUuid(u)));
    return docs.length > 0 && docs.every((d) => d?.actor?.getFlag("acks-extras", "summonedBy") === by && (d.toObject().delta?.ownership?.[pid] ?? 0) >= 3);
  }, { uuids: afterDisband.map((t) => t.uuid), by: bUuid, playerId }));
  const persons9 = await run(gm, P.tokensOf, { sceneId, actorIds: [aId, bId] });
  for (const uuid of persons9) await track(uuid, "Token");
  check("9: the party token and the party actor are gone, and both summoners' tokens stand on the field", !(await run(gm, async ({ id }) => !!game.actors.get(id), { id: partyId })) && persons9.length === 2, { tokens: persons9.length });
  // Re-form: the creatures are swept first, or the second summoner's joining would gather them into the new party.
  const clearedCreatures = await sweepNow(afterDisband.map((t) => t.uuid));
  note("9: restored creature tokens removed (removed, missing, failed)", [clearedCreatures.removed.length, clearedCreatures.missing.length, clearedCreatures.failed.length]);
  const party2 = await gm.fixture("summons/party", "Actor", { name: PARTY_NAME, type: `${SCOPE}.party` });
  partyId = idOf(party2);
  fid = (await run(gm, P.formationOf, { partyId })).fid;
  shape = await formParty();
  check("9: the party is re-formed: both summoners in it, the party token marked again, no summon members", shape.hasA && shape.hasB && !!shape.partyTokenUuid && shape.summonMembers === 0 && shape.onScene, { persons: 2 });

  /* ---------------------------------------------------------------- */
  section("10. the creature's world copy and a creature token of a caster outside the party are refused on the party sheet");
  const s10pre = await st();
  check("10: start shape: the party holds the two summoners and no summon members, the creature's world copy exists", s10pre.persons === 2 && s10pre.summons.length === 0 && !!copyId && !!(await run(gm, async ({ id }) => !!game.actors.get(id), { id: copyId })));
  const expected = await run(gm, P.expectedWarns, { copyId });
  await run(gm, P.clearWindows);
  await run(gm, P.openParty, { partyId, tab: "order" });
  await run(gm, P.takeWarns);
  const warnsCopy = await run(gm, P.drop, { partyId, data: { type: "Actor", uuid: `Actor.${copyId}` } });
  const s10a = await st();
  check("10: the world copy is refused with the warning", warnsCopy.includes(expected.copy) && s10a.persons === 2 && s10a.summons.length === 0, { warnings: warnsCopy.length });
  const outsider = await run(gm, P.outsiderToken, { sceneId, copyId, outsiderId: idOf(stranger) });
  await track(outsider, "Token");
  const warnsToken = await run(gm, P.drop, { partyId, data: { type: "Token", uuid: outsider } });
  const s10b = await st();
  check("10: a creature token of a caster outside the party is refused with the warning, still on the field, joined by nobody", warnsToken.includes(expected.absent) && s10b.summons.length === 0 && s10b.persons === 2 && (await run(gm, P.tokenThere, { uuid: outsider })), { warnings: warnsToken.length });
  await run(gm, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("what the table saw");
  for (const uuid of await run(gm, P.newMessages, { since: messagesBefore, speakers: [aId, bId], casterUuids: [aUuid, bUuid], partyName: PARTY_NAME })) await track(uuid, "ChatMessage");
  const pEnd = await run(player, P.drain);
  const gEnd = await run(gm, P.drain);
  check("no console error or uncaught error on the Player seat over the walk", !pEnd.errors.length && !pEnd.uncaught.length, { errors: pEnd.errors.length, uncaught: pEnd.uncaught.length });
  check("no console error or uncaught error on the GM seat over the walk", !gEnd.errors.length && !gEnd.uncaught.length, { errors: gEnd.errors.length, uncaught: gEnd.uncaught.length });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // Creatures a stopped run left in the party: released by the run's own cast ids, never by name or kind.
  try {
    if (gm && fid && casts.size) note("this run's casts cleared (released, deleted)", await run(gm, P.clearCasts, { fid, sceneId: await gm.eval(`game.scenes.find((s) => s.flags?.world?.fixture === ${JSON.stringify(MACHINE.own ? "summons/scene@" + MACHINE.own : "summons/scene")})?.id ?? null`), castIds: [...casts.values()] }));
  } catch (err) { console.error("clear casts:", err?.message ?? err); }
  // The ledger also holds any fixture `fixture` built or marked this run; only the run's own tokens, cards, records and copies go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  if (gm && wasPaused) {
    try { note("paused again", await run(gm, P.pause, { paused: true })); } catch (err) { console.error("pause restore:", err?.message ?? err); }
  }
  console.log("fixtures kept: summons/scene, summons/summoner-a, summons/spell-named-a, summons/spike-source, summons/stranger, summons/party, summons/party-token, summons/summoner-b, summons/spell-named-b");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
