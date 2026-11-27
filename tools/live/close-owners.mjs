/**
 * Live walk, close-owners: the controls three landed changes moved from a role
 * gate to ownership, walked on the GM seat and the Player seat. Only what each
 * change touched is checked, one verdict for each control.
 *
 *   role-cleanup (8690df68)
 *     T-0855  a Roster transfer moves the hireling's ownership with it: the new
 *             employer's grant is written and each user the old hire made Owner
 *             is removed. The Roster window's Transfer is pressed, the dialog
 *             answered, and the hireling's ownership read back, there and back
 *             again. The second owner is any other user the world holds; with
 *             none, the grant half is reported unreachable.
 *     T-0861  the legacy ledger's record hint reads singular over the Player
 *             seat's one record button.
 *   place-pay (b8d4883e)
 *     Pay the house on a place's Storage tab: coin leaves the payer and lands
 *     on the place. The payer's owner on the Player seat (a place the seat
 *     owns, a place it only observes with the payer pinned there, and one out of
 *     reach, which is refused) and the Judge (in reach, and out of reach with the
 *     override notice).
 *   ledger batch (f0dd913a)
 *     T-0820  a locked container's Unlock, Empty and Unmake: the owner carrying
 *             its key has them (the module's character sheet for Unlock and
 *             Empty, the system's sheet for Unmake, which only it draws); a
 *             keyless Player is offered none, and the refusal notice is read
 *             through the module's `passLock` since a stale control cannot be
 *             pressed on a redrawn sheet; a keyless Judge goes ahead, warned.
 *     T-0859  the item sheet's Source cell on a Player's owned item, absent
 *             while the item is disguised or its magic unidentified, present on
 *             the Judge seat, absent on an item the seat only observes.
 *     T-0856  a dismissed character (core leaves it marked as a hireling with
 *             no employer) is offered in the Roster's Transfer list, the Post a
 *             search window's employer choice and the recruit employer chooser.
 *             The recruit chooser is reached by calling `pickEmployer`, which
 *             the Recruit button calls.
 *
 * Machine values arrive through ./_env.mjs. Fixtures are kept and found by
 * marker, each brought to its shape at its step's start (the markers are listed
 * in `FX`). Items a step makes carry `flags.world.fixtureItem` and are cleared
 * from the walk's own fixture at the next step's start. The chat cards the
 * transfers and payments post speak as a fixture, and the house coin rows a
 * payment lands on a place are listed by id as they appear and swept by those
 * ids alone. The world's `autoRollCalamity` is held on and restored. Every
 * figure printed is a count, a boolean or the module's own lang string.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";
/** Foundry's ownership levels. */
const LEVEL = { NONE: 0, OBSERVER: 2, OWNER: 3 };
const FX = {
  from: "henchmen/close-from",
  to: "henchmen/close-to",
  hire: "henchmen/close-hireling",
  dis: "henchmen/close-dismissed",
  place: "henchmen/close-place",
  legacy: "classes/close-legacy",
  lockHero: "equipment/close-lock-hero",
  srcHero: "equipment/close-src-hero",
  srcObs: "equipment/close-src-observed",
  payHero: "location/close-pay-hero",
  payA: "location/close-pay-a",
  payB: "location/close-pay-b",
};
const GOLD = "QA Pay Gold";
const SILVER = "QA Pay Silver";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */

