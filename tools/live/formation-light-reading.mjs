/**
 * Live walk, formation-light-reading: a party whose only light is a shining
 * magic light counts as lit on the dungeon turn card and on the party sheet's
 * header. Walks docs/formation/TESTING.md "A magic light as the only light" on
 * the GM seat. A party in the delve with no flame lit and one member carrying a
 * magic light effect on a carried item reads: the turn card the party's one
 * turn posts has its status list and none of the no-light line; the figures
 * rail's light cell, read from the open party sheet's DOM, shows the Kit row's
 * state badge in place of the no-light reading, and the Kit row's badge reads
 * Shining. The control: the light shuttered through the Kit row's own Shutter
 * button, the next turn card carries the no-light line, the cell reads the
 * no-light reading and no longer the badge, and the row reads Shuttered. The
 * lines are matched by their lang strings, read at run time. Prints booleans
 * and counts. Machine values arrive through ./_env.mjs.
 *
 * A turn advance moves world time, and the kept party's rest and encounter
 * counters accumulate across runs; nothing here reads either.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `formation/light-reading` (the party actor), `formation/light-reading-member`
 * (a character the party holds) and `formation/light-reading-lamp` (a plain
 * carried item on the member). The magic light effect on the lamp and every
 * turn card the walk's own client posted for the party are the run's own,
 * tracked by uuid and swept; the fixtures end with no effect.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import { MACHINE, PORTS, note, section, check, checks, idOf, run, until, ready } from "./_class-style-kit.mjs";

const { browser, origin } = MACHINE;
const PARTY = "formation/light-reading";
const MEMBER = "formation/light-reading-member";
const LAMP = "formation/light-reading-lamp";
const NEEDS = "!!globalThis.acksExtras?.formation?.advanceTurns && !!globalThis.acksExtras?.formation?.travel";

const P = {
  install: async () => {
    const H = (globalThis.__lr = globalThis.__lr ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 200 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.FM = await import(`${base}formation/formation-model.mjs`);
    H.LT = await import(`${base}lib/light.mjs`);
    H.IM = await import(`${base}lib/item-model.mjs`);
    H.EF = await import(`${base}equipment/item-sheet/effect-starts.mjs`);
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.cards = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) H.cards.push({ id: m.id, alias: m.speaker?.alias ?? null, actor: m.speaker?.actor ?? null }); });
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  /** The party actor's formation id, adopted when none stands. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__lr;
    const find = () => Object.values(H.FM.getFormations()).find((f) => f.actorId === partyId);
    let found = await H.poll(find, { tries: 40, every: 200 });
    if (!found) { await H.FM.adoptPartyActor(game.actors.get(partyId)); found = await H.poll(find, { tries: 40, every: 200 }); }
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },
  /** The party holds exactly this member, seated through the party sheet's own drop. */
  seat: async ({ partyId, fid, actorId }) => {
    const H = globalThis.__lr;
    const ids = () => H.FM.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    const ok = () => ids().length === 1 && ids()[0] === actorId;
    if (!ok()) {
      for (const id of ids()) await H.FM.removeMember(H.FM.getFormation(fid), id);
      const sheet = game.actors.get(partyId).sheet;
      await sheet.render(true);
      await H.sleep(900);
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(actorId).uuid }));
      H.root(sheet).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await H.poll(ok, { tries: 40, every: 150 });
    }
    return { members: ids().length, seated: ok() };
  },
  /** An effect made with the Add Effect control's own start data, its bright and dim reaches typed. */
  makeEffect: async ({ actorId, itemId, bright, dim }) => {
    const H = globalThis.__lr;
    const item = game.actors.get(actorId).items.get(itemId);
    const data = H.EF.effectStartData("light", item, { lightName: game.i18n.localize("ACKS-EQUIPMENT.itemSheet.effects.lightEffect") });
    const band = (b) => data.changes.find((c) => c.key.endsWith(`.magicLight.${b}`));
    band("bright").value = String(bright);
    band("dim").value = String(dim);
    const [eff] = await item.createEmbeddedDocuments("ActiveEffect", [data]);
    return { id: eff.id, uuid: eff.uuid };
  },
  /** The known shape: no flame lit, the delve, the lamp out of every container, nothing shuttered. */
  shape: async ({ fid, actorId, itemId, effectId }) => {
    const H = globalThis.__lr;
    const f = H.FM.getFormation(fid);
    if ((f.lights ?? []).length) { f.lights = []; await H.FM.updateFormation(f); }
    const travel = acksExtras.formation.travel;
    if (travel.travelOf(H.FM.getFormation(fid)).mode !== "delve") await travel.setJourneyMode(fid, "delve");
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    if (H.IM.containedIn(item)) await item.unsetFlag("acks-extras", "containedIn");
    const eff = item.effects.get(effectId);
    if (H.LT.isLightShuttered(eff)) await H.LT.setLightShutter(eff, false);
    await H.sleep(500);
    const g = H.FM.getFormation(fid);
    return {
      litFlames: (g.lights ?? []).filter((l) => l.lit).length,
      mode: travel.travelOf(g).mode,
      lampState: H.LT.lightStateOf(item.effects.get(effectId)),
      hasLight: H.FM.formationHasLight(g),
      bright: H.LT.effectLight(actor).bright,
      dim: H.LT.effectLight(actor).dim,
    };
  },
  /** One dungeon turn on the record; the party's own cards the run's client made, read by their text. */
  advance: async ({ fid, partyId }) => {
    const H = globalThis.__lr;
    const name = H.FM.getFormation(fid).name;
    const before = H.cards.length;
    await acksExtras.formation.advanceTurns(H.FM.getFormation(fid), 1);
    await H.sleep(1500);
    const noLight = game.i18n.localize("ACKS-FORMATION.chat.noLight");
    const mine = H.cards.slice(before).filter((c) => c.alias === name || c.actor === partyId);
    return mine.map((c) => {
      const doc = new DOMParser().parseFromString(game.messages.get(c.id)?.content ?? "", "text/html");
      return { id: c.id, turnCard: !!doc.querySelector(".acks-formation-card ul.status"), status: doc.querySelectorAll("ul.status li").length, noLight: doc.body.textContent.includes(noLight) };
    });
  },
  /** The party sheet freshly opened on its Kit tab. */
  openKit: async ({ partyId }) => {
    const H = globalThis.__lr;
    const app = game.actors.get(partyId).sheet;
    await app.close({ animate: false });
    await app.render(true);
    await H.poll(() => H.root(app)?.isConnected);
    await H.sleep(700);
    H.root(app)?.querySelector('[data-action="tab"][data-tab="kit"]')?.click();
    await H.sleep(500);
    return { rendered: !!H.root(app) && app.state === 2 };
  },
  /** The Kit tab's magic-light rows and the figures rail's light cell, as drawn. */
  reading: async ({ partyId }) => {
    const H = globalThis.__lr;
    const root = H.root(game.actors.get(partyId).sheet);
    const rows = [...(root?.querySelectorAll(".magic-light") ?? [])].map((r) => ({
      key: r.dataset.magicLight,
      state: r.querySelector(".acks-extras-light-state")?.dataset.state ?? null,
      badge: r.querySelector(".acks-extras-light-state")?.textContent.trim() ?? "",
    }));
    const cell = [...(root?.querySelectorAll(".acks-extras-party-sheet__rail--figures .acks-extras-party-sheet__cell") ?? [])].find((c) => c.querySelector("i.fa-fire-flame-curved"));
    const sub = cell?.querySelector(".acks-extras-party-sheet__cell-sub")?.textContent.trim() ?? "";
    const title = `${cell?.getAttribute("data-tooltip") ?? ""} ${cell?.getAttribute("aria-label") ?? ""} ${cell?.querySelector(".acks-sr-only")?.textContent ?? ""}`;
    const noLight = game.i18n.localize("ACKS-FORMATION.frame.figure.noLight");
    const badge = rows[0]?.badge ?? "";
    return {
      rows,
      cell: !!cell,
      readsBadge: !!badge && sub === badge && title.includes(badge),
      readsNoLight: title.includes(noLight),
    };
  },
  pressShutter: async ({ partyId, key }) => {
    const H = globalThis.__lr;
    const btn = H.root(game.actors.get(partyId).sheet)?.querySelector(`[data-magic-light="${key}"] [data-action="shutterMagicLight"]`);
    if (!btn) return { button: false };
    btn.click();
    return { button: true };
  },
  effectState: async ({ actorId, itemId, effectId }) => {
    const H = globalThis.__lr;
    const eff = game.actors.get(actorId).items.get(itemId)?.effects.get(effectId);
    return { state: eff ? H.LT.lightStateOf(eff) : null, shuttered: eff ? H.LT.isLightShuttered(eff) : null };
  },
  closeSheet: async ({ partyId }) => { await game.actors.get(partyId)?.sheet?.close({ animate: false }); return true; },
  drain: async () => ({ errors: globalThis.__lr.errors.slice() }),
  restore: async () => {
    const H = globalThis.__lr;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    Hooks.off("createChatMessage", H.hook);
    H.patched = false;
    return "restored";
  },
};

