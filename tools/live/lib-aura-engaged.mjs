/**
 * Live walk, lib/aura-engaged: the engaged reach (T10), on the GM seat and a real
 * Player seat together. Walks docs/lib/TESTING.md, "The aura reach and the item
 * carrier", the recipe "T10: the engaged reach", steps 1 to 11. Machine values
 * arrive through ./_env.mjs. Both seats reload under a load recorder added before
 * the page's first script, so what `init`, `setup` and `ready` log is read on each.
 *
 * The bearers are creatures the generator makes from an imported template: the
 * walk finds a library template that has a `trait` axis, pins each trait option
 * in turn (`generateFromTemplate`) and keeps the first body whose ability item
 * holds a row with `reach.engaged === true` and no activation. Nothing here names
 * a kind, an item, a trait or a book; every figure the row names (the save, the
 * immunity, the timed interval) is read live from the registry through the
 * carrier's own `reachFigures`, so a blank one is a branch the walk takes (a
 * Player's press refused as `noFigure`, no `dueAt` to compare) and never a
 * number it supplies. A world with no such template prints WALK BLOCKED: the
 * book is not imported, which is outside the code under test. The
 * one figure the walk invents is the subject's stored save target.
 *
 * Fixtures, kept and found by marker (`api.fixture`, `api.mark`):
 *   scene `lib/aura-t10-scene` (square, the engagement square's feet a cell);
 *   bearers `lib/aura-t10-unit` (the generated body; the Player seat owns it) and
 *   `lib/aura-t10-unit-2` (a plain copy of it, owned by nobody but the Judge);
 *   the subject `lib/aura-t10-subject` (a creature body, since a monster's stored save target is the one the carrier reads back; the Player seat owns it), the
 *   body of an admitted kind `lib/aura-t10-man` and the body of the bearers' own
 *   side `lib/aura-t10-ally`; each actor's linked token `<actor marker>-token`.
 * Each step writes the shape it needs at its start: the effects the carrier wrote
 * cleared from every fixture actor, the tokens placed and shown at one cell, hit
 * points full, the Player seat's ownership (OWNER on the first bearer and the
 * subject, nothing else, read back in the Player's own page), the kinds the
 * filter names put on the subject, the man and the ally, and the stored save
 * target. The ownership the walk gives the Player in step 5 is not rolled back at
 * its end; the next step's start writes the shape again.
 *
 * The run's own products are tracked and swept by id: its combats, the engaged
 * cards and whispers its GM window posted (caught by a wrapper on the message
 * class), the second-kind item and Region step 4 makes, the plain effect step 8
 * puts on the subject, any bodies the generator made that carried no engaged row,
 * and any Region left on the fixture scene. The fixtures stay.
 *
 * Begin Combat is a round written to the combat, the update the tracker writes;
 * the button's own prompt is `lib-combat-start`'s. Steps that need what this walk
 * cannot build print `SKIP <step>: <reason>`; a SKIP is not a check and is
 * counted apart. `SHOTS=1` also takes the two plates of step 11.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = SHOTS ? shotDir() : null;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const skipped = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const skip = (step, reason) => {
  skipped.push(step);
  console.log(`SKIP ${step}: ${reason}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The module whose flags the fixtures carry. */
const MOD = "acks-extras";
/** A subject's stored save target: invented, low enough that a natural 20 passes and a natural 1 fails whatever a body's modifiers. */
const SAVE_TARGET = 10;
/** The most bodies the generator is asked for while the walk looks for one holding an engaged row. */
const MAX_ATTEMPTS = 40;
/** The median of a moved body's update that is a finding for the architect, in ms (the recipe's figure for step 10c). */
const MOVE_FINDING_MS = 250;

/** Every role the walk places: the actor's marker, the Player seat's ownership, the side its token stands on and its type. */
const ROLES = Object.freeze({
  U1: { marker: "lib/aura-t10-unit", type: "monster", disposition: -1, owned: true },
  U2: { marker: "lib/aura-t10-unit-2", type: "monster", disposition: -1, owned: false },
  S: { marker: "lib/aura-t10-subject", type: "monster", disposition: 1, owned: true, plain: "T10 Subject" },
  M: { marker: "lib/aura-t10-man", type: "monster", disposition: 1, owned: false, plain: "T10 Man" },
  A: { marker: "lib/aura-t10-ally", type: "monster", disposition: -1, owned: false, plain: "T10 Ally" },
});
const ROLE_KEYS = Object.keys(ROLES);
/** Where an idle token waits: three squares clear of every other, so no ring meets it. */
const HOME = Object.freeze({ U1: [300, 200], U2: [300, 600], S: [1500, 1100], M: [1500, 800], A: [1500, 500] });
/** Everyone beside the bearers: the subject touches both, the man touches the second bearer alone, the ally the first. */
const ADJ = Object.freeze({ U1: [700, 700], S: [800, 700], U2: [900, 700], M: [1000, 700], A: [700, 800] });

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__auraBoot = { phase: "load", phases: [], errors: [] });
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

