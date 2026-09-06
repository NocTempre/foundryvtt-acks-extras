/**
 * Walks the world half of `docs/bridge/TESTING.md` through the service's own
 * seat holder and prints a verdict per check. The machine's values come from
 * the environment — BROWSER, FOUNDRY_ORIGIN, FOUNDRY_USER, FOUNDRY_PASSWORD —
 * never from a file; the recipe says where they live. Run from the repo root
 * with the output redirected to a log, then read the log:
 *
 *   node tools/bridge-walk.mjs > walk.log 2>&1
 *
 * Every fixture is created by the walk and deleted by its teardown, which runs
 * even when a step throws; the map capture lands in the OS temp directory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Seat } from "../discord/src/seat.mjs";
import { Bridge, BridgeRefusal } from "../discord/src/bridge.mjs";
import { createLog } from "../discord/src/log.mjs";
import { generateSealingPair, unseal, keyIdOf } from "../scripts/bridge/sealing.mjs";
import { configGaps } from "../scripts/bridge/client-config-logic.mjs";

const env = process.env;
for (const key of ["BROWSER", "FOUNDRY_ORIGIN", "FOUNDRY_USER"]) {
  if (!env[key]) { console.error(`bridge-walk: ${key} is not set`); process.exit(2); }
}
const log = createLog("info");
const seat = new Seat({
  browser: env.BROWSER, origin: env.FOUNDRY_ORIGIN, user: env.FOUNDRY_USER, password: env.FOUNDRY_PASSWORD ?? "",
  port: Number(env.SEAT_PORT ?? 9334), width: 1600, height: 1000, readySeconds: 120, bindingName: "acksExtrasBridgeEmit",
}, log);
const events = [];
const consoleLines = [];
seat.on("event", (ev) => events.push(ev));
seat.on("console", (c) => consoleLines.push(c));

const FAKE = { kind: "discord", user: "111222333", guild: "g1", channel: "chan-fixture", message: "m1" };
/** A second identity, enrolled by the walk: its Foundry user is a fixture the teardown deletes by id. */
const FAKE2 = { ...FAKE, user: "444555666", message: "m2" };
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); log.info(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const expectRefusal = async (name, code, fn) => {
  try { await fn(); check(name, false, "no refusal"); }
  catch (e) { check(name, e instanceof BridgeRefusal && e.code === code, `${e.code ?? e.message}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fixtureIds = [];
let fixtureUserId = null;
let formationId = null;
let sceneId = null;
let hadActiveScene = null;
try {
  await seat.start();
  const bridge = new Bridge(seat);
  const asSeat = (n, a = {}) => bridge.run(n, { client: { ...FAKE, user: "seat-op" }, asSeat: true, ...a });
  const asFake = (n, a = {}) => bridge.run(n, { client: FAKE, ...a });

  // 0a. clean slate: a run that aborted before its teardown leaves this walk's keys in the store
  const slate = JSON.parse(await seat.eval(`(async () => {
    const b = acksExtras.bridge.bindings; let s = b.read(); const had = [];
    if (s.users["discord:" + ${JSON.stringify(FAKE.user)}]) { had.push("user"); s = b.unbindUser(s, "discord", ${JSON.stringify(FAKE.user)}); }
    if (s.users["discord:" + ${JSON.stringify(FAKE2.user)}]) { had.push("user2"); s = b.unbindUser(s, "discord", ${JSON.stringify(FAKE2.user)}); }
    if (s.parties["discord:" + ${JSON.stringify(FAKE.channel)}]) { had.push("party"); s = b.unbindParty(s, "discord", ${JSON.stringify(FAKE.channel)}); }
    if (had.length) await b.write(s);
    return JSON.stringify(had);
  })()`));
  if (slate.length) log.info(`clean slate: removed leftover ${slate.join(", ")} binding(s) from an earlier run`);

  // 0. the seat itself, beside a human Gamemaster if one is online
  const who = JSON.parse(await seat.eval(`JSON.stringify({ user: game.user.name, role: game.user.role, isGM: game.user.isGM, activeGM: game.users.activeGM?.name ?? null, gms: game.users.filter(u => u.active && u.isGM).map(u => u.name + ":" + u.role), scenes: game.scenes.size, activeScene: game.scenes.active?.name ?? null, canvas: canvas?.ready })`));
  check("seat joined as the configured user", who.user === env.FOUNDRY_USER, JSON.stringify(who));
  if (who.gms.length > 1) check("with a human Gamemaster online, the seat does not take activeGM", who.activeGM !== env.FOUNDRY_USER, `activeGM=${who.activeGM}; gms=${who.gms.join(",")}`);
  else log.info(`activeGM observation skipped: only ${who.gms.join(",")} online — join the pane as the Gamemaster to observe it`);
  hadActiveScene = who.activeScene;

  // 0a'. docs/TESTING.md, the repo-level recipe: the module loaded at all, from this seat's point of view
  // The importer attaches its api at ready, after its cookbook loads: give it a few seconds.
  const ns = JSON.parse(await seat.eval(`(async () => {
    const live = () => Object.keys(globalThis.acksExtras ?? {}).filter(k => globalThis.acksExtras[k] && typeof globalThis.acksExtras[k] === "object" && Object.keys(globalThis.acksExtras[k]).length);
    let n = 0; while (!live().includes("importer") && n++ < 30) await new Promise(r => setTimeout(r, 500));
    return JSON.stringify({ keys: live(), apiIsNamespace: game.modules.get("acks-extras")?.api === globalThis.acksExtras, globals: Object.keys(globalThis).filter(k => /^acks/i.test(k)), waited: n });
  })()`, { timeout: 30000 }));
  const bootErrors = consoleLines.filter((c) => c.level === "error" && /acks-extras/.test(c.text ?? ""));
  check("no console error naming acks-extras reached the seat during boot", bootErrors.length === 0, bootErrors.map((c) => c.text).join(" | ").slice(0, 300));
  check("acksExtras carries every subsystem the entry point imports", ["lib","abilities","equipment","classes","formation","influence","henchmen","location","markets","monsters","battlemap","vehicles","characterSheet","bridge","importer"].every((k) => ns.keys.includes(k)), `${ns.keys.join(",")} (importer after ${ns.waited * 0.5}s)`);
  // The seat's own binding is the one other acks global a bot's client carries; nothing else may be.
  const expectedGlobals = ["acksExtras", "acksExtrasBridgeEmit"];
  check("module.api is the namespace, and the seat's binding is the only other acks global", ns.apiIsNamespace && ns.globals.length === expectedGlobals.length && expectedGlobals.every((g) => ns.globals.includes(g)), JSON.stringify(ns.globals));

  // 0b. a scene, viewed on the seat only, so the canvas has something to draw
  const sc = JSON.parse(await seat.eval(`(async () => {
    const s = await Scene.create({ name: "Bridge Fixture Scene", width: 2000, height: 1400, grid: { size: 100, type: 1 }, background: { color: "#335533" } });
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    let n = 0; while (canvas?.scene?.id !== s.id && n++ < 6) await wait(500);
    const autoViewed = canvas?.scene?.id === s.id;
    if (!autoViewed) await s.view();
    n = 0; while (!(canvas?.ready && canvas.scene?.id === s.id) && n++ < 40) await wait(500);
    return JSON.stringify({ id: s.id, canvas: canvas?.ready, scene: canvas?.scene?.name ?? null, autoViewed, waited: n });
  })()`, { timeout: 60000 }));
  sceneId = sc.id;
  check("a fixture scene is viewed on the seat and the headless canvas becomes ready", sc.canvas === true && sc.scene === "Bridge Fixture Scene", JSON.stringify(sc));

  // 1. registry + unbound
  const cmds = await asFake("commands");
  check("commands lists the v1 verbs", ["whoami","characters","use","sheet","rolls","roll","say","users","link","unlink","bindings","parties","party","map","events","commands","config","announce","dice","enroll","password"].every((c) => cmds.some((x) => x.name === c)), cmds.map((c) => c.name).join(","));
  const unbound = await asFake("whoami");
  check("an unbound identity reads bound:false", unbound.bound === false);
  await expectRefusal("an unbound identity is refused a bound command", "unbound", () => asFake("characters"));

  // 1a. dice for anyone: an unbound identity rolls through core's own Roll, and the world keeps nothing of it
  const thrown = await asFake("dice", { formula: "2d6+1" });
  check("dice answers an unbound identity a total and every die, and posts nothing", Number.isInteger(thrown.total) && thrown.total >= 3 && thrown.total <= 13 && thrown.dice?.[0]?.results?.length === 2 && thrown.messageId === null && thrown.actor === null, JSON.stringify(thrown));
  await expectRefusal("dice refuses what core's parser refuses", "invalid", () => asFake("dice", { formula: "2d6+(" }));
  await expectRefusal("dice refuses a throw past the dice cap", "invalid", () => asFake("dice", { formula: "5000d6" }));

  // 1b. the configuration handshake — the client announces and reads back.
  // Only the CLIENT's own record is written here; the Judge's configuration
  // is read and never touched, so a configured test world stays configured.
  const keys = await generateSealingPair();
  const announced = await asSeat("announce", {
    agent: { kind: "discord", version: "walk", keyId: keyIdOf(keys.publicKey), publicKey: keys.publicKey, status: { state: "starting", message: "bridge-walk", at: Date.now() }, guilds: [{ id: "111111111111111111", name: "Walk Server" }], channels: [{ id: "222222222222222222", name: "walk-talk", guildId: "111111111111111111" }], members: [{ id: FAKE2.user, name: "walker", displayName: "The Walker" }] },
  });
  check("announce records the client's key, catalogue and the members it has heard from, and answers the configuration", announced.agent?.keyId === keyIdOf(keys.publicKey) && announced.agent?.guilds?.length === 1 && announced.agent?.members?.[0]?.displayName === "The Walker" && !!announced.config, JSON.stringify({ state: announced.agent?.status?.state, guilds: announced.agent?.guilds?.length, members: announced.agent?.members?.length, revision: announced.config?.revision }));
  const readConfig = await asSeat("config");
  check("config reads back what announce answered", readConfig.agent?.keyId === announced.agent?.keyId && readConfig.config?.revision === announced.config?.revision, JSON.stringify({ gaps: configGaps(readConfig.config, readConfig.agent) }));
  // Sealed in the PAGE, by the same module file the config window uses, and
  // opened here — the handshake end to end. A seal proved in Node alone would
  // prove the algorithm and not the browser the Judge actually types into.
  const sealedInPage = await seat.eval(`(async () => {
    const m = await import("/modules/acks-extras/scripts/bridge/sealing.mjs");
    return m.seal(${JSON.stringify(readConfig.agent.publicKey)}, "walk-token-not-a-real-one");
  })()`);
  check("what the browser seals to the announced key opens on the host, and is not the token", (await unseal(keys.privateKey, sealedInPage)) === "walk-token-not-a-real-one" && !String(sealedInPage).includes("walk-token"), `${String(sealedInPage).length} chars of base64`);
  await expectRefusal("an identity that is not the seat cannot read the client's configuration", "unbound", () => asFake("config"));
  await expectRefusal("a non-seat, unbound caller cannot link", "unbound", () => asFake("link", { externalId: FAKE.user, foundryUserName: "Player" }));

  // 2. fixtures: two characters, one owned by Player, one not
  const users = await asSeat("users");
  const player = users.find((u) => u.name === "Player");
  check("the Player seat exists in the world", !!player, users.map((u) => u.name).join("|"));
  const made = JSON.parse(await seat.eval(`(async () => {
    const a = await Actor.create({ name: "Bridge Fixture — Aelin", type: "character", ownership: { default: 0, ${JSON.stringify(player.id)}: 3 } });
    const b = await Actor.create({ name: "Bridge Fixture — Not Yours", type: "character", ownership: { default: 0 } });
    return JSON.stringify({ a: a.uuid, b: b.uuid, aId: a.id, bId: b.id });
  })()`));
  fixtureIds = [made.aId, made.bId];
  check("fixtures created", !!made.a && !!made.b, `${made.a} ${made.b}`);

  // 3. link as seat, then act as the bound player
  const linked = await asSeat("link", { externalId: FAKE.user, foundryUserName: "Player" });
  check("link binds the fake identity to Player", linked.user?.name === "Player");
  const me = await asFake("whoami");
  check("whoami reads bound, not judge, active null", me.bound && me.judge === false && me.active === null, JSON.stringify({ user: me.user?.name, judge: me.judge, chars: me.characters?.map((c) => c.name) }));
  const chars = await asFake("characters", { query: "Bridge Fixture" });
  check("characters lists only the owned fixture", chars.length === 1 && chars[0].uuid === made.a, chars.map((c) => c.name).join("|"));
  await expectRefusal("sheet before use refuses noActive", "noActive", () => asFake("sheet"));
  await expectRefusal("use on an unowned actor is forbidden", "forbidden", () => asFake("use", { uuid: made.b }));
  await expectRefusal("sheet by uuid on an unowned actor is forbidden", "forbidden", () => asFake("sheet", { uuid: made.b }));
  await expectRefusal("a bound player cannot run a Judge verb", "forbidden", () => asFake("users"));
  const used = await asFake("use", { uuid: made.a });
  check("use sets the active character", used.uuid === made.a);
  const sheet = await asFake("sheet");
  check("sheet answers vitals, saves and purse", typeof sheet.hp?.max === "number" && sheet.saves && typeof sheet.coinGp === "number", JSON.stringify({ hp: sheet.hp, ac: sheet.ac, coin: sheet.coinGp, saves: sheet.saves }));
  const rolls = await asFake("rolls");
  check("rolls lists ids with groups", rolls.rolls.length > 0 && rolls.rolls.some((r) => r.id === "save:death"), `${rolls.rolls.length} rows; ${rolls.rolls.slice(0, 6).map((r) => r.id).join(",")}`);
  // Dice from a member with an active character: the world keeps the throw, as the character, stamped.
  const kept = await asFake("dice", { formula: "1d20" });
  const keptDoc = JSON.parse(await seat.eval(`(() => { const m = game.messages.get(${JSON.stringify(kept.messageId)}); return JSON.stringify({ alias: m?.speaker?.alias, actor: m?.speaker?.actor, total: m?.rolls?.[0]?.total ?? null, flag: m?.getFlag("acks-extras","bridge") ?? null }); })()`));
  check("dice from a member with an active character lands in the world's chat as that character, stamped", kept.actor?.uuid === made.a && keptDoc.alias === "Bridge Fixture — Aelin" && keptDoc.actor === made.aId && keptDoc.total === kept.total && keptDoc.flag?.command === "dice" && keptDoc.flag?.user === FAKE.user, JSON.stringify({ total: kept.total, messageId: kept.messageId, keptDoc }));

  // 4. roll: a card captured, stamped, event heard
  const before = events.length;
  const consoleBefore = consoleLines.length;
  const rolled = await asFake("roll", { id: "save:death" });
  check("roll posts and answers at least one card", rolled.messages.length >= 1, JSON.stringify(rolled.messages.map((m) => ({ flavor: m.flavor, rolls: m.rolls, text: m.text.slice(0, 80) }))));
  const ids = rolled.messages.map((m) => m.id);
  let stamped = null;
  for (let i = 0; i < 12; i++) {
    stamped = JSON.parse(await seat.eval(`JSON.stringify(${JSON.stringify(ids)}.map(id => game.messages.get(id)?.getFlag("acks-extras", "bridge") ?? null))`));
    if (stamped.every((s) => s?.via === "discord")) break;
    await sleep(250);
  }
  check("the roll's card carries the bridge stamp on the document", stamped.every((s) => s?.via === "discord" && s.user === FAKE.user), JSON.stringify(stamped));
  const rollConsole = consoleLines.slice(consoleBefore);
  log.info(`page console during roll: ${rollConsole.length ? JSON.stringify(rollConsole).slice(0, 600) : "quiet"}`);
  const chatEvents = events.slice(before).filter((e) => e.type === "chat");
  check("the tap pushed the roll as a chat event with the stamp", chatEvents.length >= 1 && chatEvents.some((e) => e.bridge?.via === "discord"), `${chatEvents.length} chat events; bridge=${JSON.stringify(chatEvents.map((e) => e.bridge?.via ?? null))}`);
  await expectRefusal("an unknown roll id is notFound", "notFound", () => asFake("roll", { id: "save:nope" }));

  // 5. say, and a whisper the relay must not take
  const said = await asFake("say", { text: "Bridge fixture speaks <b>plainly</b>." });
  const sayDoc = JSON.parse(await seat.eval(`(() => { const m = game.messages.get(${JSON.stringify(said.id)}); return JSON.stringify({ alias: m?.speaker?.alias, actor: m?.speaker?.actor, content: m?.content, flag: m?.getFlag("acks-extras","bridge") }); })()`));
  check("say posts as the character, escaped and stamped", sayDoc.alias === "Bridge Fixture — Aelin" && sayDoc.actor === made.aId && sayDoc.content.includes("&lt;b&gt;") && sayDoc.flag?.command === "say", JSON.stringify(sayDoc));
  const emoted = await asFake("say", { text: "draws a blade", style: "emote" });
  check("say emote answers the emote style", emoted.style === "emote");
  await expectRefusal("say with nothing is invalid", "invalid", () => asFake("say", { text: "   " }));
  const wBefore = events.length;
  // A raw eval must answer plain data: a document does not survive returnByValue ("Object reference chain is too long").
  await seat.eval(`ChatMessage.create({ content: "Bridge Fixture whisper", speaker: { alias: "Bridge Fixture Whisperer" }, whisper: [game.user.id] }).then((m) => m.id)`);
  await sleep(600);
  const whispered = events.slice(wBefore).find((e) => e.type === "chat" && e.text === "Bridge Fixture whisper");
  check("a whisper's event carries its whisper list, so the relay can refuse it", !!whispered && whispered.whisper.length === 1, JSON.stringify(whispered?.whisper));

  // 6. parties: create a formation through the feature's own model, bind the fixture channel, read, unbind
  formationId = JSON.parse(await seat.eval(`(async () => {
    const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    const f = await model.createFormation("Bridge Fixture Party", { actorId: ${JSON.stringify(made.aId)} });
    return JSON.stringify(f?.id ?? null);
  })()`));
  check("a fixture formation exists", !!formationId, String(formationId));
  const parties = await asSeat("parties");
  check("parties lists the fixture formation", parties.some((p) => p.id === formationId), JSON.stringify(parties).slice(0, 300));
  const bound = await asSeat("party", { channel: FAKE.channel, formationId });
  check("party binds the channel", bound.formation?.id === formationId);
  const readBack = await asSeat("party", { channel: FAKE.channel });
  check("party reads the binding back", readBack.formation?.id === formationId);
  const bindings = await asSeat("bindings");
  check("bindings resolves users, parties and actives", bindings.users.some((u) => u.user?.name === "Player") && bindings.parties.length >= 1 && bindings.active.some((a) => a.actor?.uuid === made.a), JSON.stringify(bindings).slice(0, 300));

  // 7. map as seat: clip + png
  const view = await asSeat("map", { channel: FAKE.channel });
  const png = await seat.screenshot(view.clip);
  const out = path.join(os.tmpdir(), "bridge-walk-map.png");
  fs.writeFileSync(out, png);
  check("map answers a clip and the seat captures a PNG", png.length > 1000 && view.clip.width > 100 && view.scene?.name === "Bridge Fixture Scene", `${JSON.stringify(view)} → ${png.length} bytes at ${out}`);
  await expectRefusal("map is refused to a bound player", "forbidden", () => asFake("map"));

  // 8. drain + events
  const drained = await asFake("events", { since: 0 });
  check("drain answers the buffered events", drained.seq >= 1 && drained.events.length >= 1, `seq ${drained.seq}, heard ${events.length}`);
  const seqs = events.map((e) => e.seq);
  check("event sequence is strictly increasing", seqs.every((s, i) => i === 0 || s > seqs[i - 1]));

  // 9. unlink → unbound again
  await asSeat("party", { channel: FAKE.channel, unbind: true });
  const cleared = await asSeat("party", { channel: FAKE.channel });
  check("party unbind clears the channel", cleared.formation === null);
  await asSeat("unlink", { externalId: FAKE.user });
  const gone = await asFake("whoami");
  check("after unlink the identity is unbound again", gone.bound === false);

  // 10. accounts: a user made for a second identity, that user's own password, and the lines neither may cross
  const asFake2 = (n, a = {}) => bridge.run(n, { client: FAKE2, ...a });
  await expectRefusal("a caller that is not the seat cannot enroll", "unbound", () => asFake2("enroll", { externalId: FAKE2.user, name: "Bridge Fixture User" }));
  const enrolled = await asSeat("enroll", { externalId: FAKE2.user, name: "Bridge Fixture User" });
  fixtureUserId = enrolled.user?.id ?? null;
  check("enroll creates a Player user and binds the identity to it", !!fixtureUserId && enrolled.user.role === 1 && enrolled.created === true, JSON.stringify(enrolled));
  const me2 = await asFake2("whoami");
  check("the enrolled identity is bound to the new user and is no Judge", me2.bound === true && me2.user?.id === fixtureUserId && me2.judge === false, JSON.stringify({ user: me2.user, judge: me2.judge }));
  await expectRefusal("enroll refuses an identity that is already linked", "invalid", () => asSeat("enroll", { externalId: FAKE2.user, name: "Bridge Fixture User 2" }));
  await expectRefusal("enroll refuses a name a user already has", "invalid", () => asSeat("enroll", { externalId: "777888999", name: "bridge fixture user" }));
  await expectRefusal("a password below the floor is invalid", "invalid", () => asFake2("password", { password: "short" }));
  const pw = await asFake2("password", { password: "walk-password-not-real" });
  check("the enrolled user sets their own password through the seat", pw.changed === true && pw.user?.id === fixtureUserId, JSON.stringify(pw));
  await expectRefusal("an unbound identity cannot set a password", "unbound", () => asFake("password", { password: "walk-password-not-real" }));
  // A Gamemaster's password is never set from outside Foundry: bind the first identity to a Gamemaster for one call, then drop it.
  const gm = users.find((u) => u.role === 4);
  if (gm) {
    await asSeat("link", { externalId: FAKE.user, foundryUserId: gm.id });
    await expectRefusal("a member bound to a Gamemaster is refused a password change", "forbidden", () => asFake("password", { password: "walk-password-not-real" }));
    await asSeat("unlink", { externalId: FAKE.user });
  } else log.info("no Gamemaster user in the world; the Gamemaster-password refusal was not observed");
} catch (err) {
  check("walk completed without an exception", false, err.stack ?? String(err));
} finally {
  // Teardown: delete the fixtures, prove they are gone, leave the store without this walk's keys.
  try {
    const cleanup = JSON.parse(await seat.eval(`(async () => {
      const fid = ${JSON.stringify(formationId)};
      const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
      if (fid && model.getFormation(fid)) await model.dissolveFormation(model.getFormation(fid));
      for (const id of ${JSON.stringify(fixtureIds)}) { const a = game.actors.get(id); if (a) await a.delete(); }
      const msgs = game.messages.filter(m => m.getFlag("acks-extras","bridge")?.user === ${JSON.stringify(FAKE.user)} || m.speaker?.alias?.startsWith("Bridge Fixture"));
      for (const m of msgs) await m.delete();
      const sid = ${JSON.stringify(sceneId)};
      const scene = sid ? game.scenes.get(sid) : null;
      if (scene) await scene.delete();
      const uid = ${JSON.stringify(fixtureUserId)};
      const fixtureUser = uid ? game.users.get(uid) : null;
      if (fixtureUser) await fixtureUser.delete();
      const b = acksExtras.bridge.bindings;
      let store = b.read();
      store = b.unbindUser(store, "discord", ${JSON.stringify(FAKE.user)});
      store = b.unbindUser(store, "discord", ${JSON.stringify(FAKE2.user)});
      store = b.unbindParty(store, "discord", ${JSON.stringify(FAKE.channel)});
      await b.write(store);
      const after = b.read();
      return JSON.stringify({ actorsLeft: ${JSON.stringify(fixtureIds)}.filter(id => game.actors.get(id)).length, userLeft: !!(uid && game.users.get(uid)), formationLeft: !!(fid && model.getFormation(fid)), sceneLeft: !!(sid && game.scenes.get(sid)), activeScene: game.scenes.active?.name ?? null, messagesDeleted: msgs.length, storeHasWalkKeys: !!(after.users["discord:" + ${JSON.stringify(FAKE.user)}] || after.users["discord:" + ${JSON.stringify(FAKE2.user)}] || after.parties["discord:" + ${JSON.stringify(FAKE.channel)}]) });
    })()`, { timeout: 60000 }));
    check("teardown: fixtures, user, formation, scene and fixture messages removed; store clean", cleanup.actorsLeft === 0 && cleanup.userLeft === false && cleanup.formationLeft === false && cleanup.sceneLeft === false && cleanup.storeHasWalkKeys === false && cleanup.activeScene === hadActiveScene, JSON.stringify(cleanup));
  } catch (err) {
    check("teardown ran", false, err.message);
  }
  await seat.stop();
  if (consoleLines.length) log.info(`page console lines: ${consoleLines.length}; first: ${JSON.stringify(consoleLines[0]).slice(0, 300)}`);
  const failed = results.filter((r) => !r.ok);
  log.info(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join(" | ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}