const P = {
  /** Arm the helpers every drive shares, record notices and chat cards from now. */
  kit: async () => {
    const K = (globalThis.__cw = globalThis.__cw ?? {});
    K.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    K.poll = async (fn, { tries = 40, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await K.sleep(every);
      }
      return null;
    };
    K.root = (app) => (app?.element?.nodeType === 1 ? app.element : (app?.element?.[0] ?? null));
    K.apps = () => [...foundry.applications.instances.values()];
    K.closeDialogs = async () => {
      for (const app of K.apps()) if (app.element?.classList?.contains("dialog")) await app.close({ force: true });
    };
    if (!K.armed) {
      K.armed = true;
      K.notes = [];
      K.msgs = [];
      for (const kind of ["info", "warn", "error"]) {
        const original = ui.notifications[kind];
        ui.notifications[kind] = function (msg, ...rest) {
          K.notes.push({ kind, text: String(msg) });
          return original.call(this, msg, ...rest);
        };
      }
      K.hook = Hooks.on("createChatMessage", (m) =>
        K.msgs.push({ uuid: m.uuid, actor: m.speaker?.actor ?? null, receipt: (m.content ?? "").includes("acks-extras-pay-receipt"), whisper: [...(m.whisper ?? [])] }),
      );
    }
    K.takeNotes = () => K.notes.splice(0, K.notes.length);
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, ready: !!acksExtras.henchmen?.openRosterApp && !!acksExtras.classes?.legacy?.open && !!acksExtras.characterSheet?.Sheet };
  },

  /** Drop what `kit` armed on this seat. */
  unkit: async () => {
    const K = globalThis.__cw;
    if (!K?.armed) return true;
    for (const kind of ["info", "warn", "error"]) delete ui.notifications[kind];
    Hooks.off("createChatMessage", K.hook);
    K.armed = false;
    return true;
  },

  /** The census of seated users, and this seat's identity. */
  census: async () => ({
    active: game.users.filter((u) => u.active).map((u) => [u.name, u.isGM]),
    activeGM: game.users.activeGM?.name ?? null,
    userId: game.user.id,
    isGM: game.user.isGM,
    role: game.user.role,
    module: game.modules.get("acks-extras")?.version ?? null,
  }),

  /** GM seat: any user other than the two seats, a non-Judge first; null when the world has none. */
  otherUser: async ({ pid }) => {
    const gmId = game.user.id;
    const other = game.users.find((u) => u.id !== pid && u.id !== gmId && !u.isGM) ?? game.users.find((u) => u.id !== pid && u.id !== gmId);
    return other ? { id: other.id, isGM: other.isGM } : null;
  },

  /** The world's autoRollCalamity, set when `value` is given. */
  autoRoll: async ({ value }) => {
    const before = game.settings.get("acks-extras", "autoRollCalamity");
    if (value !== undefined && value !== before) await game.settings.set("acks-extras", "autoRollCalamity", value);
    return { before, now: game.settings.get("acks-extras", "autoRollCalamity") };
  },

  /** GM seat: the chat cards this seat received since `kit` that speak as one of `actorIds`, by uuid. */
  cards: async ({ actorIds }) => {
    const K = globalThis.__cw;
    const mine = K.msgs.filter((m) => actorIds.includes(m.actor));
    return { uuids: mine.map((m) => m.uuid), receipts: mine.filter((m) => m.receipt).map((m) => ({ actor: m.actor, toGM: m.whisper.includes(game.user.id), whisperCount: m.whisper.length })) };
  },

  /* ---------------------------- henchmen ---------------------------- */

  /**
   * GM seat. Bring the employer pair and the hirelings to the shape a step
   * needs: `from` (the Player owns it) and `to` (only `otherId` owns it) out of
   * service; each key of `serve` taken off every other list and put in service
   * under `from`, the Player owning it, as the owners of `from` do after a hire.
   */
  hShape: async ({ ids, pid, otherId, serve }) => {
    const M = "/modules/acks-extras/scripts/henchmen";
    const AD = await import(`${M}/acks-adapter.mjs`);
    const HI = await import(`${M}/engine/hire.mjs`);
    const OWN = (map) => foundry.data.operators.ForcedReplacement.create(map);
    const doc = (k) => game.actors.get(ids[k]);
    const from = doc("from");
    const to = doc("to");
    for (const a of [from, to]) {
      if (a.system.retainer?.enabled) await AD.setRetainer(a, { enabled: false, managerid: "" });
      if (!a.prototypeToken.actorLink) await a.update({ "prototypeToken.actorLink": true });
    }
    await from.update({ ownership: OWN({ default: 0, [pid]: 3 }) });
    await to.update({ ownership: OWN(otherId ? { default: 0, [otherId]: 3 } : { default: 0 }) });
    for (const k of serve) {
      const a = doc(k);
      if (!a.prototypeToken.actorLink) await a.update({ "prototypeToken.actorLink": true });
      for (const x of game.actors.filter((x) => x.id !== from.id && (x.system.henchmenList ?? []).includes(a.id))) await AD.delHenchman(x, a.id);
      if (!a.system.retainer?.enabled) await HI.enrollHenchman(from, a, { loyalty: 2 });
      else if (!(from.system.henchmenList ?? []).includes(a.id)) await AD.addHenchman(from, a.id);
      if (a.system.retainer?.managerid !== from.id) await AD.setRetainer(a, { managerid: from.id });
      const record = a.getFlag("acks-extras", "record") ?? {};
      if (record.employerUuid !== from.uuid) await a.setFlag("acks-extras", "record", { ...record, employerUuid: from.uuid });
      if (a.system.retainer?.category !== "henchman") await AD.setRetainer(a, { category: "henchman" });
      await a.update({ ownership: OWN({ default: 0, [pid]: 3 }) });
    }
    const out = { fromIdle: !from.system.retainer?.enabled, toIdle: !to.system.retainer?.enabled };
    for (const k of serve) {
      const a = doc(k);
      const own = a.ownership ?? {};
      out[k] = {
        serves: a.system.retainer?.enabled === true && a.system.retainer?.managerid === from.id && (from.system.henchmenList ?? []).includes(a.id),
        playerKey: own[pid] === 3,
        otherKey: otherId ? own[otherId] === 3 : null,
        defaultLevel: own.default ?? null,
      };
    }
    return out;
  },

  /** What a hireling and its ownership look like on this seat: the employer and manager it names, the ownership levels, the lists it is on. */
  hRead: async ({ ids, hireId, pid, otherId }) => {
    const hire = game.actors.get(hireId);
    const which = (value, by) => {
      if (!value) return "none";
      for (const k of ["from", "to"]) if (by(game.actors.get(ids[k])) === value) return k;
      return "other";
    };
    const record = hire.getFlag("acks-extras", "record") ?? {};
    const own = hire.ownership ?? {};
    return {
      employer: which(record.employerUuid, (a) => a.uuid),
      manager: which(hire.system.retainer?.managerid, (a) => a.id),
      enabled: hire.system.retainer?.enabled === true,
      playerLevel: own[pid] ?? null,
      otherLevel: otherId ? (own[otherId] ?? null) : null,
      defaultLevel: own.default ?? null,
      isOwner: !!hire.isOwner,
      listedBy: ["from", "to"].filter((k) => (game.actors.get(ids[k]).system.henchmenList ?? []).includes(hire.id)),
      events: (record.events ?? []).map((e) => e.type),
    };
  },

  /** Player seat: wait up to ten seconds for this client to hold the ownership and service a step needs. */
  hSeen: async ({ ids, hireId, owns, manager }) => {
    const K = globalThis.__cw;
    const read = () => {
      const hire = game.actors.get(hireId);
      return {
        isOwner: !!hire?.isOwner,
        fromOwned: !!game.actors.get(ids.from)?.isOwner,
        toOwned: !!game.actors.get(ids.to)?.isOwner,
        manager: hire?.system.retainer?.managerid === ids[manager] ? manager : hire?.system.retainer?.managerid ? "other" : "none",
      };
    };
    for (let i = 0; i < 40; i++) {
      const now = read();
      if (now.isOwner === owns && (!manager || now.manager === manager)) break;
      await K.sleep(250);
    }
    return { ...read(), isGM: game.user.isGM };
  },

  /**
   * Open the employer's Roster on this seat and read the hireling's row: the
   * controls it draws. With `action`, press that control and answer the dialog:
   * Transfer reads its options and chooses `pick`, or is closed unanswered when
   * `pick` is absent; Dismiss confirms.
   */
  hPress: async ({ employerId, hireId, action, pick }) => {
    const K = globalThis.__cw;
    await K.closeDialogs();
    for (const app of K.apps()) if (app.constructor?.name === "RosterApp") await app.close({ force: true });
    if (!game.actors.get(employerId)) return { opened: false, noEmployer: true };
    acksExtras.henchmen.openRosterApp(game.actors.get(employerId));
    const roster = await K.poll(() => {
      const x = K.apps().find((a) => a.constructor?.name === "RosterApp" && a.employer?.id === employerId);
      return x && K.root(x)?.querySelector(".acks-extras-roster__row") ? x : null;
    });
    if (!roster) return { opened: false };
    const row = K.root(roster).querySelector(`.acks-extras-roster__row[data-actor-id="${hireId}"]`);
    const controls = [...(row?.querySelectorAll(".acks-extras-frame__ctls [data-action]") ?? [])].map((b) => b.dataset.action);
    const out = { opened: true, row: !!row, controls, pressed: false, dialog: false, options: [], answered: false };
    const button = action ? row?.querySelector(`.acks-extras-frame__ctls [data-action="${action}"]`) : null;
    if (!button) {
      await roster.close({ force: true });
      return out;
    }
    button.click();
    out.pressed = true;
    const dialog = await K.poll(() => document.querySelector(".application.dialog"), { tries: 30, every: 200 });
    if (!dialog) return out;
    out.dialog = true;
    if (action === "transfer") {
      const select = dialog.querySelector('select[name="employerId"]');
      out.options = [...(select?.options ?? [])].map((o) => o.value);
      if (select && pick) select.value = pick;
    }
    if (action === "transfer" && !pick) {
      await K.closeDialogs();
      await roster.close({ force: true });
      return out;
    }
    const ok = dialog.querySelector('button[data-action="ok"], button[data-action="yes"]');
    if (ok) {
      ok.click();
      out.answered = true;
    }
    return out;
  },

  /** Close any Roster window this seat holds. */
  hClose: async () => {
    const K = globalThis.__cw;
    await K.closeDialogs();
    for (const app of K.apps()) if (app.constructor?.name === "RosterApp") await app.close({ force: true });
    return true;
  },

  /** Wait up to ten seconds for a dismissal to land: the retainer switch stays on and the manager is cleared. */
  hDismissed: async ({ ids, disId }) => {
    const K = globalThis.__cw;
    const read = () => {
      const a = game.actors.get(disId);
      return {
        enabled: a?.system.retainer?.enabled === true,
        managerCleared: !a?.system.retainer?.managerid,
        onFromList: (game.actors.get(ids.from).system.henchmenList ?? []).includes(disId),
      };
    };
    for (let i = 0; i < 40 && (read().managerCleared === false || read().onFromList); i++) await K.sleep(250);
    return read();
  },

  /** Render the Post a search window on place `placeId` and read its employer choice. */
  hPosting: async ({ placeId }) => {
    const K = globalThis.__cw;
    const PD = await import("/modules/acks-extras/scripts/henchmen/apps/posting-dialog.mjs");
    const app = new PD.PostingDialog({ location: game.actors.get(placeId) });
    try {
      await app.render({ force: true });
      const root = await K.poll(() => (K.root(app)?.querySelector('select[name="employerId"]') ? K.root(app) : null), { tries: 24, every: 250 });
      const options = [...(root?.querySelectorAll('select[name="employerId"] option') ?? [])].map((o) => o.value);
      return { rendered: !!app.rendered, select: !!root, options, isGM: game.user.isGM };
    } catch (err) {
      return { rendered: false, error: String(err?.message ?? err).slice(0, 160) };
    } finally {
      await app.close({ force: true });
    }
  },

  /** Call the recruit window's employer chooser and read its options; closed unanswered. Skipped where the seat's user has an assigned character, which the chooser returns first. */
  hRecruit: async () => {
    const K = globalThis.__cw;
    const RD = await import("/modules/acks-extras/scripts/henchmen/apps/recruit-dialog.mjs");
    if (game.user.character) return { skipped: true, isGM: game.user.isGM };
    await K.closeDialogs();
    const pending = RD.pickEmployer();
    const dialog = await K.poll(() => document.querySelector(".application.dialog"), { tries: 20, every: 200 });
    if (!dialog) {
      const direct = await Promise.race([pending, K.sleep(1000).then(() => "late")]);
      return { skipped: false, dialog: false, direct: direct && direct !== "late" ? direct.id : null, isGM: game.user.isGM };
    }
    const options = [...dialog.querySelectorAll('select[name="employerId"] option')].map((o) => o.value);
    await K.closeDialogs();
    await pending;
    return { skipped: false, dialog: true, options, isGM: game.user.isGM };
  },

  /* ------------------------------ legacy ------------------------------ */

  /** Open the legacy ledger on a character and read its record controls and the hint under them. */
  legacyView: async ({ actorId }) => {
    const K = globalThis.__cw;
    const id = `acks-extras-legacy-${actorId}`;
    await foundry.applications.instances.get(id)?.close({ force: true });
    acksExtras.classes.legacy.open(game.actors.get(actorId));
    const app = await K.poll(() => {
      const x = foundry.applications.instances.get(id);
      return x && K.root(x)?.querySelector(".acks-extras-legacy__body") ? x : null;
    }, { tries: 40, every: 250 });
    if (!app) return { opened: false };
    await K.sleep(400);
    const root = K.root(app);
    const buttons = [...root.querySelectorAll('[data-action="record"]')];
    const hint = buttons[0]?.closest(".form-fields")?.nextElementSibling ?? null;
    const text = hint?.textContent?.trim() ?? null;
    const expected = game.i18n.localize("ACKS-CLASSES.legacy.recordHint");
    const out = {
      opened: true,
      isGM: game.user.isGM,
      buttons: buttons.length,
      kinds: buttons.map((b) => b.dataset.kind),
      hintFound: hint?.tagName === "P",
      hintIsLang: text === expected && !/^ACKS-CLASSES\./.test(text ?? ""),
      singular: !!text && /\ba record\b/.test(text) && !/\beach\b/i.test(text),
    };
    await app.close({ force: true });
    return out;
  },

  /* ------------------------------- locks ------------------------------- */

  /**
   * GM seat. Replace the walk's items on the hero with a container holding one
   * stone, locked or not, and (when `keyed`) the key its lock lists.
   */
  lockShape: async ({ heroId, tag, keyed, locked }) => {
    const C = await import("/modules/acks-extras/scripts/equipment/containers.mjs");
    const hero = game.actors.get(heroId);
    const own = hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
    if (own.length) await hero.deleteEmbeddedDocuments("Item", own);
    const flags = { world: { fixtureItem: tag } };
    const made = await hero.createEmbeddedDocuments("Item", [
      { name: "QA Close Chest", type: "item", flags: { ...flags, "acks-extras": { container: { locked: false, opened: false, keys: [{ uuid: "", name: "QA Close Key" }] } } } },
      { name: "QA Close Stone", type: "item", flags, system: { quantity: 1 } },
    ]);
    const box = made.find((i) => i.name === "QA Close Chest");
    const stone = made.find((i) => i.name === "QA Close Stone");
    await C.storeIn(hero, stone, box);
    if (locked) await C.setLocked(box, true);
    if (keyed) await hero.createEmbeddedDocuments("Item", [{ name: "QA Close Key", type: "item", flags }]);
    return { isContainer: C.isContainer(box), locked: C.isLocked(box), keyed: C.holdsKey(hero, box), contents: C.contentsOf(hero, box.id).length };
  },

  /** Read the walk's container on this seat. */
  lockRead: async ({ heroId, tag }) => {
    const C = await import("/modules/acks-extras/scripts/equipment/containers.mjs");
    const hero = game.actors.get(heroId);
    const box = hero?.items.find((i) => i.name === "QA Close Chest" && i.flags?.world?.fixtureItem === tag);
    if (!box) return { found: false };
    const rec = C.containerOf(box);
    return { found: true, locked: C.isLocked(box), opened: !!rec?.opened, record: !!rec, keyed: C.holdsKey(hero, box), contents: C.contentsOf(hero, box.id).length, owns: !!hero.isOwner, isGM: game.user.isGM };
  },

  /**
   * Open a sheet of the hero (`surface` "extras": the module's character sheet,
   * "core": the system's, whose Equipment tab the module regroups) and read the
   * container's lock controls. With `control` (`unlock`, `empty`, `unmake`),
   * press it and read what landed and which notice the seat was given.
   */
  lockPress: async ({ heroId, tag, surface, control }) => {
    const K = globalThis.__cw;
    const C = await import("/modules/acks-extras/scripts/equipment/containers.mjs");
    const hero = game.actors.get(heroId);
    const box = hero.items.find((i) => i.name === "QA Close Chest" && i.flags?.world?.fixtureItem === tag);
    if (!box) return { rendered: false, noBox: true };
    K.takeNotes();
    let app;
    if (surface === "core") {
      const cls = Object.entries(CONFIG.Actor.sheetClasses?.character ?? {}).find(([key]) => key.startsWith("acks."))?.[1]?.cls;
      if (!cls) return { rendered: false, noClass: true };
      app = new cls({ document: hero });
    } else {
      app = new acksExtras.characterSheet.Sheet({ document: hero });
      app.tabGroups.primary = "equipment";
    }
    await app.render({ force: true });
    const find = (root) => (surface === "core"
      ? root.querySelector(`.acks-equipment-container[data-drop-target="${box.id}"] .acks-equipment-container__controls`)
      : root.querySelector(`.acks-extras-frame__gear[data-item-id="${box.id}"] > .acks-extras-frame__gear-head`));
    const bar = await K.poll(() => { const r = K.root(app); return r && find(r) ? find(r) : null; }, { tries: 40, every: 250 });
    if (!bar) {
      await app.close({ force: true });
      return { rendered: false, surface };
    }
    const iconOf = { unlock: "fa-unlock", empty: "fa-box-open", unmake: "fa-times", lock: "fa-lock" };
    const actionOf = { unlock: "containerLock", empty: "containerEmpty" };
    const present = {};
    const pick = (name) => (surface === "core"
      ? [...bar.querySelectorAll("a")].find((a) => a.querySelector("i")?.classList.contains(iconOf[name]))
      : actionOf[name] ? bar.querySelector(`[data-action="${actionOf[name]}"]`) : null);
    for (const name of ["unlock", "empty", "unmake"]) present[name] = !!pick(name);
    const out = { rendered: true, surface, isGM: game.user.isGM, present };
    if (control) {
      const el = pick(control);
      out.pressed = !!el;
      if (el) {
        el.click();
        const done = () => {
          if (control === "unlock") return !C.isLocked(box);
          if (control === "empty") return C.contentsOf(hero, box.id).length === 0;
          return !C.containerOf(box);
        };
        await K.poll(done, { tries: 28, every: 250 });
      }
    }
    const notes = K.takeNotes();
    const fmt = (key) => game.i18n.format(key, { name: box.name, actor: hero.name, action: game.i18n.localize(`ACKS-EQUIPMENT.lock.bypassAction.${control ?? "unlock"}`) });
    out.warned = notes.some((n) => n.kind === "warn" && n.text === fmt("ACKS-EQUIPMENT.lock.bypassWarn"));
    out.blocked = notes.some((n) => n.kind === "warn" && n.text === fmt("ACKS-EQUIPMENT.lock.bypassBlocked"));
    out.otherWarns = notes.filter((n) => n.kind === "warn" && n.text !== fmt("ACKS-EQUIPMENT.lock.bypassWarn") && n.text !== fmt("ACKS-EQUIPMENT.lock.bypassBlocked")).length;
    const rec = C.containerOf(box);
    out.after = { locked: C.isLocked(box), opened: !!rec?.opened, record: !!rec, contents: C.contentsOf(hero, box.id).length };
    await app.close({ force: true });
    return out;
  },

  /** Call `passLock` as a stale control would, on the walk's container, and read the notice. */
  lockPass: async ({ heroId, tag, action }) => {
    const K = globalThis.__cw;
    const L = await import("/modules/acks-extras/scripts/equipment/locks.mjs");
    const hero = game.actors.get(heroId);
    const box = hero.items.find((i) => i.name === "QA Close Chest" && i.flags?.world?.fixtureItem === tag);
    K.takeNotes();
    const result = await L.passLock(hero, box, action);
    const notes = K.takeNotes();
    const text = game.i18n.format("ACKS-EQUIPMENT.lock.bypassBlocked", { name: box.name, actor: hero.name, action: game.i18n.localize(`ACKS-EQUIPMENT.lock.bypassAction.${action}`) });
    return { result, blocked: notes.some((n) => n.kind === "warn" && n.text === text), notes: notes.length };
  },

  /* ------------------------------ source ------------------------------ */

  /** GM seat. Replace the walk's item on the hero with a plain item, or one whose magic is unidentified (`magic`), or one disguised (`mask`). */
  srcShape: async ({ heroId, tag, mode }) => {
    const A = await import("/modules/acks-extras/scripts/equipment/actions.mjs");
    const hero = game.actors.get(heroId);
    const own = hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
    if (own.length) await hero.deleteEmbeddedDocuments("Item", own);
    const [item] = await hero.createEmbeddedDocuments("Item", [{ name: "QA Close Source Item", type: "item", flags: { world: { fixtureItem: tag } } }]);
    if (mode === "magic") await item.setFlag("acks-extras", "markets", { magic: true, identified: "none" });
    if (mode === "mask") await A.disguiseItem(item, { name: "QA Close Mask" });
    return { id: item.id, magic: !!item.getFlag("acks-extras", "markets")?.magic, disguised: A.isDisguised(item) };
  },

  /** Open the item's sheet on this seat once the seat holds the item in the shape given, and read the editor rail. */
  srcView: async ({ heroId, itemId, magic, disguised, owns }) => {
    const K = globalThis.__cw;
    const A = await import("/modules/acks-extras/scripts/equipment/actions.mjs");
    const read = () => {
      const hero = game.actors.get(heroId);
      const item = hero?.items.get(itemId);
      return item ? { item, magic: !!item.getFlag("acks-extras", "markets")?.magic, disguised: A.isDisguised(item), owns: !!item.isOwner } : null;
    };
    for (let i = 0; i < 40; i++) {
      const now = read();
      if (now && now.magic === magic && now.disguised === disguised && now.owns === owns) break;
      await K.sleep(250);
    }
    const now = read();
    if (!now) return { found: false };
    const item = now.item;
    await item.sheet.render({ force: true });
    const root = await K.poll(() => { const r = K.root(item.sheet); return r?.querySelector(".acks-extras-item-sheet__rail") ? r : null; }, { tries: 30, every: 250 });
    if (!root) return { found: true, rendered: false };
    const cells = [...root.querySelectorAll(".acks-extras-item-sheet__rail--editor [data-action]")].map((b) => b.dataset.action);
    const out = {
      found: true,
      rendered: true,
      isGM: game.user.isGM,
      shape: { magic: now.magic, disguised: now.disguised, owns: now.owns },
      extrasSheet: root.classList.contains("acks-extras-item-sheet"),
      rail: !!root.querySelector(".acks-extras-item-sheet__rail--editor"),
      edit: cells.includes("edit"),
      source: cells.includes("source"),
    };
    await item.sheet.close({ force: true });
    return out;
  },

  /* ------------------------------- pay -------------------------------- */

  /**
   * GM seat. Bring the hero and the two places to a payment shape: the hero
   * carries one Gold and one Silver row; the Player owns place A and observes
   * place B; both places hold goods (so the Storage tab shows); and the hero is
   * pinned to B or not.
   */
  payShape: async ({ heroId, aId, bId, pid, tag, pin }) => {
    const S = acksExtras.lib.storage;
    const hero = game.actors.get(heroId);
    const a = game.actors.get(aId);
    const b = game.actors.get(bId);
    const own = hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
    if (own.length) await hero.deleteEmbeddedDocuments("Item", own);
    const flags = { world: { fixtureItem: tag } };
    const made = await hero.createEmbeddedDocuments("Item", [
      { name: "QA Pay Gold", type: "money", img: "icons/svg/coins.svg", flags, system: { coppervalue: 100, quantity: 40 } },
      { name: "QA Pay Silver", type: "money", img: "icons/svg/coins.svg", flags, system: { coppervalue: 10, quantity: 20 } },
    ]);
    const gold = made.find((i) => i.name === "QA Pay Gold");
    const silver = made.find((i) => i.name === "QA Pay Silver");
    await a.update({ [`ownership.${pid}`]: 3 });
    await b.update({ [`ownership.${pid}`]: 2 });
    await S.setProvider(a, true);
    await S.setProvider(b, true);
    await hero.setFlag("acks-extras", "places", pin ? [b.uuid] : []);
    return { goldId: gold.id, silverId: silver.id, aProvider: S.isProvider(a), bProvider: S.isProvider(b), pinned: acksExtras.location.reach.pinnedPlaces(hero).has(b.uuid) };
  },

  /** Player seat: wait up to ten seconds for this client to hold the payment shape. */
  paySeen: async ({ heroId, aId, bId, goldId, pin }) => {
    const K = globalThis.__cw;
    const read = () => {
      const hero = game.actors.get(heroId);
      const a = game.actors.get(aId);
      const b = game.actors.get(bId);
      return {
        heroOwned: !!hero?.isOwner,
        aOwned: !!a?.isOwner,
        bObserved: !!b?.testUserPermission(game.user, "OBSERVER") && !b.isOwner,
        coin: hero?.items.get(goldId)?.system.quantity ?? null,
        pinned: !!hero && acksExtras.location.reach.pinnedPlaces(hero).has(b?.uuid),
        providers: !!a && !!b && acksExtras.lib.storage.isProvider(a) && acksExtras.lib.storage.isProvider(b),
      };
    };
    for (let i = 0; i < 40; i++) {
      const now = read();
      if (now.heroOwned && now.aOwned && now.bObserved && now.coin === 40 && now.pinned === pin && now.providers) break;
      await K.sleep(250);
    }
    return { ...read(), isGM: game.user.isGM };
  },

  /** The hero's coin and the house coin on both places, with the ids of the house rows. */
  payRead: async ({ heroId, aId, bId }) => {
    const hero = game.actors.get(heroId);
    const house = acksExtras.lib.money.HOUSE_OWNER;
    const sum = (actor, name) => actor.items.filter((i) => i.type === "money" && i.name === name && i.flags?.["acks-extras"]?.storage?.ownerUuid === house).reduce((n, i) => n + (i.system.quantity ?? 0), 0);
    const rows = (actor) => actor.items.filter((i) => i.type === "money" && i.flags?.["acks-extras"]?.storage?.ownerUuid === house).map((i) => i.id);
    const a = game.actors.get(aId);
    const b = game.actors.get(bId);
    return {
      gold: hero.items.filter((i) => i.name === "QA Pay Gold").reduce((n, i) => n + (i.system.quantity ?? 0), 0),
      silver: hero.items.filter((i) => i.name === "QA Pay Silver").reduce((n, i) => n + (i.system.quantity ?? 0), 0),
      aGold: sum(a, "QA Pay Gold"),
      aSilver: sum(a, "QA Pay Silver"),
      bGold: sum(b, "QA Pay Gold"),
      aRows: rows(a),
      bRows: rows(b),
    };
  },

  /**
   * Open a place's Storage tab on this seat, press Pay the house, choose the
   * hero and the coins in the dialog by its own form, read what the dialog
   * shows, and (with `press`) press Pay. The dialog is closed unanswered when
   * Pay is off or `press` is false.
   */
  payDrive: async ({ placeId, heroId, goldId, goldCount, silverId, silverCount, press }) => {
    const K = globalThis.__cw;
    await K.closeDialogs();
    K.takeNotes();
    const place = game.actors.get(placeId);
    const hero = game.actors.get(heroId);
    const sheet = place.sheet;
    await sheet.render({ force: true });
    await K.poll(() => sheet.rendered, { tries: 40, every: 100 });
    sheet.changeTab("storage", "primary", { force: true });
    await K.sleep(500);
    const button = sheet.element.querySelector('[data-action="payHouse"]');
    const out = { button: !!button, buttonOff: button ? !!button.disabled : null, isGM: game.user.isGM };
    if (!button) {
      await sheet.close({ force: true });
      return out;
    }
    button.click();
    const dlg = await K.poll(() => [...document.querySelectorAll("dialog[open], .application.dialog-v2")].filter((el) => el.querySelector("[data-pay-total]")).at(-1) ?? null, { tries: 40, every: 150 });
    out.dialog = !!dlg;
    if (!dlg) {
      await sheet.close({ force: true });
      return out;
    }
    const form = dlg.querySelector("form");
    const source = form?.elements.source;
    out.chooser = !!source;
    if (source) {
      source.value = heroId;
      source.dispatchEvent(new Event("change", { bubbles: true }));
      await K.sleep(400);
    }
    const tick = async (id, count) => {
      const box = form.elements[`pick_${id}`];
      const qty = form.elements[`qty_${id}`];
      if (!box || !qty) return false;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      qty.value = String(count);
      qty.dispatchEvent(new Event("input", { bubbles: true }));
      await K.sleep(250);
      return true;
    };
    out.goldRow = goldCount ? await tick(goldId, goldCount) : null;
    out.silverRow = silverCount ? await tick(silverId, silverCount) : null;
    const total = dlg.querySelector("[data-pay-total]");
    const reach = dlg.querySelector("[data-pay-reach]");
    const ok = dlg.querySelector('button[data-action="ok"]');
    out.total = total?.textContent.trim() ?? null;
    out.totalTip = total?.dataset.tooltipText ?? null;
    out.reachShown = !!reach && !reach.hidden;
    out.reachText = reach?.textContent.trim() ?? "";
    out.reachIsNotYours = out.reachText === game.i18n.format("ACKS-LIB.money.reach.notYours", { who: hero.name, place: place.name, scene: "", from: hero.name, to: place.name });
    out.payOff = ok ? !!ok.disabled : null;
    if (press && ok && !ok.disabled) {
      ok.click();
      out.pressed = true;
      await K.sleep(2500);
    } else {
      await K.closeDialogs();
    }
    const notes = K.takeNotes();
    const head = game.i18n.localize("ACKS-LIB.money.judgeOverride").split("{")[0];
    out.judgeNote = notes.some((n) => n.kind === "info" && head && n.text.startsWith(head));
    out.warns = notes.filter((n) => n.kind === "warn").length;
    await sheet.close({ force: true });
    return out;
  },

  /** Open a place's Storage tab and read its coin figures: the figure's own tooltip and whether it names the Gold row. */
  payFigure: async ({ placeId }) => {
    const K = globalThis.__cw;
    const place = game.actors.get(placeId);
    const sheet = place.sheet;
    await sheet.render({ force: true });
    await K.poll(() => sheet.rendered, { tries: 40, every: 100 });
    sheet.changeTab("storage", "primary", { force: true });
    await K.sleep(500);
    const figures = [...sheet.element.querySelectorAll(".acks-location-coin")].map((el) => ({ tip: el.dataset.tooltipText ?? "", text: el.textContent.trim() }));
    const out = { figures: figures.length, namesGold: figures.some((f) => f.tip.includes("QA Pay Gold")), countsGold: figures.some((f) => /QA Pay Gold ×\d+/.test(f.tip)) };
    await sheet.close({ force: true });
    return out;
  },

  /** GM seat: pin or unpin the hero's place B, as the sheet's pin does. */
  unpin: async ({ heroId }) => {
    await game.actors.get(heroId).setFlag("acks-extras", "places", []);
    return true;
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
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.henchmen?.openRosterApp && !!globalThis.acksExtras?.classes?.legacy?.open && !!globalThis.acksExtras?.characterSheet?.Sheet`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Read with `fn` until `pred` holds, up to `tries` reads; returns the last read. */
async function waitFor(fn, pred, tries = 40, every = 300) {
  let last = await fn();
  for (let i = 0; i < tries && !pred(last); i++) {
    await sleep(every);
    last = await fn();
  }
  return last;
}

let gm = null;
let player = null;
let autoRollBefore;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 540_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const track = async (uuid, kind) => {
  if (!uuid || made.includes(uuid)) return;
  made.push(uuid);
  await gm.track(uuid, kind);
};
/** Track every chat card the GM seat has received that speaks as one of `actorIds`. */
const trackCards = async (actorIds) => {
  const got = await run(gm, P.cards, { actorIds });
  for (const uuid of got.uuids) await track(uuid, "ChatMessage");
  return got;
};
/** Run a group of steps; a throw is one FAIL and the walk goes on to the next group. */
const group = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`GROUP ERROR (${name}):`, err?.stack ?? err?.message ?? err);
    check(`${name}: the group ran to its end`, false, String(err?.message ?? err).slice(0, 200));
  }
};

/* ------------------------------------------------------------------ */
/*  Groups                                                              */
/* ------------------------------------------------------------------ */

/** T-0855: a transfer moves the hireling's ownership, there and back. */
async function groupTransfer(ctx) {
  const { ids, pid, otherId } = ctx;
  const all = [ids.from, ids.to, ids.hire, ids.dis];
  const hireId = ids.hire;
  const rd = (api) => run(api, P.hRead, { ids, hireId, pid, otherId });

  section("T-0855: a Roster transfer carries the hireling's ownership");
  const s = await run(gm, P.hShape, { ids, pid, otherId, serve: ["hire"] });
  check("shape: the hireling serves the Player's employer and the Player owns it; the target employer is out of service", s.fromIdle && s.toIdle && s.hire.serves && s.hire.playerKey && s.hire.defaultLevel === 0, s);
  note("a second user to own the target employer", otherId ? "found" : "none");
  if (otherId) check("shape: the second user holds no key on the hireling yet", s.hire.otherKey === false, s.hire);
  const seen = await run(player, P.hSeen, { ids, hireId, owns: true, manager: "from" });
  check("the Player seat owns the hireling and its employer, not the target, and sees the hireling in service under the employer", !seen.isGM && seen.isOwner && seen.fromOwned && !seen.toOwned && seen.manager === "from", seen);

  const before = await run(player, P.hPress, { employerId: ids.from, hireId });
  check("the Player's Roster draws the hireling's row with its controls before the transfer", before.opened && before.row && before.controls.includes("transfer") && before.controls.includes("dismiss"), before.controls);
  await run(player, P.hClose);

  const forth = await run(gm, P.hPress, { employerId: ids.from, hireId, action: "transfer", pick: ids.to });
  check("the Judge's Roster Transfer lists the target employer and not the hireling itself, and the dialog was answered", forth.pressed && forth.dialog && forth.options.includes(ids.to) && !forth.options.includes(hireId) && forth.answered, { options: forth.options.length, hasTarget: forth.options.includes(ids.to), hasSelf: forth.options.includes(hireId), answered: forth.answered });
  const moved = await waitFor(() => rd(gm), (r) => r.employer === "to" && r.playerLevel === null && (!otherId || r.otherLevel === 3), 40, 400);
  check("the move lands: the record names the target and only the target lists the hireling", moved.employer === "to" && moved.manager === "to" && moved.listedBy.join(",") === "to", moved);
  check("the new employer's grant is written: the second user holds Owner on the hireling", otherId ? moved.otherLevel === 3 : true, otherId ? { otherLevel: moved.otherLevel } : "unreachable: no second user in the world");
  check("the user the old hire made Owner is removed: the Player's key is gone from the hireling's ownership, and the default level is untouched", moved.playerLevel === null && moved.defaultLevel === 0, { playerLevel: moved.playerLevel, defaultLevel: moved.defaultLevel });
  const lost = await run(player, P.hSeen, { ids, hireId, owns: false, manager: "to" });
  check("on the Player seat the hireling is no longer owned", !lost.isGM && lost.isOwner === false, lost);
  const after = await run(player, P.hPress, { employerId: ids.to, hireId });
  note("the Player's view of the target's Roster", { opened: after.opened, row: after.row });
  if (after.opened && after.row) check("the Player's Roster row for the hireling now draws none of Transfer, Dismiss, Calamity or Penalty (the sheet-opening control is open to every seat)", !after.controls.some((c) => ["transfer", "dismiss", "calamity", "penalty"].includes(c)), after.controls);
  await run(player, P.hClose);
  await trackCards(all);

  const back = await run(gm, P.hPress, { employerId: ids.to, hireId, action: "transfer", pick: ids.from });
  check("the Judge's Roster Transfer back lists the Player's employer", back.pressed && back.dialog && back.options.includes(ids.from) && back.answered, { hasTarget: back.options.includes(ids.from), answered: back.answered });
  const home = await waitFor(() => rd(gm), (r) => r.employer === "from" && r.playerLevel === 3 && (!otherId || r.otherLevel === null), 40, 400);
  check("back under the Player's employer the Player's grant is written (Owner) and the second user's key is removed", home.employer === "from" && home.playerLevel === 3 && (!otherId || home.otherLevel === null) && home.defaultLevel === 0, home);
  const regained = await run(player, P.hSeen, { ids, hireId, owns: true, manager: "from" });
  check("on the Player seat the hireling is owned again", !regained.isGM && regained.isOwner, regained);
  await run(gm, P.hClose);
  await trackCards(all);
}

/** T-0856: a dismissed character is free on the roster and in the posting and recruit choices. */
async function groupDismissed(ctx) {
  const { ids, pid, otherId } = ctx;
  const all = [ids.from, ids.to, ids.hire, ids.dis];
  section("T-0856: a dismissed character is free");
  const s = await run(gm, P.hShape, { ids, pid, otherId, serve: ["hire", "dis"] });
  check("shape: both characters serve the Player's employer", s.hire.serves && s.dis.serves, s);
  const d = await run(gm, P.hPress, { employerId: ids.from, hireId: ids.dis, action: "dismiss" });
  check("the Roster's Dismiss is pressed and confirmed", d.pressed && d.dialog && d.answered, { pressed: d.pressed, answered: d.answered });
  const gone = await run(gm, P.hDismissed, { ids, disId: ids.dis });
  check("the dismissed character is off the employer's list, its manager cleared and its retainer switch still on (core's leftover state)", gone.managerCleared && !gone.onFromList && gone.enabled, gone);
  await run(gm, P.hClose);
  const seen = await waitFor(() => run(player, P.hSeen, { ids, hireId: ids.dis, owns: true, manager: "none" }), (r) => r.isOwner && r.manager === "none", 30, 300);
  check("the Player seat holds the dismissed character as its own, with no manager", !seen.isGM && seen.isOwner && seen.manager === "none", seen);

  for (const [label, api] of [["Judge", gm], ["Player", player]]) {
    const t = await run(api, P.hPress, { employerId: ids.from, hireId: ids.hire, action: "transfer" });
    check(`${label}: the Roster's Transfer list offers the dismissed character, and not the hireling that stays`, t.pressed && t.dialog && t.options.includes(ids.dis) && !t.options.includes(ids.hire), { options: t.options.length, hasDismissed: t.options.includes(ids.dis), hasHire: t.options.includes(ids.hire) });
    const p = await run(api, P.hPosting, { placeId: ids.place });
    check(`${label}: the Post a search window offers the dismissed character as an employer, and not the hireling in service`, p.rendered && p.select && p.options.includes(ids.dis) && !p.options.includes(ids.hire), { rendered: p.rendered, select: p.select, options: p.options?.length, hasDismissed: p.options?.includes(ids.dis), hasHire: p.options?.includes(ids.hire), error: p.error });
    const r = await run(api, P.hRecruit);
    if (r.skipped) note(`${label}: the recruit employer chooser`, "unreachable on this seat: its user has an assigned character, which the chooser returns before listing anyone");
    else check(`${label}: the recruit employer chooser (pickEmployer) lists the dismissed character, and not the hireling in service`, r.dialog && r.options.includes(ids.dis) && !r.options.includes(ids.hire), { dialog: r.dialog, options: r.options?.length, hasDismissed: r.options?.includes(ids.dis), hasHire: r.options?.includes(ids.hire), direct: r.direct });
  }
  await trackCards(all);
}