async function ready(api, seconds = 150) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Reload one seat's page under the load recorder, which a second DevTools session adds to every new document. */
async function reloadRecorded(api, port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next;
    const on = (event) => { const reply = JSON.parse(event.data); if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api);
  ws.close();
  return seconds;
}

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  userId: (name) => game.users.find((u) => u.name === name)?.id ?? null,
  userName: () => game.user.name,

  /**
   * The die rig's calibration: the totals a 1d20 gives under each candidate `CONFIG.Dice.randomUniform` value. The walk
   * takes as its passing value one that totals the top face and as its failing one a value that totals the bottom, so
   * no machine's convention is written here.
   */
  dieProbe: async () => {
    const out = {};
    const keep = CONFIG.Dice.randomUniform;
    try {
      for (const v of [0.025, 0.975, 0, 0.999, 0.5, 0.1, 0.9]) {
        CONFIG.Dice.randomUniform = () => v;
        out[v] = (await new Roll("1d20").evaluate()).total;
      }
    } finally {
      CONFIG.Dice.randomUniform = keep;
    }
    return out;
  },

  /** Arm the recorders and helpers every later call uses on this seat; replaces an earlier install in this page. */
  install: async () => {
    globalThis.__lae?.disarm?.();
    const H = (globalThis.__lae = {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.until = async (fn, ms = 8000, step = 100) => {
      const t0 = Date.now();
      for (;;) {
        let v = null;
        try { v = await fn(); } catch { v = null; }
        if (v) return v;
        if (Date.now() - t0 > ms) return null;
        await H.sleep(step);
      }
    };
    H.said = [];
    H.errors = [];
    H.cards = [];
    // A monster's default sheet is lib's Follower Card, which draws no reach strip; the strip is on the Full Monster sheet, opened as itself on a fresh instance kept per actor.
    H.kept = {};
    H.sheetOf = (uuid) => {
      const doc = fromUuidSync(uuid);
      if (doc?.type !== "monster") return doc?.sheet;
      if (!H.kept[uuid]) {
        const Full = Object.values(CONFIG.Actor.sheetClasses.monster ?? {}).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
        if (Full) H.kept[uuid] = new Full({ document: doc });
      }
      return H.kept[uuid] ?? doc.sheet;
    };
    H.closeSheet = async (uuid) => {
      try { await H.kept[uuid]?.close({ animate: false }); } catch { /* closed */ }
      delete H.kept[uuid];
      try { await fromUuidSync(uuid)?.sheet?.close({ animate: false }); } catch { /* closed */ }
    };
    const notes = ui.notifications;
    const undo = [];
    for (const kind of ["info", "warn", "error"]) {
      const had = Object.hasOwn(notes, kind);
      const original = notes[kind];
      notes[kind] = function (message, ...rest) {
        H.said.push({ kind, text: String(message) });
        if (kind === "error") H.errors.push(`toast: ${String(message)}`.slice(0, 300));
        return original.call(this, message, ...rest);
      };
      undo.push(() => { if (had) notes[kind] = original; else delete notes[kind]; });
    }
    const consoleError = console.error;
    console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); return consoleError.apply(console, args); };
    const onReject = (e) => H.errors.push(`rejection: ${String(e.reason?.message ?? e.reason)}`.slice(0, 300));
    window.addEventListener("unhandledrejection", onReject);
    const CM = foundry.documents.ChatMessage;
    const cmHad = Object.hasOwn(CM, "createDocuments");
    const cmOriginal = CM.createDocuments;
    CM.createDocuments = async function (...args) {
      const docs = await cmOriginal.apply(this, args);
      for (const d of docs ?? []) if (d?.uuid && !H.cards.includes(d.uuid)) H.cards.push(d.uuid);
      return docs;
    };
    H.dice = null;
    H.rig = (v) => { H.dice ??= CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = () => v; };
    H.unrig = () => { if (H.dice) CONFIG.Dice.randomUniform = H.dice; H.dice = null; };
    H.disarm = () => {
      for (const fn of undo) fn();
      console.error = consoleError;
      window.removeEventListener("unhandledrejection", onReject);
      if (cmHad) CM.createDocuments = cmOriginal; else delete CM.createDocuments;
      H.unrig();
    };

    const L = (key) => game.i18n.localize(key);
    const card = (k) => L(`ACKS-LIB.itemRun.card.${k}`);
    H.words = {
      asked: card("asked"), saved: card("saved"), failed: card("failed"), undone: card("undone"), save: card("save"), undo: card("undo"), notEngaged: card("notEngaged"),
      engagedRead: card("engagedRead"), well: card("well"), lifeTimed: card("life.timed"), lifeRaised: card("life.raised"), colResult: L("ACKS-LIB.rollCard.colResult"),
      tagOwed: L("ACKS-LIB.itemRun.strip.tag.owed"), tagFailed: L("ACKS-LIB.itemRun.strip.tag.failed"), tagImmune: L("ACKS-LIB.itemRun.strip.tag.immune"), stripTitle: L("ACKS-LIB.itemRun.strip.title"),
    };

    try {
      if (!ui.chat?.rendered) { await ui.hotbar?.render?.({ force: true }); await ui.chat.render({ force: true }); }
    } catch { /* the walk finds out when it looks for a card */ }

    H.msgEls = (id) => [...document.querySelectorAll(`li.chat-message[data-message-id="${id}"]`)];
    /** One rendered card as plain data: its banner, note, every footnote, each table's rows with cells and buttons. */
    H.read = (id) => {
      const el = H.msgEls(id).find((e) => e.querySelector(".acks-extras-roll-card"));
      if (!el) return null;
      const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
      const btn = (b) => ({ action: b.dataset.action, label: txt(b), tip: b.dataset.tooltipText ?? "", aria: b.getAttribute("aria-label") ?? "", subject: b.dataset.subject ?? "", entryKey: b.dataset.entryKey ?? "", disabled: b.disabled });
      const tables = [...el.querySelectorAll("table.acks-table")].map((t) => {
        const heads = [...t.querySelectorAll("thead th")].map(txt);
        const rows = [...t.querySelectorAll("tbody tr")].map((tr) => {
          const tds = [...tr.children];
          const cells = {};
          heads.forEach((h, i) => { cells[h] = { text: txt(tds[i]), tip: tds[i]?.dataset.tooltipText ?? "" }; });
          return { name: (tds[0]?.childNodes[0]?.textContent ?? "").trim(), nameTip: tds[0]?.dataset.tooltipText ?? "", cls: tr.className, cells, buttons: [...tr.querySelectorAll("button[data-action]")].map(btn) };
        });
        return { heads, rows };
      });
      return {
        title: txt(el.querySelector(".acks-chat-title")), note: txt(el.querySelector(".acks-extras-roll-note")), noteTip: el.querySelector(".acks-extras-roll-note")?.dataset.tooltipText ?? "",
        footnotes: [...el.querySelectorAll(".acks-extras-roll-footnote")].map(txt), tables, footer: [...el.querySelectorAll("footer.acks-extras-roll-actions button")].map(btn),
      };
    };
    /** The engaged row an actor's always-on item holds, as the walk needs it: where it is, the kinds it names and the figures it resolves now. */
    H.engagedOf = (actor) => {
      const R = acksExtras.lib.itemRun.logic;
      for (const item of actor?.items ?? []) {
        if (!R.alwaysOn(item)) continue;
        for (const row of R.itemRunRowsOf(item)) {
          if (row?.reach?.engaged !== true) continue;
          const f = R.reachFigures(row);
          return {
            itemUuid: item.uuid, itemId: item.id, rowKey: row.key, kindKey: R.kindKeyOf(item, row), kinds: [...(row.reach.filter?.kinds ?? [])], save: f?.save ?? null,
            conditions: [...(row.conditions ?? [])], lasts: f?.lasts ?? null, lastsNamed: f?.lastsNamed === true, immunityTurns: f?.immunityTurns ?? null,
          };
        }
      }
      return null;
    };
    return { user: game.user.name, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, extras: game.modules.get("acks-extras")?.version, lib: acksExtras.lib.apiVersion, words: H.words, chat: !!ui.chat?.rendered };
  },

  /** What this seat's recorders caught since the install. */
  caught: () => ({ errors: globalThis.__lae?.errors ?? [], boot: globalThis.__auraBoot ?? null, said: (globalThis.__lae?.said ?? []).map((s) => `${s.kind}: ${s.text}`.slice(0, 160)) }),

  /** The seat's view of the scene; a Player may or may not switch scenes itself, and the walk says which. */
  view: async ({ sceneUuid }) => {
    const H = globalThis.__lae;
    const scene = fromUuidSync(sceneUuid);
    if (!scene) return { viewing: false, reason: "no scene" };
    let threw = null;
    if (canvas.scene?.id !== scene.id) {
      try { await scene.view(); } catch (e) { threw = String(e?.message ?? e); }
      await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 12000);
    }
    return { viewing: canvas.scene?.id === scene.id, threw, isGM: game.user.isGM };
  },

  /** The engagement square's feet, and the scene grid's reading of a cell, from the carrier's own module. */
  square: async ({ sceneUuid }) => {
    const D = await import("/modules/acks-extras/scripts/lib/distance-units.mjs");
    const scene = sceneUuid ? fromUuidSync(sceneUuid) : null;
    return { feet: D.engagementFeet(), cell: scene ? D.sceneFeetPerCell(scene) : 0 };
  },

  /** The library templates that carry a `trait` axis, with that axis's option keys and the variant option keys. Read only. */
  templates: async () => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const out = [];
    for (const d of (await CB.importedDocs("Actor")).filter((x) => x.pack)) {
      const axes = d.system?.toObject?.().axes ?? d.system?.axes ?? [];
      const trait = axes.find((a) => a.key === "trait");
      if (!trait) continue;
      const variants = axes.find((a) => a.key === "variant")?.options ?? [];
      out.push({ uuid: d.uuid, traits: (trait.options ?? []).map((o) => o.key), variant: variants.find((o) => o.flags?.["acks-extras"]?.extras?.encounter)?.key ?? variants[0]?.key ?? "" });
    }
    return out;
  },

  /** One creature from a template under a pinned trait; the engaged row its ability item holds, or null. */
  generate: async ({ templateUuid, trait, variant }) => {
    const GEN = await import("/modules/acks-extras/scripts/lib/template-generate.mjs");
    const template = await fromUuid(templateUuid);
    const actor = await GEN.generateFromTemplate(template, { pins: { trait, ...(variant ? { variant } : {}) } });
    if (!actor) return { ok: false };
    return { ok: true, uuid: actor.uuid, id: actor.id, name: actor.name, engaged: globalThis.__lae.engagedOf(actor) };
  },

  /** Every document of a collection carrying a fixture marker: the actors, so a generated body found by marker is not built twice. */
  byMarker: ({ marker }) => game.actors.contents.filter((a) => a.flags?.world?.fixture === marker).map((a) => ({ uuid: a.uuid, id: a.id, name: a.name, engaged: globalThis.__lae.engagedOf(a) })),

  /** An actor as create data, with the marker, the ownership and the generator's own prototype mark taken out. */
  actorData: ({ uuid, name }) => {
    const data = fromUuidSync(uuid).toObject();
    delete data._id;
    delete data.folder;
    delete data._stats;
    delete data.sort;
    data.ownership = { default: 0 };
    data.name = name;
    if (data.flags?.world) delete data.flags.world.fixture;
    if (data.flags?.["acks-extras"]) delete data.flags["acks-extras"].organisationPrototype;
    return data;
  },

  /** Whether an actor of this id exists and holds the engaged row, read fresh. */
  engagedOfUuid: ({ uuid }) => globalThis.__lae.engagedOf(fromUuidSync(uuid)),

  /** Bring the fixtures to the shape a step starts from; answers what each write read back as. */
  reset: async ({ view, actors, tokens, playerId, saveName, target, kinds }) => {
    const H = globalThis.__lae;
    const out = { effects: 0, owners: {}, targets: {}, viewing: null };
    if (view) {
      const scene = fromUuidSync(view);
      if (canvas.scene?.id !== scene.id) { await scene.view(); await H.until(() => canvas.scene?.id === scene.id && canvas.ready, 15000); }
      out.viewing = canvas.scene?.id === scene.id;
    }
    const player = game.users.get(playerId);
    for (const a of actors) {
      const actor = fromUuidSync(a.uuid);
      const ids = [...(actor?.effects ?? [])].filter((e) => e.flags?.["acks-extras"]?.itemRun).map((e) => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { "acks-extras": { managedDelete: true } });
      out.effects += ids.length;
      const max = Number(actor.system?.hp?.max) || 8;
      const patch = { ownership: { default: 0, [playerId]: a.owned ? 3 : 0 }, "system.hp.max": max, "system.hp.value": max };
      if (a.subject) {
        patch["flags.acks-extras.extras.types"] = kinds;
        if (saveName) patch[`system.saves.${saveName}.value`] = target;
      }
      await actor.update(patch);
      const dead = CONFIG.specialStatusEffects.DEFEATED;
      if (actor.statuses.has(dead)) await actor.toggleStatusEffect(dead, { active: false });
      out.owners[a.role] = actor.testUserPermission(player, "OWNER") === true;
      if (a.subject && saveName) out.targets[a.role] = acksExtras.lib.saves?.saveSpec?.(actor, saveName)?.target ?? null;
    }
    for (const t of tokens) {
      await fromUuidSync(t.uuid).update({ x: t.x, y: t.y, width: 1, height: 1, hidden: false, disposition: t.disposition }, { animate: false });
    }
    await H.sleep(500);
    return out;
  },

  /** The seat's own reading of whether it owns each actor, by the page's own client. */
  ownedBy: ({ uuids }) => Object.fromEntries(Object.entries(uuids).map(([role, uuid]) => [role, fromUuidSync(uuid)?.testUserPermission?.(game.user, "OWNER") === true])),

  /** Whether the filter admits each subject of the first bearer: true, false or null, as the carrier's own test answers. */
  admits: ({ bearer, subjects, filter }) => {
    const L = acksExtras.lib.auraReach.logic;
    const b = fromUuidSync(bearer);
    return Object.fromEntries(Object.entries(subjects).map(([role, uuid]) => {
      const s = fromUuidSync(uuid);
      return [role, L.reachAdmits({ token: b, actor: b.actor }, { token: s, actor: s.actor }, filter)];
    }));
  },
  /** A row's filter, as stored, from an item. */
  filterOf: ({ itemUuid, rowKey }) => {
    const row = acksExtras.lib.itemRun.logic.itemRunRowsOf(fromUuidSync(itemUuid)).find((r) => r?.key === rowKey);
    return foundry.utils.deepClone(row?.reach?.filter ?? {});
  },

  /** The scene's grid set to the engagement square, and the alternating diagonal rule where this build lets a scene or the world hold one. */
  grid: async ({ sceneUuid, feet, units }) => {
    const scene = fromUuidSync(sceneUuid);
    await scene.update({ grid: { size: 100, distance: feet, units, type: CONST.GRID_TYPES.SQUARE } });
    const rule = CONST.GRID_DIAGONALS?.ALTERNATING_1 ?? null;
    const out = { rule: rule !== null, how: "none", before: null, after: null };
    if (rule === null) return out;
    if (scene.schema?.getField?.("grid.diagonals")) {
      out.how = "scene";
      out.before = scene.grid?.diagonals ?? null;
      await scene.update({ "grid.diagonals": rule });
      out.after = scene.grid?.diagonals ?? null;
      out.ok = out.after === rule;
    } else if (game.settings.settings.has("core.gridDiagonals")) {
      out.how = "world setting";
      out.before = game.settings.get("core", "gridDiagonals");
      await game.settings.set("core", "gridDiagonals", rule);
      out.after = game.settings.get("core", "gridDiagonals");
      out.ok = out.after === rule;
    }
    await globalThis.__lae.until(() => canvas.ready, 15000);
    return out;
  },
  /** Put a world setting the walk flipped back. */
  gridBack: async ({ value }) => { await game.settings.set("core", "gridDiagonals", value); return game.settings.get("core", "gridDiagonals") === value; },

  /** The combat the walk runs its fight in: the tracker's flags, the initiatives, and no turn begun. */
  fight: async ({ combatId, rows, inits }) => {
    const combat = game.combats.get(combatId);
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    await combat.updateEmbeddedDocuments("Combatant", Object.keys(rows).map((k) => ({ _id: rows[k], initiative: inits[k], defeated: false, hidden: false })));
    combat.setupTurns();
    if (!combat.active && typeof combat.activate === "function") await combat.activate();
    return { order: combat.turns.map((t) => t.name), active: !!combat.active };
  },
  /** Begin a body's turn in a given round, as the tracker does, and wait for the reach's prompt to land. */
  turnTo: async ({ combatId, round, tokenId, ms = 2200 }) => {
    const H = globalThis.__lae;
    const combat = game.combats.get(combatId);
    const turn = combat.turns.findIndex((t) => t.tokenId === tokenId);
    if (turn < 0) return { ok: false, reason: "no combatant" };
    await combat.update({ round, turn });
    await H.sleep(ms);
    return { ok: true, round: combat.round, turn: combat.turn, started: combat.started === true, up: combat.combatant?.tokenId === tokenId };
  },

  /** The aura Regions on a scene, told apart by whether their activation id is an engaged one, with the bearer token each follows. */
  regions: ({ sceneUuid }) => {
    const L = acksExtras.lib.auraReach.logic;
    const out = { engaged: [], other: [] };
    for (const r of [...(fromUuidSync(sceneUuid)?.regions ?? [])]) {
      const b = [...r.behaviors].find((x) => x.type === "acks-extras.aura");
      if (!b) continue;
      const entry = { id: r.id, uuid: r.uuid, hidden: r.hidden === true, token: r.attachment?.token?.id ?? r.attachment?.token ?? null, deleted: false };
      (L.isEngagedActivation(b.system?.activationId) ? out.engaged : out.other).push(entry);
    }
    return out;
  },
  /** The engaged Regions attached to one token. */
  regionsOn: ({ tokenUuid }) => {
    const L = acksExtras.lib.auraReach.logic;
    return [...(fromUuidSync(tokenUuid)?.attachments?.regions ?? [])]
      .filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura" && L.isEngagedActivation(b.system?.activationId)))
      .map((r) => ({ id: r.id, uuid: r.uuid, hidden: r.hidden === true }));
  },
  deleteRegionsOn: async ({ tokenUuid }) => {
    const L = acksExtras.lib.auraReach.logic;
    const regions = [...(fromUuidSync(tokenUuid)?.attachments?.regions ?? [])].filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura" && L.isEngagedActivation(b.system?.activationId)));
    for (const r of regions) await r.delete();
    await globalThis.__lae.sleep(600);
    return regions.length;
  },

  /** Use an item (a toggle raises, then lowers) and wait for its raise to settle. */
  use: async ({ itemUuid }) => {
    const item = fromUuidSync(itemUuid);
    await item.use();
    await globalThis.__lae.sleep(1200);
    return { active: item.flags?.["acks-extras"]?.itemRun?.activation?.state?.active === true };
  },

  /** Move tokens (by uuid) and wait for the region events to land. */
  move: async ({ moves, ms = 1500 }) => {
    for (const m of moves) await fromUuidSync(m.uuid).update({ x: m.x, y: m.y, ...(m.width ? { width: m.width, height: m.height } : {}), ...(m.hidden !== undefined ? { hidden: m.hidden } : {}) }, { animate: false });
    await globalThis.__lae.sleep(ms);
    return true;
  },
  /** Hide or show a token and wait. */
  hide: async ({ uuid, hidden, ms = 1800 }) => { await fromUuidSync(uuid).update({ hidden }, { animate: false }); await globalThis.__lae.sleep(ms); return true; },
  /** Time each update of a list of moves, in ms; `{animate: false}` throughout. */
  timeMoves: async ({ moves }) => {
    const out = [];
    for (const m of moves) {
      const t0 = performance.now();
      await fromUuidSync(m.uuid).update({ x: m.x, y: m.y }, { animate: false });
      out.push(performance.now() - t0);
    }
    return out;
  },

  /** Every engaged card of one subject, in the order posted, with each entry as the walk reads it. */
  cardsOf: ({ subjectUuid }) => game.messages.contents
    .filter((m) => { const c = m.flags?.["acks-extras"]?.itemRunCard; return c?.kind === "engaged" && c.subject?.uuid === subjectUuid; })
    .map((m) => {
      const c = m.flags["acks-extras"].itemRunCard;
      return {
        id: m.id, uuid: m.uuid, round: c.round, moment: c.moment,
        entries: Object.entries(c.entries ?? {}).map(([key, e]) => ({
          key, state: e.state, saved: e.saved ?? null, total: e.total ?? null, target: e.target ?? null, recordIds: e.recordIds ?? [], presser: e.presser ?? "", whisperId: e.whisperId ?? "", kindKey: e.kindKey ?? "",
          itemUuid: e.itemUuid ?? "", bearers: (e.bearers ?? []).map((b) => b.uuid), momentKey: e.momentKey ?? "", closedBy: e.closedBy?.id ?? "", immune: e.immune ?? null, names: e.names ?? [], life: e.life ?? "",
        })),
      };
    }),
  /** A whispered save card's recipients, subject, entry and answer. */
  whisperOf: ({ id }) => {
    const m = game.messages.get(id);
    const w = m?.flags?.["acks-extras"]?.itemRunWhisper;
    return m && w ? { id, to: [...(m.whisper ?? [])].sort(), subject: w.subject, entryKey: w.entryKey, answered: w.answered ?? null, engaged: w.engaged === true } : null;
  },
  /** The users that own a document, by Foundry's own test, sorted. */
  owners: ({ uuid }) => game.users.filter((u) => fromUuidSync(uuid)?.testUserPermission?.(u, "OWNER")).map((u) => u.id).sort(),
  judges: () => game.users.filter((u) => u.isGM).map((u) => u.id).sort(),

  /** An actor's carrier effects, by id and flags. */
  carrier: ({ uuid }) => [...(fromUuidSync(uuid)?.effects ?? [])].filter((e) => e.flags?.["acks-extras"]?.itemRun).map((e) => ({ id: e.id, statuses: [...(e.statuses ?? [])], dueAt: e.flags["acks-extras"].itemRun.dueAt ?? null, entryKey: e.flags["acks-extras"].itemRun.entryKey ?? "", immune: (e.flags["acks-extras"].rollMods?.parts ?? []).some((p) => p.on === "immune"), cite: !!e.flags["acks-extras"].rollMods?.cite })),
  /** One effect by id, with whether a duration was written to it. */
  effectById: ({ uuid, id }) => {
    const e = fromUuidSync(uuid)?.effects?.get?.(id);
    if (!e) return { present: false };
    const d = e.toObject().duration ?? {};
    return { present: true, dueAt: e.flags?.["acks-extras"]?.itemRun?.dueAt ?? null, entryKey: e.flags?.["acks-extras"]?.itemRun?.entryKey ?? "", durationWritten: !!(d.seconds || d.rounds || d.turns) };
  },
  /** The ids the carrier fixes a kind's records under. */
  recordIds: ({ kindKey }) => ({ lasts: acksExtras.lib.itemRun.logic.lastsRecordId(kindKey), immune: acksExtras.lib.itemRun.logic.immuneRecordId(kindKey) }),
  turnSeconds: () => acksExtras.lib.timeUnit.turnSeconds(),
  worldTime: () => game.time.worldTime,
  /** The names a status goes by on a card, localized, for the first condition a row writes. */
  statusName: ({ id }) => game.i18n.localize(CONFIG.statusEffects?.find?.((s) => s.id === id)?.name ?? String(id)),
  /** A save target as the carrier reads it for an actor. */
  target: ({ actorUuid, save }) => acksExtras.lib.saves?.saveSpec?.(fromUuidSync(actorUuid), save)?.target ?? null,
  /** The text a closed row reads for a user's name, and a holding row's text for a figure of turns. */
  closedWord: ({ name }) => game.i18n.format("ACKS-LIB.itemRun.card.closedBy", { name }),
  holdsWord: ({ turns }) => game.i18n.format("ACKS-LIB.itemRun.card.engagedHolds", { turns }),

  /** Click a card's own button in this seat's page; false where it is not there. */
  click: ({ id, action, subject = null }) => {
    for (const el of globalThis.__lae.msgEls(id)) {
      const b = [...el.querySelectorAll(`button[data-action="${action}"]`)].find((x) => subject === null || x.dataset.subject === subject);
      if (b && !b.disabled) { b.click(); return true; }
    }
    return false;
  },
  rig: ({ value }) => { const H = globalThis.__lae; if (value === null) H.unrig(); else H.rig(value); return true; },
  /** The chat log rebuilt in this seat, then each named message re-drawn, for a seat whose ownership changed under an open card. */
  rerender: async ({ ids }) => {
    await ui.chat.render({ force: true });
    for (const id of ids) { try { await ui.chat.updateMessage?.(game.messages.get(id), false); } catch { /* the log's own redraw above stands */ } }
    await globalThis.__lae.sleep(1200);
    return true;
  },
  /** The carrier's one press the API does not export, called in this page: Not engaged, as a seat with no button would forge it. */
  forgedNotEngaged: async ({ messageId, entryKey }) => {
    const M = await import("/modules/acks-extras/scripts/lib/item-run.mjs");
    const out = await M.notEngaged({ messageId, entryKey });
    return { ok: out?.ok ?? null, reason: out?.reason ?? null };
  },
  /** The lib's own press, called in this page where the card has no button to click. */
  api: async ({ call, args }) => {
    const out = await acksExtras.lib.itemRun[call](args);
    return { ok: out?.ok ?? null, reason: out?.reason ?? null };
  },

  /** Sheet: open an actor's sheet in this seat and read its strip. */
  strip: async ({ actorUuid, open = true }) => {
    const H = globalThis.__lae;
    const actor = fromUuidSync(actorUuid);
    const sheet = H.sheetOf(actorUuid);
    if (open && !sheet.rendered) await sheet.render({ force: true });
    await H.until(() => sheet.element, 6000);
    await H.sleep(open ? 900 : 100);
    const root = sheet.element;
    const strip = root?.querySelector?.(".acks-extras-reach-strip") ?? null;
    const txt = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      rendered: !!sheet.rendered, has: !!strip,
      rows: [...(strip?.querySelectorAll(".acks-extras-reach-strip__row") ?? [])].map((r) => ({
        tag: txt(r.querySelector(".acks-tag")), tagTip: r.querySelector(".acks-tag")?.dataset.tooltipText ?? "",
        nums: [...r.querySelectorAll(".acks-extras-reach-strip__line .acks-nums")].map((n) => ({ text: txt(n), tip: n.dataset.tooltipText ?? "" })),
        leftText: txt(r.querySelector(".acks-tag .acks-nums")),
        buttons: [...r.querySelectorAll("button[data-action]")].map((b) => ({ action: b.dataset.action, label: txt(b) })),
      })),
    };
  },
  stripSave: ({ actorUuid }) => {
    const b = globalThis.__lae.sheetOf(actorUuid)?.element?.querySelector?.('.acks-extras-reach-strip button[data-action="reachStripSave"]');
    if (!b) return false;
    b.click();
    return true;
  },
  closeSheet: async ({ actorUuid }) => { await globalThis.__lae.closeSheet(actorUuid); return true; },
  /** The subject's sheet opened at a narrow width, for the strip's plate; returns the selector the plate clips to. */
  stripPlate: async ({ actorUuid, width }) => {
    const H = globalThis.__lae;
    const sheet = H.sheetOf(actorUuid);
    await sheet.render({ force: true });
    await H.until(() => sheet.element, 6000);
    sheet.setPosition({ width, left: 16, top: 16 });
    await H.sleep(1200);
    const sel = `#${sheet.id} .acks-extras-reach-strip`;
    document.querySelector(sel)?.scrollIntoView({ block: "nearest" });
    await H.sleep(500);
    return { sel, found: !!document.querySelector(sel) };
  },
  /** The popout log at the plate's width, scrolled to a card; returns the selector to clip to. */
  popout: async ({ id, width }) => {
    const H = globalThis.__lae;
    await ui.hotbar.render(true);
    const pop = await ui.chat.renderPopout();
    await H.sleep(1500);
    pop.setPosition({ left: 16, top: 16, width, height: 860 });
    await H.sleep(600);
    const sel = `#${pop.id} li.chat-message[data-message-id="${id}"] .message-content`;
    document.querySelector(sel)?.scrollIntoView({ block: "nearest" });
    await H.sleep(600);
    H.popout = pop;
    return { sel, found: !!document.querySelector(sel) };
  },
  closePopout: async () => { const p = globalThis.__lae?.popout; if (p) { try { await p.close({ animate: false }); } catch { /* closed */ } globalThis.__lae.popout = null; } return true; },

  /** The cards this page posted that the walk may claim: an engaged card or whisper of a fixture subject, or a raised card of a fixture item. */
  claim: ({ subjects, items }) => {
    const out = [];
    for (const uuid of globalThis.__lae?.cards ?? []) {
      const m = fromUuidSync(uuid);
      if (!m) continue;
      const f = m.flags?.["acks-extras"] ?? {};
      if (subjects.includes(f.itemRunCard?.subject?.uuid) || subjects.includes(f.itemRunWhisper?.subject) || items.includes(f.itemRunCard?.itemUuid) || items.includes(f.itemRunWhisper?.itemUuid)) out.push(uuid);
    }
    return out;
  },
  /** The aura Regions left on a scene, to be tracked and swept. */
  leftRegions: ({ sceneUuid }) => [...(fromUuidSync(sceneUuid)?.regions ?? [])].filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura")).map((r) => r.uuid),
};

