/**
 * Live check, close-role-side: the controls the topic fix-role-side changed
 * (commits 1773c23d and 4483bdfe), on both seats. The governing owner ruling is
 * "players get blocks, judges get warnings": a rule that stops a Player warns
 * a Judge and lets the Judge go on. A GM seat cannot prove an ownership gate,
 * since it owns every document, so each Player-side check runs on the real
 * Player seat after the GM seat makes the Player an Owner or Observer.
 *
 *   T-0814  a Judge's door seal past its range goes ahead with the pick's
 *           out-of-range notice (`checkSealRequest`, `writeSeal`); a Player's
 *           request past the range is still refused. Driven through
 *           `writeSeal`, the function the cast's seal step calls: a Judge's own
 *           pick past the range already sends no range, so the handler's
 *           measure is only reachable through the request, and the walk makes
 *           it. The door pick's click is not driven.
 *   T-0815  `openFollowersDialog` (`followerGate`): a Player below the arrival
 *           level, or with no stronghold, is warned (the level first) and the
 *           class prompt does not open; a Judge hears every notice that applies
 *           and the prompt opens. Stand-in tables go in a layer of the walk's
 *           own, on each seat, and come out at the end.
 *   T-0817  a domain sheet submitted from a non-GM seat keeps the stored
 *           hidden holdings at their indices (`keepHiddenRows`).
 *   T-0821  a posting's employer flips "players see details" from the eye
 *           control (`setPostingDetails`, relayed to the GM client when the seat
 *           does not own the place), the control is drawn to the employer and
 *           the Judge only, and the employer keeps seeing the candidates their
 *           own active posting covers (`candidateMasked`).
 *
 * Fixtures, built by this run under the FIXTURE_OWN tag and swept by its own
 * ledger at the end (every figure and name is invented):
 *   `magic/close-seal-scene`   a gridded scene; walls, the token and the spell
 *                              item are tracked as they are made
 *   `magic/close-seal-caster`  a character the Player owns
 *   `henchmen/close-lord`      a character the Player owns, the follower roll's lord
 *   `henchmen/close-e1`        a character the Player owns, the employer of two postings
 *   `henchmen/close-e2`        a character the Player does not own
 *   `location/close-market`    a location with a market, the Player observes it
 *   `domains/close-domain`     a domain the Player owns, with three holdings, one hidden
 * Every figure printed is a boolean, a count or a lang key's answer.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const LEVEL = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const LOCATION = "acks-extras.location";
const DOMAIN = "acks-extras.domain";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page   */
/* ------------------------------------------------------------------ */

