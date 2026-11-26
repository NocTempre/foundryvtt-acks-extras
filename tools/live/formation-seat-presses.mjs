/**
 * Live walk: docs/formation/TESTING.md "A seat's presses follow what it owns"
 * (T-0792 slice 1). Before the frame draws a player's cells, the presses are
 * driven from a real Player seat as the sheet would call them: Form up through
 * the relay, the saves and Supplies handlers narrowed to the members the seat
 * owns, a party check declared through the `check` request, the description
 * written as the party actor's owner while the record's name stays put, and
 * the skill audit's select live for the seat's own ability and disabled for
 * another's. The relay refuses a forged order id and a party the seat owns no
 * member of, writing nothing. No load error lands on either seat under a
 * recorder added before reload.
 *
 * Every fixture and figure is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): the party `formation/seat-party` holding the Player seat's
 * `formation/seat-member` and the Judge's `formation/seat-other`; the party
 * `formation/seat-solo-party` holding only the Judge's `formation/seat-stranger`;
 * the abilities `formation/seat-member-ability` and `formation/seat-other-ability`
 * on the two members. The walk brings them to its start shape itself: the two
 * in their party, member first, the stranger alone in its own, an empty
 * description, both abilities bound to nothing.
 * Writes outside the ledger: one saved marching order, created and forgotten by
 * id in the run; the cards the presses post are tracked by id and swept.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const SCOPE = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__spBoot = { phase: "load", phases: [], errors: [] });
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

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    user: game.user.name,
    userId: game.user.id,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    active: game.users.filter((u) => u.active).map((u) => u.name),
    boot: globalThis.__spBoot ?? null,
  }),

  install: async () => {
    const H = (globalThis.__sp = globalThis.__sp ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.requests = await import(`${base}formation/player-requests.mjs`);
    H.actions = await import(`${base}formation/formation-actions.mjs`);
    H.marching = await import(`${base}formation/marching-templates.mjs`);
    H.audit = await import(`${base}formation/skill-audit.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.order = (fid) => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    return { ok: typeof H.requests.userOwnsMember === "function" && typeof H.actions.SHARED_ACTIONS.partySave === "function" };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__sp;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** The two members in their party, member first; the stranger alone in its own; no description; no binding. */
  startShape: async ({ fid, soloFid, member, other, stranger, abilities }) => {
    const H = globalThis.__sp;
    for (const [id, f] of [[member, fid], [other, fid], [stranger, soloFid]]) {
      if (!H.model.getFormation(f).members.some((m) => m?.actorId === id)) await H.model.addMember(H.model.getFormation(f), game.actors.get(id), null, { scene: null });
    }
    if (H.order(fid)[0] !== member) {
      await H.model.patchFormation(fid, (rec) => {
        rec.members.sort((a, b) => (b?.actorId === member) - (a?.actorId === member));
      });
    }
    await game.actors.get(H.model.getFormation(fid).actorId).update({ "system.description": "" });
    for (const uuid of abilities) await fromUuidSync(uuid)?.unsetFlag("acks-extras", "checkKey");
    await H.sleep(500);
    return { order: H.order(fid), solo: H.order(soloFid) };
  },

  /** Save the party's order under a name, then put it the other way round so a form-up has something to restore. */
  saveAndScramble: async ({ fid, name }) => {
    const H = globalThis.__sp;
    const saved = await H.marching.saveTemplate(H.model.getFormation(fid), name);
    await H.model.patchFormation(fid, (rec) => void rec.members.reverse());
    await H.sleep(400);
    return { id: saved?.template?.id ?? null, order: H.order(fid) };
  },

  forget: async ({ id }) => ({ forgotten: await globalThis.__sp.marching.deleteTemplate(id) }),

  owns: async ({ partyId, fid }) => {
    const H = globalThis.__sp;
    return { party: !!game.actors.get(partyId)?.isOwner, member: H.requests.userOwnsMember(H.model.getFormation(fid), game.user) };
  },

  relay: async ({ fid, type, payload }) => {
    const H = globalThis.__sp;
    const answer = await H.requests.requestPartyAction(fid, type, payload);
    await H.sleep(1500);
    return { answer: answer ?? null };
  },

  order: async ({ fid }) => ({ order: globalThis.__sp.order(fid) }),

  awaitOrder: async ({ fid, expect }) => {
    const H = globalThis.__sp;
    return !!(await H.poll(() => JSON.stringify(H.order(fid)) === JSON.stringify(expect)));
  },

  open: async ({ partyId }) => {
    const H = globalThis.__sp;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    return { rendered: !!H.root(app), editable: !!app.isEditable };
  },

  close: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** A sheet handler called as the frame's cell calls it, on this seat's open sheet. */
  press: async ({ partyId, action, dataset = {} }) => {
    const H = globalThis.__sp;
    const app = game.actors.get(partyId).sheet;
    const target = document.createElement("button");
    Object.assign(target.dataset, dataset);
    await H.actions.SHARED_ACTIONS[action].call(app, new PointerEvent("click"), target);
    await H.sleep(1500);
    return { pressed: action };
  },

  /** The sheet's form handler with a description and a record field, as a submit would hand them. */
  submit: async ({ partyId, description, name }) => {
    const H = globalThis.__sp;
    const app = game.actors.get(partyId).sheet;
    await H.actions.onChangeForm.call(app, new Event("change"), H.root(app), { object: { "system.description": description, name } });
    await H.sleep(1200);
    return { submitted: true };
  },

  partyRead: async ({ partyId, fid }) => ({
    description: game.actors.get(partyId).system?.description ?? null,
    name: globalThis.__sp.model.getFormation(fid).name,
  }),

  /** A save key every character carries a number for. */
  saveKey: async ({ actorId }) => {
    const saves = game.actors.get(actorId)?.system?.saves ?? {};
    return { key: Object.keys(saves).find((k) => typeof saves[k]?.value === "number") ?? null };
  },

  /** The skill audit, built on this seat as its opener builds it, and what each ability's select allows. */
  auditOpen: async ({ fid, abilities }) => {
    const H = globalThis.__sp;
    const app = new H.audit.default({ formationId: fid });
    H.auditApp = app;
    await app.render(true);
    await H.sleep(1200);
    const el = H.root(app);
    return Object.fromEntries(abilities.map((uuid) => {
      const select = el?.querySelector(`select[data-item-uuid="${uuid}"]`);
      return [uuid, select ? { disabled: select.disabled, options: select.options.length } : null];
    }));
  },

  /** Pick the first real option on an ability's select and send the change a browser sends. */
  auditPick: async ({ uuid }) => {
    const H = globalThis.__sp;
    const select = H.root(H.auditApp)?.querySelector(`select[data-item-uuid="${uuid}"]`);
    const option = [...(select?.options ?? [])].find((o) => o.value);
    if (!select || !option) return { picked: null };
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(1200);
    return { picked: option.value };
  },

  auditClose: async () => {
    try { await globalThis.__sp.auditApp?.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  binding: async ({ uuid }) => ({ checkKey: fromUuidSync(uuid)?.getFlag("acks-extras", "checkKey") ?? null }),

  cards: async ({ since }) => game.messages.contents
    .filter((m) => m.timestamp >= since)
    .map((m) => ({ id: m.id, text: (m.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })),
  boot: async () => globalThis.__spBoot ?? null,
  nowMs: async () => Date.now(),
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

/** The recorder has to be in the page before the page loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 500000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
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
const cards = [];
const held = { templateId: null, partyId: null };
const character = (name, ownership) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } }, ...(ownership ? { ownership } : {}) });
const ability = (name) => ({ name, type: "ability" });

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  note("installed", [await run(gm, P.install), await run(player, P.install)]);
  const census = { gm: await run(gm, P.census), player: await run(player, P.census) };
  note("active", census.gm.active);
  check("the GM seat is the active GM, and the player seat is a Player", census.gm.activeGMIsSelf && census.player.role === 1, { gm: census.gm.role, player: census.player.role });
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the relay would run there");
  for (const [key, c] of Object.entries(census)) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }

  section("fixtures");
  const yours = { default: 0, [census.player.userId]: 3 };
  const party = await gm.fixture("formation/seat-party", "Actor", { name: "QA Seat Party", type: `${SCOPE}.party` });
  const solo = await gm.fixture("formation/seat-solo-party", "Actor", { name: "QA Seat Solo Party", type: `${SCOPE}.party` });
  const member = await gm.fixture("formation/seat-member", "Actor", character("QA Seat Member", yours));
  const other = await gm.fixture("formation/seat-other", "Actor", character("QA Seat Other"));
  const stranger = await gm.fixture("formation/seat-stranger", "Actor", character("QA Seat Stranger"));
  const memberAbility = await gm.fixture("formation/seat-member-ability", "Item", ability("QA Seat Knack"), { parent: member.uuid });
  const otherAbility = await gm.fixture("formation/seat-other-ability", "Item", ability("QA Seat Trick"), { parent: other.uuid });
  held.partyId = party.id;
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  const soloRecord = await run(gm, P.formationOf, { partyId: solo.id });
  if (error || soloRecord.error) throw new Error(error ?? soloRecord.error);
  const abilities = [memberAbility.uuid, otherAbility.uuid];
  const shape = await run(gm, P.startShape, { fid, soloFid: soloRecord.fid, member: member.id, other: other.id, stranger: stranger.id, abilities });
  note("start shape", shape);
  check("the walk starts with the member first then the other in the party, and the stranger alone in its own", JSON.stringify(shape.order) === JSON.stringify([member.id, other.id]) && JSON.stringify(shape.solo) === JSON.stringify([stranger.id]), shape);
  let owns = await run(player, P.owns, { partyId: party.id, fid });
  for (let n = 0; n < 15 && !owns.party; n++) { await sleep(300); owns = await run(player, P.owns, { partyId: party.id, fid }); }
  check("the Player seat owns a member, and through it the party actor", owns.member && owns.party, owns);
  const soloOwns = await run(player, P.owns, { partyId: solo.id, fid: soloRecord.fid });
  check("and owns no member of the solo party", !soloOwns.member, soloOwns);
  const since = await run(gm, P.nowMs);

  section("Form up through the relay");
  const saved = await run(gm, P.saveAndScramble, { fid, name: "QA Seat Order" });
  held.templateId = saved.id;
  note("saved and scrambled", saved);
  check("a saved order exists and the party now stands the other way round", !!saved.id && saved.order[0] === other.id, saved);
  let sent = await run(player, P.relay, { fid, type: "formUp", payload: { templateId: saved.id, extra: "ignored" } });
  note("answer", sent);
  check("the seat's request is answered with no refusal", sent.answer?.ok !== false, sent);
  check("the Judge's client puts the party back in the saved order", await run(gm, P.awaitOrder, { fid, expect: [member.id, other.id] }));
  let posted = await run(gm, P.cards, { since });
  const formed = posted.filter((c) => c.text.includes("forms up in QA Seat Order"));
  check("one public line names the order", formed.length === 1, posted.map((c) => c.text));

  await run(gm, P.saveAndScramble, { fid, name: "QA Seat Order" });
  const before = (await run(gm, P.order, { fid })).order;
  sent = await run(player, P.relay, { fid, type: "formUp", payload: { templateId: "qaNoSuchOrder" } });
  let after = (await run(gm, P.order, { fid })).order;
  check("a forged order id writes nothing", JSON.stringify(after) === JSON.stringify(before), { before, after, sent });
  sent = await run(player, P.relay, { fid: soloRecord.fid, type: "formUp", payload: { templateId: saved.id } });
  check("a party the seat owns no member of is not formed up", JSON.stringify((await run(gm, P.order, { fid: soloRecord.fid })).order) === JSON.stringify([stranger.id]), sent);
  posted = await run(gm, P.cards, { since });
  check("and neither refusal announces anything", posted.filter((c) => c.text.includes("forms up in")).length === 1, posted.map((c) => c.text));
  await run(player, P.relay, { fid, type: "formUp", payload: { templateId: saved.id } });
  await run(gm, P.awaitOrder, { fid, expect: [member.id, other.id] });

  section("the sheet's presses on the Player seat");
  const opened = await run(player, P.open, { partyId: party.id });
  check("the party sheet opens on the seat", opened.rendered, opened);
  const { key: save } = await run(player, P.saveKey, { actorId: member.id });
  check("the member carries a save target to roll", !!save, { save });
  const t1 = await run(gm, P.nowMs);
  await run(player, P.press, { partyId: party.id, action: "partySave", dataset: { save } });
  await sleep(800);
  let fresh = (await run(gm, P.cards, { since: t1 })).filter((c) => c.text.includes("QA Seat"));
  note("save cards", fresh.map((c) => c.text));
  check("the save rolls for the member the seat owns and not for the Judge's", fresh.some((c) => c.text.includes("QA Seat Member")) && !fresh.some((c) => c.text.includes("QA Seat Other")), fresh.map((c) => c.text));

  const t2 = await run(gm, P.nowMs);
  await run(player, P.press, { partyId: party.id, action: "consumeRations" });
  await sleep(800);
  fresh = (await run(gm, P.cards, { since: t2 })).filter((c) => c.text.includes("QA Seat"));
  note("ration cards", fresh.map((c) => c.text));
  check("Supplies spends for the member the seat owns, and names no one else", fresh.length === 1 && fresh[0].text.includes("QA Seat Member") && !fresh[0].text.includes("QA Seat Other"), fresh.map((c) => c.text));

  const t3 = await run(gm, P.nowMs);
  await run(player, P.press, { partyId: party.id, action: "partyCheck", dataset: { check: "listen" } });
  await sleep(1200);
  fresh = await run(gm, P.cards, { since: t3 });
  note("check cards", fresh.map((c) => c.text));
  check("a party check is declared through the Judge's client, with its public line", fresh.some((c) => /a party/i.test(c.text)), fresh.map((c) => c.text));

  await run(player, P.submit, { partyId: party.id, description: "<p>QA seat note</p>", name: "QA Seat Hijack" });
  const read = await run(gm, P.partyRead, { partyId: party.id, fid });
  // The name rides the partyForm relay for a seat owning a member (T-0792 B3, on the allow-list); the description does not, and lands from the owner's own write.
  check("the description lands as the party actor's owner wrote it, and the record's name follows the member-owner's form through the relay", read.description?.includes("QA seat note") && read.name === "QA Seat Hijack", read);
  await run(player, P.submit, { partyId: party.id, description: "<p>QA seat note</p>", name: "QA Seat Party" });
  await run(player, P.close, { partyId: party.id });

  section("the skill audit on the Player seat");
  const selects = await run(player, P.auditOpen, { fid, abilities });
  note("selects", selects);
  check("the seat's own ability has a live select, another's a disabled one", selects[memberAbility.uuid]?.disabled === false && selects[otherAbility.uuid]?.disabled === true, selects);
  const picked = await run(player, P.auditPick, { uuid: memberAbility.uuid });
  const bound = await run(gm, P.binding, { uuid: memberAbility.uuid });
  check("a pick on the seat's own select binds that ability", !!picked.picked && bound.checkKey === picked.picked, { picked, bound });
  const untouched = await run(gm, P.binding, { uuid: otherAbility.uuid });
  check("and the other's stays unbound", !untouched.checkKey, untouched);
  await run(player, P.auditClose);

  section("what the table saw");
  await sleep(600);
  posted = await run(gm, P.cards, { since });
  for (const card of posted.filter((c) => /QA Seat/.test(c.text))) cards.push(gm.track(card.id, "ChatMessage"));
  note("cards tracked", cards.length);

  section("errors after ready");
  for (const [key, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${key} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors);
  }
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (open.player) await run(open.player, P.auditClose); } catch (_e) { /* closed */ }
  try { if (open.player && held.partyId) await run(open.player, P.close, { partyId: held.partyId }); } catch (_e) { /* closed */ }
  try { if (open.gm && held.templateId) note("saved order forgotten", await run(open.gm, P.forget, { id: held.templateId })); } catch (err) { console.error("forget:", err?.message ?? err); }
  try { if (open.gm && cards.length) note("cards swept", await open.gm.sweepTracked({ only: cards })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
