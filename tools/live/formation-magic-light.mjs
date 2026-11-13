/**
 * Live walk, formation-magic-light: a magic light's state and its shutter, on
 * the Party sheet's Kit tab and the item sheet's Effects tab, from a real
 * Player seat. Walks docs/formation/TESTING.md "A magic light" steps 8 to 11
 * (stowed and taken out, the shutter as a Player, an Observer's missing
 * button, the shutter outliving the pack) and docs/equipment/TESTING.md's
 * item-sheet tag and toggle: the Effects tab's state tag and Shutter button
 * for an effect on a carried item and none for a world item's; both action
 * handlers (`shutterMagicLight`, `shutterEffect`) pressed on the Player seat
 * and the flag landing on an item-embedded effect (`lightShutter` set true,
 * unset on Open, `disabled` never touched, no chat card); the Kit rows
 * redrawn on the other seat; the column's points (`carriedLightPoints`, and
 * the light sources the GM seat's canvas draws) and a deployed member's token
 * light following a shutter flip and a stow; a wearable item's light reading
 * through `canWear` / `isWorn`; the tooltip text on the badge and the button;
 * and the Kit row, the header's name field beside its bar, and the item tag
 * at 14 and 18 px type, on windows opened after the change, at the sheet's
 * width and a narrow one. Prints booleans
 * and counts. Machine values arrive through ./_env.mjs.
 *
 * The walk has two seats, so an Observer is the Player user taken down to
 * Observer ownership of the members (the effect's `isOwner` is false there,
 * which is what the gate reads); a world with a third seat would add nothing
 * the gate reads. A boot recorder is attached to both seats before their
 * reload, so `init`, `setup` and `ready` are in the console record.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `formation/magic-light-scene` (a room, no walls), the party
 * `formation/magic-light` with its token `formation/magic-light-token`, the
 * members `formation/magic-light-member` (holds the plain item
 * `formation/magic-light-item` and the container `formation/magic-light-pack`)
 * and `formation/magic-light-member-worn` (holds the wearable
 * `formation/magic-light-worn`, an armor), both owned by the Player, and the
 * world item `formation/magic-light-world`. The effects each step reads are
 * the walk's own, made through the same start data the Add Effect control
 * uses, tracked by uuid and swept; the fixtures end with no effect, the plain
 * item out of the pack, the wearable worn, and nobody deployed. Writes
 * outside the ledger, each restored in a finally: the Player's ownership of
 * the members, and the client setting `fontScale` on both seats.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cdp, connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCENE = "formation/magic-light-scene";
const PARTY = "formation/magic-light";
const TOKEN = "formation/magic-light-token";
const MEMBER_A = "formation/magic-light-member";
const MEMBER_B = "formation/magic-light-member-worn";
const ITEM_A = "formation/magic-light-item";
const PACK = "formation/magic-light-pack";
const ITEM_B = "formation/magic-light-worn";
const WORLD = "formation/magic-light-world";
const PACK_NAME = "QA Magic Light Pack";
const GS = 100;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Runs before any of Foundry's scripts on the next document load: errors from the first script on, each with the phase it came in, and the phases reached. */
const BOOT_RECORDER = `(() => {
  if (window.top !== window) return;
  const R = (window.__mlBoot = { pre: typeof globalThis.Hooks === "undefined" && typeof globalThis.game === "undefined", phase: "load", phases: [], errors: [] });
  const push = (kind, text) => R.errors.push({ phase: R.phase, kind, text: String(text).slice(0, 300) });
  const original = console.error;
  console.error = (...args) => { push("console", args.map((a) => a?.message ?? String(a)).join(" ")); return original.apply(console, args); };
  window.addEventListener("error", (e) => push("error", e.message));
  window.addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
  }, 0);
})();`;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ml = globalThis.__ml ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.find = ({ actorId, itemId }) => (actorId ? game.actors.get(actorId)?.items.get(itemId) : game.items.get(itemId));
    H.LT = await import(`${base}lib/light.mjs`);
    H.IM = await import(`${base}lib/item-model.mjs`);
    H.ES = await import(`${base}lib/effect-scan.mjs`);
    H.CT = await import(`${base}equipment/containers.mjs`);
    H.FM = await import(`${base}formation/formation-model.mjs`);
    H.EF = await import(`${base}equipment/item-sheet/effect-starts.mjs`);
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return { isGM: game.user.isGM, userId: game.user.id, formation: typeof globalThis.acksExtras?.formation?.carriedLightPoints === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** What the boot recorder saw from the first script to now. */
  boot: async () => {
    const b = window.__mlBoot ?? null;
    return { recorded: !!b, pre: !!b?.pre, phases: b?.phases.length ?? 0, errors: b?.errors.length ?? 0, ours: b ? b.errors.filter((e) => /acks-extras/iu.test(e.text)).length : null };
  },
  /** The party actor's formation id, adopted when none stands (an actor made while the election was still joining is passed by). */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__ml;
    const find = () => Object.values(H.FM.getFormations()).find((f) => f.actorId === partyId);
    let found = await H.poll(find, { tries: 40, every: 200 });
    let adopted = false;
    if (!found) { await H.FM.adoptPartyActor(game.actors.get(partyId)); adopted = true; found = await H.poll(find, { tries: 40, every: 200 }); }
    return found ? { fid: found.id, adopted } : { error: "no formation for the party actor" };
  },
  /** Seat the members through the party sheet's drop, in order; a member out of order is taken out and dropped again. */
  seat: async ({ partyId, fid, actorIds }) => {
    const H = globalThis.__ml;
    const ids = () => H.FM.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    const now = ids();
    const prefixOk = actorIds.every((id, i) => now[i] === id) && now.length === actorIds.length;
    if (!prefixOk) {
      for (const id of now) await H.FM.removeMember(H.FM.getFormation(fid), id);
      const sheet = game.actors.get(partyId).sheet;
      await sheet.render(true);
      await H.sleep(900);
      for (const id of actorIds) {
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
        H.root(sheet).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await H.poll(() => ids().includes(id), { tries: 40, every: 150 });
      }
    }
    return { members: ids(), reseated: !prefixOk };
  },
  /** The party's token on the scene, made from the party actor where none stands there, and adopted. */
  partyToken: async ({ fid, partyId, sceneId, x, y }) => {
    const H = globalThis.__ml;
    const scene = game.scenes.get(sceneId);
    let f = H.FM.getFormation(fid);
    let token = f.tokenId ? scene.tokens.get(f.tokenId) : null;
    let made = null;
    if (!token) {
      const doc = await game.actors.get(partyId).getTokenDocument({ x, y, rotation: 270 });
      [token] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true, hidden: false }]);
      made = token.id;
      await H.poll(() => H.FM.getFormation(fid).tokenId === token.id, { tries: 60, every: 200 });
    }
    f = H.FM.getFormation(fid);
    return { tokenId: f.tokenId, sceneId: f.sceneId, made };
  },
  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    return { scene: canvas.scene?.id === sceneId };
  },
  /**
   * The fixtures' known shape: no leftover effect, the Player owning both
   * members, the plain item out of the pack, the wearable worn, the pack a
   * container, nobody deployed.
   */
  shape: async ({ a, b, itemA, itemB, packId, worldId, playerId, fid, partyId }) => {
    const H = globalThis.__ml;
    const actorA = game.actors.get(a);
    const actorB = game.actors.get(b);
    const iA = actorA.items.get(itemA);
    const iB = actorB.items.get(itemB);
    const pack = actorA.items.get(packId);
    const world = game.items.get(worldId);
    const left = [];
    for (const it of [iA, iB, world]) {
      const ids = it.effects.map((e) => e.id);
      if (ids.length) await it.deleteEmbeddedDocuments("ActiveEffect", ids);
      left.push(ids.length);
    }
    for (const actor of [actorA, actorB]) if (actor.ownership[playerId] !== 3) await actor.update({ [`ownership.${playerId}`]: 3 });
    if (H.IM.containedIn(iA)) await iA.unsetFlag("acks-extras", "containedIn");
    if (!iB.system.equipped) await iB.update({ "system.equipped": true });
    if (H.IM.capacityOf(pack) === null) await pack.update({ "flags.acks-extras.gear.capacity": 100 });
    const f = H.FM.getFormation(fid);
    return {
      leftoverEffects: left,
      owned: [actorA, actorB].every((x) => x.ownership[playerId] === 3),
      out: !H.IM.containedIn(iA),
      worn: H.IM.isWorn(iB),
      canWearA: H.IM.canWear(iA),
      canWearB: H.IM.canWear(iB),
      packHolds: H.IM.isContainer(pack),
      deployed: f.members.filter((m) => m?.deployedTokenId).length,
      sceneOf: f.sceneId ?? null,
      party: !!game.actors.get(partyId),
    };
  },
  /** An effect made with the Add Effect control's own start data, its two reaches typed. */
  makeEffect: async ({ actorId, itemId, bright, dim }) => {
    const H = globalThis.__ml;
    const item = H.find({ actorId, itemId });
    const data = H.EF.effectStartData("light", item, { lightName: game.i18n.localize("ACKS-EQUIPMENT.itemSheet.effects.lightEffect") });
    data.changes[0].value = String(bright);
    data.changes[1].value = String(dim);
    const [eff] = await item.createEmbeddedDocuments("ActiveEffect", [data]);
    return { id: eff.id, uuid: eff.uuid, transfer: eff.transfer, changes: eff.changes.length };
  },
  /** One effect as the gate reads it, and what the document holds. */
  effectState: async ({ actorId, itemId, effectId }) => {
    const H = globalThis.__ml;
    const item = H.find({ actorId, itemId });
    const eff = item?.effects.get(effectId);
    if (!eff) return { gone: true };
    const actor = actorId ? game.actors.get(actorId) : null;
    const own = eff.flags?.["acks-extras"] ?? {};
    return {
      state: H.LT.lightStateOf(eff),
      shuttered: H.LT.isLightShuttered(eff),
      flag: eff.getFlag("acks-extras", "lightShutter") ?? null,
      flagKey: "lightShutter" in own,
      disabled: !!eff.disabled,
      owner: !!eff.isOwner,
      applied: actor ? H.ES.appliedEffects(actor).some((e) => e.id === effectId) : null,
      listed: actor ? H.LT.magicLights(actor).some((l) => l.id === effectId) : null,
    };
  },
  /** The call a seat makes to shutter, answered as the seat can: its return, and nothing else. */
  callShutter: async ({ actorId, itemId, effectId, on }) => {
    const H = globalThis.__ml;
    const eff = H.find({ actorId, itemId })?.effects.get(effectId);
    return { returned: await H.LT.setLightShutter(eff, on), owner: !!eff?.isOwner, actorOwner: actorId ? !!game.actors.get(actorId)?.isOwner : null };
  },
  ownership: async ({ actorIds, playerId, level }) => {
    for (const id of actorIds) {
      const actor = game.actors.get(id);
      if (actor.ownership[playerId] !== level) await actor.update({ [`ownership.${playerId}`]: level });
    }
    await globalThis.__ml.sleep(400);
    return actorIds.map((id) => game.actors.get(id).ownership[playerId]);
  },
  /** What gear writes the equipment API makes for a stow, a take-out and a wear toggle. */
  store: async ({ actorId, itemId, packId }) => {
    const H = globalThis.__ml;
    const actor = game.actors.get(actorId);
    const moved = await H.CT.storeIn(actor, actor.items.get(itemId), actor.items.get(packId));
    return { moved, contained: !!H.IM.containedIn(actor.items.get(itemId)) };
  },
  takeOut: async ({ actorId, itemId }) => {
    const H = globalThis.__ml;
    const item = game.actors.get(actorId).items.get(itemId);
    const moved = await H.CT.takeOut(item);
    return { moved, contained: !!H.IM.containedIn(item) };
  },
  equip: async ({ actorId, itemId, on }) => {
    const H = globalThis.__ml;
    const item = game.actors.get(actorId).items.get(itemId);
    const wrote = await H.IM.setEquipped(item, on);
    return { wrote, worn: H.IM.isWorn(item), canWear: H.IM.canWear(item) };
  },
  /** Mark the messages that exist, so a card the next action posts is told from the world's. */
  cardsMark: async () => { const H = globalThis.__ml; H.cardPre = new Set(game.messages.map((m) => m.id)); return H.cardPre.size; },
  /** Messages made since the mark that name a fixture, by the actor they speak as or a name in their text. */
  cardsNew: async ({ actorIds, names }) => {
    const H = globalThis.__ml;
    const pre = H.cardPre ?? new Set();
    const mine = [...game.messages].filter((m) => !pre.has(m.id) && (actorIds.includes(m.speaker?.actor) || names.some((n) => String(m.content ?? "").includes(n))));
    return mine.map((m) => ({ id: m.id, own: m.author?.id === game.user.id }));
  },
  openKit: async ({ partyId, fresh = false }) => {
    const H = globalThis.__ml;
    const app = game.actors.get(partyId).sheet;
    if (fresh) await app.close({ animate: false });
    await app.render(true);
    await H.poll(() => H.root(app)?.isConnected);
    await H.sleep(700);
    H.root(app)?.querySelector('[data-action="tab"][data-tab="kit"]')?.click();
    await H.sleep(500);
    const root = H.root(app);
    return { rendered: !!root && app.state === 2, state: app.state, kit: !!root?.querySelector('.tab[data-tab="kit"].active'), winId: app.id };
  },
  /** Whether this seat's user holds at least `level` on the party actor (booleans only). */
  partyPerm: async ({ partyId, level }) => game.actors.get(partyId).testUserPermission(game.user, level),
  /** A fresh render of the party sheet, read back without waiting on a window that may never draw. */
  tryOpen: async ({ partyId }) => {
    const H = globalThis.__ml;
    const app = game.actors.get(partyId).sheet;
    await app.close({ animate: false });
    await app.render(true);
    await H.sleep(1200);
    return { rendered: !!H.root(app) && app.state === 2, state: app.state, connected: !!H.root(app)?.isConnected };
  },
  closeSheets: async ({ partyId, items }) => {
    const H = globalThis.__ml;
    await game.actors.get(partyId)?.sheet?.close({ animate: false });
    for (const it of items) await H.find(it)?.sheet?.close({ animate: false });
    return true;
  },
  /** The Kit tab's magic-light rows as drawn (no render forced). */
  rows: async ({ partyId }) => {
    const root = globalThis.__ml.root(game.actors.get(partyId).sheet);
    return [...(root?.querySelectorAll(".magic-light") ?? [])].map((r) => {
      const state = r.querySelector(".acks-extras-light-state");
      const button = r.querySelector(".acks-extras-light-shutter");
      const glyph = r.querySelector("i.fa-wand-magic-sparkles");
      return {
        key: r.dataset.magicLight,
        state: state?.dataset.state ?? null,
        badge: state?.textContent.trim() ?? "",
        unlit: r.classList.contains("unlit"),
        glyphLit: !!glyph?.classList.contains("lit"),
        stateTip: state?.dataset.tooltipText ?? "",
        reachTip: r.querySelector(".remaining:not(.acks-extras-light-state)")?.dataset.tooltipText ?? "",
        button: button ? { action: button.dataset.action, label: button.textContent.trim(), aria: button.getAttribute("aria-label") ?? "", tip: button.dataset.tooltipText ?? "" } : null,
      };
    });
  },
  /** Press a Kit row's shutter button as a user does; the effect's write is the caller's to wait for. */
  pressKit: async ({ partyId, key }) => {
    const btn = globalThis.__ml.root(game.actors.get(partyId).sheet)?.querySelector(`[data-magic-light="${key}"] [data-action="shutterMagicLight"]`);
    if (!btn) return { button: false };
    btn.click();
    return { button: true };
  },
  /** An item sheet opened on its Effects tab, its state tags and Shutter buttons as drawn. */
  openItem: async ({ actorId, itemId, fresh = false }) => {
    const H = globalThis.__ml;
    const app = H.find({ actorId, itemId }).sheet;
    if (fresh) await app.close({ animate: false });
    await app.render(true);
    await H.poll(() => H.root(app)?.isConnected);
    await H.sleep(500);
    app.changeTab?.("effects", "primary");
    await H.sleep(500);
    return { rendered: !!H.root(app), winId: app.id };
  },
  itemTags: async ({ actorId, itemId }) => {
    const root = globalThis.__ml.root(globalThis.__ml.find({ actorId, itemId }).sheet);
    const rows = [...(root?.querySelectorAll(".acks-extras-item-sheet__row:not(.is-inherited)") ?? [])];
    return {
      rows: rows.length,
      tags: [...(root?.querySelectorAll(".acks-tag[data-state]") ?? [])].map((t) => ({ state: t.dataset.state, ghost: t.classList.contains("acks-tag--ghost"), tip: !!t.dataset.tooltipText, text: t.textContent.trim(), title: t.hasAttribute("title") })),
      plain: rows.reduce((n, r) => n + r.querySelectorAll(".acks-tag:not([data-state])").length, 0),
      buttons: [...(root?.querySelectorAll("[data-action='shutterEffect']") ?? [])].map((b) => ({ label: b.textContent.trim(), aria: !!b.getAttribute("aria-label"), tip: !!b.dataset.tooltipText, effect: b.dataset.effect, title: b.hasAttribute("title") })),
    };
  },
  pressItem: async ({ actorId, itemId, effectId }) => {
    const btn = globalThis.__ml.root(globalThis.__ml.find({ actorId, itemId }).sheet)?.querySelector(`[data-action='shutterEffect'][data-effect='${effectId}']`);
    if (!btn) return { button: false };
    btn.click();
    return { button: true };
  },
  /** The column's points at rest, and the light sources this seat's canvas draws for the party (null where the scene is not the one viewed). */
  points: async ({ sceneId, fid }) => {
    const scene = game.scenes.get(sceneId);
    const prefix = `acks-extras.column.${fid}.`;
    return {
      stored: acksExtras.formation.carriedLightPoints(scene).length,
      drawn: canvas.scene?.id === sceneId && canvas.ready ? [...canvas.effects.lightSources.keys()].filter((k) => String(k).startsWith(prefix)).length : null,
    };
  },
  /** Send a member out of the party token (or back) through the Order tab's own control. */
  detach: async ({ partyId, fid, actorId, want }) => {
    const H = globalThis.__ml;
    const app = game.actors.get(partyId).sheet;
    const member = () => H.FM.getFormation(fid).members.find((m) => m?.actorId === actorId);
    const kit = () => H.root(app)?.querySelector('[data-action="tab"][data-tab="kit"]')?.click();
    H.root(app)?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(600);
    const btn = H.root(app)?.querySelector(`.tab[data-tab="order"] [data-actor-id="${actorId}"] [data-action="toggleDetach"]`);
    if (!btn || btn.disabled) { kit(); return { found: !!btn, disabled: !!btn?.disabled }; }
    const was = !!member()?.deployedTokenId;
    if (was !== want) {
      btn.click();
      await H.poll(() => !!member()?.deployedTokenId === want, { tries: 60, every: 200 });
    }
    await H.sleep(500);
    kit();
    await H.sleep(300);
    const m = member();
    return { found: true, was, deployed: !!m?.deployedTokenId, tokenId: m?.deployedTokenId ?? null, sceneId: m?.deployedSceneId ?? H.FM.getFormation(fid).sceneId ?? null };
  },
  /** A deployed member's token light as stored. */
  tokenLight: async ({ fid, actorId }) => {
    const H = globalThis.__ml;
    const f = H.FM.getFormation(fid);
    const m = f.members.find((x) => x?.actorId === actorId);
    const scene = game.scenes.get(m?.deployedSceneId ?? f.sceneId);
    const t = m?.deployedTokenId ? scene?.tokens.get(m.deployedTokenId) : null;
    if (!t) return { token: false };
    return { token: true, bright: t.light.bright ?? 0, dim: t.light.dim ?? 0, managed: !!t.getFlag("acks-extras", "managedLight") };
  },
  fontScale: async ({ px }) => {
    const H = globalThis.__ml;
    if (px != null) { await game.settings.set("acks-extras", "fontScale", px); await H.sleep(700); }
    return { setting: game.settings.get("acks-extras", "fontScale"), base: getComputedStyle(document.documentElement).getPropertyValue("--acks-fs-base").trim() };
  },
  /** The Kit rows' type and fit on the open (fresh) party sheet, at its width or one set now. */
  layoutKit: async ({ partyId, width = null }) => {
    const H = globalThis.__ml;
    const app = game.actors.get(partyId).sheet;
    if (width) { app.setPosition({ width }); await H.sleep(700); }
    const root = H.root(app);
    const content = root.querySelector(".window-content");
    const panel = root.querySelector('.tab[data-tab="kit"]');
    const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const rows = [...root.querySelectorAll(".magic-light")].map((r) => {
      const rr = r.getBoundingClientRect();
      const badge = r.querySelector(".acks-extras-light-state");
      const btn = r.querySelector(".acks-extras-light-shutter");
      const kids = [...r.children].map((c) => c.getBoundingClientRect());
      return {
        h: Math.round(rr.height),
        overX: r.scrollWidth > r.clientWidth + 1,
        spill: kids.some((k) => k.width > 0 && (k.right > rr.right + 1 || k.left < rr.left - 1)),
        badgePx: px(badge),
        btnPx: px(btn),
        btnClipped: btn ? btn.scrollWidth > btn.clientWidth + 1 : null,
        btnInside: btn ? btn.getBoundingClientRect().right <= rr.right + 1 && btn.getBoundingClientRect().left >= rr.left - 1 : null,
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : null,
      };
    });
    // The header band: the name field against the bar and the window's controls.
    const header = root.querySelector(":scope > .window-header");
    const rect = (el) => el?.getBoundingClientRect() ?? null;
    const meet = (a, b) => !!a && !!b && a.width > 0 && b.width > 0 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const nameEl = header?.querySelector(".acks-extras-party-sheet__name");
    const nameR = rect(nameEl);
    const titleEl = header?.querySelector(".acks-extras-party-sheet__title");
    const titleR = rect(titleEl);
    const titleFloor = titleEl ? parseFloat(getComputedStyle(titleEl).minWidth) || 0 : null;
    const barR = rect(header?.querySelector(".acks-extras-party-sheet__bar"));
    const headR = rect(header);
    const controls = [...(header?.querySelectorAll(".header-control") ?? [])].map(rect).filter((r) => r.width > 0);
    const band = {
      name: !!nameEl,
      bar: !!barR,
      nameW: nameR ? Math.round(nameR.width) : null,
      namePx: px(nameEl),
      barOverName: meet(nameR, barR),
      controlOverName: controls.some((c) => meet(nameR, c)),
      controlOverBar: controls.some((c) => meet(barR, c)),
      inside: !!nameR && !!headR && nameR.left >= headR.left - 1 && nameR.right <= headR.right + 1 && (!barR || (barR.left >= headR.left - 1 && barR.right <= headR.right + 1)),
      titleW: titleR ? Math.round(titleR.width) : null,
      titleFloor: titleFloor === null ? null : Math.round(titleFloor),
      // The title keeps its floor: the bar wraps before the name is squeezed below it.
      roomy: !!titleR && titleFloor !== null && titleR.width >= titleFloor - 1,
      // A long name may still end in an ellipsis in a narrow header; reported, not required.
      nameWhole: nameEl ? nameEl.scrollWidth <= nameEl.clientWidth + 1 : null,
      barWrapped: !!nameR && !!barR && barR.top >= nameR.bottom - 1,
    };
    return { winW: Math.round(root.getBoundingClientRect().width), rows, band, contentOverX: content.scrollWidth > content.clientWidth + 1, panelOverX: panel ? panel.scrollWidth > panel.clientWidth + 1 : null, winId: app.id };
  },
  layoutItem: async ({ actorId, itemId }) => {
    const H = globalThis.__ml;
    const root = H.root(H.find({ actorId, itemId }).sheet);
    const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const content = root.querySelector(".window-content");
    const row = root.querySelector(".acks-tag[data-state]")?.closest(".acks-extras-item-sheet__row");
    const rr = row?.getBoundingClientRect();
    const tag = row?.querySelector(".acks-tag[data-state]");
    const btn = row?.querySelector("[data-action='shutterEffect']");
    const kids = row ? [...row.children].map((c) => c.getBoundingClientRect()) : [];
    return {
      row: !!row,
      tagPx: px(tag),
      btnPx: px(btn),
      overX: row ? row.scrollWidth > row.clientWidth + 1 : null,
      spill: row ? kids.some((k) => k.width > 0 && (k.right > rr.right + 1 || k.left < rr.left - 1)) : null,
      btnClipped: btn ? btn.scrollWidth > btn.clientWidth + 1 : null,
      contentOverX: content.scrollWidth > content.clientWidth + 1,
    };
  },
  drain: async () => ({ errors: globalThis.__ml.errors.slice() }),
  restore: async () => {
    const H = globalThis.__ml;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
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

/** Read a page function until `test` passes, or give back the last reading. */
async function until(api, fn, arg, test, { tries = 40, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, arg);
    if (test(last)) return { ok: true, value: last };
    await sleep(every);
  }
  return { ok: false, value: last };
}