const P = {
  /** Both seats: helpers under `__crs`, and a recorder of every warning notice. */
  install: async () => {
    const H = (globalThis.__crs = globalThis.__crs ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    if (!H.patched) {
      H.patched = true;
      H.warns = [];
      H.warn = ui.notifications.warn;
      ui.notifications.warn = function (msg, ...rest) {
        H.warns.push(String(msg));
        return H.warn.call(this, msg, ...rest);
      };
    }
    return { isGM: game.user.isGM, role: game.user.role, userId: game.user.id, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },

  /** The census the brief asks for. */
  census: async () => ({
    active: game.users.filter((u) => u.active).map((u) => [u.name, u.isGM]),
    activeGM: game.users.activeGM?.name ?? null,
  }),

  /** Put the seat's patches back and close every sheet this walk opened. */
  restore: async () => {
    const H = globalThis.__crs;
    if (!H) return true;
    if (H.patched) ui.notifications.warn = H.warn;
    H.patched = false;
    for (const id of H.sheets ?? []) {
      const doc = fromUuidSync(id);
      try { await doc?.sheet?.close({ animate: false }); } catch { /* closed */ }
    }
    try {
      const tables = await import("/modules/acks-extras/scripts/lib/tables.mjs");
      tables.unregisterTable("followers", { priority: 31 });
    } catch { /* none */ }
    return true;
  },

  /** Wait up to ten seconds for this seat to hold the ownership level a step needs on documents (by uuid). */
  seenLevels: async ({ want }) => {
    const H = globalThis.__crs;
    const read = () => Object.fromEntries(Object.keys(want).map((uuid) => [uuid, game.user.isGM ? null : (fromUuidSync(uuid)?.getUserLevel?.(game.user) ?? null)]));
    await H.poll(() => Object.entries(want).every(([uuid, level]) => read()[uuid] === level), { tries: 40, every: 250 });
    const now = read();
    return { levels: now, ok: Object.entries(want).every(([uuid, level]) => now[uuid] === level), isGM: game.user.isGM };
  },

  /** Warnings recorded since the last read (with the lang answers asked for), and clear them. */
  warns: async ({ keys = [] }) => {
    const H = globalThis.__crs;
    const out = { texts: H.warns.slice(), lang: Object.fromEntries(keys.map((k) => [k, game.i18n.localize(k)])) };
    H.warns.length = 0;
    return out;
  },

  /* ---------------------------- T-0814 ---------------------------- */

  /**
   * GM seat: a scene with a grid, the caster's token, a spell carrying a seal row on the caster, and two doors (one near the token,
   * one far beyond the range). Each is found by its own flag and shaped again, or made; what is made is returned so the walk tracks it.
   */
  sealBuild: async ({ sceneId, casterId, tag }) => {
    const scene = game.scenes.get(sceneId);
    const caster = game.actors.get(casterId);
    await scene.update({ "grid.size": 100, "grid.distance": 5, "grid.units": "ft", tokenVision: false });
    const made = [];
    const mark = (kind) => ({ world: { closeSeal: `${kind}@${tag}` } });
    let token = scene.tokens.find((t) => t.actorId === casterId);
    if (!token) {
      [token] = await scene.createEmbeddedDocuments("Token", [{ actorId: casterId, x: 500, y: 500, name: "Close Seal Caster", actorLink: true, flags: mark("token") }]);
      made.push({ uuid: token.uuid, kind: "Token" });
    } else await token.update({ x: 500, y: 500 });
    const door = async (kind, x) => {
      const data = { c: [x, 400, x, 700], door: CONST.WALL_DOOR_TYPES.DOOR, ds: CONST.WALL_DOOR_STATES.CLOSED, move: 20, light: 20, sound: 20, flags: mark(kind) };
      let wall = scene.walls.find((w) => w.flags?.world?.closeSeal === `${kind}@${tag}`);
      if (!wall) {
        [wall] = await scene.createEmbeddedDocuments("Wall", [data]);
        made.push({ uuid: wall.uuid, kind: "Wall" });
      } else await wall.update({ c: data.c, door: data.door, ds: data.ds, "flags.acks-extras.-=sealedBy": null });
      return wall;
    };
    const near = await door("near", 700);
    const far = await door("far", 1900);
    let spell = caster.items.find((i) => i.flags?.world?.closeSeal === `spell@${tag}`);
    if (!spell) {
      [spell] = await caster.createEmbeddedDocuments("Item", [{ name: "Close Walk Seal", type: "spell", flags: { ...mark("spell"), "acks-extras": { spell: { effects: [{ key: "s1", type: "seal", appliesTo: "target", saveEffect: "none" }] } } } }]);
      made.push({ uuid: spell.uuid, kind: "Item" });
    }
    return { made, ids: { tokenId: token.id, nearId: near.id, farId: far.id, spellUuid: spell.uuid }, hasSealRow: (spell.flags?.["acks-extras"]?.spell?.effects ?? []).some((r) => r.type === "seal") };
  },

  /** GM seat: both doors back to closed and unstamped. */
  sealReset: async ({ sceneId, wallIds }) => {
    const scene = game.scenes.get(sceneId);
    for (const id of wallIds) await scene.walls.get(id).update({ ds: CONST.WALL_DOOR_STATES.CLOSED, "flags.acks-extras.-=sealedBy": null });
    return wallIds.map((id) => scene.walls.get(id).ds === CONST.WALL_DOOR_STATES.CLOSED && !scene.walls.get(id).flags?.["acks-extras"]?.sealedBy);
  },

  /** Either seat: ask for a seal as the cast's seal step does (`writeSeal`), and answer the result and the warnings the call raised. */
  seal: async ({ casterUuid, spellUuid, sceneId, wallId, rangeFeet, castId }) => {
    const H = globalThis.__crs;
    H.warns.length = 0;
    const live = await import("/modules/acks-extras/scripts/magic/cast-seal-live.mjs");
    const result = await live.writeSeal({ casterUuid, spellUuid, castId, sceneId, wallId, rangeFeet });
    await H.sleep(600);
    const far = game.i18n.localize("ACKS-MAGIC.castSeal.pick.far");
    return { result: result ?? null, farNotice: H.warns.includes(far), warnCount: H.warns.length, isGM: game.user.isGM };
  },

  /** GM seat: a door's state and the casts its stamp lists. */
  wall: async ({ sceneId, wallId }) => {
    const wall = game.scenes.get(sceneId).walls.get(wallId);
    const stamp = wall.flags?.["acks-extras"]?.sealedBy ?? null;
    return { locked: wall.ds === CONST.WALL_DOOR_STATES.LOCKED, closed: wall.ds === CONST.WALL_DOOR_STATES.CLOSED, casts: stamp ? Array.from(stamp.casts ?? []) : [] };
  },

  /* ---------------------------- T-0815 ---------------------------- */

  /** Either seat: stand-in follower tables as a layer of the walk's own (priority 31, above the Judge's layer), and the answer the gate reads. */
  followerTables: async ({ on, arrival }) => {
    const tables = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    if (!on) {
      tables.unregisterTable("followers", { priority: 31 });
      return { on: false };
    }
    tables.registerTable({
      id: "followers",
      tables: {
        arrivalLevel: { level: arrival },
        followersByClass: { rows: [{ class: "fighter", stronghold: 1, value: 1, grants: [] }] },
        troopTypeTables: { tables: {} },
        companionLevel: {},
        followerLoyalty: { fanatic: { classes: [] } },
      },
    }, { priority: 31, source: "close-role-side" });
    const henchmen = await import("/modules/acks-extras/scripts/henchmen/rules/followers.mjs");
    return { on: true, arrival: henchmen.arrivalLevel(), tables: henchmen.followerTablesImported() };
  },

  /** GM seat: the lord's level and stronghold flag. */
  lordShape: async ({ lordId, level, stronghold }) => {
    const lord = game.actors.get(lordId);
    await lord.update({ "system.details.level": level });
    if (stronghold) await lord.setFlag("acks-extras", "stronghold", { name: "Close Keep", value: 1 });
    else await lord.unsetFlag("acks-extras", "stronghold");
    return { level: lord.system.details.level, stronghold: !!lord.getFlag("acks-extras", "stronghold") };
  },

  /** Player seat: wait for the lord's level and stronghold to reach this client. */
  lordSeen: async ({ lordId, level, stronghold }) => {
    const H = globalThis.__crs;
    const read = () => { const a = game.actors.get(lordId); return { level: a?.system.details.level, stronghold: !!a?.getFlag("acks-extras", "stronghold"), isOwner: !!a?.isOwner }; };
    await H.poll(() => { const r = read(); return r.level === level && r.stronghold === stronghold && r.isOwner; }, { tries: 40 });
    const now = read();
    return { ...now, ok: now.level === level && now.stronghold === stronghold && now.isOwner };
  },

  /**
   * Either seat: run the follower roll on the lord. The dialog it opens is found by its class select and closed with no answer, so no class
   * is chosen and no card posts. Answers the warnings (by what they are), whether a prompt stood, and whether the call came back.
   */
  follow: async ({ lordId, arrival }) => {
    const H = globalThis.__crs;
    const lord = game.actors.get(lordId);
    H.warns.length = 0;
    let done = false;
    const call = acksExtras.henchmen.openFollowersDialog(lord).then(() => { done = true; });
    const found = () => [...foundry.applications.instances.values()].find((a) => H.root(a)?.querySelector('select[name="classKey"]'));
    const app = await H.poll(found, { tries: 14, every: 250 });
    const opened = !!app;
    const keepOpenText = app ? (H.root(app)?.querySelector("p")?.textContent ?? "") : "";
    if (app) await app.close({ animate: false });
    await Promise.race([call, H.sleep(4000)]);
    const level = Number(lord.system.details.level ?? 0);
    const rules = await import("/modules/acks-extras/scripts/henchmen/rules/followers.mjs");
    const cite = rules.arrivalLevelCite();
    const levelText = game.i18n.format("ACKS-HENCHMEN.followers.levelGate", { name: lord.name, level, arrival, cite: cite ? ` (${cite})` : "" });
    const missingText = game.i18n.localize("ACKS-HENCHMEN.followers.strongholdMissing");
    const kinds = H.warns.map((w) => (w === levelText ? "levelGate" : w === missingText ? "strongholdMissing" : "other"));
    return { opened, kinds, returned: done, promptSaysMissing: keepOpenText === missingText, isGM: game.user.isGM };
  },

  /* ---------------------------- T-0821 ---------------------------- */

  /** GM seat: the place's three postings and two candidates, the employers' and place's ownership for the Player, and the visibility setting. */
  marketShape: async ({ placeId, e1Id, e2Id, pid, placeLevel, visibility }) => {
    const place = game.actors.get(placeId);
    const e1 = game.actors.get(e1Id);
    const e2 = game.actors.get(e2Id);
    await e1.update({ [`ownership.${pid}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    await e2.update({ "ownership.default": 0, [`ownership.${pid}`]: 0 });
    await place.update({ "ownership.default": 0, [`ownership.${pid}`]: placeLevel });
    const now = game.time.worldTime;
    const posting = (id, employer, segment, seesDetails) => ({ id, createdTime: now, monthStartTime: now, lastProcessedTime: now, segment, employerUuid: employer.uuid, status: "active", playersSeeDetails: seesDetails, spec: { kind: "henchman", general: true, level: 1 } });
    const cand = (id, segment, name) => ({ id, segment, name, kind: "henchman", status: "available", level: 1, quantity: 1, availableFromTime: now });
    await place.update({
      "system.market.postings": [
        posting("closep1", e1, "close:a", true),
        posting("closep2", e2, "close:a", false),
        posting("closep3", e2, "close:b", false),
      ],
      "system.market.candidates": [cand("closec1", "close:a", "Close Cand Alpha"), cand("closec3", "close:b", "Close Cand Gamma")],
    });
    let was = game.settings.get("acks-extras", "playerMarketVisibility");
    if (was !== visibility) await game.settings.set("acks-extras", "playerMarketVisibility", visibility);
    return { was, now: game.settings.get("acks-extras", "playerMarketVisibility"), postings: place.system.postings.length, candidates: place.system.candidates.length, hasMarket: !!place.system.hasMarket, e1Uuid: e1.uuid, e2Uuid: e2.uuid };
  },

  /** Either seat: wait for the sheet of the place to carry its postings. */
  marketSeen: async ({ placeId, e1Id, e2Id, placeLevel, visibility }) => {
    const H = globalThis.__crs;
    const read = () => {
      const place = game.actors.get(placeId);
      return {
        postings: place?.system.postings?.length ?? 0,
        placeLevel: game.user.isGM ? null : place?.getUserLevel(game.user),
        owns1: !!game.actors.get(e1Id)?.testUserPermission(game.user, "OWNER"),
        owns2: !!game.actors.get(e2Id)?.testUserPermission(game.user, "OWNER"),
        visibility: game.settings.get("acks-extras", "playerMarketVisibility"),
      };
    };
    const good = (r) => r.postings === 3 && (game.user.isGM || (r.placeLevel === placeLevel && r.owns1 && !r.owns2)) && r.visibility === visibility;
    await H.poll(() => good(read()), { tries: 40 });
    const now = read();
    return { ...now, ok: good(now), isGM: game.user.isGM };
  },

  /** Either seat: render the place's sheet on its Recruitment tab and read each posting's eye control and each candidate's name cell. */
  sheetRead: async ({ placeId, postings, candidates, names }) => {
    const H = globalThis.__crs;
    const place = game.actors.get(placeId);
    H.sheets = [...new Set([...(H.sheets ?? []), place.uuid])];
    const app = place.sheet;
    await app.render({ force: true });
    const rooted = await H.poll(() => H.root(app)?.querySelector("[data-posting-id]"), { tries: 40 });
    if (!rooted) return { rendered: false };
    try { await app.changeTab("recruitment", "primary"); } catch { /* the tab is the default */ }
    await H.sleep(500);
    const root = H.root(app);
    const masked = game.i18n.localize("ACKS-HENCHMEN.candidate.masked");
    const rows = {};
    for (const id of postings) {
      const row = root.querySelector(`tr[data-posting-id="${id}"]`);
      const eye = row?.querySelector('[data-action="togglePlayerDetails"] i');
      rows[id] = { present: !!row, control: !!eye, eye: eye ? (eye.classList.contains("fa-eye-slash") ? "slash" : "eye") : null, closeControl: !!row?.querySelector('[data-action="closePosting"]') };
    }
    const cands = {};
    for (const id of candidates) {
      const cell = root.querySelector(`tr[data-candidate-id="${id}"] td:first-child`);
      const text = cell?.textContent ?? "";
      cands[id] = { present: !!cell, real: !!cell && text.includes(names[id]), masked: !!cell && text.includes(masked) };
    }
    return { rendered: true, rows, cands, isGM: game.user.isGM };
  },

  /** Either seat: press the eye control of one posting on the place's open sheet. */
  sheetClick: async ({ placeId, postingId }) => {
    const H = globalThis.__crs;
    const root = H.root(game.actors.get(placeId).sheet);
    const control = root?.querySelector(`tr[data-posting-id="${postingId}"] [data-action="togglePlayerDetails"]`);
    if (!control) return { clicked: false };
    control.click();
    return { clicked: true };
  },

  /** Player seat: the relay a seat without the control would have to use, driven directly for a posting whose employer the seat does not own. */
  relayDetails: async ({ placeId, postingId, value }) => {
    const sockets = await import("/modules/acks-extras/scripts/lib/sockets.mjs");
    await sockets.executeAsGM("setPostingDetails", { locationUuid: game.actors.get(placeId).uuid, postingId, value });
    await globalThis.__crs.sleep(1500);
    return true;
  },

  /** GM seat: each posting's flag as stored. */
  postingsRead: async ({ placeId }) => Object.fromEntries(game.actors.get(placeId).system.postings.map((p) => [p.id, p.playersSeeDetails])),

  /** GM seat: set one posting's flag directly, to bring a step to its shape. */
  postingSet: async ({ placeId, postingId, value }) => {
    const place = game.actors.get(placeId);
    const list = place.system.postings.map((p) => p.toObject?.() ?? foundry.utils.deepClone(p));
    list.find((p) => p.id === postingId).playersSeeDetails = value;
    await place.update({ "system.market.postings": list });
    return true;
  },

  /** GM seat: the visibility setting, put back. */
  setVisibility: async ({ value }) => {
    if (game.settings.get("acks-extras", "playerMarketVisibility") !== value) await game.settings.set("acks-extras", "playerMarketVisibility", value);
    return game.settings.get("acks-extras", "playerMarketVisibility");
  },

  /* ---------------------------- T-0817 ---------------------------- */

  /** GM seat: the domain's holdings back to three rows, the second hidden, and the Player the owner. */
  domainShape: async ({ domainId, pid }) => {
    const domain = game.actors.get(domainId);
    await domain.update({ [`ownership.${pid}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, "ownership.default": 0 });
    const row = (name, note, hidden, gp) => ({ uuid: "", name, role: "other", investmentGp: gp, note, hidden });
    await domain.update({ "system.holdings": [row("Close Row A", "note a", false, 1), row("Close Row B", "note b hidden", true, 7), row("Close Row C", "note c", false, 3)] });
    return { count: domain.system.holdings.length, hiddenAt: domain.system.holdings.findIndex((h) => h.hidden) };
  },

  /** The domain's holdings as stored, as comparable plain rows. */
  domainRead: async ({ domainId }) => game.actors.get(domainId).system.holdings.map((h) => ({ name: h.name, note: h.note, hidden: !!h.hidden, gp: h.investmentGp })),

  /**
   * Player seat: the domain sheet on its Holdings tab, one visible row's note edited with a change event (the sheet submits on change).
   * `forced` clears `disabled` from every holdings control the seat was drawn first, since the sheet draws them locked for a non-Judge.
   */
  domainSubmit: async ({ domainId, forced }) => {
    const H = globalThis.__crs;
    const domain = game.actors.get(domainId);
    H.sheets = [...new Set([...(H.sheets ?? []), domain.uuid])];
    const app = domain.sheet;
    await app.render({ force: true });
    await H.poll(() => H.root(app)?.querySelector('[name^="system.holdings."]'), { tries: 40 });
    try { await app.changeTab("holdings", "primary"); } catch { /* the tab is drawn */ }
    await H.sleep(500);
    const root = H.root(app);
    const inputs = [...root.querySelectorAll('[name^="system.holdings."]')];
    const indexes = [...new Set(inputs.map((i) => i.name.split(".")[2]))];
    const locked = inputs.length > 0 && inputs.every((i) => i.disabled);
    if (forced) for (const input of inputs) input.disabled = false;
    const target = root.querySelector('input[name="system.holdings.2.note"]');
    if (!target) return { target: false, indexes, locked };
    target.value = "edited by the player";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(1500);
    return { target: true, indexes, locked, isGM: game.user.isGM, editable: !!app.isEditable };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.henchmen && !!globalThis.acksExtras?.magic`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const seats = {};
async function seat(key) {
  const user = key === "gm" ? MACHINE.gm : MACHINE.player;
  const api = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user, port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`ready (${key}) after (s)`, await ready(api, key));
  return api;
}

/** Runs one topic's steps; a throw in it is one FAIL and the next topic still runs. */
async function stage(name, fn) {
  section(name);
  try { await fn(); } catch (err) {
    console.error(`WALK ERROR (${name}):`, err?.stack ?? err?.message ?? err);
    check(`${name} ran to its end`, false, String(err?.message ?? err).slice(0, 200));
  }
}

/** Polls the GM seat's reader until `ok(value)` or the time is up; answers the last value. */
async function until(gm, fn, args, ok, tries = 30) {
  let value = null;
  for (let n = 0; n < tries; n++) {
    value = await run(gm, fn, args);
    if (ok(value)) return value;
    await sleep(300);
  }
  return value;
}

let gmSetting = null;

try {
  section("seats");
  const gm = await seat("gm");
  const player = await seat("player");
  const gmInfo = await run(gm, P.install);
  const pInfo = await run(player, P.install);
  note("census", await run(gm, P.census));
  const census = await run(gm, P.census);
  const others = census.active.filter(([name, isGM]) => isGM && name !== MACHINE.gm).map(([name]) => name);
  if (others.length) note("another Judge is seated (a note, not a block)", others.length);
  check("the GM seat is a Judge's and the Player seat is not", gmInfo.isGM && !pInfo.isGM && pInfo.role < 3, { gm: gmInfo.role, player: pInfo.role });
  if (pInfo.isGM) blocked("the player seat is not a player");
  const pid = pInfo.userId;
  const own = { default: LEVEL.NONE, [pid]: LEVEL.OWNER };

  /* ------------------------------------------------------------ */
  await stage("T-0814: a Judge's door seal past its range goes ahead with the notice; a Player's is refused", async () => {
    const scene = await gm.fixture("magic/close-seal-scene", "Scene", { name: "Close Seal Scene", width: 2400, height: 1200, ownership: { default: LEVEL.OBSERVER } });
    const caster = await gm.fixture("magic/close-seal-caster", "Actor", { name: "Close Seal Caster", type: "character", ownership: own });
    await run(gm, P.install);
    const built = await run(gm, P.sealBuild, { sceneId: scene.id, casterId: caster.id, tag: MACHINE.own ?? "kept" });
    for (const m of built.made) gm.track(m.uuid, m.kind);
    check("the spell carries a seal row, and the scene holds the caster's token and two doors", built.hasSealRow && !!built.ids.tokenId && !!built.ids.nearId && !!built.ids.farId, { made: built.made.length });
    const seen = await run(player, P.seenLevels, { want: { [caster.uuid ?? `Actor.${caster.id}`]: LEVEL.OWNER } });
    check("the Player seat owns the caster", seen.ok && !seen.isGM, seen);
    const base = { casterUuid: `Actor.${caster.id}`, spellUuid: built.ids.spellUuid, sceneId: scene.id, rangeFeet: 30 };
    const walls = [built.ids.nearId, built.ids.farId];
    const door = (id) => run(gm, P.wall, { sceneId: scene.id, wallId: id });

    await run(gm, P.sealReset, { sceneId: scene.id, wallIds: walls });
    let r = await run(gm, P.seal, { ...base, wallId: built.ids.nearId, castId: "closeseal-gm-near" });
    let w = await door(built.ids.nearId);
    check("[via writeSeal, door click not driven] Judge, a door within the range: sealed, no out-of-range notice (control)", r.isGM && r.result?.ok === true && !r.result.warn && !r.farNotice && w.locked && w.casts.includes("closeseal-gm-near"), { ok: r.result?.ok, warn: r.result?.warn ?? null, farNotice: r.farNotice, locked: w.locked });

    await run(gm, P.sealReset, { sceneId: scene.id, wallIds: walls });
    r = await run(gm, P.seal, { ...base, wallId: built.ids.farId, castId: "closeseal-gm-far" });
    w = await door(built.ids.farId);
    check("[via writeSeal, door click not driven] Judge, a door past the range: the request goes ahead with the warning, the pick's out-of-range notice is raised, and the door is locked and stamped", r.isGM && r.result?.ok === true && r.result.warn === "outOfRange" && r.farNotice && w.locked && w.casts.includes("closeseal-gm-far"), { ok: r.result?.ok, warn: r.result?.warn ?? null, reason: r.result?.reason ?? null, farNotice: r.farNotice, locked: w.locked, stamped: w.casts.includes("closeseal-gm-far") });

    await run(gm, P.sealReset, { sceneId: scene.id, wallIds: walls });
    r = await run(player, P.seal, { ...base, wallId: built.ids.farId, castId: "closeseal-pl-far" });
    w = await door(built.ids.farId);
    check("[via writeSeal, door click not driven] Player, a door past the range: refused outOfRange by the GM client, and the door is untouched", !r.isGM && r.result?.ok === false && r.result.reason === "outOfRange" && w.closed && !w.locked && w.casts.length === 0, { ok: r.result?.ok, reason: r.result?.reason ?? null, closed: w.closed, stamped: w.casts.length });

    r = await run(player, P.seal, { ...base, wallId: built.ids.nearId, castId: "closeseal-pl-near" });
    w = await door(built.ids.nearId);
    check("[via writeSeal, door click not driven] Player, a door within the range: sealed by the GM client (control)", !r.isGM && r.result?.ok === true && !r.result.warn && w.locked && w.casts.includes("closeseal-pl-near"), { ok: r.result?.ok, reason: r.result?.reason ?? null, locked: w.locked });
    await run(gm, P.sealReset, { sceneId: scene.id, wallIds: walls });
  });

  /* ------------------------------------------------------------ */
  await stage("T-0815: the follower roll blocks a Player and warns a Judge", async () => {
    const lord = await gm.fixture("henchmen/close-lord", "Actor", { name: "Close Lord", type: "character", ownership: own });
    const reg = { gm: await run(gm, P.followerTables, { on: true, arrival: 4 }), player: await run(player, P.followerTables, { on: true, arrival: 4 }) };
    check("each seat reads the stand-in arrival level and the four tables", reg.gm.on && reg.gm.arrival === 4 && reg.gm.tables && reg.player.arrival === 4 && reg.player.tables, reg);
    const shape = async (level, stronghold) => {
      const set = await run(gm, P.lordShape, { lordId: lord.id, level, stronghold });
      const seen = await run(player, P.lordSeen, { lordId: lord.id, level, stronghold });
      return set.level === level && set.stronghold === stronghold && seen.ok;
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    check("shape: level below arrival, with a stronghold", await shape(3, true));
    let p = await run(player, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Player below the arrival level: the level notice is raised and no class prompt opens", !p.opened && same(p.kinds, ["levelGate"]) && p.returned, p);
    let j = await run(gm, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Judge below the arrival level: the same notice is raised and the prompt opens", j.opened && same(j.kinds, ["levelGate"]) && j.returned, j);

    check("shape: level at arrival, no stronghold", await shape(4, false));
    p = await run(player, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Player at the arrival level with no stronghold: the stronghold notice is raised before the prompt, and none opens", !p.opened && same(p.kinds, ["strongholdMissing"]) && p.returned, p);
    j = await run(gm, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Judge at the arrival level with no stronghold: the notice is raised and the prompt opens, saying so", j.opened && same(j.kinds, ["strongholdMissing"]) && j.promptSaysMissing, j);

    check("shape: level below arrival, no stronghold", await shape(3, false));
    p = await run(player, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Player with both unmet: one notice only, the level, and no prompt", !p.opened && same(p.kinds, ["levelGate"]), p);
    j = await run(gm, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Judge with both unmet: both notices, the level first, and the prompt opens", j.opened && same(j.kinds, ["levelGate", "strongholdMissing"]), j);

    check("shape: level at arrival, with a stronghold", await shape(4, true));
    p = await run(player, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Player with nothing unmet: no notice and the prompt opens (control)", p.opened && p.kinds.length === 0 && !p.promptSaysMissing, p);
    j = await run(gm, P.follow, { lordId: lord.id, arrival: 4 });
    check("[via openFollowersDialog] Judge with nothing unmet: no notice and the prompt opens (control)", j.opened && j.kinds.length === 0, j);
    await run(gm, P.followerTables, { on: false });
    await run(player, P.followerTables, { on: false });
  });

  /* ------------------------------------------------------------ */
  await stage("T-0817: a Player seat's domain submit keeps the hidden holding at its index", async () => {
    const domain = await gm.fixture("domains/close-domain", "Actor", { name: "Close Domain", type: DOMAIN, ownership: own });
    const shaped = await run(gm, P.domainShape, { domainId: domain.id, pid });
    const seen = await run(player, P.seenLevels, { want: { [`Actor.${domain.id}`]: LEVEL.OWNER } });
    check("the domain holds three rows, the second hidden, and the Player seat owns it", shaped.count === 3 && shaped.hiddenAt === 1 && seen.ok, { shaped, seen: seen.ok });
    const original = await run(gm, P.domainRead, { domainId: domain.id });
    const intact = (rows) => rows.length === 3 && JSON.stringify(rows[1]) === JSON.stringify(original[1]) && JSON.stringify(rows[0]) === JSON.stringify(original[0]) && rows[2].name === original[2].name;

    const natural = await run(player, P.domainSubmit, { domainId: domain.id, forced: false });
    check("the Player's sheet draws the visible rows only, none of the hidden row's controls", natural.target && natural.indexes.includes("0") && natural.indexes.includes("2") && !natural.indexes.includes("1") && !natural.isGM, natural);
    note("the controls are drawn locked to this seat", natural.locked);
    let after = await run(gm, P.domainRead, { domainId: domain.id });
    const landed = after[2]?.note === "edited by the player";
    if (landed) check("natural submit (the drawn form, a change event on a row's note): the edit landed, the hidden row is still stored at index 1, unchanged, and the list has three rows", intact(after), { count: after.length, hiddenStays: JSON.stringify(after[1]) === JSON.stringify(original[1]) });
    else note("natural submit: the drawn form sent no holdings, so nothing was written and nothing is counted", { count: after.length, hiddenStays: JSON.stringify(after[1]) === JSON.stringify(original[1]) });

    if (!landed) {
      note("the drawn form sent no holdings (its controls are locked), so the guard was not reached", true);
      await run(gm, P.domainShape, { domainId: domain.id, pid });
      const forced = await run(player, P.domainSubmit, { domainId: domain.id, forced: true });
      after = await run(gm, P.domainRead, { domainId: domain.id });
      check("forced submit (the drawn controls unlocked in the page, as a modified client could): the Player's edit is written", forced.target && after[2]?.note === "edited by the player", { target: forced.target, editLanded: after[2]?.note === "edited by the player", count: after.length });
      check("forced submit: the hidden row is back at index 1 unchanged, row 0 is unchanged, and the list has three rows", intact(after), { count: after.length, hiddenStays: JSON.stringify(after[1]) === JSON.stringify(original[1]), firstStays: JSON.stringify(after[0]) === JSON.stringify(original[0]) });
    }
  });

  /* ------------------------------------------------------------ */
  await stage("T-0821: a posting's employer flips the details mask and sees their own candidates", async () => {
    const LD = await run(gm, async () => (await import("/modules/acks-extras/scripts/location/data/location-data.mjs")).emptyMarket());
    const place = await gm.fixture("location/close-market", "Actor", { name: "Close Market", type: LOCATION, system: { market: LD } });
    const e1 = await gm.fixture("henchmen/close-e1", "Actor", { name: "Close Employer One", type: "character", ownership: own });
    const e2 = await gm.fixture("henchmen/close-e2", "Actor", { name: "Close Employer Two", type: "character", ownership: { default: LEVEL.NONE } });
    const ids = { placeId: place.id, e1Id: e1.id, e2Id: e2.id };
    const names = { closec1: "Close Cand Alpha", closec3: "Close Cand Gamma" };
    const PS = ["closep1", "closep2", "closep3"];
    const CS = ["closec1", "closec3"];
    const read = (api) => run(api, P.sheetRead, { placeId: place.id, postings: PS, candidates: CS, names });
    const shape = async (placeLevel, visibility) => {
      const set = await run(gm, P.marketShape, { ...ids, pid, placeLevel, visibility });
      gmSetting ??= set.was;
      const seen = await run(player, P.marketSeen, { ...ids, placeLevel, visibility });
      return { set, seen };
    };
    const stored = () => run(gm, P.postingsRead, { placeId: place.id });

    /* Observer on the place, visibility owned. */
    let s = await shape(LEVEL.OBSERVER, "owned");
    check("shape: the place has a market and three postings; the Player observes it, owns the first employer and not the second", s.set.hasMarket && s.set.postings === 3 && s.set.candidates === 2 && s.seen.ok, { hasMarket: s.set.hasMarket, postings: s.set.postings, seen: s.seen.ok });
    let v = await read(player);
    check("Player: the eye control is drawn on the posting whose employer the Player owns, and on neither of the other two", v.rendered && v.rows.closep1.control && !v.rows.closep2.control && !v.rows.closep3.control, v.rendered ? Object.fromEntries(PS.map((id) => [id, v.rows[id].control])) : v);
    check("Player: a candidate in a segment the Player's own active posting covers is shown by name even though another posting there hides details", v.rendered && v.cands.closec1.present && v.cands.closec1.real && !v.cands.closec1.masked, v.cands?.closec1);
    check("Player: a candidate of a segment no posting of the Player covers is not shown at all under 'owned' visibility (control)", v.rendered && !v.cands.closec3.present, v.cands?.closec3);
    const gv = await read(gm);
    check("Judge: the eye control is drawn on all three postings", gv.rendered && PS.every((id) => gv.rows[id].control), gv.rendered ? Object.fromEntries(PS.map((id) => [id, gv.rows[id].control])) : gv);

    // The flip, as a user does it: the eye on the Player's posting, relayed because the Player does not own the place.
    let before = await stored();
    check("the first posting shows players its details at the start", before.closep1 === true && before.closep2 === false && before.closep3 === false, before);
    const c1 = await run(player, P.sheetClick, { placeId: place.id, postingId: "closep1" });
    let after = await until(gm, P.postingsRead, { placeId: place.id }, (x) => x.closep1 === false);
    check("Player, Observer on the place: pressing the eye on their own posting hides its details (the write went through the Judge's client)", c1.clicked && after.closep1 === false && after.closep2 === false && after.closep3 === false, { clicked: c1.clicked, stored: after });
    v = await read(player);
    check("Player: the eye now reads hidden, and the Player still sees their own candidate by name", v.rendered && v.rows.closep1.eye === "slash" && v.cands.closec1.real && !v.cands.closec1.masked, { eye: v.rows?.closep1?.eye, cand: v.cands?.closec1 });
    const c2 = await run(player, P.sheetClick, { placeId: place.id, postingId: "closep1" });
    after = await until(gm, P.postingsRead, { placeId: place.id }, (x) => x.closep1 === true);
    check("Player: pressing it again shows the details again", c2.clicked && after.closep1 === true, { clicked: c2.clicked, stored: after });

    // A posting whose employer the Player does not own: no control, and the relay refuses.
    await run(player, P.relayDetails, { placeId: place.id, postingId: "closep2", value: true });
    after = await stored();
    check("Player: a flip of a posting whose employer the Player does not own, sent through the relay directly, changes nothing (the GM client re-reads the ownership)", after.closep2 === false && after.closep3 === false, after);

    /* Visibility all: an uncovered masked segment stays masked. */
    s = await shape(LEVEL.OBSERVER, "all");
    check("shape: visibility 'all'", s.seen.ok && s.set.now === "all", { now: s.set.now, seen: s.seen.ok });
    v = await read(player);
    check("Player, visibility 'all': the uncovered candidate of a segment its posting hides is shown masked, and the covered one by name", v.rendered && v.cands.closec3.present && v.cands.closec3.masked && !v.cands.closec3.real && v.cands.closec1.real && !v.cands.closec1.masked, v.cands);

    /* Owner of the place: the direct path. */
    s = await shape(LEVEL.OWNER, "owned");
    check("shape: the Player owns the place", s.seen.ok, { seen: s.seen.ok });
    v = await read(player);
    check("Player, Owner of the place: the eye control is still drawn on their employer's posting only", v.rendered && v.rows.closep1.control && !v.rows.closep2.control && !v.rows.closep3.control, v.rendered ? Object.fromEntries(PS.map((id) => [id, v.rows[id].control])) : v);
    const c3 = await run(player, P.sheetClick, { placeId: place.id, postingId: "closep1" });
    after = await until(gm, P.postingsRead, { placeId: place.id }, (x) => x.closep1 === false);
    check("Player, Owner of the place: pressing the eye on their own posting hides its details", c3.clicked && after.closep1 === false && after.closep2 === false, { clicked: c3.clicked, stored: after });

    /* The Judge's seat. */
    await run(gm, P.postingSet, { placeId: place.id, postingId: "closep1", value: true });
    await read(gm);
    const c4 = await run(gm, P.sheetClick, { placeId: place.id, postingId: "closep2" });
    after = await until(gm, P.postingsRead, { placeId: place.id }, (x) => x.closep2 === true);
    check("Judge: pressing the eye on a posting whose employer the Judge does not own flips it", c4.clicked && after.closep2 === true, { clicked: c4.clicked, stored: after });
  });

  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  try { if (seats.gm && gmSetting !== null) note("playerMarketVisibility put back", await run(seats.gm, P.setVisibility, { value: gmSetting })); } catch (err) { console.error("setting:", err?.message ?? err); }
  for (const [key, api] of Object.entries(seats)) {
    try { await run(api, P.restore); } catch (err) { console.error(`restore ${key}:`, err?.message ?? err); }
  }
  try { if (seats.gm) note("swept", await seats.gm.sweepTracked()); } catch (err) { console.error("sweep:", err?.message ?? err); }
  for (const api of Object.values(seats)) {
    try { await api.close(); } catch { /* closed */ }
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
