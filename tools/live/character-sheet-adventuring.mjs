/**
 * Live walk, character-sheet-adventuring: the Rolls tab's Adventuring group
 * reads the better of the stored figure and the held skill's throw, and rolls
 * against it. Walks docs/character-sheet/TESTING.md "An Adventuring row is the
 * better of two figures": from a GM seat and from a Player seat that owns the
 * character, each row's figure beside the skill's own sheet reading, its
 * tooltip, the skill throw listed once, the target on the posted card for a
 * throw anyone sees (Trapbreaking), one only the stored figure answers
 * (Climbing) and the two the Judge makes in secret (Searching, Listening),
 * whose card is whispered to the Judges and, from a Player, posted blind with no
 * roll attached. Prints booleans and counts, never a figure or a skill's name.
 * Machine values arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker (the GM seat builds it and brings it to the
 * shape each step needs): `character-sheet/adventuring-climb`, a character the
 * Player owns, bound to the imported Thief class at level 3, holding the
 * Adventuring proficiency and the library's Searching, Listening and
 * Trapbreaking skills, with stored Adventuring figures set so every skill's
 * throw is better than the stored one. The chat cards the run posts speak as
 * the fixture and are swept by uuid.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARK = "character-sheet/adventuring-climb";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__adv = globalThis.__adv ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.cards = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.hook = Hooks.on("createChatMessage", (m) => {
        H.cards.push({
          uuid: m.uuid,
          actor: m.speaker?.actor ?? null,
          author: m.author?.id ?? null,
          blind: !!m.blind,
          whisper: [...(m.whisper ?? [])],
          rolls: m.rolls?.length ?? 0,
          text: String(m.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
        });
      });
    }
    return { isGM: game.user.isGM, userId: game.user.id, gms: game.users.filter((u) => u.isGM).map((u) => u.id) };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** The GM brings the fixture to the shape the steps need, and reports the preconditions as booleans. */
  shape: async ({ actorId, playerId }) => {
    const actor = game.actors.get(actorId);
    const R = await import("/modules/acks-extras/scripts/classes/registry.mjs");
    const G = await import("/modules/acks-extras/scripts/classes/grants.mjs");
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    const T = await import("/modules/acks-extras/scripts/abilities/adventuring-throw.mjs");
    const AR = await import("/modules/acks-extras/scripts/abilities/ability-rolls.mjs");
    await L.whenReady();
    if ((actor.ownership?.[playerId] ?? 0) < 3) await actor.update({ ownership: { ...actor.ownership, [playerId]: 3 } });
    const held = await R.classForActorAsync(actor);
    if (!held || (actor.system.details?.level ?? 1) < 3) {
      const cls = R.classItems().find((c) => /^thief$/i.test(c.name));
      if (!cls) return { noThief: true };
      await acksExtras.classes.applyClass(actor, cls, { level: 3, confirm: false, rebuildVitals: false });
    }
    const grants = [];
    await G.grantAdventuring(actor, grants);
    for (const ref of ["def.skill.searching", "def.skill.listening", "def.skill.trapbreaking"]) await G.grantAbility(actor, ref, grants);
    // Stored figures high enough that a skill's level-resolved throw is the better one.
    await actor.update({ "system.adventuring": { dungeonbashing: 19, climb: 9, listening: 19, searching: 19, trapbreaking: 19 } });
    const stored = actor.system.adventuring;
    const out = { level: actor.system.details.level, missing: grants.filter((g) => g.missing).length, adventuring: actor.items.filter((i) => G.isAdventuring(i)).length };
    for (const key of ["searching", "listening", "trapbreaking"]) {
      const skill = T.adventuringSkillThrow(actor, key);
      const found = T.adventuringThrow(actor, key);
      out[key] = {
        skill: !!skill,
        better: !!skill && skill.target < stored[key],
        derived: found.source === "skill",
        sheetAgrees: !!skill && AR.throwText(AR.rollsOf(skill.item).find((r, i) => AR.keyOf(r, i) === (skill.rollKey)), actor, skill.item) === `${skill.target}+`,
      };
    }
    return out;
  },
  /** Open the sheet on Rolls and read the Adventuring rows, their tooltips and the skill rows as booleans. */
  rows: async ({ actorId }) => {
    const H = globalThis.__adv;
    const actor = game.actors.get(actorId);
    const T = await import("/modules/acks-extras/scripts/abilities/adventuring-throw.mjs");
    const AR = await import("/modules/acks-extras/scripts/abilities/ability-rolls.mjs");
    await actor.sheet.render(true);
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("rolls", "primary");
    await H.sleep(600);
    // Every tab's panel is in the DOM (the Abilities tab lists each ability's throws): read the Rolls panel alone.
    const root = H.root(actor.sheet)?.querySelector("section[data-tab='rolls']");
    const rowOf = (id) => root.querySelector(`[data-action='roll'][data-roll='${id}']`);
    const valueOf = (id) => rowOf(id)?.querySelector(".acks-extras-frame__row-value");
    const stored = actor.system.adventuring;
    const out = { rendered: !!root && root.querySelectorAll("[data-action='roll']").length > 0 };
    for (const key of ["searching", "listening", "trapbreaking", "climb", "dungeonbashing"]) {
      const skillKey = key === "climb" || key === "dungeonbashing" ? null : key;
      const skill = skillKey ? T.adventuringSkillThrow(actor, skillKey) : null;
      const cell = valueOf(`adv:${key}`);
      const tip = cell?.dataset.tooltipText ?? "";
      const own = skill ? AR.throwText(AR.rollsOf(skill.item).find((r, i) => AR.keyOf(r, i) === skill.rollKey), actor, skill.item) : null;
      out[key] = {
        row: !!cell,
        // The figure on the row is the skill's own sheet reading where there is a skill, else the stored one.
        figure: cell?.textContent.trim() === (own ?? `${stored[key]}+`),
        notStored: skill ? cell?.textContent.trim() !== `${stored[key]}+` : true,
        tip: !!tip && tip.includes(String(cell?.textContent.trim().replace("+", ""))),
        tipNamesSkill: skill ? tip.includes(skill.name) : true,
        tipNamesOther: skill ? tip.includes(`${stored[key]}+`) : true,
        noTitle: !cell?.hasAttribute("title") && !rowOf(`adv:${key}`)?.hasAttribute("title"),
        skillNameShown: skill ? (rowOf(`adv:${key}`)?.querySelector(".acks-extras-frame__row-line")?.textContent.trim() === skill.name) : true,
      };
      if (skill) out[key].listedOnce = root.querySelectorAll(`[data-action='roll'][data-roll='abl:${skill.itemId}:${skill.rollKey}']`).length === 0;
    }
    const search = T.adventuringSkillThrow(actor, "searching");
    out.hastyStays = !!search && root.querySelectorAll(`[data-action='roll'][data-roll='abl:${search.itemId}:hasty']`).length === 1;
    const listening = T.adventuringSkillThrow(actor, "listening");
    out.listeningNotInProficiencies = !!listening && root.querySelectorAll(`[data-action='roll'][data-roll^='abl:${listening.itemId}:']`).length === 0;
    return out;
  },
  /** The posted-card count, so a step reads only what came after it. */
  mark: async () => globalThis.__adv.cards.length,
  /** Press one Adventuring row as a user does (the skip-dialog key held) and report the card it posted. */
  press: async ({ actorId, key }) => {
    const H = globalThis.__adv;
    const actor = game.actors.get(actorId);
    const before = H.cards.length;
    const skipKey = game.settings.get("acks", "skip-dialog-key");
    const row = H.root(actor.sheet)?.querySelector(`[data-action='roll'][data-roll='adv:${key}']`);
    if (!row) return { row: false };
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [skipKey]: true }));
    await H.poll(() => H.cards.length > before, { tries: 60, every: 200 });
    await H.sleep(400);
    const mine = H.cards.slice(before).filter((c) => c.actor === actorId);
    return { row: true, posted: mine.length, cards: mine };
  },
  /** What this seat's client heard since `from`, as the card's own figure. */
  heard: async ({ actorId, from }) => globalThis.__adv.cards.slice(from).filter((c) => c.actor === actorId),
  close: async ({ actorId }) => { await game.actors.get(actorId)?.sheet?.close(); return true; },
  drain: async () => ({ errors: globalThis.__adv.errors.slice() }),
  restore: async () => {
    const H = globalThis.__adv;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    Hooks.off("createChatMessage", H.hook);
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.classes?.applyClass`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let player = null;
const cards = new Set();
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 420_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** The card's figure as the system prints it, "(N)", or null. */
const figureOn = (card) => {
  const hit = /\((\d+)\)/.exec(card?.text ?? "");
  return hit ? Number(hit[1]) : null;
};
const keep = async (list) => { for (const c of list ?? []) if (c.uuid && !cards.has(c.uuid)) { cards.add(c.uuid); await gm.track(c.uuid, "ChatMessage"); } };

/** One seat's walk: the rows, then each kind of roll, with what the other seat heard of the secret ones. */
async function walkSeat(label, seat, other, actorId, gmIds, isGM) {
  section(`${label}: the Adventuring rows`);
  const r = await run(seat, P.rows, { actorId });
  check(`${label}: the sheet renders its Rolls tab`, r.rendered);
  for (const key of ["searching", "listening", "trapbreaking"]) {
    const k = r[key] ?? {};
    check(`${label}: ${key} reads the skill's own figure and not the stored one`, k.row && k.figure && k.notStored, k);
    check(`${label}: ${key}'s tooltip names the figure, the skill and the stored figure, and the row names the skill`, k.tip && k.tipNamesSkill && k.tipNamesOther && k.skillNameShown && k.noTitle, k);
    check(`${label}: ${key}'s skill throw is not listed again under Proficiencies & powers`, k.listedOnce, k);
  }
  for (const key of ["climb", "dungeonbashing"]) {
    const k = r[key] ?? {};
    check(`${label}: ${key} stays the stored figure, with a tooltip`, k.row && k.figure && k.tip && k.noTitle, k);
  }
  check(`${label}: the hasty throw stays its own row, and the Listening skill leaves the proficiencies`, r.hastyStays && r.listeningNotInProficiencies, { hasty: r.hastyStays, listening: r.listeningNotInProficiencies });

  section(`${label}: the roll's target`);
  const expected = await run(seat, async ({ actorId }) => {
    const T = await import("/modules/acks-extras/scripts/abilities/adventuring-throw.mjs");
    const actor = game.actors.get(actorId);
    const out = {};
    for (const key of ["trapbreaking", "searching", "listening", "climb"]) out[key] = { derived: T.adventuringThrow(actor, key).target, stored: actor.system.adventuring[key] };
    return out;
  }, { actorId });

  const trap = await run(seat, P.press, { actorId, key: "trapbreaking" });
  await keep(trap.cards);
  const trapCard = trap.cards?.[0];
  check(`${label}: Trapbreaking posts one public card against the skill's figure`, trap.posted === 1 && trapCard.whisper.length === 0 && !trapCard.blind && figureOn(trapCard) === expected.trapbreaking.derived && figureOn(trapCard) !== expected.trapbreaking.stored, { posted: trap.posted, public: trapCard?.whisper.length === 0, hit: figureOn(trapCard) === expected.trapbreaking.derived });

  const climb = await run(seat, P.press, { actorId, key: "climb" });
  await keep(climb.cards);
  check(`${label}: Climbing posts one card against the stored figure`, climb.posted === 1 && figureOn(climb.cards[0]) === expected.climb.stored, { posted: climb.posted, hit: figureOn(climb.cards?.[0]) === expected.climb.stored });

  for (const key of ["searching", "listening"]) {
    const from = await run(other, P.mark);
    const secret = await run(seat, P.press, { actorId, key });
    await keep(secret.cards);
    const card = secret.cards?.[0];
    await sleep(800);
    const heard = (await run(other, P.heard, { actorId, from })).filter((c) => c.uuid === card?.uuid);
    await keep(heard);
    const judgesOnly = card && card.whisper.length > 0 && card.whisper.every((id) => gmIds.includes(id));
    if (isGM) {
      check(`${label}: ${key} posts one card whispered to the Judge, against the skill's figure`, secret.posted === 1 && judgesOnly && !card.blind && card.whisper.length === 1 && figureOn(card) === expected[key].derived, { posted: secret.posted, whispered: judgesOnly, hit: figureOn(card) === expected[key].derived });
    } else {
      check(`${label}: ${key} posts one card blind to the Judges with no roll attached`, secret.posted === 1 && judgesOnly && card.blind && card.rolls === 0, { posted: secret.posted, judgesOnly, blind: card?.blind, rolls: card?.rolls });
      check(`${label}: the Judge seat hears ${key}'s card with the skill's figure on it`, heard.length === 1 && figureOn(heard[0]) === expected[key].derived && figureOn(heard[0]) !== expected[key].stored, { heard: heard.length, hit: figureOn(heard[0]) === expected[key].derived });
    }
  }
  await run(seat, P.close, { actorId });
}

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const gmInfo = await run(gm, P.install);
  check("the GM seat is a GM", gmInfo.isGM);
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");

  section("fixture");
  const fx = await gm.fixture(MARK, "Actor", { name: "QA Adventuring Climb", type: "character", ownership: { default: 0, [playerId]: 3 } });
  const actorId = fx.id ?? String(fx.uuid).split(".").pop();
  const shape = await run(gm, P.shape, { actorId, playerId });
  check("shape: a Thief at level 3 holds Adventuring and the three skills, none missing", !shape.noThief && shape.level >= 3 && shape.missing === 0 && shape.adventuring === 1, { level: shape.level, missing: shape.missing, adventuring: shape.adventuring });
  for (const key of ["searching", "listening", "trapbreaking"]) {
    const s = shape[key] ?? {};
    check(`shape: ${key}'s skill throw is better than the stored figure, the row would derive it, and the skill's sheet reads the same`, s.skill && s.better && s.derived && s.sheetAgrees, s);
  }

  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const playerInfo = await run(player, P.install);
  check("the Player seat is not a GM", !playerInfo.isGM);
  const gmIds = gmInfo.gms;

  await walkSeat("GM", gm, player, actorId, gmIds, true);
  await walkSeat("Player", player, gm, actorId, gmIds, false);

  const pe = await run(player, P.drain);
  const ge = await run(gm, P.drain);
  check("no console error on either seat over the walk", !pe.errors.length && !ge.errors.length, { player: pe.errors.slice(0, 3), gm: ge.errors.slice(0, 3) });
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && cards.size) {
    try { note("cards swept", await gm.sweepTracked({ only: [...cards] })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixture kept: ${MARK}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