/** T-0861: the legacy ledger's hint under its record button. */
async function groupLegacy(ctx) {
  const { ids } = ctx;
  section("T-0861: the legacy ledger's record hint");
  const p = await run(player, P.legacyView, { actorId: ids.legacy });
  check("the Player's ledger draws exactly one record button, and the hint under it is the lang string and reads singular", p.opened && p.buttons === 1 && p.hintFound && p.hintIsLang && p.singular, p);
  const j = await run(gm, P.legacyView, { actorId: ids.legacy });
  check("the Judge's ledger draws its record controls and the same singular hint", j.opened && j.buttons >= 1 && j.hintFound && j.hintIsLang && j.singular, j);
}

/** T-0820: Unlock, Empty and Unmake follow the key. */
async function groupLocks(ctx) {
  const { ids } = ctx;
  const heroId = ids.lockHero;
  const TAG = "equipment/close-lock";
  const shape = async (keyed) => {
    const s = await run(gm, P.lockShape, { heroId, tag: TAG, keyed, locked: true });
    const seen = await waitFor(() => run(player, P.lockRead, { heroId, tag: TAG }), (r) => r.found && r.locked === true && r.keyed === keyed && r.contents === 1 && r.owns, 40, 300);
    return { s, seen, ok: s.isContainer && s.locked && s.keyed === keyed && s.contents === 1 && seen.found && seen.locked && seen.keyed === keyed && seen.contents === 1 && seen.owns && !seen.isGM };
  };

  section("T-0820: the owner carrying the key");
  let sh = await shape(true);
  check("shape: a locked container holding one stone, its key carried, on a character the Player owns", sh.ok, sh);
  let r = await run(player, P.lockPress, { heroId, tag: TAG, surface: "extras" });
  check("the Player's character sheet draws Unlock and Empty on the locked container", r.rendered && r.present.unlock && r.present.empty, r.present);
  r = await run(player, P.lockPress, { heroId, tag: TAG, surface: "extras", control: "unlock" });
  check("Unlock on the character sheet: the lock is opened, with no refusal and no warning", r.pressed && r.after.locked === false && r.after.opened && !r.blocked && !r.warned && r.otherWarns === 0, { pressed: r.pressed, after: r.after, blocked: r.blocked, warned: r.warned });
  sh = await shape(true);
  check("shape again: locked, key carried", sh.ok, sh.seen);
  r = await run(player, P.lockPress, { heroId, tag: TAG, surface: "extras", control: "empty" });
  check("Empty on the character sheet: the stone leaves the container, with no refusal and no warning", r.pressed && r.after.contents === 0 && !r.blocked && !r.warned && r.otherWarns === 0, { pressed: r.pressed, after: r.after, blocked: r.blocked, warned: r.warned });
  sh = await shape(true);
  check("shape again: locked, key carried", sh.ok, sh.seen);
  r = await run(player, P.lockPress, { heroId, tag: TAG, surface: "core" });
  check("the system's character sheet (where the module regroups Equipment) draws Unlock, Empty and Unmake on the locked container", r.rendered && r.present.unlock && r.present.empty && r.present.unmake, r.rendered ? r.present : r);
  r = await run(player, P.lockPress, { heroId, tag: TAG, surface: "core", control: "unmake" });
  check("Unmake on the system's sheet: the container record is gone, no refusal, no warning", r.pressed && r.after.record === false && !r.blocked && !r.warned && r.otherWarns === 0, { pressed: r.pressed, after: r.after, blocked: r.blocked, warned: r.warned });

  section("T-0820: a keyless Player is refused");
  sh = await shape(false);
  check("shape: a locked container holding one stone, no key carried", sh.ok, sh);
  for (const surface of ["extras", "core"]) {
    r = await run(player, P.lockPress, { heroId, tag: TAG, surface });
    check(`the ${surface === "core" ? "system's" : "module's"} sheet offers a keyless Player no Unlock, Empty or Unmake`, r.rendered && !r.present.unlock && !r.present.empty && !r.present.unmake, r.rendered ? r.present : r);
  }
  r = await run(player, P.lockPass, { heroId, tag: TAG, action: "unlock" });
  const kept = await run(player, P.lockRead, { heroId, tag: TAG });
  check("passLock (what a stale Unlock control calls; the control itself cannot be pressed once the sheet redraws) answers false with the 'cannot' notice, and the lock stays", r.result === false && r.blocked && kept.locked && kept.contents === 1, { passLock: r.result, blocked: r.blocked, locked: kept.locked, contents: kept.contents });

  section("T-0820: a keyless Judge goes ahead, warned");
  sh = await shape(false);
  check("shape: locked, no key carried", sh.ok, sh.seen);
  r = await run(gm, P.lockPress, { heroId, tag: TAG, surface: "extras" });
  check("the Judge's character sheet draws Unlock and Empty on the locked container with no key", r.rendered && r.isGM && r.present.unlock && r.present.empty, r.present);
  r = await run(gm, P.lockPress, { heroId, tag: TAG, surface: "extras", control: "unlock" });
  check("Unlock by the Judge: the lock is opened and the warning notice is raised", r.pressed && r.after.locked === false && r.warned && !r.blocked, { pressed: r.pressed, after: r.after, warned: r.warned });
  sh = await shape(false);
  r = await run(gm, P.lockPress, { heroId, tag: TAG, surface: "extras", control: "empty" });
  check("Empty by the Judge: the stone leaves the container and the warning notice is raised", sh.ok && r.pressed && r.after.contents === 0 && r.warned && !r.blocked, { pressed: r.pressed, after: r.after, warned: r.warned });
  sh = await shape(false);
  r = await run(gm, P.lockPress, { heroId, tag: TAG, surface: "core", control: "unmake" });
  check("Unmake by the Judge on the system's sheet: the container record is gone and the warning notice is raised", sh.ok && r.pressed && r.after.record === false && r.warned && !r.blocked, { pressed: r.pressed, after: r.after, warned: r.warned });
}

