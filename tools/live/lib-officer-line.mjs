/**
 * Live walk, a chart card's officer line: docs/lib/TESTING.md "The officer line", marker
 * `lib/officer-line`. Every step presses the control a seat presses on the faction sheet's Org chart
 * tab and reads what the press wrote: Clear, + Make the <officer>, Open, Delete actor… (cancelled,
 * then answered), an actor deleted by hand drawn as deleted on the card and on the faction's leader
 * line with the open sheet redrawn and nothing written by the redraw, a live officer (and one in a
 * compendium) not shown as deleted after a real reload, and a Player seat that owns the host and the
 * row's group. Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * The family template is the library's own, found by its cookbook id as docs/monsters/TESTING.md
 * `monsters/family-roles` describes; it is read and never written, and the walk stops as blocked where
 * the library holds none or two. The walk rolls it through the page's `rollOrganisation`, which is
 * wrapped for the run so every document a Roll makes is tracked from the Roll's own result.
 *
 * Fixture, kept and found again by marker (`api.fixture`): `lib/officer-line`, a faction host whose
 * rows the walk rewrites at its start (one empty top row naming the template) and again in its
 * teardown. The run's own products are tracked by id (each Roll's `created`, each minted leader read
 * from its group the moment the press resolves) and swept with `sweepTracked`.
 *
 * The Player seat's ownership of the host, a row's group and the officer is set by API and put back at
 * the end; the world's actor-create permission is read, never changed.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const FAMILY = "mm.familyBeastman";
const OBSERVER = 2;
const OWNER = 3;
const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in a seat's page, so none names a node-side value. */
const P = {
  census: async () => ({
    role: game.user.role,
    chartApi: !!globalThis.acksExtras?.lib?.org?.editRow && !!globalThis.acksExtras?.monsters?.rollOrganisation,
    canCreate: game.user.can("ACTOR_CREATE"),
  }),

  /** The library's family template: the library documents whose cookbook id is the family, counted so a twin stops the walk. Read only. */
  template: async ({ family }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const held = (await CB.importedDocs("Actor")).filter((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id === family);
    return { uuid: held.length === 1 ? held[0].uuid : null, twins: held.length };
  },

  /** A library actor that is not the family template, by uuid: an officer that lives in a compendium. Read only. */
  libraryOfficer: async ({ family }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const doc = (await CB.importedDocs("Actor")).find((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id !== family);
    return doc ? { uuid: doc.uuid, pack: doc.pack } : null;
  },

  /** Per variant option: whether it carries an encounter line, and whether a leader part of its recipe reaches a unit word its lines name. */
  shape: async ({ uuid }) => {
    const R = await import("/modules/acks-extras/scripts/monsters/encounter-recipe.mjs");
    const doc = await fromUuid(uuid);
    const axes = doc?.system?.toObject?.().axes ?? doc?.system?.axes ?? [];
    const options = axes.find((a) => a.key === "variant")?.options ?? [];
    return options.map((o) => {
      const encounter = o.flags?.["acks-extras"]?.extras?.encounter ?? null;
      const recipe = encounter?.recipe ?? [];
      const words = [...new Set(R.sidesOf(recipe, encounter).flatMap((s) => [s.word, s.childWord]).filter(Boolean))];
      const leaders = recipe.filter((p) => p.role === "leader").map((p) => words.filter((w) => R.appliesTo(p, w)));
      return { variant: o.key, encounter: !!encounter, reaches: leaders.some((l) => l.length > 0) };
    });
  },

  /** Wrap the page's `rollOrganisation` so each resolved result, a refusal too, is kept for the walk to track from. */
  spy: async () => {
    const api = acksExtras.monsters;
    if (!api?.rollOrganisation) return { wrapped: false };
    const orig = api.rollOrganisation.__orig ?? api.rollOrganisation;
    globalThis.__officerRolls = [];
    const wrapped = async (...args) => {
      const r = await orig(...args);
      globalThis.__officerRolls.push({ ok: !!r?.ok, reason: r?.reason ?? "", created: [...(r?.created ?? [])] });
      return r;
    };
    wrapped.__orig = orig;
    api.rollOrganisation = wrapped;
    return { wrapped: api.rollOrganisation === wrapped };
  },
  drain: async () => globalThis.__officerRolls?.splice(0) ?? [],
  unspy: async () => {
    const api = acksExtras?.monsters;
    if (api?.rollOrganisation?.__orig) api.rollOrganisation = api.rollOrganisation.__orig;
    return { restored: !api?.rollOrganisation?.__orig, left: globalThis.__officerRolls?.splice(0) ?? [] };
  },

  /** Wait for a condition in the page, polling, and answer whether it held. */
  until: async ({ expr, ms }) => {
    const end = Date.now() + (ms ?? 8000);
    while (Date.now() < end) {
      if (await (0, eval)(expr)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  },

  /** The host at one empty top row naming the family template, its sheet open on the Org chart tab. Rewrites `system.units`: only the walk's own start and teardown call it. */
  host: async ({ id, template, tab, open }) => {
    const actor = game.actors.get(id);
    await actor.update({ "system.units": [{ key: "top", parentKey: "", label: "", holderUuid: "", kind: "", notes: "", hidden: false, gen: template ? { template } : {} }], "system.leaderUuid": "" });
    if (open) {
      actor.sheet.tabGroups.primary = tab;
      await actor.sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
    }
    return { rows: actor.system.units.length };
  },

  /** Roll the whole top card through the page's api, so the wrapped function keeps the result. */
  roll: async ({ id, template, variant }) => {
    const host = game.actors.get(id);
    const run = await acksExtras.monsters.rollOrganisation({ host, rowKey: "top", template, variant, context: "wilderness", state: "lair", scope: "below", card: false });
    return { ok: !!run?.ok, reason: run?.reason ?? "" };
  },

  /** Every chart row with the leader its Roll recorded and what its group names as officer. */
  rows: async ({ id }) => game.actors.get(id).system.units.map((r) => {
    const h = r.holderUuid ? fromUuidSync(r.holderUuid) : null;
    const officer = h?.system?.unit?.officerUuid ?? "";
    return { key: r.key, parentKey: r.parentKey, holderUuid: r.holderUuid, leaderRole: r.gen?.leader?.role ?? "", morale: r.gen?.leader?.moraleBonus ?? null, officer, officerMorale: h?.system?.unit?.officerMoraleBonus ?? null, officerExists: officer ? !!fromUuidSync(officer) : false };
  }),

  /** What a minted leader carries: its generating template, whether it is marked as a minted prototype, and whether it is in the world. */
  actorRead: async ({ uuid }) => {
    const a = uuid ? fromUuidSync(uuid) : null;
    return { exists: !!a, template: a?.flags?.["acks-extras"]?.generated?.templateUuid ?? "", prototypeMark: a?.flags?.["acks-extras"]?.organisationPrototype ?? null, sheetOpen: !!a?.sheet?.rendered };
  },

  /** The officer line of a card as drawn now: its state, its words and the action of each control it carries, in order. */
  line: async ({ id, key }) => {
    const sheet = game.actors.get(id).sheet;
    const card = sheet.element?.querySelector(`li[data-key="${key}"] > div`);
    const line = card?.querySelector(".acks-extras-org-officer");
    return {
      drawn: !!line,
      gone: !!line?.classList.contains("is-gone"),
      none: !!line?.classList.contains("is-none"),
      text: line?.querySelector(".acks-extras-org-officer__name")?.textContent?.trim() ?? "",
      actions: [...(line?.querySelectorAll("[data-action]") ?? [])].map((b) => b.dataset.action),
      labels: [...(line?.querySelectorAll("[data-action]") ?? [])].map((b) => (b.getAttribute("aria-label") ?? b.textContent).trim()),
      tips: [...(line?.querySelectorAll("[data-action]") ?? [])].map((b) => !!b.dataset.tooltipText),
      headGone: !!card?.querySelector(".acks-extras-org-card__head .acks-extras-pf.is-gone"),
      inEdit: !!card?.querySelector(".acks-extras-org-card__form"),
    };
  },

  /** Press a card's own control (the pen, Done) by action. */
  pressCard: async ({ id, key, action, wait }) => {
    const btn = game.actors.get(id).sheet.element?.querySelector(`li[data-key="${key}"] > div [data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 700));
    return { pressed: true };
  },

  /** Press a control of a card's officer line by action. */
  pressLine: async ({ id, key, action, wait }) => {
    const btn = game.actors.get(id).sheet.element?.querySelector(`li[data-key="${key}"] > div .acks-extras-org-officer [data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 900));
    return { pressed: true };
  },

  /** The faction's leader line as drawn now: what it says, whether it reads deleted, and its controls. */
  leaderLine: async ({ id }) => {
    const zone = game.actors.get(id).sheet.element?.querySelector('[data-drop-zone="leader"]');
    const gone = zone?.querySelector(".is-missing");
    return {
      drawn: !!zone,
      stored: game.actors.get(id).system.leaderUuid ?? "",
      goneText: gone?.textContent?.trim() ?? "",
      goneTip: gone?.dataset.tooltip ?? "",
      actions: [...(zone?.querySelectorAll("[data-action]") ?? [])].map((b) => b.dataset.action),
    };
  },

  /** Press the faction sheet's own Clear on the leader line. */
  pressLeaderClear: async ({ id }) => {
    const btn = game.actors.get(id).sheet.element?.querySelector('[data-drop-zone="leader"] [data-action="clearLeader"]');
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    return { pressed: true };
  },

  /** Delete an actor as the Actors tab's own delete does (a hand's deletion), by uuid. */
  deleteByHand: async ({ uuid }) => {
    const a = fromUuidSync(uuid);
    if (!a) return false;
    await a.delete();
    return !fromUuidSync(uuid);
  },

  /** Write a card's officer through lib's writer, as a seat would; used to set a compendium officer and to blank a link. */
  setOfficer: async ({ id, key, officer }) => {
    const out = await acksExtras.lib.org.editRow(game.actors.get(id), key, { officer: { officer, moraleBonus: null } });
    return { ok: out.ok, reason: out.reason ?? "" };
  },

  /** How many dialogs are open. */
  dialogCount: async () => document.querySelectorAll("dialog.application, .application.dialog-v2").length,

  /** Press a button of the open dialog by its action. */
  dialog: async ({ button }) => {
    await new Promise((r) => setTimeout(r, 500));
    const dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].at(-1);
    if (!dlg) return { answered: false };
    dlg.querySelector(`[data-action="${button}"]`)?.click();
    await new Promise((r) => setTimeout(r, 900));
    return { answered: true };
  },

  /** Set a user's ownership of a document, as a Judge does in its sheet. */
  setOwnership: async ({ uuid, player, level, defaultLevel }) => {
    const doc = fromUuidSync(uuid);
    const user = game.users.find((u) => u.name === player);
    await doc.update({ ownership: { ...(defaultLevel !== undefined ? { default: defaultLevel } : {}), [user.id]: level } });
    return true;
  },

  /** What this seat reads of its own permissions on the host, a group and an officer, and the world's actor-create permission. */
  perm: async ({ id, groupUuid, officerUuid }) => {
    const host = game.actors.get(id);
    const group = fromUuidSync(groupUuid);
    const officer = officerUuid ? fromUuidSync(officerUuid) : null;
    return {
      isGM: game.user.isGM,
      hostOwner: host.isOwner,
      groupOwner: !!group?.isOwner,
      officerLimited: !!officer?.testUserPermission(game.user, "LIMITED"),
      officerDelete: !!officer?.canUserModify(game.user, "delete"),
      canCreate: game.user.can("ACTOR_CREATE"),
      createRoles: (game.settings.get("core", "permissions")?.ACTOR_CREATE ?? []).slice(),
      role: game.user.role,
    };
  },

  /** The sheet of a host rendered fresh on the Org chart tab. */
  reopen: async ({ id }) => {
    const sheet = game.actors.get(id).sheet;
    if (sheet.rendered) await sheet.close({ animate: false });
    sheet.tabGroups.primary = "orgChart";
    await sheet.render({ force: true });
    await new Promise((r) => setTimeout(r, 900));
    return { rendered: sheet.rendered };
  },

  /** Close a host's sheet and a minted leader's, so nothing stays open. */
  closeSheets: async ({ ids, uuids }) => {
    for (const id of ids ?? []) { try { await game.actors.get(id)?.sheet.close({ animate: false }); } catch (_e) { /* closed */ } }
    for (const uuid of uuids ?? []) { try { await fromUuidSync(uuid)?.sheet?.close({ animate: false }); } catch (_e) { /* closed */ } }
    return true;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const waitFor = (api, expr, ms) => run(api, P.until, { expr, ms });
const open = {};
/** Reads until `pred` holds and returns the last read, which is the failing one on a timeout. */
const until = async (api, fn, arg, pred, { tries = 40, every = 250 } = {}) => {
  let v = null;
  for (let n = 0; n < tries; n++) {
    v = await run(api, fn, arg);
    if (pred(v)) return v;
    await sleep(every);
  }
  return v;
};

/** Reload the seat's page with the browser's own reload, and wait for the world to be ready again. */
async function reload(api, seconds = 150) {
  try { await Promise.race([api.eval("setTimeout(() => location.reload(), 50); true"), sleep(3000)]); } catch { /* the page went away with the call */ }
  await sleep(2500);
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Take the results the wrapper has kept, and track every document each names, the moment they are read. */
async function rollResults(gm, ms) {
  await waitFor(gm, "(globalThis.__officerRolls?.length ?? 0) > 0", ms);
  const rolls = await run(gm, P.drain, null);
  for (const r of rolls) for (const uuid of r.created) gm.track(uuid);
  return rolls;
}

const hasAll = (have, want) => want.every((a) => have.includes(a));

let fid = null;
try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  for (let n = 0; n < 60 && !(await gm.eval("!!globalThis.acksExtras?.importer?.connectBookUrl")); n++) await sleep(1000);
  const census = await run(gm, P.census);
  if (!census.chartApi) blocked("the org writers or the generating feature are not on the page: the module did not load");
  check("the seat is a GM, and may create actors", census.role >= 3 && census.canCreate === true, census);

  section("the library's family template, and the shape this walk needs from it");
  const tpl = await run(gm, P.template, { family: FAMILY });
  check("the library holds exactly one template of the family", tpl.twins === 1 && !!tpl.uuid, { twins: tpl.twins });
  if (tpl.twins !== 1 || !tpl.uuid) blocked("the library does not hold exactly one family template; the walk reads it and never builds a twin (import the family through the entry picker first)");
  const shape = await run(gm, P.shape, { uuid: tpl.uuid });
  const variant = shape.find((v) => v.encounter && v.reaches)?.variant ?? "";
  check("a variant of the template has an encounter line and a leader part that reaches a unit word", !!variant, shape);
  if (!variant) blocked("no variant of the library's family template names a leader that reaches a unit word, so no Roll can make the leader a Make needs");
  const spied = await run(gm, P.spy, null);
  if (!spied.wrapped) blocked("the page's rollOrganisation could not be wrapped, so what a Roll makes could not be tracked and swept");

  section("fixture: a faction host with a rolled chart");
  const faction = await gm.fixture("lib/officer-line", "Actor", { name: `QA Officer line${TAG}`, type: "acks-extras.faction", items: [] });
  fid = faction.id;
  note("fixture", { host: faction.uuid });
  await run(gm, P.host, { id: fid, template: tpl.uuid, tab: "orgChart", open: true });
  await run(gm, P.roll, { id: fid, template: tpl.uuid, variant });
  const rolled = await rollResults(gm, 30000);
  check("the Roll resolved", rolled.length >= 1 && rolled.every((r) => r.ok), rolled.map((r) => ({ ok: r.ok, reason: r.reason, made: r.created.length })));
  const rows0 = await run(gm, P.rows, { id: fid });
  const withLeader = rows0.filter((r) => r.holderUuid && r.leaderRole);
  check("the Roll records the first leader it made on each row that has one", withLeader.length >= 1 && withLeader.every((r) => !!r.officer), withLeader.map((r) => ({ key: r.key, role: r.leaderRole, officer: !!r.officer })));
  const rowA = withLeader.find((r) => r.parentKey) ?? withLeader[0];
  const rowB = withLeader.find((r) => r.key !== rowA?.key && r.parentKey) ?? null;
  if (!rowA) blocked("the Roll made no leader on any row: the recipe's leader parts did not reach this roll's units");
  const A = rowA.key;
  note("rows used", { rowA: A, rowB: rowB?.key ?? null, top: rows0.find((r) => !r.parentKey)?.leaderRole ?? "" });

  section("the officer line of a live officer, in a card's pen");
  check("the card is drawn and its pen opens the form", (await run(gm, P.pressCard, { id: fid, key: A, action: "orgEdit" })).pressed);
  const live = await until(gm, P.line, { id: fid, key: A }, (l) => l.drawn && l.inEdit);
  check("a live line offers Open, Clear and Delete actor…, and no Make", hasAll(live.actions, ["orgOpen", "orgClearLeader", "orgDeleteLeaderActor"]) && !live.actions.includes("orgMakeLeader") && !live.gone, live);
  check("each control carries a tooltip", live.tips.length > 0 && live.tips.every(Boolean), live.tips);

  section("3. Clear: the link goes, the actor stays");
  const O0 = rowA.officer;
  await run(gm, P.pressLine, { id: fid, key: A, action: "orgClearLeader" });
  const cleared = await waitFor(gm, `!fromUuidSync(game.actors.get("${fid}").system.units.find((r) => r.key === "${A}").holderUuid)?.system.unit.officerUuid`, 8000);
  const afterClear = (await run(gm, P.rows, { id: fid })).find((r) => r.key === A);
  check("Clear blanks the group's officer and deletes no actor", cleared && afterClear.officer === "" && (await run(gm, P.actorRead, { uuid: O0 })).exists === true, { officer: afterClear.officer });
  const emptied = await until(gm, P.line, { id: fid, key: A }, (l) => l.none);
  check("the line now reads empty and offers + Make the <officer>", emptied.none && emptied.actions.includes("orgMakeLeader") && !emptied.actions.includes("orgOpen") && !emptied.actions.includes("orgDeleteLeaderActor"), emptied);

  section("1. Make: a new leader, set as the officer");
  await run(gm, P.pressLine, { id: fid, key: A, action: "orgMakeLeader", wait: 1500 });
  await waitFor(gm, `!!fromUuidSync(game.actors.get("${fid}").system.units.find((r) => r.key === "${A}").holderUuid)?.system.unit.officerUuid`, 20000);
  const made = (await run(gm, P.rows, { id: fid })).find((r) => r.key === A);
  const O1 = made.officer;
  if (O1) gm.track(O1);
  note("the minted leader's uuid, tracked", O1);
  const read1 = await run(gm, P.actorRead, { uuid: O1 });
  check("Make sets a new actor as the officer: a world actor, not the cleared one", !!O1 && O1 !== O0 && read1.exists, { O1, O0 });
  check("it is made from the chart's template and is marked as no minted prototype", read1.template === tpl.uuid && read1.prototypeMark === null, read1);
  check("it carries the morale part the row recorded", made.officerMorale === rowA.morale, { recorded: rowA.morale, written: made.officerMorale });
  const rows1 = await run(gm, P.rows, { id: fid });
  check("no other row shares it", rows1.filter((r) => r.officer === O1).length === 1, rows1.filter((r) => r.officer === O1).length);
  const liveAgain = await until(gm, P.line, { id: fid, key: A }, (l) => l.actions.includes("orgOpen"));
  check("the line reads live again", !liveAgain.gone && !liveAgain.none && hasAll(liveAgain.actions, ["orgOpen", "orgClearLeader", "orgDeleteLeaderActor"]), liveAgain);

  section("2. Open");
  await run(gm, P.pressLine, { id: fid, key: A, action: "orgOpen", wait: 1200 });
  const opened = await waitFor(gm, `!!fromUuidSync("${O1}")?.sheet?.rendered`, 8000);
  check("Open renders the officer's own sheet", opened);
  await run(gm, P.closeSheets, { ids: [], uuids: [O1] });

  section("4. Delete actor…: asks first, then deletes the actor and clears the link");
  const dialogs0 = await run(gm, P.dialogCount, null);
  await run(gm, P.pressLine, { id: fid, key: A, action: "orgDeleteLeaderActor", wait: 800 });
  check("the press opens a confirm", (await run(gm, P.dialogCount, null)) === dialogs0 + 1);
  await run(gm, P.dialog, { button: "no" });
  const kept = (await run(gm, P.rows, { id: fid })).find((r) => r.key === A);
  check("answering no changes nothing: the link stands and the actor is in the world", kept.officer === O1 && (await run(gm, P.actorRead, { uuid: O1 })).exists, kept.officer);
  await run(gm, P.pressLine, { id: fid, key: A, action: "orgDeleteLeaderActor", wait: 800 });
  await run(gm, P.dialog, { button: "yes" });
  const goneNow = await waitFor(gm, `!fromUuidSync("${O1}")`, 8000);
  const afterDelete = (await run(gm, P.rows, { id: fid })).find((r) => r.key === A);
  check("answering yes deletes the actor and clears the card's link", goneNow && afterDelete.officer === "", { officer: afterDelete.officer });
  const empty2 = await until(gm, P.line, { id: fid, key: A }, (l) => l.none);
  check("the line reads empty with + Make, not deleted: only a delete made outside the chart leaves a dangling link", empty2.none && !empty2.gone && empty2.actions.includes("orgMakeLeader"), empty2);

  section("5. an actor deleted by hand is drawn as deleted, and the open chart redraws");
  await run(gm, P.pressLine, { id: fid, key: A, action: "orgMakeLeader", wait: 1500 });
  await waitFor(gm, `!!fromUuidSync(game.actors.get("${fid}").system.units.find((r) => r.key === "${A}").holderUuid)?.system.unit.officerUuid`, 20000);
  const O2 = (await run(gm, P.rows, { id: fid })).find((r) => r.key === A).officer;
  if (O2) gm.track(O2);
  await run(gm, P.pressCard, { id: fid, key: A, action: "orgEditDone", wait: 900 });
  const closed = await run(gm, P.line, { id: fid, key: A });
  check("with the card out of its pen a live officer draws no officer line", closed.inEdit === false && closed.drawn === false, closed);
  const writes0 = JSON.stringify((await run(gm, P.rows, { id: fid })).map((r) => [r.key, r.holderUuid, r.officer]));
  note("NOTE", "the delete is driven by API (the call the Actors tab's own delete ends in), and the sheet is left to redraw with no press");
  check("the officer is deleted from the world", await run(gm, P.deleteByHand, { uuid: O2 }));
  const gone = await until(gm, P.line, { id: fid, key: A }, (l) => l.gone, { tries: 60 });
  check("the open sheet redraws by itself: the card's officer line reads deleted, with + Make and Clear and no Open or Delete actor…", gone.gone && hasAll(gone.actions, ["orgMakeLeader", "orgClearLeader"]) && !gone.actions.includes("orgOpen") && !gone.actions.includes("orgDeleteLeaderActor"), gone);
  check("the card's head marks it deleted too", gone.headGone === true, gone.headGone);
  const writes1 = JSON.stringify((await run(gm, P.rows, { id: fid })).map((r) => [r.key, r.holderUuid, r.officer]));
  check("the redraw wrote nothing and cleared no link: the group still names the deleted actor", writes0 === writes1 && (await run(gm, P.rows, { id: fid })).find((r) => r.key === A).officer === O2, { named: O2 });
  const topRow = rows0.find((r) => !r.parentKey);
  const L = topRow?.officer ?? "";
  const factionLeader = (await run(gm, P.leaderLine, { id: fid })).stored;
  if (L && factionLeader === L) {
    check("the faction's leader is the top row's officer, so one delete tests both lines", true, { leader: L });
    check("the leader is deleted from the world by hand", await run(gm, P.deleteByHand, { uuid: L }));
    const leaderGone = await until(gm, P.leaderLine, { id: fid }, (l) => l.goneText !== "", { tries: 60 });
    check("the faction's leader line reads deleted, with a tooltip, and keeps its Clear", leaderGone.goneText.length > 0 && leaderGone.goneTip.length > 0 && leaderGone.actions.includes("clearLeader") && leaderGone.stored === L, leaderGone);
    check("a Make is not drawn on the faction's leader line: it is built with the village-as-faction slice", !leaderGone.actions.includes("orgMakeLeader"), leaderGone.actions);
    await run(gm, P.pressLeaderClear, { id: fid });
    check("the faction's Clear blanks its leader", (await run(gm, P.leaderLine, { id: fid })).stored === "");
  } else note("not walked", "the faction's leader is not the top row's officer in this roll, so the faction's leader line has no deleted actor to show");
  await run(gm, P.pressCard, { id: fid, key: A, action: "orgEdit", wait: 800 });
  await run(gm, P.pressLine, { id: fid, key: A, action: "orgMakeLeader", wait: 1500 });
  await waitFor(gm, `fromUuidSync(game.actors.get("${fid}").system.units.find((r) => r.key === "${A}").holderUuid)?.system.unit.officerUuid !== "${O2}"`, 20000);
  const O3 = (await run(gm, P.rows, { id: fid })).find((r) => r.key === A).officer;
  if (O3) gm.track(O3);
  const replaced = await until(gm, P.line, { id: fid, key: A }, (l) => !l.gone && l.actions.includes("orgOpen"));
  check("+ Make on the deleted line sets a new officer in place of the dead link, and the line reads live", !!O3 && O3 !== O2 && !replaced.gone, { O3 });

  section("6. after a reload, a live officer is not shown as deleted");
  let libOfficer = null;
  if (rowB) {
    libOfficer = await run(gm, P.libraryOfficer, { family: FAMILY });
    if (libOfficer) check("a compendium actor is set as row B's officer through lib's writer", (await run(gm, P.setOfficer, { id: fid, key: rowB.key, officer: libOfficer.uuid })).ok, libOfficer.pack);
  }
  const secs = await reload(gm);
  note("ready after reload (s)", secs);
  await run(gm, P.reopen, { id: fid });
  await run(gm, P.pressCard, { id: fid, key: A, action: "orgEdit", wait: 900 });
  const afterReload = await until(gm, P.line, { id: fid, key: A }, (l) => l.drawn && l.inEdit);
  check("a world officer reads live after a reload", afterReload.drawn && !afterReload.gone && afterReload.actions.includes("orgOpen"), afterReload);
  if (rowB && libOfficer) {
    await run(gm, P.pressCard, { id: fid, key: rowB.key, action: "orgEdit", wait: 900 });
    const lib = await until(gm, P.line, { id: fid, key: rowB.key }, (l) => l.drawn && l.inEdit);
    check("an officer in a compendium reads live on the first draw after a reload, never deleted", lib.drawn && !lib.gone && !lib.none && lib.actions.includes("orgClearLeader"), lib);
    check("a compendium officer offers no Delete actor…: the seat has no document to ask about", !lib.actions.includes("orgDeleteLeaderActor"), lib.actions);
  } else note("not walked", "the library holds no second actor, or no second row made a leader, so no compendium officer was set");

  section("7. the Player seat, owning the host and the row's group");
  const rowsNow = await run(gm, P.rows, { id: fid });
  const groupUuid = rowsNow.find((r) => r.key === A).holderUuid;
  const officerNow = rowsNow.find((r) => r.key === A).officer;
  await run(gm, P.setOwnership, { uuid: faction.uuid, player: MACHINE.player, level: OWNER });
  await run(gm, P.setOwnership, { uuid: groupUuid, player: MACHINE.player, level: OWNER });
  await run(gm, P.setOwnership, { uuid: officerNow, player: MACHINE.player, level: OBSERVER, defaultLevel: OBSERVER });
  open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const player = open.player;
  const perm = await until(player, P.perm, { id: fid, groupUuid, officerUuid: officerNow }, (p) => p.hostOwner && p.groupOwner && !p.isGM);
  check("on the Player's own page the seat owns the host and the group, may see the officer and may not delete it", perm.hostOwner && perm.groupOwner && perm.officerLimited && perm.officerDelete === false && perm.isGM === false, perm);
  note("the world's actor-create permission (roles that may create), read on the Player seat", { canCreate: perm.canCreate, roles: perm.createRoles, role: perm.role });
  await run(player, P.reopen, { id: fid });
  await run(player, P.pressCard, { id: fid, key: A, action: "orgEdit", wait: 900 });
  const pLine = await until(player, P.line, { id: fid, key: A }, (l) => l.drawn && l.inEdit);
  check("the Player sees Open and Clear", hasAll(pLine.actions, ["orgOpen", "orgClearLeader"]), pLine);
  check("Delete actor… is not rendered for a Player with no delete right over the officer", !pLine.actions.includes("orgDeleteLeaderActor"), pLine.actions);
  check("+ Make is not drawn on a live line", !pLine.actions.includes("orgMakeLeader"), pLine.actions);
  await run(gm, P.setOfficer, { id: fid, key: A, officer: "" });
  await run(player, P.reopen, { id: fid });
  await run(player, P.pressCard, { id: fid, key: A, action: "orgEdit", wait: 900 });
  const pEmpty = await until(player, P.line, { id: fid, key: A }, (l) => l.drawn && l.none);
  check(`on an empty line + Make is ${perm.canCreate ? "shown" : "absent"} as the world's actor-create permission says (${perm.canCreate ? "Players may create actors" : "Players may not create actors"})`, pEmpty.actions.includes("orgMakeLeader") === perm.canCreate, { canCreate: perm.canCreate, actions: pEmpty.actions });
  if (perm.canCreate) {
    await run(player, P.pressLine, { id: fid, key: A, action: "orgMakeLeader", wait: 2000 });
    const O4 = await until(gm, P.rows, { id: fid }, (r) => !!r.find((x) => x.key === A)?.officer);
    const made4 = O4.find((x) => x.key === A).officer;
    if (made4) gm.track(made4);
    check("the Player's Make wrote the officer, and the actor is tracked for the sweep", !!made4, made4);
  } else note("not walked", "Players may not create actors in this world, so the Player's Make press was not driven; the control's absence is what was asserted");

  note("not walked", "the faction leader line's + Make (built with the village-as-faction slice), the Delete actor… and Make presses on a seat that lost ownership between render and press, and the Player's absent-Make branch while Players may create (the world's permission is read, never changed)");
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
    process.exitCode = 1;
  }
} finally {
  section("teardown");
  const gm = open.gm;
  if (gm) {
    try { await run(gm, P.closeSheets, { ids: fid ? [fid] : [], uuids: [] }); } catch (err) { console.error("close:", err?.message ?? err); }
    try {
      const back = await run(gm, P.unspy, null);
      for (const r of back.left) for (const uuid of r.created) gm.track(uuid);
      note("the page's rollOrganisation restored", { restored: back.restored, untracked: back.left.length });
    } catch (err) { console.error("unspy:", err?.message ?? err); }
    // The kept host goes back to one empty top row and the Player's ownership of it is dropped, so the next run starts from a known shape.
    try {
      if (fid) {
        await run(gm, P.host, { id: fid, template: "", tab: "orgChart", open: false });
        await run(gm, P.setOwnership, { uuid: `Actor.${fid}`, player: MACHINE.player, level: 0 });
      }
    } catch (err) { console.error("reset:", err?.message ?? err); }
    // The run's own products go by the ids the ledger holds; the marked fixture stays for the next walk.
    try { note("swept", await gm.sweepTracked({ only: gm.tracked().filter((e) => !e.marker).map((e) => e.uuid) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
