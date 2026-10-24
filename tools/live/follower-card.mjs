/**
 * Live walk, follower card: docs/lib/TESTING.md step 9 — the follower's own
 * sheet on the frame (band in the header, three columns), the star, the two
 * fields the features set through FOLLOWER_CARD_HOOK (the saves-as line, the
 * pending dot), the employer's controls drawn by ownership on the compact
 * card, and an attack row that throws from the row and from its die.
 * Machine values arrive through ./_env.mjs; nothing here names a port, a
 * world, a seat or a book. Every figure typed into a fixture is invented.
 *
 * Writes outside the fixture ledger: none. The three actors and the item are
 * `api.create`d; the chat messages the two throws post are tracked by the ids
 * a create observer reads back for the beast's own speaker, the moment each
 * resolves. The player seat is given observer ownership of an actor this run
 * made, which the sweep removes with it.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "f" + Math.random().toString(36).slice(2, 8);
const MOD = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async (mod) => ({
    foundry: game.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    card: typeof acksExtras.lib?.followerCard?.Sheet,
    hook: acksExtras.lib?.followerCard?.HOOK ?? null,
    skipKey: (() => { try { return game.settings.get("acks", "skip-dialog-key") || null; } catch { return null; } })(),
  }),

  install: async () => {
    const H = (globalThis.__fc1 = globalThis.__fc1 ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.apps = () => [...foundry.applications.instances.values()];
    H.appBy = (cls, actorId) => H.apps().find((a) => H.root(a)?.classList?.contains(cls) && (!actorId || a.actor?.id === actorId)) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.opened = [];
    H.closeAll = async () => {
      let n = 0;
      for (const app of H.opened) { try { await app.close({ force: true }); n++; } catch {} }
      H.opened = [];
      return n;
    };
    // The compact card as the walk reads it.
    H.card = (el) => ({
      readonly: el.classList.contains("readonly"),
      nameButton: !!el.querySelector(".acks-lib-follower-card__name[data-action='hirelingShow']"),
      dot: el.querySelector(".acks-lib-follower-card__name .acks-extras-frame__dot")?.dataset.tooltip ?? null,
      rank: H.text(el.querySelector(".acks-lib-follower-card__rank")),
      dismiss: !!el.querySelector("[data-action='hirelingDelete']"),
      rolls: [...el.querySelectorAll(".acks-lib-follower-card__fact.is-roll")].map((b) => b.dataset.action),
      facts: el.querySelectorAll(".acks-lib-follower-card__fact").length,
      rows: [...el.querySelectorAll(".acks-lib-follower-card__row .acks-extras-frame__row-label")].map((s) => H.text(s)),
      inputs: el.querySelectorAll("[name]").length,
    });
    return "installed";
  },

  /** The hook's two inputs and the hireling link, on the run's own fixtures. */
  wire: async ({ employerId, henchId, beastId, playerName }) => {
    const employer = game.actors.get(employerId);
    const hench = game.actors.get(henchId);
    const beast = game.actors.get(beastId);
    // Core keeps the employer's roster as its own list: the retainer fields
    // alone do not place a hireling in the buckets.
    await hench.update({ "system.retainer": { enabled: true, managerid: employer.id, category: "henchman", wage: "5", quantity: 1 } });
    await employer.addHenchman(hench.id);
    await hench.update({ [`flags.acks-extras.record.special.pendingCalamity`]: true });
    await employer.setFlag("acks-extras", "monsterHenchmenList", [beast.id]);
    const player = game.users.find((u) => u.name === playerName);
    if (player) await employer.update({ ownership: { ...employer.ownership, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
    const config = await import(`/modules/acks-extras/scripts/monsters/config.mjs`);
    const extras = beast.getFlag("acks-extras", "extras");
    return {
      hirelings: Object.fromEntries(Object.entries(employer.getHirelings?.() ?? {}).map(([k, v]) => [k, (v ?? []).map((h) => h?._id ?? h?.id)])),
      pending: hench.getFlag("acks-extras", "record")?.special?.pendingCalamity ?? null,
      saveAs: extras?.saveAs ?? null,
      expectedSavesAs: extras?.saveAs?.class ? game.i18n.format("ACKS-MONSTERS.frame.art.savesAs", { cls: game.i18n.localize(config.SAVE_CLASSES[extras.saveAs.class]?.label ?? extras.saveAs.class), level: String(extras.saveAs.level) }) : null,
      player: !!player,
    };
  },

  /** Open the follower's own sheet and read its frame. */
  openCard: async ({ actorId }) => {
    const H = globalThis.__fc1;
    const actor = game.actors.get(actorId);
    const app = new acksExtras.lib.followerCard.Sheet({ document: actor });
    H.opened.push(app);
    app.render(true);
    const root = await H.poll(() => { const r = H.root(H.appBy("acks-lib-follower-card-sheet", actorId)); return r?.querySelector(".acks-lib-follower-card") ? r : null; });
    if (!root) return { rendered: false };
    return {
      rendered: true,
      frame: root.classList.contains("acks-extras-frame"),
      bandInHeader: !!root.querySelector(".window-header .acks-extras-frame__band"),
      bandInBody: !!root.querySelector(".window-content .acks-extras-frame__band"),
      nameInHeader: !!root.querySelector(".window-header .acks-extras-frame__name"),
      rank: H.text(root.querySelector(".acks-extras-frame__rank")),
      chips: [...root.querySelectorAll(".window-header .acks-extras-frame__chip")].map((c) => c.dataset.action),
      editable: !!root.querySelector(".acks-lib-follower-card:not(.readonly)"),
      cols3: !!root.querySelector(".acks-lib-follower-card .acks-extras-frame__cols.is-3"),
      stars: [...root.querySelectorAll("[data-action='fcStar']")].map((b) => b.dataset.itemId),
      attackRows: root.querySelectorAll(".acks-extras-frame__row.is-roll[data-action='fcRollAttack']").length,
      expandButton: !!root.querySelector(".window-header .acks-lib-fc-expand"),
      scrollContract: root.classList.contains("acks-extras-scroll"),
      width: root.getBoundingClientRect().width,
    };
  },

  /** Press the star on one power and read the flag and the pressed state back. */
  star: async ({ actorId, itemId }) => {
    const H = globalThis.__fc1;
    const actor = game.actors.get(actorId);
    const app = H.appBy("acks-lib-follower-card-sheet", actorId);
    const btn = H.root(app)?.querySelector(`[data-action='fcStar'][data-item-id='${itemId}']`);
    if (!btn) return { found: false };
    const before = actor.getFlag("acks-extras", "fcStarred") ?? [];
    btn.click();
    const flag = await H.poll(() => { const f = actor.getFlag("acks-extras", "fcStarred") ?? []; return f.includes(itemId) ? f : null; });
    const pressed = await H.poll(() => { const b = H.root(app)?.querySelector(`[data-action='fcStar'][data-item-id='${itemId}']`); return b?.getAttribute("aria-pressed") === "true" ? true : null; });
    return { found: true, before, flag, pressed: !!pressed };
  },

  /**
   * Throw the first attack row twice: once from the row's text, once from its
   * die, both with the seat's skip-dialog key held. The messages the beast
   * posts are read back from a create observer scoped to its speaker, and
   * returned for the ledger.
   */
  rollAttack: async ({ actorId }) => {
    const H = globalThis.__fc1;
    const app = H.appBy("acks-lib-follower-card-sheet", actorId);
    const row = H.root(app)?.querySelector(".acks-extras-frame__row.is-roll[data-action='fcRollAttack']");
    if (!row) return { found: false };
    const die = row.querySelector("button[data-action='fcRollAttack']");
    const same = !!die && ["attack", "itemId", "label"].every((k) => (die.dataset[k] ?? "") === (row.dataset[k] ?? ""));
    const skipKey = (() => { try { return game.settings.get("acks", "skip-dialog-key") || null; } catch { return null; } })();
    const posted = [];
    const id = Hooks.on("createChatMessage", (m) => { if (m.speaker?.actor === actorId) posted.push(m.id); });
    const press = async (el) => {
      const seen = posted.length;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...(skipKey ? { [skipKey]: true } : {}) }));
      // A dialog instead of a throw: answer its default once, so the walk
      // reports the throw and not the dialog.
      const got = await H.poll(async () => {
        if (posted.length > seen) return true;
        const dlg = H.apps().find((a) => a.constructor?.name?.includes("Dialog") && H.root(a)?.isConnected);
        if (dlg) { (H.root(dlg).querySelector("button.default, button[type='submit'], .dialog-button") ?? null)?.click(); }
        return null;
      }, { tries: 40, every: 200 });
      return !!got;
    };
    const fromRow = await press(row.querySelector(".acks-extras-frame__row-line") ?? row);
    const fromDie = die ? await press(die) : false;
    Hooks.off("createChatMessage", id);
    return { found: true, same, fromRow, fromDie, posted, rolls: posted.map((m) => game.messages.get(m)?.rolls?.length ?? 0) };
  },

  /** Open the employer's sheet from this module and read the Followers tab's cards. */
  followers: async ({ employerId }) => {
    const H = globalThis.__fc1;
    const employer = game.actors.get(employerId);
    const Cls = CONFIG.Actor.sheetClasses.character?.[`acks-extras.AcksCharacterSheet`]?.cls;
    if (!Cls) return { rendered: false, reason: "sheet class not registered" };
    const app = new Cls({ document: employer });
    H.opened.push(app);
    app.render(true);
    const ready = await H.poll(() => (H.root(app)?.querySelector(".acks-extras-frame__band") ? app : null));
    if (!ready) return { rendered: false, reason: "sheet did not render" };
    app.changeTab("followers", "primary");
    const first = await H.poll(() => H.root(app)?.querySelector(".acks-extras-frame__card[data-actor-id] .acks-lib-follower-card"));
    if (!first) return { rendered: true, cards: {}, reason: "no card rendered" };
    const cards = {};
    for (const wrap of H.root(app).querySelectorAll(".acks-extras-frame__card[data-actor-id]")) {
      const el = wrap.querySelector(".acks-lib-follower-card");
      if (el) cards[wrap.dataset.actorId] = H.card(el);
    }
    return { rendered: true, cards, toolsRow: !!H.root(app).querySelector(".acks-extras-frame__card-tools"), seat: game.user.name === undefined ? null : game.user.role };
  },

  closeAll: async () => globalThis.__fc1?.closeAll?.() ?? 0,
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
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.followerCard?.Sheet && !!globalThis.acksExtras?.henchmen`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let gm = null;
try {
  section("seats");
  gm = await seat("gm");
  const census = await run(gm, P.census, MOD);
  note("gm census", census);
  check("the GM seat is the active GM and the page serves the card with its hook", census.activeGMIsSelf && census.role === 4 && census.card === "function" && typeof census.hook === "string", { role: census.role, module: census.module, hook: census.hook });
  if (!census.activeGMIsSelf) throw new Error("another GM client is the active GM");
  note("install", await run(gm, P.install));

  section("fixtures");
  const employer = await gm.create("Actor", { name: `FC Employer ${NONCE}`, type: "character" });
  const hench = await gm.create("Actor", { name: `FC Hench ${NONCE}`, type: "character" });
  const beast = await gm.create("Actor", { name: `FC Beast ${NONCE}`, type: "monster", flags: { [MOD]: { extras: { saveAs: { class: "fighter", level: 3 } } } } });
  const power = await gm.create("Item", { name: `Keen Nose ${NONCE}`, type: "ability", system: { description: "<p>Tracks by scent across a day's trail. A second sentence the card never shows.</p>" } }, { parent: beast.uuid });
  const wired = await run(gm, P.wire, { employerId: employer.id, henchId: hench.id, beastId: beast.id, playerName: SEATS.player });
  note("wired", wired);
  check("the character hireling is in the employer's henchman bucket and the monster in its list", (wired.hirelings.henchman ?? []).includes(hench.id) && wired.pending === true && wired.saveAs?.class === "fighter", wired.hirelings);

  section("9. the follower's own sheet on the frame");
  const card = await run(gm, P.openCard, { actorId: beast.id });
  note("card", card);
  check("the card sheet carries the frame class and the scroll contract", card.rendered && card.frame && card.scrollContract, { frame: card.frame, scroll: card.scrollContract });
  check("the band is in the window header, with the name field, and not in the body", card.bandInHeader && card.nameInHeader && !card.bandInBody);
  check("the rank reads Hit Dice and the type", /HD/.test(card.rank) && card.rank.includes("·"), card.rank);
  check("the chips are the four tools and Full sheet", ["fcAddAttack", "fcAddSkill", "fcCommit", "fcResetSheet", "fcOpenFull"].every((a) => card.chips.includes(a)), card.chips);
  check("the body is the editable face in three columns", card.editable && card.cols3);
  check("the power has a star and the beast has an attack row", card.stars.includes(power.id) && card.attackRows >= 1, { stars: card.stars.length, attackRows: card.attackRows });
  check("the Expand header button stays beside the band", card.expandButton);

  section("9. the star");
  const starred = await run(gm, P.star, { actorId: beast.id, itemId: power.id });
  note("star", starred);
  check("pressing the star writes the lib flag and the button reads pressed", starred.found && (starred.flag ?? []).includes(power.id) && starred.pressed, starred);

  section("9. the attack row throws from the row and from its die");
  const thrown = await run(gm, P.rollAttack, { actorId: beast.id });
  note("thrown", thrown);
  for (const id of thrown.posted ?? []) gm.track(id, "ChatMessage");
  check("the row and its die name the same attack", thrown.found && thrown.same);
  check("a press on the row's text posts a throw, and a press on the die posts another", thrown.fromRow && thrown.fromDie && (thrown.posted ?? []).length === 2 && thrown.rolls.every((n) => n >= 1), { posted: (thrown.posted ?? []).length, rolls: thrown.rolls });
  note("closed (gm card)", await run(gm, P.closeAll));

  section("9. the compact card on the employer's Followers tab (owner)");
  const owner = await run(gm, P.followers, { employerId: employer.id });
  note("followers (gm)", owner);
  const beastCard = owner.cards?.[beast.id];
  const henchCard = owner.cards?.[hench.id];
  check("both followers render as compact cards with no bound inputs", !!beastCard?.readonly && !!henchCard?.readonly && beastCard.inputs === 0 && henchCard.inputs === 0, { beast: !!beastCard, hench: !!henchCard });
  check("the tab draws no tools row of its own", owner.rendered && owner.toolsRow === false);
  check("the name is a button that opens the follower", !!beastCard?.nameButton && !!henchCard?.nameButton);
  check("the owner gets Dismiss and the two throws on each card", !!beastCard?.dismiss && !!henchCard?.dismiss && ["hirelingMorale", "hirelingLoyalty"].every((a) => beastCard.rolls.includes(a) && henchCard.rolls.includes(a)), { beast: beastCard?.rolls, hench: henchCard?.rolls });
  check("the starred power is listed on the beast's card", !!beastCard && beastCard.rows.includes(`Keen Nose ${NONCE}`), beastCard?.rows);
  check("the saves row reads the monsters feature's saves-as line", !!beastCard && !!wired.expectedSavesAs && beastCard.rows.includes(wired.expectedSavesAs), { expected: wired.expectedSavesAs });
  check("the henchman's name carries the pending dot with the henchmen feature's title", typeof henchCard?.dot === "string" && henchCard.dot.length > 0, henchCard?.dot);
  check("the beast's name carries no dot", !!beastCard && beastCard.dot === null);
  note("closed (gm followers)", await run(gm, P.closeAll));

  section("9. the compact card from a seat that observes the employer");
  const player = await seat("player");
  note("install (player)", await run(player, P.install));
  const viewer = await run(player, P.followers, { employerId: employer.id });
  note("followers (player)", viewer);
  const pBeast = viewer.cards?.[beast.id];
  const pHench = viewer.cards?.[hench.id];
  // A body with no load reading has five facts; a character has six.
  check("the observer sees both cards with their readings", !!pBeast?.readonly && !!pHench?.readonly && pBeast.facts === 5 && pHench.facts === 6, { beast: pBeast?.facts, hench: pHench?.facts });
  check("the observer gets the name button but no Dismiss and no throw buttons", !!pBeast?.nameButton && !pBeast.dismiss && pBeast.rolls.length === 0 && !pHench?.dismiss && pHench?.rolls.length === 0, { beast: pBeast?.rolls, hench: pHench?.rolls });
  note("closed (player)", await run(player, P.closeAll));
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
} finally {
  section("teardown");
  for (const [key, api] of Object.entries(seats)) {
    try { note(`closed (${key})`, await run(api, P.closeAll)); } catch (err) { console.error(`closeAll ${key}:`, err?.message ?? err); }
    try { note(`sweep (${key})`, await api.sweepTracked()); } catch (err) { console.error(`sweep ${key}:`, err?.message ?? err); }
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