/* ------------------------------------------------------------------ */
/*  The walk                                                           */
/* ------------------------------------------------------------------ */
let gm = null;
let pl = null;
const call = (run, fn, arg) => run.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const gmRun = (fn, arg) => call(gm, fn, arg);
const plRun = (fn, arg) => call(pl, fn, arg);
/** Poll an async producer until it answers truthy or the time runs out; answers the last value either way. */
async function until(fn, ms = 10000, step = 500) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    try { last = await fn(); } catch { last = null; }
    if (last) return last;
    if (Date.now() - t0 > ms) return last;
    await sleep(step);
  }
}
/** A card read on a seat, polled until `pred` holds of it (the last read comes back either way). */
async function waitCard(run, id, pred, ms = 9000) {
  let last = null;
  await until(async () => { last = await run(P_read, { id }); return last && pred(last) ? last : null; }, ms, 500);
  return last;
}
const P_read = (a) => globalThis.__lae.read(a.id);

const rowsOf = (card) => (card?.tables ?? []).flatMap((t) => t.rows);
let W = null;
const outcomeOf = (row) => row?.cells?.[W.colResult]?.text ?? "";
const hasBtn = (row, action) => (row?.buttons ?? []).some((b) => b.action === action);
const anyBtn = (card, action) => rowsOf(card).some((r) => hasBtn(r, action));
const readLine = (card) => (card?.footnotes ?? []).includes(W.engagedRead);