async function ready(api, label, { seconds = 240, fresh = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && typeof globalThis.acksExtras?.formation?.carriedLightPoints === "function" && !!globalThis.acksExtras?.lib && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * Attach a second DevTools session to the seat's page, register the boot
 * recorder for the next document, and reload: the driver's own session
 * attaches after `ready`, so a recorder it injects would miss `init`, `setup`
 * and `ready`.
 */
async function reloadWithRecorder(api, port, label) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const cdp = new Cdp(ws);
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page" && t.url.includes("/game"));
    if (!page) throw new Error(`${label}: no /game page to reload`);
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

let gm = null;
let player = null;
const swept = [];
const cards = [];
const found = { fontScale: { gm: null, player: null } };
let playerId = null;
let ids = null;
const RUN_START = Date.now();
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_200_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
const shotsDir = fs.mkdtempSync(path.join(os.tmpdir(), "acks-magic-light-"));
const tip = (s) => typeof s === "string" && s.length > 0;
const byKey = (rows, key) => rows.find((r) => r.key === key) ?? null;

/** The Kit row for `key` on a seat once it reads `state`, polled; the last reading where it never does. */
const waitRow = (seat, key, state, { tries = 40 } = {}) => until(seat, P.rows, { partyId: ids.party }, (rows) => byKey(rows, key)?.state === state, { tries, every: 250 });

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm, PORTS.gm, "gm"));
  const gi = await run(gm, P.install);
  check("the GM seat is a GM and the formation api is published", gi.isGM && gi.formation, gi);
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  note("player reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(player, PORTS.player, "player"));
  const pi = await run(player, P.install);
  check("the Player seat is not a GM and the formation api is published", !pi.isGM && pi.formation, pi);
  playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const b = await run(seat, P.boot);
    check(`${label} seat: the recorder ran before Foundry's scripts and saw init, setup and ready`, b.recorded && b.pre && b.phases === 3, { phases: b.phases });
    check(`${label} seat: no console error naming this module from the first script through ready`, b.ours === 0, { ours: b.ours, others: b.errors - b.ours });
  }
  found.fontScale.gm = (await run(gm, P.fontScale, {})).setting;
  found.fontScale.player = (await run(player, P.fontScale, {})).setting;

  section("fixtures");
  const own = (id) => ({ ownership: { default: 0, [id]: 3 } });
  const scene = await gm.fixture(SCENE, "Scene", {
    name: "QA Magic Light Room", active: false, navigation: false, width: 1200, height: 800, padding: 0, backgroundColor: "#6f6f6f",
    grid: { type: 1, size: GS, distance: 5, units: "ft" }, tokenVision: true, environment: { globalLight: { enabled: false } }, ownership: { default: 2 },
  });
  const party = await gm.fixture(PARTY, "Actor", { name: "QA Magic Light Party", type: "acks-extras.party", ownership: { default: 2 } });
  const char = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 } }, ...own(playerId) });
  const memA = await gm.fixture(MEMBER_A, "Actor", char("QA Magic Light Member"));
  const memB = await gm.fixture(MEMBER_B, "Actor", char("QA Magic Light Member Worn"));
  const itemA = await gm.fixture(ITEM_A, "Item", { name: "QA Magic Light Lamp", type: "item", system: { quantity: { value: 1, max: 0 } } }, { parent: memA.uuid });
  const pack = await gm.fixture(PACK, "Item", { name: PACK_NAME, type: "item", system: { quantity: { value: 1, max: 0 } }, flags: { "acks-extras": { gear: { capacity: 100 } } } }, { parent: memA.uuid });
  const itemB = await gm.fixture(ITEM_B, "Item", { name: "QA Magic Light Ring", type: "armor" }, { parent: memB.uuid });
  const world = await gm.fixture(WORLD, "Item", { name: "QA Magic Light World Lamp", type: "item", system: { quantity: { value: 1, max: 0 } } });
  ids = { scene: idOf(scene), party: idOf(party), a: idOf(memA), b: idOf(memB), itemA: idOf(itemA), pack: idOf(pack), itemB: idOf(itemB), world: idOf(world) };
  const fo = await run(gm, P.formationOf, { partyId: ids.party });
  if (fo.error) throw new Error(fo.error);
  ids.fid = fo.fid;
  const seated = await run(gm, P.seat, { partyId: ids.party, fid: ids.fid, actorIds: [ids.a, ids.b] });
  check("the party holds the two members, in order", JSON.stringify(seated.members) === JSON.stringify([ids.a, ids.b]), seated);
  const pt = await run(gm, P.partyToken, { fid: ids.fid, partyId: ids.party, sceneId: ids.scene, x: 300, y: 300 });
  if (pt.made) await gm.mark(`Scene.${ids.scene}.Token.${pt.made}`, TOKEN);
  check("the party token stands on the room, linked to the record", !!pt.tokenId && pt.sceneId === ids.scene, { sceneIsRoom: pt.sceneId === ids.scene });
  const shapeArgs = { a: ids.a, b: ids.b, itemA: ids.itemA, itemB: ids.itemB, packId: ids.pack, worldId: ids.world, playerId, fid: ids.fid, partyId: ids.party };
  let shape = await run(gm, P.shape, shapeArgs);
  note("leftover effects cleared from the three items", shape.leftoverEffects);
  if (shape.deployed) {
    // A member a dead run left out is gathered through the same control a Judge uses.
    for (const id of [ids.a, ids.b]) await run(gm, P.detach, { partyId: ids.party, fid: ids.fid, actorId: id, want: false });
    shape = await run(gm, P.shape, shapeArgs);
  }
  check("start shape: the Player owns both members, the lamp is out of the pack, the ring is worn, nobody is deployed", shape.owned && shape.out && shape.worn && shape.deployed === 0, shape);
  check("the pack is a container, the ring can be worn and the lamp cannot", shape.packHolds && shape.canWearB && !shape.canWearA, { pack: shape.packHolds, ring: shape.canWearB, lamp: shape.canWearA });
  const viewed = await run(gm, P.view, { sceneId: ids.scene });
  check("the GM seat views the room", viewed.scene);
  const target = { actorIds: [ids.party, ids.a, ids.b], names: ["QA Magic Light Party", "QA Magic Light Member", "QA Magic Light Member Worn"] };
  const itemRef = { a: { actorId: ids.a, itemId: ids.itemA }, b: { actorId: ids.b, itemId: ids.itemB }, world: { actorId: null, itemId: ids.world } };
  /** Cards the run's own GM client posted since the last mark, tracked for the sweep; the count of any card naming a fixture is returned. */
  const claimCards = async () => {
    const found2 = await run(gm, P.cardsNew, target);
    for (const c of found2.filter((x) => x.own)) { const uuid = `ChatMessage.${c.id}`; if (!cards.includes(uuid)) { cards.push(uuid); await gm.track(uuid, "ChatMessage"); } }
    return found2.length;
  };
  /** A token a deploy made, tracked at once from the record. */
  const keepToken = async (d) => { if (d?.tokenId) { const uuid = `Scene.${d.sceneId}.Token.${d.tokenId}`; swept.push(uuid); await gm.track(uuid, "Token"); } };
  const effects = {};
  /** A tracked effect on one of the walk's items. */
  const makeEffect = async (label, ref, bright, dim) => {
    const made = await run(gm, P.makeEffect, { ...ref, bright, dim });
    effects[label] = { ...made, ...ref };
    swept.push(made.uuid);
    await gm.track(made.uuid, "ActiveEffect");
    return made;
  };
  const stateOf = (label) => run(gm, P.effectState, { actorId: effects[label].actorId, itemId: effects[label].itemId, effectId: effects[label].id });
  const keyOf = (label) => `${effects[label].actorId}.${effects[label].id}`;

  section("1. ownEffects: a light on a carried item, and none on a world item");
  const ma = await makeEffect("a", itemRef.a, 11, 23);
  const mb = await makeEffect("b", itemRef.b, 7, 14);
  const mw = await makeEffect("w", itemRef.world, 5, 10);
  check("each effect is a transfer effect with the two radius changes the Add Effect control makes", [ma, mb, mw].every((m) => m.transfer === true && m.changes === 2), [ma, mb, mw].map((m) => m.changes));
  const sa = await stateOf("a");
  check("the lamp's effect is applied, listed and shining, its flag unset and not disabled", sa.state === "shining" && sa.applied && sa.listed && !sa.flagKey && !sa.disabled, sa);
  await run(gm, P.openItem, { ...itemRef.a, fresh: true });
  const ta = await run(gm, P.itemTags, itemRef.a);
  check("the carried lamp's Effects tab shows one state tag reading Shining with a tooltip, and no plain 'when' tag beside it", ta.tags.length === 1 && ta.tags[0].state === "shining" && !ta.tags[0].ghost && ta.tags[0].tip && ta.plain === 0, { tags: ta.tags.length, state: ta.tags[0]?.state, plain: ta.plain });
  check("it shows one Shutter button naming its effect, labelled for assistive technology and with a tooltip, and no title attribute", ta.buttons.length === 1 && ta.buttons[0].effect === effects.a.id && ta.buttons[0].aria && ta.buttons[0].tip && !ta.buttons[0].title && !ta.tags[0].title, ta.buttons);
  await run(gm, P.openItem, { ...itemRef.world, fresh: true });
  const tw = await run(gm, P.itemTags, itemRef.world);
  check("a world item's effect shows its old 'when' tag and no state tag or Shutter button", tw.rows === 1 && tw.tags.length === 0 && tw.buttons.length === 0 && tw.plain === 1, { rows: tw.rows, tags: tw.tags.length, buttons: tw.buttons.length, plain: tw.plain });
  await run(gm, P.closeSheets, { partyId: ids.party, items: [itemRef.a, itemRef.world] });

  section("2. the Kit tab on both seats");
  await run(gm, P.openKit, { partyId: ids.party, fresh: true });
  const pk = await run(player, P.openKit, { partyId: ids.party, fresh: true });
  check("the Player seat opens the party sheet on its Kit tab", pk.rendered && pk.kit, pk);
  const gRows = await run(gm, P.rows, { partyId: ids.party });
  const pRows = await run(player, P.rows, { partyId: ids.party });
  check("each seat's Kit tab lists the two members' lights, each shining and lit", [gRows, pRows].every((rows) => rows.length === 2 && rows.every((r) => r.state === "shining" && !r.unlit && r.glyphLit)), { gm: gRows.map((r) => r.state), player: pRows.map((r) => r.state) });
  check("each row carries a state badge tooltip and its own reach tooltip", [gRows, pRows].every((rows) => rows.every((r) => tip(r.stateTip) && tip(r.reachTip) && r.badge.length > 0)));
  check("each seat that owns the members sees a Shutter button per row, with its aria-label and tooltip", [gRows, pRows].every((rows) => rows.every((r) => r.button?.action === "shutterMagicLight" && r.button.label.length > 0 && tip(r.button.aria) && tip(r.button.tip))));
  const p2 = await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 2 && v.drawn === 2);
  check("the column holds two points and the GM canvas draws two column lights", p2.ok, p2.value);

  section("3. the shutter pressed on the Kit tab by a Player");
  await run(gm, P.cardsMark);
  const labelBefore = byKey(pRows, keyOf("a"))?.button;
  const press = await run(player, P.pressKit, { partyId: ids.party, key: keyOf("a") });
  check("the Player seat finds the lamp row's Shutter button and presses it", press.button);
  const flipped = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.flag === true);
  check("the Player's press lands on the item-embedded effect: lightShutter is true and the effect is not disabled", flipped.ok && flipped.value.disabled === false && flipped.value.owner, flipped.value);
  check("the effect stays applied and the gate reads Shuttered; it is still listed", flipped.value.applied && flipped.value.state === "shuttered" && flipped.value.listed, { state: flipped.value.state, applied: flipped.value.applied });
  const pShut = await waitRow(player, keyOf("a"), "shuttered");
  const pa = byKey(pShut.value, keyOf("a"));
  check("the Player's own Kit row redraws to Shuttered and dims, and its button reads Open", pShut.ok && pa.unlit && !pa.glyphLit && pa.button && pa.button.label !== labelBefore.label && pa.button.aria !== labelBefore.aria && pa.button.tip !== labelBefore.tip, { before: labelBefore.label, after: pa.button?.label });
  const gShut = await waitRow(gm, keyOf("a"), "shuttered");
  check("the GM seat's open party sheet redraws the same row to Shuttered with no action of its own", gShut.ok && byKey(gShut.value, keyOf("a")).unlit);
  check("the other member's row is untouched on both seats", byKey(gShut.value, keyOf("b"))?.state === "shining" && byKey(pShut.value, keyOf("b"))?.state === "shining");
  check("the shuttered and the shining badges carry different tooltips",tip(pa.stateTip) && pa.stateTip !== byKey(pShut.value, keyOf("b")).stateTip);
  const p1 = await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 1 && v.drawn === 1);
  check("the column relights: one point stored and one light drawn on the GM canvas", p1.ok, p1.value);
  await sleep(1200);
  check("the shutter posted no chat card naming a fixture", (await run(gm, P.cardsNew, target)).length === 0);
  const dep = await run(gm, P.detach, { partyId: ids.party, fid: ids.fid, actorId: ids.a, want: true });
  await keepToken(dep);
  check("the Judge sends the shuttered lamp's bearer out of the party token", dep.found && dep.deployed, { found: dep.found, deployed: dep.deployed });
  await claimCards();
  const dark = await until(gm, P.tokenLight, { fid: ids.fid, actorId: ids.a }, (v) => v.token && v.bright === 0 && v.dim === 0, { tries: 24 });
  const stillApplied = await stateOf("a");
  check("a deployed token carries no light while the effect is shuttered, and the effect is still applied", dark.ok && stillApplied.applied && stillApplied.state === "shuttered", { token: dark.value.token, bright: dark.value.bright, applied: stillApplied.applied });
  const open = await run(player, P.pressKit, { partyId: ids.party, key: keyOf("a") });
  check("the Player presses Open on the same row while the bearer stands out", open.button);
  const reopened = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.state === "shining");
  check("Open unsets the flag rather than writing false, and the effect reads Shining again", reopened.ok && reopened.value.flagKey === false && reopened.value.flag === null && !reopened.value.disabled, reopened.value);
  const lit = await until(gm, P.tokenLight, { fid: ids.fid, actorId: ids.a }, (v) => v.token && v.bright === 11 && v.dim === 23, { tries: 24 });
  check("the deployed token's light returns at the typed reach", lit.ok, { bright: lit.value.bright, dim: lit.value.dim, managed: lit.value.managed });
  const pDeployed = await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 1);
  check("a deployed bearer is no column point: only the other member's point stands", pDeployed.ok, pDeployed.value);
  const back = await run(gm, P.detach, { partyId: ids.party, fid: ids.fid, actorId: ids.a, want: false });
  check("the Judge gathers the bearer back into the party token", back.found && !back.deployed, { deployed: back.deployed });
  await claimCards();
  const p2b = await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 2 && v.drawn === 2);
  check("the column's point returns", p2b.ok, p2b.value);

  section("4. the item sheet's own toggle, from the Player seat");
  await run(player, P.openItem, { ...itemRef.a, fresh: true });
  const i0 = await run(player, P.itemTags, itemRef.a);
  check("the Player's item sheet shows the lamp's tag Shining and a Shutter button", i0.tags.length === 1 && i0.tags[0].state === "shining" && i0.buttons.length === 1, { tags: i0.tags.length, state: i0.tags[0]?.state, buttons: i0.buttons.length });
  const ip = await run(player, P.pressItem, { ...itemRef.a, effectId: effects.a.id });
  check("the Player presses Shutter on the item sheet", ip.button);
  const iFlip = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.flag === true);
  check("the item sheet's press writes the same flag, the effect not disabled", iFlip.ok && !iFlip.value.disabled && iFlip.value.state === "shuttered", iFlip.value);
  const iTag = await until(player, P.itemTags, itemRef.a, (v) => v.tags[0]?.state === "shuttered" && v.tags[0].ghost && v.buttons[0]?.label !== i0.buttons[0].label);
  check("the sheet redraws the tag as Shuttered (dimmed) and the button to Open without a manual refresh", iTag.ok, { state: iTag.value.tags[0]?.state, ghost: iTag.value.tags[0]?.ghost });
  const iRow = await waitRow(gm, keyOf("a"), "shuttered");
  check("the GM seat's Kit row follows the item sheet's press", iRow.ok);
  const ip2 = await run(player, P.pressItem, { ...itemRef.a, effectId: effects.a.id });
  const iBack = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.state === "shining");
  check("pressing Open on the item sheet clears the flag: the key is gone and the effect shines", ip2.button && iBack.ok && iBack.value.flagKey === false, iBack.value);
  await run(player, P.closeSheets, { partyId: ids.party, items: [itemRef.a] });

  section("5. an Observer has no button");
  // A Kit tab drawn while the Player owns the members stays open as the Judge lowers the ownership.
  await run(player, P.openKit, { partyId: ids.party, fresh: true });
  const own2 = await run(gm, P.ownership, { actorIds: [ids.a, ids.b], playerId, level: 2 });
  check("the Player user is taken down to Observer ownership of both members", own2.every((v) => v === 2), own2);
  const dropped = await until(player, P.rows, { partyId: ids.party }, (rows) => rows.length === 2 && rows.every((r) => r.button === null), { tries: 16, every: 250 });
  note("a Kit tab drawn at Owner level drops its Shutter buttons on its own when the ownership falls", dropped.ok);
  // The sheet stays open: it is the Observer case, since the GM's ownership sync leaves a Player who owns no member without the party sheet.
  const oRows = (await until(player, P.rows, { partyId: ids.party }, (rows) => rows.length === 2, { tries: 12, every: 250 })).value;
  check("the Observer's Kit tab lists both lights with the state badge and its tooltip and no Shutter button", oRows.length === 2 && oRows.every((r) => r.state === "shining" && tip(r.stateTip) && r.button === null), { rows: oRows.length, buttons: oRows.filter((r) => r.button).length });
  const settled = await until(player, P.partyPerm, { partyId: ids.party, level: "LIMITED" }, (v) => v === false, { tries: 40, every: 250 });
  check("the party actor's permission for the Player settles below Limited once the GM's sync has run", settled.ok, { limited: settled.value });
  const refused = await run(player, P.tryOpen, { partyId: ids.party });
  check("a fresh render of the party sheet is refused for a Player who owns no member: the sheet stays closed", refused.state === -1 && !refused.rendered && !refused.connected, refused);
  await run(player, P.openItem, { ...itemRef.a, fresh: true });
  const oTag = await run(player, P.itemTags, itemRef.a);
  check("the Observer's item sheet shows the state tag and no Shutter button", oTag.tags.length === 1 && oTag.tags[0].state === "shining" && oTag.buttons.length === 0, { tags: oTag.tags.length, buttons: oTag.buttons.length });
  const call = await run(player, P.callShutter, { ...itemRef.a, effectId: effects.a.id, on: true });
  await sleep(1200);
  const untouched = await stateOf("a");
  check("setLightShutter from the Observer seat returns false and writes nothing", call.returned === false && call.owner === false && call.actorOwner === false && untouched.flagKey === false && untouched.state === "shining", { returned: call.returned, owner: call.owner, flagKey: untouched.flagKey });
  await run(player, P.closeSheets, { partyId: ids.party, items: [itemRef.a] });
  const own3 = await run(gm, P.ownership, { actorIds: [ids.a, ids.b], playerId, level: 3 });
  check("the Player's ownership is put back to Owner", own3.every((v) => v === 3), own3);
  await until(player, P.partyPerm, { partyId: ids.party, level: "LIMITED" }, (v) => v === true, { tries: 40, every: 250 });
  await run(player, P.openKit, { partyId: ids.party, fresh: true });
  check("the Player's buttons are back on a fresh sheet", (await run(player, P.rows, { partyId: ids.party })).every((r) => r.button?.action === "shutterMagicLight"));

  section("6. stowed in the pack and taken out");
  await run(player, P.openItem, { ...itemRef.a, fresh: true });
  const st = await run(gm, P.store, { actorId: ids.a, itemId: ids.itemA, packId: ids.pack });
  check("the equipment API moves the lamp into the pack", st.moved && st.contained, st);
  const stowedDoc = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.state === "stowed");
  check("the gate reads the lamp's effect as Stowed while it stays applied and unshuttered", stowedDoc.ok && stowedDoc.value.applied && !stowedDoc.value.flagKey, stowedDoc.value);
  const gStow = await waitRow(gm, keyOf("a"), "stowed");
  const pStow = await waitRow(player, keyOf("a"), "stowed");
  const gs = byKey(gStow.value, keyOf("a"));
  const ps = byKey(pStow.value, keyOf("a"));
  check("both seats' Kit rows redraw to Stowed, dimmed, the glyph unlit", gStow.ok && pStow.ok && gs.unlit && !gs.glyphLit && ps.unlit && !ps.glyphLit);
  check("the badge tooltip names the pack the lamp is in, on both seats", gs.stateTip.includes(PACK_NAME) && ps.stateTip.includes(PACK_NAME), { gm: gs.stateTip.includes(PACK_NAME), player: ps.stateTip.includes(PACK_NAME) });
  check("Stowed, Shuttered and Shining each read with their own badge tooltip", new Set([gs.stateTip, byKey(gStow.value, keyOf("b")).stateTip, pa.stateTip]).size === 3);
  const iStow = await until(player, P.itemTags, itemRef.a, (v) => v.tags[0]?.state === "stowed" && v.tags[0].ghost);
  check("the Player's open item sheet redraws the lamp's tag as Stowed", iStow.ok, { state: iStow.value.tags[0]?.state });
  const pS = await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 1 && v.drawn === 1);
  check("the column drops the stowed lamp's point: one stored and one drawn", pS.ok, pS.value);
  const out = await run(gm, P.takeOut, { actorId: ids.a, itemId: ids.itemA });
  check("the equipment API takes the lamp out of the pack", out.moved && !out.contained, out);
  const gOut = await waitRow(gm, keyOf("a"), "shining");
  const pOut = await waitRow(player, keyOf("a"), "shining");
  check("both seats' rows read Shining again with no reload", gOut.ok && pOut.ok);
  const pO = await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 2 && v.drawn === 2);
  check("the column's point returns", pO.ok, pO.value);
  await run(player, P.closeSheets, { partyId: ids.party, items: [itemRef.a] });
  await run(player, P.openKit, { partyId: ids.party, fresh: true });
  // A deployed bearer's token follows a stow.
  const dep2 = await run(gm, P.detach, { partyId: ids.party, fid: ids.fid, actorId: ids.a, want: true });
  await keepToken(dep2);
  const lit2 = await until(gm, P.tokenLight, { fid: ids.fid, actorId: ids.a }, (v) => v.token && v.bright === 11 && v.dim === 23, { tries: 24 });
  check("a deployed bearer's token carries the lamp's light", dep2.deployed && lit2.ok, { deployed: dep2.deployed, bright: lit2.value.bright });
  const st2 = await run(gm, P.store, { actorId: ids.a, itemId: ids.itemA, packId: ids.pack });
  const dark2 = await until(gm, P.tokenLight, { fid: ids.fid, actorId: ids.a }, (v) => v.token && v.bright === 0 && v.dim === 0, { tries: 24 });
  check("stowing the lamp darkens the deployed token", st2.moved && dark2.ok, { bright: dark2.value.bright });
  await run(gm, P.takeOut, { actorId: ids.a, itemId: ids.itemA });
  const lit3 = await until(gm, P.tokenLight, { fid: ids.fid, actorId: ids.a }, (v) => v.token && v.bright === 11 && v.dim === 23, { tries: 24 });
  check("taking it out relights the deployed token", lit3.ok, { bright: lit3.value.bright });
  const back2 = await run(gm, P.detach, { partyId: ids.party, fid: ids.fid, actorId: ids.a, want: false });
  check("the bearer is gathered back", back2.found && !back2.deployed);
  await claimCards();

  section("6b. the shutter outlasts the pack");
  const shutA = await run(gm, P.pressKit, { partyId: ids.party, key: keyOf("a") });
  const shutDoc = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.flag === true);
  check("the Judge's own Shutter press writes the flag", shutA.button && shutDoc.ok, shutDoc.value);
  await run(gm, P.store, { actorId: ids.a, itemId: ids.itemA, packId: ids.pack });
  const both = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.state === "stowed");
  check("shuttered and stowed together read Stowed, and the flag is kept", both.ok && both.value.flag === true, { state: both.value.state, flag: both.value.flag });
  const noPoint = await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 1 && v.drawn === 1);
  check("neither state casts a point", noPoint.ok, noPoint.value);
  await run(gm, P.takeOut, { actorId: ids.a, itemId: ids.itemA });
  const outShut = await waitRow(gm, keyOf("a"), "shuttered");
  check("taken out, the row reads Shuttered and not Shining, and no point returns", outShut.ok && (await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 1 && v.drawn === 1)).ok);
  await run(gm, P.pressKit, { partyId: ids.party, key: keyOf("a") });
  const reopened2 = await until(gm, P.effectState, { actorId: ids.a, itemId: ids.itemA, effectId: effects.a.id }, (v) => v.state === "shining");
  check("Open puts the lamp back to Shining with the flag key gone", reopened2.ok && reopened2.value.flagKey === false, reopened2.value);
  check("the column's point is back", (await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 2 && v.drawn === 2)).ok);

  section("7. a wearable item: canWear and isWorn");
  const bs = await run(gm, P.equip, { actorId: ids.b, itemId: ids.itemB, on: true });
  check("the ring can be worn and is worn", bs.canWear && bs.worn, bs);
  const off = await run(gm, P.equip, { actorId: ids.b, itemId: ids.itemB, on: false });
  check("taking the ring off writes and reads as not worn", off.wrote && !off.worn, off);
  const offDoc = await until(gm, P.effectState, { actorId: ids.b, itemId: ids.itemB, effectId: effects.b.id }, (v) => v.state === "stowed");
  check("an unworn wearable's light reads Stowed, still applied", offDoc.ok && offDoc.value.applied, offDoc.value);
  const gOff = await waitRow(gm, keyOf("b"), "stowed");
  const pOff = await waitRow(player, keyOf("b"), "stowed");
  const goff = byKey(gOff.value, keyOf("b"));
  check("both seats' rows read Stowed for the unworn ring, and the tooltip is not the pack's", gOff.ok && pOff.ok && goff.unlit && !goff.stateTip.includes(PACK_NAME) && goff.stateTip !== gs.stateTip, { notPack: !goff.stateTip.includes(PACK_NAME) });
  check("the unworn ring's point is gone", (await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 1 && v.drawn === 1)).ok);
  const on = await run(gm, P.equip, { actorId: ids.b, itemId: ids.itemB, on: true });
  const gOn = await waitRow(gm, keyOf("b"), "shining");
  check("wearing it again lights it and the point returns", on.worn && gOn.ok && (await until(gm, P.points, { sceneId: ids.scene, fid: ids.fid }, (v) => v.stored === 2 && v.drawn === 2)).ok);
  const cardLeft = await claimCards();
  note("cards naming a fixture made by the run's own actions (detach and gather), tracked for the sweep", cardLeft);

  section("8. type size and fit on windows opened after the change");
  const measured = {};
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    measured[label] = {};
    for (const px of [14, 18]) {
      await run(seat, P.closeSheets, { partyId: ids.party, items: [itemRef.a] });
      const f = await run(seat, P.fontScale, { px });
      const opened = await run(seat, P.openKit, { partyId: ids.party, fresh: true });
      const wide = await run(seat, P.layoutKit, { partyId: ids.party });
      if (label === "gm") await gm.compose(opened.winId).catch(() => {});
      let shotWide = null;
      if (label === "gm") shotWide = await gm.shot(path.join(shotsDir, `kit-${px}.png`), `#${opened.winId}`).catch((e) => ({ error: String(e?.message ?? e) }));
      const narrow = await run(seat, P.layoutKit, { partyId: ids.party, width: 420 });
      let shotNarrow = null;
      if (label === "gm") shotNarrow = await gm.shot(path.join(shotsDir, `kit-${px}-narrow.png`), `#${opened.winId}`).catch((e) => ({ error: String(e?.message ?? e) }));
      const io = await run(seat, P.openItem, { ...itemRef.a, fresh: true });
      const item = await run(seat, P.layoutItem, itemRef.a);
      let shotItem = null;
      if (label === "gm") {
        await gm.compose(io.winId).catch(() => {});
        shotItem = await gm.shot(path.join(shotsDir, `item-${px}.png`), `#${io.winId}`).catch((e) => ({ error: String(e?.message ?? e) }));
      }
      measured[label][px] = { f, wide, narrow, item, shots: [shotWide, shotNarrow, shotItem].map((s) => (s ? (s.error ? "error" : "ok") : "n/a")) };
      note(`${label} at ${px}: knob, rows, narrow width reached`, { base: f.base, rows: wide.rows.length, narrowW: narrow.winW, shots: measured[label][px].shots });
    }
    const m14 = measured[label][14];
    const m18 = measured[label][18];
    check(`${label} seat: the knob reaches the Kit row's badge and button on a fresh window (larger at 18 than at 14)`, m14.wide.rows.length === 2 && m18.wide.rows.every((r, i) => r.badgePx > m14.wide.rows[i].badgePx && r.btnPx > m14.wide.rows[i].btnPx), { badge14: m14.wide.rows[0]?.badgePx, badge18: m18.wide.rows[0]?.badgePx, btn14: m14.wide.rows[0]?.btnPx, btn18: m18.wide.rows[0]?.btnPx });
    check(`${label} seat: the item sheet's tag and button follow the knob too`, m18.item.tagPx > m14.item.tagPx && m18.item.btnPx > m14.item.btnPx, { tag14: m14.item.tagPx, tag18: m18.item.tagPx, btn14: m14.item.btnPx, btn18: m18.item.btnPx });
    for (const px of [14, 18]) {
      const m = measured[label][px];
      check(`${label} seat at ${px}: no Kit row spills past its own box, no button is clipped, and the window has no horizontal overflow, at the sheet's width`, m.wide.rows.every((r) => !r.overX && !r.spill && r.btnClipped === false && r.btnInside) && !m.wide.contentOverX && !m.wide.panelOverX, { rows: m.wide.rows.map((r) => ({ overX: r.overX, spill: r.spill, clip: r.btnClipped, inside: r.btnInside, h: r.h })), content: m.wide.contentOverX, panel: m.wide.panelOverX });
      check(`${label} seat at ${px}: the same holds at a narrow window (reached ${m.narrow.winW} px)`, m.narrow.rows.every((r) => !r.overX && !r.spill && r.btnClipped === false && r.btnInside) && !m.narrow.contentOverX, { winW: m.narrow.winW, rows: m.narrow.rows.map((r) => ({ overX: r.overX, spill: r.spill, clip: r.btnClipped, inside: r.btnInside, h: r.h })), content: m.narrow.contentOverX, panel: m.narrow.panelOverX });
      check(`${label} seat at ${px}: the item sheet's tag row fits`, m.item.row && !m.item.overX && !m.item.spill && m.item.btnClipped === false && !m.item.contentOverX, m.item);
      for (const [at, reading] of [["the sheet's width", m.wide], [`a narrow window (${m.narrow.winW} px)`, m.narrow]]) {
        const b = reading.band;
        check(`${label} seat at ${px}, ${at}: the header's title keeps its floor width, and neither the bar nor a window control lies over the name`,
          b.name && b.bar && !b.barOverName && !b.controlOverName && !b.controlOverBar && b.inside && b.roomy, b);
      }
    }
  }
  note("screenshots taken for review (the walk's own scratch directory, not the repo)", shotsDir);

  const pe = await run(player, P.drain);
  const ge = await run(gm, P.drain);
  check("no console error on the Player seat over the walk", !pe.errors.length, pe.errors.slice(0, 3));
  check("no console error on the GM seat over the walk", !ge.errors.length, ge.errors.slice(0, 3));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && ids) {
    try {
      for (const seat of [gm, player]) { if (seat) { try { await run(seat, P.closeSheets, { partyId: ids.party, items: [{ actorId: ids.a, itemId: ids.itemA }, { actorId: null, itemId: ids.world }] }); } catch {} } }
      note("ownership put back", await run(gm, P.ownership, { actorIds: [ids.a, ids.b], playerId, level: 3 }));
      await run(gm, P.takeOut, { actorId: ids.a, itemId: ids.itemA });
      await run(gm, P.equip, { actorId: ids.b, itemId: ids.itemB, on: true });
      for (const id of [ids.a, ids.b]) await run(gm, P.detach, { partyId: ids.party, fid: ids.fid, actorId: id, want: false });
    } catch (err) { console.error("restore of the fixtures:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat && found.fontScale[label] != null) note(`fontScale put back (${label})`, await run(seat, P.fontScale, { px: found.fontScale[label] })); } catch (err) { console.error(`font ${label}:`, err?.message ?? err); }
  }
  if (gm) {
    try {
      const strays = await run(gm, P.cardsNew, { actorIds: [ids?.party, ids?.a, ids?.b].filter(Boolean), names: ["QA Magic Light Party", "QA Magic Light Member", "QA Magic Light Member Worn"] });
      for (const c of strays.filter((x) => x.own)) { const uuid = `ChatMessage.${c.id}`; if (!cards.includes(uuid)) { cards.push(uuid); await gm.track(uuid, "ChatMessage"); } }
    } catch (err) { console.error("leftover cards:", err?.message ?? err); }
    try {
      note("sweep of the walk's own effects, tokens and cards", await gm.sweepTracked({ only: [...swept, ...cards] }));
    } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixtures kept: ${SCENE}, ${PARTY}, ${TOKEN}, ${MEMBER_A}, ${MEMBER_B}, ${ITEM_A}, ${PACK}, ${ITEM_B}, ${WORLD}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