/** T-0859: the item sheet's Source cell. */
async function groupSource(ctx) {
  const { ids } = ctx;
  const TAG = "equipment/close-src";
  const shape = (heroId, mode) => run(gm, P.srcShape, { heroId, tag: TAG, mode });
  const view = (api, heroId, item, expect) => run(api, P.srcView, { heroId, itemId: item.id, ...expect });

  section("T-0859: the item sheet's Source cell follows ownership");
  let item = await shape(ids.srcHero, "plain");
  let v = await view(player, ids.srcHero, item, { magic: false, disguised: false, owns: true });
  check("a plain item the Player owns: the item sheet is the module's and draws the editor rail with the Source cell", v.found && v.rendered && v.extrasSheet && v.rail && v.edit && v.source && !v.isGM, v);
  item = await shape(ids.srcHero, "magic");
  check("shape: the item's magic is unidentified", item.magic && !item.disguised, item);
  v = await view(player, ids.srcHero, item, { magic: true, disguised: false, owns: true });
  check("an unidentified magic item the Player owns: the rail is drawn and the Source cell is not", v.found && v.rendered && v.rail && v.edit && !v.source, v);
  let j = await view(gm, ids.srcHero, item, { magic: true, disguised: false, owns: true });
  check("the Judge seat, same item: the Source cell is drawn", j.rendered && j.isGM && j.source, j);
  item = await shape(ids.srcHero, "mask");
  check("shape: the item is disguised", item.disguised && !item.magic, item);
  v = await view(player, ids.srcHero, item, { magic: false, disguised: true, owns: true });
  check("a disguised item the Player owns: the rail is drawn and the Source cell is not", v.found && v.rendered && v.rail && v.edit && !v.source, v);
  j = await view(gm, ids.srcHero, item, { magic: false, disguised: true, owns: true });
  check("the Judge seat, same item: the Source cell is drawn", j.rendered && j.isGM && j.source, j);
  item = await shape(ids.srcObs, "plain");
  v = await view(player, ids.srcObs, item, { magic: false, disguised: false, owns: false });
  check("a plain item on a character the Player only observes: no editor rail and no Source cell", v.found && v.rendered && !v.rail && !v.source, v);
}