let gm = null;
let ids = null;
const swept = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 600_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Track the cards a turn made, so teardown sweeps them by id. */
const keepCards = async (cards) => {
  for (const c of cards) { const uuid = `ChatMessage.${c.id}`; if (!swept.includes(uuid)) { swept.push(uuid); await gm.track(uuid, "ChatMessage"); } }
};

try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm", NEEDS));
  const installed = await run(gm, P.install);
  check("the GM seat is the active GM and the formation api is published", installed.isGM && installed.activeGMIsSelf, installed);

  section("fixtures");
  const party = await gm.fixture(PARTY, "Actor", { name: "QA Light Reading Party", type: "acks-extras.party", ownership: { default: 2 } });
  const member = await gm.fixture(MEMBER, "Actor", { name: "QA Light Reading Member", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 } } });
  const lamp = await gm.fixture(LAMP, "Item", { name: "QA Light Reading Lamp", type: "item", system: { quantity: 1 } }, { parent: member.uuid });
  ids = { party: idOf(party), member: idOf(member), lamp: idOf(lamp) };
  const fo = await run(gm, P.formationOf, { partyId: ids.party });
  if (fo.error) blocked(fo.error);
  ids.fid = fo.fid;
  const seated = await run(gm, P.seat, { partyId: ids.party, fid: ids.fid, actorId: ids.member });
  check("the party holds the one member", seated.seated, seated);
  const made = await run(gm, P.makeEffect, { actorId: ids.member, itemId: ids.lamp, bright: 11, dim: 23 });
  swept.push(made.uuid);
  await gm.track(made.uuid, "ActiveEffect");
  const eref = { actorId: ids.member, itemId: ids.lamp, effectId: made.id };

  section("1. a shining magic light is the party's only light");
  const shape = await run(gm, P.shape, { fid: ids.fid, ...eref });
  check("shape: no flame lit, the delve, the lamp's light shining with a positive reach, and the party counts as lit", shape.litFlames === 0 && shape.mode === "delve" && shape.lampState === "shining" && shape.bright > 0 && shape.dim > 0 && shape.hasLight, shape);
  const lit = await run(gm, P.advance, { fid: ids.fid, partyId: ids.party });
  await keepCards(lit);
  const litTurn = lit.find((c) => c.turnCard);
  check("one turn posted a turn card for the party", !!litTurn && litTurn.status > 0, { cards: lit.length, turnCard: !!litTurn });
  check("the turn card has no no-light line", !!litTurn && !litTurn.noLight, { noLight: litTurn?.noLight });
  await run(gm, P.openKit, { partyId: ids.party });
  const rd = await run(gm, P.reading, { partyId: ids.party });
  check("the Kit tab lists one magic light row, Shining", rd.rows.length === 1 && rd.rows[0].state === "shining" && rd.rows[0].badge.length > 0, { rows: rd.rows.length, state: rd.rows[0]?.state });
  check("the header's light cell reads the row's badge and not the no-light reading", rd.cell && rd.readsBadge && !rd.readsNoLight, { cell: rd.cell, readsBadge: rd.readsBadge, readsNoLight: rd.readsNoLight });

  section("2. control: the light shuttered");
  const key = rd.rows[0]?.key;
  const press = await run(gm, P.pressShutter, { partyId: ids.party, key });
  check("the Kit row's Shutter button is pressed", press.button, press);
  const flipped = await until(gm, P.effectState, eref, (v) => v.shuttered === true && v.state === "shuttered");
  check("the effect reads Shuttered", flipped.ok, flipped.value);
  const dark = await run(gm, P.advance, { fid: ids.fid, partyId: ids.party });
  await keepCards(dark);
  const darkTurn = dark.find((c) => c.turnCard);
  check("one turn posted a turn card for the party, and it carries the no-light line", !!darkTurn && darkTurn.noLight, { cards: dark.length, noLight: darkTurn?.noLight });
  await run(gm, P.openKit, { partyId: ids.party });
  const rd2 = await run(gm, P.reading, { partyId: ids.party });
  check("the Kit row reads Shuttered", rd2.rows.length === 1 && rd2.rows[0].state === "shuttered", { rows: rd2.rows.length, state: rd2.rows[0]?.state });
  check("the header's light cell reads the no-light reading and no longer the badge", rd2.cell && rd2.readsNoLight && !rd2.readsBadge, { cell: rd2.cell, readsBadge: rd2.readsBadge, readsNoLight: rd2.readsNoLight });

  const drained = await run(gm, P.drain);
  check("no console error over the walk", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  if (gm && ids) {
    try { await run(gm, P.closeSheet, { partyId: ids.party }); } catch {}
    try { note("sweep of the walk's own effect and cards", await gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  console.log(`fixtures kept: ${PARTY}, ${MEMBER}, ${LAMP}`);
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