const S = { round: 0, combat: null, playerViews: false, playerId: null, playerName: "", die: { pass: null, fail: null }, diag: null };
const A = {};
const T = {};
const SC = {};
let ENG = null;
const disposables = [];
const marked = (marker) => (MACHINE.own ? `${marker}@${MACHINE.own}` : marker);
const stripRun = () => (S.playerViews ? plRun : gmRun);

/** A step runs on its own: a throw is a failed check and the walk goes on, unless the world is not the walk's to drive. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name === "WalkBlocked") throw err;
    check(`${name} ran to its end`, false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
}

/** The engaged cards the run's GM window has posted, as tracked uuids, deleted by those ids: the run's own leavings, cleared before a step reads cards. */
async function clearCards() {
  const subjects = ROLE_KEYS.map((k) => T[k].uuid);
  const claimed = await gmRun(P.claim, { subjects, items: [] });
  for (const u of claimed) disposables.push(gm.track(u, "ChatMessage"));
  const tracked = new Set(gm.tracked().map((e) => e.uuid));
  const mine = claimed.filter((u) => tracked.has(u));
  if (mine.length) await gm.sweepTracked({ only: mine });
  for (const u of mine) { const i = disposables.indexOf(u); if (i >= 0) disposables.splice(i, 1); }
  return mine.length;
}

const nextRound = () => ++S.round;
const turn = (role, ms) => gmRun(P.turnTo, { combatId: S.combat.id, round: nextRound(), tokenId: T[role].id, ms });
const cardsOf = (role) => gmRun(P.cardsOf, { subjectUuid: T[role].uuid });
/** The subject's engaged card of a round (the newest one), polled until it holds. */
const cardAt = (role, round, pred = () => true, ms = 12000) => until(async () => [...(await cardsOf(role))].reverse().find((c) => c.round === round && pred(c)) ?? null, ms, 500);

/** The combat a fight runs in: one combatant per fixture body, initiatives set, no turn begun. */
async function startFight() {
  const scene = await gmRun((u) => fromUuidSync(u).id, SC.main);
  const combat = await gm.create("Combat", { scene, active: true });
  S.combat = combat;
  S.round = 0;
  disposables.push(combat.uuid);
  const rows = {};
  for (const k of ROLE_KEYS) rows[k] = (await gm.create("Combatant", { tokenId: T[k].id, sceneId: scene, actorId: A[k].id }, { parent: combat.uuid })).id;
  return gmRun(P.fight, { combatId: combat.id, rows, inits: { U1: 25, U2: 20, S: 15, M: 10, A: 5 } });
}
/** End the fight: the run's own combat, deleted by its id. */
async function endFight() {
  if (!S.combat) return null;
  const sw = await gm.sweepTracked({ only: [S.combat.uuid] });
  const i = disposables.indexOf(S.combat.uuid);
  if (i >= 0) disposables.splice(i, 1);
  S.combat = null;
  return sw;
}
/** The engaged Regions on the walk's scene, polled until their count is `n`. */
const regionsAre = (n, ms = 15000) => until(async () => { const r = await gmRun(P.regions, { sceneUuid: SC.main }); return r.engaged.length === n ? r : null; }, ms, 600);
/** Begin the combat as the tracker's round write does, on a bearer's turn, and wait for the always-on Regions. */
async function begin() {
  const t = await turn("U1");
  const regions = await regionsAre(2);
  if (!regions) {
    const now = await gmRun(P.regions, { sceneUuid: SC.main });
    // The Regions are the code under test, so their absence fails the walk; it never blocks it.
    check("the always-on Regions stand once the combat begins", false, { started: t.started, engaged: now.engaged.length, want: 2 });
    throw new Error("no always-on Regions stand after the combat began; every later step needs them");
  }
  return regions;
}

/** Bring the fixtures to a step's start shape: effects cleared, tokens placed, ownership written and read back in the Player's own page. */
async function reset({ place = HOME, owned = null } = {}) {
  if (S.combat) await turn("A", 900);
  const actors = ROLE_KEYS.map((k) => ({ role: k, uuid: A[k].uuid, owned: owned ? owned.includes(k) : ROLES[k].owned, subject: k === "S" || k === "M" || k === "A" }));
  const tokens = ROLE_KEYS.map((k) => ({ uuid: T[k].uuid, x: (place[k] ?? HOME[k])[0], y: (place[k] ?? HOME[k])[1], disposition: ROLES[k].disposition }));
  const out = await gmRun(P.reset, { view: SC.main, actors, tokens, playerId: S.playerId, saveName: ENG.save, target: SAVE_TARGET, kinds: ENG.kinds });
  await sleep(400);
  S.owned = await plRun(P.ownedBy, { uuids: Object.fromEntries(ROLE_KEYS.map((k) => [k, A[k].uuid])) });
  return out;
}

/** Press a card's button on a seat, with the die rigged there for the press, and restore it after. */
async function press(run, { id, action, subject = null }, die = null) {
  if (die !== null) await run(P.rig, { value: S.die[die] });
  const found = await run(P.click, { id, action, subject });
  return { found, restore: async () => { if (die !== null) await run(P.rig, { value: null }); } };
}
/** Press Save for a subject's open row from a seat's card, wait for the entry to apply, and answer the entry. */
async function saveOn({ run, id, role, die, key }) {
  const p = await press(run, { id, action: "itemRun.roll", subject: null }, die);
  const applied = await until(async () => (await cardsOf(role)).flatMap((c) => c.entries.map((e) => ({ ...e, card: c.id }))).find((e) => e.key === key && e.state === "applied") ?? null, 15000, 600);
  await p.restore();
  return { found: p.found, entry: applied };
}
/** The open entry on the card of a round. */
const openOf = (card) => card?.entries?.find((e) => e.state === "open") ?? null;