/** Pay the house: coin leaves the payer and lands on the place. */
async function groupPay(ctx) {
  const { ids, pid } = ctx;
  const heroId = ids.payHero;
  const TAG = "location/close-pay";
  const fx = [ids.payHero, ids.payA, ids.payB];
  let shaped = null;
  const shape = async (pin) => {
    shaped = await run(gm, P.payShape, { heroId, aId: ids.payA, bId: ids.payB, pid, tag: TAG, pin });
    const seen = await run(player, P.paySeen, { heroId, aId: ids.payA, bId: ids.payB, goldId: shaped.goldId, pin });
    return { shaped, seen, ok: shaped.aProvider && shaped.bProvider && shaped.pinned === pin && seen.heroOwned && seen.aOwned && seen.bObserved && seen.coin === 40 && seen.pinned === pin && seen.providers && !seen.isGM };
  };
  const read = () => run(gm, P.payRead, { heroId, aId: ids.payA, bId: ids.payB });
  const trackHouse = async () => {
    const r = await read();
    for (const id of r.aRows) await track(`Actor.${ids.payA}.Item.${id}`, "Item");
    for (const id of r.bRows) await track(`Actor.${ids.payB}.Item.${id}`, "Item");
  };
  const drive = (api, placeId, gold, silver, press = true) => run(api, P.payDrive, { placeId, heroId, goldId: shaped.goldId, goldCount: gold, silverId: shaped.silverId, silverCount: silver, press });
  const receipts = async () => (await trackCards(fx)).receipts;

  section("Pay the house: the Judge, a place in reach");
  let sh = await shape(false);
  check("shape: the Player owns the payer and place A and observes place B; the hero carries Gold and Silver; the hero is not pinned to B", sh.ok, { shaped: sh.shaped.pinned, seen: sh.seen });
  let before = await read();
  const receiptsBefore = (await receipts()).length;
  let d = await drive(gm, ids.payA, 3, 0);
  check("the Judge's Storage tab on A draws Pay the house, and its dialog offers the character chooser and a live total with no reach line", d.button && d.dialog && d.chooser && d.goldRow && /\b3\b/.test(d.total ?? "") && !d.reachShown && d.payOff === false, { button: d.button, chooser: d.chooser, total: d.total, reachShown: d.reachShown, payOff: d.payOff });
  check("the total's tooltip names the coin and the count", (d.totalTip ?? "").includes(GOLD) && /×3/.test(d.totalTip ?? ""), { tip: d.totalTip });
  let after = await waitFor(read, (r) => r.gold === before.gold - 3, 24, 400);
  check("coin leaves the payer and lands on the place: Gold -3 on the hero, +3 on A's house, Silver untouched", after.gold === before.gold - 3 && after.aGold === before.aGold + 3 && after.silver === before.silver && after.aSilver === before.aSilver, { gold: after.gold - before.gold, aGold: after.aGold - before.aGold, silver: after.silver - before.silver });
  await trackHouse();
  let rc = await receipts();
  check("one whispered line is posted, to the Judges and the payer's owners", rc.length === receiptsBefore + 1 && rc.at(-1).toGM && rc.at(-1).whisperCount >= 2, { added: rc.length - receiptsBefore, last: rc.at(-1) });
  const figure = await run(gm, P.payFigure, { placeId: ids.payA });
  check("A's Storage tab shows the House figure with a tooltip naming its coin and count", figure.figures >= 1 && figure.namesGold && figure.countsGold, figure);

  section("Pay the house: the payer's owner on the Player seat, a place the seat owns");
  sh = await shape(false);
  check("shape again: Gold 40 and Silver 20, A owned, B observed, unpinned", sh.ok, sh.seen);
  before = await read();
  const receiptsB2 = (await receipts()).length;
  d = await drive(player, ids.payA, 3, 5);
  check("the Player's Storage tab on A draws Pay the house; the dialog's chooser is set to the hero, both coins ticked, no reach line, Pay live", d.button && !d.buttonOff && d.dialog && d.goldRow && d.silverRow && !d.reachShown && d.payOff === false && !d.isGM, { button: d.button, buttonOff: d.buttonOff, chooser: d.chooser, reachShown: d.reachShown, payOff: d.payOff, total: d.total });
  after = await waitFor(read, (r) => r.gold === before.gold - 3, 24, 400);
  check("coin leaves the payer and lands on the place: Gold -3 and Silver -5 on the hero, the same on A's house", after.gold === before.gold - 3 && after.silver === before.silver - 5 && after.aGold === before.aGold + 3 && after.aSilver === before.aSilver + 5, { gold: after.gold - before.gold, silver: after.silver - before.silver, aGold: after.aGold - before.aGold, aSilver: after.aSilver - before.aSilver });
  await trackHouse();
  rc = await receipts();
  check("one whispered line is posted for the Player's payment", rc.length === receiptsB2 + 1 && rc.at(-1).toGM, { added: rc.length - receiptsB2 });

  section("Pay the house: a place the Player observes, the hero out of reach");
  sh = await shape(false);
  check("shape again: B observed, the hero not pinned to B", sh.ok, sh.seen);
  before = await read();
  d = await drive(player, ids.payB, 3, 0);
  check("the dialog shows the reach reason and Pay is off", d.button && d.dialog && d.reachShown && d.reachText.length > 0 && !/^ACKS-/.test(d.reachText) && d.payOff === true && !d.pressed, { reachShown: d.reachShown, payOff: d.payOff, reachIsNotYours: d.reachIsNotYours, pressed: d.pressed });
  after = await read();
  check("nothing is written: the hero's coin and B's house are as they were", after.gold === before.gold && after.bGold === before.bGold, { gold: after.gold - before.gold, bGold: after.bGold - before.bGold });

  section("Pay the house: a place the Player observes, the hero pinned there (the payment is relayed to the Judge)");
  sh = await shape(true);
  check("shape again: B observed, the hero pinned to B", sh.ok, sh.seen);
  before = await read();
  const receiptsB4 = (await receipts()).length;
  d = await drive(player, ids.payB, 3, 0);
  check("the reach line is gone and Pay is live", d.button && d.dialog && !d.reachShown && d.payOff === false && d.pressed, { reachShown: d.reachShown, payOff: d.payOff, pressed: d.pressed });
  after = await waitFor(read, (r) => r.gold === before.gold - 3, 30, 400);
  check("coin leaves the payer and lands on B, a place the seat does not own: Gold -3 on the hero, +3 on B's house", after.gold === before.gold - 3 && after.bGold === before.bGold + 3, { gold: after.gold - before.gold, bGold: after.bGold - before.bGold });
  await trackHouse();
  rc = await receipts();
  check("one whispered line is posted for the relayed payment, once", rc.length === receiptsB4 + 1, { added: rc.length - receiptsB4 });

  section("Pay the house: the Judge, an out-of-reach payer");
  sh = await shape(false);
  check("shape again: B observed, the hero not pinned to B", sh.ok, sh.seen);
  before = await read();
  d = await drive(gm, ids.payB, 3, 0);
  check("the reason shows in the dialog as the Judge's warning with Pay still live", d.button && d.dialog && d.reachShown && d.payOff === false && d.pressed, { reachShown: d.reachShown, payOff: d.payOff, pressed: d.pressed });
  after = await waitFor(read, (r) => r.gold === before.gold - 3, 24, 400);
  check("the payment goes through: Gold -3 on the hero, +3 on B's house, and the override notice is raised", after.gold === before.gold - 3 && after.bGold === before.bGold + 3 && d.judgeNote, { gold: after.gold - before.gold, bGold: after.bGold - before.bGold, judgeNote: d.judgeNote });
  await trackHouse();
  await receipts();
  await run(gm, P.unpin, { heroId });
}

/* ------------------------------------------------------------------ */
/*  The walk                                                            */
/* ------------------------------------------------------------------ */

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const gk = await run(gm, P.kit);
  const gc = await run(gm, P.census);
  note("census: active users [name, isGM]", gc.active);
  note("census: active GM", gc.activeGM);
  note("census: module version", gc.module);
  const other = gc.active.filter(([name, isGM]) => isGM && name !== MACHINE.gm);
  if (other.length) note("census: a Judge other than this lane's own is seated", other.map(([name]) => name));
  check("the GM seat is a GM", gk.isGM && gc.isGM && gc.role >= 3, { role: gc.role });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const pk = await run(player, P.kit);
  const pc = await run(player, P.census);
  check("the Player seat is not a GM", !pk.isGM && !pc.isGM && pc.role < 3, { role: pc.role });
  const pid = pc.userId;
  const otherUser = await run(gm, P.otherUser, { pid });
  const otherId = otherUser?.id ?? null;
  note("a second user in the world", otherUser ? { found: true, isGM: otherUser.isGM } : { found: false });
  autoRollBefore = (await run(gm, P.autoRoll, { value: true })).before;
  note("autoRollCalamity (held on, restored at the end), the world's value", autoRollBefore);

  section("fixtures");
  const own = { default: LEVEL.NONE, [pid]: LEVEL.OWNER };
  const character = (name, ownership = own) => ({ name, type: "character", prototypeToken: { actorLink: true }, ownership });
  const docs = {
    from: await gm.fixture(FX.from, "Actor", character("QA Close From")),
    to: await gm.fixture(FX.to, "Actor", character("QA Close To", { default: LEVEL.NONE })),
    hire: await gm.fixture(FX.hire, "Actor", character("QA Close Hireling")),
    dis: await gm.fixture(FX.dis, "Actor", character("QA Close Dismissed")),
    place: await gm.fixture(FX.place, "Actor", { name: "QA Close Place", type: LOCATION, ownership: own }),
    legacy: await gm.fixture(FX.legacy, "Actor", character("QA Close Legacy")),
    lockHero: await gm.fixture(FX.lockHero, "Actor", character("QA Close Lock Hero")),
    srcHero: await gm.fixture(FX.srcHero, "Actor", character("QA Close Source Hero")),
    srcObs: await gm.fixture(FX.srcObs, "Actor", character("QA Close Source Observed", { default: LEVEL.NONE, [pid]: LEVEL.OBSERVER })),
    payHero: await gm.fixture(FX.payHero, "Actor", character("QA Close Pay Hero")),
    payA: await gm.fixture(FX.payA, "Actor", { name: "QA Close Pay A", type: LOCATION, ownership: own }),
    payB: await gm.fixture(FX.payB, "Actor", { name: "QA Close Pay B", type: LOCATION, ownership: { default: LEVEL.NONE, [pid]: LEVEL.OBSERVER } }),
  };
  note("fixtures built this run", Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.built])));
  const ids = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.id]));
  const ctx = { ids, pid, otherId };

  await group("T-0855", () => groupTransfer(ctx));
  await group("T-0856", () => groupDismissed(ctx));
  await group("T-0861", () => groupLegacy(ctx));
  await group("T-0820", () => groupLocks(ctx));
  await group("T-0859", () => groupSource(ctx));
  await group("Pay the house", () => groupPay(ctx));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { if (autoRollBefore !== undefined) note("autoRollCalamity restored", await run(gm, P.autoRoll, { value: autoRollBefore })); } catch (err) { console.error("restore:", err?.message ?? err); }
    try { note("cards and house rows tracked", made.length); } catch {}
    try { if (made.length) note("sweep", await gm.sweepTracked({ only: made })); } catch (err) { console.error("sweep failed:", err?.message ?? err); }
  }
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    if (!api) continue;
    try { await run(api, P.hClose); } catch {}
    try { await run(api, P.unkit); } catch {}
    try { await api.close(); } catch (err) { console.error(`${key} close:`, err?.message ?? err); }
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