/** A wall clock past which the seats are closed and the run ends, since a stuck press would otherwise wait on the world. */
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_800_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { gm?.close(); } catch {}
  try { pl?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

let diagonalWas = null;
try {
  /* ---------------------------------------------------------------- */
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after reload (s)", await reloadRecorded(gm, PORTS.gm));
  pl = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after reload (s)", await reloadRecorded(pl, PORTS.player));
  S.playerId = await gmRun(P.userId, MACHINE.player);
  if (!S.playerId) blocked("no Player user on this world");
  S.playerName = await plRun(P.userName);
  const gi = await gmRun(P.install);
  const pi = await plRun(P.install);
  W = gi.words;
  note("gm", { extras: gi.extras, lib: gi.lib, chatRendered: gi.chat });
  note("player", { extras: pi.extras, chatRendered: pi.chat });
  check("the GM seat is a GM and the primary one", gi.isGM && gi.activeGMIsSelf, { active: gi.activeGMIsSelf });
  check("the Player seat is not a GM", pi.isGM === false);
  if (!gi.activeGMIsSelf) blocked("another client is the active GM; the carrier would run there");
  const bootOf = async (run, who) => {
    const c = await run(P.caught);
    check(`${who}: init, setup and ready reached with no console error`, ["init", "setup", "ready"].every((p) => c.boot?.phases.includes(p)) && c.boot.errors.length === 0, { phases: c.boot?.phases, errors: c.boot?.errors });
  };
  await bootOf(gmRun, "gm");
  await bootOf(plRun, "player");
  const sup = await gmRun(() => acksExtras.lib.auraReach.support());
  if (!sup.ok) blocked(`this core build lacks what a reach is made of: ${JSON.stringify(sup.missing)}`);

  // The die rig is calibrated against this core, never assumed.
  const probe = await gmRun(P.dieProbe);
  const faceOf = (top) => Object.keys(probe).find((k) => probe[k] === top);
  S.die = { pass: faceOf(20) !== undefined ? Number(faceOf(20)) : null, fail: faceOf(1) !== undefined ? Number(faceOf(1)) : null };
  check("a rigged die throws the top face and the bottom face on this core", S.die.pass !== null && S.die.fail !== null, { pass: S.die.pass !== null, fail: S.die.fail !== null });
  if (S.die.pass === null || S.die.fail === null) blocked("no CONFIG.Dice.randomUniform value the walk tried throws a natural 20 and a natural 1; a save cannot be decided");

  /* ---------------------------------------------------------------- */
  section("fixtures: the bearers, from an imported template");
  let unit = (await gmRun(P.byMarker, { marker: marked("lib/aura-t10-unit") }));
  if (unit.length > 1) blocked(`${unit.length} actors carry the marker lib/aura-t10-unit; a marker names one fixture`);
  let found = unit[0]?.engaged ? { uuid: unit[0].uuid, name: unit[0].name, engaged: unit[0].engaged, kept: true } : null;
  if (unit.length === 1 && !found) blocked("the kept fixture lib/aura-t10-unit holds no engaged row any more (the import changed); retire it by its marker and run again");
  if (!found) {
    const templates = await gmRun(P.templates);
    note("library templates with a trait axis", { count: templates.length, traitOptions: templates.map((t) => t.traits.length) });
    let attempts = 0;
    search: for (const tpl of templates) {
      for (const trait of tpl.traits) {
        if (attempts >= MAX_ATTEMPTS) break search;
        attempts += 1;
        const g = await gmRun(P.generate, { templateUuid: tpl.uuid, trait, variant: tpl.variant });
        if (!g?.ok) continue;
        gm.track(g.uuid, "Actor");
        if (g.engaged) { found = { uuid: g.uuid, name: g.name, engaged: g.engaged, kept: false }; break search; }
        await gm.sweepTracked({ only: [g.uuid] });
      }
    }
    note("bodies generated while looking for an engaged row", attempts);
    if (!found) {
      skip("T10", "no library template generates a body whose ability item holds an engaged row: the book that prints the trait is not imported on this world (or the table that gives the row its parts is not), so there is nothing to walk");
      blocked("no library template generates a body with an engaged row: the book is not imported on this world");
    }
    await gm.mark(found.uuid, "lib/aura-t10-unit");
  }
  ENG = found.engaged;
  check("the bearer's ability item holds an engaged row with no activation, the carrier's always-on shape", !!ENG && ENG.kinds.length > 0 && !!ENG.kindKey && !!ENG.save, { kinds: ENG.kinds.length, save: !!ENG.save });
  note("the row's figures resolve (booleans: the walk never prints a figure)", { lasts: ENG.lasts !== null, lastsNamed: ENG.lastsNamed, immunity: ENG.immunityTurns !== null, conditions: ENG.conditions.length });
  const blankLasts = ENG.lastsNamed && ENG.lasts === null;
  const blankImmunity = ENG.immunityTurns === null;
  const row0 = (await gmRun(P.filterOf, { itemUuid: ENG.itemUuid, rowKey: ENG.rowKey }));

  A.U1 = { uuid: found.uuid, id: found.uuid.split(".").pop(), name: found.name };
  const second = await gmRun(P.byMarker, { marker: marked("lib/aura-t10-unit-2") });
  if (second.length > 1) blocked(`${second.length} actors carry the marker lib/aura-t10-unit-2`);
  if (second.length === 1) A.U2 = { uuid: second[0].uuid, id: second[0].id, name: second[0].name };
  else {
    const data = await gmRun(P.actorData, { uuid: A.U1.uuid, name: `${A.U1.name} 2` });
    const made = await gm.fixture("lib/aura-t10-unit-2", "Actor", data);
    A.U2 = { uuid: made.uuid, id: made.id, name: made.name };
  }
  for (const k of ["S", "M", "A"]) {
    const r = ROLES[k];
    const data = { name: r.plain, type: r.type, ownership: { default: 0, [S.playerId]: r.owned ? 3 : 0 }, flags: { [MOD]: { extras: { types: ENG.kinds } } } };
    if (r.type === "monster") data.prototypeToken = { actorLink: true, disposition: r.disposition };
    const f = await gm.fixture(r.marker, "Actor", data);
    A[k] = { uuid: f.uuid, id: f.id, name: f.name };
  }
  check("the second bearer carries the same engaged row", !!(await gmRun(P.engagedOfUuid, { uuid: A.U2.uuid })) && same(ENG.kindKey, (await gmRun(P.engagedOfUuid, { uuid: A.U2.uuid })).kindKey));

  section("fixtures: the scene, the tokens, the shape");
  const square = await gmRun(P.square, { sceneUuid: "" });
  const scene = await gm.fixture("lib/aura-t10-scene", "Scene", { name: "T10 Square", width: 2000, height: 1400, padding: 0, grid: { size: 100, distance: square.feet, units: "ft", type: 1 } });
  SC.main = scene.uuid;
  for (const k of ROLE_KEYS) T[k] = await gm.fixture(`${ROLES[k].marker}-token`, "Token", { name: A[k].name, actorId: A[k].id, actorLink: true, x: HOME[k][0], y: HOME[k][1], disposition: ROLES[k].disposition }, { parent: SC.main });
  note("fixtures", { actors: Object.keys(A).length, tokens: Object.keys(T).length, built: gm.tracked().length });
  const gridRead = await gmRun((a) => { const s = fromUuidSync(a.u); return { feetPerCell: acksExtras.lib.auraReach ? s.grid.distance : null, units: s.grid.units }; }, { u: SC.main });
  const cellNow = (await gmRun(P.square, { sceneUuid: SC.main })).cell;
  check("the walk's scene has the engagement square for a cell", cellNow === square.feet && gridRead.units !== undefined, { cellIsSquare: cellNow === square.feet });
  const first = await reset({ place: ADJ });
  check("the shape reset ran: effects cleared, the scene viewed", first.viewing === true, { effects: first.effects });
  const pv = await plRun(P.view, { sceneUuid: SC.main });
  S.playerViews = pv.viewing === true;
  note("the Player seat's view of the walk's scene", pv);
  note("the strip is read on", S.playerViews ? "the Player seat" : "the GM seat (a Judge owns every body, so its sheet shows the strip a Player's would; the Player's own page does not view the scene)");

  const okShape = same(first.owners, { U1: true, U2: false, S: true, M: false, A: false }) && same(S.owned, { U1: true, U2: false, S: true, M: false, A: false });
  check("the Player seat owns exactly one bearer and the subject, read back in the Player's own page", okShape, { gm: first.owners, player: S.owned });
  const subjectsByRole = { S: T.S.uuid, M: T.M.uuid, A: T.A.uuid };
  const admits = await gmRun(P.admits, { bearer: T.U1.uuid, subjects: subjectsByRole, filter: row0 });
  check("the row's filter admits the subject and the man and refuses the ally, as the carrier's own test answers", admits.S === true && admits.M === true && admits.A === false, admits);
  const targets = first.targets;
  const subjectSave = targets.S;
  note("the stored save target reads back through the carrier (booleans)", { subject: subjectSave !== null, man: targets.M !== null });
  const saveReady = subjectSave !== null;
  const ids = await gmRun(P.recordIds, { kindKey: ENG.kindKey });
  const turnSeconds = await gmRun(P.turnSeconds);

  /* The grid: the engagement square, the alternating diagonal rule where this build has one. */
  const gridSet = await gmRun(P.grid, { sceneUuid: SC.main, feet: square.feet, units: "ft" });
  S.diag = gridSet;
  if (gridSet.how === "world setting") diagonalWas = gridSet.before;
  note("the diagonal rule", { constant: gridSet.rule, heldBy: gridSet.how, wrote: gridSet.how === "none" ? false : gridSet.after !== null && gridSet.after !== gridSet.before });

  /* ---------------------------------------------------------------- */
  /*  Steps 1 and 2, one fight                                          */
  /* ---------------------------------------------------------------- */
  const fight1 = await startFight();
  check("the walk's combat is the tracker's, its order set, no turn begun", fight1.active && fight1.order.length === ROLE_KEYS.length, { active: fight1.active, combatants: fight1.order.length });
  const regionsBegun = await begin();
  note("the combat began (a round written, as the tracker's Begin Combat writes it)", { engagedRegions: regionsBegun.engaged.length, started: true });

  await step("1", async () => {
    section("1 adjacency, on the alternating-diagonal setting (inside the fight: an engaged Region exists only in a started combat)");
    if (gridSet.how === "none") skip("1 (the alternating diagonal rule)", "this build holds the diagonal rule neither on the Scene nor as the world setting `core.gridDiagonals`, so the walk measures on whatever the grid counts and says so");
    else check("1 the scene's diagonal rule reads back as the alternating rule", gridSet.ok === true, { heldBy: gridSet.how });
    const stripOf = async (place) => {
      await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: place[0], y: place[1] }], ms: 1800 });
      let s = await until(async () => { const r = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: true }); return r.has ? r : null; }, 6000, 700);
      s ??= await stripRun()(P.strip, { actorUuid: A.S.uuid, open: false });
      return s;
    };
    await reset({ place: { U1: [700, 700], U2: HOME.U2 } });
    const orth = await stripOf([800, 700]);
    check("1 a subject orthogonally beside a bearer: the strip shows a row for the item kind", orth.has && orth.rows.length === 1, { has: orth.has, rows: orth.rows.length });
    const diag = await stripOf([800, 800]);
    note("1 the diagonal square reads (the offline pins assume how the real grid counts a point on a cell edge)", { strip: diag.has, rows: diag.rows.length, feet: diag.rows[0]?.nums?.[0]?.text ?? null });
    const two = await stripOf([900, 700]);
    check("1 a subject two squares from the bearer has no strip row", !two.has || two.rows.length === 0, { has: two.has, rows: two.rows.length });
    // A two-by-two bearer: its ring follows its edge. The Region is made again at the larger footprint.
    await reset({ place: { U1: HOME.U1, U2: [1200, 300] } });
    await gmRun(P.deleteRegionsOn, { tokenUuid: T.U2.uuid });
    await gmRun(P.move, { moves: [{ uuid: T.U2.uuid, x: 1200, y: 300, width: 2, height: 2 }], ms: 800 });
    await turn("A", 900);
    const remade = await until(async () => ((await gmRun(P.regionsOn, { tokenUuid: T.U2.uuid })).length === 1 ? true : null), 12000, 600);
    check("1 the two-by-two bearer's Region is made again at its larger footprint", !!remade);
    const beside = await stripOf([1400, 400]);
    check("1 a subject beside a two-by-two bearer's far edge is in its ring (the strip shows a row)", beside.has && beside.rows.length === 1, { rows: beside.rows.length });
    const away = await stripOf([1500, 400]);
    check("1 a subject one square beyond that edge is out of it", !away.has || away.rows.length === 0, { rows: away.rows.length });
    // Put the second bearer back at one cell and its Region at one cell.
    await gmRun(P.deleteRegionsOn, { tokenUuid: T.U2.uuid });
    await gmRun(P.move, { moves: [{ uuid: T.U2.uuid, x: HOME.U2[0], y: HOME.U2[1], width: 1, height: 1 }], ms: 800 });
    await turn("A", 900);
    await regionsAre(2);
    await stripRun()(P.closeSheet, { actorUuid: A.S.uuid });
  });

  await step("2", async () => {
    section("2 the Region count");
    const now = await regionsAre(2, 4000);
    check("2 the engaged Regions on the scene equal the T10 bodies after the combat begins", !!now, { engaged: (await gmRun(P.regions, { sceneUuid: SC.main })).engaged.length, bodies: 2 });
    const toggle = await gm.create("Item", { name: "T10 Toggle", type: "item", system: { description: "", subtype: "item", quantity: 1, cost: 0, weight: 0, weight6: 0 }, flags: { [MOD]: { itemRun: { activation: { kind: "toggle", state: { active: false, activationId: "", regionId: "" } }, rows: [{ key: "r1", reach: { pulse: "standing", radius: { value: "10" }, filter: {} } }] } } } }, { parent: A.U1.uuid });
    disposables.push(toggle.uuid);
    S.toggle = toggle.uuid;
    const used = await gmRun(P.use, { itemUuid: toggle.uuid });
    const both = await gmRun(P.regions, { sceneUuid: SC.main });
    check("2 a raised toggle's Region stands beside the engaged ones on the same token", used.active && both.engaged.length === 2 && both.other.length === 1, { engaged: both.engaged.length, other: both.other.length });
    await endFight();
    const gone = await regionsAre(0, 15000);
    const after = await gmRun(P.regions, { sceneUuid: SC.main });
    check("2 delete the combat: no engaged Region is left, and the raised toggle's stays", !!gone && after.other.length === 1, { engaged: after.engaged.length, other: after.other.length });
    await gmRun(P.use, { itemUuid: toggle.uuid });
    const lowered = await gmRun(P.regions, { sceneUuid: SC.main });
    check("2 the toggle lowered, the scene holds no reach", lowered.other.length === 0 && lowered.engaged.length === 0, { other: lowered.other.length });
  });

  /* ---------------------------------------------------------------- */
  /*  Steps 3 to 6, one fight                                           */
  /* ---------------------------------------------------------------- */
  const fight2 = await startFight();
  check("the second combat is the tracker's", fight2.active && fight2.order.length === ROLE_KEYS.length);
  await begin();

  await step("3", async () => {
    section("3 a turn-start prompt");
    await reset({ place: ADJ });
    await clearCards();
    await turn("S");
    const round = S.round;
    const card = await cardAt("S", round);
    const all = (await cardsOf("S")).filter((c) => c.round === round);
    check("3 one engaged card for the subject and the moment", all.length === 1, { cards: all.length });
    const entry = card?.entries?.[0];
    check("3 one row for the item kind, open, naming both adjacent bearers", !!card && card.entries.length === 1 && entry?.state === "open" && entry.kindKey === ENG.kindKey && entry.bearers.length === 2 && entry.bearers.includes(T.U1.uuid) && entry.bearers.includes(T.U2.uuid), { entries: card?.entries?.length, bearers: entry?.bearers?.length });
    const gread = card ? await waitCard(gmRun, card.id, (c) => rowsOf(c).length > 0) : null;
    const grow = rowsOf(gread)[0];
    check("3 the row's Engaged by column names every adjacent bearer of the kind", !!grow && grow.name.includes(A.U1.name) && grow.name.includes(A.U2.name), { rows: rowsOf(gread).length });
    const wid = entry?.whisperId ? entry.whisperId : (await until(async () => (await cardsOf("S")).find((c) => c.round === round)?.entries?.[0]?.whisperId || null, 8000, 500));
    const w = wid ? await gmRun(P.whisperOf, { id: wid }) : null;
    const want = await gmRun(P.owners, { uuid: T.S.uuid });
    const judges = await gmRun(P.judges);
    check("3 the save is whispered to exactly the owners of the subject's token, a Judge among them and the Player seat too", !!w && w.engaged && same(w.to, want) && judges.every((id) => w.to.includes(id)) && w.to.includes(S.playerId), { recipients: w?.to?.length, owners: want.length });
    // The man's row: bearers the Player does not own, a subject it does not own.
    await turn("M");
    const mcard = await cardAt("M", S.round);
    const mw = mcard?.entries?.[0]?.whisperId ? await gmRun(P.whisperOf, { id: mcard.entries[0].whisperId }) : null;
    const pread = mcard ? await waitCard(plRun, mcard.id, () => true, 4000) : null;
    check("3 the body of an admitted kind beside the second bearer alone is asked, with that one bearer named", !!mcard && mcard.entries.length === 1 && mcard.entries[0].bearers.length === 1 && mcard.entries[0].bearers[0] === T.U2.uuid, { entries: mcard?.entries?.length });
    check("3 that body's whisper does not reach the Player seat, and the Player's copy of the card shows it no row", !!mw && !mw.to.includes(S.playerId) && rowsOf(pread).length === 0, { recipients: mw?.to?.length, playerRows: rowsOf(pread).length });
    // The ally: the bearers' own side, refused.
    const beforeAlly = (await cardsOf("A")).length;
    await turn("A");
    check("3 a body on the bearers' own side beside a bearer is never asked", (await cardsOf("A")).length === beforeAlly && beforeAlly === 0, { cards: (await cardsOf("A")).length });
  });

  await step("4", async () => {
    section("4 a step-in prompt, and a second kind");
    await reset({ place: { ...ADJ, S: HOME.S } });
    await clearCards();
    await turn("U1");
    const before = (await cardsOf("S")).length;
    await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: ADJ.S[0], y: ADJ.S[1] }], ms: 2500 });
    check("4 stepping into reach on another body's turn prompts nothing", (await cardsOf("S")).length === before, { cards: (await cardsOf("S")).length });
    await turn("S");
    const own = await cardAt("S", S.round, () => true, 8000);
    check("4 the subject is asked at its own turn start", !!own && own.moment === "turnStart", { moment: own?.moment });
    // On its own turn: out, a new initiative with the subject outside, then in.
    await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: HOME.S[0], y: HOME.S[1] }], ms: 1200 });
    await turn("S");
    const outside = (await cardsOf("S")).filter((c) => c.round === S.round).length;
    check("4 a turn that starts with the subject outside the square asks nothing", outside === 0, { cards: outside });
    await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: ADJ.S[0], y: ADJ.S[1] }], ms: 2500 });
    const stepped = await cardAt("S", S.round, () => true, 8000);
    check("4 the subject stepping in on its own turn is asked, as a step-in", !!stepped && stepped.moment === "enter" && stepped.entries.length === 1, { moment: stepped?.moment });
    // A second kind asked at the same moment: a copy of the second bearer's item under another kind key.
    const data = await gmRun((a) => { const it = fromUuidSync(a.uuid).toObject(); delete it._id; delete it.folder; if (it.flags?.world) delete it.flags.world.fixture; it.flags["acks-extras"].cookbook = { ...(it.flags["acks-extras"].cookbook ?? {}), id: `${a.kind}-second` }; return it; }, { uuid: ENG.itemUuid, kind: ENG.kindKey });
    const extra = await gm.create("Item", data, { parent: A.U2.uuid });
    disposables.push(extra.uuid);
    await turn("A", 900);
    const made = await regionsAre(3, 12000);
    check("4 the second kind's item makes its own Region on the second bearer at the next round", !!made, { engaged: (await gmRun(P.regions, { sceneUuid: SC.main })).engaged.length });
    await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: HOME.S[0], y: HOME.S[1] }], ms: 800 });
    await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: ADJ.S[0], y: ADJ.S[1] }], ms: 800 });
    await turn("S");
    const two = await cardAt("S", S.round, (c) => c.entries.length >= 2, 12000);
    check("4 a second kind asked at the same moment is a second row of the same card", !!two && two.entries.length === 2 && new Set(two.entries.map((e) => e.kindKey)).size === 2 && (await cardsOf("S")).filter((c) => c.round === S.round).length === 1, { entries: two?.entries?.length });
    // Take the second kind away again: its Region by its id, then the item.
    const mine = (await gmRun(P.regionsOn, { tokenUuid: T.U2.uuid }));
    const itemUuids = [extra.uuid];
    for (const r of mine) {
      const stillMine = await gmRun((a) => [...fromUuidSync(a.r).behaviors].some((b) => String(b.system?.sourceUuid ?? "") === a.item), { r: r.uuid, item: extra.uuid });
      if (stillMine) { gm.track(r.uuid, "Region"); disposables.push(r.uuid); }
    }
    const tracked = new Set(gm.tracked().map((e) => e.uuid));
    await gm.sweepTracked({ only: [...disposables.filter((u) => tracked.has(u) && (itemUuids.includes(u) || u.includes(".Region.")))] });
    for (const u of [...disposables]) if (itemUuids.includes(u) || u.includes(".Region.")) disposables.splice(disposables.indexOf(u), 1);
    const back = await regionsAre(2, 8000);
    check("4 the second kind's Region is gone again and two engaged Regions stand", !!back, { engaged: (await gmRun(P.regions, { sceneUuid: SC.main })).engaged.length });
  });

  await step("5", async () => {
    section("5 Not engaged");
    await reset({ place: ADJ });
    await clearCards();
    await turn("S");
    const round = S.round;
    const card = await cardAt("S", round, (c) => !!c.entries[0]?.whisperId);
    const entry = openOf(card);
    check("5 the subject's row is open on a card naming two bearers", !!entry && entry.bearers.length === 2, { bearers: entry?.bearers?.length });
    const gread = card ? await waitCard(gmRun, card.id, (c) => rowsOf(c).length > 0) : null;
    const pread = card ? await waitCard(plRun, card.id, (c) => rowsOf(c).length > 0) : null;
    check("5 control: the Judge's copy of the row offers Not engaged and shows the read line", hasBtn(rowsOf(gread)[0], "itemRun.notEngaged") && readLine(gread), { notEngaged: hasBtn(rowsOf(gread)[0], "itemRun.notEngaged"), readLine: readLine(gread) });
    check("5 the Player owning one of two bearers: the row shows its Save, no Not engaged and no read line", hasBtn(rowsOf(pread)[0], "itemRun.roll") && !anyBtn(pread, "itemRun.notEngaged") && !readLine(pread), { save: hasBtn(rowsOf(pread)[0], "itemRun.roll"), notEngaged: anyBtn(pread, "itemRun.notEngaged"), readLine: readLine(pread) });
    const forged = await plRun(P.forgedNotEngaged, { messageId: card.id, entryKey: entry.key });
    const afterForged = (await cardsOf("S")).find((c) => c.id === card.id)?.entries?.find((e) => e.key === entry.key);
    check("5 a Not engaged forged from that Player's page (the carrier's own press, which no button draws) is refused as not the bearers' owner and writes nothing", forged.ok === false && forged.reason === "notBearer" && afterForged?.state === "open", forged);
    // Both bearers to the Player, by the GM seat, read back; the Player's chat redrawn.
    await gmRun(async (a) => { for (const u of a.uuids) await fromUuidSync(u).update({ ownership: { default: 0, [a.player]: 3 } }); }, { uuids: [A.U1.uuid, A.U2.uuid], player: S.playerId });
    await sleep(500);
    const owns = await plRun(P.ownedBy, { uuids: { U1: A.U1.uuid, U2: A.U2.uuid } });
    check("5 the GM seat gave the Player both bearers, read back in the Player's page", owns.U1 === true && owns.U2 === true, owns);
    await plRun(P.rerender, { ids: [card.id, entry.whisperId] });
    const owning = await waitCard(plRun, card.id, (c) => anyBtn(c, "itemRun.notEngaged"), 12000);
    check("5 the Player owning every bearer is offered Not engaged and the read line", anyBtn(owning, "itemRun.notEngaged") && readLine(owning), { notEngaged: anyBtn(owning, "itemRun.notEngaged"), readLine: readLine(owning) });
    const before = await gmRun(P.carrier, { uuid: A.S.uuid });
    const clicked = await plRun(P.click, { id: card.id, action: "itemRun.notEngaged" });
    const closed = await until(async () => (await cardsOf("S")).find((c) => c.id === card.id)?.entries?.find((e) => e.key === entry.key && e.state === "closed") ?? null, 12000, 600);
    const closedWord = await gmRun(P.closedWord, { name: S.playerName });
    const gclosed = await waitCard(gmRun, card.id, (c) => outcomeOf(rowsOf(c)[0]) === closedWord, 9000);
    check("5 the Player pressed Not engaged in the chat card and the row closed, naming who closed it and keeping its bearers", clicked === true && !!closed && closed.closedBy === S.playerId && closed.bearers.length === 2 && outcomeOf(rowsOf(gclosed)[0]) === closedWord, { clicked, closedBy: closed?.closedBy === S.playerId, bearers: closed?.bearers?.length });
    const written = await gmRun(P.carrier, { uuid: A.S.uuid });
    check("5 no record on the subject and no save written", written.length === before.length && closed?.recordIds?.length === 0 && closed?.saved === null, { records: written.length - before.length });
    const wsp = entry.whisperId ? await gmRun(P.whisperOf, { id: entry.whisperId }) : null;
    const wread = entry.whisperId ? await waitCard(plRun, entry.whisperId, (c) => rowsOf(c).length > 0, 5000) : null;
    check("5 the whisper no longer offers a roll, and reads as answered", !!wsp && wsp.answered !== null && !anyBtn(wread, "itemRun.roll"), { answered: wsp?.answered, roll: anyBtn(wread, "itemRun.roll") });
    // Undo on the closed row: open again, its Save and Not engaged back, its moment key held again.
    const undid = await plRun(P.click, { id: card.id, action: "itemRun.undo" });
    const reopened = await until(async () => (await cardsOf("S")).find((c) => c.id === card.id)?.entries?.find((e) => e.key === entry.key && e.state === "open") ?? null, 12000, 600);
    const popen = await waitCard(plRun, card.id, (c) => hasBtn(rowsOf(c)[0], "itemRun.roll") && hasBtn(rowsOf(c)[0], "itemRun.notEngaged"), 9000);
    check("5 Undo on the closed row reopens it, with its Save and its Not engaged", undid === true && !!reopened && hasBtn(rowsOf(popen)[0], "itemRun.roll") && hasBtn(rowsOf(popen)[0], "itemRun.notEngaged"), { undid, reopened: !!reopened });
    await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: HOME.S[0], y: HOME.S[1] }], ms: 1000 });
    await gmRun(P.move, { moves: [{ uuid: T.S.uuid, x: ADJ.S[0], y: ADJ.S[1] }], ms: 2500 });
    const reasked = (await cardsOf("S")).filter((c) => c.round === round).flatMap((c) => c.entries).filter((e) => e.kindKey === ENG.kindKey).length;
    check("5 the moment key is held again: the same initiative's step-in asks nothing more of the kind", reasked === 1, { entries: reasked });
  });

  await step("6", async () => {
    section("6 a failure");
    if (!saveReady) { skip("6", "the subject's save target does not read back through the carrier (this build derives the save, or the subject's stored target is not read), so no save can be decided"); return; }
    await reset({ place: ADJ });
    await clearCards();
    const statusName = ENG.conditions[0] ? await gmRun(P.statusName, { id: ENG.conditions[0] }) : "";
    const pressSeat = blankLasts ? gmRun : plRun;
    if (blankLasts) {
      // A row that names its interval but resolves none refuses a Player's press: that is the row's page, not the walk's.
      await turn("S");
      const c0 = await cardAt("S", S.round);
      const refused = await plRun(P.api, { call: "pressRoll", args: { itemUuid: ENG.itemUuid, rowKey: ENG.rowKey, subject: T.S.uuid, messageId: c0?.id, entryKey: openOf(c0)?.key } });
      check("6 the timed interval is blank: a Player's press is refused as no figure", refused.ok === false && refused.reason === "noFigure", refused);
      skip("6 (the timed interval and its dueAt)", "no timed interval is imported on this world (the row names it and nothing resolves), so a failure writes its record with no end and there is no turns-from-now figure to compare");
    }
    // Moment 1: the whisper. Moment 2: the chat card. Moment 3: the sheet's strip.
    await turn("S");
    let card = await cardAt("S", S.round, (c) => !!c.entries[0]?.whisperId);
    let entry = openOf(card);
    const wid = entry?.whisperId;
    const wread = wid ? await waitCard(pressSeat, wid, (c) => anyBtn(c, "itemRun.roll"), 10000) : null;
    check("6 the whisper reaches the pressing seat with a roll", !!wread && anyBtn(wread, "itemRun.roll"), { whisper: !!wid });
    const now1 = await gmRun(P.worldTime);
    const r1 = await saveOn({ run: pressSeat, id: wid, role: "S", die: "fail", key: entry?.key });
    check("6 the whisper's Save applied the entry: Failed, one record written, pressed by that seat", !!r1.entry && r1.entry.saved === false && r1.entry.recordIds.length >= 1 && (blankLasts || r1.entry.presser === S.playerId), { found: r1.found, saved: r1.entry?.saved, records: r1.entry?.recordIds?.length });
    const gcard = await waitCard(gmRun, card.id, (c) => outcomeOf(rowsOf(c)[0]) === W.failed, 9000);
    const lifeWord = blankLasts ? W.lifeRaised : W.lifeTimed;
    check("6 the card reads Failed, and its well names the condition and the interval", outcomeOf(rowsOf(gcard)[0]) === W.failed && (gcard?.footnotes ?? []).some((f) => f.startsWith(W.well) && (!statusName || f.includes(statusName)) && f.includes(lifeWord)), { failed: outcomeOf(rowsOf(gcard)[0]) === W.failed, well: (gcard?.footnotes ?? []).some((f) => f.startsWith(W.well)) });
    const rec1 = await gmRun(P.effectById, { uuid: A.S.uuid, id: ids.lasts });
    const records = await gmRun(P.carrier, { uuid: A.S.uuid });
    check("6 one record on the subject under the kind's fixed lasts id", rec1.present && records.filter((e) => e.id === ids.lasts).length === 1, { records: records.length });
    if (!blankLasts) {
      const want = now1 + ENG.lasts * turnSeconds;
      check("6 that record's dueAt is the world time plus the row's turns, and no duration is written", rec1.dueAt !== null && Math.abs(rec1.dueAt - want) < 5 && rec1.durationWritten === false, { dueAt: rec1.dueAt !== null, durationWritten: rec1.durationWritten });
    }
    const stripA = await until(async () => { const s = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: true }); return s.rows.some((x) => x.tag.startsWith(W.tagFailed)) ? s : null; }, 10000, 700) ?? (await stripRun()(P.strip, { actorUuid: A.S.uuid, open: false }));
    const frow = stripA.rows.find((x) => x.tag.startsWith(W.tagFailed));
    if (!blankLasts) {
      const left = rec1.dueAt !== null ? Math.ceil((rec1.dueAt - (await gmRun(P.worldTime))) / turnSeconds) : null;
      check("6 the strip row reads Failed with its turns left", !!frow && left !== null && parseInt(frow.leftText, 10) === left, { failed: !!frow, turnsMatch: !!frow && parseInt(frow.leftText, 10) === left });
    } else check("6 the strip row reads Failed", !!frow, { failed: !!frow });

    // Moment 2, the chat card.
    await turn("S");
    card = await cardAt("S", S.round, (c) => !!c.entries[0]?.whisperId);
    entry = openOf(card);
    const pcard = await waitCard(pressSeat, card.id, (c) => anyBtn(c, "itemRun.roll"), 10000);
    const r2 = await saveOn({ run: pressSeat, id: card.id, role: "S", die: "fail", key: entry?.key });
    const rec2 = await gmRun(P.effectById, { uuid: A.S.uuid, id: ids.lasts });
    check("6 a second failure from the chat card replaces the record under its id, now the second entry's", !!pcard && !!r2.entry && r2.entry.saved === false && rec2.present && rec2.entryKey === entry?.key, { replaced: rec2.entryKey === entry?.key });

    // Moment 3, the strip.
    await turn("S");
    card = await cardAt("S", S.round, (c) => !!c.entries[0]?.whisperId);
    entry = openOf(card);
    const owed = await until(async () => { const s = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: true }); return s.rows.some((x) => x.tag.startsWith(W.tagOwed) && x.buttons.some((b) => b.action === "reachStripSave")) ? s : null; }, 12000, 700);
    check("6 the strip shows Save owed with a Save for the owner", !!owed, { owed: !!owed });
    await stripRun()(P.rig, { value: S.die.fail });
    const clicked = await stripRun()(P.stripSave, { actorUuid: A.S.uuid });
    const done3 = await until(async () => (await cardsOf("S")).flatMap((c) => c.entries).find((e) => e.key === entry?.key && e.state === "applied") ?? null, 15000, 600);
    await stripRun()(P.rig, { value: null });
    check("6 the strip's Save applied the same entry the card holds, Failed", clicked === true && !!done3 && done3.saved === false, { clicked, saved: done3?.saved });
    // The combat goes: the record stays, the Region and the strip row go.
    await endFight();
    await regionsAre(0, 15000);
    const lastRec = await gmRun(P.effectById, { uuid: A.S.uuid, id: ids.lasts });
    const stripAfter = await until(async () => { const s = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: false }); return s.has ? null : s; }, 8000, 700);
    check("6 delete the combat: the record stays on the subject while the Regions and the strip row go", lastRec.present && (await gmRun(P.regions, { sceneUuid: SC.main })).engaged.length === 0 && !!stripAfter, { record: lastRec.present });
    await stripRun()(P.closeSheet, { actorUuid: A.S.uuid });
  });

  /* ---------------------------------------------------------------- */
  /*  Steps 7 to 11, one fight                                          */
  /* ---------------------------------------------------------------- */
  const fight3 = await startFight();
  check("the third combat is the tracker's", fight3.active && fight3.order.length === ROLE_KEYS.length);
  await begin();

  await step("7", async () => {
    section("7 a pass");
    if (!saveReady) { skip("7", "the subject's save target does not read back through the carrier, so no save can be decided"); return; }
    await reset({ place: ADJ });
    await clearCards();
    await turn("S");
    const card = await cardAt("S", S.round, (c) => !!c.entries[0]?.whisperId);
    const entry = openOf(card);
    const pressSeat = blankLasts ? gmRun : plRun;
    const pcard = await waitCard(pressSeat, card.id, (c) => anyBtn(c, "itemRun.roll"), 10000);
    const r = await saveOn({ run: pressSeat, id: card.id, role: "S", die: "pass", key: entry?.key });
    check("7 a passed save from the chat card applied the entry: Saved", !!pcard && !!r.entry && r.entry.saved === true, { saved: r.entry?.saved });
    const win = (await gmRun(P.carrier, { uuid: A.S.uuid })).filter((e) => e.id === ids.immune);
    const gcard = await waitCard(gmRun, card.id, (c) => rowsOf(c).length > 0 && outcomeOf(rowsOf(c)[0]) !== W.asked, 9000);
    if (blankImmunity) {
      check("7 no immunity is imported: the card reads Saved alone and no immunity record is written", outcomeOf(rowsOf(gcard)[0]) === W.saved && win.length === 0, { records: win.length });
    } else {
      const holds = await gmRun(P.holdsWord, { turns: ENG.immunityTurns });
      check("7 one record under the kind's immunity id, and the card reads Saved with the immunity it gave", win.length === 1 && win[0].immune === true && outcomeOf(rowsOf(gcard)[0]) === holds, { records: win.length, holds: outcomeOf(rowsOf(gcard)[0]) === holds });
      const stripI = await until(async () => { const s = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: true }); return s.rows.some((x) => x.tag.startsWith(W.tagImmune)) ? s : null; }, 10000, 700) ?? (await stripRun()(P.strip, { actorUuid: A.S.uuid, open: false }));
      const irow = stripI.rows.find((x) => x.tag.startsWith(W.tagImmune));
      const left = win[0]?.dueAt ? Math.ceil((win[0].dueAt - (await gmRun(P.worldTime))) / turnSeconds) : null;
      check("7 the strip row reads Immune with its turns left", !!irow && left !== null && parseInt(irow.leftText, 10) === left, { immune: !!irow, turnsMatch: !!irow && parseInt(irow.leftText, 10) === left });
      await turn("S");
      const none = (await cardsOf("S")).filter((c) => c.round === S.round).flatMap((c) => c.entries).filter((e) => e.kindKey === ENG.kindKey).length;
      check("7 the next turn start asks nothing of that kind", none === 0, { entries: none });
    }
    await stripRun()(P.closeSheet, { actorUuid: A.S.uuid });
  });

  await step("8", async () => {
    section("8 Undo");
    if (!saveReady) { skip("8", "the subject's save target does not read back through the carrier, so no save can be decided"); return; }
    await reset({ place: ADJ });
    await clearCards();
    const plain = await gm.create("ActiveEffect", { name: "T10 Plain Effect", disabled: false }, { parent: A.S.uuid });
    disposables.push(plain.uuid);
    const plainId = plain.id ?? String(plain.uuid).split(".").pop();
    const pressSeat = blankLasts ? gmRun : plRun;
    const failOnce = async () => {
      await turn("S");
      const card = await cardAt("S", S.round, (c) => !!c.entries[0]?.whisperId);
      const entry = openOf(card);
      await waitCard(pressSeat, card.id, (c) => anyBtn(c, "itemRun.roll"), 10000);
      const r = await saveOn({ run: pressSeat, id: card.id, role: "S", die: "fail", key: entry?.key });
      return { card, entry: r.entry };
    };
    const a = await failOnce();
    const b = await failOnce();
    const rec = await gmRun(P.effectById, { uuid: A.S.uuid, id: ids.lasts });
    check("8 two failures: the second replaced the first's record under the one id", !!a.entry && !!b.entry && rec.present && rec.entryKey === b.entry.key && same(a.entry.recordIds, b.entry.recordIds), { replaced: rec.entryKey === b.entry?.key });
    const aUndo = await waitCard(pressSeat, a.card.id, (c) => hasBtn(rowsOf(c)[0], "itemRun.undo"), 10000);
    const clickedA = await pressSeat(P.click, { id: a.card.id, action: "itemRun.undo" });
    await until(async () => (await cardsOf("S")).flatMap((c) => c.entries).find((e) => e.key === a.entry?.key && e.state === "undone") ?? null, 12000, 600);
    const afterA = await gmRun(P.effectById, { uuid: A.S.uuid, id: ids.lasts });
    const aRead = await waitCard(gmRun, a.card.id, (c) => outcomeOf(rowsOf(c)[0]) === W.undone, 9000);
    check("8 Undo on the first entry: it reads Undone and the record a later entry replaced stays", !!aUndo && clickedA === true && outcomeOf(rowsOf(aRead)[0]) === W.undone && afterA.present && afterA.entryKey === b.entry?.key, { clicked: clickedA, kept: afterA.present });
    const clickedB = await pressSeat(P.click, { id: b.card.id, action: "itemRun.undo" });
    await until(async () => (await cardsOf("S")).flatMap((c) => c.entries).find((e) => e.key === b.entry?.key && e.state === "undone") ?? null, 12000, 600);
    const afterB = await gmRun(P.effectById, { uuid: A.S.uuid, id: ids.lasts });
    const kept = (await gmRun(P.effectById, { uuid: A.S.uuid, id: plainId })).present;
    check("8 Undo on the entry that holds it: exactly its stored record goes and the plain effect stays", clickedB === true && afterB.present === false && kept, { clicked: clickedB, gone: afterB.present === false, plainKept: kept });
  });

  await step("9", async () => {
    section("9 a hidden bearer");
    await reset({ place: { ...HOME, U2: ADJ.U2, S: [1000, 700] } });
    await clearCards();
    const before = await gmRun(P.regionsOn, { tokenUuid: T.U2.uuid });
    check("9 the second bearer holds its Region before it is hidden", before.length === 1 && before[0].hidden === false, { regions: before.length });
    const stripBefore = await until(async () => { const s = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: true }); return s.has ? s : null; }, 8000, 700);
    check("9 the subject beside only that bearer has a strip row while it is shown", !!stripBefore && stripBefore.rows.length === 1, { rows: stripBefore?.rows?.length ?? 0 });
    await gmRun(P.hide, { uuid: T.U2.uuid, hidden: true });
    const during = await gmRun(P.regionsOn, { tokenUuid: T.U2.uuid });
    note("9 what a hidden bearer's Region is (the recipe says gone; the code only skips a hidden body at the making and leaves a made Region to core's own hiding)", { regions: during.length, hidden: during.filter((r) => r.hidden).length });
    const stripDuring = await until(async () => { const s = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: false }); return s.has ? null : s; }, 8000, 700);
    check("9 the subject beside only a hidden bearer has no strip row", !!stripDuring, { stripGone: !!stripDuring });
    await turn("S");
    check("9 the subject beside only a hidden bearer is not asked at its turn start", (await cardsOf("S")).filter((c) => c.round === S.round).length === 0, { cards: (await cardsOf("S")).filter((c) => c.round === S.round).length });
    await gmRun(P.hide, { uuid: T.U2.uuid, hidden: false });
    const after = await gmRun(P.regionsOn, { tokenUuid: T.U2.uuid });
    note("9 the revealed bearer's Region", { regions: after.length, hidden: after.filter((r) => r.hidden).length });
    const stripAfter = await until(async () => { const s = await stripRun()(P.strip, { actorUuid: A.S.uuid, open: true }); return s.has ? s : null; }, 10000, 700);
    check("9 revealed, the strip row returns", !!stripAfter && stripAfter.rows.length === 1, { rows: stripAfter?.rows?.length ?? 0 });
    await turn("S");
    const asked = await cardAt("S", S.round, () => true, 10000);
    check("9 the next moment prompts", !!asked && asked.entries.length >= 1, { entries: asked?.entries?.length });
    await stripRun()(P.closeSheet, { actorUuid: A.S.uuid });
  });

  await step("10", async () => {
    section("10 timings (figures, quoted, never checks)");
    await reset({ place: HOME });
    const regions = await gmRun(P.regions, { sceneUuid: SC.main });
    note("10a the engaged Regions against the T10 bodies", { regions: regions.engaged.length, bodies: 2 });
    skip("10b (the wall time to deploy a warband with T10 against one without)", "a warband is a Roll of the organisation generator, which `lib-beastman-warband.mjs` walks and sweeps from the Roll's own result; this walk's bodies are generated singly, so there is no warband to deploy and time");
    const spots = (from) => Array.from({ length: 10 }, (_, i) => ({ x: from[0] + (i % 2 === 0 ? 100 : 0), y: from[1] }));
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const t10 = await gmRun(P.timeMoves, { moves: spots(HOME.U1).map((p) => ({ uuid: T.U1.uuid, ...p })) });
    const plainBody = await gmRun(P.timeMoves, { moves: spots(HOME.A).map((p) => ({ uuid: T.A.uuid, ...p })) });
    note("10c the median of ten {animate: false} updates of a body, in ms (the update's round trip)", { t10: Math.round(median(t10)), plain: Math.round(median(plainBody)) });
    if (median(t10) > MOVE_FINDING_MS) note("10c FINDING for `architect`, not a fix", `the T10 body's median is over ${MOVE_FINDING_MS} ms`);
    const t0 = Date.now();
    await gmRun(P.timeMoves, { moves: ROLE_KEYS.map((k, i) => ({ uuid: T[k].uuid, x: HOME[k][0] + 100 * ((i % 2) + 1), y: HOME[k][1] })) });
    note("10d one pass moving every body, wall time in ms (the five bodies, two of them T10)", Date.now() - t0);
  });

  await step("11", async () => {
    section("11 shots");
    if (!SHOTS) { skip("11", "SHOTS=1 is not set"); return; }
    await reset({ place: ADJ });
    await clearCards();
    await turn("S");
    const card = await cardAt("S", S.round, (c) => !!c.entries[0]?.whisperId);
    if (!card) { skip("11 (the engaged card plate)", "no card was posted to shoot"); return; }
    await waitCard(gmRun, card.id, (c) => rowsOf(c).length > 0);
    try {
      const where = await gmRun(P.popout, { id: card.id, width: 320 });
      if (!where.found) note("shot lib-aura-engaged-card", "the card is not in the popout log");
      else {
        const shot = await gm.shot(`${SHOT_DIR}/lib-aura-engaged-card.png`, where.sel);
        note("shot lib-aura-engaged-card", { file: shot.file, bytes: shot.bytes });
      }
    } catch (err) { note("shot lib-aura-engaged-card", `not taken: ${err?.message ?? err}`); } finally { await gmRun(P.closePopout).catch(() => {}); }
    try {
      const where = await gmRun(P.stripPlate, { actorUuid: A.S.uuid, width: 320 });
      if (!where.found) note("shot lib-aura-engaged-strip", "the strip is not on the subject's sheet");
      else {
        const shot = await gm.shot(`${SHOT_DIR}/lib-aura-engaged-strip.png`, where.sel);
        note("shot lib-aura-engaged-strip", { file: shot.file, bytes: shot.bytes });
      }
    } catch (err) { note("shot lib-aura-engaged-strip", `not taken: ${err?.message ?? err}`); } finally { await gmRun(P.closeSheet, { actorUuid: A.S.uuid }); }
    skip("11 (the closed row's plate)", "the capture driver clips a plate to a selector and cannot crop the closer's user name out of a closed row's \"Not engaged · name\"; the plates above are of an open row, which names no user");
  });

  const late = await gmRun(P.caught);
  const lateP = await plRun(P.caught);
  note("errors this walk's seats recorded after ready", { gm: late.errors.length, player: lateP.errors.length });
  check("neither seat logged a console error during the walk", late.errors.length === 0 && lateP.errors.length === 0, { gm: late.errors.length, player: lateP.errors.length });
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm && T.S) {
      const subjects = ROLE_KEYS.filter((k) => T[k]).map((k) => T[k].uuid);
      const claimed = await gmRun(P.claim, { subjects, items: [S.toggle].filter(Boolean) });
      for (const u of claimed) disposables.push(gm.track(u, "ChatMessage"));
      if (SC.main) for (const u of await gmRun(P.leftRegions, { sceneUuid: SC.main })) disposables.push(gm.track(u, "Region"));
      await gmRun(P.closePopout);
      const tracked = new Set(gm.tracked().map((e) => e.uuid));
      const sw = await gm.sweepTracked({ only: [...new Set(disposables)].filter((u) => tracked.has(u)) });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm && diagonalWas !== null) note("the world's diagonal setting put back", await gmRun(P.gridBack, { value: diagonalWas })); } catch (err) { console.error("diagonal setting:", err?.message ?? err); }
  try { if (gm) await gmRun(() => globalThis.__lae?.disarm?.()); } catch {}
  try { if (pl) await plRun(() => globalThis.__lae?.disarm?.()); } catch {}
  try { if (pl) await pl.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const id of skipped) console.log(`SKIP  ${id}`);
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  console.log(`SKIPPED ${skipped.length} step(s) not reached`);
  console.log(`SUMMARY lib/aura-engaged: ${passed}/${checks.length} checks passed${failed.length ? `; failed: ${failed.join(" | ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}
